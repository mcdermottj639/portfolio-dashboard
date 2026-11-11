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
