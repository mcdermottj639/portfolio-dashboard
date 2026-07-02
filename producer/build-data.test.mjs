// INTEGRATION check of build-data.mjs — runs the real script against fixture raw/ inputs and a
// plaintext prior data.json, then asserts the carry-forward + guard behavior that has bitten us:
//   · a fresh EMPTY bars array must NOT wipe the carried-forward hist series
//   · quotes carry forward per-symbol (a missing symbol keeps its last price, not $0)
//   · a run with NO picks (and no prior picks) must still publish (the post-emit log guard)
//   · the social-pages sidecar is reused instead of a live ApeWisdom fetch
//   · alerts.json records a ±7% day-move crossing for a held name
//
// The repo's real data.json is backed up and restored (even on failure) — this test writes a
// PLAINTEXT data.json while it runs, so never commit mid-test. No network, no MCP.
// Run: node producer/build-data.test.mjs
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, copyFileSync, existsSync, unlinkSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DATA = join(ROOT, 'data.json');
const RAW = join(__dirname, 'raw');
const BAK = join(RAW, '.data.json.testbak'); // raw/ is gitignored — safe scratch for the backup

let pass = 0, fail = 0;
const eq = (label, got, want) => { const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.error(`✗ ${label}\n    got  ${g}\n    want ${w}`); } };

const q = (last, prev) => ({ last_trade_price: String(last), adjusted_previous_close: String(prev), previous_close: String(prev) });
const bars = (n, base) => Array.from({ length: n }, (_, i) => ({ begins_at: `2026-06-${10 + i}T13:30:00Z`, close_price: String(base + i), interpolated: false }));

const FIXTURES = {
  'portfolio.json': { data: { total_value: '1000.00' } },
  'positions.json': { data: { positions: [{ symbol: 'AAA', quantity: '1', average_buy_price: '95' }] } },
  // Fresh quotes cover AAA only — BBB must carry forward from the prior snapshot.
  // AAA jumps to +9.1% on the day (prior snapshot had it at +1.0%) → a day-move alert must fire.
  'quotes-1.json': { data: { results: [{ symbol: 'AAA', ...q(108, 99) }] } },
  // Fresh day-hist returns AAA with EMPTY bars — must not clobber the carried series.
  'hist-day-1.json': { data: { results: [{ symbol: 'AAA', bars: [] }] } },
  // Sidecar as picks-build would leave it — build-data must reuse it (no live ApeWisdom fetch).
  'social-pages.json': { asOf: '2026-07-02T14:00:00.000Z', source: 'apewisdom', rows: [
    { ticker: 'AAA', name: 'Aaa Inc', rank: '12', mentions: '50', mentions_24h_ago: '40' },
  ] },
};

const prior = {
  schemaVersion: 1,
  generatedAt: new Date(Date.now() - 24 * 3600e3).toISOString(),
  generatedAtLabel: 'test prior',
  quotes: { AAA: q(100, 99), BBB: q(55, 54) },
  hist: { day: { AAA: bars(5, 95), BBB: bars(5, 50) }, month: { AAA: bars(3, 80) } },
  recorded: {},
};

const hadData = existsSync(DATA);
mkdirSync(RAW, { recursive: true });
if (hadData) copyFileSync(DATA, BAK);
const fixturePaths = Object.keys(FIXTURES).map((f) => join(RAW, f));

let stdout = '';
try {
  writeFileSync(DATA, JSON.stringify(prior));
  for (const [f, obj] of Object.entries(FIXTURES)) writeFileSync(join(RAW, f), JSON.stringify(obj));

  // PF_PASSPHRASE stripped → plaintext in, plaintext out (dev mode). Throws on non-zero exit —
  // which is itself the regression test for the old unguarded data.picks.candidates.length crash.
  stdout = execFileSync(process.execPath, [join(__dirname, 'build-data.mjs'), 'integration test'],
    { env: { ...process.env, PF_PASSPHRASE: '' }, cwd: ROOT, encoding: 'utf8', stderr: 'pipe' });

  const out = JSON.parse(readFileSync(DATA, 'utf8'));
  eq('empty fresh bars do NOT wipe carried hist', out.hist.day.AAA.length, 5);
  eq('carried hist content intact', out.hist.day.AAA[0].close_price, '95');
  eq('unfetched symbol hist carries forward', out.hist.day.BBB.length, 5);
  eq('month hist carries forward', out.hist.month.AAA.length, 3);
  eq('fresh quote wins', out.quotes.AAA.last_trade_price, '108');
  eq('missing quote carries forward (no $0)', out.quotes.BBB.last_trade_price, '55');
  eq('no-picks run still publishes (log guard)', stdout.includes('no picks'), true);
  eq('social sidecar reused (no live fetch)', stdout.includes('reused picks-build fetch'), true);
  eq('social shaped from sidecar', out.social.tickers.AAA.tracked, true);

  const alerts = JSON.parse(readFileSync(join(RAW, 'alerts.json'), 'utf8')).alerts;
  eq('day-move crossing alert fired for held name', alerts.map((a) => a.kind + ':' + a.symbol), ['day-move:AAA']);
} catch (e) {
  fail++;
  console.error('✗ build-data run failed:', e.status != null ? `exit ${e.status}` : e.message);
  if (e.stdout) console.error(String(e.stdout).slice(-2000));
  if (e.stderr) console.error(String(e.stderr).slice(-2000));
} finally {
  // ALWAYS restore the real (encrypted) data.json and remove fixtures + test artifacts.
  if (hadData) { copyFileSync(BAK, DATA); unlinkSync(BAK); }
  for (const p of [...fixturePaths, join(RAW, 'alerts.json')]) { try { unlinkSync(p); } catch {} }
}

console.log(fail ? `\n${fail} FAILED (${pass} passed)` : `all ${pass} checks passed ✅`);
process.exit(fail ? 1 : 0);
