// Offline unit checks for agentic-deploy.mjs — no network, no I/O. Run: node producer/agentic-deploy.test.mjs
import { planDeployment, EARNINGS_BLACKOUT_DAYS, AUTO_TURNOVER_CAP } from './agentic-deploy.mjs';

let pass = 0, fail = 0;
const ok = (label, cond) => { if (cond) pass++; else { fail++; console.error(`✗ ${label}`); } };
const near = (label, got, want, tol = 1) => { if (Math.abs(got - want) <= tol) pass++; else { fail++; console.error(`✗ ${label}\n    got ${got} want ~${want}`); } };
const find = (arr, sym) => arr.find((x) => x.sym === sym);

const target = { driftTriggerPp: 5, names: [
  { ticker: 'SPY',   weightPct: 25, entry: '740-750',  stop: 690,  target: 815 },
  { ticker: 'NVDA',  weightPct: 20, entry: '205-215',  stop: 190,  target: 245 },
  { ticker: 'GOOGL', weightPct: 15, entry: '352-362',  stop: 320,  target: 415 },
  { ticker: 'JPM',   weightPct: 15, entry: '336-345',  stop: 310,  target: 375 },
  { ticker: 'V',     weightPct: 15, entry: '348-358',  stop: 320,  target: 385 },
  { ticker: 'LLY',   weightPct: 10, entry: '1130-1170',stop: 1085, target: 1300 },
]};
const quotes = { SPY: 747, NVDA: 209, GOOGL: 324.76, JPM: 348.8, V: 352.5, LLY: 1152 };

// All-cash account with $2000 fresh cash, and near-term earnings on V (7d) + LLY (13d), GOOGL gapped below entry.
const base = planDeployment({
  target, positions: [], cash: 2000, quotes,
  earnings: { V: { date: '2026-07-28', daysAway: 5 }, LLY: { date: '2026-08-05', daysAway: 13 } },
  opts: { asOf: '2026-07-23' },
});

ok('book = cash when all-cash', Math.abs(base.book - 2000) < 1);
ok('V deferred for earnings inside blackout', find(base.deferred, 'V') && find(base.deferred, 'V').reason === 'earnings');
ok('LLY NOT deferred (13d > 7d blackout)', !find(base.deferred, 'LLY'));
ok('GOOGL deferred: gapped below its planned entry zone', find(base.deferred, 'GOOGL') && find(base.deferred, 'GOOGL').reason === 'below-entry');
ok('SPY is an eligible buy', !!find(base.buys, 'SPY'));
ok('NVDA is an eligible buy (px inside entry, no near earnings)', !!find(base.buys, 'NVDA'));
ok('JPM is an eligible buy (earnings behind it)', !!find(base.buys, 'JPM'));
ok('deferred names are NOT bought', !find(base.buys, 'V') && !find(base.buys, 'GOOGL'));
ok('every buy carries a share count from the live price', base.buys.every((b) => b.shares > 0));
ok('total spent never exceeds cash', base.spent <= base.cash + 1e-6);
ok('deferred cash surfaced', base.deferredCash > 0);
ok('a warning names the deferred set', base.warnings.some((w) => w.includes('deferred')));

// below-STOP is treated as broken (harder than below-entry)
const broken = planDeployment({ target: { names: [{ ticker: 'NVDA', weightPct: 100, entry: '205-215', stop: 190 }] }, positions: [], cash: 1000, quotes: { NVDA: 185 }, opts: { asOf: '2026-07-23' } });
ok('below-stop → deferred as broken setup', find(broken.deferred, 'NVDA') && find(broken.deferred, 'NVDA').reason === 'below-stop');

// wash-sale blocks a rebuy even if otherwise eligible
const wash = planDeployment({ target: { names: [{ ticker: 'NVDA', weightPct: 100, entry: '205-215', stop: 190 }] }, positions: [], cash: 1000, quotes: { NVDA: 209 }, washMap: { NVDA: { until: '2026-08-01' } }, opts: { asOf: '2026-07-23' } });
ok('wash-sale name deferred, not bought', find(wash.deferred, 'NVDA') && find(wash.deferred, 'NVDA').reason === 'wash-sale' && !find(wash.buys, 'NVDA'));

