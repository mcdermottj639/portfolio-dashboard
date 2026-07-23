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
| **Rebalance proposal** | weekly + on any drift > trigger | the weekly job builds it; you confirm (see Execution policy) |
| **Event triggers (v93)** | every run (deposit / earnings gap) | `agentic-triggers.mjs` (in `build-data.mjs`) → `raw/agentic-triggers.json`: a **`deploy-cash`** push when idle/new cash crosses ~5% of book, and a **`refreshResearch`** flag that runs the research EARLY (before the weekly gate) on a deposit or a ≥6% held-name gap. So the account reacts to deposits + earnings, not just the 7-day clock. |

## Execution policy — **alert & one-tap confirm** (owner's choice)
Everything up to the trade is automated; **no order is placed without the owner confirming the exact
tickers + amounts.** (This is also enforced by the trade-safety classifier — a summary "do it" is not
enough; orders must be explicitly named.) The automation's job is to deliver a **ready-to-confirm ticket**.

The ticket is built by the pure **`agentic-deploy.mjs`** planner (`planDeployment(...)`), which enforces the
tax/reg rules below AS EXECUTABLE CODE (not just prose) and defers — never silently drops — any name it
can't cleanly buy:
- **Earnings blackout:** never deploy NEW money into a name inside **~7 days** of its earnings report — a
  pre-print overnight gap can erase the edge. Wait for the number, then buy with full information.
- **Gap-through-entry re-verify:** a name **at/below its target stop** is a broken setup → defer; a name
  **below its planned entry zone** (e.g. it sold off after earnings, like GOOGL post-7/22) has a thesis in
  question → defer for a fresh look, don't reflexively "buy the dip".
- **Wash-sale / settlement:** skip a rebuy inside the 30-day loss window; deploying new cash needs no sells,
  and any required trim is sequenced first + flagged T+1 (cash account, no freeriding).
Deferred names keep their **target weight** — only the buy waits. The consumer's Agentic card shows the same
deferrals as amber badges so the card and the ticket always agree.

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
5. **Prefer long-term lots** for any necessary trim once lots age past 1 year; harvest losses thoughtfully.

## Weekly job — wired into the existing producer (no separate trigger)
Rather than a new scheduled trigger, the weekly refresh is **step 7 of the producer** (`PRODUCER.md`),
which runs on the existing durable triggers. It's **best-effort, post-publish, weekly-gated** — it can
never disturb the daily `data.json` publish (same isolation as the watchlist syncs). Each FETCH_ALL run:

1. `node producer/agentic-due.mjs` → `AGENTIC_DUE` (target ≥ 7d old / missing) or `AGENTIC_NOT_DUE`
   (skip; ~zero cost). The gate keys off `agentic-target.json`'s `asOf`, so it fires ~once a week and
   self-heals if a run is missed.
2. On DUE: assemble a fresh universe (oversold scan finalists + `leaders.mjs` bench + ••••3900 holdings),
   run the **`agentic-research`** workflow (`args:{universe, book}`), write the result to
   `producer/agentic-target.json` (this file's shape) and commit + push it to `main`.
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

## Robinhood writes from this account
The producer is READ-ONLY on ••••3900 (it only *fetches* for display). The **only** writes are the
**owner-confirmed rebalance orders** placed interactively — never unattended.
