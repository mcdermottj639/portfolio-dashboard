# Process reference: Plan→Build→Verify, conventions, local preview, verify-before-shipping detail

> **ARCHIVE / REFERENCE — not default context.** Moved verbatim from the repo-root `CLAUDE.md` on 2026-11-18 (docs/process-only PR). Nothing here was rewritten. Where this text conflicts with the root `CLAUDE.md`, the root file wins: it holds the current ACTIVE RULES. Labels used there: ACTIVE RULE / CURRENT STATE / HISTORICAL / UNVERIFIED.

> Load for release mechanics, preview fixtures (`make-sample-data.mjs` flags), the full test-coverage narrative, the replay-key contract, encryption and env vars.
>
> **Superseded lines kept for history (do NOT follow):** (1) "develop on `claude/portfolio-dashboard-data-ffc7x3`", "Push code straight to `main`" (2026-08-11) and the `git push origin <branch>:main` recipe under "ALWAYS MERGE" (2026-08-14) — superseded by `AGENTS.md` + `docs/RELEASE-WORKFLOW.md` (2026-11-13): a branch and PR per task, required CI, Claude merges the tested head after green checks (owner never merges; the repo's `allow_auto_merge` setting read false on 2026-11-18). The "finishing = landed on main and served" intent still stands. (2) "Currently **v254**" (any fixed number here goes stale) — the version lives in `index.html` `APP_VERSION` and `sw.js` `CACHE_VERSION`. (3) Apex "1.35× cruise / 1.5× cap" under "Two accounts, two MANDATES" — the band is `ui/apex.js` `C` (v218: 1.75 reload / 1.90 cruise / 2.00 cap). (4) "Light ⇄ Gold" theming — v229 moved to Light / Dark / System (`ui/theme.js`); read the code before relying on this paragraph.

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
  `boot()`) and `CACHE_VERSION` (in `sw.js`) together. Currently **v254** (`pf-v254`).
  **DAY IN CASH** pass (2026-09-12, owner-set): the Agentic Portfolio table's `Day / YTD` column drops YTD
  for **what the day's move was worth in dollars on that position** (`qty × (px − prevClose)`; the header is
  now just `Day`). **v147 put the dollars ON TOP with the percentage grey beneath, matching `plCell` one
  column across** — two adjacent money columns that order their own two lines differently make the eye
  re-read the row to find the figure. Greying the sub-line percentage (`pctSub`, which keeps `pctCell`'s
  display-zero-aware formatting so a flat name reads `0.0%`, never `−0.0%`) is the substantive half of that
  match, not a cosmetic one: the dollars directly above always carry the same sign (both derive from
  `px − prevClose`), so colouring both states the direction twice and leaves nothing quieter to skip —
  exactly why `plCell` greys its own. The reason it is the better second line is that **a percentage
  cannot be added up** — "+0.6% and +0.8%" answers nothing about the account — while the dollars sum
  straight down the column into the Total row, which is exactly the question a holdings table is scanned
  for. The sum is over the same priced rows the percentage is computed over, so an unquotable name (the
  parking vehicle, typically) reads `—` on both lines and is excluded from both rather than silently
  counted as zero. `cashCell` carries the **display-zero rule** `pctCell` already had — a move that rounds
  to $0.00 renders neutral, never a red `−$0.00` — and the `+`/`−` convention matches `plCell` so the two
  money columns read alike. Per-name YTD is **not deleted, it moves to the cell's `title`**, since nothing
  else on the agentic side carries one (the Analyze tab is the other route). Privacy: the new figure is
  money and masks through the existing `$` pattern — re-audited, 0 leaked across all seven surfaces. v145
  is the **CONSTRUCTION NOTE** pass (2026-09-12): `target.method` is the only place the target explains ITSELF —
  why each name got its weight, and why five names left — and it rendered as one **2,892-character
  paragraph** at 11.5px with `|` swapped for `·`, which is a thing nobody reads. It is now chunked and
  weighted by `agMethodHtml` (with the pure `agMethodParts`/`agProseLines`/`agEmph`, pinned by
  `producer/agentic-method.test.mjs`, which extracts them out of `index.html` the way `analyze-core` and
  `finalists` do). **The rule is CHUNK AND EMPHASIZE, NEVER REWRITE, and the test asserts it** — every
  character of `method` must survive into the rendered output, in order (whitespace and the delimiters
  themselves excepted) — because a card that paraphrases the research is a card asserting something the
  research did not say, and a summary of a summary is how a figure that was already caveated becomes one
  that reads as current. Four things earn their place: the string is **two different artifacts glued with
  `|`** (the synthesis's prose, then the tail `finalize-target.mjs` appends), so it splits there and the
  tail segments are classified **by their emitted prefix, never by position** — an unrecognized future
  segment renders verbatim under a neutral `·`, because "shown plainly" is the only acceptable degradation
  and a formatter keyed on a fixed segment count silently eats the next one somebody adds; the prose breaks
  at semicolons **as well as** full stops, since the synthesis writes its whole drop list as one
  semicolon-joined sentence and that clause is exactly the unit the reader wants one per line; emphasis is
  **two weights, not one** (ticker `<b>` 700, figure 600) because the note carries ~30 percentages against
  ~20 tickers and bolding both equally lit up half the paragraph — and the ticker vocabulary comes from
  **the target's own `names`/`dropped`**, never a `\b[A-Z]{2,5}\b` guess, which would light up RSI, AFTER
  and COHORT; and the block now **leads with an authoritative header strip** built from the structured
  fields, which is also the first render `target.defensive`/`target.diversifier` have ever had (emitted and
  shown nowhere since 2026-08-25). That header is not decoration — the note's own last segment warns that
  percentages quoted in the prose can predate the final cap/sleeve pass, so the figures scanned FIRST have
  to be the ones that can't be stale, and it answers the question the prose opens with a contradiction to
  ("Twelve names" over a table of 18 → `12 active + 6 phase-out`). Escaping also landed here: the old site
  interpolated `method` into `innerHTML` raw. v144 is the
  **HOLDINGS ORDER** pass (2026-09-12, owner-set): every holdings listing in the app now reads
  largest-position-first. Most already did (All Positions defaults to `val` descending; the heatmap,
  Technical Signals and Fundamentals all sort `b.val-a.val`), so what stood out was the **Agentic
  Portfolio** table, which iterated `data.agentic.positions` in the producer's — i.e. the broker's —
  order and rendered SPY $593 · LLY $761 · NVDA $1,068 · V $871 · GOOGL $914 down a card whose whole
  job is to show where the money is. The sort lives in **`agenticBook()`**, not at the render site,
  because three surfaces read that one array (the card's holdings table, its off-target orphan list,
  and the Plan tab's off-target line) and sorting per-site is how this repo keeps producing drift;
  `agenticEnriched()` got the same ordering for the shared analytics renderers. Two details are
  load-bearing: the sort key falls back to `qty × px` when `value` is 0, because the card's own row
  builder does (an unquotable name prices at 0 in the producer, and an order that contradicts the
  figures printed beside it is worse than the broker's order); and the **deliberate non-value
  orderings were left alone** — the hand-off's orphan exits stay losses-first (tax), the margin
  paydown table stays weakest-momentum-first, the Flow card stays flow-score-ranked, ex-dividends
  stay by date. The 🧹 Positions Under $250 chips flipped from ascending to descending to match.
  v143 is the
  **RECORDED-BASIS** pass (2026-09-10): the self-directed account's equity series moves off `total_value` onto the
  brokerage book (`brokerageEquity`), after `total_value` was measured to INCLUDE the event-contract sleeve the docs
  had always claimed sat outside it; the consumer's only change is that the 💰 contributions strip skips the one-off
  `basisShift` point, so a change of measuring perimeter is not listed as a transfer the owner made (see the
  prediction-market gotcha and the `equityseries.mjs` row); v142 is the **PER-LOT MIN-HOLD** pass (2026-09-09): the 14-day churn guard stops locking a whole POSITION because part of it was bought recently — only the in-window lots are held, an oversized trim/exit is resized to the free shares and the locked remainder is reported with its own unlock date (see the `agentic-deploy.mjs` row); v141 is the **ANALYZE ACCURACY + WIDE FRESH BENCH** pass (2026-09-09, Plan→Build→Verify on three Sonnet research reports): every Analyze reader now goes through one staleness-gated, live-spliced `azHist` (technicals **withheld** past 10 stale days, haircut and badged at 4–10), the call is a PURE `azCore` with a real five-state label machine (the old ladder was effectively binary and its "Oversold Bounce" branch never fired), ATR-based stops decoupled from structure-based targets with reward:risk shown and enforced, a **📏 Measured in this snapshot** strip that walks every label forward over the whole universe's recorded closes, a rewritten Recommendation card (action · why · horizon · R:R · what flips it · data quality), the "Rev growth: NaN%" and trailing-P/E-as-forward leaks fixed, and on the producer side `analyze-universe.mjs` + `hist-plan.mjs` + `histbars.mergeBars` keep a ~230-name bench fresh for ~16KB/day (see the gotcha below); v140 **fixed the Daily-Picks Track Record**, which was reporting a **0% hit rate** it had no evidence for: episodes are now graded (and FROZEN) in the producer via `pickgrade.mjs`, a price series that does not reach the measurement date reports **can't be graded** instead of "open", a resolved pick is measured **to its exit** rather than marked to today, and every price on the card carries its as-of date (see the gotcha and the `pickgrade.mjs` row); v138 is the **Mandate A VERIFY** pass (the consumer half of the three seams the adversarial verify caught: the stale-zone asymmetry mirrored into `agenticExecMap`, and the drawdown banner/hand-off quoting the relative figure); v137 is the **MANDATE A** pass (owner-set 2026-09-08: the agentic account's job is to BEAT SPY over rolling 12-month windows, not to preserve capital): the defensive floor and gold sleeve go to 0, the index core becomes a 5-10% residual, the drawdown breaker becomes **relative to SPY**, deposits **tranche in**, the `entryQuality` haircut becomes **relative to the cohort median**, the stale-zone waiver becomes **asymmetric**, and both Rebalance Logs gain a **buys-only alpha** strip (see the mandate entry below and `AGENTIC.md`); v136 **reworked privacy mode** (👁️/🙈) from a one-page dollar blur into an app-wide, region-based redaction, and fixed a `dLbl` ReferenceError that blanked the entire agentic Plan tab whenever the drawdown banner rendered (both below); v135 carried the two owner decisions of 2026-09-03 onto the phone (**parking narrowed to wash-sale only** after idle cash moved to a high-yield sweep, and the **$25 de-minimis wash floor**); v134 gated every agentic **buy-side deferral on there actually being a buy** (the phantom "above entry" rows — see the gotcha); v133 replaced the **"one-tap confirm" wording** the app had never been able to deliver with the two real confirm paths (`agentic-confirm.mjs`, or a reply in Claude); v132 added the Income & Tax **prediction-market line item**; before that, — v127 added the self-directed Rebalance Log, v128 moved it to the Accounts tab beside the agentic one, v129 made both logs **accumulate a usable record** (frozen outcome marks + time-based retention), v130 **backfilled those marks from recorded daily closes** so the record starts full instead of empty, and v131 was the **navigation & accessibility pass** — bottom tab bar, section rail, Find, My view, ▲/▼ glyphs (all below).
- **••••3900 RUNS MANDATE A — BEAT SPY (owner-set 2026-09-08).** Objective: outperform SPY over rolling
  12-month windows. Unlevered, 10-12 names, research-driven, churn-governed, and it **accepts tracking
  error and drawdowns as deep as or deeper than SPY's**. **No structural ballast** — index core ≤10% (SPY
  as residual only), `AG_DEFENSIVE_MIN` **0**, `AG_DIVERSIFIER_MIN` **0**. Risk control is **relative**
  (the drawdown breaker acts on the book falling BEHIND SPY, never on it falling WITH SPY) and
  **correlation-based** (the cluster caps, which were NOT loosened and are now the primary downside
  control). **Never market-timing.** The trigger: the book was +4.40% vs SPY +3.94% since inception but
  −0.98% vs +0.56% over the preceding fortnight, and a bottom-up attribution put that gap in three names
  plus **structural ballast** (LLY −0.64pp, the floor+gold −0.54pp, BKNG −0.43pp) with execution costing
  ~zero — 42.5% of the book had zero or negative expected alpha in a rising tape. **Everything here is
  still MEASURED** (`target.defensive`, `diversifier`, look-through) — only the obligation went away, and
  each floor is a one-constant restore. Full rationale and the "what this will feel like" note:
  `AGENTIC.md` § THE MANDATE.
- **Two accounts, two MANDATES — never let one side's rulebook leak into the other.** ••••0741
  (self-directed) is the **aggressive** book: concentrated, high-beta, levered, momentum-driven —
  since v202 its dials are **Apex's** (`ui/apex.js` `C`: 1.35× cruise / 1.5× cap, Monday research targets);
  the `SD_*` constants in `index.html` keep only the broken-thesis exit and the retired plan behind `SD_APEX_RUNS=false`. ••••3900 (agentic) is the **guarded** book:
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
- **Track Record fixture (v140):** the sample snapshot now carries `picks.history` + `picks.grades`
  built by running the REAL `gradeAll`, with bars dated relative to TODAY (the rest of the fixture's
  bars are a fixed Jan–May stub, and a track record must reach the present or every episode is
  unmeasurable by construction). Five tickers cover all five outcomes — WINNER (TP2) · BANKER (TP1) ·
  BROKEN (stopped) · RUNNER (open) · **GHOST** (prices stop 3 days after the scan → can't be graded,
  listed twice so the episode dedupe shows). The card had NO fixture before, which is how it reported
  0% for weeks without anyone seeing it in preview.
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
  `shapeSocial`, `computeAlerts`, **`agentic-exec-gate`** (the 2026-09-08 idle classification: each of the six unrecoverable reasons marked degraded, each self-clearing one left silent, the `[DEGRADED]` marker string the Routine greps for, and a COUNT of plain `idle()` calls so a new early-exit cannot be added without classifying it), **`pickgrade`** (the track record: both bar shapes coalesced and interpolated/live rows dropped, the episode dedupe and its gap boundary, **a series that stops days after the scan reported UNMEASURED rather than OPEN and carrying NO return** — the defect itself — a zero-bar episode likewise, the long-weekend reach tolerance binding on one side and not the other, **a STOPPED episode returning at its stop rather than at the rally that followed it**, TP1 banking so a later stop cannot undo the win, the stop tested before the targets on a shared bar, an intraday spliced bar unable to trip a stop, the horizon closing the window on a late target, **a frozen outcome surviving its bars going stale AND not being rewritten by richer later data** while an UNMEASURED one is still retried, a hit rate of `null` rather than 0% when nothing could be graded, and the fetch universe excluding resolved/expired episodes so it DRAINS), **`agentic-method`** (the v145 construction-note formatter, extracted out of `index.html`: the losslessness invariant itself — every character of `method` reaching the rendered output in order, against the LIVE committed target so the test tracks what actually ships — an unrecognized tail segment surviving verbatim under a neutral marker rather than being dropped, a semicolon-joined drop list becoming one line per drop, a decimal not read as a sentence end, the two-weight emphasis with RSI/AFTER/COHORT proved NOT to be mistaken for tickers, a single-letter ticker not matching inside a word, `ppm` not read as percentage points, markup in the note escaped rather than executed, emphasis never matching inside its own markup, and a target with no names/defensive/diversifier still rendering its note), **`histbars`** (the v139 bar compaction — the real live bar shape pinned verbatim, idempotency, series length preserved through a junk bar, a no-close bar passed through untouched, `h`/`l`/`v` dropped only where the reader's fallback matches, `interpolated:true` surviving while `:false` is dropped, and — the assertions that actually matter — `drawdown.benchSeries`, `maindecisions.spyClosesFrom` and a verbatim copy of the consumer's `azSeries` all returning BYTE-IDENTICAL output from the raw and compacted shapes), the **agentic v93 engines** (`riskweights` cluster/vol caps + the **v124 singleton-loophole closure** and **defensive floor** — the vol gate that disqualifies a wide-range pharma name, the per-cluster pooling that stops a top-up breaching the receiving cap, the never-fabricate shortfall report, and the `defensiveMin:0` off switch — **all now asserted with an explicit `defensiveMin`/`diversifierMin` since Mandate A set both defaults to 0 (migrated, never deleted: the mechanism must keep working because restoring either floor is one constant), plus the new default-path cases proving a megacap-only book is passed through untouched while the exposure is STILL measured**,
  `agentic-deploy` earnings-blackout/gap-reverify/wash-sale planner — plus the **v102 entry-band layer** (tolerance under the floor, the new above-entry premium deferral, zone ageing → advisory, the idle-cash deadline + tranching/sweep, and index parking: park-on-defer, release-to-fund, the off-target-exit exemption that stops the churn loop, PDT-guarded releases, the **2026-08-28 funding reconciliation** — a sub-floor shortfall re-sizes the buy instead of shipping it unfundable, the same for a parked block under the floor, and an at-or-above-floor shortfall still releases exactly as before — and comma/prose entry-zone parsing) — and its **v96 full-book layer**:
  off-target exits, TLH thresholds + cross-account wash, tax netting, the $10,000 auto tier, plus the **v98
  limited-margin layer** — same-session proceeds funding and the PDT day-trade guard across exits/harvests/trims — and the **2026-08-12 churn governor**: min-hold blocks/overrides (deep-loss, business-broken, harvest-exempt), the re-entry cooldown (+ its VTI parking), the dust floor, and the phase-out no-new-money rule — `agentic-triggers` deposit +
  refresh events, `agentic-ledger` decision grading + `activityFromDecisions` + the **v129 frozen marks** (stamped once at the horizon; a later run at a wildly different price cannot move a stamped mark; a record first seen past its horizon records `missed` rather than a value, so a backfilled log yields no statistics instead of false ones; the grace window; an unpriced decision waiting rather than recording a false miss; and `grade`/`sleeves` left untouched) **and the v130 recorded-close basis** (a backfilled decision measured close-to-close at exactly its horizon; the STALE-SERIES abstention — a series ending before the horizon is unmeasurable, never priced off its last bar, while a horizon its bars do cover still measures; no partial mark when any leg can't price; a horizon whose target date is still ahead left alone; both bar shapes with interpolated/live/zero rows dropped; a sell of a name that then fell marking positive; and a already-stamped mark not re-derived from bars), **`maindecisions`** (the self-directed log: the ET-fill grouping incl. the previous-evening boundary and the placed-vs-filled distinction, same-day clips collapsing to one share-weighted leg, the DRIP/cancelled filters, `spyAt` stamped from that day's close and `null` rather than guessed when absent, both bar shapes + the interpolated/live skips, the snapshot merge — out-of-window carry-forward, in-window sweep of a day the broker no longer reports, the owner-overlay annotation, **time-based retention** (four years of records at this account's real rate all kept, a record past the horizon dropped, the filter inert when `asOf` is omitted) and the runaway cap, **plus the 2026-09-03 `SWEEP_MAX_DROP` short-payload guard** — a narrowed (untruncated) page caught and swept only from what it covers so the merge keeps every pre-coverage day, a run of orphans at/under the threshold still read as ordinary corrections and swept, a phantom day INSIDE the covered range still swept while the guard holds, owner-committed days neither arming nor swept by it, and omitting `prior` reproducing the pre-guard behaviour exactly — and an end-to-end pass proving the derived log grades through `agentic-ledger.gradeDecisions` unchanged with no sleeve attribution), **`agentic-pending`** ticket
  lifecycle/transitions/staleness **plus the v126 `blockedSells`/`warnings` persistence** — guard, unlock date
  and would-have-been kind all survive onto the ticket, dollars rounded like any leg, warnings capped, empty
  arrays rather than `undefined`, and blocks deliberately absent from `planHash`), the **flow scorers** (`flow.mjs` — revision
  direction-over-level, the insider open-market filter + buy/sell asymmetry regression, surprise
  clamping, composite renormalization + the abstain-below-2-components rule), the **policy calendar**
  (`policy.mjs` — high-impact-only blackout, source requirement), **`polflow`** (dedupe, the ≥3-distinct-filer
  gate, the megacap-tech exclusion), **`finalists`** (the challenger quota: reserved slots filled with non-incumbents only, the shared per-sector budget, merit backfill when challengers run out, the old top-10 behaviour reproduced at `challengerSlots:0`, the sector-balanced `universeSlice`, **and the mirror check that runs the workflow's own inlined copy against the module**), **`riskweights`** (the **gold diversifier**: floor top-up, the own-ceiling bound so it is not an overflow sink, never-a-donor to the defensive floor, never-fabricated when absent, and `diversifierMin:0` as a real off switch; plus the **look-through report-only migration** — caps binding on direct while the total stays computed and disclosed, and no false RESIDUAL on an unenforced basis), **`finalize-target`** (the **structural gold injection** — injected only when absent, at the normalization-surviving weight, tagged `Diversifier`, never overriding a vehicle the allocation already chose; the **2026-08-25 verdict-derived entry bands** — the discount curve, the 8% cap that keeps a zone reachable, never-loosens, the defensive-floor exemption, `absent ≠ zero` so an unscored name is not handed the maximum haircut, and the rewritten zone still parsing first-two-numbers as lo,hi per `agentic-deploy`'s contract; plus the **vol-gate regression** that a wide-range pharma name is excluded from the floor once px/hi/lo are supplied),
  the **Mandate A drawdown breaker** (`drawdown` — a market-wide fall reading ~0pp relative and NOT tripping where the v121
  absolute rule would have, an idiosyncratic fall of the same depth tripping soft, a −3% book against a +3% market tripping
  on −6pp relative where the absolute rule would have missed it entirely, the −20% absolute backstop binding on a crash the
  market shared, a STALE bench refused and falling back to absolute-only rather than blaming the book for a market-wide drop
  while the same decline against a FRESH bench still trips, no bench at all inventing no relative figure, hysteresis and a new
  peak re-anchoring the BENCHMARK as well as the book, and both bar shapes with interpolated/live/zero rows dropped), the
  **deposit tranche** (a lump rationed on day 0 and 1, whole from day 3, a sub-floor balance never split, proceeds never
  rationed, and the idle deadline still winning so it can delay a buy and never veto one), the **asymmetric stale-zone rule**
  (a stale target still waiving BELOW-entry per the v102 whole-book-stall lesson while ABOVE-entry survives staleness, with
  the live 2026-09-02 V fill at $378.30 against its own $372.50 ceiling pinned as a regression), the **raised TLH floor** (a
  loss that cleared the old $75/5% floor no longer harvested and so no wash block manufactured against a name the target still
  wants, plus the percent arm binding independently on a large shallow loss), **`buyStats`** (buy legs only, dollar-weighted
  so a dust winner cannot outvote a large loser, a well-timed trim excluded, abstaining rather than distorting when spyRet or
  a price is missing, and `stats`/`sleeves` left untouched), the **relative entry bar** (`cohortEntryBar` as the median, a
  uniform-3 cohort haircutting NOBODY where the absolute bar would have haircut every name, a name genuinely worse than its
  peers still tightened, the absolute `AG_ENTRY_Q_FLOOR` backstop still binding, an absent cohort falling back to the legacy
  bar rather than to zero, an end-to-end finalize run over a uniform cohort rewriting no zone at all, and the defensive
  exemption going inert once the floor is 0), the deterministic `drivers` attribution + the two-strike phase-out: strike-1 retention, strike-2 drop, business-broken and not-held drops, **plus the v126 same-day re-run carry-forward** — a record survives a finalize run against finalize's own output, keeps its ORIGINAL `since`, is not duplicated, is retired the moment the name is re-included or the position exits, loses to a freshly-detected drop, and expires past the retention window when `held` was never supplied — plus the **v124 defensive floor** reaching the committed target — shortfall reported on a megacap-only book, satisfied and silent on a book with real ballast, `defensiveMin:0` restoring pre-v124 behaviour), the **option money units + collateral rules** (`options.mjs` — per-contract vs
  per-order premium, the signed short credit, `sharesLockedByShortCalls`, and the covered-call idea
  guard), the **realized-vol IV proxy** (`optvol` — the horizon-matched window proving a calm recent
  regime is NOT blended with an old wild one, both bar shapes agreeing byte-for-byte, interpolated/live
  rows dropped, a short series and a FLAT series both ABSTAINING rather than scoring ~0 vol, junk
  out-of-band results abstaining, **a 7-bar tail yielding null and FALLING THROUGH to the deeper
  snapshot series — the defect itself**, an earlier source that does produce a figure still winning,
  tail+full concatenating and deduping by date, and an END-TO-END pass through the real `buildIdeas`
  pinning the live RCL case: the flat default reproduces the shipped $13.05 while a real 32.2% vol
  cuts premium, income, breakeven AND the headline annualized yield with it), the **recorded brokerage basis** (`equityseries.mjs` v143 — `brokerageEquity` over the live sleeve-INSIDE
  payload pinned verbatim, the same equity derived from a sleeve-OUTSIDE payload so the basis is
  convention-independent, the zero-sleeve account that reconciles vacuously and is what hid the bug, an unknown asset
  bucket surfacing as a residual rather than skewing the basis, the v116 loan term still binding, and the fail-back to
  `total_value` when components are missing; plus the one-time perimeter shift — booked as a flow so it cannot read as
  a loss, exempt from the noise floor because it is read not inferred, fired exactly ONCE, **surviving all ~13
  same-day re-runs with its flag intact** (the hourly-cadence case the deposit tranche taught), inert on a zero-sleeve
  account, and absent entirely when `sleeveValue` is not supplied), the **recorded equity series** (`equityseries.mjs` — the deposit inference incl. its
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
  trades are kept, and the retention window), the **weekly research gate** (`agentic-due` — every weekday a
  target could land on is due on the next Monday fire, a same-week refresh is not, the staleness backstop,
  fail-open on a missing/malformed target, and a future-dated target not forcing a refresh off clock skew),
  and a full `build-data.mjs` fixture run
  (empty-bars guard, quotes carry-forward, no-picks log guard, social-sidecar reuse, day-move alert,
  **flow sidecar → `data.flow` + per-symbol carry-forward**, **a prediction-market settlement excluded from the
  self-directed `cumFlow` while a real same-step deposit is still caught, and a blank-symbol settlement kept out
  of the wash-sale ledger**, **the v127 `data.main.decisions` emit** — a two-sided day becoming one `rebalance` record, the DRIP and cancelled orders filtered out, a 02:00Z fill filed under the previous ET day, `spyAt` read from the carried-forward SPY series, the in-window sweep of a phantom record and the out-of-window carry-forward — **the v126 `data.agentic.blockedSells` emit** — a done ticket still stripped from `pending` while its in-force blocks reach the consumer, an expired block filtered out, and the source ticket identified — **congressional ledger accumulation + dedupe**, **per-account broker realized superseding the stale owner figure**, **real closing trades replacing an inferred wash-sale entry**, and **`data.main` recorded from the brokerage book with its deposit inferred into cumFlow**). CI runs these on every
  PR touching `producer/**` (`.github/workflows/tests.yml`). The build-data test temporarily writes
  a plaintext `data.json` and restores it — don't commit mid-test.
- Inline JS parse: extract `<script>` blocks and `new Function(src)` each (skip block #1 = JSON-LD).
- **Privacy mode:** any change that adds a card rendering account figures must re-run
  `node producer/privacy-audit.mjs` (see the key-files row for the env it needs). A leak here is
  invisible to the owner — the numbers look normal, only the audience sees more than intended.
- Producer dry run: `PF_PASSPHRASE=… node producer/run.mjs --no-push "test"` → expect "replay
  contract is valid ✅"; then `git checkout origin/main -- data.json` to discard the dry-run build.
- Intraday carry-forward test: move `producer/raw/hist-*.json` aside, build, confirm `data.hist`
  still has full series (carried forward), Markets coverage clean.
- **Replay-key contract:** the consumer looks up recorded MCP responses by `makeKey()`
  (`producer/key.mjs`) — args must serialize byte-for-byte identically on both sides, or it's a silent
  `[replay miss]`. `validate.mjs` checks this; don't reorder keys in AV/recorded arg objects.

