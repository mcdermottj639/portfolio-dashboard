// INTEGRATION check of build-data.mjs — runs the real script against fixture raw/ inputs and a
// plaintext prior data.json, then asserts the carry-forward + guard behavior that has bitten us:
//   · a fresh EMPTY bars array must NOT wipe the carried-forward hist series
//   · quotes carry forward per-symbol (a missing symbol keeps its last price, not $0)
//   · a run with NO picks (and no prior picks) must still publish (the post-emit log guard)
//   · the social-pages sidecar is reused instead of a live ApeWisdom fetch
//   · alerts.json records a ±7% day-move crossing for a held name
//   · flow sidecars land in data.flow and carry forward per-symbol (this path referenced an
//     out-of-scope variable once — an empty fixture would not have caught it)
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
  // Agentic account: fresh fetch holds 10 sh AAA (priced @108 from quotes-1) + $2000 cash. The prior
  // snapshot held the SAME 10 sh @100 with only $50 cash → equity 1050 → 3080. The $8/sh price move
  // accounts for +$80; the remaining ~$1950 is a DEPOSIT and must be inferred into cumFlow, not return.
  'agentic-portfolio.json': { data: { cash: '2000.00', buying_power: '2000.00' } },
  'agentic-positions.json': { data: { positions: [{ symbol: 'AAA', quantity: '10', average_buy_price: '95' }] } },
  // Broker-reported realized P&L, per account and per asset class (get_realized_pnl). Both accounts
  // are present, so data.realized must carry the split AND all-account totals.
  'realized-main.json': { data: { window: '2026-01-01..2026-07-02', data_points: [
    { realized_gain: '3963.72', number_of_trades: 420 }, { realized_gain: null, number_of_trades: 0 },
  ], total_returns: '3963.72' } },
  'realized-main-opt.json': { data: { data_points: [{ realized_gain: '550', number_of_trades: 2 }], total_returns: '550' } },
  'realized-agentic.json': { data: { data_points: [{ realized_gain: '233.18', number_of_trades: 5 }], total_returns: '233.18' } },
  // Real closing trades for the agentic account — the wash-sale ledger's authoritative source. One
  // loss (CCC), one gain (AAA, must be ignored). The prior snapshot's INFERRED 'ZZZ' entry has no
  // matching trade and must be dropped rather than keep blocking a buy for 30 days.
  'agentic-trades.json': { data: { trades: [
    { timestamp: new Date(Date.now() - 3 * 24 * 3600e3).toISOString(), symbol: 'CCC', side: 'sell', quantity: '2', price: '41.10', realized_gain: '-18.40' },
    { timestamp: new Date(Date.now() - 2 * 24 * 3600e3).toISOString(), symbol: 'AAA', side: 'sell', quantity: '1', price: '108.00', realized_gain: '12.00' },
  ] } },
};

const prior = {
  schemaVersion: 1,
  generatedAt: new Date(Date.now() - 24 * 3600e3).toISOString(),
  generatedAtLabel: 'test prior',
  quotes: { AAA: q(100, 99), BBB: q(55, 54) },
  hist: { day: { AAA: bars(5, 95), BBB: bars(5, 50) }, month: { AAA: bars(3, 80) } },
  recorded: {},
  agentic: {
    asOf: new Date(Date.now() - 24 * 3600e3).toISOString(), cash: 50, buyingPower: 50, equity: 1050,
    positions: [{ symbol: 'AAA', qty: 10, avgCost: 95, px: 100, value: 1000 }],
    equityHistory: [{ t: '2026-07-01', equity: 1050, cumFlow: 0 }],
    // A phantom entry from the old position-diff inference (a wrong-account fetch booked it).
    recentLosses: [{ sym: 'ZZZ', date: new Date(Date.now() - 5 * 24 * 3600e3).toISOString().slice(0, 10), avgCost: 50, exitPx: 44 }],
  },
  // The stale owner-typed margin-only figure the broker fetch must supersede.
  realized: { year: '2026 YTD', equity: 2335, options: 0, total: 2335, approx: true },
  // av last landed data on an earlier day and does NOT run this run — its stamp must survive, or the
  // once/day gate would clear itself and re-fetch on the very next run.
  fetchDays: { av: '2026-07-30' },
  // BBB was scored on an earlier run and is NOT re-fetched this run — it must carry forward.
  flow: { asOf: '2026-07-01', symbols: {
    BBB: { sym: 'BBB', asOf: '2026-07-01', flow: { score: 6.1, coverage: ['revision', 'insider'], components: { revision: 7, insider: 4.8 } } },
  }, polEvents: [
    { filer: 'FILER A', sym: 'LMT', side: 'buy', txn: '2026-06-20', chamber: 'house', lag: 40 },
    { filer: 'FILER B', sym: 'LMT', side: 'buy', txn: '2026-06-25', chamber: 'house', lag: 40 },
  ] },
};

