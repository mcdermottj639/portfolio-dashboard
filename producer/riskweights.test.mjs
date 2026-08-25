// Offline unit checks for riskweights.mjs — no network, no I/O. Run: node producer/riskweights.test.mjs
import { riskAdjustWeights, clusterOf, volScaledCap, volProxy, CLUSTER_CAPS, BASE_SINGLE_CAP, clusterExposure,
  isDefensive, defensiveExposure, AG_DEFENSIVE_MIN, DEFENSIVE_MAX_VOL,
  isDiversifier, diversifierExposure, AG_DIVERSIFIER_MIN, AG_DIVERSIFIER_MAX, LOOKTHROUGH_ENFORCE } from './riskweights.mjs';

let pass = 0, fail = 0;
const ok = (label, cond) => { if (cond) pass++; else { fail++; console.error(`✗ ${label}`); } };
const near = (label, got, want, tol = 0.5) => { if (Math.abs(got - want) <= tol) pass++; else { fail++; console.error(`✗ ${label}\n    got ${got} want ~${want}`); } };
const sum = (arr) => arr.reduce((s, n) => s + n.weightPct, 0);
const w = (t) => (names, sym) => (names.find((n) => n.ticker === sym) || {}).weightPct;

// --- clusterOf ---
ok('NVDA/GOOGL/AMZN all in megacap-tech', clusterOf('NVDA') === 'megacap-tech' && clusterOf('GOOGL') === 'megacap-tech' && clusterOf('AMZN') === 'megacap-tech');
ok('V+MA payments', clusterOf('V') === 'payments' && clusterOf('MA') === 'payments');
ok('SPY is index', clusterOf('SPY') === 'index');
ok('unknown ticker → singleton', clusterOf('ZZZZ') === 'single:ZZZZ');

// --- vol-scaled cap: wilder name (wide 52wk range) gets a smaller cap than a tight one ---
const tight = volScaledCap({ ticker: 'MSFT', px: 388, hi: 420, lo: 350 });   // narrow range
const wild  = volScaledCap({ ticker: 'NFLX', px: 68, hi: 127, lo: 65 });     // very wide range
ok('wilder name gets a smaller single-name cap', wild < tight);
ok('caps never exceed BASE_SINGLE_CAP', tight <= BASE_SINGLE_CAP + 1e-6 && wild <= BASE_SINGLE_CAP + 1e-6);
ok('explicit vol overrides the range proxy', volProxy({ px: 100, hi: 200, lo: 50, vol: 0.2 }) === 0.2);

