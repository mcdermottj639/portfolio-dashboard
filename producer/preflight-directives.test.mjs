// Daily Picks must be a preflight directive on FETCH_ALL (runs skipped it on 2026-11-20 and 11-23).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PICKS_DIRECTIVE } from './preflight-directives.mjs';

test('picks directive names the required steps', () => {
  assert.match(PICKS_DIRECTIVE, /^PREFLIGHT ALSO \(FETCH_ALL\)/);
  for (const s of ['picks-local.mjs --plan', 'picks-build.mjs', 'PUBLISHING COMES FIRST']) assert.ok(PICKS_DIRECTIVE.includes(s), s);
});

test('picks directive never tells a run to hold back publishing', () => {
  // 2026-11-24/25 runs stopped without publishing under a hard "never skip" rule.
  assert.ok(!/never skip/i.test(PICKS_DIRECTIVE));
  assert.ok(PICKS_DIRECTIVE.includes('run run.mjs with what you have'));
});

test('preflight prints the picks directive only on FETCH_ALL', () => {
  const src = readFileSync(new URL('./preflight.mjs', import.meta.url), 'utf8');
  assert.match(src, /if \(mode === 'FETCH_ALL'\) console\.log\(PICKS_DIRECTIVE\);/);
});

import { PICKS_CATCHUP_DIRECTIVE, picksCatchup } from './preflight-directives.mjs';

const stale = { picks: { ts: '2026-11-24' } };
test('catch-up: picks built today -> no directive, no note', () => {
  assert.deepEqual(picksCatchup({ mode: 'FETCH_LIGHT', prior: { picks: { ts: '2026-11-25' } }, todayET: '2026-11-25' }), { directive: null, note: null });
});
test('catch-up: stale picks on a market day -> directive on FETCH_LIGHT only', () => {
  const r = picksCatchup({ mode: 'FETCH_LIGHT', prior: stale, todayET: '2026-11-25' });
  assert.equal(r.directive, PICKS_CATCHUP_DIRECTIVE);
  assert.match(r.note, /2026-11-24/);
  assert.equal(picksCatchup({ mode: 'FETCH_ALL', prior: stale, todayET: '2026-11-25' }).directive, null);
  assert.equal(picksCatchup({ mode: 'SKIP', prior: stale, todayET: '2026-11-25' }).directive, null);
});
test('catch-up: weekend / market holiday -> no directive', () => {
  assert.equal(picksCatchup({ mode: 'FETCH_LIGHT', prior: stale, todayET: '2026-11-28', tradingDay: false }).directive, null);
});
test('catch-up: unreadable marker -> no directive, logged note', () => {
  for (const prior of [null, {}, { picks: {} }, { picks: { ts: 'garbage' } }, { picks: { ts: 20261124 } }]) {
    const r = picksCatchup({ mode: 'FETCH_LIGHT', prior, todayET: '2026-11-25' });
    assert.equal(r.directive, null); assert.match(r.note, /unreadable.*no catch-up/);
  }
});
test('catch-up: one attempt, publishing first, nothing from the snapshot is printed', () => {
  assert.ok(PICKS_CATCHUP_DIRECTIVE.includes('ONE attempt only'));
  assert.ok(PICKS_CATCHUP_DIRECTIVE.includes('PUBLISHING COMES FIRST'));
  const r = picksCatchup({ mode: 'FETCH_LIGHT', prior: { picks: { ts: '2026-11-24', picks: [{ ticker: 'SECRET' }] } }, todayET: '2026-11-25' });
  assert.ok(!JSON.stringify(r).includes('SECRET'));
  const src = readFileSync(new URL('./preflight.mjs', import.meta.url), 'utf8');
  assert.match(src, /if \(mode === 'FETCH_LIGHT'\) \{ if \(catchup\.note\)/);
  assert.match(src, /picksCatchup\(\{ mode: 'FETCH_LIGHT'/);
});
