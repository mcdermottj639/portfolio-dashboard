# Audit log — scheduled tasks, models and how they work together (owner request, 2026-11-25)

Jack: "part of these audits should be auditing the scheduling tasks and everything too... how the
schedule and the tasks and everything work together should be audited."

Findings only. Nothing here changes a scheduled task, a prompt, a rule or a model. Each finding: what was
seen, the evidence (task name, date, file), what it costs or risks, and a proposed fix for Jack to approve.
Newest first.

## Top fixes for Jack (ranked; at most 7; nothing is done until you say so)
1. "Apex v2.9 paper track · 0741": keep Monday as is; run Tue–Fri on Sonnet (the scoring is all in code). Saves about 4 long Fable runs a week (Nov 25 run: 23 minutes).
2. "Operations HQ site refresh": Fable → Sonnet. It only runs three scripts and pushes. Saves 7 Fable runs a week.
3. "Apex paper run watchdog": read the published paper file's date (one small request) instead of paging the whole task list. Same alarm, about 5 heavy task-list reads a week saved.
4. "Apex morning order ticket line": retire it and put the ticket link in the "Apex buy sheet" message. Saves 5 runs a week and one daily ping that says the same thing on days with no buy.
5. "Daily relay" Monday task check: stop paging every task; check the four named tasks from public evidence (file dates) or stop at the first page that holds them.
6. Still the largest load and NOT yet audited: "Portfolio dashboard refresh" (9 runs a weekday) and "Agentic executor" (7 a weekday). Next audit run starts there.
7. All 12 tasks read so far attach every connector (Canva, Figma, Supabase, Slides, …). Attach only what each task uses: smaller tool list every run, and a read-only watchdog no longer carries Robinhood.

## Done 2026-11-26 9:35 AM ET (Jack: "All. Just make the changes") — scheduled tasks changed by a Claude chat
- Fix 1 DONE: "Apex v2.9 paper track · 0741" now runs Mondays only (Fable, prompt untouched). New task
  "Apex v2.9 paper track · 0741 · Tue–Fri" (Sonnet, same prompt plus a header line) covers Tue–Fri. It is
  paused with the others; the cloud backup that turns investing tasks on Monday now includes it.
  NOT verified: a real Sonnet run. Tue Dec 1 is the first; the watchdog and the repo tests are the gate.
- Fix 2 DONE: "Operations HQ site refresh" model Fable → Sonnet. NOT verified until its next run.
- Fix 3 DONE: "Apex paper run watchdog" reads the published paper file's date and status (one small request)
  and no longer reads the task list. It covers both paper tasks.
- Fix 4 HALF DONE: "Apex buy sheet · 0741" now ends with the ticket link. The "Apex morning order ticket line"
  could NOT be changed from here (its prompt can only be edited from the chat it posts into). It is paused,
  and the cloud backup no longer turns it on, but the Monday 6:30 AM reminder in Jack's Duet chat still will.
  WAITS ON JACK: say "retire the Apex ticket line" in the Duet main chat.
- Fixes 5–7 not done (not in the message Jack answered): Daily relay Monday check, the hourly jobs audit,
  connector trimming (connectors cannot be edited with the task tools).

## Covered so far
- 2026-11-26 (12 tasks, task-list pages 1–3): Portfolio LAB · deep review (Thanksgiving) · Apex paper run watchdog ·
  Apex morning order ticket line · Operations HQ site refresh · League History Lab · daily polish ·
  Apex v2.9 paper track · 0741 · Apex targets copy · Mondays · Sunday game day relay · Daily relay ·
  Apex buy sheet · 0741 · Card Vault offer relay.
- NOT yet covered (named in the seed list or in other prompts): Portfolio dashboard refresh, Agentic executor,
  Agentic weekly research refresh, Apex morning scan · 0741, Market update, Morning brief, Claudex sync,
  weekly Claudex compaction, Claude OS · eBay bookkeeper, Claude OS · Sports Hub model watch / game day, App fixer,
  and anything else on later pages.
- Resume point for the next audit run (saves re-reading the 12 above): call the task list with
  cursor `MTc5NDM2ODk2NDQwMDI1MjAwMHxiZDRiNDc2MS04ODBkLTQ4ZjYtYjE4Ny1mNWFkNGI3MjcwYTY=`
  (pages run newest-created first; if the cursor is refused, start from page 1 and skip the names above).

