/* Per-symbol annualized realized volatility — the IV proxy behind every ESTIMATE-path option premium
   (`options.mjs` `estPremium`, reached through `ivProxyFor`). Pure + unit-tested.

   WHY THIS MODULE EXISTS. The proxy used to be an inline loop in `options-build.mjs` that read ONLY
   `raw/hist-day*.json` and skipped any batch with fewer than 20 bars. That was fine until v141 moved
   historicals onto 7-bar TAILS (`hist-day-tail-<n>.json`, 8 symbols/call) with full YTD series capped
   at 3 symbols/call, 30/run — so on a steady-state day almost every batch is seven bars, every batch
   fails the 20-bar gate, and `ivBySym` comes back nearly EMPTY. Every estimate-path idea then fell
   through to `ivProxyFor`'s flat 0.55/0.60 default.
   Measured on the live 2026-09-11 snapshot: the RCL cash-secured put idea quoted an estimated premium
   of $13.05 on a $242 strike with RCL at $260 — reproduced exactly by the 0.60 default, and implying
   ~68% IV against RCL's real 23.2% (30d) / 32.2% (60d). The card therefore advertised ~$1,305 of
   income and a 58% annualized yield on a contract worth nearer $400-520. The bars needed to price it
   honestly were RIGHT THERE — `data.hist.day.RCL` carried 173 of them — just not where this code
   looked. Same shape as the v119 `instrument_id` bug: data arriving and being thrown away.

   THREE THINGS ARE LOAD-BEARING.
   (a) THE WINDOW IS HORIZON-MATCHED, NOT THE WHOLE SERIES. The estimator prices a ~34-day option, so
       the question is what the name does over the next month — not what it did in February. The old
       loop used every bar in the file (YTD), which for RCL is 49.0% and still ~2x the honest number.
       `VOL_WINDOW_BARS` (60) is about two option horizons: long enough to be stable, short enough to
       describe the current regime.
   (b) IT READS THROUGH `pickgrade.closeSeries`, THE SHARED BAR READER. `data.hist` carries two bar
       shapes (raw Robinhood `{begins_at,close_price}` and the Railway/compacted `{t,c}`) plus
       `interpolated` placeholders and the consumer's spliced `live:true` bar. The old inline loop read
       `b.close_price ?? b.close` — `close` is NEITHER shape, so it silently produced nothing on a
       Railway-normalized series. A fourth private copy of that coalescer is exactly what CLAUDE.md
       warns against; there is now one reader.
   NO STALENESS GATE, DELIBERATELY. CLAUDE.md's rule is that any ranker over `data.hist.day` must check
   the last bar's age, because a series that stops STOPS AT ITS OWN HIGH and a momentum score reads that
   as perfection (the MU/WULF/NBIS 10.00). That failure does not apply to a DISPERSION measure: a stale
   window gives a stale volatility, which is approximately right because vol is far more persistent than
   price, and the alternative when we abstain is not "no number" but ivProxyFor's flat 0.60 — which is
   the very bug this module exists to fix. Abstaining on staleness would therefore make the output WORSE.
   (c) A DEGENERATE SERIES ABSTAINS RATHER THAN SCORING ZERO. A flat or junk series yields ~0 vol,
       which would price every option at the $0.05 floor and make a worthless contract look like free
       money. Out-of-band results return null so the caller falls back, the same `absent !== zero`
       rule the rest of the producer follows. */
import { closeSeries } from './pickgrade.mjs';

export const VOL_WINDOW_BARS = 60;  // trailing trading days scored — ~2x the ~34d option horizon
export const VOL_MIN_BARS = 20;     // fewer than this and the estimate is noise; abstain
export const VOL_MIN = 0.05;        // below: a flat/stale series, not a real 5%-vol equity
export const VOL_MAX = 4;           // above: junk data, not a 400%-vol equity

/* Annualized realized vol from an ascending array of closes. Returns null (never 0) when the series
   is too short or the result lands outside the sane band — the caller then falls back. */
export function realizedVol(closes, { window = VOL_WINDOW_BARS, minBars = VOL_MIN_BARS } = {}) {
  const all = (Array.isArray(closes) ? closes : [])
    .map(Number).filter((v) => Number.isFinite(v) && v > 0);
  const use = window > 0 ? all.slice(-window) : all;
  if (use.length < minBars) return null;
  const rets = [];
  for (let i = 1; i < use.length; i++) rets.push(Math.log(use[i] / use[i - 1]));
  if (rets.length < 2) return null;
  const mean = rets.reduce((s, r) => s + r, 0) / rets.length;
  const variance = rets.reduce((s, r) => s + (r - mean) ** 2, 0) / (rets.length - 1);
  const v = Math.sqrt(variance) * Math.sqrt(252);
  if (!Number.isFinite(v) || v <= VOL_MIN || v >= VOL_MAX) return null;
  return +v.toFixed(3);
}

/* Same, from a raw bar array of either shape. */
export function volFromBars(bars, opts = {}) {
  return realizedVol(closeSeries(bars).map((b) => b.c), opts);
}

/* Merge several {sym: bars} sources into {sym: annualizedVol}, EARLIER SOURCES WINNING — but only
   where they actually produce a figure. A 7-bar tail yields null and correctly falls through to the
   deeper snapshot series rather than blocking it; that fall-through IS the fix. */
export function buildIvBySym(sources, opts = {}) {
  const out = {};
  for (const src of (Array.isArray(sources) ? sources : [])) {
    for (const [sym, bars] of Object.entries(src || {})) {
      if (!sym || out[sym] != null) continue;
      const v = volFromBars(bars, opts);
      if (v != null) out[sym] = v;
    }
  }
  return out;
}
