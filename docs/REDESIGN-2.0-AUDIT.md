# Dashboard 2.0 — Phase 0 audit

Source: Jack's "Portfolio Dashboard 2.0 — Investment Intelligence Redesign" builder handoff (2026-11-17).
Audited read-only at main `e442092` (app v233) on 2026-11-17 ET; v234 (`f8c8923`, layout/theme only) merged during the audit.
Line numbers in the appendices are v233 line numbers. No file other than this one was changed by the audit.

How it was made: four delegated read-only passes (inventory, data/contracts, layout baseline, Robinhood documentation),
then spot-checks of their claims against the code by the supervising session. Items marked **unverified** were not re-checked.

## 1. What the app is today

- Visible navigation is already five areas: **Today / Portfolio / Research / Signals / Activity** (`ui/experience.js`), 21 routes
  (`ui/journey.js` `ROUTES`). The older eight-tab bar still exists in `index.html` but is hidden (`ui/experience.css`).
- 155 features/cards were inventoried (Appendix A).
- Baseline tests on `e442092`: validator 21/21, published data 4/4 valid, producer suites 56/56, `tests/*.test.cjs` 63/63 (Appendix B).

## 2. Layout baseline (synthetic data, headless Chromium — not a physical iPhone Duo)

Page length in screens (page height / viewport height). Full table in Appendix C.

| Page | Phone 390x844 | Duo folded 466x677 | Duo open 960x676 | Folded sideways 677x466 |
|---|---|---|---|---|
| Today | 2.8 | 3.4 | 2.4 | 3.2 |
| Accounts (self-directed) | 8.7 | 10.0 | 7.4 | 11.5 |
| Accounts (agentic) | 8.4 | 9.6 | 7.4 | 11.7 |
| Options | 8.5 | 10.2 | 7.4 | 13.9 |
| Plan (self-directed) | 6.1 | 7.2 | 6.0 | 9.6 |
| Plan (agentic) | 5.3 | 6.3 | 4.2 | 8.6 |
| Screens | 5.1 | 5.9 | 4.5 | 7.9 |
| Predict | 4.4 | 5.4 | 3.5 | 5.7 |

