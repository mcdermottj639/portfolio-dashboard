// Tests for the one-time 2026-08-31 phantom-cumFlow migration.
// The load-bearing property is IDEMPOTENCE: this runs on every producer run from now until it is
// deleted, so a second application would subtract the phantom twice and invent the mirror-image
// error it exists to remove.
import assert from 'node:assert';
import { repairEquityHistory, repairPriorCumFlow, PHANTOM_FLOW_FIX } from './cumflow-repair.mjs';

let n = 0;
const t = (name, fn) => { fn(); n++; console.log(`  ok  ${name}`); };

const AG = PHANTOM_FLOW_FIX.agentic;
const MAIN = PHANTOM_FLOW_FIX.main;

// The real committed series, trimmed to the points that matter.
const agentic = () => ([
  { t: '2026-08-27', equity: 11604.98, cumFlow: 7950.75 },
  { t: '2026-08-28', equity: 11637.94, cumFlow: 7950.75 },
  { t: '2026-08-31', equity: 11543.60, cumFlow: 7961.68 },
  { t: '2026-09-01', equity: 11503.23, cumFlow: 7961.68 },
]);
const main = () => ([
  { t: '2026-08-27', equity: 18687.37, cumFlow: 0 },
  { t: '2026-08-28', equity: 17469.76, cumFlow: 0 },
  { t: '2026-08-31', equity: 18960.57, cumFlow: 136.70 },
  { t: '2026-09-01', equity: 18046.34, cumFlow: 136.70 },
]);

t('agentic: the phantom comes off the anchor and every later point', () => {
  const out = repairEquityHistory(agentic(), AG);
  assert.deepStrictEqual(out.map((p) => p.cumFlow), [7950.75, 7950.75, 7950.75, 7950.75]);
});

t('main: same, landing back at zero', () => {
  const out = repairEquityHistory(main(), MAIN);
  assert.deepStrictEqual(out.map((p) => p.cumFlow), [0, 0, 0, 0]);
});

t('points BEFORE the anchor are untouched', () => {
  const src = agentic();
  const out = repairEquityHistory(src, AG);
  assert.strictEqual(out[0].cumFlow, src[0].cumFlow);
  assert.strictEqual(out[1].cumFlow, src[1].cumFlow);
});

t('equity values are never modified — only cumFlow', () => {
  const out = repairEquityHistory(agentic(), AG);
  assert.deepStrictEqual(out.map((p) => p.equity), agentic().map((p) => p.equity));
});

t('IDEMPOTENT: a second pass is a no-op, by reference', () => {
  const once = repairEquityHistory(agentic(), AG);
  const twice = repairEquityHistory(once, AG);
  assert.strictEqual(twice, once, 'second pass must return the same array, not re-subtract');
  assert.deepStrictEqual(twice.map((p) => p.cumFlow), [7950.75, 7950.75, 7950.75, 7950.75]);
});

t('a series already at the corrected value is left alone', () => {
  const clean = agentic().map((p) => ({ ...p, cumFlow: 7950.75 }));
  assert.strictEqual(repairEquityHistory(clean, AG), clean);
});

t('a series that MOVED ON (a real later deposit) is left alone', () => {
  // A genuine transfer after the phantom shifts the anchor off its expected value. Firing here would
  // corrupt real data, so exact equality is required rather than a tolerance or a >= test.
  const moved = agentic().map((p) => (p.t >= '2026-08-31' ? { ...p, cumFlow: 9361.68 } : p));
  assert.strictEqual(repairEquityHistory(moved, AG), moved);
});

t('a later REAL deposit stacked on top still carries forward correctly', () => {
  const withDeposit = agentic().concat([{ t: '2026-09-02', equity: 12900, cumFlow: 8961.68 }]);
  const out = repairEquityHistory(withDeposit, AG);
  // The $1,000 deposit survives; only the $10.93 phantom is removed.
  assert.deepStrictEqual(out.map((p) => p.cumFlow), [7950.75, 7950.75, 7950.75, 7950.75, 8950.75]);
});

t('the corrected step produces a zero inferred flow', () => {
  const out = repairEquityHistory(agentic(), AG);
  const i = out.findIndex((p) => p.t === '2026-08-31');
  assert.strictEqual(+(out[i].cumFlow - out[i - 1].cumFlow).toFixed(2), 0);
});

t('missing / malformed / absent histories are returned untouched, never thrown on', () => {
  assert.strictEqual(repairEquityHistory(null, AG), null);
  assert.strictEqual(repairEquityHistory(undefined, AG), undefined);
  const empty = [];
  assert.strictEqual(repairEquityHistory(empty, AG), empty);
  const hist = agentic();
  assert.strictEqual(repairEquityHistory(hist, null), hist);   // no spec ⇒ untouched
  const noAnchor = [{ t: '2026-07-01', equity: 100, cumFlow: 0 }];
  assert.strictEqual(repairEquityHistory(noAnchor, AG), noAnchor);
  const noCum = [{ t: '2026-08-31', equity: 100 }];
  assert.strictEqual(repairEquityHistory(noCum, AG), noCum);
});

t('repairPriorCumFlow fixes BOTH accounts in place and reports what fired', () => {
  const prior = { agentic: { equityHistory: agentic() }, main: { equityHistory: main() } };
  const applied = repairPriorCumFlow(prior);
  assert.strictEqual(applied.length, 2);
  assert.deepStrictEqual(applied.map((a) => a.acct).sort(), ['agentic', 'main']);
  assert.strictEqual(prior.agentic.equityHistory.at(-1).cumFlow, 7950.75);
  assert.strictEqual(prior.main.equityHistory.at(-1).cumFlow, 0);
});

t('repairPriorCumFlow is a no-op on the second run — reports nothing fired', () => {
  const prior = { agentic: { equityHistory: agentic() }, main: { equityHistory: main() } };
  repairPriorCumFlow(prior);
  assert.deepStrictEqual(repairPriorCumFlow(prior), []);
  assert.strictEqual(prior.agentic.equityHistory.at(-1).cumFlow, 7950.75);
  assert.strictEqual(prior.main.equityHistory.at(-1).cumFlow, 0);
});

t('one account already clean does not stop the other from being fixed', () => {
  const prior = {
    agentic: { equityHistory: agentic().map((p) => ({ ...p, cumFlow: 7950.75 })) },
    main: { equityHistory: main() },
  };
  const applied = repairPriorCumFlow(prior);
  assert.deepStrictEqual(applied.map((a) => a.acct), ['main']);
  assert.strictEqual(prior.main.equityHistory.at(-1).cumFlow, 0);
});

t('a null prior, or one with no accounts, is safe', () => {
  assert.deepStrictEqual(repairPriorCumFlow(null), []);
  assert.deepStrictEqual(repairPriorCumFlow({}), []);
  assert.deepStrictEqual(repairPriorCumFlow({ agentic: {} }), []);
});

console.log(`\ncumflow-repair: ${n} tests passed`);
