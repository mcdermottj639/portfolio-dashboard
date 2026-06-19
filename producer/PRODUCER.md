# Producer runbook (scheduled agent)

This is the job that refreshes the dashboard. A scheduled Claude Code agent runs it every
~15 minutes during US market hours. It pulls live data through the **Robinhood** (and
optionally **Alpha Vantage**) MCP connectors, assembles `data.json`, and pushes it to the
GitHub Pages repo. The phone PWA then loads that `data.json`.

**Secrets** live in `producer/secret.local.json` (git-ignored, never committed):
```json
{ "account": "<real Robinhood account number>", "passphrase": "<dashboard passphrase>" }
```
Read `account` and `passphrase` from there. Symbols for history: **top 15 holdings by value + SPY + QQQ**.

## Steps

Work from the project root: `C:\Users\mcder\OneDrive\Documents\Claude\Projects\Portfolio Dashboard`

1. **Create the scratch dir** `producer/raw/` (it is git-ignored; overwrite each run).

2. **Call the Robinhood MCP tools** and save each raw result verbatim into `producer/raw/`:

   | MCP tool | arguments | save raw output to |
   |---|---|---|
   | `mcp__claude_ai_Robinhood__get_portfolio` | `{ account_number: <account> }` | `producer/raw/portfolio.json` |
   | `mcp__claude_ai_Robinhood__get_equity_positions` | `{ account_number: <account> }` | `producer/raw/positions.json` |
   | `mcp__claude_ai_Robinhood__get_equity_quotes` | `{ symbols: [all position symbols] }` | `producer/raw/quotes.json` |
   | `mcp__claude_ai_Robinhood__get_equity_historicals` | `{ symbols: [top15 + "SPY","QQQ"], interval: "day", start_time: "<Jan 1 this year, ISO>" }` | `producer/raw/hist-day.json` |

   Notes:
   - "all position symbols" = every `symbol` from the positions response.
   - "top 15" = the 15 positions with the largest market value. If you must batch
     historicals (≤10 symbols/call), save each batch as `hist-day-1.json`, `hist-day-2.json`, …
   - Save the **entire** tool result object as returned (the assembler unwraps
     `structuredContent` / `content[].text` automatically — do not hand-edit it).

3. **(Optional) Alpha Vantage** — only if you want fundamentals/macro live. Skipped by
   default to avoid free-tier rate limits; those sections degrade to "unavailable" without it.
   If included, save each raw AV response to `producer/raw/av/<key>.json` where `<key>` is the
   URL-encoded string `mcp__4ae6f0d3-5112-4955-94dc-c6bea90e45dd__TOOL_CALL|{...stable-args...}`.
   (See `key.mjs` — easier to add later with a small helper than by hand.)

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
