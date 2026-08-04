// Offline unit checks for flow.mjs — no network. Run: node producer/flow.test.mjs
import { revisionScore, insiderScore, surpriseScore, flowScore, scoreSymbol, FLOW_WEIGHTS } from './flow.mjs';

let pass = 0, fail = 0;
const eq = (label, got, want) => { const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.error(`✗ ${label}\n    got  ${g}\n    want ${w}`); } };
const ok = (label, cond) => { if (cond) { pass++; } else { fail++; console.error(`✗ ${label}`); } };
const near = (label, got, want, tol = 0.01) => {
  if (Number.isFinite(got) && Math.abs(got - want) <= tol) { pass++; }
  else { fail++; console.error(`✗ ${label}\n    got  ${got}\n    want ${want} ±${tol}`); } };

// ---- revisionScore ---------------------------------------------------------
// Real Finnhub /stock/recommendation shape: newest first, one row per month.
const rec = [
  { symbol: 'NVDA', period: '2026-08-01', strongBuy: 23, buy: 41, hold: 3, sell: 1, strongSell: 0 }, // idx 1.2647
  { symbol: 'NVDA', period: '2026-07-01', strongBuy: 24, buy: 40, hold: 4, sell: 1, strongSell: 0 },
  { symbol: 'NVDA', period: '2026-06-01', strongBuy: 20, buy: 42, hold: 6, sell: 1, strongSell: 0 },
  { symbol: 'NVDA', period: '2026-05-01', strongBuy: 15, buy: 40, hold: 10, sell: 3, strongSell: 0 }, // idx 0.9853
];
const rv = revisionScore(rec);
near('revision level from latest consensus', rv.level, 8.16);
near('revision delta over 3 months', rv.delta, 0.28);
near('revision score blends direction 60 / level 40', rv.score, 8.28);
eq('revision analyst count', rv.analysts, 68);

// Direction dominates: a HIGHLY rated name being downgraded must score below a mid-rated name being upgraded.
const loved = revisionScore([
  { period: '2026-08-01', strongBuy: 10, buy: 30, hold: 20, sell: 8, strongSell: 2 },
  { period: '2026-07-01', strongBuy: 14, buy: 32, hold: 16, sell: 6, strongSell: 2 },
  { period: '2026-06-01', strongBuy: 18, buy: 34, hold: 14, sell: 4, strongSell: 0 },
  { period: '2026-05-01', strongBuy: 22, buy: 36, hold: 10, sell: 2, strongSell: 0 },
]);
const rising = revisionScore([
  { period: '2026-08-01', strongBuy: 8, buy: 20, hold: 18, sell: 2, strongSell: 0 },
  { period: '2026-07-01', strongBuy: 5, buy: 18, hold: 22, sell: 3, strongSell: 1 },
  { period: '2026-06-01', strongBuy: 3, buy: 16, hold: 26, sell: 4, strongSell: 1 },
  { period: '2026-05-01', strongBuy: 2, buy: 14, hold: 28, sell: 5, strongSell: 2 },
]);
ok('deteriorating consensus scores below improving consensus', loved.score < rising.score);
ok('deteriorating consensus is bearish despite a decent level', loved.score < 5 && loved.level > 4);

// Unsorted input must still resolve newest-first.
eq('revision tolerates unsorted rows', revisionScore([rec[3], rec[1], rec[0], rec[2]]).score, rv.score);

// A single snapshot has no direction — the level alone is dampened toward neutral, never taken at face value.
const one = revisionScore([rec[0]]);
near('single-snapshot level is dampened toward neutral', one.score, 6.9);
eq('single-snapshot reports no delta', one.delta, null);
ok('single snapshot scores below the full-history read', one.score < rv.score);

eq('revision with no rows → null', revisionScore([]), null);
eq('revision ignores rows with zero analysts', revisionScore([{ period: '2026-08-01', strongBuy: 0, buy: 0, hold: 0, sell: 0, strongSell: 0 }]), null);

