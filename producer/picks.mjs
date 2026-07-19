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

// Momentum / trend gate. The oversold screen surfaces two very different things: a healthy name in a
// normal PULLBACK (a buy-the-dip setup) and a structurally BROKEN name in a confirmed DOWNTREND (a
// falling knife the deep-research target explicitly AVOIDS — e.g. ORCL 63% below its high, "momentum
// 1/10"). techScore actually REWARDS being deep in the 52wk range (more reversion room), so WITHOUT
// this gate a broken downtrend can top the board and then get fed straight into the Action Center's
// redeploy sleeve (which deploys into the top picks). We read trend from AV's 50/200-day moving
// averages when present — price < 200-DMA AND 50-DMA < 200-DMA is a confirmed downtrend — else fall
// back to distance below the 52-week high (>50% off the high = broken, not merely dipping; a normal
// oversold pullback sits nearer its high). A confirmed downtrend is DISQUALIFIED from the highlighted
// top picks (buildPicks filters it out of picks[]) and docked DOWNTREND_PENALTY composite points so it
// also sinks in the candidates table. Milder pullbacks are untouched.
export const DOWNTREND_PENALTY = 3.0;   // composite points docked from a confirmed-downtrend name
export function trendGate({ price, sma50, sma200, pctOffHigh }) {
  if (price != null && sma50 != null && sma200 != null && sma200 > 0) {   // primary: MA structure (AV)
    if (price < sma200 && sma50 < sma200) return { downtrend: true, reason: 'below 200-DMA · 50 < 200-DMA' };
    return { downtrend: false, reason: '' };
  }
  if (pctOffHigh != null && pctOffHigh <= -50)                            // fallback: distance off 52wk high
    return { downtrend: true, reason: `${Math.abs(Math.round(pctOffHigh))}% below 52wk high` };
  return { downtrend: false, reason: '' };
}

// Recent-stop-out COOLDOWN (the research picks screen). The trend gate filters on trend SHAPE; it caught
// ORCL only because ORCL was ALSO a textbook downtrend. But the engine otherwise has no memory of what it
// just lost on, so it would happily re-surface a name the day after it stopped out — which is exactly how
// ORCL got re-picked ~10 sessions running (June 29–July 13) and stuffed the track record 10×. This gate
// reads the prior snapshot's GRADED pick history and benches any name that stopped out inside the trailing
// window: disqualified from the highlighted picks (like a downtrend) and docked COOLDOWN_PENALTY so it also
// sinks in the candidates table (it stays visible there, flagged "Recent stop-out", as an oversold data
// point). ~10 trading days ≈ 14 calendar days (we work off the scan `ts` calendar date). Pairs with the
// 30-day wash-sale guard on the taxable ••••3900 account (build-data → data.agentic.recentLosses).
export const COOLDOWN_PENALTY = 3.0;          // composite points docked from a recently-stopped name
export const COOLDOWN_TRADING_DAYS = 10;      // "sit out" horizon expressed in trading days (for display)
export const COOLDOWN_CAL_DAYS = 14;          // its calendar-day equivalent (weekends) — what we actually gate on

function shiftISO(iso, days) { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); }
function shortDate(iso) { const d = new Date(iso + 'T00:00:00Z'); return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); }

// Grade one archived pick on a CLOSING basis (a pure mirror of the consumer's gradePick): walk daily
// closes since the scan date — a close ≤ stop is a stop-out, ≥ tp2 wins outright, ≥ tp1 banks then keeps
// watching. bars: [{t,c}] ascending. Returns 'STOPPED' | 'TP1' | 'TP2' | 'OPEN'.
export function gradePickClose(pk, bars, sinceTs) {
  const tp1 = num(pk.tp1), tp2 = num(pk.tp2), sl = num(pk.sl);
  const closes = (bars || [])
    .filter((b) => !sinceTs || String(b.t || b.begins_at || '').slice(0, 10) >= sinceTs)   // accept {t,c} AND raw RH {begins_at,close_price}
    .map((b) => num(b.c ?? b.close_price))
    .filter((c) => c != null && c > 0);
  let status = 'OPEN', hitT1 = false;
  for (const c of closes) {
    if (sl != null && c <= sl) return hitT1 ? 'TP1' : 'STOPPED';
    if (tp2 != null && c >= tp2) return 'TP2';
    if (tp1 != null && c >= tp1) { hitT1 = true; status = 'TP1'; }
  }
  return status;
}

