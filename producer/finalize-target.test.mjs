// Offline unit checks for finalize-target.mjs — no network. Run: node producer/finalize-target.test.mjs
import { finalizeTarget, DRIVER_THRESHOLD, entryDiscountFor, tightenEntryByQuality, AG_ENTRY_Q_OK, AG_ENTRY_Q_MAX } from './finalize-target.mjs';

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
// A ranked entry for a name that didn't make the allocation is simply unused. (diversifierMin:0 keeps
// this about ranked rows — the gold sleeve is injected by default and would otherwise change the count.)
const extra = finalizeTarget(ALLOC, { ...base, diversifierMin: 0, ranked: [...RANKED, { t: 'ZZZZ', m: 10, q: 10, g: 10, c: 10, v: 10 }] });
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

// ---- dropped records survive a same-day re-run (2026-08-25) -----------------
// The bug: drops are detected ONLY by diffing against `prior.names`, and the CLI reads the COMMITTED
// target as prior — so re-running finalize against its own output finds nothing missing and writes
// `dropped: []`. Three runs landed on 2026-08-25 (research refresh → entry bands → gold sleeve) and the
// JPM/GE records from the first were erased by the second. Benign for a phase-out, NOT benign for
// 'business-broken', which is the single reason that unlocks the deploy planner's 14-day min-hold.
{
  const rerunPrior = { ...churn.target };                       // exactly what run #1 committed
  const stillHeld = ['GE', 'UNH', 'AAPL', 'V', 'SPY', 'NVDA', 'JPM'];
  const rerun = finalizeTarget(ALLOC, { ...base, prior: rerunPrior, held: stillHeld });
  const r = (t) => (rerun.target.dropped.find((d) => d.ticker === t) || {});
  ok('re-run carries the business-broken record forward', r('AAPL').reason === 'business-broken');
  ok('re-run carries the phase-out-complete record forward', r('UNH').reason === 'phase-out-complete');
  ok('carried records are marked as such', r('AAPL').carried === true && !!r('AAPL').since);
  ok('the carried record keeps its ORIGINAL date, not the re-run date', r('AAPL').since === '2026-08-04');
  ok('a carried record is not duplicated', rerun.target.dropped.filter((d) => d.ticker === 'AAPL').length === 1);
  // The record's job ends when the position does — otherwise a spent 'business-broken' entry would keep
  // the min-hold unlocked for a name the account no longer owns.
  const exited = finalizeTarget(ALLOC, { ...base, prior: rerunPrior, held: stillHeld.filter((s) => s !== 'AAPL') });
  ok('a record for an already-exited name is dropped', !exited.target.dropped.some((d) => d.ticker === 'AAPL'));
  // A name the research re-includes is no longer dropped, carried record or not.
  const readmit = finalizeTarget({ picks: [...ALLOC.picks, { ticker: 'AAPL', sector: 'Electronic Technology', weightPct: 8, entryZone: '300-312', stop: 284, target: 340, thesis: 're-included' }] },
    { ...base, prior: rerunPrior, held: stillHeld });
  ok('a re-included name loses its carried drop record', !readmit.target.dropped.some((d) => d.ticker === 'AAPL'));
  // Freshly-detected beats carried: run #1's own detection must still win on a conflict.
  ok('a freshly-detected drop is not shadowed by a carried one',
    churn.target.dropped.filter((d) => d.ticker === 'AAPL').length === 1 && !churn.target.dropped.find((d) => d.ticker === 'AAPL').carried);
  // Retention backstop: without `held` there is no natural terminator, so an aged record must expire.
  const aged = finalizeTarget(ALLOC, { ...base, asOf: '2027-01-01', prior: rerunPrior });
  ok('a record past the retention window expires', !aged.target.dropped.some((d) => d.ticker === 'AAPL'));
}

