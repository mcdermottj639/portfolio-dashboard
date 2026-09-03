// Offline unit checks for agentic-deploy.mjs — no network, no I/O. Run: node producer/agentic-deploy.test.mjs
import { planDeployment, marketRegime, EARNINGS_BLACKOUT_DAYS, AUTO_TURNOVER_CAP, MIN_HOLD_DAYS, REENTRY_COOLDOWN_DAYS, MIN_BUY } from './agentic-deploy.mjs';

let pass = 0, fail = 0;
const ok = (label, cond) => { if (cond) pass++; else { fail++; console.error(`✗ ${label}`); } };
const near = (label, got, want, tol = 1) => { if (Math.abs(got - want) <= tol) pass++; else { fail++; console.error(`✗ ${label}\n    got ${got} want ~${want}`); } };
const find = (arr, sym) => arr.find((x) => x.sym === sym);
const eqr = (label, got, want) => { if (got === want) pass++; else { fail++; console.error(`✗ ${label}\n    got ${got} want ${want}`); } };

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

// v105: a loss booked in the SELF-DIRECTED account blocks the agentic rebuy too (the IRS window is per
// taxpayer — the real Jul-29 NVDA loss / Aug-11 agentic rebuy case), and the deferral says which book.
const crossWash = planDeployment({ target: { names: [{ ticker: 'NVDA', weightPct: 100, entry: '205-215', stop: 190 }] }, positions: [], cash: 1000, quotes: { NVDA: 209 }, washMap: { NVDA: { until: '2026-08-28', date: '2026-07-29', account: 'main' } }, opts: { asOf: '2026-08-12' } });
const cw = find(crossWash.deferred, 'NVDA');
ok('a margin-book loss defers the agentic buy', cw && cw.reason === 'wash-sale' && !find(crossWash.buys, 'NVDA'));
ok('cross-account deferral names the other account', cw && /cross-account/.test(cw.detail));

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
// 2026-08-25 (owner): the auto tier is $10k, so a full-book rebalance on this ~$1.5k fixture is now
// INSIDE it — the confirm tier survives only for tickets larger than the cap. The over-cap mechanism
// itself is pinned separately below via the opts.autoCap override.
ok('a full-book rebalance sits inside the $10k auto tier', fullBook.autoEligible === true && fullBook.turnover <= AUTO_TURNOVER_CAP && fullBook.autoCap === AUTO_TURNOVER_CAP);
const overCap = planDeployment({
  target: { driftTriggerPp: 5, names: [
    { ticker: 'SPY',  weightPct: 40, entry: '740-750', stop: 690, target: 815 },
    { ticker: 'AAPL', weightPct: 40, entry: '304-312', stop: 284, target: 340 },
    { ticker: 'UNH',  weightPct: 20, entry: '398-412', stop: 366, target: 465 },
  ]},
  positions: [
    { symbol: 'SPY',  qty: 1, avgCost: 700 },
    { symbol: 'MSFT', qty: 2, avgCost: 400 },
    { symbol: 'GE',   qty: 1, avgCost: 380 },
  ],
  cash: 50, quotes: { SPY: 750, AAPL: 309, UNH: 403, MSFT: 450, GE: 340 },
  opts: { asOf: '2026-08-07', autoCap: 500 },
});
ok('a ticket over the cap is NOT auto-eligible (mechanism)', overCap.autoEligible === false && overCap.turnover > 500 && overCap.autoCap === 500);
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
// (a buy a few days back is now the MIN-HOLD's territory — see the churn-governor section below;
//  only a buy outside that window sells freely)
const pdtOld = planDeployment({ ...pdtArgs, accountActivity: { MSFT: { lastBuyDate: '2026-07-01' } } });
ok('a buy outside the min-hold window does not block the sell', !!find(pdtOld.exits, 'MSFT') && !pdtOld.blockedSells.length);
ok('no accountActivity → no blocking (nothing to key off)', !!find(planDeployment(pdtArgs).exits, 'MSFT'));

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
// UNDATED (2026-09-03) — an above-entry deferral clears on a price move with no known date, and the
// real book showed those clearing in 1-6 days: too short for beta to cover the vehicle's spread.
ok('an UNDATED deferral (above-entry) does NOT park', defReason(parked, 'V') === 'above-entry' && parked.parking.parked === null);
ok('…and the ticket says the money is waiting in cash', parked.warnings.some((w) => /stays in CASH/.test(w)));
// DATED — a wash block is a known multi-week wait, so the waiting ground earns its spread.
const parkedDated = planDeployment({ ...parkArgs, washMap: { V: { until: '2026-09-10' } } });
ok('a DATED deferral (wash-sale) parks in VTI', defReason(parkedDated, 'V') === 'wash-sale' && parkedDated.parking.parked !== null);
ok('the vehicle is VTI, not the SPY ballast', parkedDated.parking.vehicle === 'VTI');
ok('the park leg is a real VTI buy flagged parked', (find(parkedDated.buys, 'VTI') || {}).parked === true);
ok('parking is reported and named', parkedDated.parking.after > 0 && parkedDated.parking.forNames.includes('V'));
ok('…and forNames carries only the dated name, never the undated one',
  !parkedDated.parking.forNames.includes('SPY'));
