# Architecture: producer/consumer split, data flow, which Routine runs what

> **ARCHIVE / REFERENCE — not default context.** Moved verbatim from the repo-root `CLAUDE.md` on 2026-11-18 (docs/process-only PR). Nothing here was rewritten. Where this text conflicts with the root `CLAUDE.md`, the root file wins: it holds the current ACTIVE RULES. Labels used there: ACTIVE RULE / CURRENT STATE / HISTORICAL / UNVERIFIED.

> Load when a task touches the producer, `run.mjs`, preflight, fetch rows, the executor or a scheduled Routine. Routine ids, crons and models below are HISTORICAL snapshots — re-check live with `list_triggers`.

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
   **On FETCH_ALL the historicals + bench-quotes symbol lists are no longer hand-computed (v141):**
   the agent runs **`node producer/hist-plan.mjs`** and fetches exactly the batches it prints —
   `hist-day-tail-<n>.json` (8 symbols, ~7 bars each) · `hist-day-full-<n>.json` (≤3 symbols, YTD,
   capped 30/run) · `hist-month-<n>.json` (≤3, capped 15/run) · `quotes-bench-<n>.json`. That
   replaces the "top 15 holdings by value + market symbols" rotation, which is why 142 of 191 daily
   series were stale on 2026-09-08.
