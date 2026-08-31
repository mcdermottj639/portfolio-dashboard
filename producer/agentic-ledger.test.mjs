// Offline unit checks for agentic-ledger.mjs — no network, no I/O. Run: node producer/agentic-ledger.test.mjs
import { gradeDecision, gradeDecisions, makeDecision, activityFromDecisions, MIN_GRADE_DAYS, sleeveStats, SLEEVE_MIN_N, applyMarks, markStats, MARK_HORIZONS, MARK_GRACE_DAYS, closeIndex, markFromBars, snapshotHoldingsSanity, SANITY_MIN_EXPECTED } from './agentic-ledger.mjs';

let pass = 0, fail = 0;
const ok = (label, cond) => { if (cond) pass++; else { fail++; console.error(`✗ ${label}`); } };
const near = (label, got, want, tol = 0.2) => { if (got != null && Math.abs(got - want) <= tol) pass++; else { fail++; console.error(`✗ ${label}\n    got ${got} want ~${want}`); } };
const eq = (label, got, want) => { const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) pass++; else { fail++; console.error(`✗ ${label}\n    got  ${g}\n    want ${w}`); } };

const dec = {
  id: 'd1', date: '2026-07-01', kind: 'deploy', targetAsOf: '2026-06-29', book: 3500, spyAt: 700, rationale: 'initial deploy',
  trades: [
    { sym: 'NVDA', side: 'BUY', dollars: 1000, priceAt: 200 },   // now 220 → +10%
    { sym: 'JPM',  side: 'BUY', dollars: 1000, priceAt: 300 },   // now 330 → +10%
    { sym: 'V',    side: 'TRIM', dollars: 500, priceAt: 350 },   // now 340 (fell) → trim was GOOD (+contrib)
  ],
};
const quotesNow = { NVDA: 220, JPM: 330, V: 340, SPY: 735 }; // SPY +5%
const g = gradeDecision(dec, quotesNow, '2026-07-20');

near('NVDA buy return +10%', g.grade.byTrade.find((b) => b.sym === 'NVDA').retPct, 10);
ok('trim that fell contributes POSITIVELY', g.grade.byTrade.find((b) => b.sym === 'V').contribPct > 0);
near('SPY benchmark return +5%', g.grade.spyRet, 5);
ok('avgContrib is dollar-weighted across trades', g.grade.avgContrib > 0);
ok('alpha = contrib − SPY', Math.abs(g.grade.alpha - (g.grade.avgContrib - g.grade.spyRet)) < 1e-6);
ok('a >5d, positive-alpha decision reads "ahead"', g.grade.verdict === 'ahead');

// a decision younger than MIN_GRADE_DAYS is still "open"
const young = gradeDecision({ ...dec, date: '2026-07-18' }, quotesNow, '2026-07-20');
ok(`decision <${MIN_GRADE_DAYS}d old is "open"`, young.grade.verdict === 'open');

// missing spyAt → no alpha, still grades on absolute contribution
const noBench = gradeDecision({ ...dec, spyAt: null }, quotesNow, '2026-07-20');
ok('no benchmark → alpha null but still graded', noBench.grade.alpha == null && noBench.grade.verdict === 'ahead');

// portfolio-level stats + newest-first ordering
const set = gradeDecisions([
  { id: 'a', date: '2026-07-01', spyAt: 700, trades: [{ sym: 'NVDA', side: 'BUY', dollars: 100, priceAt: 200 }] },
  { id: 'b', date: '2026-07-15', spyAt: 720, trades: [{ sym: 'JPM', side: 'BUY', dollars: 100, priceAt: 300 }] },
], quotesNow, '2026-07-20');
ok('newest decision first', set.decisions[0].id === 'b');
ok('stats count resolved decisions', set.stats.total === 2 && set.stats.resolved >= 1);

