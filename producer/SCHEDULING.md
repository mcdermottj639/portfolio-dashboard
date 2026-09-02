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
| `ALPHAVANTAGE_KEY` | *(optional)* your free Alpha Vantage key — enables the automatic HTTP AV fetch (no MCP). Also add `www.alphavantage.co` to the **Allowed domains** list. |
| `PF_AV_NEWS` | *(optional)* comma-separated tickers for AV news sentiment, e.g. `NVDA,IREN`. |

The producer reads these automatically (see `PRODUCER.md` → Secrets). `data.json` is encrypted
with `PF_PASSPHRASE`; the account number is only used for the live Robinhood calls and never
ships in `data.json`. **Social buzz** (ApeWisdom) is keyless — just add `apewisdom.io` to the
Allowed domains list and it's fetched automatically.

### 2. Attach the connectors
Make sure the environment has the **Robinhood** and **Alpha Vantage** MCP connectors enabled
(the same ones used to build this). Without Robinhood the run aborts; without Alpha Vantage the
macro/fundamentals sections degrade to "—" (everything else still works).

### 3. Create a scheduled trigger
**What's actually live (as of 2026-08-11): the "Portfolio dashboard refresh" Routine, cron
`35 * * * *` UTC — HOURLY, every day.** The Routine scheduler's minimum interval is one hour, so the
30-minute cadence this section originally specified isn't expressible in a single trigger there;
hourly is the deliberate compromise. It works because runs are cheap by design: `preflight.mjs`
makes the **day's first run** a full fetch (the heavy price history) and **every run after** a *light*
run that carries the history forward — and it `SKIP`s nights/weekends/holidays outright, so the
24/7 `35 * * * *` shape costs ~nothing outside market hours. The freshness watchdog alarms at
**>90 min** while the market is open, so hourly leaves one-miss tolerance: a single failed run opens
an issue (that's the watchdog doing its job), two consecutive ones mean go look.

If you ever want the original 30-min intraday cadence back, add a **second** hourly trigger offset
by 30 minutes (e.g. `5 13-20 * * 1-5` UTC alongside the `:35`) — same prompt; preflight makes the
extra fires light/skips. A scheduling surface with a true 30-min interval can use the original spec:

- **`*/30 9-16 * * 1-5`** in **America/New_York** — every 30 min, ~09:00–16:30 ET, weekdays. If the
  UI allows, nudge off the `:00`/`:30` marks (e.g. `2,32 9-16 * * 1-5`) so fleet-wide fires don't
  cluster. UTC fallback (EDT = ET+4, add an hour in EST): `*/30 13-20 * * 1-5`.

**Stray/extra fires are safe and nearly free:** `preflight.mjs` returns `SKIP` on weekends, on NYSE
full-closure holidays (hardcoded calendar in `market.mjs` — extend it annually), and once the day's
closing snapshot is already captured (13:00 on half-days), so the agent stops immediately without
fetching — a wide window or a few extra fires costs almost nothing.

> **Lighter alternative (3×/day):** if you'd rather minimize runs, open/midday/close also works —
> `30 9 * * 1-5`, `30 12 * * 1-5`, `0 16 * * 1-5` ET (three triggers) — at the cost of less-frequent
> intraday price/value updates.

### 4. The trigger prompt
Use exactly this as the scheduled prompt:

> Run the portfolio dashboard producer by following `producer/PRODUCER.md` exactly. **First run
> `node producer/preflight.mjs` and obey its directive:** if it prints `SKIP`, stop immediately and
> do nothing; if `FETCH_ALL`, do the full fetch (steps 1–3c); if `FETCH_LIGHT`, fetch only the
> EVERY-RUN items — **both accounts'** portfolio + positions (your main account **AND** the ••••3900
> agentic cash account, resolved via `get_accounts` → `agentic-portfolio.json`/`agentic-positions.json`),
> plus quotes, VIX, options — and skip historicals, fundamentals,
> the Alpha Vantage refresh and the picks rebuild. `Write` each raw result into `producer/raw/` —
> never use `cp`/`mv`/shell variables. If any Robinhood call fails, stop without building. Then run
> **`node producer/run.mjs "<label>"`** (label = current time like `Jun 23 2026, 12:30 PM ET`),
> which handles the build, encryption, validation and the commit + push to `main`. Don't run those
> steps by hand. **If `run.mjs` exits non-zero (e.g. a build error or a push 403), STOP — do NOT
> attempt any manual git recovery, alternate push methods, branch surgery, or file searches. A
> failed push is almost always a transient proxy/egress blip; the next scheduled run republishes.
> End the session.** Finally, if (and only if) `run.mjs` succeeded **and** the FETCH_ALL sidecars
> exist, do the two best-effort Robinhood **watchlist syncs** (per `PRODUCER.md` steps 5–6): (a) if
> `producer/raw/picks-watchlist.json` exists, sync the **"Dashboard Top 10 Picks"** equity list — read
> it (`get_watchlist_items`), run `node producer/sync-watchlist.mjs`, execute the `ADD`/`REMOVE`; (b)
> if `producer/raw/option-watchlist.json` exists, sync the **options** watchlist — read it
> (`get_option_watchlist`), run `node producer/sync-option-watchlist.mjs`, execute the `ADD`/`REMOVE`
> with `position_type: "long"`. Both are best-effort — if any watchlist call fails, just end the
> session (each list re-syncs next FETCH_ALL run). Lastly, on FETCH_ALL only, do the best-effort
> **weekly agentic-account step** (`PRODUCER.md` step 7): run `node producer/agentic-due.mjs`; if it
> prints `AGENTIC_DUE`, refresh `producer/agentic-target.json` via the **`agentic-research`** workflow
> (commit + push it), then compute drift and **`PushNotification` me a rebalance proposal** for the
> ••••3900 cash account — but **place no orders** (alert, then the owner's confirm). If `AGENTIC_NOT_DUE` or
> anything fails, just end the session; it never gates the run and retries next week. Also, on EVERY
> run where `run.mjs` succeeded: read `producer/raw/alerts.json` (written by the build) and, if its
> `alerts` array is non-empty, **`PushNotification` me one message** with each alert's `msg` on its
> own line (level crossings — stop/target/TP/big day move; see `PRODUCER.md` step 8). Empty → skip.

> **Note (existing trigger):** the agentic step lives in `PRODUCER.md`, so any trigger whose prompt says
> "follow `producer/PRODUCER.md` exactly" picks it up with **no change needed**. If your live trigger
> uses an older prompt that doesn't, re-paste the prompt above once.

`preflight.mjs` owns the run-mode decision (deterministic, from the committed `data.json`), and
`run.mjs` won't push a plaintext or broken `data.json` — so the agent makes no judgment calls about
market hours or how much to fetch.

### 5. Routine configuration that lives server-side (not in git)
**Three Routines drive this repo, and roughly half of what makes each one work is not in this
repository at all.** A Routine's prompt, its connectors, its `allowed_tools`, its model, whether it
resumes a session or starts fresh, and whether it can push a notification are all stored server-side.
Shipping code here does **not** change any of them. This section is the record of what each one should
be set to; re-check it whenever a Routine misbehaves, because the failure mode is silent.

| | **Portfolio dashboard refresh** | **Agentic weekly research** | **Agentic executor** |
|---|---|---|---|
| Cron (UTC) | `35 * * * *` | `12 11 * * 1` | `20 14-20 * * 1-5` |
| Connectors | Robinhood + Alpha Vantage | Robinhood + Alpha Vantage | Robinhood |
| Session | fresh per fire (already) | fresh per fire (already; prompt rewritten 2026-09-02) | **fresh per fire** — replacement trigger created 2026-09-02, DISABLED until Robinhood is attached to it in the UI; the persistent one runs until then |
| Model | *unset* — served by `claude-sonnet-5` on 09-02; **the owner should pin it** | `claude-opus-5` | `claude-opus-5` |
| Permission mode | `auto` | `auto` | `auto` |
| `allowed_tools` | `preset:default` + `PushNotification` + `Skill` | same | same |
| Push notifications | on | **on** | **on** |
| Repo source | this repo (session config) | none — the prompt's step 0 clones it | none — the prompt's step 0 clones it |

**Connectors and `allowed_tools` are set ONLY in the claude.ai Routine UI.** The Routines API in this
org rejects a `connectors` parameter outright, and `update_trigger` can change the prompt, schedule,
name, enabled state and model but not the tool surface — so a session can fix a prompt and *cannot*
fix a missing connector. That distinction cost seven weeks of research: the weekly research
Routine was created with **no Robinhood or Alpha Vantage connector and no repo source**, so it had
never once produced a target — every `agentic-target.json` in git came from an interactive session.
For the producer Routine specifically: its `allowed_tools` can only be edited in that UI, so if it
starts prompting for permission mid-run, that is where to go.

**Never enumerate MCP tool names in `allowed_tools`.** The full name carries a session-specific server
id (`mcp__1ad8dd47-…__get_portfolio` today, something else tomorrow), so a pinned list matches nothing
on the next fire and every broker call becomes a permission prompt. `preset:default` plus the
connector attachment is the durable form. Same reason `PRODUCER.md` writes tools as `Robinhood ·
get_portfolio`.

**`SUCCEEDED` proves a Routine RAN, never that it DID anything.** A Routine that exits cleanly on a
gate reports exactly the same status as one that did the whole job — `agentic-due.mjs` printing
`AGENTIC_NOT_DUE` is a clean exit, and so is a run that found no connector and gave up. Two checks
cost nothing and separate them:
- **Duration.** `finished_at - fired_at`. A 60-name research pipeline cannot run in 109 seconds.
- **The artifact.** Did the commit the run exists to produce actually land? No commit to
  `agentic-target.json` on a research day means no research happened, whatever the status says.

**`ALPHAVANTAGE_KEY` unset costs ~19 manual MCP calls per FETCH_ALL.** With the key, the AV fetch is a
direct HTTP call from `av-fetch.mjs` and the agent does nothing; without it, the agent has to make each
`TOOL_CALL` by hand through the connector (`PRODUCER.md` step 3), which is slower, burns turns, and is
the most likely thing to stall an unattended run.

## Verify it's working
- **Commits:** `data.json` on `main` should get a new commit **hourly during market hours** (~:35
  UTC fire + a few minutes of work; every ~30 min only if the optional second offset trigger is added),
  starting with the day's first run (GitHub → repo → commits, or `list_commits` filtered to `data.json`).
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
