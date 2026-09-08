// producer/drawdown.mjs — BOOK-LEVEL drawdown circuit breaker for the agentic account.
//
// v121: absolute breaker (−8% soft / −12% hard from the book's own peak).
// MANDATE A (owner-set 2026-09-08): the trigger is now RELATIVE TO SPY. See "why relative" below.
//
// Every risk control in this system was name-scoped: per-name stops, per-name entry bands, per-name
// min-hold. Nothing said "the BOOK is down X — stop putting new money in, regardless of what any
// individual thesis says". This module supplies that missing portfolio-level view.
//
// ── WHY THE TRIGGER IS RELATIVE (Mandate A, 2026-09-08) ────────────────────────────────────────
// The v121 breaker measured the book against its own peak, on a book that carried a 15% defensive
// floor, a 5% gold sleeve and a 22.5% index core — realized beta ~0.65-0.70. At that beta an −8%
// book drawdown needs roughly a −12% move in SPY, i.e. a genuine bear market, so the breaker was
// effectively a tail guard and never fired (max book drawdown to date: −3.47%).
//
// Mandate A removes the ballast and the floor. Beta goes to ~1.0-1.1. On THAT book an absolute −8%
// fires in an ordinary 8% correction — of which there are one or two a year — and the hard tier at
// −12% would RAISE 20% CASH into the hole, i.e. sell the bottom of a routine pullback and sit out
// the rebound. That is not risk control; it is market timing wearing a risk-control costume, and it
// is precisely what the mandate says this account does not do ("regime never picks names or sizes
// positions").
//
// The question worth asking is not "is the book down?" but "is the book down MORE THAN THE MARKET?"
//   • A market-wide fall is BETA. A beat-SPY mandate is supposed to absorb it — de-risking there
//     locks in the loss and forfeits the recovery.
//   • A fall the market did NOT share is the MODEL failing. That is the case that warrants pausing
//     new money, and it is the only case this breaker now acts on.
// So: soft at −5pp and hard at −8pp OF RELATIVE DRAWDOWN, measured from the book's own peak date
// against SPY's move over the identical window.
//
// ONE ABSOLUTE BACKSTOP SURVIVES. If the relative calculation is unavailable (no benchmark series, or
// a stale one) or simply wrong, a purely relative breaker could let the book fall indefinitely as long
// as SPY fell with it. AG_DD_ABS_BACKSTOP (−20%) is a catastrophic floor that binds regardless — deep
// enough that no ordinary correction reaches it, so it cannot reintroduce the market-timing behaviour
// the relative trigger exists to remove.
//
// THREE THINGS ARE LOAD-BEARING:
//
// 1. IT RUNS ON A TIME-WEIGHTED RETURN INDEX, NEVER ON RAW EQUITY. This is a self-funded account with
//    no transfers feed (the whole reason data.agentic.cumFlow exists — see equityseries.mjs). A $1,000
//    deposit into a $5,000 book that is down 10% would push raw equity to a new high and CANCEL the
//    breaker at precisely the wrong moment; a withdrawal would fake a drawdown that never happened.
//    Chaining per-step returns with the flow neutralized is the only measure immune to both.
//
// 2. IT IS MEMORYLESS BY CONSTRUCTION. The executor may commit exactly three files
//    (agentic-pending / agentic-decisions / agentic-parked) and never data.json, so a breaker that
//    needed its own persisted "tripped" flag would have nowhere legal to live. Instead `level` is a pure
//    function of the series: hysteresis comes from the WORST relative drawdown reached since the running
//    peak (`minRelSincePeak`), which the series itself already records. Same input ⇒ same answer.
//
// 3. THE BENCHMARK MUST BE FRESH, OR IT IS NOT USED. data.hist.day goes STALE PER SYMBOL (a name that
//    rotates out of the fetch keeps the series it had when it left — the MU/WULF/NBIS lesson). A stale
//    SPY series reads as "the market did not move", which turns every book decline into a relative one
//    and would trip the breaker on exactly the market-wide fall it is designed to ignore. So a bench
//    whose last bar is more than DD_BENCH_STALE_DAYS behind the book's last recorded point is REFUSED,
//    and the module falls back to the absolute backstop alone.
//
// FAILS OPEN. Too few recorded points, no series at all, or no usable benchmark ⇒ level 'ok' (subject
// only to the absolute backstop). The equity history cannot be backfilled (Robinhood publishes no
// account-equity history), so a young account has a short series, and a breaker that defaulted to "stop
// trading" on thin data would freeze a brand-new book forever. One missed de-risk is recoverable; a
// permanently frozen account is not. Same posture as fetchgate.mjs.
//
// PURE + unit-tested (drawdown.test.mjs). Consumed by agentic-deploy.mjs via planDeployment({drawdown}),
// which agentic-exec-gate.mjs computes from the committed snapshot (passing data.hist.day.SPY as bench).