// ---- insiderScore ----------------------------------------------------------
const ASOF = '2026-08-04';
const buyCluster = { data: [
  { name: 'HUANG JENSEN', change: 1000, transactionCode: 'P', transactionDate: '2026-07-20', transactionPrice: 100, isDerivative: false },
  { name: 'KRESS COLETTE', change: 500, transactionCode: 'P', transactionDate: '2026-07-18', transactionPrice: 100, isDerivative: false },
  { name: 'STEVENS MARK', change: 200, transactionCode: 'P', transactionDate: '2026-07-05', transactionPrice: 100, isDerivative: false },
] };
const ib = insiderScore(buyCluster, null, { asOf: ASOF });
eq('insider counts distinct buyers', ib.buyers, 3);
eq('insider flags a buy cluster at 3 people', ib.cluster, 'buy');
near('all-buy cluster scores near the top', ib.score, 10);

// Same dollar magnitude on the sell side must move the score LESS — insiders sell for many reasons.
const sellCluster = { data: buyCluster.data.map((t) => ({ ...t, change: -t.change, transactionCode: 'S' })) };
const is = insiderScore(sellCluster, null, { asOf: ASOF });
eq('insider counts distinct sellers', is.sellers, 3);
eq('insider flags a sell cluster', is.cluster, 'sell');
near('all-sell cluster is bearish but muted', is.score, 3.5);
ok('sell side moves far less than buy side from neutral', (5 - is.score) * 3 < (ib.score - 5));
// Regression (live-data calibration): routine large-cap selling must NOT read as maximally bearish. The
// first live run scored NVDA and JPM at 0.9/10 on all-sell windows — a constant drag on every megacap
// rather than a discriminator. An all-sell window with no buyers belongs mildly below neutral.
ok('routine all-sell window stays mildly bearish, not floor-bearish', is.score >= 3 && is.score < 5);
const sellNegMspr = insiderScore(sellCluster, { data: [{ year: 2026, month: 7, mspr: -100 }] }, { asOf: ASOF });
ok('even sell cluster + maximally negative mspr stays off the floor', sellNegMspr.score >= 2.5);

// Five filings by ONE officer is one opinion, not a cluster.
const oneOfficer = { data: Array.from({ length: 5 }, (_, i) => (
  { name: 'HUANG JENSEN', change: 400, transactionCode: 'P', transactionDate: `2026-07-0${i + 1}`, transactionPrice: 100, isDerivative: false })) };
const io = insiderScore(oneOfficer, null, { asOf: ASOF });
eq('repeat filings by one person count once', io.buyers, 1);
eq('one person is not a cluster', io.cluster, null);
ok('one-person buying still scores bullish, just not cluster-bullish', io.score > 5 && io.score < ib.score);

// Only open-market P/S codes count — grants, exercises, gifts and tax withholding are mechanical noise.
const mechanical = { data: [
  { name: 'A', change: -500000, transactionCode: 'G', transactionDate: '2026-07-01', transactionPrice: 0, isDerivative: false },
  { name: 'B', change: 250000, transactionCode: 'A', transactionDate: '2026-07-02', transactionPrice: 0, isDerivative: false },
  { name: 'C', change: -120000, transactionCode: 'M', transactionDate: '2026-07-03', transactionPrice: 210, isDerivative: false },
  { name: 'D', change: -80000, transactionCode: 'F', transactionDate: '2026-07-04', transactionPrice: 210, isDerivative: false },
] };
eq('mechanical codes alone → null (no opinion)', insiderScore(mechanical, null, { asOf: ASOF }), null);
// …and they must not dilute a real signal mixed in alongside them.
const mixed = { data: [...mechanical.data, ...buyCluster.data] };
eq('mechanical codes are filtered out of a mixed feed', insiderScore(mixed, null, { asOf: ASOF }).filings, 3);

// Derivative rows are excluded too.
eq('derivative rows excluded', insiderScore({ data: [{ name: 'A', change: 900, transactionCode: 'P', transactionDate: '2026-07-10', transactionPrice: 100, isDerivative: true }] }, null, { asOf: ASOF }), null);

// Window: stale transactions drop out entirely.
const stale = { data: buyCluster.data.map((t) => ({ ...t, transactionDate: '2025-11-01' })) };
eq('transactions outside the window → null', insiderScore(stale, null, { asOf: ASOF }), null);
// Future-dated rows (bad provider data) are ignored rather than counted.
eq('future-dated rows ignored', insiderScore({ data: [{ name: 'A', change: 900, transactionCode: 'P', transactionDate: '2027-01-01', transactionPrice: 100 }] }, null, { asOf: ASOF }), null);

