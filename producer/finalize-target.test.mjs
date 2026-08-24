// Offline unit checks for finalize-target.mjs — no network. Run: node producer/finalize-target.test.mjs
import { finalizeTarget, DRIVER_THRESHOLD } from './finalize-target.mjs';

let pass = 0, fail = 0;
const eq = (label, got, want) => { const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.error(`✗ ${label}\n    got  ${g}\n    want ${w}`); } };
const ok = (label, cond) => { if (cond) { pass++; } else { fail++; console.error(`✗ ${label}`); } };

const ALLOC = { summary: 'test', picks: [
  { ticker: 'NVDA', sector: 'Electronic Technology', weightPct: 30, entryZone: '190-200', stop: 175, target: 230, thesis: 'AI demand' },
  { ticker: 'JPM', sector: 'Finance', weightPct: 25, entryZone: '330-340', stop: 305, target: 380, thesis: 'rates' },
  { ticker: 'SPY', sector: 'Index', weightPct: 45, entryZone: '740-750', stop: 690, target: 800, thesis: 'core hold' },
] };
const UNIVERSE = [{ t: 'NVDA', px: 192, hi: 236, lo: 151 }, { t: 'JPM', px: 336, hi: 343, lo: 279 }, { t: 'SPY', px: 747, hi: 760, lo: 600 }];
const RANKED = [
  { t: 'NVDA', m: 8.1, q: 7.5, g: 9.0, c: 5.0, v: 4.0, f: 7.2 },
  { t: 'JPM', m: 6.0, q: 8.4, g: 5.5, c: 6.0, v: 7.9, f: 4.5 },
  { t: 'SPY', m: 6.0, q: 6.0, g: 5.0, c: 5.0, v: 5.0, f: null },
];
const base = { book: 5000, asOf: '2026-08-04', universe: UNIVERSE };
const nameOf = (res, t) => res.target.names.find((n) => n.ticker === t);

// ---- shape -----------------------------------------------------------------
const r = finalizeTarget(ALLOC, { ...base, ranked: RANKED });
eq('asOf carried through', r.target.asOf, '2026-08-04');
eq('book rounded', r.target.book, 5000);
eq('default drift trigger', r.target.driftTriggerPp, 5);
ok('method records that risk caps were re-enforced', /finalize-target\.mjs/.test(r.target.method));
ok('weights normalize to ~100', Math.abs(r.target.names.reduce((a, n) => a + n.weightPct, 0) - 100) < 1);
ok('vol-proxy helper fields are stripped from the committed target',
  r.target.names.every((n) => !('px' in n) && !('hi' in n) && !('lo' in n)));
eq('entryZone is normalized to entry', nameOf(r, 'NVDA').entry, '190-200');

// ---- drivers attribution (v95) --------------------------------------------
// Derived deterministically from sleeve scores, NOT trusted from the model's prose — this is what makes
// a new sleeve measurable, and therefore reversible.
eq('driver threshold', DRIVER_THRESHOLD, 7);
eq('drivers are the >=7 sleeves, strongest first', nameOf(r, 'NVDA').drivers, ['growth', 'momentum', 'quality', 'flow']);
eq('a name driven by different sleeves tags differently', nameOf(r, 'JPM').drivers, ['quality', 'valuation']);
ok('a name with no strong sleeve carries no drivers', !('drivers' in nameOf(r, 'SPY')));
// The flow sleeve must be attributable the moment it earns weight, and absent when it abstains.
ok('flow appears as a driver when it scores high', nameOf(r, 'NVDA').drivers.includes('flow'));
ok('flow is not a driver when it merely exists', !nameOf(r, 'JPM').drivers.includes('flow'));
// LOAD-BEARING (v121): this attribution path is NOT gated by FLOW_WEIGHT, and must never become gated.
// The workflow keeps flow dark to the MODEL during the burn-in (composite, verify prompt, synthesis
// input) but returns the raw score in `ranking` regardless — so the Rebalance Log can measure whether
// high-flow names actually outperformed WITHOUT flow having influenced which names were bought. Gate
// this too and the burn-in ends with nothing to evaluate, which is the only thing that could ever
// justify turning the weight on.
ok('flow is attributed for MEASUREMENT even while its allocation weight is 0',
  nameOf(r, 'NVDA').drivers.includes('flow'));

// Attribution is optional: without `ranked` the target is byte-identical to the pre-v95 shape.
const noRank = finalizeTarget(ALLOC, base);
ok('no ranked → no drivers key at all', noRank.target.names.every((n) => !('drivers' in n)));
eq('omitting ranked changes nothing else', JSON.stringify(noRank.target.names.map((n) => n.weightPct)),
  JSON.stringify(r.target.names.map((n) => n.weightPct)));