ok('parking off → the money stays in cash', planDeployment({ ...parkArgs, washMap: { V: { until: '2026-09-10' } }, opts: { ...parkArgs.opts, park: false } }).parking.parked === null);
ok('the SPY ballast is untouched by parking', !find(parkedDated.buys, 'VTI') || (find(parkedDated.buys, 'SPY') || {}).parked !== true);

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

// (g3) SUB-FLOOR SHORTFALL (2026-08-28) — the pool counts the waiting ground, but a shortfall under
//      PARK_MIN correctly fires no release, so those dollars are never actually freed. The buy must be
//      re-sized to what cash can really pay for, NOT shipped as an unpayable ticket. This is the live
//      2026-08-28 case: $485.99 parked, $0.90 cash, a $26.94 JNJ top-up needing $26.04 of release.
const subFloorArgs = {
  target: { asOf: '2026-08-27', driftTriggerPp: 5, names: [
    { ticker: 'JNJ', weightPct: 66, entry: '256-277', stop: 246 },
    { ticker: 'MA', weightPct: 34, entry: '400-420', stop: 380 }] },
  positions: [{ symbol: 'JNJ', qty: 3, avgCost: 260 }, { symbol: 'VTI', qty: 1.62, avgCost: 300 }],
  cash: 0.9, quotes: { JNJ: 265, MA: 520, VTI: 300 },
  parked: { vehicle: 'VTI', dollars: 485.99, forNames: ['MA'] }, opts: { asOf: '2026-08-27' },
};
const subFloor = planDeployment(subFloorArgs);
ok('sub-floor shortfall: no release fires', subFloor.parking.released === null);
ok('sub-floor shortfall: the waiting ground is untouched', subFloor.parking.after === subFloor.parking.before);
ok('sub-floor shortfall: buys never exceed cash + proceeds',
  subFloor.spent <= +(0.9 + subFloor.proceeds).toFixed(2) + 1e-6);
ok('sub-floor shortfall: the dust-sized leg waits rather than forcing a release', !find(subFloor.buys, 'JNJ'));
ok('sub-floor shortfall: the re-size is explained', subFloor.warnings.some((w) => /re-sized/.test(w)));
ok('sub-floor shortfall: the funding invariant is NOT breached',
  !subFloor.warnings.some((w) => /PLANNER BUG/.test(w)));

// (g4) …and the mirror: a shortfall AT or above the floor still releases exactly as it did before, so
//      the fix narrows nothing. Same book, a bigger gap.
const overFloor = planDeployment({ ...subFloorArgs,
  target: { ...subFloorArgs.target, names: [
    { ticker: 'JNJ', weightPct: 85, entry: '256-277', stop: 246 },
    { ticker: 'MA', weightPct: 15, entry: '400-420', stop: 380 }] } });
ok('at-floor shortfall: the release still fires', overFloor.parking.released !== null);
ok('at-floor shortfall: JNJ is funded', !!find(overFloor.buys, 'JNJ'));
ok('at-floor shortfall: spend is covered by cash + proceeds + release',
  overFloor.spent <= +(0.9 + overFloor.proceeds + overFloor.parking.released.dollars).toFixed(2) + 1e-6);
ok('at-floor shortfall: no re-size was needed', !overFloor.warnings.some((w) => /re-sized/.test(w)));