// Build the recent-stop-out cooldown map for the picks screen. Pure: (graded history + bars) → benched set.
//   history:    prior snapshot's data.picks.history — [{ ts:'YYYY-MM-DD', picks:[{ticker,tp1,tp2,sl,...}] }]
//   barsBySym:  { SYM: [{t,c}] }  daily bars (prior snapshot's data.hist.day, coalesced)
//   { asOf }:   today's ISO date; { calDays }: the cooldown window (default COOLDOWN_CAL_DAYS)
// Returns { SYM: { until:'YYYY-MM-DD', date:'YYYY-MM-DD', reason } } for names still inside the window.
export function recentStopCooldown(history, barsBySym = {}, { asOf, calDays = COOLDOWN_CAL_DAYS } = {}) {
  const out = {};
  if (!Array.isArray(history) || !asOf) return out;
  const cutoff = shiftISO(asOf, -calDays);                       // only scans within the trailing window matter
  for (const h of history) {
    const ts = h && h.ts;
    if (!ts || ts < cutoff || ts > asOf) continue;
    for (const pk of (h.picks || [])) {
      const sym = pk && pk.ticker;
      if (!sym) continue;
      if (gradePickClose(pk, barsBySym[sym] || [], ts) !== 'STOPPED') continue;
      const until = shiftISO(ts, calDays);
      if (until <= asOf) continue;                               // cooldown already elapsed
      if (!out[sym] || until > out[sym].until)                   // keep the most-recent stop-out per name
        out[sym] = { until, date: ts, reason: `stopped out ${shortDate(ts)} · cooling ${COOLDOWN_TRADING_DAYS}d` };
    }
  }
  return out;
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
//  cooldown:  { SYM: {until,date,reason} }            (optional — recent stop-outs to bench; see recentStopCooldown)
export function buildPicks(finalists, fundBySym, ovBySym, socialMap = {}, cooldown = {}) {
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
    const pctOffHigh = hi52 && hi52 > 0 ? ((f.price / hi52 - 1) * 100) : null;
    const sma50 = num(ov['50DayMovingAverage']), sma200 = num(ov['200DayMovingAverage']);
    const trend = trendGate({ price: f.price, sma50, sma200, pctOffHigh });
    const cd = cooldown[f.ticker] || null;   // recently stopped out → benched from picks[] + docked below
    // Composite = the documented 33/28/19/20 blend, then a confirmed-downtrend OR recently-stopped name is
    // docked so it sinks in the candidates table (both are also excluded from picks[] below).
    const composite = +clamp(tech * 0.33 + fundS * 0.28 + rrScore * 0.19 + social * 0.20
      - (trend.downtrend ? DOWNTREND_PENALTY : 0) - (cd ? COOLDOWN_PENALTY : 0), 0, 10).toFixed(2);
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
      downtrend: trend.downtrend, trendNote: trend.reason,
      cooldown: !!cd, cooldownNote: cd ? cd.reason : '', cooldownUntil: cd ? cd.until : '',
      revGrowth: revGrowth != null ? fmtPct(revGrowth) : '—',
      fwdPE: fwdPE != null ? fwdPE.toFixed(1) : (pe != null ? pe.toFixed(1) + ' (ttm)' : '—'),
      rr: L.rr != null ? L.rr.toFixed(1) + ':1' : '—',
      flag: trend.downtrend ? 'Downtrend' : cd ? 'Recent stop-out' : fwdPE != null && fwdPE > 100 ? 'Fwd P/E > 100' : revGrowth != null && revGrowth < 0 ? 'Neg Rev Growth' : 'ok',
      _L: L, _pctOffHigh: pctOffHigh, _hi52: hi52, _mcap: f.marketCap,
    };
  }).sort((a, b) => b.composite - a.composite);

  const candidates = scored.slice(0, N_CANDIDATES).map((c, i) => ({
    rank: i + 1, ticker: c.ticker, company: c.company, sector: c.sector, price: c.price, rsi: c.rsi,
    tech: c.tech, revGrowth: c.revGrowth, fwdPE: c.fwdPE, fund: c.fund,
    rr: c.rr, rrScore: c.rrScore, social: c.social, buzz: c.buzz, composite: c.composite, cov: c.cov, flag: c.flag,
    downtrend: c.downtrend, trendNote: c.trendNote,
    cooldown: c.cooldown, cooldownNote: c.cooldownNote, cooldownUntil: c.cooldownUntil,
  }));

  // Top picks, sector-diversified: walk the composite ranking but cap how many share one sector so a
  // single-sector selloff (which fills the oversold screen) can't make all three picks the same theme.
  // Unknown sectors ("—") aren't capped against each other. Backfill from the ranking if caps fall short.
  // Confirmed downtrends (trend gate) AND recently-stopped-out names (cooldown gate) are DISQUALIFIED here —
  // they stay in the candidates table as an oversold data point but never become a highlighted top pick (nor
  // feed the Action Center's sleeve). If that leaves fewer than N_PICKS clean names, we show fewer rather than
  // promote a falling knife or re-emit a name we just lost on.
  const pickRows = diversifyBySector(scored.filter((c) => !c.downtrend && !c.cooldown), N_PICKS, MAX_PICKS_PER_SECTOR);
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