// --- look-through concentration (v121) --------------------------------------
// clusterExposure is the shared view: an index vehicle contributes to its own 'index' bucket directly AND
// spreads its composition into the real clusters.
{
  const e = clusterExposure([{ ticker: 'SPY', weightPct: 100 }]);
  near('100% SPY reads as ~37.5% megacap-tech look-through', e['megacap-tech'].lookThrough, 37.5, 0.1);
  ok('…with no DIRECT megacap exposure', e['megacap-tech'].direct === 0);
  near('…and the SPY weight itself sits in the index bucket', e['index'].direct, 100, 0.01);
}
{
  // The exact shape of the live 2026-08-18 target: 44.8% direct megacap + 20% SPY + 5% VTI.
  const e = clusterExposure([
    { ticker: 'NVDA', weightPct: 11.2 }, { ticker: 'GOOGL', weightPct: 11.2 },
    { ticker: 'MSFT', weightPct: 11.2 }, { ticker: 'AMZN', weightPct: 11.2 },
    { ticker: 'SPY', weightPct: 20 }, { ticker: 'VTI', weightPct: 5 },
  ]);
  near('direct megacap reads 44.8%', e['megacap-tech'].direct, 44.8, 0.01);
  near('…but TRUE exposure is ~53.9% once SPY+VTI are seen through', e['megacap-tech'].total, 53.9, 0.2);
  ok('which is over the 48% cap the old direct-only math reported as compliant',
    e['megacap-tech'].total > CLUSTER_CAPS['megacap-tech']);
}
{
  // An unlisted vehicle contributes zero look-through — old direct-only behaviour for that vehicle.
  const e = clusterExposure([{ ticker: 'IWM', weightPct: 50 }]);
  ok('an unlisted index vehicle contributes no look-through', !e['megacap-tech']);
}
// Worth recording: with REAL compositions an index sleeve alone can never breach the 48% megacap cap
// (100% QQQ is only ~42.4%, 100% SPY ~37.5%), so the index-borne branch is defensive code. Exercise it
// through an explicitly tightened cap.
{
  const r = riskAdjustWeights([
    { ticker: 'QQQ', weightPct: 90, px: 600, hi: 620, lo: 480 },
    { ticker: 'JPM', weightPct: 10, px: 348, hi: 351, lo: 279 },
  ], { clusterCaps: { 'megacap-tech': 20 } });
  // With LOOKTHROUGH_ENFORCE off (owner decision 2026-08-25) an index-borne "breach" is not a breach at
  // all — the caps bind on direct weight. What must survive is the REPORTING: the true total is still
  // computed and disclosed, so turning enforcement off never turns measurement off.
  ok('an index-borne concentration is still reported even though it no longer binds',
    r.notes.some((n) => /inside index vehicles|entirely via index look-through/.test(n)));
  ok('…and the look-through total is still computed', r.exposure['megacap-tech'].lookThrough > 30);
  const q = r.names.find((n) => n.ticker === 'QQQ');
  ok('and the index vehicle survives it', q && q.weightPct > 80);
}
{
  const r = riskAdjustWeights([{ ticker: 'QQQ', weightPct: 100, px: 600, hi: 620, lo: 480 }]);
  ok('100% QQQ is under the real 48% megacap cap (~42%)',
    r.exposure['megacap-tech'].total < CLUSTER_CAPS['megacap-tech']);
}
// REGRESSION: the final normalization must not re-inflate names the caps just trimmed. On this fixture
// JPM was capped to 22% and came back out at 24.2% before the fix.
{
  const r = riskAdjustWeights([
    { ticker: 'NVDA', weightPct: 25, px: 209, hi: 236, lo: 164 },
    { ticker: 'MSFT', weightPct: 25, px: 388, hi: 555, lo: 349 },
    { ticker: 'GOOGL', weightPct: 20, px: 324, hi: 408, lo: 188 },
    { ticker: 'SPY',  weightPct: 20, px: 747, hi: 760, lo: 600 },
    { ticker: 'JPM',  weightPct: 10, px: 348, hi: 351, lo: 279 },
  ]);
  ok('normalization does not push a capped cluster back over its cap',
    r.exposure['banks'].direct <= CLUSTER_CAPS['banks'] + 0.6);
  ok('any genuinely un-placeable remainder is disclosed, never silently absorbed',
    r.exposure['megacap-tech'].direct <= CLUSTER_CAPS['megacap-tech'] + 0.6
    || r.notes.some((n) => /^RESIDUAL:|no cap headroom/.test(n)));
  near('and the book still sums to 100%', r.names.reduce((a, n) => a + n.weightPct, 0), 100, 0.05);
}
// Freed weight must NOT be dumped back into the index — that re-breaches the cap it just enforced.
{
  const r = riskAdjustWeights([
    { ticker: 'NVDA', weightPct: 25, px: 209, hi: 236, lo: 164 },
    { ticker: 'MSFT', weightPct: 25, px: 388, hi: 555, lo: 349 },
    { ticker: 'GOOGL', weightPct: 20, px: 324, hi: 408, lo: 188 },
    { ticker: 'SPY',  weightPct: 20, px: 747, hi: 760, lo: 600 },
    { ticker: 'JPM',  weightPct: 10, px: 348, hi: 351, lo: 279 },
  ]);
  const e = r.exposure['megacap-tech'];
  ok('freed weight is not dumped back into the index to re-breach the cap',
    e.direct <= CLUSTER_CAPS['megacap-tech'] + 1.5 || r.notes.some((n) => /^RESIDUAL:/.test(n)));
  near('weights still normalize to 100%', r.names.reduce((a, n) => a + n.weightPct, 0), 100, 0.5);
}