// (g5) the OTHER way the pool can lie: the parked block itself is under PARK_MIN, so the release branch
//      never even opens — yet those dollars were still counted as deployable.
const tinyPark = planDeployment({ ...subFloorArgs,
  parked: { vehicle: 'VTI', dollars: 50, forNames: ['MA'] } });
ok('sub-floor PARKED BLOCK: no release', tinyPark.parking.released === null);
ok('sub-floor PARKED BLOCK: buys still never exceed cash + proceeds',
  tinyPark.spent <= +(0.9 + tinyPark.proceeds).toFixed(2) + 1e-6);
ok('sub-floor PARKED BLOCK: invariant holds', !tinyPark.warnings.some((w) => /PLANNER BUG/.test(w)));

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
ok('an undated no-quote deferral waits in cash, so no vehicle is needed', noQuote.parking.parked === null);
// The unquoted-vehicle warning is only REACHABLE when something is actually parkable, so it needs a
// dated deferral (2026-09-03). With nothing to park, an unquoted vehicle is simply irrelevant.
const shelTarget = { asOf: '2026-08-11', names: [{ ticker: 'SHEL', weightPct: 50, entry: '86-92', stop: 82 }, { ticker: 'SPY', weightPct: 50, entry: '740-780', stop: 690 }] };
const shelWash = { SHEL: { until: '2026-09-10' } };
ok('…and parking-unavailable is a visible warning', planDeployment({
  target: shelTarget, positions: [], cash: 2000, quotes: { SPY: 750, SHEL: 88 },   // no VTI quote
  washMap: shelWash, opts: { asOf: '2026-08-11' },
}).warnings.some((w) => /parking unavailable/.test(w)));
ok('…while a quoted VTI parks the same deferral', planDeployment({
  target: shelTarget, positions: [], cash: 2000, quotes: { SPY: 750, SHEL: 88, VTI: 300 },
  washMap: shelWash, opts: { asOf: '2026-08-11' },
}).parking.parked !== null);

// ═══ Churn governor (2026-08-12) — min-hold, re-entry cooldown, dust floor, phase-out ═══
// The live failure this encodes: 08-10 exited GE/LLY/AMZN/MSFT and bought AAPL/UNH/V; 08-12 the next
// target reversed both legs — a near-total book flip in 48h. These guards make that impossible.

// MIN-HOLD: an off-target exit of a name bought 2 days ago is blocked (the AAPL-bought-08-10 case).
const mh = planDeployment({ ...pdtArgs, accountActivity: { MSFT: { lastBuyDate: '2026-08-09' } } });
ok('an exit of a name bought 2d ago is min-hold blocked',
  !find(mh.exits, 'MSFT') && find(mh.blockedSells, 'MSFT') && find(mh.blockedSells, 'MSFT').blocked === 'min-hold');
ok('…the note names the unlock date', /2026-08-23/.test(find(mh.blockedSells, 'MSFT').note));
// STRUCTURED alongside the prose (2026-08-25): the ticket now persists these and the Plan tab renders
// them, so the unlock date has to be a field — re-parsing it back out of the sentence would be absurd.
ok('…and carries the unlock date + age as fields, not just prose',
  find(mh.blockedSells, 'MSFT').until === '2026-08-23' && find(mh.blockedSells, 'MSFT').heldDays === 2);
ok('a day-trade block carries an unlock date too', find(pdt.blockedSells, 'MSFT').until === '2026-08-12');
ok('…and a churn-guard warning is raised', mh.warnings.some((w) => /min-hold/.test(w)));
ok('…its proceeds are NOT counted as funding', mh.proceeds === 0);

// Risk control outranks churn control: a ≥10% loss may exit regardless of age.
const mhLoss = planDeployment({ ...pdtArgs, positions: [{ symbol: 'MSFT', qty: 2, avgCost: 520 }],
  accountActivity: { MSFT: { lastBuyDate: '2026-08-09' } } });
ok('a deep (≤−10%) loss overrides the min-hold', !!find(mhLoss.exits, 'MSFT'));

// A research verdict that the BUSINESS broke overrides too (finalize-target records it in target.dropped).
const mhBroken = planDeployment({ ...pdtArgs,
  target: { ...pdtArgs.target, dropped: [{ ticker: 'MSFT', reason: 'business-broken' }] },
  accountActivity: { MSFT: { lastBuyDate: '2026-08-09' } } });
