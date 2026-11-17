// Apex v2.9 PAPER research engine (rules "v2.9-paper-1"). Pure functions + a CLI.
//
// PAPER ONLY. Nothing here is read by ui/apex.js, the live v2.8 targets, tickets or any
// executor. It turns Robinhood market-scanner rows (one row per stock, with the price,
// trend, range and fundamental columns the scan returns) into the published
// data/apex-paper-v29.json that the dashboard's "v2.9 Paper" view reads.
//
// Coverage rule: every row of the eligible universe is scored. The scanner returns at most
// 200 rows per query, so the caller pulls the universe in batches (sector / market-cap
// slices); this module de-duplicates them, checks each batch returned all of its rows
// (rows === total_items) and reports the real count. An incomplete pull is published as
// status "partial" with the actual coverage — never as a complete scan.
//
// Thresholds are the approved v2.9-paper-1 starting points. Never loosen one without
// bumping RULES_VERSION.

export const RULES_VERSION = 'v2.9-paper-1';
export const FILTERS = { minMarketCap: 2e9, minAvgVolume: 500000, minPrice: 10 };
export const C = {
  RR_MIN: 1.5, PE_MAX: 100, EARN_DAYS: 3, TECH_BATCH_MAX: 0.40, PICKS_MAX: 4,
  SECTOR_MAX: 2, SETUP_C_MAX: 2, W_MIN: 8, W_MAX: 20, PICK_BUDGET: 60, LIST_MAX: 25,
};
export const SETUP_LABEL = { A: 'breakout', B: 'pullback', C: 'reversal' };
const TECH_SECTORS = new Set(['Technology', 'Communication Services']);

