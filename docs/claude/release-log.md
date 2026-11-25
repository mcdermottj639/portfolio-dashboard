# Release log (v148 → newest) and dated producer entries

> **ARCHIVE / REFERENCE — not default context.** Moved verbatim from the repo-root `CLAUDE.md` on 2026-11-18 (docs/process-only PR). Nothing here was rewritten. Where this text conflicts with the root `CLAUDE.md`, the root file wins: it holds the current ACTIVE RULES. Labels used there: ACTIVE RULE / CURRENT STATE / HISTORICAL / UNVERIFIED.

> HISTORICAL record of every release, newest first, exactly as it stood in `CLAUDE.md`. Use it for "why is it like this?" questions: `grep -n "^## v264 — Wasted space / misaligned cards: Full and Book layouts (2026-11-25)
Jack (Nov 25, phone-tested Book Actions: "Good but still wasting space cards not aligned"; then "Portfolio is the full view even more so than book with wasting space so check all").
Layout CSS only (`ui/duo.css` §9f); no card, number, rule, copy, producer or schedule change.
Full (740-1100, not Book): Overview strip/Action Center/More lose the 560/640px caps (rows two-up) and the analysis cards pair by height
(performance+income, risk+heatmap, technicals+fundamentals, flow+allocation; CSS `order` only); Positions holdings two-up (open card spans two rows);
Apex Actions cards pair like the Agentic plan, rows share a height, Apex card uses its Book single-column order.
Book: the Expand/Collapse-all bar floats (zero-height bar, fixed button) so the right page's first card starts at the top of the pane; cards 14px side padding.
Files: ui/duo.css, index.html, sw.js, tests/journey.test.cjs (version bump to v264). Folded and 390px unchanged (page heights identical).
NOT verified: a physical iPhone Duo.

## v2[45]" docs/claude/release-log.md`, or grep a ticker / file / function name. New releases add a SHORT entry at the top (see root `CLAUDE.md` § Writing to these docs).

## v264 — Today Scoreboard card (2026-11-25)
Jack (Nov 25 2026, after a mockup: "Build it but put that score card just on main today page. Shouldn't be buried").
New card under the Today hero: four rows from ONE start date (first v2.9 paper cohort entry, now Nov 24): SPY, Apex current
(v2.8 live picks), Apex v2.9 (always "paper"), Agentic ••••3900; diverging bars, percent only, chips 5 / 30 / 60 / 90 / Since start.
Display only. Reads `data/apex-paper-v29.json` (cohorts, marks, shadow), `data.hist.day.SPY` and `data.agentic.equityHistory` via
the existing `recordedAccountReturn`. Nothing is estimated or backfilled: a missing number is a dash with "too early" /
"missing" / "no history yet"; the first-score date is computed (5 trading days, NYSE holidays 2026-27 in `today-model.js`).
Files: ui/today-model.js (`scoreboard`), ui/today.js, ui/today.css, ui/duo.css (grid area), index.html (version + paper-load repaint),
sw.js, tests/scoreboard.test.cjs, tests/journey.test.cjs. Not verified: a physical iPhone Duo.

## v260 — Morning ticket marks rows whose order is already placed (2026-11-20)
Jack (Nov 20 2:30 AM ET, ZS on the ticket beside his Nov 9 ZS TP/SL order: "Why is this showing if the orders in").
Producer: new EVERY-RUN read-only fetch `get_equity_orders { state_group: "open" }` on ••••0741 →
`raw/main-open-orders.json` → `producer/open-orders.mjs` → `data.main.openOrders` (open sells per symbol, no ids; never
carried forward, null ⇒ every row stays a to-do). UI: `Apex.ticket()` marks a sell-stop row placed when a sell stop rests,
a sell row only when a working sell at ≤ 2% over its limit covers its shares; placed rows sit muted at the bottom with
"✓ Placed" and the order's own levels; the header counts only rows left to place ("(3) · 2 placed"). Display only:
rules, R/R, Confirm and `bookLines` never read the orders (v211). Files: producer/open-orders.mjs, build-data.mjs,
PRODUCER.md, ui/apex.js, index.html, sw.js, tests. NOT verified: physical Duo.

## v259 — Today links to the morning order ticket; share counts on ticket rows (2026-11-19)
Jack (Nov 19 4:53 PM ET): "Have a link on today page that brings me to this spot". Today's "Waiting on you" header gets a
"🧾 Order ticket ↗" button (`data-td-apex-ticket`, ui/today.js) that sets `#apex-ticket`, so the v258 jump
opens Apex · Actions and scrolls to the ticket. Jack (4:56 PM ET, "Need share amounts"): each ticket row shows its
shares under the symbol (order size for buys/sells from `bookLines`, shares held for a sell stop). Files: ui/apex.js, ui/today.js, index.html, sw.js, tests. Display only; no data,
rule or order change. NOT verified: physical Duo.