// over-target holding triggers a trim (taxable, T+1)
const over = planDeployment({
  target: { driftTriggerPp: 5, names: [{ ticker: 'NVDA', weightPct: 10, entry: '205-215', stop: 190 }, { ticker: 'SPY', weightPct: 90, entry: '740-750', stop: 690 }] },
  positions: [{ symbol: 'NVDA', qty: 5, avgCost: 150 }], cash: 0, quotes: { NVDA: 209, SPY: 747 }, opts: { asOf: '2026-07-23' },
});
ok('over-drift NVDA generates a trim', find(over.trims, 'NVDA'));
ok('trim note flags T+1 settlement', find(over.trims, 'NVDA').note.includes('T+1'));

// pro-rate when cash < total gap: two equal-gap eligible names split a small pot
const prorate = planDeployment({ target: { names: [{ ticker: 'SPY', weightPct: 50, entry: '740-750', stop: 690 }, { ticker: 'JPM', weightPct: 50, entry: '336-345', stop: 310 }] }, positions: [], cash: 100, quotes: { SPY: 747, JPM: 348.8 }, opts: { asOf: '2026-07-23' } });
near('pro-rated buys sum to the small cash pot', prorate.spent, 100, 1);

// ---- policy blackout (v95) — same reasoning as earnings: don't deploy into a dated binary event ----
const POL = { events: [
  { date: '2026-07-27', title: 'Section 232 tariff ruling', impact: 'high', tickers: ['NVDA'], source: 'https://example.gov/r' },
  { date: '2026-07-27', title: 'Comment period closes', impact: 'low', tickers: ['JPM'] },
  { date: '2026-11-01', title: 'Distant ruling', impact: 'high', tickers: ['SPY'], source: 'https://example.gov/d' },
] };
const polTarget = { names: [{ ticker: 'NVDA', weightPct: 100, entry: '205-215', stop: 190 }] };
const polArgs = { positions: [], cash: 1000, quotes: { NVDA: 209, JPM: 348.8, SPY: 747 }, opts: { asOf: '2026-07-23' } };

const polDefer = planDeployment({ ...polArgs, target: polTarget, policy: POL });
ok('high-impact policy event inside the window defers the buy', find(polDefer.deferred, 'NVDA') && find(polDefer.deferred, 'NVDA').reason === 'policy');
ok('policy-deferred name is not bought', !find(polDefer.buys, 'NVDA'));
ok('policy deferral names the event and date', /Section 232 tariff ruling on 2026-07-27/.test(find(polDefer.deferred, 'NVDA').detail));

// Absent or empty calendar must be a complete no-op — this is the shipped default.
ok('no policy calendar → normal buy', !!find(planDeployment({ ...polArgs, target: polTarget }).buys, 'NVDA'));
ok('empty policy calendar → normal buy', !!find(planDeployment({ ...polArgs, target: polTarget, policy: { events: [] } }).buys, 'NVDA'));

// Low-impact events are context, not blockers — over-blocking would quietly starve the deploy plan.
const lowImpact = planDeployment({ ...polArgs, target: { names: [{ ticker: 'JPM', weightPct: 100, entry: '330-345', stop: 310 }] }, policy: POL });
ok('low-impact policy event does not defer', !!find(lowImpact.buys, 'JPM') && !find(lowImpact.deferred, 'JPM'));

// A high-impact event months out is real but not imminent.
const distant = planDeployment({ ...polArgs, target: { names: [{ ticker: 'SPY', weightPct: 100, entry: '740-750', stop: 690 }] }, policy: POL });
ok('distant policy event does not defer today', !!find(distant.buys, 'SPY'));