const num = v => { if (v === '' || v == null) return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export const lin = (v, lo, hi) => clamp((v - lo) / (hi - lo) * 10, 0, 10);
const r2 = v => v == null ? null : Math.round(v * 100) / 100;
const r1 = v => v == null ? null : Math.round(v * 10) / 10;

/** Accepts a bare preview_scan payload, its JSON string, or an MCP envelope ([{type,text}] / {content}). */
export function unwrap(raw) {
  let v = raw;
  for (let i = 0; i < 4; i++) {
    if (typeof v === 'string') { try { v = JSON.parse(v); } catch { return null; } continue; }
    if (Array.isArray(v) && v[0] && typeof v[0].text === 'string') { v = v[0].text; continue; }
    if (v && Array.isArray(v.content)) { v = v.content; continue; }
    break;
  }
  const res = v && v.data && v.data.result ? v.data.result : (v && v.result ? v.result : null);
  if (!res || !Array.isArray(res.results)) return null;
  return { total: num(res.total_items), rows: res.results };
}

/** One scanner row -> the numeric record the rules use. Blank cells stay null (never 0). */
export function parseRow(r) {
  const c = r.columns || {};
  return {
    sym: r.ticker || c.Symbol || null, name: c.Name || null, sector: c.sector || null,
    last: num(c.Last) ?? num(c.px), close: num(c.lastClose),
    sma20: num(c.sma20), sma50: num(c.sma50), sma70: num(c.sma70), sma100: num(c.sma100), sma200: num(c.sma200),
    c63: num(c.c63), c126: num(c.c126), h20: num(c.h20), l20: num(c.l20), h63: num(c.h63), l63: num(c.l63), h126: num(c.h126),
    rsi: num(c.RSI) ?? num(c.rsi14), atr: num(c['Average true range']) ?? num(c.atr14),
    revG: num(c.revG), pe: num(c['P/E']) ?? num(c.pe), fpe: num(c['Forward P/E']) ?? num(c.fpe),
    earn: num(c['Earnings date']) ?? num(c.earn), mcap: num(c['Market cap']) ?? num(c.mcap),
    vol30: num(c['Average volume']) ?? num(c.vol30), dayVol: num(c.Volume),
  };
}

/** Merge batches: de-duplicate by ticker, and say honestly whether every batch came back whole. */
export function mergeBatches(batches) {
  const seen = new Map(); let dup = 0; const meta = []; let complete = true; let eligible = 0;
  for (const b of batches) {
    const u = unwrap(b.payload);
    if (!u) { meta.push({ label: b.label, total: null, rows: 0, error: 'unreadable' }); complete = false; continue; }
    const whole = u.total != null && u.rows.length === u.total;
    if (!whole) complete = false;
    eligible += u.total ?? u.rows.length;
    meta.push({ label: b.label, total: u.total, rows: u.rows.length });
    for (const raw of u.rows) {
      const p = parseRow(raw); if (!p.sym) continue;
      if (seen.has(p.sym)) { dup++; continue; }
      seen.set(p.sym, p);
    }
  }
  return { rows: [...seen.values()], duplicatesRemoved: dup, batches: meta, complete, eligibleReported: eligible };
}

function ymdToDate(ymd) { if (ymd == null) return null; const s = String(Math.round(ymd)); if (s.length !== 8) return null; return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`; }
/** Weekdays from `from` (exclusive) to `to` (inclusive); negative when `to` is earlier. Market holidays are not modelled. */
export function tradingDaysBetween(from, to) {
  const a = new Date(from + 'T12:00:00Z'), b = new Date(to + 'T12:00:00Z');
  if (!(a < b)) return a.getTime() === b.getTime() ? 0 : -1;
  let n = 0; const d = new Date(a);
  while (d < b) { d.setUTCDate(d.getUTCDate() + 1); const w = d.getUTCDay(); if (w !== 0 && w !== 6) n++; }
  return n;
}

export function fundamentalScore(g, pe) {
  if (g == null) return 5;
  if (g < 0) return 2;
  if (pe == null || pe <= 0) return g > 10 ? 5 : 3;
  if (pe > 80) return 3;
  if (g < 5) return 3;
  if (g < 10) return 5.5;
  if (pe >= 60) return g > 20 ? 6 : 5.5;
  if (g > 20) return pe < 40 ? 9.5 : 8;
  return 7.5;
}
export function rrPoints(rr) {
  if (rr == null) return null;
  if (rr >= 3) return 9.5;
  if (rr >= 2) return 6 + (rr - 2) * 2;
  if (rr >= 1.5) return 4 + (rr - 1.5) * 2;
  return 1 + clamp(rr, 0, 1.5) / 1.5 * 2;
}

/** Which of the three approved setups a row matches on price structure (null = none). */
export function setupOf(p) {
  const { last: px, sma20, sma50, sma200, rsi } = p;
  if ([px, sma20, sma50, sma200, rsi].some(v => v == null)) return null;
  if (px > sma200 && px > sma50 && rsi >= 55 && rsi <= 75) return 'A';
  if (px > sma200 && sma50 > sma200 && px < sma20 * 1.01 && rsi >= 35 && rsi <= 55) return 'B';
  if (px < sma200 && px > sma50 && sma20 > sma50 && rsi >= 50 && rsi <= 70) return 'C';
  return null;
}

/** Score one row. bench = {last, c63, c126} for SPY. opts: {today, themeMap, checks:{SYM:{improving,tradable}}}. */
export function scoreRow(p, bench, opts = {}) {
  const px = p.last, setup = setupOf(p);
  const out = { sym: p.sym, name: p.name, sector: p.sector, setup, setupLabel: setup ? SETUP_LABEL[setup] : null };
  const tm = opts.themeMap || {};
  const mapped = typeof tm[p.sym] === 'string' ? tm[p.sym].toLowerCase() : null;
  out.theme = (mapped && /tech|ai|cyber|semi|software/.test(mapped)) || !p.sector || TECH_SECTORS.has(p.sector) ? 'tech' : p.sector;
  if (px == null) return { ...out, composite: null, fails: ['no price'], noData: true };

  // Momentum (40%): relative strength 6m / 3m vs SPY, trend, proximity to the 6-month high.
  const spy3 = bench && bench.last && bench.c63 ? (bench.last / bench.c63 - 1) * 100 : null;
  const spy6 = bench && bench.last && bench.c126 ? (bench.last / bench.c126 - 1) * 100 : null;
  const rs3 = p.c63 && spy3 != null ? (px / p.c63 - 1) * 100 - spy3 : null;
  const rs6 = p.c126 && spy6 != null ? (px / p.c126 - 1) * 100 - spy6 : null;
  // SMA50 as it stood 20 sessions ago, from the 70- and 20-day averages: (70*SMA70 - 20*SMA20) / 50.
  const sma50Prev = p.sma70 != null && p.sma20 != null ? (70 * p.sma70 - 20 * p.sma20) / 50 : null;
  const slope = sma50Prev && p.sma50 ? (p.sma50 / sma50Prev - 1) * 100 : null;
  const tparts = [
    p.sma50 ? [0.45, lin((px / p.sma50 - 1) * 100, -12, 12)] : null,
    p.sma50 && p.sma100 ? [0.35, lin((p.sma50 / p.sma100 - 1) * 100, -8, 8)] : null,
    slope != null ? [0.20, lin(slope, -6, 6)] : null,
  ].filter(Boolean);
  const trend = tparts.length ? tparts.reduce((s, [w, v]) => s + w * v, 0) / tparts.reduce((s, [w]) => s + w, 0) : null;
  const offHigh = p.h126 ? (px / p.h126 - 1) * 100 : null;
  const mparts = [
    rs6 != null ? [0.30, lin(rs6, -20, 30)] : null, rs3 != null ? [0.25, lin(rs3, -15, 20)] : null,
    trend != null ? [0.25, trend] : null, offHigh != null ? [0.20, lin(offHigh, -45, 0)] : null,
  ].filter(Boolean);
  const M = mparts.length >= 2 ? mparts.reduce((s, [w, v]) => s + w * v, 0) / mparts.reduce((s, [w]) => s + w, 0) : null;

  // Fundamental (35%).
  const g = p.revG == null ? null : p.revG * 100;
  const F = fundamentalScore(g, p.pe);

  // Reward / risk at entry (25%).
  const atr = p.atr;
  let entry = px * 1.003, entryType = 'limit';
  const breakout = setup === 'A' && p.h20 && p.l20 && px >= p.h20 * 0.97 && (p.h20 - p.l20) <= 0.12 * px;
  if (breakout) { entry = p.h20 * 1.005 * 1.01; entryType = 'buy-stop-limit'; }
  let tp1 = null, tp1Basis = null, stop = null, stopBasis = null, rr = null;
  if (atr) {
    if (p.h63 && p.h63 > entry) { tp1 = p.h63; tp1Basis = '3-month high'; } else { tp1 = entry + 2 * atr; tp1Basis = 'entry + 2xATR (no resistance above)'; }
    const cands = [[p.sma50, '50-day average'], [entry - 2 * atr, 'entry - 2xATR'], [p.l63, '3-month low']]
      .filter(([v]) => v != null && v <= entry - atr).sort((a, b) => b[0] - a[0]);
    if (cands.length) { stop = cands[0][0]; stopBasis = cands[0][1]; } else { stop = entry - 2 * atr; stopBasis = 'entry - 2xATR'; }
    rr = (tp1 - entry) / (entry - stop);
  }
  const R = rrPoints(rr);
  const composite = M != null && R != null ? 0.40 * M + 0.35 * F + 0.25 * R : null;

  // Qualification. Each failed test is named; nothing is waived.
  const fails = [], unlock = [], keys = [];
  const fail = (k, f, u) => { keys.push(k); fails.push(f); if (u) unlock.push(u); };
  if (p.sym === (opts.core || 'IREN')) fail('owner-managed', 'owner-managed core: never a paper pick or a proposed sale');
  if (!setup) fail('no-setup', 'matches none of the three setups');
  if (rr == null) fail('no-levels', 'ATR missing: no stop/target');
  else if (rr < C.RR_MIN) {
    const need = (tp1 + C.RR_MIN * stop) / (1 + C.RR_MIN);
    fail('rr', `R/R ${rr.toFixed(2)} under ${C.RR_MIN}`, `entry at $${need.toFixed(2)} (${((need / px - 1) * 100).toFixed(1)}% from last) with target and stop held`);
  }
  if (p.pe != null && p.pe > C.PE_MAX) fail('pe', `P/E ${p.pe.toFixed(0)} over ${C.PE_MAX}`, `P/E at or under ${C.PE_MAX}`);
  if (g == null) fail('growth-unknown', 'revenue growth not reported by the feed (fails closed)', 'a reported revenue-growth figure');
  else if (g < 0) fail('growth-neg', `revenue growth ${g.toFixed(1)}% negative`, 'revenue growth back above 0%');
  const earnDate = ymdToDate(p.earn);
  if (earnDate && opts.today) {
    const d = tradingDaysBetween(opts.today, earnDate);
    if (d >= 0 && d <= C.EARN_DAYS) fail('earnings', `earnings ${earnDate} inside ${C.EARN_DAYS} trading days`, `after the ${earnDate} report`);
  }
  if (setup === 'A') {
    if (rs3 == null || rs3 <= 0) fail('rs3', `3-month return ${rs3 == null ? 'unknown' : rs3.toFixed(1) + 'pp'} vs SPY not positive`, '3-month return ahead of SPY');
    const nearHigh = p.h63 && px >= p.h63 * 0.95;
    if (!nearHigh && !breakout) fail('not-near-high', `${p.h63 ? ((px / p.h63 - 1) * 100).toFixed(1) : '?'}% off the 3-month high`, p.h63 ? `price at or above $${(p.h63 * 0.95).toFixed(2)}` : null);
  } else if (setup === 'B') {
    if (atr && p.sma20 && px > p.sma20 + 0.5 * atr) fail('not-pulled-back', 'not pulled back to the 20-day', `price at or under $${(p.sma20 + 0.5 * atr).toFixed(2)}`);
    if (g != null && g >= 0 && g < 10) fail('growth-low', `revenue growth ${g.toFixed(1)}%: pullback needs 10%`, 'revenue growth of 10% or more');
    if (trend == null || trend < 5) fail('trend', `trend score ${trend == null ? 'unknown' : trend.toFixed(1)}: pullback needs 5`, 'trend score of 5 or more');
  } else if (setup === 'C') {
    if (slope == null || slope <= 0) fail('slope', '50-day average not rising', '50-day average rising over 20 sessions');
    if (!p.l63 || px < p.l63 * 1.15) fail('off-low', 'under 15% above the 3-month low', p.l63 ? `price at or above $${(p.l63 * 1.15).toFixed(2)}` : null);
    if (rs3 == null || rs3 <= 0) fail('rs3', '3-month return vs SPY not positive', '3-month return ahead of SPY');
    const chk = opts.checks && opts.checks[p.sym];
    if (!chk || chk.improving == null) fail('growth-trend-unchecked', 'quarter-over-quarter growth trend not verified (fails closed)', 'latest quarter growth at or above the prior quarter');
    else if (!chk.improving) fail('growth-not-improving', 'growth not improving vs the prior quarter', 'latest quarter growth at or above the prior quarter');
  }
  const chk = opts.checks && opts.checks[p.sym];
  if (chk && chk.tradable === false) fail('not-tradable', 'not buyable on Robinhood', null);

  return {
    ...out, composite: r2(composite), momentum: r1(M), fundamental: r1(F), rrScore: r1(R), rr: r2(rr),
    last: r2(px), entry: r2(entry), entryType, stop: r2(stop), stopBasis, tp1: r2(tp1), tp1Basis,
    atr: r2(atr), rsi: r1(p.rsi), rs3: r1(rs3), rs6: r1(rs6), trend: r1(trend),
    relVol: p.dayVol && p.vol30 ? r2(p.dayVol / p.vol30) : null,
    revGrowthPct: r1(g), pe: r1(p.pe), peType: 'trailing', marketCapB: p.mcap ? r1(p.mcap / 1e9) : null,
    earningsDate: earnDate, halfSize: setup === 'C', fails, failKeys: keys, unlock: unlock.filter(Boolean).join('; '),
    why: setup ? `${SETUP_LABEL[setup]}: momentum ${M == null ? 'n/a' : M.toFixed(1)}, growth ${g == null ? 'n/a' : g.toFixed(0) + '%'}, R/R ${rr == null ? 'n/a' : rr.toFixed(2)}` : null,
  };
}

const REJ_LABEL = {
  'owner-managed': 'Owner-managed core (IREN)', 'no-setup': 'No setup (not a breakout, pullback or reversal)', rr: 'Reward/risk under 1.5 at entry', pe: 'P/E over 100',
  'growth-unknown': 'Revenue growth not reported', 'growth-neg': 'Revenue growth negative', 'growth-low': 'Pullback: growth under 10%',
  earnings: 'Earnings inside 3 trading days', rs3: 'Not ahead of SPY over 3 months', 'not-near-high': 'Breakout: too far below 3-month high',
  'not-pulled-back': 'Pullback: not at the 20-day yet', trend: 'Pullback: trend score under 5', slope: 'Reversal: 50-day not rising',
  'off-low': 'Reversal: under 15% above 3-month low', 'growth-trend-unchecked': 'Reversal: growth trend not verified',
  'growth-not-improving': 'Reversal: growth not improving', 'not-tradable': 'Not buyable on Robinhood', 'no-levels': 'No ATR: no stop/target',
};

/** Indicative Monday batch from the qualified list: top by score, max 2 a sector, max 2 reversals, tech <= 40% of the batch. */
export function buildBatch(qualified, vols) {
  const picks = [], blocked = []; const bySector = {}; let nC = 0;
  for (const q of qualified) {
    if (picks.length >= C.PICKS_MAX) break;
    if ((bySector[q.sector] || 0) >= C.SECTOR_MAX) { blocked.push({ sym: q.sym, reason: `sector limit (${C.SECTOR_MAX} per sector)` }); continue; }
    if (q.setup === 'C' && nC >= C.SETUP_C_MAX) { blocked.push({ sym: q.sym, reason: 'reversal limit (2 per batch)' }); continue; }
    bySector[q.sector] = (bySector[q.sector] || 0) + 1; if (q.setup === 'C') nC++;
    picks.push(q);
  }
  // Size by score / volatility (ATR as % of price stands in for 60-day realized vol until Monday's run).
  const haveVol = !!vols && picks.every(q => vols[q.sym] > 0);
  let w = picks.map(q => q.composite / (haveVol ? vols[q.sym] : Math.max(0.5, (q.atr / q.last) * 100)));
  const norm = () => { const s = w.reduce((a, b) => a + b, 0); w = s ? w.map(x => x / s * C.PICK_BUDGET) : w; };
  norm(); w = w.map(x => clamp(x, C.W_MIN, C.W_MAX));
  w = w.map((x, i) => picks[i].setup === 'C' ? x * 0.5 : x);
  const out = picks.map((q, i) => ({ sym: q.sym, theme: q.theme, weightPct: w[i] }));
  // Tech batch rule: tech picks hold at most 40% of the batch's picked weight; scale tech down only.
  const tot = () => out.reduce((s, o) => s + o.weightPct, 0);
  const tech = () => out.filter(o => o.theme === 'tech').reduce((s, o) => s + o.weightPct, 0);
  for (let guard = 0; guard < 6 && tot() > 0 && tech() / tot() > C.TECH_BATCH_MAX + 1e-9; guard++) {
    const other = tot() - tech(); const cap = other * C.TECH_BATCH_MAX / (1 - C.TECH_BATCH_MAX); const k = tech() ? cap / tech() : 0;
    for (const o of out) if (o.theme === 'tech') o.weightPct *= k;
    for (let i = out.length - 1; i >= 0; i--) if (out[i].theme === 'tech' && out[i].weightPct < C.W_MIN) {
      blocked.unshift({ sym: out[i].sym, reason: 'tech batch rule: tech may hold at most 40% of the batch' }); out.splice(i, 1);
    }
  }
  const total = tot();
  return {
    picks: out.map(o => ({ sym: o.sym, weightPct: r1(o.weightPct) })), blocked,
    techBatchPct: total ? r1(tech() / total * 100) : null, cashPct: r1(Math.max(0, 100 - total)), sizedBy: haveVol ? '60-day realized volatility' : 'ATR stand-in',
  };
}

/** Whole run -> the published document. */
/** Marks are stamped once and never recomputed: a mark already stored for (cohort, sym, horizon) wins. */
export function mergeMarks(prior, add) {
  const key = m => `${m.asOf}|${m.sym}|${m.horizon}`; const have = new Set((prior || []).map(key)); const out = [...(prior || [])];
  for (const m of add || []) if (m && m.asOf && m.sym && m.horizon && !have.has(key(m))) { have.add(key(m)); out.push(m); }
  return out;
}
/** Descriptive record per horizon, built only from stored marks. */
export function metricsOf(marks) {
  const by = {};
  for (const m of marks || []) { if (m.alpha == null) continue; (by[m.horizon] = by[m.horizon] || []).push(m.alpha); }
  const out = {};
  for (const [h, a] of Object.entries(by)) out[h] = { n: a.length, hit: r2(a.filter(x => x > 0).length / a.length), avgAlpha: r2(a.reduce((s, x) => s + x, 0) / a.length) };
  return out;
}

export function build({ batches, bench, today, asOf, nextRun, themeMap, checks, v28, prior, backtest, quoteBasis, extraNotes = [], sources = [], cohort = false, vols = null, fills = null, newMarks = null }) {
  const m = mergeBatches(batches);
  const scored = m.rows.map(p => scoreRow(p, bench, { today, themeMap, checks }));
  const setupMatches = { A: 0, B: 0, C: 0, none: 0 }; const rej = {};
  for (const s of scored) {
    setupMatches[s.setup || 'none']++;
    for (const k of s.failKeys || []) rej[k] = (rej[k] || 0) + 1;
  }
  const withSetup = scored.filter(s => s.setup && s.composite != null);
  const byScore = (a, b) => b.composite - a.composite || (a.sym < b.sym ? -1 : 1);
  const qualified = withSetup.filter(s => s.fails.length === 0).sort(byScore);
  const near = withSetup.filter(s => s.fails.length === 1).sort(byScore);
  const emerging = withSetup.filter(s => s.fails.length === 2 && s.composite >= 6).sort(byScore);
  const batch = buildBatch(qualified, vols);
  const pickSet = new Set(batch.picks.map(p => p.sym)); const blk = Object.fromEntries(batch.blocked.map(b => [b.sym, b.reason]));
  const strip = ({ failKeys, noData, trend, ...r }) => r;
  qualified.forEach((q, i) => {
    q.rank = i + 1;
    if (pickSet.has(q.sym)) { q.status = 'buy'; q.statusReason = 'paper buy candidate for the next Monday batch (paper only; not an order)'; }
    else if (blk[q.sym]) { q.status = 'blocked'; q.statusReason = `valid candidate, blocked by a batch limit: ${blk[q.sym]}`; }
    else { q.status = 'watch'; q.statusReason = `valid candidate; ranks below the ${C.PICKS_MAX}-slot paper batch`; }
    q.unlock = q.status === 'buy' ? 'joins the Monday paper batch if it still ranks' : q.status === 'blocked' ? 'a slot inside the limit in a later Monday batch' : `a top-${C.PICKS_MAX} score on a Monday`;
  });
  near.forEach((q, i) => { q.rank = i + 1; q.status = 'watch'; q.statusReason = `one test short: ${q.fails[0]}`; });
  emerging.forEach((q, i) => { q.rank = i + 1; q.status = 'watch'; q.statusReason = `two tests short: ${q.fails.join('; ')}`; });
  const count = (list) => list.reduce((o, s) => { const k = s.sector || 'Unclassified'; o[k] = (o[k] || 0) + 1; return o; }, {});
  const status = m.complete && bench && bench.last ? 'ok' : 'partial';
  // Cohort log. A cohort is frozen only on a complete Monday run, once per date; old cohorts are never edited
  // except to record a pending pick's paper fill.
  const cohorts = ((prior && prior.cohorts) || []).map(c => ({ ...c, picks: (c.picks || []).map(p => {
    const f = fills && fills[c.asOf] && fills[c.asOf][p.sym];
    return f && p.status === 'pending' ? { ...p, entryPx: f.entryPx ?? p.entryPx, entryDate: f.entryDate ?? p.entryDate, status: f.status || p.status } : p;
  }) }));
  let frozen = false;
  if (cohort && status === 'ok' && today && !cohorts.some(c => String(c.asOf).slice(0, 10) === today)) {
    const bySym = Object.fromEntries(qualified.map(q => [q.sym, q]));
    cohorts.push({
      asOf, rulesVersion: RULES_VERSION, spyAt: bench.last, universeCount: scored.length, qualifiedCount: qualified.length, techBatchPct: batch.techBatchPct, sizedBy: batch.sizedBy,
      picks: batch.picks.map(p => ({ sym: p.sym, w: p.weightPct, setup: bySym[p.sym].setup, theme: bySym[p.sym].theme, entryRule: bySym[p.sym].entryType === 'limit' ? 'next session open' : `trigger $${bySym[p.sym].entry}`, entryPx: null, entryDate: null, status: 'pending' })),
    });
    frozen = true;
  } else if (cohort && today && cohorts.some(c => String(c.asOf).slice(0, 10) === today)) frozen = true;
  const marks = mergeMarks(prior && prior.marks, newMarks);
  const bad = m.batches.filter(b => b.total == null || b.rows !== b.total);
  const doc = {
    schema: 1, paper: true, rulesVersion: RULES_VERSION, asOf, status,
    statusNote: status === 'ok' ? null : (bad.length ? `${bad.length} of ${m.batches.length} scanner batches came back short or unreadable: ${bad.map(b => `${b.label} ${b.rows}/${b.total ?? '?'}`).join(', ')}` : 'SPY benchmark missing'),
    lastSuccessAsOf: status === 'ok' ? asOf : (prior && prior.lastSuccessAsOf) || null, nextRun: nextRun || null, quoteBasis: quoteBasis || null,
    universe: {
      eligible: m.eligibleReported - m.duplicatesRemoved, scanned: scored.length, unique: scored.length, duplicatesRemoved: m.duplicatesRemoved,
      complete: m.complete, batches: m.batches, bySector: count(scored), filters: FILTERS,
      coverageNote: m.complete
        ? `All ${m.batches.length} scanner batches returned every row they reported (rows = total in each), so the whole eligible universe was scored. Stocks with no sector label in the feed are not reachable by the sector-sliced pull and are not counted.`
        : 'Coverage is partial: at least one scanner batch returned fewer rows than it reported. Counts below cover only the rows received.',
    },
    funnel: { setupMatches, qualified: qualified.length, near: near.length, emerging: emerging.length, rejected: scored.length - qualified.length },
    rejections: Object.entries(rej).map(([key, count]) => ({ key, label: REJ_LABEL[key] || key, count })).sort((a, b) => b.count - a.count),
    ranked: { qualified: qualified.map(strip), near: near.slice(0, C.LIST_MAX).map(strip), emerging: emerging.slice(0, C.LIST_MAX).map(strip) },
    batch: {
      asOf, indicative: !frozen, ...batch,
      note: frozen ? 'This Monday\'s paper batch, frozen as a cohort. Paper only: plain-limit picks enter at the next session\'s open.' : 'Indicative only: what the Monday paper batch would hold if it were picked from today\'s list. The real paper cohort is frozen each Monday and sized with 60-day realized volatility; today\'s weights use ATR as a stand-in.',
    },
    sectors: { universe: count(scored), qualified: count(qualified), near: count(near) },
    concentration: {
      techBatchPct: batch.techBatchPct, v28TechOutsideCorePct: v28 && v28.themeCap && v28.themeCap.current != null ? v28.themeCap.current : null,
      note: 'Tech share of this paper batch vs the 40% batch rule. The live v2.8 figure is tech as a share of the stock held outside the owner-managed core.',
    },
    v28: v28 ? { asOf: v28.asOf || null, rulesVersion: v28.rulesVersion || null, universe: v28.universeCount ?? null, passed: v28.gatedCount ?? null, actionable: Object.keys(v28.targets || {}), targets: v28.targets || {} } : null,
    cohorts, marks, metrics: metricsOf(marks),
    cohortNote: cohorts.length ? `${cohorts.length} Monday cohort(s) logged; descriptive only until 12 exist. Review, not verdict.` : 'No paper cohort yet. The first one is frozen on the next Monday run; results stay descriptive until 12 Monday cohorts exist.',
    backtest: backtest || (prior && prior.backtest) || null,
    notes: [
      'PAPER ONLY. No ticket, alert, order or live rule reads this file. Live Apex stays on rules v2.8.',
      'Thresholds are the approved v2.9-paper-1 starting points under test; none was loosened to produce picks.',
      'Scores come from Robinhood scanner columns for every stock in the universe: price, 20/50/70/100/200-day averages, 3- and 6-month closes and ranges, RSI-14, ATR-14, latest-quarter revenue growth (year over year), trailing P/E, next earnings date.',
      'Revenue growth is the latest reported quarter vs the same quarter a year earlier. A stock with no figure fails closed.',
      'A reversal (setup C) also needs growth improving quarter over quarter; that is checked from company financials only for names that pass every other test, and fails closed when unchecked.',
      'The earnings window counts weekdays; market holidays are not modelled.',
      'Near and Emerging lists show the top 25 by score; the funnel carries the full counts.',
      ...extraNotes,
    ],
    sources,
  };
  return doc;
}

/** A run that could not produce research: keep the last good content, but say plainly that this run failed. */
export function markFailed(prior, asOf, reason, nextRun) {
  const base = prior && typeof prior === 'object' ? prior : { schema: 1, paper: true, rulesVersion: RULES_VERSION, ranked: { qualified: [], near: [], emerging: [] }, cohorts: [], marks: [], metrics: {}, notes: [], sources: [] };
  const lastSuccessAsOf = base.status === 'ok' ? base.asOf : (base.lastSuccessAsOf || null);
  return { ...base, status: 'failed', asOf, statusNote: String(reason || 'run failed').slice(0, 300), lastSuccessAsOf, nextRun: nextRun || base.nextRun || null };
}

// ---- CLI: node producer/apex-paper.mjs --in <dir> --spy last,c63,c126 --asof ISO --next ISO [--checks file] [--out file]
if (import.meta.url === `file://${process.argv[1]}`) {
  const fs = await import('node:fs'); const path = await import('node:path');
  const arg = k => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : null; };
  const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
  const dir = arg('in'); const out = arg('out') || path.join(root, 'data/apex-paper-v29.json');
  if (process.argv.includes('--print-batches')) {
    // Prints one JSON line per batch: {label, filters, columns} exactly as preview_scan takes them, then the SPY benchmark call.
    const spec = JSON.parse(fs.readFileSync(path.join(root, 'producer/apex-paper-scan.json'), 'utf8')); const u = spec.universe;
    for (const b of spec.batches) {
      const [lo, hi] = b.cap || [u.minMarketCap, null];
      const cap = hi ? { filter_type: 'FILTER_TYPE_MARKET_CAP', predicate: 'PREDICATE_BETWEEN', values: [String(lo), String(hi)] } : { filter_type: 'FILTER_TYPE_MARKET_CAP', predicate: 'PREDICATE_GREATER_THAN_OR_EQUAL', values: [String(lo)] };
      console.log(JSON.stringify({ label: b.label, filters: [
        { filter_type: 'FILTER_TYPE_INSTRUMENT_TYPE', predicate: 'PREDICATE_EQUAL', values: [u.instrumentType] }, cap,
        { filter_type: 'FILTER_TYPE_AVERAGE_VOLUME', predicate: 'PREDICATE_GREATER_THAN_OR_EQUAL', values: [String(u.minAvgVolume30d)], interval: '1d', length: 30 },
        { filter_type: 'FILTER_TYPE_LAST', predicate: 'PREDICATE_GREATER_THAN_OR_EQUAL', values: [String(u.minLast)] },
        { expression: 'fundamental.morningstarSectorLabel', predicate: 'PREDICATE_ANY_OF', values: b.sectors }], columns: spec.columns }));
    }
    console.log(JSON.stringify({ label: 'bench', filters: [{ expression: 'symbol', predicate: 'PREDICATE_ANY_OF', values: spec.bench }], columns: spec.columns }));
    process.exit(0);
  }
  if (arg('fail')) {
    if (!arg('asof')) { console.error('--fail needs --asof'); process.exit(2); }
    const doc = markFailed((() => { try { return JSON.parse(fs.readFileSync(out, 'utf8')); } catch { return null; } })(), arg('asof'), arg('fail'), arg('next'));
    fs.writeFileSync(out, JSON.stringify(doc, null, 1) + '\n'); console.log(JSON.stringify({ status: 'failed', lastSuccessAsOf: doc.lastSuccessAsOf })); process.exit(0);
  }
  if (!dir || !arg('spy') || !arg('asof')) { console.error('usage: --in <dir of saved preview_scan results> --spy last,c63,c126 --asof <ISO> [--next ISO] [--checks file] [--backtest file] [--note text] [--out file]'); process.exit(2); }
  const files = fs.readdirSync(dir).filter(f => /\.(json|txt)$/.test(f)).sort();
  const batches = files.map(f => ({ label: f.replace(/\.(json|txt)$/, ''), payload: fs.readFileSync(path.join(dir, f), 'utf8') }));
  const [last, c63, c126] = arg('spy').split(',').map(Number);
  const rd = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
  const v28 = rd(path.join(root, 'data/apex-targets.json')); const prior = rd(out);
  const asOf = arg('asof');
  const doc = build({
    batches, bench: { last, c63, c126 }, today: asOf.slice(0, 10), asOf, nextRun: arg('next'), themeMap: v28 && v28.themeMap,
    checks: arg('checks') ? rd(arg('checks')) : null, v28, prior, backtest: arg('backtest') ? rd(arg('backtest')) : null,
    cohort: process.argv.includes('--cohort'), vols: arg('vols') ? rd(arg('vols')) : null, fills: arg('fills') ? rd(arg('fills')) : null, newMarks: arg('marks') ? rd(arg('marks')) : null,
    quoteBasis: arg('quote') || 'Robinhood scanner last trade at the time of the run',
    extraNotes: arg('note') ? [arg('note')] : [],
    sources: [`Robinhood market scanner (preview_scan), ${files.length} batches, ${asOf}`, 'SPY benchmark from the same scanner', 'data/apex-targets.json (live v2.8 result, read-only)'],
  });
  if (doc.universe.scanned === 0) { console.error('APEX_PAPER_UNREADABLE: no scanner rows parsed; the previous file is left in place'); process.exit(3); }
  fs.writeFileSync(out, JSON.stringify(doc, null, 1) + '\n');
  console.log(JSON.stringify({ status: doc.status, eligible: doc.universe.eligible, scanned: doc.universe.scanned, dup: doc.universe.duplicatesRemoved, setups: doc.funnel.setupMatches, qualified: doc.ranked.qualified.map(q => `${q.sym}:${q.setup}:${q.composite}`), near: doc.funnel.near, emerging: doc.funnel.emerging, batch: doc.batch.picks, blocked: doc.batch.blocked.length, statusNote: doc.statusNote }));
}