// makeDecision maps a plan's buys/trims into trade records
const md = makeDecision({ date: '2026-07-23', kind: 'deploy', targetAsOf: '2026-07-23', book: 4955, equity: 4955, spyAt: 747,
  rationale: 'deploy deposit', buys: [{ sym: 'spy', dollars: 300, shares: 0.4, price: 747, weightNow: 18, weightTarget: 22 }], trims: [] });
ok('makeDecision uppercases + tags side BUY', md.trades[0].sym === 'SPY' && md.trades[0].side === 'BUY');
ok('makeDecision stamps id/date/spyAt', md.id === '2026-07-23-deploy' && md.spyAt === 747);

// ── activityFromDecisions (2026-08-12 churn governor) ───────────────────────────────────────────
// The committed ledger → the deploy planner's {SYM:{lastBuyDate,lastSellDate}} shape. This is the
// exact 08-10/08-12 whipsaw window: GE sold 08-10 then rebought 08-12, AAPL the mirror image.
const act = activityFromDecisions([
  { date: '2026-08-10', trades: [{ sym: 'GE', side: 'TRIM' }, { sym: 'AAPL', side: 'BUY' }] },
  { date: '2026-08-12', trades: [{ sym: 'AAPL', side: 'TRIM' }, { sym: 'GE', side: 'BUY' }] },
  { date: '2026-05-01', trades: [{ sym: 'OLD', side: 'BUY' }] },   // outside the window
], { asOf: '2026-08-12', sinceDays: 30 });
ok('a TRIM stamps lastSellDate', act.GE.lastSellDate === '2026-08-10' && act.AAPL.lastSellDate === '2026-08-12');
ok('a BUY stamps lastBuyDate', act.GE.lastBuyDate === '2026-08-12' && act.AAPL.lastBuyDate === '2026-08-10');
ok('decisions outside the window are ignored', !act.OLD);
ok('empty ledger → empty map', Object.keys(activityFromDecisions([], { asOf: '2026-08-12' })).length === 0);

// ---- SLEEVE ATTRIBUTION (v121) ----------------------------------------------
// The question that makes a sleeve REMOVABLE: did the names it backed actually outperform?
{
  const T = { names: [
    { ticker: 'AAA', drivers: ['momentum', 'quality'] },
    { ticker: 'BBB', drivers: ['momentum'] },
    { ticker: 'CCC', drivers: ['valuation'] },
  ]};
  // drivers are stamped at DECISION time from the then-current target…
  const d1 = makeDecision({ date: '2026-07-01', book: 10000, spyAt: 700, target: T,
    buys: [{ sym: 'AAA', dollars: 1000, shares: 10, price: 100 }, { sym: 'CCC', dollars: 1000, shares: 10, price: 100 }] });
  eq('a buy leg records the drivers of the name it was bought for',
    d1.trades.find((t) => t.sym === 'AAA').drivers, ['momentum', 'quality']);
  eq('a name absent from the target records none',
    d1.trades.find((t) => t.sym === 'CCC').drivers, ['valuation']);
  // …and a TRIM never carries them: a trim is not an expression of the sleeve that picked the name.
  const d2 = makeDecision({ date: '2026-07-01', book: 10000, spyAt: 700, target: T,
    buys: [], trims: [{ sym: 'AAA', dollars: 500, shares: 5, price: 100 }] });
  ok('a trim leg carries no drivers', d2.trades[0].drivers === undefined);
  // No target supplied ⇒ no drivers, rather than a guess.
  const d3 = makeDecision({ date: '2026-07-01', book: 10000, spyAt: 700, buys: [{ sym: 'AAA', dollars: 1000, price: 100 }] });
  ok('no target ⇒ no drivers (never reconstructed later)', d3.trades[0].drivers === undefined);

  // Roll-up: AAA +20%, CCC -10%, SPY +5% over the window.
  const g = gradeDecisions([d1], { AAA: 120, CCC: 90, SPY: 735 }, '2026-08-01');
  const sl = g.sleeves;
  ok('sleeves are reported', !!sl && !!sl.momentum && !!sl.valuation);
  // AAA (+20% price, alpha +15pp) had TWO drivers, so its $1000 splits $500 each.
  near('a two-driver leg splits its dollars 1/k', sl.momentum.dollars, 500, 0.01);
  near('momentum inherits AAA\'s alpha vs SPY', sl.momentum.alphaPct, 15, 0.01);
  near('quality sees the same leg', sl.quality.alphaPct, 15, 0.01);
  near('valuation carries CCC alone', sl.valuation.dollars, 1000, 0.01);
  near('…and its alpha is negative', sl.valuation.alphaPct, -15, 0.01);
  ok('a sleeve with too few graded buys is flagged thin, not presented as a finding', sl.momentum.thin === true);
  ok('thin is keyed off SLEEVE_MIN_N', SLEEVE_MIN_N >= 3);

  // Legs written before drivers existed are EXCLUDED, never guessed at.
  const legacy = { id: 'x', date: '2026-07-01', spyAt: 700, trades: [{ sym: 'AAA', side: 'BUY', dollars: 5000, priceAt: 100 }] };
  const gl = gradeDecisions([legacy], { AAA: 200, SPY: 735 }, '2026-08-01');
  eq('a legacy leg with no drivers contributes to no sleeve', Object.keys(gl.sleeves), []);

  // Enough buys and the thin flag clears.
  const many = Array.from({ length: 4 }, (_, i) => makeDecision({
    date: `2026-07-0${i + 1}`, book: 10000, spyAt: 700, target: T,
    buys: [{ sym: 'BBB', dollars: 400, shares: 4, price: 100 }] }));
  const gm = gradeDecisions(many, { BBB: 110, SPY: 700 }, '2026-08-01');
  ok('4 graded buys clears the thin flag', gm.sleeves.momentum.thin === false);
  near('single-driver legs keep their whole dollars', gm.sleeves.momentum.dollars, 1600, 0.01);
  near('and the alpha is the price move when SPY was flat', gm.sleeves.momentum.alphaPct, 10, 0.01);
}