// --- cluster cap: an over-concentrated megacap-tech book gets trimmed to the cap, weight preserved ---
const heavy = riskAdjustWeights([
  { ticker: 'NVDA',  weightPct: 20, px: 209, hi: 236, lo: 164 },
  { ticker: 'GOOGL', weightPct: 18, px: 324, hi: 408, lo: 188 },
  { ticker: 'MSFT',  weightPct: 15, px: 388, hi: 555, lo: 349 },
  { ticker: 'AMZN',  weightPct: 12, px: 238, hi: 278, lo: 196 }, // 65% megacap-tech before caps
  { ticker: 'JPM',   weightPct: 12, px: 348, hi: 351, lo: 279 },
  { ticker: 'V',     weightPct: 8,  px: 352, hi: 365, lo: 293 },
  { ticker: 'SPY',   weightPct: 15, px: 747, hi: 760, lo: 600 },
]);
// The cap is enforced on TOTAL exposure (direct + look-through), so DIRECT lands BELOW 48 by exactly the
// amount the 15% SPY sleeve contributes (~0.375 × 15 ≈ 5.6pp). Before v121 this book reported 48% direct
// and ~54% real, which is the whole bug.
const techSum = heavy.clusters['megacap-tech'];
const techExp = heavy.exposure['megacap-tech'];
// 2026-08-25: caps bind on DIRECT weight — an index is a different KIND of holding from a single-name
// sector bet, so charging a broad-market diversifier against a sector cap penalises diversification.
// The look-through total is still computed and reported; only what BINDS changed.
near('megacap-tech DIRECT exposure respects the 48% cap', techExp.direct, CLUSTER_CAPS['megacap-tech'], 1.5);
ok('the look-through total is still measured and is higher than direct', techExp.total > techExp.direct);
ok('the index sleeve is what accounts for the difference', techExp.lookThrough > 3);
ok('…and the gap is disclosed rather than dropped',
  heavy.notes.some((n) => /inside index vehicles|look-through/.test(n)));
// The index vehicle itself is never trimmed to satisfy a cluster cap — it is the diversifier.
const spyOut = heavy.names.find((n) => n.ticker === 'SPY');
ok('SPY is not trimmed by the megacap cluster cap', spyOut && spyOut.weightPct >= 14);
near('weights still sum to 100 after risk-adjust', sum(heavy.names), 100, 0.6);
ok('a cluster-cap note was recorded', heavy.notes.some((n) => n.includes('megacap-tech')));
ok('SPY (index) absorbs spill and is never capped', (heavy.names.find((n) => n.ticker === 'SPY') || {}).weightPct >= 15);

// --- already-compliant allocation passes through ~unchanged (only normalized) ---
const clean = riskAdjustWeights([
  { ticker: 'SPY',  weightPct: 20, px: 747, hi: 760, lo: 600 },
  { ticker: 'NVDA', weightPct: 12, px: 209, hi: 236, lo: 164 },
  { ticker: 'JPM',  weightPct: 12, px: 348, hi: 351, lo: 279 },
  { ticker: 'LLY',  weightPct: 10, px: 1152, hi: 1249, lo: 624 },
  { ticker: 'XOM',  weightPct: 10, px: 157, hi: 176, lo: 105 },
  { ticker: 'PG',   weightPct: 10, px: 147, hi: 167, lo: 137 },
]);
near('compliant book normalizes to 100', sum(clean.names), 100, 0.6);
ok('no cluster in the compliant book exceeds its cap', Object.entries(clean.clusters).every(([c, v]) => CLUSTER_CAPS[c] == null || v <= CLUSTER_CAPS[c] + 1.0));

