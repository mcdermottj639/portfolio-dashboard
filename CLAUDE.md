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
5. **FETCH_ALL only, after publish:** agent syncs **two Robinhood watchlists** to the fresh snapshot —
   (a) the **"Dashboard Top 10 Picks"** equity list to the composite top-10 (`sync-watchlist.mjs`), and
   (b) the account's **options watchlist** to the single-leg Trade Ideas that resolved to a live
   contract (`sync-option-watchlist.mjs`, all added `position_type: "long"`). Each reads the live list,
   runs its planner (prints the add/remove diff), then executes the MCP writes. Best-effort: a failure
   never gates the run (each re-syncs next FETCH_ALL). These two writes are the **only** producer writes
   to Robinhood — everything else reads.

## Key files
| File | Role |
|---|---|
| `index.html` | The entire consumer app (UI, charts, Analyze/Picks/Markets/Options tabs, replay shim). |
| `sw.js` | Service worker. `CACHE_VERSION` must be bumped with every shell change. |
| `producer/run.mjs` | Orchestrator: build→validate→**publish to `origin/main`** (works from any session branch; retries; refuses to push plaintext). |
| `producer/preflight.mjs` | Run-mode gate (SKIP / FETCH_ALL / FETCH_LIGHT). |
| `producer/market.mjs` | Shared `isMarketOpen` / `isWeekday` / `etDate` / `etMinutes`. |
| `producer/build-data.mjs` | Assembles + encrypts `data.json`; **carry-forward overlay** (decrypts prior snapshot once, overlays fresh on hist/recorded/picks/options/realized/**notes**). Also maintains **`data.picks.history`** — when a fresh scan replaces the prior picks (new date), the outgoing picks (entry/TP1/TP2/stop) are archived (cap 40) so the consumer can grade the Track Record. Maintains **`data.options.ivHistory`** too — appends each run's `ivObserved` (one point/UTC-day, cap ~260) and derives **`data.options.ivRank`** (where today's IV sits in its trailing range), decorating each position/idea with `ivRank`. Optional `producer/notes.json` (a string or `{risk:"…"}`) → `data.notes` for owner editorial that renders in the Risk card without baking prose into `index.html`. |
| `producer/emit.mjs` | AES-GCM encrypt/decrypt (`encryptEnvelope`/`decryptEnvelope`). |
| `producer/picks.mjs` | Daily Picks scoring engine. Composite = **33% tech / 28% fundamentals / 19% R/R / 20% social**. Tech score **blends RSI with 52wk-range position** (so RSI isn't double-counted vs finalist selection). Candidates carry `sector` + `cov` (data-coverage flags); top picks are **sector-diversified** (`MAX_PICKS_PER_SECTOR`, default 2). |
| `producer/picks-build.mjs` | Runs the scan→finalists, fetches ApeWisdom buzz, calls `buildPicks`. Also emits `producer/raw/picks-watchlist.json` (composite top-10 tickers) — the target for the Robinhood watchlist sync. |
| `producer/sync-watchlist.mjs` | Deterministic diff for the **"Dashboard Top 10 Picks"** Robinhood watchlist. Pure planner (like `av-plan`/`options-plan`): reads the top-10 sidecar + the agent-saved live list, **prints** `ADD`/`REMOVE`; the agent executes the MCP writes. Runs as a post-publish step on FETCH_ALL only. |
| `producer/sync-option-watchlist.mjs` | Same pattern for the account's single **options** watchlist. Reads `producer/raw/option-watchlist.json` (the live single-leg Trade-Idea contracts `options-build.mjs` emits on FETCH_ALL) + the agent-saved `get_option_watchlist`, **prints** `ADD`/`REMOVE` option-UUIDs (all `position_type:"long"`); the agent executes the writes. |
| `producer/social.mjs` | Keyless ApeWisdom fetch (retail buzz). |
| `producer/markets.mjs` | `MARKET_SYMBOLS` (indexes/risk/sectors/intl) — source of truth; keep PRODUCER.md's list in sync. |
| `producer/leaders.mjs` | `LEADERS`/`LEADER_SYMBOLS` — mega-cap bench (sym+sector) for the Plan-page Ideal Portfolio. `build-data.mjs` emits it as `data.leaders`; the producer quotes `LEADER_SYMBOLS` every run so each has a live price. |
| `producer/av*.mjs`, `options*.mjs` | Alpha Vantage wiring; options analysis. `options.mjs` builds the ideas — single-leg long-call/covered-call/CSP (live-priced, delta-targeted) **plus estimate-only defined-risk structures (call debit spread, collar)** with a `legs[]` array the consumer draws as a combined payoff; estimate premiums use a **per-symbol realized-vol IV proxy**. `options-build.mjs` analyzes your contracts (full greeks incl. **vega/gamma**, concrete **roll suggestions**, a portfolio **exposure** roll-up, `ivObserved`) and, on FETCH_ALL, emits `producer/raw/option-watchlist.json` (the single-leg ideas that resolved to a live contract `optionId`) for the options-watchlist sync. The agent records each idea's resolved `optionId` into `option-quotes.json` (see `options-plan.mjs`) so `options.mjs` can carry it onto the live idea. |
| `producer/validate.mjs` | Replay-contract sanity check. |
| `.github/workflows/freshness.yml` | Watchdog: opens an issue if `data.json` is stale >3h during market hours; auto-closes on recovery. |
| `producer/railway/` · `producer/RAILWAY.md` | Optional credentialed Railway producer (Python `robin_stocks` fetch → existing Node tail). See the runbook. |

## Conventions
- **Branch:** develop on `claude/portfolio-dashboard-data-ffc7x3`; the producer publishes `data.json`
  to `main`. Ship code via PR → squash-merge to `main` (the producer always reads `main`).
- **Versioning:** any change to `index.html`/`sw.js` → bump **both** `APP_VERSION` (in `index.html`
  `boot()`) and `CACHE_VERSION` (in `sw.js`) together. Currently around **v66** (`pf-v66`).
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
- **AV MCP responses come in THREE shapes — `parseAV()` must accept all of them.** The Alpha Vantage
  connector returns economic indicators (`CPI`, `FEDERAL_FUNDS_RATE`, `TREASURY_YIELD`,
  `EARNINGS_CALENDAR`) as `{result:"<CSV string>"}`, but `INDEX_DATA`/some `COMPANY_OVERVIEW` as
  `{structuredContent:{…}}`, and other overviews as a bare `{Symbol,…}` object. `parseAV` in
  `index.html` coalesces `structuredContent` → `content[0].text` → **`result` (CSV/JSON string)** →
  array → `{Symbol|Time Series}`. If the `result` branch is dropped, the Markets **Macro Signals**
  tiles (10yr Treasury / Fed Funds / CPI) silently go blank while VIX (sourced from Robinhood) still
  renders — exactly the symptom that bit us at v51. (2s10s curve also needs the **2-year**
  TREASURY_YIELD recorded; if a run only captures the 10-year, the curve shows "—" until the next
  FETCH_ALL records both.)
- **`data.hist` bar shape differs by producer — consumer must accept BOTH.** The scheduled Claude
  agent (and `make-sample-data.mjs`) store raw Robinhood bars `{begins_at, close_price, interpolated}`;
  the **Railway** producer normalizes them to compact `{t, c}` (`fetch_rh.py` `_bars_from_historicals`).
  Any consumer that reads `data.hist[*]` must coalesce — `b.begins_at||b.t`, `b.close_price ?? b.c`
  (see `fetchHist`/`fetchHistG` and the `az*` helpers in `index.html`). A hard `b.begins_at.slice()`
  throws on Railway data, gets swallowed by `fetchHist`'s `catch{}`, and silently empties `histMap` →
  beta/Sharpe/vol/drawdown/correlation/performance/50-DMA all blank at once. (This bit us once; v50.)
- **The Portfolio background-enrichment block is fault-isolated** (`load()`'s `(async()=>{…})` wraps each
  render in a `guard()`). Keep it that way — without it, one throw leaves every card below it stuck on its
  spinner forever. Don't "simplify" the guards away.
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
- **Robinhood account access:** the producer is READ-ONLY except for **two** writes, both daily
  (FETCH_ALL, post-publish, best-effort) — the "Dashboard Top 10 Picks" **equity watchlist sync** and
  the **options watchlist sync** (single-leg Trade Ideas, added `position_type:"long"`). See Data flow
  step 5 / PRODUCER.md steps 5–6. Reads work regardless of `agentic_allowed`; the watchlist **writes**
  (`create/add/remove_watchlist`, `add/remove_option_from_watchlist`) need connector write approval —
  verified to go through unattended, but a hard 403/404 there means "always allow" must be re-granted.
  Both writes are fault-isolated: they run only after `data.json` is already published and never gate
  the run. The options watchlist is a single per-account list (its tools take no `list_id`); only ideas
  that resolved to a live contract UUID this run are synced (estimate-only/multi-leg are skipped).
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
  tickers); allocation; Income & Tax (dividends, realized YTD, options premium — the itemized harvest
  list now lives in the Action Center — which now sits on the **Picks page** (see below) — only a summary
  stat + pointer remain here). **Technical Signals** = RSI **+ price vs 50-day SMA** trend. All the above
  commentary is derived from live data; optional owner editorial can be supplied via `data.notes`.
- **Picks (the "🎯 Plan" tab — renamed from "Picks" in v56):** **sortable + sector-filterable** scored candidates table incl. a
  **Social** column (retail buzz, 20% of composite, with an inline buzz label) and **data-coverage cues**
  (grey social = "no data, neutral 5"; `ᵛ` = value-only fundamentals when AV growth is unavailable).
  **Action Center** (moved here from Portfolio in v55 — it's portfolio-derived but conceptually "the plan",
  so it pairs with Picks as the act/decide surface): one card, two tiers below the hero — a **Do-now** tier
  (the ranked live-signal feed: margin/concentration/earnings/overbought/oversold/correlated/retail-buzz)
  and a **The-plan** tier (`renderActionPlan`). The plan is **right-sizing, not "sell no winners"**: Step 1
  raises cash by harvesting losers **and trimming the excess of any name over a single-name weight cap**
  (`PLAN_SINGLE_CAP`, 25%; over-weight winners are no longer off-limits — trigger is concentration,
  RSI/fwd-P/E only flavour the "why now"), with a **tax-netting line** (gains realized by the trims offset
  by the harvested loss → net taxable). Step 2 redeploys the pooled proceeds (pay down margin first if
  levered, then a beta-tilted ballast / defensive / high-conviction-add-or-cash split; the add never names
  a ticker we're trimming/harvesting).   The redeploy **pool = freed cash + idle settled cash + margin borrowed up to a fixed leverage cap**
  (v62 — `PLAN_MAX_LEVERAGE`, **1.5×**). The cap is anchored to **your own equity**, not the broker's
  shifting buying-power offer: allowed fresh loan = `(lev−1)×equityVal` = 0.5×equity (≤ 50¢ debt per $1
  owned), then clamped to what the broker will actually lend (`bpVal−cash`). It only adds leverage **from a
  flat start**; already on margin (`cashVal<0`) → `marginUse=0` and it deleverages instead (the
  **"After clearing margin"** line carves the loan off the top — that paydown is automatic at the broker
  when Step 1's sells settle, not a separate order, so it's narration/allocation, never a buy ticket). The **high-conviction sleeve redeploys straight into the Picks list below it** —
  as a **SET, not one name** (v58): `renderActionPlan` builds `pickAdds` (up to **3** ideas you're not
  over-weight in or trimming, **sector- AND cluster-diversified**, skipping any that would worsen an
  over-`PLAN_CLUSTER_CAP` cluster). PRIMARY = the 3 vetted `PICK_PICKS`; when those don't fill the sleeve
  (held at cap / hot cluster / sector collision) it **backfills from the scored top-10 `PICK_CANDIDATES`**
  (v59) rather than dumping the remainder to cash — backfills get **synthesized 50-DMA levels**
  (`synthPickFromCandidate`) and are labelled **"screen backfill"** (no Top-3 card badge / deep-link, since
  only the top 3 have real setups). Each add is sized **risk-based** (1% of book at its stop)
  and **clamped** so it can't push the name past `PLAN_SINGLE_CAP` or outrun its bucket, **flags earnings**
  inside a 14-day swing window (`azEarn`), and reads its levels from the shared **`pickLevels(p)`** helper
  (v58 — single source of truth for px/entry-zone/limit/stop/tp1, so the plan and the Top-3 card never
  disagree). Falls back to an oversold held name, then cash. A **Track-Record conviction line** (hit-rate /
  avg-return from `picksTrackStats()`) decorates the sleeve when ≥3 picks have resolved. The chosen picks are
  stashed in `window.__PLAN_ADDS` so the **Top-3 cards badge "🧭 the plan picked this"** with the sized share
  count and a deep-link back to the plan, and each plan add deep-links **down to its card** (`jumpToPick`) —
  two-way linking (v58). (The old producer-driven **⚖️ Trim/Add** card was retired in v56 — the
  Do-now feed + this plan own trim/add now; `PICK_TRIM`/`PICK_ADD` still load but aren't rendered.)
  Step 3 = standing guardrails (single-name cap, cluster cap `PLAN_CLUSTER_CAP` 40%, RSI>75 trim,
  fragile-leg trailing stop, earnings reassess). **Step 4 = "Ideal portfolio"** (v63) — a from-scratch,
  long-only **target allocation** (up to 14 names) built inline in `renderActionPlan`: the candidate pool =
  current holdings (scored by a quality heuristic — trend vs 50-DMA, RSI regime, fwd P/E, rev growth,
  thesis health) ∪ the top scored picks (their `composite`) ∪ a small **broad-market index core**
  (`SPY`/`QQQ`, eligible even if unheld so the target can anchor on an index sleeve where it earns a slot —
  held index ETFs win over the synthetic entry). Sector-diversified (≤3/sector), conviction-weighted with a
  3.5% floor and the `PLAN_SINGLE_CAP` (25%) ceiling, normalized to 100%. Each name is then **dollar/share
  sized to a target BOOK** (v64) = `equityBase + marginUse` — i.e. equity plus the *same* `PLAN_MAX_LEVERAGE`
  (1.5×) headroom Step 2 uses (borrow up to (lev−1)×equity, clamped to broker-lendable; already on margin →
  `marginUse`=0 so the book delevers to 1×). Per name: target $ = weight×book, **trade = target $ − current
  value**, shares = trade ÷ live price (`pxOf()` resolves held px → pick live/base → raw quote). The table
  shows **Target ($/%) · Now ($/%) · Trade (±shares ≈ ±$) · Stop** with a **Book footer** (book /
  now-invested / net-buy / net-sell), an "exit to zero" line for held names that didn't make the cut, and a
  **🤖 hand-off button** (`ideal.prompt` → `chatBtn`) carrying the sized per-name orders + stops + the
  leverage base. **It's a continuous portfolio, not a daily reset** (v65/v66): **every current holding is an
  incumbent guaranteed into the target** (`heldArr` is taken first, re-weighted/trimmed but never auto-sold
  to zero — the single-name cap still trims the over-weight ones); then `ADD_SLOTS` (≈ `max(3, 12−heldCount)`)
  of the best non-held picks/leaders/index fill remaining slots (sector cap counts held + adds, `TOTAL_CAP`
  15). So the screen refines what you own and layers big names on top — it never liquidates-and-rebuilds; the
  "exits" line is now just optional consolidation of the smallest holdings beyond the name cap. **Candidate
  universe** = holdings ∪ top picks ∪ **a mega-cap LEADERS bench** (`producer/leaders.mjs` → `data.leaders`,
  read by the consumer with a hardcoded fallback; admitted only when a live price exists, so the producer
  quotes `LEADER_SYMBOLS` every run) ∪ SPY/QQQ index. Each kept position shows a **bracket** in the **TP /
  Stop** column: a **take-profit** GTC sell limit above the mark (`tpOf` — a vetted pick's real tp1, else a
  2R level off the stop, else +20%) and a **protective stop** below (`stopOf` — under the 50-DMA or a fixed
  % under the mark, whichever is tighter); reduces/exits are GTC sell limits (shown inline in Trade). The
  intent: set it once with brackets, then rebalance only when a level triggers or a weight drifts — not daily. **Every line is a concrete order with a price**: sell/trim
  rows carry a **Limit** column; redeploy buckets become sized **buy tickets** (shares risk/cap-clamped at the
  live price, entry zone + starter limit **anchored to the 50-DMA** `smaMap`, protective **stop** on the add).
  On the **Plan page the Top-3 pick cards now sit directly under the Action Center** (v58), ahead of the
  Composite chart / Scoring table, so "the plan → the three ideas it deploys into" reads as one unit.
  Step 1 / Step 2 each get a **🤖 hand-off button** (`planOrdersPrompt` → `chatBtn`). The Action Center is
  **portfolio-derived**: `load()` stashes each enrichment stage into `window.__SNAP` and calls
  `paintActionCenter()`, which `renderPicksStatic()` also calls — so the card populates whether the Picks
  tab is opened before or after the portfolio finished loading (no-ops cleanly until data + DOM both exist).
  `renderActionPlan(enriched,clusters,totalVal,betaInfo,rsiMap,ovMap,earningsMap,smaMap)` — the last four
  args are decorators, so it renders on the first pass and re-renders as they arrive.
  Top-3 cards with thesis/levels
  are **sector-diversified** and carry a **catalyst-risk note** when earnings land inside the swing window.
  **Track Record** card grades archived past picks (`data.picks.history`) on a closing basis — hit
  TP1/TP2, stopped, or open — with a running hit-rate + avg return (graded client-side from daily bars).
  Dynamic Earnings Preview follows the soonest-reporting top pick. **Robinhood watchlist sync:** on
  each FETCH_ALL run the producer mirrors the composite top 10 into the **"Dashboard Top 10 Picks"**
  Robinhood watchlist (daily add/remove diff via `sync-watchlist.mjs`), so the list in the Robinhood
  app always tracks the Picks table.
- **Analyze:** per-ticker technical+fundamental breakdown, Recommendation card, Social Pulse card,
  chat-to-build-trade + Robinhood deep links. The ticker box has **native autocomplete** over the
  analyzable universe (`azUniverse` = holdings ∪ picks ∪ daily-bar symbols ∪ quotes ∪ options book),
  and a **miss shows clickable suggestions** instead of a dead-end. Every card is collapsible +
  jump-navigable (shared `.card-nav` / auto-collapse observers). Price chart adds **volume bars + an
  RSI(14) sub-panel** (30/70 bands); **Scenarios** show a **±1σ implied expected-move band** anchored
  to live option IV when available (`azIV`, else a realized-vol proxy, labelled market-implied vs
  est.); **Historical Edge** widens its RSI match band adaptively (±8→±20) for a usable sample;
  **Options Play** links to the Options tab and flags real greeks when you hold live contracts on the
  name; **limited-data** tickers get an explicit "locked until next run" card. Colour-coded signals
  carry redundant **▲/▼/■ glyphs + text labels** (a11y) and the setup gauge has an `aria-label`.
  Last-analyzed ticker and the compare ticker persist via `localStorage`; `azExtra`/`azCorr` are
  memoized per snapshot (`data.generatedAt`).
- **Markets:** index/risk/sector tiles (YTD/5Y) with a **risk-on/off appetite gauge** synthesized from
  the day moves of equities/credit vs gold/long-bonds; **sector heatmap with a Day ⇄ vs-S&P-YTD
  (relative-strength) toggle** that surfaces leaders/laggards; macro signals incl. a **2s10s yield-curve
  tile** (10yr−2yr, flags inversion; VIX from Robinhood); **US vs International** chart (SPY/EFA/EEM)
  with a YTD+5Y stat row; **breadth = real market movers** (leaders/laggards across the index/sector/risk
  ETFs, not just your book) + news sentiment; Retail Buzz. The "as of" label reads from
  `data.generatedAt` and flags staleness, like the freshness bar.
- **Options:** an **exposure roll-up** (net delta · put cash secured · shares capped · open premium at
  risk) across your open+pending contracts; **Your Options** cards with full live **greeks (Δ Θ Vega Γ)**,
  P&L, assignment odds, an **IV-rank badge** (cheap/rich), a payoff-at-expiry diagram, and concrete
  **roll suggestions** (named later expiry + roll-up strike) on short calls; an **Upcoming Expirations**
  calendar; **Trade Ideas** that are **filterable (by direction) + sortable** — single-leg long calls,
  covered calls and cash-secured puts (live-priced, delta-targeted) **plus defined-risk call debit
  spreads and collars** (estimate-only, multi-leg payoff drawn from `legs[]`); **Covered-Call** and
  **Cash-Secured-Put income rankers** (annualized yield); Options P&L (closed trades); and a Knowledge
  card. Estimate premiums use a per-symbol realized-vol IV proxy. Research/education only. **Robinhood
  options-watchlist sync:** on each FETCH_ALL run the producer mirrors the single-leg Trade Ideas that
  resolved to a live contract (long calls / covered calls / CSPs) into the account's options watchlist
  (daily add/remove diff via `sync-option-watchlist.mjs`, all `position_type:"long"`); estimate-only
  and multi-leg structures are excluded since the list holds single-leg contracts only.
- **Producer hardening:** preflight gating, carry-forward, deterministic publish-to-main, freshness
  watchdog, clean-stop on push failure, and the two best-effort post-publish **watchlist syncs** (the
  equity "Dashboard Top 10 Picks" list + the options watchlist — the only Robinhood writes; both
  fault-isolated so they never gate a run).
- **Freshness bar:** shows the snapshot label/age and **tints amber with a "↻ to refresh" nudge when the
  snapshot is ≥3h old** (computed from `data.generatedAt` in `boot()`); also hosts the build version,
  privacy, theme, and refresh controls.
