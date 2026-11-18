# Portfolio Dashboard — agent instructions (default context)

This file holds only what every task needs: the ACTIVE rules, the release gates, the efficient way to work,
and where the deep reference lives. History and long reference were moved, verbatim, into `docs/claude/`
on 2026-11-18 (docs/process-only PR; nothing was rewritten or deleted). Load those files only when the task
needs them (§9). Size budget: this file stays under 40,000 characters (`tests/claude-docs.test.cjs`).

Labels: **ACTIVE RULE** (current owner rule or verified operating rule) · **CURRENT STATE** (dated, recheck
before relying on it) · **HISTORICAL** (kept for context) · **UNVERIFIED** (needs a fresh check). One
authoritative rule per subject; if two lines disagree, the newer owner decision wins and the older one is
labelled HISTORICAL — never invent a replacement fact.

`AGENTS.md` is the short entry point for any agent; `docs/RELEASE-WORKFLOW.md` is the release contract.
Both are ACTIVE and agree with this file.

## 1. What this is
- A personal portfolio dashboard PWA, static on GitHub Pages
  (`https://mcdermottj639.github.io/portfolio-dashboard/`). The repo is **public**; account data lives only in
  the encrypted `data.json` (AES-GCM, `producer/emit.mjs`), unlocked by a passphrase on the phone.
- **Consumer** = `index.html` (large single file) + `ui/*.js|css`, service worker `sw.js`. No backend.
- **Producer** = scheduled Claude agents (the only things that can reach the Robinhood / Alpha Vantage
  connectors) → `node producer/preflight.mjs` → fetch into `producer/raw/` (gitignored, empty on every
  fresh clone) → `node producer/run.mjs "<label>"` → encrypted `data.json` pushed to `main`.
  Steps and modes: `producer/PRODUCER.md`, `producer/SCHEDULING.md`, `docs/claude/architecture.md`.
- **Agentic executor** (••••3900) is a separate scheduled job: `producer/agentic-exec-gate.mjs` → ticket
  state machine. It may commit only `producer/agentic-pending.json`, `agentic-decisions.json`,
  `agentic-parked.json` — never `data.json`. Runbook: `producer/AGENTIC.md`.
- Scheduled-task prompts live server-side, not in this repo. **Shipping code does not update a prompt.**
  If a change alters what a task must fetch, run or read, check it with `list_triggers` and update it in the
  same change (or report exactly which prompt still contradicts the code). Three live tasks cite headings
  and step numbers in `producer/AGENTIC.md` ("The executor — the self-driving loop" steps 2–5 / 3f, the
  PRE-AUTH block, "§ THE MANDATE") and `producer/PRODUCER.md` (steps 1–3c, step 7): never rename or
  renumber those without updating the prompts. Other tasks read this file by topic (rules, release
  markers, test commands, open items, `data/apex-targets.json`) — keep those topics here.

## 2. Accounts and authorization — ACTIVE RULE (no UI/process change may alter these)
- Only ••••3900 ("Agentic") is agent-accessible for orders, and only within its mandate and the owner's
  explicit authorization. Verify its capabilities and permissions live each time; **never infer
  authorization from technical availability** (a tool that works is not a permission).
- ••••0741 ("Apex", self-directed margin book) is **read-only to every agent**; Jack places its orders
  himself. Agents never call `review_equity_order` / `place_equity_order` on it. The app's Apex buttons
  are **"Confirm with Claude"** checks of the whole proposed book (YES/WAIT/NO + prices), not order writers.
- The IRAs are agent-inaccessible and **must never influence** trading research, funding gates,
  recommendations or alerts (owner, 2026-11-17). `$0` buying power never suppresses research candidates.
- Options / multi-leg on ••••3900: **UNVERIFIED** authorization — treat as not authorized until Jack says so.
- No live trade, purchase, production credential or decrypted-account test in development. Synthetic
  fixtures only. Never put private data, passphrases or full account numbers in commits, logs, artifacts,
  URLs or handoff docs (masked ••••NNNN only).

