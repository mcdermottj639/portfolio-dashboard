# Portfolio Dashboard: agent entry point

Start from current `main`, not an old release number. Read the newest relevant
`CLAUDE.md` entries, `UI-PRESERVATION.md`, `UX_REVIEW.md`, and
[the release workflow](docs/RELEASE-WORKFLOW.md). For strategy work also read the
applicable producer contract; never infer trading authority from repo access.

## Work and handoff

- Read the current Portfolio handoff and Claudex coordination before editing.
  Claim a bounded task/files/base SHA/branch. One implementation owner per scope;
  separate scopes may run in parallel. A claim is advisory, not a lock.
- Inspect open PRs and current main before writing and again before merging.
  Preserve newer work. Use a branch/PR; no force push or direct main overwrite.
- Use exact-head CI evidence and a separate review when available. Label a
  self-review honestly; a second comment from the same agent is not independent.
- User-approved merge/push means finish the bounded release and verify it; do not
  request duplicate approval. A tool denial or expanded scope is a real stop.
- Update the canonical handoff with evidence and the remaining owner/action.
  Do not claim another assistant received or acted on a saved note.

## Boundaries

- Preserve Apex versus Agentic separation, source/freshness checks, encrypted
  records, privacy mode, owner-managed exceptions, and whole-book confirmation.
- UI/process work cannot change scores, risk limits, stops, account permissions,
  external orders, research grades or scheduled-task authority.
- Missing research or failure of new-entry eligibility is not a held-position
  exit. Keep existing validated protective exits and owner exceptions intact.
- No live trade, purchase, listing, production credential, or decrypted-account
  test. Use synthetic fixtures. Never put private data in logs, artifacts or URLs.
- Unknown, stale, incomplete and zero are different. A committed data file does
  not establish source truth, broker execution or live runtime consumption.

## Checks

Python 3 and Node 22; no secrets needed for these tests:

```sh
python3 -m unittest discover -s tests -p 'test_validate_data.py' -v
python3 scripts/validate-data.py
for t in producer/*.test.mjs; do node "$t" || exit 1; done
node --test tests/*.test.cjs
```

Use `.github/workflows/tests.yml` for the pinned Playwright installation and four
synthetic browser suites. UI work also needs rendered narrow/expanded layouts,
Back/refresh, account selection and privacy checks. Browser viewports are not
physical-device tests. Do not run the producer or executor to test a UI change.

## Review priorities

Reject account cross-talk, altered execution authority, secret exposure, data
loss, missing-is-zero logic, stale-code overwrites and unrelated strategy edits.
For data PRs check schemas/provenance and existing domain tests, not just syntax.
Require distinct evidence for built, tested, pushed, merged, deployed and served.
Instruction files guide agents; repository settings enforce merge restrictions.
