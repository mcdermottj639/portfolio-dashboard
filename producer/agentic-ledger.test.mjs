// Offline unit checks for agentic-ledger.mjs — no network, no I/O. Run: node producer/agentic-ledger.test.mjs
import { gradeDecision, gradeDecisions, makeDecision, activityFromDecisions, MIN_GRADE_DAYS, sleeveStats, SLEEVE_MIN_N } from './agentic-ledger.mjs';

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

console.log(`\nagentic-ledger.test: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
