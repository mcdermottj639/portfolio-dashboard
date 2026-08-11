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

// All-cash book with $2000 fresh cash, and near-term earnings on V (7d) + LLY (13d), GOOGL gapped below entry.
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

// over-target holding triggers a trim (taxable, sequenced before the buys it funds)
const over = planDeployment({
  target: { driftTriggerPp: 5, names: [{ ticker: 'NVDA', weightPct: 10, entry: '205-215', stop: 190 }, { ticker: 'SPY', weightPct: 90, entry: '740-750', stop: 690 }] },
  positions: [{ symbol: 'NVDA', qty: 5, avgCost: 150 }], cash: 0, quotes: { NVDA: 209, SPY: 747 }, opts: { asOf: '2026-07-23' },
});
ok('over-drift NVDA generates a trim', find(over.trims, 'NVDA'));
ok('trim note flags the sell-before-buy sequencing', /sequenced before the buys/.test(find(over.trims, 'NVDA').note));

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

// ═══ v96 — full-book planner: off-target exits, TLH, tax math, auto tier ═══

// The exact shape of the 2026-08 gap: 40% of the book in names the research dropped, target names
// starved. Off-target holds must become exits whose proceeds fund the underweights.
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
// v98 (limited margin): proceeds are spendable the same session, so there is ONE buy leg funded by
// settled cash + this ticket's proceeds — the old `buysT1` split is gone.
ok('buys draw on settled cash AND the sale proceeds', fullBook.spent > 50);
ok('buys never exceed cash + proceeds', fullBook.spent <= 50 + fullBook.proceeds + 1e-6);
ok('deployable pool = settled cash + proceeds', Math.abs(fullBook.deployable - (50 + fullBook.proceeds)) < 0.02);
ok('cash reports SETTLED cash, not the pool', Math.abs(fullBook.cash - 50) < 1e-6);
ok('buys target the underweight names in one leg', !!find(fullBook.buys, 'AAPL') && !!find(fullBook.buys, 'UNH'));
ok('no T+1 leg is emitted any more', fullBook.buysT1.length === 0);
ok('buys are flagged as leaning on sale proceeds', fullBook.buysNeedProceeds === true);
ok('turnover sums sells + buys', fullBook.turnover > 1200);
ok('an over-cap ticket is NOT auto-eligible', fullBook.autoEligible === false && fullBook.turnover > AUTO_TURNOVER_CAP && fullBook.autoCap === AUTO_TURNOVER_CAP);
ok('summary mentions the exits and the tax net', /exit/.test(fullBook.summary) && /ST tax/.test(fullBook.summary));

// Auto tier: small clean ticket within AUTO_TURNOVER_CAP is auto-eligible.
const small = planDeployment({ target: { names: [{ ticker: 'SPY', weightPct: 100, entry: '740-750', stop: 690 }] },
  positions: [], cash: 300, quotes: { SPY: 750 }, opts: { asOf: '2026-08-07' } });
ok('small clean ticket is auto-eligible', small.autoEligible === true && small.turnover <= AUTO_TURNOVER_CAP);

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
ok('harvested name is NOT bought back this ticket', !find(tlh.buys, 'GOOGL') && !find(tlh.buysT1, 'GOOGL'));
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
ok('trim proceeds fund a same-session buy of the underweight name', !!find(trimTax.buys, 'SPY'));

// ═══ v98 — limited margin (2026-08-11): instant settlement + the PDT day-trade guard ═══

// Instant settlement: with zero settled cash, a ticket's own sale proceeds still fund its buys today.
const noCash = planDeployment({
  target: { driftTriggerPp: 5, names: [{ ticker: 'AAPL', weightPct: 100, entry: '304-312', stop: 284 }] },
  positions: [{ symbol: 'MSFT', qty: 2, avgCost: 400 }],
  cash: 0, quotes: { AAPL: 309, MSFT: 450 }, opts: { asOf: '2026-08-11' },
});
ok('zero settled cash still funds buys from this ticket\'s proceeds', !!find(noCash.buys, 'AAPL') && noCash.spent > 0);
ok('…and the plan flags that the buys need the sells to fill first', noCash.buysNeedProceeds === true);
ok('…summary spells out the same-session funding', /same session/.test(noCash.summary));

