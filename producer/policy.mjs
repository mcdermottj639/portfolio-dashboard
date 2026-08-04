// producer/policy.mjs — the forward-looking half of the "Washington" theme: a dated policy-event
// calendar and the pure helpers that map it onto holdings.
//
// WHY THIS EXISTS: congressional disclosure feeds tell you what a politician traded 40-116 days ago.
// What actually moves a position is what is SCHEDULED to happen next — a tariff deadline, a PDUFA date,
// an appropriations vote, an antitrust ruling. The producer already understands one dated catalyst
// (earnings) and defers new money around it; this generalizes that to policy events, so the deploy
// planner can say "don't put fresh money into this name the week of its ruling" for the same reason it
// says "wait for the print".
//
// THE DATA IS OWNER/AGENT-MAINTAINED, NOT FETCHED. There is no free structured feed for "scheduled
// policy events affecting ticker X", and a wrong date here would defer (or fail to defer) a real trade,
// so events are only ever written from a source that has been read — the weekly research agent adds them
// as part of its catalyst work (PRODUCER.md step 7). producer/policy.json therefore ships EMPTY; an
// empty calendar makes every function below a no-op, which is the correct failure mode.
//
// Event shape (producer/policy.json → { updated, events:[…] }):
//   { date:      'YYYY-MM-DD'   — when the thing happens (required)
//     title:     'FY27 appropriations deadline'
//     kind:      'tariff' | 'fda' | 'appropriations' | 'antitrust' | 'regulatory' | 'election' | …
//     impact:    'high' | 'medium' | 'low'   — ONLY 'high' can defer a buy
//     tickers:   ['LMT','RTX']    — direct exposure
//     sectors:   ['Health Technology']  — broader exposure, matched against a name's sector
//     note:      'why this matters'
//     source:    'https://…'      — where the date came from; required for anything marked high }
// Pure functions only (no I/O) so they're unit-testable offline — see policy.test.mjs.

export const POLICY_BLACKOUT_DAYS = 7;   // mirrors EARNINGS_BLACKOUT_DAYS — same reasoning, same window
export const POLICY_HORIZON_DAYS = 90;   // how far ahead the consumer card looks

const daysUntil = (date, asOf) => {
  if (!date) return null;
  const a = Date.parse(`${String(asOf || new Date().toISOString().slice(0, 10))}T00:00:00Z`);
  const b = Date.parse(`${String(date).slice(0, 10)}T00:00:00Z`);
  return Number.isFinite(a) && Number.isFinite(b) ? Math.round((b - a) / 86400000) : null;
};
const list = (v) => (Array.isArray(v) ? v.map((x) => String(x).toUpperCase()) : []);
const events = (policy) => (policy && Array.isArray(policy.events) ? policy.events : []).filter((e) => e && e.date);

// Every event that touches `sym` (directly by ticker, or via its sector), still ahead of us, within
// `withinDays`. Sorted soonest-first. `sector` is optional — omit it for ticker-only matching.
export function policyFor(sym, policy, { asOf, sector, withinDays = POLICY_HORIZON_DAYS } = {}) {
  const s = String(sym || '').toUpperCase();
  const sec = sector ? String(sector).toUpperCase() : null;
  return events(policy)
    .map((e) => ({ ...e, daysAway: daysUntil(e.date, asOf) }))
    .filter((e) => e.daysAway != null && e.daysAway >= 0 && e.daysAway <= withinDays)
    .filter((e) => list(e.tickers).includes(s) || (sec != null && list(e.sectors).includes(sec)))
    .sort((a, b) => a.daysAway - b.daysAway);
}

// The blocking event, if any: the soonest HIGH-impact event inside the blackout window. Medium/low
// impact events are surfaced as context but never defer a buy — a comment-period close is not a reason
// to sit out, and over-blocking would quietly starve the deployment plan.
export function policyBlackout(sym, policy, { asOf, sector, blackoutDays = POLICY_BLACKOUT_DAYS } = {}) {
  const hit = policyFor(sym, policy, { asOf, sector, withinDays: blackoutDays })
    .find((e) => String(e.impact || '').toLowerCase() === 'high');
  return hit || null;
}

// Whole-book view for the consumer card: every upcoming event that touches something held or targeted,
// each annotated with the symbols it hits. `holdings` = [{ symbol, sector }].
export function policyCalendar(policy, holdings = [], { asOf, withinDays = POLICY_HORIZON_DAYS } = {}) {
  const rows = (holdings || []).map((h) => ({
    sym: String(h.symbol || h.ticker || '').toUpperCase(),
    sec: h.sector ? String(h.sector).toUpperCase() : null,
  })).filter((h) => h.sym);
  return events(policy)
    .map((e) => ({ ...e, daysAway: daysUntil(e.date, asOf) }))
    .filter((e) => e.daysAway != null && e.daysAway >= 0 && e.daysAway <= withinDays)
    .map((e) => {
      const tk = list(e.tickers), sc = list(e.sectors);
      const hits = rows.filter((h) => tk.includes(h.sym) || (h.sec && sc.includes(h.sec))).map((h) => h.sym);
      return { ...e, hits: [...new Set(hits)] };
    })
    .filter((e) => e.hits.length)
    .sort((a, b) => a.daysAway - b.daysAway);
}

// Guard for whoever edits policy.json by hand or by agent: returns a list of problems, empty when clean.
// A 'high' impact event with no source is rejected — that is the one that can block a real trade.
export function validatePolicy(policy) {
  const errs = [];
  const es = (policy && Array.isArray(policy.events)) ? policy.events : null;
  if (!policy || es == null) return ['policy.json must be { updated, events: [] }'];
  es.forEach((e, i) => {
    const at = `events[${i}]${e && e.title ? ` (${e.title})` : ''}`;
    if (!e || typeof e !== 'object') { errs.push(`${at}: not an object`); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(e.date || ''))) errs.push(`${at}: date must be YYYY-MM-DD`);
    if (!e.title) errs.push(`${at}: missing title`);
    const impact = String(e.impact || '').toLowerCase();
    if (!['high', 'medium', 'low'].includes(impact)) errs.push(`${at}: impact must be high|medium|low`);
    if (!list(e.tickers).length && !list(e.sectors).length) errs.push(`${at}: needs at least one ticker or sector`);
    if (impact === 'high' && !e.source) errs.push(`${at}: high-impact events require a source URL (they can defer a real buy)`);
  });
  return errs;
}
