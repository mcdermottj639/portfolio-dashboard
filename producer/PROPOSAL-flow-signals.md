# PROPOSAL v2 — Flow & Positioning layer for the agentic research

**Status:** awaiting sign-off on one open question (§8) · **Branch:** `claude/agentic-research-integration-o8nvo8`
**Owner decisions locked in so far:** political flow = **verify-stage evidence only, never a score input**; scope = **don't shrink it to the screenshot**.

Trigger: owner shared the **@Trump_portfolio "Trump Tracker"** X account and asked whether pages like it
could feed the **agentic-research** workflow. v1 of this proposal answered that narrowly. This v2 answers
the follow-up — *"is this the fullest and best way we can do it?"* — after probing the entire adjacent
data surface against our existing keys.

**v1's answer was correct but under-scoped.** The political feed is the weakest member of a family of
signals we can reach today, and three of its siblings are considerably better. The full layer is below.

---

## 1. Everything reachable today, probed live (2026-08-04)

All against **existing** `FINNHUB_KEY` / `FMP_KEY` (both domains already on the egress allowlist via
`extfund-fetch.mjs`) and the Alpha Vantage **MCP connector** (`ALPHAVANTAGE_KEY` is *not* set, so AV is
session-only — usable by the weekly workflow, not by the daily producer).

### ✅ Live and usable

| Signal | Endpoint | Shape | Freshness |
|---|---|---|---|
| **Analyst revision momentum** | FMP `stable/grades`, `grades-historical`, `grades-consensus`; Finnhub `stock/recommendation` | individual upgrade/downgrade actions **and** a monthly strongBuy/buy/hold/sell distribution time series | days |
| **Insider Form 4 clusters** | Finnhub `stock/insider-transactions`, `stock/insider-sentiment` | per-filer share counts, real prices, txn codes; monthly MSPR net-buy score | filing T+2–T+5 |
| **Earnings surprise / PEAD** | Finnhub `stock/earnings` | estimate vs actual, `surprisePercent`, by quarter | quarterly |
| **Federal contract awards** | Finnhub `stock/usa-spending` | awarded contracts w/ `totalValue`, `outlayedAmount`, recipient + parent | ongoing |
| **Corporate lobbying spend** | Finnhub `stock/lobbying` | per-company federal lobbying disclosures | quarterly |
| **M&A flow** | FMP `stable/mergers-acquisitions-latest` | acquirer/target pairs w/ CIKs | days |
| **Congressional PTRs** | FMP `stable/senate-latest`, `house-latest` | `page=0`, `limit≤25` → 50 newest rows/poll | **Senate p50 116d, House p50 40d** |
| **Insider firehose** | FMP `stable/insider-trading/latest` | cross-market Form 4 stream | days |
| **13F breadth** | AV MCP `INSTITUTIONAL_HOLDINGS` | summary header: holders increased/decreased, % institutional | quarterly, stale |
| **Company news** | Finnhub `company-news` | headline stream | intraday |

### ❌ Probed and rejected

| | Why |
|---|---|
| AV `HISTORICAL_PUT_CALL_RATIO` | **Returns all zeros** on our tier — dead data, not a tier warning. Options-positioning signal is off the table. |
| Finnhub `upgrade-downgrade`, `price-target`, `fund-ownership`, `social-sentiment`, `supply-chain` | restricted (FMP `grades` covers upgrades/downgrades, so no real loss) |
| FMP `institutional-ownership`, `etf/holdings`, transcripts, `insider-trading/statistics`, by-symbol congressional | restricted |
| Trump / executive-branch OGE 278 | annual PDF, bucketed ranges, advisor-managed accounts, largely fixed income — a news product, not a signal |
| Mirror-trading disclosed congressional trades | 40–116 day lag into a $4,955 **taxable cash account** where every sell is short-term and proceeds settle T+1 — worst possible fit |

### 🎁 Two incidental free fixes found while probing

Not part of this proposal's thesis, but they close documented gaps and cost one call each:

- **FMP `stable/treasury-rates`** returns the **entire curve daily in one call** (1m→30y). CLAUDE.md notes
  the Markets **2s10s tile shows "—"** whenever a run captured AV's 10-year but not the 2-year. This
  removes that failure mode permanently.
- **FMP `stable/economic-indicators`** gives GDP/CPI-class series over HTTP — a backstop for the macro
  tiles that today depend on the AV MCP connector being reachable in-session.

---

## 2. Why the political signal is the weakest member of its own family

Three independent reasons, all measured rather than assumed:

1. **The lag is fatal.** Live sample: Senate **median 116 days** between transaction and disclosure;
   House **40 days**. Post-STOCK-Act work finds the historical edge largely compressed.
2. **The ETF evidence is a factor tilt in costume.** NANC ~27% annualized vs KRUZ ~13%, but **neither
   shows significant risk-adjusted outperformance vs SPY** — NANC's return tracks its megacap-tech
   concentration, not information.