4. Agent runs **`node producer/run.mjs "<label>"`** — the single deterministic tail: optional AV
   fetch → optional **ext-fund fetch** (Finnhub/FMP supplementary fundamentals — since v141 over the
   whole **Analyze bench**, Finnhub daily and FMP on a 45/day least-recently-refreshed rotation) →
   optional **flow fetch**
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
   owner a rebalance proposal** (places nothing — alert, then the owner's confirm). Fault-isolated like step 5;
   never gates the publish. See `AGENTIC.md` / `PRODUCER.md` step 7. Adds no Robinhood writes (reads only).

## The agentic loop — which Routine exercises what (2026-08-24)
Four scheduled jobs drive ••••3900, and **a feature only works if the Routine that runs it knows about
it.** That is not automatic: a Routine's prompt is stored server-side, not in this repo, so shipping code
here does NOT update it. This table is the map; re-check it whenever a piece is added.

> **MANDATE A (2026-09-08) touched three of these four.** The **weekly research** Routine's prompt is the
> one that must change with it — it feeds the pipeline the universe and the args, and its synthesis step
> is where "12-15 names / SPY 15-20% ballast / a 15% defensive floor" lived. It is `meta_mcp` but
> SESSION-BOUND, so `update_trigger` refused the edit (gate 2, below) — it was **REPLACED the same day**:
> the live Routine became `trig_01UcxmEScHtoVU3yrGFJ1wiL`, created from this repo's paste-ready text with
> the Mandate A prompt, and the old `trig_01YRmfzy…` was disabled. **That one lasted ONE fire** — its bound
> session died and it was replaced AGAIN on 2026-09-09 by the fresh-session `trig_0114s3r8yBA7rQXLsBY7MG1y`
> (see the 2026-09-09 gotcha); the prompt text is unchanged apart from step 0. Do the prompt change in the same change
> as any code edit here, by replacing when editing is refused, or the change is inert on the next run —
> the 2026-08-25 leaders-bench lesson. The **executor** picks up the relative
> breaker and the deposit tranche automatically (both are code-side, in the gate and the planner). The
> **producer** needs no prompt change at all: deposit tranching reuses `cashIdleDays`, which build-data
> already stamps. Nothing here changes what is FETCHED.

| Routine (cron, UTC) | What it runs | v121 pieces it carries |
|---|---|---|
| **Portfolio dashboard refresh** (`35 * * * *`) | `preflight` → fetch → `run.mjs` | fetches **VIX every run** (light + full) → `data.vix` (regime); `build-data` emits **`data.agentic.drawdown`**; `alerts.mjs` pushes the **drawdown tier change** through the existing post-publish push. **v127** added one EVERY-RUN fetch row to its prompt — `get_equity_orders` on ••••0741 (`state:"filled"`, 120d) → `raw/main-orders.json` — which is the ONLY source of the self-directed Rebalance Log. Drop that row and the card renders empty with no error anywhere: build-data logs a warning and carries forward, exactly as designed. |
| **Agentic research** (`12 23 * * 0` — Sunday 23:12 UTC since 2026-09-15, was `12 11 * * 1`; fires weekly, `agentic-due` gates it to a FORTNIGHT since 2026-09-24, so the off-week fire prints NOT_DUE and stops; live Routine **`trig_0114s3r8yBA7rQXLsBY7MG1y`** since 2026-09-09 — **fresh session per fire, `claude-opus-5`, push on, step 0 shallow-clones like the executor; Robinhood + Alpha Vantage AND the repo as its source must be set on it in the Routine UI** — Mandate A prompt, the paste-ready copy in `SCHEDULING.md` §5 IS its text) | `agentic-due` → `agentic-research` workflow → **`finalize-target.mjs`** | **Its history is three config failures, not one.** Created 2026-09-02 with no connectors and no repo source, so it had NEVER RUN THE PIPELINE — every `agentic-target.json` in git came from an interactive session while the Routine logged SUCCEEDED weekly. "Fixed" the same day by **BINDING it to an interactive session that held the connectors** (inheriting them, since `create_trigger` rejects a `connectors` parameter in this org); that produced exactly two targets (09-02, 09-07) and then the bound session went idle-blocked on a question, its container was reclaimed, and the 09-09 fire fell through to a **connector-less, repo-less Sonnet fallback run** that stopped at step 0 (see the 2026-09-09 gotcha). Now the executor's shape, which has been working since 09-08. It carries the **look-through cluster caps**, the two-strike phase-out, the **`drivers[]`** tags every downstream attribution depends on, the (v124) **defensive floor** (a measurement only since Mandate A set `AG_DEFENSIVE_MIN` to 0), the (2026-08-25) **challenger quota**, and the (2026-08-25) **verdict-derived entry bands** (relative to the cohort median since Mandate A). The last three depend on what this Routine FEEDS the pipeline, so its prompt carries four specific instructions: build the universe from **`node producer/research-universe.mjs --symbols`** (NOT `leaders.mjs`); **never seed it from the Daily Picks** (that composite is 20% social — self-directed only); use **`research-universe.mjs`'s sector labels, not Robinhood's** (RH files REITs under "Finance" and GE under "Electronic Technology", which breaks the max-2-per-sector budget); pipe the **WHOLE workflow return** through `finalize-target.mjs`, since its `ranking` array carries the px/hi/lo both the vol gate and the entry bands need; and since the (2026-08-25) **gold sleeve**, `--symbols` appends **GLDM** so the batch fetch prices the injected diversifier row — drop it and the sleeve lands with no entry/stop. **v126** added two more to the prompt: re-check `target.dropped` after any SECOND finalize run in a session (the erase-on-re-run bug), and report a name absent from both `names[]` and `dropped[]` as a BUG; plus, when the target drops a HELD name, say in the push that the exit may be held by min-hold/PDT and give the unlock date. See PRODUCER.md step 7.2. |
| **Agentic executor** (`20 14-20 * * 1-5`; the fresh-session `trig_01Cy4shsbcDMX2HKvCLXrJos` went LIVE 2026-09-08 once the owner attached Robinhood in the UI, and the persistent one was disabled the same day — its step 0 fetches **`--depth 1`**, which is load-bearing, see the git-history gotcha) | `agentic-exec-gate` → ticket state machine | consumes the **drawdown** + **regime** reads; `makeDecision` stamps **sleeve drivers**; the v126 **`blockedSells`/`warnings`** ride onto the ticket. **A fresh-session-per-fire replacement was created 2026-09-02 (DISABLED until the owner attaches Robinhood to it in the Routine UI, then enables it and disables the persistent one)** with push notifications on — it had been bound to ONE persistent session since 08-10 (128M cached tokens / ~$74 over ~115 mostly-idle fires, and eventually stuck blocked on a question about a *different* Routine), which also meant it could not push, so "say what failed" always became a chat message. **Its prompt IS editable now** (see below); the code-level guards stay as belt and braces — `blockedSells` comes free from `makeTicket`, and `makeDecision` warns on a missing `target` or `spyAt`. |
| **Flow burn-in decision** (one-shot 2026-09-02) | evaluates whether `FLOW_WEIGHT` earns 0.10 | reads the **sleeve attribution** roll-up; knows the 2026-08-24 insider fix **reset the burn-in clock** |

**A Routine's prompt IS editable — use `update_trigger` (claude-code-remote MCP), don't work around it.**
Prompts live server-side, so shipping code here does not update them; but `list_triggers` + `update_trigger`
edit them in place, keeping the Routine's id and run history — **but only for a Routine an agent CREATED.**
**THERE ARE TWO INDEPENDENT GATES, and a prompt is editable only when BOTH pass (corrected 2026-09-08 —
this entry has now been wrong in both directions, so TEST the edit rather than reasoning about it):**
1. **`created_via` must be `meta_mcp`** (agent-created). **`http_api` = made in the claude.ai Routine UI =
   `update_trigger` REFUSES it** (*"Agents can only update routines they created"*). Seven of the eight
   Routines here are `meta_mcp`; the single `http_api` one is **"Portfolio dashboard refresh"** — the
   hourly producer, i.e. the most important of them — so its prompt is the owner's to paste in the UI.
2. **The Routine must not fire into a session that isn't yours.** A Routine bound to an interactive
   session can only have its prompt edited from INSIDE that session; from anywhere else the API answers
   *"editing the prompt of a routine whose fires deliver into a session that is not your own is not
   available via this tool."* This blocks **"Agentic weekly research refresh"** (bound since 2026-09-02),
   even though it IS `meta_mcp` — **and it blocks the Routine's own CREATOR too** (tested 2026-09-08: a
   Routine created seconds earlier from this session was refused the same way).
   **THE WORKAROUND IS REPLACE, NOT EDIT.** Gate 2 blocks *editing* a session-bound prompt, but not
   *creating* a new Routine bound to that same session — which is exactly how the bound one was made. So:
   `create_trigger` (same cron, same `persistent_session_id`, the new prompt) → `update_trigger` the old
   one `enabled:false` and rename it "retired … replaced by <new id>" → verify with `list_triggers`. Done
   on 2026-09-08: the live research Routine is now **`trig_01UcxmEScHtoVU3yrGFJ1wiL`** (Mandate A prompt),
   `trig_01YRmfzy7YD3P44PbwCoQD2m` is disabled. Two things to carry: get the prompt right BEFORE creating
   (the first replacement dropped step 0's `cd /home/user/portfolio-dashboard &&` and had to be deleted and
   re-created, since it could not be edited either), and a session-bound Routine reports NO `last_run` in
   `list_triggers` — its `last_fired_at` (in the full trigger record) plus the artifact commit are the
   evidence it ran (09-07: fired 11:21Z, `agentic-target.json` committed 12:07Z).
   **The same replace recipe was used a second time on 2026-09-09 — but the replacement is NOT bound to a
   session any more.** Binding was the connector workaround, and it is what failed (gotcha below): the new
   `trig_0114s3r8yBA7rQXLsBY7MG1y` is `create_new_session_on_fire`, model pinned via `update_trigger`, push
   on, and — because the API still rejects `connectors` (re-tested that day) — the owner attaches Robinhood +
   Alpha Vantage to the Routine in the claude.ai UI, exactly as for the executor. A fresh-session Routine's
   prompt IS editable from any session (gate 2 no longer applies), so the next prompt change is an
   `update_trigger`, not another replacement.