// --- extra fields (thesis/entry/stop) are preserved through the transform ---
const preserved = riskAdjustWeights([{ ticker: 'NVDA', weightPct: 50, px: 209, hi: 236, lo: 164, thesis: 'keepme', stop: 190 }, { ticker: 'SPY', weightPct: 50, px: 747, hi: 760, lo: 600 }]);
ok('non-weight fields survive', (preserved.names.find((n) => n.ticker === 'NVDA') || {}).thesis === 'keepme');

// --- v124: the singleton loophole -----------------------------------------------------------------
// A high-beta AI name absent from CLUSTERS used to be its own uncapped singleton, so it counted ZERO
// against the 48% megacap-tech cap while trading as another expression of the same bet.
ok('TSLA/PLTR/NOW/ANET/TSM now count against the megacap-tech cap',
  ['TSLA', 'PLTR', 'NOW', 'ANET', 'TSM', 'MU', 'CRWD'].every((t) => clusterOf(t) === 'megacap-tech'));
ok('defensive clusters exist at all', clusterOf('NEE') === 'utilities' && clusterOf('O') === 'reits'
  && clusterOf('VZ') === 'telecom' && clusterOf('KO') === 'staples' && clusterOf('SCHD') === 'low-vol');
{
  // The loophole, demonstrated: 30% megacap + 25% of AI names that were formerly singletons.
  const e = clusterExposure([
    { ticker: 'NVDA', weightPct: 15 }, { ticker: 'MSFT', weightPct: 15 },
    { ticker: 'PLTR', weightPct: 13 }, { ticker: 'TSLA', weightPct: 12 },
  ]);
  near('formerly-singleton AI names roll into one cluster', e['megacap-tech'].direct, 55, 0.01);
  ok('…which is now visibly over the cap', e['megacap-tech'].total > CLUSTER_CAPS['megacap-tech']);
}

