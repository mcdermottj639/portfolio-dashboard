# Audit log — scheduled tasks, models and how they work together (owner request, 2026-11-25)

Jack: "part of these audits should be auditing the scheduling tasks and everything too... how the
schedule and the tasks and everything work together should be audited."

Findings only. Nothing here changes a scheduled task, a prompt, a rule or a model. Each finding: what was
seen, the evidence (task name, date, file), what it costs or risks, and a proposed fix for Jack to approve.
Newest first.

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