No horizontal overflow and no page errors in any of the 100 measured cells.
Taps from app open: Apex Confirm 0 (on Today's first screen); held-position research 2; Agentic plan 1; covered-call ranker 3 (and ~6,000 px down the Options page); Predict 2; Smart $ 1.

**The clutter is page length on Accounts and Options, not Today.** The 20–30% target is measured against this table.

## 3. Duplication census (counted from code, Appendix A §3)

| Brokerage-style display | Live locations | Note |
|---|---|---|
| Account value / equity | 13 | Agentic Accounts shows it in the header and again in a snapshot tile directly below |
| Day P&L / day move | 10 | Same header-plus-tile repeat on Agentic Accounts; the global tape repeats it on every page |
| Share-level position tables | 7 | `All Positions` is the authoritative one |
| Price / performance charts | 5 | Only Analyze's Chart Analyzer is a plain price chart, and it carries research overlays |
| Order status | 10 | Today and Activity are the canonical ones |
| Buying power | 1 tile + 3 derived | Derived uses are Apex leverage inputs |
| Options payoff chart | 2 | Greeks appear in 2 places, both already folded |
| Options chain | 0 | Nothing to cut |
| In-app price alerts | 0 | Nothing to cut (alerts are producer-side) |
| Ticker tape | 1 (global) | Carries account value and today's move on every page |

## 4. Robinhood overlap (Robinhood's own documentation, Appendix D)

Read from page summaries; support pages are undated. Treat as **unverified until spot-checked** before any retirement relies on it.

| Robinhood documents it | Robinhood documents it with limits — keep a dashboard fallback | Not found in Robinhood's docs — dashboard differentiator |
|---|---|---|
| Position detail; charts and indicators; price/indicator alerts; buying power and margin status; options chain Greeks/IV/probabilities; news, ratings, earnings | Options simulated returns / P&L chart (options level 2 / 3); order history (Legend: open + last 24 h closed); screeners; tax lots; per-account P&L summary; watchlists | Deposit-adjusted / time-weighted / benchmark-relative performance; covered-call strike ranking; any documented deep-link scheme |

Robinhood links in the app today: `https://robinhood.com/stocks/<SYM>` (`index.html` `rhUrl`, `ui/apex.js`) and prediction-market web links. No `robinhood://` links. Robinhood documents no deep-link scheme, so none may be added or described as working without a device test.

## 5. Feature-disposition ledger

Status words: **Keep**, **Fold** (still rendered, starts collapsed, opens on tap or navigation), **Merge**, **Relocate**, **Retire-candidate** (not approved; needs the §9 retirement criteria).
Nothing in this ledger changes a calculation, a data feed, a producer file or a schedule.

| Existing feature (Appendix A id) | Purpose | Depends on | Robinhood alternative | Proposed status | Where | Risk if removed | Phase |
|---|---|---|---|---|---|---|---|
| Today (F001–) incl. Waiting on you / Out of your hands, Confirm | what matters now | `renderApexCard` → `__PF_APEX_REVIEW`, today-model | none | Keep as is | Today | breaks confirmation contract | — |
| Accounts header + snapshot, self-directed (F021, F023) | account health, leverage | `renderSnapshot`, SNAP | partly | Keep | Accounts | leverage/beta tiles are Apex context | — |
| Agentic header (F040) + snapshot tiles Account Value / Day Change (F042) | account size / day | `renderSnapshot(-ag)` | partly | Merge: drop the two tiles that repeat the header, only if the header carries the same information in every state | Accounts (agentic) | none if header is complete; otherwise keep | 1a |
| All Positions (F024, F043) | authoritative position detail | SNAP.enriched | yes | Keep, open | Accounts | reconciliation, tax context | — |
| Performance vs Benchmark / Account Performance (F025, F045) | am I beating the benchmark, deposit-adjusted | writes `__SNAP.perf` | not found | Keep, open | Accounts | YTD fallback and export read `__SNAP.perf` | — |
| Risk & Diversification (F027, F047) | concentration, correlation | D.hist | not found | Keep, open | Accounts | Apex theme/leverage context | — |
| Holdings Heatmap (F026, F046) | where the move is | SNAP.enriched | partly | Fold | Accounts | none (still rendered) | 1a |
| Allocation (F028, F048) | diversification | `alloc` stash | partly | Fold | Accounts | stash must still run | 1a |
| Income & Tax (F029, F049) | dividends, harvest, realized | overviews | limited | Fold | Accounts | tax context | 1a |
| Technical Signals (F030, F050) | timing | D.hist | yes | Fold | Accounts | — | 1a |
| Fundamentals (F031, F051) | valuation | overview feed | yes | Fold | Accounts | — | 1a |
| Positions Under $250 (F032) | dust | SNAP | yes | Fold | Accounts | — | 1a |
| Flow & Positioning (F033, F052) | smart-money context | D.flow | no | Fold here; candidate to Relocate under Research later | Accounts | — | 1a / 3 |
| Rebalance Log (F034, F053) | did trades / the model work | D.*.decisions | no | Fold here; candidate to surface in Lab evidence later | Accounts | model-evaluation evidence | 1a / 4 |
| Global ticker tape | glance | SNAP | — | Open question for Jack (compact / context-aware / optional) — mockup first | global | freshness and ticket pills live in it | 1b |
| Options: Your Options, Exposure, Expirations (F061, F064, F065) | option risk now | D.options | partly | Keep | Options | account-specific coverage | — |
| Options: payoff chart + Greeks folds (in F064, F066) | contract shape | static math | yes, gated by options level | Keep as fallback; already folded for Greeks; payoff Fold candidate | Options | fallback if Robinhood tool unavailable | 3 |
| Options: Covered-Call ranker, CSP ranker, Income Ideas (F067–F069) | which strike is worth it | D.options.ideas, D.picks.income | not found | Keep and move UP the page (today ~6,000 px down) | Options | this is the differentiator | 3 |
| Options: Income & History, Roll Scorecard (F062, F063) | did the premium pay | D.options | limited | Keep; Fold history detail | Options | outcome tracking | 3 |
| Options Knowledge (F070) | education | static | — | Fold | Options | — | 3 |
| Plan — Apex card, ranked opportunities, Business check, What-if | what should the self-directed book do | apex.js, sd-rules.js, apex-targets.json | none | Keep; no logic change | Research › Plan (self-directed) | investment contract | 2 |
| Plan — Agentic target, drift, guardrails, in-flight states | is the automation behaving | AG_* mirrors of producer | none | Keep; review the two in-flight displays for one wording of pending vs filled | Research › Plan (agentic) | submitted ≠ filled | 2 |
| Markets, Screens, Analyze | research | feeds | partly | Keep | Research | — | 3 |
| Smart $, Predict | differentiated research | own feeds | no | Keep | Signals | — | — |
| Decision evidence, What if?, Activity, Rebalance logs | provenance, validation | decisions feeds | no | Keep; Lab = a consolidated view of these, no new calculation | Research / Activity | provenance | 4 |
| Legacy momentum watchlist (`SD_APEX_RUNS=false` path), hidden "Push to Kyle" / "Run New Analysis" buttons, fallback Today renderer | — | — | — | Retire-candidate only; untouched until dependencies are proven | — | fallback Today is a safety net | later |

## 6. Old → new screen map (proposed; navigation is NOT changed by Phase 1)

The handoff's six target areas, mapped from the 21 existing routes. Every route keeps working in every option.

| Target area | Existing routes that answer it |
|---|---|
| TODAY | `today` |
| APEX | `plan` (self-directed), `accounts` + `holdings` `performance` `heatmap` `risk` `income` (self-directed), `scenario` |
| AGENTIC | `plan` (agentic), `accounts` + section routes (agentic), agentic part of `activity` / `log` |
| RESEARCH | `markets`, `screens`, `analyze`, `technicals`, `fundamentals`, `flow`, `smartmoney`, `predictions` |
| OPTIONS | `options` |
| LAB | `decisions`, `log`, rebalance logs, model-correctness cards |

The accepted design keeps five primary areas, and `tests/experience.test.cjs` pins the five page ids. A six-label phone bar is not proposed.
Two options to prototype for Jack (phone and Duo, one screen at a time) before any navigation change:
1. Keep the five areas; Apex / Agentic stay the account toggle; Options stays under Portfolio; Lab becomes a chip under Activity.
2. Rename/regroup to Today / Apex / Agentic / Research / More (Options, Lab, Activity), Signals inside Research.

## 7. Protected contracts (full list with quotes in Appendix B §3)

Whole-book Confirm; Waiting on you vs Out of your hands; held position ≠ sell when it fails new-buy rules; owner-managed IREN;
unknown is not zero; price freshness rule; Apex vs Agentic separation; submitted ≠ filled; five areas; `duo.css` last; safe-area handling;
functions extracted by producer tests (`AG_*`, `sdLockedShares`, analyze-core, agentic-method, agentic-account-return, option-history-ui) must not be renamed or moved;
a render call must never be removed, because several renderers also compute and stash values other screens read.

## 8. Known gaps in this audit

- `data.json` is encrypted; keys were inferred from code, not read.
- `CLAUDE.md` was read in part (newest entries plus greps).
- The `index.html` caller graph was sampled.
- Robinhood findings come from page summaries; mobile app home/order-history pages were not confirmed.
- Screens, Predict and Smart $ are not in the collapse / card-rail / Find page lists; whether another mechanism covers them was not checked.
- CI runs six Chromium suites plus one WebKit run; `AGENTS.md` says four; `tests/predictions-browser.mjs` is not referenced by a workflow.
- No physical-device check of anything.


---

# Appendix A — Feature and navigation inventory

# A-inventory: Portfolio Dashboard screens, cards, navigation (current code, app v233)

Repo: repo (read-only). `index.html` = 8801 lines. Shell version `APP_VERSION='v233'` (index.html:~920), `CACHE_VERSION='pf-v233'` (sw.js:9).
Method: grep -n + targeted sed. Nothing executed. `data.json` is an AES-GCM envelope (keys `enc,v,iter,salt,iv,ct`), so real payload keys could NOT be inspected; "data read" below is derived from code references only.
Notation: `I:` = index.html, `E:` = ui/experience.js, `J:` = ui/journey.js, `T:` = ui/today.js, `A:` = ui/apex.js, `K:` = ui/ticker.js, `P:` = ui/predictions.js, `S:` = ui/smartmoney.js. Account scope: MAIN = self-directed margin ••0741, AG = agentic ••3900.

---------------------------------------------------------------------
## 1. NAVIGATION MAP

### 1.1 Two layers, one DOM
| Layer | What | Visible today? | Evidence |
|---|---|---|---|
| L1 "Classic" tab bar | 8 tabs: Accounts, Markets, Plan, Options, Screens, Analyze, Predict, Smart $ (`#tabbar`, `switchTab(id)`) | NO by default. `html.experience-on #tabbar{display:none}` (ui/experience.css:14). Shown only in Classic mode (`pf_classic=1`, E:66-69 returns before building L2) or if experience.js fails to load (it bails at E:5 when `PFExperienceModel`/`switchTab` missing). | I:743-752, E:5, E:66-69, experience.css:14 |
| L2 "Experience" nav | 5 areas: Today, Portfolio, Research, Signals, Activity (side rail >=900px, bottom bar <=900px) + per-area sub-nav chips + header | YES (default). | E:71-77 (build), E:74 (area buttons), E:81-95 (`header()` sub-nav), experience.css:47,56,67 |

Relationship: L2 is a router over L1. Every L2 route either (a) calls the original `switchTab(tab)` to show an L1 page (`routes[key].tab`, E:19-43, `navigate()` E:230-247) or (b) shows one of 4 L2-owned pages `#page-ex-today|activity|decisions|scenario` (created E:77, toggled E:234) and hides all L1 pages (E:238). `window.switchTab` is overridden (E:248-252) so all legacy callers (`onclick="switchTab('picks')"`, Find, tape, pointers) are rewritten to routes: portfolio->accounts, picks->plan, markets, options, analyze, screens, predictions, smartmoney. `setAccount`/`setPlanAccount` are wrapped (E:253-254) to refresh L2 chrome. `tab-*` buttons and `switchTab` original: I:5037-5063.
Layer 3 (journey): `ui/journey.js` adds route-in-hash + history + Back button + selected-name bar on top of L2 (J:1-217).

### 1.2 Areas, sub-nav chips, routes (all 21 route ids; E:19-43; J:9 `ROUTES` has the identical 21)
Default route per area (E:44): today->today, portfolio->accounts, research->plan, signals->smartmoney, activity->activity. Signals reopens last sub-tab (`pf_signals_last`, E:46). Sub-nav chips list PAGES only; in-page section routes in the portfolio area get NO chip (E:92 filter `!(v.section&&v.area==='portfolio')`).

| Area (bottom/side nav) | Route id (hash `#view=<id>`) | Chip label | Legacy tab id | L1 page / L2 page | Render function | file:line |
|---|---|---|---|---|---|---|
| Today | `today` | Daily brief | (none, L2) | `#page-ex-today` | `renderToday` -> `PFToday.render` (T:177); fallback renderer E:117-155 | E:23, E:117, T:177 |
| Portfolio | `accounts` | Accounts | `portfolio` | `#page-portfolio` (`#app` MAIN / `#agentic-app` AG) | `load()` (I:4857) / `renderAgenticPage` (I:3571) | E:24, I:753-762 |
| Portfolio | `holdings` | (no chip) | portfolio, scroll `data-sec=holdings` | same | `_renderPos` I:4660, `renderAgenticPositions` I:4656 | E:25 |
| Portfolio | `performance` | (no chip) | portfolio, sec performance | same | `renderPerformance` I:1796 / `renderAgenticPerf` I:3685 | E:26 |
| Portfolio | `heatmap` | (no chip) | portfolio, sec heatmap | same | `renderHeatmap` I:4804 | E:27 |
| Portfolio | `risk` | (no chip) "Risk & allocation" | portfolio, sec risk | same | `renderRisk` I:2138 | E:28 |
| Portfolio | `income` | (no chip) "Income & tax" | portfolio, sec income | same | `renderIncomeTax` I:2223 | E:29 |
| Portfolio | `technicals` | (no chip) | portfolio, sec technicals | same | `renderTechSignals` I:4723 | E:36 |
| Portfolio | `fundamentals` | (no chip) | portfolio, sec fundamentals | same | `renderFundamentals` I:4742 | E:37 |
| Portfolio | `flow` | (no chip) "Flow & positioning" | portfolio, sec flow | same | `renderFlowCard` I:4576 | E:38 |
| Portfolio | `options` | Options | `options` | `#page-options` / `#options-app` | `initOptions` I:6236 -> `renderOptions` I:6567 | E:30 |
| Research | `plan` | Plan & Action Center | `picks` | `#page-picks` (`#picks-app` MAIN / `#plan-agentic-app` AG) | `renderPicksStatic` I:7976 / `renderAgenticPlan` I:4124 | E:31 |
| Research | `markets` | Markets | `markets` | `#page-markets` | `initMarkets` I:8435 -> `renderMarketsShell` I:8437 + `fetchMarkets` I:8451 | E:32 |
| Research | `screens` | Screens | `screens` | `#page-screens` | `initScreens` I:7963 -> `renderScreensPage` I:7964 | E:34 |
| Research | `analyze` | Analyze | `analyze` | `#page-analyze` | `initAnalyze` I:6614, `renderAzShell` I:6615, `runAnalysis` I:7758 | E:35 |
| Research | `decisions` | Decision evidence | (none, L2) | `#page-ex-decisions` | `renderDecisions` E:172 (+ `mainEvidence` J:133 for MAIN) | E:39 |
| Research | `scenario` | What if? | (none, L2) | `#page-ex-scenario` | `renderScenario` E:192, `updateScenario` E:202 | E:40 |
| Signals | `smartmoney` | Smart Money | `smartmoney` | `#page-smartmoney` | `PFSmartMoney.mount` S:284, `render` S:245 | E:21 |
| Signals | `predictions` | Prediction markets | `predictions` | `#page-predictions` | `PFPredictions.mount` P:152, `render` P:114 | E:22 |
| Activity | `activity` | Snapshot & routine status | (none, L2) | `#page-ex-activity` | `renderActivity` E:157 | E:41 |
| Activity | `log` | Rebalance log | portfolio, sec `rebalance-log` | same as Accounts | `renderSdLog` I:4524 / `renderAgenticLog` I:4459 | E:42 |

Resulting visible sub-nav chips: Today: [Daily brief]. Portfolio: [Accounts, Options]. Research: [Plan & Action Center, Markets, Screens, Analyze, Decision evidence, What if?]. Signals: [Smart Money, Prediction markets]. Activity: [Snapshot & routine status, Rebalance log]. (derived from E:92 filter over E:19-43 order.)
Routes with no chip and no area button: holdings, performance, heatmap, income, technicals, fundamentals, flow (+ risk). They are reachable only via hash `#view=<id>` (J:18), journey step buttons `data-pj-go="holdings"` (J:121 context bar), Scenario's `jump('risk')` (E:199), Today's "Review" buttons for routes named in the brief (`attention.route`), the per-page card rail chips (I:5122), and Find (I:6207).

### 1.3 Account toggles (3 copies of the same preference `pf_acct`)
| Control | Where | Function | file:line | Visible when |
|---|---|---|---|---|
| Accounts segmented toggle (Self-directed ••••0741 / Agentic ••••3900) | top of `#page-portfolio` | `setAccount(which,{keepSection})` swaps `#app`/`#agentic-app`, first agentic render gated on `__dataReady` | markup I:754-759, fn I:3232-3275 | Portfolio route |
| Plan segmented toggle | top of `#page-picks` | `setPlanAccount(which)` swaps `#picks-app`/`#plan-agentic-app`, mirrors the Accounts toggle state | markup I:764-771, fn I:3276-3300 | Plan route |
| Header "Account" select `#ex-account` | L2 header | `navigate(routeKey,{account})` | E:72, E:255; hidden (`#ex-account-label`) for today/predictions/smartmoney and for any route whose tab is portfolio/picks/options (E:85) | Markets, Screens, Analyze, Decision evidence, What if?, Activity |
| Today has NO account toggle (combined); account name buttons route to `accounts` with `data-ex-account` | T:195 | `navigate` via click router E:256-259 | Today |
| Options page is MAIN-only (source note) | E:92 context text | none | Options |
| `_acctPref()` | I:3302 | reads `pf_acct`; `switchTab` reconciles pages on entry (I:5051-5056) | |

### 1.4 Hash / route / Back-Forward
- Hash format: `#view=<route>` only (regex `^#view=([a-z]+)$`, J:18-21). No account/symbol/balance in URL (J:47 comment). Written by `history.replaceState` (same route/account) or `pushState` (route/account change) in `store()` J:46-52; `popstate` handler J:90 restores route+account+scroll+open `<details>`; `pagehide`/scroll/toggle persist state (J:91-93).
- Journey state persisted: sessionStorage `pf-journey-v1`; localStorage `pf-journey-ui-v1` (selected symbol per account, holding search text, evidence filter) (J:33-34, J:46-52).
- On boot `init()` (J:206) restores history state, else `#view=` hash, else `PFExperience.route` (persisted `pf_experience_route`, E:44-47).
- "<- Back" button `#pj-back` (J:185) inserted into L2 header, calls `history.back()`; disabled at index 0.
- Other hash use: `#key=<passphrase>` consumed once at unlock then stripped via `history.replaceState` (I:849-850). (Do not copy the value.)
- No `hashchange` listener anywhere (grep). Classic mode has no hash/Back handling (journey.js needs `PFExperience`; E returns early in Classic).
- Localstorage nav keys: `pf_experience_route`, `pf_area_<area>`, `pf_signals_last`, `pf_acct`, `dash_tab` (written by original `switchTab`, I:5046; restore whitelist not re-verified), `pf_classic`, `pf_today_view`, `pf_predict_tab`, `pf_smartmoney_v1(+_ui)`, `pf_pins`, `pf_card_titles`, `pf_theme`, `pf_private`, `pf_az_last`, `pf_az_cmp`, `pf_pass`.

### 1.5 Global chrome (present on every screen)
| Item | Where | file:line |
|---|---|---|
| Market tape (fixed top) | `ui/ticker.js` mount | K:123, render K:157, CSS ticker.css |
| Freshness bar `#pf-fresh` (sticky): snapshot age/stale warning, Find, app-version badge (force update), privacy eye, theme button, Refresh/Unlock | created in `boot()` | I:931-960 (innerHTML I:943) |
| Unlock prompt `#pf-unlock` (passphrase) | `loadData` | I:852-871 |
| Header `#ex-top`: "Today" title, "Portfolio /" brand, context caption, "Both accounts" badge (Today), account select, "Find a feature", "Classic view" | E | E:71-72, E:81-95 |
| Back button `#pj-back` | J | J:185 |
| Selected-name context bar `#pj-context` (symbol select, Position value, Day contribution, steps 1 Holding / 2 Research / 3 Plan, snapshot age) on routes analyze, decisions, plan | J | J:111-131 |
| Find / My view (pins) | `__pfFind` | I:6003-6213 (openFind I:6207, `window.__pfFind` I:6213); `pf_pins` I:6025 |
| Card help "?" popovers (62 `tag:` entries counted in HELP table I:5265-6002; `openHelp` I:5978) | I:5258-5985 |
| Collapsible cards (`enhance`) | I:5064-5120 |
| Per-page card rail (chips of every card + expand/collapse all) | I:5122-5242, `__navRebuild` I:5242 |
| Toast `#toast` | I:797 |
| PWA service worker (offline, versioned precache of every ui/ asset) | sw.js:9-47; registration I:~963-985 |

NOTE: Collapse (I:5116), rail (I:5133), help (I:5997) and Find (I:6022-6024) all enumerate only five page ids: portfolio, markets, picks, options, analyze. `#page-screens`, `#page-predictions`, `#page-smartmoney` are not in those lists. Whether Screens cards are covered some other way: not determined.
Hidden-by-CSS live-only controls: `.kyle-btn,.run-btn{display:none!important}` (I:43) so "Push to Kyle" (I:4915 markup, `pushToKyle` I:1617) and "Run New Analysis" (I:7918, `runNewAnalysis` I:6607) exist in markup but are not shown.

---------------------------------------------------------------------
## 2. FEATURE INVENTORY

Columns: ID | screen / route | name as shown | component (markup file:line ; render fn file:line) | decision supported | data read | account scope.
Data shorthand: `D.x` = decrypted `window.__DATA.x` (data.json); `RH` = recorded Robinhood MCP replay in `D.recorded` via `window.cowork.callMcpTool` (I:~808-885); `SNAP` = `window.__SNAP` built by `load()`; `LS:` = localStorage. Where a row says "n.d." the data origin was not traced.

### 2.0 Today (`today`, L2 page) - T = ui/today.js, model = ui/experience-model.js `dailyBrief` (153) + ui/today-model.js
| ID | Name | Component | Decision | Data | Scope |
|---|---|---|---|---|---|
| F001 | Today header: title, freshness text, Theme select (Light/Dark/System) | T:186 ; `PFTheme.set` T:153 | how stale is this / appearance | D.generatedAt; LS pf_theme | both |
| F002 | Combined equity hero (+ "Stock move today") | T:195 (`#ex-combined-equity`, `#ex-combined-move`) | how big/how today | D.agentic.equity/cash, SNAP.stats.totalVal, D.quotes (prev close) | both |
| F003 | Per-account tiles (Self-directed / Agentic value, stock move, MAIN leverage) -> link to Accounts | T:195 | which account moved | SNAP.stats, D.agentic, Apex state | both |
| F004 | Waiting on you (count badge) | T:71-82 `waiting()` ; model T:`ticket()` today-model.js:73 | what needs me now | Apex review, D.agentic.pending, brief.attention, earnings | both |
| F005 | Apex trade card: proposed orders with prices, Stop->Entry->Target rail, review-only fold, **Confirm with Claude** (whole-book) | T:50-66 `tradeCard`, T:42 `rail`, T:137 `confirm` (opens `claude.ai/new?q=` T:146) ; `renderApexCard(..,{fromToday:true})` I:2026 -> `__PF_APEX_REVIEW` | approve the weekly buy/sell set | `data/apex-targets.json` (fetch I:2039), SNAP, Apex.bookLines/bookReviews A:648/598 | MAIN |
| F006 | Agentic ticket awaiting confirmation / earnings <=7d / brief alerts rows | T:67-81 `attentionRow`, E-model attention E-model:195-212 | what needs review | D.agentic.pending, drawdown, calendar `_earnMap` I:7625, options expirations | both |
| F007 | Out of your hands (agentic ticket state + expiring option contracts; "recorded, not a live broker feed") | T:83-93 `monitor()`; `ticket()` map today-model.js:73-92 | what is in motion / not mine | D.agentic.pending (status, history), D.options.positions | AG (+MAIN options) |
| F008 | Your holdings today (area=value treemap / list toggle, both accounts) | T:94-104 `holdings()`, `T.treemap` today-model.js:31; LS `pf_today_view` T:25 | where is my money/what moved | SNAP.enriched, D.agentic.positions, D.quotes | both |
| F009 | Biggest drag insight | T:94-104; `biggestDrag` today-model.js:101 | what hurt today | same as F008 | both |
| F010 | Holding detail dialog (shares, value, Research/Plan per account) | T:127-135 `openSheet` | drill into a name | same; routes `analyze`/`plan` | both |
| F011 | Value over time (collapsed; combined recorded equity) | T:105-117 `disclosures`; chart `historyChart` E:97-104 (SVG) | trend of account value | D.main.equityHistory, D.agentic.equityHistory (matching dates) | both |
| F012 | Options income & exposure (collapsed) | T:105-117 | options P&L / exposure | D.realized (options), D.options | MAIN |
| F013 | Coming up - next 30 days (option expirations + earnings) | T:105-117 | calendar | D.options, `_earnMap`->D.recorded earnings | both |
| F014 | Sources, coverage & calculation notes (+ links to Activity, Decision evidence) | T:105-117 | trust/limits | D.* timestamps | both |
| F015 | Market backdrop (SPY/QQQ/IWM, VIX) | T:198 | market context | D.quotes, D.vix | none (market) |
| F016 | [FALLBACK, not rendered when today.js loads] legacy Today cards: hero, account cards, cash strip, On your radar, What drove your day, Market backdrop, Options income & exposure, Agentic at a glance, Where the weight sits, Combined value over time, Your next move, Sources | E:117-155 (early `return` E:121 when `window.PFToday`) | same as above | same | both |

### 2.1 Portfolio > Accounts, MAIN side (`#app`; markup I:4900-4932; orchestrator `load()` I:4857, enrichment fan-out I:4936-4994)
| ID | Name | Component | Decision | Data | Scope |
|---|---|---|---|---|---|
| F020 | Margin banner (over/under Apex cap, % of equity) | I:4907-4913 ; sdMargin I:2471, sdApexBand I:2384 | am I over-levered | RH get_portfolio (cash/bp), SNAP | MAIN |
| F021 | Header "Total Portfolio Value" + Robinhood · Individual Margin tag | I:4915 | account size | RH portfolio | MAIN |
| F022 | Push to Kyle button (hidden by CSS I:43) | I:4915 ; `pushToKyle` I:1617, `buildKyleHTML` I:1556 | export snapshot artifact | SNAP; cowork update_artifact | MAIN |
| F023 | Snapshot tiles: Buying Power, Day Change, Unrealized, YTD Return, Leverage (+utilization gauge), Portfolio Beta | I:4916 `#snap-content` ; `renderSnapshot` I:1634-1711 | headline health | SNAP.stats, D.main.equityHistory (YTD, `acctYTDStats` I:1783), betaInfo | MAIN |
| F024 | All Positions (sortable: symbol, % port, shares, avg cost, price, value, P&L $/%, day %) + row "Details" toggles | I:4917 ; `_renderPos` I:4660-4722, `sortBy` I:4650 | review each holding | RH positions + quotes, SNAP.enriched | MAIN |
| F025 | Performance vs Benchmark (YTD holdings vs SPY/QQQ, account-since, agentic-since, chart, macro strip 10yr/FedFunds/CPI/VIX) | I:4918 ; `renderPerformance` I:1796-1894 (chart I:1865/1887), `acctPerfStats` I:1731 | am I beating benchmark | D.hist, D.main.equityHistory, D.agentic.equityHistory, macro (`fetchMacro` I:1253) | MAIN (+AG overlay) |
| F026 | Holdings Heatmap (Day / P&L toggle; tap -> Analyze) | I:4919 ; `renderHeatmap` I:4804, `setHeatmap` I:4788, `squarify` I:4758 | where is the move | SNAP.enriched | MAIN |
| F027 | Risk & Diversification (Sharpe, Max Drawdown, Beta, stress -10%, themes/concentration & correlation) | I:4920 ; `renderRisk` I:2138-2198, `computeRiskMetrics` I:4837 | concentration/risk | D.hist, SNAP | MAIN |
| F028 | Allocation (By Sector, By Asset Class) | I:4921 ; `renderAllocation` I:2199-2222, `computeAllocation` I:1333 | diversification | overview feed `loadFundFeed` I:1238 (D.recorded) | MAIN |
| F029 | Income & Tax (est. dividends, realized YTD incl. options premium, derivatives settlements, By Account table, upcoming ex-div, tax-loss harvest) | I:4922 ; `renderIncomeTax` I:2223-2382, `computeIncome` I:1352, `harvestCandidates` I:1380 | income / tax-loss | D.realized, overviews, SNAP | MAIN + AG rollup (`accountRollup` I:1424) |
| F030 | Technical Signals (RSI, signal, vs 50-DMA, P&L) | I:4923 ; `renderTechSignals` I:4723 | timing | D.hist | MAIN |
| F031 | Fundamentals (P/E, fwd P/E, rev growth, EPS, yield, mkt cap, ...) | I:4924 ; `renderFundamentals` I:4742 | valuation | overview feed | MAIN |
| F032 | Positions Under $250 (small chips) | I:4925 | tidy dust | SNAP | MAIN |
| F033 | Flow & Positioning (politician/insider flow on ••0741 names) | I:4926 ; `renderFlowCard` I:4576 | smart-money context | D.flow | MAIN |
| F034 | Rebalance Log (your trades graded vs SPY) | I:4927 ; `renderSdLog` I:4524 | did my trades work | D.main.decisions | MAIN |
| F035 | Pointer card -> Plan tab | I:4928 (`switchTab('picks')`) | navigation | - | MAIN |
| F036 | Position row details toggle / holding-name filter (injected) | J:158-183 `enhanceHoldings`, J:~195 `accessible` | find a position | LS pf-journey-ui-v1 | both |

### 2.2 Portfolio > Accounts, AG side (`#agentic-app`; `renderAgenticPage` I:3571-3627; same renderers with `-ag` suffix)
| ID | Name | Component | Decision | Data | Scope |
|---|---|---|---|---|---|
| F040 | Header "Agentic Account Value" + "today" move + ••3900 tag | I:3579-3581 | account size/day | D.agentic (`agenticBook` I:3538, `agenticDay` I:3559) | AG |
| F041 | "Producer hasn't captured ••3900" notice | I:3582 | data health | D.agentic null | AG |
| F042 | Snapshot tiles: Account Value, Day Change, Unrealized, YTD, Idle Cash gauge, Portfolio Beta | I:3583 ; `renderSnapshot(..,{sfx:'-ag',cashTile:true})` I:3648/3662 | headline | D.agentic, D.agentic.equityHistory | AG |
| F043 | All Positions (same columns as MAIN; no small-position cutoff) | I:3584-3585 `#pos-table-ag` ; `renderAgenticPositions` I:4656 -> `_renderPos(...,'agentic')` I:4660 ; rows `agenticPositionRows` experience-model.js:15 | review holdings | D.agentic.positions, D.quotes | AG |
| F044 | Target comparison & trade review (collapsed): holdings tracker table (Holding / Position / Day / Unreal P&L / Trade), drift vs target, wash-sale / execution deferrals, waiting ground, drawdown breaker, in-flight ticket strip, "Rebalance ••3900 with Claude" hand-off | I:3586 `<details class="ag-trade-review">` -> `#agentic-content`; `renderAgenticCard` I:3762-4019 (table I:3941-3949, ticket strip I:~3986-3992, hand-off `chatBtn` I:3993) | what trades would converge the book to target | D.agentic.target/positions/pending/parked/drawdown, D.hist, earnings map | AG |
| F045 | Account Performance (Return % / Value $ toggle, deposit-adjusted TWR vs SPY, chart) | I:3588 ; `renderAgenticPerf` I:3685-3761, `setAgPerfMode` I:3678 | is the agent beating SPY | D.agentic.equityHistory (`cumFlow`), D.hist.SPY | AG |
| F046 | Holdings Heatmap (-ag) | I:3591 ; `renderHeatmap('-ag')` I:4804 | where is the move | `_agenticHeatRows` I:4794 | AG |
| F047 | Risk & Diversification (-ag) | I:3592 ; `renderAgenticAnalytics` I:3629-3677 -> `renderRisk` | risk | `agenticEnriched` I:1399 | AG |
| F048 | Allocation (-ag) | I:3593 ; same fn | diversification | same | AG |
| F049 | Income & Tax (-ag; dividends, harvest, realized) | I:3594 ; same fn; `agenticHarvest` I:1417 | income/tax | overviews, D.agentic | AG |
| F050 | Technical Signals (-ag) | I:3595 ; same fn | timing | D.hist | AG |
| F051 | Fundamentals (-ag) | I:3596 ; same fn | valuation | overviews | AG |
| F052 | Flow & Positioning (-ag) | I:3597 ; `renderFlowCard({sfx:'-ag',scope:'agentic'})` | context | D.flow | AG |
| F053 | Rebalance Log (agentic; decisions graded vs SPY, buy-side alpha strip, skill meter, sleeve strip) | I:3600 ; `renderAgenticLog` I:4459, `decBuyStrip` I:4384, `decMarkStrip` I:4394, `agSkillMeter` I:4432, `agSleeveStrip` I:4492 | does the model work | D.agentic.decisions | AG |
| F054 | Pointer card -> Plan tab (Daily Picks / Action Center) | I:3601 | navigation | - | AG |

### 2.3 Portfolio > Options (`#page-options`; `renderOptions` I:6567-6606)
| ID | Name | Component | Decision | Data | Scope |
|---|---|---|---|---|---|
| F060 | Options hero ("Contracts · Ideas · Knowledge") | I:6569 | context | - | MAIN |
| F061 | Options Exposure (open + pending) | I:6415-6428 `optExposureStrip` | total option risk | D.options.exposure | MAIN |
| F062 | Options Income & History (contract cards, scoreboard, filter, awaiting settlement) | I:6467-6546 `optIncomeHistory`, `ohFilter` I:6547 (title I:6482) | what premium did I earn | D.options.incomeHistory, D.realized | MAIN |
| F063 | Roll Scorecard | I:6384-6414 `optRollScorecard` (title I:6388) | were rolls worth it | D.options (rolls) | MAIN |
| F064 | Your Options (open + pending contract cards: strike, breakeven, mark, P&L, covered/naked, DTE, ITM/OTM, Greeks fold, assign odds, fill hint, guardrail note, payoff chart) | I:6576 ; `optCard` I:6276-6305, `optGuardrailNote` I:6366, `drawPayoff` I:6269 | manage a contract | D.options.positions/pending | MAIN |
| F065 | Upcoming Expirations | I:6429-6441 `optExpiryCalendar` | calendar | D.options | MAIN |
| F066 | Trade Ideas (direction/sort filter; calls, debit spread, CSP, covered call, collar; est. vs LIVE premium; Greeks fold; payoff chart; Robinhood link; Claude hand-off) | I:6585 ; `ideaCard` I:6307-6343, `optIdeaControls` I:6458, `optIdeaGridHtml` I:6442, `optIdeaApply` I:6450 | pick an options trade | D.options.ideas.ideas | MAIN |
| F067 | Covered-Call Income ranker | I:6591 | best CC yield | D.options.ideas (strategy 'Covered call') | MAIN |
| F068 | Cash-Secured Put Income ranker | I:6594 | best CSP yield | D.options.ideas | MAIN |
| F069 | Income Ideas (covered calls from the daily scan; moved here v203) | I:6562-6566 `optPickIncomeHtml` | scan-derived CC | D.picks.income (`PICK_INCOME` I:7882-) | MAIN |
| F070 | Options Knowledge (glossary accordion) | I:6598 ; `OPT_KNOWLEDGE` I:6345 | education | static | none |

### 2.4 Research > Plan & Action Center (`plan`; `#page-picks`)
MAIN side (`renderPicksStatic` I:7976-8026; apexPage = `SD_APEX_RUNS` default true; legacy v201 layout only if `window.SD_APEX_RUNS===false`):
| ID | Name | Component | Decision | Data | Scope |
|---|---|---|---|---|---|
| F080 | Apex card shell (collapsible "Apex (leverage loop · margin book)") | I:7987-7991 ; `renderApexCard` I:2026-2105 -> `Apex.render` A:502 | run the margin book | `data/apex-targets.json`, SNAP, D.quotes | MAIN |
| F081 | Apex leverage tiles + equity gauge + tripwire (Leverage, Margin debt, Cushion to call, Band) | A:541-544 | how close to a call | SNAP.stats (equity/cash), Apex.state A:129 | MAIN |
| F082 | Rules firing now (risk guard, leverage, ladder, winner/target hit, stop/research stop, drift, reload; ticket lines) | A:545 ; `Apex.rules` A:218 | what rules fire | state + research | MAIN |
| F083 | Whole-book order list + price-freshness note + **Confirm** link (opens `claude.ai/new?q=`) | A:546, `portfolioButton` A:678-693 (link A:691), `bookLines` A:648, `bookReviews` A:598, `portfolioPrompt` A:611 | approve whole book | same | MAIN |
| F084 | Business check tiles slot (verdict, milestones, sources) | A:547 `data-apex-business`; filled by `bizPaint` I:2015 -> `Business.render` ui/business.js:137 | is the company doing what it promised | `data/business.json` (fetch I:2010) | MAIN (+AG, see F105) |
| F085 | Weights vs target (bar per name, held -> target shares/$, this-week buy, research exit levels, tax-hold flag) | A:548 `sizeLine` A:525 | sizing | cfg.targets, positions | MAIN |
| F086 | Theme-cap bar | A:549 `themeHtml` A:559 | cluster cap | cfg.themeMap | MAIN |
| F087 | Research - top 5 tiles (score, entry/limit/trigger/TP1/stop, R/R, news fold, source) | A:550, `researchBlock` A:818-855 (header A:852) | which names to buy | apex-targets `top5` | MAIN |
| F088 | Ranked opportunities (Buy list / Blocked / Close / Watch groups, display only) | A:851 -> `oppBlock` A:796-815, `opportunities` A:755 | ranked candidates | apex-targets `top5/added/removed/blockedByTheme/blockedByCap` | MAIN |
| F089 | Veto block ("not buying" reasons grouped) | A:850 -> `vetoBlock` A:716-742 | why excluded | apex-targets `vetoed` | MAIN |
| F090 | What if (price sliders for IREN/PLTR -> equity, leverage, rules fired) | A:551-552, `renderWhatIf` A:856-878 | stress | positions | MAIN |
| F091 | Action Center card (collapsible) | I:7992-8003 `#b-action` | what to do with what I own | - | MAIN |
| F092 | Do now (live signals, ranked: margin over cap/cruise, trim, earnings, take profit, correlated, retail buzz...) | `#act-content` I:7996 ; `buildActionFeed` I:1895-1992, `renderActionFeed` I:1993 | urgent actions | SNAP, rsiMap, earnings, D.social | MAIN |
| F093 | The plan: Step 1 Cut what's broken (exits, covered-call lock box, net-tax note, sell hand-off) | `#plan-content` ; `renderActionPlan` I:2584-3097 (step1 I:2905-2923, `chatBtn` I:2923) | sell broken names | SNAP, `sdBroken` I:2493, `sdLockedShares` I:2531 | MAIN |
| F094 | Mandate fold (Apex / aggressive growth), margin tiles, Step 2 Deploy (Apex pointer; legacy: ranked buys + chatBtn I:3053), Step 3 Guardrails list | I:2950-2990, I:3001-3087 | rules of the book | sd-rules.js constants | MAIN |
| F095 | Stock ideas / momentum watchlist (`sdIdeasHtml`) - ONLY when `SD_APEX_RUNS=false` | I:2550-2583, mounted I:3055 | legacy | - | MAIN |
| F096 | Pointer cards: Rebalance Log -> Accounts, Screens -> Screens, Agentic -> `setPlanAccount('agentic')`, disclaimer | I:8009-8016 (`pRebal`, `pScreensLink`, `pAgLink` I:7984) | navigation | - | MAIN |
AG side (`renderAgenticPlan` I:4124-4369; host `#plan-agentic-app`):
| ID | Name | Component | Decision | Data | Scope |
|---|---|---|---|---|---|
| F100 | Agentic Strategy hero ("Target as of", age, "The whole plan" help) | I:4175-4183 | target freshness | D.agentic.target.asOf | AG |
| F101 | Where the plan stands (ticket in flight/last ticket, Book, Idle cash, idle-days, next action) | I:4184-4231 (`pendLine` I:4185; card I:4199) | what happens next / is it waiting on me | D.agentic.pending/cash | AG |
| F102 | Model correctness & forward record | I:4074-4123 `agCorrectnessCard`, card title I:4108 | is the model right | D.agentic.correctness | AG |
| F103 | The target - and why these names (weight bars, held tick, per-name levels, method fold, thesis fold) | I:4232-4292 | target allocation | D.agentic.target.names/method | AG |
| F104 | What's blocked - and what clears it (wash-sale, earnings blackout, drawdown & regime banners) | I:4293-4306 ; `agDrawdownBanner` I:4037, `agRegimeBanner` I:4045, `agenticExecMap` I:3396 | why trade deferred | D.agentic.drawdown, D.vix, earnings | AG |
| F105 | Business check (agentic book) | I:4365 `bizCard`, painted I:4367-4369 | company health | `data/business.json` | AG |
| F106 | The waiting ground (parked cash) | I:4307-4322 | parked weight | D.agentic.parked | AG |
| F107 | Guardrails (rule list) | I:4323-4350 | standing rules | static + D.agentic.target.defensive | AG |
| F108 | How the loop runs (research -> target -> ticket -> executor) | I:4351-4364 | education | static | AG |
| F109 | Agentic empty state ("No research target in this snapshot") | I:4137-4143 | data health | - | AG |

### 2.5 Research > Markets (`#page-markets`; shell I:8437-8448; `fetchMarkets` I:8451)
| ID | Name | Component | Decision | Data | Scope |
|---|---|---|---|---|---|
| F120 | Market Overview hero "The Tape" (as-of) | I:8440 ; `setMktAsOf` I:8483 | freshness | D.generatedAtLabel | none |
| F121 | Indexes | I:8441 ; `renderMktTiles` I:8528, `mktTile` I:8523 | market level | D.quotes (RH quotes replay) | none |
| F122 | Risk Gauges (gold, bonds, credit, crypto) + risk-appetite banner | I:8442 ; `riskAppetiteBanner` I:8505 | risk-on/off | D.quotes | none |
| F123 | Sector Heatmap (today / YTD toggle) | I:8443 ; `setSecMode` I:8526 | rotation | D.quotes, D.hist | none |
| F124 | US vs International (YTD chart + stats) | I:8444 ; `renderMktChart` I:8553, `renderMktVsStats` I:8555 | geography | D.hist | none |
| F125 | Macro Signals | I:8445 ; `renderMktMacro` I:8566 | macro | `fetchMacro` I:1253 / D.recorded | none |
| F126 | Breadth, Movers & News | I:8446 ; `renderBreadth` I:8580, `marketMovers` I:8574 | breadth | D.leaders, D.news | none |
| F127 | Retail Buzz (Reddit/ApeWisdom) | I:8447 ; `renderRetailBuzz` I:8493 | crowding | D.social | none |

### 2.6 Research > Screens (`#page-screens`; `renderScreensPage` I:7964; `screensCardsHtml` I:7926)
| ID | Name | Component | Decision | Data | Scope |
|---|---|---|---|---|---|
| F130 | "Reference screen, not your buy list" note | I:7971 `data-sd-screens-note` | scope warning | - | none |
| F131 | Daily Large-Cap Scan hero (+ Run New Analysis, hidden) | `screensHeroHtml` I:7911-7925 | scan age | D.picks.date/ts | none |
| F132 | Top 3 Picks Today (pick cards: signal, entry/TP1/TP2/stop, R/R, thesis, Robinhood + Claude buttons) | I:7929 ; `renderPicksCards` I:8181-8251 (`rhBtn` I:8233, `chatBtn` I:8232) | scan picks (reference) | D.picks.picks + live `fetchPicksLive` I:8408 | none |
| F133 | Composite Scores (bar chart) | I:7933 ; `renderPicksChart` I:8058 | ranking | D.picks.candidates | none |
| F134 | Scoring Breakdown (sector filter, hide-flagged, sortable table) | I:7937 ; `renderPicksFilters` I:8083, `renderPicksTable` I:8118, `sortPicks` I:8097 | compare candidates | D.picks.candidates | none |
| F135 | Track Record (past picks graded) | I:7940 ; `renderPicksTrack` I:8346 (`gradePick` I:8262, `picksEpisodes` I:8291) | did screen work | D.picks.grades/history | none |
| F136 | Catalysts & News (picks) | I:7941 | event risk | D.picks.markets.news | none |
| F137 | Earnings Preview (soonest-reporting top pick) | I:7942 `#picks-earn-card` ; `renderPicksEarnings` I:8027 | pre-earnings view | D.picks, `azEarn` I:7633 | none |

### 2.7 Research > Analyze (`#page-analyze`; shell `renderAzShell` I:6615; result `runAnalysis` I:7758-7864)
| ID | Name | Component | Decision | Data | Scope |
|---|---|---|---|---|---|
| F140 | Ticker search + chips of top holdings + datalist autocomplete + Analyze/📊 Chart buttons | I:6624 ; `azGo` I:6627, `azUniverse` I:6749 | pick a name | SNAP, D.hist, D.recorded | MAIN context (legacy position/sizing sections use self-directed book, J:127) |
| F141 | Pattern Radar ("Scan my holdings & picks") overlay | I:6624 button; `azPatternRadarOpen` I:7543, `azPatternScan` I:7539 | pattern hits | D.hist | MAIN |
| F142 | Chart Analyzer overlay (price chart, RSI sub-chart, timeframe, chart type, pattern detectors H&S, cup, double bottom, flag, triangles, trendlines, S/R, verdict, backtest) | `azCMOpen` I:7130 (canvas I:7141-7142; `azCMDrawChart` I:7397, `azCMDrawRsi` I:7426, `azCMVerdict` I:7437) | read the chart | D.hist (daily + monthly) | none |
| F143 | Ticker header / verdict card | I:7792 | headline read | `analyzeStock` I:6985 | none |
| F144 | Chart-read pill (vs analyze verdict) | I:7796 ; `azChartVerdict` I:7499 | chart vs score | D.hist | none |
| F145 | Flow read card | I:7805-7814 (`data-help="flow read"`) | smart-money read | D.flow | none |
| F146 | Recommendation (+ Claude hand-off / confirm) | I:7716 ; `azRec` I:7680, `chatBtn` I:7754 | what to do | computed | none |
| F147 | Stale History notice | I:7821 | data caveat | - | none |
| F148 | Your Position (shares, avg cost, value, P&L, return) | I:7822 | my exposure | SNAP (`heldInfo` I:7875) | MAIN |
| F149 | Earnings | I:7823 ; `azEarn` I:7633 | event risk | D.recorded earnings | none |
| F150 | Indicators (RSI, SMA50/200, multi-timeframe) | I:7824-7825 ; `azMTF` I:7612 | trend | D.hist | none |
| F151 | Historical Edge | I:7826 ; `azHistEdge` I:7563 | base rate | D.hist | none |
| F152 | Levels & Scenarios | I:7827 ; `azScenarios` I:7573 | support/resistance | D.hist | none |
| F153 | Options Play (est.; defers to real greeks when held) | I:7830 ; `azOptionPlay` I:7587, `azLiveOptions` I:6774 | option idea | D.options | MAIN |
| F154 | Valuation & Catalysts | I:7835 | valuation | overviews | none |
| F155 | Sentiment & Buzz (news + retail) | I:7836-7855 ; `azSocialRead` I:7646 | sentiment | D.news, D.social | none |
| F156 | Overlap With Your Book (correlation) | I:7857 ; `azCorr` I:7639 | diversification | D.hist + SNAP | MAIN |
| F157 | Compare (side-by-side vs another ticker) | I:7858 ; `azCompare` I:7596 | compare | same | none |
| F158 | When This Analysis Is Wrong | I:7859 | invalidation | - | none |
| F159 | Pre-trade confirm modal `#az-confirm` (retired path: `window.azConfirm` is overwritten by Journey to plain navigation) | I:7865-7872 ; J:107 | - | - | - |

### 2.8 Research > Decision evidence (`decisions`) and What if? (`scenario`) - L2 pages
| ID | Name | Component | Decision | Data | Scope |
|---|---|---|---|---|---|
| F165 | Decision evidence, AG: Construction rationale + one card per target name (thesis, entry zone, research stop/target, drivers, dated sources) | E:172-190 `renderDecisions`; `evidence()` experience-model.js:232 | why this target | D.agentic.target | AG |
| F166 | Decision evidence, MAIN: "Saved Apex evidence" cards + "Research view" filter | J:133-157 `mainEvidence`, `filterEvidence`; E:172-176 stub | why Apex research | `data/apex-targets.json` | MAIN |
| F167 | What if? (holding select, price-move slider, shift-to-cash slider, trading-cost bps, bar chart, difference note) | E:192-212 | hypothetical | account snapshot (`M.snapshot`) | selected account |

### 2.9 Signals
| ID | Name | Component | Decision | Data | Scope |
|---|---|---|---|---|---|
| F170 | Smart Money: head + 4 views Feed / Flags / Who's good / Following, "New on your names" chips | S:99-110 `head`; views S:111 `feedView`, S:232 `flagsView`, S:175 `boardView`, S:238 `followingView`; LS `pf_smartmoney_v1` S:7 | follow politician/insider trades | D.flow (STOCK Act, Form 4), D.leaders?, producer smartmoney-perf | none (pinned to held/target names) |
| F171 | Smart Money person drill-down | S:142 `personView` | who is this | D.flow | none |
| F172 | Smart Money ticker drill-down | S:201 `tickerView` | who is moving X | D.flow | none |
| F173 | Predictions head ("Your prediction desk") + 5 tabs Positions / Ideas / Watchlist / Results / Settled | P:114-128, tabs P:14 (`pf_predict_tab`) | prediction-market research | `data/predictions.json` (public raw GitHub fetch P:138-141), D.predictions, D.predictionSettlements | none (account tab AG-independent) |
| F174 | Predict > Ideas (category pills, search, sort, RH-only filter, market cards with spark + research fold) | P:51-59 `ideas`, card P:38, filters P:49, `spark` P:30 | candidate markets | predictions.json | none |
| F175 | Predict > Watchlist (export/import, target checks on fresh snapshot) | P:60-63, import/export P:166-186; LS `pf_prediction_watchlist_v1` P:17 | track markets | LS + predictions.json | none |
| F176 | Predict > Positions (account value, cash, open positions, realized P&L; "not connected" state) | P:64-72 | my event contracts | D.predictions (authenticated feed) | Predict account |
| F177 | Predict > Results (recorded research, hypothetical before fees) | P:74-82 | track record | predictions.json | none |
| F178 | Predict > Settled (payouts chart + rows) | P:83-113 `settledChart`, `settled` | what paid | D.predictionSettlements | Predict account |
| F179 | Predict > legacy "Existing derivatives history" | P:73 | old data | D.realized.predictionMarket | Predict |

### 2.10 Activity
| ID | Name | Component | Decision | Data | Scope |
|---|---|---|---|---|---|
| F185 | Status strip (snapshot age, selected account present, agentic ticket) | E:157-162 | data health | D.generatedAt, D.agentic.pending | selected |
| F186 | Published data | E:163 | what the app received | D.* | selected |
| F187 | Research & execution record | E:164 | agentic state | D.agentic.target/pending | AG |
| F188 | Published record timeline | E:165 | when captured | D.* timestamps | AG |
| F189 | Agentic ticket timeline | E:166-167 | order history | D.agentic.pending.history | AG |
| F190 | Decision history -> Rebalance Log link | E:168 | audit | - | selected |
| F191 | What this app cannot see (live Routine, broker, push) | E:169 | limits | static | none |
| F192 | Rebalance log route | `log` -> Accounts page card (F034 / F053) | audit | D.main/agentic.decisions | selected |

### 2.11 Global / cross-cutting
| ID | Name | Component | Decision | Data | Scope |
|---|---|---|---|---|---|
| F200 | Market tape (Today move, per-account value & %, breadth, SPY QQQ DIA IWM IBIT GLD TLT, VIX, holdings, option expirations, earnings <=14d, agentic breaker/ticket pills, alerts) | K:61-121 `content`, K:14 MARKETS, mount K:123, status pill K:147 | glance / jump | D.quotes, brief model | both (hidden $ in private mode K:21) |
| F201 | Freshness bar (age/stale, Find, version badge, privacy, theme, refresh) | I:931-960 | trust/refresh | D.generatedAt | none |
| F202 | Privacy mode (eye) masks balances/share counts/account numbers | I:8618-8776 (`setPrivacy` I:8766, `togglePrivacy` I:8776); `data-priv` regions on pages I:753-795; LS `pf_private` | screen sharing | DOM | all |
| F203 | Theme Light / Dark / System (button cycles; Today also has a select) | ui/theme.js (`cycle` :110, `set`, `pf_theme`); I:8614-8616; T:186 | appearance | LS | all |
| F204 | Find a feature + My view (pinned cards) | I:6003-6213 | locate card | DOM titles (`pf_card_titles`) | all |
| F205 | Card help "?" popovers (62 entries) | I:5258-5985 | explain card | static | all |
| F206 | Section rail (card chips, expand/collapse all) | I:5122-5242 | in-page jump | DOM | all |
| F207 | Classic view toggle / "Open new navigation" | E:66-69, E:261 | revert layout | LS pf_classic | all |
| F208 | Selected-name journey bar | J:111-131 | keep a symbol across Holding->Research->Plan | LS pf-journey-ui-v1 | selected |
| F209 | Unlock prompt | I:852-871 | decrypt snapshot | data.json envelope, LS pf_pass | all |
| F210 | Duo / compact layout layers (layout only, no cards) | ui/duo.js, ui/duo.css, ui/compact.js (folds long notes into details; wide tables -> stacked rows) | foldable/phone layout | - | all |
| F211 | Business check (data/business.json loader + renderer; display only) | I:2004-2022 `bizLoad`/`bizPaint`; ui/business.js:137 | company health | `data/business.json` | MAIN + AG |
Total feature rows: see section 6 summary.

---------------------------------------------------------------------
## 3. DUPLICATION CENSUS (counted from code; one entry = one rendering location)

### 3.1 Account value / total equity (account-level $ values)
| # | Location | Shows |
|---|---|---|
| 1 | I:4915 | MAIN "Total Portfolio Value" header |
| 2 | I:3579 | AG "Agentic Account Value" header |
| 3 | I:1696 (via I:3583) | AG snapshot tile "Account Value" |
| 4 | T:195 | Today combined equity hero (`#ex-combined-equity`) |
| 5 | T:195 | Today per-account value tiles (2 values, 1 location) |
| 6 | K:73-75 | tape account items |
| 7 | I:4203 | AG plan "Book" |
| 8 | I:3986 | AG card "Account book $X = invested + cash" |
| 9 | I:3949 | AG holdings table footer "book" total |
| 10 | I:2261 | Income & Tax "By Account" Value column (all accounts) |
| 11 | E:97-104 via T:105 | Today "Value over time" latest recorded value + history SVG |
| 12 | I:3720-3721 | AG performance chart "Value $" mode |
| 13 | P:68 | Predict "Account value" (Predict account) |
| 14 | E:128-129,152 | legacy Today fallback hero/accounts/history (not rendered when today.js loads) |
| 15 | I:1605 | Kyle export HTML "Equity / Holdings / Buying Power" (exported artifact, button hidden) |
Count: 13 live UI locations + 1 fallback + 1 export = 15 (Predict is a separate account).
Scenario (E:192-212) and Apex What-if (A:862 Equity tile) show hypothetical equity, not counted.

### 3.2 Daily P&L / day move
| # | Location | Shows |
|---|---|---|
| 1 | I:1697 (mounted I:4916 MAIN, I:3583 AG) | snapshot "Day Change" tile |
| 2 | I:3580 | AG header "today $ (%)" |
| 3 | T:195 | Today hero "Stock move today" + per-account stock move |
| 4 | T:94-104 | Holdings map/list per-name move + biggest drag |
| 5 | T:127 | holding dialog change |
| 6 | I:4660-4722 (mounts I:4917, I:3585) | All Positions "Day" column |
| 7 | I:3941-3949 | AG tracker "Day" column + total |
| 8 | I:4804 (mounts I:4919, I:3591) | Heatmap "Day" mode |
| 9 | K:71,75 | tape "Today" + account % |
| 10 | J:126 | journey bar "Day contribution" |
| 11 | E:123-135 | legacy Today fallback (hero move, What drove your day) |
Count: 10 live + 1 fallback (mount counts: Day Change x2, Positions x2, Heatmap x2).

### 3.3 Shares / cost / price position tables
| # | Location | Fields |
|---|---|---|
| 1 | I:4917 `#pos-table` | MAIN: shares, avg cost, price, value, P&L, day (`_renderPos` I:4660) |
| 2 | I:3585 `#pos-table-ag` | AG: same columns |
| 3 | I:3941-3949 (inside `<details>` I:3586) | AG tracker: shares@avg, value, % book, day, P&L, trade |
| 4 | T:94-104 list rows + T:127 dialog | value, shares per account (dialog) |
| 5 | I:7822 | Analyze "Your Position": shares, avg cost, value, P&L, return |
| 6 | A:525 `sizeLine` | Apex: held shares, $ , target shares |
| 7 | I:2909,3017 | Action Center sell rows: shares @ price |
| 8 | I:4925 | Under-$250 chips (value only) |
| 9 | I:4723 / I:4742 | Tech / Fundamentals per-symbol tables (price-derived, no shares) |
| 10 | P:72 | Predict positions (contracts, avg price, market value) |
| 11 | I:6276 | Option contract cards (contracts, strike, mark) |
Count: shares-bearing tables = 7 (rows 1-7) ; value-only/other = 4.

### 3.4 Price / value-series charts
| # | Location | Series |
|---|---|---|
| 1 | I:1865/1887 | MAIN YTD indexed vs SPY/QQQ (Chart.js) |
| 2 | I:3721/3752 | AG return % or value $ vs SPY (Chart.js) |
| 3 | I:7141/7421 | Chart Analyzer price chart (+ RSI I:7142/7431) |
| 4 | I:8444/8553 | Markets US vs International YTD |
| 5 | P:30 | Predict contract price spark |
| 6 | E:103 | Account value history SVG (Today, via T:105) |
| 7 | P:83 | Settled payouts chart |
Non-price charts: composite bar I:7934/8064; payoff I:6305/6340/6271; treemaps I:4919/3591/8443/T:94; Kyle export perf chart I:1593.
Count: 5 price/performance series + 2 value/payout series.

### 3.5 Buying power
| # | Location | |
|---|---|---|
| 1 | I:1696 | snapshot tile "Buying Power" (MAIN only) |
| 2 | I:4907-4913 | margin banner (uses line = buying power + loan) |
| 3 | I:1912-1950 | Action Center margin feed item |
| 4 | I:3010,3017 | plan margin tiles ("% of your $line") |
| 5 | I:1605 | Kyle export (hidden button) |
Count: 1 direct label + 3 derived + 1 export. AG snapshot swaps the tile for Account Value / Idle Cash (I:1696-1700).

### 3.6 Options chain / Greeks / payoff
- Options chain: 0 (no chain table or fetch; the string appears only inside Claude hand-off prompt text I:1531).
- Greeks: 2 (`optCard` I:6302 fold, `ideaCard` I:6338 fold) + 3 teaching/pointer texts (help I:5667-5668, OPT_KNOWLEDGE I:6349, Analyze Options Play note I:7834).
- Payoff graphs: 2 locations (`optCard` canvas I:6305, `ideaCard` canvas I:6340), one renderer `drawPayoff` I:6269 (N instances: one per contract/idea).
- Implied-vol rank badge `ivRankBadge` I:6241 used in optCard.

### 3.7 Order status
| # | Location |
|---|---|
| 1 | T:83-93 Out of your hands (ticket state) |
| 2 | T:71-81 Waiting on you (ticket needing confirm) |
| 3 | I:4185-4198 + I:4199 AG plan "Where the plan stands" (`pendLine`) |
| 4 | I:3986-3992 AG card "Rebalance in flight" strip |
| 5 | E:157-167 Activity: strip, Research & execution record, Agentic ticket timeline |
| 6 | K:111 tape "Ticket" pill (+K:115 alert items) |
| 7 | I:6277-6278,6578 option state badges + "Pending orders" + fill hint (I:6293) |
| 8 | I:6467-6546 Options Income & History (awaiting settlement) |
| 9 | A:530,546 Apex ticket lines ("armed - trigger in Jarvis") / proposed orders |
| 10 | I:4459 / I:4524 rebalance-log decision rows (open/ahead/behind) |
| 11 | E:149 legacy Today "Agentic at a glance" (fallback) |
Mappers: `ticket()` today-model.js:73; attention rule E-model:207. Count: 10 live + 1 fallback.

### 3.8 Ticker tape
1 (ui/ticker.js, fixed). Adjacent but not tape: Today Market backdrop (T:198), Markets Indexes (I:8441), Analyze quote header.

### 3.9 Watchlists
In-app: Predict Watchlist (P:60, LS `pf_prediction_watchlist_v1`), Smart Money "Following" (S:238, LS `pf_smartmoney_v1`). Legacy-mode only: momentum watchlist `sdIdeasHtml` I:2550 (reachable only with `SD_APEX_RUNS=false`). Producer-side, not UI: `producer/sync-watchlist.mjs`, `sync-option-watchlist.mjs` sync a Robinhood watchlist. Count: 2 live + 1 legacy + 2 producer scripts.

### 3.10 Price alerts
In-app price-alert UI: 0. Closest: Predict watchlist "targets are checked when a fresh snapshot arrives" (P:62); tape alert items (K:115) and Today "Waiting on you" alert rows are status flags, not price alerts; Apex research exit levels (A:530) are displayed, not alarmed. Delivery of price/level alerts is producer/agent-side: `producer/alerts.mjs` (stop/target crossings etc.) -> push by agent (alerts.mjs header). Count in-app: 0 (1 watch-target check).

---------------------------------------------------------------------
## 4. NAMED CAPABILITIES: where they live and how to reach them today

| Capability | Where | Reach path (visible L2 nav) | file:line |
|---|---|---|---|
| Apex scanner (weekly research -> `data/apex-targets.json`: `top5`, `heldLevels`, `vetoed`, `targets`, `themeMap`...) | Producer-side scheduled "research scan" (Friday 7:12 AM per code comment I:2092); file fetched by app | not a screen; read by Apex card, Today, Decision evidence | I:2039 fetch; data/apex-targets.json keys |
| Ranked candidates | Apex card: "Research - top 5" tiles + "Ranked opportunities" (Buy list/Blocked/Close/Watch) + veto block | Research > Plan & Action Center (MAIN) > Apex card (collapsible `#b-apex`) ; also Decision evidence (MAIN) | A:818-855, A:796-815, A:716; I:7987 |
| Confirm / whole-book confirmation | (1) Today > Waiting on you > "Confirm with Claude"; (2) Apex card > book list > Confirm link; (3) per-trade `chatBtn` hand-offs (plan sells I:2923, plan buys I:3053, AG deploy I:3993, pick cards I:8232, Analyze rec I:7754, option ideas I:6341) | Today ; Research > Plan | T:50-66, T:137-148; A:678-693; I:1534-1553 |
| "Waiting on you" vs "Out of your hands" | Today only (labels exist nowhere else in index.html/ui) | Today (default screen) | T:71-93; today-model.js:73 |
| Agentic targets | Plan (AG) "The target" card + Accounts AG "Target comparison & trade review" + Decision evidence (AG) | Research > Plan & Action Center with Agentic toggle | I:4232, I:3586, E:172 |
| Agentic drift / execution states | Accounts AG tracker (drift, trade col), Plan AG "Where the plan stands", "What's blocked", "waiting ground", Activity tickets, Today F007, tape pills | Portfolio>Accounts (Agentic), Research>Plan (Agentic), Activity, Today | I:3941-3993, I:4199-4322, E:157-167, T:83 |
| Options / covered calls | Options page (exposure, income & history, roll scorecard, your options, ideas, CC income ranker, CSP ranker, income ideas); covered-call share locks in Action Center plan; Today options disclosure/expiry rows | Portfolio > Options | I:6567-6606; I:2531, I:2914; T:105 |
| Analyze | single-stock deep dive + Chart Analyzer + Pattern Radar + Compare | Research > Analyze; also tape symbol tap (K:141), Today holding dialog, journey step 2 | I:6614, 7758 |
| Predict | 5-tab desk (Positions, Ideas, Watchlist, Results, Settled) | Signals > Prediction markets | P:114 |
| Smart $ | Feed / Flags / Who's good / Following + person & ticker drill | Signals > Smart Money (default Signals sub-tab) | S:99-253 |
| Signals | = area containing Smart Money + Prediction markets (v184) | bottom/side nav "Signals" | E:21-22, E:44 |
| Activity | published-data/ticket status page + Rebalance log chip | nav "Activity" | E:157-171 |
| Markets | 7 cards | Research > Markets | I:8437 |
| Screens | daily oversold scan, reference only | Research > Screens | I:7964 |
| Business Check Writer | NOT app code. A scheduled task ("Business check writer", Fridays 8:17 AM ET, per CLAUDE.md:722) writes `data/business.json`. The app only displays it ("Business check" tiles). No file named "writer" exists in repo (grep). | display: Apex card slot (F084) and Plan AG (F105) | CLAUDE.md:708,722; I:2004-2022; ui/business.js:137; data/business.json (7 names) |
| Privacy mode | eye icon in freshness bar; masks `data-priv` regions | every screen | I:943, I:8766 |
| Light/Dark/System | freshness-bar button cycles (I:8616 -> `PFTheme.cycle` theme.js:110); Today select (T:186); legacy 'gold' attr = Dark | every screen | theme.js:8-110 |
| Robinhood links | see list below | | |

### 4.1 Robinhood / external URL patterns (complete grep of index.html, ui/*.js, sw.js, manifest)
| Pattern | file:line | Notes |
|---|---|---|
| `https://robinhood.com/stocks/<SYM>` | I:1486 `rhUrl()`; I:1487 `rhBtn()` used at I:6342 (option idea "Open <SYM> in Robinhood -> Options") and I:8233 (pick cards) | `window.rhUrl` I:1488 |
| `https://robinhood.com/stocks/<SYM>` | A:707 "Open in Robinhood ↗" in `levelsHtml` | Apex rungs |
| `https://robinhood.com/us/en/prediction-markets/` | P:66 (Predict not-connected state), P:120 (header) | |
| `https://robinhood.com/us/en/prediction-markets/<category>/events/<slug>` | in data/predictions.json `robinhoodLinks`; rendered via `openLink` P:28 after `safeUrl` predictions-model.js:8 (allows kalshi.com, robinhood.com, www.robinhood.com, https only) | |
| `robinhood://` | none found | no deep links of that scheme |
Other outbound: `https://claude.ai/new?q=<prompt>` I:1538, I:1547, A:691, T:146 (hand-offs); Jarvis artifact `https://claude.ai/artifact/...` A:67; Chart.js CDN I:48; raw.githubusercontent predictions feed P:138.

---------------------------------------------------------------------
## 5. COULD NOT DETERMINE / CAVEATS
1. Actual `data.json` keys: file is encrypted; key list in section 2 is inferred from `window.__DATA.<key>` references (agentic, main, options, flow, picks, hist, quotes, recorded, realized, social, news, leaders, earnings, vix, predictions, predictionSettlements, notes, generatedAt, generatedAtLabel). Sub-fields not verified.
2. Help-entry count: 62 `tag:` lines matched in HELP (I:5265-6002); the table may hold more entries in other formats.
3. Whether Screens/Predict/Smart$ cards receive collapse/rail/help/Find treatment: the page-id lists at I:5116, 5133, 5997, 6022 do not include them; no other mechanism was checked.
4. `dash_tab` restore whitelist behaviour with the experience layer: written I:5046; the reader was not traced.
5. Exact source of each Markets quote/macro series (live MCP vs replay) per card: not traced beyond `fetchMarkets` I:8451.
6. "Apex scanner" schedule (Friday 7:12 AM ET) is documented only in comments/CLAUDE.md; no scheduler code in repo was inspected (`.claude/workflows/agentic-research.js` exists for the agentic target, not read).
7. Whether the L2 `Today` fallback renderer (E:117-155) can still be reached in production: only if `ui/today.js` fails to load; not tested.
8. Classic mode: tab bar returns but Back/hash/journey are absent; `PROPOSAL-app-structure.md` (v98, 5-tab proposal) is stale vs current code; `UI-PRESERVATION.md` (v162-v232) and `ui/TODAY.md` (v229/v232) match current code for Today, five-area nav and Light/Dark/System.
9. Not verified in a browser; all conclusions are static reading. No tests, producer, or executor were run. `git status` in repo is clean.
10. `HELP`, `Find`, and some prompt-builder behaviours (`eqTradePrompt` I:1494, `planOrdersPrompt` I:1510, `optTradePrompt` I:1521) were read only at the call sites.

---------------------------------------------------------------------
## 6. COUNTS
Feature rows in section 2: F001-F016 (16) + F020-F036 (17) + F040-F054 (15) + F060-F070 (11) + F080-F096 (17) + F100-F109 (10) + F120-F127 (8) + F130-F137 (8) + F140-F159 (20) + F165-F167 (3) + F170-F179 (10) + F185-F192 (8) + F200-F211 (12) = **155 rows** (of which F016, F022, F095, F131 run-button, F159 are fallback/hidden/legacy/retired).
Routes: 21. Areas: 5. Classic tabs: 8. Account-toggle controls: 3. Native pages: 8 (`page-portfolio|picks|markets|options|analyze|screens|predictions|smartmoney`) + 4 L2 pages.

---

# Appendix B — Data sources, client-side contracts, protected rules, tests

# B — Data contracts, calculation contracts, protected rules, test baseline (Dashboard 2.0 safety map)

Repo: repo, app/cache version v233 / pf-v233 (index.html:~850 `APP_VERSION='v233'`, sw.js:9). READ-ONLY audit. `git status` clean at end.
Notation: `file:line`. "ONLY caller" = hiding/removing that card orphans nothing; "SHARED" = other features read the same code/state.

## 0. Read-me-first findings (the things that would bite a redesign)

1. **data.json is AES-GCM encrypted** (`{enc,v,iter,salt,iv,ct}`, verified by parsing the file; no plaintext keys). Top-level keys below are derived from `producer/build-data.mjs` and consumer greps, NOT from decrypting. Do not decrypt.
2. **Apex engine runs client-side and is independent of the Plan card's DOM.** `renderApexCard` computes `__PF_APEX_REVIEW` even when `#apex-content` is absent (`if(el)Apex.render(...)`, index.html:~2095-2096). Today calls it itself (`ui/today.js:32`, `window.renderApexCard(snapshot,{fromToday:true})`). Hiding the Apex card UI orphans nothing; **removing the `renderApexCard` call, `window.__SNAP`, or the `data/apex-targets.json` fetch (index.html:2039) breaks Today, the Confirm prompt, Plan sell note, Journey evidence.**
3. **Render functions double as data stashers.** `renderPerformance` writes `window.__SNAP.perf` (index.html:1843), which the Snapshot "YTD" fallback tile (index.html:1689) and the Kyle export (index.html:1576) read. `load()` stashes `betaInfo/riskMetrics/corrG/histMap/rsiMap/smaMap/alloc/income/harvest/ovMap/earn` into `__SNAP` (index.html:4953,4957,4967,4972); `ovMap/smaMap` are consumed by the Agentic card (index.html:3768-3769), Action Plan (2129) and Analyze. Early-returns like `if(!el)return;` (e.g. index.html:1797 `perf-content`) skip the stash. **A redesign that removes a card container must keep the compute+stash step.**
4. **Replay shim**: UI never calls a broker. `window.cowork.callMcpTool` is replaced by a snapshot lookup (index.html:~895-915): quotes from `data.quotes`, bars from `data.hist[interval]`, everything else by exact key in `data.recorded` (`makeKey`, `producer/key.mjs`). The portfolio page itself is built from `recorded` keys `get_portfolio`/`get_equity_positions` (index.html:4859-4866) -> `enrich` -> `S.stats`/`S.enriched`. Missing key => `{__replayMiss}` (index.html:~915).
5. **Several index.html blocks are hand mirrors of producer code and are pinned by producer tests** (see §5b): `AG_*` constants mirror `producer/agentic-deploy.mjs` (index.html:3305-3330 comment "mirror … exactly"); `AG_WASH_WAIVED` mirrors `WASH_WAIVED` (index.html:3352 vs producer/agentic-deploy.mjs:255); `sdLockedShares` mirrors `producer/options.mjs sharesLockedByShortCalls` (index.html:2531 comment). Changing one side silently diverges.
6. AGENTS.md:47 says "four synthetic browser suites"; `.github/workflows/tests.yml` actually runs **six** Chromium suites + one WebKit run (see §4). `tests/predictions-browser.mjs` exists but is **not referenced by any workflow** (grep of `.github`, `tests/*.mjs`: no hits).

---

## 1. Data sources

### 1a. Files / feeds

| Source | Produced by (as stated in repo) | Freshness / staleness fields | Consumed by (file:line) |
|---|---|---|---|
| `data.json` (encrypted envelope; payload keys in 1b) | Scheduled Claude Code agent -> `node producer/run.mjs` -> `build-data.mjs` -> `emit.mjs` encrypt -> push to `main` (CLAUDE.md:1817-1845; producer/SCHEDULING.md). Optional Railway path `producer/railway/` | `generatedAt` (ISO), `generatedAtLabel`; freshness bar amber at >=3h (index.html:~946 `ageH>=3`); watchdog issue at >90 min while market open (.github/workflows/freshness.yml:~64 `THRESHOLD = 90`); SW `data.json` network-first, 20s timeout, separate `pf-data` cache (sw.js:~13-20, ~80-105); resume re-fetch after >=5 min hidden (index.html:~970-980) | index.html:831 `loadData()` -> `window.__DATA` (index.html:889); freshness bar index.html:~928-960; today `M.age(data.generatedAt)` experience-model.js:72,~190 |
| `data/apex-targets.json` (keys: asOf, rulesVersion, core, coreOwner, targets, pickBudget, themeMapVersion, themeCap, themeMap, blockedByTheme, clusterCap, blockedByCap, added, removed, top5, heldLevels, vetoed, gatedCount, universeCount, record, notes — verified by parsing) | NOT this repo's producer. Apex "morning scan 0741" scheduled task writes Jarvis `os/apex-targets`; the "Business check writer" task (Fri) copies it to this file (CLAUDE.md:726, 776-784). `apex-targets` not referenced in any producer/*.mjs or workflow | `asOf` ISO; `cfg.researchReady` = age in [-5 min, 8 days] (index.html:2044-2046; APEX-DECISIONS.md:14); `scripts/validate-data.py:18` lists it as REQUIRED | index.html:2039 fetch -> `window.__APEX_TGT`; cfg.targets/levels/exitLevels/themeMap index.html:2044-2058; research tiles + `Apex.opportunities(T)` (ui/apex.js:755, index.html research object `opps`); `ui/journey.js:116,135` (`w.__APEX_TGT?.top5`); today via `__PF_APEX_REVIEW` (ui/today.js:32-44); tests inject it (tests/journey-browser.mjs:22) |
| `data/business.json` (schema, updated, about, names) | "Business check writer" scheduled task Fridays (CLAUDE.md:722-728); validated by `producer/business.test.mjs` (in data-integrity.yml:34) | per-record `asOf`/review dates; `MAX_AGE_DAYS=120`, `GRACE_DAYS=7` -> "Unverified" (ui/business.js:25-26) | index.html:2010 `bizLoad()` fetch (single fetch site pinned by test: producer/business.test.mjs:194); `ui/business.js` `forSymbols/render`; slots `[data-apex-business]` + `[data-ag-business]` |
| `data/predictions.json` (schemaVersion, generatedAt, markets, featured, ideas, coverage, method …) | `.github/workflows/predictions.yml` cron `7,22,37,52 * * * *` -> `node producer/predictions-fetch.mjs` -> direct push (predictions.yml:5,27,34); sole writer | `generatedAt`; `M.isFresh(asOf, now, 45 min)` (ui/predictions-model.js:22); account capture 90 min (ui/predictions.js:67) | ui/predictions.js:136-145 fetch (raw.githubusercontent.com `main` first, local file fallback; local dev uses local file); SW network-first special case (sw.js:~66-76) |
| `producer/agentic-target.json`, `agentic-pending.json`, `agentic-decisions.json`, `main-decisions.json`, `agentic-parked.json`, `analyze-calls.json`, `policy.json`, `macro.json` | Committed producer state; read by `build-data.mjs` and folded INTO encrypted data.json (build-data.mjs:374,688,697-702,724,592-604). Executor may commit only pending/decisions/parked, never data.json (CLAUDE.md:1883-1886) | `asOf` inside each; target `asOf` research age; zone staleness `AG_ENTRY_STALE_D=7` (index.html:3312) | not fetched by UI; arrive as `data.agentic.target/pending/decisions/parked` |
| Chart.js CDN `cdn.jsdelivr.net/npm/chart.js@4.5.0` with SRI (index.html:48) | external | n/a; SW cache-first for shell | index.html charts (`applyChartTheme` :1065); **external runtime dependency** |
| Service worker caches (`pf-v233` shell, `pf-data` snapshot) | sw.js | shell list sw.js:~18-50 must contain every `ui/*?v=233` asset (tests/journey.test.cjs:37-40) | n/a |
| `producer/raw/*` | gitignored per-run scratch (not published). Tests recreated `producer/raw/` during my run; I deleted it | n/a | producer only |

No other `fetch(` in ui/*.js besides predictions (grep: ui/predictions.js:140 only; sw.js internals). index.html fetches: `./data.json` (831, 973), `./index.html` force-update (921), `data/business.json` (2010), `data/apex-targets.json` (2039).

### 1b. data.json decrypted payload — top-level keys (from producer/build-data.mjs; NOT decrypted)

| Key | Set at | Freshness/provenance field | Main consumers |
|---|---|---|---|
| `schemaVersion`, `generatedAt`, `generatedAtLabel`, `refreshInputs{checkedAt,…}` | build-data.mjs:348-352 | self | freshness bar index.html:928-960; `refreshInputs`/`fetchDays` have **no UI consumer found** (grep index.html/ui: 0 hits) |
| `recorded` (replay store of broker/AV tool responses by makeKey) | :353 | per-call; snapshot-level | `window.cowork` shim index.html:~895-915 -> `load()` 4859+ (portfolio/positions), AV overviews `azOverview` 6694, options/earnings feeds |
| `quotes` | :353 | per-quote `updated_at` | shim; `azQuote` index.html:6673; ui/ticker.js:36-40; experience-model.js:~50,~191 (`adjusted_previous_close`/`previous_close`) |
| `hist{day,month}` | :353 (merged at bar level via `histbars.mergeHist`, compacted) | per-series last bar date; `azHist` quality 'stale/aging/none' (index.html:6649) | shim historicals; `azHist/azBars` 6649-6672; `renderPerformance` 1796; `sdMomentum` 2410 (`_sdCloses` 2396); `_sdMom` keyed on `generatedAt` 2395 |
| `leaders` | :353 | none | index.html:3813 (Ideal Portfolio/agentic bench) |
| `agentic` {asOf, cash, buyingPower, equity, positions[], equityHistory[{t,equity,cumFlow}], drawdown, target, pending, decisions, parked, recentLosses, skill…} | :414,432,453-485,592-604,606-682,688,701,724+ | `asOf`; `target.asOf`; `equityHistory[].t` | Agentic page/cards index.html:3538-4520 (`agenticBook` 3538, `agenticDay` 3559, `renderAgenticCard` 3762, `renderAgenticPlan` 4124, `renderAgenticLog` 4459); experience-model.js:15-70,79,118; ui/journey.js:116; sdWashMap/agenticWashMap (`recentLosses` spans BOTH accounts) 2508, 3352 |
| `main` {asOf, equity, cash, optionsValue, sleeveValue, basisResidual, equityBasis, positions, equityHistory} | :560-566 | `asOf`; `basisResidual` | acctPerfStats/acctYTDStats 1731/1783 (index.html:1677,1690,1854); experience-model.js:79,118,131-150,~182 (`basisResidual` alert) |
| `options` (positions, pending, ideas, exposure, incomeHistory{version,trades,unresolved,awaitingSettlement}, asOf) | build-data.mjs:1003-1004 | `options.asOf`; ledger `version===2` | renderOptions 6567; sdLockedShares 2531; experience-model.js:~178-189 |
| `realized` {year, asOf, source, accounts{main,agentic}…, approx} | :1067-1113 | `asOf`, `approx` | renderIncomeTax 2223; accountRollup 1424; options reconciliation experience-model.js:~186 |
| `flow` {asOf, symbols{…}} (politician/insider/revisions) | :918 | `flow.asOf` | renderFlowCard 4576; ui/smartmoney.js:33,139 (`flow.asOf` shown); `PFSmartMoneyModel` |
| `picks` (+`picks.markets`) | :945-946,1229 | scan date inside | Screens/Plan pick cards (index.html:7891 region), pickgrade track record |
| `vix` {v, asOf} | :880 | `asOf` | ui/ticker.js:83; experience-model.js:~192; agRegime index.html:4020 |
| `news`, `social`, `notes`, `earnings` | :1130,1162,1208; earnings optional (read index.html:7634) | per-item dates | azNews 7641, azSocial 7643, plan note index.html:2190, azEarn 7633 / `dailyBrief` earnings experience-model.js:~175 |
| `predictions`, `predictionSettlements` (private Predict account + settled ledger; encrypted only) | :1283-1297 | `asOf`; mailbox status | ui/predictions.js:20-21,67 |
| `fetchDays` | :852 | per-day fetch bookkeeping | no UI consumer found |

### 1c. localStorage / sessionStorage keys

| Key | Where | Holds |
|---|---|---|
| `pf_pass` | index.html:851,881-882,963 | **the data.json passphrase** (plaintext in localStorage). Cleared on bad-pass/Unlock |
| `pf_acct` | index.html:3242,3284,3302,8610; ui/experience.js | selected account (`main`/`agentic`) |
| `dash_tab` | index.html:5044,8607 | last tab (legacy) |
| `pf_private` | index.html:8769,8779 | privacy mode on/off |
| `pf_theme` | ui/theme.js:8,23,26 | light/dark/system; dark stored as legacy `gold` |
| `pf_today_view` | ui/today.js:26,159 | map/list |
| `pf_classic`, `pf_experience_route`, `pf_area_<area>`, `pf_signals_last` | ui/experience.js:46,66-69,233 | Classic-view flag, last route per area |
| `pf-journey-ui-v1` (localStorage), `pf-journey-v1` (sessionStorage) | ui/journey.js:33,50 | selected symbol/query/evidence filter per account; route state |
| `pf_predict_tab`, `pf_prediction_watchlist_v1` | ui/predictions.js | watchlist targets (user data; export/import) |
| `pf_smartmoney_v1` (+`_ui`) | ui/smartmoney.js:7-14 | follows/flag choices |
| `pf_az_last`, `pf_az_cmp` | index.html:6614,7762,7599,7862 | Analyze last/compare ticker |
| `pf_pins`, `pf_card_titles` | index.html:6025 | My view pins keyed by **card title** (a renamed/moved card loses its pin/help) |
| `pf3_<key>` | index.html:1073-1074 | TTL cache of AV calls (`cacheGet/cacheSet`) |

---

## 2. Client-side calculation contracts

### 2a. Apex (ui/apex.js — pure, require()-able, tested by producer/apex.test.mjs 64/64)

| Contract | Where | Inputs | Callers / orphan test |
|---|---|---|---|
| Leverage band: reload 1.75 / cruise 1.90 / cap 2.00 (`C.LEV_RELOAD/NORMAL/CAP`); `band` = over/high/room/normal | ui/apex.js:~17-19, state() :~148 | positions (qty,px,avg,maint), cash (debt = -cash), equity | SHARED: rules A2 (:~262), buyBlock (:~423), Today leverage text; `sdApexBand()` index.html:2384 reads `Apex.C` |
| Maintenance blend + risk guard (equity/exposure < req+5pts sells to req+10pts), per-name `maintBy` IREN .30 AMZN .25 PLTR .25 | state() :129-153; guardPlan :178; rules A1 :~226; DEFAULT_CFG.maintBy; adapter index.html:2062 (pinned by apex.test.mjs:419) | `st.maintReq`, per-name maint | SHARED (sells in Confirm book) |
| `tripwire(st,sym,pct)` price at which guard line hits | ui/apex.js:155 | position, debt | card only? used by `render` (:502) — display |
| Theme cap v2.8: tech <= 40% of stock outside core; `classOf/themeOf/themeShare/themeRoom`; fail-closed unclassified=tech; scan label normalized | ui/apex.js:~42-119, buyBlock :~429-432, build rung sizing :~311 | `cfg.themeMap` (from apex-targets), TECH list, positions | SHARED: gates every buy in `rules`, `bookGaps`, `bookLines`, prompt; "Tech outside IREN" bar `themeHtml` :559 is display-only |
| Levels / R/R: `levelsFor` (limit default trigger*1.01; rr=(tp1-limit)/(limit-stop); owner-entered stop dropped -> 2xATR estimate flagged `ownerStop`) | ui/apex.js:390-406 | `cfg.levels[sym]` from `top5` | SHARED: buyBlock, bookLines, Today price rail `T.levels(Apex.levelsFor(...))` ui/today.js:44 |
| `exitLevelsFor` held-exit levels take precedence; ownerStop stop nulled | ui/apex.js:408 | `cfg.exitLevels` from `heldLevels` | SHARED: rules A4b research exits |
| `buyBlock` entry gate (research ready, wash hold, lev>=cruise, valid `0<stop<limit<tp1`, R/R>=1.5, tradable, order type, maxPx, theme room) | ui/apex.js:415-433 | cfg+state | SHARED (rules, reconcile, bookGaps) |
| Per-name sizing: `min(20% eq name cap, target%*eq, room*share)` , `floor(alloc/limit)` | rules A6 :~296-330 | targets, room = 1.90*equity - exposure | SHARED |
| Winner/loser: +25%/+50% milestones are **review only**, -25% stop, core exempt | rules A3/A4 :~268-285 | avg cost | SHARED |
| `reconcileRules` one action per symbol, sells capped at holding, protective > optional | ui/apex.js:436 | rows | SHARED (count/prompt/Today parity, tests/apex-browser) |
| `bookLines/bookReviews/planSellNote/portfolioPrompt/portfolioButton` — trade list, order count, Confirm prompt, Plan step-1 sell note | ui/apex.js:598-693 | st,out,cfg,research | SHARED: Today `ui/today.js:34-36,146`; Plan note index.html (`[data-sd-apex-sells]`); **Confirm button is the only broker-hand-off path** |
| `priceIsFresh` 75-min rule (`C.PRICE_FRESH_MIN`) -> "≈ estimate" instead of order price | ui/apex.js:646 | `cfg.snapAgeMin` from `generatedAt` (index.html:2049) | SHARED |
| `opportunities(T)` ranked buckets (qualified/restricted/near/watch) | ui/apex.js:755, `oppBlock` :796 | apex-targets rows | **Display only** (CLAUDE.md:14-15; test asserts `rules()` unchanged) -> ONLY caller is the research block, safe to relocate/hide |
| `renderWhatIf` sliders (core, donor) | ui/apex.js:856 | state | display only |
| Business check | ui/business.js | business.json | **Display only**; test asserts apex.js never references it (producer/business.test.mjs) |

### 2b. index.html adapters and self-directed formulas

| Contract | Where | Inputs | Other dependents? |
|---|---|---|---|
| `renderApexCard` adapter: builds `state`, cfg (targets, levels, exitLevels, wash map, researchReady, snapAgeMin), runs `Apex.rules`, stores `__PF_APEX_REVIEW` | index.html:2026-2105 | `S.stats.totalVal/cashVal`, `S.enriched`, `S.smaMap`, `S.earn`, `__APEX_TGT`, `sdWashMap/sdWashIgnore` | SHARED (Today, Journey, Plan note). Card DOM optional |
| `enrich` P&L: val=px*qty, pnlD=val-cost, pnlP=pnlD/cost, dayP via `prev`, pct of total | index.html:1121 | qMap, positions | SHARED (everything) |
| `sdMargin` (line=bp+debt; util=debt/line; brokerRoom; lev), `sdCallDrop` (equity-0.25*lmv)/(0.75*lmv) | index.html:2464-2481 | equity, exposure, cash, bp | SHARED: plan 2631, do-now feed 1912, accounts banner 4907 |
| `sdBroken` (50DMA<100DMA & price < 100DMA*(1-buf), or -25% from cost), `sdMomentum`, `sdStop` | index.html:2493,2410,2456 | `hist.day` closes | SHARED: Apex `rules` via global (ui/apex.js references `sdBroken`/`sdMomentum`), action feed 1956, plan 2604 |
| `sdWashMap` (30-day cross-account) + `sdWashIgnore` (default `['PLTR']`) | index.html:2508,2507; `SD_WASH_DAYS=30` 2330 | `data.agentic.recentLosses` | SHARED: Apex adapter 2072, plan 2598 |
| `sdLockedShares` (100 sh per short call) | index.html:2531 | `data.options.positions/pending` | SHARED: exits and paydown; mirrors producer/options.mjs |
| `renderActionPlan`/`buildActionFeed` (SD_FLOOR, SD_MIN_RR 2.0, cluster cap .30, name cap .20 via ui/sd-rules.js `allocate/entryGate/sizeMul/stopPct`) | index.html:2584, 1895; ui/sd-rules.js:272 etc | momentum, ovMap, earnings | Plan page; `window.SD_APEX_RUNS=false` revives old plan (UI-PRESERVATION.md:16) |
| `acctPerfStats`: deposit-adjusted TWR (per-step `(equity-flow)/prev-1`, legacy >20% jump zeroed only if untagged, `basisShift` skipped), net flow, P&L=last-first-netFlow, SPY since first date | index.html:1731-1782 (also `window.acctPerfStats`, `agenticPerfStats`) | `equityHistory[{t,equity,cumFlow}]`, SPY bars | SHARED: Performance card 1833/1854, Agentic perf 3694, YTD tile (via acctYTDStats 1783 -> 1678). Producer-side parity: producer/equityseries.mjs |
| `recordedAccountReturn` | index.html:4053 (extracted by producer/agentic-account-return.test.mjs:17) | history window | Agentic correctness card (4089-4090) |
| `renderPerformance`: benchmark-normalized YTD series; **side effect `__SNAP.perf`** | index.html:1796,1843 | `hist.day` for held+SPY/QQQ | SHARED (Snapshot YTD fallback 1689; Kyle export 1576) |
| Risk metrics / beta / corr / cluster sums / allocation / income & harvest | computeRiskMetrics 4837, clusterSums 1134, computeAllocation 1333, computeIncome 1352, harvestCandidates 1380, accountRollup 1424 | hist, enriched, ovMap | stashed to `__SNAP` (4953,4967); consumed by Kyle export, agentic page (3640-3673), income card. computeBeta (1318) has no caller found |
| Agentic deploy mirrors: `agenticBuyGap`, `agenticExecMap` (earnings blackout 7d, tolerance 2.5%, premium 2.0%, zone stale 7d, buy gap >0.5), `agenticWashMap` (waived NVDA) | index.html:3375,3396,3352; consts 3309-3325 | target rows, quotes, wash ledger | SHARED: Agentic card 3854, Plan 4153-4157. **Mirrors producer/agentic-deploy.mjs** |
| `AGENTIC_DRIFT=5` pp drift per name `x.drift=x.cur-x.tgt` | index.html:3112, 3837, 4152 | book, curVal, tgt | SHARED (card + Plan) |
| `agenticBook/agenticDay` (value-desc sort; day move = sum qty*(px-prevClose) over quoted names only) | index.html:3538,3559 | `data.agentic`, quotes | SHARED (card, perf, analytics) |
| Options: `payoffSeries` (legs/covered), `_estPrem` / `azOptionPlay` / `azScenarios` estimates; `optIncomeHistory` | index.html:6245,7584,7587,7573,6467 | `data.options`, vol proxy | payoff = chart only; `optIncomeHistory..renderOptions` text extracted by producer/option-history-ui.test.mjs:6 |
| Analyze scoring `azCore`, `_azStateScore`, `azRec`, `azEdgeStats` | index.html:6830,6796,7680,6944 | bars, SPY | Analyze + scanner; extracted verbatim by producer/analyze-core.test.mjs:19-41 |

### 2c. ui/*-model.js display models (pure; unit-tested via tests/*.cjs)

| Contract | Where | Notes |
|---|---|---|
| Unknown-is-not-zero normalizer `number()` (null for blank/non-finite) | ui/experience-model.js:8 | used everywhere; missing quote/cost -> null |
| `agenticPositionRows` (pct of own book, null when any lot unvalued; keeps unquoted lots) | experience-model.js:15 | ONLY caller path: Agentic All Positions (`_renderPos`, index.html:4660) + tests/holdings.test.cjs |
| `snapshot` per-account day move (quoted names only; `partialDay`) | experience-model.js:40 | SHARED: `dailyBrief` -> Today |
| `combinedHistory` joins identical dates only, last 30; `valueHistory` (flows included, "not a return series") | experience-model.js:118, 79 | Today "Value over time" |
| `dailyBrief` combined equity (needs both accounts), positive cash vs margin debt separate, attention flags (snapshot >=180 min, account capture older, residual, options expiry <=7d, earnings <=7d, drawdown soft/hard, pending ticket) | experience-model.js:153-218 | SHARED: Today, Activity/Sources. Deleting attention flags drops "stale/unreconciled stays explicit" |
| Options reconciliation (broker YTD options vs matched ledger within $0.005, ledger v2, none unresolved) | experience-model.js:~186-190 | display; keep |
| `scenario` (What if: shock, shift, cost bps; bounds) | experience-model.js:221 | local arithmetic only |
| `evidence(target,ticker)` (https-only links) | experience-model.js:232 | Decisions page |
| Today: `holdings`, `treemap`, `ticket` (ownership states), `levels` (rail requires stop<limit<target), `biggestDrag` (complete contributions only) | ui/today-model.js:11-110 | Today only |
| Smart $ / Predict models (`ideaScore`, `selectIdeas`, `isFresh`, `targetStatus`, `board`, `flags`) | ui/smartmoney-model.js, ui/predictions-model.js | Signals tab only |

---

## 3. Protected rules (verbatim short quotes)

| Rule | Source |
|---|---|
| "UI/process work cannot change scores, risk limits, stops, account permissions, external orders, research grades or scheduled-task authority." | AGENTS.md:26-27 |
| "Preserve Apex versus Agentic separation, source/freshness checks, encrypted records, privacy mode, owner-managed exceptions, and whole-book confirmation." | AGENTS.md:24-25 |
| "Missing research or failure of new-entry eligibility is not a held-position exit." | AGENTS.md:28 |
| "Unknown, stale, incomplete and zero are different." | AGENTS.md:32 |
| "Reject account cross-talk, altered execution authority, secret exposure, data loss, missing-is-zero logic" | AGENTS.md:53-54 |
| "Do not run the producer or executor to test a UI change." / UI work needs narrow+expanded layouts, Back/refresh, account selection, privacy | AGENTS.md:47-49 |
| "No live trade, purchase, listing, production credential, or decrypted-account test." | AGENTS.md:30 |
| "Section links scroll to original cards instead of copying or reimplementing their calculations." / original five pages "and all their contents" stay | UI-PRESERVATION.md:3-4 |
| Destination map (every row must still resolve: Accounts, All positions, Performance/Heatmap, Risk, Income & tax, Options, Plan/Action Center, Screens, Markets, Analyze, Rebalance log) | UI-PRESERVATION.md:7-22 |
| "Light / Dark / System … keeping the `gold` CSS namespace and existing stored choices. Five-tab navigation, account scopes, privacy and v222 Duo rail behavior are retained." | UI-PRESERVATION.md:27-29 |
| "Trades and prices above Confirm come from the same Apex `bookLines` as the unchanged whole-book Claude prompt. No new execution path is added." | UI-PRESERVATION.md:30-31 |
| "`Waiting on you` distinguishes owner approval from `Out of your hands` … does not equate a submitted or complete ticket with confirmed broker fills." | UI-PRESERVATION.md:31-33 |
| "Today history … uses only matching daily records, and has no 1D/intraday view." | UI-PRESERVATION.md:34-35 |
| Today is one combined brief; "Totals require both recorded account values. Shared tickers aggregate across accounts; positive cash and margin debt stay separate. Stock contributions do not represent full account return." | UI-PRESERVATION.md:55-58 |
| "Missing, stale and unreconciled evidence stays explicit." | UI-PRESERVATION.md:60-61 |
| "Activity … snapshot does not provide live Claude run health, broker reconciliation, or push-delivery receipts; these remain unavailable." | UI-PRESERVATION.md:62-63 |
| "Decision evidence is for the agentic target only. It preserves research dates, recorded thesis, source dates and links, and missing evidence labels." | UI-PRESERVATION.md:64-65 |
| "What if … cannot change a target or place a trade." | UI-PRESERVATION.md:66-67 |
| "The UI version, cache version, and versioned shell asset URLs must move together." | UI-PRESERVATION.md:73-74 |
| Held vs new-buy: "Held name absent from targets | Review / no add. Omission is not an exit instruction"; "Held name fails entry R/R | No add; independently evaluate its held exit plan" | APEX-DECISIONS.md:12-13 |
| "Finite `0 < stop < limit < target`, R/R at the executable limit ≥ 1.5 …" | APEX-DECISIONS.md:10 |
| "Owner-managed core | No automated sell, trim or add proposal" | APEX-DECISIONS.md:17 |
| "Mechanical +25%/+50% profit milestone | Review only until execution-backed milestone state is available." | APEX-DECISIONS.md:16 |
| Theme cap: "Never a sell, never more leverage." | APEX-DECISIONS.md:18 |
| "Quote freshness remains separate from research freshness. The existing 75-minute quote rule labels older prices as estimates. Every proposed order still requires live confirmation." Leverage band "reload 1.75, cruise 1.90, cap 2.00" | APEX-DECISIONS.md:20-23 |
| "Review rows are visible but are not counted as orders." / "the page does not claim to know their current state" (pending/partial orders) | APEX-DECISIONS.md:26-28 |
| "Keep `heldLevels` for every holding … Held levels take precedence for exits and must not be overwritten by a new entry's stop. … A missing held field stays missing until researched. … Never adjust levels merely to meet the R/R floor." | APEX-DECISIONS.md:37-42 |
| "Store account-specific state in the encrypted snapshot, not public research JSON or browser localStorage." (future ledger) | APEX-DECISIONS.md:81-82 |
| Scheduled routine not in repo: "Publishing this document does **not** update that routine." | APEX-DECISIONS.md:49-50 |
| "no intraday account chart, gold glow, gradient buttons, four-tab navigation, Today account switch, or ticker logos. Keep all five tabs: Today, Portfolio, Research, Signals, Activity." | ui/TODAY.md:10-12 |
| Confirm: "Uses the unchanged `Apex.portfolioPrompt` for the whole book. A changed book between display and click requires another review; the first click opens nothing. Self-directed broker tools remain read-only and the owner enters approved orders." | ui/TODAY.md:22 |
| Stop->entry->target rail needs "stop < entry limit < target … No invented research levels." | ui/TODAY.md:21 |
| "Never hardcode IREN or treat partial quotes as complete." (Biggest drag) | ui/TODAY.md:25 |
| "`today.js`: rendering and read-only interactions. It does not recalculate the strategy." | ui/TODAY.md:35 |
| `today.css` "loaded before duo.css, which stays last." | ui/TODAY.md:36-37; UI-PRESERVATION.md:161 "Keep duo.css last." (actual order: index.html:735 `duo.css` is the last `<link>`) |
| Privacy: bare trade quantities have explicit markers; "The full private Claude prompt is created on click, not stored in a Today link's DOM attributes. … no financial records are newly persisted." | ui/TODAY.md:53-58 |
| Phone reading order "overview → waiting → out of your hands → holdings → details"; 678x453 / 960x676 are "historical synthetic compatibility cases, not verified Safari viewport geometry" | ui/TODAY.md:47-51 |
| Safe-area: "Preserve the sticky date bar's opaque backing beside the reserved status inset."; do not "force screen.width, zoom"; "Apple's native Duo control column is outside that content viewport; it is not CSS padding." | UI-PRESERVATION.md:162-163; ui/TODAY.md:78-79; UX_REVIEW.md:7-8; CLAUDE.md:32 |
| Agentic parity: "Agentic has no small-position cutoff; unknown quotes/costs are not zero." and its "target/trade table and handoff remain in Target comparison & trade review." | UI-PRESERVATION.md:157-160 |
| "Retain one narrow Today toolbar, 44px Back/Classic/account links, sticky date/stale/appearance controls and all five tabs. Account context stays visible on the other routes." | UI-PRESERVATION.md:167-171 |
| Analyze pre-confirmation removed but "trade confirmations are not [removed]". Account Plan is authoritative; Analyze legacy screen labeled self-directed | UI-PRESERVATION.md:146-149; UX_REVIEW.md:109-115 |
| Owner-managed IREN: "no screen ever tells Jack to sell it" (v201) ; "My manual inputs should never be accounted for" (owner stops dropped) | CLAUDE.md:554 heading; CLAUDE.md:348-355; ui/apex.js:~375-380 |
| Business check is informational: "No stop, trim, weight, leverage or ticket logic reads this module" | ui/business.js:7-9 |
| Release: Apex "morning scan" routine and execution ledger are **outstanding external work**; UI must not claim them done | UX_REVIEW.md:134-139; APEX-DECISIONS.md:44-83 |
| Pending releases: separate model / UI / permission changes ("Keep model/data, UI and permission changes separable") ; "Merge only the tested head" | docs/RELEASE-WORKFLOW.md:Release sequence step 2,4 |

---

## 4. Test baseline (run from repo; Node v22.23.4, Python 3.13.18; nothing missing)

| # | Command | Result |
|---|---|---|
| 1 | `python3 -m unittest discover -s tests -p 'test_validate_data.py' -v` | **Ran 21 tests — OK** (exit 0) |
| 2 | `python3 scripts/validate-data.py` | `Published JSON: 4/4 files valid; no payload content logged.` (exit 0) |
| 3 | `for t in producer/*.test.mjs; do node "$t" \|\| exit 1; done` | **56/56 suites exit 0, 0 failures**, loop never aborted. Examples: apex 64/64, apex-turnover 14/14, agentic-deploy 276/0, agentic-ledger 113/0, business 18/18, flow 97/0, finalize-target 97/0, analyze-core 53/0, sd-rules (passed), options 21 assertions |
| 4 | `node --test tests/*.test.cjs` | **tests 63, pass 63, fail 0, cancelled 0, skipped 0** |

No failures to quote. Side effects of running: test run recreated gitignored `producer/raw/` and `__pycache__`; I removed `producer/raw`, `scripts/__pycache__`, `tests/__pycache__`. `git status --short --ignored` is empty after cleanup.

### CI (read, not run) — .github/workflows/

| Workflow | Trigger | What it runs |
|---|---|---|
| tests.yml `test` job | every PR, merge_group, main pushes touching producer/ ui/ tests/ scripts/ index.html sw.js | all `producer/*.test.mjs`; `node --test tests/*.test.cjs`; `npm install playwright@1.57.0` + `npx playwright install chromium`; starts `node tests/preview.mjs` (synthetic data, :8767); browser suites in order: `brief-browser.mjs` (also runs `today-browser.mjs` via import, brief-browser.mjs:7), `sd-plan-browser.mjs`, `apex-browser.mjs`, `journey-browser.mjs`, `holdings-duo-browser.mjs`, `today-viewport-browser.mjs`; on main push: `verify-live-shell.py` + journey/holdings-duo/today-viewport against the live GitHub Pages URL |
| tests.yml `webkit-layout` job | same | `npm install playwright@1.57.0`, `playwright install --with-deps webkit`, `PF_BROWSER=webkit node tests/today-viewport-browser.mjs` (+ live variant on main) |
| data-integrity.yml | every PR / merge_group / main push | validator unit tests, `scripts/validate-data.py`, `node producer/business.test.mjs` |
| freshness.yml | cron `0 13-21 * * 1-5` | stale-data issue >90 min; deploy-health check (blob vs HEAD) |
| predictions.yml | cron `7,22,37,52 * * * *` | `predictions-fetch.mjs` -> validate -> direct push `data/predictions.json` |

Pinned Playwright: **1.57.0** (tests.yml, both jobs). Not in CI: `tests/predictions-browser.mjs` (also needs `tests/predictions-fetch-fixture.mjs`).

---

## 5. Existing tests that assert specific UI text / ids / cards

### 5a. Dashboard model/source tests (`node --test tests/*.test.cjs`, run in CI and locally)

| Test file:line | Asserts |
|---|---|
| tests/experience.test.cjs:43 | index.html contains `id="page-portfolio"`, `page-picks`, `page-markets`, `page-options`, `page-analyze`, `app`, `agentic-app`, `picks-app`, `plan-agentic-app` |
| tests/experience.test.cjs:44 | `data-sec="…"` for snapshot, holdings, performance, heatmap, risk, allocation, income, technicals, fundamentals, smalls, flow, rebalance-log |
| tests/experience.test.cjs:46-47 | every inline `<script>` parses; ui/experience.js parses |
| tests/experience.test.cjs:49-52 | ui/experience.js routes technicals/fundamentals/flow `{area:'portfolio'` |
| tests/experience.test.cjs:53-57 | version/asset query strings in index.html and sw.js (experience, sd-rules, predictions assets) |
| tests/experience.test.cjs:58-68 | experience.js text: `class="ex-cta"`, `ex-div-left`, "Open the plan", "None in flight", "Not in this app"; absence of old headings; experience.css `.ex-brief-hero{display:grid`, `.ex-ring{width:112px`, `.ex-cta{display:block` |
| tests/journey.test.cjs:37-40 | all of journey/theme/today*/duo assets `?v=233` in index.html AND sw.js; `APP_VERSION='v233'`; `'pf-v233'` |
| tests/journey.test.cjs:43-49 | freshness header regexes (strip AM/PM, ET), `class="pf-fresh-actions"`, `.pf-find-word`, `.pf-refresh-word`, no `pf-fl-word">Snapshot: ` |
| tests/journey.test.cjs:51-53 | index.html contains `Apex.render`, `function azConfirmGo`, `function setPlanAccount`, `window.__privScan`; journey.js has no order calls |
| tests/smartmoney.test.cjs:139-146 | `smartmoney:'page-smartmoney'` and `id="tab-smartmoney"` in index.html; versions |
| tests/holdings.test.cjs:28-45 | extracts index.html agentic position renderer; `pos-table-ag` innerHTML contains headers Symbol, % Port, Risk, Shares, Cost, Price, Value, P&L $, P&L %, Day %; TINY visible / MAIN absent; no `$0.00` |
| tests/today.test.cjs:71-81 | ticket detail strings: "submission has not been confirmed", "Fill status is not confirmed", "does not independently confirm broker fills" (today-model.js `ticket`) |
| tests/daily-brief.test.cjs, tests/theme.test.cjs, tests/predictions.test.cjs | model/theme/sw behavior; predictions.test.cjs:53 loads sw.js |

### 5b. Producer tests that read index.html / ui source (break on rename, move or text change)

| Test file:line | Asserts / extracts |
|---|---|
| producer/business.test.mjs:190-194 | index.html contains `data-apex-business` AND `data-ag-business`; exactly one `fetch('data/business.json` |
| producer/apex.test.mjs:418-419 | index.html contains the `Object.assign({},(Apex.DEFAULT_CFG&&Apex.DEFAULT_CFG.maintBy)||{},` adapter text |
| producer/analyze-core.test.mjs:19-41,221-249 | extracts by name `calcRSI,_smaN,_stdevN,_betaSeries,_azNum,_azStateScore,azCore,_azScanLabels` and the `_cl` helper; regexes on `hasTA`, `AZ_AGING_CONF`, `AZ_EDGE_MIN_N=30`, `signal-days, not independent trials`, `azScenarios(a,ivInfo,dteIn)` |
| producer/agentic-method.test.mjs:19-50 | extracts `agEsc, AG_METHOD_KINDS, agMethodParts, agProseLines, agEmph, agMethodHtml` verbatim; rendered text must preserve every character of `agentic-target.json` `method` |
| producer/agentic-account-return.test.mjs:16-17 | extracts `function recordedAccountReturn(history, start, end) {…}` |
| producer/option-history-ui.test.mjs:4-6 | slices index.html between `function optIncomeHistory(` and `function renderOptions(` |
| producer/analyze-universe.test.mjs:22-33 | regex `const SD_BENCH = {…};` tickers must equal producer mirror |
| producer/sd-rules.test.mjs:246-248 | index.html and sw.js contain `ui/sd-rules.js?v=<n>` |

### 5c. Browser suites (CI; selector -> what breaks if a card moves)

| Suite:line | Selectors / text asserted |
|---|---|
| tests/apex-browser.mjs:14-16,30-32,40-53 | `#ex-combined-equity` contains `$`; `#page-ex-today [data-ex-route="plan"][data-ex-account="main"]` click -> `#picks-app` visible; `#apex-content` innerText, `a[href^="https://claude.ai/new?q="]`, `[data-apex-trade]`; text `limit entry`, `REVIEW X`, `· 1 order`, `Review · no order`, `Sell 10 X`, `reconciled execution history`; no horizontal overflow at 320/390/768/1440. **Calls `renderApexCard(window.__SNAP)` directly — requires the `#apex-content` container to exist in the DOM.** |
| tests/brief-browser.mjs:26-50,57-90 | `#ex-combined-equity`, `#ex-account` hidden on Today, `[data-brief-account]` count 2, `[data-ex-area="today"]`, plan routes by account (`#plan-tg-main`, `#plan-agentic-app`), `[data-brief-account="main"] [data-ex-route="accounts"]`, `#acct-tg-agentic`, `#agentic-app`, `[data-td-details="options"] > summary`, `#page-options`, `#pf-fresh-left` text `Nov 13, 12:40`, `.pf-fresh-actions`, `.ex-brief-method summary`, `.ex-private-chart`, text "Account totals are incomplete" |
| tests/today-browser.mjs (imported by brief-browser.mjs:7) | `#page-ex-today`, `.td-waiting` ("Waiting on you", "Awaiting your confirmation", "Queued for executor", "Submission reported", "Status needs review"), `.td-monitor` ("Out of your hands"), `[data-td-confirm]`, `[data-td-confirm-status]` ("plan changed"), `.td-trade-row`, `.td-map`/`[data-td-view]`/`[data-td-holding]`/`#td-holding-sheet`/`.td-tile*`, `[data-td-details="history"]` ("Value over time"), `[data-td-research]`, `[data-td-freshness]` (`N days old`), `[data-td-monitor-state=…]`, `#td-theme`, `#theme-toggle`, `[data-priv="val"]`, "LOCAL PREVIEW — SYNTHETIC SAMPLE DATA", missing-quote wording /—\|unknown\|unavailable\|no quote/, /partial\|lack day quotes\|incomplete/ |
| tests/sd-plan-browser.mjs:19-142 | `#plan-content` text `buy ~N sh MSFT`, `70% ceiling`; `#sd-stock-ideas .sd-idea[data-status=ready/funding]`; "Confirm this buy with Claude" counts; `#plan-content details` "Why other stocks are waiting"; `#picks-app [data-sd-screens-link]` =1; `#picks-app #picks-cards`=0 and `#screens-app #picks-cards`=1, `#screens-app #picks-track-card`=1, `[data-sd-screens-note]`, `[data-opt-pick-income], .harv-line` absent from Plan; `.sd-idea-link` -> `#page-analyze` / `#az-ticker`; retired plan RSI alert text `OVERBOUGHT` |
| tests/journey-browser.mjs:22-81 | `#pj-holding-search`, `#pos-table tbody tr … .sym/.az-link`, `#az-confirm:visible`=0, `#pj-symbol`, `#pj-context`, `[data-pj-go="plan"]`, `#plan-agentic-app`, `#pj-apex-evidence` ("Synthetic entry research"), `#pj-evidence-filter select`, `[data-evidence-symbol]`, `#pj-clear`, `#pos-table .pj-row-toggle`, `#ex-account`, privacy `setPrivacy()` |
| tests/holdings-duo-browser.mjs:24-81 | `#pos-table-ag`, `.pj-row-toggle`, `#pj-holding-search-ag`, `#pj-clear-ag`, `th` "Value", `.ag-trade-review summary` then `#agentic-content` visible, `.ex-main` rail width <200 for rail modes |
| tests/today-viewport-browser.mjs:23-87 | `#ex-combined-equity,#ex-combined-move,.td-account-value,.td-account-head .td-link`, `#ex-top`, `.td-hero`, `.td-waiting h2`, `.ex-today-title`, `#ex-context`, `#td-theme` hidden, `.ex-main [data-ex-area]` count 5, `#pf-priv`, `#ex-classic`, `.ex-classic-return`, `#pj-back`, `#pf-fresh-left` /⚠️.*Sample/ |
| tests/predictions-browser.mjs (NOT in CI) | `#predictions-app .pred-market`, `[data-ex-area="signals"]`, `[data-pred-category]`, `#pred-tab-watchlist`, `.pred-notice` … |
| tests/verify-live-shell.py:6-8 | hashes served `index.html, sw.js, ui/experience.js, experience-model.js, journey.js/css, duo.css/js, apex.js, theme.js, today-model.js, today.js, today.css` against repo (main push only) |

---

## 6. Unknowns / not determinable here

- **data.json payload contents**: encrypted; actual key set, sizes, per-key freshness not verified. Keys in §1b come from the producer source and UI greps. `refreshInputs`/`fetchDays`: no UI consumer found.
- **Who copies `data/apex-targets.json` / writes `data/business.json` today**: only stated in CLAUDE.md prose (scheduled tasks live outside the repo). Their live prompts are not in the repo (APEX-DECISIONS.md:44-50 says the same).
- **Server-side Routine prompts, executor, branch protection**: not inspectable. RELEASE-WORKFLOW.md says main was unprotected at the Nov 13 inspection; I did not re-verify.
- **Browser suites not run** (per instructions); Playwright 1.57.0 pin read from workflow only. Local Chromium has been reported blocked in prior sessions (CLAUDE.md:~44), so browser results are unverified here.
- **Complete caller graph for every `index.html` function** was sampled (grep of definitions and call sites for ~35 functions); index.html is ~870 KB so a full dependency graph was not built. Rows in §2b marked "SHARED" were verified at the cited call lines; "ONLY caller" claims are limited to those stated (opportunities, business check, what-if, payoff chart, Kyle/Performance stash caveat).
- **`computeBeta` (index.html:1318)**: no call site found (may be dead or invoked indirectly).
- **PROPOSAL-app-structure.md is stale** (written at v98, Path A/B six-tab proposal); the live app has five tabs (Today/Portfolio/Research/Signals/Activity) per TODAY.md:11-12. Treat the proposal as history, not a contract.
- CLAUDE.md read: top ~520 lines (v233 back to v204 plus selected v186-v205 sections) and the architecture/key-files/conventions block (lines 1817-2215). The remaining ~3,400 lines of "Gotchas" (2324-3349) and feature inventory (3349+) were not read in full; further "must not" rules may live there.
- `git status` clean confirmed (ignored dirs created by tests were removed). `tmp/experience-preview/` (written by tests/preview.mjs) was not created because preview was not run.

---

# Appendix C — Layout baseline

# C-baseline: layout / performance baseline (synthetic data)

Generated 2026-11-17 by headless Chromium against the repo's synthetic sample (`producer/make-sample-data.mjs`). Repo untouched (git status clean). Raw data: `audit-scratch/results.json`, `taps.json`. Screenshots: `audit-scratch/shots/` (42 PNGs: 20 destinations x 2 viewports light + Today dark x 2).

## 1. Scroll length per destination
Cell = document.scrollHeight px / "screens" (scrollHeight / innerHeight). Horizontal overflow (scrollWidth > innerWidth) was **false in all 100 destination/viewport cells** (0 px everywhere).

| Destination / account | 390x844 | 466x677 | 960x676 | 677x466 | 1280x800 |
|---|---|---|---|---|---|
| today/main | 2339 / 2.77 | 2286 / 3.38 | 1638 / 2.42 | 1467 / 3.15 | 1677 / 2.1 |
| accounts/main | 7314 / 8.67 | 6778 / 10.01 | 4971 / 7.35 | 5340 / 11.46 | 5016 / 6.27 |
| accounts/agentic | 7101 / 8.41 | 6499 / 9.6 | 4990 / 7.38 | 5446 / 11.69 | 5093 / 6.37 |
| options/main | 7161 / 8.48 | 6888 / 10.17 | 4984 / 7.37 | 6495 / 13.94 | 4646 / 5.81 |
| plan/main | 5168 / 6.12 | 4843 / 7.15 | 4039 / 5.97 | 4463 / 9.58 | 4138 / 5.17 |
| plan/agentic | 4489 / 5.32 | 4283 / 6.33 | 2822 / 4.17 | 4024 / 8.64 | 4148 / 5.18 |
| markets/main | 3070 / 3.64 | 2872 / 4.24 | 1727 / 2.55 | 2675 / 5.74 | 2347 / 2.93 |
| markets/agentic | 3070 / 3.64 | 2872 / 4.24 | 1727 / 2.55 | 2675 / 5.74 | 2347 / 2.93 |
| screens/main | 4296 / 5.09 | 4023 / 5.94 | 3072 / 4.54 | 3693 / 7.92 | 2455 / 3.07 |
| screens/agentic | 4296 / 5.09 | 4023 / 5.94 | 3072 / 4.54 | 3693 / 7.92 | 2455 / 3.07 |
| analyze/main | 844 / 1 | 677 / 1 | 676 / 1 | 557 / 1.2 | 800 / 1 |
| analyze/agentic | 844 / 1 | 677 / 1 | 676 / 1 | 557 / 1.2 | 800 / 1 |
| decisions/main | 1370 / 1.62 | 1329 / 1.96 | 1048 / 1.55 | 1218 / 2.61 | 1071 / 1.34 |
| decisions/agentic | 2365 / 2.8 | 2274 / 3.36 | 1766 / 2.61 | 2296 / 4.93 | 1812 / 2.27 |
| scenario/main | 1658 / 1.96 | 1620 / 2.39 | 1093 / 1.62 | 1600 / 3.43 | 1078 / 1.35 |
| scenario/agentic | 1658 / 1.96 | 1620 / 2.39 | 1093 / 1.62 | 1600 / 3.43 | 1078 / 1.35 |
| activity/main | 2067 / 2.45 | 1985 / 2.93 | 1393 / 2.06 | 2013 / 4.32 | 1376 / 1.72 |
| activity/agentic | 2067 / 2.45 | 1985 / 2.93 | 1393 / 2.06 | 2001 / 4.29 | 1376 / 1.72 |
| smartmoney/main | 2009 / 2.38 | 1997 / 2.95 | 1416 / 2.09 | 1922 / 4.12 | 1984 / 2.48 |
| predictions/main | 3687 / 4.37 | 3669 / 5.42 | 2338 / 3.46 | 2635 / 5.65 | 2331 / 2.91 |

## 2. Visible cards and account-value / day-P&L element counts
Counts were identical at all five viewports (verified), so one column. Today, Options, Smart $ and Predict ignore the account choice (Today is combined; Options is self-directed only; Smart $ and Predict are account-free), so they were measured once with account=main and their "/main" label is nominal. All other destinations were measured with both accounts.

| Destination / account | top-level cards/sections | of which non-article sections | account value/equity elements | day P&L elements |
|---|---|---|---|---|
| today/main | 5 | 5 | 3 | 4 |
| accounts/main | 12 | 12 | 1 | 3 |
| accounts/agentic | 12 | 12 | 3 | 3 |
| options/main | 8 | 8 | 0 | 1 |
| plan/main | 5 | 5 | 2 | 1 |
| plan/agentic | 8 | 8 | 0 | 1 |
| markets/main | 7 | 7 | 0 | 1 |
| markets/agentic | 7 | 7 | 0 | 1 |
| screens/main | 5 | 5 | 0 | 1 |
| screens/agentic | 5 | 5 | 0 | 1 |
| analyze/main | 1 | 1 | 0 | 1 |
| analyze/agentic | 1 | 1 | 0 | 1 |
| decisions/main | 2 | 2 | 0 | 1 |
| decisions/agentic | 6 | 6 | 0 | 1 |
| scenario/main | 2 | 2 | 1 | 1 |
| scenario/agentic | 2 | 2 | 1 | 1 |
| activity/main | 6 | 6 | 0 | 1 |
| activity/agentic | 6 | 6 | 0 | 1 |
| smartmoney/main | 14 | 0 | 0 | 1 |
| predictions/main | 8 | 0 | 0 | 1 |

Notes: "cards" on Smart $ (14) and Predict (8) are list items (`article.sm-row`, `article.pred-market`), not titled sections (hence 0 in the next column). Day P&L = 1 on almost every page is the global ticker tape's "Today +$118" (`.tk-big`), which appears on every route; the page itself shows none. Analyze is a near-empty page until a symbol is chosen (1 screen).

## 3. Taps from app open (fresh state: Today, self-directed) to target
Tap = one click on a real control (no scrolling counted; scrolls listed separately). End states verified (route/state/visibility). Nothing was submitted; the Apex Confirm button was never clicked.

| Target | Path | Taps | Scroll needed before a tap? (390 / 466 / 960 / 677x466 / 1280) |
|---|---|---|---|
| (a) Apex Confirm | Today > Waiting on you card (`[data-td-confirm]`) | 0 | n/a (0 taps) |
| (a) Apex Confirm (alt) | Research > Plan > Apex card (`[data-apex-confirm] a`; card already expanded) | 1 | no / no / no / no / no |
| (b) Held position detail | Today > holding tile AAPL > "Research" in sheet -> Analyze (AAPL, main) | 2 | yes / yes / yes / yes / yes |
| (b) Held position detail (alt) | Portfolio > All Positions row link AAPL -> Analyze | 2 | yes / yes / yes / yes / yes |
| (c) Agentic plan | Today > "Open agentic plan" link | 1 | yes / yes / yes / yes / no |
| (c) Agentic plan (alt) | Research > Plan > Agentic toggle (`#plan-tg-agentic`) | 2 | no / no / no / no / no |
| (d) Options covered-call | Portfolio > Options > "Covered-Call Income" chip (jumps to card) | 3 | no / no / no / no / no |
| (e) Predict | Signals > Prediction markets chip | 2 | no / no / no / no / no |
| (f) Smart $ | Signals (opens Smart Money, the default sub-tab on a fresh install) | 1 | no / no / no / no / no |

Where the Apex Confirm button sits on Today (page y px, no scroll): 390x844 -> 570; 466x677 -> 573; 960x676 -> 413; 677x466 -> 355; 1280x800 -> 500. On 390x844 that is on the first screen (viewport 844). Plan route Confirm sits at page y: 753 / 753 / 595 / 685 / 1201; at 466x677, 677x466 and 1280x800 that is below the fold.
Covered-call card after chip jump lands at page y 6038 / 5826 / 4240 / 5654 / 3784 (the Options page is ~7,100 px long at 390 wide; the chip is what makes it 3 taps rather than a long scroll).
Taps are viewport-independent (all five viewports gave the same count and all end states passed).

## 4. Errors
Page errors (uncaught): **0** at every viewport and in every tap path. Non-GET requests (would-be writes): **0**.
Console errors: **1 per viewport**, `Failed to load resource: net::ERR_FAILED` = the Chart.js CDN request (`cdn.jsdelivr.net/.../chart.umd.js`) that the harness aborts on purpose (same as the repo tests: all https requests are aborted and a CHART_STUB is injected). Not an app defect.

## 5. Method
- Browser: Playwright 1.57.0 (the version pinned in `.github/workflows/tests.yml`) driving the pre-installed Chromium 153 at `/opt/pw-browsers/chromium-1243/chrome-linux64/chrome`. `npx playwright install chromium` was **blocked** (egress proxy refused cdn.playwright.dev / playwright.download.prss.microsoft.com), so the pinned 1.57 build (Chromium ~143) was not downloaded; the newer system Chromium was used via `executablePath`.
- Serving + synthetic data (same as `tests/preview.mjs`): `server.mjs` runs the repo's `producer/make-sample-data.mjs` with its `emit` replaced by a write to `audit-scratch/scratch/sample.json` (outside the repo), serves the repo root at http://127.0.0.1:8767, maps `/data.json` to that sample, 404s `/sw.js`. Unlike preview.mjs I did not inject the "LOCAL PREVIEW" banner (it adds ~30 px to every page). Real data.json is never read.
- Per page (as in journey-browser.mjs): `CHART_STUB` from `producer/privacy-audit.mjs` via addInitScript; `data.json` fulfilled from the sample; `data/apex-targets.json` fulfilled with the journey-test synthetic fixture (MSFT entry, AAPL held levels) so the Apex card / Confirm exists; all other https aborted; service workers blocked; timezone America/New_York; localStorage `pf_acct=main`, `pf_experience_route=today` on first load; light theme via `PFTheme.set('light')`.
- Destinations navigated with `PFExperience.navigate(route,{account})` (the same entry the nav buttons call), 900 ms settle, one page per viewport reused across destinations. Routes: today, accounts, options, plan, markets, screens, analyze, decisions (Decision evidence), scenario (What if?), activity, smartmoney, predictions. Both accounts (main, agentic) for all except today/options/smartmoney/predictions. Underlying legacy tabs (portfolio, markets, picks, options, screens, analyze, predictions, smartmoney) are the same DOM pages the routes display, so they are covered; classic-view (`pf_classic=1`) was not separately measured. Section-only routes (holdings, performance, heatmap, risk, income, technicals, fundamentals, flow, log) are in-page scroll targets of Accounts and not measured separately.
- Duo emulation: viewport sizes as requested; Chromium `Emulation.setSafeAreaInsetsOverride` with the same insets as tests/holdings-duo-browser.mjs (466 wide: right 84; 960: right 100; 677x466: left 85; 390 and 1280: none). I used 677x466 as given (the repo test uses 678x453).
- scrollHeight = documentElement.scrollHeight. Overflow = documentElement.scrollWidth > innerWidth. "Visible" = non-zero box, not display:none/visibility:hidden, not under [hidden], not inside a closed <details> (summary excepted).
- Top-level cards/sections: visible elements matching `.card, .ex-card, .td-panel, section, article, .sm-panel` inside the active page container, excluding any with a matching visible ancestor (below the container).
- Account value / equity selectors (visible only): `#ex-combined-equity`, `.td-account-value`, `.h-value`; plus, only when the parent label matches /^(account value|agentic account value|total portfolio value|your equity|equity|account equity|latest recorded value|account today)/i and the text is a currency amount: `.snap-val`, `.pm-v`, `.ex-row > span:last-child`, `.ex-history-head strong`.
- Day P&L selectors (deduplicated, visible, ignoring aria-hidden ticker copy): `#ex-combined-move`, `.td-account-meta > span:first-child` (only if it starts with a currency amount), `.tk-big` (ticker "Today"), `.snap-val`/`.snap-sub` whose label starts "Day Change", and `.h-value` containing "today". Per-holding figures (`.td-tile-pnl`, table day columns, % cells) are deliberately not counted.
- Counts are selector-based and may miss values rendered under other class names; a text-based discovery pass over all routes (discover.mjs) found no additional account-level value/day elements beyond these.

## 6. Limitations
- Headless desktop Chromium emulation, not a physical iPhone Duo: no Safari/WebKit engine (the repo's own WebKit job was not run), no real foldable hinge/viewport segments, no dynamic toolbar/URL-bar resizing, no real safe-area geometry beyond the CDP inset override, no touch scrolling/momentum. Taps are mouse clicks.
- Chromium here is v153 not the CI-pinned ~143 build.
- Synthetic sample: 10 held names, short histories, 4 picks; real data with more positions/rows will lengthen pages (Accounts, Options, Predict list lengths scale with data; Predict "browse all" is a collapsed details excluded from counts but not from scrollHeight when open).
- Web fonts and Chart.js come from CDNs blocked by design; charts are stubs (canvas blank), so chart heights follow CSS only. Fonts fall back to system fonts, which can shift text wrapping slightly.
- Full-page screenshots of fixed-position chrome (bottom nav, left rail) appear once at their top-of-page position, not repeated; the Duo-open side rail is cut where the 676 px viewport ends.
- Plan/Accounts agentic states depend on the sample's agentic fixture.
- Apex Confirm presence on Today depends on the injected synthetic Apex proposal.

## 7. What failed
Nothing blocked the measurements. Only: Playwright's own browser download (see Method), worked around with the system Chromium.

---

# Appendix D — Robinhood documentation check

# D - Robinhood capability verification (as of 2026-11-17)

Method: WebSearch/WebFetch only. Primary sources: robinhood.com/us/en/support, robinhood.com/newsroom (newsroom.aboutrobinhood.com 302-redirects there). Support articles show NO publication date (footer only "(c) 2026"), so "page date" = not shown unless stated. Newsroom dates are shown. Fetch summaries were produced by a small model reading each page; treat quoted details as paraphrase and spot-check anything load-bearing.

Base URL for support: https://robinhood.com/us/en/support/articles/<slug>

| # | Capability | Available? | Where | Eligibility / rollout limits | Source | Paraphrase |
|---|---|---|---|---|---|---|
| 1 | Live account value, day P&L, total return per account | Partly | Legend "Account summary" widget (portfolio value, buying power, P&L); app/web portfolio screens | Legend: investing customers only; Trading P&L excludes crypto, event contracts, index options. A support article for the app/web portfolio header and per-account breakdown: I cannot confirm this | .../widgets-in-robinhood-legend/ | Legend shows portfolio value, buying power and P&L in one widget, with listed exclusions. |
| 2 | Per-position detail (shares, avg cost, market value, today's/total return) | Yes | App and web classic stock detail page; Legend Positions widget | Position block shows only if position open. Avg cost is NOT tax basis; retirement accounts use older avg-cost calc | .../viewing-stock-detail-pages ; .../average-cost ; .../widgets-in-robinhood-legend/ | Detail page lists shares, market value, average cost, today's and total return. |
| 3 | Charts with indicators | Yes | Mobile advanced charts (up to 10 indicators, drawings, syncs with Legend); Legend charts | Stocks, ETFs, certain crypto on mobile advanced charts; options chain icon needs options access. Legend: investing customers; no extra cost. Custom indicators (breakout etc.) "coming later this year" (announced 2026-09-29) | .../using-advanced-charts ; .../widgets-in-robinhood-legend/ ; https://robinhood.com/newsroom/hood-summit-2026/ | Indicators and drawings are saved and shared between mobile and Legend. |
| 4 | Price / custom / indicator alerts | Yes | App (custom + indicator from chart), web classic (custom price), Legend/mobile advanced charts (price alerts sync; indicator alerts created on mobile only) | Indicator alerts stocks/ETFs only; options alerts need options enabled and "not available on Legend"; watchlist alerts off by default | .../price-alerts/ ; .../options-alerts/ | Price, percent, indicator and options alerts exist; indicator alerts are mobile-created only. |
| 5a | Watchlists | Yes | App, web, Legend | Legend watchlists do not support options/event-contract positions. Option watchlist items on app: I cannot confirm this from these pages | .../watchlist-and-cards/ ; Legend widgets page | Users can build lists for stocks, ETFs, crypto, futures; no stated count limit. |
| 5b | Screeners / scans | Yes (screeners); Partly (Legend scans) | Screeners: app + web classic ("not Legend" per page). Legend Scanner widget: 60+ filters, 5-min refresh | Screener page states no eligibility. Cortex (AI screener-building) is Gold-only ($5/mo). Cortex scripting/scanners in Legend was "rolling out later" at HOOD Summit 2025; custom-indicator scanning "coming later this year" per 2026 | .../stock-screeners/ ; Legend widgets page ; .../cortex/ ; .../hood-summit-product-announcements | Preset and custom screeners exist in app/web; Legend has its own scanner widget. |
| 6 | Buying power and margin (used, maintenance) | Yes | App/web: Investing > Buying power > Usage; Margin status card (maintenance requirement, buffer, risk status); position-level via View all. Legend account summary shows buying power | Margin needs $2,000 minimum. Whether Gold affects margin eligibility: I cannot confirm this from the page | .../margin-maintenance/ | Margin used and total maintenance requirement are viewable in the Buying power screen. |
| 7 | Options chain with Greeks, IV, probability | Yes | App (Focused / Side-by-side), web classic, Legend (metrics differ by platform) | No eligibility stated on page (chain itself needs options approval - general, not on this page) | .../options-chain-metrics | Chain metrics include delta/gamma/theta/vega/rho, IV, chance of profit, prob ITM/OTM, touch probability, breakeven. |
| 8 | Options P/L chart, simulated returns, strategy builder, analyzer | Yes (partly gated) | Simulated Returns: pre-trade mobile app + Legend; open positions/watchlist in app + web classic. Strategy builder: access path given, platform not stated. P/L chart help page exists | Simulated Returns: Level 2 gets pre-trade sim; Level 3 also gets simulated P/L chart. P/L chart (expiration) described by level (2 and 3). Builder: no level/Gold stated; index options excluded from calendars/covered calls/diagonals. Simulated Returns assumes constant IV and ignores dividends | .../simulated-returns ; .../about-the-options-strategy-builder ; https://robinhood.com/support/articles/profit-loss-chart | Robinhood models option value across time and price (Bjerksund-Stensland), shows max gain/loss and Greeks per strategy. |
| 9 | Covered-call tooling (strike ranking / assignment probability) | Partly | Chain metrics include "covered return" and "max covered return"; probability ITM/OTM/touch; early-assignment/dividend alert for short calls (app push); strategy builder lists covered calls | No ranked/recommended-strike feature found. "Assignment probability" as a labeled metric: I cannot confirm this (prob ITM is the nearest listed metric) | .../options-chain-metrics ; .../options-alerts/ ; .../about-the-options-strategy-builder | Robinhood supplies covered-return metrics and probabilities but I found no strike recommender. |
| 10 | Order status / history / partial fills | Partly | Legend Recent orders widget (open orders, closed last 24h; cancel partially filled; Realized P&L column on closing orders). App/web history page: I cannot confirm this from fetched support pages | Excludes event contracts, DRIP, recurring orders | .../trading-with-robinhood-legend | Legend lists recent orders, supports cancel on partials, and shows realized P&L on closing fills. |
| 11 | Realized P&L / tax lots / cost basis | Partly | Tax lot selection on sell screen; default disposal method (FIFO/LIFO/High/Low cost) in app and web; Legend Recent orders realized P&L column | Tax lots: US taxable investing accounts only; cost basis may be missing for transferred assets; no standalone realized-P&L report described on tax-lot page. Tax docs (1099) not checked | .../tax-lots ; https://robinhood.com/newsroom/introducing-tax-lots (Dec 2, 2024, per search listing) | Robinhood shows per-lot cost and S/L term when selling but I did not confirm a realized-P&L history view outside Legend. |
| 12 | Deposit-adjusted / time-weighted performance, benchmark comparison | Not confirmed | - | I cannot confirm this. Searches of robinhood.com support found no TWR/money-weighted or S&P benchmark view for self-directed accounts (a "Strategies charts" page exists for managed Strategies, not fetched). Average-cost page itself states returns = (price - avg cost) x shares, i.e. not deposit-adjusted | .../average-cost | No primary-source evidence of benchmarked or time-weighted performance. |
| 13 | Earnings, analyst ratings, news | Yes | App/web classic stock detail page (news, analyst buy/hold/sell, quarterly EPS chart); Earnings Hub with live call + Upcoming tab in app; Legend Snapshot (7-day headlines, next earnings date) | Detail-page info is "app and web classic only". Earnings Hub: no formal eligibility; cards follow holdings. A full earnings CALENDAR page (dates grid): I cannot confirm this beyond the Upcoming tab | .../viewing-stock-detail-pages ; .../earnings-hub/ ; Legend widgets page | Detail pages carry news, ratings and EPS history; Earnings Hub covers live calls. |
| 14 | Deep links / universal links | Not documented | - | No support/newsroom page documents a URL scheme for stock, chain, or account. Only incidental: margin-maintenance article links to applink.robinhood.com/margin_status_detail (an in-article link, not a spec). robinhood.com/stocks/TICKER and robinhood:// : I cannot confirm this from a primary source; treat as commonly-used-but-undocumented. Third-party GitHub page on deep linking was not primary and not used | https://robinhood.com/us/en/support/articles/margin-maintenance/ | Robinhood publishes no deep-link spec; one support page shows applink.robinhood.com in use. |
| 15 | Agentic / MCP / API for retail | Yes (beta/rolling) | Trading MCP endpoint https://agent.robinhood.com/mcp/trading (Claude Code, Claude Desktop, ChatGPT, Codex, Cursor, Grok...); built-in Robinhood Agents (mobile app); Banking MCP | Needs primary individual investing account in good standing; agent trades ONLY in a dedicated Agentic/MCP account (counts toward 10-account limit), funded by user; read access to ALL accounts (positions, balances, transactions, order history). Equities, options (single-leg only; no multi-leg), crypto (some states excluded). MCP approvals off by default. Launched beta 2026-05-27 equities only; Built-in Agents: "still rolling out, not all customers have access". No separate public retail API described on the pages fetched | https://robinhood.com/newsroom/robinhood-is-now-open-to-agents/ (May 27, 2026) ; .../onboarding-an-external-agent/ ; .../agentic-trading-overview/ ; .../trading-with-your-agent/ ; .../robinhood-agents-overview/ | Third-party AI agents connect over MCP to a separate funded account and can read your other accounts. |

## Final classification

| Bucket | Items |
|---|---|
| Robinhood clearly does it at least as well | 2 position detail; 3 charts+indicators; 4 alerts (price/indicator); 6 buying power & margin status; 7 options chain Greeks/IV/probabilities; 13 news/analyst/earnings (stock detail) |
| Robinhood does it but with eligibility/platform limits (keep dashboard fallback) | 1 per-account value/P&L (Legend-confirmed only; exclusions); 5 screeners/scans (Legend scans/custom indicators partly "coming"; Cortex Gold-only); 8 options sim/P&L chart (Level 2/3, mobile-first); 9 covered-call (metrics yes, no recommender); 10 order history (Legend 24h confirmed only); 11 tax lots/realized P&L (taxable only, sell-flow, cost basis gaps); 5a watchlists (no options in Legend); 15 agentic/MCP (separate account, rolling out) |
| Robinhood does not do this / not confirmed (dashboard differentiator) | 12 deposit-adjusted/time-weighted performance and benchmarking (not confirmed); 14 documented deep-link scheme (none documented; applink.robinhood.com seen only incidentally); cross-account consolidated view with custom covered-call ranking (no Robinhood feature found) |

## Gaps to re-verify before cutting features
- Support pages carry no dates; re-check live pages in the app Help Center before shipping.
- #1, #10, #11, #12: no app/web primary article found; do not remove dashboard equivalents on this evidence.
- HOOD Summit 2026 (newsroom, 2026-09-29) says custom indicators/breakout scanning come "later this year" (not yet confirmed live as of 2026-11-17).