## 3. Strategy rules the code must preserve — ACTIVE RULE
**Two accounts, two mandates. A change that makes one book follow the other's rules is a bug.**

Apex ••••0741 (aggressive, levered, concentrated; dials in `ui/apex.js` `C`):
- Leverage band from `Apex.C` (v218: reload 1.75× / cruise 1.90× / cap 2.00×). Read the constants; never
  copy numbers into new code. Per-name cap 20% of equity; R/R ≥ 1.5 measured at the executable limit;
  earnings guard 3 trading days; −25% stop; +25% / +50% trims; tech theme cap 40% of stock outside the
  core (v224, themes-v1.1, unknown names fail closed as tech); separate 45% AI-compute cap.
- Picks come **from research** (Monday scan → `data/apex-targets.json`), never a hand-typed list.
- **IREN is owner-managed** (v201): no screen, rule, prompt or ticket ever tells Jack to sell or trim it.
- Jack's own stop / take-profit order prices are **never inputs** to recommendations, scoring or R/R
  (v211). Research levels only; the app alerts when price reaches the research stop or target.
- **Buy and sell rules are separate** (v216): leaving the buy list is a review, never a sell; missing
  research never liquidates a holding. Protective exits stay.
- Every trade line shows the price to act at; a stale snapshot price is shown as "≈", never as an order
  price (v213–v214, `C.PRICE_FRESH_MIN`).
- Weekly Apex research and "everything for Apex" run **Monday**.
- CURRENT STATE (2026-11-18): `data/apex-targets.json` `rulesVersion` reads `v2.8`; the owner calls the live
  framework **v2.8.1** (2026-11-17: an IRA holding never rejects a name). **v2.9 is PAPER ONLY**
  (`producer/apex-paper.mjs`, `data/apex-paper-v29.json`) until Jack expressly promotes it; nothing live
  (ui/apex.js, ui/sd-rules.js, tickets, Confirm) may read the paper file.

Agentic ••••3900 (guarded; dials in `producer/AGENTIC.md` + `AG_*` constants):
- **Mandate A — beat SPY** over rolling 12 months; unlevered, 10–12 names, research-driven, churn-governed;
  relative drawdown breaker; cluster caps are the primary downside control; never market timing.
  Full text: `producer/AGENTIC.md` § THE MANDATE.
- Research target refresh is **fortnightly** (`agentic-due.mjs`); the momentum-off shadow and any paper
  experiment never allocate money. NVDA has no wash-sale hold on ••••3900 (v208, `WASH_WAIVED`).

