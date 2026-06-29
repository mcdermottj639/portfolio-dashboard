# Producer runbook (scheduled agent)

This is the job that refreshes the dashboard. A scheduled Claude Code agent runs it **3×/day on
weekdays** (market open ~09:30, midday ~12:30, close ~16:00 ET). It pulls live data through the
**Robinhood** (and optionally **Alpha Vantage**) MCP connectors, assembles `data.json`, and pushes
it to the GitHub Pages repo. The phone PWA then loads that `data.json`.

> **Cost discipline (read this).** The expensive part is the price **historicals** (5Y monthly +
> YTD daily for ~36 symbols ≈ 24 of ~30 calls). They barely change, so they are fetched only on
> the **day's first run**; later runs carry them forward from the prior `data.json`. **Step 0
> below (`preflight.mjs`) tells you which mode you're in — always run it first and obey it.**

> **Setting up the schedule?** See [`SCHEDULING.md`](./SCHEDULING.md) for the one-time
> Claude-Code-on-the-web setup (env vars, connectors, trigger, and the exact prompt).

**Secrets.** Two values are needed: the real Robinhood **account number** (for the live MCP
calls) and the dashboard **passphrase** (to encrypt `data.json`). Resolve them in this order:

1. **Environment variables** (preferred — used by the scheduled web runs, see `SCHEDULING.md`):
   `PF_ACCOUNT` = account number, `PF_PASSPHRASE` = passphrase.
2. **`producer/secret.local.json`** (git-ignored, for local/manual runs):
   ```json
   { "account": "<real Robinhood account number>", "passphrase": "<dashboard passphrase>" }
   ```

`PF_PASSPHRASE` is read directly by `build-data.mjs`/`emit.mjs` at build time. The account
number is used only by you (this agent) when calling the Robinhood tools — it never goes into
`data.json` (the keying uses the `ACCT` placeholder).

**Market symbols** — the Markets tab renders a fixed set of benchmark/risk/sector tickers
regardless of what the account holds. These come from `producer/markets.mjs`
(`MARKET_SYMBOLS`) and must be fetched **every run** in addition to the account's own
positions, otherwise the Markets tab shows "—" for everything you don't hold:

```
SPY QQQ DIA IWM            (indexes)
GLD TLT HYG IBIT           (risk gauges)
XLK XLC XLY XLF XLV XLI XLP XLE XLU XLB XLRE   (SPDR sectors)
EFA EEM                    (international: developed ex-US, emerging)
```
(`producer/markets.mjs` `MARKET_SYMBOLS` is the source of truth — keep this list in sync with it.)

**Leader symbols** — the Plan-page Ideal Portfolio (Action Center · Step 4) can recommend a bench of
mega-cap "leaders" beyond what you hold or today's Picks screen, but it needs a live price for each, so
they must also be quoted **every run** (folded into the same `get_equity_quotes` call). These come from
`producer/leaders.mjs` (`LEADER_SYMBOLS`) and `build-data.mjs` emits the list (with sectors) as
`data.leaders`:

```
NVDA MSFT AAPL AVGO ORCL    (Technology)
GOOGL META NFLX             (Communication Services)
AMZN HD                     (Consumer Cyclical)
LLY UNH                     (Healthcare)
JPM V MA                    (Financial Services)
COST WMT PG                 (Consumer Defensive)
XOM                         (Energy)
```
(`producer/leaders.mjs` `LEADER_SYMBOLS` is the source of truth. No historicals needed — quotes only.)

Symbols for **day** history (YTD): top 15 holdings by value + every market symbol above.
Symbols for **month** history (5Y stats): every market symbol above **+ your top 15 holdings**
(the Analyze tab's Multi-Timeframe card uses monthly bars for the holding's monthly trend row;
without them it falls back to the 200-day daily average).

## Steps

Work from the project root: `C:\Users\mcder\OneDrive\Documents\Claude\Projects\Portfolio Dashboard`