The 2026-09-04 revision of this entry asserted that `created_via` was the whole story and that the
session-bound research Routine "edits fine" — that was never tested, and it is false; the attempt was
made on 2026-09-08 (Mandate A) and refused. Schedule, name and enabled state still change freely on both.
**The durable lesson is the one that survived every revision: put anything load-bearing in CODE, never in
prompt wording.** Mandate A is the worked example — the mandate lives in constants
(`AG_DEFENSIVE_MIN`, `AG_DIVERSIFIER_MIN`, `drawdown.mjs`, `finalize-target.mjs`), so the weekly Routine
emits a Mandate-A target on its next fire whether or not its prompt was ever updated; only its own
sanity-report wording went stale — and that was then fixed the same day by REPLACING the Routine (above). `SCHEDULING.md` §5 keeps paste-ready text for BOTH prompts (the producer's, which only the UI can set, and the research one, which a session can re-create). What is NOT editable from a session, for any of them, is the
**connectors and `allowed_tools`** — Routine-UI only; see `SCHEDULING.md` §5, which also keeps the producer
Routine's paste-ready prompt under version control since a session can't write it. Getting this wrong is
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
- **The executor Routine's prompt IS editable — that claim was wrong, and it was wrong for weeks.** This
  bullet used to say it "genuinely cannot be edited" because the Routine was bound to a persistent session.
  The trigger was updated on 2026-08-31 (the enabled flag), and a **fresh-session-per-fire** replacement
  with a corrected prompt was created 2026-09-02 (disabled until Robinhood is attached to it in the UI), so
  the prompt is no longer frozen by the binding. Its prompt still says only "`makeDecision`,
  with `spyAt`" — fix it there, and **keep every code-level guard anyway**: the exec gate writes `target`
  into `raw/agentic-plan.json`, `AGENTIC.md` step 3e carries a blockquote that overrides the prompt, and
  `makeDecision` **logs a loud warning** when it is called with trades but no `target` or no positive
  `spyAt`. The general rule survives the correction and is the more useful half: **prefer a code guard to
  prompt wording for anything load-bearing**, because a prompt is server-side and drifts out of sight of
  this repo. What genuinely CANNOT be set from a session is a Routine's **connectors and `allowed_tools`**
  — those are Routine-UI only (see the 2026-09-02 gotcha).

