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