0. **Preflight — run this FIRST, before any MCP call:** `node producer/preflight.mjs`. It prints
   `PREFLIGHT <MODE>` on the first line and decides how much work this run needs (from the committed
   `data.json` — `raw/` markers don't persist across the fresh-clone runs). **Obey it:**
   - **`SKIP`** → stop now. Do nothing, fetch nothing, don't run anything else. (Weekend, or today's
     closing snapshot is already taken — a stray off-hours fire ends here for ~zero cost.)
   - **`FETCH_ALL`** → the day's first run. Do the full fetch: steps 1–3c below (historicals,
     fundamentals, AV, picks, options — everything).
   - **`FETCH_LIGHT`** → an intraday/close run. Fetch **only the EVERY-RUN items** (portfolio,
     positions, quotes, VIX, options) and **SKIP the FETCH_ALL-only items** (historicals,
     fundamentals, the AV daily refresh, and the picks rebuild). `build-data.mjs` carries those
     forward from the prior snapshot automatically. Then go straight to step 4.

1. **Create the scratch dir** `producer/raw/` (it is git-ignored, empty on every fresh run).

2. **Call the Robinhood MCP tools** and save each raw result verbatim into `producer/raw/`. The
   **Mode** column says when each is fetched (`FETCH_ALL` runs do all of them; `FETCH_LIGHT` runs
   do only the EVERY-RUN rows):

   | MCP tool | arguments | save raw output to | Mode |
   |---|---|---|---|
   | `mcp__claude_ai_Robinhood__get_portfolio` | `{ account_number: <account> }` | `producer/raw/portfolio.json` | EVERY-RUN |
   | `mcp__claude_ai_Robinhood__get_equity_positions` | `{ account_number: <account> }` | `producer/raw/positions.json` | EVERY-RUN |
   | `mcp__claude_ai_Robinhood__get_portfolio` | `{ account_number: <agentic acct …3900> }` | `producer/raw/agentic-portfolio.json` | EVERY-RUN |
   | `mcp__claude_ai_Robinhood__get_equity_positions` | `{ account_number: <agentic acct …3900> }` | `producer/raw/agentic-positions.json` | EVERY-RUN |
   | `mcp__claude_ai_Robinhood__get_equity_quotes` | `{ symbols: [all position symbols + all market symbols + all leader symbols + agentic-account holdings] }` | `producer/raw/quotes.json` | EVERY-RUN |
   | `mcp__claude_ai_Robinhood__get_equity_historicals` | `{ symbols: [ALL position symbols + all market symbols], interval: "day", start_time: "<Jan 1 this year, ISO>" }` | `producer/raw/hist-day.json` | **FETCH_ALL only** |
   | `mcp__claude_ai_Robinhood__get_equity_historicals` | `{ symbols: [all market symbols + top 15 holdings], interval: "month", start_time: "<5 years ago, ISO>" }` | `producer/raw/hist-month.json` | **FETCH_ALL only** |
   | `mcp__claude_ai_Robinhood__get_index_quotes` | `{ instrument_ids: ["3b912aa2-88f9-4682-8ae3-e39520bdf4db"] }` (VIX) | `producer/raw/index-quotes.json` | EVERY-RUN |

   > ### 🔑 Resolve the agentic account number FIRST (don't skip the agentic-* rows)
   > The agentic account number is **not** in an env var, so before the two `agentic-portfolio.json` /
   > `agentic-positions.json` rows, **call `get_accounts` and use the `account_number` of the account
   > with `agentic_allowed: true`** (the …3900 cash account, nickname "Agentic"). Pass that real number
   > to `get_portfolio` / `get_equity_positions` for those two rows — do **not** treat `<agentic acct
   > …3900>` as a literal or skip the rows because the number "looks missing." Only skip them if
   > `get_accounts` returns **no** `agentic_allowed` account. Also fold that account's holdings into the
   > `get_equity_quotes` symbol list so each gets a live price. (Without this the Agentic Portfolio card
   > shows the target with `$0.00` live holdings — exactly the bug this note prevents.)

   > ### ⚠️ CRITICAL — how to save raw files (or the scheduled run hangs)
   > A scheduled run is unattended: **any command that triggers a permission prompt stalls the
   > whole run forever.** The one thing that prompts is **`cp` with shell variables** (e.g.
   > `BASE=…; cp "$BASE/x" "$RAW/y"`) — shell-variable expansion is flagged unsafe and asks for
   > approval. So:
   > - **Never use `cp`, `mv`, or shell variables** (`$BASE`, `$RAW`, `TDIR=…`) to place raw files.
   > - **Save every result with the `Write` tool**, writing the JSON straight to its path (e.g.
   >   `Write → producer/raw/quotes.json`). Inline-returned results save this way with no prompt.
   > - **Fetch historicals in ≤3-symbol batches** so each result comes back **inline** (small
   >   enough to read) instead of being auto-saved to a temp file you'd have to copy. Then `Write`
   >   each batch to `hist-day-1.json`, `hist-day-2.json`, … / `hist-month-1.json`, …
   > - If a result is *still* too large to read inline, fetch a smaller batch — do **not** copy a
   >   temp file. Following this, a scheduled run completes with zero approval prompts.

   Notes:
   - "all position symbols" = every `symbol` from the positions response.
   - The VIX instrument id above is stable; if it ever 404s, re-resolve it with
     `get_indexes { symbols: "VIX" }` (or `search` asset_type `market_index`). `build-data.mjs`
     turns this quote into the macro card's VIX value — free, every run (AV's VIX is premium).
   - "all market symbols" = the `MARKET_SYMBOLS` list above (indexes + risk gauges + sectors).
   - "top 15" = the 15 positions with the largest market value. Batch historicals **≤3 symbols
     per call** (small → inline → Write, no temp-file copy), saving each as `hist-day-1.json`,
     `hist-day-2.json`, … (and `hist-month-1.json`, … for the monthly series). `build-data.mjs`
     merges all `hist-day*.json` / `hist-month*.json` by symbol.
   - Save the **entire** tool result object as returned (the assembler unwraps
     `structuredContent` / `content[].text` automatically — do not hand-edit it).

