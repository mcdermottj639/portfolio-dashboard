// producer/preflight-directives.mjs — directives preflight.mjs prints for the scheduled agent.
// The producer Routine's prompt says to obey preflight's output, while long PRODUCER.md sections
// can go unread: the 2026-11-20 and 2026-11-23 FETCH_ALL runs skipped Daily Picks (no scan, no
// picks-local plan), so the Last scan stamp stayed frozen. The required step therefore lives here.
export const PICKS_DIRECTIVE = 'PREFLIGHT ALSO (REQUIRED on FETCH_ALL): rebuild Daily Picks on THIS run — never skip it to save calls. ' +
  'Run the saved scan (PRODUCER.md step 3b); if it spills or is unreadable, run `node producer/picks-local.mjs --plan`, ' +
  'make every batch it prints (fundamentals/quotes/rsi), repeat until it prints nothing missing, then `node producer/picks-local.mjs`. ' +
  'Then `node producer/picks-build.mjs` before options-plan and run.mjs. Skipping it freezes the Daily Picks "Last scan" date; ' +
  'only a real provider failure may leave Picks partial, and the report must name it.';
