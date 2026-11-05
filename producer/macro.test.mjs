// Offline unit checks for macro.mjs — the book-wide Fed/CPI blackout (v182). Run: node producer/macro.test.mjs
import { readFileSync } from 'node:fs';
import { prevTradingDay, blockedDates, macroBlackout, macroCoverage, validateMacro, MACRO_MIN_COVER_DAYS } from './macro.mjs';

let pass = 0, fail = 0;
const ok = (label, cond) => { if (cond) pass++; else { fail++; console.error(`✗ ${label}`); } };
const eq = (label, got, want) => ok(`${label} (got ${JSON.stringify(got)} want ${JSON.stringify(want)})`, JSON.stringify(got) === JSON.stringify(want));

// previous trading day skips weekends and modeled NYSE holidays
eq('Tue → Mon', prevTradingDay('2026-11-10'), '2026-11-09');
eq('Mon → previous Fri', prevTradingDay('2026-11-16'), '2026-11-13');
eq('day after Thanksgiving → Wed (skips the holiday)', prevTradingDay('2026-11-27'), '2026-11-25');
eq('Tue after MLK Monday → previous Fri', prevTradingDay('2027-01-19'), '2027-01-15');
eq('garbage date → null', prevTradingDay('nope'), null);

// which session each kind blocks
eq('FOMC blocks its decision day', blockedDates({ date: '2026-12-09', kind: 'fomc' }), ['2026-12-09']);
eq('CPI blocks the trading day before the print', blockedDates({ date: '2026-11-10', kind: 'cpi' }), ['2026-11-09']);
eq('explicit blockOn overrides the default', blockedDates({ date: '2026-11-10', kind: 'cpi', blockOn: ['day', 'eve'] }), ['2026-11-10', '2026-11-09']);

const M = { events: [
  { date: '2026-11-10', kind: 'cpi', title: 'CPI (Oct)', source: 'https://www.bls.gov/x' },
  { date: '2026-12-09', kind: 'fomc', title: 'FOMC', source: 'https://www.federalreserve.gov/x' },
] };
ok('session before CPI is blocked', macroBlackout(M, { asOf: '2026-11-09' })?.kind === 'cpi');
ok('CPI day itself is NOT blocked (print is out before the first pass)', macroBlackout(M, { asOf: '2026-11-10' }) === null);
ok('FOMC decision day is blocked', macroBlackout(M, { asOf: '2026-12-09' })?.kind === 'fomc');
ok('day before FOMC is NOT blocked', macroBlackout(M, { asOf: '2026-12-08' }) === null);
ok('ordinary day → null', macroBlackout(M, { asOf: '2026-11-18' }) === null);
ok('null calendar → null (no-op)', macroBlackout(null, { asOf: '2026-11-09' }) === null);
ok('empty calendar → null', macroBlackout({ events: [] }, { asOf: '2026-11-09' }) === null);
ok('no asOf → null (never guesses today)', macroBlackout(M, {}) === null);

// coverage: absent ≠ zero — a calendar that has run out must say so
const cov = macroCoverage(M, { asOf: '2026-11-04' });
ok('coverage reports days to the last event of each kind', cov.cpi === 6 && cov.fomc === 35);
ok(`CPI under ${MACRO_MIN_COVER_DAYS}d → short`, cov.short === true);
ok('a series with no events is short', macroCoverage({ events: [M.events[1]] }, { asOf: '2026-11-04' }).short === true);

// the shipped calendar is valid and covers at least the next month
const shipped = JSON.parse(readFileSync(new URL('./macro.json', import.meta.url), 'utf8'));
eq('shipped macro.json validates clean', validateMacro(shipped), []);
ok('shipped calendar is not short on 2026-11-04', macroCoverage(shipped, { asOf: '2026-11-04' }).short === false);
ok('validator rejects a missing source', validateMacro({ events: [{ date: '2026-11-10', kind: 'cpi' }] }).length === 1);
ok('validator rejects an unknown kind', validateMacro({ events: [{ date: '2026-11-10', kind: 'gdp', source: 'https://x' }] }).length === 1);
ok('validator rejects a non-object', validateMacro(null).length === 1);

console.log(`\nmacro.test: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
