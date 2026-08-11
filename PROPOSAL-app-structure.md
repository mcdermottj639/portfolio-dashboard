# PROPOSAL — App navigation restructure + Agentic performance

**Status:** plan only — owner picks a path, then a build session (Opus) implements.
**Author:** planning session on branch `claude/app-nav-portfolio-structure-76rnlj`, 2026-08-11.
**Trigger:** the Agentic Portfolio card (Plan tab) has no account-level performance readout, and the
two real accounts (self-directed margin ••••0741 vs agentic ••••3900) don't map cleanly onto the
current 5 tabs — the agentic account is a full self-driving book (target, drift, pending tickets,
decision ledger, equity history) squeezed into one card inside "Plan".

---

## Current state (v98)

Tabs (`index.html:542-548`, pages `549-562`):

| Tab | Page id | What's on it |
|---|---|---|
| 📊 Portfolio | `page-portfolio` / `#app` | Margin book: positions, heatmap (with a Margin⇄Agentic toggle), risk metrics, allocation, **Income & Tax (all-account)**, Technical Signals, **Performance vs Benchmark (with the agentic overlay + "Agentic since" stat)** |
| 🌐 Markets | `page-markets` | Indexes/sectors/macro/breadth/buzz |
| 🎯 Plan | `page-picks` | **Agentic Portfolio card** (`#agentic-content`, index.html:4463) + **Rebalance Log** (`#agentic-log-content`, 4466) + **Flow & Positioning** (`#flow-content`, 4469) + **Action Center** (`#plan-content`, 4476 — margin-book do-now + the-plan) + Top-3 pick cards + composite chart + picks table + Track Record + earnings preview |
| 💹 Options | `page-options` | Options book + ideas |
| 🔍 Analyze | `page-analyze` | Per-ticker deep dive |

Problems this structure creates:
1. **The agentic account has no home.** Its performance lives on Portfolio (as an overlay line +
   one stat inside `renderPerformance`, index.html:1317/1392), its holdings/target/ledger live on
   Plan, its heatmap lives behind a toggle on Portfolio. Nothing shows "how is this account doing"
   in one place — the thing that prompted this proposal.
2. **Plan mixes two books.** The Action Center is margin-book advice; the Agentic card is a
   different account with different rules (wash-sale ledger, PDT guard, auto-tier executor).
3. Each tab should answer one question: *what do I own / what's the world doing / what should I do
   / what are my options doing / tell me about X*. Today "what do I own" is split across two tabs
   and a toggle.

---

## Path A (RECOMMENDED) — Agentic gets its own tab (6 tabs)

```
📊 Portfolio · 🤖 Agentic · 🎯 Plan · 🌐 Markets · 💹 Options · 🔍 Analyze
```

- **📊 Portfolio** = the self-directed margin book, plus the all-account **Income & Tax** card
  (it's the "my money" page; the By-Account split already lives there). The Performance chart
  keeps its agentic overlay (nice cross-account comparison) — cheap to keep, no reason to remove.
  The heatmap's Margin⇄Agentic toggle can stay too (it's one line) or the Agentic side can move
  to the new tab — builder's choice, keep is cheaper.
