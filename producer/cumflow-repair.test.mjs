// Tests for the one-time 2026-10-09 cumFlow repair.   node producer/cumflow-repair.test.mjs
import assert from 'node:assert/strict';
import { repairCumFlow, applyRepairs, REPAIRS } from './cumflow-repair.mjs';

let n = 0; const t = (name, fn) => { fn(); n++; console.log(`  ✓ ${name}`); };
const R = REPAIRS[0];
const live = () => [
  { t: '2026-10-07', equity: 7374.74, cumFlow: 3788.17 },
  { t: '2026-10-08', equity: 7344.12, cumFlow: 3788.17 },
  { t: '2026-10-09', equity: 7036.41, cumFlow: 3788.17 },
  { t: '2026-10-19', equity: 7035.19, cumFlow: 3788.17 },
  { t: '2026-10-20', equity: 7735.19, cumFlow: 4488.17 },
];

t('subtracts the missed $375 from the miss day onward, leaving earlier points alone', () => {
  const { history, applied } = repairCumFlow(live(), R);
  assert.equal(applied, true);
  assert.deepEqual(history.map((p) => p.cumFlow), [3788.17, 3788.17, 3413.17, 3413.17, 4113.17]);
});
t('is a no-op on an already-repaired series (self-disabling)', () => {
  const once = repairCumFlow(live(), R).history;
  const twice = repairCumFlow(once, R);
  assert.equal(twice.applied, false);
  assert.deepEqual(twice.history, once);
});
t('does not fire when the anchor moved (a later genuine transfer)', () => {
  const h = live(); h[1].cumFlow = 3000;
  assert.equal(repairCumFlow(h, R).applied, false);
});
t('missing history or missing points are a no-op', () => {
  assert.equal(repairCumFlow(null, R).applied, false);
  assert.equal(repairCumFlow(live().slice(0, 2), R).applied, false);
});
t('applyRepairs touches only the agentic block', () => {
  const prior = { agentic: { equityHistory: live() }, main: { equityHistory: live() } };
  const done = applyRepairs(prior);
  assert.equal(done.length, 1);
  assert.equal(prior.agentic.equityHistory[2].cumFlow, 3413.17);
  assert.equal(prior.main.equityHistory[2].cumFlow, 3788.17);
  assert.deepEqual(applyRepairs({}), []);
});
t('the repaired series no longer reads the 10-09 withdrawal as a loss', () => {
  const r = repairCumFlow(live(), R).history;
  const step = (h) => (h[2].equity - (h[2].cumFlow - h[1].cumFlow)) / h[1].equity - 1;
  assert.ok(step(live()) < -0.04);
  assert.ok(step(r) > 0);
});

console.log(`\n✅ cumflow-repair: ${n} assertions passed`);
