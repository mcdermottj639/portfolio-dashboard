// Offline unit checks for riskweights.mjs — no network, no I/O. Run: node producer/riskweights.test.mjs
import { riskAdjustWeights, clusterOf, volScaledCap, volProxy, CLUSTER_CAPS, BASE_SINGLE_CAP, clusterExposure } from './riskweights.mjs';

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
  ok('an index-borne breach is reported, not silently trimmed',
    r.notes.some((n) => /entirely via index look-through/.test(n)));
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
    r.exposure['banks'].total <= CLUSTER_CAPS['banks'] + 0.6);
  ok('any genuinely un-placeable remainder is disclosed, never silently absorbed',
    r.exposure['megacap-tech'].total <= CLUSTER_CAPS['megacap-tech'] + 0.6
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
    e.total <= CLUSTER_CAPS['megacap-tech'] + 1.5 || r.notes.some((n) => /^RESIDUAL:/.test(n)));
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
near('megacap-tech TOTAL exposure respects the ~48% cap', techExp.total, CLUSTER_CAPS['megacap-tech'], 1.5);
ok('direct megacap sits below the cap because the index core eats into it',
  techSum < CLUSTER_CAPS['megacap-tech'] - 3);
ok('the index sleeve is what accounts for the difference', techExp.lookThrough > 3);
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

console.log(`\nriskweights.test: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
