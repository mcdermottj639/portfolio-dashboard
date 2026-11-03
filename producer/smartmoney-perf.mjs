// producer/smartmoney-perf.mjs — Smart Money scorecard (v175). PURE (no I/O), unit-tested.
//
// Question it answers: "of the people whose trades we track, who is actually good?" — measured the only
// honest way our data allows:
//
//   • FROM THE DAY WE FIRST SAW THE REPORT, not from the trade date. Congressional reports carry no
//     price and arrive weeks to months late, and we have no historical candles on our keys. The price on
//     the day a report reached the snapshot is also the best price a follower could actually have got —
//     so "since report" is the copyable return, which is the one that matters for "should I follow them".
//   • AGAINST SPY over the same window, signed by side: a BUY scores (stock − SPY); a SELL scores
//     (SPY − stock) — selling before a stock lags the market was the right call.
//   • Insider Form 4 rows also carry the real transaction price, so they get a second figure: since the
//     trade itself (stock only — SPY on the trade day is unknown).
//
// Marks are forward-only: an event's entry is the first quote we hold on/after the day it was first seen,
// and the date is recorded. History therefore starts on the day this shipped; nothing is back-filled or
// estimated. Every number carries its sample size, and people below MIN_SCORED are labelled, not ranked.
// Display-only — feeds no score, target, order or alert.

export const PERF_RETENTION_DAYS = 400;  // keep a trade's mark ~13 months, well past polEvents' 120d window
export const PERF_MAX_TRADES = 900;      // snapshot size guard (~150 B each)
export const MIN_SCORED = 5;             // fewer marked trades than this → "too few to judge"
export const MIN_AGE_DAYS = 5;           // a mark younger than this is shown but not counted in a score

const DAY = 86400000;
const isDay = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v.slice(0, 10));
const d10 = (v) => (isDay(v) ? v.slice(0, 10) : null);
const days = (a, b) => Math.round((Date.parse(a) - Date.parse(b)) / DAY);
const num = (v) => { if (v === null || v === undefined || v === '') return null; const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null; };
const r4 = (v) => Math.round(v * 10000) / 10000;
const up = (v) => String(v || '').toUpperCase().trim();

// Every event we track, normalized to one shape. Same identity rules as the Smart Money UI model, so a
// scorecard row and a feed card always agree on "who" and "which trade".
export function trackedEvents(flow) {
  const out = [];
  for (const e of (flow && Array.isArray(flow.polEvents) ? flow.polEvents : [])) {
    if (!e || !e.sym || !e.filer || (e.side !== 'buy' && e.side !== 'sell') || !d10(e.txn)) continue;
    const filer = up(e.filer);
    out.push({ id: `pol|${filer}|${up(e.sym)}|${e.side}|${d10(e.txn)}`, who: `pol|${filer}`, kind: 'politician',
      sym: up(e.sym), side: e.side, txn: d10(e.txn), reported: d10(e.disc), tradePx: null });
  }
  const syms = (flow && flow.symbols) || {};
  for (const k of Object.keys(syms)) {
    const s = up((syms[k] && syms[k].sym) || k);
    for (const r of (syms[k] && Array.isArray(syms[k].insiderTrades) ? syms[k].insiderTrades : [])) {
      if (!r || !r.name || (r.side !== 'buy' && r.side !== 'sell') || !d10(r.txn)) continue;
      const name = up(r.name);
      out.push({ id: `ins|${s}|${name}|${r.side}|${d10(r.txn)}`, who: `ins|${name}|${s}`, kind: 'insider',
        sym: s, side: r.side, txn: d10(r.txn), reported: d10(r.filed), tradePx: num(r.price) });
    }
  }
  return out;
}

// Which symbols need a quote today: every live tracked trade plus SPY, held/most-recent first, capped.
export function symbolsToQuote({ priorPerf, flow, cap = 150 } = {}) {
  const seen = new Map();
  const add = (s, t) => { s = up(s); if (!s || !/^[A-Z][A-Z0-9.\-]{0,9}$/.test(s)) return; if (!seen.has(s) || seen.get(s) < t) seen.set(s, t); };
  for (const e of trackedEvents(flow)) add(e.sym, e.reported || e.txn);
  for (const t of ((priorPerf && priorPerf.trades) || [])) add(t.sym, t.seen || '');
  const list = [...seen.entries()].sort((a, b) => String(b[1]).localeCompare(String(a[1]))).map(([s]) => s).filter((s) => s !== 'SPY');
  return ['SPY', ...list.slice(0, Math.max(0, cap - 1))];
}

