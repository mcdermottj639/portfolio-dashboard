// producer/preflight-directives.mjs — directives preflight.mjs prints for the scheduled agent.
// The producer Routine's prompt says to obey preflight's output, while long PRODUCER.md sections
// can go unread: the 2026-11-20 and 2026-11-23 FETCH_ALL runs skipped Daily Picks (no scan, no
// picks-local plan), so the Last scan stamp stayed frozen. The step therefore lives here.
// 2026-11-24/25: a hard "never skip" made FETCH_ALL runs stop WITHOUT publishing when the full list
// felt too long, freezing the whole dashboard. Publishing always comes first; Picks is the top extra.
export const PICKS_DIRECTIVE = 'PREFLIGHT ALSO (FETCH_ALL): rebuild Daily Picks on THIS run whenever you can. ' +
  'Run the saved scan (PRODUCER.md step 3b); if it spills or is unreadable, run `node producer/picks-local.mjs --plan`, ' +
  'make every batch it prints (fundamentals/quotes/rsi), repeat until it prints nothing missing, then `node producer/picks-local.mjs`. ' +
  'Then `node producer/picks-build.mjs` before options-plan and run.mjs. ' +
  'PUBLISHING COMES FIRST: never end a run without running run.mjs because Picks, historicals, fundamentals, options or Alpha Vantage are unfinished. ' +
  'Once portfolio.json and positions.json (both accounts) are saved, if you run short, skip what is left, run run.mjs with what you have ' +
  '(build-data keeps prior data for anything missing) and name every skipped item in the report.';

// ── Daily Picks CATCH-UP (2026-11-25, owner-approved; not a new scheduled task) ─────────────────────
// Picks are rebuilt only on the day's first FETCH_ALL run, and later runs are FETCH_LIGHT, so a missed
// morning stayed missed until the next market day. On a FETCH_LIGHT run, when the published picks are
// older than today (ET), this prints ONE directive to rebuild them. Freshness = `data.picks.ts` (the
// 'YYYY-MM-DD' build date that the app's "Last scan" stamp reads), read from the prior snapshot that
// preflight already decrypts in-run; only a yes/no decision and a date-free note are printed — no
// snapshot content leaves the run. Fail safe: an unreadable marker prints a note and no directive.
// At most one attempt per run (a single directive); publishing still comes first, so a failed or
// unfinished catch-up never blocks run.mjs.
export const PICKS_CATCHUP_DIRECTIVE = 'PREFLIGHT ALSO (FETCH_LIGHT, Daily Picks catch-up): the published Daily Picks are older than today, ' +
  'so rebuild them ONCE on THIS run, AFTER the every-run fetches and BEFORE run.mjs: run `node producer/picks-local.mjs --plan`, ' +
  'make every batch it prints (fundamentals/quotes/rsi/SPY), repeat until it prints nothing missing, then `node producer/picks-local.mjs` ' +
  'and `node producer/picks-build.mjs` (PRODUCER.md step 3b; the saved scan is fine if it reads). ' +
  'ONE attempt only: if it fails, spills or you run short, drop it and move on. ' +
  'PUBLISHING COMES FIRST: run.mjs always runs; a failed or unfinished catch-up never blocks it. Name the outcome in the report.';

// Pure decision. Returns { directive: string|null, note: string|null }.
//   mode: preflight mode about to print; prior: decrypted prior snapshot; todayET: 'YYYY-MM-DD' (ET)
//   tradingDay: false on weekend / market holiday.
export function picksCatchup({ mode, prior, todayET, tradingDay = true } = {}) {
  if (mode !== 'FETCH_LIGHT') return { directive: null, note: null };
  if (!tradingDay) return { directive: null, note: null };
  const ts = prior && prior.picks && prior.picks.ts;
  if (typeof ts !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(ts) || !Number.isFinite(Date.parse(ts)) || !/^\d{4}-\d{2}-\d{2}$/.test(todayET || '')) {
    return { directive: null, note: 'picks catch-up: Daily Picks date unreadable in the prior snapshot — no catch-up (fail safe, no retry loop).' };
  }
  if (ts >= todayET) return { directive: null, note: null };   // built today (or UTC-stamped later today): nothing to do
  return { directive: PICKS_CATCHUP_DIRECTIVE, note: `picks catch-up: published Daily Picks are from ${ts}, before ${todayET} ET — one rebuild attempt requested.` };
}