// ── Relative thresholds (Mandate A) ─────────────────────────────────────────────────────────────
export const AG_DD_REL_SOFT = -0.05;    // book ≤ this many pp behind SPY since the peak ⇒ pause new money
export const AG_DD_REL_HARD = -0.08;    // …and this far behind ⇒ also raise defensive cash
export const AG_DD_REL_RESUME = -0.03;  // hysteresis: an episode ends only ABOVE this, not at SOFT
// ── Absolute catastrophic backstop (binds even when the relative read is unavailable) ───────────
export const AG_DD_ABS_BACKSTOP = -0.20;

export const AG_DD_CASH_FLOOR = 20;       // % of book to hold in cash once the hard tier trips
export const DD_MIN_POINTS = 5;           // fewer recorded points than this can't establish a peak
export const DD_IMPLAUSIBLE_STEP = 0.20;  // an un-annotated >20% step is a legacy deposit, not a return
export const DD_BENCH_STALE_DAYS = 5;     // a bench older than this vs the book's last point is refused

const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };
const r4 = (v) => Math.round(v * 10000) / 10000;
const dayMs = 86400000;
const daysBetween = (a, b) => {
  const A = Date.parse(a + 'T00:00:00Z'), B = Date.parse(b + 'T00:00:00Z');
  return (Number.isFinite(A) && Number.isFinite(B)) ? Math.round((B - A) / dayMs) : null;
};

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

// Benchmark bars → sorted [{t, c}]. Accepts BOTH producer bar shapes (the Claude-agent path stores raw
// Robinhood {begins_at, close_price}; Railway normalizes to {t, c}) and drops the placeholder rows that
// are not real closes: `interpolated` (a gap-filler) and `live` (the consumer's spliced intraday bar).
export function benchSeries(bars) {
  return (bars || [])
    .filter((b) => b && !b.interpolated && !b.live)
    .map((b) => ({ t: String(b.begins_at || b.t || '').slice(0, 10), c: num(b.close_price ?? b.c) }))
    .filter((b) => b.t && b.c > 0)
    .sort((a, b) => a.t.localeCompare(b.t));
}