ok('a business-broken drop overrides the min-hold', !!find(mhBroken.exits, 'MSFT'));

// A TLH harvest is exempt by kind (it has its own floor; a real loss harvested fast is legitimate).
// GOOGL here is −8.6% — NOT deep enough for the loss override, so only the kind-exemption passes it.
const mhHarvest = planDeployment({
  target: { driftTriggerPp: 5, names: [{ ticker: 'GOOGL', weightPct: 50, entry: '370-382', stop: 332 }, { ticker: 'SPY', weightPct: 50, entry: '740-750', stop: 690 }] },
  positions: [{ symbol: 'GOOGL', qty: 10, avgCost: 372 }], cash: 0, quotes: { GOOGL: 340, SPY: 750 },
  accountActivity: { GOOGL: { lastBuyDate: '2026-08-06' } }, opts: { asOf: '2026-08-11' },
});
ok('a TLH harvest is exempt from the min-hold', !!find(mhHarvest.harvests, 'GOOGL'));

// RE-ENTRY COOLDOWN: a name sold 2 days ago is not rebought (the GE-sold-08-10-rebought-08-12 case);
// its weight parks in the VTI waiting ground instead.
const reArgs = {
  target: { asOf: '2026-08-12', driftTriggerPp: 5, names: [
    { ticker: 'AAPL', weightPct: 50, entry: '300-312', stop: 284 }, { ticker: 'SPY', weightPct: 50, entry: '740-760', stop: 690 }] },
  positions: [], cash: 2000, quotes: { AAPL: 309, SPY: 750, VTI: 300 }, opts: { asOf: '2026-08-12' },
};
const re = planDeployment({ ...reArgs, accountActivity: { AAPL: { lastSellDate: '2026-08-10' } } });
ok('a name sold 2d ago is not rebought (re-entry cooldown)', !find(re.buys, 'AAPL') && defReason(re, 'AAPL') === 'reentry');
ok('…the deferral carries the unlock date', find(re.deferred, 'AAPL').until === '2026-08-24');
ok('…and the deferred weight parks in VTI', re.parking.parked !== null && re.parking.forNames.includes('AAPL'));
ok('a sell outside the cooldown does not defer',
  !!find(planDeployment({ ...reArgs, accountActivity: { AAPL: { lastSellDate: '2026-07-01' } } }).buys, 'AAPL'));
ok('wash-sale still outranks the re-entry reason', defReason(planDeployment({ ...reArgs,
  washMap: { AAPL: { until: '2026-09-01' } }, accountActivity: { AAPL: { lastSellDate: '2026-08-10' } } }), 'AAPL') === 'wash-sale');

// DUST FLOOR: a sub-$25 gap is not worth an order (the 08-05 ticket placed a $1.80 UNH buy).
const dust = planDeployment({
  target: { asOf: '2026-08-12', names: [{ ticker: 'SPY', weightPct: 100, entry: '740-760', stop: 690 }] },
  positions: [{ symbol: 'SPY', qty: 1.3, avgCost: 700 }], cash: 10, quotes: { SPY: 750 }, opts: { asOf: '2026-08-12' },
});
ok('a sub-$25 gap is not traded (dust floor)', dust.buys.length === 0 && MIN_BUY === 25);
ok('…opts.minBuy can lower the floor', planDeployment({
  target: { asOf: '2026-08-12', names: [{ ticker: 'SPY', weightPct: 100, entry: '740-760', stop: 690 }] },
  positions: [{ symbol: 'SPY', qty: 1.3, avgCost: 700 }], cash: 10, quotes: { SPY: 750 },
  opts: { asOf: '2026-08-12', minBuy: 1 } }).buys.length === 1);

