// producer/riskweights.mjs — deterministic RISK-AWARE weighting for the agentic target.
//
// The deep-research workflow (.claude/workflows/agentic-research.js) proposes conviction weights, but
// conviction alone ignores two risks the old target carried:
//   1. CORRELATION CLUSTERS. "Sector-diversified" by GICS label still let the megacap-tech complex
//      (NVDA "semis" + GOOGL/MSFT "software" + AMZN "retail") dominate — those names move together, so a
//      35-40% combined weight is really one bet. We cap each correlation CLUSTER, not just each sector.
//   2. VOLATILITY. A flat 25% cap treats 10% in LLY (a single drug stock into an earnings print + a
//      drug-pricing overhang) the same as 10% in SPY. We scale each name's cap DOWN by its volatility so
//      the same conviction buys a smaller slot in a wilder name (risk-parity-lite).
//
// PURE + unit-tested (riskweights.test.mjs). Used by finalize-target.mjs (enforced on the workflow output
// before it's committed as agentic-target.json) AND by agentic-deploy.mjs (so a cash deployment can't push
// a cluster past its cap). The research WORKFLOW inlines a mirror of clusterOf()/CLUSTER_CAPS in its
// synthesis prompt (the sandbox can't import repo modules); THIS file is the canonical, enforced copy.

// Correlation clusters (co-movement, not GICS sector). A name not listed is its own singleton cluster
// (uncapped beyond the single-name cap). SPY/QQQ index ballast is intentionally UNCAPPED — it's the
// diversifier, so capping it would be backwards.
export const CLUSTERS = {
  'megacap-tech': ['NVDA', 'AVGO', 'AMD', 'AAPL', 'MSFT', 'GOOGL', 'GOOG', 'META', 'AMZN', 'ORCL', 'NFLX', 'CRM', 'ACN', 'CTSH'],
  'payments':     ['V', 'MA'],
  'banks':        ['JPM', 'GS', 'BAC', 'WFC', 'C', 'MS'],
  'exchanges':    ['ICE', 'CME'],
  'pharma':       ['LLY', 'MRK', 'PFE', 'ABBV', 'BMY'],
  'health-svc':   ['UNH', 'CVS', 'CI', 'HUM'],
  'staples':      ['PG', 'WMT', 'COST', 'KO', 'PEP'],
  'energy':       ['XOM', 'CVX', 'SHEL', 'CNQ', 'COP'],
};
export const INDEX_SYMS = ['SPY', 'QQQ', 'VTI', 'VOO', 'IVV', 'DIA', 'IWM'];

// LOOK-THROUGH COMPOSITION (v121). The cluster caps used to count only DIRECT holdings, so a book could
// hold 44.8% megacap-tech directly, add 20% SPY + 5% VTI on top, and still report itself inside a "48%"
// cap while true exposure was ~52%. Funds measure exposure THROUGH their index vehicles; so do we now.
// Fractions = that cluster's share of the vehicle's assets, from Alpha Vantage ETF_PROFILE on 2026-08-24
// (SPY and QQQ read directly; VTI derived as SPY × 0.83 — a total-market fund holds every S&P name at its
// S&P weight times the S&P's share of total US market cap, calibrated against VTI's observed NVDA 6.32%
// and AAPL 5.84% against SPY's 7.90% / 6.79%, i.e. ratios 0.800 and 0.860).
// REVIEW ~ANNUALLY, like market.mjs's holiday calendar. A vehicle that is NOT listed here contributes
// ZERO look-through — that is the old direct-only behaviour for that vehicle, which is NOT conservative,
// so add a vehicle here before allocating to it (DIA and IWM are deliberately absent: unused today).
export const LOOKTHROUGH = {
  SPY: { 'megacap-tech': 0.375, banks: 0.037, pharma: 0.030, staples: 0.027, energy: 0.018, payments: 0.016 },
  VOO: { 'megacap-tech': 0.375, banks: 0.037, pharma: 0.030, staples: 0.027, energy: 0.018, payments: 0.016 },
  IVV: { 'megacap-tech': 0.375, banks: 0.037, pharma: 0.030, staples: 0.027, energy: 0.018, payments: 0.016 },
  VTI: { 'megacap-tech': 0.311, banks: 0.031, pharma: 0.025, staples: 0.022, energy: 0.015, payments: 0.013 },
  QQQ: { 'megacap-tech': 0.424, staples: 0.052 },
};

