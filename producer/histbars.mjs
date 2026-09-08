// producer/histbars.mjs
//
// Compact `data.hist` bars to the smallest shape EVERY existing reader already accepts.
// Pure + unit-tested (histbars.test.mjs). No I/O.
//
// WHY THIS EXISTS — it is a repo-lifetime problem, not a display one. Measured 2026-09-08:
// `data.hist` was 4.88MB of a 5.33MB snapshot (91.5%), at 159 bytes per bar over 29,202
// daily bars. That snapshot is committed to a PUBLIC repo ~13x a day, and it is ENCRYPTED,
// so consecutive versions share no bytes: git cannot delta or compress them and every run
// adds a full fresh copy to history forever. The history had reached 1.7GB and was growing
// ~3GB/month. That is not an abstract tidiness cost — it lands on every agent that has to
// fetch the repo, and on 2026-09-08 the agentic executor's first real test fire spent TEN
// MINUTES in `git fetch` and never reached the gate before the market closed.
//
// WHAT IS DROPPED, and the grep that justifies each (index.html + producer/*.mjs):
//   open_price — read NOWHERE, by anything, ever. The chart analyzer's candles derive the
//                open from the PRIOR CLOSE (CLAUDE.md, chart-analyzer entry), so this field
//                has been pure weight since day one: ~24 bytes x 29,202 bars.
//   session    — read NOWHERE off a bar. Every "session" hit in this repo is sessionStorage
//                or a session-bound Routine.
//   ...plus every price stops being a zero-padded string: "230.360000" is 12 bytes to carry
//   a number that needs 6.
//
// WHAT SURVIVES: t, c, h, l, v, interpolated. The consumer's azSeries/azSeriesMonthly and
// the producer's drawdown.mjs / agentic-ledger.mjs / maindecisions.mjs readers ALL already
// coalesce both bar shapes (`b.begins_at || b.t`, `b.close_price ?? b.c`, `b.volume ?? b.v`).
// That coalescing is the documented Railway-vs-Claude-agent bar-shape lesson in CLAUDE.md,
// and it is precisely what makes this change invisible to every one of them. It is now
// load-bearing in a second way — do not "simplify" it away.
//
// FOUR INVARIANTS, each of which would be a real bug if broken.
//
// (a) IDEMPOTENT. build-data carries prior bars forward on every run, so on all but the
//     day's first fetch this function runs over its OWN prior output. compact(compact(x))
//     must equal compact(x), or the snapshot would churn its own bytes every hour and
//     defeat the entire point.
//
// (b) ARRAY LENGTH IS PRESERVED EXACTLY — bars are shrunk, never dropped, not even a junk
//     one. `betaFromHist` and `corrGroups` align two series by TAIL INDEX (`slice(-n)`),
//     not by date, so silently removing one bad bar from one symbol shifts that symbol a
//     day out of phase and quietly corrupts beta and correlation. This is the same hazard
//     the v111 splice fix documents; a uniformly stale series merely lags, a mis-aligned
//     one is WRONG.
//
// (c) THE TIMESTAMP IS COPIED VERBATIM, never reformatted. Readers slice it, date-parse it,
//     and compare it against ET dates computed elsewhere. Truncating "2026-09-04T00:00:00Z"
//     to "2026-09-04" would save another ~6% and is not worth one date-comparison regression.
//
// (d) A FIELD IS OMITTED ONLY WHERE ITS READER'S FALLBACK PRODUCES THE SAME VALUE. h and l
//     fall back to c (`parseFloat(x.high_price || x.h || c)`), so they are dropped only when
//     equal to c; v falls back to 0 (`parseFloat(x.volume || x.v || 0)`), so only a zero
//     volume is dropped. Omitting anything else would change what the consumer renders.
//     A bar with no finite close is passed through UNTOUCHED — it is rare, every reader
//     already skips it, and rewriting it could only lose information.

const num = (v) => {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * One bar → its compact form. Accepts the raw Robinhood shape, the Railway/compact shape,
 * or anything already produced by this function (invariant (a)).
 */
export function compactBar(b) {
  if (!b || typeof b !== 'object') return b;

  const t = b.begins_at ?? b.t;
  const c = num(b.close_price ?? b.c);

  // Invariant (b)+(d): an unreadable bar keeps its slot AND its original content.
  if (t == null || c == null) return b;

  const out = { t, c };

  const h = num(b.high_price ?? b.h);
  if (h != null && h !== c) out.h = h;

  const l = num(b.low_price ?? b.l);
  if (l != null && l !== c) out.l = l;

  const v = num(b.volume ?? b.v);
  if (v != null && v !== 0) out.v = v;

  // Placeholder rows the readers filter on. Only ever stored when true — `interpolated:false`
  // was ~22 bytes on 88.7% of bars to say nothing, and an absent field is equally falsy.
  if (b.interpolated) out.interpolated = true;
  // The consumer's spliced live bar (v111) is client-side only and never reaches a snapshot,
  // but carry it if it ever does: `gradePick` depends on being able to filter it out.
  if (b.live) out.live = true;

  return out;
}

/** One symbol's series. Length is preserved exactly (invariant (b)). */
export function compactSeries(bars) {
  return Array.isArray(bars) ? bars.map(compactBar) : bars;
}

/**
 * A whole `hist` block: { day: {SYM: bars[]}, month: {...}, week: {...} }.
 * Unknown intervals and non-array values pass through untouched.
 */
export function compactHist(hist) {
  if (!hist || typeof hist !== 'object') return hist;
  const out = {};
  for (const iv of Object.keys(hist)) {
    const series = hist[iv];
    if (!series || typeof series !== 'object') { out[iv] = series; continue; }
    const o = {};
    for (const sym of Object.keys(series)) o[sym] = compactSeries(series[sym]);
    out[iv] = o;
  }
  return out;
}

/** Reporting helper for the build log: bytes before → after. */
export function histBytes(hist) {
  try { return JSON.stringify(hist || {}).length; } catch { return 0; }
}
