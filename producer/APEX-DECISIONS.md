# Apex entry, hold and exit contract

Implemented in the dashboard in v216. Applies only to the self-directed Apex
model. The separate agentic model and brokerage execution are outside this change.

## Decision rules

| Situation | Dashboard behavior |
| --- | --- |
| Valid new entry/add | Finite `0 < stop < limit < target`, R/R at the executable limit ≥ 1.5, supported order type, within the research maximum price, no earnings/wash/exit hold, and available allocation room |
| Underweight target | Same entry gates as a build; combined additions cannot exceed cruise room or the smaller of target weight and the 20% name cap |
| Held name absent from targets | Review / no add. Omission is not an exit instruction |
| Held name fails entry R/R | No add; independently evaluate its held exit plan |
| Missing/stale entry research | No new entry; retain independent protective rules. The adapter allows a weekly source up to eight days old, with five minutes of clock skew |
| Genuine hard stop, held research stop/target or maintenance trigger | One sell proposal per symbol, no opposing buy; quantity capped at the holding. Full exits supersede smaller optional sells |
| Mechanical +25%/+50% profit milestone | Review only until execution-backed milestone state is available. Position quantity alone cannot establish whether a trim already filled |
| Owner-managed core | No automated sell, trim or add proposal |

Quote freshness remains separate from research freshness. The existing 75-minute
quote rule labels older prices as estimates. Every proposed order still requires
live confirmation. The unchanged leverage band is reload 1.50, cruise 1.65, cap
1.75. Existing owner wash waivers remain in the adapter.

`bookLines()` supplies the trade list, order count, Plan sell note and confirmation
prompt. Review rows are visible but are not counted as orders. Pending/partial
orders must be reconciled in live confirmation; the page does not claim to know
their current state.

## Research provenance

`data/apex-targets.json` supplies ISO `asOf`, entry `targets` and `top5` rows with
`sym`, `trigger`, `limit`, `orderType`, `maxPx`, `tp1`, `stop`, `stopBasis`,
`tradable`, and research evidence. `orderType` supports `limit` and `stop_limit`
(`stop-limit` alias); legacy rows default to stop-limit.

Keep `heldLevels` for every holding, including names outside the current buy
list. Held levels take precedence for exits and must not be overwritten by a new
entry's stop. Do not re-anchor a held stop to an updated entry price. A missing
held field stays missing until researched. The app may display an ATR estimate
when it detects an owner-entered stop, but that estimate cannot authorize a buy
or serve as a held research stop. Never adjust levels merely to meet the R/R floor.

## Scheduled scan update still required

The dashboard confirmation prompt follows this contract. The independently
scheduled Claude morning routine is not stored in this repository, and its live
prompt was not accessible in this session. Publishing this document does **not**
update that routine. Its owner must read and update the actual routine, then
verify a preview run before claiming completion. Required prompt addition:

> Maintain separate entry eligibility and held-position decisions. Entry R/R
> below 1.5, rank changes, or omission from targets mean no add/review, never an
> automatic sell. Keep independently justified stop, thesis/trend, planned profit
> and maintenance exits. Publish held research levels with provenance for every
> holding and keep them separate from new-entry levels. Review discretionary
> rotations weekly and require a material same-horizon advantage after spread,
> slippage and other costs. Reconcile live positions, all open/advanced orders,
> partial fills, fills, cancellations and rejections before proposing one net
> action per symbol. Unknown order state requires reconciliation before a new
> ticket; preserve urgent protective alerts. Never mark a trim completed from
> a recommendation, approval click or a position-size guess. Preserve the
> owner-managed core, leverage band, account boundaries and owner wash waivers.

Verify the updated routine using the seven turnover regressions in
`producer/apex-turnover.test.mjs`, plus pending and partial-order scenarios.
Do not mistake the dashboard's review fallback for live order reconciliation.

## Execution ledger work still required

The current producer stores daily aggregate order history. It does not retain a
complete open-order set or link fills to a trim milestone. No ledger was invented
or backfilled in v216; automatic milestone trim tickets are intentionally paused.

The follow-up implementation needs durable position-cycle IDs, milestone IDs,
intended quantities, broker order IDs and fill IDs, filled quantities, pending
reservations, and timestamps/coverage. Initialize existing positions as unknown
until reconciled. Deduplicate fills, count partial fills once, retain filled
quantities after cancellation, and never reset a milestone on refresh or research
list changes. Reopen a cycle only from confirmed position lifecycle events.
Store account-specific state in the encrypted snapshot, not public research JSON
or browser localStorage. Test refresh/restart, multiple devices, partial fills,
cancellation/replacement, additions, and full exit/re-entry before enabling tickets.

## Verification

- `node producer/apex.test.mjs`
- `node producer/apex-turnover.test.mjs`
- All `producer/*.test.mjs` sequentially and `node --test tests/*.test.cjs`
- With `tests/preview.mjs`: `tests/brief-browser.mjs`,
  `tests/sd-plan-browser.mjs`, `tests/apex-browser.mjs`

The browser suites use synthetic data. They do not submit orders, access live
accounts, or overwrite the encrypted production snapshot.