// Wash-sale and earnings still outrank policy in the guardrail order.
const washFirst = planDeployment({ ...polArgs, target: polTarget, policy: POL, washMap: { NVDA: { until: '2026-08-01' } } });
ok('wash-sale still takes precedence over policy', find(washFirst.deferred, 'NVDA').reason === 'wash-sale');
const earnFirst = planDeployment({ ...polArgs, target: polTarget, policy: POL, earnings: { NVDA: { date: '2026-07-26' } } });
ok('earnings still takes precedence over policy', find(earnFirst.deferred, 'NVDA').reason === 'earnings');

// ═══ v96 — full-book planner: off-target exits, TLH, two-leg T+1, tax math, auto tier ═══

// The exact shape of the 2026-08 gap: 40% of the book in names the research dropped, target names
// starved. Off-target holds must become exits whose proceeds fund the underweights next session.
const fullBook = planDeployment({
  target: { driftTriggerPp: 5, names: [
    { ticker: 'SPY',  weightPct: 40, entry: '740-750', stop: 690, target: 815 },
    { ticker: 'AAPL', weightPct: 40, entry: '304-312', stop: 284, target: 340 },
    { ticker: 'UNH',  weightPct: 20, entry: '398-412', stop: 366, target: 465 },
  ]},
  positions: [
    { symbol: 'SPY',  qty: 1, avgCost: 700 },     // held target name, near weight
    { symbol: 'MSFT', qty: 2, avgCost: 400 },     // off-target, at a GAIN
    { symbol: 'GE',   qty: 1, avgCost: 380 },     // off-target, at a LOSS
  ],
  cash: 50, quotes: { SPY: 750, AAPL: 309, UNH: 403, MSFT: 450, GE: 340 },
  opts: { asOf: '2026-08-07' },
});
ok('off-target MSFT becomes an exit', find(fullBook.exits, 'MSFT') && find(fullBook.exits, 'MSFT').kind === 'exit');
ok('off-target GE becomes an exit', !!find(fullBook.exits, 'GE'));
ok('held target name is NOT exited', !find(fullBook.exits, 'SPY'));
near('exit sells the whole position', find(fullBook.exits, 'MSFT').dollars, 900, 1);
near('exit carries realized ST P&L vs avg cost', find(fullBook.exits, 'MSFT').pl, 100, 1);
near('loss exit carries a negative P&L', find(fullBook.exits, 'GE').pl, -40, 1);
ok('sells are ordered losses-first', fullBook.sells[0].sym === 'GE');
near('taxSummary nets gains against losses', fullBook.taxSummary.net, 60, 2);
ok('leg-1 buys spend only settled cash', fullBook.spent <= 50 + 1e-6);
ok('T+1 leg exists, funded by proceeds', fullBook.buysT1.length > 0);
ok('T+1 buys never exceed sale proceeds', fullBook.buysT1.reduce((s, b) => s + b.dollars, 0) <= fullBook.proceeds + 1e-6);
ok('T+1 buys target the underweight names', !!find(fullBook.buysT1, 'AAPL') && !!find(fullBook.buysT1, 'UNH'));
ok('turnover sums sells + both buy legs', fullBook.turnover > 1200);
ok('a >$500-turnover ticket is NOT auto-eligible', fullBook.autoEligible === false && fullBook.autoCap === AUTO_TURNOVER_CAP);
ok('summary mentions the exits and the tax net', /exit/.test(fullBook.summary) && /ST tax/.test(fullBook.summary));

// Auto tier: small clean ticket ≤ $500 turnover is auto-eligible.
const small = planDeployment({ target: { names: [{ ticker: 'SPY', weightPct: 100, entry: '740-750', stop: 690 }] },
  positions: [], cash: 300, quotes: { SPY: 750 }, opts: { asOf: '2026-08-07' } });
ok('small clean ticket is auto-eligible', small.autoEligible === true && small.turnover <= 500);

