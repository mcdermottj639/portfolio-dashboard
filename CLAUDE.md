# CLAUDE.md — Portfolio Dashboard

Orientation for future Claude sessions. Read this first. Deep producer detail lives in
`producer/PRODUCER.md` (runbook) and `producer/SCHEDULING.md` (the scheduled job).

> ## 📌 Standing rule — keep this file current
> **Whenever you change the architecture, build pipeline, data model, scheduling, or add/remove a
> feature, update the relevant section of this file in the SAME change** (and bump the version note
> below if `index.html`/`sw.js` changed). Future sessions rely on this file being accurate — don't
> wait to be asked. If you touch the producer flow, also check `PRODUCER.md`/`SCHEDULING.md` stay in
> sync. A quick self-check before finishing: did anything here go stale (file paths, the composite
> weights, the version, the feature list)? Fix it now.

## What this is
A personal **portfolio dashboard PWA** served as a **static site on GitHub Pages**
(`https://mcdermottj639.github.io/portfolio-dashboard/`). The repo is **public**, so all holdings
live in an **encrypted** `data.json`; the user types a passphrase on the phone to unlock it.

It is a **producer / consumer split**:
- **Consumer** = `index.html` (one big file: inline CSS + one large inline `<script>`). It's dumb —
  it loads `data.json`, decrypts it, and renders. No backend. It also has a `window.cowork` **replay
  shim** (~line 448) that answers `callMcpTool(...)` from the snapshot (`data.quotes`, `data.hist`,
  `data.recorded`) so the same code works live-in-Claude and as a static phone app.
- **Producer** = a **scheduled Claude Code agent** (the only thing that can reach the Robinhood +
  Alpha Vantage MCP connectors, which are auth'd to the user's Claude account). It fetches live data,
  builds the encrypted `data.json`, and pushes it to `main`. GitHub Pages serves it.

**Robinhood has no public API key** — it's only reachable via the MCP connector inside a Claude
session. That's *why* there's a scheduled agent and not a plain cron. Don't propose moving the
producer to a credentialed cron unless the user explicitly accepts storing RH login secrets.

> **Optional credentialed path (Railway).** `producer/railway/` + `producer/RAILWAY.md` document an
> opt-in alternative: a Python `robin_stocks` fetcher on Railway that writes the same `producer/raw/*`
> files and then runs the existing `node producer/run.mjs`. It stores RH credentials (the user
> accepted this tradeoff). It reuses the entire Node tail, so the replay contract can't drift. It
> refreshes all tabs live — Portfolio/Markets/Analyze/Options/Picks (Picks via a client-side oversold
> screen over a curated universe, since the RH saved-scan is a connector abstraction). At parity with
> the scheduled Claude agent, which remains the default/blessed path.

## Data flow (one run)
1. Scheduled agent runs the prompt in `SCHEDULING.md` → **`node producer/preflight.mjs` first**.
2. preflight prints `PREFLIGHT <MODE>` (deterministic, from the committed snapshot):
   - **SKIP** (exit 10): weekend / today's close already captured → agent stops, ~zero cost.
   - **FETCH_ALL** (exit 0): day's first run → full fetch incl. heavy historicals + AV + picks.
   - **FETCH_LIGHT** (exit 11): intraday → fetch only portfolio/positions/quotes/VIX/options;
     historicals/AV/picks **carry forward** from the prior snapshot.
3. Agent makes the Robinhood MCP calls and `Write`s raw JSON into `producer/raw/` (gitignored).
4. Agent runs **`node producer/run.mjs "<label>"`** — the single deterministic tail: optional AV
   fetch → picks-build → options-build → `build-data.mjs` (encrypted) → `validate.mjs` → publish to
   `main`. No improvised shell, so unattended runs don't stall on permission prompts.