// ── FROZEN OUTCOME MARKS ───────────────────────────────────────────────────────────────────────
// The whole point: gradeDecision re-marks to TODAY every run, so without these a log can never
// answer "what is our 30-day hit rate?". A mark is stamped once, at the horizon, and never moves.
const mkDec = (date, priceAt, spyAt) => ({ id: 'm-' + date, date, kind: 'deploy', spyAt,
  trades: [{ sym: 'NVDA', side: 'BUY', dollars: 1000, priceAt }] });
// Day 31 of a decision made at NVDA 200 / SPY 700; now NVDA 220 (+10%), SPY 735 (+5%) ⇒ alpha +5pp.
const at31 = applyMarks(gradeDecisions([mkDec('2026-07-01', 200, 700)], { NVDA: 220, SPY: 735 }, '2026-08-01'), [], '2026-08-01');
const m31 = at31.decisions[0].marks;
ok('the 5d and 30d horizons stamp once reached', !!m31[5] && !!m31[30]);
ok('a horizon not yet reached is not stamped', !m31[90]);
near('the 30d mark freezes that window\'s alpha', m31[30].alphaPct, 5);
eq('…and records the day it was actually taken', m31[30].days, 31);
// Same decision seen again much later at a very different price: the stamped mark must NOT move.
const at120 = applyMarks(gradeDecisions([mkDec('2026-07-01', 200, 700)], { NVDA: 400, SPY: 700 }, '2026-10-29'), at31.decisions, '2026-10-29');
const m120 = at120.decisions[0].marks;
near('a stamped mark is FROZEN — a later run cannot move it', m120[30].alphaPct, 5);
eq('…nor restamp the day it was taken', m120[30].days, 31);
ok('the live grade still tracks today, as the card needs', at120.decisions[0].grade.avgContrib > 50);
ok('a horizon reached in the meantime does stamp', !!m120[90]);
// A BACKFILLED record — first seen already older than every horizon — must never fake an outcome.
// This is the live case: all 21 days derived from ••••0741's existing order history are >90d old.
const back = applyMarks(gradeDecisions([mkDec('2026-05-01', 200, 700)], { NVDA: 220, SPY: 735 }, '2026-08-01'), [], '2026-08-01');
const mb = back.decisions[0].marks;
eq('a record first seen past the horizon records a MISS, never a value', [mb[5].missed, mb[30].missed], [true, true]);
ok('…and says how late it was first seen', mb[5].firstSeenDays === 92);
ok('a missed mark carries no contribution to be mistaken for a result', mb[30].contribPct === undefined);
eq('markStats counts real marks and misses separately', [markStats(back.decisions)[30].n, markStats(back.decisions)[30].missed], [0, 1]);
eq('…so a backfilled log yields NO statistics rather than false ones', markStats(back.decisions)[30].avgAlpha, null);
// The grace window: a run that lands a few days late still measures the horizon it claims.
const late = applyMarks(gradeDecisions([mkDec('2026-07-01', 200, 700)], { NVDA: 220, SPY: 735 }, '2026-08-04'), [], '2026-08-04');
ok(`a stamp inside the ${MARK_GRACE_DAYS}d grace window is real, not missed`, late.decisions[0].marks[30].missed !== true);
const tooLate = applyMarks(gradeDecisions([mkDec('2026-07-01', 200, 700)], { NVDA: 220, SPY: 735 }, '2026-08-10'), [], '2026-08-10');
eq('…and one past it is honestly a miss', tooLate.decisions[0].marks[30].missed, true);
// An unpriced decision waits for a price rather than recording a false miss.
const unpriced = applyMarks(gradeDecisions([mkDec('2026-07-01', 200, 700)], { SPY: 735 }, '2026-08-01'), [], '2026-08-01');
ok('an unpriced decision records nothing at all at its horizon', !(unpriced.decisions[0].marks || {})[30]);
eq('markStats reports every horizon', Object.keys(markStats(at31.decisions)).map(Number), MARK_HORIZONS);
eq('applyMarks leaves `grade` and `sleeves` untouched (purely additive)',
  [at31.stats.total, typeof at31.sleeves], [1, 'object']);


