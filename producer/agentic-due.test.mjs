// Unit tests for the weekly research gate (producer/agentic-due.mjs).
//
// This module had NO tests, which is how the same defect shipped twice: a `>= 7` age gate that the
// Monday cron could never satisfy, then a `>= 6` one that still couldn't whenever the target landed
// on a Wednesday. Both were reasoned about in prose and neither was ever executed against a real
// (asOf-weekday, fire-weekday) pair. Every case below is such a pair.
import assert from 'node:assert/strict';
import { researchDue, weekStart, REFRESH_DAYS } from './agentic-due.mjs';

let n = 0;
const t = (name, fn) => { fn(); n++; console.log('  ✓', name); };

console.log('agentic-due');

t('weekStart pins each day to the Monday of its ET week', () => {
  assert.equal(weekStart('2026-09-07'), '2026-09-07');   // Monday → itself
  assert.equal(weekStart('2026-09-02'), '2026-08-31');   // Wednesday
  assert.equal(weekStart('2026-09-06'), '2026-08-31');   // Sunday belongs to the week that began Mon
  assert.equal(weekStart('2026-08-31'), '2026-08-31');
});

// THE LIVE REGRESSION. The committed target on 2026-09-03 was stamped 2026-09-02 — a WEDNESDAY — so
// the next Monday fire saw it 5 days old. Under the old `ageDays >= 6` gate that printed NOT_DUE and
// the research would have skipped the week, logging SUCCEEDED with nothing anywhere saying so.
t('a Wednesday target is DUE on the following Monday (the 2026-09-07 case)', () => {
  const r = researchDue('2026-09-02', '2026-09-07');
  assert.equal(r.due, true);
  assert.equal(r.ageDays, 5, 'the age that the old gate refused');
  assert.match(r.reason, /before this week/);
});

t('every weekday a target could land on is DUE on the next Monday fire', () => {
  // Mon 2026-08-31 … Sun 2026-09-06, all of them last week relative to the 09-07 fire.
  for (const [day, age] of [['2026-08-31', 7], ['2026-09-01', 6], ['2026-09-02', 5],
                            ['2026-09-03', 4], ['2026-09-04', 3], ['2026-09-05', 2], ['2026-09-06', 1]]) {
    const r = researchDue(day, '2026-09-07');
    assert.equal(r.due, true, `${day} (${age}d before the fire) must be due`);
    assert.equal(r.ageDays, age);
  }
});

t('a target written earlier the SAME Monday is not due again', () => {
  const r = researchDue('2026-09-07', '2026-09-07');
  assert.equal(r.due, false);
  assert.equal(r.ageDays, 0);
  assert.match(r.reason, /already refreshed this week/);
});

t('a mid-week ad-hoc refresh does not re-trigger later the same week', () => {
  // Ran Tuesday; a Thursday producer run must not spend another research pass.
  const r = researchDue('2026-09-08', '2026-09-10');
  assert.equal(r.due, false);
  assert.equal(r.ageDays, 2);
});

t('a missing or malformed target fails OPEN (refresh rather than starve)', () => {
  for (const bad of [null, undefined, '', 'not-a-date', '2026-9-2']) {
    assert.equal(researchDue(bad, '2026-09-07').due, true);
  }
});

t('the staleness backstop still forces a refresh inside one week', () => {
  // Same ET week (both in the week of Mon 2026-09-07) but past REFRESH_DAYS — only reachable if the
  // cron changes or a week stalls, and it must still fire rather than wait for the week to roll.
  const r = researchDue('2026-09-07', '2026-09-13');
  assert.equal(r.ageDays, REFRESH_DAYS);
  assert.equal(r.due, true);
  assert.match(r.reason, /staleness backstop/);
});

t('a future-dated target does not force a refresh off clock skew', () => {
  const r = researchDue('2026-09-09', '2026-09-07');
  assert.equal(r.due, false);
  assert.ok(r.ageDays < 0);
});

t('a two-week gap is due (the missed-week self-heal)', () => {
  const r = researchDue('2026-08-25', '2026-09-07');
  assert.equal(r.due, true);
  assert.equal(r.ageDays, 13);
});

console.log(`agentic-due: ${n} tests passed`);