// Fold today's quotes into the carried-forward ledger. `quotes` = { SYM: price }.
export function updatePerf(priorPerf, flow, quotes, { asOf, retentionDays = PERF_RETENTION_DAYS, maxTrades = PERF_MAX_TRADES } = {}) {
  const today = d10(asOf) || new Date().toISOString().slice(0, 10);
  const q = {};
  for (const [k, v] of Object.entries(quotes || {})) { const p = num(v); if (p) q[up(k)] = p; }
  const spy = q.SPY || null;
  const byId = new Map(((priorPerf && Array.isArray(priorPerf.trades)) ? priorPerf.trades : []).filter((t) => t && t.id).map((t) => [t.id, { ...t }]));
  // New events enter with seen = today; a known one keeps its first-seen day.
  for (const e of trackedEvents(flow)) {
    const t = byId.get(e.id);
    if (t) { if (e.tradePx && !t.tradePx) t.tradePx = e.tradePx; if (e.reported && !t.reported) t.reported = e.reported; continue; }
    byId.set(e.id, { id: e.id, who: e.who, kind: e.kind, sym: e.sym, side: e.side, txn: e.txn, reported: e.reported,
      seen: today, tradePx: e.tradePx, entry: null, entryDay: null, spyEntry: null, last: null, lastDay: null, spyLast: null });
  }
  const out = [];
  for (const t of byId.values()) {
    if (days(today, t.txn) > retentionDays) continue;                 // aged out
    const px = q[t.sym] || null;
    // Entry needs the stock AND SPY on the same day, else the excess return would compare two windows.
    if (t.entry == null && px && spy) { t.entry = px; t.spyEntry = spy; t.entryDay = today; }
    if (t.entry != null && px && spy) { t.last = px; t.spyLast = spy; t.lastDay = today; }
    out.push(t);
  }
  out.sort((a, b) => String(b.seen).localeCompare(String(a.seen)) || String(b.txn).localeCompare(String(a.txn)));
  return { asOf: today, method: 'since-first-seen-vs-SPY', trades: out.slice(0, maxTrades) };
}

// One trade's numbers. ret = stock move since entry; excess = side-signed (stock − SPY); sinceTrade =
// stock move since the insider's own transaction price (side-signed), when known.
export function tradeResult(t) {
  if (!t) return null;
  const dir = t.side === 'sell' ? -1 : 1;
  const res = { ret: null, spy: null, excess: null, sinceTrade: null, heldDays: null };
  if (t.entry && t.last && t.spyEntry && t.spyLast && t.entryDay && t.lastDay) {
    res.ret = r4(t.last / t.entry - 1);
    res.spy = r4(t.spyLast / t.spyEntry - 1);
    res.excess = r4(dir * (res.ret - res.spy));
    res.heldDays = days(t.lastDay, t.entryDay);
  }
  if (t.tradePx && t.last) res.sinceTrade = r4(dir * (t.last / t.tradePx - 1));
  return res;
}

const median = (a) => { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

// Per-person scorecard. Only marks at least MIN_AGE_DAYS old count toward a score (a two-day-old mark is
// noise); every person still gets a row so the UI can say "too few to judge" instead of hiding them.
export function scoreboard(perf, { minScored = MIN_SCORED, minAgeDays = MIN_AGE_DAYS } = {}) {
  const people = new Map();
  for (const t of ((perf && perf.trades) || [])) {
    if (!t || !t.who) continue;
    const p = people.get(t.who) || { who: t.who, kind: t.kind, tracked: 0, scored: 0, wins: 0, excess: [], sinceTrade: [], best: null, worst: null };
    p.tracked++;
    const r = tradeResult(t);
    if (r.excess != null && r.heldDays != null && r.heldDays >= minAgeDays) {
      p.scored++; p.excess.push(r.excess); if (r.excess > 0) p.wins++;
      const row = { sym: t.sym, side: t.side, excess: r.excess, txn: t.txn };
      if (!p.best || r.excess > p.best.excess) p.best = row;
      if (!p.worst || r.excess < p.worst.excess) p.worst = row;
    }
    if (r.sinceTrade != null) p.sinceTrade.push(r.sinceTrade);
    people.set(t.who, p);
  }
  const rows = [...people.values()].map((p) => ({
    who: p.who, kind: p.kind, tracked: p.tracked, scored: p.scored,
    hitRate: p.scored ? r4(p.wins / p.scored) : null,
    avgExcess: p.scored ? r4(p.excess.reduce((a, b) => a + b, 0) / p.scored) : null,
    medianExcess: p.scored ? r4(median(p.excess)) : null,
    avgSinceTrade: p.sinceTrade.length ? r4(p.sinceTrade.reduce((a, b) => a + b, 0) / p.sinceTrade.length) : null,
    sinceTradeN: p.sinceTrade.length,
    best: p.best, worst: p.worst,
    enough: p.scored >= minScored,
  }));
  // Ranked: enough-sample people by average excess (median breaks ties), then everyone else by sample.
  return rows.sort((a, b) => (b.enough - a.enough) || ((b.avgExcess ?? -9) - (a.avgExcess ?? -9)) || ((b.medianExcess ?? -9) - (a.medianExcess ?? -9)) || (b.tracked - a.tracked) || a.who.localeCompare(b.who));
}
