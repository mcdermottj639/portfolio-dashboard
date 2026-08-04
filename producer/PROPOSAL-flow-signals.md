# PROPOSAL — Political / insider "flow" signals in the agentic research

**Status:** awaiting sign-off · **Author:** Claude session 2026-08-04 · **Branch:** `claude/agentic-research-integration-o8nvo8`

Trigger: owner shared the **@Trump_portfolio "Trump Tracker"** X account (50.4K followers, "Never miss a
Trump trade again", pinned post about the OGE financial-disclosure release — 900 pages, 6,000+ trades,
$1.9B volume) and asked whether pages like it could feed the **agentic-research** workflow.

---

## 1. The short answer

**Not the page — the filings underneath it.** That account is a repackager of statutory disclosures
(STOCK Act periodic transaction reports for Congress; OGE Form 278 for the executive branch). Scraping X
is a dead end: no usable API for this, ToS problems, unstructured prose, and a curated feed is an
editorial layer between us and the data. The primary data is available as structured JSON.

**But once you look at the actual data, the honest verdict is: context, not conviction.** Everything
below is measured from live probes against our existing keys on 2026-08-04, not assumed.

---

## 2. What is actually reachable today (live-probed)

| Source | Endpoint | Works on our key? | Granularity | Observed lag |
|---|---|---|---|---|
| **FMP congressional** | `stable/senate-latest`, `stable/house-latest` | ✅ **yes** | `page=0` only, `limit≤25` → **50 newest rows per poll** | Senate **p50 116 days**; House **p50 40 days** |
| FMP congressional by symbol | `stable/senate-trades?symbol=` | ❌ **restricted** (tier) | — | — |
| **Finnhub insider (Form 4)** | `stock/insider-transactions` | ✅ **yes, by symbol** | per-filer, share counts, real prices, txn codes | filing ≈ T+2 to T+5 |
| **Finnhub insider sentiment** | `stock/insider-sentiment` (MSPR) | ✅ **yes, by symbol** | monthly net-buy score | ~1 month |
| Finnhub congressional | `stock/congressional-trading` | ❌ **restricted** (tier) | — | — |
| Alpha Vantage `INSIDER_TRANSACTIONS`, `NEWS_SENTIMENT` | MCP connector | ✅ in-session only | — | — |
| Trump / executive branch (OGE 278) | annual PDF | scrape-only | ranges, largely managed accounts + fixed income | **annual** |

Notes that matter for design:

- `FINNHUB_KEY` and `FMP_KEY` are already set, and `finnhub.io` / `financialmodelingprep.com` are already
  on the egress allowlist (`extfund-fetch.mjs` uses both). **Zero new infrastructure or secrets.**
- `ALPHAVANTAGE_KEY` is **not** set — AV is reachable only through the MCP connector inside a Claude
  session. So AV-based signals can feed the **weekly research workflow** but *not* the deterministic
  daily producer. Finnhub can feed both.
- The by-symbol congressional endpoint being restricted means we can't ask "who traded NVDA" — we'd have
  to poll the firehose and **build our own symbol index locally**, accumulating forward.

## 3. Why the congressional signal is weaker than the feed makes it look

Three independent reasons, all checkable:

1. **The lag is fatal to the trade.** Senate disclosures in our live sample had a **median 116-day** gap
   between transaction and disclosure; House **40 days**. Post-STOCK-Act academic work finds the
   historical edge largely compressed; the one supportive figure (~4.9% over three months from following
   senators) rests on older, pre-STOCK-Act-style data.
2. **The ETF evidence is a factor tilt wearing a costume.** NANC (Democrat-tracking) ~27% annualized vs
   KRUZ ~13%, but **neither shows significant risk-adjusted outperformance vs SPY** — NANC's return
   tracks its megacap-tech concentration, not any informational edge.
3. **It points straight into the concentration we deliberately cap.** In our own live pull, the most
   active House names were **AMAT, SPGI, MNST, META, MSFT, TSM, NVDA**. Four of those sit inside the
   `megacap-tech` correlation cluster that `riskweights.mjs` caps at **≤48%**. Naively weighting this
   signal would spend our risk budget re-buying the exact co-moving complex the v93 work was built to
   contain. This is the single strongest argument against giving it conviction weight.

