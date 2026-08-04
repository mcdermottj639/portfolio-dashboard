// Offline unit checks for polflow.mjs — no network. Run: node producer/polflow.test.mjs
import { normalizeDisclosure, mergeEvents, detectClusters, clusterEvidence,
  MIN_FILERS, CLUSTER_WINDOW_DAYS, RETENTION_DAYS, EXCLUDED_CLUSTERS } from './polflow.mjs';

let pass = 0, fail = 0;
const eq = (label, got, want) => { const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.error(`✗ ${label}\n    got  ${g}\n    want ${w}`); } };
const ok = (label, cond) => { if (cond) { pass++; } else { fail++; console.error(`✗ ${label}`); } };

const ASOF = '2026-08-04';

// ---- normalizeDisclosure ---------------------------------------------------
// Real FMP house-latest row shape.
const houseRow = { symbol: 'AMAT', senateID: 'M001234', disclosureDate: '2026-07-31', transactionDate: '2026-06-29',
  firstName: 'Kelly Louise', lastName: 'Morrison', office: 'Kelly Louise Morrison', district: 'MN03',
  owner: 'Spouse', assetDescription: 'APPLIED MATERIALS', assetType: 'Stock', type: 'Purchase', amount: '$15,001 - $50,000' };
const n = normalizeDisclosure(houseRow, 'house');
eq('normalizes symbol', n.sym, 'AMAT');
eq('maps Purchase → buy', n.side, 'buy');
eq('keeps transaction date', n.txn, '2026-06-29');
eq('names the filer', n.filer, 'KELLY LOUISE MORRISON');
eq('computes the disclosure lag', n.lag, 32);
eq('keeps the amount bucket verbatim', n.amount, '$15,001 - $50,000');

eq('Sale → sell', normalizeDisclosure({ ...houseRow, type: 'Sale' }, 'house').side, 'sell');
// The feed is mostly bonds, funds and unmapped assets — all of it has to go.
eq('bond rows are dropped', normalizeDisclosure({ ...houseRow, assetType: 'Corporate Bond' }, 'senate'), null);
eq('rows with no symbol are dropped', normalizeDisclosure({ ...houseRow, symbol: '' }, 'house'), null);
// 'Exchange' carries no direction — counting it as a buy would manufacture clusters.
eq('directionless Exchange rows are dropped', normalizeDisclosure({ ...houseRow, type: 'Exchange' }, 'house'), null);
eq('rows with no transaction date are dropped', normalizeDisclosure({ ...houseRow, transactionDate: '' }, 'house'), null);
eq('null row is safe', normalizeDisclosure(null, 'house'), null);

// ---- mergeEvents -----------------------------------------------------------
const ev = (filer, sym, side, txn) => ({ filer, sym, side, txn, chamber: 'house', lag: 40 });
const priorLedger = [ev('A', 'RTX', 'buy', '2026-07-01'), ev('B', 'RTX', 'buy', '2026-07-03')];
const fresh = [ev('B', 'RTX', 'buy', '2026-07-03'), ev('C', 'RTX', 'buy', '2026-07-10')];
const merged = mergeEvents(priorLedger, fresh, { asOf: ASOF });
// The rolling 25-row window re-serves the same rows every poll; counting them twice would fake activity.
eq('re-fetched rows do not duplicate', merged.length, 3);
eq('ledger is newest-first', merged.map((e) => e.txn), ['2026-07-10', '2026-07-03', '2026-07-01']);
eq('retention drops stale events', mergeEvents([ev('A', 'RTX', 'buy', '2025-01-01')], [], { asOf: ASOF }), []);
eq('future-dated rows are dropped', mergeEvents([ev('A', 'RTX', 'buy', '2027-01-01')], [], { asOf: ASOF }), []);
eq('empty in, empty out', mergeEvents([], [], { asOf: ASOF }), []);
ok('retention window is the documented one', RETENTION_DAYS === 120);

// ---- detectClusters --------------------------------------------------------
const cluster = [ev('A', 'RTX', 'buy', '2026-07-01'), ev('B', 'RTX', 'buy', '2026-07-08'), ev('C', 'RTX', 'buy', '2026-07-15')];
const cl = detectClusters(cluster, { asOf: ASOF });
eq('three distinct filers form a cluster', cl.RTX.filers, 3);
eq('cluster direction', cl.RTX.side, 'buy');
eq('cluster reports its last transaction', cl.RTX.lastTxn, '2026-07-15');
eq('cluster reports how stale it is', cl.RTX.staleDays, 20);

