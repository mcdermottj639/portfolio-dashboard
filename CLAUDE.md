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
> refreshes all tabs live — Portfolio/Markets/Analyze/Options/Picks + the **Agentic Portfolio** card's
> real ••••3900 holdings/cash (`fetch_agentic()`, every run) (Picks via a client-side oversold
> screen over a curated universe, since the RH saved-scan is a connector abstraction). At parity with
> the scheduled Claude agent, which remains the default/blessed path.

## Data flow (one run)
1. Scheduled agent runs the prompt in `SCHEDULING.md` → **`node producer/preflight.mjs` first**.
2. preflight prints `PREFLIGHT <MODE>` (deterministic, from the committed snapshot):
   - **SKIP** (exit 10): weekend / market holiday / today's close already captured → agent stops, ~zero cost.
   - **FETCH_ALL** (exit 0): day's first run → full fetch incl. heavy historicals + AV + picks.
   - **FETCH_LIGHT** (exit 11): intraday → fetch only portfolio/positions/quotes/VIX/options;
     historicals/AV/picks **carry forward** from the prior snapshot.
3. Agent makes the Robinhood MCP calls and `Write`s raw JSON into `producer/raw/` (gitignored). This
   includes (every run) `get_portfolio` + `get_equity_positions` for the **agentic account
   (••••3900)** → `agentic-portfolio.json` / `agentic-positions.json`, which `build-data.mjs` turns into
   `data.agentic` for the Agentic Portfolio card, plus (every run) `get_pnl_trade_history` →
   `agentic-trades.json` AND (v105) the same call on the **main** account → `main-trades.json` — the
   real closing trades behind the CROSS-ACCOUNT wash-sale ledger (the IRS window is per taxpayer, so a
   loss the owner books in ••••0741 must block agentic rebuys too). On **FETCH_ALL** it also
   fetches `get_realized_pnl` per account per asset class → `realized-main{,-opt}.json` /
   `realized-agentic.json` → `data.realized` (the Income & Tax card's per-account Realized YTD).
   (Account-scoped reads — pass that account_number.)
4. Agent runs **`node producer/run.mjs "<label>"`** — the single deterministic tail: optional AV
   fetch → optional **ext-fund fetch** (Finnhub/FMP supplementary fundamentals) → optional **flow fetch**
   (Finnhub analyst revisions / insider clusters / earnings surprise → `data.flow`) → picks-build →
   options-build → `build-data.mjs` (encrypted) → `validate.mjs` → publish to `main`. No improvised
   shell, so unattended runs don't stall on permission prompts.
5. **FETCH_ALL only, after publish:** agent syncs **two Robinhood watchlists** to the fresh snapshot —
   (a) the **"Dashboard Top 10 Picks"** equity list to the composite top-10 (`sync-watchlist.mjs`), and
   (b) the account's **options watchlist** to the single-leg Trade Ideas that resolved to a live
   contract (`sync-option-watchlist.mjs`, all added `position_type: "long"`). Each reads the live list,
   runs its planner (prints the add/remove diff), then executes the MCP writes. Best-effort: a failure
   never gates the run (each re-syncs next FETCH_ALL). These two writes are the **only** producer writes
   to Robinhood — everything else reads.
5c. **Executor (separate hourly trigger, not the producer):** `agentic-exec-gate.mjs` → ticket state machine.
   Since **v102** it also maintains the **waiting ground** — deferred weight parked in **VTI** rather than left
   in cash, released to fund each name as it clears — whose state lives in the committed
   `producer/agentic-parked.json`. The executor may commit exactly three files (`agentic-pending.json`,
   `agentic-decisions.json`, `agentic-parked.json`) and **never `data.json`**.
5b. **Every run, after publish (best-effort):** the build wrote `producer/raw/alerts.json`
   (`alerts.mjs` — stop/target/TP/day-move crossings since the prior snapshot); if non-empty, the
   agent `PushNotification`s the owner one combined message (PRODUCER.md step 8). Railway runs only
   log these (no push channel).
6. **FETCH_ALL only, after publish, ~weekly (best-effort):** `agentic-due.mjs` gates the agentic-account
   research refresh; when `AGENTIC_DUE`, the agent runs the **`agentic-research`** workflow → writes
   `producer/agentic-target.json` (commit+push) → computes drift vs ••••3900 → **`PushNotification`s the
   owner a rebalance proposal** (places nothing — alert & one-tap-confirm). Fault-isolated like step 5;
   never gates the publish. See `AGENTIC.md` / `PRODUCER.md` step 7. Adds no Robinhood writes (reads only).

## Key files
| File | Role |
|---|---|
| `index.html` | The entire consumer app (UI, charts, Analyze/Picks/Markets/Options tabs, replay shim). Both the Accounts and Plan tabs are split per account by a shared `pf_acct` switcher (v108). |
| `sw.js` | Service worker. `CACHE_VERSION` must be bumped with every shell change. |
| `producer/run.mjs` | Orchestrator: build→validate→**publish to `origin/main`** (works from any session branch; retries; refuses to push plaintext). |
| `producer/preflight.mjs` | Run-mode gate (SKIP / FETCH_ALL / FETCH_LIGHT). |
| `producer/market.mjs` | Shared `isMarketOpen` / `isWeekday` / `etDate` / `etMinutes` + a **hardcoded NYSE holiday/half-day calendar** (`isHoliday`, `closeMinutes` — 13:00 close on half-days). Preflight SKIPs full-closure holidays and treats a 1 PM-close snapshot as the day's close; the freshness watchdog only alarms while the market is actually open. **Extend the HOLIDAYS/HALF_DAYS sets once a year** — an unlisted date fails safe (old holiday-blind behavior, harmless extra runs). |
| `producer/build-data.mjs` | Assembles + encrypts `data.json`; **carry-forward overlay** (decrypts prior snapshot once, overlays fresh on **quotes**/hist/recorded/picks/options/realized/**notes** — quotes carry forward per-symbol since v88 so a transiently unquotable name keeps its last price instead of dropping to $0; a fresh-but-EMPTY bars array also no longer clobbers carried-forward hist). Also maintains **`data.picks.history`** — when a fresh scan replaces the prior picks (new date), the outgoing picks (entry/TP1/TP2/stop) are archived (cap 40) so the consumer can grade the Track Record. Maintains **`data.options.ivHistory`** too — appends each run's `ivObserved` (one point/UTC-day, cap ~260) and derives **`data.options.ivRank`** (where today's IV sits in its trailing range), decorating each position/idea with `ivRank`. Optional `producer/notes.json` (a string or `{risk:"…"}`) → `data.notes` for owner editorial that renders in the Risk card without baking prose into `index.html`. **COMPANY_OVERVIEW accumulation guard:** the free AV tier (25/day + burst throttle) only covers a rotating subset of holdings per run; this run's 11-field Robinhood-synth overview (P/E·MktCap·DivYld only) is NOT allowed to clobber a carried-forward AV-rich overview (one with `ForwardPE`/`EPS`/`QuarterlyRevenueGrowthYOY`) for the same symbol — genuine AV refreshes (also rich) still win — so Fwd P/E / Rev Growth / EPS coverage **accumulates across days** instead of flickering blank for whichever names missed today's cap. Also emits **`data.agentic`** (v67) = the agentic account's `{asOf,cash,buyingPower,equity,positions[]}` from optional `agentic-portfolio.json`/`agentic-positions.json` (priced from `data.quotes`, carry-forward) — the actual holdings the **Agentic Portfolio** card renders its target against. Maintains **`data.agentic.equityHistory`** too (v72 — same shape as `ivHistory`: one `{t,equity,cumFlow}` point/UTC-day, latest wins, cap ~260) — the account's **real** equity recorded **forward** (Robinhood has no account-equity-history endpoint, so it can't be backfilled); the Portfolio Performance chart overlays it. **Deposit-adjustment (v92):** this is a self-funded account the owner adds to over time and Robinhood exposes no transfers feed, so a deposit inflates equity and would read as a fake return (a $1k→$3.5k funding jump = a bogus +250% — the bug that prompted this). build-data now **infers the net external cash flow** each run — `flow ≈ ΔEquity − Σ(priorQty × price move)` (a deposit lands in cash without a matching position change; internal buys/sells net to ~0; qty-unchanged gaps are exact) — past a noise floor (`max($40, 8% of prior equity)`), and stores it as a running **`cumFlow`** on each point. The consumer computes a **time-weighted, deposit-immune** return from `cumFlow` deltas (see `renderPerformance`), with an implausible-jump fallback (>20% in one step → treated as an un-annotated legacy deposit) so already-recorded points before this field are corrected too. Also maintains **`data.agentic.recentLosses`** (v91 — the wash-sale ledger; rolling 31-day retention, read by the Agentic card to **block + flag** rebuying any name inside the 30-day window). **v98 sources it from REAL closing trades** — `producer/raw/agentic-trades.json` (`get_pnl_trade_history`, span `ytd`) via `lossesFromTrades` — and rebuilds it wholesale on each fetch, stamping `data.agentic.lossSource='trades'`. **v105 makes it CROSS-ACCOUNT:** the ledger also merges the **self-directed ••••0741 book's** realized losses (`producer/raw/main-trades.json`, `get_pnl_trade_history` span `3month`, every run), each entry tagged `account:'main'|'agentic'`, because the IRS wash window is per TAXPAYER — on 2026-07-29 the owner sold 35 NVDA at −$431.76 in ••••0741 and the agentic executor rebought NVDA on 2026-08-11 through a ledger that only read ••••3900's (empty) trade history, partially disallowing the loss. Each account's portion rebuilds when its file is present and carries forward (expiring) when not; there is NO inference for the main portion, ever. The original **inference** (diff prior→fresh positions; a holding reduced/exited while underwater = a loss dated today) survives only as the Railway fallback and **never wins over real trades, nor layers on top of a trades-sourced ledger**: it is unsound, because any run whose agentic fetch returned the *wrong account's* positions makes the next correct fetch look like a mass liquidation. That is what happened — five losses booked 2026-08-03 (LLY/NVDA/TSM/CIFR/IREN) for an account with **no closing trades that week** that had never held three of those names, and NVDA was wash-sale blocked out of a real buy for 30 days off one of them. Also assembles **`data.realized`** per account (v98, via `realizedpnl.mjs`) from `realized-main{,-opt}.json` / `realized-agentic.json` (`get_realized_pnl`, per asset class): `{year,asOf,source:'robinhood',approx:false,accounts:{main,agentic},equity,options,total,premiumYTD}` — top-level fields are **all-account sums** (so an older cached consumer shows a correct combined figure), `accounts` carries the split. Precedence: fresh broker fetch → committed `producer/realized.json` (gitignored owner override / Railway fallback) → prior snapshot; the options-book `realizedYTD` override is skipped when `source==='robinhood'` so it can't desync `accounts` from the totals. **v93:** also grades **`data.agentic.decisions`** from committed `agentic-decisions.json` (via `agentic-ledger.mjs`, vs live quotes + SPY) and writes **`producer/raw/agentic-triggers.json`** (via `agentic-triggers.mjs` — deploy-cash + research-refresh events). |
| `producer/emit.mjs` | AES-GCM encrypt/decrypt (`encryptEnvelope`/`decryptEnvelope`). |
| `producer/realizedpnl.mjs` | **Broker realized-P&L normalizers (v98, pure + unit-tested).** `sumRealized` (one `get_realized_pnl` response → total/trades; null "transfer-only" buckets are **n/a, not $0**), `accountRealized` (equity + option classes → one account block; a missing class stays `null`, not 0), `buildRealized` (per-account blocks → `data.realized` with all-account totals), `lossesFromTrades` (`get_pnl_trade_history` → the dated realized **losses** feeding the wash-sale ledger; takes an optional `account` tag (v105) so the cross-account merge knows which taxable book booked each loss). `asset_classes` is **required** by the endpoint — omitting it errors `un-specified asset class`. |
| `producer/picks.mjs` | Daily Picks scoring engine. Composite = **33% tech / 28% fundamentals / 19% R/R / 20% social**. Tech score **blends RSI with 52wk-range position** (so RSI isn't double-counted vs finalist selection). Candidates carry `sector` + `cov` (data-coverage flags); top picks are **sector-diversified** (`MAX_PICKS_PER_SECTOR`, default 2). **Momentum/trend gate (`trendGate`):** the oversold screen surfaces both healthy pullbacks and *falling knives* — and techScore's 52wk-range term actually **rewards** a broken name (deeper in range = more "reversion room"), so a confirmed downtrend could top the board and feed the Action Center's redeploy sleeve (this is the ORCL bug — deep-research rejected it "momentum 1/10, broken downtrend" while the picks screen ranked it #1). A name is a **confirmed downtrend** when AV's 50/200-DMA are present and `price < 200-DMA AND 50-DMA < 200-DMA`, else (no MA) `>50% below its 52-week high`. A confirmed downtrend is **disqualified from the highlighted top picks** (`buildPicks` filters `picks[]`) and **docked `DOWNTREND_PENALTY` (3.0) composite points** so it also sinks in the candidates table (stays visible there, flagged `Downtrend`, as an oversold data point). Each candidate carries `downtrend`/`trendNote`; the consumer's Action Center backfill sleeve also skips `downtrend` candidates (`index.html`), so a falling knife can't reach the plan via either path. Milder pullbacks (≤50% off high / above the 200-DMA) are untouched. **Recent-stop-out COOLDOWN (v91 — separate from the trend gate):** the trend gate filters on trend *shape*, so it caught ORCL only because ORCL was *also* a textbook downtrend — the engine otherwise had no memory of what it just lost on and re-surfaced ORCL ~10 sessions running (June 29–July 13), each stopping out (the 0W·10L distortion). `recentStopCooldown(history, barsBySym, {asOf})` reads the prior snapshot's **graded** pick history (via the pure `gradePickClose`, a mirror of the consumer's grader) and benches any name that **stopped out inside the trailing window** (`COOLDOWN_CAL_DAYS` = 14 cal days ≈ `COOLDOWN_TRADING_DAYS` 10): disqualified from `picks[]` (like a downtrend) and docked `COOLDOWN_PENALTY` (3.0), flagged `Recent stop-out` with a `cooldownNote`/`cooldownUntil`. **Averaging-down backstop:** `recentStopCooldown` also accepts `priceBySym` (today's scan prices) and benches any name whose fresh scan price is **at/below a recent in-window pick's published stop** — the name has fallen *through* the level we'd have exited on, so re-listing it lower is chasing a knife down. This fires straight from the scan price (no bars needed), so it still bites when the prior snapshot's daily bars for that name are thin/missing and the closing-basis grade can't confirm the stop-out. `buildPicks(..., cooldown)` takes the map (5th arg); the consumer skips `cooldown` candidates in the Action Center backfill AND the Agentic heuristic pool. Pairs with the 30-day wash-sale guard on ••••3900 (below). |
| `producer/picks-build.mjs` | Runs the scan→finalists, fetches ApeWisdom buzz, calls `buildPicks`. Also emits `producer/raw/picks-watchlist.json` (composite top-10 tickers) — the target for the Robinhood watchlist sync. **Decrypts the prior committed `data.json`** (best-effort — `PF_PASSPHRASE` + `emit.mjs`; degrades to no-cooldown on any miss/plaintext) to feed `recentStopCooldown` the graded `picks.history` + `hist.day` bars, then passes the resulting cooldown map into `buildPicks` so recently-stopped names are benched. |
| `producer/sync-watchlist.mjs` | Deterministic diff for the **"Dashboard Top 10 Picks"** Robinhood watchlist. Pure planner (like `av-plan`/`options-plan`): reads the top-10 sidecar + the agent-saved live list, **prints** `ADD`/`REMOVE`; the agent executes the MCP writes. Runs as a post-publish step on FETCH_ALL only. |
| `producer/sync-option-watchlist.mjs` | Same pattern for the account's single **options** watchlist. Reads `producer/raw/option-watchlist.json` (the live single-leg Trade-Idea contracts `options-build.mjs` emits on FETCH_ALL) + the agent-saved `get_option_watchlist`, **prints** `ADD`/`REMOVE` option-UUIDs (all `position_type:"long"`); the agent executes the writes. |
| `producer/social.mjs` | Keyless ApeWisdom fetch (retail buzz), with one retry. Split into `fetchSocialPages` (network, once) + pure `shapeSocial(pages, symbols)` so one fetch serves both callers: `picks-build` saves the raw pages to `raw/social-pages.json` and `build-data` reuses that sidecar (light runs, which have no sidecar, fetch live) — previously each FETCH_ALL hit ApeWisdom twice with potentially different results. |
| `producer/alerts.mjs` | **Pure level-crossing detection** between the prior snapshot and the one being built (no I/O, unit-tested): agentic holding crosses its research **stop/target**, a top pick hits its published **TP1/TP2/stop**, a held name crosses **±7% on the day**. Transition-based (prior on one side, fresh through the other) so a crossing fires exactly once with no sent-state. `build-data` writes the result to `producer/raw/alerts.json`; the **agent** delivers post-publish via `PushNotification` (PRODUCER.md step 8, best-effort, every run); the Railway path only logs them. |
| `producer/markets.mjs` | `MARKET_SYMBOLS` (indexes/risk/sectors/intl) — source of truth; keep PRODUCER.md's list in sync. |
| `producer/leaders.mjs` | `LEADERS`/`LEADER_SYMBOLS` — mega-cap bench (sym+sector) for the Plan-page Ideal Portfolio. `build-data.mjs` emits it as `data.leaders`; the producer quotes `LEADER_SYMBOLS` every run so each has a live price. |
| `producer/extfund.mjs` · `producer/extfund-fetch.mjs` | **Supplementary fundamentals** (Finnhub + Financial Modeling Prep). `extfund.mjs` = pure normalizers turning each provider's payload into the **same COMPANY_OVERVIEW shape AV uses** (AV's fraction conventions: RevGrowth/Margin/DivYield stored as fractions — Finnhub returns percents, so ÷100; FMP TTM ratios are already fractions; mktcap → whole dollars). `extfund-fetch.mjs` fetches over HTTP (once/day ET gate, like `av-fetch.mjs`), writing `producer/raw/ext-fund/overview-<SYM>.json`. **AV stays PRIMARY** — `build-data.mjs` reads ext-fund *after* av-src and only **fills fields AV is missing** for a name (so AV's ForwardPE/AnalystTargetPrice win) or adds a whole overview for names AV's daily cap skipped (rich, so it beats the RH synth). Both providers independently optional (`FINNHUB_KEY` / `FMP_KEY`); no key → silently skipped. Unit-tested offline (`extfund.test.mjs`). |
| `producer/av*.mjs`, `options*.mjs` | Alpha Vantage wiring; options analysis. `options.mjs` builds the ideas — single-leg long-call/covered-call/CSP (live-priced, delta-targeted) **plus estimate-only defined-risk structures (call debit spread, collar)** with a `legs[]` array the consumer draws as a combined payoff; estimate premiums use a **per-symbol realized-vol IV proxy**. `options-build.mjs` analyzes your contracts (full greeks incl. **vega/gamma**, concrete **roll suggestions**, a portfolio **exposure** roll-up, `ivObserved`) and, on FETCH_ALL, emits `producer/raw/option-watchlist.json` (the single-leg ideas that resolved to a live contract `optionId`) for the options-watchlist sync. The agent records each idea's resolved `optionId` into `option-quotes.json` (see `options-plan.mjs`) so `options.mjs` can carry it onto the live idea. |
| `producer/flow.mjs` · `producer/flow-fetch.mjs` | **Flow & Positioning signals (v95)** — who is *acting* on a name, which none of the four research sleeves read. `flow.mjs` = pure scorers (unit-tested, `flow.test.mjs`): **`revisionScore`** (Finnhub `/stock/recommendation` — a consensus index `(2·sB+B−S−2·sS)/total` per month, scored **60% on the DIRECTION of change / 40% on the level**, because consensus levels are structurally bullish and carry little information alone), **`insiderScore`** (Form 4 clusters — **open-market `P`/`S` codes only**; `A` grants / `M` exercises / `G` gifts / `F` withholding are mechanical and would make every large cap look like a wall of selling), **`surpriseScore`** (PEAD off recency-weighted `surprisePercent`, each quarter clamped ±25% so a blowout off a near-zero estimate isn't 16× the signal), **`awardScore`** (Finnhub `/stock/usa-spending` — federal contract dollars, scored as YoY **growth** not level, since the level just measures how big a defence contractor is), **`lobbyingFlag`** (a regulatory-exposure **flag, never scored** — heavy lobbying isn't bullish or bearish, it marks policy beta), and **`flowScore`** (weighted composite — revision 40 / insider 30 / surprise 20 / award 10; renormalizes over whatever is present, and returns **null below 2 components** so a sparse name abstains instead of faking a neutral 5). **`insiderScore` asymmetry is load-bearing** — a sell tilt moves the score ~4× less than an equal buy tilt; the first live run scored *both* NVDA and JPM at 0.9/10 on all-sell windows, i.e. a constant drag on every megacap rather than a discriminator, because large-cap selling is comp/diversification/plan-driven and this endpoint can't distinguish it. Don't "simplify" it back to symmetry. `flow-fetch.mjs` fetches over HTTP (Finnhub, paced ~55 calls/min); since v100 its cover is the margin book ∪ the agentic holdings ∪ the agentic target's tickers (best-effort reads of `raw/agentic-positions.json` + the committed `agentic-target.json`), so both accounts' names carry flow data. Its **once/day gate reads `data.flow.asOf` from the COMMITTED (decrypted) snapshot**, not a `raw/` marker — raw/ is wiped on every scheduled run, so a marker-only gate never trips and would re-spend ~6 calls/symbol on all ~13 runs of the day, writes the **scored** read to `producer/raw/flow/<SYM>.json` over the held book (`coverFromRaw`), and also writes `_treasury.json` — one FMP `stable/treasury-rates` call returning the **whole curve**, which removes the documented 2s10s "—" failure mode (sidecar only so far; wiring it into the tile touches the replay contract). `build-data.mjs` merges the sidecars **per symbol over the prior snapshot** (like quotes) into **`data.flow`**. Optional (`FINNHUB_KEY`); `PF_FLOW=off` kills the layer. **DISPLAY-ONLY today** — nothing here touches `agentic-target.json` until the sleeve weight is switched on. See `PROPOSAL-flow-signals.md`. |
| `producer/policy.mjs` · `producer/policy.json` | **Policy-catalyst calendar (v95)** — the *forward-looking* half of the "Washington" theme, and the reason the congressional feed isn't it: what moves a position is the **scheduled** decision (tariff ruling, PDUFA date, appropriations vote, antitrust judgment), not a trade disclosed 40–116 days late. `policy.mjs` = pure helpers (`policyFor` / `policyBlackout` / `policyCalendar` / `validatePolicy`, unit-tested). `agentic-deploy.mjs` consumes `policyBlackout` as a **new deferral reason (`policy`)** — the exact parallel of the earnings blackout: never deploy NEW money into a name inside ~7d of a dated binary event. **Only `impact:"high"` blocks** (a comment-period close is context, not a reason to sit out — over-blocking starves the plan), and high-impact events **require a `source` URL** since they can defer a real trade. **`policy.json` ships EMPTY on purpose** — there is no free structured feed for this, and a wrong date would defer or wave through a real buy, so events are only ever written from a source that's been read (the weekly research agent adds them, PRODUCER.md step 7). An empty calendar makes every helper a no-op, which is the correct failure mode. |
| `producer/polflow.mjs` | **Congressional disclosure clusters (v95)** — the STOCK Act PTR feed the Trump/congress trackers repackage. Pure + unit-tested: `normalizeDisclosure` (drops bonds/funds/no-symbol rows and directionless "Exchange"), `mergeEvents` (**de-dupes on filer+symbol+side+date** — the tier serves a rolling 25-row window that re-delivers the same trades every poll, and counting them twice would fake activity; 120-day retention), `detectClusters` (**≥3 DISTINCT filers**, same direction, inside a 45-day span — one person filing five times is one opinion; equal-sized opposing clusters cancel), `clusterEvidence`. **`EXCLUDED_CLUSTERS = ['megacap-tech']` is load-bearing**: the most-traded congressional names are exactly the complex `riskweights.mjs` caps at 48%, so a political nudge there would spend risk budget re-buying the concentration that cap exists to contain. **ZERO score weight, permanently** (owner decision) — it enters the research workflow's **adversarial verify prompt only**, explicitly framed as stale weak context, and renders as a labelled context strip on the Plan card. Accumulated into `data.flow.polEvents`/`polClusters` by `build-data.mjs` (raw/ is wiped every run, so the ledger can only live in the snapshot — the `ivHistory` pattern). |
| `producer/PROPOSAL-flow-signals.md` | Signed-off design for the flow layer + the **live probe results** for every political/insider/positioning source (what works on our keys, what's tier-restricted, what returns dead data). Read before adding another provider — it records what was already tried and rejected, and why congressional disclosure feeds get **no score weight** (40–116 day lag; the ETF "edge" is a megacap-tech beta tilt; the most-traded names sit inside the 48% cluster cap). |
| `producer/validate.mjs` | Replay-contract sanity check. |
| `.github/workflows/freshness.yml` | Two watchdogs, hourly during market hours. **check**: opens an issue if `data.json`'s *commit* is stale **>90 min while the market is open** (holiday/half-day-aware via `market.mjs`; was 3h, which let real 60–105m scheduler gaps through); auto-closes on recovery. **deploy-health** (v88): catches "committed but never DEPLOYED" — compares the live Pages `data.json` blob vs `HEAD` (15-min grace; the envelope's random salt means bytes always differ mid-deploy) + reads the Pages build status API, **auto-retriggers a Pages build** (`POST /pages/builds`, needs the workflow's `pages: write`) and opens/auto-closes a `pages-watchdog` issue. Added after 2026-07-02, when two consecutive branch Pages deploys hung in `deployment_queued` → timeout while the commit-age check stayed green. |
| `producer/agentic-target.json` | **Canonical research-driven target** for the agentic account (••••3900): `{asOf,method,book,driftTriggerPp,names[]}`. `build-data.mjs` attaches it as `data.agentic.target`; the Agentic Portfolio card renders drift against it. Refreshed **weekly** by the deep research. |
| `.claude/workflows/agentic-research.js` | Reusable **named workflow** — the deep multi-factor research (momentum/quality/growth/catalyst sleeves + valuation → adversarial verify → synthesis). **v102 — SPLIT VERDICT.** `supports` used to collapse two independent judgements into one boolean, and it failed live on 2026-08-11: 5 of 6 finalists came back unsupported and *every* rejection said "the business is sound, the price is wrong" — so a great company 2% above its ideal entry was discarded exactly like a broken one and the allocation went defensive across the board. The verdict now carries **`businessOk`** (worth owning at SOME price → decides INCLUSION) and **`entryQuality` 0-10** (how good TODAY's price is → decides SIZE, via a precomputed `entryHaircut` multiplier the synthesis prompt applies), with `entryRisk` kept apart from `biggestRisk`. A weak entry now **shrinks** a position instead of vetoing it, so an extended market yields a smaller defensive book rather than an empty one. The synthesis prompt also demands **reachable entry zones** — a zone far below spot reads as "never buy" to the executor and strands the cash; conviction is expressed by cutting WEIGHT, not by setting an unreachable price. Universe guidance widened (mid-cap / out-of-favour / international), since a screen can only buy what it is shown and a megacap-only universe in an extended tape can only ever answer "wait". Pass a fresh `args.universe`; output drives `agentic-target.json` (via `finalize-target.mjs`). **v93:** the synthesis prompt now asks for **correlation-cluster** (megacap-tech ≤48%) + **vol-scaled** weighting; `finalize-target.mjs` re-enforces those caps deterministically so they hold regardless of the model output. **Incumbency (2026-08-12 churn governor):** pass **`args.held`** (••••3900's current holdings, `[{t,w}]` or tickers) + **`args.priorTarget`** (the committed target) — the verify prompt tells the skeptic a held name's exit is a real taxable event ("broken thesis" ≠ "less attractive"; only the former is `businessOk:false`), and the synthesis prompt makes the current book the **null hypothesis** (displace an incumbent only for a materially stronger name; prefer weight changes to name swaps; a drop-and-re-add produces pure cost because the deterministic governor retains/blocks it anyway). |
| `producer/AGENTIC.md` | **Runbook** for the agentic account: tax/reg rules (taxable, short-term lots, wash-sale, instant settlement + the v98 PDT day-trade guard), the weekly research→target→rebalance-proposal flow, execution policy (**alert & one-tap confirm**). The weekly job is **wired into the producer** (step 7), not a separate trigger. |
| `producer/agentic-due.mjs` | Weekly gate (like `preflight.mjs`) for the agentic research refresh — `AGENTIC_DUE` (exit 0) / `AGENTIC_NOT_DUE` (exit 20), keyed off `agentic-target.json` `asOf` ≥ 7d. Producer step 7 runs the deep research only when DUE. **v93:** the gate is now also tripped EARLY by `agentic-triggers.mjs` (a deposit or a big held-name gap → `refreshResearch`), so research doesn't wait out the week when something material happens. |
| `producer/agentic-triggers.mjs` | **Pure event detection (v93, unit-tested).** `computeAgenticTriggers(prior, fresh)` — called by `build-data.mjs` (both snapshots in memory, like `computeAlerts`) → `producer/raw/agentic-triggers.json`. Two things: (a) a **`deploy-cash`** trigger when idle cash newly crosses ~5% of book OR a fresh **deposit** lands (inferred like `cumFlow`: ΔEquity − price-move ≥ $200) — transition-based so it nudges once, not every 30-min run; the agent `PushNotification`s it. (b) **`refreshResearch`** flag when a deposit lands or a held target name gaps ≥6% in one run (earnings/news) — the producer runs the research workflow THIS run even if `agentic-due` says NOT_DUE. Replaces the purely-calendar-driven refresh: the system now reacts to deposits + earnings, not just the 7-day clock. |
| `producer/agentic-deploy.mjs` | **Pure deployment/rebalance planner (v93, unit-tested; FULL-BOOK since v96; LIMITED MARGIN since v98).** `planDeployment({target, positions, cash, quotes, earnings, washMap, crossActivity, accountActivity})` → a ready-to-execute ticket, enforcing the execution discipline that was previously only prose: **earnings blackout** (never deploy NEW money into a name ≤7d from its report — wait for the print), **gap-through-entry re-verify** (a name at/below its target stop = broken → defer; below its planned entry zone = thesis in question → defer, the GOOGL-after-earnings case), **wash-sale** (reads `recentLosses`), and **cash-flow-first / sells-before-buys** sequencing. **v96 additions** (the planner used to see only target names — 40% of the book once sat invisible in research-dropped names): **off-target exits** (a held name absent from the target = explicit SELL-to-exit), **tax-aware sale ordering + estimates** (losses first, per-sell est. ST P&L, `taxSummary` netting), **opportunistic TLH** (target name underwater ≥ max($75, 5% of cost) → harvested whole, wash-blocked from the buy legs), **cross-account wash guard** (`crossActivity` = recent margin-book buys; a recent buy there kills a harvest / flags an exit `washRisk` — executor fetches this live), and the **auto tier** (`autoEligible` = turnover ≤ `AUTO_TURNOVER_CAP` **$1,000** — owner-approved unattended-execution ceiling; raised from $500 on 2026-08-11 because routine drift top-ups kept landing just over it and stalling on a confirm). Buys move each underweight name only toward its (already cluster/vol-capped) target, so honoring the target respects the risk caps. Mirrors the consumer's Agentic-card badges so card + ticket agree. **v98 — LIMITED MARGIN (2026-08-11):** ••••3900 was upgraded from a cash account, so proceeds are spendable the moment a sell **fills**, with **no borrowing or leverage** (`unleveraged_buying_power == buying_power` — "unlevered 1×" still holds). (a) **The T+1 leg is gone** — one allocation pass over `cash + proceeds` (also better sizing: leg-1 used to pro-rate over settled cash alone and top names up a day later); `buysT1` is always `[]`, kept in the shape only so tickets written under the old two-leg model reach `done`; `buysNeedProceeds` flags when the buys require the sells to fill first. (b) **PDT now applies** — a limited-margin account is a margin account for FINRA, so 4+ day trades in 5 business days under $25k restricts it, and this book is ~$5k with an hourly executor. The guard is categorical, not a counter: `accountActivity` (`{SYM:{lastBuyDate}}`) refuses to sell **anything bought today** (→ `blockedSells`), across exits/harvests/trims — zero round trips ⇒ PDT can't accrue. The gate can't see today's fills, so the **executor supplies `accountActivity` live** from `get_equity_orders` on ••••3900.  **v102 — entry-band discipline + the waiting ground.** The zone check was a one-sided bright line (`px < entryLow`, no tolerance, nothing above) and failed three ways on 2026-08-11: V at 0.2% under a floor parked $437 (**no tolerance**); THREE of seven names read "below entry" at once purely because the zones were six days stale (**no ageing**); and the re-verification deliberately set every zone *below* spot, which the planner would have bought straight through because **"too expensive" had no code path**. Now: a SYMMETRIC band — `ENTRY_TOLERANCE_PCT` 2.5% under the floor, `ENTRY_PREMIUM_PCT` 2.0% over the ceiling (new `above-entry` deferral) — zones go **advisory** past `ENTRY_ZONE_STALE_DAYS` (7, off `target.asOf`), and `below-stop` stays absolute and unbanded because that one is the real thesis-broken signal. **Idle-cash deadline:** nothing ever forced cash IN, so "wait for a pullback" had no expiry and a rising market could strand a deposit indefinitely; past `CASH_IDLE_DEPLOY_DAYS` (10, from `data.agentic.cashIdleSince`) the bands are waived and cash deploys in `CASH_IDLE_TRANCHE_PCT` (34%) tranches, sweeping whole below `CASH_IDLE_SWEEP_FLOOR` ($250) so thirds-of-a-shrinking-balance can't run forever. **INDEX PARKING (`PARK_VEHICLE` = VTI, owner's design):** a deferred name's dollars go to a broad-market placeholder instead of idling in cash, and are released to fund the name when it clears. **VTI, not SPY** — SPY is the target's own ballast, so parking there buries the placeholder inside a position that has its own weight; a separate ticker makes it visible, and VTI/SPY track different indexes so the two never become substantially identical for wash-sale purposes. **Not QQQ** (~half megacap tech = the very cluster `riskweights.mjs` caps at 48%). Two load-bearing invariants: the vehicle is **exempt from off-target exits** (it is absent from the target by design, so the v96 orphan rule would liquidate it every pass while parking rebuilt it — an infinite taxable churn loop), and **unparking is a taxable ST sale**, so releases are floored at `PARK_MIN` ($100), sized to the actual shortfall, and run through the same losses-first ordering and PDT guard as any other sell. Plan carries `entryPolicy` + `parking`. **CHURN GOVERNOR (2026-08-12).** On 08-10 the planner exited GE/LLY/AMZN/MSFT (dropped by the 08-05 target) and bought AAPL/UNH/V; on 08-12 the next target reversed BOTH legs — a near-total book flip in 48h, every leg ST-taxable, because nothing priced the cost of changing our mind (memoryless weekly research × full-delta execution). Three deterministic guards now: **min-hold** (`MIN_HOLD_DAYS` 14 — a name bought inside the window is not exited/trimmed; overridden only by a `target.dropped` **business-broken** verdict, a ≤`MIN_HOLD_EXEMPT_LOSS_PCT` (−10%) loss — risk control outranks churn control — or by being a TLH harvest/park-release; day 0 stays the harder PDT block), **re-entry cooldown** (`REENTRY_COOLDOWN_DAYS` 14 — a name this account sold inside the window is not rebought; deferral reason `reentry`, weight parks in VTI like any deferral; covers the GAIN-sells the 30d wash ledger can't), and a **dust floor** (`MIN_BUY` $25 — the 08-05 ticket placed a $1.80 UNH buy). A `phaseOut` target name (below) is held but never bought into and never parks. `accountActivity` gained `lastSellDate`; the exec gate now derives it from the committed decisions ledger (`activityFromDecisions`) and the executor overlays today's live fills. |
| `producer/agentic-pending.mjs` | **Pure rebalance-ticket state machine (v96, unit-tested).** The ticket lives in the COMMITTED `producer/agentic-pending.json` (raw/ is wiped every run — the target/ledger pattern): `proposed → confirmed → sells-placed → buys-placed → done` (or `aborted`), with `makeTicket` / `advanceTicket` (illegal transitions throw) / `nextAction(ticket, todayET)` (what the executor should do NOW: await-confirm · place-trades · place-buys once the sells fill · stale → re-plan after 5d) / `planHash` (don't re-nag an identical outstanding proposal). `build-data.mjs` attaches a live ticket as `data.agentic.pending` so the card shows "rebalance in flight". |
| `producer/agentic-parked.json` | **The index-parking ledger (v102) — the "waiting ground".** When the deploy planner defers a target name, its dollars are parked in a broad-market placeholder (`PARK_VEHICLE` = **VTI**) instead of idling in cash, and released to fund the name when it clears. This COMMITTED file is the **only** system of record: `raw/` is wiped every run and the executor may never write `data.json`, so neither can hold state the executor mutates (same reasoning as `agentic-target.json` / `agentic-decisions.json`). `build-data.mjs` reads it into **`data.agentic.parked`** (committed file wins; prior snapshot is the fallback) and `agentic-exec-gate.mjs` reads it directly, so a park/release written this session is visible on the very next pass without waiting for a producer run. The executor rewrites it after a park or release FILLS (AGENTIC.md §executor step 3f) — it is the **third and only other file** the executor may commit. Skipping that write silently breaks the mechanism: the ledger reads $0 while the vehicle is actually held, so the next pass can't release it and the money strands in a placeholder nothing accounts for. |
| `producer/agentic-exec-gate.mjs` | **Deterministic gate for the agentic EXECUTOR (v96)** — preflight for the self-driving rebalance loop (see AGENTIC.md §executor). Prints one mode and exits: `EXEC_TRADE` (ticket confirmed/auto → place sells + leg-1 buys) · `EXEC_BUYS` (carried buy leg due) · `EXEC_AUTO` (fresh plan ≤ $500 turnover → execute unattended) · `EXEC_PROPOSE` (above cap → ticket + push for one-tap) · `EXEC_IDLE` (exit 30: kill switch `PF_AGENTIC_AUTO=off`, market closed, stale/missing snapshot — **trading fails SAFE**, dust plans < $25, or an identical proposal already outstanding). Decrypts the committed snapshot, runs `planDeployment`, writes `producer/raw/agentic-plan.json` for the agent. The gate's plan has NO earnings map — the executor checks `get_earnings_calendar` (and `get_equity_orders` on BOTH accounts — margin for cross-account wash, ••••3900 for the v98 PDT day-trade guard) LIVE before placing. **Since the 2026-08-12 churn governor** the gate DOES pass `accountActivity` (buy/sell dates from the committed `agentic-decisions.json` via `activityFromDecisions`) so the 14d min-hold/re-entry guards bind at plan time; the executor still overlays today's fills live. |
| `producer/riskweights.mjs` | **Pure risk-aware weighting (v93, unit-tested).** `riskAdjustWeights(names)` enforces two caps on top of the research's conviction weights: a **correlation-cluster cap** (`megacap-tech` NVDA/AVGO/AAPL/MSFT/GOOGL/META/AMZN/ORCL/NFLX ≤48% combined — "sector-diversified" labels hid this; payments ≤20%, staples ≤25%; SPY/index uncapped) and a **vol-scaled single-name cap** (a wider 52wk range → a smaller max weight for the same conviction, so 10% in LLY ≠ 10% in SPY). Iterative water-filling + re-normalize to 100%. `clusterOf`/`volScaledCap` reused by the deploy planner. |
| `producer/finalize-target.mjs` | Turns the research workflow's raw `allocation` into the committed `agentic-target.json`, **deterministically re-enforcing** `riskweights.mjs` caps (the workflow proposes, this disposes — cluster/vol caps hold regardless of the LLM output). Producer step 7.4 pipes the workflow output through it; also `import { finalizeTarget }` for on-demand rebalances. **Two-strike phase-out (2026-08-12 churn governor):** a HELD name in the prior target but missing from the new allocation is **retained at its prior weight, flagged `phaseOut:true`** (zero trades — if next week re-includes it, nothing was ever sold); still missing on the NEXT refresh → genuinely dropped; an explicit adverse verdict (`businessOk:false`/rec `avoid`) drops immediately. Drop reasons land in **`target.dropped`** (`business-broken` unlocks the planner's min-hold). The CLI auto-reads the committed target as `prior` (`--no-prior` to disable) and takes `--held SYM,…` (••••3900's current tickers — without it every prior name is protected, which fails safe since the planner never BUYS a phaseOut name); `verdicts` come from the workflow return. |
| `producer/agentic-ledger.mjs` · `producer/agentic-decisions.json` | **Rebalance decision ledger (v93, unit-tested).** The committed JSON is the owner-confirmed log of each deploy/rebalance (`{date,kind,trades:[{sym,side,dollars,priceAt}],spyAt,rationale}`); the agent APPENDS a record on confirm (`makeDecision`). `build-data.mjs` reads it, `gradeDecisions(…, quotes)` grades each vs live prices + SPY (dollar-weighted contribution, alpha, ahead/behind/open verdict), and attaches it as `data.agentic.decisions` for the consumer's **Rebalance Log** card. The account's own Track Record — so the strategy gets smarter, not just busier. Also exports **`activityFromDecisions`** (2026-08-12): ledger → `{SYM:{lastBuyDate,lastSellDate}}` over a trailing window — the exec gate's input to the deploy planner's min-hold/re-entry churn guards. |
| `producer/railway/` · `producer/RAILWAY.md` | Optional credentialed Railway producer (Python `robin_stocks` fetch → existing Node tail). See the runbook. |

## Conventions
- **Branch:** develop on `claude/portfolio-dashboard-data-ffc7x3`; the producer publishes `data.json`
  to `main`. **Push code straight to `main`** — the owner gave standing authorization (2026-08-11); a PR
  the agent opens and merges alone is ceremony, and both the producer and the agentic executor read
  `main`, so unmerged work simply never takes effect. Open a PR only when the owner asks for one, or
  when a change is large/risky enough that a reviewable diff is genuinely worth the round trip. Run the
  test suite before pushing (see "Verify before shipping").
- **Versioning:** any change to `index.html`/`sw.js` → bump **both** `APP_VERSION` (in `index.html`
  `boot()`) and `CACHE_VERSION` (in `sw.js`) together. Currently around **v110** (`pf-v110`).
- **Theming:** two themes toggled by the freshness-bar control — **Light ⇄ Gold** (`data-theme="gold"` on
  `<html>`, persisted as `pf_theme`; legacy `dark`/`neon` prefs auto-migrate to `gold` in the boot script +
  `toggleTheme()`). Gold is a **rich-gold-on-true-black** dark variant — body + card/tile surfaces are
  near-pure black (`#000`/`#0b0b0c`/`#0e0e0f`, **no brown wash, no glow/blur** — v71 killed the muddy
  translucent gradients that read as "neon"), with thin warm-gold borders, a gold-gradient headline number,
  and a corner-bracket hero frame that's true black with a single soft gold corner-glow. The hero `.snap-grid`
  stat tiles carry **warm per-tile edges** (emerald · bronze · gold · copper · champagne via `:nth-child` —
  no cyan/purple). Cards carry a **soft gold halo** (outer glow + 1px inset top highlight) for emphasis on
  the black bg, and the jewel tiles a faint matching per-tile glow (v72 — re-added after v71 stripped all
  glow). Renamed from the old cyan/magenta "neon" HUD
  in v69–v70: the `data-theme` key, the `_isGold()` chart helper, and `THEME_ORDER` all use `gold` now; the
  historical `--nx-cyan/-mag/-pur` CSS vars are kept (repurposed to the gold/jewel palette). Its CSS is a
  self-contained `html[data-theme="gold"]` block at the end of the `<style>`. Charts read the theme via
  `chGrid()`/`chTick()`/`chLabel()` + `applyChartTheme()` so gridlines/labels stay legible. (The old
  `html[data-theme="dark"]` rules remain but are unreachable — dark was retired as an option.)
- **Encryption:** `data.json` is always encrypted on real runs (`PF_PASSPHRASE`). `run.mjs` refuses to
  push plaintext. Never commit the passphrase or real holdings.
- **Secrets / env (in the web environment, not git):** `PF_ACCOUNT`, `PF_PASSPHRASE`, optional
  `ALPHAVANTAGE_KEY` / `PF_AV_NEWS`, optional `FINNHUB_KEY` / `FMP_KEY` (supplementary fundamentals —
  see `extfund.mjs`; `FINNHUB_KEY` also drives the **flow layer**, `PF_FLOW=off` disables it). Network
  egress allowlist must include `apewisdom.io` (and `www.alphavantage.co` if using direct AV;
  `finnhub.io` / `financialmodelingprep.com` if using the supplementary providers or the flow layer).

## Local dev / preview (no live connectors)
- `node producer/make-sample-data.mjs` writes a **plaintext** sample `data.json` (fake holdings) so
  the consumer renders without the real encrypted snapshot or any MCP access.
- `node producer/serve.mjs` serves the static site locally to eyeball UI changes.
- `producer/gen-icons.mjs` regenerates the PWA icons. **Never commit a plaintext `data.json`** — restore
  the real one with `git checkout origin/main -- data.json` before committing.

## Verify before shipping (no network needed)
- **Unit + integration tests:** `for t in producer/*.test.mjs; do node "$t"; done` — covers the
  extfund normalizers, the picks scoring engine (weights/sector cap/social/coverage flags, the
  **trend gate** and the **recent-stop-out cooldown** — `gradePickClose`/`recentStopCooldown`),
  `shapeSocial`, `computeAlerts`, the **agentic v93 engines** (`riskweights` cluster/vol caps,
  `agentic-deploy` earnings-blackout/gap-reverify/wash-sale planner — plus the **v102 entry-band layer** (tolerance under the floor, the new above-entry premium deferral, zone ageing → advisory, the idle-cash deadline + tranching/sweep, and index parking: park-on-defer, release-to-fund, the off-target-exit exemption that stops the churn loop, PDT-guarded releases, and comma/prose entry-zone parsing) — and its **v96 full-book layer**:
  off-target exits, TLH thresholds + cross-account wash, tax netting, the $1,000 auto tier, plus the **v98
  limited-margin layer** — same-session proceeds funding and the PDT day-trade guard across exits/harvests/trims — and the **2026-08-12 churn governor**: min-hold blocks/overrides (deep-loss, business-broken, harvest-exempt), the re-entry cooldown (+ its VTI parking), the dust floor, and the phase-out no-new-money rule — `agentic-triggers` deposit +
  refresh events, `agentic-ledger` decision grading + `activityFromDecisions`, **`agentic-pending`** ticket
  lifecycle/transitions/staleness), the **flow scorers** (`flow.mjs` — revision
  direction-over-level, the insider open-market filter + buy/sell asymmetry regression, surprise
  clamping, composite renormalization + the abstain-below-2-components rule), the **policy calendar**
  (`policy.mjs` — high-impact-only blackout, source requirement), **`polflow`** (dedupe, the ≥3-distinct-filer
  gate, the megacap-tech exclusion), **`finalize-target`** (the deterministic `drivers` attribution + the two-strike phase-out: strike-1 retention, strike-2 drop, business-broken and not-held drops), the **broker realized-P&L normalizers** (`realizedpnl.mjs` — null transfer-only buckets stay n/a, a missing asset class stays null, all-account totals, and the losses-only/de-duped wash-sale extraction), and a full `build-data.mjs` fixture run
  (empty-bars guard, quotes carry-forward, no-picks log guard, social-sidecar reuse, day-move alert,
  **flow sidecar → `data.flow` + per-symbol carry-forward**, **congressional ledger accumulation + dedupe**, **per-account broker realized superseding the stale owner figure**, and **real closing trades replacing an inferred wash-sale entry**). CI runs these on every
  PR touching `producer/**` (`.github/workflows/tests.yml`). The build-data test temporarily writes
  a plaintext `data.json` and restores it — don't commit mid-test.
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
  Any consumer that reads `data.hist[*]` must coalesce — `b.begins_at||b.t`, `b.close_price ?? b.c`,
  **`b.volume ?? b.v`** (see `fetchHist`/`fetchHistG` and the `az*` helpers in `index.html`). A hard
  `b.begins_at.slice()` throws on Railway data, gets swallowed by `fetchHist`'s `catch{}`, and silently
  empties `histMap` → beta/Sharpe/vol/drawdown/correlation/performance/50-DMA all blank at once. (This
  bit us once; v50.) **Volume:** the Claude-agent path keeps raw RH bars (incl. `volume`); the Railway
  path now carries `v` too (`_bars_from_historicals`, v77 — it previously dropped volume, so the Analyze
  price chart's volume bars silently never drew for Railway-refreshed names). The Analyze **"Price &amp;
  Levels"** volume bars are data-gated: they draw (and the header lists "· volume") only when the symbol's
  bars actually carry volume — older `{t,c}` snapshots show none until a fresh run repopulates it.
- **The Portfolio background-enrichment block is fault-isolated** (`load()`'s `(async()=>{…})` wraps each
  render in a `guard()`). Keep it that way — without it, one throw leaves every card below it stuck on its
  spinner forever. Don't "simplify" the guards away.
- **`producer/raw/` is gitignored and EMPTY on every scheduled run** (fresh clone). Any "once/day"
  gating must derive from the committed `data.json`, not raw/ marker files. **This bit us for real (v95):**
  `av-fetch`, `extfund-fetch` and `flow-fetch` all gated on a `.fetched` marker *inside* `raw/`, so on the
  scheduler the gate never tripped and each re-spent its full provider budget on all ~13 runs of the day —
  extfund alone burned ~70 FMP calls/run against a ~250/day cap, exhausting it within the first few runs
  and then silently dropping supplementary fundamentals for the rest of each day. All three now go through
  **`producer/fetchgate.mjs`**, which reads `data.fetchDays.{av,extfund}` / `data.flow.asOf` from the
  decrypted snapshot; `build-data.mjs` stamps those and **carries them forward** on runs where that
  provider didn't fetch (otherwise skipping would clear the stamp and re-trigger the fetch next run).
  Fails OPEN — no snapshot / no passphrase / decrypt failure all fetch, since one extra fetch is far
  cheaper than a starved snapshot.
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
- **The agentic ••••3900 fetch is EVERY-RUN, not FETCH_ALL — skipping it silently FREEZES the card.**
  The …3900 account's portfolio + positions (`agentic-portfolio.json` / `agentic-positions.json`)
  must be fetched on **light runs too**. If they're absent, `build-data.mjs` carries the prior holdings
  forward, **re-prices** them, and **re-stamps `asOf` to now** — so the Agentic card looks freshly
  updated while share counts + cash are stuck at an old snapshot (new trades/deposits never appear).
  **This bit us hard (2026-07):** the Railway path was the active producer then (`pf-railway-bot`
  commits; the scheduled Claude "Portfolio dashboard refresh" trigger had gone dormant), and
  `fetch_rh.py` only fetched the **main** account — it never fetched ••••3900 at all, so the card sat
  frozen ~$1,033 for a week while the real account had tripled to ~$3,574. Fixed in `fetch_rh.py`
  (`fetch_agentic()` — every run, `PF_AGENTIC_ACCOUNT` to override, fault-isolated: writes both files
  or neither).
  **WHICH PRODUCER IS LIVE FLIPS — check, don't assume** (as of 2026-08-11 it's the **Claude agent**:
  every `data:` snapshot on `main` is authored `Claude <noreply@anthropic.com>` and Railway's last run
  was ~17d prior). One command settles it: `git log origin/main --format='%an | %s' -5` — `pf-railway-bot`
  means Railway, `Claude` means the scheduled agent. This matters because the two paths resolve ••••3900
  DIFFERENTLY: the Claude path via `get_accounts` `agentic_allowed:true` (type-independent), Railway via
  `_agentic_account_number()`. Railway's detector used to filter `type == "cash"` and would have broken
  silently at the 2026-08-11 limited-margin upgrade — latent only because Railway happened to be idle.
  It now keys on structure (the non-IRA account that isn't `PF_ACCOUNT`), since account TYPE is a
  mutable broker attribute and must never be the identity test. The Claude-agent path fetches it too (PRODUCER.md step 2 rows, resolved via
  `get_accounts` `agentic_allowed:true`); its FETCH_LIGHT item list was also corrected to name **both
  accounts**. `build-data.mjs` now `console.warn`s whenever it carries the agentic block forward, so a
  future skip (either producer) is visible in run logs instead of masquerading as fresh.
- **Never infer a realized loss from a position diff.** The ••••3900 wash-sale ledger used to be
  reconstructed by diffing prior→fresh agentic positions. Any run whose agentic fetch returned the WRONG
  account's positions then makes the next *correct* fetch look like a mass liquidation: five losses were
  booked on 2026-08-03 (LLY/NVDA/TSM/CIFR/IREN) for an account with **no closing trades that week** that
  had never held three of those names — and the phantom NVDA loss wash-sale **blocked a real buy** for 30
  days. `get_pnl_trade_history` reports actual closing trades and can't drift like that; it is now the
  source (v98), the inference is Railway-only fallback, and the two **never mix** (`lossSource`).
- **A target refresh is not an execution order — the churn governor stands between them (2026-08-12).**
  The weekly research is memoryless and the deploy planner used to execute the full delta immediately, so
  two consecutive targets disagreeing flipped the whole book: 08-10 exited GE/LLY/AMZN/MSFT and bought
  AAPL/UNH/V, 08-12 reversed both legs — ~$7k of round trips in 48h for positions held under two days,
  all short-term taxable. Now: `finalize-target.mjs` retains a dropped-but-held name one cycle
  (`phaseOut`, two-strike; an explicit `businessOk:false` verdict drops immediately via `target.dropped`),
  and `agentic-deploy.mjs` enforces a 14d **min-hold** on sells + 14d **re-entry cooldown** on buys
  (+$25 dust floor), fed by `activityFromDecisions` over the committed decisions ledger. Don't "simplify"
  a phase-out name into an immediate exit, and don't bypass the cooldown because a target "says so" — a
  target refresh expresses *intent*; the governor decides *when* intent becomes trades. (The consumer's
  Agentic card doesn't yet render min-hold/re-entry badges — the phase-out names reach it naturally via
  the target; mirroring the two account-activity guards client-side is open follow-up. Since v108 the
  Plan tab's agentic side at least *documents* both rules in its Guardrails card, but it still can't flag
  WHICH name is inside a window — that needs the account-activity dates in the snapshot, which
  `build-data.mjs` doesn't emit.)
- **The wash-sale ledger must cover BOTH taxable accounts (v105).** The IRS window is per taxpayer, not
  per account, and the ledger originally read only ••••3900's trade history — so when the owner sold 35
  NVDA at a **−$431.76 loss in the self-directed ••••0741 book on 2026-07-29**, the agentic executor's
  ledger stayed empty and it **rebought NVDA on 2026-08-11 inside the window**, partially disallowing
  the loss (a real cross-account wash sale; Robinhood's 1099-B won't even report it, since brokers only
  adjust within an account). Hence `main-trades.json` (every run) feeds the same ledger tagged
  `account:'main'`, and the executor's live pre-check also pulls the margin book's last-30d losses
  (AGENTIC.md step 3c) to cover a loss booked after the last producer run. Don't "simplify" the ledger
  back to one account.
- **`get_realized_pnl` REQUIRES `asset_classes`** — omitting it errors `un-specified asset class`. Also:
  a bucket with `realized_gain: null` is a **transfer-only** bucket (lots with no cost basis) and must be
  treated as *n/a*, never as $0. Options realized/premium exists on the **margin** account only (••••3900
  has no options level), so a null options block there is correct, not a fetch failure.
- **Cost discipline:** historicals (5Y monthly + YTD daily for ~36 symbols ≈ 24 of ~30 calls) are the
  expensive part. They're fetched once/day (FETCH_ALL) and carried forward — never re-fetch them on a
  light run. The live schedule is **hourly** (the "Portfolio dashboard refresh" Routine, `35 * * * *`
  UTC — the Routine scheduler's minimum interval is an hour; preflight SKIPs the off-hours fires), and
  only the day's first run is heavy; every run after is a cheap light run (historicals/AV/picks carry
  forward), so the cadence stays inexpensive. (See `SCHEDULING.md`, incl. how to get 30-min cadence
  back with a second offset trigger.)

## Feature inventory (what's built)
- **Accounts tab (v99 — the two real accounts, one per side of a segmented toggle):** the tab formerly
  called "Portfolio" now leads with an **Accounts segmented control** (`.acct-seg` → `setAccount('main'|'agentic')`,
  persisted as `pf_acct`, restored at boot) that swaps between two containers inside `page-portfolio`:
  **📊 Self-directed (••••0741 · margin)** = `#app`, everything below, unchanged; and **🤖 Agentic (••••3900 ·
  automated)** = `#agentic-app`, rendered lazily on first visit by `renderAgenticPage()`. The split exists
  because these are two real accounts with different rules (unlevered limited margin, wash-sale ledger, PDT
  guard, the auto-tier executor), and the agentic book previously had no home — its holdings/target/log sat on
  the Plan tab while its only performance readout was an overlay line on the *self-directed* page. The agentic
  side carries a value hero (equity · day move · account tag), the new **📈 Account Performance** card, the
  **🤖 Agentic Portfolio** tracker and the **🧾 Rebalance Log** (both MOVED off the Plan page — a pointer card
  there links back), then a pointer to the Plan tab. Each card renders behind its own `guard()` so a single
  throw (a bad series, a Chart.js hiccup) can't leave the cards below stuck on their spinners. The **card
  jump-nav** skips cards hidden by the inactive side (`hiddenWithin`) and rebuilds on toggle
  (`window.__navRebuild`), so chips always match what's on screen. Privacy masking already scoped to
  `#page-portfolio`, so it covers the agentic side for free.
- **Card parity across the two account sides (v101):** the agentic side now carries the SAME analytics
  cards as the self-directed side — snapshot tiles, 🗺️ Holdings Heatmap, 🛡️ Risk & Diversification,
  🗂 Allocation, 💵 Income & Tax, 📡 Technical Signals, 📋 Fundamentals — plus its own 📈 Account
  Performance, 🤖 Agentic Portfolio tracker and 🧾 Rebalance Log. **They are the same functions, not
  copies:** `agenticEnriched()` returns the margin `enriched` row shape (incl. `pct`, `dayD`/`dayP`
  and `r`=`risk(pct)` — the shared renderers read `p.r.color`, so a row without it throws), and each
  renderer took an optional `opts` — `{sfx}` picks the mount id (`'-ag'`), `{min}` the position floor,
  `{scope}` the account. `renderAgenticAnalytics()` (fault-isolated per card, like `load()`) builds the
  book, fetches this account's historicals (merged over `__SNAP.histMap`, since the margin fetch only
  covers ITS top holdings) and drives them. Two deliberate account-specific differences: the position
  floor is **`AG_MIN_POS` (1), not `SMALL_THR` (250)** — this book is fractional (~$150 names) and a
  $250 floor would empty every table; and the snapshot's 5th tile is **Idle Cash %** instead of Margin
  Used (the account can't borrow, so "Margin: None" was a dead tile — idle cash is what actually
  drives its next rebalance). **Six tiles since v110** — value · day · **Unrealized** · **YTD Return** ·
  idle-cash/margin · beta (beta moved to the last slot, which used to sit empty). The renamed
  **Unrealized** tile was called "Total Return", and that label was actively misleading: it is the mark
  on the lots you hold *right now* (`totalPnL`/`totalRet` off current cost basis), so realized gains and
  every closed position sit outside it — the agentic account read **+0.98% · $100.22** two days after a
  $5,000 deposit was redeployed, while its real year was +5.51% / $252 with another $233 already
  realized. The new **YTD Return** tile carries the honest number per side: agentic reads
  **`agenticYTDStats()`** — the calendar-year slice of `agenticPerfStats()`'s chained, deposit-adjusted
  growth (same math, rebased to the first recorded point of the year, `partial` → the sub-line says
  "since {date}" because the equity series can't be backfilled), so the tile and the 📈 Account
  Performance card can't disagree; the self-directed side has no recorded equity series, so it reuses
  the benchmark card's modeled `__SNAP.perf.portYTD` and labels it **"YTD (holdings) · at current
  weights"**. That side's tile therefore fills in on the *second* `renderSnapshot` call (after
  `renderPerformance` stashes `perf`) — it shows a spinner until then, by design. The heatmap keeps **per-instance state** (`_hmS` keyed by suffix) so the
  two mounts' Day/P&L toggles don't move together. **Income & Tax is scoped**: `accountRollup(..., scope)`
  filters accounts, so the self-directed side keeps the all-account view + By-Account table while the
  agentic side shows only ••••3900 (no one-row table, its own harvest floor, options premium hidden —
  options are margin-only, and the harvest pointer targets the rebalance ticket, not the Action Center).
  Two cards are intentionally NOT duplicated because the agentic side already has a superset: **All
  Positions** (the Agentic Portfolio tracker is the same table plus target/drift/trade) and
  **Performance vs Benchmark** (Account Performance is the real, deposit-adjusted return).
  **The switcher is STICKY and lands you on the SAME section (v107).** `.acct-seg-wrap` pins the
  segmented control below the tab bar (`top: env(safe-area-inset-top) + var(--tabbar-h)`; the height is
  measured live by `_syncTabbarH` because the tab row wraps to two lines on a phone), so accounts can be
  swapped from anywhere in the page. Swapping then **preserves the reader's section**: every paired card
  on both sides carries a `data-sec` key (`snapshot·holdings·performance·heatmap·risk·allocation·income·
  technicals·fundamentals·flow`, plus the unpaired `smalls`/`rebalance-log`), `_currentSec()` notes which
  one is on screen before the swap and `_landOnSec()` scrolls to its counterpart after — so comparing the
  two books' Risk or Income cards is one tap, not a scroll back to the top and down again. An unpaired
  section falls back to the nearest common one **above** it in `SEC_ORDER` (self-directed `smalls` →
  `fundamentals`). Three things here are load-bearing and were each a real bug in development:
  **(a) `__pfTopOffset()` must be built from HEIGHTS + the tab bar's resolved sticky `top`, never from
  live `getBoundingClientRect().bottom`** — a rect-based offset reads ~50px larger while the page sits at
  scroll 0 (nothing is stuck yet), so a scroll computed before sticking and judged after it disagreed with
  itself and landed every jump a section early; **(b) `_currentSec` picks the FIRST section whose bottom
  clears the header by `SEC_EDGE` (40px)** — "last card whose top is above the line" flips to the previous
  section exactly when the next card starts filling the screen, and "whichever card covers the most pixels"
  tips to the *next* section whenever the current one is short (a compact Allocation card handed you off to
  Income); **(c) the nav-chip `topOffset()` delegates to `__pfTopOffset`** — once the switcher became
  sticky, any jump computed off the tab bar alone parks the target card underneath it. First visit to a
  side also runs `_settleOnSec` (re-place for ~1.2s, cancelled by any real scroll input) because that
  side's cards are still filling in and everything above the target grows.
  **Both sides run the SAME card order (v106)** — hero → snapshot tiles → *holdings table* → *performance*
  → 🗺️ Heatmap → 🛡️ Risk → 🗂 Allocation → 💵 Income & Tax → 📡 Technicals → 📋 Fundamentals → 🏛️ Flow →
  pointer, where "holdings table"/"performance" resolve to each side's version of that card (All
  Positions / Performance vs Benchmark on the self-directed side; Agentic Portfolio / Account
  Performance on the agentic side). The agentic page's 🧾 Rebalance Log has no counterpart, so it
  trails after Flow; the self-directed 🧹 Positions Under $250 card is likewise a conditional extra
  (the agentic floor is `AG_MIN_POS`, so it can't apply there). **Keep the spine aligned when adding a
  card** — the toggle swaps the two containers in place, and a card that sits third on one side and
  eighth on the other makes the switch feel like a different app rather than the same view of a
  different account.
- **📈 Account Performance (v99, agentic side)** — the account-level performance the Agentic card never had.
  **`agenticPerfStats(AG, spySeries)`** is now the single source of truth for this math: extracted verbatim
  out of `renderPerformance`, it returns `{EH,mult,cumFlows,ret,spy,since,netFlow,firstEquity,lastEquity,pnl,days}`
  and BOTH surfaces call it (the Portfolio benchmark chart's "Agentic since" stat and this card), so they
  cannot disagree. Everything is **deposit-adjusted**: the headline is a **time-weighted** return that chains
  per-step returns with external flows neutralized (producer `cumFlow` deltas when present, else zeroing any
  implausible >20% one-step jump), because this is a self-funded account with no transfers feed — a deposit
  would otherwise read as profit (the +250% bug). `cumFlows[i]` is the running implied flow, defined as
  `cur.equity − prev.equity×(1+r)` so it stays exactly consistent with the return series. Stat row: Return
  since {date} · S&P 500 same window (+ ahead/behind in pp) · Money made (net of deposits) · You put in
  (start + added **since {date}**) · Account today (invested + cash). **A 💰 contributions strip (v103)
  itemizes every detected transfer — date + amount, most recent bolded, legacy untagged ones flagged `*`
  — because one cumulative "you put in" figure standing next to a same-day deposit reads as though the
  whole amount arrived today (the owner saw $10,083.94 the day they wired $5,000 and reasonably called
  it wrong; the figure was right, the card just never showed its work). `agenticPerfStats` returns
  `flows[]` (per-step implied flow, $50 floor) for it, and the Value-$ chart dots the contribution line
  at each one. Chart toggles **Return %** (deposit-adjusted line vs SPY
  rebased over the same window, aligned by calendar day) ⇄ **Value $** (raw equity with cumulative
  contributions as a dashed baseline — the gap between the lines IS the money made). Degrades honestly:
  under 2 recorded points it explains that tracking can't be backfilled (the broker publishes no
  account-equity history) instead of showing a fake number, and a chart failure leaves the stat row intact.
- **Portfolio (the Self-directed side of the Accounts tab):** All Positions table (sortable) with a **TOTAL footer row** (value, cost, P&L $, P&L %
  on cost, value-weighted Day %); **Holdings Heatmap** (squarified treemap, sized by value, colored by
  day move or total P&L, tap-to-Analyze, with a "top N of M" coverage note when capped; **locked to
  this account's book** — the v74 Margin ⇄ Agentic compare toggle was **retired in v106**, since v101
  gave the agentic side its own heatmap and one page showing the other page's holdings was a second,
  worse route to the same tiles; `_agenticHeatRows()` lives on as the `-ag` instance's source);
  risk/concentration
  with a **risk-adjusted metrics row** (Sharpe · annualized volatility · max drawdown · beta, computed YTD
  from covered holdings' historicals in `computeRiskMetrics`) plus a **data-derived concentration &
  correlation context** block (largest theme, an **empirical correlated cluster** from actual return
  correlation in `corrGroups`, and the highest-β "fragile leg" from per-symbol betas — no hardcoded
  tickers); allocation; **Income & Tax — ALL accounts, attributed (v98)**: the four tiles (est.
  annual dividends, income/month, **Realized — YTD**, harvestable losses) are all-account totals, and a
  **🏦 By Account** table underneath splits value · unrealized P&L · realized YTD · est. dividends ·
  harvestable across **📊 Individual margin ••••0741** and **🤖 Agentic ••••3900**
  (`accountRollup`/`agenticEnriched`), with a Total row net of margin debt. Previously every figure here
  was margin-only *while reading as the whole picture* — ••••3900's dividend payers, unrealized P&L and
  realized gains appeared nowhere, and the Realized tile was a hand-typed margin figure that had frozen
  (it read $2,335 against a real $4,746.90 across both accounts). Realized is now **broker-reported per
  account** (`data.realized.accounts`); the dividend yield still divides by **dividend payers only**
  (`computeIncome` now returns `mktBasis`/`costBasis` so a multi-account roll-up pools the right
  denominators); the agentic account is scanned for harvestable losses at the **rebalance planner's**
  floor (`AG_TLH_MIN` $75 / `AG_TLH_PCT` 5% of cost) rather than the margin book's `SMALL_THR` $250
  position floor, so the card and the rebalance ticket agree on what's worth harvesting; ex-div rows are
  tagged by account and filtered to genuinely **upcoming** dates; and `load()` now fetches
  COMPANY_OVERVIEWs for the agentic holdings too — they were already recorded in the snapshot, the page
  just never asked, so that account reported **$0** of dividends on a book of SPY/JPM/V/AAPL/UNH.
  Degrades honestly: margin-only (with a note) when there's no agentic snapshot, and an explicit ⚠️ when
  Realized isn't yet broker-sourced for every account shown. The itemized harvest list still lives in the
  Action Center — which now sits on the **Picks page** (see below) — only a summary stat + pointer here. **Est. annual dividends (v94):** `computeIncome` prefers `DividendPerShare`×qty
  but now **falls back to `DividendYield`×market-value** when a holding's overview carries a yield but no
  per-share amount — the case for names that only got the lighter Robinhood-synth overview (e.g. NVDA/TSM via
  the Railway `holdings-fund`), which previously showed **$0** income. The Railway producer now also emits
  `dividend_per_share`/`distribution_frequency`/`ex_dividend_date` (so per-share income + the ex-div list
  populate going forward). Ex-div dates only list names whose overview carries `ExDividendDate`. **Technical Signals** = RSI **+ price vs 50-day SMA** trend. **Performance vs
  Benchmark** plots YTD % return (your holdings vs SPY/QQQ, all indexed to Jan 1) and now **overlays the
  agentic account** (v72): a faint **dotted "modeled"** line (its current holdings priced back to Jan 1,
  same synthetic method as the "Your holdings" line) spliced into a **solid "real"** line from
  `data.agentic.equityHistory` (recorded forward), plus an **"Agentic since {date}"** stat that rebases SPY
  over that same window (`renderPerformance` reads `window.__DATA.agentic`; aligns equity points to the SPY
  axis by calendar day). **The real line + "Agentic since" stat are deposit-adjusted (v92):** they're a
  **time-weighted** return that chains per-step returns and neutralizes external cash flows (deposits the
  owner adds / withdrawals) — using the producer's inferred `cumFlow` deltas when present, else zeroing any
  implausible >20% one-step jump — so funding the account no longer masquerades as a gain (was the bug: a
  deposit had inflated "Agentic since" to +251.83% vs the true ~+2%). All the above commentary is derived from live data; optional owner editorial can be
  supplied via `data.notes`.
- **Plan tab is SPLIT BY ACCOUNT (v108) — the same switcher the Accounts tab carries.** `page-picks`
  now leads with a sticky `.acct-seg-wrap` (`#plan-seg-wrap` → `setPlanAccount('main'|'agentic')`) over two
  containers: **📊 Self-directed** = `#picks-app`, the daily scan + Action Center + Top-3, unchanged; and
  **🤖 Agentic** = `#plan-agentic-app`, rendered lazily by `renderAgenticPlan()`. Both tabs share the
  **`pf_acct`** key, so the app has ONE account context — but each side only re-renders while its page is
  VISIBLE (a Chart.js canvas built into a `display:none` container sizes to zero), so `setPlanAccount` only
  mirrors the other tab's button state and `switchTab` brings whichever page you land on into line. The
  mental model is **Accounts = what you own, Plan = what happens next**, both split the same way.
  The agentic side deliberately carries the **plan half only** — it does NOT restate the holdings/drift
  table or the Rebalance Log (those are the Accounts tab's Agentic side; a card that exists twice is the
  v99 mistake this repo already made once). Six cards: **🤖 Where the plan stands** (the `data.agentic
  .pending` ticket + its `nextAction`, book/idle-cash/on-target/last-rebalance tiles, the `cashIdleSince`
  clock, off-target holdings), **🎯 The target — and why these names** (weights · entry vs. spot · stop/TP ·
  a per-name **Status** badge, with `method` and the per-name thesis + `drivers` behind `<details>`),
  **⏸ What's blocked — and what clears it** (every wash-sale / earnings / entry-band deferral, each with the
  date or condition that clears it, plus whether zones have gone advisory), **🅿️ The waiting ground**
  (`data.agentic.parked` — the VTI ledger), **📏 Guardrails** (the standing rulebook: cluster/vol caps,
  min-hold, re-entry cooldown, wash window, earnings blackout, entry band, drift trigger, auto tier, PDT,
  dust floor, idle-cash deadline, no leverage), and **🔁 How the loop runs**. This exists because `parked`,
  `phaseOut`, `cashIdleSince`, `target.dropped` and the whole rulebook were rendered **nowhere** — they
  lived only in `AGENTIC.md`, i.e. not on the phone. Read-only: it reports what the automated system
  intends and why, and places nothing.
  **The guards are SHARED, not copied** — `agenticWashMap(A)` / `agenticExecMap(rows,targetAsOf,washMap)` /
  `agenticEntryBounds` / `agenticPxOf` were extracted out of `renderAgenticCard` so the card, this page and
  `producer/agentic-deploy.mjs` can't drift; the `AG_*` constants at the top of that block mirror the
  planner's exports one-for-one. A badge that says "buy deferred" while the executor buys anyway is worse
  than no badge. **v108 also fixed a real card bug the new fixtures exposed:** the Agentic Portfolio card
  treated the **`VTI` parking vehicle as an off-target orphan** and put "EXIT — SELL ALL VTI" in the deploy
  hand-off, contradicting the planner's exemption (which exists to stop an infinite park→liquidate→park
  churn loop). It now renders as **`waiting ground` / `parked` / hold** and is excluded from the orphan
  exits. **v109 then finished the split** by deleting the duplicated half from the Accounts card (Target/Drift
  column, TP/Stop sub-line, Targets-to-open strip) — see the Agentic Portfolio entry below. Keep it that way:
  the target belongs to ONE surface, and the reason it's the Plan tab is that a target is about what happens
  next, not about what you own. `make-sample-data.mjs` gained the matching fixtures (`parked`, `pending`, `cashIdleSince`, a
  cross-account `recentLosses` entry, a held VTI, entry zones that trip the band) so all of this renders in
  local preview instead of showing every card in its empty state.
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
  fragile-leg trailing stop, earnings reassess). **The recommended portfolio is a standalone _Agentic Portfolio_ card** (v67 — formerly Step 4 of the Action Center; built by `renderAgenticCard()`. **Moved in v99** off the Plan page onto the Accounts tab's Agentic side, together with the Rebalance Log — the Plan page keeps a pointer card in their place, and `paintActionCenter()` still repaints them from `__SNAP` whenever that page exists.) It is the blueprint for the **agentic account (••••3900)**, no longer a restructuring of the margin book. **Its target is the weekly deep-research output** (`data.agentic.target`, read from `producer/agentic-target.json`; v68) so the card shows drift vs. the REAL deployed basket; **only when that's absent** does a fallback heuristic build a from-scratch, long-only, **UNLEVERED** target from a **fully-independent universe** — top scored picks ∪ a mega-cap **LEADERS** bench (`producer/leaders.mjs` → `data.leaders`, hardcoded fallback) ∪ an SPY/QQQ index core ∪ **whatever ••••3900 already holds** (the margin account is ignored). Sector-diversified (≤4/sector, `TOTAL_CAP` 15, `ADD_SLOTS` ≈ `max(3,12−heldCount)`), conviction-weighted (3.5% floor, `PLAN_SINGLE_CAP` 25% ceiling), normalized to 100%, and **sized to the account's own equity** (`data.agentic.equity` = cash + positions; book = equity, i.e. 1× — no leverage: limited margin grants instant settlement only, never borrowing). **Unified single tracker (v91 — replaced the old target-table + separate "Your holdings — performance" table, which duplicated every held name across two tables).** One table iterates **what ••••3900 ACTUALLY holds** — one row per holding carrying its **Position ($/% of book)**, **trailing performance** (Day % from the live quote's prior close / YTD % off the `data.hist.day` daily-bar series, — until bars are captured), **unrealized P&L ($/%)** (cost = avgCost×qty), and the rebalance **Trade (±sh ≈ $)**. A **Total** footer rolls up value-now/+cash, value-weighted Day & YTD and aggregate P&L. **Held names NOT in the target ("orphans")** still appear in this table (flagged `off-target`, trade = trim-to-exit); the **`VTI` parking vehicle is exempt** and renders as `waiting ground` / `parked` / hold (v108 — the card used to call it an orphan and put "EXIT — SELL ALL VTI" in the hand-off, contradicting the planner's exemption that stops an infinite park→liquidate→park churn loop). **v109 slimmed the card to the BOOK:** the **Target % / Drift** column, the **TP/Stop** sub-line under Trade and the **"🎯 Targets to open"** strip were all removed — the Plan tab's Agentic side (v108) owns the target, its entry zones, its stop/TP and its per-name status including over/under-by-Xpp, so keeping them here was the same numbers in two places AND the extra width pushed the genuinely account-side columns (P&L, Day/YTD) off a phone screen. What remains is what only the book can answer, plus the Trade cell, since that is what the hand-off button actually places; an intro line links across to the Plan tab. When the account holds nothing (all cash) the table is replaced by an info line pointing there. It reads **`data.agentic`** (the account's real cash + positions — emitted by `build-data.mjs` from the producer's `agentic-portfolio.json` / `agentic-positions.json`, carry-forward like realized/options); until that snapshot lands it shows **target weights only**. Brackets (`tpOf`/`stopOf`) are **monitor-only** — fractional positions can't carry resting GTC stops. The **🤖 hand-off button** carries a deploy/rebalance prompt that targets ••••3900 with **fractional dollar-market** orders (review_equity_order → confirm → place). **Wash-sale guard (v91):** the card reads `data.agentic.recentLosses` (the inferred realized-loss ledger build-data maintains) into a `washMap` and, for any target name with a realized loss **inside the last 30 calendar days**, replaces its **Trade** cell with a "⚠️ wait · wash-sale (to {date})" badge, drops it from the deploy hand-off's BUY list (moving it to a **"DO NOT BUY YET"** section with the clear date), and shows a **Wash-sale hold** note below — the target *weight* is unchanged, only the execution is deferred. The 30-day taxable-account rule pairs with the 10-trading-day cooldown on the research picks screen (the user's "both, per surface" choice). (The old margin Step 4 — leveraged to `equityBase + marginUse`, anchored to current margin holdings — was removed from `renderActionPlan`, which is now Steps 1–3 only.) **Execution-discipline deferrals (v93):** alongside the wash-sale guard, the card now defers a BUY (target weight unchanged, buy held back + left out of the hand-off, with an amber badge in the Trade cell and a note) when a target name is inside a **~7-day earnings blackout** (`azEarn` — wait for the print) or has **gapped through its entry/stop** (at/below stop = broken; below the planned entry zone = re-verify, e.g. a name that sold off after earnings). Mirrors `producer/agentic-deploy.mjs` so the card and the producer's rebalance ticket agree. **v104 mirrors the v102 band:** the entry check is symmetric and toleranced (±2.5% under the floor / 2.0% over the ceiling), adds an **`above-entry` deferral** ("⏳ wait for pullback" — nothing guarded that side before, so a target whose zones sat below spot would have been bought straight through), and goes **advisory when the target's `asOf` is >7d old** (the card says so explicitly), since a whole target reading out-of-band at once is stale zones rather than broken companies. `below-stop` stays absolute. **v96 — the hand-off is FULL-BOOK + tax-aware:** off-target orphans are explicit **"EXIT — SELL ALL"** lines (losses first, each with an est. ST gain/loss tag via `estPl`/`orphanPl`), trims carry the same tag, an **"Est. short-term tax impact"** line nets the ticket's gains against harvested losses (with a cross-account wash caveat), and the sequencing (sells first → their proceeds fund the buys the same session, once they fill — v98 limited margin) is spelled out, along with the PDT rule that nothing bought today is sold today — mirroring the planner. A **🤖 Rebalance-in-flight strip** renders whenever `data.agentic.pending` carries a live executor ticket (id · status · legs · turnover · est ST net · what happens next). A sibling **🧾 Rebalance Log** card (`renderAgenticLog`, reads `data.agentic.decisions`) grades every confirmed deploy/rebalance vs what happened next + vs SPY (ahead/behind/open) — the account's own track record. **The whole loop is now self-driving (v96):** a separate hourly **executor** trigger (AGENTIC.md §executor — `agentic-exec-gate.mjs` → `agentic-pending.json` state machine) exits/harvests/rebalances unattended within the owner-approved **$1,000/ticket auto tier** and pushes one-tap proposals above it, with tiered TLH (losses-first on every sell + opportunistic harvests ≥ max($75, 5% of cost)).
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
  **Compact by default (v89):** the card leads with the 3 headline stats (Hit rate · Avg return ·
  **Record** = W·L) + a one-line **resolved-vs-open** clarifier (resolved = a close hit a target=win or
  stop=loss; open = still running, excluded from the hit-rate) + a **compact recent-outcomes chip strip**
  (last 12, most-recent first: ✅ win · ⛔ loss · • open). The full per-scan breakdown (entry/exit levels,
  recent 8 scans) is tucked behind a native **`<details>` "View graded detail"** expander (`.trk-detail`)
  so the card no longer grows unbounded as history accrues. Headline stats now reuse `picksTrackStats()`
  over the FULL history (previously recomputed inline over only the 8 shown scans, so they could diverge).
  **EPISODE dedupe (v91):** `picksTrackStats()`/the chip strip now count **episodes**, not per-scan re-picks —
  `picksEpisodes()` groups each ticker's archived picks chronologically and starts a new episode only on a gap
  > `EPISODE_GAP_DAYS` (14, matching the cooldown), grading each episode from its **earliest entry** (the
  outcome of that continuous position). So one broken thesis re-picked daily counts **once**, not N times: ORCL,
  re-surfaced ~10 sessions before it got trend-gated, had turned the record into 0W·10L off a single bad call —
  now it's a single ⛔ episode (chip shows **·N** = how many times it was re-listed). The `<details>` per-scan
  breakdown stays granular; only the headline/record/strip dedupe. (The producer-side cooldown, above, prevents
  *future* daily re-picks; this fixes the historical measurement distortion.)
  Dynamic Earnings Preview follows the soonest-reporting top pick. **Robinhood watchlist sync:** on
  each FETCH_ALL run the producer mirrors the composite top 10 into the **"Dashboard Top 10 Picks"**
  Robinhood watchlist (daily add/remove diff via `sync-watchlist.mjs`), so the list in the Robinhood
  app always tracks the Picks table.
- **Analyze:** per-ticker technical+fundamental breakdown, Recommendation card, Sentiment & Buzz card,
  chat-to-build-trade + Robinhood deep links. **Card de-dup (v85):** the deep dive was slimmed by folding
  redundant cards into their natural home — the standalone **Exact Trade Levels** + **Position Sizing** cards
  are gone, their Entry/Stop/TP1·TP2 (now with target %), the risk-based share-size line, and the hand-off/RH
  buttons all live in the **Recommendation** card so the whole trade plan reads as one unit (`azRec(a,x)` —
  takes `x` for sizing/held); **News Sentiment + Social Pulse merged** into one **🗣️ Sentiment & Buzz** card
  (news block + retail-buzz block, divider between; help key `sentiment buzz`); fundamentals
  **stopped being repeated** in the narrative (Valuation & Catalysts owns P/E·Fwd P/E·Rev-growth·yield, and now
  the **Sector** tile too); and **β is shown once** (Indicators), dropped
  from the setup-gauge subtitle and the Recommendation meta line. **Round 2 (v86):** the standalone
  **📖 Understanding This Analysis** card was retired — its Trend/Momentum-RSI rows just re-stated the Indicators
  grid + gauge bars; the one teaching blurb that carried weight (**💡 Why this signal** — the plain-English read
  of the call + dampeners, built as `whyTxt`) now renders **under the Setup gauge**. **🕒 Multi-Timeframe** folded
  into the **Indicators** card as a compact "Timeframes" line (D/W/M ▲▼ glyphs + alignment). **🧱 Key Levels merged
  into Scenarios** → one **🎲 Levels & Scenarios** card (support/resistance block above the bull/base/bear table;
  help key `levels scenarios`). **Round 3 (v87):** the two big chart cards left the Analyze stack — the verbose
  **🔭 Chart Pattern Verdict** card became a small subtle **🔭 Chart read** pill above the Recommendation, and the
  **📊 Interactive Chart** launcher card was dropped (chart opens from the pill / the 📊 Chart button by the input;
  its help moved into the analyzer modal). See the Chart Pattern Verdict entry below for detail. Net Analyze deep
  dive ≈ 13 cards. All pure consumer-side — no producer/data change; the chart **internals** (detection, modal)
  are unchanged, only their placement. **The setup score is no longer technical-only (v75):**
  `analyzeStock()` blends a **fundamentals/quality sub-score** (`_fundScore` — forward P/E, revenue
  growth, PEG, profit margin, analyst-target upside; neutral 50, returns null when <2 inputs so sparse-AV
  names fall back to the old technical-only weights) into the setup at **15% weight** (pattern 34 / signal
  30 / risk 21 / fund 15). Two **confidence-only dampeners** (they never move the setup score) also fold
  in data we already collect: an **imminent earnings print** (≤7d → IV-crush/gap haircut, via `azEarn`)
  and a **high-VIX regime** on a bullish call (`azVix()` reads the recorded `INDEX_DATA` VIX synchronously;
  ≥22 elevated / ≥30 high). All three are surfaced transparently — the fundamentals score in the
  Recommendation meta line + Fundamentals narrative, the dampeners in the "Why This Signal" note + meta
  chips. The ticker box has **native autocomplete** over the
  analyzable universe (`azUniverse` = holdings ∪ picks ∪ daily-bar symbols ∪ quotes ∪ options book),
  and a **miss shows clickable suggestions** instead of a dead-end. Every card is collapsible +
  jump-navigable (shared `.card-nav` / auto-collapse observers). Price chart adds **volume bars
  (data-gated — only when the bars carry volume; the header drops "· volume" otherwise) + an
  RSI(14) sub-panel** (30/70 bands); axis/tooltip dates are compacted via `azDateLbl` (e.g. "Jun 12",
  not the raw ISO timestamp). **Scenarios** show a **±1σ implied expected-move band** anchored
  to live option IV when available (`azIV`, else a realized-vol proxy, labelled market-implied vs
  est.); **Historical Edge** widens its RSI match band adaptively (±8→±20) for a usable sample;
  **Options Play** links to the Options tab and flags real greeks when you hold live contracts on the
  name; **limited-data** tickers get an explicit "locked until next run" card. Colour-coded signals
  carry redundant **▲/▼/■ glyphs + text labels** (a11y) and the setup gauge has an `aria-label`.
  Last-analyzed ticker and the compare ticker persist via `localStorage`; `azExtra`/`azCorr` are
  memoized per snapshot (`data.generatedAt`). **Chart Analyzer (v78–v79):** the inline Price-&-Levels card was
  **replaced (v79)** by a **📊 Open chart & pattern analyzer** launcher (the **📊 Chart** button beside the
  Analyze input also opens it) → a large, full-screen **`azCMOpen()`** modal: one big chart with **switchable
  timeframes** (1M/3M/6M/YTD daily; 1Y/5Y from `hist.month`), a **Line ⇄ Candles** toggle (candles are pure
  Chart.js **floating bars** — body=open(≈prior close)..close, wick=low..high, colored by up/down — **no new
  dep**), a **volume overlay + an RSI(14) sub-panel**, and a **pattern scanner**. **Indicator fix (v79):**
  SMA20/50 + RSI are computed over the **full** daily/monthly series in **`azCMWindow()`** then sliced to the
  visible window, so the MAs span the whole view instead of restarting blank at the left edge (the old
  per-slice recompute left SMA50 a stub on short timeframes). **Patterns:** Head & Shoulders (+ Inverse), Cup
  with Handle, Double Bottom, Bull Flag, **Ascending/Descending Triangle, Falling/Rising Wedge**, plus two
  overlay filters — **auto Trendlines** and **Support/Resistance zones**. Detection is a self-contained
  heuristic module (no deps beyond Chart.js): **`azCMPivots`** is an adaptive **ZigZag** swing-pivot detector
  (≈4× median-bar-move reversal threshold, clamped 2.5–8%); reversal/continuation matchers
  (`azCMHS`/`azCMCup`/`azCMDouble`/`azCMFlag`) plus geometry-fit ones (`azCMTriWedge`/`azCMTrend`/`azCMSR` via
  `_cmGeom`/`_cmFit` — triangle = one flat side + one sloped; wedge = both sides sloped same way + converging)
  each return a `{found,conf,points,lines,target,bias,…}` shape. **`azCMDrawChart`** overlays it (swing dots,
  neckline/rim/trend lines, measured target), **`azCMDrawRsi`** draws the RSI panel, and **`azCMVerdict`**
  renders a teaching panel that now also shows **volume/RSI/divergence confirmation** (`azCMConfirm`) and a
  **per-symbol historical hit-rate** (`azCMBacktest` slides the same detector across the name's full daily
  history → forward-return win-rate in the pattern's bias). A **📡 Pattern Radar** button on the Analyze page
  (`azPatternRadarOpen`→`azPatternScan`) scans holdings + picks for any pattern and lists hits (tap → opens
  that name's chart with the pattern drawn). All overlays are plain Chart.js datasets (markers/lines as
  `_pts`/named line datasets; candle bars use `grouped:false` so wick/body/volume overlay instead of dodging).
  **Multi-timeframe confluence (v80):** when a pattern is selected, `azCMRender` re-runs the detector across
  every available timeframe and **glows the timeframe chips** (`.cm-found` — green ● + ring) where it's also
  found (stashed in `_azCM._foundTFs`); the verdict adds a **confluence note** (which other frames agree, or a
  single-timeframe/lower-conviction caveat), and a collapsible **"How the timeframe changes your read"**
  explainer (short=tactical / medium=swing / long=structural; longer frame wins on disagreement) lives in the
  modal + the `interactive chart` help entry. **Chart Pattern Verdict (v83):** `azChartVerdict(sym)` (memoized
  per snapshot) aggregates EVERY directional pattern across EVERY timeframe into one bull/bear/mixed/none read
  — each hit weighted by `confidence × volume-RSI-confirmation × its own historical hit-rate × timeframe`
  (longer = heavier; backtest deduped per pattern+bias). It's **independent of `analyzeStock`** (which blends
  RSI/trend/momentum/fundamentals), so `azVerdictVsAnalyze` frames it as a second opinion — **agree** = higher
  conviction, **diverge** = a clean pattern fighting the blended read (size down/wait). `verdict.groups`
  collapses every recognized pattern → the timeframes it shows on, for a **compact, non-clickable** summary.
  Surfaced as a compact "Chart read" line near the **top** of the modal (a pill + short agree/diverge tag +
  the grouped recognized-pattern list — phone-friendly; the timeframe row + pattern scanner are grouped
  together below the chart so the glow stays visible while filtering). **On the Analyze page (v87)** it's a
  small, subtle **🔭 Chart read** pill placed **above the Recommendation** — `icon · label · conviction%` + a
  one-line agree/diverge tag (`azVerdictVsAnalyze().short`) + a 📊 Chart button; `data-help="chart pattern
  verdict"` keeps the popup. The old verbose **🔭 Chart Pattern Verdict** card AND the **📊 Interactive Chart**
  launcher card were **removed from the Analyze stack** — the full pattern/driver detail lives in the analyzer
  modal (`azCMOpen`, opened by the pill, the **📊 Chart** button beside the ticker box, or Pattern Radar), and
  the `interactive chart` help moved into the modal header (a **?** button → `openHelp('interactive chart')`).
  Research/education only — reads are
  tendencies, detection is heuristic and can miss/over-fit. Reads `azSeries`/`azSeriesMonthly`; nothing from
  the producer changed (pure consumer-side).
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
- **🏛️ Flow & Positioning (v95; moved to the ACCOUNTS page in v100, split per account in v102):** a card (`renderFlowCard(opts)`) mounted ONCE PER ACCOUNT SIDE — `{scope:'main'}` at the foot of `#app`, `{scope:'agentic', sfx:'-ag'}` on the agentic page directly above the Rebalance Log. Each shows only that account's names (`inScope`: margin-held, vs agentic-held ∪ agentic-target), because a shared card sitting outside the toggle listed margin-only tickers under the Agentic side — noise about a book you aren't looking at. Rows stay tagged 📊 self-directed-held / 🤖 agentic-held / 🎯 agentic-target (own account's tag first) so a name in both books is still obvious; an empty scope says so rather than rendering a blank table + an Analyze **🏛️ Flow read chip**
  showing who is *acting* on your names — analyst revision direction, insider Form 4 clusters, earnings
  surprise, federal contract awards — plus a lobbying-intensity strip and a labelled congressional-cluster
  strip. Reads `data.flow`; a name with too little data **abstains** rather than showing a misleading
  middling score. **DISPLAY-ONLY through the burn-in**: the research workflow's 5th sleeve exists and is
  wired, but `FLOW_WEIGHT` in `.claude/workflows/agentic-research.js` is **0** — flipping it to `0.10` after
  the burn-in is the single line that switches the layer on (the other five sleeves scale proportionally, so
  their relative standing is unchanged either way). Congressional clusters carry **zero weight permanently**.
  `finalize-target.mjs` tags each target name with `drivers:[]` (the sleeves scoring ≥7, derived
  deterministically from sleeve scores rather than trusted from the model) so the Rebalance Log can
  eventually answer whether the sleeve earned its keep — which is what makes it removable.
- **Table readability (v97):** the three wide scrollers (All Positions `#pos-table`, Picks `#picks-table`, the Agentic holdings table `.sticky-first`) pin their **first (ticker) column sticky** while the rest scrolls sideways — opaque per-theme background (`--sticky-bg`, gold override) + a soft edge shadow, so rows stay identifiable mid-scroll. The Picks table is **ticker-first** (was Score·#·Ticker) and the Agentic table's **Target/Drift sits next to Position** (allocation read side-by-side, perf after). `fmtP`/`sc`/the agentic `pctCell` are **display-zero aware**: a value that rounds to 0.0% renders neutral gray, never a red "-0.0%" (the weekend quirk). `thead th` contrast bumped (#9ca3af→#6b7280, light theme).
- **Freshness bar:** shows the snapshot label/age and **tints amber with a "↻ to refresh" nudge when the
  snapshot is ≥3h old** (computed from `data.generatedAt` in `boot()`); also hosts the build version,
  privacy, theme, and refresh controls. **v88 made it live**: the tint/label repaint every 5 min and on
  every foregrounding (no more fresh-looking hours-old bar in a resident PWA); on resume after ≥5 min
  away it peeks at `data.json` (fingerprint = `ct` prefix, stashed as `window.__PF_SNAP_FP`) and
  **auto-reloads into a newer snapshot**; the SW registration now calls `reg.update()` on load/foreground
  and a newly-installed version shows a **"⬆️ tap to update" nudge** in the bar (`window.__pfNudge`) instead
  of silently waiting; `pfForceUpdate` re-downloads the shell BEFORE wiping caches (offline tap can no
  longer blank the app); decrypt failures distinguish **corrupt snapshot** (bad base64 envelope) from
  wrong passphrase, and 10 failed attempts dismiss the overlay into the bar's Locked state.
- **Card help popovers (v76):** every card header carries a small **"?" button**; tapping it opens a
  teaching modal that explains what the card shows, what each stat/number means, and what to look for
  (e.g. RSI bands, beta/Sharpe/drawdown, the composite weights, the greeks, expected-move ±1σ, the
  2s10s curve). Implemented as a **pure UI overlay** in a self-contained IIFE near the collapsible/nav
  enhancers in `index.html`: a `HELP` registry keyed by a normalized signature of the card title (chevron/
  hint/badge/buttons stripped) + a tiny `PREFIX` list for dynamic titles (e.g. "Earnings Preview · {tkr}"),
  a `decorate()` that injects the button into each `.card-title`, and a single shared `#help-modal`
  (`openHelp(key)`). A MutationObserver over all five page roots catches late-rendered/dynamic cards
  (Analyze especially). The 2 ambiguous/dynamic headers carry an explicit `data-help` (the Analyze compare
  result header → `cmp-head`); everything else resolves by signature. Reads nothing from `data.json`,
  never blocks a render. Theme-aware (`.help-box` gets `--hb-bg`/border overrides for dark + gold). To
  add/edit content, edit the `HELP` object; to cover a NEW card, add an entry keyed by its title signature
  (lowercase, non-letters → spaces) — no per-card markup needed since the decorator auto-injects.