Add: amounts are **bucketed ranges** (`$1,001 – $15,000`), so it can never inform sizing; the feed is
heavily diluted by bonds, ETFs, spouse accounts and advisor-managed trades; and on our tier we see only
the 25 newest rows per chamber per call, so coverage is a rolling window, not a census.

**The Trump/OGE feed specifically** — annual cadence, ranges, third-party-managed accounts dominated by
fixed income. It is a news product, not a signal. **Recommend: skip entirely.**

---

## 4. Three ideas, ranked (the workshop)

The interesting result of the research is that **the adjacent signal is much better than the one that
prompted the question**, and it's free and already wired.

### 💚 Idea 1 — **Insider Conviction (Form 4)** · *build this first*

Corporate insiders filing Form 4 are the version of this idea with a real evidence base, a **2–5 day**
lag instead of 40–116, **exact** share counts and prices, and per-symbol queries that map onto our
existing coverage universe. `stock/insider-sentiment` even gives a ready-made monthly net-buy score (MSPR).

- Cluster rule: **≥3 distinct insiders, same direction, ≤90 days**, open-market codes only (`P`/`S` —
  exclude `G` gifts, `A` grants, `M` option exercises, which is most of the raw volume).
- Weight officers/directors above 10% holders; weight buys far above sells (insiders sell for a hundred
  reasons and buy for one).
- Feeds the existing **catalyst sleeve** (which already nominally references insider data but has no
  deterministic input) and shows as a chip on Analyze.

### 🟡 Idea 2 — **Policy-catalyst calendar** · *the thing the tracker crowd is actually trading*

The value in "Trump trades" isn't the disclosed trade — it's the **forward-dated policy event**. Our
catalyst machinery today knows only earnings dates and news sentiment. A small committed
`producer/policy.json` of dated, scheduled policy events (tariff deadlines, PDUFA/FDA dates,
appropriations and defense authorizations, antitrust rulings, major regulatory comment closes), each
mapped to affected tickers/sectors, is:

- **forward-looking**, unlike everything in Idea 3;
- reusable as a **deferral rule** in `agentic-deploy.mjs` — a *policy blackout* exactly parallel to the
  existing ~7-day earnings blackout ("don't deploy new money the week of the tariff ruling");
- cheap: no API, refreshed by the weekly research agent as part of its catalyst work.

### 🟠 Idea 3 — **Washington Flow (congressional)** · *context strip, capped tiebreaker*

Ingest `senate-latest` / `house-latest`, accumulate forward, surface it — but hold it to a strict
altitude given §3.

- **Cluster gate:** ≥3 distinct filers, same direction, within 45 days, `assetType` = Stock, non-empty
  symbol. Everything else is discarded as noise.
- **Cluster-cap exclusion:** a name inside the `megacap-tech` correlation cluster gets **no** political
  nudge, ever. (Guards the §3.3 beta mirage.)
- Realistic expectation: with 50 rows/poll the gate will fire rarely for non-megacap names. That is the
  point — rare and clean beats frequent and noisy.

### ⛔ Idea 4 — **Mirror-trading / the Trump OGE feed** · *recommend rejecting*

Copying disclosed trades at a 40–116 day lag into a $4,955 taxable cash account, where every sell is a
short-term gain and proceeds settle T+1, is the worst-fit strategy we could bolt onto this account. Named
here only so the "no" is on the record.

---

## 5. Architecture (mirrors patterns already in the repo)

Nothing novel — each piece copies an existing, tested shape.

| New file | Pattern it copies | Role |
|---|---|---|
| `producer/insider.mjs` | `extfund.mjs` (pure normalizers) | Form 4 → cluster score; **unit-tested** |
| `producer/insider-fetch.mjs` | `extfund-fetch.mjs` (HTTP + once/day ET gate) | Finnhub per-symbol over `coverFromRaw` |
| `producer/polflow.mjs` | `alerts.mjs` / `agentic-triggers.mjs` (pure, no I/O) | firehose → cluster detection; **unit-tested** |
| `producer/polflow-fetch.mjs` | `extfund-fetch.mjs` | 2 calls/poll, degrades silently |
| `producer/policy.json` + `policy.mjs` | `agentic-decisions.json` + `agentic-ledger.mjs` | committed dated event list → holdings mapping |
| `producer/*.test.mjs` for each | existing `producer/*.test.mjs` | CI already runs `producer/**` tests on PR |

