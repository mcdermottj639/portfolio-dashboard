// producer/macro.mjs — book-wide MACRO blackout for NEW agentic money (v182, owner-approved 2026-11-04).
//
// WHY: the earnings and policy blackouts are NAME-scoped — "don't put fresh money into X the week of its
// print / ruling". Two scheduled events move the WHOLE tape at once and no name-scoped rule sees them:
// the FOMC rate decision (2:00 PM ET) and the CPI release (8:30 AM ET). Jack asked for the rule a research
// prompt he reviewed put as "never let a new strategy launch into one". Here that means: on those days the
// planner holds NEW buys for one session and lets them run the next. It is PACING, not timing —
//   • buys only — sells, exits, trims, TLH and drawdown raises are NEVER blocked (de-risking stays open);
//   • one trading session per event, so ~20 sessions a year at most (8 FOMC + 12 CPI);
//   • the deferral is dated and short, so the dollars wait in CASH (it is not in PARK_DATED_REASONS) and
//     clear on the next pass after the event. Mandate A forbids market timing; a one-session pause around
//     a scheduled binary event is the same thing the earnings blackout already does per name.
//
// WHICH SESSION. The executor runs 10:20 AM–4:20 PM ET.
//   • FOMC ('day'): the statement lands at 2:00 PM, i.e. DURING the session — any buy that day before 2 PM
//     is a buy into the announcement, so the whole decision day is blocked.
//   • CPI ('eve'): the print lands at 8:30 AM, BEFORE the first executor pass. A buy on release day already
//     has the number; the exposure is buying the session BEFORE and holding it overnight into the print.
//     So the previous TRADING day is blocked (weekends and NYSE holidays from market.mjs are skipped).
//
// THE DATA IS A DATED FILE, NOT A FEED (producer/macro.json), for the same reason policy.json is: a wrong
// date would defer — or wave through — a real trade, so every date is copied from a source that was read
// and carries that source. ABSENT ≠ ZERO: when the calendar runs out the rule would go quietly inert, so
// `macroCoverage` reports how far ahead it reaches and the planner WARNS once it is under
// MACRO_MIN_COVER_DAYS, instead of silently doing nothing. Pure functions only — macro.test.mjs.

import { isHoliday } from './market.mjs';

export const MACRO_MIN_COVER_DAYS = 30;   // warn when either series ends inside this many days
const DAY = 86400000;
const iso = (t) => new Date(t).toISOString().slice(0, 10);
const parse = (d) => Date.parse(`${String(d).slice(0, 10)}T12:00:00Z`);

// Previous NYSE trading day before `date` (YYYY-MM-DD): skips Sat/Sun and modeled full closures.
export function prevTradingDay(date) {
  let t = parse(date);
  if (!Number.isFinite(t)) return null;
  for (let i = 0; i < 10; i++) {
    t -= DAY;
    const wd = new Date(t).getUTCDay();
    if (wd === 0 || wd === 6) continue;
    if (isHoliday(new Date(t))) continue;   // noon UTC is the same ET calendar date
    return iso(t);
  }
  return null;
}

const events = (macro) => (macro && Array.isArray(macro.events) ? macro.events : []).filter((e) => e && e.date && e.kind);

// The session(s) an event blocks, as ET dates. 'day' = the event date, 'eve' = the trading day before.
export function blockedDates(e) {
  const on = Array.isArray(e.blockOn) && e.blockOn.length ? e.blockOn : (e.kind === 'cpi' ? ['eve'] : ['day']);
  const out = [];
  if (on.includes('day')) out.push(String(e.date).slice(0, 10));
  if (on.includes('eve')) { const p = prevTradingDay(e.date); if (p) out.push(p); }
  return out;
}

// The event that blocks NEW buys on `asOf`, or null. Book-wide: there is no ticker argument.
export function macroBlackout(macro, { asOf } = {}) {
  const day = String(asOf || '').slice(0, 10);
  if (!day) return null;
  for (const e of events(macro)) if (blockedDates(e).includes(day)) return e;
  return null;
}

// How far ahead each series reaches from `asOf` (days to its LAST listed event; negative = already past,
// null = none listed). The planner warns when the shorter one is under MACRO_MIN_COVER_DAYS.
export function macroCoverage(macro, { asOf } = {}) {
  const a = parse(asOf);
  const last = (k) => events(macro).filter((e) => e.kind === k).map((e) => parse(e.date)).filter(Number.isFinite).sort((x, y) => y - x)[0];
  const span = (k) => { const l = last(k); return l == null || !Number.isFinite(a) ? null : Math.round((l - a) / DAY); };
  const fomc = span('fomc'), cpi = span('cpi');
  const short = [fomc, cpi].some((d) => d == null || d < MACRO_MIN_COVER_DAYS);
  return { fomc, cpi, short };
}

// Guard for whoever edits macro.json: problems as strings, empty when clean.
export function validateMacro(macro) {
  const es = macro && macro.events;
  if (!macro || !Array.isArray(es)) return ['macro.json must be { updated, events: [] }'];
  const errs = [];
  es.forEach((e, i) => {
    const at = `events[${i}]`;
    if (!e || !/^\d{4}-\d{2}-\d{2}$/.test(String(e.date || ''))) errs.push(`${at}: date must be YYYY-MM-DD`);
    if (!['fomc', 'cpi'].includes(e && e.kind)) errs.push(`${at}: kind must be fomc | cpi`);
    if (!(e && /^https:\/\//.test(String(e.source || '')))) errs.push(`${at}: source URL required`);
    if (e && e.blockOn != null && !(Array.isArray(e.blockOn) && e.blockOn.every((b) => b === 'day' || b === 'eve'))) errs.push(`${at}: blockOn must be ['day'] and/or ['eve']`);
  });
  return errs;
}