## v258 — Morning order ticket on the Apex card, deep link #apex-ticket (2026-11-19)
Jack (Nov 19 3:14 PM ET, sample "Morning stock order ticket" image; option 1 picked 3:53 PM ET). DISPLAY ONLY.
`Apex.ticket()` re-lays the Confirm list (`bookLines`) as 🟢 Buys (entry · target · stop, R/R in the row) and
🔴 Sells & sell stops (sell lines + held names' research exit levels; never the owner-managed core). Rows are
`<details>` (tap for action, price, reason, Robinhood link). Stale research ⇒ "No ticket for today — research last
updated …"; stale quotes ⇒ "≈" estimates. `#apex-ticket` (index.html `apexTicketJump`, journey `pageRoute`) opens Apex ·
Plan, unfolds the card and scrolls to the ticket. Files: ui/apex.js, ui/journey.js, index.html, sw.js, tests.
No rule, price, order, prompt or schedule change. NOT verified: physical Duo.

## v257 — v2.9 Paper page: measured results, weekly cohorts, rejected-names ledger (2026-11-19)
Jack (Nov 18 10:51 PM ET, Duet relay, Priority 1). `ui/apex-paper.js` `research()` reads `evaluation` (eval-1 raw,
sim-1 simulated), `shadow` and `skipped` from `data/apex-paper-v29.json`. Three cards on the existing Paper page:
Measured results (four arms in a locked order, 30-day primary horizon, 5-day table labelled an early look, "x of 12
weeks", simulated in its own table or an honest wait line), Weekly cohorts (newest first, live-copy status, skipped
Mondays with reason), Rejected names (group chips + rule select, every frozen name once, weeks folded). Own `<h2>`
headers: the shared `.card-title` adds the My view pin button and this page carries none. Files: ui/apex-paper.js,
ui/apex-paper.css, sw.js, index.html, tests. No live rule, ticket, schedule, threshold or producer change; nothing
live reads the paper file. NOT verified: physical Duo.

## v256 — one Expand all / Collapse all toolbar per page; fold memory for every card (2026-11-19)
Jack (Nov 18 10:51 PM ET, Duet relay, Priority 2). Audit: the rail's Expand/Collapse all existed but v242 hid it on Apex /
Agentic; most cards (Risk, Plan, Research) reopened on every refresh; Collapse all hid the Apex Confirm card and Action Center.
Now: one `.pf-foldbar` control above the card stack on every page with foldable cards (rail button removed); every card keyed in
`pf_card_fold_v1`; Collapse all skips Apex card / Action Center / plan status / warning cards; empty state on an empty opened card;
one shared open/close path (`__pfFold.set`). Files: index.html, ui/experience.css, sw.js, tests (new foldbar-checks.mjs).
No strategy, order, threshold, schedule, account-isolation, data or producer change. NOT verified: physical Duo.

## Producer — Apex paper: daily prices and simulated sim-1 (2026-11-19, no app version change)
Jack (Nov 19, "Merge + daily prices"). `producer/apex-paper.mjs`: new `--paths` flag stores read-only daily
[date, open, low, close] per cohort name and SPY under `paths` (never overwrites a stored day; newest 26 cohorts);
Monday freezes now keep each pick's `stop` and `tp1`; `evaluation.simulated` (sim-1): paper (frozen weights) and
live (equal weight) cohorts held 30 trading days or to the stop, net return, SPY alpha, max drawdown, exposure,
stop hits; 0.20 pt cost, no margin interest. PAPER ONLY: no live rule, ticket, UI, schedule or `RULES_VERSION`
change. Tests: apex-paper 27/27. The task-prompt step that supplies `--paths` is drafted, not applied.

## Producer — Apex paper: live control arm, late-copy fix, eval-1 (2026-11-19, no app version change)
Jack (Nov 19, relayed): make v2.9 paper measurable; fix the 7:52 scan vs 8:30 targets-copy timing; never drop
rejected live names silently. `producer/apex-paper.mjs`: live v2.8 picks join the shadow ledger as `live-pick`;
a Monday whose live file lands after 7:52 gets its live names on the next run before the next open
(`liveStatus` added-late) or is marked `missing`; partial/failed Mondays go in `skipped`; new `evaluation`
block (locked spec `producer/APEX-PAPER-EVAL.md`, eval-1: 4 arms, 5/30/60/90d vs SPY, 0.20 pt cost, descriptive
until 12 cohorts). Raw only; simulated drawdown/stops need daily closes (task prompt change, Jack's call).
PAPER ONLY: no live rule, ticket, UI, schedule or `RULES_VERSION` change. Tests: apex-paper 23/23.
NOT verified: a real Monday freeze (first is 2026-11-23).

## v255 — cleanup release: What if? removed, cards open, labels, Book fixes (2026-11-19)
Jack (Nov 18, relayed handoff plan: "Say 'go'"): one release, six steps. What if? removed everywhere (route, page, Overview row,
Decision evidence link, Apex sliders, model fn); the Risk stress test stays. Cards start open except `agp-loop` and `opt-knowledge`
(`TUCK` in the fold IIFE; saved choices still win). Labels: Deployed 1 decimal, "No active ticket", "Target names held",
research age vs the 14-day cycle (`PFExperienceModel.researchCycle`; agentic research stamp stale after 14d, was 7), By Sector
denominator. Book: Actions left page + Performance + Top holdings (5); Allocation stacks in the pane. Phones: freshness stamp
wraps so the controls stay on screen. New `tests/sweep-browser.mjs` (route × 7 sizes × both accounts; reports, not in CI).
No strategy, order, threshold, schedule, account-isolation, data or producer change. NOT verified: physical Duo.

## Producer — Apex paper rejected-names ledger (2026-11-18, no app version change)
Jack (Nov 18 7:16 PM ET, after an opportunity-cost concern about the Apex filters): "Start paper review".
`producer/apex-paper.mjs` now freezes, with each Monday cohort, a `shadow` ledger in `data/apex-paper-v29.json`:
live v2.8 names blocked by the 40% tech cap or dropped for R/R under 1.5 (only when `data/apex-targets.json` is
dated the same day), plus the top 5 paper names per single failed test. All enter on paper at the next open and
are graded vs SPY per gate (`shadowMetrics`, `avgAlphaNet` = minus 0.20 pt slippage; margin interest not modelled).
New CLI flags `--shadow-fills`, `--shadow-marks`. PAPER ONLY: no threshold, live rule, ticket or UI changed;
`RULES_VERSION` unchanged. Tests: `producer/apex-paper.test.mjs` 20/20. The "Apex v2.9 paper track · 0741"
task prompt was updated to fill and mark the ledger. NOT built: a dashboard view of the ledger (first marks
cannot exist before ~Dec 1). NOT verified: a real Monday freeze (first is 2026-11-23).

## Docs/process — conditional UI docs + migration manifest (2026-11-18)
ChatGPT review of PR #248 (relayed by Jack 7:06 PM ET): `AGENTS.md` still told every task to read `UI-PRESERVATION.md`
(35.7K) and `UX_REVIEW.md` (15.9K). They now load for UI/layout work only; `CLAUDE.md` + `docs/RELEASE-WORKFLOW.md`
stay mandatory. New `docs/claude/MIGRATION.json`: SHA-256 of the source CLAUDE.md (c57f072) and of each of the 8
verbatim blocks; `tests/claude-docs.test.cjs` re-hashes every block, so an edit to moved history fails CI.

## Docs/process — instruction split: CLAUDE.md 575,553 → 18,625 characters (2026-11-18)
Jack (Nov 18 17:39 ET, Operations HQ): the last two releases took 113 model requests and 64.8M cached-read tokens;
"Create a separate, documentation/process-only optimization PR." Root `CLAUDE.md` now holds only ACTIVE rules,
release gates, the efficient-execution workflow, a targeted-test map and dated open items. Every original line
(4,306) moved verbatim into `docs/claude/` (architecture, process, key-files, gotchas, features, this log); the
three reference files gained a lead-line index. `AGENTS.md`, `docs/RELEASE-WORKFLOW.md` (Jarvis retired; measure
usage; one blocking CI watch), `PROPOSAL-app-structure.md`, `producer/AGENTIC.md` (one cross-reference line) and
`producer/PROPOSAL-hedgefund-gaps.md` point at the new paths. New `tests/claude-docs.test.cjs` holds the 40,000-
character budget. No code, data, rule, schedule, permission or version change. Scheduled-task prompts audited:
none depends on a CLAUDE.md heading or line; AGENTIC.md / PRODUCER.md headings and step numbers left untouched.

## v254 — Apex card no longer sends approvals to Jarvis (2026-11-18)
Jack (Nov 18 17:31 ET): "Best guess. 'Approvals live in Jarvis': the Apex card still says this." Jarvis is retired (Task storage is
a database only), and approvals have been the Confirm button since v199. Wording only: no rule, ticket, prompt or Confirm change.
- `ui/apex.js`: intro "Rules fire here; you confirm with Claude below; you place the order in Robinhood." Footer "Tickets are proposals
  from these rules. Check them with Claude using the Confirm button above, and against live holdings and pending orders before …" (the
  Jarvis link and the unused `DEFAULT_CFG.jarvis` are gone). Armed rung "armed — trigger set by the morning scan".
- `index.html` research note: "Buy lines are in the Confirm list on Actions." Comments updated.
- Tests: `producer/apex.test.mjs` now asserts the card names Robinhood and never Jarvis. Older entries below that say "Jarvis" are
  HISTORICAL.

## v253 — Research holds each account's research; Actions holds what to do (2026-11-18)
Jack (Nov 18 14:02 ET: "why does research always open to analyze. Apex and agentic plans should be under the research for each no?";
14:54 "PR 2 — Research/Actions redesign … Reuse existing cards; avoid duplicate information"). Display and navigation only: every card
is the same node drawn once by the same renderer; no rule, ticket, Confirm flow, prompt, data, producer or schedule change.
- **One page, two tabs.** New route `acctresearch` (`ui/experience.js`; account-scoped, tab `picks`, hidden from chip rows) is the
  workspace **Research** tab. It shows page-picks, the same page as `plan` (**Actions**). Pieces carry `data-ws="research"` or
  `data-ws="actions"` and `ui/experience.css` hides the other tab's pieces (`html.ws-on[data-ws-tab=…] #page-picks [data-ws=…]`).
  Untagged pieces (agentic hero, disclaimer) show on both. Classic view and every non-workspace route keep the whole page.

| Tab | Apex (••0741) | Agentic (••3900) |
| --- | --- | --- |
| Research | This week's research (top 5, record), ranked opportunities, screened out, weights vs target + tech bar, business check, v2.9 Paper pointer | Model correctness & forward record, The target and why, Business check |
| Actions | Leverage tiles, recommended trades + Confirm + review rows, rules firing, what-if, Action Center | Where the plan stands, What's blocked, The waiting ground, Guardrails, How the loop runs |

- **`ui/apex.js`**: thin wrappers only (`[data-apex-weights]`, `[data-apex-research]`, `[data-apex-sim]`) plus `data-ws` on each section.
  On Research the Apex sections are re-ordered by CSS `order` (research, weights, business); DOM order is unchanged, so Classic is.
- **Analyze** is no longer what the tab opens. A slim "Analyze a stock" row (`#ws-analyze`, the journey's existing
  `data-pj-go="analyze"`) sits at the top of the research page; Analyze opened from it (or from a position card) still keeps the
  Research tab lit and Back returns to the research page. Research > Analyze in the bottom nav is unchanged.
- **Book** (`ui/book.js`, `ui/duo.js` BOOK_ROUTES): on Research the left page is navigation: "On this page" (one row per research
  section visible on the right, tap = scroll the right page to it) and "Names in this research" (tap = Analyze). Labels and tickers
  only, no figure repeated. Actions keeps the review queue + risk/strategy block. The independent-scroll trial is NOT extended:
  `INDEP_ROUTES` is still `plan` only. Left-panel rows that pointed at research content (Tech outside core, Largest drift) and the
  Overview "theme cap" action row now open Research.
- Find / My view: a jump to a tagged card opens its tab first (`scrollToCard`).
- Timestamps unchanged: Agentic says research is every two weeks; the header Research stamp and its 7-day ⚠ (entry zones advisory)
  are as in v251. Known and left alone: the Apex header "Last scan" stamp reads the Daily Picks screen date, not the Apex scan.
- Tests: nav-b-checks (Research tab → account research; the row → Analyze; Back twice), workspace-checks (each tagged piece on
  exactly one tab; paper pointer on Research), book-checks section 4 (navigation panel, jump, names, no dollar figure),
  analyze-account-checks, experience.test / duo.test route lists. Not verified: a physical iPhone Duo.

## v252 — Held names always get daily history; Analyze reads one account's book (2026-11-18)
Jack (Nov 18 14:02 ET, two Analyze screenshots; 14:54 "PR 1 — Data integrity"): DXCM, about a fifth of Apex, read
"Limited Data / STALE DATA", and Research > Analyze with Account = Agentic listed the self-directed holdings.
- **Why DXCM had no bars (two defects, both in the fetch plan, both reproduced).** (1) DXCM, ZS, NET, SNPS and S are on
  NO static bench (`ANALYZE_BENCH`), so they entered `hist-plan.mjs` only through `raw/positions.json`, i.e. only when
  the planner ran after this run's position files were written. (2) A "full" batch was "≤3 symbols" of YTD bars, a rule
  written Sept 8 at ~153 bars a name. On Nov 18 the same call (DXCM, SPY, IREN from Jan 1) returned **115,017
  characters** and was refused inline, so the batch could not be written to `raw/` (measured in this session, ~173
  characters per bar). The live run log and the encrypted snapshot were NOT readable here (no passphrase), so which of
  the two bit on Nov 17-18 is not established; both are fixed.
- **`producer/hist-plan.mjs`.** Calls are sized by BARS: `HIST_CALL_BARS` 265, `symbolsPerCall(start, today)` (3 names in
  spring, one from about May; never under one), `HIST_FULL_CALLS` 12 per run (so the YTD cap is min(30, per-call x 12)),
  pinned Daily-Picks batches use the same sizing. Holdings = `heldFromRaw()` ∪ `heldFromSnapshot(snap)`; the target tier
  also carries `apexSymbols()` (targets, top five, held-level rows of the public `data/apex-targets.json`).
  New pure `heldHistoryGaps` / `heldHistoryDirective`.
- **`producer/preflight.mjs`.** On FETCH_LIGHT it prints `PREFLIGHT ALSO: held names with no usable daily history …` with
  the exact one-symbol calls and `hist-day-held-<n>.json` files (max 6), so a holding bought after the morning run is
  seeded within the hour. Code-side because the producer Routine's prompt is not editable from a session; it already
  says to obey preflight (the Nov 3 mail directive is the precedent). **Not verified until a run does it.**
- **`producer/build-data.mjs`.** A symbol present in more than one raw history file is UNIONED (`mergeBars`), not
  last-file-wins. After the build, any held name (both accounts) with no real daily bar inside 10 days is named in
  `refreshInputs.missing` as `holdings-history: …`, warned as `REFRESH_PARTIAL`, and (`refresh-check.mjs`) earns a FULL
  run its one bounded retry.
- **Analyze account isolation (`index.html`).** New `azBook()` = the ONE book Analyze reads, chosen by `pf_acct`
  (Apex = `window.__PORT`, Agentic = `agenticEnriched()` + `agenticBook().equity`). The holdings chips ("Top holdings ·
  Apex|Agentic"), Your Position (now badged with the account), sizing, Overlap With Your Book, the pattern-radar list,
  the miss-fallback chips and the autocomplete all read it; the per-snapshot memo is keyed by account; `azSyncAccount()`
  redraws the shell and the open ticker when the account changes (called from `switchTab`). `ui/journey.js` notice reads
  "General screen · Self-directed|Agentic positions only". Not changed: Screens' ✓ OWN badge and Markets' HELD tag
  (self-directed by design), the technical read itself (account-independent), any rule, ticket or schedule.
- Tests: `producer/hist-plan.test.mjs` (+18: bar sizing, snapshot holdings, gaps, directive), `refresh-recovery`,
  `build-data.test.mjs` (union across raw files, held-history warning; 109), new `tests/analyze-account-checks.mjs`
  (via journey-browser: both accounts, switch on the same screen, a name held in both, workspace Research tabs, privacy,
  no sideways drift). **Data freshness is NOT confirmed:** the fix takes effect on the producer's next runs and the
  snapshot cannot be decrypted from this session or from CI. DXCM on the phone is the check.

## v251 — Apex Actions: no Confirm at zero orders, repeated review lines grouped; Book scroll trial on Actions (2026-11-18)
Jack (Nov 18 13:57 ET, Book screenshot of Apex Actions at v250, "Ok fix that page and try the scroller fix"; 14:00 Agentic Actions screenshot).
- **`ui/apex.js` `portfolioButton`.** With no order line the green "Confirm this week's Apex book with Claude · 0 orders" block is not
  drawn (Today already hid its Confirm then); it had nothing to send and, pinned, covered the list above it. "Review · no order" rows that
  share a reason are ONE row (`[data-apex-review]`: tickers joined with " · ", the reason once, first-seen order). Same names and words;
  `bookReviews`, `bookLines`, `portfolioPrompt`, every rule and ticket are unchanged. Applies in every layout, not only Book.
- **Wording (index.html).** The agentic hero, disclaimer, card intro, empty state and target help said the research target is "refreshed
  weekly"; the gate has been fortnightly since 2026-09-24 (`agentic-due.mjs`). They now say "every two weeks". The 7-day ⚠ on the Research
  stamp is unchanged on purpose: it marks the point entry zones go advisory (`AG_ENTRY_STALE_D`), which is still true in week two.
- **Book scroll TRIAL (`ui/duo.js` `syncIndep`, `ui/duo.css` 9e).** Jack: flick the right page, touch the left panel quickly, and the right
  page keeps the touch. The right page was the document and the left panel a scroller nested in it. On route `plan` (Actions) in Apex /
  Agentic, in Book, the visible page (`[data-duo-scroller]`, `html[data-duo-indep]`) is now its own scroller and the document is locked, so
  `#pf-book` (a body-level sibling) is independent of it. **Only `plan` qualifies** (`INDEP_ROUTES`): its page holds no pinned block, and
  Safari mis-draws a fixed element inside a scrolling ancestor, so `syncIndep` also refuses any page containing a `[data-duo-pin]`. Every
  other Book route keeps the document scroll until its pinned blocks are moved out of the page — do that only if the phone confirms the
  trial cures the hand-off. `window.scrollY` / `pageYOffset` / `scrollTo` / `scrollBy` follow the page scroller while it is on (duo.js keeps
  the native ones as `rootY` / `nScrollTo`), a window `scroll` event is re-dispatched from it, `__pfTopOffset` returns the scroller's top,
  and the place is carried both ways on a mode switch. The freshness strip is `position:relative` while it is on (a locked body applied the
  sticky offset twice). Side effect: the Overview · Positions · Research · Actions row stays put while the page scrolls.
- Tests: `producer/apex.test.mjs`, `producer/apex-turnover.test.mjs` (no Confirm at zero orders, one row per reason, every name kept);
  `tests/book-checks.mjs` section 9 (document locked, nothing fixed inside the scroller, sibling of the panel, wheel moves only the right
  page, scrollTo/scrollY follow it, re-pin keeps the place, carried back in Standard, off on Positions). **Not verified, and not verifiable
  here:** iOS touch momentum and Safari's fixed-in-scroller behaviour — Chromium reproduces neither. A physical iPhone Duo is the test.

## v250 — Book mode: no right page keeps the viewport's two-column rules (2026-11-18)
Jack (Nov 18 12:15 ET, Book screenshot of Apex v2.9 Paper at v249: "Some issues in book mode"; 12:19 "Make sure that issue isn't
appearing elsewhere too"). Cause: rules keyed to the 740-1100px VIEWPORT kept drawing two columns inside the Book right page, which is
only about 459px wide. On Paper that made a 200px list beside a 224px detail (row cells printed over each other, Entry/Target/Stop
tiles and labels cut) while the left page sat empty under the tiles. Layout only; no number, rule, copy, data or producer change.
- **Paper (Book only).** `ui/duo.js`: the ranked card is a new last atom for `apexpaper` in Book and is pinned as a FILL block
  (`data-duo-fill`, `--duo-h` = the rest of the left pane, own scroll, scroll kept across re-pins) when the pane has >= 200px of height
  and >= 300px of width; otherwise it stays in the flow. `ui/duo.css` 9c: right page is one column, selected stock first at full page
  width, then Decision summary and the panels; filter chips are one sideways-scrolling line in the pinned list. Not pinned (466 / 390
  Book): the detail pane is hidden and rows expand inline, as on a phone. `ui/apex-paper.js`: a tap on a pinned-list row brings the
  selected stock to the top of the right page; `ui/apex-paper.css`: the setup chip can no longer print over the score.
- **Same fault elsewhere** (every route swept in Book vs Standard at 951x669 for clipped, overlapping and off-page elements; `ui/duo.css` 9d):
  Apex Actions card was leverage+rules | trades+Confirm in 459px, now one column in the folded-phone order (leverage, trades + Confirm,
  rules) and its blocks stretch (the opportunity list was 252px wide and cut its R/R lines); the plan's four Exposure/Equity/Leverage/
  Idle-cash tiles ran off the page, now 2 x 2; Markets index / gauge / macro tiles ran off the page, now two columns; the Agentic plan
  hero's stale line wraps instead of being cut. Clean: Today, Overview, Positions and the section routes for both accounts, Analyze.
- **Not changed:** Standard, Folded, phone and desktop layouts (their rules are untouched; every new rule is keyed to
  `html[data-duo-split="on"][data-duo-layout="book"]` or to `[data-duo-fill]`). Known, left alone: in Book the left page of Markets and
  Analyze holds only their banner (no command panel exists for Research; a new panel is a feature, not a layout fix), and the pinned
  header caption can still end in an ellipsis.
- Tests: tests/book-checks.mjs section 8 (list pinned left of the crease under the tiles, detail full right-page width, no overlapping
  row cells or clipped levels, tap updates and reveals the detail, 466 fallback, nothing filled in Standard / Folded, Actions blocks
  full width, no plan or Markets tile off the page). Not verified: a physical iPhone Duo.

## v249 — Book mode: Today gets the command panel too (2026-11-18)
Jack (Nov 18 01:21 ET, Book screenshot of Today at v248: the left page held only the combined hero, then blank; "Looks good on
other pages"). `ui/book.js` now also runs on Today (`ctx()` returns tab `today` for route `today`, any area). Two labelled groups,
each the SAME block the account pages use: **Apex · self-directed ••••0741** = the Risk block (leverage band, margin cushion, tech
cap, largest position) + its deposit-adjusted Performance; **Agentic · automated ••••3900** = the Strategy block (deployed, ticket,
largest drift) + its Performance. Deliberately NO holdings list on Today: its right page already has the combined holdings map,
so a list on the left would repeat it. Taps are account-aware now (route rows carry `data-ex-account`, card/holding rows
`data-bk-acct`), so a tap from Today opens the right account's Actions / Overview / Positions. Display only; no calculation, rule
or data change; Standard / Folded unchanged. Tests: tests/book-checks.mjs section 7b. Not verified: a physical iPhone Duo.

## v248 — Book mode vNext: command panel on the left page, analysis on the right (2026-11-17)
Jack (Nov 17 23:24 ET, screen recording of v247 Book mode on the open Duo, ~951x669 CSS px): the left page held only the value card with
empty space under it while the right page needed long scrolls. He approved ChatGPT's dual-pane proposal ("I agree" … "do it"): left =
command, right = analysis, the two pages connected, each account with its own priorities, Book-only, display only.
- New `ui/book.js` + `ui/book.css` (precached; book.css loads before duo.css so duo.css stays last). One fixed panel `#pf-book` (child of
  <body>, `data-priv="on"`) in the free part of the left pane, under the blocks duo.js pins there; it scrolls on its own (scroll kept per
  account + tab across repaints), so the right page keeps the document scroll. Shown only when Book is split AND the area is Apex or
  Agentic AND the left pane is ≥200px wide and ≥120px tall (so 390px Book keeps the v247 pinned summary only). Sets `html[data-book="on"]`.
- Per tab. Overview: Apex = Risk (leverage band gauge from `Apex.C` reload/cruise/cap and the review's `st.band`; margin cushion
  `st.callDrop` only when borrowing; tech outside the core vs its cap via `Apex.themeShare`; largest position), Performance (sparkline of
  `acctPerfStats` deposit-adjusted growth, return vs S&P same window), Holdings (top 8 by value: weight bar, today, return). Agentic =
  Strategy (Deployed = `agenticBook` invested / equity; ticket via `PFExperienceModel.ticketStatus`; largest drift from `__PF_AG_TARGET`),
  Performance, Holdings. Positions: every holding + the account's risk/strategy block. Research: "Compare holdings" (tap = the journey's
  Research step for that name). Actions: the Overview Action Center list (`PFExperience.actionsHTML`, new export) as a review queue + the
  risk/strategy block.
- Connected pages. A holding tapped on Overview selects it (`PFJourney.select`, so Research / Plan follow) and `experience.js` places a
  `#ws-selected` block (the same position card, open) at the top of the right page with a Close button; on Positions the tapped card opens
  first. Performance scrolls the right page to the Performance card (opening it if folded). Risk/strategy rows open Actions (the Apex card /
  agentic plan). A selection made on the right page highlights the matching left row.
- No repeated figures: on Overview the right page's snapshot tiles that the left page already shows (Day change / Leverage, Idle cash) are
  marked `data-book-dup` and hidden while Book is on; the grid re-flows (`data-book-n`). Strip clones never carry the mark.
- `ui/duo.js`: new `BOOK_ROUTES` (holdings, plan and Overview's section routes) split in Book only, inside Apex / Agentic; section routes and
  Positions also pin the account header. Folded keeps the v247 landing set (Positions / Actions stay full screen there). Hint text updated.
- `ui/experience.js`: `posOpts()` factored out of `posCards()` (same fields), `selectedHTML()`, `#ws-selected` placement (order 25),
  `PFExperience.actionsHTML`.
- Not changed: any calculation, rule, threshold, ticket, Confirm flow, producer, data, schedule, Apex/Agentic separation (Apex panel reads
  only the Apex review; Agentic only ••••3900 fields), Standard / Folded / phone layouts.
- Tests: new tests/book-checks.mjs (via journey-browser; also standalone): geometry left of the crease and under the pins at 951x669 and
  466x677, none at 390; per-tab content for both accounts; holdings = All Positions rows in order; tap → right page in place, Close, panel
  scroll kept; Performance jump; Positions / Research / Actions taps; Action Center parity; privacy masks $; gold theme; Folded/Standard
  leave nothing behind; folded Positions stays full screen. tests/duo.test.cjs asserts BOOK_ROUTES. Not verified: a physical iPhone Duo.

## v247 — Duo layout state + four-way mid-fold control (2026-11-17, issue #238)
Owner-approved spec (Jack 20:48 ET, Sports Hub duo.js as reference). Duo optimization ALWAYS applies; the Duo mode controls ONLY the mid-fold split. Layout only; no model, rule, ticket, Confirm, data, producer, schedule or .github change.
- `ui/duo.js` is the single owner of `html[data-duo-mode]` (auto|folded|book|standard, `localStorage pf:duo-mode`, junk/failed storage = auto), `data-duo-layout` (standard|folded|book), `data-duo-source`, `data-duo-split`, the `--fold-*` vars, `window.PFDuo` and the `pf:duo-change` event. Auto follows only the browser's fold signals (Viewport Segments / its CSS queries + Device Posture); without Safari's flags it stays Standard until Folded or Book is tapped. Inset and screen-size probes are never used to guess a fold.
- Control `#pf-duo` in the gray bar (icon-only <480px, 44px target, popover `role=radiogroup`). Standard = v246 geometry (1,537 element boxes identical to main across 6 views x 4 viewports, local check).
- Folded = top/bottom, Book = left/right, only on Today, Accounts (Apex/Agentic Overview), Markets, Analyze and v2.9 Paper; every other route is full screen in every mode. Existing nodes are pinned in place (position:fixed) while they fit; the rest scrolls with the document, so scrollY, Back/Forward, Find, My view and __pfTopOffset keep working. Route, selection, folds and scroll anchor survive every transition.
- Tests: tests/duo.test.cjs (detection, mode resolution, storage), tests/duo-checks.mjs via journey-browser (fold simulated with stubbed segments/posture + live change events). Not verified: real Safari fold APIs, WebKit, a physical Duo.

## v246 — Apex v2.9 Paper: decision view, Duo two-pane list/detail, filters, honest validation panel (2026-11-17, issue #235)

Jack reviewed a recording of v244's v2.9 Paper page and approved issue #235 (Claudex OPS-20261117-01). Display only, ui/apex-paper.js/.css; every number comes from data/apex-paper-v29.json at run time (no sample figures hardcoded).
- Top: PAPER ONLY label; separate stamps for research run, last success (only if different), next run, model version and cohort status; tiles eligible / scanned / qualified / near with share-of-scanned bars; paper picks + cash as one stacked bar using the file's published weights (rounding note when they sum to 99–101%); blocked names with their source reason or "reason not available".
- Open Duo (>=740 px): filterable ranked list left, selected stock right (setup, score, entry/stop/target, R/R, weight, sector, thesis = row `why`, selected/blocked reason); selecting updates the pane in place; opens on the first paper pick. Phone / folded: one column, rows expand inline.
- Filters: search; All / Paper picks / Qualified / Near / Blocked; folded More filters (sector, setup, min score, min R/R); Reset. Radios and an input reset (the page keeps its no-<button> rule). High-ranked blocked names are never hidden by default.
- Panels: qualified count by sector (pass rate only where sectors.universe has that sector's screened count), top-sector concentration as count and share of qualified, paper weight by sector + cash, validation panel "Not yet measured" listing what will be measured; alpha marks plotted only when recorded.
- Not changed: producer/, data, thresholds, weights, selection, live Apex v2.8/2.8.1, Confirm/tickets, accounts, schedules, routes. Stale rule stays the tested one (>26 h and a missed weekday run). Catalyst, drawdown and fees/slippage are not in the file, so they are not shown or estimated.
- Tests: new tests/apex-paper-view.test.cjs (edge cases: 0 picks, 0 qualified, no batch, missing reason, stale, unknown sector, rounding) and tests/apex-paper-view-browser.mjs (320x690, 390x844, 466x677 with right inset, 960x676). tests/apex-paper-checks.mjs section 5 now asserts list left / selected stock right instead of funnel/list columns. Not verified: physical iPhone Duo.

## v245 — Apex / Agentic workspace: one header, one tab row, decision cards (2026-11-17)

Jack (Nov 17 09:08 ET, Duo screenshot of Apex > Plan at v240): too many navigation layers, investment information below the fold, position card should be a decision tool, Holding > Research > Plan as stages not big buttons, distinguish freshness, better home for Options Income & History. He approved a mockup ("Build it", 09:18), asked for full date + AM/PM ET (09:27, shipped in v243) and set five release checks (13:32): Duo layouts, one authoritative date/time stamp, Apex/Agentic separation, v2.9 Paper without a fifth tab, CI + live verification.
- Header (Apex, Agentic, Research, More): page name + identity line ("Self-directed · ••••0741" / "Automated · ••••3900"), compact Back arrow, existing tools. Classic view moved under More. Today's header unchanged.
- Stamps: Research and Last scan (Apex), Research (Agentic), "Nov 17, 9:41 AM ET" format, "(date only)" when the source has only a day; omitted when there is no source. No Account stamp: the gray freshness bar is the one account time, with its stale warning.
- One tab row for Apex and Agentic: Overview (accounts route) · Positions (holdings) · Research (analyze, area kept highlighted when entered from the tab) · Actions (plan). The old sub-nav, card rail chips and the three big journey step buttons are gone from these pages; PFJourney state/Back unchanged. 22 routes unchanged.
- Overview: value, today, leverage / invested + idle, then an Action Center list built only from existing items (Today's waiting/monitor items for the account, existing risk notices, options items, ticket status via PFExperienceModel.ticketStatus), then rows for What if?, Options Income & History, v2.9 Paper research (Apex only) and the existing secondary cards. The agentic trade review (with the in-flight strip) lives with All Positions on Positions.
- Positions: decision cards from existing fields only (price, value, % of book, total gain/return, today, risk = the existing concentration label, next action = existing Apex review words, stop/target or target weight/drift for Agentic); "—" when unknown; slim Holding — Research — Plan stage line.
- v2.9 Paper (v244) stays reachable from the Overview row and the pointer under the live Apex card on Actions; no fifth tab; Apex keeps the highlight on the paper page; Apex reopens its last live tab.
- Not changed: models, rankings, stops/targets, confirmation flow, data, producer, schedules, .github. No dedicated half-fold layout exists in this app (Sports Hub only); folded, open and sideways Duo were checked.
- Tests: tests/workspace-checks.mjs (via journey-browser), nav-b-checks, apex-paper-checks, ticket-status-checks, experience.test.cjs updated. Local: journey 684 s PASS, sd-plan, apex, holdings-duo PASS; unit 87/87; producer 58/58. Not verified: physical iPhone Duo.

## v244 — Apex v2.9 PAPER research view + market-wide scanner engine (2026-11-17)

Jack (Nov 17 2026): "I am authorizing the expanded research system and paper testing to become fully operational. I am not authorizing switching the live strategy to v2.9, changing trading rules, executing trades, or granting new account permissions." Live Apex stays rules v2.8; `ui/apex.js`, `ui/sd-rules.js`, `data/apex-targets.json`, the Confirm flow and every ticket are untouched and never read the paper file (asserted in `tests/apex-paper.test.cjs`).
- **Engine (code, not prompt).** `producer/apex-paper.mjs` (rules `v2.9-paper-1`, pure + CLI) scores every Robinhood scanner row: universe market cap ≥ $2B, 30-day average volume ≥ 500k, price ≥ $10; setups A breakout / B pullback / C reversal; composite + R/R ≥ 1.5; Monday batch ≤ 4 picks, ≤ 2 per sector, tech ≤ 40%. `producer/apex-paper-scan.json` holds the 12 sector / market-cap slices: the scanner returns at most 200 rows a query, so each slice must return rows == total_items, duplicates are removed, and an incomplete pull publishes `status:"partial"` with the real coverage. `--fail "<reason>"` marks a run FAILED and keeps the last good research under its own older time. A threshold change bumps `RULES_VERSION`. Tests: `producer/apex-paper.test.mjs` (19).
- **One canonical output:** `data/apex-paper-v29.json` (schema 1: universe, funnel, rejections by reason, ranked qualified / near / emerging with entry · stop · target · R/R and evidence, indicative batch + blocked, sectors, v2.8 comparison, cohorts + frozen marks, backtest block, notes). The "Apex v2.9 paper track · 0741" scheduled task (weekdays 7:52 AM ET) runs the engine and publishes ONLY this file by a data-only PR it merges after `test` + `data-integrity` pass. No new schedule was added.
- **View.** `ui/apex-paper.js` + `ui/apex-paper.css` (precached), page `#page-apexpaper`, route `apexpaper` in the Apex area ("v2.9 Paper"), plus a pointer row under the live Apex card. Shows eligible vs scanned, qualified, rejection bars, ranked rows that open to levels and evidence, paper buys vs blocked, sector coverage, v2.8 LIVE vs v2.9 PAPER, last successful run, cohort results. Missing, unreadable, FAILED, partial and stale (> 26 h) are five named states; an old successful time is never shown as the current run. Layouts: phone, folded Duo, folded sideways, open Duo two-pane.
- **First full run:** Nov 17 2026 9:22 AM ET, 1,555 eligible = 1,555 scanned (12 slices whole, 0 duplicates), 68 qualified, 0 breakouts qualified (target too close to entry for 1.5 R/R — a finding, no threshold changed). First paper cohort freezes Monday Nov 23; results are descriptive until 12 Monday cohorts.
- **Backtest** block reads "pending" until the one-off 66-name price-rule backtest stores its result; it is hypothetical, in-sample and survivorship-biased and is labelled so on screen.
- Files: `producer/apex-paper.mjs`, `producer/apex-paper-scan.json`, `producer/apex-paper.test.mjs`, `data/apex-paper-v29.json`, `ui/apex-paper.{js,css}`, `ui/experience.js`, `ui/journey.js`, `index.html`, `sw.js`, `tests/apex-paper.test.cjs`, `tests/apex-paper-checks.mjs`, `tests/journey-browser.mjs`, version-only test updates, `UI-PRESERVATION.md`, `producer/SCHEDULING.md`, `CLAUDE.md`. App/cache **v244 / pf-v244**. Not verified: a physical iPhone Duo, WebKit locally.

## v243 — Header shows the full date and time again: "Nov 17, 9:41 AM ET" (2026-11-17)

Jack (12:38 ET, Duo screenshot of Today at v242): "Bring back the am/pm ET the full date and time like u had originally in the grey we have the space". `paintBar()` in index.html no longer strips the AM/PM (added in v228) or the ET suffix (v230) from `generatedAtLabel`; the current year is still dropped as before. The black tape stays time-free (v242). Verified fitting beside the header icons at 320, 390, 466x677 and 960x676 with no clipping or overflow. Tests: tests/journey.test.cjs (now asserts the strip code is gone), tests/brief-browser.mjs (whole stamp "Nov 13, 12:40 PM ET" at 320/390). Supersedes the v228 and v230 entries below on this point.

## v241 — Apex/Agentic pages drop the old two-account toggle; Research chip (Navigation B follow-up, 2026-11-17)

Jack sent a v239 phone screenshot asking "Why is agentic still in apex": the Accounts and Plan pages still carried the Self-directed | Agentic segmented switch inside Apex and Agentic. He also said yes to a Research chip.
- `ui/experience.js` header(): on account-scoped routes with a tab (plan, accounts, section routes) both `.acct-seg-wrap` get `hidden`; `ui/experience.css` `html.experience-on .acct-seg-wrap[hidden]{display:none!important}`. The elements, handlers, setAccount/setPlanAccount/syncToggles and aria-selected stay; Classic view unchanged. Account is switched with the Apex / Agentic nav items (one history step, Back undoes it). The Rebalance log (More) is not scoped and has no header select, so its switch stays. The header select was already hidden on Plan/Account (v185).
- Identity kept: caption "Apex (self-directed) · …" / "Agentic (automated) · …"; Accounts hero pill "Robinhood · Individual Margin · ••••0741" (suffix via CSS ::after in the experience layer) / "Robinhood · Agentic ••••3900 · limited margin (1×)"; Agentic Plan hero "Agentic Strategy · ••••3900".
- Research chip: Apex and Agentic rows are Plan · Account · Research · What if?. It is the journey's "2 · Research" step (`data-pj-go="analyze"`): opens Analyze for the area's selected holding (or its picker) in the same account; navigates to `analyze`, so Research is highlighted and Back returns. No new route (21); Analyze unchanged.
- Tests: tests/nav-b-checks.mjs (toggles hidden and unfocusable, flips via nav with one history step, identity, Classic toggles, layouts at six viewports, Research chip), tests/brief-browser.mjs updated. Not verified: physical iPhone Duo.

## v240 — Order-status wording unified; finished tickets no longer shown as in flight (2026-11-17)

Jack said "Unify" Nov 17 2026 (after the order-status comparison: four different words for "needs approval", three for "submitted", three for "done"; approved action: "make every screen use Today's wording and fix the strip"). Wording/display only: no ticket state logic, eligibility, executor behaviour, producer, data, schedule, Apex confirmation flow or number changed.
- **One map.** `PFExperienceModel.ticketStatus(pending)` (and `ticketStatusFor(status, pending)` for history events) in `ui/experience-model.js`, loaded before every consumer, so no script order changed and no file was added. `PFTodayModel.ticket()` now delegates to it. Today's existing phrases are the canonical text; every agentic ticket surface renders through it: Today (Waiting on you / Out of your hands), Agentic Plan "Where the plan stands" (including "Last ticket" and "Sells held back · from the … ticket"), the Agentic Accounts strip, the market-tape "Ticket" pill, Activity (status strip, Research & execution record, "Recorded ticket complete" row, ticket timeline) and the "Agentic ticket: …" attention title. No surface prints a stored status word any more.
- **Final status → text table** (the contract; mirrored in UI-PRESERVATION.md):

| Stored status | Label (Today's text) | Compact form (Plan, strip, tape pill, Activity, timeline, attention title) | Next-step clause (Plan, strip) |
| --- | --- | --- | --- |
| `proposed`, not auto-eligible (or flag missing) | Awaiting your confirmation | Awaiting your confirmation | confirm with one command, or a reply in Claude (Plan adds "turnover is over the $X auto tier") |
| `proposed`, `autoEligible: true` | Queued for executor | Queued for executor | the executor places it unattended at its next pass (Plan adds "turnover is under the $X auto tier") |
| `confirmed` | Queued for executor · confirmation recorded | same | executes at the next executor pass |
| `sells-placed` | Submission reported · sells | Submission reported · sells (fill status is not confirmed) | the buys follow once the sells fill (limited margin: proceeds are spendable on fill) |
| `buys-placed` | Submission reported · buys | Submission reported · buys (fill status is not confirmed) | the ticket closes once the buys fill |
| `partial-fill`, `partially-filled` | Partial fill reported | Partial fill reported (check the latest broker status) | none |
| `done` | Recorded ticket complete | Recorded ticket complete (does not independently confirm broker fills) | none; terminal |
| `cancelled` | Ticket cancelled | Ticket cancelled (broker cancellation is not independently verified) | none; terminal |
| `aborted` | Ticket needs review | Ticket needs review · aborted | none; terminal |
| `rejected` | Ticket needs review | Ticket needs review · rejected | none; terminal |
| anything else, or no status | Status needs review | Status needs review: “raw value” (or "no status recorded") | none; not terminal |

Long text (Today's detail line) is the map's `detail` field. Headings: terminal states read "Last ticket"; in-flight states read "Rebalance in flight"; an unknown status reads "Latest ticket".

- **Two queued states stay distinct.** Today used "Queued for executor" for both an auto-eligible proposal and an owner-confirmed ticket. Now auto-eligible is "Queued for executor" and owner-confirmed is "Queued for executor · confirmation recorded". Sells and buys submission are likewise distinct ("Submission reported · sells" / "· buys") and aborted/rejected carry their own tag.
- **A finished ticket is a record, not a fill.** Every surface that shows `done` carries Today's caveat ("does not independently confirm broker fills"); submitted states carry "fill status is not confirmed". Retired phrases: "sells are in", "buys are in", "sells placed", "buys placed", "Ticket completed", "waiting on your confirm", "awaiting your confirm", the bare words `proposed` / `confirmed` / `done` / `aborted` and the raw `sells-placed` / `buys-placed` as status text.
- **Strip bug fixed.** The Agentic Accounts strip (renderAgenticCard) listed a done, aborted, cancelled or rejected ticket under "Rebalance in flight". It now reads like Plan: a terminal ticket shows under "Last ticket" (neutral background, no robot icon), with the same text, id, leg counts, turnover and tax figure as before, and without the sentence "The table below reflects the book before this ticket fills" (untrue for a finished ticket). Nothing the owner saw is lost; the strip still reads the same `A.pending`. Terminal = done, aborted, cancelled, rejected (Plan now uses the same flag, so a cancelled or rejected ticket, which the producer never writes, also reads "Last ticket").
- **Unknown status** is shown, never hidden or treated as zero: Today keeps its "Status needs review" label (its detail now names the raw value); the other surfaces print "Status needs review: “<raw>”" (reusing Today's unknown-state words rather than a second phrase).
- **Not changed (known separate vocabulary).** Options order-state badges CONFIRMED / QUEUED / UNCONFIRMED / PARTIALLY_FILLED are the broker's own states; Apex "armed", "Confirm with Claude", "Waiting on you" / "Out of your hands"; the Plan help text "Ticket statuses" glossary, which names the producer's stored words on purpose; Rebalance-log chips.
- **Tests.** New `tests/ticket-status.test.cjs` (every status, both queued variants, unknown, terminal flags) and `tests/ticket-status-checks.mjs` (called from `tests/journey-browser.mjs`: 11 ticket fixtures across Today, Plan, strip, tape, Activity; no raw or retired text; strip heading; no overflow at 320x568, 390x844, 466x677, 960x676, 677x466). Updated for the new words only: `tests/today.test.cjs` (queued and submitted labels).
- Files: `index.html`, `sw.js`, `ui/experience-model.js`, `ui/today-model.js`, `ui/ticker.js`, `ui/experience.js`, `tests/ticket-status.test.cjs`, `tests/ticket-status-checks.mjs`, `tests/today.test.cjs`, `tests/journey-browser.mjs`, `tests/journey.test.cjs`, `UI-PRESERVATION.md`, `ui/TODAY.md`, `CLAUDE.md`. App/cache **v240 / pf-v240**. Not verified: WebKit, a physical iPhone Duo, real decrypted data.

## v239 — Plan (agentic), Screens and Predict keep decisions open; reference cards start folded (2026-11-17)

Dashboard 2.0 Phase 3b; Jack said "keep going" Nov 17 2026. Display only: nothing removed, every card still renders (all renderers run unchanged, `__PF_APEX_REVIEW`, `#picks-cards`, `#sd-stock-ideas`, `#screens-app`, `#apex-content` untouched); no calculation, ranking, eligibility, stop/target, guardrail, data fetch, label or confirmation flow changed.
- **Folded by default (2 cards).** Agentic Plan: "How the loop runs" (static explainer; `data-sec="agp-loop"`). Research › Screens: "Scoring Breakdown" (the full candidate table whose top 3 is the Top 3 Picks card above it; `data-sec="scr-breakdown"`).
- **Always open, unchanged.** Self-directed Plan: Apex card, Action Center (and the pointer cards) — nothing qualified, so that page is unchanged. Agentic Plan: Where the plan stands, Model correctness & forward record, The target, Business check, What's blocked, The waiting ground, Guardrails. Screens: Top 3 Picks, Composite Scores, Track Record, the reference note and scan hero. Predict: nothing qualified, unchanged (tabs; its glossary-type blocks were already closed `<details>`).
- **How.** `window.__pfFold` gains two scopes: `plan-agentic` (`#plan-agentic-app`) and `screens` (`#screens-app`), keys `plan-agentic:agp-loop` and `screens:scr-breakdown` in `pf_card_fold_v1` (scope-prefixed, so the agentic Plan, the self-directed Plan and the Accounts keys never share a choice). `apply()` also stamps `aria-expanded="true"` on a fold-set card that starts open. Same contract as v235/v236: saved choice, My view pin starts open, rail chip / Find / Expand all open it (session only). Screens has no card enhancer, section rail or Find index (existing), so `renderScreensPage` calls `__pfFold.apply` after the table has rows; with no candidate rows the card is only an empty-state notice and stays open.
- **Disclaimer kept visible.** The "Not financial advice … Levels are monitor-only" line was the last child of the loop card body; it now sits in the same card OUTSIDE the foldable body (same text, same place when open), so folding the explainer never hides it.
- Not folded, left open unsure: Composite Scores (chart repeating the table's ranking; a canvas), The waiting ground (parked cash is an execution state), Business check.
- Tests: `tests/research-folds-checks.mjs` (called from `tests/journey-browser.mjs`, one context) — folded and open sets, content while folded, persistence over re-render and reload per account, navigation, pin, privacy parity, five viewports with the Duo insets, empty state.
- Files: `index.html`, `sw.js`, `tests/journey-browser.mjs`, `tests/research-folds-checks.mjs`, `tests/journey.test.cjs`, `UI-PRESERVATION.md`, `CLAUDE.md`. App/cache **v239 / pf-v239**. Not verified: WebKit, a physical iPhone Duo, real decrypted data.

## v238 — Navigation B: Today / Apex / Agentic / Research / More (2026-11-17)

Jack's Nov 17 2026 choice "Option B · by strategy" (mockup page, 05:42 ET) supersedes the five-area labels only. Grouping only: 21 route ids, `#view=` hashes, pages and renderers unchanged; no card, calculation, data or confirmation change.
- `ui/experience.js`: account-scoped routes (plan, accounts + section routes, scenario) have `scoped:true`; `areaOf(route, account)` puts them in Apex (pf_acct main) or Agentic (agentic). Apex/Agentic taps pass the account to navigate (native setAccount/setPlanAccount via switchTab) and reopen the area's last route (default Plan). Research = Markets, Screens, Analyze, Smart $, Predict (default Markets; pf_signals_last seeds it). More = Options (default), Decision evidence, Rebalance log ("Lab" caption prefix), Activity. Account flips are one history step as before (Back undoes).
- Stored prefs: old pf_area_* ignored, new pf_area_apex/_agentic/_research/_more; unknown route values fall back (hasOwnProperty).
- Fixed: stale Accounts toggle after Plan flip + Back (syncToggles).
- Taps vs v236 (tests assert max +1): self-directed Account, its section cards, Activity and Smart $ are one tap deeper; Options, Markets, Agentic plan and Agentic What if? are one tap closer.
- Tests: tests/nav-b-checks.mjs via journey-browser; experience.test.cjs, today/predictions browser labels updated. Docs: UI-PRESERVATION.md, UX_REVIEW.md (old→new map), ui/TODAY.md supersession note. Not verified: physical iPhone Duo.

## v237 — Agentic header carries Invested, repeated tiles removed; ticker stops repeating account numbers on Today and Accounts (2026-11-17)

Dashboard 2.0 Phase 1b; Jack chose "Proposed" for both from the mockup page on Nov 17 2026. Display only; no calculation, threshold, data fetch, producer, schedule, confirmation flow or account separation changed, and the self-directed header and six tiles are untouched.
- **Agentic header.** `renderAgenticPage` sub-line is now `▲ $X today (+p%) · Invested $Y` (`fmtD`; privacy masking is the page-wide text scan, so it applies unchanged). `renderSnapshot(...,{cashTile:true})` no longer emits the Account Value and Day Change tiles (it still receives and computes everything; only the markup is omitted): the agentic snapshot is Unrealized, YTD Return, Idle Cash, Portfolio Beta. Grid: 2x2 below 740px, one row of four from 740px (agentic-only selectors in index.html and ui/duo.css; the self-directed 2/3/6/5-column rules are unchanged).
- **State table (tile vs header).** Header figure stays `agenticBook` equity (producer equity, else cash+invested); the removed tile showed `max(equity, invested)`, which differs only when equity < invested (stale equity), where the tile's figure equals Invested, now in the header. Day move: header basis equity, tile basis the same `max`; equal whenever equity >= invested. No quote history: the tile showed `$0.00 / 0.00%` (unknown shown as zero); the header shows no today line. No priced position values: tile `Invested $0.00`, header `Invested —`. No positions: neither showed Invested. Account not captured: `—`, no tiles, as before. Stale snapshot: unchanged (freshness bar).
- **Tape.** The strip is `#pf-tape` (`ui/ticker.js`; there is no `#pf-ticker`/`renderTicker`). On the Today and Accounts routes (accounts, holdings, performance, heatmap, risk, income) the combined "Today" item and the two per-account value items are not drawn; the status pill, Breadth, Markets, Holdings, Options, Earnings, Agentic and Heads-up items stay and all other routes are unchanged. Repaints on `pf:route` and `pf:render`. Height and page offset do not change (tested). technicals/fundamentals/flow/log (also Accounts page sections) were not in the brief's list and keep the full strip.
- Files: `index.html`, `ui/duo.css`, `ui/ticker.js`, `sw.js`, `tests/journey-browser.mjs` (block (g) replaced, new v237 block), `tests/journey.test.cjs`, `UI-PRESERVATION.md`, `CLAUDE.md`. App/cache **v237 / pf-v237**.
- Verified on the synthetic preview (Chromium 1243, Playwright 1.57): journey, sd-plan, apex, holdings-duo, today-viewport pass; brief-browser fails identically on unmodified main (678x453 label fit). Not verified: WebKit, a physical iPhone Duo, real decrypted data.
## Producer-only — momentum-off paper shadow starts recording at the next research refresh (2026-11-17)

Jack approved this Nov 17 2026 after ChatGPT's "momentum on probation" note. No UI, version, target, weight, executor or trade change.
- **Why.** Sleeve attribution can't isolate momentum (34 of 37 momentum-tagged buys also carry quality), and past targets never stored per-name sleeve scores, so the with/without question can only be answered forward.
- **What.** New `producer/momentum-shadow.mjs`; `finalize-target.mjs --write` now also appends one frozen cohort per refresh to `momentumShadow` inside `producer/agentic-target.json` (carried forward from the committed file; outside `targetIdentity`; top 10 by live composite vs top 10 with momentum weight 0, equal weight, index vehicles excluded). `gradeShadow` reports `noMomentum − live`; `thin` until 4 graded cohorts. Wrapped in try/catch after the target write, so it cannot fail a refresh. Optional `--spy PRICE`.
- **Rule.** Paper only: nothing allocates from the shadow, cohorts are never edited, and `FACTOR_WEIGHTS` stays as is until Jack decides on enough cohorts. The research Routine and `producer/SCHEDULING.md` are unchanged: the log rides in the one file the Routine already commits.
- Files: `producer/momentum-shadow.mjs` (new), `producer/momentum-shadow.test.mjs` (new, 9/9), `producer/finalize-target.mjs`, `producer/AGENTIC.md`, `CLAUDE.md`.

## v236 — Options leads with holdings and income rankers; history and knowledge start folded (2026-11-17)

Dashboard 2.0 Phase 3a, Jack's Nov 17 2026 redesign handoff. Display only; nothing removed, no option math, idea ranking/filter, premium/yield/assignment figure, guardrail note, data fetch or label (hypothetical / estimated / LIVE / pending / filled) changed.
- **Order.** `renderOptions` still BUILDS every card in the original order with the same builders (so `_optIdeas`, `_optIdeaState` and the payoff-chart queue behave as before) but each piece goes into its own string and they are placed: hero, Options Exposure, Your Options, Upcoming Expirations, Covered-Call Income, Cash-Secured Put Income, Income Ideas, Trade Ideas, Options Income & History, Roll Scorecard, Options Knowledge, disclaimer. The late-arriving Income Ideas insert (picks file landing after the page rendered) now goes before Trade Ideas instead of before Options Knowledge.
- **Dependencies checked.** ui/duo.css pairs the two rankers by selector (`#options-app>.card[data-priv="market"]:not(:has(#opt-idea-grid)):not([data-opt-pick-income])`), not by position; the rankers stay adjacent, so the open-Duo two-up (740-1100px) is unchanged (boxes identical apart from y: 424px wide, same row). The rail chips and Find are built from DOM order/titles; the help entries are title-keyed. `producer/option-history-ui.test.mjs` extracts `optIncomeHistory`..`renderOptions` from index.html: those functions only gain a `data-sec` attribute. No CSS change.
- **Fold.** `window.__pfFold` now also covers `#options-app` (scope `options`): `data-sec="opt-history"`, `"opt-rolls"`, `"opt-knowledge"` (new attributes on the card wrappers; `tests/experience.test.cjs` only checks the twelve Accounts keys are present, and `_currentSec`/`placeSection` only read `#app`/`#agentic-app`). Same contract as v235: saved choice in `pf_card_fold_v1` (`options:opt-history` ...), a My view pin starts open, rail chips / Find / My view / Expand all open a folded card, aria-expanded kept. Income & History folds only when it holds contract rows (`.oh-hist` / `.oh-list`); with no ledger it is just a "Trade history is not in this snapshot yet" / reconciliation notice and stays open. Roll Scorecard only exists when there are rolls.
- Files: `index.html`, `sw.js`, `tests/journey-browser.mjs`, `tests/journey.test.cjs`, `UI-PRESERVATION.md`, `CLAUDE.md`.
- Verified (synthetic preview + a synthetic ledger/rolls fixture, Chromium 1243 via `executablePath`, Playwright 1.57): `journey-browser` covers order, three folds, content while folded, persistence over re-render/reload, Covered-Call and rail chips, Find, Expand all, pin, no overflow at 390x844 / 466x677 / 960x676 / 677x466 (CDP insets) folded and expanded, open-Duo pairing geometry, privacy after opening, empty state. Options scrollHeight (rich fixture) 390x844 8185 -> 6755, 960x676 5851 -> 4532; Covered-Call ranker y at 390x844 7041 -> 1941. Not verified: a physical iPhone Duo, WebKit (unavailable here), real decrypted data. App/cache **v236 / pf-v236**.

## v235 — Accounts leads with decisions; secondary cards start folded (2026-11-17)

Dashboard 2.0 Phase 1a, Jack's Nov 17 2026 redesign handoff: reduce routine clutter, nothing removed. Display only.
- On Portfolio › Accounts, for BOTH accounts (`#app`, `#agentic-app`), these cards now start **folded** (header visible,
  body hidden): Holdings Heatmap, Allocation, Income & Tax, Technical Signals, Fundamentals, Positions Under $250 (where
  it exists), Flow & Positioning, Rebalance Log. Margin banner, header, snapshot tiles, All Positions, Performance /
  Account Performance, Risk & Diversification, the Agentic Target comparison & trade review block, notices and the
  pointer cards are unchanged and stay open. Every card is still rendered into the DOM by the same renderer; only the
  body's `display` differs, through the existing collapse mechanisms (`toggleSection` data-toggle bodies, the enhancer's
  `.card-body`), with `aria-expanded` and the chevron kept correct.
- **How.** New `window.__pfFold` (index.html, just above the card enhancer). Cards are matched by `data-sec` inside
  `#app` / `#agentic-app`, not by title. The enhancer calls `apply(card)` once per NEW card node (a re-render replaces the
  node), honouring in order: this session's choice, the saved choice, a My view pin (pinned = not folded), else folded.
  Saved choice = localStorage `pf_card_fold_v1`, one JSON map `{"main:allocation":1,"agentic:income":0}` (1 open, 0 closed,
  per account + card); every read/write is try/catch, a storage failure just uses defaults (session memory still holds).
  A header tap, `toggleSection` and the rail's Expand/Collapse all are the user's choice and are saved.
- **Navigation opens a folded card (session only, not saved):** rail chips (`jump()` only opened `.card-body` cards, so it
  now also opens data-toggle bodies — most cards), the hidden routes holdings/performance/heatmap/risk/income/technicals/
  fundamentals/flow/log (`placeSection` in ui/experience.js), Find and My view (`scrollToCard`). The rail's Expand/Collapse
  all label is re-synced. The treemap cannot lay out at zero width (`renderHeatmap` skips a hidden container, as it always
  has for a hidden tab), so opening the Heatmap card calls `renderHeatmap` once; its drawing code is untouched. A folded
  self-directed Heatmap therefore has an empty container until it is opened — the one card whose body is not pre-drawn.
- **Not done: removing the duplicate Account Value / Day Change tiles from the Agentic snapshot.** The Account Value tile
  shows `book = max(equity, invested)` with an "Invested $X" sub-line the header (`equity` only) does not carry, and
  the 5/6/3-column snapshot grids (index.html, duo.css) assume six tiles. Day Change would be safe in isolation but the
  pair was one request. Needs a design decision; both tiles and the header are unchanged and pinned by a test.
- Files: `index.html`, `ui/experience.js`, `sw.js`, `tests/journey.test.cjs`, `tests/journey-browser.mjs`,
  `UI-PRESERVATION.md`, `CLAUDE.md`.
- Verified (synthetic preview, Chromium 153 via `executablePath`; Playwright 1.57): `journey-browser` covers default folds on
  both accounts, content present while folded, persistence across a re-render and a reload (open and closed), storage
  failure, rail chip / Expand all / hidden routes / Find, a pinned card, no horizontal overflow at 390, 466x677 and
  960x676 folded and expanded, and privacy masking after opening. Not verified: a physical iPhone Duo, WebKit (not
  available here), real decrypted data. Known existing quirk, unchanged: Find/My view match a card by title, so a title
  shared by both accounts lands on the self-directed card. App/cache **v235 / pf-v235**.

## v234 — Open Duo follow-up from Jack's screen recording (2026-11-17)

Jack (Nov 17 00:54 ET, 37-second screen recording of v233 on the open Duo, dark theme): "Peak into wide screen duo
portfolio dashboard so u can further optimized". Read frame by frame. Layout and legibility only, all in `ui/duo.css`
section 8: no card, number, rule, prompt or copy change.
- **Oversized grey text.** Notes, "How to read this" lines and card intros drew at about 20px on the phone but
  11–13px in Chromium. The app never set `text-size-adjust`, and iOS inflates paragraph text on a landscape-shaped
  screen. `html{-webkit-text-size-adjust:100%}` now applies everywhere. Cause inferred from the recording vs the
  preview; not confirmed on the phone.
- **Unreadable Apex ticket tiles in dark.** `levelsHtml` cells use `var(--card,#fff)` with `var(--text)`; `--card`
  was never defined, so dark theme printed light values on white tiles. `--card` is now defined for the dark
  themes. Inline dark reds (#b91c1c, #991b1b, #dc2626) and blues (#2563eb, #075985) inside `.card` are lifted in
  the gold theme ("Open in Robinhood", "Flunks if", % from cost).
- **Today, 740–1100px.** "Out of your hands" follows "Waiting on you" in the right column and Market backdrop is
  full width, closing a ~300px empty block (page 1,674 → 1,656px in the preview). Sliver holdings-map tiles shrink
  their label and drop the percent under 34px instead of clipping it.
- **Options, 740–1100px.** The two half-width income rankers hide the grey title hint (title row 43 → 19px) and
  the six-column put table fits (scrollWidth 408 → 374 in a 374px box).
- Not changed: a card's right edge still passes under the status icons while it scrolls through the top ~160px
  (the v220 trade-off; the count badge and Review link are clear at rest).
- Files: `ui/duo.css`, `index.html`, `sw.js`, `tests/journey.test.cjs`, `CLAUDE.md`.
- Verified (synthetic preview, Chromium, side inset forced by hand): Today / Options / Plan at 960×676 dark and
  light plus 320, 390, 466×677, 678×453, 739, 740, 1100, 1101, 1280 — scrollWidth = innerWidth, 0 page errors,
  screenshots read; tests/*.test.cjs 63/63, apex 64/64, business 18/18; today-viewport, holdings-duo, journey,
  sd-plan and apex browser suites PASS. `brief-browser` fails one label-fit assertion at 678×453 identically on
  unmodified main in this session. Not verified: a physical iPhone Duo. App/cache **v234 / pf-v234**.

## v233 — Apex ranked opportunities (display only) (2026-11-16)

Jack (Nov 16 12:37 ET, on a zero-buy Monday with the seven top-scored names locked out by the tech cap): "Is apex
working right? … I don't get how this works"; he then approved (12:41–12:42 ET, with ChatGPT's v2.9 proposal)
"Publish the ranked opportunity list … why they qualify or fail, and what would make them actionable" and
"Keep v2.8 running live unchanged … Nothing here authorizes a live strategy change."
- `ui/apex.js`: new pure `opportunities(T)` (exported) + `oppBlock()`. A re-sort of rows the Monday scan already
  writes to `data/apex-targets.json` into four buckets under the Research tiles (`[data-apex-opps]`,
  `[data-apex-opp="qualified|restricted|near|watch"]`): **Buy list** (targets, never the core), **Blocked by a cap**
  (`blockedByTheme` + `blockedByCap`, one row per name, by score), **Close** (failed ONLY the R/R floor; shows the entry
  at which R/R reaches `C.RR_MIN` with the scan's target and stop held fixed, `(tp1 + 1.5·stop) ÷ 2.5`, labelled an
  estimate; closest first), **Watch** (relative-strength or catalyst gate). Names under their 200-day are a count only.
  Each row is one line (ticker · score · why) and opens to "Actionable when" + the scan's levels.
- **Display only.** No rule, ticket, size, prompt or gate reads it (test asserts `rules()` output is unchanged with it
  present). Rules stay v2.8. A row with a second disqualifier (e.g. negative growth) is not "Close".
- `index.html`: the research object carries `opps`; versions. No scan-prompt, schema or data change — the list is
  derived from fields already in the file, so it is as old as the last Monday research.
- **Apex v2.9 is a PAPER track, not in this repo's rules:** a separate scheduled task ("Apex v2.9 paper track")
  screens a wider market daily and logs paper cohorts beside v2.8. Nothing in `ui/apex.js` reads its output.
- Files: `ui/apex.js`, `index.html`, `sw.js`, `tests/journey.test.cjs`, `producer/apex.test.mjs` (64/64, +2), `CLAUDE.md`.
- Verified: all producer suites, tests/*.test.cjs, data validator; Chrome at 390 and 320px with the real Nov 16 file
  and a synthetic book — 1 / 7 / 8 / 10 rows, scrollWidth = innerWidth, 0 page errors, screenshot read. Not verified:
  a physical iPhone, live decrypted data. App/cache **v233 / pf-v233**.

## v232 — Compact Today in the actual Duo web viewport (2026-11-14)

Jack's follow-up screenshot shows v231 loaded and a native controls column still
outside the page. This supersedes the earlier assumption that a right CSS inset
could explain/reclaim that entire column. WebKit explicitly documents this limit:
https://webkit.org/blog/18486/#web-content-under-the-controls . Safari 27.2's notes
publish no change to that contract: https://webkit.org/blog/18515/webkit-features-for-safari-27-2/ .
Do not force screen.width, zoom, or claim Chromium inset emulation is native Duo proof.

- On narrow Today, one toolbar replaces the repeated Portfolio/caption/Today rows.
  Back and Classic keep 44px targets. The existing sticky date, stale warning and
  Light/Dark/System toggle remain; the duplicate Today appearance picker is hidden.
- Each account name is its explicit Portfolio link. Compact overview padding and
  figures bring Waiting on you higher without changing any displayed calculation.
  Open/landscape layouts, source notes, confirmation flow and v231 Agentic details
  stay intact. The visible account context remains on other routes.
- New Chromium and Playwright WebKit checks use content widths (373px screenshot
  approximation, documented 382/385/594/669/951px widths, and 320px fallback), assert
  first-screen action visibility, no clipped figures, touch targets, account links,
  Back, reload, privacy, Classic and all three appearance modes. These are browser
  engine checks, not native-device or installed-PWA acceptance. New CI screenshots
  and geometry evidence are required before merge; main also checks served assets.
- Based on a70bc69, preserving the newer prediction snapshot. No data, model,
  executor, permission, schedule or trade changes. Local 63 model tests pass;
  local Chromium cannot launch (socket EPERM), so layout evidence runs in CI.
  App/cache v232/pf-v232. Final release evidence: PR and canonical handoff.

## v231 — Agentic holdings parity and Duo preservation (2026-11-14)

Jack reported missing Agentic holding details and an apparent Duo regression in
his v230 screenshot. Comparison to v222 confirmed ui/duo.css and ui/duo.js were
retained unchanged; the screenshot alone cannot establish why iOS reserved the
full right strip. The v229 stylesheet order no longer kept duo.css last.

- Agentic now uses the same All Positions renderer: percentage of its own book,
  concentration label, exact shares, average cost, price, value, unrealized P&L
  dollars/percent and daily move. Every positive fractional lot remains visible.
  Search and sort state are account-local. Missing costs/quotes remain unavailable.
- Existing Agentic target/performance/trade review is retained inside a named
  disclosure. Strategy, snapshots, executor, confirmation text and permissions
  are unchanged. Generic Analyze still carries its existing source limitation.
- duo.css is last again. A persistent environment probe detects late safe-area
  changes with ResizeObserver, PWA resume, visibility and visual-viewport events.
  No guessed device width, forced zoom or native-status-bar override is used.
  Folded holdings use tighter card spacing and readable three-column details.
  The sticky date bar masks its reserved side area so scrolled cards cannot bleed
  through beside it; this was caught in the first CI screenshot review.
- New synthetic holdings tests cover fractional, unavailable and account-local
  rows. holdings-duo-browser uses Chromium's real safe-area override, checks
  late insets without a resize, symmetric notches, 320/373/466/678/960/1440 widths,
  both accounts/themes, search/sort/Back/refresh/privacy and preserved trade review.
  CI also verifies these paths and Duo/model asset hashes on the served shell.
- Local: 56 producer suites, 63 dashboard tests, 21 validator tests and published
  JSON validation pass. Local Chromium cannot launch (socket EPERM); required
  browser checks and rendered screenshots run in CI before merge. This is
  self-review; neither physical iPhone acceptance nor broker execution is claimed.
- App/cache: v231 / pf-v231. Publication evidence belongs to the PR and canonical
  handoff. Recovery: revert this bounded release, retaining newer source data.

## v229 — Premium Today, Light / Dark / System (2026-11-13)
Jack requested the stronger Today concept built into the app, then corrected the mockup:
daily-only value history behind a tap row; visible trades + prices directly above **Confirm
with Claude**; separate **Waiting on you** and **Out of your hands**; restrained gold, no
glow/gradient buttons; all five tabs. No account selector on Today and no ticker logos.
These corrections supersede the earlier illustrative mockup's intraday line.

- `ui/today.js`, `today-model.js`, `today.css`, `theme.js`: combined overview, proportional
  holdings map/list, account-aware holding dialog, recorded status ownership, full Apex
  confirmation and remembered Light/Dark/System. The strategy and broker/producer code
  are unchanged; the Plan adapter exposes its same computed state to Today.
- `Value over time` uses only matching daily records, including flows. Stock move is not
  full account P&L. Unknown quotes stay unknown; the biggest-drag line requires a complete
  recorded contribution. No hardcoded trade, price, ticker recommendation or chart series.
- Privacy covers new bare trade quantities and dynamic dialogs. The private Claude prompt
  is built on click; a changed proposed book blocks that click pending review. Five tabs,
  v222 Duo geometry and scoped account/Research/Back behavior remain authoritative.
- Build/cache: **v229 / pf-v229**. Implementation handoff: `ui/TODAY.md`.
- Local validation: 56/56 producer suites and 58/58 dashboard/model tests passed. Local
  Chromium is blocked by socket EPERM; browser and screenshot validation are required in
  the existing CI workflow before release. No physical-device validation is claimed.
- Reconciled through PR #209 / v226 before release: Apex rules v2.8 / themes-v1.1,
  normalized scan labels and fail-closed unknown names remain authoritative. Today reuses
  that same engine and whole-book prompt. Current main data refreshes and the
  v228 date-only freshness header without AM/PM are preserved.

## v226 — Apex theme cap: scan labels normalized, unknown names fail closed (2026-11-13)
ChatGPT's review of the merged v224 (claudex Portfolio handoff, Nov 13 ~12:39 ET) found a real hole: `themeOf()` returned a
scan `themeMap` label verbatim, so a map saying `ZS:'cyber'` or `PLTR:'ai-software'` made those names NOT tech and they
escaped the 40% cap. Not live yet (the committed `data/apex-targets.json` is v2.7 and carries no `themeMap`), but Monday's
first v2.8 scan writes one. Jack: "Review confirm edit as needed build and merge" stands for the fix.
- `ui/apex.js` (theme map **themes-v1.1**): new `classOf()`; `themeOf()` = `classOf()` with 'unclassified' folded into the
  capped theme. Rules in order: (1) a built-in `TECH` name is ALWAYS tech — a scan label can never downgrade it; (2) a scan
  label is normalized — `ai-compute`/`ai-software`/`cyber`/`tech-other`/`semis`/`software`… → `tech`, case-insensitive;
  (3) a name no list or scan classifies (or a blank label) is **unclassified and counts as tech** until classified — fail
  closed, or the cap leaks every time the universe grows. A built-in `NONTECH` map covers the scan's non-tech clusters
  (power, space, crypto, health, finance, industrial, consumer) so the S&P growth extension is classified without the scan.
  `themeShare().unclassified` lists them and the Tech bar says "Counted as tech until classified: …".
- Tests: `producer/apex.test.mjs` 62/62 (+3: label normalization incl. a scan-labelled newcomer blocked over the cap, no
  downgrade of a built-in tech name, fail-closed + its card line); `apex-turnover.test.mjs` and `tests/apex-browser.mjs`
  classify their synthetic X/Y/Z tickers (they would otherwise fail closed — which is the rule working).
- Files: `ui/apex.js`, `index.html`, `sw.js`, `tests/journey.test.cjs`, `producer/apex.test.mjs`,
  `producer/apex-turnover.test.mjs`, `tests/apex-browser.mjs`, `producer/APEX-DECISIONS.md`, `CLAUDE.md`.
- Verified: all producer suites, tests/*.test.cjs 33/33, apex / sd-plan / brief / journey browser suites (local Chrome).
  App/cache **v226 / pf-v226** (v225 is ChatGPT's open Today PR #207; it must re-bump past v226 when it rebases).

## v224 — Apex rules v2.8: tech capped at 40% of the stock outside IREN (2026-11-13)
Jack (Nov 13 11:59 ET, after a day when every Apex name fell with tech): "The decision is if we should continue to keep
concentrating Apex inside AI like this, or if we should look for growth other where … doesn't mean we have to be
exclusively AI." Claude proposed a 40% theme cap + a wider universe; ChatGPT reviewed it (transition rule, keep the
45% AI-compute cap separate, versioned theme map, three-arm paper test); Jack (12:13 ET): "Review confirm edit as
needed build and merge".
- `ui/apex.js`: `C.THEME_MAX` 0.40 / `C.THEME_CAPPED` 'tech'; theme map **themes-v1** (`TECH` list: AI compute, AI and
  software, cyber, TSLA, AXON — software and cyber cannot escape under separate labels); `cfg.themeMap` (from the scan's
  `data/apex-targets.json` `themeMap`) overrides per name; unknown names are "other". New pure `themeOf`,
  `themeShare` (stock outside the core + a whole-account figure incl. the core, reported, never used to pass the cap),
  `themeRoom` (dollars of a tech buy that keep tech ≤ 40% after it: (0.4·N − T) ÷ 0.6, counting rungs already written).
- **Forward-only.** `buyBlock` refuses a tech buy/add once tech is at the cap ("Not a sell signal"); build rungs and
  `bookGaps` adds are sized down to `themeRoom`; non-tech buys are untouched. No rule sells for the cap, and no
  leverage, maintenance or per-name limit moved. The existing 45%-of-equity AI-compute cap (scan, incl. IREN) is a
  separate control and is unchanged.
- Card: a "Tech outside IREN — X% / 40% cap" bar under Weights vs target (`[data-apex-theme]`). Confirm prompt
  carries the cap and today's share. `cfg.themeCap:false` = the v2.7 book (paper control, pre-v2.8 tests).
- Live book on Nov 13: tech = 100% of the $8,472 outside IREN, so every tech add (incl. the CRWD drift buy) is blocked
  until non-tech names are bought or tech exits by its own rules.
- The "Apex morning scan · 0741" prompt moved to **rules v2.8** the same day (wider universe: the existing list + a fixed
  S&P 500 growth extension across health, finance, industrial, consumer; same gates and R/R ≥ 1.5; theme cap in picks
  and adds; three paper arms v2.8 / v2.7 / v1). Monday Nov 16 7:12 AM ET is its first v2.8 research run.
- Files: `ui/apex.js`, `index.html`, `sw.js`, `tests/journey.test.cjs`, `producer/apex.test.mjs` (59/59: +4; five
  pre-v2.8 fixtures pinned to `themeCap:false`), `producer/APEX-DECISIONS.md`, `CLAUDE.md`.
- Verified: all producer suites, tests/*.test.cjs 33/33, apex / sd-plan / brief / journey browser suites (local
  Chrome); the theme bar at 390 and 320px with the Nov 13 book — scrollWidth = innerWidth, 0 page errors, screenshot read.
  Not verified: a physical iPhone, live data. App/cache **v224 / pf-v224** (v223 is held by ChatGPT's open Today PR #207, which must re-bump past v224 when it rebases).

## v222 — Duo folded screen turned sideways: nav rail in the left strip (2026-11-13)
Jack (Nov 13 10:55 ET, screenshot of Today on the folded screen held sideways): "optimize this landscape folded view
as well". Measured from the screenshot: about **678 x 453 CSS px**, the Duo reports an **~85px LEFT** safe-area inset
in this pose, and the bottom bar took ~100px of the 453px height. `ui/duo.css` section 7, for
`(min-width:560px) and (max-width:739px) and (max-height:520px)`: the nav becomes a left rail sitting in that strip
(width = max(72px, the inset)), the bottom bar goes, Today's heading row is hidden (its age repeats the snapshot strip),
the hero is tighter, the Plan context card is one row, and Apex Confirm pins to the bottom edge. `ui/duo.js` now also
sets `--duo-l` (the measured left inset). Any short wide screen (a phone held sideways) gets the same layout.
- Not changed: portrait folded, open, desktop (their ranges do not overlap: open and desktop are taller than 520px).
- Files: `ui/duo.css`, `ui/duo.js`, `index.html`, `sw.js`, `tests/journey.test.cjs`, `CLAUDE.md`.
- Verified (synthetic preview, Chromium, left inset forced by hand): 14 routes x 678x453, 466x677, 960x676, 390x844,
  667x375 — scrollWidth = innerWidth, scrollX 0 after a forced sideways scroll, no new page errors; screenshots read;
  suites as listed in the PR. Not verified: the real phone, and whether status icons sit inside the left strip in this
  pose (the screenshot showed none). App/cache **v222 / pf-v222**.

## v221 — Duo layouts for the rest of the app (2026-11-12)
Jack (Nov 12 ~19:00 ET, on v220's open Today): "That's better. Do the rest of that portfolio dashboard app now."
Layout only, all in `ui/duo.css` section 6 — no JS, no card, number or copy change.
- **Both screens (≤ 739px wide or ≤ 720px tall):** the dark page banners (`#page-portfolio .header`, every
  `.picks-hero`, the Predictions head) are one slim block (Accounts 143 → 100px, Markets/Options 105 → 70px).
- **Folded (420–739px):** the six Accounts snapshot tiles are 3 × 2 instead of 2 × 3.
- **Open (740–1100px):** Accounts snapshot tiles are one row of six. `#markets-app`, `#options-app`,
  `#plan-agentic-app` and `#az-result` are two-column grids where every child spans both columns unless opted in:
  Markets pairs Sector Heatmap | US vs International and Macro | Breadth; Options pairs the two income rankers;
  the Agentic plan and Analyze pair every card after their header. Paired cards drop the grey title hint so the
  ? ☆ ▼ buttons stay on the title line. Smart Money is full width with trade rows two-up.
- Cards are matched by content (`:has(#sec-hint)`, `:has(#mkt-macro)`, `[data-priv="market"]`), never by `navc-N`
  ids, which the section rail regenerates.
- Not changed: Accounts tables and charts (too wide for half a screen), the Action Center, Screens, Activity,
  Decision evidence, What if (already grids), Predictions cards (already two-up).
- Measured (synthetic preview, 960×676): Agentic plan 4,151 → 2,962px, Markets 2,321 → 1,826, Analyze 3,078 → 2,476,
  Smart Money 2,016 → 1,452.
- Files: `ui/duo.css`, `index.html` + `sw.js` + `tests/journey.test.cjs` (version), `CLAUDE.md`.
- Verified (synthetic preview, Chromium, side inset forced by hand): 13 routes × 960×676 and 466×677 — scrollWidth =
  innerWidth, nothing past the right edge, 0 page errors other than the preview's missing Chart.js on Screens (same on
  main); suites as listed in the PR. Not verified: charts at half width (no Chart.js in preview), a physical iPhone
  Duo. App/cache **v221 / pf-v221**.

## v220 — Duo follow-up: the open screen is ~960px wide, and the side status strip is reclaimed (2026-11-12)
Jack (Nov 12 18:31 ET, two screenshots from the phone): "Full view is awful" and, on the empty strip beside the
clock/Wi-Fi icons, "Reclaim what u can". v219's sizes were estimates and both were wrong: the open screen measures
about **960 CSS px** wide (so it got the 184px desktop sidebar plus panes too narrow for the figures — "$18,254." /
"28" wrapped and "-$717.94" spilled out of its tile), and the Duo reports its status icons as a **~100px RIGHT
safe-area inset** on both screens, which the page padded by for its whole height.
- `ui/duo.css`: the left rail now covers **740–1100px** and fully overrides the desktop sidebar (column buttons,
  wordmark and sidebar Classic hidden; the header Classic button stays). Today's panes are paired rows — hero | radar,
  accounts | cash, then the existing two-column grid — so a short radar leaves no hole. Hero, day-move and account
  values are `nowrap` with clamped sizes.
- New `ui/duo.js` (precached): measures the safe-area insets and sets `html.pf-side-status` + `--duo-r` ONLY for a
  right inset ≥ 60px with a left inset < 20px (the Duo's shape; a notched iPhone in landscape reports both sides and
  is untouched). Under that class the body's right padding drops to 12px and only `#pf-fresh`, `#ex-top`,
  `#ex-subnav`, the Today heading and the sticky account switcher stay clear of the icons.
- Known trade-off: a card's right edge passes under the icons while it scrolls through the top ~100–160px.
- Files: `ui/duo.css`, `ui/duo.js` (new), `index.html`, `sw.js`, `tests/journey.test.cjs`, `CLAUDE.md`.
- Verified (synthetic preview, Chromium, inset forced by hand since `env()` cannot be simulated): 960×676 and
  466×677 screenshots read, 6-figure equity fits; suites as listed in the PR. Not verified: the real inset values or
  the icon area's height on the phone. App/cache **v220 / pf-v220**.

## v219 — iPhone Duo layouts: slim header, left rail + two panes when open, Confirm pinned (2026-11-12)
Jack (Nov 12 17:40 ET): "I just got the iPhone duo. Can our apps be optimized for the folded vs big view" → asked for
mockups, then "Both" (Today and Apex). Layout only — same cards, numbers and controls; nothing new is computed.
- New `ui/duo.css` (loaded last, in `sw.js` precache). Keyed to width RANGES, not a device: the Duo's browser width
  was estimated from Apple's pixel counts (folded ≈ 466×678, open ≈ 890×626), never measured on the phone.
  - **≤ 739px wide, or ≤ 720px tall — slim header.** `#ex-top` is one row (Back · title · Classic view; the
    "Both accounts" badge is hidden because the caption says it), Today's one-tab sub-nav row is hidden, and "Your
    daily brief." is one line (its label and tagline hidden). 420–739px: equity sits beside the day move.
  - **≤ 739px — Apex.** `#apex-content` is a flex column: leverage → Recommended trades → Rules firing now → rest
    (CSS `order`; the DOM order is unchanged). `[data-apex-confirm]` is `position:sticky` above the bottom nav while
    the trade list is in view.
  - **740–900px — left rail.** `.ex-main` becomes a 76px rail under the tape; body padding follows.
  - **740–1100px — two panes.** Today: hero · accounts · cash on the left, On your radar on the right, the other
    cards pair up below (`.ex-brief-grid` is `display:contents`). Apex: leverage + rules left, trades + sticky
    Confirm right. The Plan context card (`#pj-context`) puts the name picker and the three steps on one row.
- `ui/apex.js`: three wrappers only — `[data-apex-lev]`, `[data-apex-rules]`, `[data-apex-book]` — plus
  `[data-apex-confirm]` around the button and its note. No rule, prompt, ticket or text change.
- Differs from the mockup: the radar (not the day drivers) is the right pane on Today, and on Plan the context card,
  account switcher and section chips still sit above the Apex card, so the trades need one scroll.
- Files: `ui/duo.css` (new), `ui/apex.js`, `index.html`, `sw.js`, `tests/journey.test.cjs`, `CLAUDE.md`.
- Verified (synthetic preview, Chromium): 56 producer suites, tests/*.test.cjs 33/33, brief / sd-plan / apex / journey
  browser suites PASS; 12 widths (320–1101) × Today, Plan, Portfolio, Markets × Ivory + Midnight: scrollWidth =
  innerWidth, scrollX 0 after a forced sideways scroll, 0 page errors; screenshots read at 320, 390, 466×678, 890×626,
  1024; Apex shows no readable $ in private mode. Not verified: a physical iPhone Duo (real viewport, fold/unfold,
  safe-area insets), live data. App/cache **v219 / pf-v219**.

## v218 — Apex leverage band 1.75x reload / 1.90x cruise / 2.00x cap (2026-11-11)
Jack (Nov 11 22:03 ET): "Apex not able to get crwd when it's a buy? Raise leverage cap to 2x"; then (22:08) "Update the
app". The Nov 11 scan read 1.70x, above the 1.65x cruise, so CRWD (a picked target) got no buy. He named the cap only;
the Nov 10 spacing was kept (cruise = cap − 0.10, reload = cruise − 0.15).
- `ui/apex.js`: `Apex.C.LEV_CAP` 1.75 → **2.00**, `LEV_NORMAL` 1.65 → **1.90**, `LEV_RELOAD` 1.50 → **1.75**.
  `sdApexBand()` fallbacks and the help line in `index.html` match. No other rule changed (risk guard, maintenance,
  R/R floor, per-name and cluster caps, IREN owner-managed, −25% stop, milestones).
- The "Apex morning scan · 0741" prompt was updated first, same night, to rules **v2.7** with the same band (also sizes
  picks to 1.90x and caps buys at Robinhood's reported buying power). Scan and card agree.
- Facts for the next reader: 2.00x is Robinhood's 50%-initial-margin buying ceiling, so real buying power can be
  smaller than the card's room. At 30% maintenance a 1.90x book reaches a call after a 32.3% fall and a 2.00x book
  after 28.6% (1.65x: 43.7%). From 1.90x a 5.3% fall in the book reaches the 2.00x cap.
- Files: `ui/apex.js`, `index.html`, `sw.js`, `producer/apex.test.mjs` (55/55; cap, reload, book-gaps and
  Confirm-list fixtures migrated), `tests/sd-plan-browser.mjs`, `producer/APEX-DECISIONS.md`, `CLAUDE.md`.
- Verified locally: all producer suites, tests/*.test.cjs. Browser suites run in CI only (no Chromium in the
  session). Physical iPhone not verified. App/cache **v218 / pf-v218**.

## v217 — Portfolio UI/UX continuation (2026-11-11)
- Added read-only holding/research/plan context, route-only history, Back/Forward/refresh restoration,
  account-local selected names/evidence filters, position search and keyboard row details.
- Removed only the redundant read-only Analyze confirmation; whole-book/trade confirmation unchanged.
- Existing Apex v216 and Agentic retry safeguards, strategy/risk thresholds and source data unchanged.
- Analyze's legacy self-directed input boundary is explicit; account-specific decisions stay on Plan.
- Added journey unit/browser checks and exact served-shell verification. Local producer 56/56 and
  existing model tests pass; consult the PR/CI and shared handoff for final browser/publication status.
- App/cache v217 / pf-v217. Research, source links, testing limits and Caddie→Jarvis continuation:
  `UX_REVIEW.md`. No physical-device, private-account decryption or broker execution claim.

## v216 — Separate entry eligibility from held exits; stop turnover loops (2026-11-11)
- A held name falling off the entry list is now a visible review/no-add item, never a sell by omission.
  Missing research cannot liquidate holdings. Valid entries share hard finite-level/R/R gates;
  gap adds also respect earnings, tradability, target/name caps and combined cruise room.
- One reconciled action set supplies the app, count, Plan note and Claude confirmation prompt.
  Protective exits remain active, override smaller optional sells and exclude same-name buys.
  Guard legs for the same holding are combined; proposed sales never exceed held shares.
- Held exit levels are separate from new-entry levels. Owner-stop ATR replacements are labelled
  estimates and cannot authorize entries or become held stops. Limit vs stop-limit and max price
  survive the adapter. Weekly review uses the Eastern weekday.
- Mechanical profit-milestone trims are REVIEW ONLY: the existing aggregate order history cannot
  establish completed trims. No execution ledger or live pending-order reconciliation is claimed.
- The in-app confirmation prompt follows the new contract. The external Claude scheduled routine
  was inaccessible and is NOT updated by this release. See producer/APEX-DECISIONS.md for the
  exact remaining scan and durable-ledger requirements. No broker writes or agentic-model changes.
- Local validation: 56/56 producer suites and 23 dashboard tests passed; seven turnover failures
  plus seven additional cases covered. Local Chromium could not start due to the environment's
  socket restriction; the CI workflow now runs all three synthetic browser suites before merge.
  Self-audited; no separate Fable reviewer available. App/cache v216 / pf-v216.

## v215 — Plan step 1 points at the Apex sells; margin verdict says "no new buys" (2026-11-11)
Jack (Nov 11 05:15 ET, two screenshots: Plan step 1 "✓ Nothing is broken — 5 holdings checked · ≈ $0.00 freed" and
"✓ Inside Apex's band, above 1.65× cruise — hold", above the Apex card's "Sell 4 SNPS · dropped by this week's
research"): "Rec sells but nothing broken. Where's the disconnect". No rule disagreed — two tests, and the page never
said so: step 1 (`sdBroken`) is a trend / −25% stop test; the Apex list also exits a held non-core name absent from
`cfg.targets` (`bookGaps`) and any rule sell. SNPS left the targets on Nov 10 (R/R at entry 1.09 < 1.5).
- `ui/apex.js`: new pure `planSellNote(st, out, cfg, skip)` (exported) — one amber line naming the SELL names
  `bookLines()` sends (same set as the Confirm button), minus names step 1 already lists. Tickers and reasons only: no
  share counts, no dollars, never the core.
- `index.html`: `step1ExitsHtml` ends with a `[data-sd-apex-sells]` slot (Apex-run plan only, `data-skip` = step 1's
  exits); `renderApexCard` fills it after `Apex.render` (the plan renders first; the targets fetch re-renders Apex
  only). Margin verdict "above cruise — hold" → "— no new buys" ("hold" read as "don't sell"). Wording only: no rule,
  ticket, prompt, scan or Jarvis change. "≈ $ freed" and "after planned sells" still count step 1's exits only.
- Checked, not changed: the Nov 10 drop scored SNPS with Jack's own $431 stop (ruled out Nov 11, v211). Re-scored with
  the research stop (limit − 2 × ATR14; ATR14 ≈ $19.10 from Robinhood daily bars through Nov 9): R/R 1.11 at the scan's
  $469.91 limit, 1.22 at the 4:01 AM ET pre-market $466.44, target held at the scan's $512.49 — still under 1.5.
- Files: `ui/apex.js`, `index.html`, `sw.js`, `producer/apex.test.mjs` (55/55, +1), `CLAUDE.md`.
- Verified: 55 producer suites, tests/*.test.cjs (23 pass), sd-plan-browser + brief-browser PASS; Chromium 390 and
  320px with the Nov 11 book (line renders under step 1, scrollWidth = innerWidth, 0 page errors, screenshot read).
  Not verified: the full page with live data, a physical iPhone. App/cache **v215 / pf-v215**.

## v214 — The trade list never shows a stale price as an order price (2026-11-11)
Jack (Nov 11 05:02–05:04 ET, on v213's "Sell 4 SNPS · limit $457.62 · Day" — built from the Nov 10 4:41 PM close while
SNPS last traded $466.44 pre-market): "U want me to sell at this limit price" · "Fix the app!" · "Needs to say right
price". The page has no live quote source: prices come only from the producer snapshot (hourly, weekdays 8:41 AM–
4:41 PM ET; it prefers the extended-hours quote, so the 8:41 run carries the pre-market price).
- `index.html` passes `cfg.snapAgeMin` (minutes since `__DATA.generatedAt`).
- `ui/apex.js`: `C.PRICE_FRESH_MIN = 75`, `priceIsFresh()`. Fresh ⇒ lines read "limit $x · Day|GTC" and a grey note
  gives the quote age. Stale or unknown ⇒ lines read "≈ $x" in amber (`est: true`, no "limit", no time-in-force) under
  an amber note: not order prices yet, when the app re-prices, tap Confirm for the exact price now.
- `portfolioPrompt`: exits send the snapshot price with its age and tell Claude to set the limit from the LIVE price.
- Files: `ui/apex.js`, `index.html`, `sw.js`, `producer/apex.test.mjs` (54/54, +1), `CLAUDE.md`.
- Not done (needs Jack's decision — usage): a pre-market producer run earlier than 8:41 AM.
  App/cache **v214 / pf-v214**.

## v213 — Recommended trades name the price to enter (2026-11-11)
Jack (Nov 11 04:56 ET, on v212's "Sell 4 SNPS · last $459.92"): "Sell or buy at what price". `bookLines()` now puts
an order price and time-in-force on every line: build rungs and adds "limit $x · GTC", rule sells "limit $x · Day"
(GTC when the ticket says so), research-dropped exits "limit = last × 0.995 · Day" (the scan's swap rule) with the
last price moved to the grey line; an add with no research limit says "price at confirm". `portfolioPrompt` sends
the same proposed limit for exits. Display + prompt text only.
- Files: `ui/apex.js`, `producer/apex.test.mjs` (53/53), `index.html` + `sw.js` (version), `CLAUDE.md`.
- Verified: all producer suites, tests/*.test.cjs. Not verified: browser at phone width for this text change, the
  served site, a physical iPhone. App/cache **v213 / pf-v213**.

## v212 — The Apex Confirm button lists the trades it sends (2026-11-11)
Jack (Nov 11 04:51 ET, phone screenshot of the button reading only "1 order"): "somewhere here it's gotta tell me
what trades it's recommended that I click to confirm". `ui/apex.js` new pure `bookLines()` (exported) = the same set
the button counts and `portfolioPrompt` sends: build rungs, under-target adds, research-dropped exits, rule sells.
`portfolioButton()` renders them as a "🧾 Recommended trades" list directly above the button: a BUY/SELL tag, one
line ("Sell 4 SNPS · last $459.92"), one grey reason line. Snapshot prices; the confirm step re-prices live. No
rule, prompt, scan or Jarvis change. IREN never appears.
- Files: `ui/apex.js`, `producer/apex.test.mjs` (53/53, +1), `index.html` + `sw.js` (version), `CLAUDE.md`.
- Verified: all producer suites, tests/*.test.cjs; Chromium 390 and 320px with the Nov 11 book (scrollWidth =
  innerWidth, 0 page errors, screenshot read). Not verified: the full page with live data, a physical iPhone.
  App/cache **v212 / pf-v212**.

## v211 — Apex stops and targets are research levels only; the card alerts at them (2026-11-11)
Jack (Nov 11 04:29–04:31 ET): "My manual inputs should never be accounted for" · "u tell me tp or sl spots … when a
price hits the correct tp or sl the app is telling me. But the recs are from deep research". The Nov 10 scan had
scored S, ZS and SNPS with HIS resting Robinhood stops (`stopBasis: "Jack's open stop"`).
- `levelsFor()`: a stop whose `stopBasis` names Jack's own order is dropped; fallback = limit − 2 × `atr` (the
  scan's default basis) when the row carries an ATR, else no stop and no R/R. ZS: $180 → $173.82.
- New rule A4b: a held non-core name at/through its research `tp1` → `tp` row ("target hit"); at/through its
  research stop → `sl` row ("research stop"); each a whole-position sell line unless a rule sell is already on the
  name. His order prices are never read. IREN excluded.
- Weights rows show "research exit: stop · target" under every held target name; research tiles show the research stop.
- Confirm prompt: lists research exit levels for held names and tells Claude his resting orders are never an input.
- Confirm answer format (Jack, same day, screenshot of the 8-column table cut off on his iPhone: "orders easy to
  read in one view on iOS no scrolling"): numbered order lines first, leverage line, one 3-column Ticker | Stop |
  Target table, one "No action" line; no table wider than 3 columns.
- `index.html`: `cfg.levels` and research rows carry `atr` + `stopBasis`.
- `index.html` also reads optional `heldLevels` rows from `data/apex-targets.json` (scan rules v2.5: research
  stop/target/score for every held name, not only the top 5); a `top5` row wins.
- Files: `ui/apex.js`, `index.html`, `sw.js`, `producer/apex.test.mjs` (52/52, +1), `CLAUDE.md`.
- Verified: 55 producer suites, tests/*.test.cjs 4/4. NOT run: sd-plan / brief browser suites (playwright import
  failed in the session), phone-width check, served site. Needs scan rules v2.5 (prompt change, separate).
  App/cache **v211 / pf-v211**.

## v210 — Apex research: the 50-name "News veto" paragraph is one folded line (2026-11-11)
Jack (Nov 11 04:26 ET, phone screenshot of Research: a 30-line orange paragraph repeating "price below SMA200" 40
times): "Clean this up and merge". `ui/apex.js` new `vetoBlock()` renders `R.vetoed` as ONE collapsed
`<details class="sd-more apex-veto" data-apex-veto>`: summary "⛔ 50 screened out" + a count chip per reason
(40 below 200-day · 6 R/R under 1.5 · 4 other). Open: names sharing a reason are ticker chips; R/R misses are chips
carrying the figure, with their limit → target · stop lines in a nested fold; one-off reasons stay "SYM — why" rows.
Display only — same rows, nothing computed or dropped (test asserts every name survives). Relabelled from "News veto"
to "screened out" because most rows are trend / R/R gates, not news. No scan prompt, rule, ticket or Jarvis change.
- Checked, not changed: 8 of the 40 (NVDA, GOOGL, TSLA, AVGO, MU, TSM, CEG, HOOD) re-read from Robinhood — each
  closed Nov 10 under its 200-day SMA, so the list is real, not a data fault.
- Files: `ui/apex.js`, `producer/apex.test.mjs` (51/51, +1), `index.html` + `sw.js` (version), `CLAUDE.md`.
- Verified: all producer suites, tests/*.cjs, sd-plan + brief browser suites; Chromium 390 and 320px, Ivory and
  Midnight, with the real Nov 10 `data/apex-targets.json` list — closed 2 lines, open no overflow. The full page
  with live data and a physical iPhone not verified. App/cache **v210 / pf-v210**.

## v209 — Scheduled plan buys are not an insider cluster (2026-11-10)
Jack, on a "30 insiders bought TSM" Smart Money flag that turned out to be a routine monthly purchase
(same 30 officers, the 7th of each month, one identical price, 28-152 shares each, about $121K in total):
"If it's nothing important this shouldn't keep refiring."
- **Rule (`producer/flow.mjs`):** new `planBuyRows()` + `INSIDER_PLAN_MIN_BUYERS = 3`. `P` rows where 3+
  DIFFERENT people bought on the same `transactionDate` at the same `transactionPrice` are a scheduled plan
  run and are treated as mechanical, like `A` grants. `insiderScore` drops them before counting buyers, buy
  dollars or a cluster (reported as `planRows`, and in the note); `insiderTrades` drops them from the Smart
  Money feed, so the `cluster-buy|SYM|<latest txn>` flag id no longer changes every month.
- **Not matched (tested):** two people sharing a day and price; one person's lots at one price; several
  people on one day at DIFFERENT prices (still a real cluster); sells.
- **Takes effect** on a symbol's next daily flow-fetch (the sidecar replaces the prior per-symbol read).
  No UI, score-weight, Jarvis or agentic change. A feed with nothing but plan runs returns no insider read.
- Files: `producer/flow.mjs`, `producer/flow.test.mjs` (+12), `index.html` + `sw.js` (version), `CLAUDE.md`.
- Not verified: the live Finnhub TSM payload (no key in this session) — the pattern was read from Alpha
  Vantage's copy of the same Form 4 rows.

## v208 — Apex keeps adding: cruise 1.65x, reload line 1.5x (2026-11-10)

Jack (Nov 10 01:18 ET), told that raising the cap to 1.75x only widened the hold zone: "No I don't want that. I want
to keep adding" — then chose "Add to 1.65x". `Apex.C.LEV_NORMAL` 1.35 → **1.65** (where adds stop) and `LEV_RELOAD`
1.20 → **1.50** (below it Apex opens buys; it trails cruise by the same 0.15 as before). Cap stays 1.75x (v206), so
the hold-only zone is 1.65–1.75x. The real Nov 9 book (1.25x) is now UNDER the reload line and builds again. Every
surface reads the band from `Apex.C` (`sdApexBand()` fallbacks match). Per-name cap (20% of equity), R/R floor, IREN
owner-managed and maintenance are unchanged — with the Nov 9 targets (60% of equity) plus IREN the book tops out
near 1.56x, below cruise. At 30% maintenance a 1.65x book reaches a call after a 43.7% fall. **The "Apex morning
scan · 0741" prompt still hard-codes 1.35x cruise / 1.2x reload / 1.65x cap (rules v2.3)** — its update was refused by
a session permission check twice on Nov 10; until it is changed the scan's tickets and this card disagree. Files:
`ui/apex.js`, `index.html`, `sw.js`, `producer/apex.test.mjs` (50/50; build and book-gaps tests migrated, +keep-adding
case). Verified: all producer suites, tests/*.cjs 4/4, sd-plan-browser PASS. Physical iPhone not verified.
App/cache **v208 / pf-v208**.

**Also in v208 — NVDA is waived from the AGENTIC wash-sale block.** Jack (Nov 10 01:21 ET): "remove any nvda wash
sale restrictions for agentic". `WASH_WAIVED = ['NVDA']` + `applyWashWaiver()` in `producer/agentic-deploy.mjs`,
applied where the ledger becomes a washMap — `agentic-exec-gate.mjs` (which logs each waived hold) and the card's
`agenticWashMap` mirror (`AG_WASH_WAIVED` in `index.html`; keep the two in step). `planDeployment` is untouched and
stays a pure function of the map it is handed; a same-ticket TLH harvest still blocks its own rebuy; every other
name keeps its 30-day hold; `data.agentic.recentLosses` (the ledger) is unchanged, so the self-directed side still
sees an NVDA loss. `AGENTIC.md` step 3c tells the executor the live cross-account check exempts waived names too
(the executor prompt defers to that runbook; the prompt itself was not edited). Tax effect: a wash sale DEFERS the
loss into the replacement shares' basis; Robinhood does not adjust a cross-account wash on the 1099-B. Tests:
agentic-deploy 276 (+4), agentic-exec-gate 18. Not verified: a live executor pass (market closed, no passphrase here).

## v207 — PLTR is waived from the Apex wash-sale hold (2026-11-10)

Jack (Nov 10 01:11 ET): "Forget any wash sale for plntr is minimal compared to iren loses". New `sdWashIgnore()`
(default `['PLTR']`, override `window.SD_WASH_IGNORE`): a name on it is dropped from `cfg.wash` in `renderApexCard`,
so it is never an Apex TAX HOLD row, 🚫 tile or WAIT line and can be a build rung / ADD line again. **Apex card
only** — `sdWashMap` (the cross-account ledger), the retired SD plan's wash check and the ••3900 executor's wash block
are unchanged, and every other name keeps its hold. Files: `index.html`, `sw.js`, `tests/sd-plan-browser.mjs`.
Verified: apex 50/50, tests/*.cjs 4/4, sd-plan-browser PASS. Physical iPhone not verified. App/cache **v207 / pf-v207**.

## v206 — Apex leverage cap is 1.75x (2026-11-10)

Jack (Nov 10 01:02 ET), after asking for 2:1 and seeing that 2:1 is the Reg T buying ceiling: "Let's do 1.75 for
now." `Apex.C.LEV_CAP` 1.50 → **1.75**; cruise 1.35x and the 1.2x reload line are unchanged (he changed the cap only).
The "Over the …x cap" row title, the gauge label and the confirm prompt now READ the constant, and `sdApexBand()`'s
fallback matches, so the Plan posture, Do-now, the Accounts banner and the Leverage tile follow. At a 30% maintenance
requirement a book at 1.75x reaches a call after a 38.8% fall (1.5x: 52.4%). Not changed: maintenance, the risk guard,
IREN owner-managed, the old plan's `PLAN_MAX_LEVERAGE`. Files: `ui/apex.js`, `index.html`, `sw.js`,
`producer/apex.test.mjs` (50/50, +1), `tests/sd-plan-browser.mjs`. Verified: all producer suites, tests/*.cjs 4/4,
sd-plan-browser PASS (320–1440). Physical iPhone not verified. App/cache **v206 / pf-v206**.

## v205 — The Confirm button carries the week's whole book, not only armed build rungs (2026-11-09)

The first Monday v2.2 scan (Nov 9) landed, but on the real book (1.25x, above the 1.2x reload line) no build rung
fires, and drift rows carry no ticket — so `portfolioButton` counted **0 orders and hid the button** on the morning it
was built for, while the research had real changes (S 3% → 16.2%, ZS 2% → 14.5%, new SNPS 16.1%, PLTR 9% → 13.3%,
AMZN dropped). New pure **`Apex.bookGaps(st, out, cfg)`**: **ADD** for a target name ≥ 2 pts under its weight that is
not already a build rung (with the research entry · limit · target · stop · R/R from `cfg.levels`), **EXIT** for a held
non-core name absent from `cfg.targets`. Never the core (IREN, owner-managed), never a wash-window name (it stays the
TAX HOLD line). Both feed `portfolioPrompt` and the button's order count; Claude still checks each line live
(YES/WAIT/NO). Also: `data/apex-targets.json` refreshed from Jarvis `os/apex-targets` (Nov 9, rules v2.2) — the
scan's own copy hit a 403 again (the repo is not a source on that scheduled task). Files: `ui/apex.js`,
`producer/apex.test.mjs` (49/49, +1 replaying the Nov 9 book), `data/apex-targets.json`, `index.html`, `sw.js`.
App/cache **v205 / pf-v205**.

## 2026-11-09 — Open Daily Picks keep getting prices: a `pick` fetch outside the YTD cap + dated quote closes

Jack (Nov 9 01:54 ET, screenshot of the Track Record: BAC/T/NFLX Oct 23–26 and CMCSA Oct 7 "Not graded — no
recorded prices after the scan"): "make sure these are graded still for the future". The grading universe WAS in
`hist-plan.mjs`'s priority list, but a name whose series fell more than `HIST_TAIL_DAYS` (10) behind needed a full
YTD refetch, and those share `HIST_FULL_CAP` (30/run) with holdings, the agentic target and the shadow vintages —
so an open pick could sit in `fullDeferred` for its whole 60-day life (inferred from the code; the live snapshot was
not decryptable from this session). Two fixes, producer-only: **(1)** `pickgrade.gradingStarts` → `planHistoricals
({pinned})`: an open-pick symbol too stale for a tail goes in a new **`pick`** group (`hist-day-pick-<n>.json`,
≤3/call, OUTSIDE the cap), starting the day after its last bar (no hole for moving averages), else YTD, never later
than its scan date − 3. **(2)** `pickgrade.quoteCloseBars` + `addQuoteCloses` in `build-data.mjs`: every run, an
open pick's quote carries Robinhood's official dated close (`previous_close` + `previous_close_date`, verified live
on BAC/CMCSA), added as a daily bar only where that date is missing AND the series is contiguous
(`QUOTE_BAR_MAX_GAP_DAYS` 5) — a close appended over a hole could let the grader walk past a stop hit and FREEZE the
wrong outcome, so a gapped series waits for the backfill. The EVERY-RUN quotes row already carries the grading
universe, so no Routine prompt change: PRODUCER.md's table and the hist-plan section name the new file. Tests:
`pickgrade` +3 groups (31), `hist-plan` +7 (43), `build-data` 106/106, full suite green. No app/cache bump.
Existing ungraded episodes self-heal on the next FETCH_ALL (the `pick` lines backfill from their last bar).

## v204 — Screens is the 3rd Research tab, Analyze the 4th (2026-11-09)

Jack (Nov 9 01:53 ET): "Move screens to 3rd and bunk analyze to 4". `routes` order in `ui/experience.js` IS the
Research row, so `screens` now precedes `analyze` (Plan · Markets · Screens · Analyze · Decision evidence · What if?);
the classic tab bar swaps the same two buttons. Nothing else changed. App/cache **v204 / pf-v204**.

## v203 — Research › Screens page; Apex rows show shares and dollars (2026-11-09)

Jack (Nov 9 ~01:35 ET), asked whether the v202 "Other screens" fold should be its own page: "Build and merge"; then
(01:38) "Make sure apex is showing the recommended shares and dollar amounts in each ticker as well so it's clear".
**Pages.** The Plan › Self-directed page now holds ONLY the plan — Apex card → Action Center → Rebalance Log link →
**Screens link** (`[data-sd-screens-link]`) → Agentic link → disclaimer. The oversold daily screen (hero, Top 3,
Composite Scores, Scoring Breakdown, Track Record, Catalysts, Earnings preview) moved to a new **Research › Screens**
page: `#page-screens` / `#screens-app` (`data-priv="market"`), classic tab `#tab-screens`, `routes.screens`
(`area:'research'`, `tab:'screens'`) in `ui/experience.js`, `initScreens()` → `renderScreensPage()`, led by a
reference-not-buys note (`[data-sd-screens-note]`: nothing there is checked against Apex's band, cluster cap or tax
holds and nothing reaches the Confirm button). Shared pieces `screensHeroHtml` / `screensCardsHtml(top3Hint)` /
`screensDiscHtml` / `screensRenderAll` serve both the Screens page and the legacy (`SD_APEX_RUNS=false`) Plan page,
which still renders them inline — in that mode Screens is a pointer, so the `picks-*` ids exist once app-wide.
`fetchPicksLive` runs once whichever page asks first (`_picksLiveStarted`). **Cut:** the momentum watchlist
(`#sd-ideas-content` has no mount; `renderActionPlan` already null-checks it) — Apex's Monday scan ranks momentum,
and two lenses on one page was the v202 problem again. **Moved:** Income Ideas (PICK_INCOME) render on the Options
page via `optPickIncomeHtml()` before Options Knowledge (`[data-opt-pick-income]`, a data attribute because the rail
re-ids every `.card`); `loadPicksData` slots the card in late if Options rendered first. Earnings stays on both
(Apex's WAIT gate reads `azEarn`). The v202 `.sd-other` CSS, `sdOtherShown` and the fold are gone; the v202
jump-opens-folded-ancestor fix stays. **Apex (`ui/apex.js`):** every 🎯 weights row carries a second line —
`hold N sh · $X · target $Y (N sh)` and, when a build rung is armed, `this week: buy N sh ≈ $Z` taken from the rung's
own ticket (sized at the limit, so it cannot disagree with the Jarvis ticket); with nothing held the target share
count is priced at the scan limit and says so; the owner-managed core shows held shares and dollars only.
**Privacy audit** gained the Screens surface (0 leaked). Files: `index.html`, `ui/apex.js`, `ui/experience.js`,
`sw.js`, `producer/apex.test.mjs` (48/48, +1), `producer/privacy-audit.mjs`, `tests/sd-plan-browser.mjs` (Screens
section replaces the fold section), `CLAUDE.md`, `UI-PRESERVATION.md`. Verified: all producer suites, tests/*.cjs
4/4, sd-plan-browser + brief-browser PASS, privacy audit 0 leaked across 9 surfaces, Playwright 390 — Plan, Options
and Screens scrollWidth 390, no page errors. Physical iPhone not verified. App/cache **v203 / pf-v203**.

## v202 — Apex runs the Self-directed page: one leverage rule, one buy list (2026-11-08)

Jack (Nov 8 ~23:05 ET) asked for a review of the whole Self-directed research page, then chose **"Apex only"**. The
review found two rulebooks on ••0741: the August plan's credit-line bands (cruise 50% / ceiling 70% of the line,
which allowed far more borrowing than Apex's cap) against Apex's 1.35× cruise / 1.5× cap, and three
pick lists that never overlapped (Apex's Monday research, the plan's momentum lens over SD_BENCH, and the daily
**oversold** RSI<45 screen, whose card claimed "the ideas the plan's Step 2 redeploys into" — Step 2 never used it).
Also: Step 2 read "$0 … already at your 50% cruise band" far below cruise (the real cause was the heat gate), a 14%
Apex target sat in a wash-sale window only the old plan knew about (Apex had no wash check), the IREN weights bar
showed orange ~96% vs a 20% target after v201 made IREN owner-managed, and research tiles printed `vol 0%` (the scan
writes vol as a fraction, 0.313 = 31%).
**`sdApexRuns()`** (default true; `window.SD_APEX_RUNS=false` restores the old plan, and `tests/sd-plan-browser.mjs`
runs both) switches, in `index.html`: **Plan** — Step 1 "cut what's broken" kept (exits, covered-call locks, sell
confirm — shared with the old plan via `step1ExitsHtml`/`lockedBoxHtml`/`step1TailHtml`); the margin-ceiling paydown,
peel-back chips, sleeves, borrowing, press room and rotation no longer render; margin posture is a verdict on Apex's
band; Step 2 is "↑ Buys come from the Apex book above"; Step 3 lists Apex's rules (band, risk guard, collateral,
20%/45% AI size limits, R/R ≥ 1.5 at the limit, +25%/+50% trims, −25% stop, tax holds, earnings, IREN). Band numbers
are READ from `Apex.C` (`sdApexBand`), never copied. **Do-now** keeps margin on Apex's band + earnings; the
size+weakness TRIM, RSI OVERBOUGHT / oversold ADD, +40% TAKE PROFIT, CORRELATED and CROWDED alerts stay with the old
plan. **Accounts** margin banner, Leverage tile colour and the Kyle export judge leverage on Apex's band. **Page
order:** Apex card → Action Center → Rebalance Log link → Agentic link → **🗂 Other screens** (collapsed
`.card.sd-other`, body `#sd-other-body`, found in tests by `[data-sd-other]` because the section rail re-ids every
`.card`) holding the momentum watchlist (`#sd-ideas-content`, "watchlist, not buys", no funding state) and the whole
oversold daily screen (hero, Top 3 "oversold screen — not your Apex plan", scores, scoring table, track record,
income ideas, catalysts, earnings) — same ids and renderers, only order and the fold changed. Rail/Find jumps now open
a folded ancestor (`jump`/`scrollToCard`); `sdOtherShown()` resizes the composite chart when the fold opens. The old
Step 2 headline now names the real reason (heat gate / ceiling / cruise / no room). **Apex (`ui/apex.js`):**
`cfg.wash` (from `sdWashMap`, the cross-account loss ledger) makes a wash-window target a dated `wash` row ("SYM —
tax hold to <date>"), never a build rung, a 🚫 on its tile and weights row, and a WAIT line in `portfolioPrompt`;
the owner-managed core's weights row is a grey "NN% · yours" bar with no target; `portfolioPrompt`'s target line
drops the core ("plus IREN, owner-managed (no target)"); research tiles list this week's TARGETS first (PLTR, 6th by
score, used to lose its tile to two cluster-blocked names), show the limit the R/R is measured at, and print vol as a
percent. Help text for Action Center and Top 3 updated. Files: `index.html`, `ui/apex.js`, `sw.js`,
`producer/apex.test.mjs` (47/47, +3), `tests/sd-plan-browser.mjs` (Apex-run section), `CLAUDE.md`,
`UI-PRESERVATION.md`. Verified: all 55 producer suites, tests/*.cjs 4/4, sd-plan-browser + brief-browser PASS,
privacy audit 0 leaked, Playwright 390/320 with the real `data/apex-targets.json` and a synthetic wash-window loss —
scrollWidth = viewport with the fold open, no page errors. Not changed: the Apex morning scan prompt, Jarvis, tickets,
the producer. Physical iPhone not verified. App/cache **v202 / pf-v202**.

## v201 — IREN is owner-managed: no screen ever tells Jack to sell it (2026-11-08)

Jack (Nov 8 22:38 ET): "I do want u to stop telling me to sell the iren to clear margin. Just build the portfolio and
I'll handle the iren." **Apex (`ui/apex.js`)**: new `DEFAULT_CFG.coreOwner: true` and `ladder: []` (the IREN 200 @ $30
rung is retired). With `coreOwner` the core (`cfg.core`, IREN) is never a risk-guard leg (`guardPlan` skips it; a
short guard says "IREN excluded — your call — deposit cash"), never a ladder rung, never a winner trim or stop exit
(one neutral `core` row: "IREN — your call"), never drift-flagged; build rungs already skipped it. Leverage / guard
sells still fire, but only on the other names. `portfolioPrompt` marks IREN "OWNER-MANAGED — Jack handles it" and tells
Claude never to propose selling or trimming it to make room, fix leverage or fit a cap — size new buys down instead.
**Self-directed Plan (`index.html`)**: new `sdOwnerHold(sym)` (default `['IREN']`, override `window.SD_OWNER_HOLD`);
an owner-held name is never a broken-thesis exit, a margin-ceiling paydown donor, a ✂️ peel-back chip, or an Action
Center TRIM / OVERBOUGHT / winner alert. Concentration bars still SHOW it (measurement, not an order). The old
behaviour is still tested under `LEGACY = {coreOwner:false, ladder:[IREN 200 @ $30]}`. The "Apex morning scan · 0741"
scheduled task's prompt was updated the same night to match (no IREN stop/ladder/trim/cluster-trim tickets).
Files: `ui/apex.js`, `index.html`, `sw.js`, `producer/apex.test.mjs` (44/44 + 2 v201 cases), `CLAUDE.md`. Verified:
apex, sd-rules 76/76, business 18/18, tests/*.cjs 4/4, sd-plan-browser + brief-browser PASS; replay of the live Nov 6
book (IREN 500 sh, 0.96x) and the Nov 5 3x book (IREN 900 + PLTR 100): no IREN ticket on either; the 3x guard sells
PLTR only. Physical iPhone not verified. App/cache **v201 / pf-v201**.

## v199 — One "Confirm this week's Apex book" button; plan buttons become a confirm (2026-11-08)

Jack (Nov 8 22:24–22:33 ET): the hand-off button "should be a confirm so the app builds out what I should be trading
… tell me the yes or no and prices"; then "I don't want it individually. It's supposed to be full recommended
portfolios. So the research feeds me the new portfolio each week and I one click to confirm." So: **ONE green
button on the Apex card**, under "Rules firing now" — **"✅ Confirm this week's Apex book with Claude · N orders"**
(`Apex.portfolioPrompt` + `portfolioButton`, pure; rendered only when at least one armed build rung or a sell ticket
exists). It opens a Claude chat carrying the WHOLE proposed book: equity / debt / leverage / maintenance, every held
position (core flagged "keep ≤ 500, never add"), target weights, every armed buy with trigger · limit · target · stop ·
scan R/R (+ "BELOW 1.5 R/R floor" when `r.lowRR`), any rule sells, and up to 3 research names outside the target
as context only. Claude is told to check each line with Robinhood READ tools (••••0741 is read-only to every agent;
`review_equity_order` / `place_equity_order` are forbidden) and answer ONE table — Ticker | Verdict YES/WAIT/NO |
Shares | Entry/limit | Stop | Target | R/R | why — then leverage after all YES fills, then the Robinhood order lines
in entry order. Jack types the YES lines into Robinhood. Gates in the prompt mirror the card: within 3% of the
20-day high ⇒ WAIT, earnings ≤ 3 trading days ⇒ WAIT, bad news ≤ 10 days ⇒ NO, R/R < 1.5 ⇒ NO, 20% per-name cap,
stay under 1.5x, AI/compute cluster = one bet. The **Self-directed Plan** batch buttons (v198) are the same idea for
the SD plan's own sells/buys: **"✅ Confirm these N buys / sells with Claude"** via `planOrdersPrompt`. Per-name
confirm links (tried first this evening) were removed before release at Jack's word. Unchanged: rules, tickets,
the scan prompt, Jarvis approvals (still where a ticket is approved/declined — this button is the live second
opinion before entry), Analyze / Picks / Options hand-offs, the agentic "Deploy ••••3900" button. Files: `ui/apex.js`,
`index.html`, `sw.js`, `producer/apex.test.mjs` (+1, 43/43 incl. the new prompt test), `tests/sd-plan-browser.mjs`
(label), `CLAUDE.md`. Verified: apex 43/43, business 18/18, tests/*.cjs 4/4, sd-plan-browser PASS (320–1440,
privacy, Midnight); synthetic Playwright 390 with the real `data/apex-targets.json` (4 armed rungs) — one button,
"· 4 orders", prompt decodes clean (no undefined/NaN), scrollWidth 390, no page errors. Physical iPhone not
verified. App/cache **v200 / pf-v200** (the per-name variant shipped briefly as v199 in PR #173; this supersedes it).

## v198 — Self-directed plan buttons write tickets instead of promising to place trades (2026-11-08)

Jack (Nov 8 22:05 ET, phone screenshot of the Plan page): "Does this allow me to build Claude trades for Robinhood
or no cause u can't trade in this acct". It did not: the **"Build these N buys / sells with Claude"** buttons on the
Self-directed Plan (the ••••0741 margin book) predate Apex and opened a Claude chat whose prompt said run
`review_equity_order` → `place_equity_order` — tools that work only in the dedicated agentic account (••••3900).
Robinhood's rule, not ours: an agent trades only in its own agentic account, and no agentic account can borrow
on margin, so the ••••0741 book stays human-entered for good. `planOrdersPrompt` now asks Claude to **WRITE one
copy-ready order line per ticket** (side · shares · ticker · type · limit · TIF, plus entry/target/stop, CANCEL if
last > limit + 0.5×ATR) and says the account is read-only to agents; the buttons read **"✍️ Write these N buy
tickets for Robinhood"** / **"… sell tickets …"**. Unchanged: `eqTradePrompt` / `optTradePrompt` (Analyze, Picks,
Options ideas — account-agnostic, Claude can still place those in ••••3900) and the agentic page's
"Deploy ••••3900" button. No rule, ticket, scan or Jarvis change. Files: `index.html`, `sw.js`,
`tests/sd-plan-browser.mjs` (label assertions), `CLAUDE.md`. Verified: tests/*.test.cjs 4/4, sd-plan-browser PASS
(320–1440, privacy, Midnight), Playwright 390 screenshot of the button, scrollWidth 390. Physical iPhone not
verified. App/cache **v198 / pf-v198**.

## v197 — Research top-5 tiles: links stop running off the screen; R/R measured at the entry the tile shows (2026-11-08)

Jack (Nov 8 00:20 ET, phone screenshot of Research — top 5, "Fix"): the raw SEC URLs in each tile's `why` didn't
wrap, so they ran past 390px and printed over the next column. Now any `http(s)` URL in `why` is pulled out and shown
as a short **source ↗** link, and the `News: …` part plus that link fold into a `📰 News · source` `<details>` under
each tile (tiles also get `overflow-wrap:anywhere`). Second fix, found while checking the screenshot: the tile printed
the scan's `rr` (measured from the prior close) beside the buy-stop entry, e.g. PANW "R/R 46.1" next to Entry $357.55 →
$432.32 · stop $312.12. The tile now computes R/R at the entry it shows, exactly like the v194 build rungs
(`levelsFor`: limit, else trigger × 1.01): AMZN 0.12, ZS 0.68, S 0.55, PANW 1.45, CRWD 0.68, red when under
`C.RR_MIN` 1.5. The scan's close-based figure stays in the fold ("Scan R/R 46.1 was measured from the prior close").
Display only: no rule, ticket, target, scan prompt or Jarvis change. Adapter passes `limit` from `top5`. Files:
`ui/apex.js`, `index.html`, `sw.js`, `producer/apex.test.mjs` (new test uses the live Nov 6 AMZN/PANW rows),
`CLAUDE.md`. Verified: all producer suites, tests/*.test.cjs, Playwright 390 (Ivory) / 320 (Midnight) with the real
data/apex-targets.json rows: scrollWidth = viewport, no tile overflow, no page errors. Physical iPhone not verified.
App/cache **v197 / pf-v197**.
## v196 — Apex uses Robinhood's per-stock maintenance: IREN 30%, AMZN 25%, PLTR 25% (2026-11-08)

Jack sent two screenshots of Robinhood's Margin buffer screen (2026-11-08 00:22 ET) showing the per-stock
maintenance ratio: **IREN 30%, AMZN 25%, PLTR 25%**. `Apex.DEFAULT_CFG.maintBy` now carries those three; every other
name (S, ZS and the rest, whose figures sit behind Robinhood's "View all") stays at the **30%** account default, which
is the same or stricter than Robinhood's, so the guard can only fire early, never late. `renderApexCard` merges
`DEFAULT_CFG.maintBy` under any `window.__APEX_CFG.maintBy` override. Per name: a 25% stock alone ⇒ guard 30% /
recovery 35%; a 30% stock ⇒ 35% / 40%. The card's line is the value-weighted blend (v195), so it now sits a little
under 35% / 40% while PLTR and AMZN are held. No balances or account numbers are stored; `maintReq` (the broker's
dollar total) is still not set. Proposals only: no orders, alerts, Jarvis or Robinhood change. Files: `ui/apex.js`,
`index.html`, `sw.js`, `producer/apex.test.mjs` (41/41). App/cache **v196 / pf-v196**.

## v195 — Apex risk guard follows the maintenance requirement (LAB-004-P1, 2026-11-07)

ChatGPT's Market & Trading Lab (LAB-004-P1, claudex Portfolio handoff 2026-11-07 19:58 ET) showed `ui/apex.js`
accepted a maintenance override (`state.maint`) but kept the risk guard at a fixed **35%** and its recovery target at
a fixed **40%**: at 50% maintenance a 100/40/60 book (already under its call) fired nothing, and 1000/340/660 sold
only back to 40%. Reproduced from source, then fixed. **Guard = requirement + `GUARD_BUFFER` (5 pts); recovery =
requirement + `GUARD_RECOVER` (10 pts), capped at 100% (no debt).** The requirement is **blended per name**:
`req = Σ maint_i · value_i`, where a position's own `maint` overrides the account default (`input.maint`, else
`C.MAINT` 0.30), and a broker total `input.maintReq` ($, covers options / anything not modeled) is used when higher.
`state()` now returns `req`, `maint` (effective blend), `maintBase`, `guardPct`, `guardTarget`; `cushion = equity −
req`. **`guardPlan(st, cfg)`** sizes the sale exactly, re-blending after each leg (selling a low-requirement donor
lifts the blend): `cfg.donor` first (keeps the 50-share tranche), then other names largest first, then core shares
above `coreMax`, then the core itself flagged `ticket.core` ("your call — a call would sell it anyway"); if even that
cannot reach the target the last leg says how much cash to deposit. The last risk row carries `after.check`
{eqPct, guardPct, guardTarget, maint, ok, short}. `tripwire()` with no pct is requirement-aware; an explicit pct keeps
the old uniform formula. Render shows the book's own guard line. Adapter passes optional `window.__APEX_CFG`
`maint`, `maintBy {SYM: 0–1}`, `maintReq`; **none are set today, so the live 30% book behaves exactly as v194**
(35% / 40%, same PLTR 50-share tranche). Proposals only: no scan prompt, ticket, Jarvis or trade change; Robinhood's
per-name requirements are not fetched (no source in the snapshot). Files: `ui/apex.js`, `producer/apex.test.mjs`
(36/36: 25/30/50/100%, concentrated blend, insufficient donor, negative equity, broker total, tripwire, render),
`index.html`, `sw.js`. App/cache **v195 / pf-v195**.

## v194 — Apex tickets show entry · target · stop · R/R, name and a Robinhood link; untradable names never become rungs (2026-11-06)

Jack (11:34 ET, phone screenshot of the build rungs): "What's S and ZS? And always put the entry target prices";
(11:35) "ZS is available on Robinhood not seeing S. Make sure all can be bought on Robinhood always". Each armed
build rung now shows a **2×2 grid — Entry (trigger, limit under it) · Target (+% from entry) · Stop (−% from entry) ·
R/R at entry** — plus the company name, "Buy N SYM · armed in Jarvis" and an **Open in Robinhood ↗** link
(`robinhood.com/stocks/<SYM>`). Levels come from `data/apex-targets.json` `top5` (`trigger`, optional `limit`, `tp1`,
`stop`, new optional `name`, `tradable`, `tradableAt`) through `cfg.levels` (built in `renderApexCard`) and
`Apex.levelsFor` — **limit defaults to trigger × 1.01** (the scan's convention) and **R/R is reward ÷ risk at the
LIMIT**, the worst fill a buy-stop-limit can get. With levels the rung is **sized at the limit** (floor(budget ÷ limit)),
so its share count matches the Jarvis ticket; without levels it keeps the v188 live-price sizing. A rung under
`C.RR_MIN` (1.5, Jack's floor) is tagged **below R/R floor** and says so in red — display only, nothing is blocked.
Live finding that prompted the R/R line: the Nov 6 scan scored R/R from Nov 5's close, but its buy-stops sit above
it, so at their real entries AMZN 0.12, PLTR 1.00, S 0.55, ZS 0.68 — all four under the floor (scan fix is Jack's call;
`ui/apex.js` rule logic for picks is unchanged). **Tradability:** a `top5` row with `tradable:false` becomes a
`skip` row ("not buyable on Robinhood"), never a buy rung. Today's six rows were checked with
`get_equity_tradability` on ••0741 at 11:35 ET (all tradable) and stamped in the data file. **Weekly review is
Monday:** the adapter passes `review` (Monday) instead of `friday`, and drift copy says "Monday review" (`friday`
still accepted by `Apex.rules`). Research tiles also show name and entry → target · stop. Files: `ui/apex.js`,
`index.html`, `data/apex-targets.json` (additive fields), `producer/apex.test.mjs` (24/24), `sw.js`. App/cache
**v194 / pf-v194**. Verified: apex 24/24, full producer suite, tests/*.cjs; synthetic Playwright 390 and 320 with the
real targets file — 4 grids, floor warning, SentinelOne + Robinhood link, scrollWidth = innerWidth, no page errors.
Physical iPhone not verified.

## v193.1 — Business check tests no longer pin IREN's live grade (2026-11-06)

ChatGPT's setup of the weekly "Business check writer" found that `producer/business.test.mjs` asserted the
LIVE `data/business.json` IREN record was "intact", so an honest regrade (weakening/broken) would fail CI and
block the data PR. Behavior tests now run on a frozen inline fixture (the Nov 6 2026 IREN record); the live file
only gets structural checks: known verdict, asOf date, graded (non-unverified) records complete per `problems()`,
refClose on/before asOf, history older than current. An `unverified` record may be partial (no sources yet) and
still renders Unverified. Verified: business 18/18, apex 18/18, plus a simulated regrade (IREN → weakening with
the old record in history[], and a partial unverified name) passing both. Test-only; no UI or data change, no
version bump.

## v193 — Business check compact view (2026-11-06)

Jack (01:34 ET): "it'll take up a lot of room when we have them all so build a condense view". `ui/business.js`
`html()` now renders a **tally strip** (one colored count per verdict) and every assessed name as ONE collapsed
`<details class="biz-row">` row — ticker (+CORE tag) · the 3 milestone glyphs · % from cost · verdict chip —
sorted worst first (broken, weakening, unverified, intact, improving; then core, then held). Tapping a row opens
the full card (core note, summary, milestones, flunks-if, next check, nested sources fold). Unassessed names stay
one chip line; funds one line; the legend + "informational only" note moved into a "How to read this" fold.
Styles ship as one scoped `<style>` block (`.biz-row`, `.biz-tally`). The weekly "Business check writer" scheduled
task's instructions are NOT kept in this public repo (they name full account numbers). Files: `ui/business.js`,
`producer/business.test.mjs` (17/17), `index.html`, `sw.js`. App/cache **v193 / pf-v193**. Verified: synthetic
Playwright 390/320 with 4 assessed rows — each collapsed row 38px, tap opens, scrollWidth = innerWidth, agentic
page clean, no page errors. Physical iPhone not verified.

## v192 — Business check on both books + a weekly writer (2026-11-06)

Jack (01:25 ET): "Wire both". The 🧾 Business check now also renders on the **Agentic plan page** (card
`#b-agp-biz` after "The target", slot `[data-ag-business]`: ••3900 holdings first, then `agentic-target.json` names),
beside the Apex card's slot. One loader for both: **`bizLoad()`** fetches `data/business.json` once into `window.__BIZ`
and repaints whichever book is open; **`bizPaint(slot, symbols, positions, core)`** fills a slot (load/render errors
paint a one-line reason). `ui/business.js` gains **funds**: `FUNDS` (SPY, VOO, VTI, QQQ, GLD, TLT, sector SPDRs…) or a
record with `fund:true` are listed on one line ("Funds — no single business to check") instead of as Unverified.
Records now come from the **"Business check writer"** scheduled task (Fridays 8:17 AM ET, after the 7:12 Apex scan):
it assesses up to 6 names a run that have no record, an overdue review, or a new earnings report since their `asOf`
(held names first, both books), writes NEW frozen assessments (old → `history[]` unchanged), runs
`producer/business.test.mjs`, and lands the data on a `data/<date>-business` PR it squash-merges (data-only, like
the eBay bookkeeper). The same run copies Jarvis `os/apex-targets` to `data/apex-targets.json` when it is newer
(the 7:45 copier was a one-shot). **Still display only**: Mandate A, the executor, `ui/apex.js`, `ui/sd-rules.js` and
every ticket path never read it (tests assert it). Files: `index.html`, `ui/business.js`, `data/business.json` (about
text), `sw.js`, `producer/business.test.mjs` (16/16). App/cache **v192 / pf-v192**. Verified: business 16/16, apex
18/18, full producer suite, tests/*.cjs 23/23, inline scripts parse; synthetic Playwright 390 and 320 — Apex slot
(IREN Intact) and Agentic slot (Unverified row + funds line) render, scrollWidth = innerWidth, scrollX 0, no page
errors. Physical iPhone not verified.

## v191 — Business check tiles on the Apex card (read-only) (2026-11-06)

Jack (01:12 ET): "Ok yes good build" — step 1 of the Lynch review: the price rules only see price, so every Apex
name gets a second card, **"is the company doing what it promised?"**. New **`data/business.json`** (schema 1,
`names{SYM:{thesis, status, summary, asOf, frozenAt, assessor, refClose, milestones[3]{name,state,metric,asOf},
changed, invalidators[], nextReview{date,trigger}, sources[]{title,url,date}, history[]}}`) and **`ui/business.js`**
(UMD, pure + render: `problems`, `assess`, `forSymbols`, `html`, `render`). Verdicts: improving · intact · weakening ·
broken · unverified; milestone states: met · on-track · late · open · missed · unverified. **Never defaults to
healthy**: no record, unknown verdict, no dated https source, ≠3 milestones, no invalidator, evidence older than
120 days, or `nextReview.date` passed by more than 7 days ⇒ the tile shows **Unverified** (with the stored verdict
and reason). The owner-directed **core** is its own chip ("core · your rule") and never changes the verdict.
`renderApexCard` fetches the file once (`window.__BIZ`) and fills the `[data-apex-business]` slot that
`Apex.render` now reserves under "Rules firing now" — assessed names get full tiles (core, then held, first);
names with no record collapse into one "Not assessed yet · Unverified" chip row (price % from cost) so a big book
stays one screen. Details (what changed, every invalidator, dated sources, assessor, frozen reference close) are
folded. **INFORMATIONAL ONLY — no stop, trim, weight, leverage or ticket logic reads it**; `producer/business.test.mjs`
fails if `ui/apex.js` or `ui/sd-rules.js` ever references it. **Freeze rule (forward paper tests):** to change a
verdict, write a NEW assessment and move the old one into `history[]` unchanged — never edit a past assessment;
`refClose` records the last close before the assessment so later grading uses only what was known then. First
record: **IREN = Intact** ("Demand up, delivery late, financing still open") from LAB-009 + the Nov 5 Q1 FY27 release
— revenue conversion met ($200M AI Cloud, +182% q/q), delivery late (>$4B ARR moved to Jan 31 2027, may run to end
Feb), financing open ($6B FY27 capex still to finance; net debt $4.4B); next review 2027-01-31. More names get
records as research assesses them (LAB-009 / the Friday scan); until then they read Unverified. Files:
`data/business.json`, `ui/business.js`, `ui/apex.js` (one empty slot div — no rule change), `index.html`, `sw.js`,
`producer/business.test.mjs` (14/14). App/cache **v191 / pf-v191**. Verified: business 14/14, apex 18/18, full
producer suite, tests/*.cjs 23/23; synthetic Playwright 390 and 320 — IREN tile Intact with core chip, unassessed
names in one Unverified row, fold opens, scrollWidth = innerWidth, scrollX 0, no page errors. Physical iPhone not verified.

## v190 — Apex research upgraded: momentum lens, vol sizing, news veto, graded record (2026-11-05)

Jack (20:56 ET): "Upgrade it". The Friday research in the "Apex morning scan · 0741" task now scores MOMENTUM
(the dashboard's `sdMomentum` rubric — 6m/3m RS vs SPY, 50/100-day trend, distance from the 6-month high)
instead of RSI alone, applies a don't-chase ENTRY GATE (within 3% of the 20-day high ⇒ half size, or wait unless
momentum ≥ 9), sizes the 4 targets by INVERSE 60-day realized vol (sum 60% of equity, clamp 8–20%), runs a NEWS
VETO on the top 6 (2 WebSearch queries each; veto on guidance cut / dilution / investigation / exec departure /
lawsuit inside 10 days — never a score input), and GRADES every Friday's picks at 5/30/90 trading days vs SPY
into Jarvis `os/apex-picks-log` (marks stamped once, never recomputed — the v129 rule). `os/apex-targets` gains
`vetoed[]`, `record{}`, and per-pick `vol`/`extended`; the 7:45 AM follow-up copies all of it to
`data/apex-targets.json`. Card: the research block shows a "Record vs SPY" line (or "no graded picks yet"), a
⛔ News veto line, and per-tile vol + ⏳ extended. Files: `ui/apex.js`, `index.html`, `sw.js`,
`producer/apex.test.mjs` (18/18). App/cache **v190 / pf-v190**.

## v189 — Apex targets come from research, not a fixed list (2026-11-05)

Jack (20:40 ET): "PICK FROM RESEARCH". The hand-typed NVDA 20 · PLTR 15 · RKLB 15 · CRWD 10 list is retired. The
"Apex morning scan · 0741" task's Friday research picks the 4 non-core targets (gates, Jack's 40/35/25 scoring,
max 2 per theme, top-6 incumbency, weights 20/15/15/10) and writes Jarvis `os/apex-targets`; that document is
copied to **`data/apex-targets.json`** in this repo (`{asOf, targets, top5, gatedCount, universeCount}`), which
`renderApexCard` fetches once (`window.__APEX_TGT`) and re-renders with. `cfg.targets = {IREN:20, ...targets}`;
with no file the book is the IREN core alone and the build rule writes nothing — never the old list. Research
tiles prefer the file's `top5` (composite · R/R · why · 🎯 target weight) over the momentum-lens preview.
Files: `index.html`, `ui/apex.js`, `sw.js`, `producer/apex.test.mjs` (17/17). App/cache **v189 / pf-v189**.

## v188 — Apex builds the new book + weekly research on the card (2026-11-05)

Jack (19:06–19:25 ET): "There's margin to play with so I expect a new portfolio tomorrow" → chose **Build on
confirmation**; then "we need the research"; Apex must stay different from ••3900. `ui/apex.js` now matches the
rules the "Apex morning scan · 0741" task runs: (1) **IREN core** — `cfg.coreMax` 500: a core ≤ 500 sh is exempt from
the 25% stop and from Friday drift trims (kind `core`, info only); shares above it still follow the stop / drift;
never added to. (2) **Build on confirmation** (kind `build`) — when lev < 1.2x and reload is shut, the room to 1.35x is
split across the non-core targets by drift weight (NVDA 20 · PLTR 15 · RKLB 15 · CRWD 10), capped at 20% of equity
per name, skipping names in the earnings guard; shown as ARMED buys (the scan writes the exact buy-stop-limit
trigger = max(prior high, 10-day EMA) × 1.005 in Jarvis). The adapter passes live quotes (`azQuote`) as `smaMap[sym].px`
so whole-share qty can be sized. (3) **🔬 Research — top 5** tiles: `renderApexCard` ranks SD_BENCH + holdings with the
existing freshness-gated `sdMomentum` lens (stale/aging names excluded) and passes `{rows, asOf, source}` as
`Apex.render`'s 5th arg; empty state says why. The Friday scan adds fundamentals + reward/risk (Jack's
stock-analysis method) and writes the full ranking to Jarvis `os/apex-targets` + any swap ticket. Files:
`ui/apex.js`, `index.html`, `sw.js`, `producer/apex.test.mjs` (+5, 16/16; the old drift test now expects the core NOT
to be trimmed). App/cache **v188 / pf-v188**. Verified: apex 16/16, full producer suite, tests/*.cjs 23/23;
synthetic Playwright 390 and 320 — card renders, research tiles render with fresh synthetic bars, scrollWidth =
innerWidth, no page errors (one pre-existing preview-only SW 404 console line, same on main). Physical iPhone not verified.

## v187 — Apex card never spins forever (2026-11-05)

Jack's phone at 1:10 AM ET, three minutes after v186 deployed: the Apex card stayed on "Reading the book…".
`renderApexCard` returned silently when `Apex` was undefined (a stale cached build, or Pages not yet serving
the new `ui/apex.js`) and swallowed any render error into console.warn — both left the spinner. Now every
exit path paints a one-line reason into `#apex-content` (`fail()`), including the thrown message, so the
next screenshot says what broke. Files: `index.html`, `sw.js`. App/cache **v187 / pf-v187**. Root cause of
the 1:10 AM spinner not confirmed (likely the deploy race); if it recurs the card will say.

## v186 — Apex: the margin book's leverage loop (2026-11-05)

Jack (00:15–00:38 ET, workshopped with ChatGPT): turn the self-directed margin account on for modelling with a
mandate DIFFERENT from ••3900 — concentrated growth, selective margin, Claude builds tickets, he taps approve.
"Tracking and visuals and analysis should be in portfolio dashboard and approve tickets in Jarvis." New card
**🪜 Apex** at the top of the Self-directed Plan page (`#apex-card`, before Action Center), rendered by
`renderApexCard(S)` from the same snapshot the plan reads (equity = `st.totalVal`, debt = negative `cashVal`,
positions = `S.enriched`). Pure rules in **`ui/apex.js`** (UMD, `Apex.*`), layered ON the v156 SD rules — never a
second rulebook: trims reuse `SD_TRIM_GAIN` (25%), the per-name cap reuses `SD_SINGLE_MAX_EQ` (20% of equity),
the stop is `sdBroken`'s 25%. What Apex adds: a **leverage band** (exposure ÷ equity: 1.35x cruise, 1.5x cap,
1.2x reload line), **cushion to call** at 30% maintenance (Robinhood's figure on IREN, seen in the app
2026-11-05; PLTR assumed — note `sdCallDrop` still uses 25%, untouched), a **risk guard** at 35% equity that sells
the donor name (`cfg.donor`, PLTR per Jack) in 50-share tranches until 40%, a **de-lever ladder** that sells into
strength (`cfg.ladder`: IREN 200 @ $30 GTC, newest lots first) and shows `armed` until the rung prints, winner
(+25% → trim 25%, +50% again) / stop exits, Friday **drift** vs `cfg.targets` (IREN 20 · NVDA 20 · PLTR 15 ·
RKLB 15 · CRWD 10, LEAPS kicker ≤ 15% from trims only), **reload** (lev < 1.2x and ≥ ⅔ of names above their
50-day ⇒ add to the top-2 up to 1.35x), and an **earnings guard** (no adds ≤ 3 days before a print; trims wait).
Each firing rule renders as a flag card with the ticket line and leverage/debt before → after; a two-slider
**What if** (core + donor price, debt fixed) re-runs the rules live. `window.__APEX_CFG` overrides the defaults
(no producer field yet). **Approvals are not in this app:** the card links to Jarvis, where the weekday
7:12 AM ET "Apex morning scan · 0741" task writes the tickets into the decisions queue; Jack places orders in
Robinhood. Files: `ui/apex.js` (new), `producer/apex.test.mjs` (new, 11), `index.html` (card, adapter, hook,
script tag, versions), `sw.js` (precache + `pf-v186`). App/cache **v186 / pf-v186**. Verified: apex 11/11,
sd-rules 76/76, full producer suite, tests/*.cjs 23/23; synthetic Playwright 390 — card renders, scrollWidth
390 (no drift), slider updates leverage + fired rules. Physical iPhone not verified.

## v185 — One navigation system: pages row + section rail (2026-11-04)

Jack (phone screenshot): "nav widgets are split between the buttons and the scroll bar. Disjointed and not all
sections have one." Two systems overlapped: the v150 `#ex-subnav` listed eight Portfolio SECTION routes as
wrapping buttons (4 rows at 390px), and the v131 card rail listed every card again as chips — with the cards the
buttons forgot (Agentic Portfolio, Account Performance, Rebalance Log) only on the rail. Now: **`#ex-subnav` =
pages only** (Accounts · Options; Plan · Markets · Analyze · Decision evidence · What if?; …), one underlined tab
row that scrolls sideways and never wraps; **the card rail = every section**, restyled to the shell's chips and
placed UNDER the page's Self-directed/Agentic switcher (still a direct child of the page — every
`:scope > .card-nav` lookup depends on that). Section routes stay in `routes` for deep links (Today's Review
buttons, the tape); Activity › Rebalance log keeps its chip because it crosses areas. The header **Account
dropdown is hidden on Accounts, Plan and Options** — the first two have their own switcher, Options is
self-directed only — so the account is chosen in one place. "Accounts overview" → "Accounts". Also
`html.experience-on{overflow-x:clip}`: Accounts/Plan/Options/Markets drifted 3–65px sideways at 320–390px on
main (measured); now 0 on all six checked pages, sticky intact. Files: `ui/experience.{js,css}`, `index.html`
(rail insertion point, versions), `sw.js`, `tests/brief-browser.mjs` (asserts the dropdown is hidden and uses
the in-page switcher). App/cache **v185 / pf-v185**. Verified: Playwright 320/390 on six pages, scrollX 0
after a forced sideways scroll; brief-browser, sd-plan-browser, tests/*.cjs PASS; predictions-browser fails at
line 43 identically on main (pre-existing). Physical iPhone not verified.

## 2026-11-04 — Rebalance Log froze at Oct 8; a refused buy leg idled $740 for two days

**(1) Log froze.** The 2026-10-14 executor commit (`1126c59`) rewrote `producer/agentic-decisions.json` as a BARE
ARRAY. `build-data.mjs` only read `{decisions:[…]}`, so every run since silently carried the Oct 14 graded log
forward: the agentic Rebalance Log stopped at Oct 8 while ~40 trades (Oct 14 → Nov 2) went unlisted. The file is
restored to `{_comment, decisions}` and build-data now accepts both shapes with a warning. **Writers: keep the
wrapper.** (2) **Stuck ticket.** Ticket `2026-11-02-jnuw39` filled its sells (GOOGL, CAT) but its `buysNow`
(META $28.86, VTI park $355.55) were refused by a session permission check; `nextAction('sells-placed')` only
looked at `buysT1`, returned `none`, and every pass idled. It now treats unplaced `buysNow` as a carried leg
(`place-buys`), and re-plans (`stale`) past `TICKET_STALE_DAYS`; AGENTIC.md step 4 says to push the owner at
once when a buy is refused. The two buys were placed from Jack's chat on 11-04 (queued for the 11-05 open), the
ticket closed `done`, the decision appended and the VTI park recorded in `agentic-parked.json`. Producer-only;
no app/cache bump. Tests: agentic-pending 32/32 (+2), agentic-ledger 113, agentic-deploy 272, build-data 107.

## v184 — Smart $ and Predict combined into one "Signals" tab (2026-11-04)

Jack: "Combine smart money and predict into one tab". The bottom nav goes from six areas to five — Today ·
Portfolio · Research · **Signals** · Activity. `routes.smartmoney` / `routes.predictions` keep their KEYS (the
tape, deep links and the saved `pf_experience_route` all use them) and now share `area:'signals'`, so the
existing sub-nav renders them as two sub-tabs (Smart Money first). Tapping Signals reopens the last-used
sub-tab (`pf_signals_last`, via `areaDefault`). Both pages, their state and the classic tab bar are unchanged.
Files: `ui/experience.js`, `tests/predictions-browser.mjs` (area selector), `index.html`, `sw.js`.
App/cache **v184 / pf-v184**. Verified: synthetic Playwright 320/390 — 5 nav items, both sub-tabs render,
last-used memory, no overflow, no page errors; tests/*.cjs, brief-browser, sd-plan-browser PASS.

## v183 — Skill-meter status chip wraps on phones (2026-11-04)

Jack's phone screenshot: the v182 chip read "Can't tell from luck yet · the edge is inside…" — the shared
`.cr-status` pill is `nowrap` + ellipsis by design (v178), which cut the reason off at 390px. Scoped override
`.sk-card .cr-status` (rounded box, wraps, dot top-aligned); the v178 Model-correctness chip is untouched.
Files: `ui/experience.css`, `index.html`, `sw.js`. App/cache **v183 / pf-v183**.

## v182 — Skill-vs-luck meter + Fed/CPI blackout on new ••3900 money (2026-11-04)

Jack reviewed an outside "AI trading desk" prompt and approved the two pieces worth taking ("Yes").
**(1) Skill vs luck** — `skillStats` in `producer/agentic-ledger.mjs` (on `gradeDecisions`' return as
`skill`, so `data.agentic.decisions.skill`): a one-sample t-statistic on the per-decision BUY excess vs SPY
(`grade.alpha`, resolved decisions only). Verdicts: `too-early` (n < `SKILL_MIN_N` 12) · `luck` (|t| < 2) ·
`skill` (t ≥ 2) · `lagging` (t ≤ −2); `needN` = decisions for t to reach 2 if mean/spread hold. Decisions
overlap in time and share names, so the t is OPTIMISTIC — the card says so. Rendered by `agSkillMeter` at
the top of the agentic Rebalance Log: status chip, a gauge (lagging | luck zone | skill, marker at t, clamped
±3), three `cr-tile`s (graded · avg excess ± spread · to know). `agSkillOf` recomputes the same rule in the
browser for a snapshot that predates the field — `AG_SKILL_MIN_N`/`AG_SKILL_T` mirror the producer, keep in step.
**(2) Macro blackout** — new `producer/macro.mjs` + committed, sourced `producer/macro.json`. Book-wide, NEW
buys only: an FOMC decision day (statement 2 PM ET, mid-session) and the trading day BEFORE a CPI print
(8:30 AM ET, before the first executor pass) defer every buy with reason `macro` for that one session.
Sells/exits/trims/TLH/drawdown raises are never blocked; the deferral is not in `PARK_DATED_REASONS`, so the
dollars wait in cash and clear next pass. The exec gate loads the file (`readMacro`; unreadable ⇒ null ⇒
no-op, logged). **Absent ≠ zero:** `macroCoverage` makes the planner WARN once either series ends within
`MACRO_MIN_COVER_DAYS` (30) — the shipped calendar runs to CPI 2027-03-10 / FOMC 2027-04-28 (2027 FOMC dates
are the Fed's tentative schedule), so it starts warning ~Feb 8 2027: extend it then. No mandate dial changed;
a one-session pacing pause around a scheduled binary event is what the earnings blackout already does per name.
Files: `producer/macro.{mjs,json,test.mjs}`, `agentic-deploy.mjs` (+test), `agentic-exec-gate.mjs`,
`agentic-ledger.mjs` (+test), `index.html`, `ui/experience.css` (`.sk-*`), `sw.js`, `producer/AGENTIC.md`.
App/cache **v182 / pf-v182**. No Routine prompt change: the planner/gate pick both up in code. Verified:
macro 24/24, agentic-deploy 272/272, agentic-ledger 113/113, full producer suite; synthetic Playwright 320/390
— all four verdicts render, gauge label stays inside the card. **Pre-existing, not from this change:** the
agentic Portfolio page drifts 3px sideways at 390px on main too (`scrollWidth` 393, no unclipped culprit found).

## v181 — Concentration readout counts what stays after the planned sells (2026-11-03)

Jack spotted it on v179's bars: "AI / compute complex 107% of equity" next to PLTR at 106%. The readout
was built from `keep` (holdings minus every broken name), so a name on the exit list vanished WHOLE —
including shares the exit leaves behind (covered-call collateral, a fully pledged lockedExit). Live:
IREN 900 sh with 300 pledged dropped out of the AI/compute complex, which really sits at ~151% of
equity after the sell (PLTR $17.5k + 300 IREN × $24.50), not 107%. Now `afterVal(r)` = value minus the
planned exit sale minus any paydown sale (`soldVal`); `concRows` and `aiVal` both use it, a partially
sold name is labelled "after sell", and the copy says "measured after the planned sells". The bars also
changed: the scale runs 0..max(100%, largest reading rounded up to 50) with a 20% new-money-cap tick and
a red 100%-of-equity tick, the fill is solid by severity, and >100% reads "1.5× what you own" — the
v179 gradient filled to the edge at any value ≥100% and made the 20% tick look like the reading.
Advisory display only; no order, size or guard changed. Files: `index.html`, `ui/experience.css`,
`sw.js`. App/cache **v181 / pf-v181**. Verified: Jack's book replayed synthetically (PLTR 100 sh,
IREN 900.07 sh / 3 short calls, equity $16,471) → PLTR 106%, AI/compute 151%; sd-plan-browser PASS.

## v180 — Portfolio tab (both accounts) + Options: folded notes, one-line table rows (2026-11-03)

Jack: "same thing for the portfolio tabs". Rather than hand-editing ~15 cards, a new reading layer
**`ui/compact.js`** re-shapes what the Portfolio (`#page-portfolio`) and Options (`#page-options`) cards
already render, so it covers both accounts and future cards. Nothing is computed or removed:
1. **Quiet notes fold.** A `div`/`p` inside a `.card` that is a `fund-note`/`cov-note` or styled faded/gray
   (`opacity:.7/.75/.8`, `#9ca3af`), has only inline children and ≥170 chars becomes
   `<details class="sd-more pf-fold">`; a note opening with a bold lead keeps it as the summary
   ("💰 Money you added"), else "ⓘ How to read this". Opt out with `.no-compact` on an ancestor.
2. **Wide tables stack on phones.** Any card table with ≥5 header columns gets `pf-stack` + per-cell
   `data-l`; at ≤520px a row is one line — first cell + 3 key columns (priority list `KEY` in compact.js:
   Value, P&L %, Day %, Signal, Flow, …) — and the rest opens on a row tap (`pf-open`). Header cells stay
   `<th>` chips, so click-to-sort still works. Opt out with `.no-stack`.
It runs synchronously in a MutationObserver (before paint), marks touched nodes `data-pfc`, and is
idempotent, so re-renders and the privacy masker converge. **Options** also changed in source: contract
cards keep strike/price/credit/P&L visible and fold the Greeks ("Greeks · assign odds 35%"), live trade
ideas fold Greeks/POP, idea bullets fold under "Why this trade", and Options Knowledge is tap rows.
Files: `ui/compact.js` (new, in `sw.js` precache), `ui/experience.css` (v180 block), `index.html`,
`sw.js`. App/cache **v180 / pf-v180**. Verified: sd-plan / brief / predictions browser suites PASS,
`privacy-audit.mjs` 0 leaked across all surfaces + clean round-trip, model suites green; synthetic
Playwright 390px — no overflow, no page errors; Options page 8,760 → 7,006px. Physical iPhone not verified.

## v179 — Both plan pages: visual rows, collapsed explanations (2026-11-03)

Jack: "word blocks → more visually appealing views and collapsed info", on ALL plan pages.
**Self-directed plan** (`renderActionPlan`): mandate box folds to a chip summary; "Nothing is broken" is a
verdict pill; margin posture is a gauge (fill = line used, ticks at cruise/max) + 3 tiles (line used ·
headroom · margin call) + verdict, method folded; paydown sells use the v178 `xr-row`s; concentration is
one bar per name (% of equity, tick at the 20% new-money cap) with peel-backs as chips; Stock ideas are
tap-to-expand rows (ticker · momentum bar · status chip · R/R; price → target · stop visible, reason on
tap); Guardrails render through `sdGuardrails()` — icon · short rule · LIVE status chip, the why on tap.
**Agentic plan** (`renderAgenticPlan`): every card intro folds under "About this card"; idle-cash clock is
a progress bar; the 5-column target table is one row per name (target-weight bar with a held-weight
tick, status chip; sector/levels on tap); buy deferrals and held sells are rows (ticker · reason ·
unlock date; detail on tap); park/entry/held-sell footnotes fold; the 19 rules and the 5 loop steps are
`gr-row`s (rule chip only when the value is ≤16 chars). Same fields, nothing new computed; all
`sd-plan-browser.mjs` assertions unchanged (ideas keep `.sd-idea[data-status]`, `.sd-idea-link`, the
target price stays in the visible summary). Agentic plan page at 390px: 7,171px → ~3,620px tall.
Files: `index.html`, `ui/experience.css` (v179 blocks), `sw.js`. App/cache **v179 / pf-v179**.
Verified: sd-plan-browser PASS (320–1440, privacy, Midnight), model + agentic suites green, synthetic
Playwright 320/390 on both pages — no overflow, no page errors, no readable $ in private mode.
Physical iPhone not verified.

## v178 — Compact "Model correctness" card + broken-thesis exit rows (2026-11-03)

Jack (phone screenshots): both read as walls of text. **Agentic › Model correctness & forward record**
(`agCorrectnessCard`): a status chip (green tracking / amber waiting / red needs attention) + "Updated …
ET", three tiles (vs SPY pp on the current vintage · research coverage · recorded account return), and the
shadow vintages as one-line rows (date · Model · SPY · excess-pp pill; tap shows model version, start,
basis, status). Account estimate / verified comparison, evidence, vol & correlations and the method note
fold into `<details>`. Vintage dates are formatted in UTC so an ET phone no longer shows the day before.
**Self-directed › Cut what's broken**: the 5-column exits table (the reason text wrapped to one word per
line at 390px) is now one row per exit — ticker pill · "Sell N @ limit" · proceeds (+ 🔒 shares held for
covered calls) · realized P/L; the reason and the full collateral sentence open on tap; Total row below.
Same fields, nothing new computed. Files: `index.html`, `ui/experience.css` (`.cr-*`, `.xr-*`), `sw.js`.
App/cache **v178 / pf-v178**. Verified: synthetic Playwright 320/390/1280 — cards don't overflow, no page
errors; vintage row ~47px. Physical iPhone not verified.

## v177 — Options history: one-line rows by close month (2026-11-03)

Jack: the v169 contract cards (~280px each) "take too much room as we go on". Approved: closed contracts
render as one-line rows (ticker pill · strike/type ×qty · status + close date · P/L · % kept) inside
**month groups** whose header carries W·L and the month's matched total; only the newest month starts open.
Tapping a row opens the v169 card body (life bar + cash legs; its duplicate header is hidden). Filter chips
All / Wins / Losses / each ticker (`ohFilter`, horizontally scrolling inside the card) — a filter opens the
matching months and hides empty ones. The scoreboard stays. The old "monthly matched results" `<details>`
is gone — the month headers replace it. Pending/other-year lists use the same compact rows (no grouping).
Same ledger fields; nothing new computed. Files: `index.html` (`optIncomeHistory`), `ui/experience.css`
(`.oh-*` v177 block), `sw.js`. App/cache and all `?v=` assets **v177 / pf-v177**. Verified: model suites green;
synthetic Playwright 320/390/1280, Ivory + Midnight — no horizontal overflow, no page errors, expand +
filters work; a closed row is ~51px vs ~280px. Physical iPhone not verified.

## v176 — Smart $ feed: grouped compact rows instead of one card per trade (2026-11-03)

Jack: "This is just a long scroll to get this info" (three identical ~470px cards for one member buying MU
three times). Approved mockup, then "Good build it and merge".
- **Grouping** (`groupItems` in `ui/smartmoney-model.js`): one row per person+ticker+side (default) or per
  ticker+side ("Group by Stock" toggle). The trades fold underneath behind an "N trades" button. Size is the
  SUM of reported ranges only when every trade in the group has one — otherwise "Size n/a", never a partial
  total. Politician rows show the filing-lag range ("Filed 32–39d late"); vs-S&P is the average of the scored
  trades, labelled "(k of n)" when only some are scored.
- **Feed chrome:** compact header, two summary tiles (new filings in 7d with how many are on your names; most
  bought in 30d), filter chips All / You hold / Following / Buys / Sells replacing the checkbox (an old
  `mineOnly:true` preference migrates to "You hold"), the "New on your names" chip row moved off the Feed, and
  ONE "tracking starts at the next daily price check" banner instead of a line on every card. Person and ticker
  pages use the same rows.
- **Global freshness strip:** the left label no longer wraps (nowrap + ellipsis), drops the current year, and
  hides the word "Snapshot:" under 430px, so the strip stays one line on a phone.
- Files: `ui/smartmoney{,-model}.js`, `ui/smartmoney.css`, `tests/smartmoney.test.cjs` (+4: grouping, no partial
  totals, by-stock, chips/summary), `producer/make-sample-data.mjs` (one member buys NVDA 3×), `index.html`,
  `sw.js`. App/cache **v176 / pf-v176**. No producer, schema or Routine change.
- Verified: model suites green; synthetic Playwright 320/390/1280, Ivory + Midnight — no horizontal overflow,
  no page errors, expand/collapse, by-stock and chip filters. Physical iPhone not verified.

## v175 — Smart Money scorecard: who's actually good (2026-11-03)

Jack: "track performance of each individual or entity so we can see who's good". New pure module
`producer/smartmoney-perf.mjs` (+ test) and a **Who's good** view in Smart $.
- **Method (read before changing):** every tracked trade (politician ledger + insider Form 4 rows) is
  priced on the FIRST DAY IT APPEARS in the snapshot — the earliest price a follower could actually get —
  then marked daily against SPY. Score = side-signed excess: buy → stock − SPY; sell → SPY − stock.
  Insider rows also get "since their trade price" (stock only). Entry needs BOTH the stock and SPY quoted
  the same day, else it waits (never mixes windows). Forward-only: nothing back-filled — no historical
  candles on our keys — so history starts 2026-11-03.
- **Ranking:** a mark counts once ≥5 days old (`MIN_AGE_DAYS`); a person is ranked at ≥5 scored trades
  (`MIN_SCORED`), by average excess, median as tie-break. Everyone else is shown as "Too early to judge".
- **Data:** flow-fetch.mjs now spends one Finnhub `/quote` per tracked symbol + SPY once a day (cap 150,
  ~1.1 s apart, ≈3 min) and writes `raw/flow/_marks.json`; build-data folds it into
  `data.flow.perf` (`trades[]` with `res`, 400-day retention, max 900) and `data.flow.scoreboard`.
  The prior ledger carries forward on runs without marks. Display-only — no score, target, order or alert.
- **UI:** feed cards show "Since report · Nd · Stock · vs S&P · Since trade"; the person page gains a
  Track record panel (beat-S&P rate, average/median vs S&P, best/worst call); Who's good ranks people,
  filterable by Politicians / Insiders, with "How the scores work" folded into a note.
- Verified: new perf suite 23/23, UI suite 10 tests, all producer suites; synthetic Playwright
  320/390/1280 Ivory + Midnight, no overflow. Live marks unverified until the next full producer run.

## v174 — Smart Money tab: politician + insider trades on your names, read-only (2026-11-03)

Jack can't use Robinhood Social because of his job, so this rebuilds the public-data half of it inside
the dashboard. New area **Smart $** (6th item in the new nav; legacy tab bar too): a feed of
congressional STOCK Act trades (`data.flow.polEvents`, already accumulated by build-data) and
open-market insider Form 4 trades, pinned to names held in either book or in the agentic target.
Views: Feed (All / Politicians / Insiders / Funds, "only my names" toggle), a person page (Follow,
trades by month, typical report delay, overlap), a ticker page ("Who's moving X": buys vs sells per
group + a conservative read), and Flags (insider cluster buy, an insider buying a held name, Congress
cluster on a held name, new trade by someone you follow) with Research-in-Claude / Snooze 7 days /
Dismiss. Follows and flag choices live in `localStorage.pf_smartmoney_v1` on the device only.
- **Producer (display-only):** `flow.mjs` gains `insiderTrades()` — the individual open-market P/S
  rows behind the insider read (same filter as `insiderScore`, 120-day window, lots merged per
  person/side/day, max 10 per symbol). `scoreSymbol` returns it as `insiderTrades`; it never enters
  any score. It appears in a symbol's sidecar on its next daily flow-fetch, so the Insiders feed fills
  in over the next full run; until then only politician rows show.
- **Not built (no source):** fund 13F holdings. Finnhub fund-ownership / FMP institutional-ownership
  are restricted on our keys, and AV INSTITUTIONAL_HOLDINGS is session-only and enormous. The Funds
  filter says "Not connected" rather than showing anything made up. Robinhood Social's verified
  retail traders are Robinhood-only data and cannot be replicated.
- **Honest limits on screen:** politician rows are weeks–months late and come from a rolling
  window of the newest reports (not a census); amounts are ranges; the read never calls politician
  flow a reason to buy (it keeps its zero weight, PROPOSAL-flow-signals.md).
- Nothing is posted, shared or traded. No balances, share counts of Jack's or account numbers render,
  so the page sits outside the privacy mask (`data-priv="off"`) like Predict.
- Files: `ui/smartmoney-model.js` (pure), `ui/smartmoney.js`, `ui/smartmoney.css`,
  `tests/smartmoney.test.cjs`, `ui/experience.js` (area + route), `index.html` (page, tab, switchTab,
  assets), `sw.js`, `producer/flow.mjs` + test, `producer/make-sample-data.mjs` (real-shaped sample
  rows). The phone bottom nav now shares width evenly across six areas (CSS in smartmoney.css).
- Verified: tests/*.cjs and all producer suites green; synthetic Playwright at 320/390/1280 in Ivory
  and Midnight — no horizontal overflow, no page errors; privacy audit clean. Live decrypted data and
  the physical iPhone not verified here.

## 2026-11-03 — A wrapped scan.json silently emptied the Daily Picks (Track Record gaps)

Owner saw the Track Record jump Oct 7 → Oct 23 → Oct 26 and nothing after. Cause: `scanRows` read only the
bare run_scan payload. When the scheduled agent saved the tool result in its MCP envelope (`[{type,text}]`
or `{content:[…]}`), it parsed to **0 rows** → 0 finalists → `picks.json` with empty `picks` → the day's
picks replaced by nothing, and `build-data` archives only a non-empty outgoing set, so every such day
vanished from the history. Reproduced on main with tonight's live scan saved wrapped: 237 matches (200 rows returned) →
0 candidates; after the fix the same file gives 10 candidates / 3 picks. Fix: `unwrapMcp()` in
`picks.mjs` (bare, structuredContent, content array, `{content}`, `{result:{content}}`, JSON string) used by
`scanRows`/`scanReportedCount`; `picks-select`/`picks-build` exit 2 with `PICKS_SCAN_UNREADABLE` when the
scanner reported rows but none parsed, so an unreadable scan carries the prior picks forward (run.mjs
treats it as non-fatal) instead of publishing an empty set. Days already lost are not back-filled — the
archived set is the outgoing picks, and those days had none. No prompt, schedule, UI or data change.

## 2026-11-03 — Preflight tells the producer to read the payout mailbox every run

Gmail was attached to the producer task at 07:27 ET, but the 07:35 run still left the Settled tab at
"Mailbox not read". build-data reads `raw/predict-mail-*.json` correctly, so the agent skipped step 2e:
the task prompt (http_api, not editable from a session) lists only Robinhood fetches for FETCH_LIGHT,
and Gmail's tools can be deferred in a scheduled session, so "only if Gmail is available" read as no.
The prompt says to obey preflight's directive, so `preflight.mjs` now prints a `PREFLIGHT ALSO:` line on
every non-SKIP run naming step 2e and the ToolSearch to load Gmail. PRODUCER.md step 2e says the same.
Not verified until a run shows the mailbox as read. Producer-only; no app/cache bump.

## 2026-11-03 — Predict Settled: a broker settlement links only on contract + side + quantity

dot's independent review of v173 (Portfolio handoff, 11/3 06:51 ET) reproduced that `reconcile()`
linked a payout email to ANY broker `settlement` row with the same contract ID — so a Yes ×10 email
and a No ×2 settlement read `matched-broker` with nothing in review. It now links only when side AND
quantity also agree and exactly one row does; an opposite side, a different quantity, a row missing
either, several matching rows, or two partial rows that merely sum to the email are `review` (payout
evidence kept, out of the totals, no `brokerTxId`). `prediction-account.mjs` now keeps a transaction's
`side` (yes/no, else null) — it was dropped, which would have made every strict match impossible.
No live impact known: the account feed carries no settlement rows yet. Tests: 8 new cases in
`prediction-settlements.test.mjs` (25 total), all 51 producer suites green. Producer-only; no
app/cache bump. **Mailbox ingestion is a separate gap:** the "Portfolio dashboard refresh" task
(`trig_01PtRiUPvg3DL6LWounfmPo7`) has only Robinhood + Alpha Vantage attached, so step 2e skips until
Gmail is attached to that task in the claude.ai UI (connectors cannot be set from a session).

## v173 — Predict Settled tab from Robinhood payout emails (2026-11-03)

dot (ChatGPT) relayed Jack's request on 11/2: settled prediction-market emails are the best outcome
source, so track them in Predict. Jack chose **option A** (email-only, private) and **route 1** (the
producer reads the mailbox). `producer/prediction-settlements.mjs` parses Robinhood's "Your $X payout
is available" emails (sender `noreply@robinhood.com`; Amount / Contract / Quantity + the contract ID in
the "View payout" link) into the encrypted **`data.predictionSettlements`** — never the public
`data/predictions.json`, and hypothetical Results are unchanged. Rules, all pinned in
`prediction-settlements.test.mjs` (17, synthetic emails only): gross payout is never profit — cost,
fees, net and settlement time stay null and there is no ROI or win rate; a combo is ONE record with
nested legs; a "No" payout is a payout on the No side; no loss is ever inferred from a missing email;
records are append-only keyed by Gmail message id (an identical retry adds nothing, a forwarded copy
is kept as `duplicate`, a different amount/quantity for the same contract marks both `conflict`, no
contract ID or excess quantity is `review` — all outside the totals); a settlement already in the
future broker feed is linked and counted once. **PRODUCER.md step 2e** (EVERY-RUN, best-effort) runs
`predict-mail-plan.mjs` and saves `search_threads` + new `get_message` results verbatim into `raw/`;
**it only runs if the producer's scheduled task has the Gmail connector**, which is set in the claude.ai
UI, not here (that task is `http_api`; its prompt already defers to PRODUCER.md, so no prompt edit).
Without Gmail the ledger carries forward and the tab says the mailbox has not been read. UI:
`ui/predictions.js` adds a fifth **Settled** tab (tiles, weekly bars hidden in privacy mode, one card
per payout with legs and the source email link, a collapsed method note); the tab keyboard handler
no longer hard-codes four tabs. App/cache **v173 / pf-v173**. Tests: 51 producer suites,
`build-data.test.mjs` 106/106 incl. a payout email through the real builder, 3 model suites,
`predictions-browser.mjs` (Settled at 320/390, privacy masking, End/ArrowLeft) and `brief-browser.mjs`.
The real ledger (7–9 payouts since July) appears only after the first producer run with Gmail access.

## 2026-11-02 — ••3900 stop breaks: phase-out names exit, active names re-research (owner "A + B")

The executor never acted on a research stop: in `agentic-deploy.mjs` the stop only deferred BUYS
(`below-stop`), and nothing re-checked a thesis when price reached it. Live case: phase-out GOOGL $281.87
under its $322 stop and CAT $628 under $695 sat held for days while Jarvis's rulebook wrongly said the
executor sold at stops. Jack chose A + B (not a blanket hard stop, which is market timing under Mandate A
and, via the 30-day wash block after a loss sale, the Sep 8 "de-facto −5% hard stop" again).
**(B)** `agentic-deploy.mjs` step 1b-2: a held `phaseOut` name at/below its stop exits whole on the next
pass (`reason:'phase-out-below-stop'`) — the research already dropped it once, so the stop break is the
second strike. Same guards as any exit (PDT; min-hold unless down ≥10%); it supersedes a drift trim and a
TLH harvest of the same name; no rebuy (phase-out names never take new money). Auto tier unchanged, so
with turnover ≤ $10k it executes unattended. **(A)** `agentic-triggers.mjs` `stopBreaks`: a held ACTIVE
target name at/below its stop, broken after the research that set it (some close since `target.asOf`
above the stop; research dated today never re-fires), sets `refreshResearch`. **`agentic-due.mjs`
`applyTriggers` now honours `raw/agentic-triggers.json` in CODE** (only a file written today) — PRODUCER.md
step 7 had said so in prose only, and the producer prompt checks just the gate's output. Targets
(take-profit) still never sell; winners are trimmed by the 5pp drift band. Tests: new cases in
`agentic-deploy`, `agentic-triggers`, `agentic-due`; all 50 producer suites green. Not verified: a live
exec-gate pass (no `PF_PASSPHRASE` in this session) — the planner was replayed on the Nov 2 book
($7,341.66) and exits GOOGL + CAT. Producer-only; no app/cache bump; no Routine prompt change needed.

## v172 — Tape text moved below iOS's status-bar blur (2026-10-30)

v171 loaded the snapshot again, but the tape was still hazy: an already-installed Home Screen app kept its
original translucent status bar, so the v171 meta change did not apply. Measured off the owner's screenshots,
iOS blurs everything under a translucent status bar AND ~20pt below it (this morning's v168 snapshot strip
showed its first line faded the same way). `ui/ticker.css` now adds `--tk-pad: min(env(safe-area-inset-top), 24px)`
between the status bar and the tape's text row — a blank band of tape colour, so the haze over it is invisible —
and every dependent offset (body padding, `#pf-fresh` top, `.acct-seg-wrap` top, desktop sidebar) includes it.
`_syncStickyTop` is back to the strip height alone; the tape's share of the switcher offset lives in the CSS
override. The `min()` makes the buffer 0 wherever there is no top inset (desktop, or iOS honouring the opaque
status bar after a re-install), so it costs nothing there. Verified in Chromium with the buffer forced to 24px:
tape 56px, text at 24px, strip and switcher stacked flush below, no overflow. Not verified on a physical iPhone.
App/cache **v172 / pf-v172**; scope `ui/ticker.css`, `index.html`, `sw.js`, this file.

## v171 — Snapshot survives a failed download; status bar stops blurring the tape (2026-10-30)

**(1) The app went blank on the owner's phone** — "Couldn't load data (FetchEvent.respondWith received an
error: TypeError: Load failed)", after minutes stuck on "Snapshot not loaded". The ~6.6 MB `data.json`
download failed, and the service worker's offline fallback had nothing, because the snapshot was cached in the
VERSIONED cache: every app update (`pf-v169` → `pf-v170` that afternoon) deleted the only offline copy, so
the first failed fetch after an update returned `undefined`. `sw.js` now keeps data.json in its own
version-independent `pf-data` cache (never deleted on activate), times the network out at 20s, falls back to
that copy (then any cache), and when there is none returns a real JSON 503 the page shows as "offline — no
saved snapshot on this device yet" instead of a broken response. Navigations are unchanged. `loadData` also
retries the fetch once after 2.5s. Verified in Chromium: load → offline → reload serves the saved snapshot;
a device with no saved copy gets the clean message.

**(2) The v170 tape fix did not work on the phone** — the haze persisted. Root cause found by comparing with
Sports Hub, whose fixed ticker is sharp: that app never draws UNDER the iPhone status bar (no
`black-translucent`), while this one did, and iOS blurs whatever sits beneath the status bar. Status-bar
style is now **`default`** (opaque; the page starts below it) and the static `theme-color` is the tape's
`#0a120f`, so the bar reads as part of the tape. The v170 solid-background/no-mask changes stay — they are
still correct. **iOS reads the status-bar style at launch, so it takes effect after the PWA is fully closed
and reopened** (worst case: remove and re-add the Home Screen icon). Not verified on a physical iPhone.
App/cache **v171 / pf-v171**; scope `sw.js`, `index.html`, this file. No producer/schema/routine change.

## v170 — Market tape renders sharp on iOS (2026-10-30)

On the owner's iPhone the v169 tape read blurred under a light-grey haze. Two causes, both iOS-specific
and invisible in desktop Chromium. (1) **iOS 26 tints the status-bar area from a fixed top bar's
`background-color`**; the tape's background was a gradient IMAGE, which gives it no colour to read, so it
fell back to the page's ivory `theme-color` and laid its scroll-edge haze/blur across the top of the tape.
The tape is now a solid `#0a120f`, and the `theme-color` meta follows it while the tape is mounted
(`window.PF_TAPE_BG`; `themeColor()` returns it, so a theme toggle no longer flips the status bar back to
ivory). (2) **A CSS mask on an animated layer is rendered offscreen at reduced resolution on iOS**, which
softens moving text; the scrolling view's mask is gone, replaced by a plain right-edge overlay, and the
track animates with `translate3d` (no `will-change`). **Rule for any future fixed top bar here: solid
background-color matching `theme-color`, never a gradient, never a mask over moving text.** Not verified on
a physical iPhone from this session — desktop Chromium cannot reproduce either effect. App/cache
**v170 / pf-v170**; scope `ui/ticker.css`, `ui/ticker.js`, `index.html`, `sw.js`, this file.

## v169 — Market tape and options-history contract cards (2026-10-30)

**Market tape** (`ui/ticker.js` + `ui/ticker.css`, owner request: "a live ticker like the other apps,
fixed to top"). A dark full-bleed strip `position:fixed` at the very top of every screen (status bar to
edge on iPhone; 32px phone / 34px desktop, set as `--tk-h` only once `html.pf-has-tape` is on). Everything
below is pushed by `--tk-h`: body padding-top, the sticky freshness strip's `top`, the desktop sidebar's
`top`, and `_syncStickyTop` adds `--tk-h` to `--stickytop-h` so the account switcher sticks below both.
`__pfTopOffset()` needs no change — it already reads the strip's computed sticky `top`. z-index 170
(above #pf-fresh 150 / switcher 90, below overlays). Sections: YOUR BOOK (combined day $/% , per-account
equity + day %, breadth), MARKETS (SPY/QQQ/DIA/IWM/IBIT/GLD/TLT + VIX regime pill), HOLDINGS (every quoted
position, both accounts, value-ordered, value not shown), OPTIONS (open contracts, days left, guardrail
tier pill), EARNINGS (≤14 days), AGENTIC (breaker level vs SPY, open ticket), HEADS UP (the Today radar's
warn items). **It is built from `PFExperienceModel.dailyBrief`** — the same model as Today — so the tape
cannot disagree with the brief. It makes no network/broker call: it is exactly as live as the published
snapshot, and the status pill says so — **LIVE** only while the market is open AND the snapshot is
≤75 min old, otherwise "As of"/"Close" + the snapshot time. Taps: symbol → Analyze (`switchTab` +
`runAnalysis`), option → Options, everything else via experience.js's `data-ex-route` router. Hold or
hover pauses; tapping the pill toggles pause; reduced motion → static, swipeable. **Privacy:** the tape
lives OUTSIDE every `data-priv` region, so it masks its own dollar figures (•••) and re-renders on the
body-class change; percentages, prices and strikes stay. Re-render is signature-gated so the scroll
animation does not restart every minute.

**Options Income & History rows** (owner: the four-line text rows looked "elementary"). Each contract is
now a card: underlying badge, outcome chip (Expired / Closed / Closed by roll / Assigned), P/L with the
share of premium kept (`net / |opening|`; "+x% return" for a debit open), a life bar opened → close
marker → expiration with "held N of Md", and the two cash legs in words (Premium in / Paid to close /
"expired worthless"). A scoreboard above the year's rows: win-rate ring, W-L record, best and worst
contract. Same ledger fields as before; nothing new is computed from data the ledger does not carry.
Styles in `ui/experience.css` (`.oh-*`).

Scope: `ui/ticker.js`, `ui/ticker.css` (new), `index.html`, `ui/experience.css`, `sw.js`, this file,
`UI-PRESERVATION.md`. App/cache **v169 / pf-v169**. Routines touched: **none**; no producer, schema,
broker or encryption change. Validation: dashboard model suites (3), brief/sd-plan/predictions browser
suites, privacy audit (clean round-trip), plus synthetic Playwright checks at 390 and 1280px: tape pinned
at y=0 after scrolling, freshness strip directly below it, no horizontal overflow, no page errors,
symbol tap opens Analyze, tape dollars masked in private mode. Physical iPhone not verified. Self-audited.

## v168 — Reachable buy allocations and visible research (2026-10-26)

The self-directed allocator capped every target at `price + 1.5 * (price - stop)`
then required reward/risk >= 2.0, so every otherwise valid candidate reaching that
check failed. `targetOf` now uses the independently observed **20-session closing-price
range**, supplied by `sdMomentum.range20`, or analyst consensus when available. The
estimate is the lower available target, still capped at the existing 3R ceiling;
**the 2:1 minimum is unchanged**. This is a range-based estimate, not a chart-pattern
measurement or empirically validated return forecast. Missing both independent inputs
is explicitly `no-target`; 3R alone cannot create a buy. A flat range yields no upside.

`setupOf` is shared by the research cards and allocator. Entry, momentum and target
checks also run at the final allocation boundary: an extended >=9 momentum name cannot
become an immediate buy through the pullback sleeve, and that sleeve enforces its 5.0
floor. The sleeve's actual tier and cash-only funding are used in the research status.
This preserves the intended delayed-entry behavior while removing the universal reject.

Research / Self-directed now shows up to six **Stock ideas** independently of the funded
pool: qualifying setups first, then momentum-ranked watch candidates, with price, estimated
target, stop, reward/risk and the next condition. Funding, tax, trend, entry and concentration
holds stay explicit. No order quantities are invented for unfunded research. Symbols open
Analyze; the long rejection lists and target methodology are expandable. Near-high UI help
now matches the code: even >=9 names wait for a pullback. Narrow Research grids and chart
bounds fit 320px. App/cache and all versioned shell assets move together to **v168**.

Scope: `ui/sd-rules.js`, `index.html`, `producer/sd-rules.test.mjs`,
`tests/sd-plan-browser.mjs`, `sw.js`, this note and `UI-PRESERVATION.md`.
Routines touched: **none**. Existing snapshot closes already supply the range; no schema,
producer input, schedule, brokerage write, account-data or encryption change is needed.
No trading thresholds were loosened. The preceding v156 target/near-high descriptions
are historical and are superseded by this implementation.

Validation: 76 focused assertions, all 50 producer suites, all dashboard model suites,
and synthetic browser checks of real range propagation, a positive funded buy, zero-funded
visible research, wash/floor/entry/missing-target rejection, 320/390/768/1440px layouts,
privacy round-trip, Midnight and Analyze navigation. Browser visuals inspected at phone
width. Self-audited; Fable was unavailable. Decrypted live account output was not accessed.

## v167 — Assignment eligibility is not a verified win (2026-10-20)

ChatGPT's 2026-10-19 19:39 ET review (Portfolio handoff) found the last confident-from-missing-input
case left after v165: a late in-the-money short call with **no cost basis** (and no mark or premium)
still got **ASSIGNMENT_WIN** — a green ✅ "the plan working" card — while `strikeVsBasis` and
`ifAssignedPerSh` were null. Because STRIKE_UNDER_BASIS can only fire with a known basis, a call struck
*below* an unknown cost could read as a win. It was live-reachable: `options-build` sets `costBasis` to
null whenever the stock leg is missing from its cost lookup. The v165 regression test had pinned the
wrong tier (it asserted ASSIGNMENT_WIN and only checked the wording).
`guardrail` now separates **eligibility** (≤7 DTE and ITM) from the **win** claim. ASSIGNMENT_WIN requires
a known basis with strike ≥ basis AND `covered === true`; premium is not required (collected premium only
adds). Otherwise the new neutral tier **ASSIGNMENT_LIKELY** (blue 📌) says the call is likely to be assigned,
names what is missing (cost basis unknown, coverage unknown, or no shares covering a naked call), and makes no gain claim. New flag
**NO_BASIS**, shown in the card as "cost basis unknown". Tier order unchanged otherwise:
STRIKE_UNDER_BASIS > EXTENDED_STOCK > ASSIGNMENT_WIN / ASSIGNMENT_LIKELY > LET_IT_RIDE > ROLL_WINDOW > HOLD.
Five tests added, the v165 test corrected to assert the tier. App/cache **v167 / pf-v167**.

## 2026-10-20 — A sub-floor withdrawal read as a loss and tripped the drawdown breaker

The owner withdrew **$375** from ••••3900 on 2026-10-09 (cash 379.24 → 4.24, every position unchanged —
committed snapshots `e36618a` → `6c9dde0`). `appendEquityPoint` holds every inferred transfer to
`flowThreshold` (8% of equity, ~$587 here), so the cash-based inference's exact −$375 was zeroed and the
deposit-immune return read a **−4.2% day while SPY rose**. That one phantom loss was the entire −5.4pp
relative drawdown: the breaker went SOFT and held $1,119 of deposited cash out of the market. Corrected,
the book is −1.7% vs SPY −1.3% (−0.4pp) — breaker open. **The 8% floor exists for price noise in the
legacy quote-priced formula; the cash path has no price term.** `cashFlowThreshold` now uses the $40
floor when cash is exact — no option exposure, no derivatives sleeve and no margin loan on either side —
and the scaled floor otherwise, so the self-directed margin book is unchanged. `cumflow-repair.mjs`
re-books the missed −$375 once (keyed on the exact bad anchor, self-disabling; delete it and its
build-data call after it has published). Pinned in `equityseries.test.mjs` / `cumflow-repair.test.mjs`.
**Open, not fixed here:** on the self-directed book, selling calls lands premium in cash with no stock
trade, and `inferCashFlow` does not net it — a large credit can read as a deposit. Producer-only; no
app/cache bump. `build-data.test.mjs` still fails 3 checks identically on clean `main` (pre-existing),
and its cleanup deletes live `raw/` inputs — don't run it between a fetch and `run.mjs`.

## 2026-10-19 — The snapshot label comes from the clock, not the caller

`generatedAtLabel`, the in-app freshness text and the `data: snapshot …` commit subject all used the
string the scheduled agent typed as `run.mjs`'s first argument, while `generatedAt` came from the real
clock. On four early-morning runs that string was ~4h AHEAD of the commit — `a47a832` (Oct 14, committed
6:39 AM ET, labelled 10:45 AM ET), `f1422bd` (Oct 15), `203f9d8` (Oct 16), `c50b8d4` (Oct 19) — i.e. the
UTC wall-clock written with an "ET" suffix (inference from the pattern; the agent's prompt text was not
inspected). Of 81 snapshot commits Oct 12–19, those four were the only ones off by more than 10 minutes.
`producer/snapshot-label.mjs` now derives the label from the same instant as `generatedAt`, formatted
explicitly in America/New_York (`"Oct 19 2026, 6:40 AM ET"`, the shape the prompts always produced). A
supplied argument is still ACCEPTED, so no Routine prompt needs to change, but it is only parsed, compared
and logged — `[run] ⚠️ supplied label … is +245 min from the clock` when it drifts more than
`LABEL_MISMATCH_MIN` (15). The routine 4–5 minute "rounded to :45" labels are now simply the exact minute.
Published history is not rewritten. Pinned by `snapshot-label.test.mjs` (all four real commits as
regressions, both DST sides, ET-vs-UTC date rollover, host-TZ independence); `run.test.mjs`'s sandbox copy
list gained the new module. Producer-only; no app/cache bump.

## 2026-10-19 — build-data.test.mjs: fixture dates were a time bomb (fixed, test-only)

CI's "Producer tests" workflow went red on every push to `main` touching `producer/**` (four failure
emails on 2026-10-19), with `Cannot read properties of undefined (reading 'kind')`. Nothing in the
product: `build-data.test.mjs` hard-coded its self-directed orders on **2026-06-11/12**, and
`maindecisions.mjs` only derives days inside `FETCH_DAYS` (120), so the fixture aged out of the window
on 2026-10-10 and `sdBy['2026-06-12']` became undefined. Behind that crash a second one was waiting:
the congressional-ledger fixture (`2026-06-20/25/28`) had likewise aged past polflow's 120-day
retention. Both are now anchored to the run date (`D1`/`D2` = 41/40 days back, `barsAround` puts SPY's
602 close on D2, pol events at 30/25/22 days back), the way `pageOrder` already was. The v164 entry's
"pre-existing, not touched here" refers to this. **Any fixture that must sit INSIDE a retention or
fetch window needs a relative date** — a fixed one is a test that fails on a schedule nobody set.

## 2026-10-19 — Options history reads a two-leg roll as a close plus an open

The owner's phone listed the PLTR $195 call under **"Past contracts awaiting settlement records ·
Settlement record missing"** three days after he had bought it back in the Oct 12 roll. `option-history.mjs`
accepted single-leg orders only, so the two-leg roll order went to `unresolved`, its contracts were
`blocked`, and the retired lot read as an unexplained expiry. The normalizer now keeps each leg's fill
price (`legs[].price`, from `executions[0].price`, carried in the retained ledger so it survives the
rolling fetch window), and a filled two-leg order with one buy-to-close and one sell-to-open of the same
option type expands into `<id>:close` and `<id>:open` entries, each with its OWN cash
(`price × 100 × qty` — `processed_premium` on a roll is the NET and must not be used per leg). The close
leg matches the old lot FIFO like any close (`status: 'Closed by roll'`); the open leg starts the new lot.
Spreads, two opens, and partial fills still require broker reconciliation. Pinned by a verbatim-shape
PLTR test in `option-history.test.mjs`. Producer-only; no app/cache bump.

## v166 — Roll Scorecard settles against fresh bars; stacked rows on the phone (2026-10-19)

The owner's phone showed the PLTR roll **"pending · 2026-10-16"** three days after that expiry: `options-build`
handed `settleRolls` the PRIOR snapshot's series only, and the old leg's expiry close first arrives in THIS
run's fresh tail. It now settles and grades against `histForExt` (snapshot + raw, deduped by date in
`stockExtension`). Consumer: the six-column roll table wrapped its ROLL cell to nine lines at 390px; it is
now one stacked row per roll (symbol · date · grade pill / old → new leg / net + DTE / vs-do-nothing with
"est." / a collapsed "why"). Rendered and checked at 390px. App/cache **v166 / pf-v166**.

## v165 — Guardrail verify: unknown is never green (2026-10-19)

ChatGPT's independent review of v164 (Portfolio Dashboard handoff, 16:08 ET) reproduced three real
defects, all of the same shape — a confident output from incomplete input. Each is fixed and pinned.
**(1) Missing data graded GREEN.** `gradeRoll({closeMark:1, openCredit:2})` returned green with the
extrinsic gate silently skipped, and a late-ITM call with no live mark said "little extrinsic — a roll is
a debit for nothing". Now: `gradeRoll` returns **`unknown`** (never green) whenever any gate cannot be
checked — no intrinsic, no DTE, or no/stale price history — with one warning per unchecked gate; a real
breach still reads red. `guardrail` returns a new **`INSUFFICIENT_DATA`** tier when the stock price,
strike or DTE is absent (it used to fall through to a confident HOLD), flags **`NO_MARK`** when the mark
is missing, and the ASSIGNMENT_WIN text then says the extrinsic is UNKNOWN rather than small.
**(2) Duplicate bars changed the signal — and it was LIVE-REACHABLE.** `options-build` concatenates the
prior snapshot's series with the run's fresh 7-bar tail, which overlaps it by design (`hist-plan.mjs`),
and `stockExtension` only sorted. Four closes 100/103/106/109 read +9.0% once and **+2.8%** with each bar
twice — so on every FETCH_ALL the "don't roll up into an extended stock" gate would have under-fired on
exactly the PLTR setup. `stockExtension` now dedupes by session date, **last occurrence wins**, and
`options-build` orders snapshot-then-raw so the fresher bar takes precedence (comment at the call site).
**(3) The scorecard's "vs do-nothing" is an ESTIMATE.** The replacement leg is marked at intrinsic on the
old expiry, omitting its remaining time value — a liability the roller still holds, so the proxy flatters
the roll. `settle.basis='intrinsic-proxy'` / `estimated:true`, `rollSummary.estimated`, and the card says
"est." everywhere it shows the figure and that it is not the basis for threshold tuning. Six regression
tests added (31 total). App/cache **v165 / pf-v165**. Self-audited; the finder was ChatGPT, which is the
Plan→Build→Verify split working through the Claudex handoff rather than inside one session.

## v164 — Options Guardrail and roll scorecard (2026-10-19)

The 2026-10-12 PLTR roll is the regression this release pins: a $0.50 NET-DEBIT roll of a deep-ITM
$195 covered call (~10% extrinsic left) four days before expiry, up-and-out to Nov 20 $210, into a
stock up ~9% in three sessions. PLTR closed $186.03 on Oct 16; the original call would have expired
worthless and kept the $397. `options-build.mjs`'s old `rollAlert` told the owner, for EVERY
in-the-money short call, "assignment risk — roll up/out" — the advice that produced the loss.

`producer/option-guardrail.mjs` (pure, 25 tests) replaces it. Per short call it computes intrinsic /
extrinsic ($ and % of mark), moneyness, strike-vs-basis, if-assigned P&L per share and total, premium
captured %, stock extension (3-session return and distance over the 20-day SMA from the same bars the
vol proxy reads, stale-gated at 10 days) and earnings-inside-expiry (optional `raw/earnings.json`),
and assigns ONE tier: STRIKE_UNDER_BASIS (red — assignment realizes a loss; decide it consciously) >
EXTENDED_STOCK (red — do not roll up) > ASSIGNMENT_WIN (≤7 DTE, ITM: let it be assigned; v167: only
with a known basis ≥ strike-cost and covered shares, else neutral ASSIGNMENT_LIKELY) >
LET_IT_RIDE (≤7 DTE, OTM) > ROLL_WINDOW (14–21 DTE with ≥50% captured or within 3% of the strike;
credit-only wording) > HOLD. Three gates grade any roll (`gradeRoll`): net credit, ≥15% extrinsic in
the closed leg, not inside the final week, and not rolling UP into an extended stock — GREEN only when
all pass; the Oct 12 roll grades red on every one. `detectRolls` reads any filled order with a
buy-to-close and a sell-to-open leg on one chain; `settleRolls` accumulates them in the snapshot
(`data.options.rolls`, `rollSummary`) and settles each against the do-nothing path at the OLD leg's
expiration close — entry #1 is the PLTR roll, settled at −$0.50/sh vs letting it expire. The CLI
(`--positions/--quotes/--equity/--prices/--orders`, or `--grade '{…}'`) exists so the Jarvis investing
agent, which cannot decrypt data.json, runs the SAME code over raw Robinhood reads.

Consumer: each short-call card carries a tier-colored guardrail note with the figures; a 📒 Roll
Scorecard card sits under Options Income & History. `rollAlert` is kept as the field name (now the
guardrail's text) so an older cached consumer still reads something true. Thresholds (15% extrinsic,
8% three-day, 12% over SMA, 14–21 DTE, 50% captured) are starting points from the owner's cited roll
guides, meant to be tuned by the scorecard. Covered calls only; short puts and long legs get no tier
yet. No Routine prompt change needed: the producer prompt defers to PRODUCER.md and the fields derive
from inputs already fetched every run. App/cache **v164 / pf-v164**. Verification: 48 producer
suites green except `build-data.test.mjs`, which fails identically on clean origin/main (pre-existing,
"Cannot read properties of undefined (reading 'kind')" in the paged-orders block — not touched here);
every inline script parses. Self-audited; no live snapshot decrypted.

## 2026-10-08 — Small refresh inputs without erasing history

The refresh now has an explicit `main-orders-incremental.json` request envelope and
`main-order-plan.mjs` (14-day overlap, expands after a recorded outage). This path NEVER
sweeps older days; guards existing-day share aggregates against omitted old GTC fills.
Full-history input and cursor-page safeguards remain unchanged. Incremental success means
recent input ingested, not full historical reconciliation. Ambiguous corrections stay partial.

Oversized saved scan results can use `picks-local.mjs`: small broker batches and local Wilder
RSI on a disclosed 68-name universe, complete/fresh inputs required. Existing ranking weights
are unchanged; this fallback has narrower coverage than the saved market-wide scanner.
`holdings-fund-N.json` files now merge so the second top-14 batch is not dropped.
`refresh-check.mjs` names missing research inputs; the builder saves encrypted refreshInputs.
Live single-leg premium fetches are required attempts rather than an optional shortcut.
Broker outputs remain verbatim, protected spill-file access remains forbidden.

No brokerage orders, account mandates, schedules, encryption settings or host permissions
changed. Local regression coverage includes real builder ingestion, old-day preservation,
partial same-day protection, duplicate orders, empty responses and fallback screen readiness.
Live Claude connector execution must still be verified by the scheduled host.

## 2026-10-07 — Refresh publication and paginated order safety

`run.mjs` now gates publication on validation, a required encryption key, and authenticated
prior/output envelopes. `snapshot-publish.mjs` builds a data-only commit with a detached Git
worktree: no force checkout/reset, no staging unrelated files, no blind retry after rejection.
It preserves concurrent code changes and rejects builds whose source snapshot was superseded.
The publisher verifies the resulting remote commit. Permission denials remain terminal.

`order-pages.mjs` accepts cursor-linked `main-orders-page-NNN.json` files retaining the full
120-day request. It rejects gaps, shortened windows and conflicting broker IDs, and preserves
an unfinished cursor so older history survives. Missing/invalid inputs carry the log forward,
emit REFRESH_PARTIAL, and record encrypted `main.orderHistoryRefresh` metadata. That metadata
is logged now; no new consumer UI is claimed. Live connector page-size/cursor availability and
Claude host approvals cannot be tested in this environment. No host permissions were changed.
Old statements below that Node wrappers guarantee prompt-free operation are superseded.
Fable is unavailable; this repair is self-audited with synthetic local Git remotes and fixtures.

## 2026-10-07 — Keep research construction inside the combined index cap

Evidence-v1 finalization now passes the same 10% combined index limit into `riskAdjustWeights`
that it records for validation. All index vehicles share one budget during cluster trimming,
redistribution and rounding. The proposal plus retained phase-out holdings is scaled to 100%
before concentration is measured. Unallocatable weight rejects the candidate instead of being
parked above the index limit, preserving the last valid target. Legacy callers without an index
limit retain their policy. New targets use risk version `hard-caps-v3`; existing targets and
decision history retain their recorded versions. Research dates, schedules and execution rules
are unchanged. The 2026-10-07 research refresh (`2edb506`, 13 names) already replaced the September 24 target and carries `hard-caps-v3`; the next fortnightly research is due the Sunday 2026-10-25 fire.

`agentic-index-cap.test.mjs` covers single/multiple index vehicles, initial excess, fractional
rounding, a zero limit, infeasible allocations, phase-out retention and the scheduled CLI's
successful write / failed-retry preservation. Fixtures are synthetic and fixed in the test.
Validation: all 43 producer suites and the dashboard model tests pass, including all 12 new
index-cap scenarios. Producer-only change; no app/cache bump or broker action.

# v163 — Broader Predict coverage (2026-10-06)

Expanded public collection from seven to 29 catalog-verified series across nine categories,
including elections, climate, commodities, crypto, financials, culture and technology. Category
round-robin and a firm two-per-topic cap prevent inflation from filling the featured list. CPI
and core CPI share one topic. Category filters follow actual published coverage. Elections
retain up to three years of open contracts; other new categories use one year. Robinhood public
link discovery now samples all observed page categories, up to 36 exact-symbol event pages.
App/cache v163. Existing research observations and private data are preserved. Portfolio and
Agentic Routines are unchanged; only the public prediction collector changes. Self-audited
because Fable is unavailable. Validation recorded in UI-PRESERVATION.md.

# CLAUDE.md — Portfolio Dashboard

## v162 — Predictions research, watchlist and results (2026-10-06)

Predict is a top-level section (also a sixth Classic tab), with Positions / Ideas / Watchlist /
Results. `ui/predictions-model.js` owns public-market math; `ui/predictions.js` renders the page.
The existing account picker is hidden on Predict because its event-contract account is a separate
source. App/cache and shell assets are **v162 / pf-v162**.

Public `data/predictions.json` contains only Kalshi markets, hourly charts, optional exact-symbol
Robinhood links, and an append-only research record. `producer/predictions-fetch.mjs` collects
NFL, college football, MLB, MMA, Fed and CPI series. `.github/workflows/predictions.yml` is a new
independent 15-minute schedule including evenings/weekends, also run once on collector code changes.
Production reads the public raw GitHub file, with same-origin/offline fallback: bot commits alone
cannot trigger a Pages rebuild. Keep original per-source timestamps across failures. The collector
retries HTTP 429/transient server errors with bounded backoff and respects Retry-After. The first
production run exposed two rate-limited charts (quotes were fresh); this retry path is fixture-tested.
The existing eight-surface privacy audit also passed with zero readable account figures.

Ideas are liquidity/activity research candidates, **not directional forecasts or measured edges**.
Results track a hypothetical Yes contract at each original asking price, before fees; they are not
account returns. Missing/closed markets stay pending until explicit exchange settlement. Watchlists
and chosen Yes/No target prices live on the device with export/import; stale prices pause checks.

Authenticated Predict access remains pending. `producer/prediction-account.mjs` validates an optional
`raw/prediction-account.json` into encrypted `data.predictions`. This is an adapter, not an active
broker connection. Absent input preserves the original capture time. Blank-symbol derivative rows
in `realized.predictionMarket` are legacy/unverified: older documentation calling them verified
prediction contracts is superseded. The Income & Tax label now reflects this; existing derivative
cash-flow calculations stay intact. Never infer named positions, event-only coverage, or net P&L.

Routine impact: no change to the portfolio-refresh, Agentic-research or Agentic-executor prompts,
schedules or mandates. The stock producer gains only the optional strictly validated account input.
The new public collector is simulated with pagination, historic settlement, chart failures and total
outage fixtures, plus successful live GET collection (671 markets, eight candidates, 28 link matches).

Validation: all 42 producer test files, dashboard model/cache tests, Predict browser checks and the
existing Daily Brief browser suite pass. Browser checks use synthetic account data and a Chart.js
stub; public prediction prices come from the actual timestamped snapshot. New Predict privacy
masking, mobile/desktop, Classic reload, themes, imports/exports, staleness, failure and production
feed fallback were tested. Self-audited; a Fable verifier is unavailable in this environment.
Full scope, future authenticated schema and remaining limits: `producer/PREDICTIONS.md`.


## v161 — One combined Daily Brief (2026-10-02)

Today always summarizes **Self-directed + Agentic** together; the global account selector is
hidden only on Today. Other pages keep their existing account selection. Account/plan/options
links from Today carry an explicit account destination, while returning to Today always restores
the combined view. `ui/experience-model.js` owns the pure `dailyBrief` model; no broker calls or
producer/trading changes are involved.

The brief adds combined recorded equity, per-account values and stock contributions, separately
summed positive cash and margin debt, shared-ticker dollar movers and breadth, SPY/QQQ/IWM plus
VIX context, a 30-day earnings/option-expiration calendar, broker-reported self-directed options
realized P&L with reconciliation status and open exposure, agentic target/ticket/drawdown state,
combined concentration, and a combined value-history chart. Radar items identify incomplete or
older captures, quote gaps, recorded valuation residuals, near-term events, overdue option records,
active agentic guards/tickets, and unreconciled option history. Detail rows collapse for longer
lists; source/calculation notes are expandable.

Correctness: use `data.main.equity` (the recorded basis) rather than potentially sleeve-inclusive
`stats.totalVal` when available; label brokerage scope only when `equityBasis` confirms it.
A missing account never becomes a partial total labeled combined. Cash in one account never nets
against another's loan. Shared tickers combine once; missing quote legs remain explicit. Stock
moves are contributions on current quantities, not full account return. History joins only matching
valid recorded dates, keeps the latest duplicate, and includes external cash flows. Event day
countdowns use America/New_York and actual expiration dates, never stale persisted `dte`.
The brief updates its date/age on foreground and every minute without closing expanded details.
Options income uses only `realized.accounts.main.options` from the broker source, never gross
premiums or another account's subtotal. Missing P&L and settlement evidence stay unknown.

App/cache and all shell URLs: **v161 / pf-v161**. Routines touched: **none** (Portfolio dashboard
refresh, Agentic research, and Agentic executor retain their existing inputs, schedules and mandates).
Docs: this file and `UI-PRESERVATION.md`. `producer/privacy-audit.mjs` now includes Today and accepts
`PF_AUDIT_DATA` pointing to a synthetic fixture within the repo without replacing encrypted data.

Verification: all **40 producer suites**, `tests/experience.test.cjs`, and new
`tests/daily-brief.test.cjs` passed. `tests/brief-browser.mjs` passed account navigation, both plans,
options routing, 320/390/768/1440px layouts, missing-account state, detail persistence, privacy and
Midnight checks; screenshots inspected. Expanded eight-surface privacy audit: zero readable account
figures, clean toggle restoration. Browser checks used synthetic data and a Chart.js stub; the brief's
own SVG/CSS visuals rendered normally. Live decrypted balances were not available. Self-audited;
the specified independent Fable reviewer is unavailable in this environment.

## 2026-10-01 — Preserve the Rebalance Log on empty equity-order responses

`deriveLog()` now disables sweeping whenever no usable decision day establishes coverage,
including empty, malformed, filtered-only and out-of-window payloads. Any in-window saved
broker decisions trigger a warning to re-fetch the full 120-day window. This protects even
one saved day; the nonempty short-payload/correction rules and normal retention remain intact.
Regression tests reproduce the empty narrow-fetch loss, preserve a 39-record fixture across
supported envelopes, and replay an empty refresh through `build-data.mjs`. Full producer
suite passed. Producer-only patch; live encrypted snapshot and broker accounts untouched.


## 2026-09-30 — Keep older open options visible on incremental refreshes

`options-build.mjs` resolves live position contract IDs against both retained encrypted
`incomeHistory.orders` and the current order batch. Only fresh broker positions determine
which contracts remain open and their quantity; saved orders cannot resurrect closed positions.
Position direction uses the broker's long/short type, with opening-side (or inverse closing-side)
metadata as fallback. Unknown contract metadata fails the options build explicitly instead of
silently dropping a position; recover with a full order fetch. The existing producer Routine
picks up this change through `run.mjs`; no prompt or fetch-window change is needed.
Integration coverage replays encrypted incremental runs with old PLTR/new IREN fixtures, live
quotes, partial closes, collateral, direction and missing metadata. Live broker refresh remains
unverified here; no connected Robinhood tool or dashboard decryption key is available.
Self-audited because the specified Fable reviewer is unavailable.


## 2026-09-30 — Keep confirmed option expirations out of the stock-loss guard

`lossesFromTrades` excludes a zero-price/blank-side loss only when it exactly matches a
contract-reconciled, confirmed P&L expiration in the same account's options history.
Main-account evidence is loaded from the fresh options build (or retained snapshot) and is
never applied to agentic-account rows. Ambiguous losses, real stock sales, blank-side cash-in-lieu
losses, and the existing daily loss floor remain guarded. Option losses remain in options P&L;
this does not determine option wash-sale treatment or add an option tax engine. Producer-only,
no UI/cache change, broker calls, trades, schedule changes, or snapshot decryption required.
Regression coverage: long expiry, same-day stock loss, missing/conflicting evidence, account
isolation, daily floor, and incremental history retention (`option-wash.test.mjs`).

## 2026-09-30 — Options history: broker-evidenced expirations, one-time backfill, incremental fetch

The Robinhood connector has **no option-event/settlement endpoint**, so the v160 events path only ever
worked on Railway. The settlement evidence the connector DOES expose is `get_pnl_trade_history`: an expiry
is a row with the ticker, an **empty `side`, `price` "0"**, a 20:00Z timestamp on the expiration date and
`realized_gain` = the opening premium. `option-history.mjs` reads those rows from the self-directed
`main-trades.json` the producer already fetches EVERY-RUN (**no new call**) and accepts one only when it
reconciles exactly — one retained contract of that underlying expiring that ET day, identical open
quantity, realized equal to the retained opening cash to the cent, and no same-day equity trade at the
strike (assignment evidence) — then stores it as a confirmed zero-cash expiration so it outlives the
3-month window. **Traps pinned by tests:** equity rows can ALSO have a blank side (a 2026-02-19 MSFT
cash-in-lieu row at a real price), and event-contract settlements have a blank SYMBOL; both are excluded.
`option-fetch-plan.mjs` prints `OPTION_ORDERS FULL` until the snapshot records `incomeHistory.fullHistoryAt`
(written only when `options-orders.json` carries `fullHistory:true` after every page was merged), then
`OPTION_ORDERS SINCE <date>` — a 14-day `created_at_gte` window widened to any still-working retained
order, since filled/cancelled orders are final. Backfill against the live account (2026-09-30): the broker
has **7 filled option orders in total** (one page); the three expired short calls (IREN $70C and CIFR
$30C 2026-07-17, IREN $50C×3 2026-09-11) reconcile to **$1,426**, exactly Robinhood's options-realized
YTD. The producer Routine is `http_api`, so its prompt was NOT edited; it already defers to PRODUCER.md
§3c, and SCHEDULING.md §5 has the paste-ready text. The long-option expiration stock-loss
classification gap noted in this release is addressed by the follow-up entry above.

## v160 — Settlement-aware history and explicit year reconciliation

History now separates current-year matched results from other years (the 2024 AMC loss no longer sits in the 2026 subtotal). A prominent reconciliation status compares broker YTD with same-year matched results. Gross premiums are labeled not profit. Expired contracts with missing outcomes are visible with known opening cash and unknown profit. The producer retains broker events and recognizes confirmed zero-cash/no-equity expirations, handles partial-close basis allocation, and leaves assignment/exercise P&L uncalculated. Railway fetches all event pages; the active connector producer requirements are updated in PRODUCER.md. No brokerage data was available for backfill in this session; Railway reports no latest deployment, so live completeness is NOT verified. App/cache v160. New tests cover settlements, assignment exclusion, idempotency, year isolation, and event pagination; full suite run before publishing. Self-audited; Fable unavailable. Mobile screenshot verification is blocked by the missing Chromium runtime.


## v159 — Compact options history and Railway source repair

Replaces the three sparse tiles with one broker-realized headline and supporting metrics only when present. High-contrast missing-history status accurately explains that browser Refresh reloads published data; it does not run the producer. Calculation details collapse below populated trades. Railway option normalization now preserves order IDs and leg position effects and enriches filled historical contracts with strike/type/expiry, enabling v158 matching. The connected Railway service had no latest deployment; a fresh broker snapshot remains unverified, and no completeness promise is made. Existing broker figures and encrypted data are unchanged. App/cache v159. Full sequential producer suite, display tests, zero/missing rendering checks, inline syntax, and mocked Railway-to-ledger integration passed. Self-audited; browser layout remains unverified because Chromium is unavailable.


## v158 — Options income and contract history

Options Income & History now sits below exposure and above open positions. Shows self-directed broker-reported YTD options realized P&L, recorded sell-to-open premiums (includes open trades), monthly matched results, and exact-contract closing rows. `producer/option-history.mjs` retains normalized source orders in the encrypted snapshot, deduplicates by order ID, and FIFO-matches filled single-leg contracts with partial-close allocation. Removed unsafe underlying-chain netting and its realized fallback. Before-fee ledger results are deliberately separate from broker totals. Expirations/assignments, multi-leg/partial fills, and missing basis are explicit coverage gaps, never inferred zero-cost closes. Existing refresh fetches are unchanged; the next successful producer refresh is needed for the new ledger. No brokerage access or snapshot decryption was available during this implementation, so historical completeness is unverified. Live backfill/settlement reconciliation remains outstanding. App/cache v158. Verification: full sequential producer suite, display-model tests, inline script syntax, and isolated history rendering checks passed. Self-audited; the specified Fable reviewer was unavailable. Browser visual verification was blocked by the missing Chromium runtime.


## 2026-09-24 — research cost: 22 agents → 7, and a fortnightly cadence

The weekly research was measured, not estimated: **per-agent fixed context on this harness is ~177k
tokens** — a one-word, zero-tool subagent costs that before it reasons — so the dominant expense of
`agentic-research` is the NUMBER of agents, not which model each runs. Three changes, no change to what
the pipeline decides:

- **momentum is CODE now** (`producer/momentum.mjs`, passed in as `args.momentum`, the `args.flow`
  pattern). It was the sleeve doing the heaviest fetching and none of it was needed — since v141
  `hist-plan.mjs` keeps the ~230-name bench fresh in `data.hist.day`, so the producer already HELD the
  bars the agent was re-fetching. Rubric and staleness gate mirror `index.html`'s `sdMomentum`.
- **quality/growth/catalyst were merged into ONE agent and REVERTED the same day.** The cost reasoning
  was right and the behaviour was not: asked for three factors across 61 names — 183 scored fields with
  evidence in a single pass — the agent made **zero** ToolSearch calls and **zero** MCP calls and
  returned all 61 rows as `status:"missing"`, taking the "a missing factor is NOT a neutral 5" escape
  hatch wholesale instead of fetching anything, then exited cleanly. Verify had no finalists and the run
  died on "No verified survivors" having produced nothing. The single-factor agents, same model and same
  tools on the same universe, made 3 ToolSearch and 14 data calls and returned real scores with
  citations. **An agent’s willingness to do the work scales with how large the ask LOOKS, and an
  explicit abstention path turns "too big" into a clean-looking EMPTY RESULT rather than an error** —
  this repo’s silent-guard failure mode wearing a new hat, since every step reported success. If it is
  retried, cut the UNIVERSE per agent (e.g. two agents of ~30 names each scoring all three factors)
  rather than widening what one agent must produce, and assert a minimum observed rate so an all-miss
  fails loudly instead of quietly.
- **verify is BATCHED**: it was one agent per finalist and measured the largest phase (~2.7× the whole
  sleeve phase). Finalists are dealt ROUND-ROBIN into `VERIFY_BATCH_COUNT` (3) agents — round-robin, not
  consecutive slicing, so no agent gets the whole top of the ranked list and anchors across names.
  `FINALIST_CAP` 16 → 10, `CHALLENGER_SLOTS` 5 → 3 (the quota shrank WITH the cut, it was not dropped).

**Cadence is now FORTNIGHTLY** (`agentic-due.mjs`), because the churn governor already runs on a 14-day
clock (`MIN_HOLD_DAYS`/`REENTRY_COOLDOWN_DAYS` 14) — a target refreshed every 7 days spent half its life
proposing trades the governor would refuse. **The cron is UNCHANGED** (live: `12 23 * * 0`): the gate prints
NOT_DUE on the off weeks, which costs one cheap gate run and needs no Routine edit.

**Routine prompt APPLIED the same day** (`update_trigger` on `trig_0114s3r8yBA7rQXLsBY7MG1y`): step 3b runs
`node producer/momentum.mjs --symbols <universe> --out producer/raw/momentum.json` (a CLI added for it —
the first draft had the agent hand-edit an inline `node -e` with a `/*the universe tickers*/` placeholder)
and passes the file as `args.momentum`. If it fails the workflow logs the fallback to the momentum AGENT and
runs as before. **The live cron is `12 23 * * 0` (Sunday 23:12 UTC), not the `12 11 * * 1` older notes
below quote** — it was moved 2026-09-15. A Sunday fire is the LAST day of its Monday-anchored fortnight, so
the first run after a lapse can land one week after the previous one (the new fortnight starts the next
day); from then on it settles to every other Sunday. Harmless — it errs toward running.

Verification: full `producer/*.test.mjs` suite (34 suites green), including a new `momentum.test.mjs`
that pins the stale-series abstention, and `agentic-correctness.test.mjs`'s end-to-end workflow
simulation driven through the new batched-verdict contract.

## v157 — Ivory Ledger and source-backed visual summaries

Today and Activity use the approved Ivory Ledger palette (warm ivory, ink, emerald) with responsive icon navigation, a prominent Action Center, and retained Midnight toggle. A one-time v157 preference migration opens the approved Ivory theme; later theme choices persist. Today adds a dated account-value line from the selected account’s `equityHistory` (last 30 valid unique observations; includes flows, never labeled return), priced-long allocation segments, and quote breadth (up/down/flat/missing). Activity adds a published-record timeline and recorded Agentic ticket timeline, with elapsed snapshot age and unavailable live telemetry explicitly distinguished. Empty/partial records stay explicit. Chart geometry is hidden in privacy mode; numeric labels use the existing scanner. No producer, Routine, account mandate, trade, data schema, or original destination changes. App/cache v157. Verification: model edge cases, full sequential producer suite, and DOM interaction checks. Browser layout verification was blocked by the preview environment; self-audited because the specified Fable reviewer is unavailable.

## v156 — Entry quality vs trend strength (self-directed plan)

The aggressive plan still **ranks** leadership with `sdMomentum` (6m/3m RS vs SPY, 50/100-DMA, proximity to the trailing high). It no longer **buys** the high with borrowed buying power just because that score is 10.0.

New money only (nothing here sells a winner for being large — the 2026-08-25 lesson stands):

- **Entry gate** — within 3% of the 20-day high cannot be bought unless momentum ≥ 9, and then at half size. Failed entries with an intact 50-DMA become the **asymmetric pullback book** (GTD 30–90d limits, no leverage), not an empty leftover sleeve.
- **Floors** — core 7.0 / satellite 7.5. A 5-handle miner (NBIS 5.6, CLSK 5.2) does not print as a buy.
- **Caps on new money** — 20% of **equity** per name (the 60%-of-line clamp is a backstop), 30% of the ending book per theme (crypto-beta, ai-infra, cyber, megacap-software). A full cluster skips the next name.
- **Stops** — ATR × 1.75/2.25, capped at 12% core / 20% high-beta. If the cap is tighter than the vol budget, size is cut rather than the stop widened. HV > 80% halves size again; a book already >1.3× multiplies by 0.65.
- **Heat / borrow** — no incremental cruise-band borrow or press-room add when the median proposed fill is <5% off the 20-day high, when more than half the fills are <3% off, or when average HV > 40% on a >1.3× book. Press room, when open, funds pullbacks — not a second share of the same extended mega-cap.
- **Targets** — min(app 3R, 12-month consensus, 1.5× measured move). App > 1.4× street is speculative (size ×0.5). Reward/risk after the tighter target must be ≥ 2:1.
- **Trim advisory** — 25% of equity or +25% from cost peels back to the 20% target weight. Still not a forced sell.
- **Do not chase** — reprice at order time; if last > limit + 0.5×ATR, cancel.

Helpers live in `ui/sd-rules.js` (pure, unit-tested by `producer/sd-rules.test.mjs`) so the consumer cannot drift from the tests. App/cache v156.

## v155 — Activity copy
## v155 — Activity copy

Activity no longer says "Not connected" for feeds this PWA cannot see. Research rows humanize `not-recorded` and idle tickets as "None in flight". Telemetry is labeled "Not in this app" and the last published snapshot is the proof a producer run finished. No invented routine/broker/push health. App/cache v155.

## v154 — Today brief visuals

The Today tab keeps the v150 card language and snapshot math. Numbered 01/02/03/04 labels are gone. Quoted-move bars now diverge from a center spine, the concentration ring is sized, negative cash is labeled Margin, and Next is an Action Center button to the existing Plan. No producer, mandate, or snapshot-schema change. App/cache v154.

## v153 — Portfolio analysis navigation

Technicals, Fundamentals, and Flow & Positioning are now grouped in the **Portfolio** sub-navigation, alongside the Portfolio cards they open. Their destinations, account behavior, card rendering, snapshot contracts, and research surfaces are unchanged. App/cache v153.

## v152 — Signal Ledger visual system

The consumer now uses Signal Ledger as its default: warm off-white surfaces, deep ink, restrained green for verified/positive states, quieter cards, and a consistent desktop/mobile shell. The retained theme toggle now switches between Signal Ledger and a clean Midnight view; legacy gold preferences resolve to Midnight without reviving gold gradients, glow, HUD brackets, or color-coded decorative cards. The existing Today / Portfolio / Research / Activity structure, detailed original views, privacy, charts, account controls, data contracts, producer routines, allocations, and investment mandate are unchanged. App/cache v152.

## v150 — navigation, daily brief, and decision explorer (2026-09-16)

The consumer now loads `ui/experience.css`, `ui/experience-model.js`, and `ui/experience.js`
after the original dashboard. Today / Portfolio / Research / Activity organize the existing
five pages; all original cards, chart renderers, account controls, Find, My view/pins, Help,
privacy masking, and analysis links remain. The Gold and Light palettes and original chart
colors are unchanged. **Classic view** restores the original navigation; missing shell scripts
leave the original dashboard usable. `UI-PRESERVATION.md` maps the retained functionality.

Today summarizes the published account and quoted-holding day contributions, with coverage
labels; it does not invent a daily narrative or equate stock contributions to full account P&L.
Activity distinguishes published records from unavailable live routine/broker/delivery telemetry.
Decision evidence displays the existing agentic target and its recorded evidence, with explicit
missing-source states. What if uses a selected priced position and equity in the snapshot;
its adjustable shock, cash shift, and user-assumed transaction costs do not write targets or orders.
These views use the existing app-wide privacy scanner. No producer, mandate, trade, schedule,
or snapshot schema changes are required; no Routine is touched. App/cache: **v150 / pf-v150**.

Verification: `node tests/experience.test.cjs` plus the existing sequential producer suite.
`node tests/preview.mjs` serves isolated synthetic sample data, never the committed encrypted
snapshot. Verification is self-audited; an independent Fable reviewer is unavailable here.

> **v149 follow-up:** Account estimates now consume existing recorded equity history automatically
> (producer and browser share the same calculation), with matching-date coverage checks and explicit
> inferred-flow / valuation-time limitations. The panel shows the existing account record even before
> a v148+ producer refresh, then adds an estimate on each shadow vintage's dates. No estimate is called
> verified and no execution gap is derived from it. The optional verified comparison still requires
> feeds not available in this session; it is labeled "Not connected" rather than implying waiting fixes
> it. Tracking status distinguishes pre-upgrade snapshots, pending closes, invalid targets and stale
> bars. Historical evidence is labeled as historical, not a current mandate/configuration failure.
> App/cache: v149 / pf-v149. Production Claude Routine access remains unavailable here; its next
> successful publish is required for new forward observations. Browser reload only reloads published data.


Orientation for future Claude sessions. Read this first. Deep producer detail lives in
`producer/PRODUCER.md` (runbook) and `producer/SCHEDULING.md` (the scheduled job).

> ## 📌 Standing rule — keep this file current
> **Whenever you change the architecture, build pipeline, data model, scheduling, or add/remove a
> feature, update the relevant section of this file in the SAME change** (and bump the version note
> below if `index.html`/`sw.js` changed). Future sessions rely on this file being accurate — don't
> wait to be asked. If you touch the producer flow, also check `PRODUCER.md`/`SCHEDULING.md` stay in
> sync. A quick self-check before finishing: did anything here go stale (file paths, the composite
> weights, the version, the feature list)? Fix it now.

## v148 — correctness and forward observation (2026-09-16)

See `producer/CORRECTNESS.md` for the authoritative new contracts and verification limits.
Hard target admission/executor validation now rejects impossible allocations, including resumed tickets;
new plans bind to target content IDs. Research records evidence/source dates and coverage, with a
code-side source-enrichment stage for older Routine argument shapes. `finalize-target --write` requires
the whole evidence-v1 workflow output and leaves the previous canonical target intact on rejection.
Final construction prose is computed from final weights. Grading v2 separates buys, sold baskets and
rotations; missing benchmarks are unknown; historical mixed marks stay outside current stats.
Forward target vintages and display-only realized risk diagnostics live in the encrypted snapshot and
render on Plan. Strict actual/model/SPY total-return comparison is implemented but awaits verified
closing cash-flow and stable dividend-adjusted data feeds; it explicitly shows unavailable meanwhile.
Historical targets/decisions are not relabeled as the new model. Existing mandate weights and trading
safeguards remain in force. App/cache versions are **v148 / pf-v148**.

