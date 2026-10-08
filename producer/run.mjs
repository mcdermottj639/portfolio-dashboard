// producer/run.mjs — the single deterministic entrypoint for the producer's tail.
//
// The scheduled agent's ONLY job becomes: make the Robinhood MCP calls and `Write` the raw
// files into producer/raw/ (per PRODUCER.md), then run:
//
//     node producer/run.mjs "Jun 22 2026, 3:45 PM ET"
//
// This script does EVERYTHING else deterministically — optional Alpha Vantage fetch, picks,
// options, the encrypted build, validation, and the git commit/push — with no improvised shell,
// subject to the host permission checks. A denial is terminal; do not bypass it.
// Mandatory validation and authenticated encryption precede every publish.
//
// Flags:
//   --require-open   exit without building/pushing when US equities are closed (old behavior).
//                    Default: build + push always, so social/news stay fresh off-hours.
//   --no-push        build + validate but don't commit/push (dry run).
//   --no-av          skip the direct Alpha Vantage fetch even if ALPHAVANTAGE_KEY is set.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { isMarketOpen } from './market.mjs';
import { assertEncryptedSnapshot, publishSnapshot } from './snapshot-publish.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const RAW = join(__dirname, 'raw');
const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith('--')));
const label = args.find((a) => !a.startsWith('--')) || new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC';

const log = (...m) => console.log('[run]', ...m);
function node(script, extra = []) {
  execFileSync(process.execPath, [join(__dirname, script), ...extra], { stdio: 'inherit', cwd: ROOT });
}
function tryNode(script, extra = []) {
  try { node(script, extra); return true; }
  catch (e) { log(`⚠️  ${script} failed (non-fatal): ${e.message.split('\n')[0]}`); return false; }
}

// Deterministic market-hours gate (shared with preflight.mjs via market.mjs).
const open = isMarketOpen();
log(`market is ${open ? 'OPEN' : 'CLOSED'} · label "${label}"`);
if (!open && flags.has('--require-open')) { log('closed + --require-open → nothing to do, exiting clean.'); process.exit(0); }

// Fail before building if we cannot preserve/decrypt the prior history. Publishing always
// requires a passphrase; plaintext remains available only for explicit local --no-push runs.
let sourceBlob;
try {
  if (!flags.has('--no-push') && !process.env.PF_PASSPHRASE)
    throw new Error('PF_PASSPHRASE is required for publishing.');
  const priorBytes = readFileSync(join(ROOT, 'data.json'));
  if (JSON.parse(priorBytes).enc === 1)
    await assertEncryptedSnapshot(priorBytes, process.env.PF_PASSPHRASE);
  if (!flags.has('--no-push')) sourceBlob = execFileSync('git', ['rev-parse', 'HEAD:data.json'], { cwd: ROOT, encoding: 'utf8' }).trim();
} catch (e) {
  console.error('[run] ABORT — prior snapshot / encryption preflight failed:', e.message.split('\n')[0]);
  process.exit(1);
}

// Guard: never build (and risk pushing) without the core portfolio inputs the agent should have
// fetched. If they're missing, the RH fetch failed — abort loudly rather than ship a broken file.
for (const f of ['portfolio.json', 'positions.json']) {
  if (!existsSync(join(RAW, f))) { console.error(`[run] ABORT — producer/raw/${f} is missing. Did the Robinhood fetch run?`); process.exit(1); }
}

// 1. Alpha Vantage direct fetch (optional; only when a key is configured) — #2.
if (process.env.ALPHAVANTAGE_KEY && !flags.has('--no-av')) tryNode('av-fetch.mjs');
else log(process.env.ALPHAVANTAGE_KEY ? 'AV fetch skipped (--no-av)' : 'AV direct fetch off (no ALPHAVANTAGE_KEY) — using any agent-saved av-src + RH-synthesized fundamentals');

// 1b. Supplementary fundamentals (Finnhub / FMP) — optional; fills the fields/holdings AV's free
// daily cap skipped. AV stays primary; runs only when a provider key is configured.
if ((process.env.FINNHUB_KEY || process.env.FMP_KEY) && !flags.has('--no-extfund')) tryNode('extfund-fetch.mjs');
else log((process.env.FINNHUB_KEY || process.env.FMP_KEY) ? 'ext-fund fetch skipped (--no-extfund)' : 'ext-fund fetch off (no FINNHUB_KEY / FMP_KEY)');

// 1c. Flow & Positioning signals (analyst revisions / insider Form 4 clusters / earnings surprise) —
// optional, Finnhub-only, once/day ET gate inside. Display-only until the sleeve weight is switched on
// (see PROPOSAL-flow-signals.md Phase 4); non-fatal like every other enrichment step.
if (process.env.FINNHUB_KEY && !flags.has('--no-flow')) tryNode('flow-fetch.mjs');
else log(process.env.FINNHUB_KEY ? 'flow fetch skipped (--no-flow)' : 'flow signals off (no FINNHUB_KEY)');

// 2–3. Picks + options (each optional, gated on its raw input; non-fatal so the snapshot still ships).
if (existsSync(join(RAW, 'scan.json'))) tryNode('picks-build.mjs'); else log('no scan.json — skipping picks');
if (existsSync(join(RAW, 'options-orders.json'))) tryNode('options-build.mjs'); else log('no options-orders.json — skipping options');

// 4. Build the (encrypted) data.json — FATAL on failure: abort before any commit.
log('building data.json…');
try { node('build-data.mjs', [label]); }
catch (e) { console.error('[run] ABORT — build-data failed:', e.message.split('\n')[0]); process.exit(1); }

// 5. Validation is a publication gate, not a warning.
try { node('validate.mjs'); }
catch { console.error('[run] ABORT — validation failed; no commit or push.'); process.exit(1); }

// 5b. Watchlist reminders — picks-build / options-build emit these sidecars only on FETCH_ALL.
// run.mjs can't do the syncs itself (MCP writes are agent-only), so just remind the agent of the
// post-publish steps.
if (existsSync(join(RAW, 'picks-watchlist.json')))
  log('NOTE: picks rebuilt → after publishing, sync the "Dashboard Top 10 Picks" Robinhood watchlist (PRODUCER.md → "Sync the Picks watchlist").');
if (existsSync(join(RAW, 'option-watchlist.json')))
  log('NOTE: options ideas rebuilt → after publishing, sync the Robinhood OPTIONS watchlist (PRODUCER.md → "Sync the options watchlist").');

// 6. Publish from a detached worktree. Keep the caller's branch and edits intact.
if (flags.has('--no-push')) { log('built and validated · --no-push set (not published).'); process.exit(0); }
try {
  const result = await publishSnapshot({ root: ROOT, bytes: readFileSync(join(ROOT, 'data.json')),
    passphrase: process.env.PF_PASSPHRASE, sourceBlob, label });
  log(result.published ? `PUBLISHED ${result.commit} — encrypted data.json verified on origin/main`
    : `UNCHANGED ${result.commit} — data.json already matches origin/main`);
} catch (e) {
  console.error(`[run] ${e.code === 'PUBLISH_UNVERIFIED' ? 'PUBLISH_UNVERIFIED' : 'NOT_PUBLISHED'} —`, e.message.split('\n')[0]);
  if (e.stderr) console.error(e.stderr.toString().trim());
  console.error('[run] STOP. Preserve the exact error. Permission/auth/validation failures need diagnosis; do not try alternate push methods.');
  process.exit(1);
}
