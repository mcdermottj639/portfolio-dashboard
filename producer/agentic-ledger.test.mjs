// Offline unit checks for agentic-ledger.mjs — no network, no I/O. Run: node producer/agentic-ledger.test.mjs
import { gradeDecision, gradeDecisions, makeDecision, MIN_GRADE_DAYS } from './agentic-ledger.mjs';

let pass = 0, fail = 0;
const ok = (label, cond) => { if (cond) pass++; else { fail++; console.error(`✗ ${label}`); } };
const near = (label, got, want, tol = 0.2) => { if (got != null && Math.abs(got - want) <= tol) pass++; else { fail++; console.error(`✗ ${label}\n    got ${got} want ~${want}`); } };

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

console.log(`\nagentic-ledger.test: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
