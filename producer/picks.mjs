// Daily Picks scoring engine — fully Robinhood-driven, with optional AV growth enrichment.
//
// Universe: a saved Robinhood scanner ("Dashboard Picks — oversold large-caps",
// RSI(14) < 45 AND market cap > $10B) — see SCAN_ID. That returns ~hundreds of
// oversold large-caps across every sector with RSI already as a column, so the
// wide screen costs ZERO Alpha Vantage calls.
//
// Pipeline (see PRODUCER.md "Daily Picks"):
//   1. run_scan(SCAN_ID)                          → producer/raw/scan.json
//   2. selectFinalists() picks the N most oversold → fetch RH fundamentals for them
//      (+ optional AV COMPANY_OVERVIEW for revenue growth / forward P/E)
//   3. buildPicks() scores them and emits the candidates[] + picks[] the dashboard renders.
//
// Scoring weights match the dashboard: technical 33% · fundamentals 28% · risk/reward 19% · social 20%.

export const SCAN_ID = '17e8f5a7-395f-4f22-bba8-f287d39b6e57';
export const N_FINALISTS = 12;   // how many to deep-dive (fundamentals + AV)
export const N_CANDIDATES = 10;  // how many to show in the scoring table
export const N_PICKS = 3;        // top picks with full thesis
export const MAX_PICKS_PER_SECTOR = 2; // sector-diversification cap on the highlighted picks

// The Robinhood watchlist the producer keeps in sync with the composite top-N candidates (the Picks
// table). On every FETCH_ALL run, picks-build.mjs emits the sidecar producer/raw/picks-watchlist.json
// and the agent diffs it against the live list (add/remove via MCP — see PRODUCER.md "Sync the Picks
// watchlist"). The id below is the list created for this account; if it's ever deleted the agent
// re-creates it by WATCHLIST_NAME.
export const WATCHLIST_ID = '3f8c0634-f4ac-4265-8824-85e25bae4886';
export const WATCHLIST_NAME = 'Dashboard Top 10 Picks';
export const WATCHLIST_EMOJI = '📈';
export const WATCHLIST_DESC = "Auto-synced daily from the portfolio dashboard's top 10 oversold picks.";

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };

// Pull the per-row columns out of a run_scan result into flat objects.
export function scanRows(scanRaw) {
  const r = scanRaw?.data?.result ?? scanRaw?.result ?? scanRaw;
  const rows = r?.results ?? [];
  return rows.map((x) => {
    const c = x.columns || {};
    return {
      ticker: x.ticker || c.Symbol,
      name: c.Name || x.ticker,
      price: num(c.Last),
      rsi: num(c.RSI),
      marketCap: num(c['Market cap']),
      pctChange: num(c['% Change']),
    };
  }).filter((x) => x.ticker && x.price > 0 && x.rsi != null);
}

// The most-oversold names (lowest RSI), liquidity already implied by the $10B+ screen.
export function selectFinalists(scanRaw, n = N_FINALISTS) {
  return scanRows(scanRaw).sort((a, b) => a.rsi - b.rsi).slice(0, n).map((x) => x.ticker);
}

// --- component scores (0–10) ---
// Technical: oversold (RSI) BLENDED with position in the 52-week range, so "oversold" isn't the
// whole story (RSI alone was double-counted — it also picks the finalists). rsiPart: RSI 25→10,
// 35→~7, 45→~3. rangePart: at the 52wk low → 10, at the high → 0 (deeper in range = more mean-
// reversion room). 70/30 blend keeps RSI leading but lifts a name pinned near its low and tempers
// a low-RSI name that's still near its highs. No 52wk data → fall back to RSI alone.
function techScore(rsi, price, hi52, lo52) {
  const rsiPart = clamp((52 - rsi) / 2.7, 0, 10);
  let rangePart = rsiPart;
  if (price != null && hi52 != null && lo52 != null && hi52 > lo52) {
    const pos = clamp((price - lo52) / (hi52 - lo52), 0, 1); // 0 = at low, 1 = at high
    rangePart = clamp((1 - pos) * 10, 0, 10);
  }
  return clamp(Math.round(rsiPart * 0.7 + rangePart * 0.3), 0, 10);
}