// ── MARKS COMPUTED FROM RECORDED CLOSES ────────────────────────────────────────────────────────
// A live-only stamp can measure only horizons reached while the producer was watching, so a
// backfilled log yields nothing for months. data.hist.day already holds real closes, so the answer
// is arithmetic on prices we have — NOT a guess. The danger is pricing off a STALE series.
function shiftD(day, d) { const x = new Date(day + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + d); return x.toISOString().slice(0, 10); }
const barsFor = (start, n, base, step) => Array.from({ length: n }, (_, i) => ({
  begins_at: shiftD(start, i) + 'T00:00:00Z', close_price: String(base + i * step), interpolated: false }));

// NVDA 200 → 230 over 30d (+15%); SPY 700 → 721 (+3%) ⇒ alpha +12pp, measured AT day 30.
const HIST = { NVDA: barsFor('2026-06-01', 120, 200, 1), SPY: barsFor('2026-06-01', 120, 700, 0.7) };
const oldDec = { id: 'b1', date: '2026-06-01', kind: 'deploy', spyAt: 700,
  trades: [{ sym: 'NVDA', side: 'BUY', dollars: 1000, priceAt: 200 }] };

// Graded "today" is far past every horizon: the live path calls all of these unmeasurable.
const withBars = applyMarks(gradeDecisions([oldDec], { NVDA: 999, SPY: 999 }, '2026-08-27'), [], '2026-08-27', { histDay: HIST });
const bm = withBars.decisions[0].marks;
eq('a backfilled decision IS measurable from recorded closes', bm[30].missed, undefined);
eq('…measured at the horizon, not at grading time', bm[30].days, 30);
near('…contribution is the close-to-close move over exactly that window', bm[30].contribPct, 15);
near('…and alpha is measured against SPY over the same window', bm[30].alphaPct, 12);
eq('…and the basis is recorded so it can be told from a live stamp', bm[30].src, 'bars');
ok('every horizon the bars cover backfills', !!bm[5] && !!bm[30]);
// 2026-06-01 + 90d = 2026-08-30, past the 2026-08-27 grading date: not due, so not stamped.
ok('a horizon whose target date is still ahead is left alone', !bm[90]);
eq('markStats reports how many came from recorded closes', markStats(withBars.decisions)[30].fromBars, 1);

