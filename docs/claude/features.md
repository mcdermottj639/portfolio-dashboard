# Feature inventory (what is built)

> **ARCHIVE / REFERENCE — not default context.** Moved verbatim from the repo-root `CLAUDE.md` on 2026-11-18 (docs/process-only PR). Nothing here was rewritten. Where this text conflicts with the root `CLAUDE.md`, the root file wins: it holds the current ACTIVE RULES. Labels used there: ACTIVE RULE / CURRENT STATE / HISTORICAL / UNVERIFIED.

> Load to find where a screen or card lives and what it already does. Update the matching entry when a feature changes.

## Index

- Accounts tab (v99 — the two real accounts, one per side of a segmented toggle):
- Navigation & accessibility pass (v131) — the app got a bottom tab bar, a section rail, Find and
- Card parity across the two account sides (v101):
- 🧾 Rebalance Log — SELF-DIRECTED (v127, Accounts tab, ••••0741 side, after Flow):
- 📈 Account Performance (v99, agentic side)
- Portfolio (the Self-directed side of the Accounts tab):
- Plan tab is SPLIT BY ACCOUNT (v108) — the same switcher the Accounts tab carries.
- Picks (the "🎯 Plan" tab — renamed from "Picks" in v56):
- Analyze:
- Markets:
- Options:
- Producer hardening:
- 🏛️ Flow & Positioning (v95; moved to the ACCOUNTS page in v100, split per account in v102):
- Table readability (v97):
- Privacy mode (👁️ / 🙈) — REWORKED APP-WIDE IN v136.
- Freshness bar (STICKY since v131):
- Card help popovers (v76):

---
## Feature inventory (what's built)
- **Accounts tab (v99 — the two real accounts, one per side of a segmented toggle):** the tab formerly
  called "Portfolio" now leads with an **Accounts segmented control** (`.acct-seg` → `setAccount('main'|'agentic')`,
  persisted as `pf_acct`, restored at boot) that swaps between two containers inside `page-portfolio`:
  **📊 Self-directed (••••0741 · margin)** = `#app`, everything below, unchanged; and **🤖 Agentic (••••3900 ·
  automated)** = `#agentic-app`, rendered lazily on first visit by `renderAgenticPage()`. The split exists
  because these are two real accounts with different rules (unlevered limited margin, wash-sale ledger, PDT
  guard, the auto-tier executor), and the agentic book previously had no home — its holdings/target/log sat on
  the Plan tab while its only performance readout was an overlay line on the *self-directed* page. The agentic
  side carries a value hero (equity · day move · account tag), the new **📈 Account Performance** card, the
  **🤖 Agentic Portfolio** tracker and the **🧾 Rebalance Log** (both MOVED off the Plan page — a pointer card
  there links back), then a pointer to the Plan tab. Each card renders behind its own `guard()` so a single
  throw (a bad series, a Chart.js hiccup) can't leave the cards below stuck on their spinners. The **card
  jump-nav** skips cards hidden by the inactive side (`hiddenWithin`) and rebuilds on toggle
  (`window.__navRebuild`), so chips always match what's on screen. Privacy masking is no longer scoped to
  `#page-portfolio` at all (v136) — it is region-based and app-wide; see the Privacy mode entry below.
