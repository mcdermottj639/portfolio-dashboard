# Producer runbook (scheduled agent)

This is the job that refreshes the dashboard. A scheduled Claude Code agent runs it every
~15 minutes during US market hours. It pulls live data through the **Robinhood** (and
optionally **Alpha Vantage**) MCP connectors, assembles `data.json`, and pushes it to the
GitHub Pages repo. The phone PWA then loads that `data.json`.

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
```

Symbols for **day** history (YTD): top 15 holdings by value + every market symbol above.
Symbols for **month** history (5Y stats): every market symbol above.

## Steps

Work from the project root: `C:\Users\mcder\OneDrive\Documents\Claude\Projects\Portfolio Dashboard`

1. **Create the scratch dir** `producer/raw/` (it is git-ignored). Overwrite the Robinhood
   files each run, but **leave `producer/raw/av-src/` in place** — that holds the once-a-day
   Alpha Vantage snapshot (step 3) which is reused across intra-day runs.

2. **Call the Robinhood MCP tools** and save each raw result verbatim into `producer/raw/`:

   | MCP tool | arguments | save raw output to |
   |---|---|---|
   | `mcp__claude_ai_Robinhood__get_portfolio` | `{ account_number: <account> }` | `producer/raw/portfolio.json` |
   | `mcp__claude_ai_Robinhood__get_equity_positions` | `{ account_number: <account> }` | `producer/raw/positions.json` |
   | `mcp__claude_ai_Robinhood__get_equity_quotes` | `{ symbols: [all position symbols + all market symbols] }` | `producer/raw/quotes.json` |
   | `mcp__claude_ai_Robinhood__get_equity_historicals` | `{ symbols: [top15 + all market symbols], interval: "day", start_time: "<Jan 1 this year, ISO>" }` | `producer/raw/hist-day.json` |
   | `mcp__claude_ai_Robinhood__get_equity_historicals` | `{ symbols: [all market symbols], interval: "month", start_time: "<5 years ago, ISO>" }` | `producer/raw/hist-month.json` |
   | `mcp__claude_ai_Robinhood__get_index_quotes` | `{ instrument_ids: ["3b912aa2-88f9-4682-8ae3-e39520bdf4db"] }` (VIX) | `producer/raw/index-quotes.json` |

   Notes:
   - "all position symbols" = every `symbol` from the positions response.
   - The VIX instrument id above is stable; if it ever 404s, re-resolve it with
     `get_indexes { symbols: "VIX" }` (or `search` asset_type `market_index`). `build-data.mjs`
     turns this quote into the macro card's VIX value — free, every run (AV's VIX is premium).
   - "all market symbols" = the `MARKET_SYMBOLS` list above (indexes + risk gauges + sectors).
   - "top 15" = the 15 positions with the largest market value. If you must batch
     historicals (≤10 symbols/call), save each batch as `hist-day-1.json`, `hist-day-2.json`, …
     (and `hist-month-1.json`, `hist-month-2.json`, … for the monthly series).
   - Save the **entire** tool result object as returned (the assembler unwraps
     `structuredContent` / `content[].text` automatically — do not hand-edit it).

3. **Alpha Vantage — ONCE PER DAY only** (powers Macro Signals + Fundamentals + Earnings).
   No separate API key step: the **Alpha Vantage MCP connector is already authenticated**
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
      It lists the calls and confirms the budget. ~18 calls is typical (3 macro + 1 earnings +
      up to 14 fundamentals) — comfortably under 25.
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
   5. `node producer/picks-build.mjs` → writes `producer/raw/picks.json` (scored candidates +
      top 3 with thesis). `build-data.mjs` embeds it as `data.picks`; the dashboard reads it
      directly (the old Kyle note is retired).

4. **Build** `data.json` — **with the passphrase set** so the output is encrypted:
   ```
   PF_PASSPHRASE="<the dashboard passphrase>" node producer/build-data.mjs "<label>"
   ```
   where `<label>` is the snapshot time in market terms, e.g. `Jun 18 2026, 3:45 PM ET`
   (shown in the phone's freshness bar). The repo is public, so **always set PF_PASSPHRASE**
   on real runs — without it the file is written as plaintext (holdings exposed).
   The passphrase must match what you type on the phone. Keep it out of git
   (it lives in the scheduled job's environment, not in any committed file).

5. **Sanity check** (optional but recommended): `node producer/validate.mjs` — should print
   "replay contract is valid ✅".

6. **Publish**:
   ```
   git add data.json
   git commit -m "data: snapshot <label>"
   git push
   ```
   Only `data.json` changes on a normal run. GitHub Pages serves the new file within a minute;
   the PWA's service worker is network-first for `data.json`, so the next open shows it.

## Failure handling
- If a Robinhood call fails, abort without pushing (keep the last good `data.json`). A stale
  snapshot is better than a broken one — the freshness bar will show the data is old.
- Markets are closed → either skip the run or push once; prices won't change.
