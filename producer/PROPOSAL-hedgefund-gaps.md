# PROPOSAL — Institutional-practice gap closures for the agentic account (••••3900)

**Status: BUILD SPEC — approved for implementation, not yet built.** Written 2026-08-24 from the
hedge-fund-vs-agentic gap analysis (session branch `claude/hedge-fund-vs-agentic-x1rl3n`). The
implementing session should read this whole file first, then CLAUDE.md's Gotchas, then the files
named in each phase. Owner decision points are marked **⚖️ OWNER** — implement the recommended
default unless the owner has said otherwise in the launching prompt.

## Why (one paragraph)

Compared against current institutional practice (Q2-2026 13F season + multi-strat platform norms),
the agentic system already has fund-grade verification, caps, turnover discipline and tax handling.
Its real gaps: (1) the cluster caps are blind to what's *inside* SPY/VTI, so true megacap-tech
exposure exceeds the 48% the cap claims; (2) there is no book-level drawdown rule — every risk
control is name-scoped; (3) deployment pacing ignores market regime (the idle-cash deadline fires
identically at VIX 12 and VIX 35); (4) the waiting ground parks "too risky to buy now" dollars in
an instrument that is 100% equity beta; (5) the flow layer collects positioning data but weights it
zero; (6) sleeve attribution exists as tags but is never aggregated, so the system can't learn
which research sleeve earns its keep.

## Ground rules for the implementing session (non-negotiable)

- **Every engine change is a pure, unit-tested module** — the repo pattern: pure function in
  `producer/*.mjs`, offline tests in the sibling `*.test.mjs`, callers pass inputs in. No network,
  no I/O inside the pure layer. Run `for t in producer/*.test.mjs; do node "$t"; done` before push.
- **No new committed state files.** The executor may commit exactly three files
  (`agentic-pending.json`, `agentic-decisions.json`, `agentic-parked.json`) and never `data.json`.
  Anything stateful here must be **derivable from the committed snapshot** (the drawdown design
  below is deliberately memoryless for this reason).
- **All planner inputs come from the committed (decrypted) snapshot** — `raw/` is wiped every run
  (see Gotchas: the fetchgate lesson). Never gate on a raw/ marker.
- **Mirror consumer-side.** Any new deferral reason or badge the planner emits must be mirrored in
  `index.html`'s shared agentic helpers (`agenticExecMap` etc.) — a badge that disagrees with the
  executor is worse than no badge. Consumer change ⇒ bump `APP_VERSION` + `CACHE_VERSION` together.
- **Update CLAUDE.md + AGENTIC.md in the same change** (standing rule), and this file's status
  line per phase as phases land.
- **Land on `main`** when verified (ALWAYS MERGE rule) — unmerged producer code never runs.
- Phases are independent unless noted. Suggested order: **1 → 2 → 4 → 6**, with **3** and **5** as
  owner-gated switches. Each phase should be its own commit (or few) so a phase can be reverted alone.

---

## Phase 1 — Look-through concentration (`riskweights.mjs`)

**Problem.** `CLUSTERS.megacap-tech ≤ 48%` counts only direct holdings. The 2026-08-18 target holds
NVDA/GOOGL/MSFT/AMZN at 44.8% *plus* ~20% SPY + 5% VTI; SPY is itself roughly a third megacap tech,
so true exposure is materially above the cap. Funds measure exposure through their index holdings.

**Design.**
- Add to `producer/riskweights.mjs`:
  ```js
  // Static look-through composition of index vehicles, per capped cluster only.
  // Reviewed ~quarterly like market.mjs's HOLIDAYS set — an unlisted vehicle contributes 0
  // (fails safe: old direct-only behavior). Fractions of the vehicle's assets.
  export const LOOKTHROUGH = {
    SPY: { 'megacap-tech': 0.33, payments: 0.03 },
    VTI: { 'megacap-tech': 0.27, payments: 0.03 },
    QQQ: { 'megacap-tech': 0.52 },
  };
  export function clusterExposure(names) { /* → { [cluster]: { direct, lookThrough, total } } */ }
  ```
  Numbers above are placeholders at spec time — the implementer should sanity-check current index
  weights (top-10 SPY weights are public) and round conservatively; precision to the percent is fine,
  this is a cap, not accounting.