// PHASE-OUT: a name finalize-target retained after the research dropped it is held but never added to —
// and it is NOT a deferral, so its weight must not attract parked dollars.
const po = planDeployment({
  target: { asOf: '2026-08-12', driftTriggerPp: 5, names: [
    { ticker: 'GE', weightPct: 50, entry: '350-372', stop: 336, phaseOut: true },
    { ticker: 'SPY', weightPct: 50, entry: '740-760', stop: 690 }] },
  positions: [], cash: 1000, quotes: { GE: 368, SPY: 750, VTI: 300 }, opts: { asOf: '2026-08-12' },
});
ok('no NEW money into a phase-out name', !find(po.buys, 'GE') && !find(po.deferred, 'GE'));
ok('…its weight does not park', po.parking.parked === null);
near('…while the live names still deploy to target', po.spent, 500, 1);
ok('governor windows: min-hold and re-entry are both 14d', MIN_HOLD_DAYS === 14 && REENTRY_COOLDOWN_DAYS === 14);


// ---- BOOK-LEVEL DRAWDOWN BREAKER (v121) -------------------------------------
{
  const dq = { SPY: 747, NVDA: 209, GOOGL: 360, VTI: 380 };
  const dt = { asOf: '2026-07-23', driftTriggerPp: 5, names: [
    { ticker: 'SPY',   weightPct: 40, entry: '740-750', stop: 690 },
    { ticker: 'NVDA',  weightPct: 35, entry: '205-215', stop: 190 },
    { ticker: 'GOOGL', weightPct: 25, entry: '352-368', stop: 320 },
  ]};
  const mk = (level, extra = {}) => planDeployment({
    target: dt, positions: extra.positions || [], cash: extra.cash ?? 3000, quotes: dq,
    parked: extra.parked || null,
    drawdown: level ? { level, dd: level === 'hard' ? -0.14 : -0.09, peakT: '2026-06-01', note: 'test' } : null,
    opts: { asOf: '2026-07-23', ...(extra.opts || {}) },
  });

  const okRun = mk(null);
  ok('no drawdown input ⇒ buys proceed exactly as before', okRun.buys.length > 0);
  ok('…and nothing is deferred for drawdown', !okRun.deferred.some((d) => d.reason === 'drawdown'));
  ok("level 'ok' behaves identically to no input", mk('ok').buys.length === okRun.buys.length);

  const soft = mk('soft');
  ok('soft tier: no new buys at all', soft.buys.length === 0);
  ok('soft tier: every target name is deferred with reason drawdown',
    ['SPY', 'NVDA', 'GOOGL'].every((t) => { const d = find(soft.deferred, t); return d && d.reason === 'drawdown'; }));
  ok('soft tier: the deferral explains itself with the book figure',
    find(soft.deferred, 'SPY').detail.includes('from its peak'));
  ok('soft tier: the summary leads with the breaker', /DRAWDOWN SOFT/.test(soft.summary));

  // THE POINT of keeping deferred money in cash: the park vehicle is 100% equity beta, so routing
  // "the market is falling" dollars into it defeats the purpose. (Owner kept VTI over SGOV, which is
  // exactly why this rule is load-bearing rather than cosmetic.)
  ok('soft tier: deferred cash is NOT parked', !soft.parking || !soft.parking.park);
  ok('soft tier: cash actually stays in cash', soft.cashLeft >= 2900);

  // INVARIANT: suspending parking must NOT make the planner treat an EXISTING waiting ground as an
  // off-target orphan. Flipping the whole parking flag would do exactly that — liquidating the
  // placeholder the moment a drawdown began, the infinite park→liquidate churn the exemption prevents.
  const withPark = mk('soft', {
    positions: [{ symbol: 'VTI', qty: 2, avgCost: 375 }],
    parked: { vehicle: 'VTI', dollars: 760, forNames: ['NVDA'] },
  });
  ok('soft tier: an existing waiting ground is NOT exited as an orphan', !find(withPark.exits, 'VTI'));
  ok('soft tier: …and is not trimmed either', !find(withPark.trims, 'VTI'));

  // The idle-cash deadline must not force money in while the breaker is tripped.
  const idleOk = mk(null, { opts: { cashIdleDays: 30 } });
  const idleSoft = mk('soft', { opts: { cashIdleDays: 30 } });
  ok('the idle-cash deadline forces deployment when the book is healthy', idleOk.buys.length > 0);
  ok('…but is paused by the breaker', idleSoft.buys.length === 0);

  // Sells are never blocked by the breaker — de-risking must always be possible.
  const softExit = planDeployment({
    target: dt, quotes: { ...dq, ORCL: 100 }, cash: 0,
    positions: [{ symbol: 'ORCL', qty: 20, avgCost: 90 }],
    drawdown: { level: 'soft', dd: -0.09, peakT: '2026-06-01' },
    opts: { asOf: '2026-07-23' },
  });
  ok('soft tier: an off-target exit still happens (de-risking is never blocked)', !!find(softExit.exits, 'ORCL'));
}
{
  // HARD TIER — raise defensive cash, losses first, through the existing guards.
  const dq = { AAA: 100, BBB: 100, CCC: 100 };
  const hard = planDeployment({
    target: { asOf: '2026-07-23', driftTriggerPp: 5, names: [
      { ticker: 'AAA', weightPct: 34, entry: '90-110', stop: 50 },
      { ticker: 'BBB', weightPct: 33, entry: '90-110', stop: 50 },
      { ticker: 'CCC', weightPct: 33, entry: '90-110', stop: 50 },
    ]},
    // Losses deliberately SHALLOWER than the TLH floor (max($75, 5% of cost)) so this exercises the
    // drawdown raise itself. A deeper loser is harvested by the existing TLH path first, which already
    // raises cash — worth knowing: the two paths compose rather than double-selling.
    positions: [
      { symbol: 'AAA', qty: 30, avgCost: 90 },    // +11% winner
      { symbol: 'BBB', qty: 30, avgCost: 103 },   // −2.9%  ← least-bad first: sold first
      { symbol: 'CCC', qty: 30, avgCost: 102 },   // −2.0%
    ],
    cash: 0, quotes: dq,
    drawdown: { level: 'hard', dd: -0.14, peakT: '2026-06-01', note: 'test' },
    opts: { asOf: '2026-07-23' },
  });
  ok('hard tier: defensive cash is raised', hard.ddRaises.length > 0);
  ok('hard tier: the most-underwater name is sold first', hard.ddRaises[0].sym === 'BBB');
  ok('hard tier: raises appear in the combined sells list', hard.sells.some((x) => x.kind === 'drawdown-raise'));
  ok('hard tier: raises count toward turnover', hard.turnover > 0);
  ok('hard tier: the tax summary sees the realized loss', hard.taxSummary.realizedLoss < 0);
  ok('hard tier: it does not sell more than the floor needs', hard.ddRaises.reduce((a, x) => a + x.dollars, 0) <= 9000 * 0.20 + 1);
  ok('hard tier: still no new buys', hard.buys.length === 0);
  const raised = hard.ddRaises.reduce((a, x) => a + x.dollars, 0);
  near('hard tier: raises roughly reach the 20% cash floor', raised, 9000 * 0.20, 60);
  ok('hard tier: the summary announces it', /DRAWDOWN HARD/.test(hard.summary));

  // The breaker does NOT override the churn/PDT guards — a name bought today can't be sold today.
  const pdt = planDeployment({
    target: { asOf: '2026-07-23', names: [{ ticker: 'BBB', weightPct: 100, entry: '90-110', stop: 50 }] },
    positions: [{ symbol: 'BBB', qty: 30, avgCost: 103 }],
    cash: 0, quotes: { BBB: 100 },
    accountActivity: { BBB: { lastBuyDate: '2026-07-23' } },
    drawdown: { level: 'hard', dd: -0.14, peakT: '2026-06-01' },
    opts: { asOf: '2026-07-23' },
  });
  ok('hard tier: the PDT day-trade guard still binds', !pdt.ddRaises.some((x) => x.sym === 'BBB'));
  ok('…and the block is reported rather than silently dropped',
    pdt.blockedSells.some((b) => b.sym === 'BBB' && b.blocked === 'day-trade'));
  ok('…with a warning that the floor was not reached',
    pdt.warnings.some((w) => /cash floor/.test(w)));
}