// Per-cluster ceiling (% of book). Uncapped clusters (and singletons) fall back to the single-name cap.
export const CLUSTER_CAPS = {
  'megacap-tech': 48, // the AI/big-tech complex — the concentration this whole feature targets
  'payments':     20,
  'banks':        22,
  'staples':      25,
  'energy':       18,
  'pharma':       20,
  'health-svc':   18,
  'exchanges':    18,
};

export const BASE_SINGLE_CAP = 25;   // hard ceiling for any single non-index name (%)
export const FLOOR_PCT = 3.5;        // don't bother holding a sub-floor sliver
const REF_RANGE = 0.42;              // a "normal" large-cap 52wk range / price; names wider than this get docked
const MIN_VOL_SCALE = 0.55;          // never dock a single-name cap below 55% of base on vol alone

// Direct + look-through exposure per cluster. `names` = [{ticker, weightPct}].
// Returns { [cluster]: {direct, lookThrough, total} }. An index vehicle contributes its own weight to the
// 'index' bucket's `direct` AND spreads its composition into the real clusters' `lookThrough`.
export function clusterExposure(names) {
  const out = {};
  const bucket = (cl) => (out[cl] || (out[cl] = { direct: 0, lookThrough: 0, total: 0 }));
  for (const n of names || []) {
    const t = String((n && n.ticker) || '').toUpperCase();
    const w = num(n && n.weightPct);
    if (!t || !(w > 0)) continue;
    bucket(clusterOf(t)).direct += w;
    const lt = LOOKTHROUGH[t];
    if (lt) for (const [cl, frac] of Object.entries(lt)) bucket(cl).lookThrough += w * frac;
  }
  for (const e of Object.values(out)) e.total = +(e.direct + e.lookThrough).toFixed(4);
  for (const e of Object.values(out)) { e.direct = +e.direct.toFixed(4); e.lookThrough = +e.lookThrough.toFixed(4); }
  return out;
}

export function clusterOf(sym) {
  const s = String(sym || '').toUpperCase();
  if (INDEX_SYMS.includes(s)) return 'index';
  for (const [c, members] of Object.entries(CLUSTERS)) if (members.includes(s)) return c;
  return 'single:' + s; // singleton — only the single-name cap applies
}

// Volatility proxy from the 52-week range (width / price). Crude — it conflates a big trend with vol — so
// callers MAY pass an explicit `vol` (e.g. realized vol from data.hist) per name, which wins. Returns a
// fraction (~0.3 tight … ~0.9 wild). Falls back to REF_RANGE (neutral) when nothing usable is supplied.
export function volProxy(name) {
  if (name && typeof name.vol === 'number' && name.vol > 0) return name.vol;
  const px = num(name && (name.px ?? name.price));
  const hi = num(name && (name.hi ?? name.hi52 ?? name.high_52_weeks));
  const lo = num(name && (name.lo ?? name.lo52 ?? name.low_52_weeks));
  if (px > 0 && hi > 0 && lo > 0 && hi > lo) return (hi - lo) / px;
  return REF_RANGE;
}

// Vol-scaled single-name cap: wilder names get a smaller ceiling for the same conviction.
export function volScaledCap(name) {
  const v = volProxy(name);
  const scale = clamp(REF_RANGE / v, MIN_VOL_SCALE, 1);
  return +(BASE_SINGLE_CAP * scale).toFixed(2);
}