// A horizon still in the FUTURE must not be reached for, even though later bars exist in the fixture.
const future = applyMarks(gradeDecisions([{ ...oldDec, id: 'b2', date: '2026-08-25' }], { NVDA: 230, SPY: 721 }, '2026-08-27'), [], '2026-08-27', { histDay: HIST });
ok('a horizon that has not arrived is not stamped', !(future.decisions[0].marks || {})[30]);

// THE STALE-SERIES TRAP. A name that rotated out of the fetch keeps the series it had when it left,
// and a series that stops mid-run stops at its own high — how MU/WULF/NBIS once scored a perfect
// 10.00. The lookup must ABSTAIN, never reach backwards to the last available bar.
const STALE = { NVDA: barsFor('2026-06-01', 10, 200, 12), SPY: HIST.SPY };   // ends 2026-06-10 at 308
const stale = applyMarks(gradeDecisions([oldDec], { NVDA: 999, SPY: 999 }, '2026-08-27'), [], '2026-08-27', { histDay: STALE });
eq('a series ending before the horizon is UNMEASURABLE, not priced off its last bar', stale.decisions[0].marks[30].missed, true);
eq('…while the horizon its bars DO cover still measures', stale.decisions[0].marks[5].src, 'bars');
eq('markFromBars returns null rather than a stale number', markFromBars(oldDec, closeIndex(STALE), 30, '2026-08-27'), null);

// EVERY leg must price — dropping the leg that moved the number is how a statistic becomes a lie.
const twoLeg = { id: 'b3', date: '2026-06-01', spyAt: 700, trades: [
  { sym: 'NVDA', side: 'BUY', dollars: 1000, priceAt: 200 },
  { sym: 'GONE', side: 'BUY', dollars: 9000, priceAt: 50 },
]};
eq('a decision with an unpriceable leg is not partially marked', markFromBars(twoLeg, closeIndex(HIST), 30, '2026-08-27'), null);

const idxBoth = closeIndex({ X: [
  { begins_at: '2026-06-01T00:00:00Z', close_price: '10' },
  { t: '2026-06-02', c: 11 },
  { begins_at: '2026-06-03T00:00:00Z', close_price: '99', interpolated: true },
  { t: '2026-06-04', c: 88, live: true },
  { begins_at: '2026-06-05T00:00:00Z', close_price: '0' },
]});
eq('closeIndex reads both bar shapes and drops placeholder/live/zero rows', idxBoth.X.map((r) => r[1]), [10, 11]);

const sold = { id: 'b4', date: '2026-06-01', spyAt: 700, trades: [{ sym: 'DROP', side: 'SELL', dollars: 1000, priceAt: 100 }] };
ok('a sell of a name that then FELL marks positive',
  markFromBars(sold, closeIndex({ DROP: barsFor('2026-06-01', 60, 100, -1), SPY: HIST.SPY }), 30, '2026-08-27').contribPct > 0);

// A stamped mark is still never recomputed, even once bars would answer differently.
const first = applyMarks(gradeDecisions([oldDec], { NVDA: 230, SPY: 721 }, '2026-07-01'), [], '2026-07-01');
const later = applyMarks(gradeDecisions([oldDec], { NVDA: 999, SPY: 999 }, '2026-08-27'), first.decisions, '2026-08-27', { histDay: HIST });
eq('a previously stamped mark is not re-derived from bars', later.decisions[0].marks[5].src, first.decisions[0].marks[5].src);
eq('…and keeps its original value', later.decisions[0].marks[5].contribPct, first.decisions[0].marks[5].contribPct);