// --- v124: defensive floor ------------------------------------------------------------------------
// The vol gate is what makes cluster membership honest. LLY is GICS healthcare, but a ~0.54 range/price
// is wider than the market — counting it as ballast would let the floor be met by the very kind of
// position it exists to offset.
ok('a tight staples name is defensive', isDefensive({ ticker: 'KO', px: 70, hi: 74, lo: 60 }));
ok('a wide-range pharma name is NOT defensive', !isDefensive({ ticker: 'LLY', px: 1152, hi: 1249, lo: 624 }));
ok('a megacap-tech name is never defensive', !isDefensive({ ticker: 'MSFT', px: 388, hi: 400, lo: 380 }));
ok('vol gate is anchored to the same reference range as the caps', DEFENSIVE_MAX_VOL === 0.42);
ok('bare ticker form works (no price data ⇒ membership decides)', isDefensive('PG') && !isDefensive('NVDA'));
{
  // Index sleeves carry defensive weight and must be seen through, exactly like the caps.
  const e = defensiveExposure([{ ticker: 'SPY', weightPct: 100 }]);
  ok('100% SPY reads as defensive only through look-through', e.direct === 0 && e.lookThrough > 5);
}
{
  // THE LIVE 2026-08-18 TARGET SHAPE. Nine names, zero qualifying defensives — the gap this floor closes.
  const r = riskAdjustWeights([
    { ticker: 'SPY', weightPct: 20, px: 747, hi: 760, lo: 600 },
    { ticker: 'AMZN', weightPct: 14, px: 238, hi: 278, lo: 196 },
    { ticker: 'MSFT', weightPct: 13, px: 388, hi: 555, lo: 349 },
    { ticker: 'NVDA', weightPct: 11, px: 209, hi: 236, lo: 164 },
    { ticker: 'GOOGL', weightPct: 10, px: 324, hi: 408, lo: 188 },
    { ticker: 'LLY', weightPct: 11, px: 1152, hi: 1249, lo: 624 },
    { ticker: 'V', weightPct: 11, px: 352, hi: 365, lo: 293 },
    { ticker: 'JPM', weightPct: 10, px: 348, hi: 351, lo: 279 },
  ]);
  ok('a book with no qualifying defensive name is flagged, never faked',
    r.defensive.shortfall > 5 && r.notes.some((n) => /NO qualifying defensive name/.test(n)));
  ok('…and no weight is fabricated to hide it', Math.abs(r.names.reduce((a, n) => a + n.weightPct, 0) - 100) < 0.6);
}
{
  // Top-up path: a real but undersized defensive sleeve is raised toward the floor, funded by the
  // non-defensive names, and the book still sums to 100.
  const r = riskAdjustWeights([
    { ticker: 'SPY', weightPct: 15, px: 747, hi: 760, lo: 600 },
    { ticker: 'NVDA', weightPct: 20, px: 209, hi: 236, lo: 164 },
    { ticker: 'MSFT', weightPct: 20, px: 388, hi: 555, lo: 349 },
    { ticker: 'JPM', weightPct: 20, px: 348, hi: 351, lo: 279 },
    { ticker: 'V', weightPct: 20, px: 352, hi: 365, lo: 293 },
    { ticker: 'KO', weightPct: 5, px: 70, hi: 74, lo: 60 },
  ]);
  ok('the defensive sleeve is topped up toward the floor',
    (r.names.find((n) => n.ticker === 'KO') || {}).weightPct > 5);
  ok('…to at least the floor', r.defensive.total >= AG_DEFENSIVE_MIN - 0.6);
  ok('…and a note records the move', r.notes.some((n) => /defensive floor: moved/.test(n)));
  near('…with the book still at 100%', r.names.reduce((a, n) => a + n.weightPct, 0), 100, 0.6);
  ok('…and no cluster pushed over its cap by the top-up',
    Object.entries(r.exposure).every(([c, e]) => CLUSTER_CAPS[c] == null || e.total <= CLUSTER_CAPS[c] + 0.6));
}
{
  // The top-up must respect the RECEIVING cluster's own cap, pooling the two staples names rather than
  // letting each see the whole headroom. The floor is set deliberately unreachable (staples caps at 25%),
  // so the correct behaviour is: fill to the cap, stop, and say so.
  const r = riskAdjustWeights([
    { ticker: 'SPY', weightPct: 20, px: 747, hi: 760, lo: 600 },
    { ticker: 'NVDA', weightPct: 30, px: 209, hi: 236, lo: 164 },
    { ticker: 'JPM', weightPct: 30, px: 348, hi: 351, lo: 279 },
    { ticker: 'KO', weightPct: 10, px: 70, hi: 74, lo: 60 },
    { ticker: 'PG', weightPct: 10, px: 147, hi: 167, lo: 137 },
  ], { defensiveMin: 60 });
  ok('an unreachable floor cannot breach the receiving cluster cap',
    r.exposure['staples'].direct <= CLUSTER_CAPS['staples'] + 0.6);
  ok('…but it does fill that cluster to its cap on the way',
    r.exposure['staples'].direct > 20);
  ok('…and the residual is disclosed rather than tolerated',
    r.notes.some((n) => /DEFENSIVE SHORTFALL/.test(n)));
}
{
  const off = riskAdjustWeights([
    { ticker: 'NVDA', weightPct: 60, px: 209, hi: 236, lo: 164 },
    { ticker: 'SPY', weightPct: 40, px: 747, hi: 760, lo: 600 },
  ], { defensiveMin: 0 });
  ok('defensiveMin:0 disables the floor entirely (no note, old behaviour)',
    !off.notes.some((n) => /DEFENSIVE/i.test(n)) && off.defensive.shortfall === 0);
}