// Fundamentals: valuation (trailing P/E, P/B, dividend) from Robinhood, plus growth
// (revenue growth, forward P/E) from AV when available. Returns 0–10.
function fundScore({ pe, pb, divYield, revGrowth, fwdPE }) {
  let s = 5; // neutral base
  if (pe != null && pe > 0) s += pe < 15 ? 2 : pe < 25 ? 1 : pe < 40 ? 0 : -2;
  if (pb != null && pb > 0) s += pb < 3 ? 1 : pb > 10 ? -1 : 0;
  if (divYield != null && divYield > 1) s += 0.5;
  if (revGrowth != null) s += revGrowth > 20 ? 2 : revGrowth > 8 ? 1 : revGrowth < 0 ? -2 : 0;
  if (fwdPE != null && fwdPE > 0) s += fwdPE > 100 ? -3 : fwdPE < 20 ? 1 : 0;
  return clamp(Math.round(s), 0, 10);
}

// Social: retail-BUZZ sub-score (0–10), centered on a NEUTRAL 5 so names with no chatter are
// unaffected beyond the weight rescale. ApeWisdom's free feed gives attention (mention rank +
// velocity), not a bullish/bearish sentiment, so this scores ATTENTION: a name climbing the
// mention board and surging in volume gets lifted (rising retail interest on an oversold pick is a
// potential bounce catalyst). Velocity is damped when absolute mentions are tiny (low-count % moves
// are noise), and a top-5 euphoric name is crowding-capped so we don't reward a blow-off peak.
//   t = data.social.tickers[TICKER] | undefined  (ApeWisdom: tracked, rank, mentions, mentionChg)
function socialScore(t) {
  if (!t || t.tracked === false) return 5;                       // no retail chatter → neutral
  const rank = num(t.rank), chg = num(t.mentionChg), mentions = num(t.mentions);
  // Attention from rank (1 = most-mentioned of the universe → 1.0; rank 200 → 0).
  const att = rank == null ? 0 : clamp((200 - rank) / 200, 0, 1);
  // Velocity from mention growth, damped when there are few absolute mentions (noise guard).
  const volOK = mentions == null ? 0 : clamp(mentions / 20, 0, 1);
  const vel = chg == null ? 0 : clamp(chg / 300, -0.3, 1) * volOK;
  let socialS = clamp(5 + att * 3.0 + vel * 1.5, 0, 10);         // attention lifts; absence stays ~5
  if (rank != null && rank <= 5) socialS = Math.min(socialS, 7); // crowding cap (euphoric peak)
  return +socialS.toFixed(2);
}
// Short display flag for the picks table.
function buzzLabel(t, social) {
  if (!t || t.tracked === false) return 'Quiet';
  if (num(t.rank) != null && num(t.rank) <= 5) return 'Crowded';
  if (social >= 7.5) return 'High buzz';
  if (social >= 6) return 'Rising buzz';
  return 'On the radar';
}

// Entry / target / stop from price + 52-week range; risk/reward from those levels.
function levels(price, hi52, lo52) {
  const entryLo = +(price * 0.97).toFixed(2), entryHi = +price.toFixed(2);
  // stop: just under recent support — the deeper of -9% or a touch below the 52wk low
  const stop = +Math.min(price * 0.91, (lo52 && lo52 < price ? lo52 * 1.01 : price * 0.91)).toFixed(2);
  // targets: reversion toward the 52wk high, capped to sensible swing sizes
  const headroom = hi52 && hi52 > price ? hi52 - price : price * 0.25;
  const tp1 = +(price + Math.min(headroom * 0.5, price * 0.10)).toFixed(2);
  const tp2 = +(price + Math.min(headroom * 0.9, price * 0.20)).toFixed(2);
  // risk/reward measured from the entry (you buy the dip near entryLo), not spot
  const risk = entryLo - stop, reward = tp1 - entryLo;
  const rr = risk > 0 ? reward / risk : null;
  const pct = (v) => ((v - price) / price * 100);
  return { entryLo, entryHi, stop, tp1, tp2, rr,
    tp1pct: pct(tp1), tp2pct: pct(tp2), slpct: pct(stop) };
}

