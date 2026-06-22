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
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

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

// --- #3 deterministic market-hours gate -------------------------------------
// US cash session: Mon–Fri 09:30–16:00 America/New_York. (Market holidays aren't modeled — an
// off-day fire just produces a harmless duplicate snapshot; widen/ignore as you like.)
function isMarketOpen(now = new Date()) {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(now).reduce((o, x) => (o[x.type] = x.value, o), {});
  if (['Sat', 'Sun'].includes(p.weekday)) return false;
  const mins = (parseInt(p.hour, 10) % 24) * 60 + parseInt(p.minute, 10);
  return mins >= 570 && mins < 960; // 9:30 .. 16:00
}

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

function git(a) { return execFileSync('git', a, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim(); }
git(['add', 'data.json']);
const staged = execFileSync('git', ['diff', '--cached', '--name-only'], { cwd: ROOT }).toString().trim();
if (!staged) { log('data.json unchanged — nothing to commit.'); process.exit(0); }
git(['commit', '-m', `data: snapshot ${label}`]);
log('committed. pushing…');
let pushed = false;
for (let i = 1; i <= 4 && !pushed; i++) {
  try { execFileSync('git', ['push'], { cwd: ROOT, stdio: 'inherit' }); pushed = true; }
  catch (e) {
    if (i === 4) { console.error('[run] push failed after 4 attempts:', e.message.split('\n')[0]); process.exit(1); }
    const wait = 2 ** i; log(`push failed, retrying in ${wait}s…`);
    execFileSync(process.execPath, ['-e', `setTimeout(()=>{}, ${wait * 1000})`]); // blocking sleep, no shell
  }
}
log('✅ pushed data.json to', git(['rev-parse', '--abbrev-ref', 'HEAD']));