// PDT guard: a name BOUGHT TODAY is never sold today — one day trade is one too many on a sub-$25k
// margin account, and the hourly executor would otherwise walk into the 4-in-5 restriction.
const pdtArgs = {
  target: { driftTriggerPp: 5, names: [{ ticker: 'AAPL', weightPct: 100, entry: '304-312', stop: 284 }] },
  positions: [{ symbol: 'MSFT', qty: 2, avgCost: 400 }],
  cash: 0, quotes: { AAPL: 309, MSFT: 450 }, opts: { asOf: '2026-08-11' },
};
const pdt = planDeployment({ ...pdtArgs, accountActivity: { MSFT: { lastBuyDate: '2026-08-11' } } });
ok('a name bought TODAY is not sold today', !find(pdt.exits, 'MSFT'));
ok('…it lands in blockedSells with the day-trade reason', find(pdt.blockedSells, 'MSFT') && find(pdt.blockedSells, 'MSFT').blocked === 'day-trade');
ok('…with a warning naming the guard', pdt.warnings.some((w) => /day trade/.test(w)));
ok('…and its proceeds are NOT counted as funding', pdt.proceeds === 0 && pdt.spent === 0);
const pdtOld = planDeployment({ ...pdtArgs, accountActivity: { MSFT: { lastBuyDate: '2026-08-08' } } });
ok('a buy on an EARLIER day does not block the sell', !!find(pdtOld.exits, 'MSFT') && !pdtOld.blockedSells.length);
ok('no accountActivity → no blocking (gate passes none)', !!find(planDeployment(pdtArgs).exits, 'MSFT'));

// The guard covers every sell kind, not just exits.
const pdtHarvest = planDeployment({
  target: { driftTriggerPp: 5, names: [{ ticker: 'GOOGL', weightPct: 50, entry: '370-382', stop: 332 }, { ticker: 'SPY', weightPct: 50, entry: '740-750', stop: 690 }] },
  positions: [{ symbol: 'GOOGL', qty: 2, avgCost: 400 }], cash: 1000, quotes: { GOOGL: 340, SPY: 750 },
  accountActivity: { GOOGL: { lastBuyDate: '2026-08-11' } }, opts: { asOf: '2026-08-11' },
});
ok('a harvest of a name bought today is blocked too', !find(pdtHarvest.harvests, 'GOOGL') && !!find(pdtHarvest.blockedSells, 'GOOGL'));
const pdtTrim = planDeployment({
  target: { driftTriggerPp: 5, names: [{ ticker: 'NVDA', weightPct: 10, entry: '205-215', stop: 190 }, { ticker: 'SPY', weightPct: 90, entry: '740-750', stop: 690 }] },
  positions: [{ symbol: 'NVDA', qty: 5, avgCost: 150 }], cash: 0, quotes: { NVDA: 209, SPY: 747 },
  accountActivity: { NVDA: { lastBuyDate: '2026-08-11' } }, opts: { asOf: '2026-08-11' },
});
ok('a trim of a name bought today is blocked too', !find(pdtTrim.trims, 'NVDA') && !!find(pdtTrim.blockedSells, 'NVDA'));

// ── v102: symmetric entry band, zone ageing, idle-cash deadline, index parking ──────────────────
// Fresh target (asOf == asOf) so zones are live; one name, so the arithmetic is checkable by hand.
const band = (px, extra = {}, tgt = {}) => planDeployment({
  target: { asOf: '2026-08-11', driftTriggerPp: 5, names: [{ ticker: 'V', weightPct: 100, entry: '364-372', stop: 328 }], ...tgt },
  positions: [], cash: 1000, quotes: { V: px, SPY: 750 }, opts: { asOf: '2026-08-11' }, ...extra,
});
const defReason = (p, sym) => (p.deferred.find((d) => d.sym === sym) || {}).reason;

