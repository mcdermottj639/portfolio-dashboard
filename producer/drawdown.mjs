// producer/drawdown.mjs — BOOK-LEVEL drawdown circuit breaker for the agentic account (v121).
//
// Every risk control in this system was name-scoped: per-name stops, per-name entry bands, per-name
// min-hold. Nothing said "the BOOK is down X% from its high — stop putting new money in, regardless of
// what any individual thesis says". Multi-strategy platforms cut a pod's capital on drawdown for exactly
// this reason: a book in a deep drawdown is, empirically, in a regime its own name-level theses are not
// pricing. This module supplies that missing portfolio-level view.
//
// TWO THINGS ARE LOAD-BEARING:
//
// 1. IT RUNS ON A TIME-WEIGHTED RETURN INDEX, NEVER ON RAW EQUITY. This is a self-funded account with no
//    transfers feed (the whole reason data.agentic.cumFlow exists — see equityseries.mjs). A $1,000
//    deposit into a $5,000 book that is down 10% would push raw equity to a new high and CANCEL the
//    breaker at precisely the wrong moment; a withdrawal would fake a drawdown that never happened.
//    Chaining per-step returns with the flow neutralized is the only measure immune to both.
//
// 2. IT IS MEMORYLESS BY CONSTRUCTION. The executor may commit exactly three files
//    (agentic-pending / agentic-decisions / agentic-parked) and never data.json, so a breaker that
//    needed its own persisted "tripped" flag would have nowhere legal to live. Instead `level` is a pure
//    function of the series: hysteresis comes from the WORST drawdown reached since the running peak
//    (`minDdSincePeak`), which the series itself already records. Same input ⇒ same answer, every run.
//
// FAILS OPEN. Too few recorded points, or no series at all, ⇒ level 'ok'. The equity history cannot be
// backfilled (Robinhood publishes no account-equity history), so a young account has a short series, and
// a breaker that defaulted to "stop trading" on thin data would freeze a brand-new book forever. One
// missed de-risk is recoverable; a permanently frozen account is not. Same posture as fetchgate.mjs.
//
// PURE + unit-tested (drawdown.test.mjs). Consumed by agentic-deploy.mjs via planDeployment({drawdown}),
// which agentic-exec-gate.mjs computes from the committed snapshot.

export const AG_DRAWDOWN_SOFT = -0.08;    // ≤ this ⇒ stop deploying NEW money
export const AG_DRAWDOWN_HARD = -0.12;    // ≤ this ⇒ also raise defensive cash
export const AG_DRAWDOWN_RESUME = -0.06;  // hysteresis: an episode ends only ABOVE this, not at SOFT
export const AG_DD_CASH_FLOOR = 20;       // % of book to hold in cash once the hard tier trips
export const DD_MIN_POINTS = 5;           // fewer recorded points than this can't establish a peak
export const DD_IMPLAUSIBLE_STEP = 0.20;  // an un-annotated >20% step is a legacy deposit, not a return

const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };
const r4 = (v) => Math.round(v * 10000) / 10000;

// Deposit-adjusted, time-weighted return index from data.agentic.equityHistory / data.main.equityHistory.
// Returns [{t, idx}] with idx starting at 1. Mirrors the consumer's acctPerfStats convention so the card
// and the breaker can never disagree about what "the account's return" means.
export function twrSeries(equityHistory) {
  const pts = (equityHistory || [])
    .filter((p) => p && p.t && num(p.equity) > 0)
    .map((p) => ({ t: String(p.t).slice(0, 10), equity: num(p.equity), cumFlow: p.cumFlow == null ? null : num(p.cumFlow) }))
    .sort((a, b) => a.t.localeCompare(b.t));
  if (!pts.length) return [];
  const out = [{ t: pts[0].t, idx: 1 }];
  let idx = 1;
  for (let i = 1; i < pts.length; i++) {
    const prev = pts[i - 1], cur = pts[i];
    const haveFlow = prev.cumFlow != null && cur.cumFlow != null;
    const flow = haveFlow ? cur.cumFlow - prev.cumFlow : 0;
    let r = (cur.equity - flow) / prev.equity - 1;
    // The >20% fallback applies ONLY where cumFlow is missing on BOTH ends (the v119 lesson): once flows
    // are annotated, a >20% step is a real move and zeroing it would discard exactly the volatility this
    // breaker exists to detect.
    if (!haveFlow && Math.abs(r) > DD_IMPLAUSIBLE_STEP) r = 0;
    idx *= (1 + r);
    out.push({ t: cur.t, idx });
  }
  return out;
}

// → { dd, level:'ok'|'soft'|'hard', peakT, minDdSincePeak, points, insufficient }
// `dd` is the CURRENT deposit-adjusted drawdown from the running peak (negative, e.g. -0.093 = −9.3%).
export function bookDrawdown(equityHistory, opts = {}) {
  const soft = opts.soft ?? AG_DRAWDOWN_SOFT;
  const hard = opts.hard ?? AG_DRAWDOWN_HARD;
  const resume = opts.resume ?? AG_DRAWDOWN_RESUME;
  const minPoints = opts.minPoints ?? DD_MIN_POINTS;

  const series = twrSeries(equityHistory);
  if (series.length < minPoints) {
    return { dd: null, level: 'ok', peakT: null, minDdSincePeak: null, points: series.length, insufficient: true,
      note: `only ${series.length} recorded point(s) — too few to establish a peak; the breaker stays open (the equity series cannot be backfilled)` };
  }

  let peak = series[0].idx, peakT = series[0].t, minSincePeak = 0;
  for (const p of series) {
    if (p.idx > peak) { peak = p.idx; peakT = p.t; minSincePeak = 0; }
    const d = p.idx / peak - 1;
    if (d < minSincePeak) minSincePeak = d;
  }
  const dd = series[series.length - 1].idx / peak - 1;

  // EPS: the TWR index is a product of floating-point steps, so a book exactly 8.00% off its peak lands
  // at -0.07999999999999996 and would sit one ulp on the wrong side of the threshold. At exactly the
  // threshold the breaker should trip, so compare with a tolerance rather than leaving it to rounding.
  const EPS = 1e-9;
  let level = 'ok';
  if (dd <= hard + EPS) level = 'hard';
  else if (dd <= soft + EPS) level = 'soft';
  // HYSTERESIS: an episode that reached the soft tier does not end the moment it ticks back above it —
  // it ends above the resume threshold. Without this the breaker chatters on and off around -8%,
  // deploying into the exact conditions it just refused to deploy into.
  else if (dd <= resume + EPS && minSincePeak <= soft + EPS) level = 'soft';

  return {
    dd: r4(dd), level, peakT, minDdSincePeak: r4(minSincePeak), points: series.length, insufficient: false,
    note: level === 'ok'
      ? `book ${(dd * 100).toFixed(1)}% from its peak (${peakT}) — deployment normal`
      : level === 'soft'
        ? `book ${(dd * 100).toFixed(1)}% from its peak (${peakT}) — new deployment paused until it recovers above ${(resume * 100).toFixed(0)}%`
        : `book ${(dd * 100).toFixed(1)}% from its peak (${peakT}) — new deployment paused and defensive cash raised to ${opts.cashFloor ?? AG_DD_CASH_FLOOR}% of book`,
  };
}
