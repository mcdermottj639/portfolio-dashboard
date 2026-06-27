// Mega-cap "leaders" bench for the Plan-page Ideal Portfolio (Action Center · Step 4).
//
// The ideal-portfolio target isn't confined to what the account holds or today's oversold Picks
// screen — it can also reach into a curated bench of big names with good upside. The CONSUMER scores
// and sizes them (index.html · renderActionPlan), but it needs a LIVE PRICE for each, and the snapshot
// only carries quotes the producer fetched. So the producer:
//   • quotes every LEADERS symbol each run (get_equity_quotes — folded into the every-run quotes call),
//     so data.quotes has their price/day%, and
//   • emits this list as `data.leaders` (build-data.mjs) so the consumer reads the bench + sectors from
//     data (single source of truth) rather than a hardcoded array.
//
// Sectors here are the broad GICS-ish themes the consumer diversifies on (must match the Sector strings
// the consumer derives for held names / picks, e.g. "Technology", "Communication Services"). Keep this
// list tight — quality large-caps across sectors; it's a bench, not an index.
export const LEADERS = [
  { sym: 'NVDA',  sector: 'Technology' },
  { sym: 'MSFT',  sector: 'Technology' },
  { sym: 'AAPL',  sector: 'Technology' },
  { sym: 'AVGO',  sector: 'Technology' },
  { sym: 'ORCL',  sector: 'Technology' },
  { sym: 'GOOGL', sector: 'Communication Services' },
  { sym: 'META',  sector: 'Communication Services' },
  { sym: 'NFLX',  sector: 'Communication Services' },
  { sym: 'AMZN',  sector: 'Consumer Cyclical' },
  { sym: 'HD',    sector: 'Consumer Cyclical' },
  { sym: 'LLY',   sector: 'Healthcare' },
  { sym: 'UNH',   sector: 'Healthcare' },
  { sym: 'JPM',   sector: 'Financial Services' },
  { sym: 'V',     sector: 'Financial Services' },
  { sym: 'MA',    sector: 'Financial Services' },
  { sym: 'COST',  sector: 'Consumer Defensive' },
  { sym: 'WMT',   sector: 'Consumer Defensive' },
  { sym: 'PG',    sector: 'Consumer Defensive' },
  { sym: 'XOM',   sector: 'Energy' },
];

// Symbols only — for the producer's every-run get_equity_quotes fetch list.
export const LEADER_SYMBOLS = LEADERS.map((l) => l.sym);
