// Offline unit checks for policy.mjs — no network. Run: node producer/policy.test.mjs
import { policyFor, policyBlackout, policyCalendar, validatePolicy, POLICY_BLACKOUT_DAYS } from './policy.mjs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

let pass = 0, fail = 0;
const eq = (label, got, want) => { const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.error(`✗ ${label}\n    got  ${g}\n    want ${w}`); } };
const ok = (label, cond) => { if (cond) { pass++; } else { fail++; console.error(`✗ ${label}`); } };

const ASOF = '2026-08-04';
const POLICY = { updated: ASOF, events: [
  { date: '2026-08-07', title: 'Section 232 tariff ruling', kind: 'tariff', impact: 'high',
    tickers: ['NVDA', 'TSM'], source: 'https://example.gov/ruling' },                        // 3d out
  { date: '2026-08-09', title: 'Comment period closes', kind: 'regulatory', impact: 'low',
    tickers: ['JPM'] },                                                                       // 5d out, low
  { date: '2026-09-15', title: 'PDUFA decision', kind: 'fda', impact: 'high',
    sectors: ['Health Technology'], source: 'https://example.gov/pdufa' },                     // 42d out
  { date: '2026-07-01', title: 'Already happened', kind: 'other', impact: 'high',
    tickers: ['NVDA'], source: 'https://example.gov/past' },                                   // past
] };

// ---- policyFor -------------------------------------------------------------
eq('matches by ticker, soonest first', policyFor('NVDA', POLICY, { asOf: ASOF }).map((e) => e.title), ['Section 232 tariff ruling']);
eq('past events are excluded', policyFor('NVDA', POLICY, { asOf: ASOF }).length, 1);
eq('matches by sector when given one', policyFor('LLY', POLICY, { asOf: ASOF, sector: 'Health Technology' }).map((e) => e.title), ['PDUFA decision']);
eq('sector event does not match without a sector', policyFor('LLY', POLICY, { asOf: ASOF }), []);
eq('unrelated name matches nothing', policyFor('COST', POLICY, { asOf: ASOF }), []);
eq('daysAway computed', policyFor('NVDA', POLICY, { asOf: ASOF })[0].daysAway, 3);
eq('horizon window is respected', policyFor('LLY', POLICY, { asOf: ASOF, sector: 'Health Technology', withinDays: 10 }), []);
ok('ticker matching is case-insensitive', policyFor('nvda', POLICY, { asOf: ASOF }).length === 1);

// ---- policyBlackout --------------------------------------------------------
ok('high-impact event inside the window blocks', policyBlackout('NVDA', POLICY, { asOf: ASOF }).title === 'Section 232 tariff ruling');
// A comment-period close is context, not a reason to sit out — over-blocking starves the deploy plan.
eq('low-impact event does NOT block', policyBlackout('JPM', POLICY, { asOf: ASOF }), null);
// 42 days out is real but not imminent; it should surface on the card, not defer today's buy.
eq('high-impact event beyond the window does not block', policyBlackout('LLY', POLICY, { asOf: ASOF, sector: 'Health Technology' }), null);
ok('…but it does block once inside the window', policyBlackout('LLY', POLICY, { asOf: '2026-09-12', sector: 'Health Technology' }) != null);
eq('an empty calendar blocks nothing', policyBlackout('NVDA', { events: [] }, { asOf: ASOF }), null);
eq('a missing calendar blocks nothing', policyBlackout('NVDA', null, { asOf: ASOF }), null);
eq('blackout window matches the earnings one', POLICY_BLACKOUT_DAYS, 7);

// ---- policyCalendar --------------------------------------------------------
const cal = policyCalendar(POLICY, [{ symbol: 'NVDA' }, { symbol: 'LLY', sector: 'Health Technology' }, { symbol: 'COST' }], { asOf: ASOF });
eq('calendar covers only events touching the book', cal.map((e) => e.title), ['Section 232 tariff ruling', 'PDUFA decision']);
eq('calendar annotates which holdings each event hits', cal[0].hits, ['NVDA']);
eq('calendar resolves sector hits to symbols', cal[1].hits, ['LLY']);
eq('calendar on an empty book is empty', policyCalendar(POLICY, [], { asOf: ASOF }), []);

// ---- validatePolicy --------------------------------------------------------
eq('a clean calendar validates', validatePolicy(POLICY), []);
eq('the shipped empty calendar validates', validatePolicy({ updated: ASOF, events: [] }), []);
ok('a malformed root is rejected', validatePolicy(null).length === 1);
// The source requirement exists because a high-impact event can defer a real trade — it must be traceable.
const bad = validatePolicy({ events: [{ date: '2026-09-01', title: 'Unsourced', impact: 'high', tickers: ['X'] }] });
ok('high-impact event without a source is rejected', bad.some((e) => /source/.test(e)));
const bad2 = validatePolicy({ events: [{ date: '9/1/26', title: 'Bad date', impact: 'medium', tickers: ['X'] }] });
ok('non-ISO date is rejected', bad2.some((e) => /YYYY-MM-DD/.test(e)));
const bad3 = validatePolicy({ events: [{ date: '2026-09-01', title: 'No exposure', impact: 'low' }] });
ok('event with neither ticker nor sector is rejected', bad3.some((e) => /ticker or sector/.test(e)));
const bad4 = validatePolicy({ events: [{ date: '2026-09-01', title: 'Bad impact', impact: 'critical', tickers: ['X'] }] });
ok('unknown impact level is rejected', bad4.some((e) => /impact/.test(e)));

// ---- the committed file ----------------------------------------------------
// It ships EMPTY on purpose (no free structured feed; a wrong date would defer or wave through a real
// trade). This guards the invariant rather than the contents: whatever is in it must be valid.
const __dirname = dirname(fileURLToPath(import.meta.url));
const shipped = JSON.parse(readFileSync(join(__dirname, 'policy.json'), 'utf8'));
eq('committed policy.json is valid', validatePolicy(shipped), []);
ok('committed policy.json documents its schema', !!shipped.schema && !!shipped.readme);

console.log(`\npolicy.test: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