// Enforce single-name (vol-scaled) + cluster caps on a proposed allocation, then re-normalize to ~100%.
// `names` = [{ticker, weightPct, sector?, px?, hi?, lo?, vol?, ...}] (extra fields preserved untouched).
// Returns { names:[…same shape, weightPct adjusted…], notes:[strings], clusters:{cluster:pct} }.
// Deterministic: iterative water-filling — clamp violators to their cap, redistribute the freed weight to
// names with headroom (proportionally), repeat until stable. Index ballast absorbs overflow last.
export function riskAdjustWeights(names, opts = {}) {
  const clusterCaps = { ...CLUSTER_CAPS, ...(opts.clusterCaps || {}) };
  const items = (names || []).filter((n) => n && n.ticker && num(n.weightPct) > 0).map((n) => ({
    ...n,
    ticker: String(n.ticker).toUpperCase(),
    weightPct: num(n.weightPct),
    _cluster: clusterOf(n.ticker),
    _isIndex: INDEX_SYMS.includes(String(n.ticker).toUpperCase()),
    _nameCap: INDEX_SYMS.includes(String(n.ticker).toUpperCase()) ? 100 : volScaledCap(n),
  }));
  if (!items.length) return { names: [], notes: [], clusters: {} };
  const notes = [];

  // 1. Single-name vol-scaled caps (water-filling).
  waterfill(items, (it) => it._nameCap, (it, capped) => {
    if (capped) notes.push(`${it.ticker} capped to ${it._nameCap}% (vol-scaled single-name cap)`);
  });

  // 2. Cluster caps — enforced on DIRECT + LOOK-THROUGH exposure, but only DIRECT members are trimmed.
  // That asymmetry is deliberate and will look like a bug otherwise: SPY/VTI are the diversifier, so a
  // fat index core must SHRINK how much direct megacap can be stacked on top of it, not itself be sold.
  const indexBorne = new Set();
  for (let pass = 0; pass < 8; pass++) {
    const exp = clusterExposure(items);
    let violated = false;
    for (const [cl, e] of Object.entries(exp)) {
      const cap = clusterCaps[cl];
      if (cap == null || e.total <= cap + 1e-6) continue;
      const members = items.filter((it) => it._cluster === cl);
      if (!members.length || e.direct <= 1e-6) {
        // The breach is entirely index-borne — there is no direct position to trim. Say so once and
        // move on; looping here would spin without converging.
        if (!indexBorne.has(cl)) {
          indexBorne.add(cl);
          notes.push(`${cl} is ${e.total.toFixed(1)}% vs its ${cap}% cap entirely via index look-through — no direct position to trim`);
        }
        continue;
      }
      violated = true;
      const allowedDirect = Math.max(0, cap - e.lookThrough);
      const scale = allowedDirect / e.direct;
      const freed = e.direct - allowedDirect;
      members.forEach((it) => { it.weightPct = +(it.weightPct * scale).toFixed(4); });
      notes.push(`${cl} cluster trimmed ${freed.toFixed(1)}pp to its ${cap}% cap — ${e.direct.toFixed(1)}% direct + ${e.lookThrough.toFixed(1)}% via index look-through (${members.map((m) => m.ticker).join('/')})`);
      redistribute(items, freed, clusterCaps);
    }
    if (!violated) break;
  }

  // 3. Drop sub-floor slivers created by trimming, then bring the book to 100% WITHOUT undoing the caps.
  let kept = items.filter((it) => it._isIndex || it.weightPct >= FLOOR_PCT - 1e-6);
  const dropped = items.filter((it) => !(it._isIndex || it.weightPct >= FLOOR_PCT - 1e-6));
  dropped.forEach((it) => notes.push(`${it.ticker} dropped (${it.weightPct.toFixed(1)}% < ${FLOOR_PCT}% floor after caps)`));

  // A BLANKET re-normalization here silently UNDOES step 2: capping frees weight, the book then sums to
  // less than 100, and scaling every name back up by the same factor re-inflates the very names just
  // trimmed. Observed on a 70%-megacap fixture: JPM was capped to 22% and came out at 24.2%. So the
  // shortfall is filled through the SAME cap-aware redistribution used above, and only a genuinely
  // un-placeable remainder is parked — visibly — in the index sleeve.
  const totalOf = (list) => list.reduce((a, it) => a + it.weightPct, 0);
  const t0 = totalOf(kept);
  if (t0 > 100 + 1e-6) {
    kept.forEach((it) => { it.weightPct = +(it.weightPct * 100 / t0).toFixed(4); });  // scaling DOWN is always cap-safe
  } else if (t0 < 100 - 1e-6) {
    redistribute(kept, 100 - t0, clusterCaps);
    const t1 = totalOf(kept);
    if (t1 < 100 - 1e-6) {
      const rem = 100 - t1;
      const idx = kept.filter((it) => it._isIndex).sort((a, b) => b.weightPct - a.weightPct)[0];
      if (idx) {
        idx.weightPct = +(idx.weightPct + rem).toFixed(4);
        notes.push(`${rem.toFixed(1)}pp had no cap headroom anywhere — parked in ${idx.ticker} (which raises its look-through contribution)`);
      } else {
        const t2 = totalOf(kept) || 1;
        kept.forEach((it) => { it.weightPct = +(it.weightPct * 100 / t2).toFixed(4); });
        notes.push(`${rem.toFixed(1)}pp had no cap headroom and there is no index sleeve to park it in — weights scaled up and caps MAY be exceeded`);
      }
    }
  }
  // Final 2dp rounding, with any residual rounding drift absorbed by the largest holding.
  kept.forEach((it) => { it.weightPct = +it.weightPct.toFixed(2); });
  const drift = +(100 - totalOf(kept)).toFixed(2);
  if (Math.abs(drift) >= 0.01 && kept.length) {
    const big = kept.slice().sort((a, b) => b.weightPct - a.weightPct)[0];
    big.weightPct = +(big.weightPct + drift).toFixed(2);
  }
  // Report any cluster still over its cap after the fill (an honest residual, not a silent one).
  {
    const finalExp = clusterExposure(kept);
    for (const [cl, e] of Object.entries(finalExp)) {
      const cap = clusterCaps[cl];
      if (cap != null && e.total > cap + 0.5) {
        notes.push(`RESIDUAL: ${cl} ends at ${e.total.toFixed(1)}% vs its ${cap}% cap (${e.direct.toFixed(1)}% direct + ${e.lookThrough.toFixed(1)}% look-through) — no headroom existed elsewhere`);
      }
    }
  }

  const clusters = groupSum(kept);
  const exposure = clusterExposure(kept);
  const out = kept.map(({ _cluster, _isIndex, _nameCap, ...rest }) => rest);
  return {
    names: out, notes,
    // `clusters` stays DIRECT-only for back-compat with existing callers/tests; `exposure` carries the
    // direct / look-through / total split that the caps are actually enforced against.
    clusters: Object.fromEntries(Object.entries(clusters).map(([k, v]) => [k, +v.toFixed(2)])),
    exposure,
  };
}