2c. **Holdings fundamentals (FETCH_ALL only — skip on `FETCH_LIGHT`, it carries forward)** —
   `mcp__claude_ai_Robinhood__get_equity_fundamentals`
   for the **top 14 holdings by market value** (the same set AV would cover; batch ≤10/call)
   → `producer/raw/holdings-fund.json`. `build-data.mjs` turns these into sector + dividend
   data (synthesized `COMPANY_OVERVIEW`) so **Allocation-by-Sector and Income/Dividends work
   without Alpha Vantage** — AV (when not capped) still overrides with richer growth metrics.

3. **Alpha Vantage — ONCE PER DAY only** (powers Macro Signals + Fundamentals + Earnings).

   > **Prefer the automatic path.** If `ALPHAVANTAGE_KEY` is set in the environment **and**
   > `www.alphavantage.co` is in the network egress allowlist, `run.mjs` calls `av-fetch.mjs`
   > automatically (plain HTTP, no MCP, once per ET day) for macro + company overviews, and you
   > can **skip the manual AV tool calls below entirely**. It never overwrites a good snapshot on
   > a throttle/cap, and respects the 25/day limit. The manual MCP steps below remain the fallback
   > when no key is configured. (Earnings stays on the MCP/agent path — `av-fetch` skips it.)

   No separate API key step (manual path): the **Alpha Vantage MCP connector is already authenticated**
   (same as Robinhood), so you just call the tool. The connector uses a **free** key, capped
   at **25 requests/day**, so AV is *not* fetched on every 15-min run — only on the **first run
   of the trading day**. On every later run, skip this step entirely; the existing
   `producer/raw/av-src/` files are replayed unchanged.

   **Decide whether to fetch:** look at `producer/raw/av-src/.fetched` (a file containing the
   last fetch date in ET, `YYYY-MM-DD`). If it is missing or not today's date, do the daily
   fetch below; otherwise skip to step 4.

   **Daily fetch:**
   1. Print the plan (auto-computes which holdings to cover from the raw files saved in step 2):
      ```
      node producer/av-plan.mjs
      ```
      It lists the calls and confirms the budget. ~19 calls is typical (4 macro — 10yr + 2yr
      Treasury for the 2s10s curve, CPI, Fed Funds — + 1 earnings + up to 14 fundamentals) —
      comfortably under 25.
   2. For each printed line, call the Alpha Vantage MCP tool
      `mcp__claude_ai_AlphaVantage__TOOL_CALL` with `{ tool_name: "<tool>", arguments: "<args JSON>" }`
      and save the **verbatim** result object to the printed path
      `producer/raw/av-src/<id>.json`. **Pace the calls ~1/second** — the free tier throttles
      bursts (a too-fast call comes back with an "Information" rate-limit message instead of data).
   3. Write today's ET date (`YYYY-MM-DD`) into `producer/raw/av-src/.fetched`.

   Notes / known free-tier limits (verified against the live connector):
   - **VIX is premium-only on Alpha Vantage** (`INDEX_DATA` returns "not yet entitled to index
     data access"), so it is **not** fetched from AV. Instead the VIX macro value comes from the
     free **Robinhood** index quote saved in step 2 — no AV call spent on it.
   - The economic indicators return CSV; `COMPANY_OVERVIEW` returns a JSON object — the PWA
     parses both.
   - If AV is unavailable or you skip it, those sections simply show "—"; everything else still
     works. `build-data.mjs` maps the saved files to the correct replay keys automatically
     (no hand-keying) and prints how many AV snapshots it embedded.
   - **News sentiment (OPTIONAL).** If AV budget remains after the required calls, you may
     fetch `NEWS_SENTIMENT { tickers: "<SYM>" }` for a few **top holdings** and save each raw
     result to `producer/raw/news/<SYM>.json`. `build-data.mjs` aggregates these into
     `data.news` for the Analyze tab's News card. It's rate-limited, so this is opt-in and
     never required — the card hides when absent. The **EARNINGS_CALENDAR** call you already
     make powers the Analyze tab's per-ticker Earnings countdown (no extra call needed).
   - **Social / retail sentiment (AUTOMATIC + OPTIONAL boost).** `build-data.mjs` fetches retail
     buzz from **ApeWisdom** (`https://apewisdom.io`, free + keyless) in-process every run — no
     MCP call, no agent action. It powers the Analyze "Social Pulse" card, the Markets "Retail
     Buzz" card, and Action-Feed buzz/crowding alerts. **Requirement:** `apewisdom.io` must be in
     the environment's network **egress allowlist**; if it's blocked the fetch returns nothing and
     all social UI hides gracefully (build still succeeds — it logs `social: ApeWisdom unreachable`).
     *(Optional boost)* You may also save the Robinhood "100 most popular" watchlist items, in
     rank order, to `producer/raw/popular.json` so Social Pulse can show a retail-popularity rank:
     `get_popular_watchlists` → find "100 most popular" (id `e8ef4c1f-244f-4db5-a582-c4c37f3c8e8e`)
     → `get_watchlist_items { id: "<that id>" }` → save raw to `producer/raw/popular.json`. Optional;
     omit it and the rank line simply doesn't show. Social is a SIGNAL layer only — it is **not**
     folded into the Picks composite score.

3b. **Daily Picks — ONCE PER DAY** (the Picks tab). Like AV, only on the day's first run
   (gate on the same `.fetched` date, or a separate `producer/raw/picks-built` marker). Fully
   Robinhood-driven; AV is optional enrichment for the finalists only.
   1. Run the saved scanner and save the result:
      `mcp__claude_ai_Robinhood__run_scan { scan_id: "17e8f5a7-395f-4f22-bba8-f287d39b6e57" }`
      → `producer/raw/scan.json`. (The scan = RSI(14) < 45 AND market cap > $10B — oversold
      large-caps across all sectors, with RSI already a column. Re-create with `create_scan` if
      the id ever 404s; update `SCAN_ID` in `picks.mjs`.)
   2. `node producer/picks-select.mjs` → prints the ~12 most-oversold finalist tickers.
   3. `mcp__claude_ai_Robinhood__get_equity_fundamentals { symbols: [those finalists] }`
      → `producer/raw/picks-fund.json` (P/E, P/B, sector, 52-wk range, dividend).
   4. *(hybrid, optional)* If AV budget remains, call `COMPANY_OVERVIEW` for each finalist and
      save to `producer/raw/av-src/overview-<SYM>.json` (revenue growth + forward P/E). Skip if
      the 25/day cap is hit — scoring degrades gracefully to value-only.
   4b. **For the Analyze tab** — so picks/recommendations are analyzable: `get_equity_quotes`
      and `get_equity_historicals` (interval=day, Jan 1 this year) for the **pick candidate
      tickers + any non-held option-idea underlyings** → `producer/raw/quotes-picks.json` and
      `producer/raw/hist-day-picks.json` (build-data merges all `quotes*.json` / `hist-day*.json`).
   5. `node producer/picks-build.mjs` → writes `producer/raw/picks.json` (scored candidates +
      top 3 with thesis). `build-data.mjs` embeds it as `data.picks`; the dashboard reads it
      directly (the old Kyle note is retired). It **also** emits
      `producer/raw/picks-watchlist.json` (the composite top-10 tickers) — the target for the
      Robinhood watchlist sync in step 5 below.

3c. **Options page** (the Options tab) — **EVERY-RUN** (cheap; run it on `FETCH_LIGHT` too).
   Fully Robinhood-driven; can run every snapshot
   (cheap) or once/day with picks.
   1. `mcp__claude_ai_Robinhood__get_option_orders { account_number: <account> }`
      → `producer/raw/options-orders.json` (pending + history; legs carry strike/type/expiry/premium).
   2. `mcp__claude_ai_Robinhood__get_option_positions { account_number: <account>, nonzero: true }`
      → `producer/raw/options-positions.json` (open contracts; may be empty).
   2b. **Live quotes for YOUR contracts:** collect the `option_id` of every pending order leg
      (from step 1) and every open position (step 2), then `get_option_quotes { instrument_ids:[…] }`
      and save the raw result to `producer/raw/option-pos-quotes.json`. `options-build.mjs` uses
      these for live mark / P&L / Greeks / assignment odds on your positions.
   3. **Live idea premiums:** `node producer/options-plan.mjs` prints the idea contracts to
      price (each with a **target delta** as well as a strike). For each, `get_option_instruments
      { chain_symbol, expiration_dates, type }` → pick the contract nearest the target **delta**
      (fall back to nearest strike) → `get_option_quotes { instrument_ids:[id] }`, and append one
      normalized object to `producer/raw/option-quotes.json` (a JSON array):
      `{ underlying, optionId, strike, expiration, mark, bid, ask, breakeven, iv, delta, theta, vega, gamma, openInterest, volume, popLong }`
      from the quote's `mark_price / bid_price / ask_price / break_even_price / implied_volatility /
      delta / theta / vega / gamma / open_interest / volume / chance_of_profit_long` — and set
      **`optionId` to the instrument UUID you just resolved** (the same id passed to
      `get_option_quotes`); it's the contract the options-watchlist sync (step 6) adds. (Skip if you
      want estimates instead.) Only the single-leg ideas are priced live — the defined-risk
      structures (call debit spread, collar) are estimate-only and need nothing here.
   4. `node producer/options-build.mjs` → writes `producer/raw/options.json`
      (analyzes your contracts — covered/naked, DTE, breakeven, moneyness, full greeks, concrete
      roll suggestions — builds the directional + defined-risk ideas using live quotes when present
      else estimates, and emits the portfolio `exposure` roll-up + `ivObserved`). `build-data.mjs`
      embeds it as `data.options` and maintains the rolling `ivHistory` → `ivRank`. Needs
      `positions.json`, `quotes.json`, and (for ideas) `picks.json`; `hist-day*.json` sharpens
      estimate premiums via realized vol when present.

4. **Build + validate + publish — ONE command.** Once every raw file from steps 2–3c is in
   `producer/raw/`, run the orchestrator. It does everything deterministically (optional AV
   fetch → picks → options → encrypted build → validate → commit → push) with **no improvised
   shell**, so an unattended run can't stall on a permission prompt:
   ```
   node producer/run.mjs "Jun 18 2026, 3:45 PM ET"
   ```
   where the argument is the snapshot label shown in the phone's freshness bar. `PF_PASSPHRASE`
   must be set in the environment (it is, for scheduled runs) — `run.mjs` **refuses to push** a
   plaintext `data.json`, so holdings can't leak even if the passphrase is missing. The repo is
   public; the passphrase lives only in the environment, never in git.

   What `run.mjs` does, in order (each step guarded — a missing optional input is skipped, a hard
   failure aborts **before** any commit):
   - **Market gate** — deterministic US-session check (Mon–Fri 09:30–16:00 ET). By default it
     builds + pushes anyway so social/news stay fresh; pass `--require-open` to skip when closed.
   - **Alpha Vantage** (optional) — if `ALPHAVANTAGE_KEY` is set, `av-fetch.mjs` pulls macro +
     fundamentals over plain HTTP (no MCP call), once per ET day. See step 3's AV note.
   - **picks-build / options-build** — run only if their raw inputs exist.
   - **build-data** — writes the encrypted `data.json`. Optional owner editorial: a hand-maintained
     `producer/notes.json` (a plain string, or `{ "risk": "…" }`) is embedded as `data.notes` and
     rendered in the dashboard's Risk card; absent → carried forward from the prior snapshot, so it
     persists across fresh-clone runs like `realized.json`/picks.
   - **validate** — replay-contract sanity check (warn-only).
   - **commit + push** — only if `data.json` actually changed; retries the push with backoff.

   Useful flags: `--no-push` (dry run / local build), `--no-av` (skip the AV fetch), `--require-open`.
   Only `data.json` changes on a normal run; GitHub Pages serves it within a minute (the PWA's
   service worker is network-first for `data.json`, so the next open shows it).

5. **Sync the Picks watchlist — FETCH_ALL only, best-effort, AFTER `run.mjs` succeeds.** This is the
   *one* place the producer **writes** to Robinhood (everything else is read-only). It keeps a custom
   watchlist — **"Dashboard Top 10 Picks"** (`list_id 3f8c0634-f4ac-4265-8824-85e25bae4886`) — in step
   with the Picks tab's composite top 10. Run it only if `producer/raw/picks-watchlist.json` exists
   (it's written by `picks-build.mjs`, so present on FETCH_ALL and absent on FETCH_LIGHT — on a light
   run the picks carried forward and the list is already correct, so do nothing).

   1. Read the live list: `get_watchlist_items { list_id: "3f8c0634-f4ac-4265-8824-85e25bae4886" }`
      and **`Write` the raw result to `producer/raw/watchlist-current.json`**.
      - If that call **404s** (the list was deleted), call
        `create_watchlist { display_name: "Dashboard Top 10 Picks", icon_emoji: "📈", display_description: "Auto-synced daily from the portfolio dashboard's top 10 oversold picks." }`,
        note the new `list_id`, and `Write` `{"items":[]}` to `producer/raw/watchlist-current.json`.
        Use the **new** id for the add call below (and update `WATCHLIST_ID` in `picks.mjs` next code change).
   2. `node producer/sync-watchlist.mjs` → prints the deterministic diff: a `LIST <id>` line plus
      `ADD <syms…>` / `REMOVE <syms…>` (or `IN SYNC`). It only *prints* — it never calls Robinhood.
   3. Execute exactly what it printed, using that list_id:
      - `ADD …`    → `add_to_watchlist { list_id, symbols: [those tickers] }`
      - `REMOVE …` → `remove_from_watchlist { list_id, symbols: [those tickers] }`
      - `IN SYNC` / `NO-OP` → nothing to do.

   This step is **best-effort and must never gate the run**: `data.json` is already published by the
   time it runs, so if a watchlist call fails (e.g. the connector lacks write approval and returns a
   403/404, or any blip), **just stop — do not retry, do not improvise git/MCP recovery**. The list
   simply re-syncs on the next FETCH_ALL run. (Writes were verified to go through unattended; a hard
   403/404 means the Robinhood connector needs write/"always allow" approval re-granted.)

6. **Sync the options watchlist — FETCH_ALL only, best-effort, AFTER `run.mjs` succeeds.** Same idea
   as step 5 but for the Options tab's single-leg Trade Ideas (long calls, covered calls, cash-secured
   puts). The account has **one** options watchlist (the tools take no `list_id`); `options-build.mjs`
   wrote the desired contracts to `producer/raw/option-watchlist.json` — present only on FETCH_ALL and
   only for ideas that resolved to a live contract UUID this run (estimate-only and the multi-leg
   debit-spread/collar structures are excluded — the watchlist holds single-leg contracts). Run this
   only if that file exists.

   1. Read the live list: `get_option_watchlist` (no args) and **`Write` the raw result to
      `producer/raw/option-watchlist-current.json`**. (If it errors with "no options watchlist found",
      options trading isn't enabled — skip this whole step.)
   2. `node producer/sync-option-watchlist.mjs` → prints `ADD <option_ids…>` / `REMOVE <option_ids…>`
      (or `IN SYNC`). It only *prints* — it never calls Robinhood.
   3. Execute what it printed, **always with `position_type: "long"`** (the watchlist read-back doesn't
      expose side, so the producer adds/removes long-only for a deterministic diff):
      - `ADD …`    → `add_option_to_watchlist    { option_ids: [those ids], position_type: "long" }`
      - `REMOVE …` → `remove_option_from_watchlist { option_ids: [those ids], position_type: "long" }`
      - `IN SYNC` / `NO-OP` → nothing to do.

   Best-effort, same rule as step 5: `data.json` is already published, so on any failure **just stop**
   — it re-syncs next FETCH_ALL. (Verified end-to-end against the live account: add → read-back →
   remove all succeed unattended.)

7. **Weekly agentic-account research + rebalance alert (best-effort, post-publish, FETCH_ALL only).**
   The agentic cash account (••••3900) target is the output of the deep multi-factor research, refreshed
   ~weekly. After the watchlist syncs:
   1. `node producer/agentic-due.mjs` → `AGENTIC_DUE` (exit 0) or `AGENTIC_NOT_DUE` (exit 20). If NOT_DUE,
      **skip the rest of this step** — the committed target is still fresh (~zero cost).
   2. If DUE: assemble a fresh candidate **universe** — the day's oversold scan finalists (`scan.json` via
      `picks.mjs`) + the `leaders.mjs` mega-cap bench + current ••••3900 holdings (`agentic-positions.json`),
      with live quotes/fundamentals for sector/PE/52wk → `[{t,sec,px,pe,hi,lo}]`.
   3. Run the **`agentic-research`** workflow (`.claude/workflows/agentic-research.js`) with
      `args:{ universe:<that list>, book:<••••3900 equity from agentic-portfolio.json> }`.
   4. Write its `allocation` to **`producer/agentic-target.json`** (shape per `AGENTIC.md`: names with
      ticker/sector/weightPct/entry/stop/target/thesis; `asOf` = today ET, `book`, `driftTriggerPp` 5), then
      `git add producer/agentic-target.json && git commit && git push origin main` (next run's
      `build-data.mjs` embeds it as `data.agentic.target`).
   5. Compute drift vs the new target from the live ••••3900 holdings, apply the **Tax & regulation rules**
      in `AGENTIC.md` (cash-flow-first, wash-sale-safe, short-term-gain-aware, sells-before-buys); if
      anything is actionable, **`PushNotification`** the owner the proposed rebalance ticket.
   6. **Place NOTHING** — execution is alert & one-tap-confirm; the owner confirms in a session.

   Best-effort, same rule as steps 5–6: `data.json` is already published, so on ANY failure (workflow
   error, rate-limit, push blip) **just stop** — the existing target stands and it retries next week. This
   step NEVER gates the core publish. Full flow + tax/reg rules: `AGENTIC.md`.

## Failure handling
- `run.mjs` aborts (no commit) if the core `portfolio.json`/`positions.json` are missing, if the
  build fails, or if `data.json` came out unencrypted while `PF_PASSPHRASE` is set. A stale
  snapshot is always preferred over a broken one — the freshness bar shows the data is old.
- If a Robinhood call fails during fetching, stop there (don't run `run.mjs`); keep the last good
  `data.json`.
- **If `run.mjs` exits non-zero — including a push failure (403 / proxy / egress) — STOP.** Do not
  attempt manual git recovery, alternate push methods (GitHub MCP, etc.), branch surgery, or file
  searches. A failed push is almost always a transient proxy/egress blip; the build is fine and the
  next scheduled run republishes. Improvising here just stalls the unattended run on permission
  prompts — exactly what we avoid.
- The **freshness watchdog** (`.github/workflows/freshness.yml`) opens a GitHub issue if
  `data.json` goes >3h without a refresh during market hours, and auto-closes it on recovery — so
  a stalled run never goes unnoticed.