// Two filers is not a cluster; one person trading five times is emphatically not a cluster.
eq('two filers is below the gate', detectClusters(cluster.slice(0, 2), { asOf: ASOF }), {});
const onePerson = ['2026-07-01', '2026-07-05', '2026-07-09', '2026-07-12', '2026-07-15'].map((d) => ev('A', 'RTX', 'buy', d));
eq('one filer trading repeatedly is not a cluster', detectClusters(onePerson, { asOf: ASOF }), {});
ok('cluster gate is the documented one', MIN_FILERS === 3);

// Trades must be CLOSE TOGETHER — three people over five months is not a coordinated read.
const spread = [ev('A', 'RTX', 'buy', '2026-04-01'), ev('B', 'RTX', 'buy', '2026-06-01'), ev('C', 'RTX', 'buy', '2026-07-15')];
eq('filers spread beyond the window do not cluster', detectClusters(spread, { asOf: ASOF, windowDays: CLUSTER_WINDOW_DAYS }), {});

// A split legislature is no signal: equal-sized clusters on both sides cancel.
const split = [...cluster, ev('D', 'RTX', 'sell', '2026-07-02'), ev('E', 'RTX', 'sell', '2026-07-06'), ev('F', 'RTX', 'sell', '2026-07-11')];
eq('equal buy and sell clusters cancel out', detectClusters(split, { asOf: ASOF }), {});
// …but a clear majority still registers.
const lopsided = [...split, ev('G', 'RTX', 'buy', '2026-07-16')];
eq('the larger side wins when they differ', detectClusters(lopsided, { asOf: ASOF }).RTX.side, 'buy');

// THE LOAD-BEARING GUARD: the most-traded congressional names are megacap tech, which is exactly the
// cluster riskweights.mjs caps at 48%. A political nudge there would spend risk budget re-buying the
// concentration that cap exists to contain. It must never produce a signal, however strong the cluster.
const megacap = ['NVDA', 'MSFT', 'META', 'AAPL', 'GOOGL', 'AMZN', 'AVGO', 'ORCL', 'NFLX'];
for (const sym of megacap) {
  const strong = [ev('A', sym, 'buy', '2026-07-01'), ev('B', sym, 'buy', '2026-07-05'),
    ev('C', sym, 'buy', '2026-07-09'), ev('D', sym, 'buy', '2026-07-12')];
  eq(`${sym} is excluded from political clusters`, detectClusters(strong, { asOf: ASOF }), {});
}
ok('the exclusion targets the capped cluster by name', EXCLUDED_CLUSTERS.includes('megacap-tech'));
// A non-megacap name with the same pattern DOES register — the guard is targeted, not a blanket off-switch.
eq('a non-excluded name still clusters', detectClusters(
  [ev('A', 'LMT', 'buy', '2026-07-01'), ev('B', 'LMT', 'buy', '2026-07-05'), ev('C', 'LMT', 'buy', '2026-07-09')],
  { asOf: ASOF }).LMT.filers, 3);

// Chambers are reported so a reader can see whether it is one body or both.
const bothHouses = [ev('A', 'LMT', 'buy', '2026-07-01'), { ...ev('B', 'LMT', 'buy', '2026-07-05'), chamber: 'senate' }, ev('C', 'LMT', 'buy', '2026-07-09')];
eq('cluster reports the chambers involved', detectClusters(bothHouses, { asOf: ASOF }).LMT.chambers, ['house', 'senate']);

// ---- clusterEvidence -------------------------------------------------------
const evid = clusterEvidence(detectClusters(cluster, { asOf: ASOF }));
eq('one evidence line per cluster', evid.length, 1);
// The phrasing must carry the caveat — this string goes to a verifier that would otherwise read a bare
// "3 members of Congress bought it" as a recommendation.
ok('evidence states the staleness', /~20d ago/.test(evid[0]));
ok('evidence flags itself as weak context', /weak context only/.test(evid[0]));
eq('no clusters → no evidence', clusterEvidence({}), []);

console.log(`\npolflow.test: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
