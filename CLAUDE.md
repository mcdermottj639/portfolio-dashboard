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
   loss the owner books in ••••0741 must block agentic rebuys too), AND (v127) `get_equity_orders`
   on the **main** account (`state:"filled"`, 120d) → `main-orders.json`, from which
   `maindecisions.mjs` derives the **self-directed Rebalance Log**. On **FETCH_ALL** it also
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
   research refresh; when `AGENTIC_DUE`, the agent runs the **`agentic-research`** workflow — screening the wide
   `research-universe.mjs` bench (137 names / 20 sectors, sliced sector-balanced), cutting **16 finalists with 5
   slots reserved for challengers** (`finalists.mjs`), then adversarial verify → synthesis → writes
   `producer/agentic-target.json` (commit+push) → computes drift vs ••••3900 → **`PushNotification`s the
   owner a rebalance proposal** (places nothing — alert & one-tap-confirm). Fault-isolated like step 5;
   never gates the publish. See `AGENTIC.md` / `PRODUCER.md` step 7. Adds no Robinhood writes (reads only).

## Plan → Build → Verify (standing development process, owner-set 2026-08-25)
Every substantive change to this repo runs a three-stage split, chosen for usage-limit economics AND
because the verifier must not be the builder grading its own work:

1. **PLAN (Fable).** Structure the task: what changes, in which files, what the Routine/doc surface is,
   what could silently break. A plan that doesn't name the Routines and docs it touches is incomplete.
2. **BUILD (Opus).** The heavy implementation. Mechanics: a session running as Fable delegates the bulk
   build to Opus subagents (`Agent` tool with `model:"opus"`; Workflow stages via `opts.model`) rather
   than building inline; a session already running as Opus builds directly against the plan. Check which
   model is serving via `get_session` when it matters — do not guess.
3. **VERIFY (Fable).** Runs before "done" is ever reported, and it is an adversarial audit, not a re-read
   of the build's own summary. If no Fable pass is available the builder self-audits and SAYS SO.

**The verify checklist — every item earned its place by catching a real defect on day one (2026-08-25):**
- **Full suite:** `for t in producer/*.test.mjs; do node "$t"; done` — green is the entry ticket, not the audit.
- **Simulate the next scheduled run of every Routine the change touches.** Run `agentic-exec-gate.mjs`
  against the committed snapshot; drive the research pipeline (`finalize-target.mjs`) with the real bench
  and workflow-shaped input. "Works when driven by hand" ≠ works on schedule. (Caught: the gold sleeve
  landing unpriced on a scheduled research day because GLDM wasn't in the bench's symbol list; the
  min-hold gating the first post-refresh rebalance to $0 turnover.)
- **Grep the docs for claims the change falsified** — this file's key-files rows and gotchas, AGENTIC.md,
  PRODUCER.md, and the live Routine prompts (`list_triggers`). A code change that a doc or prompt still
  contradicts is NOT shipped. (Caught: the riskweights row still describing look-through as enforced
  after it went report-only; AGENTIC.md step 2 still naming the retired leaders bench.)
- **New data shapes reach the consumer or are logged as explicit follow-up** — e.g. `target.diversifier`
  is emitted but not yet rendered by the Agentic card (open follow-up, noted 2026-08-25).
- **Findings get FIXED in the same session**, then the owner gets a findings-or-clean statement.

The production Routines are NOT part of this split — they execute fixed pipelines, and their `model`
changes only on the owner's explicit ask via `update_trigger`.

## The agentic loop — which Routine exercises what (2026-08-24)
Four scheduled jobs drive ••••3900, and **a feature only works if the Routine that runs it knows about
it.** That is not automatic: a Routine's prompt is stored server-side, not in this repo, so shipping code
here does NOT update it. This table is the map; re-check it whenever a piece is added.

| Routine (cron, UTC) | What it runs | v121 pieces it carries |
|---|---|---|
| **Portfolio dashboard refresh** (`35 * * * *`) | `preflight` → fetch → `run.mjs` | fetches **VIX every run** (light + full) → `data.vix` (regime); `build-data` emits **`data.agentic.drawdown`**; `alerts.mjs` pushes the **drawdown tier change** through the existing post-publish push. **v127** added one EVERY-RUN fetch row to its prompt — `get_equity_orders` on ••••0741 (`state:"filled"`, 120d) → `raw/main-orders.json` — which is the ONLY source of the self-directed Rebalance Log. Drop that row and the card renders empty with no error anywhere: build-data logs a warning and carries forward, exactly as designed. |
| **Agentic weekly research** (`12 11 * * 1`) | `agentic-due` → `agentic-research` workflow → **`finalize-target.mjs`** | **look-through cluster caps**, the two-strike phase-out, the **`drivers[]`** tags every downstream attribution depends on, the (v124) **defensive floor**, the (2026-08-25) **challenger quota**, and the (2026-08-25) **verdict-derived entry bands**. The last three depend on what this Routine FEEDS the pipeline, so its prompt carries four specific instructions: build the universe from **`node producer/research-universe.mjs --symbols`** (NOT `leaders.mjs`); **never seed it from the Daily Picks** (that composite is 20% social — self-directed only); use **`research-universe.mjs`'s sector labels, not Robinhood's** (RH files REITs under "Finance" and GE under "Electronic Technology", which breaks the max-2-per-sector budget); pipe the **WHOLE workflow return** through `finalize-target.mjs`, since its `ranking` array carries the px/hi/lo both the vol gate and the entry bands need; and since the (2026-08-25) **gold sleeve**, `--symbols` appends **GLDM** so the batch fetch prices the injected diversifier row — drop it and the sleeve lands with no entry/stop. **v126** added two more to the prompt: re-check `target.dropped` after any SECOND finalize run in a session (the erase-on-re-run bug), and report a name absent from both `names[]` and `dropped[]` as a BUG; plus, when the target drops a HELD name, say in the push that the exit may be held by min-hold/PDT and give the unlock date. See PRODUCER.md step 7.2. |
| **Agentic executor** (`20 14-20 * * 1-5`) | `agentic-exec-gate` → ticket state machine | consumes the **drawdown** + **regime** reads; `makeDecision` stamps **sleeve drivers**; the v126 **`blockedSells`/`warnings`** ride onto the ticket. This Routine IS persistent-bound, so that last one is enforced in CODE (it comes free from `makeTicket`) plus an `AGENTIC.md` step-2 blockquote — hand-writing a ticket is the only way to lose it. |
| **Flow burn-in decision** (one-shot 2026-09-02) | evaluates whether `FLOW_WEIGHT` earns 0.10 | reads the **sleeve attribution** roll-up; knows the 2026-08-24 insider fix **reset the burn-in clock** |

**A Routine's prompt IS editable — use `update_trigger` (claude-code-remote MCP), don't work around it.**
Prompts live server-side, so shipping code here does not update them; but `list_triggers` + `update_trigger`
edit them in place, keeping the Routine's id and run history. The ONE exception is a Routine bound to a
persistent session (`persistent_session_id` set in `list_triggers` — the **executor** is; the weekly
research one is NOT). Check the field before concluding you can't edit something. Getting this wrong is
expensive in a specific way: on 2026-08-25 the research bench was widened in code while the Routine's step 3
still said "the mega-cap LEADERS bench from `producer/leaders.mjs`", which would have made the entire change
inert on the next run. The prompt was updated the same session.

Three hazards this table exists to prevent:
- **The weekly Routine used to hand-write `agentic-target.json`**, bypassing `finalize-target.mjs` — which
  silently skipped the risk caps, the phase-out AND `drivers[]`. Fixed; the prompt now names the runbook
  as source of truth. **Never hand-write that file.**
- **A code change that a Routine's prompt still contradicts is not shipped.** Anything that alters what a
  Routine FEEDS the pipeline — the universe it assembles, the args it passes, the files it writes — needs
  the prompt edited in the same change, not just the runbook. (The runbook helps only because these prompts
  explicitly name it as source of truth; a step that names a specific file or command overrides it.)
- **The executor Routine's prompt genuinely cannot be edited** (bound to a persistent session), and it still
  says only "`makeDecision`, with `spyAt`". So the `target` requirement is enforced three other ways
  instead of by prompt: the exec gate writes `target` into `raw/agentic-plan.json`, `AGENTIC.md` step 3e
  carries a blockquote that overrides the prompt, and `makeDecision` **logs a loud warning** when it is
  called with buys but no target. For a persistent-bound Routine, prefer code-level guards over prompt
  wording for anything load-bearing.