// → { dd, ddBench, relDd, level:'ok'|'soft'|'hard', basis:'relative'|'absolute-only', peakT,
//     minRelSincePeak, minDdSincePeak, points, insufficient, benchStale }
// `dd` is the CURRENT deposit-adjusted drawdown from the running peak (negative, e.g. -0.093 = −9.3%).
// `relDd` is that drawdown MINUS the benchmark's drawdown over the identical window — the number the
// soft/hard tiers actually act on under Mandate A.
export function bookDrawdown(equityHistory, opts = {}) {
  const soft = opts.relSoft ?? AG_DD_REL_SOFT;
  const hard = opts.relHard ?? AG_DD_REL_HARD;
  const resume = opts.relResume ?? AG_DD_REL_RESUME;
  const absBackstop = opts.absBackstop ?? AG_DD_ABS_BACKSTOP;
  const minPoints = opts.minPoints ?? DD_MIN_POINTS;

  const series = twrSeries(equityHistory);
  if (series.length < minPoints) {
    return { dd: null, ddBench: null, relDd: null, level: 'ok', basis: 'absolute-only', peakT: null,
      minRelSincePeak: null, minDdSincePeak: null, points: series.length, insufficient: true, benchStale: false,
      note: `only ${series.length} recorded point(s) — too few to establish a peak; the breaker stays open (the equity series cannot be backfilled)` };
  }

  const lastT = series[series.length - 1].t;
  // The benchmark is REFUSED when stale (invariant 3). A bench that stopped moving makes every book
  // decline look idiosyncratic, which would trip the breaker on precisely the market-wide fall the
  // relative trigger exists to ignore — the exact inverse of the intended behaviour.
  const bench = benchSeries(opts.bench);
  const benchLastT = bench.length ? bench[bench.length - 1].t : null;
  const benchLagDays = benchLastT ? daysBetween(benchLastT, lastT) : null;
  const benchStale = benchLastT != null && benchLagDays != null && benchLagDays > (opts.benchStaleDays ?? DD_BENCH_STALE_DAYS);
  const useBench = bench.length >= 2 && !benchStale;
  // last close at or before t (never reaches forward)
  const benchAt = (t) => { let v = null; for (const b of bench) { if (b.t <= t) v = b.c; else break; } return v; };

  let peak = series[0].idx, peakT = series[0].t;
  let benchAtPeak = useBench ? benchAt(series[0].t) : null;
  let minSincePeak = 0, minRelSincePeak = useBench ? 0 : null;

  for (const p of series) {
    if (p.idx > peak) {
      peak = p.idx; peakT = p.t; minSincePeak = 0;
      if (useBench) { benchAtPeak = benchAt(p.t); minRelSincePeak = 0; }
    }
    const d = p.idx / peak - 1;
    if (d < minSincePeak) minSincePeak = d;
    if (useBench && benchAtPeak > 0) {
      const bAt = benchAt(p.t);
      if (bAt > 0) {
        const rel = d - (bAt / benchAtPeak - 1);
        if (rel < minRelSincePeak) minRelSincePeak = rel;
      }
    }
  }

  const dd = series[series.length - 1].idx / peak - 1;
  let ddBench = null, relDd = null;
  if (useBench && benchAtPeak > 0) {
    const bNow = benchAt(lastT);
    if (bNow > 0) { ddBench = bNow / benchAtPeak - 1; relDd = dd - ddBench; }
  }

  // EPS: the TWR index is a product of floating-point steps, so a book exactly 5.00pp behind lands at
  // -0.049999999999999996 and would sit one ulp on the wrong side of the threshold. At exactly the
  // threshold the breaker should trip, so compare with a tolerance rather than leaving it to rounding.
  const EPS = 1e-9;
  const basis = relDd != null ? 'relative' : 'absolute-only';
  let level = 'ok';
  if (dd <= absBackstop + EPS) {
    level = 'hard';   // catastrophic absolute floor — binds regardless of the benchmark
  } else if (relDd != null) {
    if (relDd <= hard + EPS) level = 'hard';
    else if (relDd <= soft + EPS) level = 'soft';
    // HYSTERESIS: an episode that reached the soft tier does not end the moment it ticks back above it —
    // it ends above the resume threshold. Without this the breaker chatters on and off around −5pp,
    // deploying into the exact conditions it just refused to deploy into.
    else if (relDd <= resume + EPS && minRelSincePeak != null && minRelSincePeak <= soft + EPS) level = 'soft';
  }

  const pct = (v) => `${(v * 100).toFixed(1)}%`;
  const pp = (v) => `${(v * 100).toFixed(1)}pp`;
  let note;
  if (level === 'ok') {
    note = basis === 'relative'
      ? `book ${pct(dd)} from its peak (${peakT}) vs benchmark ${pct(ddBench)} over the same window — ${pp(relDd)} relative; deployment normal`
      : `book ${pct(dd)} from its peak (${peakT}); no usable benchmark series${benchStale ? ` (SPY bars are ${benchLagDays}d stale — refused)` : ''}, so only the ${pct(absBackstop)} absolute backstop binds — deployment normal`;
  } else if (level === 'soft') {
    note = `book is ${pp(relDd)} BEHIND the benchmark since its peak (${peakT}; book ${pct(dd)} vs market ${pct(ddBench)}) — this is the model underperforming, not a market-wide fall, so new deployment is paused until it recovers above ${pp(resume)} relative`;
  } else {
    note = relDd != null && relDd <= hard + EPS
      ? `book is ${pp(relDd)} BEHIND the benchmark since its peak (${peakT}; book ${pct(dd)} vs market ${pct(ddBench)}) — new deployment paused and defensive cash raised to ${opts.cashFloor ?? AG_DD_CASH_FLOOR}% of book`
      : `book ${pct(dd)} from its peak (${peakT}) has breached the ${pct(absBackstop)} absolute backstop — new deployment paused and defensive cash raised to ${opts.cashFloor ?? AG_DD_CASH_FLOOR}% of book`;
  }

  return {
    dd: r4(dd), ddBench: ddBench == null ? null : r4(ddBench), relDd: relDd == null ? null : r4(relDd),
    level, basis, peakT,
    minRelSincePeak: minRelSincePeak == null ? null : r4(minRelSincePeak),
    minDdSincePeak: r4(minSincePeak),
    points: series.length, insufficient: false, benchStale, note,
  };
}
