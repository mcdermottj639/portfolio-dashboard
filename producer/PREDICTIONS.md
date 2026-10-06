# Predictions (v162)

Predict is a top-level section in the existing portfolio dashboard. It has Positions, Ideas,
Watchlist and Results; the default is Ideas. Both Ivory and Midnight work on desktop and mobile.
The feature is read-only. It places no orders and does not prompt for brokerage credentials.

## Public markets

`node producer/predictions-fetch.mjs` writes `data/predictions.json`. `PREDICTIONS_OUTPUT` can
redirect output for an isolated trial. No keys, account balances, positions or watchlists are
used by this collector. The initial committed file is actual public market data, timestamped
at collection. It is not live streaming data.

The seven initial series are NFL, college football, MLB, MMA, Fed rates, CPI and core CPI.
Sports cover the next 21 days; economics the next 120. Combos are excluded. Pagination must
complete before a series is considered successfully collected. This is a selected universe,
not Robinhood's entire catalog. Market and chart timestamps remain separate.

The Ideas screen selects up to eight liquid research candidates, with no more than one
contract per event at a time and a balance of sports/economics when qualified candidates exist.
Checks require fresh quotes (45 minutes), a positive Yes bid, an ask between zero and one,
a spread no wider than eight cents, at least 100 contracts in 24 hours and readable rules.
The score uses activity, spread, movement and proximity to resolution. It is **not a forecast**.
There is no fabricated probability edge, buy recommendation or algorithmic entry target.
Sports Hub predictions have not been joined or calibrated against these exact contracts.

Each first-published event keeps its original side, title, price, time and rationale. A later
opposite outcome cannot silently replace that reference. Results require an explicit exchange
settlement; closed/missing markets remain pending. Archived markets use the historical API.
Partial payouts are supported. Results describe one hypothetical Yes contract at the recorded
ask, before fees and execution costs, not the user's P&L or an independently verified strategy.
Original observations are never silently capped or pruned. Up to 60 absent unresolved contracts
are checked per run, oldest check first, so very large backlogs may take multiple runs.

Public Robinhood pages supply optional links by exact Kalshi exchange symbol. The discovery
runs at most every six hours and checks up to 18 linked events. An unmatched market says so;
a matched link does not establish account eligibility, available size or a Robinhood quote.
Charts show hourly trade closes where available; missing intervals remain gaps. The date at
the top of a card is expected resolution, not necessarily event start time.

## Refresh, failure and hosting

`.github/workflows/predictions.yml` collects at minutes 7, 22, 37 and 52, all seven days, including
evenings. The workflow activates on the default branch after merge and runs once on collector code/config changes. The UI checks the published
snapshot each minute while visible; Refresh reloads the file, not the collector. GitHub schedule
and CDN delivery may be delayed. A failed series keeps its old collection time; total collection
failure leaves the prior file unchanged. Stale targets are paused.

Production reads the public `main/data/predictions.json` on raw.githubusercontent.com, with the
same-origin file as a fallback. This avoids depending on a Pages rebuild for each bot data commit.
GitHub's standard workflow token does not trigger a Pages build merely by pushing a commit.
The raw public endpoint supports browser CORS (verified on this repository). The service worker
uses network-first for both public snapshot URLs, retaining JSON offline; it does not substitute
HTML for a missing snapshot. Localhost previews use their own branch's same-origin snapshot.

The schedule, write permissions and public main-branch delivery must still be verified in the
first post-merge workflow run. Protected-branch rules or repository Actions settings may require
owner action; this change does not alter them or bypass a branch policy.

Reference: https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-github-pages-site

## Watchlist

Stars save market IDs and locally chosen Yes/No ask targets on the current browser/device.
Targets trigger a visual status only, using the chosen side's fresh ask; there are no background
push notifications. Export/import transfers the watchlist; it is not cross-device account sync.
Imports preserve IDs and target intent but cannot supply trusted fresh quotes. Invalid files do
not erase an existing watchlist. Browser-storage failures prompt the user to export.

## Authenticated Predict account (pending connection)

Named positions, Predict cash and actual results remain unavailable until an authenticated,
read-only event-contract feed can be verified. The current legacy blank-symbol derivative rows
are not adequate: futures can share that shape and separate transactions can have identical
amount/time/quantity. They stay labeled as unverified legacy derivatives, outside verified
Predict totals. Existing equity cash-flow calculations are unchanged.

`build-data.mjs` optionally reads `producer/raw/prediction-account.json` (plain or MCP wrapper),
passes it through `prediction-account.mjs`, and includes it only in the encrypted account snapshot.
Without new valid input it carries the previous capture forward **without changing its asOf**.
The public collector never reads this file. The adapter is implemented and tested, but is not
an authenticated connector and cannot itself prove the origin of a hand-written payload.

Only the authenticated producer should supply this contract, directly from explicit broker fields:

```json
{
  "schemaVersion": 1,
  "source": "robinhood",
  "asOf": "2026-10-06T21:00:00Z",
  "historyStart": "2026-01-01",
  "historyComplete": true,
  "coverage": {"balance": true, "positions": true, "transactions": true, "fees": true},
  "balance": {"value": null, "availableCash": null},
  "positions": [],
  "transactions": []
}
```

This is a schema illustration, not an account snapshot. Do not set a coverage flag or an empty
list to mean "not available." A complete empty list means a verified zero. Positions require
`assetClass: "event_contract"`, `contractId`, `name`, `side` (yes/no), `quantity`; optional values
are `averagePrice`, `marketValue`, `costBasis`, `feesPaid`. Transactions require `assetClass`, a
stable broker `id`, `contractId`, `at`, `type` (buy/sell/settlement/void), `quantity`; optional fields
are `name`, `price`, `fees`, `realizedNet`. Prices use dollars per contract. Unknowns must be null.
`realizedNet` must be broker-reported net realized P&L, not a gross payout or a locally inferred
profit. Exact duplicate transaction IDs are deduplicated; conflicting IDs block complete results.
Fees, full historical coverage and explicit net amounts are required before showing net P&L.

Before enabling this producer input, check the actual Predict tools for account identity, named
open contracts, fully paginated transactions, all charges and settlement records. Reconcile a
small sample with the broker. If any capability is missing, leave its coverage false. No trade
submission or account-setting change is needed.

## Validation

- `node --test tests/*.test.cjs`
- `node producer/prediction-account.test.mjs`
- `node producer/predictions-fetch.test.mjs` (mock transport; pagination, historical settlement,
  exact link matching, partial and total outages; does not touch the production snapshot)
- `node producer/build-data.test.mjs` (synthetic integration; restores committed account data)
- Existing `producer/*.test.mjs` suites are the CI regression gate.
- Start `node tests/preview.mjs`, then run `node tests/predictions-browser.mjs` and
  `node tests/brief-browser.mjs` with Playwright available. `PF_PLAYWRIGHT` and `PF_CHROME`
  may point to local installations. `PF_SCREENSHOT_DIR` enables desktop/mobile captures.
  The preview always uses synthetic account data. Never run make-sample-data directly over a
  production account snapshot just to preview this screen.

Browser checks cover 320, 390, 768 and 1440 pixels; search/categories; watch persistence;
export/import; in-progress edits across refresh; side-specific and stale targets; offline retry;
keyboard tabs; account privacy; Midnight; navigation back into the daily brief. Actual private
broker access and a running default-branch schedule are explicitly outside these local checks.
