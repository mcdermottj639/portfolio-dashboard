// Single source of truth for the Markets-tab symbols.
//
// The Markets tab in ../index.html renders quote tiles (price + day% + YTD% + 5Y%)
// for a FIXED set of benchmark / risk-gauge / sector tickers — independent of what
// the account actually holds. These lists must stay in sync with MKT_INDEX,
// MKT_RISK and MKT_SECTORS in index.html.
//
// The producer must fetch, EVERY run:
//   • get_equity_quotes        for all MARKET_SYMBOLS  (price + day%)
//   • get_equity_historicals   interval=day  for MARKET_SYMBOLS (YTD%)
//   • get_equity_historicals   interval=month for MARKET_SYMBOLS (5Y%)
// …in addition to the account's own position symbols. Skipping these is why the
// Markets tab shows "—" for everything the account doesn't hold.

export const MARKET_INDEX   = ['SPY', 'QQQ', 'DIA', 'IWM'];
export const MARKET_RISK    = ['GLD', 'TLT', 'HYG', 'IBIT'];
export const MARKET_SECTORS = ['XLK', 'XLC', 'XLY', 'XLF', 'XLV', 'XLI', 'XLP', 'XLE', 'XLU', 'XLB', 'XLRE'];
// International benchmarks for the "US vs International" chart (developed ex-US + emerging).
export const MARKET_INTL    = ['EFA', 'EEM'];

// De-duplicated union, in a stable order, for the fetch lists.
export const MARKET_SYMBOLS = [...new Set([...MARKET_INDEX, ...MARKET_RISK, ...MARKET_SECTORS, ...MARKET_INTL])];
