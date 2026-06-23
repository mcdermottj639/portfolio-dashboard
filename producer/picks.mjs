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
// Technical: more oversold = higher. RSI 25→10, 35→~7, 45→~3.
const techScore = (rsi) => clamp(Math.round((52 - rsi) / 2.7), 0, 10);

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

// Social: retail-sentiment sub-score (0–10), centered on a NEUTRAL 5 so untracked names are
// unaffected beyond the weight rescale. Sentiment-weighted (bullish crowd/news lifts, bearish
// drags), amplified by how much real attention a name has (low ApeWisdom rank + rising mentions),
// and crowding-capped so a top-few euphoric name can't score the max on hype alone.
//   t = data.social.tickers[TICKER] | undefined  (fields: tracked, rank, mentionChg, sentiment, news{score})
function socialScore(t) {
  if (!t || t.tracked === false) return 5;                       // no coverage → neutral
  const parts = [];
  if (t.sentiment != null && Number.isFinite(t.sentiment)) parts.push(t.sentiment);
  if (t.news && t.news.score != null && Number.isFinite(t.news.score)) parts.push(t.news.score);
  if (!parts.length) return 5;                                   // tracked but no sentiment → neutral
  const s = parts.reduce((a, b) => a + b, 0) / parts.length;     // [-1, 1]
  const rank = num(t.rank), chg = num(t.mentionChg);
  const rankAmp = rank == null ? 0 : clamp((200 - rank) / 200, 0, 1);   // buzz: low rank = strong
  const velAmp = chg == null ? 0 : clamp(chg / 100, -0.5, 1);           // surging mentions amplify
  const a = clamp(1 + 0.4 * rankAmp + 0.3 * velAmp, 0.6, 1.4);
  let socialS = clamp(5 + s * 3.5 * a, 0, 10);
  if (rank != null && rank <= 5 && s > 0) socialS = Math.min(socialS, 7); // crowding cap (blow-off top)
  return +socialS.toFixed(2);
}
// Short display flag for the picks table.
function buzzLabel(t, social) {
  if (!t || t.tracked === false) return '—';
  if (social >= 7) return 'Bullish buzz';
  if (social <= 3) return 'Bearish buzz';
  if (num(t.rank) != null && num(t.rank) <= 5) return 'Crowded';
  return 'Neutral';
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
    const tech = techScore(f.rsi);
    const fundS = fundScore({ pe, pb, divYield, revGrowth, fwdPE });
    const L = levels(f.price, hi52, lo52);
    const rrScore = L.rr == null ? 4 : clamp(Math.round(L.rr * 2.5), 0, 10);
    const socT = socialMap[f.ticker];
    const social = socialScore(socT);
    const buzz = buzzLabel(socT, social);
    const composite = +(tech * 0.33 + fundS * 0.28 + rrScore * 0.19 + social * 0.20).toFixed(2);
    const pctOffHigh = hi52 && hi52 > 0 ? ((f.price / hi52 - 1) * 100) : null;
    return {
      ticker: f.ticker, company: f.name, sector, price: f.price, rsi: Math.round(f.rsi),
      tech, fund: fundS, rrScore, social, buzz, composite,
      revGrowth: revGrowth != null ? fmtPct(revGrowth) : '—',
      fwdPE: fwdPE != null ? fwdPE.toFixed(1) : (pe != null ? pe.toFixed(1) + ' (ttm)' : '—'),
      rr: L.rr != null ? L.rr.toFixed(1) + ':1' : '—',
      flag: fwdPE != null && fwdPE > 100 ? 'Fwd P/E > 100' : revGrowth != null && revGrowth < 0 ? 'Neg Rev Growth' : 'ok',
      _L: L, _pctOffHigh: pctOffHigh, _hi52: hi52, _mcap: f.marketCap,
    };
  }).sort((a, b) => b.composite - a.composite);

  const candidates = scored.slice(0, N_CANDIDATES).map((c, i) => ({
    rank: i + 1, ticker: c.ticker, company: c.company, price: c.price, rsi: c.rsi,
    tech: c.tech, revGrowth: c.revGrowth, fwdPE: c.fwdPE, fund: c.fund,
    rr: c.rr, rrScore: c.rrScore, social: c.social, buzz: c.buzz, composite: c.composite, flag: c.flag,
  }));

  const picks = scored.slice(0, N_PICKS).map((c) => {
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