// MSPR confirmation nudges, but cannot flip the read on its own.
const sentNeg = { data: [{ year: 2026, month: 7, mspr: -100 }, { year: 2026, month: 6, mspr: 20 }] };
const ibNeg = insiderScore(buyCluster, sentNeg, { asOf: ASOF });
eq('mspr picks the latest month', ibNeg.mspr, -100);
ok('negative mspr trims a buy cluster but leaves it bullish', ibNeg.score < ib.score && ibNeg.score > 5);

// ---- surpriseScore ---------------------------------------------------------
const earn = [
  { period: '2026-06-30', surprisePercent: 4.3, year: 2027, quarter: 1 },
  { period: '2026-03-31', surprisePercent: 3.0 },
  { period: '2025-12-31', surprisePercent: 2.0 },
  { period: '2025-09-30', surprisePercent: -1.0 },
];
const sp = surpriseScore(earn);
near('recency-weighted average surprise', sp.avgSurprisePct, 2.92);
near('surprise score', sp.score, 6.22);
eq('surprise counts beats', sp.positives, 3);

// A 400% "beat" off a near-zero estimate is an artefact — clamped to ±25%, not treated as 16× the signal.
const blowout = surpriseScore([{ period: '2026-06-30', surprisePercent: 400 }]);
const capped = surpriseScore([{ period: '2026-06-30', surprisePercent: 25 }]);
eq('outsized surprise is clamped', blowout.score, capped.score);
ok('clamped blowout stays inside the scale', blowout.score <= 10);

eq('surprise with no rows → null', surpriseScore([]), null);
eq('surprise ignores rows missing surprisePercent', surpriseScore([{ period: '2026-06-30', actual: 1.87 }]), null);

// ---- flowScore composite ---------------------------------------------------
const comp = flowScore({ revision: { score: 8 }, insider: { score: 6 }, surprise: { score: 5 } });
near('composite renormalizes weights over present components', comp.score, 6.67);
eq('composite reports coverage', comp.coverage, ['revision', 'insider', 'surprise']);

// One live signal is not a sleeve — abstain rather than let it stand in for the whole read.
eq('single component → null (abstains)', flowScore({ revision: { score: 9 } }), null);
eq('no components → null', flowScore({}), null);
eq('null components are not counted as neutral', flowScore({ revision: { score: 9 }, insider: null, surprise: null }), null);

// Absent components must not shift the blend of those present: award is declared but unfetched (Phase 2),
// so a two-component read is a pure renormalization of the two.
const twoOnly = flowScore({ revision: { score: 10 }, insider: { score: 0 } });
near('two components renormalize to their own ratio', twoOnly.score, 10 * (0.4 / 0.7));
ok('award weight is declared for Phase 2', FLOW_WEIGHTS.award === 0.10);
ok('weights sum to 1', Math.abs(Object.values(FLOW_WEIGHTS).reduce((a, b) => a + b, 0) - 1) < 1e-9);

// Adding the Phase-2 award component must not require touching existing arithmetic.
const withAward = flowScore({ revision: { score: 8 }, insider: { score: 6 }, surprise: { score: 5 }, award: { score: 10 } });
ok('award slots in without breaking the composite', withAward.score > comp.score && withAward.coverage.includes('award'));

// ---- scoreSymbol end-to-end ------------------------------------------------
const full = scoreSymbol({ recommendation: rec, insiderTx: buyCluster, insiderSentiment: null, earnings: earn }, { asOf: ASOF });
ok('scoreSymbol produces a composite from three live components', full.flow && full.flow.coverage.length === 3);
ok('scoreSymbol keeps the component detail for display', full.insider.cluster === 'buy' && full.revision.delta > 0);

// A name with nothing but one earnings row abstains — no fake neutral.
const sparse = scoreSymbol({ earnings: [{ period: '2026-06-30', surprisePercent: 4 }] }, { asOf: ASOF });
eq('sparse name abstains from the sleeve', sparse.flow, null);
ok('sparse name still exposes what it does have', sparse.surprise && sparse.surprise.score > 5);

// Empty input is safe.
eq('scoreSymbol on empty input → null composite', scoreSymbol({}, { asOf: ASOF }).flow, null);

console.log(`\nflow.test: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
