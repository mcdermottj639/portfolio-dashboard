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
| Account **holdings / cash / drift** (card `Now`) | **3×/day** (09:30 / 12:30 / 16:00 ET) | the **producer** now fetches ••••3900 every run (`agentic-portfolio.json` / `agentic-positions.json` → `data.agentic`) |
| **Target** (`agentic-target.json`) | **weekly** | the deep research workflow (below) re-runs, and the new target is committed |
| **Rebalance proposal** | weekly + on any drift > trigger | the weekly job builds it; you confirm (see Execution policy) |

## Execution policy — **alert & one-tap confirm** (owner's choice)
Everything up to the trade is automated; **no order is placed without the owner confirming the exact
tickers + amounts.** (This is also enforced by the trade-safety classifier — a summary "do it" is not
enough; orders must be explicitly named.) The automation's job is to deliver a **ready-to-confirm ticket**.

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

## Weekly job — turnkey scheduled-trigger prompt
The remote container is ephemeral, so durable scheduling is a **web-UI scheduled trigger** (like the
producer's — see `SCHEDULING.md` §3), **not** in-session cron. Add **one** trigger, **weekly, ~30 min before
the Monday open** (e.g. `0 9 * * 1` America/New_York), with this prompt:

> Refresh the agentic account target and propose a rebalance. Steps:
> 1. Assemble a fresh candidate **universe**: run the Robinhood oversold scan (`run_scan` SCAN_ID from
>    `producer/picks.mjs`) for value names + the `producer/leaders.mjs` mega-cap bench + current ••••3900
>    holdings; pull live quotes + fundamentals for sector/PE/52wk. Build the `[{t,sec,px,pe,hi,lo}]` list.
> 2. Run the **`agentic-research`** workflow with `args:{ universe:<that list>, book:<current ••••3900 equity> }`.
> 3. Write its `allocation` to **`producer/agentic-target.json`** (shape per AGENTIC.md), commit + push to `main`.
> 4. Read ••••3900 live (`get_portfolio` + `get_equity_positions`), compute drift vs the new target, and apply
>    the **Tax & regulation rules** above to build a concrete rebalance ticket (buys to underweights first;
>    trims only on drift > trigger and wash-sale/short-term-gain-aware; sells sequenced before buys).
> 5. **Do NOT place anything.** Send the owner the proposed orders for one-tap confirmation (`PushNotification`
>    + the order list). Place only after they confirm the exact tickers + amounts.

On demand (any session), the same flow is one call: run the **`agentic-research`** workflow, commit the new
`agentic-target.json`, then propose the reviewed rebalance.

## Robinhood writes from this account
The producer is READ-ONLY on ••••3900 (it only *fetches* for display). The **only** writes are the
**owner-confirmed rebalance orders** placed interactively — never unattended.