const fmtPct = (v) => (v >= 0 ? '+' : '') + v.toFixed(1) + '%';

// Top-n from a composite-sorted list, capping how many can share one sector (the broad theme before
// the "·" in our sector strings). Unknown/"—" sectors don't count against each other. If the caps
// leave us short of n, backfill in rank order so we always return n when enough rows exist.
function diversifyBySector(sorted, n, maxPerSector) {
  const theme = (c) => String(c.sector || '—').split('·')[0].trim() || '—';
  const out = [], count = {};
  for (const c of sorted) {
    if (out.length >= n) break;
    const s = theme(c);
    if (s !== '—' && (count[s] || 0) >= maxPerSector) continue;
    count[s] = (count[s] || 0) + 1;
    out.push(c);
  }
  if (out.length < n) for (const c of sorted) { if (out.length >= n) break; if (!out.includes(c)) out.push(c); }
  return out;
}

// Build the full picks payload the dashboard reads (data.picks).
//  finalists: [{ticker, name, price, rsi, marketCap}]  (from scanRows, already sliced)
//  fundBySym: { SYM: <RH get_equity_fundamentals result row> }
//  ovBySym:   { SYM: <AV COMPANY_OVERVIEW object> }  (optional / may be {})
//  socialMap: { SYM: <data.social.tickers entry> }   (optional / may be {} — neutral when absent)
export function buildPicks(finalists, fundBySym, ovBySym, socialMap = {}) {
  const today = new Date();
  const scored = finalists.map((f) => {
    const fund = fundBySym[f.ticker] || {};
    const ov = ovBySym[f.ticker] || {};
    const pe = num(fund.pe_ratio), pb = num(fund.pb_ratio), divYield = num(fund.dividend_yield);
    const hi52 = num(fund.high_52_weeks), lo52 = num(fund.low_52_weeks);
    const sector = fund.sector || ov.Sector || '—';
    const revGrowth = ov.QuarterlyRevenueGrowthYOY != null ? num(ov.QuarterlyRevenueGrowthYOY) * 100 : null;
    const fwdPE = num(ov.ForwardPE);
    const tech = techScore(f.rsi, f.price, hi52, lo52);
    const fundS = fundScore({ pe, pb, divYield, revGrowth, fwdPE });
    const L = levels(f.price, hi52, lo52);
    const rrScore = L.rr == null ? 4 : clamp(Math.round(L.rr * 2.5), 0, 10);
    const socT = socialMap[f.ticker];
    const social = socialScore(socT);
    const buzz = buzzLabel(socT, social);
    const composite = +(tech * 0.33 + fundS * 0.28 + rrScore * 0.19 + social * 0.20).toFixed(2);
    const pctOffHigh = hi52 && hi52 > 0 ? ((f.price / hi52 - 1) * 100) : null;
    // Per-row data-coverage flags so the dashboard can tell a real score from a "no data → neutral"
    // one: growth = AV supplied revenue-growth/forward-P/E (else value-only); social = ApeWisdom
    // actually tracked this name (else neutral 5); rr = 52wk levels were present for the R/R math.
    const cov = {
      growth: revGrowth != null || fwdPE != null,
      social: !!(socT && socT.tracked),
      rr: L.rr != null,
    };
    return {
      ticker: f.ticker, company: f.name, sector, price: f.price, rsi: Math.round(f.rsi),
      tech, fund: fundS, rrScore, social, buzz, composite, cov,
      revGrowth: revGrowth != null ? fmtPct(revGrowth) : '—',
      fwdPE: fwdPE != null ? fwdPE.toFixed(1) : (pe != null ? pe.toFixed(1) + ' (ttm)' : '—'),
      rr: L.rr != null ? L.rr.toFixed(1) + ':1' : '—',
      flag: fwdPE != null && fwdPE > 100 ? 'Fwd P/E > 100' : revGrowth != null && revGrowth < 0 ? 'Neg Rev Growth' : 'ok',
      _L: L, _pctOffHigh: pctOffHigh, _hi52: hi52, _mcap: f.marketCap,
    };
  }).sort((a, b) => b.composite - a.composite);

  const candidates = scored.slice(0, N_CANDIDATES).map((c, i) => ({
    rank: i + 1, ticker: c.ticker, company: c.company, sector: c.sector, price: c.price, rsi: c.rsi,
    tech: c.tech, revGrowth: c.revGrowth, fwdPE: c.fwdPE, fund: c.fund,
    rr: c.rr, rrScore: c.rrScore, social: c.social, buzz: c.buzz, composite: c.composite, cov: c.cov, flag: c.flag,
  }));

  // Top picks, sector-diversified: walk the composite ranking but cap how many share one sector so a
  // single-sector selloff (which fills the oversold screen) can't make all three picks the same theme.
  // Unknown sectors ("—") aren't capped against each other. Backfill from the ranking if caps fall short.
  const pickRows = diversifyBySector(scored, N_PICKS, MAX_PICKS_PER_SECTOR);
  const picks = pickRows.map((c) => {
    const L = c._L;
    const signal = c.composite >= 7 ? 'BUY' : c.composite >= 5.5 ? 'CAUTIOUS BUY' : 'WATCH';
    const signalClass = signal === 'BUY' ? 'sig-buy' : signal === 'CAUTIOUS BUY' ? 'sig-cautious' : 'sig-watch';
    const mcapB = c._mcap ? (c._mcap / 1e9).toFixed(0) : '—';
    const thesis = [
      `RSI ${c.rsi} — oversold on the daily${c._pctOffHigh != null ? `; trading ${Math.abs(c._pctOffHigh).toFixed(0)}% below its 52-week high` : ''}.`,
      `Large-cap ${c.sector} name (~$${mcapB}B). ${c.revGrowth !== '—' ? `Revenue ${c.revGrowth} YoY, forward P/E ${c.fwdPE}.` : `Trailing P/E ${c.fwdPE}.`}`,
      `Entry $${L.entryLo}–$${L.entryHi} on the pullback; TP1 $${L.tp1} (${fmtPct(L.tp1pct)}), stretch $${L.tp2} (${fmtPct(L.tp2pct)}); stop $${L.stop} (${fmtPct(L.slpct)}).`,
      `Risk/reward ${c.rr}. Mechanical swing setup off the oversold reading — honor the stop; this is a bounce thesis, not a fundamental call.`,
    ];
    return {
      ticker: c.ticker, company: c.company, sector: c.sector, signal, signalClass,
      basePrice: c.price, entry: `$${L.entryLo} – $${L.entryHi}`,
      tp1: { price: L.tp1, pct: fmtPct(L.tp1pct) }, tp2: { price: L.tp2, pct: fmtPct(L.tp2pct) },
      sl: { price: L.stop, pct: fmtPct(L.slpct) }, rr: c.rr,
      confidence: clamp(Math.round(c.composite * 9), 30, 90),
      timeframe: '4–8 weeks', rsi: c.rsi, social: c.social, buzz: c.buzz, composite: c.composite, tvSymbol: c.ticker, thesis,
    };
  });

  const iso = today.toISOString().slice(0, 10);
  return {
    date: today.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
    ts: iso,
    universe: 'S&P 500 / large-cap',
    candidates, picks,
  };
}
