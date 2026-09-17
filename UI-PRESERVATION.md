# v150 interface preservation map

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
| Technical Signals / Fundamentals / Flow & Positioning | Research shortcuts to original account cards |
| Rebalance logs, grading, methodology | Activity → Rebalance log for selected account |
| Find, Help, saved pins, collapse, privacy, refresh, Signal Ledger/Midnight theme toggle, PWA offline | Original controls and implementations retained |

## New views and their limits

- Today reads the published snapshot and the existing main account calculations. Day contributions
  are stock-quote changes, not a claim about cash flows, options P&L, or verified account return.
- Activity shows publication time, account/target/ticket records. The snapshot does not provide
  live Claude run health, broker reconciliation, or push-delivery receipts; these remain unavailable.
- Decision evidence is for the agentic target only. It preserves research dates, recorded thesis,
  source dates and links, and missing evidence labels. The original self-directed plan stays separate.
- What if is local scenario arithmetic on one holding, with other assets held flat, optional
  assumed trading cost, and no tax/option sensitivity model. It cannot change a target or place a trade.

## Release checks

Run `node tests/experience.test.cjs`, all `producer/*.test.mjs` sequentially, and browser checks
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