3. **It points into the concentration we deliberately cap.** In our own live pull the most active House
   names were **AMAT, SPGI, MNST, META, MSFT, TSM, NVDA** — four sit inside the `megacap-tech` cluster
   `riskweights.mjs` caps at ≤48%. Weighting it would spend risk budget re-buying the exact co-moving
   complex v93 was built to contain.

Plus: amounts are **bucketed ranges** (`$1,001–$15,000`) so it can never inform sizing; the feed is
diluted by bonds, ETFs, spouse and advisor-managed accounts; and our tier sees only a rolling 50-row
window, not a census.

**Conclusion — and this is the reframe:** the valuable part of the "Washington" theme isn't *what a
politician disclosed buying four months ago*. It's **where federal money is actually going** (contract
awards), **which companies are fighting regulatory battles** (lobbying spend), and **what is scheduled to
happen next** (policy calendar). Those are forward-linked to revenue. The PTR feed is the rear-view
mirror of all three.

---

## 3. The full layer, ranked by evidence strength

### Tier 1 — well-evidenced, fresh, free, per-symbol

| # | Signal | Why it earns weight |
|---|---|---|
| **1** | **Analyst revision momentum** | Post-revision drift is among the most robustly documented equity anomalies. `grades-historical` gives a *time series* of the rating distribution, so we can measure the **direction of change**, not just the level. **This is the single best addition in the entire survey — and it has nothing to do with the screenshot.** |
| **2** | **Insider Form 4 clusters** | The version of "follow the informed trader" with a real evidence base: 2–5 day lag, exact share counts and prices. Gate: **≥3 distinct insiders, same direction, ≤90 days**, open-market codes only (`P`/`S`; exclude `G` gifts, `A` grants, `M` exercises — which is most of the raw volume). Officers/directors > 10% holders; buys weighted far above sells. |
| **3** | **Earnings surprise / PEAD** | `surprisePercent` history feeds post-earnings-announcement drift, and pairs with the existing earnings-blackout deferral. |

### Tier 2 — the *real* Washington signals (orthogonal, forward-linked)

| # | Signal | Why |
|---|---|---|
| **4** | **Federal contract awards** (`usa-spending`) | Actual dollars awarded, visible before they reach the income statement. This is what the political theme *should* have been. |
| **5** | **Lobbying intensity** (`lobbying`) | Best used as a **policy-beta risk flag** — a name spending heavily in a contested area carries regulatory tail risk — not as a buy signal. |
| **6** | **Policy-catalyst calendar** (`producer/policy.json`, agent-maintained) | Forward-dated events (tariff deadlines, PDUFA, appropriations, antitrust rulings) → a **policy blackout** in `agentic-deploy.mjs`, exactly parallel to the existing ~7-day earnings blackout. |

### Tier 3 — context only, no score weight

