# Gotchas / hard-won lessons

> **ARCHIVE / REFERENCE — not default context.** Moved verbatim from the repo-root `CLAUDE.md` on 2026-11-18 (docs/process-only PR). Nothing here was rewritten. Where this text conflicts with the root `CLAUDE.md`, the root file wins: it holds the current ACTIVE RULES. Labels used there: ACTIVE RULE / CURRENT STATE / HISTORICAL / UNVERIFIED.

> Load before changing the area a lesson names. Index below = the bold lead of each lesson; `grep -n -F "<first words>" docs/claude/gotchas.md` then `sed -n <line>,+40p` reads one.

## Index

- AV MCP responses come in THREE shapes — `parseAV()` must accept all of them.
- `data.hist` bar shape differs by producer — consumer must accept BOTH.
- `data.hist.day` can trail the live quotes by days — `fetchHist` splices the live bar on (v111).
- `data.hist.day` goes STALE PER SYMBOL, and a momentum scorer reads stale bars as a perfect score.
- A TRACK RECORD GRADED OFF A SERIES THAT STOPS MEASURES THE DATA, NOT THE STRATEGY (2026-09-09).
- THE DEPOSIT INFERENCE WAS PRICING THE BOOK ON TWO DIFFERENT CLOCKS (2026-08-30).
- A PREDICTION-MARKET WIN LOOKS EXACTLY LIKE A DEPOSIT (2026-08-30).
- Robinhood's `equity_value` is GROSS long market value — the account's equity is `total_value` (v116).
- Robinhood's option money units differ between orders and positions — and BOTH call sites had it
- `get_option_quotes` nests `instrument_id` INSIDE `quote` — reading it off the wrapper silently
- Never plan a sell of shares that back a short call (v119).
- The Portfolio background-enrichment block is fault-isolated
- `producer/raw/` is gitignored and EMPTY on every scheduled run
- Never `cp` a result into `producer/raw/` — and the reason is NOT shell variables (corrected
- On `run.mjs` push failure (e.g. a 403 proxy/egress blip): STOP.
- ApeWisdom has NO sentiment field
- Robinhood account access:
- The agentic ••••3900 fetch is EVERY-RUN, not FETCH_ALL — skipping it silently FREEZES the card.
- Never infer a realized loss from a position diff.
- INDEX LOOK-THROUGH IS NOW REPORTED, NOT ENFORCED (owner decision, 2026-08-25).
- A score that only sizes is half a control — `entryQuality` never moved the entry ZONE (2026-08-25).
- SOCIAL IS SELF-DIRECTED ONLY — and the leak path is the UNIVERSE, not the scoring (2026-08-25).
- The research screen could not be judged, because it only ever saw one kind of name (2026-08-25).
- THE DEFENSIVE FLOOR WAS RIGHT FOR A MANDATE THE ACCOUNT NO LONGER HAS (2026-09-08).
- Every risk control in the agentic model was a CEILING until v124 — the book had no FLOOR.
- SELF-DIRECTED MARGIN RUNS ON OWNER BANDS, NOT A LEVERAGE CAP (owner decision, 2026-08-25).
- A GUARD THAT FIRES SILENTLY IS INDISTINGUISHABLE FROM A BROKEN SYSTEM (2026-08-25).
- A SCHEDULED JOB THAT CORRECTLY DOES NOTHING REPORTS THE SAME "SUCCEEDED" AS ONE THAT WORKED
- A ROUTINE THAT HAS NEVER RUN CAN LOG SUCCEEDED EVERY WEEK — AND THE "BACK AND FORTH" WAS THREE
- A ROUTINE BOUND TO A PERSISTENT SESSION IS ONLY AS ALIVE AS THAT SESSION — AND WHEN THE SESSION DIES
- THE TWO ACCOUNTS' POSITION ARRAYS CAME BACK TRANSPOSED — AND ONLY THE RUNNING TOTAL WAS PERMANENT
- THE PLANNER IS ONLY EVER AS RIGHT AS THE ACCOUNT IT WAS HANDED (2026-08-31).
- WIDENING A FUNDING POOL IS NOT THE SAME AS FREEING THE MONEY (2026-08-28).
- A GUARD RENDERED WITHOUT THE TRADE IT GUARDS IS NOISE — AND IT OUTRANKED THE REAL STATUS (2026-09-03).
- A GUARD WITH NO MATERIALITY FLOOR SPENDS REAL MONEY TO SAVE PENNIES — AND THE PARK VEHICLE FEEDS IT
- A PRIVACY TOGGLE IS ONLY AS WIDE AS THE PAGE IT WAS WRITTEN ON (2026-09-04).
- A SHARED COMPUTATION HAS EVERY CALLER, OR IT IS NOT SHARED — THE MANDATE A VERIFY (2026-09-08).
- AN ENCRYPTED FILE COMMITTED ON A SCHEDULE IS A PERMANENT, COMPOUNDING COST (2026-09-08).
- THE ANALYZE PAGE READ STALE BARS AGAINST A LIVE PRICE, AND ITS OWN SCORE HAD NEVER BEEN SCORED
- A WRITER AND A READER OF THE SAME DAY STAMP DISAGREED ON THE TIME ZONE (2026-09-12).
- A THRESHOLD THAT WAS FINE BECAME A SILENT OFF-SWITCH WHEN THE DATA SHAPE CHANGED UNDER IT
- A HELPER SHARED BY TWO TOP-LEVEL FUNCTIONS CANNOT BE A LOCAL CONST — AND THE CRASH ONLY FIRED IN
- A target refresh is not an execution order — the churn governor stands between them (2026-08-12).
- The wash-sale ledger must cover BOTH taxable accounts (v105).
- `get_realized_pnl` REQUIRES `asset_classes`
- Cost discipline:
- `Workflow({name})` CAN SERVE A STALE COPY OF A WORKFLOW YOU EDITED THIS SESSION (2026-09-24).
- A SCHEDULED RUN AND A HAND RUN DO NOT SHARE A CADENCE (2026-09-24).

---
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
  check the last bar's date against `_snapETDate()`, never just `bars.length`. **The producer-side fix
  landed in v141** — `hist-plan.mjs` keeps the whole Analyze bench fresh with 7-bar tails merged by
  `histbars.mergeBars` — but the gate stays, because the bench seeds over ~7 FETCH_ALL days, a name can
  still fall outside it, and a guard that costs nothing when the data is fresh is worth keeping. The Analyze
  page got the same gate in v141 (`azHist`); see the next entry.
- **A TRACK RECORD GRADED OFF A SERIES THAT STOPS MEASURES THE DATA, NOT THE STRATEGY (2026-09-09).**
  The Daily-Picks Track Record card read **0% hit rate · 0W·2L · 42 open · +2.1% avg return** — a
  shape that is internally impossible, since a positive average return alongside a 0% hit rate and
  42 "open" positions means almost nothing was ever graded. It wasn't. `gradePick` walked
  `data.hist.day[sym]` from each scan date, and that series **goes stale per symbol** (the gotcha
  above): the producer only bar-fetches its CURRENT rotation, so a pick's closes freeze within days
  of the scan that named it. **12 of the 44 episodes had ZERO bars after their own pick date** and
  most of the rest had fewer than ten. Regraded against the real closes: **9W·3L, a 75% hit rate.**
  **Four things generalize, and the first is the one worth carrying furthest.**
  **(a) Censoring is rarely symmetric, so "we can only measure some of it" is not a wash.** The
  window we retained was the few days right after each scan — and a stop sits ~6% away while a
  target sits ~13-24% away, so an early dip through the stop lands INSIDE that window while a target
  hit weeks later never does. The measurable slice could only produce losses and "open". A missing
  measurement is not neutral; work out which direction the gap points before trusting what's left.
  **(b) The two halves of the card were on different clocks, and that is what made it look wrong
  rather than merely empty.** Status came from bars that stopped in July; the return came from
  `data.quotes`, which **carries forward per-symbol** (v88) — so **35 of 42** archived names carried
  a frozen quote (VZ and T were two months old) rendered with no as-of date, as if live. The tell was
  a row reading "⛔ STOPPED · +18.3%": ORCL stopped at 127.94 on 07-14 and then rallied to ~158
  without us. **A resolved trade must be measured to its EXIT** — marking it to today prices a
  position nobody holds — and any figure that is not current must carry the date it was current.
  **(c) The fix has to move the measurement to where the data lives, not add more fetching.** Grading
  now happens in `build-data.mjs` via `pickgrade.mjs` and a resolved outcome is **frozen into the
  snapshot** (the v129 marks rule), so the record stops depending on the bars staying fresh forever.
  That is what makes the extra fetch **bounded and self-draining**: only episodes still RUNNING and
  inside their 60-day horizon are ever asked for (`gradingUniverse`, capped at 30), and each one
  leaves the list permanently the moment it resolves. A naive "just fetch all the pick history"
  would have grown without limit.
  **(d) It needed NO Routine prompt change, and checking that was the difference between a real fix
  and an inert one.** The producer Routine is the one `http_api` Routine here — its prompt is the
  owner's to paste, and cannot be edited from a session — so a fix requiring a prompt edit would
  have shipped broken. It doesn't: that prompt says "follow `producer/PRODUCER.md` exactly" and
  never enumerates the symbol lists, so widening the table's quotes/historicals rows is picked up on
  the next run. **Check whether the prompt names the thing you are changing before assuming either
  way** — CLAUDE.md's own rule is that a step naming a specific file or command overrides the
  runbook, and here none does.
  Preview it with the `make-sample-data.mjs` track fixture (WINNER/BANKER/BROKEN/RUNNER/**GHOST**) —
  the card had no local fixture at all, which is precisely how a card reporting 0% for weeks was
  never looked at in preview.
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
  **The root cause is that the MEASURED book is the brokerage account only** — `equity_value + options_value +
  cash` — while `event_contracts_value`, `futures_value` and `crypto_value` are sleeves held by different legal
  entities (Robinhood Derivatives, LLC is a registered FCM; Robinhood Crypto, LLC). So money moving between the
  brokerage account and a derivatives sleeve is an **internal transfer the inference cannot see**. Fixed by
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
  **THAT DAY HAD ALREADY COME — AND THE "GUARD" WAS TESTING A PREMISE NOBODY HAD EVER MEASURED (2026-09-10).**
  This entry used to assert the sleeves sit outside `total_value`, "verified to 9 decimals on the live payload",
  with a guard for the day Robinhood folded one in. Both halves were wrong. `total_value` was measured against a
  live OPEN event position and it **includes the sleeve**: `41351.32550084 − 51 − 21146.93 = 20153.39550084`
  against a `total_value` of `20374.14550084` — a residual of exactly the `220.75` in `event_contracts_value`.
  Robinhood changed nothing; the premise was false from the start. **The identity is VACUOUS whenever the sleeve
  is empty**, and it was checked moments after the 08-30 settlement closed the position — the agentic account,
  same run, sleeve 0, still reconciles to nine decimals, which is precisely what made it look verified.
  **The generalizable lesson: an invariant that only holds trivially in the state you sampled is not evidence.**
  Before trusting one, ask which state would make it FAIL and check that you have actually observed that state.
  **What the bug did NOT do is the other half of the lesson.** The obvious fear — `derivativesRealized` now
  double-counting the gain — never happened, because `inferCashFlow` reads `Δcash`, never `total_value`, and the
  payout **does** land in brokerage cash (proved from the recorded series: had it not, the 08-30 step's flow would
  have been −$1,008.45, cleared the $750 floor and moved `cumFlow`; it stayed 0 because the flow was
  `1245 − 1008.45 = 236.55`, the COST BASIS). The residual error was ±cost at each end of a round trip,
  telescoping to zero and floor-suppressed at this account's position sizes. **Nothing in the recorded series was
  corrupted** — which is why the fix was made calmly rather than as a repair.
  **The fix is to stop asking the question.** `brokerageEquity` derives the recorded basis from the COMPONENTS
  (`equity_value + options_value + cash`), which equals `total_value − sleeves` when the broker folds them in and
  equals `total_value` when it doesn't — correct under **both** conventions, so the convention never has to be
  re-litigated. The guard that replaced the old one is a real invariant checked against the payload rather than a
  restatement of the model: whatever `total_value` carries beyond the brokerage book must be exactly the sleeves
  we model, and an unexplained residual means an asset bucket the producer has never heard of. It **pushes**
  (`alerts.mjs`, transition-based) rather than only warning into a scheduled run's log — the old one would have
  fired silently on every run for weeks. One-time cost: the perimeter moved, so the first point on the new basis
  books the sleeve carve-out as a FLOW (`basisShift`) — otherwise a −1.07% step that was purely a change of
  measuring stick would compound into a series whose whole purpose is a deposit-immune return.
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
  `data.main.equityHistory` forward through the shared `equityseries.mjs` (from `total_value` until v143, from
  the brokerage book via `brokerageEquity` since — see the prediction-market gotcha), and
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
- **Never `cp` a result into `producer/raw/` — and the reason is NOT shell variables (corrected
  2026-09-04).** This entry used to blame `$VAR` expansion. Measured in a live session: `cp` inside
  the workspace *with* shell variables is allowed, while a `cp` whose SOURCE is
  `/root/.claude/projects/<project>/<session>/tool-results/…` is refused by the auto-mode classifier
  — which on an unattended run surfaces as a `Bash wants to run: cp …` card on the owner's phone and
  stalls that run. **How the agent gets there:** an MCP result too large to return inline is spilled
  by the harness to a file under that directory and only its PATH comes back, so the payload was
  never in context, `Write` has nothing to write, and `cp` looks like the only way to land it. It is
  the trap, not the fix — **re-fetch in a smaller batch so the result returns inline**, then `Write`
  it (historicals ≤3 symbols/call). If a **subagent** made the call the spill lands in the
  subagent's own session dir and the parent never sees the payload either — so have the subagent
  `Write` the raw file itself and return only a confirmation. Getting the CAUSE right is the point:
  a session that thinks the hazard is `$VARS` writes a literal-path `cp` and stalls anyway.
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
- **THE DEFENSIVE FLOOR WAS RIGHT FOR A MANDATE THE ACCOUNT NO LONGER HAS (2026-09-08).** Read the entry
  below as the argument FOR a floor — it is a good one, and it is why the mechanism is retained rather than
  deleted. What changed is the objective it was serving. Mandate A makes the account's job "beat SPY over
  rolling 12-month windows", and against that objective a 15% floor is not insurance, it is a 6pp
  structural short of the benchmark's growth names before a single stock is picked (SPY is itself ~9%
  defensive). Measured live: −0.54pp in a fortnight, zero realized protective benefit, against a breaker
  that has never fired in the account's life (deepest drawdown −3.47%). **The generalizable lesson is that
  a control can be individually well-reasoned and still be wrong once the objective moves** — so when a
  mandate changes, re-derive the dials from the objective rather than defending each one on its own
  merits. What replaced it: the drawdown breaker now measures the book against SPY rather than against its
  own peak (so it acts on the model failing, not on the market falling), and the correlation-cluster caps
  — untouched — became the primary downside control. `AG_DEFENSIVE_MIN` and `AG_DIVERSIFIER_MIN` are 0;
  both exposures are still measured and reported.
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
- **A SCHEDULED JOB THAT CORRECTLY DOES NOTHING REPORTS THE SAME "SUCCEEDED" AS ONE THAT WORKED
  (2026-09-02).** The weekly research Routine fires `12 11 * * 1` (Mondays) and its first step is
  `agentic-due.mjs`, which gated at `asOf >= 7d`. But every committed target has been stamped on a
  TUESDAY, so the gap the Monday cron sees is **6 days** and the gate refused every time. On 2026-08-31
  it fired, ran **109 seconds**, printed AGENTIC_NOT_DUE, stopped, and logged
  `ROUTINE_RUN_STATUS_SUCCEEDED` — which is honest, since a clean early exit IS success. **Nothing
  anywhere said the research had skipped a week.** `REFRESH_DAYS` was set to 6 — **and that was still
  wrong, caught 2026-09-03**: the justification ("every target landed on a Tuesday") was false, two had
  landed on Wednesdays and so had the current one, so the 09-07 fire would have seen a 5-day-old target
  and skipped the week again. **No age threshold can work here** — threshold N blocks a whole band of
  weekdays — so the gate is now a **calendar-week test** with `REFRESH_DAYS` demoted to a staleness
  backstop, and `agentic-due.test.mjs` pins every (asOf-weekday, fire-weekday) pair. See the key-files row.
  **Three things generalize.**
  **(a) A cadence gate must be looser than the cadence it gates.** Equality (`>= 7` against a 7-day
  cron) has zero tolerance for the stamp landing an hour late, and the penalty for missing is not an
  hour — it is a WHOLE PERIOD, because the next attempt is a week away.
  **(b) The damage surfaced somewhere else entirely.** A stale target is not itself visible; what showed
  up was the deploy planner waiving MA's and V's entry bands, because zones go advisory past
  `ENTRY_ZONE_STALE_DAYS` (7). That waiver is correct in isolation — a stale zone must not strand cash
  forever — but it was designed assuming the refresh RUNS. When the refresh silently stops, a backstop
  quietly becomes the primary decision-maker. **Check what a safety valve starts deciding when the thing
  it backs up is broken.**
  **(c) `last_run: SUCCEEDED` proves a Routine RAN, never that it DID anything.** Two signals separate
  them and cost nothing to check: an implausibly short `finished_at - fired_at` (109s cannot be a
  60-name research pipeline), and the absence of the artifact the run exists to produce — here, no
  commit to `agentic-target.json` on a research day.
- **A ROUTINE THAT HAS NEVER RUN CAN LOG SUCCEEDED EVERY WEEK — AND THE "BACK AND FORTH" WAS THREE
  CONFIG GAPS, NOT THE MODEL (2026-09-02).** The owner's complaint was that the agentic account needed
  constant permission prompts and chat round trips. Three audits found nothing wrong with the code; all
  three causes were **Routine configuration, which lives server-side and is invisible from this repo**.
  **(a) The weekly research Routine had no connectors and no repo source**, so it had never once produced
  a target — every `agentic-target.json` in git came from an interactive session, and the file was 8 days
  stale, which pushed entry zones past `ENTRY_ZONE_STALE_DAYS` and let today's ticket fill MA and V
  outside their bands. It reported SUCCEEDED weekly throughout. (This is the previous gotcha's lesson
  arriving a second time by a different door: the gate was fixed, the Routine still wasn't running.)
  **(b) The executor Routine was bound to one persistent session since 08-10** — 128M cached tokens and
  ~$74 across ~115 fires that mostly print `EXEC_IDLE` and stop — with no Robinhood tools pre-approved
  and no `PushNotification`, and it had become **stuck in a "needs input" state about a different
  Routine**. A persistent-bound Routine also cannot use completion push notifications at all, so every
  "say what failed" degraded into a chat message someone had to go and read. **(c) The "one-tap confirm"
  the dashboard, the pushes and `AGENTIC.md` all promised did not exist** — the only confirm path was a
  human typing into a Claude session — and the dated pre-authorization block the executor prompt
  references was spent on 08-12 with no template left behind.
  **The tells, all cheap:** a Routine whose `last_run` is SUCCEEDED but whose *artifact* never lands (no
  commit to `agentic-target.json` on a research day); a `finished_at - fired_at` too short for the work;
  a persistent `session_id` repeated across every fire in `list_triggers`; and a promise in the UI copy
  that no code path implements — grep for it.
  **The fixes.** The research Routine's prompt was rewritten in place for a fresh session (with a
  never-fail-silently push rule), a fresh-session executor replacement was created (`claude-opus-5`, push on,
  DISABLED until the owner attaches Robinhood to it in the Routine UI — the API rejects connectors); `producer/agentic-confirm.mjs` makes the confirm a
  real one-command action; `AGENTIC.md` carries an empty PRE-AUTH template; and `SCHEDULING.md` §5 now
  records what each Routine's server-side config must be.
  **Three things generalize.**
  **(i) Connectors and `allowed_tools` are configuration exactly like the prompt — but unlike the prompt
  they cannot be set from a session.** `update_trigger` changes prompt/schedule/name/enabled/model; the
  Routines API in this org **rejects a `connectors` parameter outright**, and `allowed_tools` is
  Routine-UI only. So a session can diagnose this class of failure and cannot fix it. Say which surface
  the fix lives on. (The hourly producer Routine is unchanged and correct, but the same limit applies to
  it: its `allowed_tools` is editable only in the claude.ai Routine UI.)
  **(ii) Never pin MCP tool names in `allowed_tools`.** The full name carries a **session-specific**
  server id — this repo's docs said `mcp__claude_ai_Robinhood__get_portfolio` while a live session sees
  `mcp__1ad8dd47-…__get_portfolio` — so a copied prefix matches nothing and every broker call becomes a
  permission prompt. `preset:default` + the connector attachment is the durable form; `PRODUCER.md` now
  writes tools as `Robinhood · get_portfolio` for the same reason.
  **(iii) A promise in the UI is a spec.** "One-tap confirm" shipped in v96 and was still on the card,
  in the push text and in the runbook on 2026-09-02, with no tap anywhere. Either build the thing or say
  what actually happens — the owner had been doing the round trip for weeks believing it was the
  intended design.
- **A ROUTINE BOUND TO A PERSISTENT SESSION IS ONLY AS ALIVE AS THAT SESSION — AND WHEN THE SESSION DIES
  THE ROUTINE DOESN'T FAIL, IT RUNS SOMEWHERE ELSE WITH NOTHING (2026-09-09).** The weekly research
  Routine had been bound to an interactive session since 09-02 so it could inherit that session's
  Robinhood + Alpha Vantage connectors (the org rejects `connectors` on `create_trigger`; re-tested
  2026-09-09, still rejected). It produced two targets that way. Then the bound session finished its
  09-07 run by *asking a question* ("confirm push to main"), sat idle-BLOCKED on it for two days, and
  its container was reclaimed. The 09-09 fire could not land in it — the session's `updated_at` never
  moved — so the platform spawned a **fallback run built from the Routine RECORD**, which carries
  `mcp_connections: []`, `sources: []` and no model: a Sonnet 5 session with no repo on disk and no
  broker tools, which correctly stopped at step 0 and pushed "connector missing". The owner then
  toggled Robinhood ON in that run's connector picker and it changed nothing, because a chat-level
  toggle sets a preference for future sessions and does not hot-attach an MCP server into an agent
  process that is already running. **Four things generalize.** (a) **A session-bound Routine has two
  ways to die and only one of them is visible.** The obvious one is the session being archived. The
  quiet one is the session ending a turn on a question — a bound session that needs input is a Routine
  that will never run again, and nothing reports that; the executor died the same way on 08-31. The
  prompt now says *never ask a question here, push instead*, which is the code-side guard for a
  prompt-side hazard. (b) **A fallback run reads the Routine record, so the record has to be complete
  on its own.** Everything the binding was supplying (connectors, repo, model) was absent from the
  record, so the fallback had none of it. The executor's record — `mcp_connections:[Robinhood]`,
  `model: claude-opus-5`, a step-0 shallow clone — is complete, and it is the shape the research
  Routine now has. **Except for one field, caught the same afternoon: `sources`.** The replacement's first
  real run completed the research end to end and was refused on the push — 403, *"not in this session's
  authorized repository set"* — because the git proxy scopes PUSH credentials to the Routine's repo
  `sources`, which `create_trigger` cannot set and which was `[]`. The producer Routine, the one that
  pushes 13×/day, has it only because it was made in the UI ("Select a repository"). A public repo clones
  fine without a source, so nothing upstream of the push can reveal the gap — and the executor carried the
  identical hole and had simply never needed to push (every fire since going live idled). Both must have
  the repo selected in the UI; the prompts now also carry an `add_repo(access:"push")` retry as a
  code-side fallback. (c) **Where a connector is attached is the whole question.** On the ROUTINE (UI,
  "Manage connectors") survives every fire; in a bound session survives until that session dies; in a
  run's chat picker survives nothing. Compare `mcp_connections` in `list_triggers` between a working
  Routine and a failing one before touching anything else. (d) **Don't bind. Ever.** The 09-02 note
  said "bind only jobs that run WEEKLY" as if cadence were the risk; it isn't — the risk is that the
  binding's whole justification lives outside the Routine and expires silently. Fresh-per-fire plus
  UI-attached connectors is the only shape that has kept working here. The `Sonnet 5` in the fallback
  run is the same lesson from another angle: a fresh-session Routine with `model: ""` runs on whatever
  the platform defaults to, so pin it with `update_trigger` at creation.
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
  ≈0.71pp once it compounds — measured 2026-09-01: ••••0741 read −2.86% against a true −2.16%). They
  were **CORRECTED on 2026-09-01 by a one-time migration run inside the PRODUCER**, and the reasoning is
  the part worth keeping. **No ordinary run can shed a corrupted running total:** `appendEquityPoint` reads
  `priorCum` from the point it is REPLACING, so every same-day rebuild inherits the bad value and it is the
  permanent baseline for every future point — which is why this sat open for a day looking like a manual
  chore. But `data.json` is the PRODUCER's own file, rewritten hourly through build-data → emit → validate
  → publish, so a total the pipeline corrupted is the pipeline's to correct, on that same path and under
  the same validation. `repairPriorCumFlow(prior)` ran in `build-data.mjs` immediately after `loadPrior()`,
  BEFORE anything read the series — one call site that corrected both the `appendEquityPoint` path and the
  carry-forward branches. **Prefer this shape to a hand edit for any future data repair:** a hand-edited
  encrypted blob is reviewable by nobody and reproducible by no one, while a migration is tested,
  committed, self-applying and self-disabling (it keyed on the anchor still holding the EXACT bad value to
  the cent, so the first run that applied it made every later run a no-op — firing twice would have
  invented the mirror-image error, and exact equality rather than a tolerance meant a genuine later deposit
  would have shifted the anchor and correctly stopped it). It landed on the 15:35Z run; the agentic series
  went to a flat 7,950.75 and main to a flat 0, verified by decrypting the published snapshot, and the next
  appended point carried `flow=0` so the correction propagated instead of being re-inferred. The module and
  its build-data block were **DELETED the same day** once spent across four runs — it was a migration, not
  a guard, and the root cause is fixed separately below. `git log producer/cumflow-repair.mjs` has it if a
  similar repair is ever needed.
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
  **(d) THE INVARIANT'S FIRST REAL CATCH WAS THE FIX ITSELF (2026-09-08).** The re-size path introduced
  above sizes buys against `cash + proceeds` — and then rounded each of ten legs to cents independently,
  which summed **two cents OVER** the pool it had just been sized against ($1,817.31 vs $1,817.29). The
  invariant refused the ticket, correctly: the broker would have rejected the final leg. Two things worth
  keeping. **A fix that computes a budget must also be held to it** — the reconciliation was written to
  stop over-spending and then over-spent by rounding, which is precisely why the check is an INVARIANT
  against reality rather than another figure derived from the same model. And **the failure was two
  cents on $1,817, which is exactly the size that argues for fixing the allocator rather than widening
  the tolerance**: a cent of slack would have hidden this and every future rounding error with it, while
  the real rule ("never size above the pool") is cheap to enforce and needs no tolerance at all.
- **A GUARD RENDERED WITHOUT THE TRADE IT GUARDS IS NOISE — AND IT OUTRANKED THE REAL STATUS (2026-09-03).**
  The Plan tab's "What's blocked" card listed **8 buys deferred** on a day the planner deferred **2**. Six of
  them — MSFT, NVDA, AMZN, GOOGL, SHEL, LLY — were names the account already held at or above their target
  weight, flagged `above entry` purely because spot sat over the research's entry ceiling. The owner read it
  exactly right: *"it's looking for entry positions for stocks we already have."*
  **Root cause: the consumer scored every target name on PRICE, the planner scores only names it is BUYING.**
  Every deferral in `agentic-deploy.mjs` is pushed inside `if (gap > 0.5)` — underweight by more than fifty
  cents — so a fully-weighted name never reaches a guard at all. `agenticExecMap` in `index.html` had no gap
  input and looped the whole target. The two had drifted since v104 without either being individually wrong:
  the band logic was a faithful mirror, it was just being asked about names the planner never asks about.
  **Three things generalize.**
  **(a) A guard is a statement about a specific trade, so rendering it needs that trade to exist.** "Is the
  price outside the band" and "would we defer this buy" are different questions, and only the second is what
  a card headed *what's blocked* claims to answer. Mirroring a guard's THRESHOLDS is not mirroring the guard
  — the precondition is half of it. `agenticBuyGap` now computes the planner's `gap` (park allowance and all)
  in ONE place that both the card and the Plan page call.
  **(b) The phantom actively HID the truth, which is what makes it worse than clutter.** `statusOf` ranks the
  deferral badge above the drift badge, so MSFT showed `above entry` instead of `on target` — the card had a
  correct answer available and printed a wrong one over the top of it. Any priority-ordered status needs its
  high-priority branches gated at least as tightly as the thing they suppress.
  **(c) The reader's follow-up question was the right one and the card should answer it in place.** Once a
  position is at weight the live levels are the **stop and take-profit**, not the entry zone — so the card and
  its help now say so explicitly, rather than leaving "why is my holding being screened for entry" to be
  worked out. An entry deferral on a HELD name is still legitimate whenever the target wants *more* than is
  held (MA, 2.03% against a 5% target, was one of the two real rows), and the parking vehicle appears the same
  way because parked dollars are other names' money — so the fix is a gap test, never a "skip held names" test.
  Verified by replaying the fixed consumer functions and the real `planDeployment` over the live 09-03
  snapshot: 8 rows → 2, exactly matching the planner's `MA:above-entry, VTI:wash-sale`.
- **A GUARD WITH NO MATERIALITY FLOOR SPENDS REAL MONEY TO SAVE PENNIES — AND THE PARK VEHICLE FEEDS IT
  (2026-09-03).** The wash-sale ledger blocked on ANY realized loss with no minimum, so a **$1.01** VTI
  loss from 09-02 was deferring a **$29.25** VTI target buy until Oct 2. Five more dust entries sat in the
  live ledger the same day (VTI −$0.24, UNH −$1.02, CIFR −$1.11, AAPL −$9.06, GE −$23.96).
  **The structural part: VTI is BOTH the parking vehicle AND a 5% target holding, and nothing anywhere
  excludes the vehicle from the research target** — CLAUDE.md claimed it was "absent from the target by
  design" and it has been IN the target since at least 2026-08-25. Parking is by construction a
  short-duration round trip in a broad-market ETF, so it manufactures small realized losses on its own
  ticker roughly every other release — which then gate that ticker's genuine target allocation. A guard
  was eating its own tail.
  **What the fix is NOT.** Parking itself was never blocked (the park leg isn't washMap-checked), so the
  mechanism kept working; only the target's own buy was gated. And the fix is not "exempt the vehicle" —
  a real VTI loss should still block a real VTI rebuy. It is **materiality**: `WASH_MIN_LOSS` $25.
  **Three things generalize.**
  **(a) Know what a ledger is FOR before deciding how strict it should be.** This one is a pre-trade
  avoidance tool, not a tax record — Robinhood reports within-account wash sales on the 1099-B whatever
  this file says — and a disallowed loss is not lost, it moves to the replacement shares' basis. So the
  cost of ignoring a $1 wash is a timing difference on pennies; the cost of honouring it is a 30-day
  block on a real allocation. Strictness that buys nothing is not conservatism.
  **(b) Filter at the ONE site every consumer reads.** Four surfaces build a washMap from
  `data.agentic.recentLosses` (planner, exec gate, agentic card, self-directed plan). Filtering in
  `lossesFromTrades` gives all four the behaviour at once; filtering per-surface is how this repo keeps
  producing card-vs-executor drift.
  **(c) The floor must test the DAY's total, not each fill, and must not reach the inference path.**
  Five −$20 clips are a −$100 loss and must still block, so a per-trade floor would wave it through. And
  the Railway inference fallback records no `realized` at all — unknown magnitude has to fail safe and
  keep blocking, which falls out for free because the filter keys on a field those entries lack.
  **The same day the owner moved idle cash to a HIGH-YIELD SWEEP, which retired most of the waiting
  ground.** Parking only ever paid for itself by earning beta that cash could not; the repo's own
  measurement already showed it losing (+$0.78 gross on ~$1,000 of turnover against a 0.21% spread, while
  VTI fell 0.22%). `PARK_DATED_REASONS` is now `{wash-sale}` alone — the one window long enough to be
  worth a spread. **A capability's justification can expire because something OUTSIDE the code changed**;
  re-check the premise, not just the implementation. One trap if parking is ever switched off entirely:
  releases are gated on `parkingOn`, so flipping it strands whatever is already parked — drain first.
- **A PRIVACY TOGGLE IS ONLY AS WIDE AS THE PAGE IT WAS WRITTEN ON (2026-09-04).** The 👁️ control
  shipped when the app was essentially one page, as a text walk over `#page-portfolio` matching
  `$<digit>`. The app then grew four more tabs that render account figures — the Plan tab's Action
  Center, the entire agentic plan, the Options tab's own contracts, Analyze's 📦 Your Position — and
  the toggle never grew with them. Measured on the sample snapshot it read as ON while leaking
  **100+ values across four tabs**. Reworked in v136 (see the feature entry). **Five things
  generalize.**
  **(a) A leak here is invisible to the person who owns it.** Every other bug in this repo announces
  itself to the owner — a wrong number, an empty card, a red CI run. This one shows the owner exactly
  what they expect and shows the *audience* more than intended, so it can only be caught by a machine
  looking on purpose. That is why `producer/privacy-audit.mjs` exists and why it is worth a browser
  dependency the rest of the suite refuses.
  **(b) Default-mask with explicit opt-outs, never opt-in.** A pattern-matcher that must be TOLD
  about each new surface fails silently the first time someone adds a card — which is precisely what
  happened over five tabs. Page roots now seed `data-priv`, so new cards inherit masking and a
  forgotten attribute over-masks. Over-masking a strike price is cosmetic; leaking a balance is the
  whole failure.
  **(c) The values that hide best are the ones with no punctuation.** Every pattern here keys on `$`
  or a unit, so a **bare** figure is invisible to all of them — the Shares column renders `350.00`,
  and 350 shares next to a visible price IS the position value. Hence `data-priv="val"`, and hence
  the audit reading table *headers* rather than only cell text. When adding a masking rule, ask what
  the value looks like with its symbol stripped off.
  **(d) Blur is not redaction.** A blurred `$1,234,567.89` keeps its width, so the magnitude survives
  the blur, and the real text stays selectable and readable to a screen reader underneath. Replacing
  the text (original parked in `data-v`, restored on toggle-off) fixes all three at once — but then
  the RESTORE path becomes load-bearing, since a broken one strands the app in bullets with no way
  back. The audit round-trips the toggle for that reason.
  **(e) Percentages are the demo.** Masking them too would have been the "safe" call and would have
  left an app with nothing to show. Returns, weights and drift reveal no balance; they are exactly
  what the owner wants a guest to see.
- **A SHARED COMPUTATION HAS EVERY CALLER, OR IT IS NOT SHARED — THE MANDATE A VERIFY (2026-09-08).** The
  Plan→Build→Verify split earned its keep on its largest change yet: the build passed its full suite, the
  exec-gate simulation, the privacy audit and a finalize-target drive, and the adversarial verify still
  found **three real defects and one design hole**, none of which any test could see. All four were the
  same shape — a change made correctly at ONE site of something that has SEVERAL.
  **(a) The relative drawdown breaker was wired into the exec gate and not into `build-data.mjs`.** The
  gate computed relative (−5pp trips); the snapshot — which the card, the hand-off prompt and
  `alerts.mjs`'s push all read — computed absolute-only (−20% trips), at a call site whose own comment
  says the two "can never disagree". The executor would have stopped buying with nothing on the phone
  and no push. The build-data test never asserted on the drawdown block at all, which is how it slipped;
  it now pins `benchStale:true`, a flag only reachable when a bench was actually passed.
  **(b) The push text quoted the absolute figure** for a breaker that now trips on the relative one — a
  "−3.2% below its peak" push against a −5pp threshold reads as the breaker being broken.
  **(c) The stale-zone asymmetry was applied in the planner and not in the consumer's mirror**
  (`agenticExecMap`), so on a stale target the card said "entry checks are OFF" while the executor
  deferred above-entry — the card-vs-executor drift the repo's own rules name as worse than no badge.
  **(d) The deposit tranche was inert.** It rationed cash to 50% "per pass", but the executor runs HOURLY
  and `idleDays` advances at midnight, so the remainder was re-rationed every hour: a $2,000 deposit went
  in as $1,000/$500/$250/$250 across four consecutive hours. Fully deployed in ~3 hours; variance
  reduction zero. The build's test ran ONE pass and passed. Replaying the hourly loop is what exposed it.
  **Three things generalize.** (i) **When a computation is shared, grep every call site before the build
  is done** — the bench had to reach `bookDrawdown` at both sites, the asymmetry had to reach both the
  planner and its mirror, and each was "done" after one. (ii) **A test of a mechanism that runs on a
  schedule has to run it on the schedule** — one pass proves the arithmetic, the hourly loop proves the
  mechanism. This is the verify checklist's "simulate the next scheduled run" rule, which the build
  applied to the gate and not to the planner's own new rule. (iii) **The builder's summary is not
  evidence.** Every one of these was described as done, in good faith, in a summary that read as
  complete; the defects lived in the seams between correct pieces, which is where a re-read of the
  summary cannot look and an adversarial pass has to.
- **AN ENCRYPTED FILE COMMITTED ON A SCHEDULE IS A PERMANENT, COMPOUNDING COST (2026-09-08).** The
  producer publishes a ~7MB encrypted `data.json` to a PUBLIC repo about thirteen times a day.
  Encryption is the part that makes this bite: the envelope carries a random salt, so consecutive
  snapshots share no bytes, and git can neither delta nor compress them. **Every run appends a full
  fresh copy to history, forever.** By 2026-09-08 `.git` had reached **1.7GB**, growing ~2.7GB/month,
  and nothing in the repo said so because the working tree is only ever one file.
  **It surfaced as a completely unrelated-looking failure.** The agentic executor's first real test
  fire spent **over ten minutes inside `git fetch`** and never reached the gate before the market
  closed — a Routine that looked hung, on the day its connector was finally attached. The producer
  pays the same tax on all thirteen daily runs (it fires at :35 and commits at :41).
  **Two fixes, at different layers.** (a) The executor's prompt now fetches **`--depth 1`** and is
  told never to fetch unbounded, never `--unshallow`, and never to rebase (a shallow checkout has no
  merge base — on a rejected push it re-does the shallow fetch and re-applies its three files).
  Pushing FROM a shallow clone is routine and safe; it is what `actions/checkout` does by default.
  (b) `histbars.mjs` halves the file itself, which halves the growth for every consumer at once.
  **What was deliberately NOT done: `run.mjs`'s `git fetch origin main` was left unbounded.** Adding
  `--depth 1` there would convert the producer's own repo to shallow, and the producer is the one
  pipeline whose failure takes the whole dashboard down. Saving five minutes a run is not worth that,
  especially now the compaction has halved the bytes anyway. If it is ever revisited, test the
  shallow **push** path first, in isolation.
  **Three things generalize.** (i) **Size is a function of cadence times payload times retention, and
  retention here is infinite by default** — any recurring commit of an incompressible blob needs that
  arithmetic done ONCE, at design time, because it is invisible until it is expensive.
  (ii) **The cost lands on a different component than the one that creates it.** The producer writes
  the history; the executor, which writes nothing, is what broke. Look upstream of a slow agent before
  concluding the agent is wrong. (iii) **91% of a payload can be one key.** Nobody had ever measured
  the snapshot's composition; one `JSON.stringify(...).length` per top-level key found that `hist` was
  91.5% of it and that two of its seven per-bar fields were read by nothing at all. Measure before
  optimizing, and measure the WHOLE thing, not the part you suspect.
  **Still open, and it needs an owner decision:** the existing 1.7GB does not shrink by itself. Only a
  history rewrite (force-push) removes it, which breaks every existing clone and is destructive, so it
  was not done unilaterally. Shallow fetches make the size operationally invisible to the agents, and
  the halved payload slows the growth; GitHub's own soft warning starts around 1GB.

- **THE ANALYZE PAGE READ STALE BARS AGAINST A LIVE PRICE, AND ITS OWN SCORE HAD NEVER BEEN SCORED
  (2026-09-09).** Three Sonnet research passes (an accuracy audit, a coverage study and a 13,613-read
  walk-forward backtest of `analyzeStock` over the snapshot's own history) found the same page failing in
  four independent ways, none visible on a card.
  **(a) Clock mixing.** `azBars`/`azSeries` read `hist.day` raw with no splice and no age gate while
  `price` came from the live quote — the Portfolio page had spliced since v111 and the Plan page had gated
  since v113, and the Analyze page did neither. 142 of 191 series were stale that day. Measured: a series 20
  bars stale flips the DIRECTION of the call **11.2%** of the time, 40 bars **14.9%** — not a lag, a wrong
  answer, because a series that stops stops at its own high. Fixed by `azHist`, ONE reader every az*
  function goes through (splice ≤5d, haircut 4–10d, WITHHOLD past 10d).
  **(b) The label ladder was effectively binary.** `trendUp = price>sma20 && sma20>=sma50` called every
  routine pullback a downtrend (66% of reads), `sma50 = smaN(closes, min(50,len))` was never null so
  `trendUp` was never null and "Oversold Bounce" fired **0 times in 13,613 reads**, and "Hold / Watch" was
  unreachable. A recommendation engine whose middle states cannot occur is a coin with a gauge around it.
  **(c) Stops were built to lose.** `k = max(5%, vol×2.2)` put the MEDIAN stop 12.3% below entry (52% past
  12%), and because tp1 was `price + k×(price−stop)` a looser stop mechanically inflated the target, so
  tp1 hits paid a measured **+0.23R** against a nominal 1.6–1.8R and the whole thing netted ≈0R on a 58.5%
  win rate. Now 2×ATR/swing-low clamped 3–10%, targets from structure, R:R displayed and enforced.
  **(d) Every component of the setup score was NEGATIVELY rank-correlated with forward return** in this
  sample (decile 1 +2.29% fwd10 vs decile 10 −0.33%), and "Buy Opportunity" ran −2.24pp vs SPY across 169
  names. One bull-market YTD sample with overlapping windows, so the SIGN is the finding, not the size —
  and the response was NOT to flip the engine contrarian on nine months of data. It was to make the page
  measure itself: `azEdgeStats` walks every label forward over the whole universe on every snapshot and
  prints what that state has actually been worth, in the card, next to the call. After the rebuild the
  same replay reads Buy 40% / Hold 29% / Downtrend 22% / Extended 10% / Oversold 0.2% — and Buy Opportunity
  STILL trails (−0.68% fwd20, −2.96pp vs SPY) while Hold/Watch and Downtrend lead, which is exactly what
  the strip now tells the reader, with a −10 confidence haircut, instead of asserting an edge nobody checked.
  **Three things generalize.** (i) **A score that has never been scored is a guess** — build the measurement
  into the surface, so it re-runs on every snapshot and cannot go stale the way a one-off study does.
  (ii) **Two readers of the same data must share one reader function**, or the gate one of them has is a
  gate the other lacks; the Portfolio/Plan/Analyze split had three copies of the bar coalescer and only
  two of them were safe. (iii) **The coverage half needed NO owner action** — the hourly Routine's pasted
  prompt defers to `PRODUCER.md`, so the fetch lists were a repo edit (`hist-plan.mjs`), and the
  `SD_BENCH` copy in `analyze-universe.mjs` is pinned to `index.html` by a regex-extraction test, the
  `finalists.mjs` pattern. Known, accepted: 69% of positive-tone reads now carry R:R under 1.5 on the
  tighter stops and read ACCUMULATE with the "targets don't pay" line — that is the honest number, not a
  bug; the swing engine's short-horizon edge in this tape is ~0R and the page now says so.
- **A WRITER AND A READER OF THE SAME DAY STAMP DISAGREED ON THE TIME ZONE (2026-09-12).**
  `fetchgate.fetchedToday(key, todayET)` compares `data.fetchDays[key]` for EQUALITY against a date every
  fetcher computes in **ET** — the parameter is literally named `todayET` — while `build-data.mjs` stamped
  `fetchDays` (and `data.flow.asOf`) from a **UTC** ISO slice, directly under a comment that said "records
  the ET day". They agree for twenty hours a day and disagree for four, and **the failure is silent and
  INVERTED**: a build landing at 01:00 UTC stamps TOMORROW's ET date, so the next morning's av/extfund/flow
  fetcher sees "already fetched today" and **skips a whole day of provider data**. Same class as the
  raw/-marker gate this stamp replaced, pointed the other way — that one over-spent the budget, this one
  starves it. **Three things generalize.**
  **(a) It was LATENT, and only incidentally so.** No scheduled build has ever landed in that window,
  because preflight SKIPs once the day's close is captured — so the thing protecting this was a *different
  module's* unrelated behavior, not anything structural. Two off-schedule 23:00 UTC commits in the history
  show manual runs do happen off-cadence. **"It has never fired" is a fact about the current schedule, not
  a property of the code.**
  **(b) The duplicated helper is what let it drift.** `build-data.mjs` already imported `etDate` from
  `market.mjs` AND carried a second, private inline copy of the same Intl formatter for `_extAsOf` — so the
  file had two definitions of "today" and the newer stamp reached for neither. Both now go through `etDate`.
  **(c) A nightly-red test is signal, not flake.** This surfaced as `build-data.test.mjs` failing for four
  hours a night on an assertion comparing a stamp to a UTC slice. The tempting read is "timezone flake in
  the test"; the test was right and the product was wrong. **Before relaxing a time-dependent assertion,
  check which side is actually wrong.** Three assertions were on the UTC basis; fixing `flowDay` tripped the
  third, which is the suite doing its job. The stamps that must stay UTC are the ones that are NOT gates —
  `appendEquityPoint`'s day (documented as one point per UTC day), the wash-ledger cutoff, the decision-log
  retention window. Only a value compared for equality against another module's ET date is affected.
- **A THRESHOLD THAT WAS FINE BECAME A SILENT OFF-SWITCH WHEN THE DATA SHAPE CHANGED UNDER IT
  (2026-09-12).** `options-build.mjs` computed its realized-vol IV proxy from `raw/hist-day*.json`,
  skipping any batch with `bars.length < 20`. That gate was correct when every historicals fetch was a
  YTD series. **v141 then moved historicals onto 7-bar TAILS** to make a ~230-name bench affordable —
  and 7 < 20, so from that day essentially every batch was skipped, `ivBySym` came back EMPTY, and every
  estimate-path option premium fell through to `ivProxyFor`'s flat **0.55/0.60** default. Nothing failed;
  the Options tab stayed fully populated with confident-looking numbers.
  **What it produced.** The live 2026-09-11 **RCL cash-secured put** card: strike $242, estimated premium
  **$13.05**, income **~$1,305**, **58% annualized**. That premium implies **~68% IV** on a name whose
  realized vol is **23.2% (30d) / 32.2% (60d)**. The honest figures are **$511 and 23%** — the card
  overstated the income of a short-premium trade by **~2.5x**. FER's CSP read **60%** against a true 13%.
  **Four things generalize.**
  **(a) A validity threshold is a claim about the shape of your inputs, and inputs change.** Nothing was
  wrong with `>= 20 bars`, and nothing was wrong with 7-bar tails; the defect lived in the seam, and the
  change that opened it was in a DIFFERENT file for a DIFFERENT reason. When a data shape changes, grep
  for every consumer that asserts something about its size.
  **(b) The data was already there.** `data.hist.day.RCL` carried **173 bars** — the proxy just wasn't
  looking at the snapshot, only at raw/. Third time this exact shape has bitten: the v119 `instrument_id`
  greeks, the 2026-08-30 derivatives settlements, now this. **Before adding a fetch, check whether the
  producer already has the data and is throwing it away.**
  **(c) The fallback was WORSE than no answer, because it was plausible.** A flat 60% default is a real
  number in a real range; it cannot be told apart from a measurement by looking at it. A default that
  silently substitutes for a measurement must be NAMED when it fires — `options-build` now warns with the
  symbols, because a guard that fires silently is indistinguishable from a broken system.
  **(d) The direction of the error follows the SIDE of the trade.** Overstating IV overstates income on a
  SHORT-premium idea (CSP/covered call — it flatters a trade that is actually being underpaid) and
  overstates cost on a LONG one (conservative). There is no single safe direction, which is the argument
  for measuring rather than defaulting. The mirror now applies: realized vol runs a few points UNDER
  implied, so estimates read slightly conservative for short premium and slightly cheap for long. Closing
  that last gap means preferring real IV the book already holds (`ivObserved`, `liveBySym`), not inventing
  an uplift constant.
  The card's own **"Estimate — confirm the live bid in the chain"** line was doing its job the whole time;
  it is not a licence to ship a figure that is 3x out.
- **A HELPER SHARED BY TWO TOP-LEVEL FUNCTIONS CANNOT BE A LOCAL CONST — AND THE CRASH ONLY FIRED IN
  A DRAWDOWN (2026-09-04).** `agDrawdownBanner()` called `dLbl()`, which was declared as a `const`
  inside its sibling `renderAgenticPlan()`. The resulting ReferenceError blanked the **entire agentic
  Plan tab** — target, deferrals, parking, guardrails, all of it — leaving only "Loading agentic
  plan…". It was invisible because the banner only renders when `data.agentic.drawdown.level` is
  `soft`/`hard`, i.e. **the page failed exactly when the book was down and the reader most needed
  it**. Fixed by hoisting `agDLbl` to module scope. Two things generalize: a guard's own presentation
  code needs the same "does this run on the unhappy path" test as the guard, and a **local preview
  flag is what catches it** — `PF_SAMPLE_DRAWDOWN=soft` reproduces it in one command, which is the
  argument for keeping those flags exercised rather than letting them rot.
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
- **Cost discipline:** historicals are the expensive part. Since v141 `hist-plan.mjs` decides them: a
  7-bar **tail** for every bench name whose series is ≤10 days behind (8 symbols/call — the ≤3 rule is
  about PAYLOAD size, and a tail is ~1/20th of a YTD series), full YTD only for absent/too-stale names
  (≤3/call, capped 30/run) and 5Y monthly capped 15/run — ~25 calls on a steady-state day. They're
  fetched once/day (FETCH_ALL) and carried forward — never re-fetch them on a light run. The live schedule is **hourly** (the "Portfolio dashboard refresh" Routine, `35 * * * *`
  UTC — the Routine scheduler's minimum interval is an hour; preflight SKIPs the off-hours fires), and
  only the day's first run is heavy; every run after is a cheap light run (historicals/AV/picks carry
  forward), so the cadence stays inexpensive. (See `SCHEDULING.md`, incl. how to get 30-min cadence
  back with a second offset trigger.)

- **`Workflow({name})` CAN SERVE A STALE COPY OF A WORKFLOW YOU EDITED THIS SESSION (2026-09-24).** After
  editing `.claude/workflows/agentic-research.js` and verifying the file on disk was correct, a launch by
  `name` ran the PRE-EDIT version: four sleeve agents on Opus instead of one, `args.momentum` ignored,
  ~459k tokens before it was spotted on the phone. The working tree was right the whole time; the
  launcher resolved a copy cached earlier in the same session. **After editing a workflow, launch it by
  `scriptPath` pointing at the repo file** — the launch result echoes the path it actually used, so check
  that line rather than assuming. The scheduled Routine is NOT exposed to this (a fresh session per fire
  has nothing cached, so `name` reads the clone), which is exactly why it is easy to miss in development
  and never see in production.
- **A SCHEDULED RUN AND A HAND RUN DO NOT SHARE A CADENCE (2026-09-24).** Refreshing the target on demand
  writes today's date into `agentic-target.json`, and `agentic-due` gates on that date — so an ad-hoc
  refresh CONSUMES the fortnight rather than adding to it. Doing one on 09-24 made the scheduled 09-27
  fire print NOT_DUE and pushed the next real research to 10-04. That is correct behaviour and it is
  easy to mistake for a missed run, so say which one you are spending before you spend it.