// TLH: a target name deep underwater is harvested — full position, wash-blocked from the buy legs.
const tlhTarget = { driftTriggerPp: 5, names: [
  { ticker: 'GOOGL', weightPct: 50, entry: '370-382', stop: 332, target: 440 },
  { ticker: 'SPY',   weightPct: 50, entry: '740-750', stop: 690, target: 815 },
]};
const tlh = planDeployment({
  target: tlhTarget,
  positions: [{ symbol: 'GOOGL', qty: 2, avgCost: 400 }], // px 340 → −$120 loss (>max($75,5% of $800))
  cash: 1000, quotes: { GOOGL: 340, SPY: 750 }, opts: { asOf: '2026-08-07' },
});
ok('deep-loss target name is harvested', find(tlh.harvests, 'GOOGL') && find(tlh.harvests, 'GOOGL').kind === 'harvest');
near('harvest realizes the ST loss', find(tlh.harvests, 'GOOGL').pl, -120, 1);
ok('harvested name is NOT bought in leg-1', !find(tlh.buys, 'GOOGL'));
ok('harvested name is NOT bought in leg-2', !find(tlh.buysT1, 'GOOGL'));
ok('harvest adds a wash-sale deferral for the rebuy', find(tlh.deferred, 'GOOGL') && find(tlh.deferred, 'GOOGL').reason === 'wash-sale');
ok('SPY still gets bought', !!find(tlh.buys, 'SPY'));

// TLH threshold: a small loss is left alone (harvesting dust isn't worth the underweight).
const smallLoss = planDeployment({ target: tlhTarget,
  positions: [{ symbol: 'GOOGL', qty: 2, avgCost: 350 }], cash: 100, quotes: { GOOGL: 340, SPY: 750 }, opts: { asOf: '2026-08-07' } });
ok('a −$20 loss is below the harvest floor', !find(smallLoss.harvests || [], 'GOOGL'));

// Cross-account wash guard: the margin book bought the name within 30d → no harvest (loss disallowed),
// and a loss-EXIT is flagged washRisk but still exits (allocation dominates; only the tax benefit dies).
const cross = planDeployment({
  target: tlhTarget,
  positions: [{ symbol: 'GOOGL', qty: 2, avgCost: 400 }, { symbol: 'INTC', qty: 10, avgCost: 40 }],
  cash: 0, quotes: { GOOGL: 340, SPY: 750, INTC: 30 },
  crossActivity: { GOOGL: { lastBuyDate: '2026-07-20' }, INTC: { lastBuyDate: '2026-07-25' } },
  opts: { asOf: '2026-08-07' },
});
ok('cross-account recent buy blocks the harvest', !find(cross.harvests, 'GOOGL'));
ok('…with a warning naming the reason', cross.warnings.some((w) => /TLH skipped on GOOGL/.test(w)));
ok('off-target loss-exit still exits but is flagged washRisk', find(cross.exits, 'INTC') && find(cross.exits, 'INTC').washRisk === true);
const crossOld = planDeployment({ ...{ target: tlhTarget, positions: [{ symbol: 'GOOGL', qty: 2, avgCost: 400 }], cash: 0, quotes: { GOOGL: 340, SPY: 750 } },
  crossActivity: { GOOGL: { lastBuyDate: '2026-06-01' } }, opts: { asOf: '2026-08-07' } });
ok('a cross-account buy OUTSIDE 30d does not block the harvest', !!find(crossOld.harvests, 'GOOGL'));

// Trims now carry the tax estimate too.
const trimTax = planDeployment({
  target: { driftTriggerPp: 5, names: [{ ticker: 'NVDA', weightPct: 10, entry: '205-215', stop: 190 }, { ticker: 'SPY', weightPct: 90, entry: '740-750', stop: 690 }] },
  positions: [{ symbol: 'NVDA', qty: 5, avgCost: 150 }], cash: 0, quotes: { NVDA: 209, SPY: 747 }, opts: { asOf: '2026-07-23' },
});
ok('trim carries realized P&L', typeof find(trimTax.trims, 'NVDA').pl === 'number' && find(trimTax.trims, 'NVDA').pl > 0);
ok('trim proceeds fund a T+1 buy of the underweight name', !!find(trimTax.buysT1, 'SPY'));

console.log(`\nagentic-deploy.test: ${pass} passed, ${fail} failed  (blackout=${EARNINGS_BLACKOUT_DAYS}d)`);
process.exit(fail ? 1 : 0);