// --- v124: the defensive floor reaches the committed target -----------------------------------------
{
  // A megacap-only allocation, i.e. the shape every recent live target has had.
  const noDef = finalizeTarget({ picks: [
    { ticker: 'SPY', sector: 'Miscellaneous', weightPct: 20, entryZone: '740-760', stop: 690, target: 830, thesis: 'ballast' },
    { ticker: 'NVDA', sector: 'Electronic Technology', weightPct: 25, entryZone: '208-216', stop: 190, target: 258, thesis: 'ai' },
    { ticker: 'MSFT', sector: 'Technology Services', weightPct: 25, entryZone: '450-465', stop: 410, target: 560, thesis: 'azure' },
    { ticker: 'JPM', sector: 'Finance', weightPct: 30, entryZone: '350-366', stop: 331, target: 400, thesis: 'bank' },
  ] }, { book: 10000, universe: [
    { t: 'SPY', px: 747, hi: 760, lo: 600 }, { t: 'NVDA', px: 209, hi: 236, lo: 164 },
    { t: 'MSFT', px: 388, hi: 555, lo: 349 }, { t: 'JPM', px: 348, hi: 351, lo: 279 },
  ] });
  ok('the committed target carries a defensive block', noDef.target.defensive
    && typeof noDef.target.defensive.total === 'number' && noDef.target.defensive.floor === 15);
  ok('a megacap-only book is reported SHORT of the floor, not quietly passed',
    noDef.target.defensive.shortfall > 5);
  ok('…and the shortfall reaches the method line the runbook prints',
    /DEFENSIVE SHORTFALL/.test(noDef.target.method));
}
{
  // Same book, but the research actually included ballast — the floor is satisfied and says nothing.
  const withDef = finalizeTarget({ picks: [
    { ticker: 'SPY', sector: 'Miscellaneous', weightPct: 20, entryZone: '740-760', stop: 690, target: 830, thesis: 'ballast' },
    { ticker: 'NVDA', sector: 'Electronic Technology', weightPct: 22, entryZone: '208-216', stop: 190, target: 258, thesis: 'ai' },
    { ticker: 'MSFT', sector: 'Technology Services', weightPct: 20, entryZone: '450-465', stop: 410, target: 560, thesis: 'azure' },
    { ticker: 'JPM', sector: 'Finance', weightPct: 18, entryZone: '350-366', stop: 331, target: 400, thesis: 'bank' },
    { ticker: 'KO', sector: 'Consumer Non-Durables', weightPct: 10, entryZone: '68-72', stop: 62, target: 82, thesis: 'staple' },
    { ticker: 'NEE', sector: 'Utilities', weightPct: 10, entryZone: '74-78', stop: 66, target: 90, thesis: 'utility' },
  ] }, { book: 10000, universe: [
    { t: 'SPY', px: 747, hi: 760, lo: 600 }, { t: 'NVDA', px: 209, hi: 236, lo: 164 },
    { t: 'MSFT', px: 388, hi: 555, lo: 349 }, { t: 'JPM', px: 348, hi: 351, lo: 279 },
    { t: 'KO', px: 70, hi: 74, lo: 60 }, { t: 'NEE', px: 75, hi: 86, lo: 61 },
  ] });
  ok('a book that carries real ballast clears the floor', withDef.target.defensive.shortfall === 0);
  ok('…and no shortfall is reported on the method line', !/DEFENSIVE SHORTFALL/.test(withDef.target.method));
  ok('…with the defensive names still in the committed target',
    withDef.target.names.some((n) => n.ticker === 'KO') && withDef.target.names.some((n) => n.ticker === 'NEE'));
  ok('weights still normalize to ~100', Math.abs(withDef.target.names.reduce((a, n) => a + n.weightPct, 0) - 100) < 1);
}
{
  // The dial is overridable, and 0 restores exactly the pre-v124 behaviour.
  const off = finalizeTarget({ picks: [
    { ticker: 'NVDA', sector: 'Electronic Technology', weightPct: 60, entryZone: '208-216', stop: 190, target: 258, thesis: 'ai' },
    { ticker: 'SPY', sector: 'Miscellaneous', weightPct: 40, entryZone: '740-760', stop: 690, target: 830, thesis: 'ballast' },
  ] }, { book: 10000, defensiveMin: 0 });
  ok('defensiveMin:0 disables the floor', off.target.defensive.shortfall === 0
    && !/DEFENSIVE SHORTFALL/.test(off.target.method));
}

