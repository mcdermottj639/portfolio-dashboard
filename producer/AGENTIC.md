# AGENTIC.md — Agentic cash account (••••3900) automation & rebalancing

How the **agentic cash account** is researched, targeted, monitored, and rebalanced. Read with
`CLAUDE.md` (architecture) and `SCHEDULING.md` (how the producer is scheduled — same web-trigger model).

## What this account is
- **••••3900 "Agentic"** — an **individual CASH account**, the only one with `agentic_allowed: true`
  (the agent can place orders here; the other three accounts can't). Confirm with `get_accounts`.
- **Cash account ⇒ taxable, unlevered, settled-cash-only.** Every sell is a taxable event; there is no
  margin; proceeds settle **T+1** and can't be reused before settlement (good-faith / freeriding rule).
- Fractional + dollar-based market orders fill **regular hours only**; **fractional positions can't carry
  resting GTC stop orders** — stops/targets in the target are **monitor-and-alert**, not resting orders.

## The target is research-driven (`producer/agentic-target.json`)
The recommended portfolio for this account is **not** the cheap oversold-picks heuristic — it's the output
of the **deep multi-factor research** (`.claude/workflows/agentic-research.js`): momentum / quality /
growth / catalyst sleeves + a valuation factor → composite → sector-cap → **adversarial verify** (refute
each finalist) → synthesis into a sector-diversified, conviction-weighted, capped allocation.

- The committed `producer/agentic-target.json` is the **canonical target**. `build-data.mjs` reads it every
  run and attaches it as **`data.agentic.target`**; the **Agentic Portfolio card** (`renderAgenticCard`)
  renders drift against it (falling back to a live heuristic only if the file is absent).
- Shape: `{ asOf, method, book, driftTriggerPp, names:[{ticker,sector,weightPct,entry,stop,target,thesis}] }`.

## Cadence (who updates what, when)
| Item | Cadence | Mechanism |
|---|---|---|
| Account **values / drift** (card `Now`) | **every ~30 min** (each producer run, market hours) | re-priced every run from that run's quotes — in step with the main account (carry-forward re-pricing in `build-data.mjs`; the 8 holdings are index/leader symbols quoted every run) |
| Account **holdings** (share counts) | **daily** (full/open run) | re-fetched via `agentic-portfolio.json` / `agentic-positions.json` (resolved through `get_accounts`); they only change on a rebalance, which refreshes them in-session anyway |
| **Target** (`agentic-target.json`) | **weekly** | the deep research workflow (below) re-runs, and the new target is committed |
| **Rebalance execution (v96)** | hourly gate, market hours | the **executor** (below): auto ≤ $500 turnover, push + one-tap confirm above; in-flight ticket in `agentic-pending.json` |
| **Event triggers (v93)** | every run (deposit / earnings gap) | `agentic-triggers.mjs` (in `build-data.mjs`) → `raw/agentic-triggers.json`: a **`deploy-cash`** push when idle/new cash crosses ~5% of book, and a **`refreshResearch`** flag that runs the research EARLY (before the weekly gate) on a deposit or a ≥6% held-name gap. So the account reacts to deposits + earnings, not just the 7-day clock. |

## Execution policy — **TIERED AUTO** (owner-approved 2026-08-07; supersedes confirm-everything)
The owner signed off on a two-tier policy so the account is **self-sufficient** for routine upkeep:
- **Auto tier:** a ticket with **turnover ≤ `AUTO_TURNOVER_CAP` ($500)** may be executed **unattended**
  by the executor (below) — placed, logged to the decision ledger, and reported by PushNotification
  *after* the fact. Routine drift top-ups, small TLH harvests, deploying a modest deposit.
- **Confirm tier:** anything larger (a full restructure, a big deposit) goes out as a **push + one-tap
  confirm** — the ticket sits in `agentic-pending.json` as `proposed` until the owner confirms (in any
  session: "confirm the pending rebalance") or it goes stale (5 days → re-planned at fresh prices).
- **Kill switch:** `PF_AGENTIC_AUTO=off` in the executor's environment idles the whole executor.
The trade-safety classifier still applies — the executor always names exact tickers + dollar amounts
when placing, and the auto tier never exceeds the cap the owner approved.

The ticket is built by the pure **`agentic-deploy.mjs`** planner (`planDeployment(...)`), which enforces the
tax/reg rules below AS EXECUTABLE CODE (not just prose) and defers — never silently drops — any name it
can't cleanly buy:
- **Earnings blackout:** never deploy NEW money into a name inside **~7 days** of its earnings report — a
  pre-print overnight gap can erase the edge. Wait for the number, then buy with full information.
- **Gap-through-entry re-verify:** a name **at/below its target stop** is a broken setup → defer; a name
  **below its planned entry zone** (e.g. it sold off after earnings, like GOOGL post-7/22) has a thesis in
  question → defer for a fresh look, don't reflexively "buy the dip".
- **Policy blackout (v95):** the same rule for a **scheduled policy decision** — a tariff ruling, PDUFA date,
  appropriations vote or antitrust judgment inside ~7 days, read from `producer/policy.json` via `policy.mjs`.
  Only `impact:"high"` events defer (a comment-period close is context, not a reason to sit out), and those
  require a source URL. The calendar ships **empty** and is maintained by the weekly research agent, so this
  is a no-op until events are added.
- **Wash-sale / settlement:** skip a rebuy inside the 30-day loss window; deploying new cash needs no sells,
  and any required trim is sequenced first + flagged T+1 (cash account, no freeriding).
Deferred names keep their **target weight** — only the buy waits. The consumer's Agentic card shows the same
deferrals as amber badges so the card and the ticket always agree.

**v96 — the planner is FULL-BOOK** (it used to see only target names, which once left 40% of the book
sitting in names the research had dropped, with no ticket):
- **Off-target exits:** a held name absent from the target is an explicit **SELL-to-exit** — the research
  dropping it IS the sell signal; the proceeds fund the underweight target names.
- **Tax-aware ordering + estimates:** every sell (exit/trim/harvest) carries an est. realized ST P&L; the
  combined `sells` list is **losses-first**, and `taxSummary` nets the ticket's gains against its losses.
- **Tax-loss harvesting (owner-approved):** *harvest-on-sells always* (loss lots go first whenever we're
  selling anyway) **plus opportunistic**: a held target name underwater ≥ **max($75, 5% of cost)** is
  harvested whole (position-level — the MCP can't select lots), wash-blocked from the buy legs, and its
  target weight sits underweight until the 30-day window clears.
- **Cross-account wash guard:** the IRS window spans accounts and the **margin book trades the same names**
  — pass `crossActivity` (recent margin-account buys); a loss-sale on a name the other account bought
  within 30d gets its harvest **skipped** (no benefit) or its exit flagged `washRisk`. The gate can't see
  margin orders, so **the executor fetches `get_equity_orders` on the margin account live** before any
  loss sale (step 3 below).
- **Two-leg T+1 ticket:** `buys` (settled cash, today) vs `buysT1` (funded by sale proceeds, next session).

## Flow & Positioning sleeve — in BURN-IN (v95)
The research has a fifth sleeve (**flow**: analyst revision momentum, insider Form 4 clusters, earnings
surprise, federal contract awards — `producer/flow.mjs`, surfaced on the Plan page's 🏛️ card). It is
**switched off**: `FLOW_WEIGHT` in `.claude/workflows/agentic-research.js` is `0`, so the composite is
byte-identical to v94's and a name with no flow read is never penalised for the silence.

`FLOW_WEIGHT` gates **every** path from flow data into the allocation — the composite, the sleeve line and
notes in the adversarial verify prompt, and the sleeve scores handed to synthesis. At 0 the layer is
genuinely inert. This matters: if flow leaked into the model's judgment while nominally "off", the
burn-in would not be a control and there would be no clean before/after to evaluate at the decision point.
(Verified by running the workflow with stubbed agents and asserting no flow string reaches any prompt.)

The owner signed off on it taking **10%** *after* a **4-week display-only burn-in**, so the signal can be
judged on real accumulated data first. To switch it on: set `FLOW_WEIGHT = 0.10` — nothing else changes
(the other five sleeves scale proportionally). To judge whether it earned its keep, read the `drivers:[]`
tags `finalize-target.mjs` writes onto each target name against the Rebalance Log's graded outcomes.

**Congressional disclosures are excluded from this permanently** — they enter the adversarial verify prompt
as explicitly-labelled weak context and nothing else. See `producer/PROPOSAL-flow-signals.md`.

## Risk-aware target weighting (v93)
The research proposes conviction weights; **`riskweights.mjs`** (enforced by `finalize-target.mjs` before the
target is committed) disposes, adding two caps conviction alone ignored:
- **Correlation-cluster cap** — the megacap-tech/AI complex (NVDA/AVGO/AAPL/MSFT/GOOGL/META/AMZN/ORCL/NFLX)
  is capped at **≤48% combined** (GICS "sector-diversified" labels hid that these co-move as one bet);
  payments (V+MA) ≤20%, staples ≤25%; SPY/index ballast is uncapped.
- **Vol-scaled single-name cap** — a wider 52wk range → a smaller max weight for the same conviction, so
  10% in LLY (a single drug stock into an earnings print) isn't sized like 10% in SPY.

## Decision ledger — the account's own track record (v93)
Every owner-confirmed deploy/rebalance is appended to **`producer/agentic-decisions.json`** (`makeDecision`
in `agentic-ledger.mjs`: `{date, kind, trades:[{sym,side,dollars,priceAt}], spyAt, rationale}`). `build-data.mjs`
grades each vs live quotes + SPY (dollar-weighted contribution, alpha, ahead/behind/open) and attaches it as
`data.agentic.decisions` for the consumer's **🧾 Rebalance Log** card — so we learn whether each allocation call
actually worked, the same way the picks screen grades its Track Record. **When you place a confirmed rebalance,
append the record** (record `spyAt` = SPY's price at decision time so alpha can be graded).

## Tax & regulation rules the rebalancer MUST follow
1. **Minimize realized gains.** All lots opened 2026-06-29 are **short-term until ~2026-06-30** of the next
   year (taxed as ordinary income). Prefer **cash-flow rebalancing** — steer new deposits/dividends into
   underweight names (no sale) — and only **trim** when a name is materially over target (drift > trigger).
2. **Wash-sale guard.** Never realize a loss and rebuy the same (or substantially identical) security within
   **30 days** either side. Check recent orders (`get_equity_orders`) / `get_realized_pnl` before any loss sale
   or any rebuy of a recently-sold loser.
3. **Settlement / freeriding.** It's a cash account: **sequence sells before buys**, and don't rebuy with
   unsettled proceeds (T+1). Spreading a rebalance across days is fine and often cheaper tax-wise.
4. **Drift band, not daily churn.** Only rebalance a name when |drift| ≥ `driftTriggerPp` (5pp) or a
   stop/target/earnings level triggers — turnover is tax drag.
5. **Prefer long-term lots** for any necessary trim once lots age past 1 year. **TLH is formalized (v96):**
   losses sell first on every ticket, and standalone harvests fire at ≥ max($75, 5% of cost) — see the
   planner's TLH + cross-account wash rules above.

## Weekly job — wired into the existing producer (no separate trigger)
Rather than a new scheduled trigger, the weekly refresh is **step 7 of the producer** (`PRODUCER.md`),
which runs on the existing durable triggers. It's **best-effort, post-publish, weekly-gated** — it can
never disturb the daily `data.json` publish (same isolation as the watchlist syncs). Each FETCH_ALL run:

1. `node producer/agentic-due.mjs` → `AGENTIC_DUE` (target ≥ 7d old / missing) or `AGENTIC_NOT_DUE`
   (skip; ~zero cost). The gate keys off `agentic-target.json`'s `asOf`, so it fires ~once a week and
   self-heals if a run is missed.
2. On DUE: assemble a fresh universe (oversold scan finalists + `leaders.mjs` bench + ••••3900 holdings),
   run the **`agentic-research`** workflow (`args:{universe, book, flow, polClusters}` — pass
   `data.flow.symbols` and `data.flow.polClusters` from the fresh snapshot so the flow sleeve and the verify
   stage see them), pipe the result through **`finalize-target.mjs`** (which re-enforces the risk caps and
   writes the `drivers:[]` attribution when given `ranking`), and commit + push `agentic-target.json`.
   While reviewing catalysts, add any newly-confirmed dated policy event to **`producer/policy.json`**
   (schema + rules in `policy.mjs`; high-impact entries need a source URL) and commit it in the same change.
3. Compute drift vs the new target, apply the **Tax & regulation rules** above, and **`PushNotification`
   the owner a rebalance proposal** — placing nothing (alert & one-tap-confirm).

Because the producer's trigger prompt is "follow `producer/PRODUCER.md` exactly", this needs **no web-UI
change** — the existing schedule picks it up. (If a live trigger uses an older prompt that doesn't defer to
PRODUCER.md, re-paste the prompt in `SCHEDULING.md` once.)

**On demand (any session):** just ask to "rebalance" — same flow in one go: run the `agentic-research`
workflow → pipe its `allocation` through **`finalize-target.mjs`** (risk-caps enforced) → commit the new
`agentic-target.json` → build the ticket with **`agentic-deploy.mjs`** (earnings/gap/wash-sale deferrals) →
propose it for confirmation. On confirm + place, **append the decision** to `agentic-decisions.json`
(`makeDecision`, with `spyAt`) so the Rebalance Log can grade it.

## The executor — the self-driving loop (v96)
A **separate scheduled Claude session** (hourly during market hours — cron `20 14-20 * * 1-5` UTC, its own
trigger, NOT the data producer) that keeps ••••3900 on target without the owner having to notice drift.
Cheap by construction: every run starts with the deterministic gate and exits immediately when idle.

**Runbook (the trigger prompt is: "follow AGENTIC.md §executor exactly"):**
1. `node producer/agentic-exec-gate.mjs` → mode. **`EXEC_IDLE` (exit 30) → stop, ~zero cost.** Otherwise
   `producer/raw/agentic-plan.json` holds the plan/ticket. The gate handles: kill switch, market hours,
   stale/missing snapshot (trading **fails safe**), in-flight ticket sequencing, dust plans (< $25),
   and not re-nagging an identical outstanding proposal.
2. **`EXEC_PROPOSE`** — write the ticket (`makeTicket`, status `proposed`) to `producer/agentic-pending.json`,
   commit + push to `main`, and PushNotification the owner a one-tap summary (sells → buys, turnover, est
   ST tax net). Place nothing. (An owner later confirming = set status `confirmed`, commit; the next
   executor pass places it.)
3. **`EXEC_AUTO` / `EXEC_TRADE`** — live pre-checks, then place:
   a. Re-fetch the account (`get_portfolio`/`get_equity_positions`) + fresh quotes; abort if the book moved
      > 5% from the plan's basis (re-plan next pass).
   b. `get_earnings_calendar` for the buy names — drop any reporting ≤ 7d (the gate's plan has no earnings
      map; this is where the blackout is enforced).
   c. Before ANY loss-sale: `get_equity_orders` on the **margin** account (…0741) for the same symbol,
      30-day window — a recent buy there kills a harvest (keep exits, flag `washRisk`).
   d. Place **sells first** (losses first, then smallest gain), then **leg-1 buys** from settled cash —
      fractional **dollar-market** orders via `review_equity_order → place_equity_order`, regular hours.
   e. Advance the ticket (`advanceTicket` → `sells-placed`, or `buys-placed`/`done` when there's no T+1
      leg), **append the decision** to `agentic-decisions.json` (`makeDecision`, with `spyAt`), commit +
      push both files, PushNotification the fill report.
4. **`EXEC_BUYS`** — the T+1 leg: verify settled cash actually covers it (settlement can lag), place the
   `buysT1` orders, advance to `buys-placed` → `done`, append/extend the ledger record, commit + push, push
   the report.
5. Never gate or touch the data producer's publish. On ANY placement error: stop, leave the ticket state
   as-is (idempotent — the next pass re-checks open orders via `get_equity_orders` before re-placing),
   and push a failure note instead of improvising.

### How the executor trigger is wired (and the one thing that bit us)
**A scheduled session only has a git checkout if its trigger carries a `sources` block — and
`create_trigger` (the agent-facing MCP tool) cannot set one.** The first executor trigger was minted
that way on 2026-08-10 and every firing landed in an **empty working directory**: step 1
(`node producer/agentic-exec-gate.mjs`) could not run, so the loop never did anything and failed
silently — no commit, no push, no notification, nothing to notice. Confirmed from the fired session's
own `session_context`, which carried no `sources` where every working session carries one. (The same
defect killed the standalone *Agentic weekly research refresh* trigger, minted the same way on Jul 15;
`agentic-target.json` has exactly one commit in its history, written by an ad-hoc session on Aug 5.)

The fix, and the pattern to reuse: `create_session` **does** accept `source_url`, so the executor now
runs as a **persistent session with the repo attached** (`session_01PMH7obdqWYEiR63EhFRgd9`), with an
hourly `persistent_session_id` routine firing into it. Two consequences that are load-bearing:
- **The working tree persists between firings** — it is *not* a fresh clone like the data producer's.
  Every pass therefore MUST start with `git fetch origin main && git checkout -f -B pf-exec origin/main`,
  or the gate reads a stale `data.json` and plans against yesterday's snapshot.
- **The routine carries no MCP connectors.** `create_trigger`'s `connectors` parameter is disabled for
  this org, so the fired session has no `mcp__Robinhood__*` tools. `EXEC_PROPOSE` is fully unattended
  (it only writes/commits/pushes the ticket and notifies), but the **placing** modes — `EXEC_AUTO`,
  `EXEC_TRADE`, `EXEC_BUYS` — need Robinhood and will stall until the connector is attached to that
  session from the claude.ai UI. Until then the auto tier is effectively **propose-only**.

Do not "clean this up" by re-minting the trigger with `create_trigger` alone; that is the exact bug.

## Robinhood writes from this account
The **executor** (above) is the only thing that places orders here: unattended within the **auto tier**
(≤ $500 turnover/ticket), owner-confirmed above it. The **data producer** remains READ-ONLY on ••••3900
(it only fetches for display; its only Robinhood writes anywhere are the two watchlist syncs).