- **Navigation & accessibility pass (v131) — the app got a bottom tab bar, a section rail, Find and
  My view.** Integrated from a Claude Design study (`Portfolio_App_Redesign.dc.html`), **taking its
  structure and rejecting its palette wholesale** — the study proposed a warm "Clay" ground with a
  `#c94b39` accent, and the owner's instruction was to keep Light ⇄ Gold exactly as they are. Nothing
  was removed: every card, chart, table and both account books are untouched, and the study's redrawn
  card bodies (pill/bar/meter/tile approximations of our real tables and Chart.js canvases) were
  deliberately NOT taken — they are a mock's stand-in for content we already render properly.
  - **The tab bar is FIXED TO THE BOTTOM**, one row, icon over label, 56px targets. It used to be a
    sticky TOP bar that **wrapped to two rows on a phone** (Analyze alone on row 2), costing ~150px
    above the fold before a single figure appeared — measured on the live app, the portfolio value
    began at y≈780 of a 900px screen. The active state is a top accent stripe, not the old dark
    "wealth" gradient pill: on a bottom bar a filled block reads as a floating button on the device
    chrome, and it also rendered dark-on-dark and unreadable in the light theme. **Two consequences
    are load-bearing.** (a) `body` carries `padding-bottom: safe-area + 74px`, or the last card hides
    behind the bar. (b) **The tab bar contributes NOTHING to `__pfTopOffset()` any more** — it
    obscures the page's bottom, not its top, so counting it there would push every jump ~62px past
    its target. See the sticky-geometry gotcha below, which this change rewrote.
  - **The section rail replaced the collapsible jump-nav.** v112 had made it a disclosure collapsed by
    default (`pf_nav_open`, `.card-nav-toggle`, `setNavOpen`) because expanded it wrapped to five
    lines and buried each page's first card — a real problem, but hiding the nav treated the symptom.
    One **non-wrapping row that scrolls sideways** costs the same ~40px the collapsed toggle did and
    is always usable, so the toggle, the preference key and `setNavOpen` are **gone** (nothing else
    read that key). An **Expand all / Collapse all** button leads the rail.
  - **`__navAll` must drive BOTH collapse mechanisms.** The app has two, and a control that knows only
    one silently acts on a fraction of the page: the generic enhancer wraps a card's content in a
    `.card-body` child, but **every card whose header already carried `.collapsible` owns its own
    toggle** — `data-toggle="<bodyId>"` on the title plus `toggleSection()`. Measured live on the
    Accounts tab: **10 collapsible cards, 1 of mechanism (1) and 9 of mechanism (2).** `bodyOf()`
    resolves either; the rail's label is computed from live state (`anyOpen`) rather than a stored
    flag, because individual toggles change the answer, so `toggleSection` also calls `__navSyncAll`.
  - **Find (🔍 in the freshness strip) searches every card on every tab** — title matches ranked ahead
    of body-text matches, Enter opens the first hit, and a result switches tab, expands the card and
    scrolls to it. **The hard part is that Markets, Options and Analyze render LAZILY**, so a search
    run before you have ever opened Markets cannot see one Markets card in the DOM. Two fixes were
    rejected: a hardcoded title registry drifts silently the moment a card is renamed, and eagerly
    initialising the hidden tabs would build **Chart.js canvases inside `display:none` containers,
    which size to ZERO** — the documented hazard behind the Plan tab's lazy render. So Find
    **remembers**: titles seen on a rendered page are cached per tab (`pf_card_titles`), and an
    unrendered tab contributes its remembered titles, labelled "not loaded yet". Self-healing, and
    the cross-tab jump **waits for the real render** (polling to a ~3s ceiling) before scrolling —
    scrolling early lands at the top of a page that then grows underneath you.
  - **My view** (`pf_pins`) pins any card from any tab via a ☆ in its header, and renders as **ONE row
    of chips, empty by default** — it appears on every page, so a taller block would tax every tab's
    fold to show something the reader never asked for. Pins are keyed by **card TITLE, not element
    id**: the rail regenerates ids (`navc-1`, `navc-2` …) on every rebuild, so an id-keyed pin would
    break on the next re-render. A pin whose card can't be resolved (renamed, or a tab never visited
    on this device) is **skipped, not deleted** — the preference is still valid, we just can't
    resolve it yet, and dropping it would lose the pin on one bad boot.
  - **▲/▼ on every percentage that renders through `fmtP()`** — the shared formatter behind the
    position tables, snapshot tiles, P&L columns and the account cards (29 call sites) — so colour is
    no longer the only carrier of direction there. **It is not literally every percentage in the app:**
    a few surfaces format their own (the Markets index/sector tiles print "+0.30% day" directly), and
    those were left alone because their own labels already carry the direction in words. Two rules it obeys:
    a value that ROUNDS to zero stays neutral and glyph-less (matching `sc()`'s `neu`; a "▲ 0.00%"
    would assert a direction the data doesn't have), and the **sign is kept alongside the glyph**
    rather than replaced by it. Verified safe: all 29 call sites render the string directly, all
    table sorting runs over data objects rather than cell text, and nothing parses `textContent`.
  - **ARIA:** `aria-expanded` on every collapsible card header (stamped once in the enhancer — the one
    place every card passes through — then maintained by both toggle paths), `aria-current="page"` on
    the active tab (the accent stripe is now the sole visual cue), `role="tablist"` on the tab bar, a
    labelled Find dialog, 44px+ targets, and `prefers-reduced-motion` honoured.
  - The freshness strip is now **sticky** (`position:sticky` in its inline `cssText`), so snapshot age,
    Find and ↻ stay reachable in a long page. `paintBar()` already set an opaque background on every
    repaint, which is what makes that safe. Analyze still shows no rail until a ticker is analyzed
    (the pre-existing `cards.length<2` rule).
- **Card parity across the two account sides (v101):** the agentic side now carries the SAME analytics
  cards as the self-directed side — snapshot tiles, 🗺️ Holdings Heatmap, 🛡️ Risk & Diversification,
  🗂 Allocation, 💵 Income & Tax, 📡 Technical Signals, 📋 Fundamentals — plus its own 📈 Account
  Performance, 🤖 Agentic Portfolio tracker and 🧾 Rebalance Log. **They are the same functions, not
  copies:** `agenticEnriched()` returns the margin `enriched` row shape (incl. `pct`, `dayD`/`dayP`
  and `r`=`risk(pct)` — the shared renderers read `p.r.color`, so a row without it throws), and each
  renderer took an optional `opts` — `{sfx}` picks the mount id (`'-ag'`), `{min}` the position floor,
  `{scope}` the account. `renderAgenticAnalytics()` (fault-isolated per card, like `load()`) builds the
  book, fetches this account's historicals (merged over `__SNAP.histMap`, since the margin fetch only
  covers ITS top holdings) and drives them. Two deliberate account-specific differences: the position
  floor is **`AG_MIN_POS` (1), not `SMALL_THR` (250)** — this book is fractional (~$150 names) and a
  $250 floor would empty every table; and the snapshot's 5th tile is **Idle Cash %** instead of Margin
  Used (the account can't borrow, so "Margin: None" was a dead tile — idle cash is what actually
  drives its next rebalance). **Six tiles since v110** — value · day · **Unrealized** · **YTD Return** ·
  idle-cash/margin · beta (beta moved to the last slot, which used to sit empty). The renamed
  **Unrealized** tile was called "Total Return", and that label was actively misleading: it is the mark
  on the lots you hold *right now* (`totalPnL`/`totalRet` off current cost basis), so realized gains and
  every closed position sit outside it — the agentic account read **+0.98% · $100.22** two days after a
  $5,000 deposit was redeployed, while its real year was +5.51% / $252 with another $233 already
  realized. The new **YTD Return** tile carries the honest number per side: agentic reads
  **`agenticYTDStats()`** — the calendar-year slice of `agenticPerfStats()`'s chained, deposit-adjusted
  growth (same math, rebased to the first recorded point of the year, `partial` → the sub-line says
  "since {date}" because the equity series can't be backfilled), so the tile and the 📈 Account
  Performance card can't disagree; **since v119 the self-directed side reads its OWN
  recorded series the same way** (`data.main`, via the shared `acctYTDStats`), so both tiles report the
  account's real deposit-adjusted year rather than two different kinds of number; the modelled
  `__SNAP.perf.portYTD` remains only as the labelled fallback for the first day or two of recording
  (that fallback fills in on the *second* `renderSnapshot` call, after `renderPerformance` stashes
  `perf` — it shows a spinner until then, by design). The heatmap keeps **per-instance state** (`_hmS` keyed by suffix) so the
  two mounts' Day/P&L toggles don't move together. **Income & Tax is scoped**: `accountRollup(..., scope)`
  filters accounts, so the self-directed side keeps the all-account view + By-Account table while the
  agentic side shows only ••••3900 (no one-row table, its own harvest floor, options premium hidden —
  options are margin-only, and the harvest pointer targets the rebalance ticket, not the Action Center).
  Two cards are intentionally NOT duplicated because the agentic side already has a superset: **All
  Positions** (the Agentic Portfolio tracker is the same table plus target/drift/trade) and
  **Performance vs Benchmark** (Account Performance is the real, deposit-adjusted return).
  **The switcher is STICKY and lands you on the SAME section (v107).** `.acct-seg-wrap` pins the
  segmented control below whatever else is pinned at the top (`top: env(safe-area-inset-top) +
  var(--stickytop-h)`; measured live by `_syncStickyTop`), so accounts can be swapped from anywhere in the
  page. **That variable was `--tabbar-h` until v131** — the tab row wrapped to two lines on a phone, so a
  hardcoded offset would overlap or gap; the tab bar is now bottom-fixed and the **freshness strip** is
  what sits above the switcher. Still measured live for the same class of reason: the strip's text wraps
  to two lines whenever a staleness or update nudge is showing. `_syncStickyTop` re-measures on resize,
  on orientation change, and through a `ResizeObserver` on the strip (with timed retries as the fallback,
  since `boot()` may create the strip before or after that code runs). Swapping then **preserves the reader's section**: every paired card
  on both sides carries a `data-sec` key (`snapshot·holdings·performance·heatmap·risk·allocation·income·
  technicals·fundamentals·flow·rebalance-log`, plus the unpaired `smalls`), `_currentSec()` notes which
  one is on screen before the swap and `_landOnSec()` scrolls to its counterpart after — so comparing the
  two books' Risk or Income cards is one tap, not a scroll back to the top and down again. An unpaired
  section falls back to the nearest common one **above** it in `SEC_ORDER` (self-directed `smalls` →
  `fundamentals`). Three things here are load-bearing and were each a real bug in development:
  **(a) `__pfTopOffset()` must be built from HEIGHTS + the pinned element's resolved sticky `top`, never
  from live `getBoundingClientRect().bottom`** — a rect-based offset reads ~50px larger while the page sits
  at scroll 0 (nothing is stuck yet), so a scroll computed before sticking and judged after it disagreed
  with itself and landed every jump a section early. **v131 changed WHAT it measures, not how:** the tab
  bar moved to a bottom-fixed bar, so it obscures the page's BOTTOM and is no longer summed here (counting
  it would push every jump ~62px too far down); what remains pinned above the content is the **freshness
  strip** (sticky since v131) plus, on Accounts/Plan, the account switcher. Both can be absent — a
  decrypt-failure boot has no strip, and the switcher measures 0 on pages that don't show it — and both
  cases degrade to a smaller offset, which lands a jump slightly HIGH rather than hiding the card under a
  header. Verified live at 123px = strip + switcher + 8, landing a rail jump at exactly y=123;
  **(b) `_currentSec` picks the FIRST section whose bottom
  clears the header by `SEC_EDGE` (40px)** — "last card whose top is above the line" flips to the previous
  section exactly when the next card starts filling the screen, and "whichever card covers the most pixels"
  tips to the *next* section whenever the current one is short (a compact Allocation card handed you off to
  Income); **(c) the nav-chip `topOffset()` delegates to `__pfTopOffset`** — once the switcher became
  sticky, any jump computed off the top bar alone parks the target card underneath it — and since v131 a
  jump computed off the *tab* bar is wrong in the other direction, because that bar is at the bottom now
  (hence the rail's small fallback offset rather than a tab-bar measurement); **(d) the region
  ABOVE the first `data-sec` card is its own section, `SEC_TOP` (`'__top'`), which lands at scroll 0
  (v120)** — neither hero (nor the self-directed margin banner) carries a `data-sec`, so `_currentSec`
  used to answer `snapshot` for the whole top of the page, and switching accounts while sitting at the
  very top scrolled the incoming side DOWN to its snapshot tiles, **cutting the account balance off
  screen** — the reader had not scrolled at all, yet the app jumped. `_currentSec` now returns `SEC_TOP`
  whenever the first tagged card's top is still below `__pfTopOffset()`, and `_landOnSec` treats it as a
  successful landing at 0 (so the settle pass still holds the top while the incoming cards fill).
  First visit to a
  side also runs `_settleOnSec` (re-place for ~1.2s, cancelled by any real scroll input) because that
  side's cards are still filling in and everything above the target grows.
  **Both sides run the SAME card order (v106)** — hero → snapshot tiles → *holdings table* → *performance*
  → 🗺️ Heatmap → 🛡️ Risk → 🗂 Allocation → 💵 Income & Tax → 📡 Technicals → 📋 Fundamentals → 🏛️ Flow →
  pointer, where "holdings table"/"performance" resolve to each side's version of that card (All
  Positions / Performance vs Benchmark on the self-directed side; Agentic Portfolio / Account
  Performance on the agentic side) — then **🧾 Rebalance Log**, which since v127 trails Flow on BOTH
  sides (the agentic one graded from its executor's confirmed ledger, the self-directed one derived
  from the account's filled orders; `data-sec="rebalance-log"` is a paired section, so the toggle lands
  you on the other book's log rather than a neighbour). The self-directed 🧹 Positions Under $250 card
  remains a conditional extra (the agentic floor is `AG_MIN_POS`, so it can't apply there). **Keep the spine aligned when adding a
  card** — the toggle swaps the two containers in place, and a card that sits third on one side and
  eighth on the other makes the switch feel like a different app rather than the same view of a
  different account.
- **🧾 Rebalance Log — SELF-DIRECTED (v127, Accounts tab, ••••0741 side, after Flow):** the mirror of the
  agentic account's log, so the two books are judged on identical terms. One row per ET trading day —
  the trades, the dollar-weighted contribution since the fill, the same window's **alpha vs SPY**, and an
  ahead/behind/open verdict. Rows are DERIVED from filled orders rather than appended by an executor
  (there is none on this side — see `maindecisions.mjs`), and the card says so. 12 most recent shown, the
  rest behind a `<details>` expander; legs capped at `SD_LOG_LEGS` (8) per day with the remainder counted,
  because this book's real history contains a 60-leg near-total liquidation that would otherwise render as
  a wall of tickers. Deliberately **without** the agentic card's research-sleeve strip — there are no
  sleeves on a discretionary book, and rendering them would leak one mandate's rulebook onto the other's
  surface. **Both logs carry a ⏱️ Frozen outcomes strip (v129)** — each decision's alpha vs SPY measured
  AT 5/30/90 days and never re-marked — because the table itself marks everything to today, so without it
  more history never compounds into an answerable question. Earlier decisions are measured from the
  snapshot's own recorded daily closes, so the record starts full rather than empty; the ones whose price
  history doesn't reach the horizon (a name that left the book) are reported as unmeasurable rather than
  priced off a series that merely stops.
  **It briefly shipped on the Plan tab** (v127, same day), which read well beside Track Record —
  that grades the *screen*, this grades *what was actually done* — but split the same card across two tabs
  depending on which account you were viewing, and left `rebalance-log` an unpaired section so the toggle
  had nothing to land on. Owner's call: mirror the agentic placement, keep a pointer on Plan.
- **📈 Account Performance (v99, agentic side)** — the account-level performance the Agentic card never had.
  **`agenticPerfStats(AG, spySeries)`** is now the single source of truth for this math: extracted verbatim
  out of `renderPerformance`, it returns `{EH,mult,cumFlows,ret,spy,since,netFlow,firstEquity,lastEquity,pnl,days}`
  and BOTH surfaces call it (the Portfolio benchmark chart's "Agentic since" stat and this card), so they
  cannot disagree. Everything is **deposit-adjusted**: the headline is a **time-weighted** return that chains
  per-step returns with external flows neutralized (producer `cumFlow` deltas when present, else zeroing any
  implausible >20% one-step jump), because this is a self-funded account with no transfers feed — a deposit
  would otherwise read as profit (the +250% bug). `cumFlows[i]` is the running implied flow, defined as
  `cur.equity − prev.equity×(1+r)` so it stays exactly consistent with the return series. Stat row: Return
  since {date} · S&P 500 same window (+ ahead/behind in pp) · Money made (net of deposits) · You put in
  (start + added **since {date}**) · Account today (invested + cash). **A 💰 contributions strip (v103)
  itemizes every detected transfer — date + amount, most recent bolded, legacy untagged ones flagged `*`
  — because one cumulative "you put in" figure standing next to a same-day deposit reads as though the
  whole amount arrived today (the owner saw $10,083.94 the day they wired $5,000 and reasonably called
  it wrong; the figure was right, the card just never showed its work). `agenticPerfStats` returns
  `flows[]` (per-step implied flow, $50 floor) for it, and the Value-$ chart dots the contribution line
  at each one. Chart toggles **Return %** (deposit-adjusted line vs SPY
  rebased over the same window, aligned by calendar day) ⇄ **Value $** (raw equity with cumulative
  contributions as a dashed baseline — the gap between the lines IS the money made). Degrades honestly:
  under 2 recorded points it explains that tracking can't be backfilled (the broker publishes no
  account-equity history) instead of showing a fake number, and a chart failure leaves the stat row intact.
- **Portfolio (the Self-directed side of the Accounts tab):** All Positions table (sortable) with a **TOTAL footer row** (value, cost, P&L $, P&L %
  on cost, value-weighted Day %); **Holdings Heatmap** (squarified treemap, sized by value, colored by
  day move or total P&L, tap-to-Analyze, with a "top N of M" coverage note when capped; **locked to
  this account's book** — the v74 Margin ⇄ Agentic compare toggle was **retired in v106**, since v101
  gave the agentic side its own heatmap and one page showing the other page's holdings was a second,
  worse route to the same tiles; `_agenticHeatRows()` lives on as the `-ag` instance's source);
  risk/concentration
  with a **risk-adjusted metrics row** (Sharpe · annualized volatility · max drawdown · beta, computed YTD
  from covered holdings' historicals in `computeRiskMetrics`) plus a **data-derived concentration &
  correlation context** block (largest theme, an **empirical correlated cluster** from actual return
  correlation in `corrGroups`, and the highest-β "fragile leg" from per-symbol betas — no hardcoded
  tickers); allocation; **Income & Tax — ALL accounts, attributed (v98)**: the four tiles (est.
  annual dividends, income/month, **Realized — YTD**, harvestable losses) are all-account totals, and a
  **🎯 prediction-market strip (v132)** sits beside the options-premium one on the self-directed side —
  event contracts settle through Robinhood Derivatives and `get_realized_pnl` is per ASSET CLASS, so they
  are genuinely absent from the Realized tile and are reported as their own line rather than folded into
  it (reads `data.realized.predictionMarket`; hidden on the agentic side, which doesn't trade them), and a
  **🏦 By Account** table underneath splits value · unrealized P&L · realized YTD · est. dividends ·
  harvestable across **📊 Individual margin ••••0741** and **🤖 Agentic ••••3900**
  (`accountRollup`/`agenticEnriched`), with a Total row net of margin debt. Previously every figure here
  was margin-only *while reading as the whole picture* — ••••3900's dividend payers, unrealized P&L and
  realized gains appeared nowhere, and the Realized tile was a hand-typed margin figure that had frozen
  (it read $2,335 against a real $4,746.90 across both accounts). Realized is now **broker-reported per
  account** (`data.realized.accounts`); the dividend yield still divides by **dividend payers only**
  (`computeIncome` now returns `mktBasis`/`costBasis` so a multi-account roll-up pools the right
  denominators); the agentic account is scanned for harvestable losses at the **rebalance planner's**
  floor (`AG_TLH_MIN` $200 / `AG_TLH_PCT` 10% of cost — raised from $75/5% on 2026-09-08; a harvest sells the WHOLE position and the wash guard then blocks the rebuy 30 days, so the old floor was a de-facto −5% hard stop with a forced month out of a name the research still wanted, and ~$19 of tax on a $75 loss does not pay for that) rather than the margin book's `SMALL_THR` $250
  position floor, so the card and the rebalance ticket agree on what's worth harvesting; ex-div rows are
  tagged by account and filtered to genuinely **upcoming** dates; and `load()` now fetches
  COMPANY_OVERVIEWs for the agentic holdings too — they were already recorded in the snapshot, the page
  just never asked, so that account reported **$0** of dividends on a book of SPY/JPM/V/AAPL/UNH.
  Degrades honestly: margin-only (with a note) when there's no agentic snapshot, and an explicit ⚠️ when
  Realized isn't yet broker-sourced for every account shown. The itemized harvest list still lives in the
  Action Center — which now sits on the **Picks page** (see below) — only a summary stat + pointer here. **Est. annual dividends (v94):** `computeIncome` prefers `DividendPerShare`×qty
  but now **falls back to `DividendYield`×market-value** when a holding's overview carries a yield but no
  per-share amount — the case for names that only got the lighter Robinhood-synth overview (e.g. NVDA/TSM via
  the Railway `holdings-fund`), which previously showed **$0** income. The Railway producer now also emits
  `dividend_per_share`/`distribution_frequency`/`ex_dividend_date` (so per-share income + the ex-div list
  populate going forward). Ex-div dates only list names whose overview carries `ExDividendDate`. **Technical Signals** = RSI **+ price vs 50-day SMA** trend. **Performance vs
  Benchmark** plots YTD % return (your holdings vs SPY/QQQ, all indexed to Jan 1) and now **overlays the
  agentic account** (v72): a faint **dotted "modeled"** line (its current holdings priced back to Jan 1,
  same synthetic method as the "Your holdings" line) spliced into a **solid "real"** line from
  `data.agentic.equityHistory` (recorded forward), plus an **"Agentic since {date}"** stat that rebases SPY
  over that same window (`renderPerformance` reads `window.__DATA.agentic`; aligns equity points to the SPY
  axis by calendar day). **The real line + "Agentic since" stat are deposit-adjusted (v92):** they're a
  **time-weighted** return that chains per-step returns and neutralizes external cash flows (deposits the
  owner adds / withdrawals) — using the producer's inferred `cumFlow` deltas when present, else zeroing any
  implausible >20% one-step jump — so funding the account no longer masquerades as a gain (was the bug: a
  deposit had inflated "Agentic since" to +251.83% vs the true ~+2%). All the above commentary is derived from live data; optional owner editorial can be
  supplied via `data.notes`.
- **Plan tab is SPLIT BY ACCOUNT (v108) — the same switcher the Accounts tab carries.** `page-picks`
  now leads with a sticky `.acct-seg-wrap` (`#plan-seg-wrap` → `setPlanAccount('main'|'agentic')`) over two
  containers: **📊 Self-directed** = `#picks-app`, the daily scan + Action Center + Top-3, unchanged; and
  **🤖 Agentic** = `#plan-agentic-app`, rendered lazily by `renderAgenticPlan()`. Both tabs share the
  **`pf_acct`** key, so the app has ONE account context — but each side only re-renders while its page is
  VISIBLE (a Chart.js canvas built into a `display:none` container sizes to zero), so `setPlanAccount` only
  mirrors the other tab's button state and `switchTab` brings whichever page you land on into line. The
  mental model is **Accounts = what you own, Plan = what happens next**, both split the same way.
  The agentic side deliberately carries the **plan half only** — it does NOT restate the holdings/drift
  table or the Rebalance Log (those are the Accounts tab's Agentic side; a card that exists twice is the
  v99 mistake this repo already made once). Six cards: **🤖 Where the plan stands** (the `data.agentic
  .pending` ticket + its `nextAction`, book/idle-cash/on-target/last-rebalance tiles, the `cashIdleSince`
  clock, off-target holdings), **🎯 The target — and why these names** (weights · entry vs. spot · stop/TP ·
  a per-name **Status** badge, with the per-name thesis + `drivers` behind `<details>`, and — since v145 —
  the **construction note** behind *"How this target was built"*: an authoritative header strip
  (active/phase-out split, defensive, diversifier — straight off the structured fields), the synthesis's
  prose one claim per line with tickers and figures weighted, then each thing `finalize-target` enforced
  as its own labelled row. Chunked and weighted only; the text is never rewritten),
  **⏸ What's blocked — and what clears it** (split in **v126** into two labelled halves: **🛒 Buys deferred** —
  every wash-sale / earnings / entry-band deferral, each with the date or condition that clears it, plus whether
  zones have gone advisory — and **💸 Sells held back**, read from `data.agentic.pending.blockedSells`, naming the
  guard, the trade it would have been and the unlock date. The sell half exists because the buy half is computed
  from the TARGET, and an exit sells a name the target no longer contains — so a suppressed exit was structurally
  unrenderable here, which is how a deposit-funded buys-only ticket came to look like a failure on 2026-08-25.
  **v134 gated the buy half on `agenticBuyGap` — a deferral is only shown for a name the planner is actually
  trying to BUY** (underweight past the planner's own `gap > 0.5`, park allowance included), so a name held at
  its target weight no longer reports "⏳ wait for pullback" for a top-up nobody is making; see the gotcha),
  **🅿️ The waiting ground**
  (`data.agentic.parked` — the VTI ledger), **📏 Guardrails** (the standing rulebook: cluster/vol caps,
  min-hold, re-entry cooldown, wash window, earnings blackout, entry band, drift trigger, auto tier, PDT,
  dust floor, idle-cash deadline, no leverage), and **🔁 How the loop runs**. The hero also carries a **📖 The whole plan** button (v123) → `openHelp('agentic-whole-plan')`: one plain-English walkthrough of the entire agentic model — the six sleeves, the adversarial verify, sizing + the correlation/vol/look-through caps, every reason a trade gets blocked, the drawdown breaker, the waiting ground, regime pacing, the tax treatment, and an explicit "what it will never do" list. Written for someone who has never seen the app, so it doubles as the thing to hand a person who asks how it works; it reuses the shared help modal (one `HELP` registry entry + one button — no new modal machinery). This exists because `parked`,
  `phaseOut`, `cashIdleSince`, `target.dropped` and the whole rulebook were rendered **nowhere** — they
  lived only in `AGENTIC.md`, i.e. not on the phone. Read-only: it reports what the automated system
  intends and why, and places nothing.
  **The guards are SHARED, not copied** — `agenticWashMap(A)` / `agenticExecMap(rows,targetAsOf,washMap)` /
  `agenticEntryBounds` / `agenticPxOf` were extracted out of `renderAgenticCard` so the card, this page and
  `producer/agentic-deploy.mjs` can't drift; the `AG_*` constants at the top of that block mirror the
  planner's exports one-for-one. A badge that says "buy deferred" while the executor buys anyway is worse
  than no badge. **v108 also fixed a real card bug the new fixtures exposed:** the Agentic Portfolio card
  treated the **`VTI` parking vehicle as an off-target orphan** and put "EXIT — SELL ALL VTI" in the deploy
  hand-off, contradicting the planner's exemption (which exists to stop an infinite park→liquidate→park
  churn loop). It now renders as **`waiting ground` / `parked` / hold** and is excluded from the orphan
  exits. **v109 then finished the split** by deleting the duplicated half from the Accounts card (Target/Drift
  column, TP/Stop sub-line, Targets-to-open strip) — see the Agentic Portfolio entry below. Keep it that way:
  the target belongs to ONE surface, and the reason it's the Plan tab is that a target is about what happens
  next, not about what you own. `make-sample-data.mjs` gained the matching fixtures (`parked`, `pending`, `cashIdleSince`, a
  cross-account `recentLosses` entry, a held VTI, entry zones that trip the band) so all of this renders in
  local preview instead of showing every card in its empty state.
- **Picks (the "🎯 Plan" tab — renamed from "Picks" in v56):** **sortable + sector-filterable** scored candidates table incl. a
  **Social** column (retail buzz, 20% of composite, with an inline buzz label) and **data-coverage cues**
  (grey social = "no data, neutral 5"; `ᵛ` = value-only fundamentals when AV growth is unavailable).
  **Action Center** (moved here from Portfolio in v55 — it's portfolio-derived but conceptually "the plan",
  so it pairs with Picks as the act/decide surface): one card, two tiers below the hero — a **Do-now** tier
  (the ranked live-signal feed: margin/concentration/earnings/overbought/oversold/correlated/retail-buzz)
  and a **The-plan** tier (`renderActionPlan`).
  **⚡ v113 — the plan tier now runs the SELF-DIRECTED AGGRESSIVE MANDATE (`SD_*` constants).** The two real
  accounts run opposite mandates and this renderer used to ignore that: it hard-coded ONE objective (pull
  beta down) and drew its redeploy ideas from the producer's oversold mean-reversion screen. On a
  concentrated, 1.6×-levered AI/compute book that rendered as *"sell everything that's red, then buy low-β
  ballast + bonds/gold + three Brazilian value names"* — a de-risking plan running on the account whose
  whole purpose is high-beta growth. (••••3900 is the guarded, diversified one; **do not make this side
  imitate it**.) Three structural fixes, each of which was a live defect:
  **(1) Exits are a THESIS test, not the sign of P&L.** The old harvest filter was `pnlD<0 && val≥$250`, so
  in a levered high-beta book *everything* qualified on any red week. `sdBroken(sym,costPx)` now requires the
  50-DMA to have rolled under the 100-DMA **and** price to sit decisively below it, or a −25% stop breach.
  "Decisively" is **vol-scaled** (`buf = clamp(vol/8, 5%, 20%)`) — load-bearing, because a 114%-vol miner
  6% under its 100-DMA is inside its own noise, and without the buffer the rule fires on exactly the
  volatility the mandate exists to hold. (The producer's `trendGate` uses the 200-DMA; a YTD daily series
  can't reach 200 bars, so the 100-DMA is the long anchor here.) Red-but-intact = **hold**.
  **(2) Percentages are on EQUITY, not gross exposure.** With margin debt the two diverge enormously —
  IREN read "49% of exposure" while being **79% of what the owner actually owned**. Every percentage on
  this side is a fraction of equity (`st.totalVal`), which is also why v116/v118 had to fix the tiles.
  **v125 replaced the CAPS themselves with BANDS — see the gotcha below.** The v113 dials
  (`SD_SINGLE_CAP` 50% / `SD_CLUSTER_CAP` 80% / `SD_MAX_LEVERAGE` 1.60×) are **deleted**, not relaxed:
  margin posture is now `SD_UTIL_CRUISE` (**50%**) / `SD_UTIL_MAX` (**70%**) of the **credit line**, and
  concentration is a **readout that generates no orders** (`SD_CONC_FLAG` 50% of equity is a reporting
  threshold, never a cap). The only sells this plan emits are a **broken thesis** and, above the ceiling,
  a **margin paydown** sourced weakest-momentum-first. A name being exited is **never also paid down**
  — the old code put an over-cap loser in both tables and summed both proceeds, overstating the
  deployable pool by the entire value of those shares; the one-name-one-decision rule survives intact.
  **(3) The redeploy universe is a MOMENTUM lens, not the oversold screen.** `sdMomentum(sym)` (memoized per
  snapshot, reads only `data.hist.day` + `data.quotes`) scores 6- and 3-month **relative strength vs SPY**,
  trend state (px vs 50-DMA, 50 vs 100-DMA + slope) and **proximity to the trailing high** — the inverse of
  an oversold screen, which by construction cannot surface leadership. Weights renormalize over whatever
  components are present; under 2 it abstains. `SD_BENCH` is the curated aggressive universe (this side's
  counterpart to `producer/leaders.mjs`), tiered core/sat/asym. Pool splits per `SD_SLEEVES` —
  **30 core / 45 satellite / 15 asymmetric / 10 dry powder** (owner-set) — allocated **inverse-vol** within
  each sleeve, then clamped by `SD_SINGLE_MAX_X` (**60% of exposure**, v125) so no single BUY leg piles the
  whole sleeve into the leader. That clamp is a **sizing rule for new money, not a cap**: it shrinks a leg,
  it never sells anything, and the cluster clamp was dropped entirely (this whole book is one cluster by
  design — the 4/4/2 sleeve structure plus inverse-vol IS the diversifier).
  **No bond/gold sleeve exists on this side at all.**
  Two gates are non-negotiable: **`SD_MIN_SCORE` (5.0/10)** — without it a sleeve fills from whatever ranks
  least-badly in its tier, and the first live run wanted $1,492 of TSLA at **1.2/10** (−41pp vs SPY) purely
  because nothing better carried that tier; and the **staleness gate** (see Gotchas). An empty sleeve's
  weight **cascades up** (asym → sat → core) and anything still unfilled stays dry powder — "there is no
  leadership to buy today" is a legitimate answer and a far better one than a bad fill.
  **(4) Covered-call collateral is reserved (v119).** Nothing in this plan knew the account had sold
  calls, so it happily sized exits and cap trims over shares that were collateral — selling them turns
  a covered call NAKED. `sdLockedShares()` (mirrors the producer's `sharesLockedByShortCalls`, pending
  sell-to-opens included) caps every sell at the free count, flags a partially-capped trim, lists a
  broken-but-fully-pledged name as blocked with buy-back/roll named as the way out, and adds a
  standing guardrail. The Do-now MARGIN alert picks a sellable paydown candidate for the same reason.
  **Wash-sale guard (new on this side):** `sdWashMap()` reads `data.agentic.recentLosses` and deliberately
  does **not** filter by account — the IRS window is per *taxpayer*, so a loss booked in ••••3900 blocks a
  rebuy here and vice versa. Blocked names are dropped from every buy ticket with the clear date shown.
  Step 3 guardrails are rewritten for this mandate: leverage ceiling, equity-based name/cluster caps,
  vol-scaled stops on every satellite, the **house-money rule** (`SD_HOUSE_MONEY` 2× → sell the cost basis
  and let the rest run), never add to a broken trend, and earnings-gap sizing. Concentration figures are
  reported over what you'd still **hold** (a name being exited wholesale is not "your largest position").
  Buys that coincide with a vetted pick still populate `window.__PLAN_ADDS`, so the Top-3 cards keep their
  "🧭 the plan picked this" badge. (v113 removed the now-orphaned `pickLevels`, `synthPickFromCandidate`
  and `jumpToPick` helpers along with the retired picks-backfill sleeve.)
  The **`PLAN_*` constants remain** — they are still read by the agentic heuristic-target fallback, and are
  NOT this side's rulebook any more. (The old producer-driven **⚖️ Trim/Add** card was retired in v56 — the
  Do-now feed + this plan own trim/add now; `PICK_TRIM`/`PICK_ADD` still load but aren't rendered.) **The recommended portfolio is a standalone _Agentic Portfolio_ card** (v67 — formerly Step 4 of the Action Center; built by `renderAgenticCard()`. **Moved in v99** off the Plan page onto the Accounts tab's Agentic side, together with the Rebalance Log — the Plan page keeps a pointer card in their place, and `paintActionCenter()` still repaints them from `__SNAP` whenever that page exists.) It is the blueprint for the **agentic account (••••3900)**, no longer a restructuring of the margin book. **Its target is the weekly deep-research output** (`data.agentic.target`, read from `producer/agentic-target.json`; v68) so the card shows drift vs. the REAL deployed basket; **only when that's absent** does a fallback heuristic build a from-scratch, long-only, **UNLEVERED** target from a **fully-independent universe** — top scored picks ∪ a mega-cap **LEADERS** bench (`producer/leaders.mjs` → `data.leaders`, hardcoded fallback) ∪ an SPY/QQQ index core ∪ **whatever ••••3900 already holds** (the margin account is ignored). Sector-diversified (≤4/sector, `TOTAL_CAP` 15, `ADD_SLOTS` ≈ `max(3,12−heldCount)`), conviction-weighted (3.5% floor, `PLAN_SINGLE_CAP` 25% ceiling), normalized to 100%, and **sized to the account's own equity** (`data.agentic.equity` = cash + positions; book = equity, i.e. 1× — no leverage: limited margin grants instant settlement only, never borrowing). **Unified single tracker (v91 — replaced the old target-table + separate "Your holdings — performance" table, which duplicated every held name across two tables).** One table iterates **what ••••3900 ACTUALLY holds**, **largest position first (v144 — the order comes from `agenticBook()`, so the orphan list and the Plan tab's off-target line inherit it)** — one row per holding carrying its **Position ($/% of book)**, **trailing performance** (Day % from the live quote's prior close, shown since v146 as **the day's move in CASH on that position over the percentage**, `plCell`'s order — the dollars sum to the Total row where percentages cannot; YTD moved to the cell's tooltip), **unrealized P&L ($/%)** (cost = avgCost×qty), and the rebalance **Trade (±sh ≈ $)**. A **Total** footer rolls up value-now/+cash, value-weighted Day & YTD and aggregate P&L. **Held names NOT in the target ("orphans")** still appear in this table (flagged `off-target`, trade = trim-to-exit); the **`VTI` parking vehicle is exempt** and renders as `waiting ground` / `parked` / hold (v108 — the card used to call it an orphan and put "EXIT — SELL ALL VTI" in the hand-off, contradicting the planner's exemption that stops an infinite park→liquidate→park churn loop). **v109 slimmed the card to the BOOK:** the **Target % / Drift** column, the **TP/Stop** sub-line under Trade and the **"🎯 Targets to open"** strip were all removed — the Plan tab's Agentic side (v108) owns the target, its entry zones, its stop/TP and its per-name status including over/under-by-Xpp, so keeping them here was the same numbers in two places AND the extra width pushed the genuinely account-side columns (P&L, Day/YTD) off a phone screen. What remains is what only the book can answer, plus the Trade cell, since that is what the hand-off button actually places; an intro line links across to the Plan tab. When the account holds nothing (all cash) the table is replaced by an info line pointing there. It reads **`data.agentic`** (the account's real cash + positions — emitted by `build-data.mjs` from the producer's `agentic-portfolio.json` / `agentic-positions.json`, carry-forward like realized/options); until that snapshot lands it shows **target weights only**. Brackets (`tpOf`/`stopOf`) are **monitor-only** — fractional positions can't carry resting GTC stops. The **🤖 hand-off button** carries a deploy/rebalance prompt that targets ••••3900 with **fractional dollar-market** orders (review_equity_order → confirm → place). **Wash-sale guard (v91):** the card reads `data.agentic.recentLosses` (the inferred realized-loss ledger build-data maintains) into a `washMap` and, for any target name with a realized loss **inside the last 30 calendar days**, replaces its **Trade** cell with a "⚠️ wait · wash-sale (to {date})" badge, drops it from the deploy hand-off's BUY list (moving it to a **"DO NOT BUY YET"** section with the clear date), and shows a **Wash-sale hold** note below — the target *weight* is unchanged, only the execution is deferred. The 30-day taxable-account rule pairs with the 10-trading-day cooldown on the research picks screen (the user's "both, per surface" choice). (The old margin Step 4 — leveraged to `equityBase + marginUse`, anchored to current margin holdings — was removed from `renderActionPlan`, which is now Steps 1–3 only.) **Execution-discipline deferrals (v93):** alongside the wash-sale guard, the card now defers a BUY (target weight unchanged, buy held back + left out of the hand-off, with an amber badge in the Trade cell and a note) when a target name is inside a **~7-day earnings blackout** (`azEarn` — wait for the print) or has **gapped through its entry/stop** (at/below stop = broken; below the planned entry zone = re-verify, e.g. a name that sold off after earnings). Mirrors `producer/agentic-deploy.mjs` so the card and the producer's rebalance ticket agree. **v104 mirrors the v102 band:** the entry check is symmetric and toleranced (±2.5% under the floor / 2.0% over the ceiling), adds an **`above-entry` deferral** ("⏳ wait for pullback" — nothing guarded that side before, so a target whose zones sat below spot would have been bought straight through), and goes **advisory when the target's `asOf` is >7d old** (the card says so explicitly), since a whole target reading out-of-band at once is stale zones rather than broken companies. `below-stop` stays absolute. **v122:** the hand-off's BUY leg is also gated on **`data.agentic.drawdown`** (soft/hard ⇒ buys listed ON HOLD in the prompt + an amber note on the card; sells untouched) — mirrors the planner's breaker so the card can't offer buys the executor refuses. **v96 — the hand-off is FULL-BOOK + tax-aware:** off-target orphans are explicit **"EXIT — SELL ALL"** lines (losses first, each with an est. ST gain/loss tag via `estPl`/`orphanPl`), trims carry the same tag, an **"Est. short-term tax impact"** line nets the ticket's gains against harvested losses (with a cross-account wash caveat), and the sequencing (sells first → their proceeds fund the buys the same session, once they fill — v98 limited margin) is spelled out, along with the PDT rule that nothing bought today is sold today — mirroring the planner. A **🤖 Rebalance-in-flight strip** renders whenever `data.agentic.pending` carries a live executor ticket (id · status · legs · turnover · est ST net · what happens next). A sibling **🧾 Rebalance Log** card (`renderAgenticLog`, reads `data.agentic.decisions`) grades every confirmed deploy/rebalance vs what happened next + vs SPY (ahead/behind/open) — the account's own track record. **The whole loop is now self-driving (v96):** a separate hourly **executor** trigger (AGENTIC.md §executor — `agentic-exec-gate.mjs` → `agentic-pending.json` state machine) exits/harvests/rebalances unattended within the owner-approved **$10,000/ticket auto tier** (raised from $1,000 on 2026-08-25) and pushes proposals above it for the owner's confirm, with tiered TLH (losses-first on every sell + opportunistic harvests ≥ max($75, 5% of cost)).
  On the **Plan page the Top-3 pick cards now sit directly under the Action Center** (v58), ahead of the
  Composite chart / Scoring table, so "the plan → the three ideas it deploys into" reads as one unit.
  Step 1 / Step 2 each get a **🤖 hand-off button** (`planOrdersPrompt` → `chatBtn`). The Action Center is
  **portfolio-derived**: `load()` stashes each enrichment stage into `window.__SNAP` and calls
  `paintActionCenter()`, which `renderPicksStatic()` also calls — so the card populates whether the Picks
  tab is opened before or after the portfolio finished loading (no-ops cleanly until data + DOM both exist).
  `renderActionPlan(enriched,clusters,totalVal,betaInfo,rsiMap,ovMap,earningsMap,smaMap)` — the last four
  args are decorators, so it renders on the first pass and re-renders as they arrive.
  Top-3 cards with thesis/levels
  are **sector-diversified** and carry a **catalyst-risk note** when earnings land inside the swing window.
  **Track Record** card grades archived past picks (`data.picks.history`) on a closing basis — hit
  TP1/TP2, stopped, or open — with a running hit-rate + avg return (graded client-side from daily bars).
  **Graded in the PRODUCER since v140 (`pickgrade.mjs`), and honest about what it cannot grade.** It read **0% hit rate · 0W·2L · 42 open** because it walked `data.hist.day` on the phone and that series freezes per symbol days after each scan — the true record over the same episodes is **9W·3L / 75%**. Episodes are now graded upstream and each resolved outcome is **frozen into the snapshot**, so the record survives its own prices going stale; an episode whose series does not reach the measurement date reports **"can't be graded"** (a `?` chip, its own amber sentence in the clarifier) and is excluded from BOTH the hit rate and the average, rather than counted as "open"; a resolved pick is measured **to its exit** (a stop-out is its stop, not the rally that followed); the window closes at 60 days into `⌛ EXPIRED`; and every price in the graded detail says **which** price ("exited"/"last close") and **as of when** — it used to print a per-symbol carried-forward quote, up to two months old, with no date at all. **Compact by default (v89):** the card leads with the 3 headline stats (Hit rate · Avg return ·
  **Record** = W·L) + a one-line **resolved-vs-open** clarifier (resolved = a close hit a target=win or
  stop=loss; open = still running, excluded from the hit-rate) + a **compact recent-outcomes chip strip**
  (last 12, most-recent first: ✅ win · ⛔ loss · • open). The full per-scan breakdown (entry/exit levels,
  recent 8 scans) is tucked behind a native **`<details>` "View graded detail"** expander (`.trk-detail`)
  so the card no longer grows unbounded as history accrues. Headline stats now reuse `picksTrackStats()`
  over the FULL history (previously recomputed inline over only the 8 shown scans, so they could diverge).
  **EPISODE dedupe (v91):** `picksTrackStats()`/the chip strip now count **episodes**, not per-scan re-picks —
  `picksEpisodes()` groups each ticker's archived picks chronologically and starts a new episode only on a gap
  > `EPISODE_GAP_DAYS` (14, matching the cooldown), grading each episode from its **earliest entry** (the
  outcome of that continuous position). So one broken thesis re-picked daily counts **once**, not N times: ORCL,
  re-surfaced ~10 sessions before it got trend-gated, had turned the record into 0W·10L off a single bad call —
  now it's a single ⛔ episode (chip shows **·N** = how many times it was re-listed). The `<details>` per-scan
  breakdown stays granular; only the headline/record/strip dedupe. (The producer-side cooldown, above, prevents
  *future* daily re-picks; this fixes the historical measurement distortion.)
  A pointer card under Track Record links to the **🧾 Rebalance Log** on the Accounts tab (below).
  Dynamic Earnings Preview follows the soonest-reporting top pick. **Robinhood watchlist sync:** on
  each FETCH_ALL run the producer mirrors the composite top 10 into the **"Dashboard Top 10 Picks"**
  Robinhood watchlist (daily add/remove diff via `sync-watchlist.mjs`), so the list in the Robinhood
  app always tracks the Picks table.
- **Analyze:** per-ticker technical+fundamental breakdown, Recommendation card, Sentiment & Buzz card,
  chat-to-build-trade + Robinhood deep links. **Card de-dup (v85):** the deep dive was slimmed by folding
  redundant cards into their natural home — the standalone **Exact Trade Levels** + **Position Sizing** cards
  are gone, their Entry/Stop/TP1·TP2 (now with target %), the risk-based share-size line, and the hand-off/RH
  buttons all live in the **Recommendation** card so the whole trade plan reads as one unit (`azRec(a,x)` —
  takes `x` for sizing/held); **News Sentiment + Social Pulse merged** into one **🗣️ Sentiment & Buzz** card
  (news block + retail-buzz block, divider between; help key `sentiment buzz`); fundamentals
  **stopped being repeated** in the narrative (Valuation & Catalysts owns P/E·Fwd P/E·Rev-growth·yield, and now
  the **Sector** tile too); and **β is shown once** (Indicators), dropped
  from the setup-gauge subtitle and the Recommendation meta line. **Round 2 (v86):** the standalone
  **📖 Understanding This Analysis** card was retired — its Trend/Momentum-RSI rows just re-stated the Indicators
  grid + gauge bars; the one teaching blurb that carried weight (**💡 Why this signal** — the plain-English read
  of the call + dampeners, built as `whyTxt`) now renders **under the Setup gauge**. **🕒 Multi-Timeframe** folded
  into the **Indicators** card as a compact "Timeframes" line (D/W/M ▲▼ glyphs + alignment). **🧱 Key Levels merged
  into Scenarios** → one **🎲 Levels & Scenarios** card (support/resistance block above the bull/base/bear table;
  help key `levels scenarios`). **Round 3 (v87):** the two big chart cards left the Analyze stack — the verbose
  **🔭 Chart Pattern Verdict** card became a small subtle **🔭 Chart read** pill above the Recommendation, and the
  **📊 Interactive Chart** launcher card was dropped (chart opens from the pill / the 📊 Chart button by the input;
  its help moved into the analyzer modal). See the Chart Pattern Verdict entry below for detail. Net Analyze deep
  dive ≈ 13 cards. All pure consumer-side — no producer/data change; the chart **internals** (detection, modal)
  are unchanged, only their placement. **The setup score is no longer technical-only (v75):**
  `analyzeStock()` blends a **fundamentals/quality sub-score** (`_fundScore` — forward P/E, revenue
  growth, PEG, profit margin, analyst-target upside; neutral 50, returns null when <2 inputs so sparse-AV
  names fall back to the old technical-only weights) into the setup at **15% weight** (pattern 34 / signal
  30 / risk 21 / fund 15). Two **confidence-only dampeners** (they never move the setup score) also fold
  in data we already collect: an **imminent earnings print** (≤7d → IV-crush/gap haircut, via `azEarn`)
  and a **high-VIX regime** on a bullish call (`azVix()` reads the recorded `INDEX_DATA` VIX synchronously;
  ≥22 elevated / ≥30 high). All three are surfaced transparently — the fundamentals score in the
  Recommendation meta line + Fundamentals narrative, the dampeners in the "Why This Signal" note + meta
  chips. The ticker box has **native autocomplete** over the
  analyzable universe (`azUniverse` = holdings ∪ picks ∪ daily-bar symbols ∪ quotes ∪ options book),
  and a **miss shows clickable suggestions** instead of a dead-end. Every card is collapsible +
  jump-navigable (shared `.card-nav` / auto-collapse observers). Price chart adds **volume bars
  (data-gated — only when the bars carry volume; the header drops "· volume" otherwise) + an
  RSI(14) sub-panel** (30/70 bands); axis/tooltip dates are compacted via `azDateLbl` (e.g. "Jun 12",
  not the raw ISO timestamp). **Scenarios** show a **±1σ implied expected-move band** anchored
  to live option IV when available (`azIV`, else a realized-vol proxy, labelled market-implied vs
  est.); **Historical Edge** widens its RSI match band adaptively (±8→±20) for a usable sample;
  **Options Play** links to the Options tab and flags real greeks when you hold live contracts on the
  name; **limited-data** tickers get an explicit "locked until next run" card, and since **v141** a
  **stale-history** ticker (bars >10 days behind the snapshot) gets a ⏳ card and its technical call is
  WITHHELD rather than shaded (4–10 days: scored, confidence ×0.8, amber "bars N days old" badge) — see
  `azHist` and the v141 gotcha. **v141 also rebuilt the call itself:** `azCore` is a PURE function
  (`producer/analyze-core.test.mjs` extracts it from `index.html` and runs it in node) with a three-way
  trend against the 50-day (buffered, so a routine pullback is `neutral` rather than a downtrend), an
  explicit `extended` state (RSI ≥70, >8% over the 20-day, or at the recent high on +15% momentum) that
  reads **Extended — Wait for Pullback**, the oversold check FIRST so it is reachable, stops = the wider
  of 2×ATR and the swing low clamped to 3–10% below price, targets from structure (nearest pivot/recent
  high ≥3% above, then the 52-week high or 2× that distance) with `rr` shown and a BUY downgraded to
  ACCUMULATE with a "targets don't pay for the risk" line under 1.5:1; the Recommendation card carries
  action · why (the two inputs that moved it) · horizon · R:R · "what flips this call" (one price each
  way) · a data-quality line (bars as-of, quote age, fundamentals inputs, trailing-vs-forward P/E); and
  **📏 Measured in this snapshot** (`azEdgeStats`, incremental O(n) walk-forward over EVERY symbol's
  recorded closes, memoized per `generatedAt`) reports what the current label actually did over the next
  10/20 sessions and vs SPY, folding ±5/−10 into confidence only above 30 reads. Colour-coded signals
  carry redundant **▲/▼/■ glyphs + text labels** (a11y) and the setup gauge has an `aria-label`.
  Last-analyzed ticker and the compare ticker persist via `localStorage`; `azExtra`/`azCorr` are
  memoized per snapshot (`data.generatedAt`). **Chart Analyzer (v78–v79):** the inline Price-&-Levels card was
  **replaced (v79)** by a **📊 Open chart & pattern analyzer** launcher (the **📊 Chart** button beside the
  Analyze input also opens it) → a large, full-screen **`azCMOpen()`** modal: one big chart with **switchable
  timeframes** (1M/3M/6M/YTD daily; 1Y/5Y from `hist.month`), a **Line ⇄ Candles** toggle (candles are pure
  Chart.js **floating bars** — body=open(≈prior close)..close, wick=low..high, colored by up/down — **no new
  dep**), a **volume overlay + an RSI(14) sub-panel**, and a **pattern scanner**. **Indicator fix (v79):**
  SMA20/50 + RSI are computed over the **full** daily/monthly series in **`azCMWindow()`** then sliced to the
  visible window, so the MAs span the whole view instead of restarting blank at the left edge (the old
  per-slice recompute left SMA50 a stub on short timeframes). **Patterns:** Head & Shoulders (+ Inverse), Cup
  with Handle, Double Bottom, Bull Flag, **Ascending/Descending Triangle, Falling/Rising Wedge**, plus two
  overlay filters — **auto Trendlines** and **Support/Resistance zones**. Detection is a self-contained
  heuristic module (no deps beyond Chart.js): **`azCMPivots`** is an adaptive **ZigZag** swing-pivot detector
  (≈4× median-bar-move reversal threshold, clamped 2.5–8%); reversal/continuation matchers
  (`azCMHS`/`azCMCup`/`azCMDouble`/`azCMFlag`) plus geometry-fit ones (`azCMTriWedge`/`azCMTrend`/`azCMSR` via
  `_cmGeom`/`_cmFit` — triangle = one flat side + one sloped; wedge = both sides sloped same way + converging)
  each return a `{found,conf,points,lines,target,bias,…}` shape. **`azCMDrawChart`** overlays it (swing dots,
  neckline/rim/trend lines, measured target), **`azCMDrawRsi`** draws the RSI panel, and **`azCMVerdict`**
  renders a teaching panel that now also shows **volume/RSI/divergence confirmation** (`azCMConfirm`) and a
  **per-symbol historical hit-rate** (`azCMBacktest` slides the same detector across the name's full daily
  history → forward-return win-rate in the pattern's bias). A **📡 Pattern Radar** button on the Analyze page
  (`azPatternRadarOpen`→`azPatternScan`) scans holdings + picks for any pattern and lists hits (tap → opens
  that name's chart with the pattern drawn). All overlays are plain Chart.js datasets (markers/lines as
  `_pts`/named line datasets; candle bars use `grouped:false` so wick/body/volume overlay instead of dodging).
  **Multi-timeframe confluence (v80):** when a pattern is selected, `azCMRender` re-runs the detector across
  every available timeframe and **glows the timeframe chips** (`.cm-found` — green ● + ring) where it's also
  found (stashed in `_azCM._foundTFs`); the verdict adds a **confluence note** (which other frames agree, or a
  single-timeframe/lower-conviction caveat), and a collapsible **"How the timeframe changes your read"**
  explainer (short=tactical / medium=swing / long=structural; longer frame wins on disagreement) lives in the
  modal + the `interactive chart` help entry. **Chart Pattern Verdict (v83):** `azChartVerdict(sym)` (memoized
  per snapshot) aggregates EVERY directional pattern across EVERY timeframe into one bull/bear/mixed/none read
  — each hit weighted by `confidence × volume-RSI-confirmation × its own historical hit-rate × timeframe`
  (longer = heavier; backtest deduped per pattern+bias). It's **independent of `analyzeStock`** (which blends
  RSI/trend/momentum/fundamentals), so `azVerdictVsAnalyze` frames it as a second opinion — **agree** = higher
  conviction, **diverge** = a clean pattern fighting the blended read (size down/wait). `verdict.groups`
  collapses every recognized pattern → the timeframes it shows on, for a **compact, non-clickable** summary.
  Surfaced as a compact "Chart read" line near the **top** of the modal (a pill + short agree/diverge tag +
  the grouped recognized-pattern list — phone-friendly; the timeframe row + pattern scanner are grouped
  together below the chart so the glow stays visible while filtering). **On the Analyze page (v87)** it's a
  small, subtle **🔭 Chart read** pill placed **above the Recommendation** — `icon · label · conviction%` + a
  one-line agree/diverge tag (`azVerdictVsAnalyze().short`) + a 📊 Chart button; `data-help="chart pattern
  verdict"` keeps the popup. The old verbose **🔭 Chart Pattern Verdict** card AND the **📊 Interactive Chart**
  launcher card were **removed from the Analyze stack** — the full pattern/driver detail lives in the analyzer
  modal (`azCMOpen`, opened by the pill, the **📊 Chart** button beside the ticker box, or Pattern Radar), and
  the `interactive chart` help moved into the modal header (a **?** button → `openHelp('interactive chart')`).
  Research/education only — reads are
  tendencies, detection is heuristic and can miss/over-fit. Reads `azSeries`/`azSeriesMonthly`; nothing from
  the producer changed (pure consumer-side).
- **Markets:** index/risk/sector tiles (YTD/5Y) with a **risk-on/off appetite gauge** synthesized from
  the day moves of equities/credit vs gold/long-bonds; **sector heatmap with a Day ⇄ vs-S&P-YTD
  (relative-strength) toggle** that surfaces leaders/laggards; macro signals incl. a **2s10s yield-curve
  tile** (10yr−2yr, flags inversion; VIX from Robinhood); **US vs International** chart (SPY/EFA/EEM)
  with a YTD+5Y stat row; **breadth = real market movers** (leaders/laggards across the index/sector/risk
  ETFs, not just your book) + news sentiment; Retail Buzz. The "as of" label reads from
  `data.generatedAt` and flags staleness, like the freshness bar.
- **Options:** an **exposure roll-up** (net delta · put cash secured · shares capped · open premium at
  risk) across your open+pending contracts; **Your Options** cards with full live **greeks (Δ Θ Vega Γ)**,
  P&L, assignment odds, an **IV-rank badge** (cheap/rich), a payoff-at-expiry diagram, and concrete
  **roll suggestions** (named later expiry + roll-up strike) on short calls; an **Upcoming Expirations**
  calendar; **Trade Ideas** that are **filterable (by direction) + sortable** — single-leg long calls,
  covered calls and cash-secured puts (live-priced, delta-targeted) **plus defined-risk call debit
  spreads and collars** (estimate-only, multi-leg payoff drawn from `legs[]`); **Covered-Call** and
  **Cash-Secured-Put income rankers** (annualized yield); Options P&L (closed trades); and a Knowledge
  card. Estimate premiums use a per-symbol realized-vol IV proxy (`optvol.mjs`; horizon-matched 60-bar window, sourced from the raw bars AND the prior snapshot). Research/education only. **Robinhood
  **v119 corrected the money units and the collateral rules** (see Gotchas): position/order premiums
  are no longer 100×/÷contracts off, a short credit no longer inverts the breakeven, your own
  contracts' live greeks/P&L/IV actually populate (the `instrument_id` keying bug), covered-call and
  collar ideas are only offered on shares NOT already backing a short call, and `options-build` now
  warns when a held contract has no live quote instead of rendering a blank card. **Robinhood
  options-watchlist sync:** on each FETCH_ALL run the producer mirrors the single-leg Trade Ideas that
  resolved to a live contract (long calls / covered calls / CSPs) into the account's options watchlist
  (daily add/remove diff via `sync-option-watchlist.mjs`, all `position_type:"long"`); estimate-only
  and multi-leg structures are excluded since the list holds single-leg contracts only.
- **Producer hardening:** preflight gating, carry-forward, deterministic publish-to-main, freshness
  watchdog, clean-stop on push failure, and the two best-effort post-publish **watchlist syncs** (the
  equity "Dashboard Top 10 Picks" list + the options watchlist — the only Robinhood writes; both
  fault-isolated so they never gate a run).
- **🏛️ Flow & Positioning (v95; moved to the ACCOUNTS page in v100, split per account in v102):** a card (`renderFlowCard(opts)`) mounted ONCE PER ACCOUNT SIDE — `{scope:'main'}` at the foot of `#app`, `{scope:'agentic', sfx:'-ag'}` on the agentic page directly above the Rebalance Log. Each shows only that account's names (`inScope`: margin-held, vs agentic-held ∪ agentic-target), because a shared card sitting outside the toggle listed margin-only tickers under the Agentic side — noise about a book you aren't looking at. Rows stay tagged 📊 self-directed-held / 🤖 agentic-held / 🎯 agentic-target (own account's tag first) so a name in both books is still obvious; an empty scope says so rather than rendering a blank table + an Analyze **🏛️ Flow read chip**
  showing who is *acting* on your names — analyst revision direction, insider Form 4 clusters, earnings
  surprise, federal contract awards — plus a lobbying-intensity strip and a labelled congressional-cluster
  strip. Reads `data.flow`; a name with too little data **abstains** rather than showing a misleading
  middling score. **DISPLAY-ONLY through the burn-in**: the research workflow's 5th sleeve exists and is
  wired, but `FLOW_WEIGHT` in `.claude/workflows/agentic-research.js` is **0** — flipping it to `0.10` after
  the burn-in is the single line that switches the layer on (the other five sleeves scale proportionally, so
  their relative standing is unchanged either way). Congressional clusters carry **zero weight permanently**.
  `finalize-target.mjs` tags each target name with `drivers:[]` (the sleeves scoring ≥7, derived
  deterministically from sleeve scores rather than trusted from the model) so the Rebalance Log can
  eventually answer whether the sleeve earned its keep — which is what makes it removable.
- **Table readability (v97):** the three wide scrollers (All Positions `#pos-table`, Picks `#picks-table`, the Agentic holdings table `.sticky-first`) pin their **first (ticker) column sticky** while the rest scrolls sideways — opaque per-theme background (`--sticky-bg`, gold override) + a soft edge shadow, so rows stay identifiable mid-scroll. The Picks table is **ticker-first** (was Score·#·Ticker) and the Agentic table's **Target/Drift sits next to Position** (allocation read side-by-side, perf after). `fmtP`/`sc`/the agentic `pctCell` are **display-zero aware**: a value that rounds to 0.0% renders neutral gray, never a red "-0.0%" (the weekend quirk) — and v131's ▲/▼ glyph obeys the same rule, so a display-zero stays glyph-less rather than asserting a direction the data doesn't have. `thead th` contrast bumped (#9ca3af→#6b7280, light theme).
- **Privacy mode (👁️ / 🙈) — REWORKED APP-WIDE IN v136.** Hands the phone to someone without
  handing them the balances. It was a text walk over `#page-portfolio` alone that matched `$<digit>`
  and blurred it, and every other tab renders account figures too — audited against the sample
  snapshot the toggle read as ON while leaking **100+ values across four tabs**: the Plan tab's Action
  Center (loan, buying power, ticket dollars), the whole agentic plan (book, idle cash, parked
  dollars, turnover), the Options tab's own contracts (credit, P&L, cash secured), and the Analyze
  page's 📦 Your Position card.
  - **Three region kinds, nearest `data-priv` ancestor wins.** `on` = mask money + quantities +
    leverage multiples + account last-4 (your book). `market` = `$` here is a PRICE, not a balance —
    strikes, entry/stop levels, market caps stay readable, quantities/multiples/last-4 do not.
    `off` = mask nothing (Markets tab, the standing rulebook, help text). Page roots seed the
    default — Accounts/Plan/Options `on`, Analyze `market`, Markets `off` — so a card added later
    **inherits masking**, and a forgotten attribute over-masks rather than leaks. That asymmetry is
    the design: the original's failure mode was silent under-masking, and only an explicit opt-out
    can bring it back.
  - **A fourth kind, `data-priv="val"`, marks ONE element whose whole text is a BARE figure.** A
    Shares cell reads `350.00` — no `$`, no unit — so no pattern can recognise it, and 350 shares
    against a visible price is the position value in one multiplication. Used on every share/contract
    count and on Net delta (a share-equivalent exposure with the unit filed off). It still defers to
    an enclosing `off`.
  - **Values are REPLACED (`$•••`, `••• sh`, `•×`, `••••`), never blurred.** A blur keeps the original
    width, so a seven-figure balance stays visibly wider than a three-figure one; the real text also
    stays selectable and readable to a screen reader underneath. The original is parked in `data-v`
    and restored on toggle-off, so nothing re-renders. `title`/`aria-label` are masked the same way —
    a long-press or a screen reader would otherwise read out what the screen is hiding.
  - **Charts in an `on` region are blurred whole** (`.priv-blur` on the `.chart-wrap`) — a canvas
    can't be walked and the Account Performance chart plots equity in dollars. `market` charts (the
    picks composite, the Analyze price chart) are untouched.
  - **PERCENTAGES ARE NEVER MASKED.** A return, a weight, a drift is what makes the app worth showing
    and none of them reveal what the account is worth. Masking them would leave nothing to demo.
  - Masking runs **synchronously inside the MutationObserver callback** — the old one debounced 150ms,
    so every freshly-rendered card flashed its real numbers first. With privacy OFF no observer runs
    at all, so the layer costs nothing in the normal case. `producer/privacy-audit.mjs` is the
    regression net; run it for any change that adds a card carrying account figures.
- **Freshness bar (STICKY since v131):** shows the snapshot label/age and **tints amber with a "↻ to
  refresh" nudge when the snapshot is ≥3h old** (computed from `data.generatedAt` in `boot()`); also hosts
  the **🔍 Find** button (v131), the build version,
  privacy, theme, and refresh controls. **v88 made it live**: the tint/label repaint every 5 min and on
  every foregrounding (no more fresh-looking hours-old bar in a resident PWA); on resume after ≥5 min
  away it peeks at `data.json` (fingerprint = `ct` prefix, stashed as `window.__PF_SNAP_FP`) and
  **auto-reloads into a newer snapshot**; the SW registration now calls `reg.update()` on load/foreground
  and a newly-installed version shows a **"⬆️ tap to update" nudge** in the bar (`window.__pfNudge`) instead
  of silently waiting; `pfForceUpdate` re-downloads the shell BEFORE wiping caches (offline tap can no
  longer blank the app); decrypt failures distinguish **corrupt snapshot** (bad base64 envelope) from
  wrong passphrase, and 10 failed attempts dismiss the overlay into the bar's Locked state.
- **Card help popovers (v76):** every card header carries a small **"?" button**; tapping it opens a
  teaching modal that explains what the card shows, what each stat/number means, and what to look for
  (e.g. RSI bands, beta/Sharpe/drawdown, the composite weights, the greeks, expected-move ±1σ, the
  2s10s curve). Implemented as a **pure UI overlay** in a self-contained IIFE near the collapsible/nav
  enhancers in `index.html`: a `HELP` registry keyed by a normalized signature of the card title (chevron/
  hint/badge/buttons stripped) + a tiny `PREFIX` list for dynamic titles (e.g. "Earnings Preview · {tkr}"),
  a `decorate()` that injects the button into each `.card-title`, and a single shared `#help-modal`
  (`openHelp(key)`). A MutationObserver over all five page roots catches late-rendered/dynamic cards
  (Analyze especially). The 2 ambiguous/dynamic headers carry an explicit `data-help` (the Analyze compare
  result header → `cmp-head`); everything else resolves by signature. Reads nothing from `data.json`,
  never blocks a render. Theme-aware (`.help-box` gets `--hb-bg`/border overrides for dark + gold). To
  add/edit content, edit the `HELP` object; to cover a NEW card, add an entry keyed by its title signature
  (lowercase, non-letters → spaces) — no per-card markup needed since the decorator auto-injects.
