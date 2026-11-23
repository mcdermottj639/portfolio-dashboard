// Daily Picks must be a preflight directive on FETCH_ALL (runs skipped it on 2026-11-20 and 11-23).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PICKS_DIRECTIVE } from './preflight-directives.mjs';

test('picks directive names the required steps', () => {
  assert.match(PICKS_DIRECTIVE, /^PREFLIGHT ALSO \(REQUIRED on FETCH_ALL\)/);
  for (const s of ['picks-local.mjs --plan', 'picks-build.mjs', 'never skip']) assert.ok(PICKS_DIRECTIVE.includes(s), s);
});

test('preflight prints the picks directive only on FETCH_ALL', () => {
  const src = readFileSync(new URL('./preflight.mjs', import.meta.url), 'utf8');
  assert.match(src, /if \(mode === 'FETCH_ALL'\) console\.log\(PICKS_DIRECTIVE\);/);
});
