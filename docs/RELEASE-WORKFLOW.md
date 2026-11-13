# Evidence-based development and release

## Roles and authority

GitHub is authoritative for code, PRs, checks and release history. Claudex/Drive
remains the shared handoff. ChatGPT coordinates and uses verified tools; Codex
and Claude are implementation/review options, not automatic permission upgrades.
Claude Duet remains the reasoning recipient; Jarvis is the display/workflow layer.
One task has one implementation owner. Do not replace existing automation owners.

- Coordination: https://docs.google.com/document/d/1oyJS2uyoBF8-TET3fLxU-hvlke9U805GXNhFjMb4k8Q/edit
- Portfolio handoff: https://docs.google.com/document/d/1tRDoWPVmd8HhEV7-rqPoqG1cYe7Yp9lAXAasEMos5xw/edit
- Shared UX research: https://github.com/mcdermottj639/Ebay/blob/main/UX_REVIEW.md

## Release sequence

1. Read current instructions/handoff; inspect main and overlapping PRs. Record
   base SHA, authorization, owner, scope, acceptance test and recovery path.
2. Implement on an isolated branch with synthetic fixtures and minimum access.
   Keep model/data, UI and permission changes separable. Add a failing regression
   for a bug before fixing it when practical.
3. Run relevant local checks and all required CI. Review the combined diff and
   resulting behavior. Separate review is preferred; never disguise self-review.
4. Re-read main and the PR head. If either changed materially, reconcile and
   revalidate. Merge only the tested head using an expected-head lease where
   available. Do not bypass a failed, missing or cancelled check.
5. Observe the deployment for the merge SHA and the actual served version/files.
   Verify the changed user journey. A frontend deploy is not a backend deploy;
   a synthetic UI pass is not a broker/runtime/source acceptance test.
6. Save a concise completion record: PR/head/merge/deploy/check evidence,
   limitations, rollback target and remaining owner/action. Release the claim.

## Current CI contract

- `Producer tests` runs for every PR (including data-only PRs), merge groups and
  selected main code pushes. It retains producer/model and four browser suites.
- `Data integrity` runs on every PR, merge group and ordinary main push. It tests
  the validator, checks published JSON, and runs the existing business-record
  contract. It logs no payloads and has read-only repository permissions.
- `scripts/validate-data.py` rejects malformed UTF-8/JSON, duplicate keys,
  non-finite numbers, scalar roots, missing required feeds and symlink paths.
  Default scope: data.json plus data/**/*.json. It neither decrypts accounts nor
  approves freshness, factual accuracy, investment rules or trades.
- Prediction collection retains its existing cadence and sole output path. It
  validates its snapshot before commit and again after rebase/before push.
  GITHUB_TOKEN-generated pushes do not trigger ordinary follow-on workflows;
  do not rely on the post-push check to guard that publisher.
- Existing freshness and deployment watchdogs remain; do not add duplicate
  polling jobs merely to show activity.

## Repository enforcement: explicit remaining dependency

At the November 13 inspection, main was unprotected. Adding these files does NOT
turn on branch protection, configure Codex Cloud, or enable automatic reviews.
The current connector exposes no repository-administration write action.

Before requiring PRs/checks for main, migrate/verify every authorized direct
publisher. Known: predictions.yml publishes data/predictions.json directly;
external producer snapshots also update main. A blanket PR requirement today
could break them. Do not give a general coding agent an unrestricted bypass.

Next enforcement rollout: inventory publisher identity + permitted paths +
pre-push checks; test PR-based or narrowly scoped publication; then configure
required `test` and `data-integrity` checks using their observed GitHub names and
App identity, prevent force pushes/deletion and audit any authorized exceptions.
Test a deliberately invalid branch is rejected and a valid data refresh succeeds.
Do not claim branch protection until settings are read back and this is proven.

## Codex environment pilot

Configure one environment with Node 22, Python 3 and the pinned Playwright browser
runtime used by CI. No production secrets or broker connections; restrict network
to required package sources. Demonstrate a bounded edit/test/PR/review/authorized
merge/deployment/served check. This session's GitHub/API work is not proof that a
separate Codex Cloud environment is configured. Automatic Codex review is optional
and must be enabled/verified separately; no recurring cost is assumed approved.

## Recovery and measurement

Use a scoped revert of the defective change or redeploy the last known-good
artifact. Do not reset main wholesale, rewind fresh snapshots or overwrite
unrelated merges. Persistent-data migrations require their own backup/recovery
plan before implementation. After recovery verify the served app and data age.

Record regressions, reverts, failed releases, manual handoffs and usage per useful
change. Fewer handoffs and verified outcomes matter more than PR volume. Expand
the workflow app by app after evidence, retaining each app's own test commands.

## Primary references

- GitHub workflow/permissions: https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax
- GitHub trigger behavior: https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow
- Codex review rules: https://developers.openai.com/blog/custom-code-review-rules-for-codex
