# Interface preservation map · v162

The navigation layer leaves the five original pages and all their contents in place. Section
links scroll to original cards instead of copying or reimplementing their calculations.
Classic view is available from the header. The original feature search and saved My view remain.

| Existing destination | New entry point |
| --- | --- |
| Accounts, account switch, snapshot tiles | Portfolio → Accounts overview |
| All Positions, sorting, small positions | Portfolio → All positions; original overview |
| Account performance, SPY/QQQ, heatmap | Portfolio → Performance / Heatmap |
| Risk, diversification, allocations, drawdown | Portfolio → Risk & allocation; adjacent original cards |
| Income, dividends, tax-loss harvesting, realized P&L | Portfolio → Income & tax |
| Options positions, orders, Greeks, IV, ideas, payoff views, watchlists | Portfolio → Options (explicitly self-directed source) |
| Plan / Action Center | Research → Plan & Action Center (self-directed): the Apex card, the Action Center and two pointer cards (Rebalance Log, Screens) |
| Daily Picks, composite chart, filters, screen track record, catalysts, earnings | Research → **Screens** (v203, its own page, `#page-screens` / `#screens-app`) — same cards, ids and renderers, led by a reference-not-buys note. Income Ideas moved to the Options page (`[data-opt-pick-income]`); the momentum watchlist is cut (Apex's Monday scan ranks momentum). `window.SD_APEX_RUNS=false` renders the v201 page inline on Plan and turns Screens into a pointer |
| Agentic targets, bands, drift, parking, guardrails, diagnostics, forward observations | Research → Plan & Action Center (agentic) |
| Markets, sectors, macro, breadth, retail buzz | Research → Markets |
| Analyze, technical chart, scanner, fundamentals, live/estimated option context | Research → Analyze |
| Technical Signals / Fundamentals / Flow & Positioning | Portfolio shortcuts to original account cards |
| Rebalance logs, grading, methodology | Activity → Rebalance log for selected account |
| Find, Help, saved pins, collapse, privacy, refresh, Signal Ledger/Midnight theme toggle, PWA offline | Original controls and implementations retained |

## New views and their limits

- v229: Today uses `ui/today.js`, `today-model.js` and `today.css`; the original renderer
  is retained as a missing-asset fallback. Light / Dark / System replaces the old two-state
  toggle while keeping the `gold` CSS namespace and existing stored choices. Five-tab
  navigation, account scopes, privacy and v222 Duo rail behavior are retained.
- Trades and prices above Confirm come from the same Apex `bookLines` as the unchanged
  whole-book Claude prompt. No new execution path is added. `Waiting on you` distinguishes
  owner approval from `Out of your hands` recorded executor/broker states. The latter does
  not equate a submitted or complete ticket with confirmed broker fills.
- Today history stays behind `Value over time`, uses only matching daily records, and has
  no 1D/intraday view. The map uses actual proportional values with an accessible list;
  its holding dialog offers explicit account destinations for shared names. See `ui/TODAY.md`.

- v202: Apex runs the self-directed book. The Plan keeps "cut what's broken"; Step 2 points to the Apex card; the
  retired momentum plan (sleeves, borrowing, press room) returns only with `window.SD_APEX_RUNS=false`.
- v203: the oversold daily screen moved to its own Research › Screens page; the momentum watchlist was cut and Income
  Ideas moved to Options. Apex weights rows carry held / target / this-week shares and dollars.

- Predict adds Positions, Ideas, Watchlist, Results and (v173) a private Settled tab without replacing any account, plan or
  research page. It is a separate account/data scope and hides the stock-account picker.
  Ideas are public liquidity-based research candidates; outcomes are hypothetical and before fees.
  Private account values remain unavailable until authenticated event-contract coverage is verified.
  The old Income & Tax derivatives row is now explicitly unverified, with its recorded values kept.
  See `producer/PREDICTIONS.md` for source, refresh, import/export and connection details.

- Smart $ (v174) is a new read-only area: politician (STOCK Act) and insider (Form 4) trades from
  `data.flow`, pinned to held/target names, with person, ticker and flag views. Follows and flag
  choices stay in this device's storage. Fund 13F data is not connected and says so. It replaces
  nothing; the Flow & Positioning card and Analyze flow chip are unchanged.

- Today is one combined Daily Brief for Self-directed + Agentic. Its header has no account toggle;
  the detailed pages keep theirs. Totals require both recorded account values. Shared tickers aggregate
  across accounts; positive cash and margin debt stay separate. Stock contributions do not represent
  full account return. Combined history uses only matching recorded dates and includes cash flows.
- The brief also surfaces market context, dated earnings/options events, broker-reported self-directed
  options income and exposure, and recorded agentic research/ticket/guard status. Missing, stale and
  unreconciled evidence stays explicit. Links to each account or plan select the intended account.
- Activity shows publication time, account/target/ticket records. The snapshot does not provide
  live Claude run health, broker reconciliation, or push-delivery receipts; these remain unavailable.
- Decision evidence is for the agentic target only. It preserves research dates, recorded thesis,
  source dates and links, and missing evidence labels. The original self-directed plan stays separate.
- What if is local scenario arithmetic on one holding, with other assets held flat, optional
  assumed trading cost, and no tax/option sensitivity model. It cannot change a target or place a trade.

## Release checks

Run `node tests/experience.test.cjs`, `node tests/daily-brief.test.cjs`, all `producer/*.test.mjs` sequentially, and browser checks
using `node tests/preview.mjs` (synthetic data). Check both accounts, every navigation entry,
existing charts and Analyze drill-down, privacy, Gold/Light, mobile width, and Classic view.
The UI version, cache version, and versioned shell asset URLs must move together.

### Local verification (2026-09-16)

- Interface tests pass. Browser checks exercised both accounts, navigation destinations,
  rendered performance charts, scenario input changes, privacy masking, Classic return,
  and a 390px mobile viewport. No browser console errors were recorded.
- Existing producer suite: 31 files pass; `agentic-correctness.test.mjs` fails at line 103
  on Windows. The unchanged `finalize-target.mjs` CLI entry guard compares a native Windows
  path to a file URL, so the subprocess exits without executing the validation. This is
  outside the interface change; producer code is unchanged.
- Browser preview uses synthetic data. Live decrypted broker data and production service
  worker upgrade behavior have not been verified in this local preview.

### Daily Brief verification (2026-10-02)

All 40 producer suites and both display-model suites pass. With `tests/preview.mjs` running,
`tests/brief-browser.mjs` checks initial combined rendering from an Agentic preference, explicit
account/plan/options links, unchanged detailed account switching, 320–1440px layouts, foreground
updates, details persistence, privacy round-trip, Midnight, and a missing account. Set
`PF_PLAYWRIGHT` and `PF_CHROME` to an available browser install; optional `PF_SCREENSHOT_DIR`
keeps screenshots under local scratch. `producer/privacy-audit.mjs` now audits Today too;
`PF_AUDIT_DATA=tmp/experience-preview/sample.json` uses the preview fixture without changing data.json.
All eight audited surfaces reported zero leaks. Synthetic browser verification, Chart.js stub;
no decrypted live balances or independent Fable reviewer were available. Self-audited.

### Predictions verification (2026-10-06)

All 42 producer suites and the dashboard model/cache suites pass. Predict and Daily Brief browser
checks passed at 320/390/768/1440px, with synthetic account data, a Chart.js stub and real public
prediction snapshots. Includes Classic reload, keyboard tabs, target persistence, export/import,
stale and offline behavior, theme switching, privacy masking and production raw-feed fallback.
Self-audited; authenticated Predict access and the first production schedule remain separate checks.

## v163 — Broader Predict coverage

29 catalog-verified series and category filters; featured candidates are selected across categories
with a two-per-topic limit (CPI/core CPI combined). No portfolio/account or trading changes.
Validation: full producer suites, dashboard model tests, collector election-horizon fixtures,
public live collection, Predict responsive/browser checks. Self-audited; Fable unavailable.

## v168 — Self-directed recommendations

The existing Action Center, funding/collateral/tax protections, accounts and Analyze destination
remain. New Stock ideas are research rows, separate from funded buy quantities; rejection details
and estimated-target methodology can be expanded. The allocator uses an observed closing-price
range or consensus target with the existing 2:1 minimum, and checks entry/floors at allocation time.
`tests/sd-plan-browser.mjs` covers positive funded allocation, zero-funded visibility, missing targets,
tax/entry/momentum blocks, true consumer range propagation, 320–1440px layouts, privacy round-trip,
Midnight and Analyze links. All 50 producer suites and dashboard model tests pass. Browser fixtures
are synthetic; no decrypted account or production trade action was used. Self-audited.

## v169 — Market tape and contract cards

Added: a fixed-top market tape (`ui/ticker.js`/`.css`) on every screen, read-only over the published
snapshot, privacy-aware. Changed presentation only: Options Income & History contract rows are cards with
a scoreboard; every field shown before (contracts, expiration, status, opened, event date, opening and
closing cash, net) is still shown. The freshness strip, Find, privacy, theme, ↻ and the account switcher
keep their behavior; their sticky offsets now include the tape height.

### Apex decision corrections (v216)

Research › Plan retains its existing cards. Apex now separates review-only names
from recommended trades, shares its action set with the Plan note and confirmation
prompt, preserves held exit research, and gates entries at the executable limit.
Profit milestones require execution review; the separate agentic model is unchanged.
`tests/apex-browser.mjs` covers adapter propagation, missing/stale research, entry
gates, genuine exits, prompt/count agreement and 320–1440px layouts. CI runs this
with the existing Brief and Plan browser checks on synthetic data.

### v217 — Context-preserving research journey

The original account, Plan, chart, Options, Signals, Activity, Find, privacy and Classic
surfaces remain. The read-only Analyze pre-confirmation is removed; trade confirmations
are not. New context distinguishes account-specific position observations from the
legacy self-directed general Analyze screen. The account Plan remains authoritative.

Route-only hashes, Back/Forward, refreshed selections and scroll/details are covered in
`tests/journey-browser.mjs`. `ui/journey.js` stores only UI preferences; no saved financial
records, raw balances, broker credentials or strategy state are added. Shell/cache v217
moves with the new assets. See `UX_REVIEW.md` and the shared handoff for evidence and limits.

### v231 — Agentic positions and Duo

Both accounts share All Positions columns and retain account-local filters/sorts.
Agentic has no small-position cutoff; unknown quotes/costs are not zero. Its
existing target/trade table and handoff remain in Target comparison & trade review.
Keep duo.css last. Late-inset/resume detection, symmetric-notch protection and
folded/open/sideways geometry are exercised by holdings-duo-browser.mjs in CI.
Preserve the sticky date bar's opaque backing beside the reserved status inset.
The exact native iOS status strip remains a physical-device acceptance item.

### v232 — Native control column and compact Today

The Duo status/control column is browser-owned and outside the web viewport:
https://webkit.org/blog/18486/#web-content-under-the-controls . Do not claim it can
be reclaimed by CSS or use screen.width to force a wider page. Distinguish actual
content viewport tests from synthetic inset tests. Retain one narrow Today toolbar,
44px Back/Classic/account links, sticky date/stale/appearance controls and all five
tabs. Account context stays visible on the other routes. Agentic details and all
account/model/confirmation boundaries from v231 remain protected.

### v235 — Accounts starts with the decisions (Dashboard 2.0 Phase 1a)

Nothing is removed. On Portfolio › Accounts, for both accounts, Holdings Heatmap, Allocation, Income & Tax, Technical
Signals, Fundamentals, Positions Under $250, Flow & Positioning and Rebalance Log start **folded** (header visible).
Every card is still rendered into the DOM; All Positions, Performance, Risk & Diversification, the snapshot tiles, margin
banner, the Agentic Target comparison & trade review block, notices and pointer cards stay open as before. A tap on a
card header, or Expand all, is remembered per card and account (`pf_card_fold_v1`, falls back to defaults if storage
fails); a card pinned to My view does not start folded. Anything that navigates to a card — a rail chip, the hidden routes
(heatmap, income, technicals, fundamentals, flow, log), Find, My view — opens it first, for the session. Opening the
Heatmap draws it. Covered by `tests/journey-browser.mjs`.

### v236 — Options leads with what you hold (Dashboard 2.0 Phase 3a)

Nothing is removed. Options now reads: Options Exposure, Your Options, Upcoming Expirations, Covered-Call Income,
Cash-Secured Put Income, Income Ideas, Trade Ideas, then Options Income & History, Roll Scorecard and Options Knowledge.
Those last three start **folded** (header visible, every card still rendered). A tap on a header or Expand all is
remembered (`pf_card_fold_v1`, key `options:<section>`); a card pinned to My view starts open; a rail chip, Find, My view
or any other jump opens a folded card first. Income & History stays open when it only holds the "history not in this
snapshot" / reconciliation notice. The two rankers must stay adjacent: the open-Duo two-up pairing is selector based
(`ui/duo.css`, shared pairing grid) and relies on that. Covered by `tests/journey-browser.mjs`.

### v237 — Agentic header carries Invested; the tape stops repeating account numbers (Dashboard 2.0 Phase 1b)

Jack chose "Proposed" for both changes from the mockup page on Nov 17 2026. Display only.

**Agentic Accounts.** The header (`#agentic-app .header`) keeps its figure (`agenticBook` equity) and today's move, and its
sub-line now ends `· Invested $X` (same `fmtD`, same privacy masking, which is a text scan of the page). The snapshot is
the four tiles Unrealized, YTD Return, Idle Cash and Portfolio Beta; the Account Value and Day Change tiles are gone from
the agentic markup only (`renderSnapshot` with `cashTile`; the stats they used are still computed). Unknown is not zero:
no priced position value shows `Invested —`, no quote history shows no today line (the old tile showed `$0.00`), an
account the producer has not captured shows `—` and no tiles, as before. Grid: 2x2 below 740px, one row of four from
740px (`index.html`, `ui/duo.css`, agentic selector only). The self-directed header and six tiles are unchanged.

**Tape (`#pf-tape`, `ui/ticker.js`).** On Today and the Accounts routes (accounts, holdings, performance, heatmap, risk,
income; both accounts) the combined "Today" item and the two per-account value items are not drawn. Every other item
(status pill, Breadth, Markets, Holdings, Options, Earnings, Agentic breaker and ticket, Heads up) stays, and every other
route is unchanged. Strip height and the page top offset do not depend on the items. It repaints on `pf:route` and
`pf:render` (tap, hash, Back/Forward, account switch). Classic mode has no `PFExperience`, so it is unchanged.
Covered by `tests/journey-browser.mjs`.
## Navigation B (Jack, Nov 17 2026)

Jack reviewed the Nov 17 mockup and chose **"Option B · by strategy"**: bottom bar **Today · Apex · Agentic · Research · More**.
This supersedes ONLY the five-area labels (Today / Portfolio / Research / Signals / Activity) recorded above, in `ui/TODAY.md`
and in the earlier notes of this file; those entries are history and are left as written. Grouping only: the 21 route ids, their
`#view=<route>` hashes, pages, renderers and page ids, every card and calculation, Back/Forward, Find, Classic view, privacy and
the Today brief are unchanged. The nav stays five items; it is not extended.

- **Apex** (`pf_acct='main'`, self-directed) and **Agentic** (`pf_acct='agentic'`, automated) each hold Plan, Account and What if?
  (chips) plus the hidden section routes. The area of an account-scoped route is a function of the route AND the account
  (`areaOf` in `ui/experience.js`), so Apex always means the self-directed account and Agentic the agentic one; neither shows the
  other's plan, positions or actions. Tapping Apex / Agentic selects the account and reopens that area's last-used route (default Plan).
  Flipping the Accounts toggle, the Plan toggle or the header select moves the highlight (Apex <-> Agentic); the flip is its own history
  step exactly as before, so Back undoes it.
- **Research**: Markets · Screens · Analyze · Smart $ · Predict (default Markets). The old Signals memory (`pf_signals_last`) maps in.
- **More**: Options · Decision evidence · Rebalance log · Activity (default Options). "Lab" is the group of the two existing evidence
  routes (Decision evidence, Rebalance log); there is no new page. It appears in the header caption ("Lab · Agentic · Decision evidence"),
  not as a new nav pattern. Account-aware More pages keep the selected account and name it in the caption, as before.
- Stored values: `pf_experience_route` (any old route id) and `pf_acct` load as before; `pf_area_<old area>` values that do not belong
  to a new area are ignored (new keys `pf_area_apex/_agentic/_research/_more`); `pf_signals_last` seeds Research; unknown values fall back.

| Route id (hash `#view=`) | v236 area · chip | Navigation B area · chip |
| --- | --- | --- |
| `today` | Today | Today |
| `plan` | Research › Plan & Action Center | Apex or Agentic (by account) › Plan |
| `accounts` | Portfolio › Accounts | Apex or Agentic › Account |
| `holdings` `performance` `heatmap` `risk` `income` `technicals` `fundamentals` `flow` | Portfolio (no chip) | Apex or Agentic (no chip; Account page cards and rail) |
| `scenario` | Research › What if? | Apex or Agentic › What if? |
| `markets` `screens` `analyze` | Research | Research (unchanged chips) |
| `smartmoney` | Signals › Smart Money | Research › Smart $ |
| `predictions` | Signals › Prediction markets | Research › Predict |
| `options` | Portfolio › Options | More › Options |
| `decisions` | Research › Decision evidence | More › Decision evidence (Lab) |
| `log` | Activity › Rebalance log | More › Rebalance log (Lab) |
| `activity` | Activity | More › Activity |

Moves and why: What if? is account-aware (it reads the selected account's positions), so it sits in both account areas rather
than one. Options is self-directed source data and stays account-neutral. Every destination is reachable in at most one more tap
than in v236 (Account +1, Activity +1, Smart $ +1, section cards +1; Options, Markets, Agentic plan and agentic scenario are one tap
fewer). Covered by `tests/nav-b-checks.mjs` (run from `tests/journey-browser.mjs` in CI): all 21 routes by tap path, deep links for both
accounts, stored preferences, Back/Forward across areas and an account flip, the three account controls, Classic both ways, privacy,
Light/Dark/System, the fallback Today renderer, and no overflow at 320x568, 390x844, 466x677, 960x676, 677x466 and 1280x800.
Also fixed: returning to Accounts after flipping the Plan toggle left the Accounts toggle on the other account (the Plan toggle mirrors
the Accounts toggle without swapping its pages); `navigate` now brings the visible page's toggle into line through the native setters.

**Follow-up (Nov 17, owner): no second account switch inside Apex / Agentic, plus a Research chip.**
- On the account-scoped routes under Apex / Agentic (Plan, Account and its section routes) the old `Self-directed | Agentic` switches
  (`#acct-tg-*` on Accounts, `#plan-tg-*` on Plan) are `hidden` by the experience layer (`header()` in `ui/experience.js`, plus
  `html.experience-on .acct-seg-wrap[hidden]{display:none!important}`): out of sight, the accessibility tree and the tab order, taking no
  space. Elements, handlers, `setAccount` / `setPlanAccount` / `syncToggles` and aria-selected stay in step; Classic view shows them
  as before. Switching account there is the Apex / Agentic nav item (one history step, Back undoes it). The Rebalance log (More) is not
  account-scoped and has no header select, so its switch stays. The header select was already hidden on Plan / Account (v185) and is unchanged elsewhere.
- Account identity on those pages: caption "Apex (self-directed) · Account" / "Agentic (automated) · Account" (Plan likewise), hero pill
  "Robinhood · Individual Margin · ••••0741" (the ••••0741 suffix is added by CSS in the experience layer) / "Robinhood · Agentic ••••3900 · limited margin (1×)",
  and on Agentic Plan the hero label "Agentic Strategy · ••••3900".
- Research chip: Apex and Agentic rows read Plan · Account · Research · What if?. It is the journey's "2 · Research" step
  (`data-pj-go="analyze"`, handled by `ui/journey.js`): it opens the existing Analyze page for that area's selected holding, or Analyze's own
  picker when none is selected, in the same account; no new route (still 21), Analyze is unchanged. It navigates to `analyze`, so the Research
  tab is highlighted afterwards and Back returns to the Apex / Agentic page. Research's own row does not repeat it.
Not verified: WebKit (not installed here), a physical iPhone Duo.


### v239 — Plan, Screens and Predict keep decisions open (Dashboard 2.0 Phase 3b)

Nothing is removed; every card is rendered into the DOM. Reuses `window.__pfFold` (same contract as v235/v236: saved choice in
`pf_card_fold_v1`, My view pin starts open, rail chip / Find / Expand all open a folded card, `aria-expanded` kept).

| Page | Starts folded | Always open |
| --- | --- | --- |
| Plan, self-directed (`#picks-app`) | none | Apex card (leverage band, margin, ranked opportunities, Confirm, held-position review), Action Center, pointer cards |
| Plan, agentic (`#plan-agentic-app`) | How the loop runs (`agp-loop`, key `plan-agentic:agp-loop`) | Where the plan stands, Model correctness & forward record, The target, Business check, What's blocked, The waiting ground, Guardrails |
| Screens (`#screens-app`) | Scoring Breakdown (`scr-breakdown`, key `screens:scr-breakdown`) | Top 3 Picks, Composite Scores, Track Record, reference note, scan hero, Earnings Preview |
| Predict (`#predictions-app`) | none (Browse more markets, Sources & coverage and the per-result rows were already closed `<details>`) | Positions, Ideas, Watchlist, Results, Settled |

Keys are per page and account, so the agentic choice never reaches the self-directed Plan or the Accounts folds. The
"Not financial advice … monitor-only" line stays outside the folded loop body. Scoring Breakdown stays open when it holds no
candidate rows. Screens has no rail or Find entry, so its card is only reached by opening the page. Covered by
`tests/research-folds-checks.mjs` via `tests/journey-browser.mjs`.

### v240 — One wording for agentic ticket status (Jack: "Unify", Nov 17 2026)

The contract is `PFExperienceModel.ticketStatus` (`ui/experience-model.js`). Today, Agentic Plan "Where the plan stands" (and "Last ticket"),
the Agentic Accounts strip, the market-tape Ticket pill, Activity (strip, record row, timeline) and the attention title all render ticket
state through it; a stored status word is never printed. Changing a string here changes every screen, so change it in one place and
update `tests/ticket-status.test.cjs`, `tests/today.test.cjs` and this table together.

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

Rules that stay: a submitted or completed ticket is never worded as a confirmed fill (caveats above travel with the label); queued
(auto-eligible) and queued (owner-confirmed) stay distinct; a finished ticket is never headed "Rebalance in flight" (the strip reads
"Last ticket", like Plan); an unknown status is shown with its raw value, not hidden. Out of scope and unchanged: ticket state logic,
producer, Apex "Confirm with Claude" flow, Options broker-state badges (CONFIRMED / QUEUED / PARTIALLY_FILLED are the broker's own
words), the Plan help glossary of stored producer words. Covered by `tests/ticket-status-checks.mjs` via `tests/journey-browser.mjs`.

## v244 — Apex v2.9 paper research view (2026-11-17)

Added, nothing removed: route `apexpaper` ("v2.9 Paper", Apex area) and a pointer row under the live Apex card. The live Apex card, its targets, Recommended trades, Confirm button, tickets and every agentic surface are unchanged and never read `data/apex-paper-v29.json`. The view is display only and names missing / unreadable / failed / partial / stale states.
**Superseded in part, 2026-11-17 (Apex workspace; owner: "Build it", after the folded-Duo screenshot of Apex > Plan).** Inside Apex and Agentic the
Plan · Account · Research · What if? sub-nav, the card rail (chips + Expand/Collapse all) and the journey's three large step buttons are replaced by ONE
tab row: **Overview · Positions · Research · Actions** (Overview = `accounts`, Positions = `holdings`, Research = `analyze` entered from the area and kept
highlighted via history-state `origin`, Actions = `plan`; `scenario` is an Overview row; the 22 routes and hashes are unchanged). Back is icon-only and
Classic view moved into More. A bare `#view=analyze` is still a Research-area page. Everything above this note stays as history.

## Duo layout state and mid-fold (v247)

Jack's rule, taken from his Sports Hub app: **Duo optimization ALWAYS applies; the Duo mode controls ONLY the mid-fold split.** The
width rules in `ui/duo.css` (sections 1–8: slim header, rails, two-pane open Today/Apex, sideways rail) never depend on the mode. Do not
infer a fold from screenshot dimensions or from `screen.width`.

**One owner.** `ui/duo.js` alone writes `html[data-duo-mode]` (auto | folded | book | standard), `html[data-duo-layout]` (standard |
folded | book), `html[data-duo-source]` (none | sensor | forced), `html[data-duo-split="on"]` (only on a landing view while the layout is not
standard), `--fold-top/--fold-bottom` (folded) or `--fold-left/--fold-right` (book) in px, and `window.PFDuo` (`mode`, `layout`, `split`,
`setMode()`, `refresh()`, `core` for tests). Every change dispatches `pf:duo-change` on `document`. The mode is stored in `localStorage`
`pf:duo-mode`; a missing, unknown or unwritable store means `auto`. No page keeps its own layout flag.

| Mode | Layout |
| --- | --- |
| Auto | the browser's own fold signals only: Viewport Segments (`window.viewport.segments`, or the CSS `(vertical|horizontal)-viewport-segments: 2` queries read through `env(viewport-segment-*)`) with Device Posture not `continuous`. Two stacked segments = folded; two side by side = book; anything else, including a posture with no geometry, = standard |
| Folded | top / bottom split at the reported crease (24px gutter), else at 50% of the viewport height (8px hairline) |
| Book | left / right split at the reported crease, else at 50% of the viewport width |
| Standard | exactly the v246 layout: nothing below is applied |

**Web limits.** Safari without the Viewport Segments / Device Posture flags (or any browser without those APIs) reports nothing, so
**Auto stays Standard there until the owner taps Folded or Book.** Chromium reports `continuous` posture by default, which also means no
split. The inset probe (`pf-side-status`, `--duo-r`, `--duo-l`, `__pfDuoMeasure`) is unchanged and is not a fold signal: an inset says nothing
about orientation. A separate "phone" vs "folded" (outer display) distinction is not knowable from the web and is not made.

**Control.** One button in the gray freshness bar (`#pf-duo`, beside the theme button, present on every route of the new navigation (Classic view loads the same script and bar; not browser-tested); at
widths under 480px icon-only, always with `aria-label` "Duo layout: <mode>…"; 44px target without growing the bar). It opens a
`role="radiogroup"` popover with four `role="radio"` buttons (≥44px, arrow keys, Escape) and a one-line note that names what Auto is
currently seeing. The popover floats over the page (no layout shift). The same setting is not duplicated elsewhere.

**Which views split.** Only the landing view of an area, and only when the layout is folded or book: Today; Accounts (Apex and Agentic
Overview); Markets and Analyze (Research); v2.9 Paper. Every other route (Positions, Actions, Options, Activity, Decision evidence,
Rebalance log, Scenario, Screens, Smart $, Predict) stays full screen in every mode, because confining every page to half the screen "cut off
most of the app" in Sports Hub.

**How.** No node is moved, removed or re-rendered. The summary blocks stay where they are in the DOM and are pinned in place
(`position:fixed`, values set by `duo.js`) while they fit in the top pane (folded) or left pane (book); the first block that does not fit
and everything after it continues at the top of the scrolling part, so nothing is clipped. The document keeps scrolling (`window.scrollY`,
Back/Forward scroll restore, Find, My view and section jumps are unchanged; `__pfTopOffset()` clears the top pane). In folded an opaque
backdrop (`html::before`) hides scrolled content under the top pane. The tab row (`#ex-subnav`) is interactive, so it stays in the scrolling
part. Pinned: chrome `#ex-top` (title or identity, Back, stamps) plus Today `.td-hero`; Apex/Agentic Overview `.header` and `#ws-strip`; Markets
`.picks-hero`; Analyze `#pj-context` and the selected ticker's first card; Paper `.apx-head` and `.apx-tiles`. Whatever does not fit stays in
the bottom part. A re-render of a page re-pins (childList observer); `data-duo-pin` and the `--duo-*` vars are removed on any other route.

**Transitions.** Rotate, open/close, a segment or posture change, a mode change, a route change: the page re-lays out without a reload; route,
account, selected holding, filters, open details and card folds are untouched (state lives outside the layout); the element at the top of
the scrolling part keeps its place (anchor saved and restored). No animation is used.

**Contract.** Standard = v246: rule blocks 9b/9c in `ui/duo.css` are all keyed to `html[data-duo-split="on"]`; `tests/duo.test.cjs` fails an
unscoped selector. Account separation, Confirm, ticket wording, Paper's paper-only labelling and privacy masking are unaffected (pinned nodes
keep their `data-priv`). Covered by `tests/duo.test.cjs` and `tests/duo-checks.mjs` (run from `tests/journey-browser.mjs`). Not verified: real
Safari / the physical Duo (the browser fold APIs are simulated).

## Book command panel (v248)

Book only, Apex / Agentic only. `ui/book.js` owns `#pf-book`, `html[data-book]`, the `data-book-dup` / `data-book-n` marks and
`window.__pfBookPick`; `ui/experience.js` owns `#ws-selected`. The panel is display only and reads existing figures (All Positions rows, the
Apex review, `acctPerfStats`, `agenticBook`, `__PF_AG_TARGET`, `ticketStatus`, the Action Center list). In Book, Positions, Actions and
Overview's section routes split too (`PFDuo.core.BOOK_ROUTES`); Folded keeps the v247 landing set. Turning Book off removes every mark.
v249: Today also gets the panel in Book (both accounts' command blocks + their performance; no holdings list, since Today's
right page carries the combined holdings map). Panel taps carry the account (`data-ex-account` / `data-bk-acct`).

v250: in Book the v2.9 Paper ranked list is pinned on the left page under the tiles (own scroll) and the selected stock leads the
right page; the Apex Actions card, the plan tiles and the Markets tiles are one / two columns on the half-width right page. Book only.
v251: the Apex Confirm button is drawn only when there is an order to confirm; review-only names that share a reason are one row.
Book, Actions only (trial): the right page scrolls on its own and the document is locked; every other route is unchanged.
v252: Analyze reads one account's book (the account in context): holdings chips, Your Position (badged Apex / Agentic), sizing, overlap and the pattern-radar list. Same cards and levels; the technical read is unchanged. Producer: held names always get a daily series (bar-sized fetch calls, snapshot holdings, light-run seeding).
v253: Apex / Agentic Research tab = that account's research cards (Apex research, opportunities, screened out, weights, business check, paper pointer; Agentic target, model correctness, business check); Actions = trades, Confirm, leverage, rules, blockers, waiting ground, guardrails. Same cards, each on one tab; Classic view shows the whole page as before. Analyze opens from the row on Research.