// Fresh flow sidecar for AAA only (flow-fetch.mjs writes these into raw/flow/<SYM>.json).
const FLOWDIR = join(RAW, 'flow');
const EXTDIR = join(RAW, 'ext-fund');
const FLOW_FIXTURE = {
  sym: 'AAA', asOf: '2026-07-02',
  flow: { score: 7.4, coverage: ['revision', 'insider', 'surprise'], components: { revision: 8.2, insider: 7.0, surprise: 6.2 } },
  revision: { score: 8.2, level: 8.1, delta: 0.24, analysts: 41 },
  insider: { score: 7.0, buyers: 3, sellers: 0, cluster: 'buy', filings: 3 },
  surprise: { score: 6.2, avgSurprisePct: 2.9, positives: 3, quarters: 4 },
};

// Congressional ledger: the poll re-serves one row the prior snapshot already holds (the rolling 25-row
// window does this constantly) plus one genuinely new filer. Dedup must keep the ledger at 3, and the
// third distinct filer must tip LMT into a cluster.
const pol = (filer, sym, side, txn) => ({ filer, sym, side, txn, chamber: 'house', lag: 40 });
const POLFLOW_FIXTURE = { asOf: '2026-07-02', events: [
  pol('FILER B', 'LMT', 'buy', '2026-06-25'),   // duplicate of one already in `prior`
  pol('FILER C', 'LMT', 'buy', '2026-06-28'),   // new → third distinct filer → cluster
] };

const hadData = existsSync(DATA);
mkdirSync(RAW, { recursive: true });
if (hadData) copyFileSync(DATA, BAK);
const fixturePaths = Object.keys(FIXTURES).map((f) => join(RAW, f));

