// Offline unit checks for agentic-deploy.mjs — no network, no I/O. Run: node producer/agentic-deploy.test.mjs
import { planDeployment, EARNINGS_BLACKOUT_DAYS } from './agentic-deploy.mjs';

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

console.log(`\nagentic-deploy.test: ${pass} passed, ${fail} failed  (blackout=${EARNINGS_BLACKOUT_DAYS}d)`);
process.exit(fail ? 1 : 0);