// --- GOLD DIVERSIFIER SLEEVE (2026-08-25, owner mandate) ---------------------------------------------
// The book's first non-equity holding. It exists for correlation, not return: the defensive floor buys
// staples/pharma which still fall in a drawdown, and the drawdown breaker only acts after -8%.
{
  ok('the bullion vehicles are recognised', isDiversifier('GLDM') && isDiversifier('GLD') && isDiversifier('IAU'));
  ok('an equity is not one — and neither are the MINERS, which carry equity beta',
    !isDiversifier('NVDA') && !isDiversifier('GDX'));
  ok('gold carries no sector/cluster exposure at all', clusterOf('GLDM').startsWith('single:'));

  // NEVER FABRICATES — the same hard rule as the defensive floor.
  const noGold = riskAdjustWeights([
    { ticker: 'NVDA', weightPct: 50, px: 209, hi: 236, lo: 164 },
    { ticker: 'JNJ', weightPct: 30, px: 273, hi: 276, lo: 173 },
    { ticker: 'SPY', weightPct: 20, px: 747, hi: 760, lo: 600 },
  ]);
  ok('a book with no gold vehicle reports the shortfall instead of inventing a position',
    noGold.diversifier.direct === 0 && noGold.diversifier.shortfall === AG_DIVERSIFIER_MIN);
  ok('…and says so in the notes', noGold.notes.some((n) => /no gold vehicle/.test(n)));

  const thin = riskAdjustWeights([
    { ticker: 'NVDA', weightPct: 60, px: 209, hi: 236, lo: 164 },
    { ticker: 'JNJ', weightPct: 20, px: 273, hi: 276, lo: 173 },
    { ticker: 'SPY', weightPct: 19, px: 747, hi: 760, lo: 600 },
    { ticker: 'GLDM', weightPct: 1, px: 92, hi: 110, lo: 67 },
  ]);
  ok('an under-weight sleeve is topped up to the floor',
    thin.diversifier.direct >= AG_DIVERSIFIER_MIN - 0.5);

  // Bounded on BOTH sides: exempt from the punitive vol-scaled cap (gold's range/price ~0.47 would cap
  // the hedge exactly when volatility makes it useful), but never an overflow sink either.
  const fat = riskAdjustWeights([
    { ticker: 'GLDM', weightPct: 40, px: 92, hi: 110, lo: 67 },
    { ticker: 'JNJ', weightPct: 30, px: 273, hi: 276, lo: 173 },
    { ticker: 'SPY', weightPct: 30, px: 747, hi: 760, lo: 600 },
  ]);
  ok('gold is bounded by its own ceiling, not left unbounded',
    fat.names.find((n) => n.ticker === 'GLDM').weightPct <= AG_DIVERSIFIER_MAX + 0.5);
  ok('…and its ceiling is not the vol-scaled equity cap (which it would fail outright)',
    AG_DIVERSIFIER_MAX !== volScaledCap({ ticker: 'GLDM', px: 92, hi: 110, lo: 67 }));

  // The equity ballast must never be funded by selling the non-correlated sleeve.
  const raid = riskAdjustWeights([
    { ticker: 'NVDA', weightPct: 85, px: 209, hi: 236, lo: 164 },
    { ticker: 'GLDM', weightPct: 15, px: 92, hi: 110, lo: 67 },
  ], { defensiveMin: 15 });
  ok('the defensive floor never raids the gold sleeve to fund itself',
    raid.names.find((n) => n.ticker === 'GLDM').weightPct >= 9.5);

  const off = riskAdjustWeights([{ ticker: 'NVDA', weightPct: 100, px: 209, hi: 236, lo: 164 }],
    { diversifierMin: 0 });
  ok('diversifierMin:0 is a real off switch', off.diversifier.shortfall === 0);
}

console.log(`\nriskweights.test: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