- **🤖 Agentic (NEW)** = everything ••••3900, led by a **new performance hero** (see "Performance
  block" below, built in Phase 1 regardless of path):
  1. Performance hero: Equity · Day $/% · **TWR since inception** (deposit-adjusted) · vs SPY same
     window · net deposits (`cumFlow`) · true P&L $ (equity − net deposits).
  2. Equity-history chart (real `data.agentic.equityHistory` line, deposit-flagged markers where
     `cumFlow` steps, SPY rebased over the same window). This is the chart the account never had.
  3. The existing Agentic Portfolio card (holdings tracker + targets-to-open + drift + wash-sale/
     earnings/gap deferrals + 🤖 hand-off) — moved, not rewritten.
  4. Rebalance-in-flight strip (`data.agentic.pending`) — already part of the card.
  5. 🧾 Rebalance Log (moved).
  6. Agentic heatmap variant (optional, reuse the toggle's render path).
- **🎯 Plan** = pure "what should I do next" for the *margin* book + research surface: Action
  Center, Top-3 cards, composite chart, picks table, Track Record, **Flow & Positioning stays here**
  (it's research context over picks + holdings; the agentic target already carries `drivers[]`).
- Markets / Options / Analyze unchanged.

**Why recommended:** matches the real-world structure (two accounts, different rules, different
automation), gives the agentic experiment a legible scoreboard — which is the point of the decision
ledger — and *removes* content from Plan, which is currently the most overloaded page.

**Tab-crowding check:** the tabbar already `flex-wrap`s and drops `.tab-sub` + shrinks to 12px under
760px (index.html:293). Six tabs at ~390px phone width ≈ 60px each — tight but workable; if it wraps,
that's the accepted fallback. Optional mitigation: shorten labels on mobile via the existing media
query (e.g. hide emoji-only vs text). Do NOT drop a tab to make room.

## Path B (alternative, 5 tabs) — one "Accounts" tab with a segmented toggle

```
📊 Accounts (Self-directed ⇄ Agentic) · 🌐 Markets · 🎯 Plan · 💹 Options · 🔍 Analyze
```

- Portfolio page grows a segmented control at the top (same pattern as the heatmap's
  Margin⇄Agentic toggle, persisted as `pf_acct` in localStorage). "Self-directed" = today's
  Portfolio page; "Agentic" = the same new Agentic page content as Path A (performance hero,
  equity chart, tracker card, log). Plan sheds the agentic cards either way.
- Pros: keeps 5 tabs; one "what do I own" surface. Cons: the agentic account is a tap deeper and
  invisible to someone who forgets the toggle; the page becomes two render paths in one container,
  which fights the fault-isolated enrichment pipeline (`load()`'s guards assume one page shape).

**Not proposed:** collapsing Options/Analyze or Markets into fewer tabs — they each answer a
distinct question, are individually large, and nothing about the two-account problem is improved
by touching them.

---

## The Performance block (Phase 1 — common to BOTH paths, shippable alone)

This is the piece that triggered the request, and it needs no producer change — all data exists:

- `data.agentic.equityHistory` = `[{t, equity, cumFlow}]`, recorded forward daily (v72/v92).
- The deposit-adjusted TWR math **already exists** inside `renderPerformance`
  (index.html:1352-1392): chains per-step returns, subtracts `cumFlow` deltas, zeroes implausible
  >20% legacy jumps, rebases SPY over the same window.

**Build:** extract that math into a pure helper `agenticPerfStats(AG, spySeries)` returning
`{ret, spy, days, netFlow, pnl$, firstDate}` — `renderPerformance` calls it (identical output to
today, no visual change on Portfolio) and the Agentic card/tab hero calls the same helper. One
source of truth; the two surfaces can never disagree. Add the hero stat row + (Path A/B) the
equity-history chart (Chart.js line, same `applyChartTheme` plumbing as every other chart).

---

## Implementation structure for the build session

**Phase 1 — Agentic performance (small, ship first, zero-risk):**
1. Extract `agenticPerfStats()` from `renderPerformance` (index.html:1352-1392); re-wire
   `renderPerformance` through it; verify the Portfolio "Agentic since" stat is byte-identical.
2. Render a perf hero row at the top of `renderAgenticCard()` (index.html:1886): Equity · Day ·
   TWR since {date} · SPY same window · net deposits · P&L $. Reuse `fmtP`/`sc` (display-zero aware).
3. Bump `APP_VERSION` + `CACHE_VERSION` together; update CLAUDE.md feature inventory.

**Phase 2 — the new tab (Path A) or toggle (Path B):**
1. Tab plumbing: add `tab-agentic` button + `page-agentic` container (mirror index.html:542-562);
   extend `switchTab` (2531) and the `dash_tab` restore whitelist (5017 — currently only
   `'picks'||'markets'`).
2. Move the card mounts: `#agentic-content` + `#agentic-log-content` skeletons move from the Plan
   page template (`renderPicksStatic`, 4448/4463-4466) into the new page's static skeleton.
   `paintActionCenter()` (1468) already guards on `document.getElementById(...)` existence, so it
   keeps working — but audit every call site (1472-1473, 2430, 2453, 2468, 4496, 4834) and the
   lazy-init pattern: the new page must render its skeleton on first `switchTab` (like `initPicks`)
   or statically in the HTML (simpler — recommended, the containers are just divs + spinners).
3. New: equity-history chart renderer on the Agentic page (Phase 1's helper + one Chart.js line).
4. Deep-links audit: `jumpToPick`, the Portfolio→Plan pointer cards (e.g. 2423), hand-off
   `chatBtn` prompts, and any `switchTab('picks')` that semantically meant "go see the agentic
   card" → retarget to `'agentic'`.
5. Help popovers: the registry keys off card **titles**, so moved cards keep their help for free;
   add one new entry for the perf hero/equity chart card.
6. Bump `APP_VERSION`/`CACHE_VERSION`; update CLAUDE.md (tab list, feature inventory, this file's
   status line).

**Explicitly out of scope:** producer changes (none needed), Options/Analyze/Markets, the executor,
and any change to `data.json` shape — this is 100% consumer-side, replay contract untouched.

**Verify checklist (no network):** `node producer/make-sample-data.mjs` + `node producer/serve.mjs`
→ eyeball all tabs incl. the new one in Light + Gold; inline-JS parse check (`new Function` per
script block); confirm Portfolio's "Agentic since" stat unchanged pre/post Phase 1; confirm
`paintActionCenter` no-ops cleanly when the Agentic page hasn't been visited; sample data lacks
`agentic` → new tab must degrade to an honest "no snapshot yet" note, not a spinner.

**Estimated size:** Phase 1 ≈ 1 focused session; Phase 2 (Path A) ≈ 1-2 sessions. Path B ≈ Phase 2
plus toggle-state plumbing, similar total.

---

## Decision needed from the owner

1. **Path A (6 tabs, Agentic first-class — recommended)** or **Path B (5 tabs, Accounts toggle)?**
2. Ship Phase 1 alone first, or land Phase 1+2 together? (Recommendation: together in one PR is
   fine; Phase 1 is defined separately only so it can't be lost if scope gets cut.)