// --- REGRESSION (2026-08-25): the vol gate must actually BIND on the whole-workflow-return path -------
// finalize-target's CLI feeds `raw.ranking` in as its universe. That array carries px/hi/lo ONLY because
// the workflow's return projection was widened to include them; when it did not, `volProxy` fell back to
// the neutral REF_RANGE, every defensive-cluster name passed the width test regardless of how it traded,
// and LLY (52wk range/price 0.48) counted as ballast — satisfying the 15% floor with precisely the kind
// of high-vol position the floor exists to offset. Live run of 2026-08-25 reported 21.0% direct
// defensive when the honest figure was 14.5%.
{
  const picks = [
    { ticker: 'LLY', sector: 'Health Technology', weightPct: 40, thesis: 'x', entryZone: '', stop: 1, target: 2 },
    { ticker: 'MSFT', sector: 'Technology Services', weightPct: 60, thesis: 'x', entryZone: '', stop: 1, target: 2 },
  ];
  // LLY: (1292.65 - 694.23) / 1246.93 = 0.48 — wider than the ~0.42 gate.
  const universe = [
    { t: 'LLY', px: 1246.93, hi: 1292.65, lo: 694.23 },
    { t: 'MSFT', px: 487.31, hi: 553.72, lo: 349.20 },
  ];
  const withVol = finalizeTarget({ picks }, { universe, book: 10000 });
  ok('a wide-range pharma name does NOT count as defensive when px/hi/lo are supplied',
    withVol.defensive.direct < 1);
  ok('…so the floor reports a real shortfall rather than a satisfied one',
    withVol.defensive.shortfall > 5);

  // The bug: same allocation, no universe ⇒ neutral vol fallback ⇒ LLY sails through the gate.
  const noVol = finalizeTarget({ picks }, { book: 10000 });
  ok('…and without px/hi/lo the gate cannot bind (documents the failure mode)',
    noVol.defensive.direct > withVol.defensive.direct);
}