// (a) TOLERANCE — the live 2026-08-11 case: V at $363.22 vs a $364 floor is 0.2% under = noise.
ok('a 0.2% miss under the entry floor no longer defers', !!find(band(363.22).buys, 'V'));
ok('…and a real break below the floor still does', defReason(band(340), 'V') === 'below-entry');
ok('below-stop stays absolute — no tolerance band', defReason(band(320), 'V') === 'below-stop');

// (b) UPPER BOUND — the gap that would have bought all 7 names above their zones on 2026-08-11.
ok('a small premium over the entry ceiling is tolerated', !!find(band(375).buys, 'V'));
ok('a real premium over the ceiling defers (above-entry)', defReason(band(400), 'V') === 'above-entry');

// (c) AGEING — same out-of-band price, but the zone is 30 days old → advisory, so it buys.
const stale = band(400, {}, { asOf: '2026-07-12' });
ok('a stale entry zone goes advisory (no band deferral)', !!find(stale.buys, 'V') && stale.entryPolicy.zonesStale === true);
ok('…and says so in the warnings', stale.warnings.some((w) => /advisory/i.test(w)));

// (d) IDLE DEADLINE — cash sitting past the deadline waives the bands and tranches in.
const idle = band(400, { opts: { asOf: '2026-08-11', cashIdleDays: 12 } });
ok('past the idle deadline the bands are waived', !!find(idle.buys, 'V') && idle.entryPolicy.idleOverdue === true);
ok('…and only a tranche of the idle cash is deployed', idle.entryPolicy.tranching === true && idle.spent < 500);
ok('…while a small balance is swept whole, not tranched forever',
  planDeployment({ target: { asOf: '2026-08-11', names: [{ ticker: 'V', weightPct: 100, entry: '364-372', stop: 328 }] },
    positions: [], cash: 200, quotes: { V: 400 }, opts: { asOf: '2026-08-11', cashIdleDays: 30 } }).entryPolicy.tranching === false);

// (e) PARKING — a deferred name's dollars go to the VTI waiting ground instead of idling in cash.
const parkArgs = {
  target: { asOf: '2026-08-11', driftTriggerPp: 5, names: [
    { ticker: 'V', weightPct: 50, entry: '364-372', stop: 328 }, { ticker: 'SPY', weightPct: 50, entry: '740-760', stop: 690 }] },
  positions: [], cash: 2000, quotes: { V: 450, SPY: 750, VTI: 300 }, opts: { asOf: '2026-08-11' },
};
const parked = planDeployment(parkArgs);
ok('V defers on premium and its weight parks in VTI', defReason(parked, 'V') === 'above-entry' && parked.parking.parked !== null);
ok('the vehicle is VTI, not the SPY ballast', parked.parking.vehicle === 'VTI');
ok('the park leg is a real VTI buy flagged parked', (find(parked.buys, 'VTI') || {}).parked === true);
ok('parking is reported and named', parked.parking.after > 0 && parked.parking.forNames.includes('V'));
ok('parking off → the money stays in cash', planDeployment({ ...parkArgs, opts: { ...parkArgs.opts, park: false } }).parking.parked === null);
ok('the SPY ballast is untouched by parking', !find(parked.buys, 'VTI') || (find(parked.buys, 'SPY') || {}).parked !== true);

// (f) INVARIANT 1 — the placeholder is absent from the target, so the off-target EXIT rule would
//     liquidate it every pass and the parking rule would rebuild it. That loop must not exist.
const heldPark = planDeployment({ ...parkArgs,
  parked: { vehicle: 'VTI', dollars: 900, forNames: ['V'] },
  positions: [{ symbol: 'VTI', qty: 3, avgCost: 300 }], cash: 0 });
ok('the parked VTI position is NOT exited as off-target',
  !heldPark.exits.some((e) => e.sym === 'VTI' && e.kind === 'exit'));
ok('…nor trimmed as drift', !find(heldPark.trims, 'VTI'));
ok('parking off → VTI IS a normal off-target orphan again', !!find(planDeployment({ ...parkArgs,
  positions: [{ symbol: 'VTI', qty: 3, avgCost: 300 }], cash: 0, opts: { ...parkArgs.opts, park: false } }).exits, 'VTI'));