// ---- REGIME-AWARE PACING (v121) ---------------------------------------------
{
  const rq = { SPY: 747, NVDA: 209 };
  const rt = { asOf: '2026-07-23', driftTriggerPp: 5, names: [
    { ticker: 'SPY',  weightPct: 50, entry: '740-750', stop: 690 },
    { ticker: 'NVDA', weightPct: 50, entry: '205-215', stop: 190 },
  ]};
  const mk = (vix, extra = {}) => planDeployment({
    target: extra.target || rt, positions: [], cash: 3000, quotes: rq, vix,
    opts: { asOf: '2026-07-23', ...(extra.opts || {}) },
  });

  eqr('missing VIX ⇒ calm (fails open to current behaviour)', marketRegime(null), 'calm');
  eqr('unparseable VIX ⇒ calm', marketRegime({ v: 'n/a' }), 'calm');
  eqr('VIX 14 ⇒ calm', marketRegime({ v: 14 }), 'calm');
  eqr('VIX 22 ⇒ elevated (boundary)', marketRegime({ v: 22 }), 'elevated');
  eqr('VIX 27 ⇒ elevated', marketRegime({ v: 27 }), 'elevated');
  eqr('VIX 30 ⇒ stressed (boundary)', marketRegime({ v: 30 }), 'stressed');
  eqr('VIX 41 ⇒ stressed', marketRegime({ v: 41 }), 'stressed');
  eqr('a bare number works too', marketRegime(33), 'stressed');

  // The deadline stretches; the tranche shrinks only when stressed.
  near('calm keeps the 10d deadline', mk({ v: 14 }).regime.idleDeadlineDays, 10, 0.01);
  near('elevated stretches it to 15d', mk({ v: 25 }).regime.idleDeadlineDays, 15, 0.01);
  near('stressed stretches it to 20d', mk({ v: 33 }).regime.idleDeadlineDays, 20, 0.01);
  near('calm keeps the full tranche', mk({ v: 14 }).regime.tranchePct, 34, 0.01);
  near('stressed halves the tranche', mk({ v: 33 }).regime.tranchePct, 17, 0.01);

  // 12 idle days: past the calm deadline, inside the stressed one.
  const calmForced = mk({ v: 14 }, { opts: { cashIdleDays: 12 } });
  const stressForced = mk({ v: 33 }, { opts: { cashIdleDays: 12 } });
  ok('calm: 12 idle days forces the backlog in', calmForced.buys.length > 0);
  ok('stressed: the same 12 days does NOT yet force it', stressForced.regime.idleDeadlineDays > 12);
  // …but a long enough wait still deploys — pacing stretches the deadline, it never removes it.
  const stressEventually = mk({ v: 33 }, { opts: { cashIdleDays: 25 } });
  ok('stressed still deploys once its stretched deadline passes', stressEventually.buys.length > 0);

  // Regime NEVER changes WHICH names are bought in a normal (non-stale) target.
  const calmBuys = mk({ v: 14 }).buys.map((b) => b.sym).sort().join(',');
  const stressBuys = mk({ v: 33 }).buys.map((b) => b.sym).sort().join(',');
  eqr('regime does not change the buy SET on a fresh target', stressBuys, calmBuys);

  // …but a STRESSED tape plus ADVISORY (stale) bands defers: buying unbanded into a stressed tape is
  // the worst of both. A stale target in a CALM tape still buys (the v102 lesson: stale zones must not
  // defer the whole book).
  const staleT = { ...rt, asOf: '2026-06-01' };   // >7d old ⇒ zones advisory
  const staleCalm = mk({ v: 14 }, { target: staleT });
  const staleStress = mk({ v: 33 }, { target: staleT });
  ok('stale zones in a calm tape still deploy', staleCalm.buys.length > 0);
  ok('stale zones in a stressed tape defer', staleStress.buys.length === 0);
  ok('…with reason regime', staleStress.deferred.every((d) => d.reason === 'regime'));
  ok('…explaining both halves', /stressed/.test(find(staleStress.deferred, 'SPY').detail) && /advisory/.test(find(staleStress.deferred, 'SPY').detail));

  // Regime never blocks a sell.
  const sellStress = planDeployment({
    target: staleT, quotes: { ...rq, ORCL: 100 }, cash: 0,
    positions: [{ symbol: 'ORCL', qty: 20, avgCost: 90 }], vix: { v: 40 },
    opts: { asOf: '2026-07-23' },
  });
  ok('a stressed tape never blocks an off-target exit', !!find(sellStress.exits, 'ORCL'));
}

console.log(`\nagentic-deploy.test: ${pass} passed, ${fail} failed  (blackout=${EARNINGS_BLACKOUT_DAYS}d)`);
process.exit(fail ? 1 : 0);