// ── SNAPSHOT IDENTITY GUARD (2026-08-31) ────────────────────────────────────────────────────────────
// The live incident, pinned: a producer run published the SELF-DIRECTED book into data.agentic, and the
// deploy planner — correct on its inputs — proposed a $61,962 liquidation of an account holding none of
// those names. EXEC_PROPOSE arms a one-tap without any live account call, so this must catch it offline.
const WRONG_ACCOUNT = [ // ••••0741's book, verbatim from the 2026-08-31 19:44Z snapshot
  { symbol: 'NVDA', qty: 0.288502 }, { symbol: 'TSM', qty: 0.56322 }, { symbol: 'CIFR', qty: 0.446733 },
  { symbol: 'IREN', qty: 350.071851 }, { symbol: 'PLTR', qty: 100.006259 }];
const REAL_BOOK = ['SPY', 'LLY', 'NVDA', 'GOOGL', 'AMZN', 'MSFT', 'SHEL', 'VTI', 'JNJ', 'KO', 'GLDM', 'BKNG']
  .map((symbol) => ({ symbol, qty: 1 }));
const ACT = { VTI: { lastBuyDate: '2026-08-27' }, BKNG: { lastBuyDate: '2026-08-27' },
  JNJ: { lastBuyDate: '2026-08-26' }, KO: { lastBuyDate: '2026-08-26' }, GLDM: { lastBuyDate: '2026-08-26' },
  GE: { lastBuyDate: '2026-08-12', lastSellDate: '2026-08-26' } }; // GE exited — must NOT be expected held
const PARKED = { vehicle: 'VTI', dollars: 485.99, forNames: ['MA', 'V'] };

ok('the wrong account\'s book is REFUSED',
  !!snapshotHoldingsSanity({ positions: WRONG_ACCOUNT, activity: ACT, parked: PARKED }));
ok('…and the real book passes',
  snapshotHoldingsSanity({ positions: REAL_BOOK, activity: ACT, parked: PARKED }) === null);
ok('the parking ledger arm fires on its own (vehicle held per the ledger, absent from the book)',
  /parking ledger/.test(snapshotHoldingsSanity({ positions: [{ symbol: 'SPY' }, { symbol: 'JNJ' }], activity: {}, parked: PARKED }) || ''));
ok('…and is silent when nothing is parked',
  snapshotHoldingsSanity({ positions: [{ symbol: 'SPY' }], activity: {}, parked: { vehicle: 'VTI', dollars: 0 } }) === null);
ok('the ledger-overlap arm fires on its own (no parking involved)',
  /wrong account/.test(snapshotHoldingsSanity({ positions: WRONG_ACCOUNT, activity: ACT, parked: null }) || ''));
ok('a name bought and later SOLD is not expected to still be held',
  snapshotHoldingsSanity({ positions: [{ symbol: 'VTI' }], activity: { GE: { lastBuyDate: '2026-08-12', lastSellDate: '2026-08-26' }, VTI: { lastBuyDate: '2026-08-27' } }, parked: null }) === null);
ok('an ordinary rebalance passes — one surviving name is enough',
  snapshotHoldingsSanity({ positions: [{ symbol: 'KO' }, { symbol: 'NEWNAME' }], activity: ACT, parked: null }) === null);
ok(`fails OPEN below SANITY_MIN_EXPECTED (${SANITY_MIN_EXPECTED}) tracked names — a young book is not judged`,
  snapshotHoldingsSanity({ positions: [{ symbol: 'ZZZZ' }], activity: { AAA: { lastBuyDate: '2026-08-27' }, BBB: { lastBuyDate: '2026-08-27' } }, parked: null }) === null);
ok('reads the {sym} position shape too, not just {symbol}',
  snapshotHoldingsSanity({ positions: [{ sym: 'KO' }], activity: ACT, parked: null }) === null);
ok('an all-cash book still trips the parking contradiction',
  !!snapshotHoldingsSanity({ positions: [], activity: {}, parked: PARKED }));

console.log(`\nagentic-ledger.test: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