// A ranked entry for a name that didn't make the allocation is simply unused.
const extra = finalizeTarget(ALLOC, { ...base, ranked: [...RANKED, { t: 'ZZZZ', m: 10, q: 10, g: 10, c: 10, v: 10 }] });
eq('unused ranked rows are ignored', extra.target.names.length, 3);

// ---- risk caps still dispose over the model ---------------------------------
// The workflow proposes; this re-enforces. A blatantly over-concentrated megacap-tech allocation must be
// pulled back under the cluster cap regardless of what the model returned.
const hot = finalizeTarget({ picks: [
  { ticker: 'NVDA', sector: 'Electronic Technology', weightPct: 40, thesis: 'x' },
  { ticker: 'MSFT', sector: 'Technology Services', weightPct: 40, thesis: 'x' },
  { ticker: 'SPY', sector: 'Index', weightPct: 20, thesis: 'core' },
] }, { book: 5000, asOf: '2026-08-04', universe: [...UNIVERSE, { t: 'MSFT', px: 372, hi: 555, lo: 349 }] });
const mega = hot.target.names.filter((n) => ['NVDA', 'MSFT'].includes(n.ticker)).reduce((a, n) => a + n.weightPct, 0);
ok('megacap-tech cluster pulled back under its cap', mega <= 49);
ok('the pullback is recorded in the notes', hot.notes.length > 0);

// ---- churn governor: two-strike phase-out (2026-08-12) ----------------------
// The 08-10/08-12 whipsaw: a held name dropped by ONE refresh must be retained (flagged phaseOut),
// not exited; only a second consecutive absence — or an explicit business-broken verdict — drops it.
const PRIOR = { asOf: '2026-08-05', names: [
  { ticker: 'GE',   sector: 'Electronic Technology', weightPct: 9,  entry: '355-372', stop: 336, target: 419, thesis: 'aero aftermarket' },
  { ticker: 'AAPL', sector: 'Electronic Technology', weightPct: 15, entry: '300-312', stop: 284, target: 340, thesis: 'services' },
  { ticker: 'UNH',  sector: 'Health Services',       weightPct: 11, entry: '398-412', stop: 366, target: 465, thesis: 'managed care', phaseOut: true },
  { ticker: 'V',    sector: 'Finance',               weightPct: 15, entry: '348-358', stop: 320, target: 385, thesis: 'take rate' },
  { ticker: 'XOM',  sector: 'Energy Minerals',       weightPct: 8,  entry: '130-140', stop: 120, target: 160, thesis: 'never bought' },
] };
const churn = finalizeTarget(ALLOC, { ...base, prior: PRIOR,
  held: ['GE', 'AAPL', 'UNH', 'V', 'SPY', 'NVDA', 'JPM'],           // XOM was never actually bought
  verdicts: [{ t: 'AAPL', rec: 'avoid', businessOk: false, risk: 'thesis broken in test' }] });
const dropReason = (t) => (churn.target.dropped.find((d) => d.ticker === t) || {}).reason;

ok('a held name dropped ONCE is retained, flagged phaseOut', nameOf(churn, 'GE') && nameOf(churn, 'GE').phaseOut === true);
ok('a second held no-verdict name is retained too', nameOf(churn, 'V') && nameOf(churn, 'V').phaseOut === true);
ok('the phase-out thesis says what it is', /PHASE-OUT/.test(nameOf(churn, 'GE').thesis));
ok('strike 2: a name already phaseOut in the prior target is genuinely dropped',
  !nameOf(churn, 'UNH') && dropReason('UNH') === 'phase-out-complete');
ok('business-broken verdict drops immediately (no retention)',
  !nameOf(churn, 'AAPL') && dropReason('AAPL') === 'business-broken');
ok('a prior name the account never held has nothing to protect',
  !nameOf(churn, 'XOM') && dropReason('XOM') === 'not-held');
ok('weights still normalize to ~100 with the retained names in',
  Math.abs(churn.target.names.reduce((a, n) => a + n.weightPct, 0) - 100) < 1);
ok('the method line records the retention', /phase-out retained/.test(churn.target.method));
ok('phaseOuts/dropped are surfaced to the caller',
  churn.phaseOuts.includes('GE') && churn.dropped.some((d) => d.ticker === 'AAPL'));
ok('without a prior target the shape is unchanged (no dropped key)',
  !('dropped' in finalizeTarget(ALLOC, base).target));

console.log(`\nfinalize-target.test: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
