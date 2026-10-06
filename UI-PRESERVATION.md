# Interface preservation map · v162

The navigation layer leaves the five original pages and all their contents in place. Section
links scroll to original cards instead of copying or reimplementing their calculations.
Classic view is available from the header. The original feature search and saved My view remain.

| Existing destination | New entry point |
| --- | --- |
| Accounts, account switch, snapshot tiles | Portfolio → Accounts overview |
| All Positions, sorting, small positions | Portfolio → All positions; original overview |
| Account performance, SPY/QQQ, heatmap | Portfolio → Performance / Heatmap |
| Risk, diversification, allocations, drawdown | Portfolio → Risk & allocation; adjacent original cards |
| Income, dividends, tax-loss harvesting, realized P&L | Portfolio → Income & tax |
| Options positions, orders, Greeks, IV, ideas, payoff views, watchlists | Portfolio → Options (explicitly self-directed source) |
| Plan / Action Center, Daily Picks, composite chart, filters, screen track record, earnings | Research → Plan & Action Center (self-directed) |
| Agentic targets, bands, drift, parking, guardrails, diagnostics, forward observations | Research → Plan & Action Center (agentic) |
| Markets, sectors, macro, breadth, retail buzz | Research → Markets |
| Analyze, technical chart, scanner, fundamentals, live/estimated option context | Research → Analyze |
| Technical Signals / Fundamentals / Flow & Positioning | Portfolio shortcuts to original account cards |
| Rebalance logs, grading, methodology | Activity → Rebalance log for selected account |
| Find, Help, saved pins, collapse, privacy, refresh, Signal Ledger/Midnight theme toggle, PWA offline | Original controls and implementations retained |

## New views and their limits

- Predict adds Positions, Ideas, Watchlist and Results without replacing any account, plan or
  research page. It is a separate account/data scope and hides the stock-account picker.
  Ideas are public liquidity-based research candidates; outcomes are hypothetical and before fees.
  Private account values remain unavailable until authenticated event-contract coverage is verified.
  The old Income & Tax derivatives row is now explicitly unverified, with its recorded values kept.
  See `producer/PREDICTIONS.md` for source, refresh, import/export and connection details.

- Today is one combined Daily Brief for Self-directed + Agentic. Its header has no account toggle;
  the detailed pages keep theirs. Totals require both recorded account values. Shared tickers aggregate
  across accounts; positive cash and margin debt stay separate. Stock contributions do not represent
  full account return. Combined history uses only matching recorded dates and includes cash flows.
- The brief also surfaces market context, dated earnings/options events, broker-reported self-directed
  options income and exposure, and recorded agentic research/ticket/guard status. Missing, stale and
  unreconciled evidence stays explicit. Links to each account or plan select the intended account.
- Activity shows publication time, account/target/ticket records. The snapshot does not provide
  live Claude run health, broker reconciliation, or push-delivery receipts; these remain unavailable.
- Decision evidence is for the agentic target only. It preserves research dates, recorded thesis,
  source dates and links, and missing evidence labels. The original self-directed plan stays separate.
- What if is local scenario arithmetic on one holding, with other assets held flat, optional
  assumed trading cost, and no tax/option sensitivity model. It cannot change a target or place a trade.

## Release checks

Run `node tests/experience.test.cjs`, `node tests/daily-brief.test.cjs`, all `producer/*.test.mjs` sequentially, and browser checks
using `node tests/preview.mjs` (synthetic data). Check both accounts, every navigation entry,
existing charts and Analyze drill-down, privacy, Gold/Light, mobile width, and Classic view.
The UI version, cache version, and versioned shell asset URLs must move together.

### Local verification (2026-09-16)

- Interface tests pass. Browser checks exercised both accounts, navigation destinations,
  rendered performance charts, scenario input changes, privacy masking, Classic return,
  and a 390px mobile viewport. No browser console errors were recorded.
- Existing producer suite: 31 files pass; `agentic-correctness.test.mjs` fails at line 103
  on Windows. The unchanged `finalize-target.mjs` CLI entry guard compares a native Windows
  path to a file URL, so the subprocess exits without executing the validation. This is
  outside the interface change; producer code is unchanged.
- Browser preview uses synthetic data. Live decrypted broker data and production service
  worker upgrade behavior have not been verified in this local preview.

### Daily Brief verification (2026-10-02)

All 40 producer suites and both display-model suites pass. With `tests/preview.mjs` running,
`tests/brief-browser.mjs` checks initial combined rendering from an Agentic preference, explicit
account/plan/options links, unchanged detailed account switching, 320–1440px layouts, foreground
updates, details persistence, privacy round-trip, Midnight, and a missing account. Set
`PF_PLAYWRIGHT` and `PF_CHROME` to an available browser install; optional `PF_SCREENSHOT_DIR`
keeps screenshots under local scratch. `producer/privacy-audit.mjs` now audits Today too;
`PF_AUDIT_DATA=tmp/experience-preview/sample.json` uses the preview fixture without changing data.json.
All eight audited surfaces reported zero leaks. Synthetic browser verification, Chart.js stub;
no decrypted live balances or independent Fable reviewer were available. Self-audited.

### Predictions verification (2026-10-06)

All 42 producer suites and the dashboard model/cache suites pass. Predict and Daily Brief browser
checks passed at 320/390/768/1440px, with synthetic account data, a Chart.js stub and real public
prediction snapshots. Includes Classic reload, keyboard tabs, target persistence, export/import,
stale and offline behavior, theme switching, privacy masking and production raw-feed fallback.
Self-audited; authenticated Predict access and the first production schedule remain separate checks.