## Key files
| File | Role |
|---|---|
| `index.html` | The entire consumer app (UI, charts, Analyze/Picks/Markets/Options tabs, replay shim). |
| `sw.js` | Service worker. `CACHE_VERSION` must be bumped with every shell change. |
| `producer/run.mjs` | Orchestrator: build→validate→**publish to `origin/main`** (works from any session branch; retries; refuses to push plaintext). |
| `producer/preflight.mjs` | Run-mode gate (SKIP / FETCH_ALL / FETCH_LIGHT). |
| `producer/market.mjs` | Shared `isMarketOpen` / `isWeekday` / `etDate` / `etMinutes`. |
| `producer/build-data.mjs` | Assembles + encrypts `data.json`; **carry-forward overlay** (decrypts prior snapshot once, overlays fresh on hist/recorded/picks/options/realized/**notes**). Optional `producer/notes.json` (a string or `{risk:"…"}`) → `data.notes` for owner editorial that renders in the Risk card without baking prose into `index.html`. |
| `producer/emit.mjs` | AES-GCM encrypt/decrypt (`encryptEnvelope`/`decryptEnvelope`). |
| `producer/picks.mjs` | Daily Picks scoring engine. Composite = **33% tech / 28% fundamentals / 19% R/R / 20% social**. |
| `producer/picks-build.mjs` | Runs the scan→finalists, fetches ApeWisdom buzz, calls `buildPicks`. |
| `producer/social.mjs` | Keyless ApeWisdom fetch (retail buzz). |
| `producer/markets.mjs` | `MARKET_SYMBOLS` (indexes/risk/sectors/intl) — source of truth; keep PRODUCER.md's list in sync. |
| `producer/av*.mjs`, `options*.mjs` | Alpha Vantage wiring; options analysis. |
| `producer/validate.mjs` | Replay-contract sanity check. |
| `.github/workflows/freshness.yml` | Watchdog: opens an issue if `data.json` is stale >3h during market hours; auto-closes on recovery. |
| `producer/railway/` · `producer/RAILWAY.md` | Optional credentialed Railway producer (Python `robin_stocks` fetch → existing Node tail). See the runbook. |

## Conventions
- **Branch:** develop on `claude/portfolio-dashboard-data-ffc7x3`; the producer publishes `data.json`
  to `main`. Ship code via PR → squash-merge to `main` (the producer always reads `main`).
- **Versioning:** any change to `index.html`/`sw.js` → bump **both** `APP_VERSION` (in `index.html`
  `boot()`) and `CACHE_VERSION` (in `sw.js`) together. Currently around **v45** (`pf-v45`).
- **Theming:** two themes toggled by the freshness-bar control — **Light ⇄ Neon** (`data-theme` on
  `<html>`, persisted as `pf_theme`; legacy `dark` auto-migrates to `neon`). Neon is a "tasteful HUD"
  dark variant (cyan/magenta accents, glow on headline numbers, corner-bracket hero frame); its CSS
  is a self-contained `html[data-theme="neon"]` block at the end of the `<style>`. Charts read the
  theme via `chGrid()`/`chTick()`/`chLabel()` + `applyChartTheme()` so gridlines/labels stay legible.
  (The old `html[data-theme="dark"]` rules remain but are unreachable — dark was retired as an option.)
- **Encryption:** `data.json` is always encrypted on real runs (`PF_PASSPHRASE`). `run.mjs` refuses to
  push plaintext. Never commit the passphrase or real holdings.
- **Secrets / env (in the web environment, not git):** `PF_ACCOUNT`, `PF_PASSPHRASE`, optional
  `ALPHAVANTAGE_KEY` / `PF_AV_NEWS`. Network egress allowlist must include `apewisdom.io` (and
  `www.alphavantage.co` if using direct AV).

## Local dev / preview (no live connectors)
- `node producer/make-sample-data.mjs` writes a **plaintext** sample `data.json` (fake holdings) so
  the consumer renders without the real encrypted snapshot or any MCP access.
- `node producer/serve.mjs` serves the static site locally to eyeball UI changes.
- `producer/gen-icons.mjs` regenerates the PWA icons. **Never commit a plaintext `data.json`** — restore
  the real one with `git checkout origin/main -- data.json` before committing.

## Verify before shipping (no network needed)
- Inline JS parse: extract `<script>` blocks and `new Function(src)` each (skip block #1 = JSON-LD).
- Producer dry run: `PF_PASSPHRASE=… node producer/run.mjs --no-push "test"` → expect "replay
  contract is valid ✅"; then `git checkout origin/main -- data.json` to discard the dry-run build.
- Intraday carry-forward test: move `producer/raw/hist-*.json` aside, build, confirm `data.hist`
  still has full series (carried forward), Markets coverage clean.
- **Replay-key contract:** the consumer looks up recorded MCP responses by `makeKey()`
  (`producer/key.mjs`) — args must serialize byte-for-byte identically on both sides, or it's a silent
  `[replay miss]`. `validate.mjs` checks this; don't reorder keys in AV/recorded arg objects.

## Gotchas / hard-won lessons (don't relearn these)
- **`producer/raw/` is gitignored and EMPTY on every scheduled run** (fresh clone). Any "once/day"
  gating must derive from the committed `data.json`, not raw/ marker files.
- **No `cp`/`mv`/shell-variables in the agent's fetch step** — shell-var expansion triggers a
  permission prompt that stalls unattended runs. Save raw files with the `Write` tool; fetch
  historicals in ≤3-symbol batches so results return inline.
- **On `run.mjs` push failure (e.g. a 403 proxy/egress blip): STOP.** Do not improvise manual git
  recovery / alternate push / file searches — that stalls on permission prompts. The build is fine;
  the next run republishes. (Enforced in run.mjs output + the runbook.)
- **ApeWisdom has NO sentiment field** (always null) — the social score uses **buzz: mention rank +
  velocity** (not bullish/bearish), with a noise guard (damp velocity when mentions are tiny) and a
  top-5 crowding cap. Most oversold-large-cap picks aren't on Reddit, so social is a *spotlight on
  the few heating up*, not a full reshuffle (neutral 5 = no buzz).
- **Robinhood account access:** the producer only READS (reads work regardless of `agentic_allowed`).
  `PF_ACCOUNT` = the default individual account (…0741). A 404 on `get_portfolio` usually means the
  connector needs reconnecting/approval ("always allow"), not a code bug.
- **Cost discipline:** historicals (5Y monthly + YTD daily for ~36 symbols ≈ 24 of ~30 calls) are the
  expensive part. They're fetched once/day (FETCH_ALL) and carried forward — never re-fetch them on a
  light run. Schedule is a few runs/day, not hourly-heavy.

## Feature inventory (what's built)
- **Portfolio:** All Positions table (sortable) with a **TOTAL footer row** (value, cost, P&L $, P&L %
  on cost, value-weighted Day %); **Holdings Heatmap** (squarified treemap, sized by value, colored by
  day move or total P&L, tap-to-Analyze, with a "top N of M" coverage note when capped); risk/concentration
  with a **risk-adjusted metrics row** (Sharpe · annualized volatility · max drawdown · beta, computed YTD
  from covered holdings' historicals in `computeRiskMetrics`) plus a **data-derived concentration &
  correlation context** block (largest theme, an **empirical correlated cluster** from actual return
  correlation in `corrGroups`, and the highest-β "fragile leg" from per-symbol betas — no hardcoded
  tickers); allocation; Income & Tax (dividends, realized YTD, options premium); Action Feed; **Action Plan**
  whose redeploy buckets name your actual lowest-β / defensive holdings and size the harvest proceeds
  (50/30/20). **Technical Signals** = RSI **+ price vs 50-day SMA** trend. All the above commentary is
  derived from live data; optional owner editorial can be supplied via `data.notes` (see below).
- **Picks:** scored candidates table incl. a **Social** column (retail buzz, 20% of composite); top-3
  with thesis/levels; dynamic Earnings Preview (follows the soonest-reporting top pick).
- **Analyze:** per-ticker technical+fundamental breakdown, Recommendation card, Social Pulse card,
  chat-to-build-trade + Robinhood deep links.
- **Markets:** index/risk/sector tiles (YTD/5Y), macro signals (VIX from Robinhood), **US vs
  International** chart (SPY/EFA/EEM) with a YTD+5Y stat row, breadth/movers, Retail Buzz.
- **Options:** positions/pending + directional ideas with live greeks.
- **Producer hardening:** preflight gating, carry-forward, deterministic publish-to-main, freshness
  watchdog, clean-stop on push failure.
- **Freshness bar:** shows the snapshot label/age and **tints amber with a "↻ to refresh" nudge when the
  snapshot is ≥3h old** (computed from `data.generatedAt` in `boot()`); also hosts the build version,
  privacy, theme, and refresh controls.