| # | Signal | Role |
|---|---|---|
| **7** | **Congressional PTRs** | **Verify-stage evidence only** (owner's decision). Cluster gate: ≥3 distinct filers, same direction, ≤45 days, `assetType`=Stock, non-empty symbol. **Megacap-tech cluster names excluded from any nudge, ever** (guards §2.3). |
| **8** | **M&A flow** | Primarily a *risk* flag — a held name appearing as an acquirer (integration/dilution risk) or target (event-driven, don't chase). |
| **9** | **13F breadth** | Quarterly and stale; slow confirmation at most. Read only the AV summary header — the full payload is 440k tokens. |

---

## 4. What this does to the research workflow

**v1 said "no 5th sleeve." v2 reverses that — and the reversal is the substance of the widened scope.**

The v1 argument was: *don't give one unproven signal permanent share of the composite.* That argument
holds for the political feed alone. It does **not** hold for a **diversified sleeve** whose components
(revisions, insider clusters, surprise drift, federal awards) each carry their own literature and their
own failure modes. Four weakly-correlated evidenced signals in one sleeve is a different proposition from
one weak signal in five.

**Proposed composite change** (`agentic-research.js`, currently `0.22 m / 0.24 q / 0.22 g / 0.14 c / 0.18 v`):

| Sleeve | Now | Proposed |
|---|---|---|
| Momentum | 0.22 | 0.20 |
| Quality | 0.24 | 0.22 |
| Growth | 0.22 | 0.20 |
| Catalyst | 0.14 | 0.12 |
| Valuation | 0.18 | 0.16 |
| **Flow & Positioning (new)** | — | **0.10** |

Flow sleeve composition, internally: **revisions 40% · insider 30% · surprise 20% · federal awards 10%.**
**Congressional PTRs contribute 0%** — they enter the *adversarial verify* prompt only, per the owner's
decision, where they can help refute or support a name that already earned its finalist slot but can
never manufacture a candidate.

Weight is taken proportionally so no existing sleeve's *relative* standing changes.

---

## 5. Architecture

Every piece copies a pattern already in the repo.

| New file | Copies | Role |
|---|---|---|
| `producer/flow.mjs` | `extfund.mjs`, `riskweights.mjs` (pure) | normalizers + the 4 component scores + sleeve composite; **unit-tested** |
| `producer/flow-fetch.mjs` | `extfund-fetch.mjs` (HTTP, once/day ET gate, silent degradation) | Finnhub per-symbol + FMP firehose |
| `producer/polflow.mjs` | `alerts.mjs`, `agentic-triggers.mjs` (pure, no I/O) | PTR cluster detection; **unit-tested** |
| `producer/policy.json` + `policy.mjs` | `agentic-decisions.json` + `agentic-ledger.mjs` | committed dated event list → holdings mapping → blackout |
| `producer/*.test.mjs` | existing tests | CI already runs `producer/**` tests on every PR |

**Accumulation.** `producer/raw/` is gitignored and empty on every scheduled run, so the rolling window
cannot live there. It lives in the snapshot as **`data.flow` / `data.flow.polEvents`**, carried forward
and capped at ~120 days — precisely the `ivHistory` / `equityHistory` pattern in `build-data.mjs`.

**Call budget — a real constraint.** `extfund-fetch.mjs` already spends ~5 FMP calls/symbol/day (~180 for
a 36-name universe), close to the free tier's daily ceiling. So the design **routes revision momentum
through Finnhub `recommendation`** (1 call/symbol, free, 60/min) and uses FMP `grades` only for the ~10
weekly finalists. Finnhub load: ~6 calls/symbol/day ≈ 216, throttled under 60/min ≈ 4 minutes, once/day.
FMP load: unchanged +2/poll for PTRs +1 for treasury rates.

**Consumer.** One **🏛️ Flow & Positioning** card on the Plan page (revision arrow, insider cluster chip,
federal-award badge, Washington-flow strip), an Analyze chip, a `HELP` entry, and the usual
`APP_VERSION` / `CACHE_VERSION` bump.

**Attribution.** Add `drivers:[]` to each `agentic-target.json` name so the **🧾 Rebalance Log** can
answer *"is the flow sleeve earning its 10%?"* — the same discipline the picks Track Record applies to
the oversold screen. This is what makes the layer safe to add: measurable, therefore removable.

---

## 6. Guardrails (unchanged from v1, extended)

1. **Political flow never scores.** Verify-stage evidence only; excluded entirely for megacap-tech names.
2. **Flow sleeve capped at 10%** and cannot override *any* existing risk rule — correlation-cluster cap,
   vol-scaled cap, wash-sale window, earnings blackout, gap-through-entry deferral, or the 10-day stop-out
   cooldown. It is a tilt inside those rails, never a bypass.
3. **No signal is ever a sole reason to buy** — a name must still survive adversarial verify.
4. **Burn-in.** Ships display-only for **4 weeks** before the sleeve weight is switched on; the composite
   reweight is one constant, flipped in a one-line change once we've seen real accumulated data.
5. **Silent degradation + kill switch.** Missing key / restricted tier / bad response → skipped with a log
   line, prior data kept (`extfund-fetch.mjs` behaviour). `PF_FLOW=off` disables the layer outright.
6. **Fault-isolated, post-publish** — like the watchlist syncs, it can never gate or delay a `data.json` publish.

---

## 7. Phasing

| Phase | Contents | Gate |
|---|---|---|
| **1** | `flow.mjs` + `flow-fetch.mjs` + tests · insider clusters, revision momentum, surprise · `data.flow` · Analyze chip · **the two incidental fixes (treasury curve, macro backstop)** | ships immediately, display-only |
| **2** | Federal awards + lobbying + `policy.json` + policy blackout in `agentic-deploy.mjs` · Plan-page card | after 1 |
| **3** | `polflow.mjs` PTR ingest → verify-stage evidence + Washington strip · M&A + 13F context | after 2 |
| **4** | Flip the composite reweight (§4) on · `drivers:[]` attribution in the Rebalance Log | after the 4-week burn-in |

---

## 8. The one open question

Everything above is signed off except this, because it changes how your target is scored:

**Does the Flow & Positioning sleeve get 10% of the composite (§4), or does it stay out of the score
entirely and feed only the catalyst + verify prompts as evidence?**

- **Take the 10%** — the layer can actually move the target. Requires trusting four evidenced-but-new
  signals with a real (if small) share, and reweights five existing sleeves.
- **Evidence-only** — composite math is untouched; flow informs the catalyst sleeve's reasoning and the
  adversarial verify stage. Strictly safer, strictly less powerful, and harder to attribute later.

Recommendation: **take the 10%, after the Phase-4 burn-in.** 10% is small enough that a bad sleeve costs
little, `drivers:[]` makes it measurable, and if it doesn't earn its keep the reweight is one constant to
revert.