let stdout = '';
try {
  writeFileSync(DATA, JSON.stringify(prior));
  for (const [f, obj] of Object.entries(FIXTURES)) writeFileSync(join(RAW, f), JSON.stringify(obj));
  mkdirSync(FLOWDIR, { recursive: true });
  writeFileSync(join(FLOWDIR, 'AAA.json'), JSON.stringify(FLOW_FIXTURE));
  writeFileSync(join(FLOWDIR, '_polflow.json'), JSON.stringify(POLFLOW_FIXTURE));
  // A fresh ext-fund sidecar this run → the extfund fetch-day stamp must be set to today.
  mkdirSync(EXTDIR, { recursive: true });
  writeFileSync(join(EXTDIR, 'overview-AAA.json'), JSON.stringify({ structuredContent: { Symbol: 'AAA', EPS: '4.20', ForwardPE: '18.5' } }));

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

  // Agentic deposit inference: equity 1050 → 3080 (10sh AAA @108 = 1080 + 2000 cash). Price move on the
  // held 10 sh = 10×(108−100)=+80; the rest (~1950) is a deposit → cumFlow ≈ 1950, NOT return.
  const agEH = out.agentic.equityHistory;
  const newPt = agEH[agEH.length - 1];
  eq('agentic equity point recorded', newPt.equity, 3080);
  eq('deposit inferred into cumFlow (not counted as return)', Math.abs(newPt.cumFlow - 1950) < 1, true);

  // Realized P&L is now per account and broker-sourced — the stale owner figure must NOT win.
  eq('realized is broker-sourced when the fetch landed', out.realized.source, 'robinhood');
  eq('stale owner realized figure superseded', out.realized.total !== 2335, true);
  eq('margin account realized split by asset class', [out.realized.accounts.main.equity, out.realized.accounts.main.options], [3963.72, 550]);
  eq('agentic account realized captured', out.realized.accounts.agentic.total, 233.18);
  eq('top-level total covers BOTH accounts', out.realized.total, 4746.90);
  eq('broker figures are not flagged approx', out.realized.approx, false);
  eq('account masks carried for the card', [out.realized.accounts.main.mask, out.realized.accounts.agentic.mask], ['••••0741', '••••3900']);

  // Wash-sale ledger: real closing trades replace the inference wholesale.
  eq('ledger sourced from real trades', out.agentic.lossSource, 'trades');
  eq('only genuine realized losses are listed', out.agentic.recentLosses.map((l) => l.sym), ['CCC']);
  eq('phantom inferred entry dropped', out.agentic.recentLosses.some((l) => l.sym === 'ZZZ'), false);
  eq('dropped phantom is logged', stdout.includes('no matching closing trade'), true);
  eq('realized loss amount carried', out.agentic.recentLosses[0].realized, -18.40);

  // Flow & Positioning: the fresh sidecar lands, the unfetched name carries forward, and asOf advances
  // to THIS run's day (the block computes its own day — asOfDay is scoped to the agentic section).
  eq('fresh flow sidecar lands in data.flow', out.flow.symbols.AAA.flow.score, 7.4);
  eq('flow component detail preserved for display', out.flow.symbols.AAA.insider.cluster, 'buy');
  eq('unfetched symbol flow carries forward', out.flow.symbols.BBB.flow.score, 6.1);
  eq('flow asOf advances on a fresh fetch', out.flow.asOf, new Date(out.generatedAt).toISOString().slice(0, 10));
  eq('flow run logged', stdout.includes('flow signals: 2 symbols (1 fresh this run)'), true);

  // Congressional ledger accumulates across runs (raw/ is wiped every run, so it can only live here).
  eq('ledger accumulated, duplicate poll row not double-counted', out.flow.polEvents.length, 3);
  eq('third distinct filer tips it into a cluster', out.flow.polClusters.LMT.filers, 3);
  eq('cluster direction recorded', out.flow.polClusters.LMT.side, 'buy');

  // Provider fetch-day stamps. These are what the once/day gates key off, and they MUST carry forward
  // on a run where that provider didn't fetch — raw/ is wiped every scheduled run, so if skipping
  // cleared the stamp the next run would re-fetch and the gate would never hold.
  const today = new Date(out.generatedAt).toISOString().slice(0, 10);
  eq('extfund stamp set when fresh sidecars landed', out.fetchDays.extfund, today);
  eq('av stamp carried forward when av did not run', out.fetchDays.av, '2026-07-30');
} catch (e) {
  fail++;
  console.error('✗ build-data run failed:', e.status != null ? `exit ${e.status}` : e.message);
  if (e.stdout) console.error(String(e.stdout).slice(-2000));
  if (e.stderr) console.error(String(e.stderr).slice(-2000));
} finally {
  // ALWAYS restore the real (encrypted) data.json and remove fixtures + test artifacts.
  if (hadData) { copyFileSync(BAK, DATA); unlinkSync(BAK); }
  for (const p of [...fixturePaths, join(RAW, 'alerts.json'), join(FLOWDIR, 'AAA.json'), join(FLOWDIR, '_polflow.json'), join(EXTDIR, 'overview-AAA.json')]) { try { unlinkSync(p); } catch {} }
}

console.log(fail ? `\n${fail} FAILED (${pass} passed)` : `all ${pass} checks passed ✅`);
process.exit(fail ? 1 : 0);