// --- ENTRY-QUALITY → ENTRY BAND (2026-08-25) ---------------------------------------------------------
// entryQuality shrank the WEIGHT but never moved the entry ZONE, and the v102 prompt tells the model to
// set reachable zones — so it brackets spot and a 3/10 entry executed at market exactly like a 9/10 one.
{
  ok('a fair-or-better entry demands no discount', entryDiscountFor(6) === 0 && entryDiscountFor(9) === 0);
  ok('a poor entry demands a real one', entryDiscountFor(3) > 0.04 && entryDiscountFor(3) < 0.05);
  ok('the demand is CAPPED so the zone stays reachable (v102: a deep zone reads as never-buy)',
    entryDiscountFor(0) === AG_ENTRY_Q_MAX);
  ok('a missing/garbage verdict changes nothing', entryDiscountFor(null) === 0 && entryDiscountFor(undefined) === 0);

  const t = tightenEntryByQuality({ ticker: 'MA', px: 600, entry: '$565-$604' }, 3);
  ok('the ceiling lands below spot', t.entryTightened.to < 600);
  ok('…by exactly the demanded discount', Math.abs(t.entryTightened.to - 600 * (1 - entryDiscountFor(3))) < 0.02);
  ok('…and the rewritten zone still parses first-two-numbers as lo,hi (agentic-deploy contract)', (() => {
    const m = String(t.entry).replace(/,/g, '').match(/\d+(\.\d+)?/g);
    return +m[0] < +m[1] && Math.abs(+m[1] - t.entryTightened.to) < 0.02;
  })());
  ok('…keeping the model\'s band width', Math.abs((t.entryTightened.to - +String(t.entry).match(/\d+(\.\d+)?/g)[0]) - 39) < 0.5);

  const already = tightenEntryByQuality({ ticker: 'X', px: 600, entry: '$500-$520' }, 3);
  ok('a zone the model already set tighter is left alone (never loosens)', already.entryTightened === undefined);

  const def = tightenEntryByQuality({ ticker: 'KO', px: 92, entry: '$85-$93' }, 2, { exempt: true });
  ok('a defensive-floor name is exempt even on a terrible entry', def.entryTightened === undefined);

  const noPx = tightenEntryByQuality({ ticker: 'Y', entry: '$10-$12' }, 2);
  ok('no spot price ⇒ no change (never guess a band)', noPx.entryTightened === undefined);
}
{
  const picks = [
    { ticker: 'MA', sector: 'Finance', weightPct: 50, thesis: 'x', entryZone: '$565-$604', stop: 1, target: 2 },
    { ticker: 'KO', sector: 'Consumer Non-Durables', weightPct: 50, thesis: 'x', entryZone: '$85-$93', stop: 1, target: 2 },
  ];
  const universe = [{ t: 'MA', px: 600, hi: 601, lo: 464 }, { t: 'KO', px: 92, hi: 92.5, lo: 65 }];
  const verdicts = [
    { t: 'MA', businessOk: true, entryQuality: 3, rec: 'hold' },
    { t: 'KO', businessOk: true, entryQuality: 2, rec: 'hold' },
  ];
  const r = finalizeTarget({ picks }, { universe, verdicts, book: 10000 });
  const ma = r.target.names.find((n) => n.ticker === 'MA');
  const ko = r.target.names.find((n) => n.ticker === 'KO');
  ok('the non-defensive poor entry is tightened end-to-end', /entry-quality 3\/10/.test(ma.entry));
  ok('…and the defensive one carrying the floor is NOT', !/entry-quality/.test(ko.entry));
  ok('…with the tightening reported, not silent', r.entryBands.some((x) => x.startsWith('MA ')));
  ok('…and never reported for the exempt name', !r.entryBands.some((x) => x.startsWith('KO ')));
}

// --- GOLD SLEEVE INJECTED STRUCTURALLY (2026-08-25) --------------------------------------------------
// The research CANNOT select gold: quality/growth/catalyst are meaningless for a bullion trust, so it
// takes the "no data" 5.0 on three of five sleeves and tops out at a 5.72 composite against a ~6.8
// marginal finalist. A mandate dial places it, exactly as SPY is handed to the synthesis as ballast.
{
  const withGold = finalizeTarget(ALLOC, { ...base });
  const g = withGold.target.names.find((n) => n.ticker === 'GLDM');
  ok('a gold sleeve is injected when the allocation contains none', !!g);
  ok('…at a real weight, inside the mandate band', g.weightPct >= 4 && g.weightPct <= 10.5);
  ok('…tagged as a diversifier rather than an equity sector', g.sector === 'Diversifier');
  ok('…and labelled a mandate sleeve, not a research pick', /mandate sleeve/.test(g.thesis));
  ok('the read is emitted for the card and the run log',
    withGold.target.diversifier && withGold.target.diversifier.floor > 0);

  const off = finalizeTarget(ALLOC, { ...base, diversifierMin: 0 });
  ok('diversifierMin:0 disables the injection entirely',
    !off.target.names.some((n) => n.ticker === 'GLDM'));

  // Never overrides a gold vehicle the allocation already carries (a different one, or a chosen weight).
  const own = finalizeTarget({ picks: [...ALLOC.picks, { ticker: 'IAU', sector: 'Diversifier', weightPct: 8,
    thesis: 'owner-chosen', entryZone: '$80-$90', stop: 70, target: 110 }] }, { ...base });
  ok('an allocation that already holds gold is not given a second vehicle',
    !own.target.names.some((n) => n.ticker === 'GLDM'));
  ok('…and the one it chose survives', own.target.names.some((n) => n.ticker === 'IAU'));
}

console.log(`\nfinalize-target.test: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