## 2026-11-26 5:47 AM ET audit run — findings (task list read this run; nothing changed)
How the task list behaves (matters for every task that reads it):
- One task-list page holds only about 4 tasks, because each entry carries its full prompt and 13–15 connector
  records. Any task that pages "until it finds X" or "until has_more is false" pays for every prompt on the way.
  Evidence: this run, 3 pages = 12 tasks. This is why fixes 3 and 5 exist.
- The pages arrive inside the conversation, not as saved files as the LAB prompt assumes, so an audit run can
  cover about 12 tasks. The resume cursor above is the workaround.
- This run found no `add_repo` tool (tool search returned nothing). The repo was already cloned and in scope, so
  the run carried on. Other prompts tell their task to stop when add_repo is refused; "not found" is a third
  case none of them names.

Investing and portfolio tasks:
- **Apex v2.9 paper track · 0741** — Fable, weekdays 7:52 AM, paused this week on purpose. Last run Nov 25
  7:53–8:16 AM ET, succeeded. Reads 13 scanner pulls, tradability, daily bars and financials; runs
  `producer/apex-paper.mjs`; publishes `data/apex-paper-v29.json` by its own PR (file on main reads asOf
  2026-11-25 07:55 ET, status ok, 1 cohort); then copies a summary into two Task-storage documents.
  The prompt says the agent "never compute[s] a score, a gate or a level": it fetches, runs code and publishes.
  Cohorts and the rejected-names ledger freeze on Monday only; Tue–Fri it usually sends nothing.
  Model vs rule: Fable is hard to justify for the Tue–Fri operator work. Proposed: fix 1. Jack approved
  "daily research", so the days stay; only the model changes. Risk to weigh: Tue–Fri still does mark and fill
  bookkeeping in python; a Sonnet trial for one week with the tests as the gate would show it.
  Also: the two storage copies (os/apex-paper-v29, os/apex-paper-v29-log) feed no dashboard page; only the
  task's own Tue–Fri "new top-4" comparison reads the log. Candidate to drop once that comparison reads the
  repo file instead.
- **Apex paper run watchdog** — Sonnet, weekdays 8:24 AM, paused. Last run Nov 25, 15 seconds, succeeded.
  Its whole job is one yes/no about the paper track, and it gets it by paging the task list (the paper track
  sits on page 2). Overlap: the paper track already publishes a FAILED marker and the dashboard's paper page
  says STALE. Proposed: fix 3, or fold the check into "Daily relay".
- **Apex buy sheet · 0741** — Sonnet, weekdays 8:05 AM, paused. Reads the morning scan's "buy" cards from Task
  storage, Jack's open orders and live quotes on ••0741; keeps a small ledger; messages only when there is a buy.
  Model fits the rule. Note: it depends on the alert cards as its data route, so the cards are not dead weight
  while this task exists. It is the only one of the three morning buy surfaces that re-checks the live price.
- **Apex morning order ticket line** — no model set, weekdays 8:45 AM, paused; runs inside a standing chat
  session and posts one fixed sentence linking `#apex-ticket` every weekday, whether or not a ticket exists.
  Overlap: buy sheet message (8:05) + this line (8:45) + the dashboard Plan page all present the same buys;
  Apex research itself is Monday only. Proposed: fix 4.
  DASHBOARD LINK TO PROTECT: the line opens `#apex-ticket`; the lab still handles that hash
  (lab/index.html lines 46 and 2087–2097). The navigation pass (Order of work item 5) must keep it working or
  the task's sentence has to change in the same batch.
- **Apex targets copy · Mondays** — Sonnet, Mondays 8:30 AM and 12:30 PM, enabled. Its prompt records that the
  Nov 23 and Nov 25 runs gave up when one tool lookup failed; it was rewritten Nov 25 with fallback routes.
  Last fire Nov 25 3:30 PM ET (off schedule, so started by hand), 18 seconds, "succeeded". Checked the result
  rather than the status: `data/apex-targets.json` on main reads asOf 2026-11-23 07:13 ET, v2.8.1, so this
  week's targets are in the dashboard. The rewritten route is NOT yet proven on a real Monday; Nov 30 is the test.
  Structure: the research is saved to Task storage, then a second task copies it to the repo (two tasks and a
  hop for one file). Proposed (after the Apex morning scan is audited): let the scan open the data PR itself
  and keep this task only as the 12:30 PM safety net (one run a week instead of two).
