// Unit tests for the research cadence gate (producer/agentic-due.mjs).
//
// This module had NO tests, which is how the same defect shipped twice: a `>= 7` age gate that the
// Monday cron could never satisfy, then a `>= 6` one that still couldn't whenever the target landed
// on a Wednesday. Both were reasoned about in prose and neither was ever executed against a real
// (asOf-weekday, fire-weekday) pair. Every case below is such a pair.
//
// 2026-09-24: cadence moved weekly → FORTNIGHTLY, so the same class of bug now costs two weeks of
// stale entry zones instead of one. The gate is still a CALENDAR test — an age threshold cannot work
// here, for the reasons above — anchored to a fixed epoch Monday so "which fortnight" is a pure
// function of the date rather than of when the last target happened to land.
import assert from 'node:assert/strict';
import { researchDue, weekStart, fortnightStart, FORTNIGHT_EPOCH, REFRESH_DAYS } from './agentic-due.mjs';

let n = 0;
const t = (name, fn) => { fn(); n++; console.log('  ✓', name); };

console.log('agentic-due');

t('weekStart pins each day to the Monday of its ET week', () => {
  assert.equal(weekStart('2026-09-07'), '2026-09-07');   // Monday → itself
  assert.equal(weekStart('2026-09-02'), '2026-08-31');   // Wednesday
  assert.equal(weekStart('2026-09-06'), '2026-08-31');   // Sunday belongs to the week that began Mon
  assert.equal(weekStart('2026-08-31'), '2026-08-31');
});

t('the epoch is itself a Monday and its own fortnight start', () => {
  assert.equal(weekStart(FORTNIGHT_EPOCH), FORTNIGHT_EPOCH, 'epoch must be a Monday');
  assert.equal(fortnightStart(FORTNIGHT_EPOCH), FORTNIGHT_EPOCH);
});

t('fortnightStart is stable across all 14 days of a period', () => {
  const start = '2026-09-14';
  for (let i = 0; i < 14; i++) {
    const d = new Date(Date.parse(start + 'T00:00:00Z') + i * 86400000).toISOString().slice(0, 10);
    assert.equal(fortnightStart(d), start, `${d} belongs to the fortnight from ${start}`);
  }
  assert.equal(fortnightStart('2026-09-28'), '2026-09-28', 'day 15 starts the NEXT fortnight');
});

t('alternate Mondays are distinct fortnight starts, and the between-Monday is not', () => {
  assert.equal(fortnightStart('2026-09-14'), '2026-09-14');
  assert.equal(fortnightStart('2026-09-21'), '2026-09-14', 'the odd Monday folds back');
  assert.equal(fortnightStart('2026-09-28'), '2026-09-28');
});

t('parity holds for dates BEFORE the epoch (no negative-modulo flip)', () => {
  // Math.floor on a negative week index would otherwise put pre-epoch dates on the wrong parity.
  assert.equal(fortnightStart('2025-12-22'), '2025-12-22');
  assert.equal(fortnightStart('2025-12-29'), '2025-12-22');
  assert.equal(fortnightStart('2025-12-08'), '2025-12-08');
});

// THE LIVE CASE that motivated the change. The committed target is stamped 2026-09-14 (a Monday and a
// fortnight start). The 2026-09-24 run must NOT spend a research pass — that fortnight is already done.
t('a target from earlier in the SAME fortnight is not due (the 2026-09-24 case)', () => {
  const r = researchDue('2026-09-14', '2026-09-24');
  assert.equal(r.due, false);
  assert.equal(r.ageDays, 10, 'ten days old and still current under a fortnightly cadence');
  assert.match(r.reason, /already refreshed this fortnight/);
});

t('…and the SAME target is due once the next fortnight opens', () => {
  const r = researchDue('2026-09-14', '2026-09-28');
  assert.equal(r.due, true);
  assert.match(r.reason, /before this fortnight/);
});

t('every weekday a target could land on is DUE on the next fortnight fire', () => {
  // Mon 2026-08-31 … Sun 2026-09-13 all precede the fortnight beginning 2026-09-14.
  for (let i = 0; i < 14; i++) {
    const day = new Date(Date.parse('2026-08-31T00:00:00Z') + i * 86400000).toISOString().slice(0, 10);
    const r = researchDue(day, '2026-09-14');
    assert.equal(r.due, true, `${day} must be due on the 09-14 fire`);
  }
});

t('an ad-hoc mid-fortnight refresh does not re-trigger later in the same fortnight', () => {
  const r = researchDue('2026-09-16', '2026-09-22');
  assert.equal(r.due, false);
  assert.equal(r.ageDays, 6);
});

t('a missing or malformed target fails OPEN (refresh rather than starve)', () => {
  for (const bad of [null, undefined, '', 'not-a-date', '2026-9-2']) {
    assert.equal(researchDue(bad, '2026-09-14').due, true);
  }
});

t('the staleness backstop still fires inside one fortnight', () => {
  // Same fortnight (from 2026-09-14) but past REFRESH_DAYS — reachable only if the cron changes or a
  // period stalls, and it must fire rather than wait for the fortnight to roll.
  const r = researchDue('2026-09-14', '2026-09-27');
  assert.equal(r.ageDays, REFRESH_DAYS);
  assert.equal(r.due, true);
  assert.match(r.reason, /staleness backstop/);
});

t('the backstop sits INSIDE one period, so it can never skip a fortnight', () => {
  assert.ok(REFRESH_DAYS < 14, `REFRESH_DAYS ${REFRESH_DAYS} must be under 14 or a stalled period is invisible`);
});

t('a future-dated target does not force a refresh off clock skew', () => {
  const r = researchDue('2026-09-16', '2026-09-14');
  assert.equal(r.due, false);
  assert.ok(r.ageDays < 0);
});

t('a missed fortnight self-heals rather than compounding', () => {
  const r = researchDue('2026-08-31', '2026-09-28');
  assert.equal(r.due, true);
  assert.equal(r.ageDays, 28);
});

console.log(`agentic-due: ${n} tests passed`);
