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