- `riskAdjustWeights` enforces each cluster cap against `total` (direct + look-through). **When a
  cluster breaches on look-through, water-fill down the DIRECT members only — never trim the index
  vehicles.** SPY/VTI are ballast by design and stay uncapped as *positions*; the point is that a
  fat index core shrinks how much direct megacap you can stack on top of it, not that the core gets
  sold. Document this asymmetry in the function's comment — it will look like a bug otherwise.
- `agentic-deploy.mjs` reuses `clusterExposure` (it already imports `clusterOf`/`volScaledCap`) so
  buys respect the same math; no separate implementation.
- Consumer (optional but recommended, small): the Plan tab's 📏 Guardrails card and the agentic 🛡️
  Risk card show the look-through cluster total next to the direct figure ("megacap-tech 44.8%
  direct · ~52% look-through, cap 48%"). Mirror `LOOKTHROUGH` as a small const in `index.html`'s
  agentic block (same keep-in-step note as `sdLockedShares`).

**Tests** (`riskweights.test.mjs`): direct-only book unchanged vs old behavior; direct 44% + 20% SPY
⇒ breach detected and direct names trimmed while SPY untouched; unlisted vehicle contributes 0;
renormalization still sums to 100%.

**Effort:** small. Pure + tests ~half the work; consumer strip the rest.

---

## Phase 2 — Book-level drawdown circuit breaker (`agentic-deploy.mjs` + new `drawdown.mjs`)

**Problem.** Per-name stops exist; nothing says "the *book* is down X% from its high — stop
deploying." Multi-strat platforms cut capital on pod drawdown; agentic has no equivalent.

**Design.**
- New pure module `producer/drawdown.mjs`:
  ```js
  // Deposit-adjusted drawdown from the recorded equity history.
  // MUST run on the time-weighted return index (chain per-step returns with cumFlow deltas
  // neutralized — same math as the consumer's acctPerfStats / equityseries.mjs conventions),
  // NEVER on raw equity: a deposit would mask a drawdown and a withdrawal would fake one.
  export function bookDrawdown(equityHistory) { /* → {dd, peakT, level: 'ok'|'soft'|'hard'} */ }
  export const AG_DRAWDOWN_SOFT = -0.08;   // ⚖️ OWNER — defaults proposed
  export const AG_DRAWDOWN_HARD = -0.12;
  export const AG_DRAWDOWN_RESUME = -0.06; // hysteresis: soft lifts only above this
  ```
  **Memoryless by construction**: `level` is a pure function of the series (drawdown now vs the
  running peak of the TWR index, with the resume threshold providing hysteresis) — no committed
  state file, so the executor-three-files rule holds. Series source: `data.agentic.equityHistory`
  from the decrypted snapshot (the exec gate already decrypts it).
- Planner integration (`planDeployment` gains an optional `drawdown` input; the exec gate computes
  and passes it):
  - **soft:** all NEW buys defer with a new deferral reason `'drawdown'`; **parking is suspended**
    (deferred dollars stay cash — routing "market is falling" money into an equity placeholder
    defeats the purpose). Sells/TLH/exits unaffected. The idle-cash deadline pauses (its clock
    keeps running but cannot force cash in while soft is active — document this interaction).
  - **hard:** soft, plus raise defensive cash — losses-first trims (TLH synergy, wash-ledger
    respected) until cash ≥ `AG_DD_CASH_FLOOR` (proposed 20% ⚖️ OWNER). Existing overrides
    already cover the churn conflict: min-hold yields to the ≤−10% deep-loss exemption and to
    harvests; a name inside min-hold at a small loss is NOT trimmed (churn control holds — the
    hard tier trims what it may, not everything). PDT guard applies as everywhere.
- Consumer mirror: `'drawdown'` badge in the Plan tab's ⏸ blocked card + a line in Guardrails; a
  small "book drawdown −x.x% · deployment paused" note on the Agentic side when active.
- AGENTIC.md: new subsection under execution policy.

**Tests** (`drawdown.test.mjs` + additions to `agentic-deploy.test.mjs`): TWR index ignores a
deposit mid-drawdown (raw equity recovers, TWR doesn't — level stays soft); hysteresis (−8.5% soft,
recovers to −7% still soft, −5.5% ok); hard tier trims losses-first, respects min-hold except
deep-loss, stops at the cash floor; parking suspended under soft; <2 recorded points ⇒ `'ok'`
(fail-open like fetchgate — a young series must not freeze the account).

**Effort:** medium. The planner interaction cases are most of it.

---

## Phase 3 — ⚖️ OWNER: park vehicle → SGOV (yield on waiting capital)

**Problem.** Deferred dollars ("too extended / wash-blocked / earnings — wait") sit in VTI: 100%
equity beta on money that is waiting precisely because equities looked risky. Funds hold waiting
capital at the risk-free rate. **This reverses a deliberate 2026-08-11 owner choice** (VTI for
visibility + wash-sale separation) — hence owner-gated. Recommended: **switch to SGOV**; it keeps
both properties (separate visible line, zero wash overlap with anything) and adds ~4–5% yield with
near-zero vol (which also makes park/release round trips PDT- and tax-trivial).

**If approved:**
- `agentic-deploy.mjs`: `PARK_VEHICLE = 'SGOV'`. Keep the off-target-exit exemption keyed to the
  *current* vehicle constant, and **grandfather `VTI`** in the exemption list until the ledger and
  book show no VTI attributable to parking (as of 2026-08-18 the held VTI was reclassified as a
  target name, so likely nothing to unwind — verify against `agentic-parked.json` history, currently
  `dollars: 0`).
- Note in the code why SGOV and not BIL (same idea; SGOV = 0–3mo, cheaper) and why the drawdown
  interaction from Phase 2 becomes moot for parking (SGOV is fine to hold in a drawdown — if Phase
  2 lands after Phase 3, parking need not be suspended under soft; reconcile whichever lands second).
- Ledger/consumer: `agentic-parked.json` `vehicle` field, the Plan tab 🅿️ waiting-ground card copy,
  AGENTIC.md §parking, CLAUDE.md's parked-ledger row. Quotes: SGOV must be in the producer's
  every-run quote cover (it is once held; add it to the quote list the way VTI is handled).

**If declined:** keep VTI, but implement Phase 2's parking-suspension under drawdown as specced.

**Effort:** small. Mostly copy/docs; the code change is one constant + exemption list.

---

## Phase 4 — Regime gate on deployment pacing (`agentic-deploy.mjs`)

**Problem.** `CASH_IDLE_DEPLOY_DAYS` (10) force-deploys idle cash in 34% tranches regardless of
tape. Funds pace deployment by regime.

**Design — pacing only, never selection.** A regime signal must not pick names (that's the research
workflow's job); it only stretches or shrinks the pacing dials.
- `build-data.mjs` surfaces the VIX it already records: emit **`data.vix = {v, asOf}`** (parse the
  recorded `INDEX_DATA` VIX response the same way the consumer's `azVix` does; carry forward like
  other blocks). Additive snapshot field — `validate.mjs` untouched, replay contract unaffected
  (nothing keys on it).
- New pure helper in `agentic-deploy.mjs` (or `drawdown.mjs` if Phase 2 landed):
  ```js
  export function marketRegime({vix}) { // → 'calm' | 'elevated' | 'stressed'
    // thresholds match the consumer's azVix bands: ≥30 stressed, ≥22 elevated
  }
  ```
- Effects (all in `planDeployment`, which gains an optional `regime` input from the exec gate):
  - `stressed`: idle-cash deadline ×2 (20d), tranche halves (17%); new-money buys into names whose
    entry band has gone *advisory* (stale zones) defer instead — advisory-band buying is exactly
    the corner where a stressed tape burns you.
  - `elevated`: deadline ×1.5, tranche unchanged.
  - `calm` / **missing `data.vix`**: current behavior exactly (fail-open, the fetchgate lesson).
  - Never delays sells, TLH, or wash/PDT logic.
- Consumer: one line in Guardrails ("pacing: regime-aware — VIX ≥22/≥30 stretches the idle-cash
  deadline"); the ⏸ card shows regime next to a stretched deadline.

**Tests:** threshold boundaries; missing vix ⇒ calm; stressed stretches deadline/tranche and defers
advisory-band buys; sells unaffected.

**Effort:** small–medium.

---

## Phase 5 — ⚖️ OWNER: flip `FLOW_WEIGHT` 0 → 0.10

One line in `.claude/workflows/agentic-research.js` (documented there and in CLAUDE.md as *the*
switch). Precondition the owner asked for: a burn-in review — before flipping, eyeball 2–3 weeks of
`data.flow` for the known failure modes recorded in `PROPOSAL-flow-signals.md` (the all-sell
megacap insider drag, sparse-name abstention working). If flipped, update CLAUDE.md's flow rows
("DISPLAY-ONLY" clauses) and the Flow card's burn-in copy in `index.html` (version bump). The other
five sleeves scale proportionally — no other code changes. Congressional clusters stay at zero
weight permanently regardless.

---

## Phase 6 — Sleeve attribution (`agentic-ledger.mjs` + Rebalance Log)

**Problem.** Target names carry `drivers[]` (which sleeves scored ≥7) and decisions are graded vs
SPY, but nothing aggregates "how do momentum-driven positions do vs quality-driven ones" — the
feedback loop that would let sleeve weights be tuned on evidence (and is the stated justification
for `drivers` existing: "what makes the flow sleeve removable").

**Design.**
- **Record drivers at decision time.** `makeDecision` (in `agentic-ledger.mjs`) copies each BUY
  leg's `drivers` from the *then-current* target into the trade leg
  (`{sym, side, dollars, priceAt, drivers:[...]}`, buys only). Mapping legs retroactively to a later
  target would attribute trades to a thesis that didn't pick them — don't. Old ledger entries
  simply lack the field and are excluded from attribution (say so on the card, don't fake it).
  The executor's decision-append path (AGENTIC.md §executor) and any manual append instructions
  must pass drivers through — grep for `makeDecision` call sites.
- `gradeDecisions` (already takes quotes + SPY) additionally returns
  `sleeveStats: { [driver]: {n, dollars, contribPct, alphaPct} }` — dollar-weighted contribution
  and alpha vs SPY per driver tag, over graded buy legs carrying `drivers`. A leg with k drivers
  splits its dollars 1/k across them (crude but honest; note it in a comment).
- `build-data.mjs` attaches it under `data.agentic.decisions` (it already attaches the graded
  ledger — extend that object, carry-forward as-is).
- Consumer: a compact strip in the 🧾 Rebalance Log card ("By sleeve: momentum +2.1pp α ($3.2k, 5
  buys) · quality −0.4pp α …"), with an "n too small" note under ~4 graded buys per sleeve —
  attribution over two trades is noise and the card should say so rather than imply signal.

**Tests** (`agentic-ledger.test.mjs`): drivers copied at decision time; 1/k split; legs without
drivers excluded; alpha math consistent with the existing per-decision grading on a shared fixture.

**Effort:** medium. The ledger plumbing (executor append path) needs care.

---

## Explicitly out of scope (and why — don't scope-creep into these)

- **Shorting / options hedging on ••••3900** — no options level on the account; a $10k unlevered
  mandate expresses "risk down" via Phase 2's cash raise, not via hedges.
- **Leverage** — contrary to the account's mandate (unlevered 1× is load-bearing all over the repo).
- **Crowding metrics / paid alt-data / execution algos** — not reachable with current connectors;
  the research prompt already frames "don't chase" per name. A one-line addition to the adversarial
  verify prompt ("is this name a consensus/crowded position, and does the thesis survive that?") is
  fine if touching the workflow anyway — anything more is a new proposal.
- **Making ••••0741 defensive** — every phase above is agentic-side. The self-directed mandate is
  aggressive by design (two-mandates rule); nothing here leaks across.

## Acceptance checklist (per phase, before merge to main)

1. All `producer/*.test.mjs` pass, including the new ones.
2. `PF_PASSPHRASE=… node producer/run.mjs --no-push "test"` → "replay contract is valid ✅", then
   `git checkout origin/main -- data.json`.
3. If `index.html`/`sw.js` touched: both versions bumped; inline-JS parse check; sample-data preview
   renders the new badges (`make-sample-data.mjs` gains fixtures for: a look-through breach, a
   drawdown-soft state, a stressed regime, sleeve stats — a surface that can't be previewed rots,
   see the v116 lesson).
4. CLAUDE.md (+ AGENTIC.md / PRODUCER.md where relevant) updated in the same change; this file's
   phase status updated.
5. Branch merged to `main` (ALWAYS MERGE rule).
