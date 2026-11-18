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

# Portfolio Dashboard — research-based UX continuation

November 11, 2026 · v217, based on main 396bf8a / v216.

## Scope

Holding → what changed → research → account-specific plan → return with context.
This is a consumer/UI release. It does not authorize trades, change strategy thresholds,
modify source snapshots, or resolve the external routine/execution-ledger backlog.

## Shared research and workflow

- Shared synthesis, sources and continuation procedure: https://github.com/mcdermottj639/Ebay/blob/main/UX_REVIEW.md
- Claudex coordination: https://docs.google.com/document/d/1oyJS2uyoBF8-TET3fLxU-hvlke9U805GXNhFjMb4k8Q/edit
- Portfolio handoff: https://docs.google.com/document/d/1tRDoWPVmd8HhEV7-rqPoqG1cYe7Yp9lAXAasEMos5xw/edit
- Caddie handoff: https://docs.google.com/document/d/10TzWts8Im5hGWAcYKpHSUhuiOwJYrUii2g2TLiZtShc/edit
- Jarvis handoff: https://docs.google.com/document/d/1rS1uTgGb3GvaiADqUaqbKajcztb29WMJUzDlM1Qii-E/edit

The requested reusable skill is **Improve App UI & UX / improve-app-ux**. Its workflow
was recovered from the prior chat; its full installed text was not exposed by this
session's skill catalog. The shared research above is the inspected primary continuation
reference, not a claim to have loaded the missing skill package.

Relevant product patterns rechecked in this pass:
- Linked selected-asset context: https://robinhood.com/us/en/support/articles/widget-linking-on-legend/
- Browser Back/Forward and restoration: https://developer.mozilla.org/en-US/docs/Web/API/History_API/Working_with_the_History_API
- Original sources for compact disclosure, reusable views and touch controls remain in the shared synthesis.

## Implementation

- `ui/journey.js` and `.css`: compact selected-name context with distinct account identity,
  recorded position value/day contribution, snapshot age, source limitations and a
  Holding / Research / Plan progression. The default Analyze hero is replaced, not duplicated.
- Read-only Analyze opens directly from holding/heatmap links. Existing trade and whole-book
  confirmation functions, account execution controls and model code are unchanged.
- Navigation writes whitelisted route-only hashes. Account alias, selected ticker, reading
  position and expanded details stay in local history/session state, not the URL. Browser Back,
  Forward and refresh restore context; each area remembers its last subview.
- Selected names and the evidence filter are account-local. Source tables, chart renderers,
  formulas and underlying financial data remain authoritative.
- Self-directed position search filters the existing table, with clear/reset and an honest
  no-match count. Table details and ticker research links are keyboard-operable.
- Decision evidence supports a selected-name view without losing the complete list. Saved
  Apex explanatory records complement the existing Agentic thesis/source cards. Missing
  evidence remains missing; absence is never turned into a sell instruction.
- Existing chart types and units are preserved. The Today layout, header spacing and repeated
  Find control are tightened without deleting destinations, privacy controls or Classic view.
- v217 UI, service worker and shell URLs move together; new assets are in the offline shell.

## Important source boundary

Analyze's legacy general technical screen still derives its position/sizing/correlation
context from the self-directed book. The new panel labels this explicitly and carries the
selected account's own holding summary separately. The account-specific Plan is the decision
surface; this UX change does not relabel generic screen calls as Apex or Agentic decisions.
A separate, coordinated model change would be needed to change Analyze's input semantics.

## Verification contract

Local: all 56 producer suites and existing model tests passed. Ten new journey-model tests
cover state validation, route/secret separation, nulls, account aliases and shell consistency.
Rendered in-memory synthetic previews passed 320/390px checks without page errors. Local
browser navigation was blocked by the environment, so real history/reload behavior is gated
by CI, not inferred from the screenshots.

CI keeps the three existing synthetic browser suites and adds `tests/journey-browser.mjs`:
Back/Forward/reload, source scroll, per-account selection, search and evidence filters,
expanded details, privacy round-trip, keyboard, themes and twelve destinations at five widths.
On main push, `tests/verify-live-shell.py` requires the served release assets to match this
commit, then the journey suite runs on the live shell with intercepted synthetic account data.
Screenshots are retained in the `journey-browser-evidence` workflow artifact. These are not
physical iPhone/Steam Deck checks or evidence of decrypted live account/trading execution.
The shared handoff records actual run/merge/deployment results after completion.

## Remaining operational work (not silently marked done by UX)

Preserve `producer/APEX-DECISIONS.md`: align the external morning routine, reconcile pending/
partial orders, and implement durable fill-linked milestone state. Agentic runtime acceptance,
source/scoring reconciliation, equity/option-liability reconciliation and prospective Lab
validation remain separate evidence-backed tasks. No new schedule or order is created here.

## Next app

Only after this release is tested, published and verified: **Caddie HQ**, then **Jarvis**.
Caddie must read this record, the shared research and its current handoff; start from latest
main, preserve existing golf data/offline/map/round functionality, and complete its full
course → prep → hole guide → score → recap journey. It must then supply the Jarvis prompt.
Jarvis ends with the overall completed/remaining-items list, not another app prompt.

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
Not verified: WebKit (not installed here), a physical iPhone Duo.

**Superseded in part, 2026-11-17 (Apex workspace; owner: "Build it", after the folded-Duo screenshot of Apex > Plan).** Inside Apex and Agentic the
Plan · Account · Research · What if? sub-nav, the card rail (chips + Expand/Collapse all) and the journey's three large step buttons are replaced by ONE
tab row: **Overview · Positions · Research · Actions** (Overview = `accounts`, Positions = `holdings`, Research = `analyze` entered from the area and kept
highlighted via history-state `origin`, Actions = `plan`; `scenario` is an Overview row; the 22 routes and hashes are unchanged). Back is icon-only and
Classic view moved into More. A bare `#view=analyze` is still a Research-area page. Everything above this note stays as history.

## 2026-11-17 · Duo layout state and mid-fold control (v247)
Jack chose the Sports Hub rule: Duo optimization always applies; the Duo mode only decides the mid-fold split. A four-way control
(Auto / Folded / Book / Standard) sits in the gray freshness bar on every page; Standard is the v246 layout. Folded puts the glance
summary on top and the scrolling page below; Book puts it left and the page right; both only on Today, Apex/Agentic Overview, Research
(Markets, Analyze) and v2.9 Paper. Auto only follows what the browser reports; without Safari's fold flags it stays Standard until Folded
or Book is tapped. At 466x677 the Today equity, Apex/Agentic value and stamps, and Paper's PAPER ONLY header with stamps sit above the crease; larger
blocks (Paper tiles, Markets indexes) continue at the top of the scrolling part. Not verified on a physical Duo or WebKit.
