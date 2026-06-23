// producer/run.mjs — the single deterministic entrypoint for the producer's tail.
//
// The scheduled agent's ONLY job becomes: make the Robinhood MCP calls and `Write` the raw
// files into producer/raw/ (per PRODUCER.md), then run:
//
//     node producer/run.mjs "Jun 22 2026, 3:45 PM ET"
//
// This script does EVERYTHING else deterministically — optional Alpha Vantage fetch, picks,
// options, the encrypted build, validation, and the git commit/push — with no improvised shell,
// so an unattended run can't stall on a permission prompt. A hard failure aborts BEFORE any
// commit, so a broken or plaintext build never ships.
//
// Flags:
//   --require-open   exit without building/pushing when US equities are closed (old behavior).
//                    Default: build + push always, so social/news stay fresh off-hours.
//   --no-push        build + validate but don't commit/push (dry run).
//   --no-av          skip the direct Alpha Vantage fetch even if ALPHAVANTAGE_KEY is set.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { isMarketOpen } from './market.mjs';

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

// Guard: never build (and risk pushing) without the core portfolio inputs the agent should have
// fetched. If they're missing, the RH fetch failed — abort loudly rather than ship a broken file.
for (const f of ['portfolio.json', 'positions.json']) {
  if (!existsSync(join(RAW, f))) { console.error(`[run] ABORT — producer/raw/${f} is missing. Did the Robinhood fetch run?`); process.exit(1); }
}

// 1. Alpha Vantage direct fetch (optional; only when a key is configured) — #2.
if (process.env.ALPHAVANTAGE_KEY && !flags.has('--no-av')) tryNode('av-fetch.mjs');
else log(process.env.ALPHAVANTAGE_KEY ? 'AV fetch skipped (--no-av)' : 'AV direct fetch off (no ALPHAVANTAGE_KEY) — using any agent-saved av-src + RH-synthesized fundamentals');

// 2–3. Picks + options (each optional, gated on its raw input; non-fatal so the snapshot still ships).
if (existsSync(join(RAW, 'scan.json'))) tryNode('picks-build.mjs'); else log('no scan.json — skipping picks');
if (existsSync(join(RAW, 'options-orders.json'))) tryNode('options-build.mjs'); else log('no options-orders.json — skipping options');

// 4. Build the (encrypted) data.json — FATAL on failure: abort before any commit.
log('building data.json…');
try { node('build-data.mjs', [label]); }
catch (e) { console.error('[run] ABORT — build-data failed:', e.message.split('\n')[0]); process.exit(1); }

// 5. Validate the replay contract (warn-only).
tryNode('validate.mjs');

// 6. Safety check, then commit + push.
const dataPath = join(ROOT, 'data.json');
let parsed;
try { parsed = JSON.parse(readFileSync(dataPath, 'utf8')); }
catch { console.error('[run] ABORT — data.json is not valid JSON after build.'); process.exit(1); }
if (process.env.PF_PASSPHRASE && parsed.enc !== 1) {
  console.error('[run] ABORT — PF_PASSPHRASE is set but data.json is NOT encrypted. Refusing to push plaintext holdings.');
  process.exit(1);
}

if (flags.has('--no-push')) { log('built OK · --no-push set, stopping (no commit).'); process.exit(0); }

// Publish the built data.json onto origin/main DETERMINISTICALLY — regardless of the (often
// upstream-less) scheduled-session branch, and tolerating main moving mid-flight. Hold the file in
// memory and re-apply it on a fresh branch at the newest origin/main each attempt, so the producer
// never needs the agent to improvise git. (run.mjs is Node, so the in-memory copy avoids any cp.)
function git(a, stdio = ['ignore', 'pipe', 'pipe']) { return execFileSync('git', a, { cwd: ROOT, stdio }); }
function sleep(s) { execFileSync(process.execPath, ['-e', `setTimeout(()=>{}, ${s * 1000})`]); } // blocking, no shell
const fresh = readFileSync(dataPath);
let pushed = false;
for (let i = 1; i <= 4 && !pushed; i++) {
  try {
    git(['fetch', 'origin', 'main']);
    git(['checkout', '-f', '-B', 'pf-publish', 'origin/main']); // newest main; -f drops the local data.json
    writeFileSync(dataPath, fresh);                              // re-apply our snapshot on top
    git(['add', 'data.json']);
    const staged = git(['diff', '--cached', '--name-only']).toString().trim();
    if (!staged) { log('data.json identical to main — nothing to publish.'); process.exit(0); }
    git(['commit', '-m', `data: snapshot ${label}`]);
    git(['push', 'origin', 'HEAD:main'], 'inherit');
    pushed = true;
  } catch (e) {
    if (i === 4) { console.error('[run] publish failed after 4 attempts:', e.message.split('\n')[0]); process.exit(1); }
    const wait = 2 ** i; log(`publish failed (main may have moved), retrying in ${wait}s…`);
    sleep(wait);
  }
}
log('✅ published data.json to origin/main');