## Key files
| File | Role |
|---|---|
| `index.html` | The entire consumer app (UI, charts, Analyze/Picks/Markets/Options tabs, replay shim). Both the Accounts and Plan tabs are split per account by a shared `pf_acct` switcher (v108). |
| `sw.js` | Service worker. `CACHE_VERSION` must be bumped with every shell change. |
| `producer/run.mjs` | Orchestrator: build→validate→**publish to `origin/main`** (works from any session branch; retries; refuses to push plaintext). |
| `producer/preflight.mjs` | Run-mode gate (SKIP / FETCH_ALL / FETCH_LIGHT). |
| `producer/market.mjs` | Shared `isMarketOpen` / `isWeekday` / `etDate` / `etMinutes` + a **hardcoded NYSE holiday/half-day calendar** (`isHoliday`, `closeMinutes` — 13:00 close on half-days). Preflight SKIPs full-closure holidays and treats a 1 PM-close snapshot as the day's close; the freshness watchdog only alarms while the market is actually open. **Extend the HOLIDAYS/HALF_DAYS sets once a year** — an unlisted date fails safe (old holiday-blind behavior, harmless extra runs). |
| `producer/build-data.mjs` | Assembles + encrypts `data.json`; emits **`data.vix`** (v121 — `{v,asOf}` parsed from the already-recorded `INDEX_DATA` VIX; additive, nothing keys on it, carried forward, absent when unparseable) so the producer-side deploy planner can pace by regime without re-implementing the AV response parsing; **carry-forward overlay** (decrypts prior snapshot once, overlays fresh on **quotes**/hist/recorded/picks/options/realized/**notes** — quotes carry forward per-symbol since v88 so a transiently unquotable name keeps its last price instead of dropping to $0; a fresh-but-EMPTY bars array also no longer clobbers carried-forward hist). Also maintains **`data.picks.history`** — when a fresh scan replaces the prior picks (new date), the outgoing picks (entry/TP1/TP2/stop) are archived (cap 40) so the consumer can grade the Track Record. Maintains **`data.options.ivHistory`** too — appends each run's `ivObserved` (one point/UTC-day, cap ~260) and derives **`data.options.ivRank`** (where today's IV sits in its trailing range), decorating each position/idea with `ivRank`. Optional `producer/notes.json` (a string or `{risk:"…"}`) → `data.notes` for owner editorial that renders in the Risk card without baking prose into `index.html`. **COMPANY_OVERVIEW accumulation guard:** the free AV tier (25/day + burst throttle) only covers a rotating subset of holdings per run; this run's 11-field Robinhood-synth overview (P/E·MktCap·DivYld only) is NOT allowed to clobber a carried-forward AV-rich overview (one with `ForwardPE`/`EPS`/`QuarterlyRevenueGrowthYOY`) for the same symbol — genuine AV refreshes (also rich) still win — so Fwd P/E / Rev Growth / EPS coverage **accumulates across days** instead of flickering blank for whichever names missed today's cap. Also emits **`data.agentic`** (v67) = the agentic account's `{asOf,cash,buyingPower,equity,positions[]}` from optional `agentic-portfolio.json`/`agentic-positions.json` (priced from `data.quotes`, carry-forward) — the actual holdings the **Agentic Portfolio** card renders its target against. Maintains **`data.agentic.equityHistory`** too (v72 — same shape as `ivHistory`: one `{t,equity,cumFlow}` point/UTC-day, latest wins, cap ~260) — the account's **real** equity recorded **forward** (Robinhood has no account-equity-history endpoint, so it can't be backfilled); the Portfolio Performance chart overlays it. **Deposit-adjustment (v92):** this is a self-funded account the owner adds to over time and Robinhood exposes no transfers feed, so a deposit inflates equity and would read as a fake return (a $1k→$3.5k funding jump = a bogus +250% — the bug that prompted this). build-data now **infers the net external cash flow** each run — `flow ≈ ΔEquity − Σ(priorQty × price move)` (a deposit lands in cash without a matching position change; internal buys/sells net to ~0; qty-unchanged gaps are exact) — past a noise floor (`max($40, 8% of prior equity)`), and stores it as a running **`cumFlow`** on each point. The consumer computes a **time-weighted, deposit-immune** return from `cumFlow` deltas (see `renderPerformance`), with an implausible-jump fallback (>20% in one step → treated as an un-annotated legacy deposit) so already-recorded points before this field are corrected too. Also maintains **`data.agentic.recentLosses`** (v91 — the wash-sale ledger; rolling 31-day retention, read by the Agentic card to **block + flag** rebuying any name inside the 30-day window). **v98 sources it from REAL closing trades** — `producer/raw/agentic-trades.json` (`get_pnl_trade_history`, span `ytd`) via `lossesFromTrades` — and rebuilds it wholesale on each fetch, stamping `data.agentic.lossSource='trades'`. **v105 makes it CROSS-ACCOUNT:** the ledger also merges the **self-directed ••••0741 book's** realized losses (`producer/raw/main-trades.json`, `get_pnl_trade_history` span `3month`, every run), each entry tagged `account:'main'|'agentic'`, because the IRS wash window is per TAXPAYER — on 2026-07-29 the owner sold 35 NVDA at −$431.76 in ••••0741 and the agentic executor rebought NVDA on 2026-08-11 through a ledger that only read ••••3900's (empty) trade history, partially disallowing the loss. Each account's portion rebuilds when its file is present and carries forward (expiring) when not; there is NO inference for the main portion, ever. The original **inference** (diff prior→fresh positions; a holding reduced/exited while underwater = a loss dated today) survives only as the Railway fallback and **never wins over real trades, nor layers on top of a trades-sourced ledger**: it is unsound, because any run whose agentic fetch returned the *wrong account's* positions makes the next correct fetch look like a mass liquidation. That is what happened — five losses booked 2026-08-03 (LLY/NVDA/TSM/CIFR/IREN) for an account with **no closing trades that week** that had never held three of those names, and NVDA was wash-sale blocked out of a real buy for 30 days off one of them. Also assembles **`data.realized`** per account (v98, via `realizedpnl.mjs`) from `realized-main{,-opt}.json` / `realized-agentic.json` (`get_realized_pnl`, per asset class): `{year,asOf,source:'robinhood',approx:false,accounts:{main,agentic},equity,options,total,premiumYTD}` — top-level fields are **all-account sums** (so an older cached consumer shows a correct combined figure), `accounts` carries the split. Precedence: fresh broker fetch → committed `producer/realized.json` (gitignored owner override / Railway fallback) → prior snapshot; the options-book `realizedYTD` override is skipped when `source==='robinhood'` so it can't desync `accounts` from the totals. **v93:** also grades **`data.agentic.decisions`** from committed `agentic-decisions.json` (via `agentic-ledger.mjs`, vs live quotes + SPY) and writes **`producer/raw/agentic-triggers.json`** (via `agentic-triggers.mjs` — deploy-cash + research-refresh events). **2026-08-30:** also emits **`data.realized.predictionMarket`** `{asOf,year,ytd,count,trades[]}` (via `mergeEventTrades` over `main-trades.json`) — kept deliberately OUT of `realized.total` and out of `accounts`, because those are broker-reported per-account figures and folding a snapshot-accumulated ledger into them would desync the split from its own total (the same failure the options-override guard prevents). The consumer renders it as its own strip. |
| `producer/emit.mjs` | AES-GCM encrypt/decrypt (`encryptEnvelope`/`decryptEnvelope`). |
| `producer/equityseries.mjs` | **Recorded account-equity history (v119, pure + unit-tested)** — the shared basis of BOTH accounts' real YTD. `appendEquityPoint` (one point per UTC day, latest wins, cap 260) · `inferFlow` (deposits/withdrawals: `flow ≈ ΔEquity − Σ(priorQty × price move) − Δoptions_value`, past a noise floor) · `flowThreshold`. Extracted verbatim out of `build-data.mjs`'s agentic block so the **self-directed** account could record the same way — the two accounts' YTD figures can now differ only in their inputs, never in their math. Two things it knows that a caller must not re-decide: **equity is `total_value`**, never `equity_value` (v116 — on margin they differ by the whole loan), and the **options-value term is P&L, not a transfer** (a short call's mark moving $300 is not a $300 deposit; only the self-directed book needs it). Noise floor = `max($40, min(8% of prior equity, $750))` — the **$750 cap is new**: at a flat 8% a $19k book would need a $1,520 move before a transfer registered, which is larger than most real deposits. **`derivativesRealized` (2026-08-30) is the third term:** prediction-market (event-contract) and futures settlements pay into `cash` from sleeves that sit OUTSIDE `total_value`, so a winning bet is shaped exactly like a deposit and a losing one exactly like a withdrawal. It sums the realized P&L of those trades for THIS step only (`since` = the prior snapshot's `asOf`, exclusive; `until` = this one's) and `inferFlow`/`appendEquityPoint` subtract it as `extraPnl`. The discriminator is a **blank `symbol`** (shared with `realizedpnl.isDerivativeTrade`) — see the gotcha. No `since` ⇒ it returns 0 and abstains. **`inferCashFlow` REPLACED the price-move sum as the PRIMARY (2026-08-30):** `flow = Δcash + Σ(Δqty × px) − extraPnl`. External money must land in CASH, and an internal trade moves cash and position value in opposite directions by the same amount, so the two terms cancel a trade exactly and leave a transfer standing. Prices enter ONLY through the Δqty term — zero on almost every run — which makes it immune to the stale-quote skew that produced ±$1,000/day of phantom flow (see the gotcha), and EXACT when nothing traded. Returns `null` (⇒ caller falls back to `inferFlow`) when cash is missing on either side or a traded symbol can't be priced. `inferFlow` is now the documented legacy fallback for pre-v119 snapshots. |
| `producer/cumflow-repair.mjs` | **One-time cumFlow migration (2026-09-01, pure + unit-tested) — DELETE ME once spent.** Removes the phantom transfers the 2026-08-31 account-swap run wrote into both accounts' `equityHistory` (+$10.93 agentic, +$136.70 main). `build-data.mjs` calls `repairPriorCumFlow(prior)` right after `loadPrior()`, **before anything reads the series** — one call site that corrects both the `appendEquityPoint` path and the carry-forward branches. It exists as producer code rather than a hand edit because a corrupted running total **cannot be fixed by any ordinary run** (`appendEquityPoint` reads `priorCum` from the point it is REPLACING, so each rebuild inherits the bad value), while `data.json` is the producer's own file — so the pipeline that corrupted the total is the right thing to correct it, on its own validated path. **Idempotent by exact equality:** each account fires only while its anchor still holds the bad value to the cent, so a second pass is a no-op by reference and a genuine later deposit (which shifts the anchor) is left strictly alone. Firing twice would invent the mirror-image error it removes. Not a guard — the root cause is `snapshotsanity.mjs` — so delete this module and its `build-data.mjs` block once both accounts have logged `cumFlow migration applied`. |
| `producer/drawdown.mjs` | **Book-level drawdown circuit breaker (v121, pure + unit-tested).** The missing PORTFOLIO-level risk control — every other guard in this system is name-scoped (per-name stops, entry bands, min-hold), so nothing said "the BOOK is down X% from its high, stop putting new money in". `bookDrawdown(equityHistory)` → `{dd, level:'ok'|'soft'|'hard', peakT, minDdSincePeak}`; `twrSeries` is the shared index. **Two invariants:** (a) it runs on a **time-weighted, deposit-adjusted** index, never raw equity — a $500 deposit into a $850 book that fell from $1,000 makes RAW equity a new all-time high and would cancel the breaker at exactly the worst moment (and a withdrawal would fake a drawdown); (b) it is **memoryless by construction** — the executor may commit only three files and never `data.json`, so a persisted "tripped" flag has nowhere legal to live; hysteresis instead comes from `minDdSincePeak`, which the series itself records. Thresholds `AG_DRAWDOWN_SOFT` −8% / `AG_DRAWDOWN_HARD` −12% / `AG_DRAWDOWN_RESUME` −6% (an episode ends only ABOVE resume, or the breaker chatters around −8% and redeploys into what it just refused). **Fails OPEN** below `DD_MIN_POINTS` (5) — the equity series cannot be backfilled, so a young account is thin by definition and a breaker that stopped on thin data would freeze a new book forever. Consumed by `agentic-deploy.mjs` via `planDeployment({drawdown})`, computed by `agentic-exec-gate.mjs` from the committed snapshot. |
| `producer/realizedpnl.mjs` | **Broker realized-P&L normalizers (v98, pure + unit-tested).** `sumRealized` (one `get_realized_pnl` response → total/trades; null "transfer-only" buckets are **n/a, not $0**), `accountRealized` (equity + option classes → one account block; a missing class stays `null`, not 0), `buildRealized` (per-account blocks → `data.realized` with all-account totals), `lossesFromTrades` (`get_pnl_trade_history` → the dated realized **losses** feeding the wash-sale ledger; takes an optional `account` tag (v105) so the cross-account merge knows which taxable book booked each loss). `asset_classes` is **required** by the endpoint — omitting it errors `un-specified asset class`. **`isDerivativeTrade` + `mergeEventTrades` (2026-08-30)** own the PREDICTION-MARKET line item: `get_realized_pnl` is per asset class (equity/option) and never reports event contracts, so a settled bet appears in no realized figure anywhere. `mergeEventTrades` accumulates the settlement ledger **in the snapshot** (raw/ is wiped every run and the fetch is a rolling 3-month window — the `ivHistory` pattern), de-duped on `timestamp|qty|realized` because the feed re-delivers the same settlement on every run for three months (counting it per-run would turn a $1,008 win into five figures by November), retained by TIME not count (`EVENT_RETAIN_YEARS` 3; `EVENT_CAP` is a runaway backstop only — the `maindecisions.mjs` lesson), and a malformed/absent payload returns the prior ledger **untouched** rather than rebuilding from empty and silently zeroing the year. |
| `producer/picks.mjs` | Daily Picks scoring engine. Composite = **33% tech / 28% fundamentals / 19% R/R / 20% social**. Tech score **blends RSI with 52wk-range position** (so RSI isn't double-counted vs finalist selection). Candidates carry `sector` + `cov` (data-coverage flags); top picks are **sector-diversified** (`MAX_PICKS_PER_SECTOR`, default 2). **Momentum/trend gate (`trendGate`):** the oversold screen surfaces both healthy pullbacks and *falling knives* — and techScore's 52wk-range term actually **rewards** a broken name (deeper in range = more "reversion room"), so a confirmed downtrend could top the board and feed the Action Center's redeploy sleeve (this is the ORCL bug — deep-research rejected it "momentum 1/10, broken downtrend" while the picks screen ranked it #1). A name is a **confirmed downtrend** when AV's 50/200-DMA are present and `price < 200-DMA AND 50-DMA < 200-DMA`, else (no MA) `>50% below its 52-week high`. A confirmed downtrend is **disqualified from the highlighted top picks** (`buildPicks` filters `picks[]`) and **docked `DOWNTREND_PENALTY` (3.0) composite points** so it also sinks in the candidates table (stays visible there, flagged `Downtrend`, as an oversold data point). Each candidate carries `downtrend`/`trendNote`; the consumer's Action Center backfill sleeve also skips `downtrend` candidates (`index.html`), so a falling knife can't reach the plan via either path. Milder pullbacks (≤50% off high / above the 200-DMA) are untouched. **Recent-stop-out COOLDOWN (v91 — separate from the trend gate):** the trend gate filters on trend *shape*, so it caught ORCL only because ORCL was *also* a textbook downtrend — the engine otherwise had no memory of what it just lost on and re-surfaced ORCL ~10 sessions running (June 29–July 13), each stopping out (the 0W·10L distortion). `recentStopCooldown(history, barsBySym, {asOf})` reads the prior snapshot's **graded** pick history (via the pure `gradePickClose`, a mirror of the consumer's grader) and benches any name that **stopped out inside the trailing window** (`COOLDOWN_CAL_DAYS` = 14 cal days ≈ `COOLDOWN_TRADING_DAYS` 10): disqualified from `picks[]` (like a downtrend) and docked `COOLDOWN_PENALTY` (3.0), flagged `Recent stop-out` with a `cooldownNote`/`cooldownUntil`. **Averaging-down backstop:** `recentStopCooldown` also accepts `priceBySym` (today's scan prices) and benches any name whose fresh scan price is **at/below a recent in-window pick's published stop** — the name has fallen *through* the level we'd have exited on, so re-listing it lower is chasing a knife down. This fires straight from the scan price (no bars needed), so it still bites when the prior snapshot's daily bars for that name are thin/missing and the closing-basis grade can't confirm the stop-out. `buildPicks(..., cooldown)` takes the map (5th arg); the consumer skips `cooldown` candidates in the Action Center backfill AND the Agentic heuristic pool. Pairs with the 30-day wash-sale guard on ••••3900 (below). |
| `producer/picks-build.mjs` | Runs the scan→finalists, fetches ApeWisdom buzz, calls `buildPicks`. Also emits `producer/raw/picks-watchlist.json` (composite top-10 tickers) — the target for the Robinhood watchlist sync. **Decrypts the prior committed `data.json`** (best-effort — `PF_PASSPHRASE` + `emit.mjs`; degrades to no-cooldown on any miss/plaintext) to feed `recentStopCooldown` the graded `picks.history` + `hist.day` bars, then passes the resulting cooldown map into `buildPicks` so recently-stopped names are benched. |
| `producer/sync-watchlist.mjs` | Deterministic diff for the **"Dashboard Top 10 Picks"** Robinhood watchlist. Pure planner (like `av-plan`/`options-plan`): reads the top-10 sidecar + the agent-saved live list, **prints** `ADD`/`REMOVE`; the agent executes the MCP writes. Runs as a post-publish step on FETCH_ALL only. |
| `producer/sync-option-watchlist.mjs` | Same pattern for the account's single **options** watchlist. Reads `producer/raw/option-watchlist.json` (the live single-leg Trade-Idea contracts `options-build.mjs` emits on FETCH_ALL) + the agent-saved `get_option_watchlist`, **prints** `ADD`/`REMOVE` option-UUIDs (all `position_type:"long"`); the agent executes the writes. |
| `producer/social.mjs` | Keyless ApeWisdom fetch (retail buzz), with one retry. Split into `fetchSocialPages` (network, once) + pure `shapeSocial(pages, symbols)` so one fetch serves both callers: `picks-build` saves the raw pages to `raw/social-pages.json` and `build-data` reuses that sidecar (light runs, which have no sidecar, fetch live) — previously each FETCH_ALL hit ApeWisdom twice with potentially different results. |
| `producer/alerts.mjs` | **Pure level-crossing detection** (v121: also the **book-level drawdown TIER CHANGE** — `ok→soft→hard` and every recovery. Transition-based like the rest, so the owner is told once when the breaker trips rather than every 30 minutes while it holds. This one matters most: the breaker silently stops deploying and at the hard tier *sells*, so it has to reach the phone through the same push path as a stop crossing rather than only living on a card.) between the prior snapshot and the one being built (no I/O, unit-tested): agentic holding crosses its research **stop/target**, a top pick hits its published **TP1/TP2/stop**, a held name crosses **±7% on the day**. Transition-based (prior on one side, fresh through the other) so a crossing fires exactly once with no sent-state. `build-data` writes the result to `producer/raw/alerts.json`; the **agent** delivers post-publish via `PushNotification` (PRODUCER.md step 8, best-effort, every run); the Railway path only logs them. |
| `producer/markets.mjs` | `MARKET_SYMBOLS` (indexes/risk/sectors/intl) — source of truth; keep PRODUCER.md's list in sync. |
| `producer/leaders.mjs` | `LEADERS`/`LEADER_SYMBOLS` — mega-cap bench (sym+sector) for the **Plan-page Ideal Portfolio only**. `build-data.mjs` emits it as `data.leaders`; the producer quotes `LEADER_SYMBOLS` every run so each has a live price. **NOT the agentic research bench — that is `research-universe.mjs` (2026-08-25).** The weekly research used to screen over this list, and because it is 19 names / 16 of them megacap-or-large-growth (deliberately: it is quoted EVERY run, so it is curated tight), six research cycles then produced 14 distinct names in seven weeks. Keep the two separate — this one is narrow because it is expensive per run; the research bench is wide because it is quoted once a week. |
| `producer/extfund.mjs` · `producer/extfund-fetch.mjs` | **Supplementary fundamentals** (Finnhub + Financial Modeling Prep). `extfund.mjs` = pure normalizers turning each provider's payload into the **same COMPANY_OVERVIEW shape AV uses** (AV's fraction conventions: RevGrowth/Margin/DivYield stored as fractions — Finnhub returns percents, so ÷100; FMP TTM ratios are already fractions; mktcap → whole dollars). `extfund-fetch.mjs` fetches over HTTP (once/day ET gate, like `av-fetch.mjs`), writing `producer/raw/ext-fund/overview-<SYM>.json`. **AV stays PRIMARY** — `build-data.mjs` reads ext-fund *after* av-src and only **fills fields AV is missing** for a name (so AV's ForwardPE/AnalystTargetPrice win) or adds a whole overview for names AV's daily cap skipped (rich, so it beats the RH synth). Both providers independently optional (`FINNHUB_KEY` / `FMP_KEY`); no key → silently skipped. Unit-tested offline (`extfund.test.mjs`). |
| `producer/av*.mjs`, `options*.mjs` | Alpha Vantage wiring; options analysis. **v119 fixed the money units and the collateral rules — see the Gotchas entry; `options.mjs` now exports `positionPremium`/`orderPremium`/`sharesLockedByShortCalls`, all unit-tested in `options.test.mjs`.** `options.mjs` builds the ideas — single-leg long-call/covered-call/CSP (live-priced, delta-targeted) **plus estimate-only defined-risk structures (call debit spread, collar)** with a `legs[]` array the consumer draws as a combined payoff; estimate premiums use a **per-symbol realized-vol IV proxy**. `options-build.mjs` analyzes your contracts (full greeks incl. **vega/gamma**, concrete **roll suggestions**, a portfolio **exposure** roll-up, `ivObserved`) and, on FETCH_ALL, emits `producer/raw/option-watchlist.json` (the single-leg ideas that resolved to a live contract `optionId`) for the options-watchlist sync. The agent records each idea's resolved `optionId` into `option-quotes.json` (see `options-plan.mjs`) so `options.mjs` can carry it onto the live idea. |
| `producer/flow.mjs` · `producer/flow-fetch.mjs` | **Flow & Positioning signals (v95)** — who is *acting* on a name, which none of the four research sleeves read. `flow.mjs` = pure scorers (unit-tested, `flow.test.mjs`): **`revisionScore`** (Finnhub `/stock/recommendation` — a consensus index `(2·sB+B−S−2·sS)/total` per month, scored **60% on the DIRECTION of change / 40% on the level**, because consensus levels are structurally bullish and carry little information alone), **`insiderScore`** (Form 4 clusters — **open-market `P`/`S` codes only**; `A` grants / `M` exercises / `G` gifts / `F` withholding are mechanical and would make every large cap look like a wall of selling), **`surpriseScore`** (PEAD off recency-weighted `surprisePercent`, each quarter clamped ±25% so a blowout off a near-zero estimate isn't 16× the signal), **`awardScore`** (Finnhub `/stock/usa-spending` — federal contract dollars, scored as YoY **growth** not level, since the level just measures how big a defence contractor is), **`lobbyingFlag`** (a regulatory-exposure **flag, never scored** — heavy lobbying isn't bullish or bearish, it marks policy beta), and **`flowScore`** (weighted composite — revision 40 / insider 30 / surprise 20 / award 10; renormalizes over whatever is present, and returns **null below 2 components** so a sparse name abstains instead of faking a neutral 5). **`insiderScore` measures sell INTENSITY vs the name's own baseline, not direction (v121 — the saturation fix).** Direction is a constant for a large cap: insiders sell continuously and essentially never buy on the open market, so the old dollar-tilt read pinned at −1 and the score saturated — on the live 2026-08-24 snapshot **12 of 13 covered names scored between 3.00 and 3.50**, i.e. 30% of the composite's weight was a uniform offset that cancels out of any ranking. (Live probe: NVDA, 405 open-market sells and **zero** buys across 11 months, monthly sale dollars ranging $133K–$507M — a 3000× spread collapsed to one number.) It now compares the window's sell RATE to the trailing rate from the same feed: normal pace ⇒ ~5 (no information), a multiple of it ⇒ bearish, a collapse ⇒ mildly bullish. Rescoring the same 13 names live moved **0 of 13** into that band, spread 1.5–6.0 (AMZN 1.5 on Bezos's real $346M sale = 13.7× normal; AAPL 6.0 on a quiet quarter). Three guards are load-bearing: the window **anchors to the newest filing, not to today** (Form 4s lag days-to-weeks, so a today-anchored window is systematically under-filled against a fully-filed baseline and would bias every name toward "gone quiet"), a feed with no open-market filing inside `INSIDER_STALE_DAYS` **abstains**, and a **provider price-sanity filter** rejects rows priced >10× off the feed's own median — two LLY rows carried `transactionPrice ≈ 1,031,415` on a ~$1,185 stock (a 1000× scaling error) and alone accounted for $75.8B of a $79.4B baseline, making every later window look 2000× quieter, which is the original bug's *mirror image* and more dangerous. The filter tests PRICE, never dollar size, so a genuinely enormous sale at a sane price survives. Caps are **asymmetric** (`INSIDER_HEAVY_CAP` 3 / `INSIDER_QUIET_CAP` 1): an absence of selling is weak evidence, and one 10%-owner can set a whole baseline by itself (LLY's is the Lilly Endowment, a foundation whose selling is portfolio management, not an opinion). **The buy/sell asymmetry is also load-bearing** — a sell tilt moves the score ~4× less than an equal buy tilt; the first live run scored *both* NVDA and JPM at 0.9/10 on all-sell windows, i.e. a constant drag on every megacap rather than a discriminator, because large-cap selling is comp/diversification/plan-driven and this endpoint can't distinguish it. Don't "simplify" it back to symmetry. `flow-fetch.mjs` fetches over HTTP (Finnhub, paced ~55 calls/min); since v100 its cover is the margin book ∪ the agentic holdings ∪ the agentic target's tickers (best-effort reads of `raw/agentic-positions.json` + the committed `agentic-target.json`), so both accounts' names carry flow data. Its **once/day gate reads `data.flow.asOf` from the COMMITTED (decrypted) snapshot**, not a `raw/` marker — raw/ is wiped on every scheduled run, so a marker-only gate never trips and would re-spend ~6 calls/symbol on all ~13 runs of the day, writes the **scored** read to `producer/raw/flow/<SYM>.json` over the held book (`coverFromRaw`), and also writes `_treasury.json` — one FMP `stable/treasury-rates` call returning the **whole curve**, which removes the documented 2s10s "—" failure mode (sidecar only so far; wiring it into the tile touches the replay contract). `build-data.mjs` merges the sidecars **per symbol over the prior snapshot** (like quotes) into **`data.flow`**. Optional (`FINNHUB_KEY`); `PF_FLOW=off` kills the layer. **DISPLAY-ONLY today** — nothing here touches `agentic-target.json` until the sleeve weight is switched on. See `PROPOSAL-flow-signals.md`. |
| `producer/policy.mjs` · `producer/policy.json` | **Policy-catalyst calendar (v95)** — the *forward-looking* half of the "Washington" theme, and the reason the congressional feed isn't it: what moves a position is the **scheduled** decision (tariff ruling, PDUFA date, appropriations vote, antitrust judgment), not a trade disclosed 40–116 days late. `policy.mjs` = pure helpers (`policyFor` / `policyBlackout` / `policyCalendar` / `validatePolicy`, unit-tested). `agentic-deploy.mjs` consumes `policyBlackout` as a **new deferral reason (`policy`)** — the exact parallel of the earnings blackout: never deploy NEW money into a name inside ~7d of a dated binary event. **Only `impact:"high"` blocks** (a comment-period close is context, not a reason to sit out — over-blocking starves the plan), and high-impact events **require a `source` URL** since they can defer a real trade. **`policy.json` ships EMPTY on purpose** — there is no free structured feed for this, and a wrong date would defer or wave through a real buy, so events are only ever written from a source that's been read (the weekly research agent adds them, PRODUCER.md step 7). An empty calendar makes every helper a no-op, which is the correct failure mode. |
| `producer/polflow.mjs` | **Congressional disclosure clusters (v95)** — the STOCK Act PTR feed the Trump/congress trackers repackage. Pure + unit-tested: `normalizeDisclosure` (drops bonds/funds/no-symbol rows and directionless "Exchange"), `mergeEvents` (**de-dupes on filer+symbol+side+date** — the tier serves a rolling 25-row window that re-delivers the same trades every poll, and counting them twice would fake activity; 120-day retention), `detectClusters` (**≥3 DISTINCT filers**, same direction, inside a 45-day span — one person filing five times is one opinion; equal-sized opposing clusters cancel), `clusterEvidence`. **`EXCLUDED_CLUSTERS = ['megacap-tech']` is load-bearing**: the most-traded congressional names are exactly the complex `riskweights.mjs` caps at 48%, so a political nudge there would spend risk budget re-buying the concentration that cap exists to contain. **ZERO score weight, permanently** (owner decision) — it enters the research workflow's **adversarial verify prompt only**, explicitly framed as stale weak context, and renders as a labelled context strip on the Plan card. Accumulated into `data.flow.polEvents`/`polClusters` by `build-data.mjs` (raw/ is wiped every run, so the ledger can only live in the snapshot — the `ivHistory` pattern). |
| `producer/PROPOSAL-hedgefund-gaps.md` | **Build spec (2026-08-24, NOT yet implemented)** for the institutional-gap closures on the agentic account: look-through cluster caps (SPY/VTI composition counted against the 48% megacap-tech cap), a book-level drawdown circuit breaker, regime-aware deployment pacing, sleeve attribution in the Rebalance Log, plus an observe-only decoupling of the flow sleeve. **Both owner gates are DECIDED (2026-08-24): park vehicle stays VTI (SGOV declined), and `FLOW_WEIGHT` HOLDS AT 0** — the burn-in was run against the live snapshot and the signal did not clear (12 of 13 insider scores inside a 0.50-pt band, 14 of 16 revision scores inside ~1.0 pt: 70% of the flow composite's weight carries near-zero ranking information). Build the recording/weighting decoupling instead, so Phase 6 attribution can measure the sleeve before it is paid for. Read the file in full before implementing any phase — it fixes constants, function signatures, test cases and both decisions. |
| `producer/PROPOSAL-flow-signals.md` | Signed-off design for the flow layer + the **live probe results** for every political/insider/positioning source (what works on our keys, what's tier-restricted, what returns dead data). Read before adding another provider — it records what was already tried and rejected, and why congressional disclosure feeds get **no score weight** (40–116 day lag; the ETF "edge" is a megacap-tech beta tilt; the most-traded names sit inside the 48% cluster cap). |
| `producer/snapshotsanity.mjs` | **Cross-account integrity guard (2026-08-31, pure + unit-tested).** `accountsLookSwapped({agentic:{fresh,prior}, main:{fresh,prior}})` → a reason string when the two accounts' fresh position arrays look crossed, else null. `build-data.mjs` calls it before writing anything and **THROWS** on a hit, so the run publishes nothing. Compares position IDENTITY against each account's own prior book rather than reconciling dollars (an unquoted position prices at 0 — routine); needs no tolerance, fails OPEN below `SWAP_MIN_NAMES` (3). See the gotcha for why an abort is right: the display self-heals on the next run, `cumFlow` never does. |
| `producer/validate.mjs` | Replay-contract sanity check. |
| `.github/workflows/freshness.yml` | Two watchdogs, hourly during market hours. **check**: opens an issue if `data.json`'s *commit* is stale **>90 min while the market is open** (holiday/half-day-aware via `market.mjs`; was 3h, which let real 60–105m scheduler gaps through); auto-closes on recovery. **deploy-health** (v88): catches "committed but never DEPLOYED" — compares the live Pages `data.json` blob vs `HEAD` (15-min grace; the envelope's random salt means bytes always differ mid-deploy) + reads the Pages build status API, **auto-retriggers a Pages build** (`POST /pages/builds`, needs the workflow's `pages: write`) and opens/auto-closes a `pages-watchdog` issue. Added after 2026-07-02, when two consecutive branch Pages deploys hung in `deployment_queued` → timeout while the commit-age check stayed green. |
| `producer/agentic-target.json` | **Canonical research-driven target** for the agentic account (••••3900): `{asOf,method,book,driftTriggerPp,names[]}`. `build-data.mjs` attaches it as `data.agentic.target`; the Agentic Portfolio card renders drift against it. Refreshed **weekly** by the deep research. |
| `.claude/workflows/agentic-research.js` | Reusable **named workflow** — the deep multi-factor research (momentum/quality/growth/catalyst sleeves + valuation → adversarial verify → synthesis). **v102 — SPLIT VERDICT.** `supports` used to collapse two independent judgements into one boolean, and it failed live on 2026-08-11: 5 of 6 finalists came back unsupported and *every* rejection said "the business is sound, the price is wrong" — so a great company 2% above its ideal entry was discarded exactly like a broken one and the allocation went defensive across the board. The verdict now carries **`businessOk`** (worth owning at SOME price → decides INCLUSION) and **`entryQuality` 0-10** (how good TODAY's price is → decides SIZE, via a precomputed `entryHaircut` multiplier the synthesis prompt applies), with `entryRisk` kept apart from `biggestRisk`. A weak entry now **shrinks** a position instead of vetoing it, so an extended market yields a smaller defensive book rather than an empty one. The synthesis prompt also demands **reachable entry zones** — a zone far below spot reads as "never buy" to the executor and strands the cash; conviction is expressed by cutting WEIGHT, not by setting an unreachable price. Universe guidance widened (mid-cap / out-of-favour / international), since a screen can only buy what it is shown and a megacap-only universe in an extended tape can only ever answer "wait". Pass a fresh `args.universe`; output drives `agentic-target.json` (via `finalize-target.mjs`). **v93:** the synthesis prompt now asks for **correlation-cluster** (megacap-tech ≤48%) + **vol-scaled** weighting; `finalize-target.mjs` re-enforces those caps deterministically so they hold regardless of the model output. **Incumbency (2026-08-12 churn governor):** pass **`args.held`** (••••3900's current holdings, `[{t,w}]` or tickers) + **`args.priorTarget`** (the committed target) — the verify prompt tells the skeptic a held name's exit is a real taxable event ("broken thesis" ≠ "less attractive"; only the former is `businessOk:false`), and the synthesis prompt makes the current book the **null hypothesis** (displace an incumbent only for a materially stronger name; prefer weight changes to name swaps; a drop-and-re-add produces pure cost because the deterministic governor retains/blocks it anyway). |
| `producer/AGENTIC.md` | **Runbook** for the agentic account: tax/reg rules (taxable, short-term lots, wash-sale, instant settlement + the v98 PDT day-trade guard), the weekly research→target→rebalance-proposal flow, execution policy (**alert & one-tap confirm**). The weekly job is **wired into the producer** (step 7), not a separate trigger. |
| `producer/agentic-due.mjs` | Weekly gate (like `preflight.mjs`) for the agentic research refresh — `AGENTIC_DUE` (exit 0) / `AGENTIC_NOT_DUE` (exit 20), keyed off `agentic-target.json` `asOf` ≥ 7d. Producer step 7 runs the deep research only when DUE. **v93:** the gate is now also tripped EARLY by `agentic-triggers.mjs` (a deposit or a big held-name gap → `refreshResearch`), so research doesn't wait out the week when something material happens. |
| `producer/agentic-triggers.mjs` | **Pure event detection (v93, unit-tested).** `computeAgenticTriggers(prior, fresh)` — called by `build-data.mjs` (both snapshots in memory, like `computeAlerts`) → `producer/raw/agentic-triggers.json`. Two things: (a) a **`deploy-cash`** trigger when idle cash newly crosses ~5% of book OR a fresh **deposit** lands (inferred like `cumFlow`: ΔEquity − price-move ≥ $200) — transition-based so it nudges once, not every 30-min run; the agent `PushNotification`s it. (b) **`refreshResearch`** flag when a deposit lands or a held target name gaps ≥6% in one run (earnings/news) — the producer runs the research workflow THIS run even if `agentic-due` says NOT_DUE. Replaces the purely-calendar-driven refresh: the system now reacts to deposits + earnings, not just the 7-day clock. |
| `producer/agentic-deploy.mjs` | **Pure deployment/rebalance planner (v93, unit-tested; FULL-BOOK since v96; LIMITED MARGIN since v98).** `planDeployment({target, positions, cash, quotes, earnings, washMap, crossActivity, accountActivity})` → a ready-to-execute ticket, enforcing the execution discipline that was previously only prose: **earnings blackout** (never deploy NEW money into a name ≤7d from its report — wait for the print), **gap-through-entry re-verify** (a name at/below its target stop = broken → defer; below its planned entry zone = thesis in question → defer, the GOOGL-after-earnings case), **wash-sale** (reads `recentLosses`), and **cash-flow-first / sells-before-buys** sequencing. **v96 additions** (the planner used to see only target names — 40% of the book once sat invisible in research-dropped names): **off-target exits** (a held name absent from the target = explicit SELL-to-exit), **tax-aware sale ordering + estimates** (losses first, per-sell est. ST P&L, `taxSummary` netting), **opportunistic TLH** (target name underwater ≥ max($75, 5% of cost) → harvested whole, wash-blocked from the buy legs), **cross-account wash guard** (`crossActivity` = recent margin-book buys; a recent buy there kills a harvest / flags an exit `washRisk` — executor fetches this live), and the **auto tier** (`autoEligible` = turnover ≤ `AUTO_TURNOVER_CAP` **$10,000** — owner-approved unattended-execution ceiling; $500 → $1,000 on 2026-08-11, then **$1,000 → $10,000 on 2026-08-25** because routine rebalances kept landing just over the tier and stalling on a confirm the owner was approving unread — an approval step nobody exercises is not a control, it is latency. The consumer mirrors it as `AG_AUTO_CAP` in `index.html`; **keep the two in step**). Buys move each underweight name only toward its (already cluster/vol-capped) target, so honoring the target respects the risk caps. Mirrors the consumer's Agentic-card badges so card + ticket agree. **v98 — LIMITED MARGIN (2026-08-11):** ••••3900 was upgraded from a cash account, so proceeds are spendable the moment a sell **fills**, with **no borrowing or leverage** (`unleveraged_buying_power == buying_power` — "unlevered 1×" still holds). (a) **The T+1 leg is gone** — one allocation pass over `cash + proceeds` (also better sizing: leg-1 used to pro-rate over settled cash alone and top names up a day later); `buysT1` is always `[]`, kept in the shape only so tickets written under the old two-leg model reach `done`; `buysNeedProceeds` flags when the buys require the sells to fill first. (b) **PDT now applies** — a limited-margin account is a margin account for FINRA, so 4+ day trades in 5 business days under $25k restricts it, and this book is ~$5k with an hourly executor. The guard is categorical, not a counter: `accountActivity` (`{SYM:{lastBuyDate}}`) refuses to sell **anything bought today** (→ `blockedSells`), across exits/harvests/trims — zero round trips ⇒ PDT can't accrue. The gate can't see today's fills, so the **executor supplies `accountActivity` live** from `get_equity_orders` on ••••3900.  **v121 — REGIME-AWARE PACING.** The idle-cash deadline fired identically at VIX 12 and VIX 35. `marketRegime(vix)` (pure, from the new **`data.vix`** block build-data emits off the already-recorded `INDEX_DATA` VIX) returns `calm`/`elevated`/`stressed` at the **same 22/30 bands the consumer's `azVix` uses**, and stretches the deadline ×1.5 / ×2 and halves the forced tranche when stressed. It also adds a **`regime` deferral** for the one genuinely bad corner: a **stressed tape PLUS advisory (stale >7d) entry zones** — band discipline is switched off exactly when price is moving fastest, and buying unbanded into a stressed tape is the worst of both (a stale target in a CALM tape still buys, per the v102 lesson that stale zones must not defer the whole book). **Regime never picks names or sizes positions** — only pacing — and never blocks a sell. Missing/unparseable VIX ⇒ `calm` ⇒ today's behaviour exactly. **v121 — BOOK-LEVEL DRAWDOWN BREAKER.** `planDeployment({drawdown})` takes `drawdown.mjs`'s read (absent/`ok` ⇒ today's behaviour exactly). **soft** (≤−8%): every new buy defers with reason **`drawdown`**, which outranks every name-level guard because it is a statement about the whole book; **deferred dollars stay in CASH, not parked** — the owner kept VTI as the park vehicle (SGOV declined 2026-08-24), and VTI is 100% equity beta, so routing "the market is falling" money into it is precisely backwards; and the **idle-cash deadline is paused** (its clock keeps running, but "10 days elapsed" loses to "the book is in a drawdown"). **hard** (≤−12%): also raises defensive cash to `AG_DD_CASH_FLOOR` (20% of book) via `kind:'drawdown-raise'` sells, **losses-first** like every other sell path here. **The suspension flag is `parkNewOn`, NOT `parkingOn`** — that distinction is load-bearing: `parkingOn` also gates the off-target-exit exemption for the vehicle, so flipping it would make the planner liquidate the *existing* waiting ground as an "orphan" the moment a drawdown began, which is the infinite park→liquidate churn the exemption exists to prevent. Sells, exits and TLH are **never** blocked by the breaker (de-risking must always be possible), and the breaker does **not** override the PDT day-trade guard or the 14d min-hold — it warns when the cash floor can't be reached rather than forcing past them. **v102 — entry-band discipline + the waiting ground.** The zone check was a one-sided bright line (`px < entryLow`, no tolerance, nothing above) and failed three ways on 2026-08-11: V at 0.2% under a floor parked $437 (**no tolerance**); THREE of seven names read "below entry" at once purely because the zones were six days stale (**no ageing**); and the re-verification deliberately set every zone *below* spot, which the planner would have bought straight through because **"too expensive" had no code path**. Now: a SYMMETRIC band — `ENTRY_TOLERANCE_PCT` 2.5% under the floor, `ENTRY_PREMIUM_PCT` 2.0% over the ceiling (new `above-entry` deferral) — zones go **advisory** past `ENTRY_ZONE_STALE_DAYS` (7, off `target.asOf`), and `below-stop` stays absolute and unbanded because that one is the real thesis-broken signal. **Idle-cash deadline:** nothing ever forced cash IN, so "wait for a pullback" had no expiry and a rising market could strand a deposit indefinitely; past `CASH_IDLE_DEPLOY_DAYS` (10, from `data.agentic.cashIdleSince`) the bands are waived and cash deploys in `CASH_IDLE_TRANCHE_PCT` (34%) tranches, sweeping whole below `CASH_IDLE_SWEEP_FLOOR` ($250) so thirds-of-a-shrinking-balance can't run forever. **INDEX PARKING (`PARK_VEHICLE` = VTI, owner's design):** a deferred name's dollars go to a broad-market placeholder instead of idling in cash, and are released to fund the name when it clears. **VTI, not SPY** — SPY is the target's own ballast, so parking there buries the placeholder inside a position that has its own weight; a separate ticker makes it visible, and VTI/SPY track different indexes so the two never become substantially identical for wash-sale purposes. **Not QQQ** (~half megacap tech = the very cluster `riskweights.mjs` caps at 48%). Two load-bearing invariants: the vehicle is **exempt from off-target exits** (it is absent from the target by design, so the v96 orphan rule would liquidate it every pass while parking rebuilt it — an infinite taxable churn loop), and **unparking is a taxable ST sale**, so releases are floored at `PARK_MIN` ($100), sized to the actual shortfall, and run through the same losses-first ordering and PDT guard as any other sell. Plan carries `entryPolicy` + `parking`. **2026-08-28 — FUNDING RECONCILIATION (the floor is inherited by the BUY).** The pool counts the waiting ground, but the release that frees it can decline to fire — shortfall under `PARK_MIN`, the parked block itself under it, or the day-trade guard bouncing the leg — and the buys were sized as if it had. Live: $485.99 parked against $0.90 cash, a $26.94 JNJ top-up needing $26.04 of release, the floor correctly suppressing the dust sale, and the buy shipping anyway. Buys are now re-sized against cash+proceeds alone when no release materializes, so a sub-floor top-up waits (0.23pp of drift is not worth a taxable ST sale of the placeholder — the same judgement `PARK_MIN` makes about the sale). Backed by a hard invariant: **spend ≤ cash + proceeds + an actual release leg**, breach ⇒ a `PLANNER BUG` warning instead of a quiet unfundable ticket. **CHURN GOVERNOR (2026-08-12).** On 08-10 the planner exited GE/LLY/AMZN/MSFT (dropped by the 08-05 target) and bought AAPL/UNH/V; on 08-12 the next target reversed BOTH legs — a near-total book flip in 48h, every leg ST-taxable, because nothing priced the cost of changing our mind (memoryless weekly research × full-delta execution). Three deterministic guards now: **min-hold** (`MIN_HOLD_DAYS` 14 — a name bought inside the window is not exited/trimmed; overridden only by a `target.dropped` **business-broken** verdict, a ≤`MIN_HOLD_EXEMPT_LOSS_PCT` (−10%) loss — risk control outranks churn control — or by being a TLH harvest/park-release; day 0 stays the harder PDT block), **re-entry cooldown** (`REENTRY_COOLDOWN_DAYS` 14 — a name this account sold inside the window is not rebought; deferral reason `reentry`, weight parks in VTI like any deferral; covers the GAIN-sells the 30d wash ledger can't), and a **dust floor** (`MIN_BUY` $25 — the 08-05 ticket placed a $1.80 UNH buy). A `phaseOut` target name (below) is held but never bought into and never parks. `accountActivity` gained `lastSellDate`; the exec gate now derives it from the committed decisions ledger (`activityFromDecisions`) and the executor overlays today's live fills. |
| `producer/agentic-pending.mjs` | **Pure rebalance-ticket state machine (v96, unit-tested).** The ticket lives in the COMMITTED `producer/agentic-pending.json` (raw/ is wiped every run — the target/ledger pattern): `proposed → confirmed → sells-placed → buys-placed → done` (or `aborted`), with `makeTicket` / `advanceTicket` (illegal transitions throw) / `nextAction(ticket, todayET)` (what the executor should do NOW: await-confirm · place-trades · place-buys once the sells fill · stale → re-plan after 5d) / `planHash` (don't re-nag an identical outstanding proposal). `build-data.mjs` attaches a live ticket as `data.agentic.pending` so the card shows "rebalance in flight" — **done/aborted tickets are omitted**, which is why the v126 blocked sells ride OUTSIDE it as **`data.agentic.blockedSells`** `{ticket,created,status,items[]}`: a FINISHED ticket is exactly when a held-back sell still needs explaining (the 08-25 ticket hit `done` the moment its buys filled while both exits were still blocked), so hitching them to `pending` would have shipped the fix inert. That block **self-expires by each item's `until`**, not by ticket age — once the unlock date passes the guard has released and the next plan emits the real sell, so a surviving row would claim a trade is held when it is merely queued. **v126 — the ticket also carries `blockedSells` + `warnings`.** It used to persist `deferred` only, which is BUY-side, so a ticket whose entire SELL leg was suppressed rendered as a pure buy list with the reason nowhere on the phone. That is exactly how 2026-08-25 read: a $1,400 deposit funded five buys while the JPM and GE exits the target called for sat **one day** short of the 14d min-hold (both bought 08-12, day 13), and the owner reasonably read deposit-then-buys-only as the sells having failed. The planner computed the blocks all along — the ticket dropped them, and `raw/agentic-plan.json` is wiped every run, so the ticket is the ONLY carrier that survives to the consumer. Each entry keeps `{sym, kind, blocked, dollars, pl, plPct, until, heldDays, note}` — `kind` is what the sell WOULD have been (exit/trim/harvest), `blocked` names the guard, `until` is the unlock date as a FIELD (the consumer must never re-parse it out of the prose). A block is **not** a trade and deliberately does **not** enter `planHash`, or an unchanged plan would re-propose itself every pass as a day-count ticked. **The consumer cannot recompute this** — min-hold needs per-name `lastBuyDate`, which the snapshot doesn't carry. |
| `producer/agentic-parked.json` | **The index-parking ledger (v102) — the "waiting ground".** When the deploy planner defers a target name, its dollars are parked in a broad-market placeholder (`PARK_VEHICLE` = **VTI**) instead of idling in cash, and released to fund the name when it clears. This COMMITTED file is the **only** system of record: `raw/` is wiped every run and the executor may never write `data.json`, so neither can hold state the executor mutates (same reasoning as `agentic-target.json` / `agentic-decisions.json`). `build-data.mjs` reads it into **`data.agentic.parked`** (committed file wins; prior snapshot is the fallback) and `agentic-exec-gate.mjs` reads it directly, so a park/release written this session is visible on the very next pass without waiting for a producer run. The executor rewrites it after a park or release FILLS (AGENTIC.md §executor step 3f) — it is the **third and only other file** the executor may commit. Skipping that write silently breaks the mechanism: the ledger reads $0 while the vehicle is actually held, so the next pass can't release it and the money strands in a placeholder nothing accounts for. |
| `producer/agentic-exec-gate.mjs` | **Deterministic gate for the agentic EXECUTOR (v96)** — preflight for the self-driving rebalance loop (see AGENTIC.md §executor). Prints one mode and exits: `EXEC_TRADE` (ticket confirmed/auto → place sells + leg-1 buys) · `EXEC_BUYS` (carried buy leg due) · `EXEC_AUTO` (fresh plan ≤ `AUTO_TURNOVER_CAP` turnover — **$10,000** since 2026-08-25 → execute unattended) · `EXEC_PROPOSE` (above cap → ticket + push for one-tap) · `EXEC_IDLE` (exit 30: kill switch `PF_AGENTIC_AUTO=off`, market closed, stale/missing snapshot — **trading fails SAFE**, dust plans < $25, an identical proposal already outstanding, or — since 2026-08-31 — the snapshot **failing the agentic IDENTITY check**, `snapshotHoldingsSanity`, which runs before any mode is printed). Decrypts the committed snapshot, runs `planDeployment`, writes `producer/raw/agentic-plan.json` for the agent. The gate's plan has NO earnings map — the executor checks `get_earnings_calendar` (and `get_equity_orders` on BOTH accounts — margin for cross-account wash, ••••3900 for the v98 PDT day-trade guard) LIVE before placing. **Since the 2026-08-12 churn governor** the gate DOES pass `accountActivity` (buy/sell dates from the committed `agentic-decisions.json` via `activityFromDecisions`) so the 14d min-hold/re-entry guards bind at plan time; the executor still overlays today's fills live. |
| `producer/riskweights.mjs` | **Pure risk-aware weighting (v93, unit-tested; LOOK-THROUGH since v121).** `riskAdjustWeights(names)` enforces two caps on top of the research's conviction weights: a **correlation-cluster cap** (`megacap-tech` NVDA/AVGO/AAPL/MSFT/GOOGL/META/AMZN/ORCL/NFLX ≤48% combined — "sector-diversified" labels hid this; payments ≤20%, staples ≤25%; SPY/index uncapped) and a **vol-scaled single-name cap** (a wider 52wk range → a smaller max weight for the same conviction, so 10% in LLY ≠ 10% in SPY). Iterative water-filling + re-normalize to 100%. `clusterOf`/`volScaledCap` reused by the deploy planner. **v121 measured what is INSIDE the index sleeves — and since 2026-08-25 that look-through is REPORTED, NOT ENFORCED (`LOOKTHROUGH_ENFORCE = false`, owner decision; caps bind on DIRECT weight — see the gotcha below; flip the flag to restore v121 enforcement).** They previously counted only DIRECT holdings, so a book could hold 44.8% megacap-tech directly, stack 20% SPY + 5% VTI on top, and still report itself inside a "48%" cap while true exposure was ~54%. **`LOOKTHROUGH`** maps each index vehicle to its cluster composition (Alpha Vantage `ETF_PROFILE`, 2026-08-24: SPY 37.5% megacap-tech, QQQ 42.4%, VTI 31.1% derived as SPY×0.83 and calibrated against VTI's observed NVDA/AAPL weights) and **`clusterExposure(names)`** returns `{direct, lookThrough, total}` per cluster; caps were enforced on `total` until 2026-08-25 and now bind on `direct`, with `total` still computed and disclosed. **Three things here are load-bearing:** (a) a breach trims **DIRECT members only, never the index vehicle** — SPY/VTI are the diversifier, so a fat index core must shrink how much direct megacap can sit on top of it, not itself be sold (it will read as a bug otherwise); (b) `redistribute` is look-through aware, because adding `x` to SPY adds `0.375x` of megacap exposure, so dumping freed megacap weight into the index re-breaches the cap just enforced — an oscillation that previously only terminated because the pass loop is bounded; (c) the final normalization no longer scales every name back up by a blanket factor, which **silently undid the caps** (observed: JPM capped to 22% came back out at **24.2%**) — the shortfall is filled through the same cap-aware redistribution, and a genuinely un-placeable remainder is parked in the index sleeve with an explicit `RESIDUAL:` note rather than absorbed. `VTI` was also added to `INDEX_SYMS` (it is total-market ballast; as a singleton it was drawing a 25% single-name cap). An unlisted vehicle contributes zero look-through — old direct-only behaviour for that vehicle, which is NOT conservative, so **add a vehicle to `LOOKTHROUGH` before allocating to it**, and review the fractions ~annually like `market.mjs`'s holiday calendar. **v124 — the SINGLETON LOOPHOLE + the first FLOOR.** (a) A ticker absent from `CLUSTERS` falls through to `single:<SYM>`, which carries **no correlation cap at all** — and the list only ever held the fourteen names the research universe happened to contain, so a high-multiple AI name co-moving with the complex tick for tick (**TSLA, PLTR, NOW, CRWD, ANET, MU, TSM, SMCI**…) counted **zero** against the 48% cap; a book could sit at 44.8% direct megacap and stack more of the same bet on top while reporting itself compliant. Membership is about **co-movement, not GICS labels or market cap** (TSM is a semi, TSLA an automaker, NOW a software firm — all three trade as the AI bet); adding a name can only ever *tighten* a cap, so err toward inclusion. Defensive clusters (`utilities`/`reits`/`telecom`/`low-vol`) were added in the same pass — every one of those names was an uncapped singleton too, the mirror image of the hole. (b) **`AG_DEFENSIVE_MIN` (15% of book) is the module's only FLOOR** — everything else here is a ceiling. See the Defensive floor entry below. Note `agentic-deploy.mjs` needs no change: it buys only toward target weights, so it inherits whatever caps held when the target was built. |
| `producer/riskweights.mjs` — **gold diversifier (2026-08-25)** | `DIVERSIFIER_SYMS` (GLDM/GLD/IAU/SGOL) · `AG_DIVERSIFIER_MIN` **5%** floor · `AG_DIVERSIFIER_MAX` **10%** ceiling · `isDiversifier` / `diversifierExposure`. The book's first NON-EQUITY holding, and its only non-correlated one: the defensive floor buys staples/pharma which still fall in a drawdown (~0.5-0.7 correlation to SPY), and the drawdown breaker only acts AFTER −8%. **It cannot come from the research** — quality/growth/catalyst are meaningless for a bullion trust, so gold takes the "no data" 5.0 on three of five sleeves and tops out at a **5.72** composite against a ~6.8 marginal finalist; it is *arithmetically* unselectable. So `finalize-target.mjs` injects it structurally, the way SPY is handed to the synthesis as ballast, at the weight that **survives normalization** (`divMin·S/(100−divMin)` — appending the floor itself lands below the floor, 5 → 4.76%). **Four things are load-bearing:** it gets its OWN floor rather than counting toward the defensive one (gold's range/price ~0.47 fails the 0.42 `DEFENSIVE_MAX_VOL` gate, and loosening that gate to admit it would re-admit LLY at 0.48 — the bug fixed the same day); it is exempt from the vol-scaled single-name cap (which would shrink the hedge hardest exactly when volatility makes it useful) but **bounded by its own ceiling** so it never becomes the overflow sink for weight freed by cluster trims; it is **never a donor** to the defensive floor (funding equity ballast by selling the non-correlated sleeve trades the better hedge for the weaker one); and it **never fabricates** — a book with no gold vehicle reports the shortfall. Miners (GDX) are deliberately excluded — that is an equity with its own operating risk and the equity beta the sleeve exists to avoid; silver (SLV, range/price ~1.2) is far too volatile to be ballast. |
| `producer/research-universe.mjs` | **The weekly research's screening BENCH (2026-08-25)** — 137 names / 20 sectors, with `universeSlice(n)` dealing a **sector-BALANCED** slice (round-robin, `core` before `wide`) because taking the first n rows would hand back whatever sectors sit at the top, and the cut's `max 2/sector` rule means a slice missing a sector cannot produce a finalist from it. Exists because the Routine used to screen over **`leaders.mjs`** — 19 names, 16 megacap/large-growth — and six research cycles then selected **14 distinct names in seven weeks**. `leaders.mjs` is deliberately NOT reused (it is the CONSUMER's Plan-page bench, quoted every run and curated tight); this one is wide and quoted only on research day. CLI: `--symbols` (comma list for a batch quote), `--stats`, `--max N\|all`. **Size has an arithmetic ceiling — don't pad it:** a name the sleeves can't fetch scores 5.0 and tops out at a **5.72** composite vs a ~6.5-6.9 marginal finalist, so it is *incapable* of clearing the cut and only thins each sleeve's attention. Valuation is free at any size, momentum is RH-batched, but **quality/growth/catalyst are capped by Alpha Vantage's 25/day** — hence `DEFAULT_SLICE` 60. Going wider needs fundamentals passed in via `args` (the flow-sleeve pattern; `extfund.mjs` already emits the AV shape, FMP ~250/day + Finnhub 60/min) — **not built yet**. |
| `producer/finalists.mjs` | **Which candidates reach adversarial verify — the CHALLENGER QUOTA (2026-08-25).** `selectFinalists(ranked,{cap,perSector,challengerSlots,incumbents})`, pure + unit-tested; the workflow inlines a MIRROR (sandbox can't import repo modules) and **`finalists.test.mjs` extracts that block out of the workflow source and asserts it produces identical output**, so the mirror can't silently drift. The old cut (`top 10, max 2/sector`) looked neutral and wasn't: over six committed cycles the system picked **14 distinct names in 7 weeks**, seven in ≥5 of 6 targets (SPY/GOOGL/NVDA/JPM in all six). That is neither proof it works nor proof it's broken — *a landslide says nothing when one name is on the ballot* — and that unfalsifiability IS the bug. Cut is now **16** with **5 slots RESERVED** for names in neither the book nor the prior target; challengers share the same per-sector budget (five from one sector would just trade one concentration for another), and unfillable slots **backfill on merit** with the shortfall reported rather than shrinking the cut. Live effect: fresh names reaching verify **1/10 → 7/16**, sectors 7 → 11, **every previous finalist retained**. It buys and sells nothing — verify, the incumbency framing, min-hold and re-entry cooldown still decide what trades. |
| `producer/finalize-target.mjs` | Turns the research workflow's raw `allocation` into the committed `agentic-target.json`, **deterministically re-enforcing** `riskweights.mjs` caps (the workflow proposes, this disposes — cluster/vol caps hold regardless of the LLM output). Producer step 7.4 pipes the workflow output through it; also `import { finalizeTarget }` for on-demand rebalances. **Two-strike phase-out (2026-08-12 churn governor):** a HELD name in the prior target but missing from the new allocation is **retained at its prior weight, flagged `phaseOut:true`** (zero trades — if next week re-includes it, nothing was ever sold); still missing on the NEXT refresh → genuinely dropped; an explicit adverse verdict (`businessOk:false`/rec `avoid`) drops immediately. Drop reasons land in **`target.dropped`** (`business-broken` unlocks the planner's min-hold). The CLI auto-reads the committed target as `prior` (`--no-prior` to disable) and takes `--held SYM,…` (••••3900's current tickers — without it every prior name is protected, which fails safe since the planner never BUYS a phaseOut name); `verdicts` come from the workflow return. **v124** also applies the **defensive floor** and emits `target.defensive` `{direct,lookThrough,total,floor,shortfall}` (`meta.defensiveMin` overrides; `0` disables). **Also derives the ENTRY BAND from the adversarial verdict (2026-08-25).** `entryDiscountFor(entryQuality)` → the discount below spot the zone's ceiling must sit at (1.5%/pt below `AG_ENTRY_Q_OK` 6, capped at `AG_ENTRY_Q_MAX` 8%); `tightenEntryByQuality` rewrites the zone so the deploy planner's `above-entry` deferral actually fires. Closes a real hole: `entryQuality` was documented as "sizes, does not veto" and did shrink the WEIGHT, but never moved the ZONE — and the v102 prompt tells the model to set *reachable* zones, so it brackets spot and a 3/10 entry executed at market exactly like a 9/10 one. Four guards: the discount is **bounded** (a deep zone reads as never-buy — the v102 lesson), the **idle-cash deadline still backstops it** so it can delay a buy but never veto one, it **never loosens** a zone the model set tighter, and **defensive-floor names are EXEMPT** (deferred weight parks in VTI, 100% equity beta, so deferring ballast would swap stabilizers for beta at the worst moment — same reasoning as the drawdown breaker holding deferred dollars in cash). **`absent ≠ zero`:** `+null` coerces to 0, so an unscored name would have drawn the maximum haircut; a missing verdict leaves the zone untouched. **v126 — `dropped` SURVIVES A RE-RUN.** Drops are detected only by diffing the new allocation against `prior.names`, and the CLI auto-reads the COMMITTED target as `prior` — so re-running finalize against its own output finds nothing missing and writes `dropped: []`, **erasing the record**. Live on 2026-08-25: three finalize runs landed the same day (research refresh → entry bands → gold sleeve) and the JPM/GE `phase-out-complete` entries the first wrote were wiped by the second and third. Benign for a phase-out; **not** benign for `business-broken`, the one reason that unlocks the deploy planner's 14d min-hold — losing it would strand a broken thesis in the book for two more weeks. A prior record is now carried forward while it is still TRUE: still absent from the target, still held (when `held` is supplied), and inside `DROP_RETENTION_DAYS` (90). Each entry carries `since` (first recorded, never re-stamped) and carried ones are tagged `carried:true`; a freshly-detected drop always wins on conflict. **The natural terminator is the exit itself** — a name that leaves the book leaves this list — so the 90d cap is only a backstop for callers that omit `held`. |
| `producer/agentic-ledger.mjs` — **frozen outcome marks (v129)** | `gradeDecision` marks every decision to **TODAY's** price. Right for "how am I doing", useless for learning: a June call's contribution and verdict keep moving for as long as the position exists, so neither log could ever answer *"what is our 30-day hit rate?"* — the number it would answer with changed every hour. **Accumulating history does not compound into anything while every row is still re-graded against a moving target.** `applyMarks(graded, priorDecisions, asOf)` freezes the outcome at `MARK_HORIZONS` (5/30/90d): stamped ONCE on the first run at or past the horizon and **never recomputed**, the same rule that makes `drivers` a decision-time stamp. Marks live on the record in the snapshot, so they need no second store, and they are carried by `id` from the prior snapshot — independent of `mergeDecisions`' sweep, which would otherwise wipe them for any record inside the sweep window. Purely **additive**: `grade`, `stats` and `sleeves` are untouched, so the flow burn-in Routine reads exactly what it read before. `markStats` rolls them up per horizon. **Two things are load-bearing.** (a) When bars cannot measure it, a decision **first seen past a horizon records `missed`, never a value** — the 21 days backfilled from ••••0741's existing order history are all >78d old, and stamping them on sight would file a 78-day-old outcome as a "5-day" result and poison the very statistics this exists to produce; `markStats` counts misses separately and never folds them in, so a backfilled log yields NO statistics rather than false ones. (b) `MARK_GRACE_DAYS` (5) lets a run land late (weekend, holiday, producer outage) and still call the measurement by its horizon; past that it is honestly a miss. **v130 measures a horizon from RECORDED CLOSES wherever it can** (`closeIndex` / `markFromBars`, passed `histDay` by build-data for both ledgers): a live-only stamp can measure only horizons reached while the producer was watching, so a backfilled log yields nothing for months — but `data.hist.day` already holds the real closes, and the outcome of a June decision at +30d is *arithmetic on prices we have*, not a guess. Bars are tried FIRST for every due horizon (close-to-close is also the more consistent basis than "whatever the price was at run time"), and each mark records `src:'bars'|'live'` so the two can be told apart. Live effect on the real books: self-directed 5d **n=1 → 13**, 30d **n=1 → 7** (and the 30d alpha moved from a lone unrepresentative −19.1pp to −3.6pp over seven decisions); agentic 5d **0 → 2**, 30d **1 → 2**. **The one thing that must never happen is pricing off a STALE series** — `data.hist.day` goes stale PER SYMBOL (a name that rotates out of the fetch keeps the series it had when it left), and a series that stops mid-run *stops at its own high*, which is exactly how MU/WULF/NBIS once scored a perfect 10.00. So the lookup requires a bar dated at or after the target within `MARK_BAR_WINDOW_DAYS` (5, for weekends/holidays) and **never reaches backwards to the last available bar**; a name whose series doesn't reach the horizon is simply unmeasurable. **Every leg must price**, too — dropping the one leg that happened to move the number is how a statistic becomes a lie. Rendered by `decMarkStrip()` on BOTH Rebalance Log cards. |
| `producer/agentic-ledger.mjs` · `producer/agentic-decisions.json` | **Rebalance decision ledger (v93, unit-tested).** The committed JSON is the owner-confirmed log of each deploy/rebalance (`{date,kind,trades:[{sym,side,dollars,priceAt}],spyAt,rationale}`); the agent APPENDS a record on confirm (`makeDecision`). `build-data.mjs` reads it, `gradeDecisions(…, quotes)` grades each vs live prices + SPY (dollar-weighted contribution, alpha, ahead/behind/open verdict), and attaches it as `data.agentic.decisions` for the consumer's **Rebalance Log** card. The account's own Track Record — so the strategy gets smarter, not just busier. **Sleeve attribution (v121)** — the thing that makes a research sleeve *removable*: `makeDecision` now takes the committed `target` and stamps each **BUY** leg with that name's `drivers` (the sleeves scoring ≥7, derived deterministically by `finalize-target.mjs`), and `gradeDecisions` returns **`sleeves`** = per-driver `{n, dollars, contribPct, alphaPct, thin}` — dollar-weighted, measured as **alpha vs SPY** so a sleeve isn't credited for a rising tape. Three deliberate choices: drivers are stamped **at decision time, never reconstructed later** (a leg matched against whatever target is current would be attributed to a thesis that did not pick it — legacy legs are excluded, not guessed at); **buys only** (a trim is not an expression of the sleeve that picked the name); and a leg with k drivers **splits its dollars 1/k** — crude, but unbiased and needs no extra data, where a regression on sleeve scores would need far more decisions than this account generates in a year. Sleeves under `SLEEVE_MIN_N` (4) graded buys are flagged **`thin`** and must be rendered as "not yet measurable", never as a finding. **The agent must pass `target` to `makeDecision`** (AGENTIC.md executor step 3e / PRODUCER.md step 7) — omit it and that rebalance is invisible to attribution forever, since it cannot be backfilled. This is also what will eventually answer whether the **flow** sleeve earns its keep while `FLOW_WEIGHT` is still 0: `ranking` returns flow scores unconditionally, so flow is attributed for MEASUREMENT without having influenced which names were bought. Also exports **`activityFromDecisions`** (2026-08-12): ledger → `{SYM:{lastBuyDate,lastSellDate}}` over a trailing window — the exec gate's input to the deploy planner's min-hold/re-entry churn guards. **And `snapshotHoldingsSanity` (2026-08-31)** — the agentic IDENTITY check: does the snapshot's book agree with what this system's own committed files say ••••3900 owns? Two arms, both comparing against records we WRITE rather than against a threshold a real deposit or drawdown could trip: (a) the parking ledger cannot hold dollars in a vehicle the book doesn't contain; (b) a name bought and not since sold must still be there — requiring that ZERO survive keeps it quiet through ordinary rebalancing while a wrong-account payload fails outright. Fails OPEN below `SANITY_MIN_EXPECTED` (3) tracked names. The exec gate calls it **before any mode is printed**; see the gotcha. |
| `producer/maindecisions.mjs` · `producer/main-decisions.json` | **The SELF-DIRECTED account's Rebalance Log (v127, pure + unit-tested).** ••••3900's log works because an executor Routine APPENDS a record to `agentic-decisions.json` at confirm time. ••••0741 has no executor — the owner trades by hand — so a hand-appended ledger there would be **a card that stays empty forever**. Its decisions are instead DERIVED from the account's own filled orders (`raw/main-orders.json`, `get_equity_orders`, EVERY-RUN) and then run through the **same** `gradeDecisions` from `agentic-ledger.mjs`: same SPY alpha, same ahead/behind/open verdicts, same card. `decisionsFromOrders` groups fills into one record per **ET trading day**; `spyClosesFrom` reads SPY's close for that day out of `data.hist.day` (both bar shapes, skipping `interpolated` placeholders and the consumer's spliced `live` bar); `mergeDecisions` accumulates the log **in the snapshot** (raw/ is wiped every run and the window only covers the recent past — the `ivHistory` pattern). **Four things are load-bearing.** (a) **Orders, never a position diff** — the same lesson the wash-sale ledger learned the expensive way; a fill is a fact with a price and a timestamp, and if `main-orders.json` is absent the module derives NOTHING and carries the prior log forward rather than inferring. (b) **The date is the ET FILL, not the UTC placement** — a GTC limit placed 08-14 06:38Z filled at 17:21Z, and a fill at 08-10 03:56Z is really the evening of Aug 9; group on the wrong one and the record lands on a day nothing happened AND reads the wrong SPY close, silently biasing every alpha on the card. (c) **The sweep window comes from what the payload COVERS, never from a constant** — `get_equity_orders` PAGINATES, and a live 120-day fetch came back with 200 orders reaching only ~78 days plus a `next` cursor. The sweep deletes any in-window record the fresh fetch no longer reports, so keying it to the days *requested* would have deleted six weeks of real history on every run; `deriveLog()` keys it to the oldest day actually returned, and on a truncated page also discards that oldest day, whose legs the page boundary may have split. (d) **DRIP / recurring fills are excluded** (`MECHANICAL_AGENTS`) — a standing instruction firing is not an allocation call, the same reasoning as `flow.mjs` counting open-market P/S codes only. **Retention is TIME-BASED, not a count** (`DECISION_RETAIN_YEARS` 8; `DECISION_CAP` 2000 is only a runaway backstop). The original flat cap of 160 looked generous and was not: this account filled orders on 22 of 78 calendar days (~103 records/yr), so it would have begun **silently discarding the oldest history after ~1.6 years** — precisely the history worth keeping. The log lives only in the snapshot, so the one real loss path is a prior snapshot that cannot be decrypted; `warnIfLogShrank` makes that LOUD in the run log instead of letting a short log quietly become the new baseline, and every prior `data.json` is in git, so it is recoverable rather than gone. `main-decisions.json` is an **optional, committed owner overlay** (the manual half of "same process"): it can give a derived day a real rationale, and never invents a day the broker has no orders for. Consumer: `renderSdLog()` on the ACCOUNTS tab's self-directed side, mirroring where the agentic log sits on its side (Plan keeps a pointer). |
| `producer/railway/` · `producer/RAILWAY.md` | Optional credentialed Railway producer (Python `robin_stocks` fetch → existing Node tail). See the runbook. |

## Conventions
- **Branch:** develop on `claude/portfolio-dashboard-data-ffc7x3`; the producer publishes `data.json`
  to `main`. **Push code straight to `main`** — the owner gave standing authorization (2026-08-11); a PR
  the agent opens and merges alone is ceremony, and both the producer and the agentic executor read
  `main`, so unmerged work simply never takes effect. Open a PR only when the owner asks for one, or
  when a change is large/risky enough that a reviewable diff is genuinely worth the round trip. Run the
  test suite before pushing (see "Verify before shipping").
- **ALWAYS MERGE — finishing a change means landing it on `main` (standing rule, 2026-08-14).** A
  Claude-on-the-web session is often launched pinned to its own per-task branch
  (`claude/<slug>`); that pin governs where you *develop*, not where the work *ends*. When the change
  is verified, fast-forward or merge that branch into `main` in the same session
  (`git fetch origin main && git push origin <branch>:main`, or a real merge if `main` moved) and
  say so. **Do not ask first, and do not hand back a green branch as if it were done** — GitHub Pages
  serves `main`, so an unmerged commit is invisible to the phone, and the producer + agentic executor
  both read `main`, so unmerged producer code silently never runs. Leaving work on a branch is a
  half-finished task, not a cautious one. The only exceptions: the owner explicitly asks for a PR, or
  the change is large/risky enough to want a reviewable diff — in both cases say plainly that it is
  NOT live yet. Verify before merging (tests + the version bumps), never merge to dodge a failure.
- **Versioning:** any change to `index.html`/`sw.js` → bump **both** `APP_VERSION` (in `index.html`
  `boot()`) and `CACHE_VERSION` (in `sw.js`) together. Currently around **v132** (`pf-v132`) — v132 added the Income & Tax **prediction-market line item**; before that, — v127 added the self-directed Rebalance Log, v128 moved it to the Accounts tab beside the agentic one, v129 made both logs **accumulate a usable record** (frozen outcome marks + time-based retention), v130 **backfilled those marks from recorded daily closes** so the record starts full instead of empty, and v131 was the **navigation & accessibility pass** — bottom tab bar, section rail, Find, My view, ▲/▼ glyphs (all below).
- **Two accounts, two MANDATES — never let one side's rulebook leak into the other.** ••••0741
  (self-directed) is the **aggressive** book: concentrated, high-beta, levered, momentum-driven —
  its dials are the `SD_*` constants in `index.html`. ••••3900 (agentic) is the **guarded** book:
  unlevered, diversified, research-driven, churn-governed — its dials live in `producer/AGENTIC.md`
  + the `AG_*` constants. A change that makes one look like the other is a bug, not a simplification.
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
- **v121 preview flags:** `PF_SAMPLE_DRAWDOWN=soft|hard` trips the book-level drawdown banner + guardrail
  row, `PF_SAMPLE_VIX=33` (or 25) the stressed/elevated regime banner. The sample ledger now carries
  graded decisions **with sleeve drivers** (built through the real `makeDecision`/`gradeDecisions`, so the
  fixture can't drift from the shipped shape) so the Rebalance Log's "By research sleeve" strip renders.
- `node producer/make-sample-data.mjs` writes a **plaintext** sample `data.json` (fake holdings) so
  the consumer renders without the real encrypted snapshot or any MCP access. Two env flags widen what
  it exercises, because the default fixture left whole surfaces unreachable in preview:
  **`PF_SAMPLE_MARGIN=1`** (v117) renders a levered book so the Leverage tile and margin banner can be
  eyeballed, and **`PF_SAMPLE_CONCENTRATED=1`** (v119) shrinks the rest of the book so IREN breaches
  the 50% single-name cap by MORE than its unpledged shares can cover — the only way to see the
  covered-call collateral reserve, its 🔒 callout and the "capped — collateral" trim row. The fixture
  also carries a real short-call position + a queued sell-to-open on a 350-share lot (300 pledged, 50
  free) and a `data.main` equity history with a mid-series deposit.
- **v127:** the sample `data.main` carries a `decisions` block built by running the REAL
  `decisionsFromOrders` over a synthetic `get_equity_orders` payload (anchored to the fixture's SPY bar
  dates so the "vs SPY" column is actually exercised), covering all three record kinds — deploy, cash
  raise, two-sided rebalance — plus a DRIP fill and a cancelled order that must both be filtered out.
- `node producer/serve.mjs` serves the static site locally to eyeball UI changes.
- `producer/gen-icons.mjs` regenerates the PWA icons. **Never commit a plaintext `data.json`** — restore
  the real one with `git checkout origin/main -- data.json` before committing.

## Verify before shipping (no network needed)
- **Unit + integration tests:** `for t in producer/*.test.mjs; do node "$t"; done` — covers the
  extfund normalizers, the picks scoring engine (weights/sector cap/social/coverage flags, the
  **trend gate** and the **recent-stop-out cooldown** — `gradePickClose`/`recentStopCooldown`),
  `shapeSocial`, `computeAlerts`, the **agentic v93 engines** (`riskweights` cluster/vol caps + the **v124 singleton-loophole closure** and **defensive floor** — the vol gate that disqualifies a wide-range pharma name, the per-cluster pooling that stops a top-up breaching the receiving cap, the never-fabricate shortfall report, and the `defensiveMin:0` off switch,
  `agentic-deploy` earnings-blackout/gap-reverify/wash-sale planner — plus the **v102 entry-band layer** (tolerance under the floor, the new above-entry premium deferral, zone ageing → advisory, the idle-cash deadline + tranching/sweep, and index parking: park-on-defer, release-to-fund, the off-target-exit exemption that stops the churn loop, PDT-guarded releases, the **2026-08-28 funding reconciliation** — a sub-floor shortfall re-sizes the buy instead of shipping it unfundable, the same for a parked block under the floor, and an at-or-above-floor shortfall still releases exactly as before — and comma/prose entry-zone parsing) — and its **v96 full-book layer**:
  off-target exits, TLH thresholds + cross-account wash, tax netting, the $10,000 auto tier, plus the **v98
  limited-margin layer** — same-session proceeds funding and the PDT day-trade guard across exits/harvests/trims — and the **2026-08-12 churn governor**: min-hold blocks/overrides (deep-loss, business-broken, harvest-exempt), the re-entry cooldown (+ its VTI parking), the dust floor, and the phase-out no-new-money rule — `agentic-triggers` deposit +
  refresh events, `agentic-ledger` decision grading + `activityFromDecisions` + the **v129 frozen marks** (stamped once at the horizon; a later run at a wildly different price cannot move a stamped mark; a record first seen past its horizon records `missed` rather than a value, so a backfilled log yields no statistics instead of false ones; the grace window; an unpriced decision waiting rather than recording a false miss; and `grade`/`sleeves` left untouched) **and the v130 recorded-close basis** (a backfilled decision measured close-to-close at exactly its horizon; the STALE-SERIES abstention — a series ending before the horizon is unmeasurable, never priced off its last bar, while a horizon its bars do cover still measures; no partial mark when any leg can't price; a horizon whose target date is still ahead left alone; both bar shapes with interpolated/live/zero rows dropped; a sell of a name that then fell marking positive; and a already-stamped mark not re-derived from bars), **`maindecisions`** (the self-directed log: the ET-fill grouping incl. the previous-evening boundary and the placed-vs-filled distinction, same-day clips collapsing to one share-weighted leg, the DRIP/cancelled filters, `spyAt` stamped from that day's close and `null` rather than guessed when absent, both bar shapes + the interpolated/live skips, the snapshot merge — out-of-window carry-forward, in-window sweep of a day the broker no longer reports, the owner-overlay annotation, **time-based retention** (four years of records at this account's real rate all kept, a record past the horizon dropped, the filter inert when `asOf` is omitted) and the runaway cap — and an end-to-end pass proving the derived log grades through `agentic-ledger.gradeDecisions` unchanged with no sleeve attribution), **`agentic-pending`** ticket
  lifecycle/transitions/staleness **plus the v126 `blockedSells`/`warnings` persistence** — guard, unlock date
  and would-have-been kind all survive onto the ticket, dollars rounded like any leg, warnings capped, empty
  arrays rather than `undefined`, and blocks deliberately absent from `planHash`), the **flow scorers** (`flow.mjs` — revision
  direction-over-level, the insider open-market filter + buy/sell asymmetry regression, surprise
  clamping, composite renormalization + the abstain-below-2-components rule), the **policy calendar**
  (`policy.mjs` — high-impact-only blackout, source requirement), **`polflow`** (dedupe, the ≥3-distinct-filer
  gate, the megacap-tech exclusion), **`finalists`** (the challenger quota: reserved slots filled with non-incumbents only, the shared per-sector budget, merit backfill when challengers run out, the old top-10 behaviour reproduced at `challengerSlots:0`, the sector-balanced `universeSlice`, **and the mirror check that runs the workflow's own inlined copy against the module**), **`riskweights`** (the **gold diversifier**: floor top-up, the own-ceiling bound so it is not an overflow sink, never-a-donor to the defensive floor, never-fabricated when absent, and `diversifierMin:0` as a real off switch; plus the **look-through report-only migration** — caps binding on direct while the total stays computed and disclosed, and no false RESIDUAL on an unenforced basis), **`finalize-target`** (the **structural gold injection** — injected only when absent, at the normalization-surviving weight, tagged `Diversifier`, never overriding a vehicle the allocation already chose; the **2026-08-25 verdict-derived entry bands** — the discount curve, the 8% cap that keeps a zone reachable, never-loosens, the defensive-floor exemption, `absent ≠ zero` so an unscored name is not handed the maximum haircut, and the rewritten zone still parsing first-two-numbers as lo,hi per `agentic-deploy`'s contract; plus the **vol-gate regression** that a wide-range pharma name is excluded from the floor once px/hi/lo are supplied), the deterministic `drivers` attribution + the two-strike phase-out: strike-1 retention, strike-2 drop, business-broken and not-held drops, **plus the v126 same-day re-run carry-forward** — a record survives a finalize run against finalize's own output, keeps its ORIGINAL `since`, is not duplicated, is retired the moment the name is re-included or the position exits, loses to a freshly-detected drop, and expires past the retention window when `held` was never supplied — plus the **v124 defensive floor** reaching the committed target — shortfall reported on a megacap-only book, satisfied and silent on a book with real ballast, `defensiveMin:0` restoring pre-v124 behaviour), the **option money units + collateral rules** (`options.mjs` — per-contract vs
  per-order premium, the signed short credit, `sharesLockedByShortCalls`, and the covered-call idea
  guard), the **one-time cumFlow migration** (`cumflow-repair.mjs` — the phantom coming off the anchor and
  every later point while earlier ones and all `equity` values stay untouched, the IDEMPOTENCE that keeps a
  second pass a no-op by reference, a series that MOVED ON via a real later deposit left strictly alone, a
  genuine deposit stacked on top still carrying forward, and malformed/absent histories returned rather than
  thrown on), the **recorded equity series** (`equityseries.mjs` — the deposit inference incl. its
  options-value term, the capped noise floor, one-point-per-day/latest-wins, the history cap, **and the
  2026-08-30 derivatives term** — the real Scottie settlement payload pinned verbatim, the phantom deposit it
  used to produce, the step window telescoping so a second run of the day can't subtract it twice, the
  abstain-without-`since` rule, a losing bet cancelling the mirror-image phantom withdrawal, and junk/NaN inputs
  staying inert), **and the 2026-08-30 cash-based primary** (`inferCashFlow` — a pure price move with wholly stale
  quotes inferring nothing, a deposit caught whether it lands in cash or is deployed the same run, buys/sells/full
  exits cancelling to zero, a settlement netted via `extraPnl`, abstention when cash is absent or a traded symbol
  can't be priced, the legacy fallback still reachable, and a first point never reading as a transfer),
  the **broker realized-P&L normalizers** (`realizedpnl.mjs` — null transfer-only buckets stay n/a, a missing asset class stays null, all-account totals, the losses-only/de-duped wash-sale extraction, **and the prediction-market ledger** — a settlement picked up while
  equity trades are not, 13 runs of re-delivery de-duping to one, a losing bet netting the year down, a malformed
  payload leaving the ledger untouched rather than zeroing the year, YTD counting only the current year while older
  trades are kept, and the retention window), and a full `build-data.mjs` fixture run
  (empty-bars guard, quotes carry-forward, no-picks log guard, social-sidecar reuse, day-move alert,
  **flow sidecar → `data.flow` + per-symbol carry-forward**, **a prediction-market settlement excluded from the
  self-directed `cumFlow` while a real same-step deposit is still caught, and a blank-symbol settlement kept out
  of the wash-sale ledger**, **the v127 `data.main.decisions` emit** — a two-sided day becoming one `rebalance` record, the DRIP and cancelled orders filtered out, a 02:00Z fill filed under the previous ET day, `spyAt` read from the carried-forward SPY series, the in-window sweep of a phantom record and the out-of-window carry-forward — **the v126 `data.agentic.blockedSells` emit** — a done ticket still stripped from `pending` while its in-force blocks reach the consumer, an expired block filtered out, and the source ticket identified — **congressional ledger accumulation + dedupe**, **per-account broker realized superseding the stale owner figure**, **real closing trades replacing an inferred wash-sale entry**, and **`data.main` recorded from `total_value` with its deposit inferred into cumFlow**). CI runs these on every
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
- **`data.hist.day` can trail the live quotes by days — `fetchHist` splices the live bar on (v111).**
  Historicals are fetched once a day (FETCH_ALL) and carried forward, so any run whose historicals fetch
  didn't land leaves the daily series behind while `data.quotes` stays current — and every bar-derived
  figure silently ages with it. **Caught live on 2026-08-13:** the series ended on a real **Aug 11** bar
  (plus an `interpolated:true` Aug 12 placeholder — `fetchHist` already drops those) while the snapshot
  was built Aug 13 post-close. Holdings YTD read **+10.00%** against a true **+15.48%**, SPY **+12.79%**
  against **+13.85%**, and because two sessions of an IREN gap ($39.75→$44.77) hit the book far harder
  than the benchmark, the card claimed the portfolio was 2.8pp **behind** SPY when it was ~1.6pp **ahead**.
  `spliceLiveBars(map)` now appends the live quote as a final bar dated from the snapshot's own ET date
  (`_snapETDate`, `en-CA` in `America/New_York`), and `fetchHist` returns through it — so the YTD tile,
  Performance vs Benchmark, RSI/SMA, beta and the agentic SPY window all read current. Two invariants,
  both load-bearing: **(a) the splice is ATOMIC** — every series or none, because `betaFromHist`/
  `corrGroups` align returns by TAIL INDEX (`slice(-n)`), not by date, so pricing SPY but not one holding
  would shift that holding's whole series a day out of phase and quietly corrupt beta/correlation (a
  uniformly stale map merely lags; a half-spliced one is *wrong*) — hence a single unquotable symbol
  aborts the whole splice; **(b) the appended bar carries `live:true` and `gradePick` filters it out**,
  because the Track Record grades picks on CLOSES and already takes the live price as its own argument —
  splicing it into `bars` would double-count it AND let an intraday print trip a stop nothing closed
  through. `fetchHistG` (the chart modal's week/month series) is deliberately NOT spliced.
- **`data.hist.day` goes STALE PER SYMBOL, and a momentum scorer reads stale bars as a perfect score.**
  Distinct from the v111 splice bug (which was a uniform 1–2 day lag): the producer only refreshes daily
  bars for symbols in its **current fetch rotation** (holdings + market ETFs + the live picks universe), so
  a name that rotates out keeps whatever series it had **when it left** — potentially for months. On
  2026-08-14 the snapshot carried 137 symbols, but only **12** had bars inside 10 days; MU/WULF/NBIS ended
  **2026-06-18…22** (~8 weeks stale) and META 2026-06-26. This is lethal for any *ranking* built on those
  bars, because a series that stops mid-run **stops at its own high**: the v113 momentum lens scored MU,
  WULF and NBIS a perfect **10.00 at "0.0% off the high, +182pp relative strength"** and put all three at
  the top of the buy list. They were phantoms — the series simply never recorded what came next. Hence
  `sdMomentum`'s gates: a symbol must carry a **live quote** (no quote ⇒ it can't be priced or limit-ordered
  anyway — MU/WULF/NBIS/CRM/ADBE all lack one) **and** bars no older than `SD_AGING_DAYS` (35); 11–35 days
  scores but takes an `SD_AGING_CONF` haircut and can never outrank a fresh name; staler **abstains** and is
  listed to the reader as needing a refresh. **Any future ranker over `hist.day` needs the same gate** —
  check the last bar's date against `_snapETDate()`, never just `bars.length`. The real fix is producer-side
  (a growth bench quoted + bar-fetched every run, the `leaders.mjs` pattern); until then the lens is honest
  but narrow, and it says so on the card.
- **THE DEPOSIT INFERENCE WAS PRICING THE BOOK ON TWO DIFFERENT CLOCKS (2026-08-30).** `equity` comes from the
  broker's `total_value`, but the position prices in the price-move term come from `data.quotes` — and quotes
  **carry forward per-symbol** (v88), so a pre-market run reuses last night's prices while `total_value` already
  reflects the broker's live marks. The whole gap had nowhere to go but `flow`. Traced out of git on the real
  book, 2026-08-28: at **05:07** the stored quote prices were byte-identical to the prior evening while
  `total_value` had fallen $1,070 → a phantom **withdrawal of $1,070.39**; at **14:39** the quotes caught up and
  re-booked a move `total_value` had already absorbed → a phantom **deposit of $920.69**. **Cash never moved once
  all day, and the owner confirmed no transfers.** The same shape produced a +$949.26 "deposit" on 08-24.
  This is worse than noise, because the consumer's return is **deposit-IMMUNE by construction**: a phantom
  deposit silently DELETES real return and a phantom withdrawal silently INVENTS it. The self-directed account's
  "since 08-20" figure was showing **−9.71%** against a true **−5.28%** — 4.43pp of loss that never happened.
  Fixed by making `inferCashFlow` the primary: `flow = Δcash + Σ(Δqty × px) − extraPnl`. **Why that is the right
  shape:** substituting `total_value = equity_value + options_value + cash` into `flow = ΔTotal − P&L` cancels
  *every* mark-to-market term algebraically, leaving only cash and traded quantity — so the marks that were being
  sampled on the wrong clock drop out of the formula entirely rather than being corrected. Prices survive only in
  the `Δqty` term, which is **zero on any run that didn't trade**, i.e. almost all of them.
  **Three things are load-bearing.** (a) It **abstains** (`null` ⇒ caller falls back) rather than guessing when
  cash is missing or a traded symbol can't be priced. (b) The **fallback is the old formula, not zero** — falling
  back to the previous behaviour cannot itself be a regression. (c) A **first point is never a transfer**, even
  with cash present. Verified by replaying all 42 committed snapshots: **every phantom flow → 0**, while a real
  deposit is still caught whether it sits in cash or is deployed the same run.
  **Known residual, deliberately not modelled:** option premium is a cash flow this doesn't net out (selling a
  call for $300 credit reads as +$300). **The old formula had exactly the same blind spot** — `Δoptions_value`
  cancels the mark but not the trade — so it is unchanged, not a regression, and it sits far below the noise
  floor for this book. Dividends and margin interest are the same shape and size. Netting them needs an
  option-order and cash-activity feed the producer doesn't fetch.
  **The already-recorded history was repaired in the same change** (owner-confirmed against Robinhood's transfer
  history: nothing touched ••••0741 in the recorded window — the 08-25 $1,400 went to Agentic *from Robinhood
  Banking*), so all seven `data.main.equityHistory` points now carry `cumFlow: 0`. **••••3900 was left alone** —
  its 7,950.75 reflects real transfers ($5,000 on 08-11, $1,400 on 08-25, both confirmed), and its recorded
  window predates the available git history, so there is no evidence to correct and guessing would be worse.
- **A PREDICTION-MARKET WIN LOOKS EXACTLY LIKE A DEPOSIT (2026-08-30).** The self-directed book settled a
  1,245-contract event position ("Will Scottie Scheffler win the 2026 TOUR Championship?") at $1.00 on a $236.55
  cost — **$1,008.45 of real profit** — and the next producer run would have booked ~$890 of it as an inferred
  **deposit**, because the deposit inference's whole definition is *cash that appears with no matching change in
  any equity position*, which is precisely what a settlement payout is. The consumer's return is **time-weighted
  and deposit-immune**, so it would then have *subtracted* the win: ~5.7pp of genuine return erased on a $17.5k
  book, plus a phantom contribution the owner never made on the Account Performance card's 💰 strip. A LOSING bet
  fails the same way sign-flipped — it reads as a withdrawal and **flatters** the return, which is worse.
  **The root cause is that `total_value` is the BROKERAGE account only.** It reconciles exactly as
  `equity_value + options_value + cash` (verified to 9 decimals on the live payload), while `event_contracts_value`,
  `futures_value` and `crypto_value` are separate top-level buckets — those sleeves are different legal entities
  (Robinhood Derivatives, LLC is a registered FCM; Robinhood Crypto, LLC). So money moving between the brokerage
  account and a derivatives sleeve is an **internal transfer the inference cannot see**. Fixed by
  `equityseries.mjs`'s `derivativesRealized`, subtracted as `inferFlow`'s `extraPnl`.
  **Four things are load-bearing.** (a) **A blank `symbol` is the discriminator** — `get_pnl_trade_history` covers
  prediction markets alongside equities and the settlement row comes back with an EMPTY `symbol` AND an empty
  `side` (`{"timestamp":"2026-08-30T22:31:15Z","symbol":"","side":"","quantity":"1245","price":"1","realized_gain":"1008.45"}`);
  every equity/option/crypto trade carries a ticker. (b) **The window is the STEP, not the span** — the producer
  fetches 3 months every run but the inference differences ONE step, so it is bounded by the prior snapshot's
  `asOf`; consecutive runs telescope and nothing is subtracted twice. (c) **It needed NO new fetch and NO Routine
  prompt edit** — `main-trades.json` and `agentic-trades.json` were already EVERY-RUN for the wash-sale ledger; the
  data was arriving and being thrown away, the same shape of bug as the v119 `instrument_id` one. (d) **The
  wash-sale ledger was never affected**, by luck rather than design: `lossesFromTrades` drops blank symbols AND
  drops gains, so a settlement can't reach it — a bet is not a security and has no wash window. There is now an
  explicit test for that.
  **The guard for the day this stops being true:** if Robinhood ever folds a sleeve INTO `total_value`, subtracting
  realized P&L would double-count. `build-data.mjs` checks the `equity + options + cash` identity every run and
  **warns loudly** when it breaks while any sleeve bucket is non-zero, rather than drifting silently.
  **Known gap, deliberately not closed:** `get_realized_pnl` is per **asset class** (equity/option), so the Income
  & Tax card's "Realized — YTD" does **not** include prediction-market P&L. That is an omission in a
  broker-sourced tile, not a corruption of it — unlike the equity series, nothing downstream is made *wrong* by it.
- **Robinhood's `equity_value` is GROSS long market value — the account's equity is `total_value` (v116).**
  The payload is `total_value = equity_value + options_value + cash`, and on a margin book `cash` is the
  loan (negative), so the two diverge by the whole debt. On 2026-08-18 the self-directed account read
  `equity_value 29,906.51` / `options_value −591` / `cash −11,282.65` / `total_value 18,032.86`. The
  snapshot **Margin Used** tile, the red margin banner, the Action Center `MARGIN` alert and the Kyle
  export all divided the loan by `equity_value` while *labelling it "% of equity"* — reporting **37.7%**
  where the true debt-to-equity is **62.6%**. It understated leverage by exactly the leverage factor,
  which is the one number that must never be flattered. All four now divide by **`netEq`**
  (`stats.netEq` = `total_value`, falling back to `equity_value + cash`), the margin tile carries the
  leverage multiple (`1.66×`) in its sub-line, and the tile's colour thresholds were retuned to the new
  basis (>50% red ≈ 1.5×, >25% amber ≈ 1.25× — the old 30/15 against the gross denominator was a far
  laxer bar than it looked). **Those THRESHOLDS were superseded in v125** — the tile now colours on the
  owner's line-utilisation bands (red >70%, amber >50% of the credit line), because a debt-to-equity
  threshold painted this book permanently red at a level the owner deliberately runs. **Every FIGURE
  described in this entry is unchanged**, and must stay that way: `netEq` remains the denominator for
  every percentage-of-equity, and the line remains `buying_power + loan`. Only the colour and the
  verdict moved; the numbers are not negotiable. The Plan tab's `renderActionPlan` (v113) already did this correctly
  (`const equity=+st.totalVal`), which is precisely why the two surfaces disagreed: the plan said
  **1.58× / cap 1.60×** while the tile above it said a comfortable 37.7%. Also relabelled: the Buying
  Power tile's sub-line called `equity_value` "Equity" — it is **"Holdings"**. **Any new percentage-of-
  equity figure must use `netEq`**, never `equityVal`/`equity_value`.
  **v117 finished the job on Day Change.** `dayPnLP` was the last gross-basis figure — the *holdings'*
  price return, not the account's, so a levered book's real day was the leverage factor worse: on
  2026-08-18 the tile read **−6.06%** against a true **−9.67%**. It is now `dayPnL/(netEq−dayPnL)`, with
  the holdings basis kept as `stats.dayPnLPGross` and shown as a grey "· holdings −6.06%" **only when
  the two differ by ≥0.05pp** (i.e. only on margin — on an unlevered book they're the same number and
  printing it twice is noise). The agentic side already divided by `book` (= equity), so it was correct
  and is untouched. Note the sub-tile that CANNOT be fixed the same way: **YTD (holdings)** is the
  benchmark card's *modeled* price return of today's holdings indexed to Jan 1 — levering it would need
  a margin-balance history the broker never exposes, and multiplying by *today's* leverage would invent
  a number. It stays on the holdings basis and now says **"unlevered"** in its sub-line so the two tiles
  don't silently disagree.
  **`make-sample-data.mjs` was complicit** and is fixed too: it set `total_value = equity_value` while
  carrying positive cash — internally inconsistent with the real payload — so the margin banner and the
  Margin Used tile were **never exercised in local preview**, which is how this survived. It now emits
  `total_value = equity_value + cash`, and **`PF_SAMPLE_MARGIN=1`** generates a levered fixture
  (cash −11,282.65, buying power 16,976.33 — the real account's, so the fixture reproduces the reported
  screen exactly) so those surfaces can actually be eyeballed.
  **v119 — the self-directed YTD tile is now the ACCOUNT's year, not a model of it.** The two sides of
  the Accounts tab were showing two different KINDS of number under the same heading: the agentic side
  reported its real, deposit-adjusted, time-weighted return, while the self-directed side reported the
  benchmark card's **modelled** figure — today's holdings priced back to Jan 1 at current weights.
  That is not the account's year: it ignores everything opened or closed during the year, ignores
  realized P&L, and — being a holdings-price return — is blind to leverage, understating the real
  swing by the same factor that made "Margin Used" understate risk in v116. The producer now records
  `data.main.equityHistory` forward from `total_value` through the shared `equityseries.mjs`, and
  `acctPerfStats`/`acctYTDStats` (renamed from `agenticPerfStats`/`agenticYTDStats` — the math was
  never agentic-specific; the old `window.*` names still resolve) drive BOTH tiles. The Performance
  card gained a matching **"This account since {date}"** stat so the real figure sits beside the
  modelled one rather than silently disagreeing with the tile above (the v117 lesson). **It cannot be
  backfilled** — Robinhood publishes no account-equity history — so it starts the day the producer
  begins recording and says "since {date}"; until two points exist the tile falls back to the modelled
  number, explicitly labelled `modelled`. One consumer-side change came with it: the implausible-jump
  fallback (>20% in one step ⇒ treat as an un-annotated legacy deposit) now applies **only to steps
  where cumFlow is absent on both ends**. On a 1.6× high-beta book a >20% recorded step is a bad
  Tuesday, not a mystery deposit, and zeroing it would discard exactly the volatility this account
  exists to take.
  **v118 — the tile is called LEVERAGE, because "Margin Used" was ambiguous, not just miscomputed.**
  Robinhood's buying-power screen stacks **Margin total $28,258.98** over **Margin used $11,282.65**, so
  that *name* reads as **line utilisation** (loan ÷ credit line = **39.9%**), while the risk number is
  loan ÷ equity (**63.2%**). Both are legitimate; the old tile borrowed RH's label for the other one's
  denominator — and 37.7% landed near 39.9% by coincidence, which is why it never looked obviously
  broken. The tile now headlines `63.2% · 1.63×` with `39.9% of $28,258.98 line` beneath. **The margin
  line is not in the payload** — it is exactly `buying_power + loan` (verified to the penny against the
  app). Corroboration that `netEq` is the right basis: RH's own **margin buffer** (57.74% / $10,258.26)
  only reproduces against equity ≈ `total_value` — modelling it as `equity − 25% maintenance × LMV`
  gives 58.4% off `total_value` and nothing sane off `equity_value`.
- **Robinhood's option money units differ between orders and positions — and BOTH call sites had it
  wrong (v119).** Verified against the live payload for 3 IREN $50 calls sold at $2.92/sh:
  an **order** carries `price` "2.92" (per share), `premium` "292.00" (**per CONTRACT** = price ×
  multiplier) and `processed_premium` "876" (the whole filled order); a **position** carries
  `average_price` "-292.0000" (**per CONTRACT, and SIGNED** — negative = a credit you received) with
  `quantity` "3" and `trade_value_multiplier` "100". `options-build.mjs` multiplied the
  already-multiplied `average_price` by 100 *again*, so the covered call reported an **$87,600
  credit on an $876 trade** — straight into the card's "Credit" line, the payoff diagram, `maxProfit`
  and the exposure card's Open-Premium tile. The orders path had the mirror-image error, passing the
  per-contract figure as the order total (understating any multi-contract order by its contract
  count). The sign leaked too: `analyzeLeg` took the negative through and broke the covered call even
  at **$47.08 instead of $52.92** — i.e. below the strike, which is not how a short call works.
  Now `positionPremium`/`orderPremium` in `options.mjs` are the ONE place that knows these units,
  they return a MAGNITUDE (direction comes from the leg's side, never the sign), `analyzeLeg`
  defensively `Math.abs`es anyway, and `options.test.mjs` pins every case to the live fixture.
  Independent confirmation the fix is right: rebuilt `exposure.openPremium` comes out at **$597**,
  which is exactly Robinhood's own reported `options_value: -597`.
- **`get_option_quotes` nests `instrument_id` INSIDE `quote` — reading it off the wrapper silently
  dropped every greek (v119).** The response is `results[] = { quote:{instrument_id,…}, close:{…} }`.
  `options-build.mjs` keyed `posQById` off `q.instrument_id` on the *wrapper*, which is `undefined`,
  so the map never populated and `enrichLive` was a **no-op for your own contracts**: no mark, no
  delta/theta/vega/gamma, no P&L, no IV — hence a portfolio `netDelta` of exactly **0** and an
  `ivRank` of 0 on a name whose IV was 97%. It failed silently because the *idea* quotes are saved
  pre-normalized by the agent and worked fine, so the Options tab looked populated. `PRODUCER.md`
  step 2b was already correct — the data was arriving and being thrown away. Fixed by reading the id
  from both places. **A zero net delta on a book with open contracts is the tell.**
- **Never plan a sell of shares that back a short call (v119).** Robinhood does NOT reserve them:
  `get_equity_positions` reported `shares_held_for_options_events: 0` and the full 350 IREN shares as
  `shares_available_for_sells` while 300 of them backed three open $50 calls. So nothing but our own
  code stops the plan from recommending a sale that converts a covered call into a **naked** one —
  open-ended risk above the strike, on a levered book, which is the exact failure mode every cap in
  the self-directed mandate exists to prevent. `sharesLockedByShortCalls` (producer) and
  `sdLockedShares` (consumer, mirrors it — **keep the two in step**) count 100 shares per short-call
  contract, counting **pending sell-to-open orders too** (the shares are spoken for the moment the
  order is live). Three surfaces consume it: covered-call/collar **ideas** only look at free shares
  (the account was being offered a 4th call on 50 free shares), `renderActionPlan` caps every **exit
  and cap trim** at the free count and renders a 🔒 callout naming buy-back/roll as the way out, and
  the Do-now **MARGIN** alert picks a paydown candidate that is actually sellable. A subtlety worth
  keeping: when the reserve zeroes a trim entirely, the trims table's empty state must NOT say "no
  name is above the cap" — it would contradict the callout directly below it.
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
- **INDEX LOOK-THROUGH IS NOW REPORTED, NOT ENFORCED (owner decision, 2026-08-25).** v121 enforced the
  cluster caps on direct + look-through, on the reasoning that owning 20% SPY really is owning ~7.5%
  megacap-tech. The owner's call is that an **index is a different KIND of holding from a single-name
  sector bet** — the caps exist to stop concentration in individual names within a theme, and charging a
  broad-market diversifier against them penalises the very thing that reduces concentration. So
  `LOOKTHROUGH_ENFORCE` is **false**: caps bind on DIRECT weight, while `clusterExposure` still returns
  direct/lookThrough/total and the notes still disclose the gap. **Losing the measurement would be the
  real regression; only what BINDS changed.** Know the trade: at the 48% megacap cap, direct can now reach
  48% with ~8-9pp more inside SPY/VTI — roughly **57% true exposure**. Flip the flag to restore v121. Two
  follow-ons that will look like bugs otherwise: the RESIDUAL note must be judged on the SAME basis the
  caps were enforced on (or every book with an index core reports a permanent false breach it cannot
  clear), and six riskweights tests encoded the old contract and were migrated, not deleted — they now
  assert direct-basis capping AND that the look-through total is still computed and surfaced.
- **A score that only sizes is half a control — `entryQuality` never moved the entry ZONE (2026-08-25).**
  The v102 split (`businessOk` decides inclusion, `entryQuality` decides size) fixed the "great company,
  wrong price → all cash" bug, and the haircut does shrink the weight. But nothing connected the verdict to
  *when* the name is bought: the zone came from the model, and the same v102 prompt correctly tells it to
  set **reachable** zones — so it brackets spot, the planner's `above-entry` deferral never fires, and a
  3/10 entry goes on at market exactly like a 9/10 one. Live on 2026-08-25: all 16 verdicts came back 2-5
  (ten on exactly **3**) against a genuinely extended tape — 25 of 60 universe names in the top quartile of
  their 52-week range, V/MA/KO/JNJ at **97-99%** — and every zone still enclosed spot, so five new positions
  would have opened in one day at the top of the range. `finalize-target` now derives the ceiling from the
  verdict deterministically. **Two things worth carrying forward:** a distribution this narrow (ten of
  sixteen identical) means the *level* is informative but the *ranking* is not — same shape as the insider
  saturation bug — so use it to read the tape, never to pick which name to buy first; and the **defensive
  exemption is load-bearing**, because deferred weight parks in VTI and deferring ballast would swap
  stabilizers for beta exactly when the tape is stretched.
- **SOCIAL IS SELF-DIRECTED ONLY — and the leak path is the UNIVERSE, not the scoring (2026-08-25).** Retail
  buzz is **20% of the Daily Picks composite** (`picks.mjs`: `tech .33 + fund .28 + rr .19 + social .20`),
  which is correct — that engine feeds the ••••0741 swing book, where crowd attention is a real 4-8 week
  signal. It is **absent from the agentic model entirely**: the sleeves are momentum .22 / quality .24 /
  growth .22 / catalyst .14 / valuation .18 (+ flow at weight 0), and there is no reference to
  social/ApeWisdom/buzz anywhere in `agentic-research.js`, `finalize-target`, `riskweights`,
  `agentic-deploy`, `agentic-exec-gate`, `agentic-ledger` or `flow.mjs`. **The subtle part:** it never
  needed a sleeve to get in. The weekly Routine used to seed its universe from "the current top Daily
  Picks" — a socially-ranked list — so retail attention would have decided which names the agentic screen
  was *shown*, which is the same lever as scoring them (the v102 "a screen can only buy what it is shown"
  lesson, pointed the wrong way). PRODUCER.md step 7.2 and the Routine prompt now both say holdings ∪
  research bench and nothing else. **When auditing whether a signal is "in" a model, check what feeds the
  universe, not just what carries weight.**
- **The research screen could not be judged, because it only ever saw one kind of name (2026-08-25).** Six
  committed research cycles selected **14 distinct names in seven weeks**; seven appeared in ≥5 of 6 targets
  (SPY/GOOGL/NVDA/JPM in all six). The tempting read — "it keeps re-confirming these, so they must be good" —
  is unfalsifiable: **a landslide tells you nothing when one name is on the ballot.** "These are the best
  available" and "these were the only ones shown" produce identical evidence. Three narrowing steps all
  pulled the same way (a 16/19-megacap bench, a composite weighting momentum+growth **0.44** vs valuation
  **0.18**, and a top-10 cut), and fixing any ONE was absorbed by the other two — a 2.4× wider universe moved
  **2 of 10** finalist slots. The accumulated cost was concentration nobody chose: 46.0% of the book in one
  AI/big-tech bet (37.5% direct + 8.5% inside SPY/VTI) against a 48% ceiling. **The fix widens what is
  EVALUATED, never what is HELD** — that distinction is load-bearing, because turnover is short-term taxable
  here and the churn governor exists to protect a stable core. `research-universe.mjs` + the
  `finalists.mjs` challenger quota put ~5 fresh candidates in front of the adversarial verifier every week;
  nothing is bought or sold as a result. Don't "simplify" the quota into forced turnover, and don't widen the
  universe past what the sleeves can score (see the 5.72 ceiling in `research-universe.mjs`).
- **Every risk control in the agentic model was a CEILING until v124 — the book had no FLOOR.** The caps stop
  it over-owning the AI complex; nothing ever made it own a stabilizer. The only downturn responses that
  existed were reactive and cash-based — the drawdown breaker pauses buying at −8% and raises cash at −12%
  (i.e. *after* the book is already down), and regime pacing only slows deployment. **Neither rotates.** So a
  target could legitimately hold 0% staples, 0% utilities and 0% healthcare in perpetuity and the composite
  would never object: momentum + growth carry **0.44** of the weight against valuation's **0.18**, so an
  expensive fast name structurally outranks a cheap stable one — the valuation sleeve is an 18% dampener on a
  44% tailwind and cannot outvote it. Measured on the live 2026-08-18 target the book was **2.4% defensive**,
  all of it look-through from SPY/VTI, zero explicit. `AG_DEFENSIVE_MIN` (15%) is now enforced in
  `riskweights.mjs` / `finalize-target.mjs`. Two things about it are load-bearing: the **vol gate** (a name must
  be in a defensive cluster AND trade no wider than ~0.42 range/price — **LLY is GICS healthcare but a ~0.54
  range**, so counting it as ballast would satisfy the floor with the exact kind of position it exists to
  offset), and the fact that it **never fabricates a holding** — a book with no qualifying defensive name is
  reported short, never topped up out of thin air, because the real fix is the **universe the research was
  shown** (which had zero utilities, zero REITs and zero telecom in it — a screen can only buy what it is
  shown, the v102 lesson applied to the stability axis instead of the value axis).
- **SELF-DIRECTED MARGIN RUNS ON OWNER BANDS, NOT A LEVERAGE CAP (owner decision, 2026-08-25).** ••••0741
  is a deliberate gamble book, and the v113 risk dials had quietly started overruling that mandate. On
  2026-08-25 the plan told the owner to **sell the PLTR he had bought that morning** — momentum 9.0/10,
  trend fully intact — purely because it was 98% of equity and the book sat at 1.79× against a 1.60×
  ceiling. Nothing about the position was wrong; a dial was. Owner's instruction, verbatim: *"i dont mind
  using 50% or even up to 70% of my margin. its a gamble account and if i sell at a loss so be it."*
  So (a) margin is measured as **utilisation of the credit LINE** — the number Robinhood actually shows
  him — with `SD_UTIL_CRUISE` **50%** (the plan deploys up to it unprompted) and `SD_UTIL_MAX` **70%**
  (the only level that forces a sell). The line is `buying_power + loan`, the **v118 identity**; when
  buying power is missing the line is *unknowable*, so `util` is `null` and every surface falls back to
  the `SD_LEV_FALLBACK` (2.0×) exposure/equity ceiling **and says so** rather than inventing a
  denominator. (b) **Concentration is advisory-only: the plan may never generate a sell from size
  alone.** `SD_SINGLE_CAP`/`SD_CLUSTER_CAP`/`SD_MAX_LEVERAGE` are deleted — a dead constant reads as a
  live rule. What replaced them is a readout (each name >`SD_CONC_FLAG` 50% of equity, its −20%-day
  impact on the account, its vol-scaled stop) plus one factual AI/compute-complex line. Precedent for
  measure-but-don't-bind is `riskweights.mjs` `LOOKTHROUGH_ENFORCE=false`. The **Do-now TRIM** alert
  follows the same logic: it fires on size **AND weakness** (broken, or under `SD_MIN_SCORE`), never
  size alone — a concentrated *leader* is the mandate working. (c) **Reporting bases are UNCHANGED** —
  `netEq` (`total_value`) still denominates every percentage-of-equity, `sdLockedShares` still reserves
  covered-call collateral out of every sell path, and the wash-sale guard still binds. Only what BINDS
  and what is COLOURED moved. Two traps worth naming: both the plan's paydown table and the Do-now
  MARGIN alert must source from the **weakest-momentum** free shares (the alert originally named the
  *largest* position — i.e. it said "sell PLTR" while the plan's own table correctly said IREN; two
  surfaces naming different sells for the same loan is worse than either alone), and press room is
  **suppressed whenever a paydown is in flight**, since "you could borrow more" alongside "you are over
  your ceiling" is incoherent.
- **A GUARD THAT FIRES SILENTLY IS INDISTINGUISHABLE FROM A BROKEN SYSTEM (2026-08-25).** The churn
  governor, the PDT guard and the drawdown breaker are all *refusals* — they work by producing NOTHING —
  and none of them reached the phone. On 08-25 the owner added $1,400; the plan the 08-25 target called
  for was "exit JPM and GE, fund the defensive floor and the gold sleeve". Both exits were held at **day
  13 of the 14-day min-hold** (both names bought 08-12), so the sell leg came back empty, the deposit
  funded the buys on its own, and the ticket recorded five buys and no sells with the reason recorded
  nowhere. Every component behaved exactly as designed and the result still read as a failure. Three
  things generalize:
  **(a) The explanation has to live where the decision lands.** `planDeployment` returned `blockedSells`
  and a warning naming both tickers all along — `makeTicket` just didn't copy them, and `raw/` is wiped
  every run, so the analysis was destroyed within the hour. **If the planner computes a reason, the
  ticket must carry it**: the ticket is the only artifact that survives to the consumer.
  **(b) A surface built from the TARGET can only ever explain buys.** The Plan tab's blocked card
  derived every row from `target.names` — but an exit sells a name the target no longer contains, so a
  suppressed exit was *structurally* unrenderable there, not merely missing. When adding a "why didn't
  it act" surface, check that its data source can even represent the inaction you want to show.
  **(c) Deposits mask blocked sells specifically.** Buys are funded from `cash + proceeds`. With sells
  blocked, proceeds are $0 — so on a normal day the ticket is empty and nothing looks amiss, but new
  cash lets the buy leg proceed alone and the ticket reads as a deliberate buys-only decision. The
  deposit didn't cause the block; it made the block *invisible*.
  Fixed in v126 (ticket persistence + the "💸 Sells held back" half of the card). The min-hold itself
  was NOT loosened — 13 days is 13 days, and one-day-early exits are the churn this guard exists to
  stop. The exits fired on the 08-26 pass, as designed.
- **THE TWO ACCOUNTS' POSITION ARRAYS CAME BACK TRANSPOSED — AND ONLY THE RUNNING TOTAL WAS PERMANENT
  (2026-08-31).** Root cause of the wrong-account incident below: the producer's two
  `get_equity_positions` calls were made with the account numbers the wrong way round, so
  `data.agentic.positions` held ••••0741's five names and `data.main.positions` held ••••3900's twelve.
  **Each account's cash and totals were still correct**, which is why nothing downstream noticed —
  ••••3900's equity was then re-derived as `cash + Σ(the OTHER book × quotes)` = $31,800 against a real
  $11,551. **Three lessons.**
  **(a) Rank the damage by what can't be republished.** The visible harm (a wrong card, a $61,962 ticket)
  is undone by the next good snapshot. The harm that is NOT is `cumFlow`: the deposit inference saw each
  book replaced wholesale and booked equal-and-opposite phantom transfers of ±$20k, and
  `appendEquityPoint` reads `priorCum` from the point it is REPLACING (equityseries.mjs:220) — so a
  same-day rebuild inherits the bad total instead of recomputing it, and the error becomes the baseline
  for every future point. **A corrupted running total has to be repaired by hand; plan the fix around
  that, not around the display.** Worse, leaving the swapped positions committed guarantees a SECOND
  phantom flow, because the next run differences against them.
  **OUTCOME, and the residual left behind.** The 20:42Z run fetched both accounts correctly, and because
  the positions swapped BACK the inference produced the mirror-image phantom, which very nearly cancelled
  the first: agentic cumFlow 7,950.75 → 28,218.50 → **7,961.68**, main 0 → −20,247.65 → **+136.70**. What
  survives is the difference between the two runs' price moves — a phantom deposit of **$10.93** on
  ••••3900 and **$136.70** on ••••0741. Those are not cosmetic: the consumer's return is deposit-IMMUNE,
  so a phantom deposit silently DELETES real return (≈0.09pp at the step, and on the headline ≈0.34pp /
  ≈0.71pp once it compounds — measured 2026-09-01: ••••0741 reads −2.86% against a true −2.16%). They are
  **corrected by a one-time MIGRATION IN THE PRODUCER** (2026-09-01, `producer/cumflow-repair.mjs`), not
  by a hand edit — and the reason why generalizes. **No ordinary run can shed a corrupted running total:**
  `appendEquityPoint` reads `priorCum` from the point it is REPLACING, so every same-day rebuild inherits
  the bad value and it is the permanent baseline for every future point. But `data.json` is the
  PRODUCER's file, written once an hour through build-data → emit → validate → publish, so the fix
  belongs on that path: `repairPriorCumFlow(prior)` runs in `build-data.mjs` immediately after
  `loadPrior()`, before anything reads the series, which is what makes BOTH the `appendEquityPoint` path
  and the carry-forward branches see a corrected history from one call site. A hand-edited encrypted blob
  is reviewable by nobody and reproducible by no one; this is tested, committed and self-applying.
  **Three things are load-bearing.** (a) **Idempotence** — it runs on every future run, so each account's
  correction fires only while its anchor point still holds the EXACT bad value to the cent; a second pass
  returns the same array by reference. Firing twice would invent the mirror-image error it exists to
  remove. (b) **Exact equality, never a tolerance or a `>=`** — a genuine later deposit shifts the anchor
  off its expected value, and the migration must then do nothing rather than corrupt real data. (c) It is
  a **MIGRATION, not a guard**: the root cause is fixed separately in `snapshotsanity.mjs`, and this block
  plus its module should be **DELETED** once both accounts have logged `cumFlow migration applied`.
  Verified against the live snapshot before shipping: both accounts land on the corrected series and the
  next appended point carries `flow=0`, i.e. the correction propagates instead of being re-inferred.
  **(b) So the guard ABORTS the publish** (`snapshotsanity.mjs` → `accountsLookSwapped`, called from
  `build-data.mjs` before anything is written). Refusing to publish costs one stale hour and trips the
  freshness watchdog; publishing costs the account's whole recorded return history.
  **(c) It compares position IDENTITY, not dollars.** Reconciling `cash + Σ(positions × px)` against the
  account's own `total_value` looks tighter and false-positives constantly — an unquoted position prices
  at 0, which is routine for a brand-new target name. Comparing each fresh book against its OWN prior
  book needs no tolerance: books are stable across an hour, and a wholesale replacement of both, each
  matching the other's prior contents, is not something a market or a rebalance can produce. Fails OPEN
  below `SWAP_MIN_NAMES` (3). A one-sided wrong-account fetch of the AGENTIC book is fatal too (it is the
  book that trades); the mirror on the self-directed side is not, since aborting the publish over a
  display-only error trades a real outage for a cosmetic one.
- **THE PLANNER IS ONLY EVER AS RIGHT AS THE ACCOUNT IT WAS HANDED (2026-08-31).** A producer run
  published the **self-directed ••••0741 book into `data.agentic`** — equity $31,800 instead of $11,551,
  positions IREN/PLTR/TSM/CIFR instead of the twelve names actually held, and `weightNow: 0` on every
  target name. `agentic-deploy` then did its job perfectly on the data it was given and produced a
  **$61,962 ticket** (5× the book) to liquidate an account that held none of those names. **350 of those
  IREN shares back three short $50 calls in the margin book**, so approving it would have written naked
  calls on a levered account — the exact risk `sharesLockedByShortCalls` exists to prevent, reached by a
  route that guard never sees. This is the wrong-account failure the wash-sale ledger already learned
  once (five phantom losses, 2026-08-03); it recurs because **nothing downstream of the producer ever
  asked whether the book it was handed was the right account's.**
  **Three things generalize.**
  **(a) The one-tap tier needs a validity gate, not just a size gate.** `EXEC_PROPOSE` writes a ticket
  and pushes the owner a one-tap **before making a single live account call** — the live 5%-book-move
  abort (which would have caught this at 175% off) runs only in the placement path. A confirm step is a
  control only if what sits behind the tap has been checked; above the auto cap it was checked for SIZE
  and not for SANITY. The identity check now runs before any mode is printed.
  **(b) Check against records you WROTE, not against thresholds.** An equity-jump threshold cannot
  separate this from a real deposit (the 08-11 $5,000 was +43%). `snapshotHoldingsSanity` instead asks
  whether the snapshot contradicts `agentic-parked.json` and `agentic-decisions.json` — files this system
  authors and therefore knows to be true. Replayed over the 36 committed snapshots since 08-27 it blocks
  exactly one: the corrupt one.
  **(c) It had to be CODE, not prompt wording.** The executor Routine is bound to a persistent session,
  so its prompt cannot be edited — the same constraint already documented for the `target` requirement.
  For a persistent-bound Routine, anything load-bearing goes in the gate.
- **WIDENING A FUNDING POOL IS NOT THE SAME AS FREEING THE MONEY (2026-08-28).** `agentic-deploy`'s buy
  pool has been widened twice — sale proceeds in v98, the VTI waiting ground in v102 — and each widening
  adds a source whose availability is **conditional**. The v102 one counted the whole parked block as
  deployable, but the release that actually frees it is floored at `PARK_MIN` ($100), so a shortfall
  under the floor freed nothing while the buy had already been sized against it. Live: $485.99 parked,
  $0.90 cash, a $26.94 JNJ top-up needing $26.04 of release — an unpayable ticket that only the
  executor's live buying-power check stopped. **Three things generalize.**
  **(a) The dangerous part was the CORROBORATION, not the gap.** `buysNeedProceeds:false`, `cashLeft:0`
  and the warning "$0 left uninvested (eligible buys fully funded to target)" all independently asserted
  the plan was funded — because all three were derived from the same wrong pool. Agreement between
  figures computed off a common bad input is not evidence; it is the same error printed three times.
  Hence the explicit invariant (**spend ≤ cash + proceeds + an actual release leg**) rather than more
  derived indicators: an invariant is checked against reality, an indicator only restates the model.
  **(b) A floor on a trade must be inherited by whatever MOTIVATES that trade.** `PARK_MIN` exists
  because the tax and spread on a dust sale aren't worth it — and that judgement applies with identical
  force to a buy that can only happen by triggering one. `MIN_BUY` ($25) tested the buy in isolation and
  had no idea it required a liquidation, so $26.94 sailed through a floor designed to stop exactly this.
  When two floors govern two halves of one decision, they have to see each other.
  **(c) It failed in the safe direction and was still worth fixing immediately.** A rejected order places
  nothing, but the gate re-planned it hourly and never wrote a ticket, so the "identical proposal already
  outstanding" idle guard never engaged — a permanent false EXEC_AUTO that would mask a real one. A
  harmless bug that degrades a signal you rely on is not harmless.
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
- **Navigation & accessibility pass (v131) — the app got a bottom tab bar, a section rail, Find and
  My view.** Integrated from a Claude Design study (`Portfolio_App_Redesign.dc.html`), **taking its
  structure and rejecting its palette wholesale** — the study proposed a warm "Clay" ground with a
  `#c94b39` accent, and the owner's instruction was to keep Light ⇄ Gold exactly as they are. Nothing
  was removed: every card, chart, table and both account books are untouched, and the study's redrawn
  card bodies (pill/bar/meter/tile approximations of our real tables and Chart.js canvases) were
  deliberately NOT taken — they are a mock's stand-in for content we already render properly.
  - **The tab bar is FIXED TO THE BOTTOM**, one row, icon over label, 56px targets. It used to be a
    sticky TOP bar that **wrapped to two rows on a phone** (Analyze alone on row 2), costing ~150px
    above the fold before a single figure appeared — measured on the live app, the portfolio value
    began at y≈780 of a 900px screen. The active state is a top accent stripe, not the old dark
    "wealth" gradient pill: on a bottom bar a filled block reads as a floating button on the device
    chrome, and it also rendered dark-on-dark and unreadable in the light theme. **Two consequences
    are load-bearing.** (a) `body` carries `padding-bottom: safe-area + 74px`, or the last card hides
    behind the bar. (b) **The tab bar contributes NOTHING to `__pfTopOffset()` any more** — it
    obscures the page's bottom, not its top, so counting it there would push every jump ~62px past
    its target. See the sticky-geometry gotcha below, which this change rewrote.
  - **The section rail replaced the collapsible jump-nav.** v112 had made it a disclosure collapsed by
    default (`pf_nav_open`, `.card-nav-toggle`, `setNavOpen`) because expanded it wrapped to five
    lines and buried each page's first card — a real problem, but hiding the nav treated the symptom.
    One **non-wrapping row that scrolls sideways** costs the same ~40px the collapsed toggle did and
    is always usable, so the toggle, the preference key and `setNavOpen` are **gone** (nothing else
    read that key). An **Expand all / Collapse all** button leads the rail.
  - **`__navAll` must drive BOTH collapse mechanisms.** The app has two, and a control that knows only
    one silently acts on a fraction of the page: the generic enhancer wraps a card's content in a
    `.card-body` child, but **every card whose header already carried `.collapsible` owns its own
    toggle** — `data-toggle="<bodyId>"` on the title plus `toggleSection()`. Measured live on the
    Accounts tab: **10 collapsible cards, 1 of mechanism (1) and 9 of mechanism (2).** `bodyOf()`
    resolves either; the rail's label is computed from live state (`anyOpen`) rather than a stored
    flag, because individual toggles change the answer, so `toggleSection` also calls `__navSyncAll`.
  - **Find (🔍 in the freshness strip) searches every card on every tab** — title matches ranked ahead
    of body-text matches, Enter opens the first hit, and a result switches tab, expands the card and
    scrolls to it. **The hard part is that Markets, Options and Analyze render LAZILY**, so a search
    run before you have ever opened Markets cannot see one Markets card in the DOM. Two fixes were
    rejected: a hardcoded title registry drifts silently the moment a card is renamed, and eagerly
    initialising the hidden tabs would build **Chart.js canvases inside `display:none` containers,
    which size to ZERO** — the documented hazard behind the Plan tab's lazy render. So Find
    **remembers**: titles seen on a rendered page are cached per tab (`pf_card_titles`), and an
    unrendered tab contributes its remembered titles, labelled "not loaded yet". Self-healing, and
    the cross-tab jump **waits for the real render** (polling to a ~3s ceiling) before scrolling —
    scrolling early lands at the top of a page that then grows underneath you.
  - **My view** (`pf_pins`) pins any card from any tab via a ☆ in its header, and renders as **ONE row
    of chips, empty by default** — it appears on every page, so a taller block would tax every tab's
    fold to show something the reader never asked for. Pins are keyed by **card TITLE, not element
    id**: the rail regenerates ids (`navc-1`, `navc-2` …) on every rebuild, so an id-keyed pin would
    break on the next re-render. A pin whose card can't be resolved (renamed, or a tab never visited
    on this device) is **skipped, not deleted** — the preference is still valid, we just can't
    resolve it yet, and dropping it would lose the pin on one bad boot.
  - **▲/▼ on every percentage that renders through `fmtP()`** — the shared formatter behind the
    position tables, snapshot tiles, P&L columns and the account cards (29 call sites) — so colour is
    no longer the only carrier of direction there. **It is not literally every percentage in the app:**
    a few surfaces format their own (the Markets index/sector tiles print "+0.30% day" directly), and
    those were left alone because their own labels already carry the direction in words. Two rules it obeys:
    a value that ROUNDS to zero stays neutral and glyph-less (matching `sc()`'s `neu`; a "▲ 0.00%"
    would assert a direction the data doesn't have), and the **sign is kept alongside the glyph**
    rather than replaced by it. Verified safe: all 29 call sites render the string directly, all
    table sorting runs over data objects rather than cell text, and nothing parses `textContent`.
  - **ARIA:** `aria-expanded` on every collapsible card header (stamped once in the enhancer — the one
    place every card passes through — then maintained by both toggle paths), `aria-current="page"` on
    the active tab (the accent stripe is now the sole visual cue), `role="tablist"` on the tab bar, a
    labelled Find dialog, 44px+ targets, and `prefers-reduced-motion` honoured.
  - The freshness strip is now **sticky** (`position:sticky` in its inline `cssText`), so snapshot age,
    Find and ↻ stay reachable in a long page. `paintBar()` already set an opaque background on every
    repaint, which is what makes that safe. Analyze still shows no rail until a ticker is analyzed
    (the pre-existing `cards.length<2` rule).
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
  Performance card can't disagree; **since v119 the self-directed side reads its OWN
  recorded series the same way** (`data.main`, via the shared `acctYTDStats`), so both tiles report the
  account's real deposit-adjusted year rather than two different kinds of number; the modelled
  `__SNAP.perf.portYTD` remains only as the labelled fallback for the first day or two of recording
  (that fallback fills in on the *second* `renderSnapshot` call, after `renderPerformance` stashes
  `perf` — it shows a spinner until then, by design). The heatmap keeps **per-instance state** (`_hmS` keyed by suffix) so the
  two mounts' Day/P&L toggles don't move together. **Income & Tax is scoped**: `accountRollup(..., scope)`
  filters accounts, so the self-directed side keeps the all-account view + By-Account table while the
  agentic side shows only ••••3900 (no one-row table, its own harvest floor, options premium hidden —
  options are margin-only, and the harvest pointer targets the rebalance ticket, not the Action Center).
  Two cards are intentionally NOT duplicated because the agentic side already has a superset: **All
  Positions** (the Agentic Portfolio tracker is the same table plus target/drift/trade) and
  **Performance vs Benchmark** (Account Performance is the real, deposit-adjusted return).
  **The switcher is STICKY and lands you on the SAME section (v107).** `.acct-seg-wrap` pins the
  segmented control below whatever else is pinned at the top (`top: env(safe-area-inset-top) +
  var(--stickytop-h)`; measured live by `_syncStickyTop`), so accounts can be swapped from anywhere in the
  page. **That variable was `--tabbar-h` until v131** — the tab row wrapped to two lines on a phone, so a
  hardcoded offset would overlap or gap; the tab bar is now bottom-fixed and the **freshness strip** is
  what sits above the switcher. Still measured live for the same class of reason: the strip's text wraps
  to two lines whenever a staleness or update nudge is showing. `_syncStickyTop` re-measures on resize,
  on orientation change, and through a `ResizeObserver` on the strip (with timed retries as the fallback,
  since `boot()` may create the strip before or after that code runs). Swapping then **preserves the reader's section**: every paired card
  on both sides carries a `data-sec` key (`snapshot·holdings·performance·heatmap·risk·allocation·income·
  technicals·fundamentals·flow·rebalance-log`, plus the unpaired `smalls`), `_currentSec()` notes which
  one is on screen before the swap and `_landOnSec()` scrolls to its counterpart after — so comparing the
  two books' Risk or Income cards is one tap, not a scroll back to the top and down again. An unpaired
  section falls back to the nearest common one **above** it in `SEC_ORDER` (self-directed `smalls` →
  `fundamentals`). Three things here are load-bearing and were each a real bug in development:
  **(a) `__pfTopOffset()` must be built from HEIGHTS + the pinned element's resolved sticky `top`, never
  from live `getBoundingClientRect().bottom`** — a rect-based offset reads ~50px larger while the page sits
  at scroll 0 (nothing is stuck yet), so a scroll computed before sticking and judged after it disagreed
  with itself and landed every jump a section early. **v131 changed WHAT it measures, not how:** the tab
  bar moved to a bottom-fixed bar, so it obscures the page's BOTTOM and is no longer summed here (counting
  it would push every jump ~62px too far down); what remains pinned above the content is the **freshness
  strip** (sticky since v131) plus, on Accounts/Plan, the account switcher. Both can be absent — a
  decrypt-failure boot has no strip, and the switcher measures 0 on pages that don't show it — and both
  cases degrade to a smaller offset, which lands a jump slightly HIGH rather than hiding the card under a
  header. Verified live at 123px = strip + switcher + 8, landing a rail jump at exactly y=123;
  **(b) `_currentSec` picks the FIRST section whose bottom
  clears the header by `SEC_EDGE` (40px)** — "last card whose top is above the line" flips to the previous
  section exactly when the next card starts filling the screen, and "whichever card covers the most pixels"
  tips to the *next* section whenever the current one is short (a compact Allocation card handed you off to
  Income); **(c) the nav-chip `topOffset()` delegates to `__pfTopOffset`** — once the switcher became
  sticky, any jump computed off the top bar alone parks the target card underneath it — and since v131 a
  jump computed off the *tab* bar is wrong in the other direction, because that bar is at the bottom now
  (hence the rail's small fallback offset rather than a tab-bar measurement); **(d) the region
  ABOVE the first `data-sec` card is its own section, `SEC_TOP` (`'__top'`), which lands at scroll 0
  (v120)** — neither hero (nor the self-directed margin banner) carries a `data-sec`, so `_currentSec`
  used to answer `snapshot` for the whole top of the page, and switching accounts while sitting at the
  very top scrolled the incoming side DOWN to its snapshot tiles, **cutting the account balance off
  screen** — the reader had not scrolled at all, yet the app jumped. `_currentSec` now returns `SEC_TOP`
  whenever the first tagged card's top is still below `__pfTopOffset()`, and `_landOnSec` treats it as a
  successful landing at 0 (so the settle pass still holds the top while the incoming cards fill).
  First visit to a
  side also runs `_settleOnSec` (re-place for ~1.2s, cancelled by any real scroll input) because that
  side's cards are still filling in and everything above the target grows.
  **Both sides run the SAME card order (v106)** — hero → snapshot tiles → *holdings table* → *performance*
  → 🗺️ Heatmap → 🛡️ Risk → 🗂 Allocation → 💵 Income & Tax → 📡 Technicals → 📋 Fundamentals → 🏛️ Flow →
  pointer, where "holdings table"/"performance" resolve to each side's version of that card (All
  Positions / Performance vs Benchmark on the self-directed side; Agentic Portfolio / Account
  Performance on the agentic side) — then **🧾 Rebalance Log**, which since v127 trails Flow on BOTH
  sides (the agentic one graded from its executor's confirmed ledger, the self-directed one derived
  from the account's filled orders; `data-sec="rebalance-log"` is a paired section, so the toggle lands
  you on the other book's log rather than a neighbour). The self-directed 🧹 Positions Under $250 card
  remains a conditional extra (the agentic floor is `AG_MIN_POS`, so it can't apply there). **Keep the spine aligned when adding a
  card** — the toggle swaps the two containers in place, and a card that sits third on one side and
  eighth on the other makes the switch feel like a different app rather than the same view of a
  different account.
- **🧾 Rebalance Log — SELF-DIRECTED (v127, Accounts tab, ••••0741 side, after Flow):** the mirror of the
  agentic account's log, so the two books are judged on identical terms. One row per ET trading day —
  the trades, the dollar-weighted contribution since the fill, the same window's **alpha vs SPY**, and an
  ahead/behind/open verdict. Rows are DERIVED from filled orders rather than appended by an executor
  (there is none on this side — see `maindecisions.mjs`), and the card says so. 12 most recent shown, the
  rest behind a `<details>` expander; legs capped at `SD_LOG_LEGS` (8) per day with the remainder counted,
  because this book's real history contains a 60-leg near-total liquidation that would otherwise render as
  a wall of tickers. Deliberately **without** the agentic card's research-sleeve strip — there are no
  sleeves on a discretionary book, and rendering them would leak one mandate's rulebook onto the other's
  surface. **Both logs carry a ⏱️ Frozen outcomes strip (v129)** — each decision's alpha vs SPY measured
  AT 5/30/90 days and never re-marked — because the table itself marks everything to today, so without it
  more history never compounds into an answerable question. Earlier decisions are measured from the
  snapshot's own recorded daily closes, so the record starts full rather than empty; the ones whose price
  history doesn't reach the horizon (a name that left the book) are reported as unmeasurable rather than
  priced off a series that merely stops.
  **It briefly shipped on the Plan tab** (v127, same day), which read well beside Track Record —
  that grades the *screen*, this grades *what was actually done* — but split the same card across two tabs
  depending on which account you were viewing, and left `rebalance-log` an unpaired section so the toggle
  had nothing to land on. Owner's call: mirror the agentic placement, keep a pointer on Plan.
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
  **🎯 prediction-market strip (v132)** sits beside the options-premium one on the self-directed side —
  event contracts settle through Robinhood Derivatives and `get_realized_pnl` is per ASSET CLASS, so they
  are genuinely absent from the Realized tile and are reported as their own line rather than folded into
  it (reads `data.realized.predictionMarket`; hidden on the agentic side, which doesn't trade them), and a
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
  **⏸ What's blocked — and what clears it** (split in **v126** into two labelled halves: **🛒 Buys deferred** —
  every wash-sale / earnings / entry-band deferral, each with the date or condition that clears it, plus whether
  zones have gone advisory — and **💸 Sells held back**, read from `data.agentic.pending.blockedSells`, naming the
  guard, the trade it would have been and the unlock date. The sell half exists because the buy half is computed
  from the TARGET, and an exit sells a name the target no longer contains — so a suppressed exit was structurally
  unrenderable here, which is how a deposit-funded buys-only ticket came to look like a failure on 2026-08-25),
  **🅿️ The waiting ground**
  (`data.agentic.parked` — the VTI ledger), **📏 Guardrails** (the standing rulebook: cluster/vol caps,
  min-hold, re-entry cooldown, wash window, earnings blackout, entry band, drift trigger, auto tier, PDT,
  dust floor, idle-cash deadline, no leverage), and **🔁 How the loop runs**. The hero also carries a **📖 The whole plan** button (v123) → `openHelp('agentic-whole-plan')`: one plain-English walkthrough of the entire agentic model — the six sleeves, the adversarial verify, sizing + the correlation/vol/look-through caps, every reason a trade gets blocked, the drawdown breaker, the waiting ground, regime pacing, the tax treatment, and an explicit "what it will never do" list. Written for someone who has never seen the app, so it doubles as the thing to hand a person who asks how it works; it reuses the shared help modal (one `HELP` registry entry + one button — no new modal machinery). This exists because `parked`,
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
  and a **The-plan** tier (`renderActionPlan`).
  **⚡ v113 — the plan tier now runs the SELF-DIRECTED AGGRESSIVE MANDATE (`SD_*` constants).** The two real
  accounts run opposite mandates and this renderer used to ignore that: it hard-coded ONE objective (pull
  beta down) and drew its redeploy ideas from the producer's oversold mean-reversion screen. On a
  concentrated, 1.6×-levered AI/compute book that rendered as *"sell everything that's red, then buy low-β
  ballast + bonds/gold + three Brazilian value names"* — a de-risking plan running on the account whose
  whole purpose is high-beta growth. (••••3900 is the guarded, diversified one; **do not make this side
  imitate it**.) Three structural fixes, each of which was a live defect:
  **(1) Exits are a THESIS test, not the sign of P&L.** The old harvest filter was `pnlD<0 && val≥$250`, so
  in a levered high-beta book *everything* qualified on any red week. `sdBroken(sym,costPx)` now requires the
  50-DMA to have rolled under the 100-DMA **and** price to sit decisively below it, or a −25% stop breach.
  "Decisively" is **vol-scaled** (`buf = clamp(vol/8, 5%, 20%)`) — load-bearing, because a 114%-vol miner
  6% under its 100-DMA is inside its own noise, and without the buffer the rule fires on exactly the
  volatility the mandate exists to hold. (The producer's `trendGate` uses the 200-DMA; a YTD daily series
  can't reach 200 bars, so the 100-DMA is the long anchor here.) Red-but-intact = **hold**.
  **(2) Percentages are on EQUITY, not gross exposure.** With margin debt the two diverge enormously —
  IREN read "49% of exposure" while being **79% of what the owner actually owned**. Every percentage on
  this side is a fraction of equity (`st.totalVal`), which is also why v116/v118 had to fix the tiles.
  **v125 replaced the CAPS themselves with BANDS — see the gotcha below.** The v113 dials
  (`SD_SINGLE_CAP` 50% / `SD_CLUSTER_CAP` 80% / `SD_MAX_LEVERAGE` 1.60×) are **deleted**, not relaxed:
  margin posture is now `SD_UTIL_CRUISE` (**50%**) / `SD_UTIL_MAX` (**70%**) of the **credit line**, and
  concentration is a **readout that generates no orders** (`SD_CONC_FLAG` 50% of equity is a reporting
  threshold, never a cap). The only sells this plan emits are a **broken thesis** and, above the ceiling,
  a **margin paydown** sourced weakest-momentum-first. A name being exited is **never also paid down**
  — the old code put an over-cap loser in both tables and summed both proceeds, overstating the
  deployable pool by the entire value of those shares; the one-name-one-decision rule survives intact.
  **(3) The redeploy universe is a MOMENTUM lens, not the oversold screen.** `sdMomentum(sym)` (memoized per
  snapshot, reads only `data.hist.day` + `data.quotes`) scores 6- and 3-month **relative strength vs SPY**,
  trend state (px vs 50-DMA, 50 vs 100-DMA + slope) and **proximity to the trailing high** — the inverse of
  an oversold screen, which by construction cannot surface leadership. Weights renormalize over whatever
  components are present; under 2 it abstains. `SD_BENCH` is the curated aggressive universe (this side's
  counterpart to `producer/leaders.mjs`), tiered core/sat/asym. Pool splits per `SD_SLEEVES` —
  **30 core / 45 satellite / 15 asymmetric / 10 dry powder** (owner-set) — allocated **inverse-vol** within
  each sleeve, then clamped by `SD_SINGLE_MAX_X` (**60% of exposure**, v125) so no single BUY leg piles the
  whole sleeve into the leader. That clamp is a **sizing rule for new money, not a cap**: it shrinks a leg,
  it never sells anything, and the cluster clamp was dropped entirely (this whole book is one cluster by
  design — the 4/4/2 sleeve structure plus inverse-vol IS the diversifier).
  **No bond/gold sleeve exists on this side at all.**
  Two gates are non-negotiable: **`SD_MIN_SCORE` (5.0/10)** — without it a sleeve fills from whatever ranks
  least-badly in its tier, and the first live run wanted $1,492 of TSLA at **1.2/10** (−41pp vs SPY) purely
  because nothing better carried that tier; and the **staleness gate** (see Gotchas). An empty sleeve's
  weight **cascades up** (asym → sat → core) and anything still unfilled stays dry powder — "there is no
  leadership to buy today" is a legitimate answer and a far better one than a bad fill.
  **(4) Covered-call collateral is reserved (v119).** Nothing in this plan knew the account had sold
  calls, so it happily sized exits and cap trims over shares that were collateral — selling them turns
  a covered call NAKED. `sdLockedShares()` (mirrors the producer's `sharesLockedByShortCalls`, pending
  sell-to-opens included) caps every sell at the free count, flags a partially-capped trim, lists a
  broken-but-fully-pledged name as blocked with buy-back/roll named as the way out, and adds a
  standing guardrail. The Do-now MARGIN alert picks a sellable paydown candidate for the same reason.
  **Wash-sale guard (new on this side):** `sdWashMap()` reads `data.agentic.recentLosses` and deliberately
  does **not** filter by account — the IRS window is per *taxpayer*, so a loss booked in ••••3900 blocks a
  rebuy here and vice versa. Blocked names are dropped from every buy ticket with the clear date shown.
  Step 3 guardrails are rewritten for this mandate: leverage ceiling, equity-based name/cluster caps,
  vol-scaled stops on every satellite, the **house-money rule** (`SD_HOUSE_MONEY` 2× → sell the cost basis
  and let the rest run), never add to a broken trend, and earnings-gap sizing. Concentration figures are
  reported over what you'd still **hold** (a name being exited wholesale is not "your largest position").
  Buys that coincide with a vetted pick still populate `window.__PLAN_ADDS`, so the Top-3 cards keep their
  "🧭 the plan picked this" badge. (v113 removed the now-orphaned `pickLevels`, `synthPickFromCandidate`
  and `jumpToPick` helpers along with the retired picks-backfill sleeve.)
  The **`PLAN_*` constants remain** — they are still read by the agentic heuristic-target fallback, and are
  NOT this side's rulebook any more. (The old producer-driven **⚖️ Trim/Add** card was retired in v56 — the
  Do-now feed + this plan own trim/add now; `PICK_TRIM`/`PICK_ADD` still load but aren't rendered.) **The recommended portfolio is a standalone _Agentic Portfolio_ card** (v67 — formerly Step 4 of the Action Center; built by `renderAgenticCard()`. **Moved in v99** off the Plan page onto the Accounts tab's Agentic side, together with the Rebalance Log — the Plan page keeps a pointer card in their place, and `paintActionCenter()` still repaints them from `__SNAP` whenever that page exists.) It is the blueprint for the **agentic account (••••3900)**, no longer a restructuring of the margin book. **Its target is the weekly deep-research output** (`data.agentic.target`, read from `producer/agentic-target.json`; v68) so the card shows drift vs. the REAL deployed basket; **only when that's absent** does a fallback heuristic build a from-scratch, long-only, **UNLEVERED** target from a **fully-independent universe** — top scored picks ∪ a mega-cap **LEADERS** bench (`producer/leaders.mjs` → `data.leaders`, hardcoded fallback) ∪ an SPY/QQQ index core ∪ **whatever ••••3900 already holds** (the margin account is ignored). Sector-diversified (≤4/sector, `TOTAL_CAP` 15, `ADD_SLOTS` ≈ `max(3,12−heldCount)`), conviction-weighted (3.5% floor, `PLAN_SINGLE_CAP` 25% ceiling), normalized to 100%, and **sized to the account's own equity** (`data.agentic.equity` = cash + positions; book = equity, i.e. 1× — no leverage: limited margin grants instant settlement only, never borrowing). **Unified single tracker (v91 — replaced the old target-table + separate "Your holdings — performance" table, which duplicated every held name across two tables).** One table iterates **what ••••3900 ACTUALLY holds** — one row per holding carrying its **Position ($/% of book)**, **trailing performance** (Day % from the live quote's prior close / YTD % off the `data.hist.day` daily-bar series, — until bars are captured), **unrealized P&L ($/%)** (cost = avgCost×qty), and the rebalance **Trade (±sh ≈ $)**. A **Total** footer rolls up value-now/+cash, value-weighted Day & YTD and aggregate P&L. **Held names NOT in the target ("orphans")** still appear in this table (flagged `off-target`, trade = trim-to-exit); the **`VTI` parking vehicle is exempt** and renders as `waiting ground` / `parked` / hold (v108 — the card used to call it an orphan and put "EXIT — SELL ALL VTI" in the hand-off, contradicting the planner's exemption that stops an infinite park→liquidate→park churn loop). **v109 slimmed the card to the BOOK:** the **Target % / Drift** column, the **TP/Stop** sub-line under Trade and the **"🎯 Targets to open"** strip were all removed — the Plan tab's Agentic side (v108) owns the target, its entry zones, its stop/TP and its per-name status including over/under-by-Xpp, so keeping them here was the same numbers in two places AND the extra width pushed the genuinely account-side columns (P&L, Day/YTD) off a phone screen. What remains is what only the book can answer, plus the Trade cell, since that is what the hand-off button actually places; an intro line links across to the Plan tab. When the account holds nothing (all cash) the table is replaced by an info line pointing there. It reads **`data.agentic`** (the account's real cash + positions — emitted by `build-data.mjs` from the producer's `agentic-portfolio.json` / `agentic-positions.json`, carry-forward like realized/options); until that snapshot lands it shows **target weights only**. Brackets (`tpOf`/`stopOf`) are **monitor-only** — fractional positions can't carry resting GTC stops. The **🤖 hand-off button** carries a deploy/rebalance prompt that targets ••••3900 with **fractional dollar-market** orders (review_equity_order → confirm → place). **Wash-sale guard (v91):** the card reads `data.agentic.recentLosses` (the inferred realized-loss ledger build-data maintains) into a `washMap` and, for any target name with a realized loss **inside the last 30 calendar days**, replaces its **Trade** cell with a "⚠️ wait · wash-sale (to {date})" badge, drops it from the deploy hand-off's BUY list (moving it to a **"DO NOT BUY YET"** section with the clear date), and shows a **Wash-sale hold** note below — the target *weight* is unchanged, only the execution is deferred. The 30-day taxable-account rule pairs with the 10-trading-day cooldown on the research picks screen (the user's "both, per surface" choice). (The old margin Step 4 — leveraged to `equityBase + marginUse`, anchored to current margin holdings — was removed from `renderActionPlan`, which is now Steps 1–3 only.) **Execution-discipline deferrals (v93):** alongside the wash-sale guard, the card now defers a BUY (target weight unchanged, buy held back + left out of the hand-off, with an amber badge in the Trade cell and a note) when a target name is inside a **~7-day earnings blackout** (`azEarn` — wait for the print) or has **gapped through its entry/stop** (at/below stop = broken; below the planned entry zone = re-verify, e.g. a name that sold off after earnings). Mirrors `producer/agentic-deploy.mjs` so the card and the producer's rebalance ticket agree. **v104 mirrors the v102 band:** the entry check is symmetric and toleranced (±2.5% under the floor / 2.0% over the ceiling), adds an **`above-entry` deferral** ("⏳ wait for pullback" — nothing guarded that side before, so a target whose zones sat below spot would have been bought straight through), and goes **advisory when the target's `asOf` is >7d old** (the card says so explicitly), since a whole target reading out-of-band at once is stale zones rather than broken companies. `below-stop` stays absolute. **v122:** the hand-off's BUY leg is also gated on **`data.agentic.drawdown`** (soft/hard ⇒ buys listed ON HOLD in the prompt + an amber note on the card; sells untouched) — mirrors the planner's breaker so the card can't offer buys the executor refuses. **v96 — the hand-off is FULL-BOOK + tax-aware:** off-target orphans are explicit **"EXIT — SELL ALL"** lines (losses first, each with an est. ST gain/loss tag via `estPl`/`orphanPl`), trims carry the same tag, an **"Est. short-term tax impact"** line nets the ticket's gains against harvested losses (with a cross-account wash caveat), and the sequencing (sells first → their proceeds fund the buys the same session, once they fill — v98 limited margin) is spelled out, along with the PDT rule that nothing bought today is sold today — mirroring the planner. A **🤖 Rebalance-in-flight strip** renders whenever `data.agentic.pending` carries a live executor ticket (id · status · legs · turnover · est ST net · what happens next). A sibling **🧾 Rebalance Log** card (`renderAgenticLog`, reads `data.agentic.decisions`) grades every confirmed deploy/rebalance vs what happened next + vs SPY (ahead/behind/open) — the account's own track record. **The whole loop is now self-driving (v96):** a separate hourly **executor** trigger (AGENTIC.md §executor — `agentic-exec-gate.mjs` → `agentic-pending.json` state machine) exits/harvests/rebalances unattended within the owner-approved **$10,000/ticket auto tier** (raised from $1,000 on 2026-08-25) and pushes one-tap proposals above it, with tiered TLH (losses-first on every sell + opportunistic harvests ≥ max($75, 5% of cost)).
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
  A pointer card under Track Record links to the **🧾 Rebalance Log** on the Accounts tab (below).
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
  **v119 corrected the money units and the collateral rules** (see Gotchas): position/order premiums
  are no longer 100×/÷contracts off, a short credit no longer inverts the breakeven, your own
  contracts' live greeks/P&L/IV actually populate (the `instrument_id` keying bug), covered-call and
  collar ideas are only offered on shares NOT already backing a short call, and `options-build` now
  warns when a held contract has no live quote instead of rendering a blank card. **Robinhood
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
- **Table readability (v97):** the three wide scrollers (All Positions `#pos-table`, Picks `#picks-table`, the Agentic holdings table `.sticky-first`) pin their **first (ticker) column sticky** while the rest scrolls sideways — opaque per-theme background (`--sticky-bg`, gold override) + a soft edge shadow, so rows stay identifiable mid-scroll. The Picks table is **ticker-first** (was Score·#·Ticker) and the Agentic table's **Target/Drift sits next to Position** (allocation read side-by-side, perf after). `fmtP`/`sc`/the agentic `pctCell` are **display-zero aware**: a value that rounds to 0.0% renders neutral gray, never a red "-0.0%" (the weekend quirk) — and v131's ▲/▼ glyph obeys the same rule, so a display-zero stays glyph-less rather than asserting a direction the data doesn't have. `thead th` contrast bumped (#9ca3af→#6b7280, light theme).
- **Freshness bar (STICKY since v131):** shows the snapshot label/age and **tints amber with a "↻ to
  refresh" nudge when the snapshot is ≥3h old** (computed from `data.generatedAt` in `boot()`); also hosts
  the **🔍 Find** button (v131), the build version,
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