`data/apex-targets.json` (public, no balances): written from the "Apex morning scan · 0741" research
(Task storage `os/apex-targets`) and copied into the repo by a data-only PR (scheduled task "Apex targets
copy · Mondays"). The app reads `targets`, `top5`, `heldLevels`, `themeMap`, `blockedBy*` and levels from it;
with no file the book is the core alone and the build rule writes nothing. Contract:
`producer/APEX-DECISIONS.md`; app adapter: `renderApexCard` in `index.html`.

## 4. Data integrity and privacy — ACTIVE RULE
- **Unknown, stale, incomplete and zero are different.** Missing data renders "—" or a named state, never 0.
- A committed or growing snapshot does not prove source freshness, broker execution or runtime use.
- Never infer a realized loss from a position diff; never let one account's cash net against the other's loan.
- `data.json` is always encrypted on real runs; `run.mjs` refuses plaintext. Never commit a plaintext
  `data.json` (`make-sample-data.mjs` writes one for preview — restore with `git checkout origin/main -- data.json`).
- Any card that renders account figures must pass `node producer/privacy-audit.mjs` (privacy mode).
- Replay-key contract: recorded MCP args must serialize identically on both sides (`producer/key.mjs`,
  checked by `validate.mjs`); don't reorder arg keys.
- Data PRs: only the intended file changes; `scripts/validate-data.py` + the domain test must pass.

## 5. UI and iPhone Duo — ACTIVE RULE (release requirement)
- Duo optimization is a release requirement. Layout modes Standard / Folded / Book are owned by
  `ui/duo.js` (`html[data-duo-*]`); Book-only rules are keyed to
  `html[data-duo-split="on"][data-duo-layout="book"]`.
- Check every UI change at phone and Duo widths: 320, 390×844, 466×677 (folded), 678×453 (folded sideways),
  951×669 / 960×676 (open, Book). `document.scrollWidth == innerWidth`, no sideways drift, no blank
  background ("abyss") on overscroll, no clipped figures, 44px touch targets, privacy masking, Back/refresh.
- Browser viewports are not the phone: say "Not verified: a physical iPhone Duo" unless Jack confirms.
- The dashboard must not become a second Robinhood: keep function, simplify, visuals first, short lines,
  method/caveats in closed `<details>`. Timestamps show full date + time with AM/PM ET.
- Apex and Agentic stay separate in every view; no account number repeated across sections.
- Do not invent features or scope; layout/wording passes change no rule, number, prompt or schedule.

## 6. Release gates — what "done" means (ACTIVE RULE)
1. Start from current `main` (`git clone --depth 1`), read the Claudex handoff's Current state, check open
   PRs for the same files, claim the task in Work in progress.
2. One branch + one PR per bounded scope. No force push, no direct overwrite of `main`.
3. **Release markers:** any change to `index.html` or `sw.js` bumps **both** `APP_VERSION` (index.html
   `boot()`) and `CACHE_VERSION` (`sw.js`, `pf-vNNN`) together, plus the version assertion in
   `tests/journey.test.cjs`. New UI files go in the `sw.js` precache. Docs-only and data-only PRs bump nothing.
4. Local checks for what you touched (§8 map), then the full set on the final head:
   ```sh
   for t in producer/*.test.mjs; do node "$t" || exit 1; done
   node --test tests/*.test.cjs
   python3 -m unittest discover -s tests -p 'test_validate_data.py' -v
   python3 scripts/validate-data.py
   ```
   Browser suites (synthetic data; start `node tests/preview.mjs` first, port 8767; Playwright 1.57.0):
   `brief-browser`, `sd-plan-browser`, `apex-browser`, `journey-browser` (also runs workspace, nav-b, book,
   duo, apex-paper, ticket-status, research-folds, analyze-account checks), `holdings-duo-browser`,
   `today-viewport-browser`; WebKit: today checks in the `webkit-layout` job. Inline-script parse check for
   `index.html`. Privacy audit when account figures render.
5. Required CI on the PR head: **`test`** (Producer tests) and **`data-integrity`**. Never merge on a failed,
   missing or cancelled check; never merge to dodge a failure.
6. **Claude merges** the tested head (Jack never merges). CURRENT STATE: the repo setting `allow_auto_merge`
   read `false` on 2026-11-18, so the merge is a deliberate step after green checks. Finishing means landed on
   `main`: then confirm "pages build and deployment" succeeded for the merge SHA and the served version
   matches (`tests/verify-live-shell.py` / the post-merge CI step).
7. Keep built / tested / committed / pushed / merged / deployed / verified-live separate in every report.
   Self-review is labelled self-review.
8. Record: one release-log entry (§10), the Claudex handoff (Current state, Next actions, newest-first
   Dialogue entry with PR/SHA/tests/blockers), and scheduled-task prompts if the change touches what they do.

## 7. Efficient execution — ACTIVE RULE (owner, 2026-11-18)
The two releases before this rule took 113 model requests and 64.8M cached-read tokens, much of it
re-reading a 570K-character CLAUDE.md. Work this way:
- **Search, don't read.** `grep -n` the code and `docs/claude/*.md`; read a line range (`sed -n a,bp`), not
  whole files. Never Read `docs/claude/release-log.md`, `gotchas.md` or `key-files.md` end to end, never
  print `data.json` or large JSON, and read `index.html` only by grep + ranges.
- **Plan the whole change set first, then batch.** Edit each file once where possible; one version bump
  per release; one PR per scope; run independent tool calls in parallel.
- **Targeted tests while developing** (§8). Run the full gate set once on the final head (§6.4); CI is the
  gate of record for the long browser suites (journey-browser ≈ 11 min).
- **No status polling loops.** Wait for CI with ONE blocking shell call (timeout ≤ 10 min, then at most one
  more), not repeated separate status checks. GraphQL (`gh pr checks`) is refused in Claude sessions; use REST:
  `for i in $(seq 1 18); do r=$(gh api repos/mcdermottj639/portfolio-dashboard/commits/$SHA/check-runs --jq '.check_runs[]|"\(.name)=\(.status)/\(.conclusion)"'); [ -n "$r" ] && ! grep -q 'queued\|in_progress' <<<"$r" && break; sleep 30; done; echo "$r"`.
  After merge, one Pages check in the same style (≤ 5 tries, 60 s apart).
- **Delegate only parallel, independent work**, and hand the agent file paths + line ranges, not "read CLAUDE.md".
- **Short records.** Release-log entry ≤ 12 lines; handoff entries link PR/SHA instead of re-describing.
- **Measure.** On each development task note requests/turns, elapsed time and cached-read tokens when the
  tool reports them, in the handoff Dialogue entry, so the next comparable task can be compared.

## 8. Targeted tests by area (run these first; full set before merge)
| Touching | Run |
|---|---|
| `ui/apex.js`, Apex card, Confirm | `node producer/apex.test.mjs`, `node producer/apex-turnover.test.mjs`, `tests/apex-browser.mjs`, `tests/sd-plan-browser.mjs` |
| Apex v2.9 paper | `node producer/apex-paper.test.mjs`, `node --test tests/apex-paper*.test.cjs`, `tests/apex-paper-view-browser.mjs` |
| `ui/duo.*`, `ui/book.*`, layout | `node --test tests/duo.test.cjs`, journey-browser (duo/book/workspace checks), `holdings-duo-browser`, `today-viewport-browser` |
| `ui/experience*.js`, navigation | `node --test tests/experience.test.cjs tests/journey.test.cjs`, journey-browser (nav-b, workspace) |
| Today | `node --test tests/today.test.cjs tests/daily-brief.test.cjs`, `brief-browser`, `today-viewport-browser` |
| Ticket status wording | `node --test tests/ticket-status.test.cjs`, journey-browser (ticket-status checks) |
| Predictions / Smart $ | `node --test tests/predictions.test.cjs tests/smartmoney.test.cjs`, `tests/predictions-browser.mjs` |
| `producer/hist-plan.mjs`, `build-data.mjs`, refresh | `node producer/hist-plan.test.mjs`, `node producer/build-data.test.mjs`, `node producer/refresh-recovery.test.mjs` |
| Agentic executor / planner | `node producer/agentic-deploy.test.mjs`, `agentic-exec-gate.test.mjs`, `agentic-pending.test.mjs`, `agentic-ledger.test.mjs`; simulate the next scheduled run (`docs/claude/process.md`) |
| Research target | `node producer/finalize-target.test.mjs`, `finalists.test.mjs`, `momentum-shadow.test.mjs`, `riskweights.test.mjs` |
| Business check | `node producer/business.test.mjs` |
| Any published `data/*.json` | `python3 scripts/validate-data.py` + the file's domain test |
| Docs only | `node --test tests/claude-docs.test.cjs` |

(If a listed test file does not exist, `ls producer/*.test.mjs tests/` and pick the matching suite.)

## 9. Reference docs — load only when the task needs them
| Doc | Load when |
|---|---|
| `docs/claude/architecture.md` | Producer/consumer split, one run's data flow, which scheduled job runs what (HISTORICAL ids/crons — recheck with `list_triggers`) |
| `docs/claude/process.md` | Plan→Build→Verify, preview fixtures (`make-sample-data.mjs` flags), the full verify narrative, env vars, encryption; superseded lines are flagged at its top |
| `docs/claude/key-files.md` | Before changing a module: its row says what it owns (indexed by file) |
| `docs/claude/gotchas.md` | Before changing an area with a recorded lesson (indexed by lead line): bar shapes, staleness, deposits, wash sales, margin, options collateral, transposed arrays, … |
| `docs/claude/features.md` | Where a screen/card lives and what it already does |
| `docs/claude/release-log.md` | Why something is the way it is (HISTORICAL, newest first; grep by version, file or ticker) |
| `producer/AGENTIC.md` / `PRODUCER.md` / `SCHEDULING.md` / `RAILWAY.md` | Executor and mandate / producer steps / scheduling / optional Railway path |
| `producer/APEX-DECISIONS.md` | Apex rules contract and the apex-targets schema |
| `UI-PRESERVATION.md`, `UX_REVIEW.md`, `ui/TODAY.md`, `docs/REDESIGN-2.0-AUDIT.md` | UI contracts and design decisions that must not regress |

Code comments that cite "CLAUDE.md <topic>" (e.g. `producer/histbars.mjs`, `equityseries.mjs`,
`optvol.mjs`, `build-data.mjs`) refer to text now in `docs/claude/gotchas.md`, `key-files.md` or
`release-log.md` — grep the topic there.

## 10. Writing to these docs — ACTIVE RULE
- A release adds ONE entry at the top of `docs/claude/release-log.md` (≤ 12 lines: owner request + time,
  what changed, files, tests, what is NOT verified). Do not add release entries to this file.
- Change this file only when an ACTIVE rule, gate, open item or file location changes: **replace** the line
  it supersedes (move the old wording to the release log as HISTORICAL if worth keeping); never append a
  second rule beside the first. Keep it under the 40,000-character budget.
- New lessons go in `docs/claude/gotchas.md`, new modules in `key-files.md`, new screens in `features.md`
  (add the index line too).
- When a rule changes, fix the older docs, prompts and comments that still carry the old wording in the
  same change.

## 11. CURRENT STATE and open items (dated 2026-11-18 — recheck before relying on them)
- App/cache **v254 / pf-v254** on `main` (recheck `APP_VERSION` / `CACHE_VERSION`).
- **UNVERIFIED — DXCM history correction (v252).** The fix to held-name daily history (`hist-plan.mjs`
  bar-sized calls, held-name directive in `preflight.mjs`, union of raw files and `holdings-history`
  warning in `build-data.mjs`) is merged, but ticker-level freshness is **not confirmed**: the snapshot is
  encrypted and cannot be read from a session or CI. Snapshot commits or file growth are not proof. It
  clears only when a run shows DXCM's last real daily bar within one trading day and no
  `holdings-history: DXCM` in `refreshInputs.missing` / `REFRESH_PARTIAL`, or Jack's phone shows DXCM
  Analyze without "Limited Data / STALE DATA".
- UNVERIFIED: every Duo layout since v219 on a physical iPhone Duo; iOS momentum / fixed-in-scroller
  behaviour of the Book independent-scroll trial (`INDEP_ROUTES` = `plan` only — extend only if the phone
  confirms it).
- Known, left alone: the Apex header "Last scan" stamp reads the Daily Picks screen date, not the Apex scan
  (v253); in Book, Markets and Analyze have no left-page command panel (v250).
- v2.9 paper: first Monday cohort freezes 2026-11-23; results are descriptive until 12 Monday cohorts.
- Momentum-off shadow (••••3900): paper only; `thin` until 4 graded cohorts.
