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
export const INDEX_SYMS = ['SPY', 'QQQ', 'VOO', 'IVV', 'DIA', 'IWM'];

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

  // 2. Cluster caps — clamp any over-cap cluster proportionally, spill to headroom names elsewhere.
  for (let pass = 0; pass < 8; pass++) {
    const byCluster = groupSum(items);
    let violated = false;
    for (const [cl, sum] of Object.entries(byCluster)) {
      const cap = clusterCaps[cl];
      if (cap == null || sum <= cap + 1e-6) continue;
      violated = true;
      const scale = cap / sum;
      const members = items.filter((it) => it._cluster === cl);
      const freed = sum - cap;
      members.forEach((it) => { it.weightPct = +(it.weightPct * scale).toFixed(4); });
      notes.push(`${cl} cluster trimmed ${freed.toFixed(1)}pp to its ${cap}% cap (${members.map((m) => m.ticker).join('/')})`);
      // redistribute freed weight to names/clusters with headroom (index first, then singletons/under-cap)
      redistribute(items, freed, clusterCaps);
    }
    if (!violated) break;
  }

  // 3. Drop sub-floor slivers created by trimming, then normalize to 100%.
  let kept = items.filter((it) => it._isIndex || it.weightPct >= FLOOR_PCT - 1e-6);
  const dropped = items.filter((it) => !(it._isIndex || it.weightPct >= FLOOR_PCT - 1e-6));
  dropped.forEach((it) => notes.push(`${it.ticker} dropped (${it.weightPct.toFixed(1)}% < ${FLOOR_PCT}% floor after caps)`));
  const total = kept.reduce((s, it) => s + it.weightPct, 0) || 1;
  kept.forEach((it) => { it.weightPct = +(it.weightPct * 100 / total).toFixed(2); });

  const clusters = groupSum(kept);
  const out = kept.map(({ _cluster, _isIndex, _nameCap, ...rest }) => rest);
  return { names: out, notes, clusters: Object.fromEntries(Object.entries(clusters).map(([k, v]) => [k, +v.toFixed(2)])) };
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
  // give `amount` (pp) to names with cluster+name headroom, proportional to remaining room; index last-resort
  const byCluster = groupSum(items);
  const room = (it) => {
    const nameRoom = it._nameCap - it.weightPct;
    const cap = it._isIndex ? Infinity : clusterCaps[it._cluster];
    const clRoom = cap == null ? Infinity : cap - (byCluster[it._cluster] || 0);
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