// --- helpers ---
function waterfill(items, capOf, onCap) {
  for (let pass = 0; pass < 8; pass++) {
    let over = 0; const under = [];
    for (const it of items) {
      const cap = capOf(it);
      if (it.weightPct > cap + 1e-6) { over += it.weightPct - cap; it.weightPct = cap; onCap && onCap(it, true); }
      else if (it.weightPct < cap - 1e-6) under.push(it);
    }
    if (over < 1e-6 || !under.length) break;
    const room = under.reduce((s, it) => s + (capOf(it) - it.weightPct), 0) || 1;
    under.forEach((it) => { it.weightPct = +(it.weightPct + over * (capOf(it) - it.weightPct) / room).toFixed(4); });
  }
}
function redistribute(items, amount, clusterCaps) {
  // give `amount` (pp) to names with cluster+name headroom, proportional to remaining room
  const exp = clusterExposure(items);
  const room = (it) => {
    const nameRoom = it._nameCap - it.weightPct;
    let clRoom;
    if (it._isIndex) {
      // LOAD-BEARING: an index vehicle is not infinitely absorbent. Adding x to SPY adds x×0.375 to
      // megacap-tech look-through, so dumping freed megacap weight into the index would re-breach the
      // very cap we just enforced — an oscillation that only terminated because the pass loop is bounded.
      // Its room is the tightest of its own look-through headroom across every cluster it feeds.
      const lt = LOOKTHROUGH[it.ticker];
      clRoom = Infinity;
      if (lt) for (const [cl, frac] of Object.entries(lt)) {
        const cap = clusterCaps[cl];
        if (cap == null || !(frac > 0)) continue;
        clRoom = Math.min(clRoom, (cap - ((exp[cl] && exp[cl].total) || 0)) / frac);
      }
    } else {
      const cap = clusterCaps[it._cluster];
      clRoom = cap == null ? Infinity : cap - ((exp[it._cluster] && exp[it._cluster].total) || 0);
    }
    return Math.max(0, Math.min(nameRoom, clRoom));
  };
  let targets = items.filter((it) => room(it) > 1e-6);
  if (!targets.length) return; // nowhere to put it — normalization will absorb
  const totalRoom = targets.reduce((s, it) => s + room(it), 0) || 1;
  targets.forEach((it) => { it.weightPct = +(it.weightPct + amount * room(it) / totalRoom).toFixed(4); });
}
function groupSum(items) {
  const g = {};
  for (const it of items) g[it._cluster] = (g[it._cluster] || 0) + it.weightPct;
  return g;
}
function num(v) { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