- **Daily relay** — Sonnet, daily 8:45 AM (same minute as the ticket line), paused. Three jobs in one prompt:
  forward new cards, the Agentic ••3900 watch (two small public files daily; on Mondays the whole task list),
  and an options check that reads option positions on both accounts every day ("most days... adds nothing").
  Model fits. Proposed: fix 5. Its prompt says the Morning brief was switched off Nov 14, while the seed list
  below counts a Morning brief in the weekday overlap: UNVERIFIED which is true; check when that task is reached.

Other tasks on these pages:
- **Operations HQ site refresh** — Fable, daily 7:10 AM, paused. Last run Nov 25, 3 minutes, succeeded. Runs
  `build-ledger`, `resolve`, `validate`, pushes two generated files. The scripts decide what is published.
  Model vs rule: no need for Fable. Proposed: fix 2.
- **League History Lab · daily polish** — Fable, daily 3:23 AM through Nov 30, paused Nov 25 5:37 PM ET. Last
  recorded run Nov 23. No Nov 24 or Nov 25 run is recorded although the pause came after both: two missed fires,
  cause UNVERIFIED. Design work, so Fable is defensible; it ends by itself Nov 30. No fix proposed; just do not
  run it in the same week as another design lab.
- **Sunday game day relay** — Sonnet, Sundays 12:50 PM in season, enabled. Fired Nov 22; the list shows no
  last-run record for it. Exists only to forward cards another task wrote 40 minutes earlier. Proposed (small):
  let "Claude OS · Sports Hub game day" message Jack itself, as the model watch does; saves 1 run a week.
- **Card Vault offer relay** — Sonnet, 12:43 PM and 8:43 PM daily, paused. Last run Nov 25, 19 seconds: ends at
  the first Gmail search when no offer is new. Already cut from 4 runs to 2. No fix proposed.
- **Portfolio LAB · deep review (Thanksgiving)** — Fable, 3 runs a day through Nov 29 (this task). Design
  work on Fable is within the rule. Its audit step assumed saved task-list files (see the first bullet).

Stale wording, retired routes:
- None of these 12 still tries to post to the retired Jarvis channel; each carries the Nov 17 "Strip" note.
  Several prompts repeat that note and its history in full (about half of them). Harmless, but it is paid for on every run;
  one short line would do.
- Privacy note (no action in the repo): some prompts hold full brokerage account numbers because the tools need
  them. Prompts are private; this log and the repo keep to ••0741 / ••3900.

## Seed findings (Claude chat, 2026-11-25, from the scheduled-task list read that day)
- Usage limit already bites: "Claude OS · eBay bookkeeper" (Nov 24 8:17 PM ET run) and "Claude OS · Sports
  Hub model watch" (Nov 24 9:35 PM ET run) both failed with USAGE_LIMIT_REACHED. Evening tasks run after
  a full day of hourly investing jobs.
- Hourly jobs are the largest recurring load: "Portfolio dashboard refresh" (9 runs each weekday) and
  "Agentic executor" (7 runs each weekday). Review whether every hour needs a full run.
- "Portfolio dashboard refresh" was created outside Claude's task tools, so a Claude chat cannot pause or
  edit it; only Jack can. Any change to it waits on him.
- Morning overlap to review (weekdays 7:12–8:45 AM ET): Apex morning scan, Apex v2.9 paper track, Apex buy
  sheet, Market update, Apex paper run watchdog, Daily relay, Apex morning order ticket line, plus the
  Morning brief. Several read the same Robinhood data minutes apart.
- Models in use differ by task (Opus for the Apex morning scan and the weekly Claudex compaction, Fable
  for the paper track, Operations HQ refresh and League History Lab polish, Sonnet for most others).
  Check each against the owner rule: Sonnet by default, stronger models only where needed.
- Several prompts still describe the retired Jarvis page and alert cards as the delivery route.
- "League History Lab · daily polish" last ran Nov 23 (no Nov 24 or Nov 25 run recorded when checked).
