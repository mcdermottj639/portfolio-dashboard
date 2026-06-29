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
Run **every ~30 minutes during market hours on weekdays.** This is cheap by design: `preflight.mjs`
makes the **day's first run** a full fetch (the heavy price history) and **every run after** a *light*
run that carries the history forward — so only one run/day is expensive and the rest are nearly free.
The 30-minute cadence keeps prices/values current intraday (including the Agentic Portfolio card, which
re-prices its holdings on every run). Set this in **America/New_York**:

- **`*/30 9-16 * * 1-5`** — every 30 min, ~09:00–16:30 ET, weekdays. The day's first fire is the full
  fetch; the rest are light. If the UI allows, nudge off the `:00`/`:30` marks (e.g. `2,32 9-16 * * 1-5`)
  so fleet-wide fires don't cluster.

UTC fallback (no per-trigger TZ; EDT = ET+4, add an hour in EST): `*/30 13-20 * * 1-5`.

**Stray/extra fires are safe and nearly free:** `preflight.mjs` returns `SKIP` on weekends and once the
day's closing snapshot is already captured, so the agent stops immediately without fetching — a wide
window or a few extra fires costs almost nothing.

> **Lighter alternative (3×/day):** if you'd rather minimize runs, open/midday/close also works —
> `30 9 * * 1-5`, `30 12 * * 1-5`, `0 16 * * 1-5` ET (three triggers) — at the cost of less-frequent
> intraday price/value updates.

### 4. The trigger prompt
Use exactly this as the scheduled prompt:

> Run the portfolio dashboard producer by following `producer/PRODUCER.md` exactly. **First run
> `node producer/preflight.mjs` and obey its directive:** if it prints `SKIP`, stop immediately and
> do nothing; if `FETCH_ALL`, do the full fetch (steps 1–3c); if `FETCH_LIGHT`, fetch only the
> EVERY-RUN items (portfolio, positions, quotes, VIX, options) and skip historicals, fundamentals,
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
> ••••3900 cash account — but **place no orders** (alert & one-tap-confirm). If `AGENTIC_NOT_DUE` or
> anything fails, just end the session; it never gates the run and retries next week.

> **Note (existing trigger):** the agentic step lives in `PRODUCER.md`, so any trigger whose prompt says
> "follow `producer/PRODUCER.md` exactly" picks it up with **no change needed**. If your live trigger
> uses an older prompt that doesn't, re-paste the prompt above once.

`preflight.mjs` owns the run-mode decision (deterministic, from the committed `data.json`), and
`run.mjs` won't push a plaintext or broken `data.json` — so the agent makes no judgment calls about
market hours or how much to fetch.

## Verify it's working
- **Commits:** `data.json` on `main` should get a new commit **every ~30 min during market hours**,
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
