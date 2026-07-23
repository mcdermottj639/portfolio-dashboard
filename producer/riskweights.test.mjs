// Offline unit checks for riskweights.mjs — no network, no I/O. Run: node producer/riskweights.test.mjs
import { riskAdjustWeights, clusterOf, volScaledCap, volProxy, CLUSTER_CAPS, BASE_SINGLE_CAP } from './riskweights.mjs';

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
const techSum = heavy.clusters['megacap-tech'];
near('megacap-tech trimmed to its ~48% cap', techSum, CLUSTER_CAPS['megacap-tech'], 1.5);
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
