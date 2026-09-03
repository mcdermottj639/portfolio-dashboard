# AGENTIC.md — Agentic account (••••3900) automation & rebalancing

How the **agentic account** is researched, targeted, monitored, and rebalanced. Read with
`CLAUDE.md` (architecture) and `SCHEDULING.md` (how the producer is scheduled — same web-trigger model).

## What this account is
- **••••3900 "Agentic"** — an **individual LIMITED MARGIN account**, the only one with
  `agentic_allowed: true` (the agent can place orders here; the other three accounts can't). Confirm
  with `get_accounts` — it reports `type: "limited_margin"`.
- **Upgraded from a cash account 2026-08-11 (v98).** Limited margin buys exactly one thing: **instant
  settlement** — proceeds from a closing order are spendable the moment the sell FILLS, so a rebalance
  no longer straddles two sessions. It adds **no borrowing and no leverage** (`get_portfolio` shows
  `unleveraged_buying_power == buying_power`), so everything downstream stays **unlevered, 1×**.
- **Still taxable, still short-term.** Every sell is a taxable event and the wash-sale rules are
  unchanged — the upgrade moved settlement, not tax treatment.
- **⚠️ PDT now applies — this is the cost of the upgrade.** A limited-margin account is a margin account
  for FINRA purposes, so **4+ day trades in 5 rolling business days** on a book under **$25,000** gets it
  flagged and restricted. This book is ~$5k and the executor runs hourly. A cash account had no such
  rule (it had good-faith/freeriding violations instead), so nothing in the system guarded against it
  before v98. The guard is absolute rather than a counter: **a name bought today is never sold today**
  (`accountActivity` in `agentic-deploy.mjs`). Zero round trips ⇒ PDT can't accrue; the only cost is
  that a same-day reversal waits a session, which the 5pp drift band already tolerates.
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
| Account **values / drift** (card `Now`) | **hourly** (each producer run, market hours — `35 * * * *` UTC) | re-priced every run from that run's quotes — in step with the main account (carry-forward re-pricing in `build-data.mjs`; the 8 holdings are index/leader symbols quoted every run) |
| Account **holdings** (share counts) | **daily** (full/open run) | re-fetched via `agentic-portfolio.json` / `agentic-positions.json` (resolved through `get_accounts`); they only change on a rebalance, which refreshes them in-session anyway |
| **Target** (`agentic-target.json`) | **weekly** | the deep research workflow (below) re-runs, and the new target is committed |
| **Rebalance execution (v96)** | hourly gate, market hours | the **executor** (below): auto ≤ $10,000 turnover, push + owner confirm above (`agentic-confirm.mjs`, or any Claude session); in-flight ticket in `agentic-pending.json`. Since **v98** a whole ticket (sells → buys) completes in ONE session — limited margin, instant settlement |
| **Event triggers (v93)** | every run (deposit / earnings gap) | `agentic-triggers.mjs` (in `build-data.mjs`) → `raw/agentic-triggers.json`: a **`deploy-cash`** push when idle/new cash crosses ~5% of book, and a **`refreshResearch`** flag that runs the research EARLY (before the weekly gate) on a deposit or a ≥6% held-name gap. So the account reacts to deposits + earnings, not just the 7-day clock. |

## The standing flow (owner-ratified 2026-08-11)
**Research builds the model → the legitimizer decides what's tradeable → the executor trades it → the
excess parks in VTI.** Concretely: the `agentic-research` workflow (split verdict: `businessOk` gates
inclusion, `entryQuality` sizes) proposes an allocation; `finalize-target.mjs` re-enforces the risk caps
deterministically and writes the canonical `agentic-target.json`; the executor's planner applies the
guards (earnings/policy/wash/PDT/entry-band) and places what clears; whatever the guards hold back is
parked in the VTI waiting ground rather than left in cash **when — and only when — the deferral has a
dated end** (wash-sale, re-entry cooldown, earnings or policy blackout), and released to fund each name
as it clears. An UNDATED deferral (entry band, below-stop, no-quote, regime, drawdown) waits in CASH:
those clear on a price move, historically within 1-6 days, and a round trip through the vehicle costs
more in spread than a few days of beta can expect to earn — measured on this book, the 08-26 park
returned +$0.78 gross on ~$1,000 of turnover while paying a wider spread than that (2026-09-03).

## Execution policy — **TIERED AUTO** (owner-approved 2026-08-07; supersedes confirm-everything)
The owner signed off on a two-tier policy so the account is **self-sufficient** for routine upkeep:
- **Auto tier:** a ticket with **turnover ≤ `AUTO_TURNOVER_CAP` ($10,000 — history: $500 → $1,000 on
  2026-08-11 (top-ups kept stalling on a confirm) → $10,000 on 2026-08-25, owner: "i dont like that i
  have to approve everything — make it all auto up to $10k")** may be executed **unattended**
  by the executor (below) — placed, logged to the decision ledger, and reported by PushNotification
  *after* the fact. On a ~$10k book that covers full-book rebalances, not just routine upkeep.
- **Confirm tier:** anything larger (today, only a ticket bigger than the whole book — e.g. deploying
  a large fresh deposit) goes out as a **push + the owner's confirm** — the ticket sits in
  `agentic-pending.json` as `proposed` until the owner confirms (one command:
  `node producer/agentic-confirm.mjs <id> --commit`, or in any session: "confirm the pending rebalance")
  or it goes stale (5 days → re-planned at fresh prices). It was described as a "one tap" from v96 until
  2026-09-02, when an audit found there had never been a tap — only a chat round trip.
- **Kill switch:** `PF_AGENTIC_AUTO=off` in the executor's environment idles the whole executor. The
  Routine itself can also be paused (`update_trigger enabled:false`) — done 2026-08-31 after the
  wrong-account snapshot below, and **re-enabled the same day** once the 20:42Z producer run republished
  both books correctly and the gate passed the identity check.
- **Snapshot identity check (2026-08-31).** Before any mode is printed, the gate runs
  `snapshotHoldingsSanity` (agentic-ledger.mjs) and idles if the snapshot's agentic book contradicts this
  system's own committed records — the parking ledger naming a vehicle the book doesn't hold, or none of
  the names we bought and never sold being present. It exists because a producer run published the
  SELF-DIRECTED book into `data.agentic` and the planner proposed a $61,962 liquidation of an account
  holding none of those names; `EXEC_PROPOSE` would have armed it behind a single owner tap without ever
  calling the broker. Ordinary rebalancing does not trip it (one surviving name is enough).
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
  and any required trim is sequenced first so its proceeds fund the buys the same session (v98).
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
- **Cross-account wash guard — BOTH directions (v105):** the IRS window spans accounts and the **margin
  book trades the same names**. Direction 1 (v96): pass `crossActivity` (recent margin-account buys); a
  loss-sale on a name the other account bought within 30d gets its harvest **skipped** (no benefit) or
  its exit flagged `washRisk`. Direction 2 (v105): the wash-sale ledger itself now merges the margin
  book's realized LOSSES (`main-trades.json` → `recentLosses` entries tagged `account:'main'`), so an
  owner loss-sale in ••••0741 blocks the agentic executor from rebuying that name for 30 days. This
  direction was missing and it bit for real: the owner sold 35 NVDA at −$431.76 on 2026-07-29 and the
  executor bought NVDA back on 2026-08-11, partially disallowing the loss. The gate can't see margin
  orders newer than the snapshot, so **the executor fetches both accounts live** (step 3c below).
- **~~Two-leg T+1 ticket~~ — removed in v98.** Under limited margin the sale proceeds fund the buys in the
  SAME session, so there is one allocation pass over `cash + proceeds` and `buysT1` is always empty (the
  field survives only to carry tickets written under the old model through to `done`). Sells still lead:
  instant settlement means spendable once a sell **fills**, not before, so the executor places the sells,
  confirms the fills, then places the buys.
- **The wash-sale ledger is REAL trades (v98), not an inference — and spans BOTH taxable accounts (v105).**
  `data.agentic.recentLosses` is rebuilt each run from `producer/raw/agentic-trades.json`
  (`get_pnl_trade_history`, span `ytd`) PLUS `producer/raw/main-trades.json` (the self-directed ••••0741
  book, span `3month`) — actual closing trades, losses only, rolling 31 days, each entry tagged
  `account: 'agentic' | 'main'`. The agentic portion used to be *inferred* from position diffs, which
  booked five phantom losses on 2026-08-03 and blocked a real NVDA buy for 30 days off one of them. The
  main portion exists because the single-account ledger missed a REAL cross-account wash: NVDA sold at a
  loss in ••••0741 on 2026-07-29, rebought by the executor on 2026-08-11. If you ever see a wash-sale
  hold you can't tie to a closing trade, check `data.agentic.lossSource`: `trades` is authoritative,
  `inferred` means the agentic portion fell back (Railway) and the entry deserves a second look (the
  main portion is only ever broker trades or a carry-forward of them — never inferred).

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

### The singleton loophole, closed (v124)
A ticker absent from `CLUSTERS` falls through to its own `single:<SYM>` cluster, which carries **no
correlation cap at all**. That is right for a genuinely idiosyncratic name, but the list only ever held the
fourteen names the research universe happened to contain — so a high-multiple AI name that co-moves with the
complex tick for tick (**TSLA, PLTR, NOW, CRWD, ANET, MU, TSM, SMCI**…) counted **zero** against the 48% cap.
A book could sit at 44.8% direct megacap and stack more of the *same bet* on top while reporting itself
compliant. Membership is now about **co-movement, not GICS labels or market cap** — TSM is a semi, TSLA an
automaker and NOW a software firm, and all three trade as the AI bet. Adding a name can only ever *tighten*
a cap, so err toward inclusion. Defensive clusters (`utilities`, `reits`, `telecom`, `low-vol`) were added at
the same time; every one of those names used to be an uncapped singleton too — the mirror image of the hole.

## Gold diversifier + index look-through (2026-08-25, two owner decisions)
**Gold sleeve — `AG_DIVERSIFIER_MIN` 5% / `AG_DIVERSIFIER_MAX` 10%, vehicle GLDM.** The book's first
non-equity holding. Every other downside control here is either equity ballast or reactive: the defensive
floor buys staples and pharma, which still fall in a drawdown (~0.5-0.7 correlation to SPY), and the
drawdown breaker only acts once the book is already −8%. Gold's equity correlation is ~0 and typically
goes negative in exactly those episodes. Context: across BOTH accounts the household held zero commodity
exposure while ••••0741 was five names of one AI/compute bet at ~1.6× and ••••3900 was 40.7% megacap-tech.

It is placed by mandate, not by the model, because **the research cannot select it**: quality, growth and
catalyst are meaningless for bullion, so gold scores the "no data" 5.0 on three of five sleeves and tops
out at a 5.72 composite against a ~6.8 marginal finalist. `finalize-target.mjs` injects it structurally,
the way SPY is handed to the synthesis as ballast.

It has its **own floor**, not a share of the defensive one — gold's range/price (~0.47) fails the 0.42
equity vol gate, and loosening that gate to admit it would also re-admit LLY at 0.48, the bug fixed the
same morning. Exempt from the vol-scaled single-name cap (which would shrink the hedge hardest exactly
when volatility makes it useful) but bounded by its own ceiling so it never becomes the overflow sink.
Never a donor to the defensive floor. Never fabricated — an absent sleeve is reported. GDX is excluded on
purpose (an equity, with the beta this sleeve exists to avoid); SLV is far too volatile to be ballast.

**Look-through: reported, not enforced.** The cluster caps now bind on DIRECT weight. An index is a
different kind of holding from a single-name sector bet, and charging a broad-market diversifier against a
sector cap penalises diversification. The true direct/look-through/total split is still computed and
disclosed in the notes and on the Plan card — only what BINDS changed. The trade: at the 48% megacap cap,
direct can reach 48% with ~8-9pp more inside SPY/VTI, about 57% true. `LOOKTHROUGH_ENFORCE = true`
restores the v121 behaviour.

## Entry bands are derived from the verdict, not from the prose (2026-08-25)
`entryQuality` sizes a position — that is the v102 design and it is right. What it did NOT do was change
**when** the name is bought. The zone came from the model, and the v102 prompt (correctly) demands
*reachable* zones, so the model sets zones that BRACKET spot; the deploy planner's `above-entry` deferral
then never fires and a 3/10 entry executes at market exactly like a 9/10 one.

Measured on the 2026-08-25 run: **all 16 verdicts scored 2-5, ten of them exactly 3**, against a tape that
really was extended (25 of 60 universe names in the top quartile of their 52-week range; V/MA/KO/JNJ at
97-99% of theirs). Every entry zone still enclosed spot. Five new positions would have opened on one day.

`finalize-target.mjs` now computes the ceiling deterministically — `AG_ENTRY_Q_OK` 6 / `AG_ENTRY_Q_STEP`
1.5% per point / `AG_ENTRY_Q_MAX` 8% — and rewrites the zone, so a poor entry defers and parks instead of
buying. Guards: **bounded** (a deep zone reads as never-buy), the **idle-cash deadline still backstops it**
(delays a buy, never vetoes one), **never loosens** the model's own tighter zone, **defensive-floor names
are exempt** (parked weight goes to VTI at 100% equity beta — deferring ballast is backwards), and
**absent ≠ zero** (an unscored name keeps its zone rather than drawing the maximum haircut).

Read the distribution with care: ten identical scores means the LEVEL is informative and the RANKING is
not. Use it to judge the tape, never to rank which name has the better entry.

## The screening funnel — bench, cut, and the challenger quota (2026-08-25)
Six committed research cycles (2026-06-29 → 08-18) selected **14 distinct names in seven weeks**. Seven of
them appeared in five or more of six targets — SPY/GOOGL/NVDA/JPM in **all six**. The apparent variety at
the tail (MA, VTI, AAPL, UNH, one appearance each) was mostly the 08-05→08-12 churn incident, not discovery.

**This was neither proof the screen worked nor proof it was broken, and that is the actual problem.** A
landslide tells you nothing when one name is on the ballot: "these are the best names available" and "these
were the only names shown" produce identical evidence. Three narrowing steps all pulled the same way:

| step | what it was | why it biased |
|---|---|---|
| bench | `leaders.mjs`, 19 names | 16 of 19 megacap or large-growth |
| composite | m .22 · q .24 · g .22 · c .14 · v .18 | momentum+growth **0.44** vs valuation **0.18** — a cheap stable name cannot out-rank an expensive fast one |
| cut | top 10, max 2/sector | the sector cap was the *only* diversity rule |

Widening any one alone got absorbed by the other two — a 2.4× wider universe moved **2 of 10** finalist
slots. The accumulated cost was concentration nobody chose: on 2026-08-24 the book was **46.0%** one
AI/big-tech bet (37.5% direct + 8.5% inside SPY/VTI) against a 48% ceiling, and **2.9%** defensive against
the 15% floor. No individual pick was wrong; the total was never a decision.

**The fix widens what is EVALUATED, never what is HELD.** Turnover is expensive here (short-term rates) and
a stable core of good names is a legitimate outcome for this mandate — the churn governor exists precisely
to protect it. So:
- **`producer/research-universe.mjs`** — a wide screening bench (137 names / 20 sectors) with a
  sector-balanced `universeSlice(n)`. `leaders.mjs` is untouched and keeps its own job (the consumer's
  Plan-page bench, quoted every run). The Routine reads this instead — PRODUCER.md step 7.2.
- **`producer/finalists.mjs`** — the cut goes **10 → 16**, and **5 of those 16 slots are RESERVED** for
  names in neither the current book nor the prior target (`CHALLENGER_SLOTS`). Challengers share the same
  per-sector budget, so five of them from one sector can't trade one concentration for another. If too few
  non-incumbents qualify, the slots **backfill on merit** rather than shrinking the cut, and the shortfall
  is reported. On the live ranking this took fresh names reaching adversarial verify from **1/10 to 7/16**
  and sector coverage from 7 to 11 — **with every previous finalist still in the set**.
- **Allocation widens to 12-15 names** (was 7-9): the defensive floor needs room, and a 16-name cut now
  supplies enough verified survivors. On a ~$10k book 13 names is ~$780 each, far above the 3.5% sliver floor.

Nothing here buys or sells anything. The adversarial verify, the incumbency framing ("displace an incumbent
only when MATERIALLY stronger"), the 14-day min-hold and the re-entry cooldown all still decide what trades.
The point is to make the incumbents' win **falsifiable**: if the seven are genuinely best they keep winning
and that now means something; if they are not, it surfaces cheaply.

**Universe size has a hard arithmetic ceiling — do not pad it.** The sleeve prompts fall back to "score 5.0,
no data" for a name they cannot fetch, and such a name's composite tops out at `0.82×5 + 0.18×9` = **5.72**
against a marginal finalist around **6.5-6.9**. It is *arithmetically incapable* of clearing the cut, so
extra names beyond what can be scored only thin each sleeve's attention. Valuation is free at any size
(pure code over px/pe/hi/lo); momentum is Robinhood-batched and cheap; **quality/growth/catalyst are the
constraint at Alpha Vantage's 25/day free cap**. Hence the default slice of 60. To go meaningfully wider,
feed fundamentals in via `args` — the pattern the flow sleeve already uses, and `extfund.mjs` already
normalizes Finnhub/FMP into the same COMPANY_OVERVIEW shape (quotas ~250/day and 60/min vs AV's 25/day).
**That work is not done.**

## Defensive floor — the book's only FLOOR (v124)
Every risk control above is a **ceiling**. Until v124 there was no floor of any kind, and that asymmetry was
the gap: the caps stop the book over-owning the AI complex, but **nothing ever made it own a stabilizer**.
The only downturn responses that existed were reactive and cash-based — the drawdown breaker pauses buying at
−8% and raises cash at −12%, i.e. *after* the book is already down, and regime pacing only slows deployment.
Neither rotates. So a target could legitimately hold 0% staples, 0% utilities and 0% healthcare in perpetuity
and the composite would never object: momentum + growth carry **0.44** of the weight against valuation's
**0.18**, so an expensive fast name structurally outranks a cheap stable one.

**`AG_DEFENSIVE_MIN` = 15% of book** (owner-set mandate dial, ••••3900 only), enforced in
`riskweights.mjs` and applied by `finalize-target.mjs` — the same "workflow proposes, this disposes" contract
the caps use. The synthesis prompt *asks* for defensive weight; this is the **guarantee**.

- **What counts.** Cluster membership (`staples · utilities · telecom · reits · health-svc · pharma · low-vol`)
  names the candidate set; a **vol gate** makes it honest. A name must also trade no wilder than a normal
  large-cap (`DEFENSIVE_MAX_VOL` = 0.42 range/price, the same reference the vol-scaled caps use). **LLY is the
  case that matters**: GICS healthcare, in the `pharma` cluster, but a ~0.54 range — counting it as ballast
  would let the floor be satisfied by exactly the kind of position it exists to offset.
- **Index sleeves count only partially**, through `LOOKTHROUGH`, so a big SPY core cannot satisfy the floor on
  its own (~10% of the sleeve is defensive). Those fractions are deliberately rounded **down** — under-crediting
  the index makes the floor demand more explicit ballast, which is the safe direction to be wrong in.
- **It moves weight, it never creates it.** Donors are the non-defensive, non-index names, floored at
  `FLOOR_PCT`. The index sleeve is deliberately **not** a donor: it carries defensive look-through itself, so
  trimming it would partly undo the top-up being made.
- **It never breaches a ceiling.** The floor runs *after* the cluster caps, and receiver capacity is pooled
  **per cluster** — two staples names each see the whole staples headroom, so summing their name-room would
  overshoot the 25% cap.
- **It never fabricates a holding.** If the allocation contains no qualifying defensive name, the shortfall is
  **reported** (`target.defensive.shortfall`, a `DEFENSIVE SHORTFALL:` note in `method`, and the Plan tab's
  Guardrails row) — never invented. That failure mode points at the real fix: the **universe** the research was
  shown. The fallback universe in `.claude/workflows/agentic-research.js` previously contained zero utilities,
  zero REITs, zero telecom and one staples-ish name, so "hold some ballast" was not an answer the process could
  physically give. A defensive block is now carried there, and **any fresh `args.universe` must carry one too**.

Measured against the live 2026-08-18 target, the book was **2.4% defensive** (all of it look-through from
SPY/VTI; zero explicit) against a 15% floor. Set `defensiveMin: 0` to disable the floor entirely — that
restores pre-v124 behaviour exactly.

## Decision ledger — the account's own track record (v93)
Every owner-confirmed deploy/rebalance is appended to **`producer/agentic-decisions.json`** (`makeDecision`
in `agentic-ledger.mjs`: `{date, kind, trades:[{sym,side,dollars,priceAt,drivers}], spyAt, rationale}`). **Always pass
`target` (the committed `agentic-target.json`)** — `makeDecision` stamps each BUY leg with that name's
`drivers`, which is what the sleeve attribution below measures. It must be stamped AT DECISION TIME: a leg
looked up later against whatever target is current would be attributed to a thesis that did not pick it, so
legs written without it are excluded from attribution rather than reconstructed. `build-data.mjs`
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
3. **Settlement / day trades (v98).** Limited margin settles instantly, so a rebalance completes in one
   session: still **sequence sells before buys** (proceeds are spendable on FILL, not on placement), but
   there's no T+1 wait and no freeriding rule to trip. What replaced it is **PDT** — never sell a name
   this account bought earlier the same day; that's the one way an hourly executor could walk into the
   4-day-trades-in-5-days restriction on a sub-$25k book. The planner enforces this; the executor must
   supply it live (step 3c below).
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
2. On DUE: assemble a fresh universe — **`node producer/research-universe.mjs --symbols --max 60` ∪ the
   ••••3900 holdings, and nothing else** (2026-08-25). NOT `leaders.mjs` (that is the consumer's Plan-page
   bench, 19 names / 16 megacap — screening it produced 14 distinct names in seven weeks), and NOT the
   Daily Picks (20% social — self-directed only). Use `research-universe.mjs`'s sector labels rather than
   Robinhood's, since `sec` is the co-movement budget behind the max-2-per-sector finalist rule.
   Run the **`agentic-research`** workflow (`args:{universe, book, held, priorTarget, flow, polClusters}` —
   `held`+`priorTarget` are NOT optional: they are the churn governor AND they drive the challenger quota),
   then pipe the **WHOLE return** through **`finalize-target.mjs`** — not just `.allocation`, because its
   `ranking` array carries the px/hi/lo that both the defensive vol gate and the verdict-derived entry
   bands need — and commit + push `agentic-target.json`.
   While reviewing catalysts, add any newly-confirmed dated policy event to **`producer/policy.json`**
   (schema + rules in `policy.mjs`; high-impact entries need a source URL) and commit it in the same change.
3. Compute drift vs the new target, apply the **Tax & regulation rules** above, and **`PushNotification`
   the owner a rebalance proposal** — placing nothing (alert, then the owner's confirm).

Because the producer's trigger prompt is "follow `producer/PRODUCER.md` exactly", this needs **no web-UI
change** — the existing schedule picks it up. (If a live trigger uses an older prompt that doesn't defer to
PRODUCER.md, re-paste the prompt in `SCHEDULING.md` once.)

**On demand (any session):** just ask to "rebalance" — same flow in one go: run the `agentic-research`
workflow → pipe its `allocation` through **`finalize-target.mjs`** (risk-caps enforced) → commit the new
`agentic-target.json` → build the ticket with **`agentic-deploy.mjs`** (earnings/gap/wash-sale deferrals) →
propose it for confirmation. On confirm + place, **append the decision** to `agentic-decisions.json`
(`makeDecision`, with `spyAt` **and `target`** — the target supplies each buy leg's `drivers` for sleeve
attribution) so the Rebalance Log can grade it.

## Book-level drawdown breaker (v121)
The only guard here that looks at the WHOLE book — everything else (stops, entry bands, min-hold) is
name-scoped. `drawdown.mjs` reads the recorded, **deposit-adjusted** equity series; `build-data.mjs`
publishes it as `data.agentic.drawdown` and `agentic-exec-gate.mjs` feeds it to the planner.

| tier | trips at | what changes |
|---|---|---|
| `soft` | ≤ −8% from the deposit-adjusted peak | Every new buy defers with reason `drawdown`. Deferred dollars stay in **cash — not parked in VTI** (the placeholder is 100% equity beta, so parking "the market is falling" money there is backwards). The idle-cash deadline is paused; its clock keeps running. |
| `hard` | ≤ −12% | Soft, plus `drawdown-raise` sells lifting cash to **20% of book, losses first**. |
| clear | back **above −6%** | Not at −8%: the gap is hysteresis, or the breaker chatters and redeploys into what it just refused. |

Load-bearing details: **sells, exits and TLH are never blocked** — de-risking must always be possible.
The breaker does **not** override the PDT day-trade guard or the 14-day min-hold; it warns when the cash
floor cannot be reached rather than forcing past them. It **fails open** below 5 recorded points (the
equity series cannot be backfilled, so a young account is thin by definition, and a breaker that stopped
on thin data would freeze a new book forever). Tier CHANGES — including recoveries — are pushed to the
owner by `alerts.mjs` through the normal producer push path, so the executor should not re-push them.

## The executor — the self-driving loop (v96)

> **PRE-AUTH (none active).** To pre-approve one above-cap ticket without a chat round trip, replace this
> block with: PRE-AUTH &lt;YYYY-MM-DD&gt; — ticket &lt;id or "next EXEC_PROPOSE"&gt;, max turnover $N, expires
> &lt;date&gt;, guard: applies only if `agentic-target.json` asOf ≥ &lt;date&gt;. Spent once; the executor deletes
> it after execution and notes the id.

A **separate scheduled Claude session** (hourly during market hours — cron `20 14-20 * * 1-5` UTC, its own
trigger, NOT the data producer) that keeps ••••3900 on target without the owner having to notice drift.
Cheap by construction: every run starts with the deterministic gate and exits immediately when idle.

**Why the executor is a fresh session per fire (2026-09-02).** It is stateless by design — every run does a
`git checkout -f` from `origin/main`, and all the state it carries lives in the three committed files
(`agentic-pending.json` / `agentic-decisions.json` / `agentic-parked.json`), so a resumed conversation adds
nothing but cost. From 08-10 it was bound to ONE persistent session, and that accumulated **128M cached
tokens / ~$74 over ~115 mostly-idle fires** — the gate prints `EXEC_IDLE` and stops on nearly every pass,
yet each fire re-loaded the whole conversation. Worse, a persistent session can get *stuck*: this one sat
blocked in a "needs input" state over a question about a **different** Routine, which is exactly the
chat back-and-forth the owner was seeing. And a persistent-bound Routine **cannot use completion push notifications**
(the API rejects them), which is why "say what failed" always turned into a chat message the owner had to
go and read. Fresh-session-per-fire fixes all three. **Status 2026-09-02:** the replacement trigger exists ("Agentic executor
(••••3900 rebalancer) — fresh session") but is DISABLED until the owner attaches Robinhood to it in the
claude.ai Routine UI, enables it, and disables the persistent one — the API cannot attach connectors.

**Runbook (the trigger prompt is: "follow AGENTIC.md §executor exactly"):**
1. `node producer/agentic-exec-gate.mjs` → mode. **`EXEC_IDLE` (exit 30) → stop, ~zero cost.** Otherwise
   `producer/raw/agentic-plan.json` holds the plan/ticket. The gate handles: kill switch, market hours,
   stale/missing snapshot (trading **fails safe**), in-flight ticket sequencing, and dust plans (< $25).
   **Not re-nagging an outstanding proposal is the in-flight branch's `await-confirm` idle** — a ticket
   still sitting in `proposed` owns the run and the gate never reaches the planner, so it cannot propose
   again. (There used to be a second planHash comparison at the bottom for this; it was unreachable and
   was deleted 2026-09-02.)
2. **`EXEC_PROPOSE`** — write the ticket (`makeTicket`, status `proposed`) to `producer/agentic-pending.json`,
   commit + push to `main`, and PushNotification the owner a summary (sells → buys, turnover, est
   ST tax net) **naming both confirm paths**. Place nothing. Confirming is either
   `node producer/agentic-confirm.mjs <id> --commit` (the one-command path — moves `proposed → confirmed`
   through `advanceTicket`, writes the file and pushes it) or telling any Claude session
   "confirm the pending rebalance". Either way the next executor pass places it.

   > **ALWAYS build the ticket with `makeTicket` — never hand-write it (v126).** Since v126 the ticket
   > carries `blockedSells` and `warnings` alongside the legs: the sells the planner WANTED to make and
   > the guard that stopped each (min-hold / PDT), with the unlock date. `raw/agentic-plan.json` is wiped
   > every run, so the ticket is the only thing that carries them to the Plan tab's "💸 Sells held back"
   > list. Hand-writing a ticket, or copying only `legs`, silently reverts the 08-25 failure mode: a
   > deposit-funded, buys-only ticket with the suppressed exits explained nowhere, which reads to the
   > owner as the sells having failed. `advanceTicket` spreads the whole ticket, so every later
   > transition preserves them for free — only a hand-built one loses them.
   > **When the push summary's sell leg is empty but `blockedSells` is not, SAY SO in the notification**
   > ("2 sells held by the min-hold to Aug 26"). A buys-only ticket arriving right after a deposit is the
   > exact shape that looks broken.
3. **`EXEC_AUTO` / `EXEC_TRADE`** — live pre-checks, then place:
   a. Re-fetch the account (`get_portfolio`/`get_equity_positions`) + fresh quotes; abort if the book moved
      > 5% from the plan's basis (re-plan next pass). **Also check the buys against live `buying_power`,
      and STOP if a `PLANNER BUG` warning is on the plan** — the 5% test compares BOOK value, which barely
      moves when cash converts to equity, so it cannot see a funding gap (2026-08-26 near-miss: a −0.07%
      book move alongside a stale $1,380 plan against $23.75 of real cash). Buying power is the check that
      actually catches it, and on 2026-08-28 it did: a $26.94 buy against $0.90. Placing anyway just earns
      a broker rejection; report the gap instead and leave the ticket alone.
   b. `get_earnings_calendar` for the buy names — drop any reporting ≤ 7d (the gate's plan has no earnings
      map; this is where the blackout is enforced).
   c. `get_equity_orders` on **••••3900** for today (**PDT guard, v98**) and on the **margin** account
      (…0741) over a 30-day window. Today's ••••3900 fills feed `accountActivity` — **drop any sell of a
      name bought earlier today** (a day trade; this book is under $25k), and **overlay them onto the
      gate's ledger-derived buy/sell dates** (2026-08-12 churn governor: the gate already passed
      `{SYM:{lastBuyDate,lastSellDate}}` from `agentic-decisions.json`; your live fills cover anything
      placed since its last append). A sell of a name bought <14d ago, or a buy of a name sold <14d ago,
      that somehow reaches you anyway must be dropped for the same reasons the planner would have
      (min-hold / re-entry cooldown) — unless the plan explicitly carries the business-broken drop or
      deep-loss override. A recent margin-account buy of
      the same symbol kills a harvest (keep exits, flag `washRisk`). The gate can see neither, so this is
      the only place both are enforced. **Also (v105): `get_pnl_trade_history` on the margin account
      (…0741, span `month`) — drop any BUY of a name that account realized a LOSS on within 30 days**
      (cross-account wash; keep the target weight, defer like the gate's own wash deferral). The
      snapshot's merged ledger covers losses up to the last producer run; this live call covers a loss
      the owner books between that run and this executor pass — the exact gap that let a Jul-29 NVDA
      loss in ••••0741 get partially disallowed by an Aug-11 agentic rebuy.
   d. Place **sells first** (losses first, then smallest gain), **confirm they FILL**, then place the buys
      — instant settlement makes the proceeds spendable on fill, so the whole ticket goes in one session.
      Fractional **dollar-market** orders via `review_equity_order → place_equity_order`, regular hours.
      If a sell is still pending, leave the ticket at `sells-placed`; the next pass places the rest.
   e. Advance the ticket (`advanceTicket` → `sells-placed`, then `buys-placed`/`done`), **append the
      decision** to `agentic-decisions.json`, commit + push both files,

      > **`makeDecision` takes `spyAt` AND `target`. Both. Every time.**
      > `target` is the committed `agentic-target.json` — and the exec gate already hands it to you:
      > `producer/raw/agentic-plan.json` carries it as `target`, so pass that straight through. It
      > stamps each BUY leg with the name's `drivers[]`, which is the only input the Rebalance Log's
      > sleeve attribution has. **Omit it and that rebalance is invisible to attribution permanently** —
      > the stamp is decision-time only and cannot be backfilled, because a leg matched against a later
      > target would be credited to a thesis that did not pick it. Nothing errors when it is missing;
      > `makeDecision` logs a loud warning instead, so check the run output.
      > (The executor Routine's own prompt predates this and says only "with `spyAt`". **This runbook
      > wins**, exactly as that prompt instructs. The old claim here — that the prompt "cannot be edited"
      > because the Routine was bound to a persistent session — is **wrong as of 2026-09-02**: the trigger
      > was updated on 08-31, and since 09-02 it is a fresh-session Routine, so `update_trigger` edits its
      > prompt in place like any other. The code-level guards stay anyway, as belt and braces: the gate
      > writes `target` into `raw/agentic-plan.json`, and `makeDecision` warns loudly when either `target`
      > or a positive `spyAt` is missing. Prefer a code guard to prompt wording for anything load-bearing —
      > prompts are server-side and drift out of sight of this repo.)

      **Also stamp `completedAt` (ISO, the last fill's timestamp) on the ticket when you close it.**
      The gate reads it to refuse re-planning against a snapshot that predates those fills. Caught live
      2026-08-25: minutes after a $1,380 ticket filled, the next pass printed `EXEC_AUTO` for the
      IDENTICAL $1,380 plan — the producer had not republished, so the snapshot still showed pre-trade
      cash (live cash was $23.75). **The 5%-book-move abort does NOT catch this**: converting cash to
      equity barely moves book value (-0.07% in that case) while deployable cash collapses, so the check
      that guards against a moving market is blind to a ticket you just executed. Without the stamp the
      gate falls back to a coarse "closed today" test — that only costs idle passes, never a bad trade.

      PushNotification the fill report.
   f. **PARKING LEDGER (v102) — do not skip this.** If the plan carried a `parking.parked` leg (a buy
      flagged `parked: true`) or a `parking.released` leg (`kind: 'park-release'`), rewrite
      **`producer/agentic-parked.json`** from the plan's `parking.after` once those orders FILL, and
      commit + push it alongside the other two files. This is the **third and only other committable
      file** for the executor — `data.json` stays off-limits, and `raw/` is wiped every run, so this
      committed file is the sole system of record for the waiting ground. **Skipping it silently breaks
      the mechanism**: the ledger would read $0 while the vehicle is actually held, so the next pass
      sees an unexplained position, can't release it to fund a cleared name, and — because the
      off-target-exit exemption keys off the SAME `parkVehicle` — would leave real money stranded in a
      placeholder nothing knows about. Set `dollars`, `forNames` (the deferred names it stands in for),
      and `since` (first park date); append a `{date, action, dollars, forNames}` row to `history`.
4. **`EXEC_BUYS`** — a carried buy leg (a ticket whose sells were placed on an earlier pass, or one written
   under the pre-v98 two-leg model): verify buying power actually covers it, place the orders, advance to
   `buys-placed` → `done`, append/extend the ledger record, commit + push, push the report.
5. Never gate or touch the data producer's publish. On ANY placement error: stop, leave the ticket state
   as-is (idempotent — the next pass re-checks open orders via `get_equity_orders` before re-placing),
   and push a failure note instead of improvising.

**Files the executor may commit — the complete list:** `producer/agentic-pending.json` (the ticket),
`producer/agentic-decisions.json` (the graded ledger), and — since v102 — `producer/agentic-parked.json`
(the waiting ground). Nothing else, and **never `data.json`**: the producer owns that file, and the
executor writing it would race the publish. Any executor state must therefore live in one of these three.

## The churn governor (2026-08-12)
Added after a real 48-hour whipsaw: the 08-05 target dropped GE/LLY/AMZN/MSFT (all exited 08-10, buying
AAPL/UNH/V), then the 08-11 target re-included the four and dropped the three (all reversed 08-12) — a
near-total book flip with every leg short-term taxable, driven by nothing but two weekly research runs
disagreeing at the margin. The research is memoryless and the planner executed the full delta; neither
priced the cost of changing its mind. Four rules now stand between a target refresh and the trades:

- **Two-strike phase-out** (`finalize-target.mjs`): a held name dropped by ONE refresh is retained at its
  prior weight (`phaseOut:true` — zero trades; the planner holds it but never adds). Dropped by TWO
  consecutive refreshes → a real off-target exit. An explicit `businessOk:false`/`avoid` verdict skips the
  grace period (`target.dropped`, reason `business-broken`).
- **Min-hold** (`agentic-deploy.mjs`, 14d): a name bought inside the window is not exited or trimmed.
  Overrides: business-broken drop, a position down ≥10% (risk control outranks churn control), TLH
  harvests and park-releases (own floors/purpose). Day 0 remains the harder PDT day-trade block.
- **Re-entry cooldown** (14d): a name this account sold inside the window is not rebought; the weight
  parks in the VTI waiting ground until the window clears. (The wash-sale ledger already blocks
  loss-sale rebuys 30d — this covers gain-sells, which is what the 08-10 exits were.)
- **Dust floor** ($25): no more $1.80 orders.

The research workflow is also handed the current book + prior target (`args.held` / `args.priorTarget`)
and told the current book is the null hypothesis — the deterministic layer is the backstop, but the
cheapest churn is the churn never proposed. As the book grows, these same rules scale: the toll is
proportional (ST tax + spread on every flipped dollar), so what was a ~$240 annoyance at $10k becomes
real money at $100k — which is why the governor is code, not prose.

## Entry discipline, the idle-cash deadline, and the waiting ground (v102)
Three linked rules the planner enforces, all added 2026-08-11 after a live re-verification exposed them:

- **Symmetric entry band.** A buy defers only when price is more than `ENTRY_TOLERANCE_PCT` (2.5%) *below*
  the entry floor or more than `ENTRY_PREMIUM_PCT` (2.0%) *above* the ceiling. Previously there was no
  tolerance (a 0.2% miss parked a whole position) and no upper bound at all, so a target whose zones were
  set deliberately below spot would have been bought straight through. `below-stop` is deliberately **not**
  banded — at/below the stop is the genuine thesis-broken signal and stays absolute.
- **Zones expire.** Past `ENTRY_ZONE_STALE_DAYS` (7 days from `target.asOf`) the bands go advisory and are
  skipped. Zones are written against the prices of the day the research ran; when most of the target reads
  "out of band" at once, the guard is measuring its own staleness, not the companies.
- **The waiting ground (`PARK_VEHICLE` = VTI).** Deferred dollars are parked in a broad-market placeholder
  rather than left in cash, and released to fund each name as it clears. VTI rather than SPY so the
  placeholder is visibly separate from the target's SPY ballast (and the two aren't substantially identical
  for wash-sale purposes); not QQQ, which would concentrate into the capped megacap-tech cluster. The
  vehicle is **exempt from off-target exits** — it is absent from the target by design, and without the
  exemption the orphan rule would sell it every pass while parking rebuilt it. Releases are taxable ST
  sales: floored at `PARK_MIN` ($100), sized to the actual shortfall, PDT-guarded, losses-first ordered.
  **And the floor is INHERITED BY THE BUY (2026-08-28).** The funding pool counts the waiting ground, but
  a release can legitimately decline to fire — shortfall under `PARK_MIN`, the parked block itself under
  it, or the day-trade guard bouncing the leg — and the buys were still sized as though those dollars had
  been freed. Live that day: $485.99 parked against $0.90 of cash, a $26.94 JNJ top-up needing $26.04 of
  release, the floor correctly suppressing the dust sale, and the buy shipping anyway with
  `buysNeedProceeds:false` and a "fully funded to target" warning both swearing it was covered. The
  planner now re-sizes the buys against cash + proceeds alone, so a sub-floor top-up simply waits; a
  0.23pp drift correction is not worth a taxable ST sale of the placeholder, which is the same judgement
  `PARK_MIN` already makes about the sale itself. A hard invariant backs it — **spend must never exceed
  cash + proceeds + an actual release leg** — and a breach pushes a `PLANNER BUG` warning rather than
  shipping quietly.
- **Idle-cash deadline (backstop).** If cash still sits past `CASH_IDLE_DEPLOY_DAYS` (10, tracked by
  `data.agentic.cashIdleSince`), the bands are waived and the balance deploys in ~thirds
  (`CASH_IDLE_TRANCHE_PCT`), sweeping whole under `CASH_IDLE_SWEEP_FLOOR`. Waiting indefinitely is a
  decision too, and cash drag is a loss that never shows up as one.

## Robinhood writes from this account
The **executor** (above) is the only thing that places orders here: unattended within the **auto tier**
(≤ $10,000 turnover/ticket since 2026-08-25), owner-confirmed above it. The **data producer** remains READ-ONLY on ••••3900
(it only fetches for display; its only Robinhood writes anywhere are the two watchlist syncs).