**Accumulation.** `producer/raw/` is gitignored and empty on every scheduled run, so the rolling window
*cannot* live there. It lives in the snapshot as **`data.polflow.events` / `data.insider`**, carried
forward and capped at ~120 days — precisely the `ivHistory` / `equityHistory` pattern in `build-data.mjs`.

**Research workflow.** Deliberately **do not** add a 5th scoring sleeve — that would force a rebalance of
the composite weights (`0.22 m / 0.24 q / 0.22 g / 0.14 c / 0.18 v`) and hand an unproven signal a
permanent share of the score. Instead:

- pass insider + policy evidence **into the existing catalyst sleeve prompt** (weights untouched), and
- pass political flow as a **`flags` payload into the adversarial *verify* stage only** — where it can
  contribute to refuting or supporting a name that already earned its way to the finalist list, and can
  never manufacture a candidate on its own.

**Consumer.** One new **🏛️ Washington & Insider Flow** card on the Plan page + an Analyze chip + a `HELP`
entry, with the usual `APP_VERSION` / `CACHE_VERSION` bump.

**Attribution.** Add `drivers:[]` to each `agentic-target.json` name so the **🧾 Rebalance Log** can
eventually answer *"is this signal earning its weight?"* — the same discipline the picks Track Record
applies to the oversold screen. This is what makes the whole thing safe to add: it can be measured, and
therefore removed.

---

## 6. Guardrails (the part worth signing off on)

1. **Never a sole reason to buy.** Flow can only co-sign a name that already survived adversarial verify.
2. **Hard influence cap** — ≤ **±0.4** composite points (for scale: `DOWNTREND_PENALTY` is 3.0), and at
   most **one** flow-promoted name into the finalists per weekly run.
3. **Cannot override any existing risk rule** — correlation-cluster cap, vol-scaled cap, wash-sale window,
   earnings blackout, gap-through-entry deferral, or the 10-day stop-out cooldown. Flow is a tiebreaker
   inside those rails, never a bypass.
4. **Megacap-tech cluster exclusion** for the political signal (§3.3).
5. **Display-only burn-in.** Ships with **zero** effect on the target for **6 weeks**; it only earns weight
   after we can look at real accumulated data and confirm it isn't noise.
6. **Silent degradation + kill switch.** Missing key / restricted tier / bad response → skipped with a log
   line, prior data kept (`extfund-fetch.mjs` behaviour). `PF_FLOW=off` disables it outright.
7. **Fault-isolated, post-publish.** Like the watchlist syncs — it can never gate or delay a `data.json`
   publish.

## 7. Cost

- FMP: 2 calls/poll. Even polling every run (~13/day) = **26 of 250** daily calls.
- Finnhub: ~2 calls × ~36 symbols, once/day, throttled under the 60/min limit.
- Research workflow: **no new agents** (evidence folds into existing catalyst + verify prompts).
- Consumer: one card. No new dependency anywhere.

---

## 8. Sign-off options

| | Scope | Effort |
|---|---|---|
| **A** | **Idea 1 only** — Insider Conviction (Form 4 clusters) into the catalyst sleeve + Analyze chip | ~1 session |
| **B** | **Ideas 1 + 2** — insider + policy-catalyst calendar with a policy-blackout deferral in `agentic-deploy.mjs` | ~1–2 sessions |
| **C** ⭐ | **Ideas 1 + 2 + 3 (display-only)** — everything above plus the Washington Flow card, no target influence until the 6-week burn-in passes | ~2 sessions |
| **D** | **C, but flow gets its capped ±0.4 tiebreaker immediately** (skip the burn-in) | ~2 sessions |
| **E** | Do nothing — record the finding and move on | 0 |

**Recommendation: C.** It captures the genuinely good signal (insider Form 4) and the genuinely
forward-looking one (policy calendar) immediately, gives the political feed a place to prove or disprove
itself against real accumulated data, and commits none of the risk budget to a signal whose headline
evidence dissolves into a megacap-tech beta tilt on inspection.
