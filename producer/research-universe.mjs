// producer/research-universe.mjs — the candidate BENCH the weekly agentic research screens over.
//
// WHY THIS FILE EXISTS. Until 2026-08-25 the weekly Routine assembled its universe from
// `leaders.mjs` (19 names, 16 of them megacap or large-growth) + the day's oversold scan + the current
// ••••3900 holdings. Six research cycles run against that bench produced **14 distinct names in seven
// weeks**, seven of which appeared in five or more of six targets (SPY/GOOGL/NVDA/JPM 6-of-6;
// MSFT/LLY/V 5-of-6). That is not a screen re-confirming its convictions, it is a screen with almost
// nothing else to look at — and the two are indistinguishable from the outside, which is precisely the
// problem: "these are the best names" and "these were the only names" produce identical evidence.
//
// The accumulated cost was concentration nobody chose: on 2026-08-24 the book was 46.0% one AI/big-tech
// bet (37.5% direct + 8.5% inside SPY/VTI) against a 48% ceiling, and 2.9% defensive against a 15%
// floor. No individual pick was wrong; the total was never anyone's decision.
//
// `leaders.mjs` is deliberately NOT reused for this. It is the CONSUMER's Plan-page Ideal Portfolio
// bench, it is quoted on every single producer run, and it is curated to be tight ("it's a bench, not
// an index"). This list is the opposite job: wide, screened weekly, quoted only on research day.
//
// ── HOW BIG SHOULD THIS BE? THE ANSWER IS "AS BIG AS THE SLEEVES CAN ACTUALLY SCORE" ────────────────
// Universe size is nearly free in agent count — the sleeve stage is 4 agents no matter how long the
// list is. What it is NOT free in is per-name data. The sleeve prompts instruct: "if you truly cannot
// get data, score 5.0 and say no data", and that fallback is fatal to a candidate:
//
//     an unscored name's composite tops out at  0.82×5 + 0.18×9 = 5.72   (and is typically ~5.13)
//     the marginal finalist scores               ~6.5 - 6.9
//
// So a name the sleeves cannot reach is not merely unlikely to be picked — it is ARITHMETICALLY
// INCAPABLE of clearing the cut, because only the valuation term (0.18 weight) can move it. Padding
// this list past what can be scored does not widen the search; it thins each sleeve's attention across
// names that were never eligible. Bigger is better ONLY up to the scoring ceiling.
//
// Today's ceiling, from the providers' own limits recorded in this repo:
//   • valuation  — FREE at any size. `valOf` is pure code over px/pe/hi/lo, which the Routine already
//                  collects in batch Robinhood calls. Scales to hundreds.
//   • momentum   — Robinhood historicals, 3 symbols/call, no daily quota. ~40 calls at 120 names.
//   • quality /  — Alpha Vantage COMPANY_OVERVIEW etc, PER-SYMBOL and capped at 25/day on the free
//     growth /     tier (see av-fetch.mjs). THIS is the binding constraint, and it is why
//     catalyst     `universeSlice()` exists rather than a single fixed list.
// To lift the ceiling properly, feed fundamentals IN via `args` instead of having the sleeves fetch
// them — the exact pattern the flow sleeve already uses ("not an agent; the producer already computed
// this deterministically"). extfund.mjs already normalizes Finnhub/FMP payloads into the SAME
// COMPANY_OVERVIEW shape AV returns, and those quotas (FMP ~250/day, Finnhub 60/min) are far larger
// than AV's 25/day. That work is NOT done yet — until it is, prefer `universeSlice(60)` over the full
// list, and treat the rest of this bench as ready-to-use breadth rather than breadth in use.
//
// SECTORS use the same FactSet-style strings the research workflow and Robinhood fundamentals return,
// because the workflow's finalist cut is `max 2 per sector` — a mislabelled sector silently changes
// how many of a theme can reach the verify stage. **The Routine must USE these labels, not
// Robinhood's** — RH files REITs under "Finance" and GE under "Electronic Technology", which breaks
// the max-2-per-sector budget (rule recorded in PRODUCER.md step 7.2 and the Routine prompt).
export const RESEARCH_UNIVERSE = [
  // ── Electronic Technology (semis, hardware) ──────────────────────────────────────────────────
  { sym: 'NVDA', sector: 'Electronic Technology', tier: 'core' },
  { sym: 'AVGO', sector: 'Electronic Technology', tier: 'core' },
  { sym: 'AAPL', sector: 'Electronic Technology', tier: 'core' },
  { sym: 'TSM',  sector: 'Electronic Technology', tier: 'core' },
  { sym: 'AMD',  sector: 'Electronic Technology', tier: 'wide' },
  { sym: 'MU',   sector: 'Electronic Technology', tier: 'wide' },
  { sym: 'ANET', sector: 'Electronic Technology', tier: 'wide' },
  { sym: 'ASML', sector: 'Electronic Technology', tier: 'wide' },
  { sym: 'QCOM', sector: 'Electronic Technology', tier: 'wide' },
  { sym: 'TXN',  sector: 'Electronic Technology', tier: 'wide' },
  // ── Technology Services (software, internet) ─────────────────────────────────────────────────
  { sym: 'MSFT', sector: 'Technology Services', tier: 'core' },
  { sym: 'GOOGL',sector: 'Technology Services', tier: 'core' },
  { sym: 'META', sector: 'Technology Services', tier: 'core' },
  { sym: 'ORCL', sector: 'Technology Services', tier: 'wide' },
  { sym: 'CRM',  sector: 'Technology Services', tier: 'wide' },
  { sym: 'ADBE', sector: 'Technology Services', tier: 'wide' },
  { sym: 'NOW',  sector: 'Technology Services', tier: 'wide' },
  { sym: 'PLTR', sector: 'Technology Services', tier: 'wide' },
  { sym: 'IBM',  sector: 'Technology Services', tier: 'wide' },
  { sym: 'ACN',  sector: 'Technology Services', tier: 'wide' },
  // ── Retail Trade ─────────────────────────────────────────────────────────────────────────────
  { sym: 'AMZN', sector: 'Retail Trade', tier: 'core' },
  { sym: 'COST', sector: 'Retail Trade', tier: 'core' },
  { sym: 'WMT',  sector: 'Retail Trade', tier: 'core' },
  { sym: 'HD',   sector: 'Retail Trade', tier: 'wide' },
  { sym: 'TJX',  sector: 'Retail Trade', tier: 'wide' },
  { sym: 'LOW',  sector: 'Retail Trade', tier: 'wide' },
  { sym: 'BABA', sector: 'Retail Trade', tier: 'wide' },
  { sym: 'TGT',  sector: 'Retail Trade', tier: 'wide' },
  // ── Finance ──────────────────────────────────────────────────────────────────────────────────
  { sym: 'JPM',  sector: 'Finance', tier: 'core' },
  { sym: 'V',    sector: 'Finance', tier: 'core' },
  { sym: 'MA',   sector: 'Finance', tier: 'core' },
  { sym: 'BAC',  sector: 'Finance', tier: 'wide' },
  { sym: 'GS',   sector: 'Finance', tier: 'wide' },
  { sym: 'SCHW', sector: 'Finance', tier: 'wide' },
  { sym: 'AXP',  sector: 'Finance', tier: 'wide' },
  { sym: 'ICE',  sector: 'Finance', tier: 'wide' },
  { sym: 'CME',  sector: 'Finance', tier: 'wide' },
  { sym: 'PGR',  sector: 'Finance', tier: 'wide' },
  { sym: 'BLK',  sector: 'Finance', tier: 'wide' },
  { sym: 'SPGI', sector: 'Finance', tier: 'wide' },
  // ── Health Technology (pharma, biotech, devices) ─────────────────────────────────────────────
  { sym: 'LLY',  sector: 'Health Technology', tier: 'core' },
  { sym: 'JNJ',  sector: 'Health Technology', tier: 'core' },
  { sym: 'ABBV', sector: 'Health Technology', tier: 'core' },
  { sym: 'MRK',  sector: 'Health Technology', tier: 'wide' },
  { sym: 'PFE',  sector: 'Health Technology', tier: 'wide' },
  { sym: 'AMGN', sector: 'Health Technology', tier: 'wide' },
  { sym: 'GILD', sector: 'Health Technology', tier: 'wide' },
  { sym: 'VRTX', sector: 'Health Technology', tier: 'wide' },
  { sym: 'ABT',  sector: 'Health Technology', tier: 'wide' },
  { sym: 'MDT',  sector: 'Health Technology', tier: 'wide' },
  { sym: 'SYK',  sector: 'Health Technology', tier: 'wide' },
  { sym: 'NVO',  sector: 'Health Technology', tier: 'wide' },
  // ── Health Services (managed care, distribution) ─────────────────────────────────────────────
  { sym: 'UNH',  sector: 'Health Services', tier: 'core' },
  { sym: 'ELV',  sector: 'Health Services', tier: 'wide' },
  { sym: 'CI',   sector: 'Health Services', tier: 'wide' },
  { sym: 'CVS',  sector: 'Health Services', tier: 'wide' },
  { sym: 'HCA',  sector: 'Health Services', tier: 'wide' },
  { sym: 'MCK',  sector: 'Health Services', tier: 'wide' },
  // ── Producer Manufacturing (industrials, aerospace/defence) ──────────────────────────────────
  { sym: 'GE',   sector: 'Producer Manufacturing', tier: 'core' },
  { sym: 'CAT',  sector: 'Producer Manufacturing', tier: 'core' },
  { sym: 'ETN',  sector: 'Producer Manufacturing', tier: 'wide' },
  { sym: 'HON',  sector: 'Producer Manufacturing', tier: 'wide' },
  { sym: 'PH',   sector: 'Producer Manufacturing', tier: 'wide' },
  { sym: 'EMR',  sector: 'Producer Manufacturing', tier: 'wide' },
  { sym: 'DE',   sector: 'Producer Manufacturing', tier: 'wide' },
  { sym: 'LMT',  sector: 'Producer Manufacturing', tier: 'wide' },
  { sym: 'RTX',  sector: 'Producer Manufacturing', tier: 'wide' },
  { sym: 'GD',   sector: 'Producer Manufacturing', tier: 'wide' },
  // ── Energy Minerals ──────────────────────────────────────────────────────────────────────────
  { sym: 'XOM',  sector: 'Energy Minerals', tier: 'core' },
  { sym: 'CVX',  sector: 'Energy Minerals', tier: 'core' },
  { sym: 'SHEL', sector: 'Energy Minerals', tier: 'wide' },
  { sym: 'CNQ',  sector: 'Energy Minerals', tier: 'wide' },
  { sym: 'COP',  sector: 'Energy Minerals', tier: 'wide' },
  { sym: 'EOG',  sector: 'Energy Minerals', tier: 'wide' },
  { sym: 'SLB',  sector: 'Energy Minerals', tier: 'wide' },
  // ── Consumer Non-Durables (staples) ──────────────────────────────────────────────────────────
  { sym: 'PG',   sector: 'Consumer Non-Durables', tier: 'core' },
  { sym: 'KO',   sector: 'Consumer Non-Durables', tier: 'core' },
  { sym: 'PEP',  sector: 'Consumer Non-Durables', tier: 'core' },
  { sym: 'CL',   sector: 'Consumer Non-Durables', tier: 'wide' },
  { sym: 'KMB',  sector: 'Consumer Non-Durables', tier: 'wide' },
  { sym: 'MDLZ', sector: 'Consumer Non-Durables', tier: 'wide' },
  { sym: 'MO',   sector: 'Consumer Non-Durables', tier: 'wide' },
  { sym: 'PM',   sector: 'Consumer Non-Durables', tier: 'wide' },
  { sym: 'STZ',  sector: 'Consumer Non-Durables', tier: 'wide' },
  // ── Utilities ────────────────────────────────────────────────────────────────────────────────
  { sym: 'NEE',  sector: 'Utilities', tier: 'core' },
  { sym: 'DUK',  sector: 'Utilities', tier: 'core' },
  { sym: 'SO',   sector: 'Utilities', tier: 'wide' },
  { sym: 'AEP',  sector: 'Utilities', tier: 'wide' },
  { sym: 'XEL',  sector: 'Utilities', tier: 'wide' },
  { sym: 'SRE',  sector: 'Utilities', tier: 'wide' },
  { sym: 'D',    sector: 'Utilities', tier: 'wide' },
  { sym: 'ED',   sector: 'Utilities', tier: 'wide' },
  // ── Communications (telecom) ─────────────────────────────────────────────────────────────────
  { sym: 'VZ',   sector: 'Communications', tier: 'core' },
  { sym: 'TMUS', sector: 'Communications', tier: 'core' },
  { sym: 'T',    sector: 'Communications', tier: 'wide' },
  // ── Real Estate (REITs) ──────────────────────────────────────────────────────────────────────
  { sym: 'O',    sector: 'Real Estate', tier: 'core' },
  { sym: 'AMT',  sector: 'Real Estate', tier: 'core' },
  { sym: 'PLD',  sector: 'Real Estate', tier: 'wide' },
  { sym: 'EQIX', sector: 'Real Estate', tier: 'wide' },
  { sym: 'SPG',  sector: 'Real Estate', tier: 'wide' },
  { sym: 'VICI', sector: 'Real Estate', tier: 'wide' },
  { sym: 'PSA',  sector: 'Real Estate', tier: 'wide' },
  { sym: 'WELL', sector: 'Real Estate', tier: 'wide' },
  // ── Process Industries (chemicals, materials) ────────────────────────────────────────────────
  { sym: 'LIN',  sector: 'Process Industries', tier: 'core' },
  { sym: 'SHW',  sector: 'Process Industries', tier: 'wide' },
  { sym: 'ECL',  sector: 'Process Industries', tier: 'wide' },
  { sym: 'APD',  sector: 'Process Industries', tier: 'wide' },
  { sym: 'NUE',  sector: 'Process Industries', tier: 'wide' },
  // ── Non-Energy Minerals (mining, aggregates) ─────────────────────────────────────────────────
  { sym: 'FCX',  sector: 'Non-Energy Minerals', tier: 'wide' },
  { sym: 'NEM',  sector: 'Non-Energy Minerals', tier: 'wide' },
  { sym: 'VMC',  sector: 'Non-Energy Minerals', tier: 'wide' },
  // ── Transportation ───────────────────────────────────────────────────────────────────────────
  { sym: 'UNP',  sector: 'Transportation', tier: 'core' },
  { sym: 'UPS',  sector: 'Transportation', tier: 'wide' },
  { sym: 'CSX',  sector: 'Transportation', tier: 'wide' },
  { sym: 'ODFL', sector: 'Transportation', tier: 'wide' },
  // ── Distribution Services ────────────────────────────────────────────────────────────────────
  { sym: 'SYY',  sector: 'Distribution Services', tier: 'wide' },
  { sym: 'FAST', sector: 'Distribution Services', tier: 'wide' },
  { sym: 'GWW',  sector: 'Distribution Services', tier: 'wide' },
  // ── Commercial Services ──────────────────────────────────────────────────────────────────────
  { sym: 'VRSK', sector: 'Commercial Services', tier: 'wide' },
  { sym: 'CTAS', sector: 'Commercial Services', tier: 'wide' },
  { sym: 'WM',   sector: 'Commercial Services', tier: 'core' },
  { sym: 'ADP',  sector: 'Commercial Services', tier: 'wide' },
  { sym: 'ROL',  sector: 'Commercial Services', tier: 'wide' },
  // ── Consumer Services (restaurants, travel, media) ───────────────────────────────────────────
  { sym: 'MCD',  sector: 'Consumer Services', tier: 'core' },
  { sym: 'SBUX', sector: 'Consumer Services', tier: 'wide' },
  { sym: 'BKNG', sector: 'Consumer Services', tier: 'wide' },
  { sym: 'MAR',  sector: 'Consumer Services', tier: 'wide' },
  { sym: 'CMG',  sector: 'Consumer Services', tier: 'wide' },
  { sym: 'DIS',  sector: 'Consumer Services', tier: 'wide' },
  { sym: 'NFLX', sector: 'Consumer Services', tier: 'wide' },
  // ── Consumer Durables ────────────────────────────────────────────────────────────────────────
  { sym: 'TSLA', sector: 'Consumer Durables', tier: 'wide' },
  { sym: 'DECK', sector: 'Consumer Durables', tier: 'wide' },
  { sym: 'LEN',  sector: 'Consumer Durables', tier: 'wide' },
  { sym: 'DHI',  sector: 'Consumer Durables', tier: 'wide' },
  // ── Miscellaneous (index / diversified vehicles) ─────────────────────────────────────────────
  { sym: 'SPY',  sector: 'Miscellaneous', tier: 'core' },
  { sym: 'VTI',  sector: 'Miscellaneous', tier: 'core' },
  { sym: 'SCHD', sector: 'Miscellaneous', tier: 'core' },
];

