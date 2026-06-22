# Scheduling the producer (Claude Code on the web)

The dashboard only refreshes when the **producer** runs and pushes a new `data.json`. The
producer needs the **Robinhood + Alpha Vantage connectors**, which only exist inside Claude —
so it can't run as a plain GitHub Action or OS cron. The durable home is a **scheduled run on
Claude Code on the web**, which already has the connectors.

Docs: https://code.claude.com/docs/en/claude-code-on-the-web (environments, triggers, schedules).

## One-time setup

### 1. Set environment variables (secrets)
In the web environment for this repo, add two environment variables (these live in the
environment config — never in git, never in a prompt):

| Variable | Value |
|---|---|
| `PF_ACCOUNT` | your real Robinhood account number |
| `PF_PASSPHRASE` | your dashboard passphrase (same one you type on the phone) |

The producer reads these automatically (see `PRODUCER.md` → Secrets). `data.json` is encrypted
with `PF_PASSPHRASE`; the account number is only used for the live Robinhood calls and never
ships in `data.json`.

### 2. Attach the connectors
Make sure the environment has the **Robinhood** and **Alpha Vantage** MCP connectors enabled
(the same ones used to build this). Without Robinhood the run aborts; without Alpha Vantage the
macro/fundamentals sections degrade to "—" (everything else still works).

### 3. Create a scheduled trigger
Add a **schedule** that starts a session on `main` **hourly during US market hours** on weekdays,
running the prompt below. The producer's market-hours guard skips any fire when the market is
closed, so the *exact* anchor time is cosmetic — pick whichever is least effort:

- **Simplest (no CLI):** the web **hourly** preset. It updates every hour the market is open; the
  first fresh snapshot each day lands on the first fire after the 09:30 ET open.
- **Pinned to the top of the hour (custom cron via `/schedule update`):** `0 9-16 * * 1-5` in
  **America/New_York** — first run 09:00 ET, then hourly through the 16:00 close, Mon–Fri. The web
  preset list can't express a fixed start time, so this needs the CLI's `/schedule update`.
  Note: the cash market opens at 09:30, so the 09:00 fire no-ops (guard) and the first live
  snapshot posts at 10:00; use `30 9-16 * * 1-5` instead if you want a push right at the 09:30 open.
- **UTC-only cron fallback:** `0 13-20 * * 1-5` (09:00 ET in EDT); widen to `0 13-21 * * 1-5` to
  also cover EST. Off-hours fires no-op via the guard.

### 4. The trigger prompt
Use exactly this as the scheduled prompt:

> Run the portfolio dashboard producer by following `producer/PRODUCER.md` exactly. First check
> whether US equity markets are open right now — if they're closed, stop without pushing. If
> open: pull the live Robinhood data, do the once-per-day Alpha Vantage refresh only if
> `producer/raw/av-src/.fetched` isn't today's date, fetch the VIX index quote, build the
> **encrypted** `data.json` (`PF_PASSPHRASE` is set in the environment), run `validate.mjs`, and
> commit + push `data.json` to `main`. If any Robinhood call fails, abort without pushing.

## Verify it's working
- **Commits:** `data.json` on `main` should get a new commit roughly hourly during market hours,
  starting ~09:30 ET (GitHub → repo → commits, or `list_commits` filtered to `data.json`).
- **Phone:** open the app and pull-to-refresh — the freshness bar ("📡 Snapshot: …") should show
  a recent time. `data.json` is network-first, so a refresh always pulls the latest.
- **First run:** trigger the schedule once manually (don't wait for market hours) to confirm the
  env vars + connectors are wired; it will run end-to-end and push.

## Notes
- **Cost/limits:** Robinhood runs every fire; Alpha Vantage is gated to once/day (~18 calls,
  under the free 25/day cap — see `av-plan.mjs`). VIX comes free from Robinhood.
- **Off-hours:** the prompt's market-hours guard means extra cron fires are no-ops, so a slightly
  wide window is fine.
- **Stale is safe:** if a run fails it pushes nothing and the phone keeps the last good snapshot;
  the freshness bar will simply show it's old.