// (g) RELEASE — V clears, so the parked slice is sold to fund it (taxable, in the sell list).
const relArgs = {
  target: { asOf: '2026-08-11', driftTriggerPp: 5, names: [
    { ticker: 'V', weightPct: 50, entry: '364-372', stop: 328 }, { ticker: 'SPY', weightPct: 50, entry: '740-760', stop: 690 }] },
  positions: [{ symbol: 'VTI', qty: 5, avgCost: 280 }, { symbol: 'SPY', qty: 2, avgCost: 700 }],
  cash: 0, quotes: { V: 368, SPY: 750, VTI: 300 },
  parked: { vehicle: 'VTI', dollars: 1400, forNames: ['V'] }, opts: { asOf: '2026-08-11' },
};
const rel = planDeployment(relArgs);
ok('a cleared name releases the parked slice', rel.parking.released !== null && rel.parking.after < rel.parking.before);
ok('the release is a SELL carrying a realized P&L', (rel.parking.released || {}).kind === 'park-release' && rel.parking.released.pl !== null);
ok('…and it funds the cleared name', !!find(rel.buys, 'V'));
ok('release respects the PDT guard', planDeployment({ ...relArgs,
  accountActivity: { VTI: { lastBuyDate: '2026-08-11' } } }).parking.released === null);
ok('the release never exceeds what was parked', rel.parking.released.dollars <= 1400 + 1e-6);

// (g2) LOCKED POOL — the vehicle was bought TODAY, so releasing it is a day trade. The parked pool
//      must not count as funding: buys cap at real cash, and nothing pretends the release happened.
const locked = planDeployment({ ...relArgs, positions: [{ symbol: 'VTI', qty: 5, avgCost: 280 }],
  cash: 100, parked: { vehicle: 'VTI', dollars: 1400, forNames: ['V'] },
  accountActivity: { VTI: { lastBuyDate: '2026-08-11' } } });
ok('PDT-locked pool: buys never exceed real cash', locked.spent <= 100 + locked.proceeds + 1e-6);
ok('PDT-locked pool: no phantom release', locked.parking.released === null && locked.parking.after === locked.parking.before);

// (h) entry zones with commas + trailing prose must parse (the live research writes them this way).
const prose = planDeployment({
  target: { asOf: '2026-08-11', names: [{ ticker: 'LLY', weightPct: 100, entry: '$1,130-$1,180 (into the $1,160 50-DMA)', stop: 1075 }] },
  positions: [], cash: 1000, quotes: { LLY: 1216.41 }, opts: { asOf: '2026-08-11' },
});
ok('a "$1,130-$1,180 (prose)" zone parses and defers on premium', defReason(prose, 'LLY') === 'above-entry');

// (i) NO QUOTE — a brand-new target name with no snapshot price defers honestly (not phantom below-stop),
//     and an unquoted park vehicle warns instead of silently disabling the waiting ground.
const noQuote = planDeployment({
  target: { asOf: '2026-08-11', names: [{ ticker: 'SHEL', weightPct: 50, entry: '86-92', stop: 82 }, { ticker: 'SPY', weightPct: 50, entry: '740-780', stop: 690 }] },
  positions: [], cash: 2000, quotes: { SPY: 750 }, opts: { asOf: '2026-08-11' },   // no SHEL, no VTI quote
});
ok('unquoted target name defers as no-quote, not below-stop', defReason(noQuote, 'SHEL') === 'no-quote');
ok('…and parking-unavailable is a visible warning', noQuote.warnings.some((w) => /parking unavailable/.test(w)));
ok('…while a quoted VTI parks the same deferral', planDeployment({
  target: { asOf: '2026-08-11', names: [{ ticker: 'SHEL', weightPct: 50, entry: '86-92', stop: 82 }, { ticker: 'SPY', weightPct: 50, entry: '740-780', stop: 690 }] },
  positions: [], cash: 2000, quotes: { SPY: 750, VTI: 300 }, opts: { asOf: '2026-08-11' },
}).parking.parked !== null);

console.log(`\nagentic-deploy.test: ${pass} passed, ${fail} failed  (blackout=${EARNINGS_BLACKOUT_DAYS}d)`);
process.exit(fail ? 1 : 0);