export const RESEARCH_SYMBOLS = RESEARCH_UNIVERSE.map((r) => r.sym);
export const DEFAULT_SLICE = 60;   // what the sleeves can score well TODAY (see the ceiling note above)

// A sector-BALANCED slice of `n` names. Taking the first n of the array would hand back whatever
// sectors happen to sit at the top, which reintroduces the exact bias this file exists to remove —
// and the workflow's `max 2 per sector` finalist rule means a slice missing a sector cannot produce a
// finalist from it, no matter how good its names are. So this deals round-robin across sectors,
// 'core' before 'wide' within each, until it has n.
export function universeSlice(n = DEFAULT_SLICE, universe = RESEARCH_UNIVERSE) {
  const bySector = new Map();
  for (const r of universe) {
    if (!bySector.has(r.sector)) bySector.set(r.sector, []);
    bySector.get(r.sector).push(r);
  }
  for (const list of bySector.values()) {
    list.sort((a, b) => (a.tier === b.tier ? 0 : a.tier === 'core' ? -1 : 1));
  }
  const out = [];
  const queues = [...bySector.values()];
  let round = 0;
  while (out.length < n) {
    let placed = 0;
    for (const q of queues) {
      if (round >= q.length) continue;
      if (out.length >= n) break;
      out.push(q[round]); placed++;
    }
    if (!placed) break;   // every sector exhausted
    round++;
  }
  return out;
}

// --- CLI: the weekly Routine calls this to get its bench (PRODUCER.md step 7.2) ---
//   node producer/research-universe.mjs --symbols [--max 60]   → comma list for a batch quote call
//   node producer/research-universe.mjs [--max 60]             → JSON [{t,sec}] rows to fill with live data
if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2);
  const flag = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : d; };
  const maxArg = flag('max');
  const n = maxArg === 'all' ? RESEARCH_UNIVERSE.length : (maxArg != null ? +maxArg : DEFAULT_SLICE);
  const slice = universeSlice(n);
  if (argv.includes('--symbols')) {
    // The gold diversifier rides along AFTER the slice (never displacing a scoreable name): it cannot
    // make the finalist cut — quality/growth/catalyst are meaningless for bullion, so it scores ~5.0 —
    // but finalize-target.mjs injects it structurally and prices its entry/stop from the universe row.
    // Without this, a scheduled research run writes the sleeve with entry "core hold" and stop null
    // (found by the 2026-08-25 verify pass). DIVERSIFIER_SYMS[0] in riskweights.mjs is the vehicle.
    console.log([...slice.map((r) => r.sym), 'GLDM'].join(','));
  } else if (argv.includes('--stats')) {
    const bySec = {};
    for (const r of slice) bySec[r.sector] = (bySec[r.sector] || 0) + 1;
    console.error(`slice ${slice.length} of ${RESEARCH_UNIVERSE.length} across ${Object.keys(bySec).length} sectors`);
    for (const [s, c] of Object.entries(bySec).sort((a, b) => b[1] - a[1])) console.error(`  ${String(c).padStart(2)}  ${s}`);
  } else {
    console.log(JSON.stringify(slice.map((r) => ({ t: r.sym, sec: r.sector })), null, 0));
  }
}
