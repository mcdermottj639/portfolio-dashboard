// Offline unit checks for drawdown.mjs — no network, no I/O. Run: node producer/drawdown.test.mjs
//
// MANDATE A (2026-09-08): the tiers act on the book's drawdown RELATIVE TO SPY, not on its absolute
// drawdown. The suite below was migrated rather than rewritten — every deposit/withdrawal/implausible-
// step case is unchanged in intent and now supplies a FLAT benchmark, which makes those declines
// idiosyncratic and so keeps their original expectations meaningful.
import { bookDrawdown, twrSeries, benchSeries,
  AG_DD_REL_SOFT, AG_DD_REL_HARD, AG_DD_REL_RESUME, AG_DD_ABS_BACKSTOP,
  DD_MIN_POINTS, DD_BENCH_STALE_DAYS } from './drawdown.mjs';

let pass = 0, fail = 0;
const ok = (label, cond) => { if (cond) pass++; else { fail++; console.error(`✗ ${label}`); } };
const near = (label, got, want, tol = 0.005) => { if (Number.isFinite(got) && Math.abs(got - want) <= tol) pass++; else { fail++; console.error(`✗ ${label}\n    got ${got} want ~${want}`); } };
const eqs = (label, got, want) => { if (got === want) pass++; else { fail++; console.error(`✗ ${label}\n    got ${got} want ${want}`); } };

// series helper: equities with an optional running cumFlow
const S = (rows) => rows.map(([t, equity, cumFlow]) => ({ t, equity, ...(cumFlow === undefined ? {} : { cumFlow }) }));
// benchmark helper: raw Robinhood bar shape (the other shape is exercised separately)
const B = (rows) => rows.map(([t, c]) => ({ begins_at: t + 'T00:00:00Z', close_price: String(c) }));
const DATES = ['2026-01-01', '2026-01-02', '2026-01-03', '2026-01-04', '2026-01-05', '2026-01-06'];
// a market that did nothing over the window ⇒ any book decline is entirely the model's
const FLAT = B(DATES.map((t) => [t, 100]));
// a market that fell by `pct` on the last day
const FELL = (pct) => B(DATES.map((t, i) => [t, i === DATES.length - 1 ? 100 * (1 + pct) : 100]));

// ---- twrSeries -------------------------------------------------------------
{
  const s = twrSeries(S([['2026-01-01', 1000, 0], ['2026-01-02', 1100, 0], ['2026-01-03', 1210, 0]]));
  eqs('one index point per equity point', s.length, 3);
  near('index starts at 1', s[0].idx, 1, 1e-9);
  near('two +10% steps compound to 1.21', s[2].idx, 1.21, 1e-6);
}

// ---- benchSeries: both bar shapes, placeholders dropped ---------------------
{
  const mixed = benchSeries([
    { begins_at: '2026-01-01T00:00:00Z', close_price: '100' },
    { t: '2026-01-02', c: 101 },
    { t: '2026-01-03', c: 999, interpolated: true },   // gap filler — not a real close
    { t: '2026-01-04', c: 888, live: true },           // consumer's spliced intraday bar
    { t: '2026-01-05', c: 0 },                         // unpriced
  ]);
  eqs('both producer bar shapes are accepted', mixed.length, 2);
  ok('…and interpolated / live / zero rows are dropped', mixed.every((b) => b.c === 100 || b.c === 101));
}

// THE POINT OF THE MODULE (unchanged): a deposit must not create return, nor cancel a drawdown.
{
  // Book falls 1000 → 850 (−15%), then a $500 deposit lands. RAW equity (1350) is a new all-time high.
  const withFlow = bookDrawdown(S([
    ['2026-01-01', 1000, 0], ['2026-01-02', 950, 0], ['2026-01-03', 900, 0],
    ['2026-01-04', 870, 0], ['2026-01-05', 850, 0], ['2026-01-06', 1350, 500],
  ]), { bench: FLAT });
  near('a deposit contributes no return', withFlow.dd, -0.15, 0.005);
  eqs('…so the breaker stays tripped through it', withFlow.level, 'hard');
  // Same series read on RAW equity (what a naive implementation would do) would look like a new high.
  const naive = 1350 / 1000 - 1;
  ok('raw equity would have shown a GAIN and cancelled the breaker at the worst moment', naive > 0);
}
{
  // …and a withdrawal must not fake a drawdown.
  const w = bookDrawdown(S([
    ['2026-01-01', 1000, 0], ['2026-01-02', 1010, 0], ['2026-01-03', 1020, 0],
    ['2026-01-04', 1030, 0], ['2026-01-05', 1040, 0], ['2026-01-06', 540, -500],
  ]), { bench: FLAT });
  near('a withdrawal is not a loss', w.dd, 0, 0.005);
  eqs('…and does not trip the breaker', w.level, 'ok');
}
// The >20% implausible-step fallback applies ONLY where cumFlow is missing on BOTH ends (v119 lesson):
// on an annotated series a >20% step is a real move and must NOT be zeroed.
{
  const legacy = bookDrawdown(S([   // no cumFlow anywhere → un-annotated legacy deposit is neutralised
    ['2026-01-01', 1000], ['2026-01-02', 1000], ['2026-01-03', 1500],
    ['2026-01-04', 1500], ['2026-01-05', 1500],
  ]), { bench: FLAT });
  near('an un-annotated >20% jump is treated as a deposit, not a gain', legacy.dd, 0, 0.005);
  const annotated = bookDrawdown(S([  // cumFlow present and flat → the move is REAL
    ['2026-01-01', 1000, 0], ['2026-01-02', 1000, 0], ['2026-01-03', 700, 0],
    ['2026-01-04', 700, 0], ['2026-01-05', 700, 0],
  ]), { bench: FLAT });
  near('an annotated −30% step is a real loss, not discarded', annotated.dd, -0.30, 0.005);
  eqs('…and trips the hard tier', annotated.level, 'hard');
}

// ---- MANDATE A: BETA IS NOT A REASON TO STOP ------------------------------------------------------
// The whole point of the relative trigger. These four cases are the ones that would have been decided
// the OTHER way by the v121 absolute breaker, and getting them wrong means either selling the bottom of
// an ordinary correction or ignoring the model actually failing.
{
  // A market-wide fall: the book is down 10% and so is SPY. A beat-SPY mandate absorbs this.
  const marketWide = bookDrawdown(S([
    ['2026-01-01', 1000, 0], ['2026-01-02', 1000, 0], ['2026-01-03', 1000, 0],
    ['2026-01-04', 950, 0], ['2026-01-05', 900, 0],
  ]), { bench: B([['2026-01-01', 100], ['2026-01-02', 100], ['2026-01-03', 100], ['2026-01-04', 95], ['2026-01-05', 90]]) });
  near('a market-wide fall is measured as ~0pp relative', marketWide.relDd, 0, 0.005);
  eqs('…and does NOT trip the breaker (this is beta, and Mandate A is paid to carry it)', marketWide.level, 'ok');
  near('…while the absolute drawdown is still reported honestly', marketWide.dd, -0.10, 0.005);
  eqs('…on the relative basis', marketWide.basis, 'relative');
  // The v121 absolute breaker would have called this same book 'hard' and raised 20% cash at the low.
  ok('the OLD absolute rule would have tripped here — that is the behaviour being removed',
    marketWide.dd <= -0.08);
}
{
  // An idiosyncratic fall: the book is down 6% while the market did nothing. That is the model failing.
  const idio = bookDrawdown(S([
    ['2026-01-01', 1000, 0], ['2026-01-02', 1000, 0], ['2026-01-03', 1000, 0],
    ['2026-01-04', 970, 0], ['2026-01-05', 940, 0],
  ]), { bench: FLAT });
  near('an idiosyncratic fall shows its full depth as relative', idio.relDd, -0.06, 0.005);
  eqs('…and DOES trip the soft tier', idio.level, 'soft');
}
{
  // The worst shape of all: the book falls while the market RISES. Small absolute, large relative.
  const diverging = bookDrawdown(S([
    ['2026-01-01', 1000, 0], ['2026-01-02', 1000, 0], ['2026-01-03', 1000, 0],
    ['2026-01-04', 985, 0], ['2026-01-05', 970, 0],
  ]), { bench: B([['2026-01-01', 100], ['2026-01-02', 100], ['2026-01-03', 100], ['2026-01-04', 102], ['2026-01-05', 103]]) });
  near('a −3% book against a +3% market is −6pp relative', diverging.relDd, -0.06, 0.006);
  eqs('…which trips soft even though the book barely fell', diverging.level, 'soft');
  ok('…and the v121 absolute breaker would have missed it entirely', diverging.dd > -0.08);
}
{
  // Relative hard tier.
  const bad = bookDrawdown(S([
    ['2026-01-01', 1000, 0], ['2026-01-02', 1000, 0], ['2026-01-03', 1000, 0],
    ['2026-01-04', 950, 0], ['2026-01-05', 910, 0],
  ]), { bench: FLAT });
  eqs('a −9pp relative drawdown raises defensive cash', bad.level, 'hard');
  ok('…and the note says the decline is idiosyncratic, not market-wide', /BEHIND the benchmark/.test(bad.note));
}

// ---- the absolute catastrophic backstop -----------------------------------------------------------
{
  // A −25% book in a −25% market: 0pp relative, but the backstop binds regardless. Without this a purely
  // relative breaker would let the book fall indefinitely so long as SPY fell with it.
  const crash = bookDrawdown(S([
    ['2026-01-01', 1000, 0], ['2026-01-02', 1000, 0], ['2026-01-03', 1000, 0],
    ['2026-01-04', 900, 0], ['2026-01-05', 750, 0],
  ]), { bench: B([['2026-01-01', 100], ['2026-01-02', 100], ['2026-01-03', 100], ['2026-01-04', 90], ['2026-01-05', 75]]) });
  near('…relative reads ~0pp', crash.relDd, 0, 0.01);
  eqs('…but the absolute backstop still trips hard', crash.level, 'hard');
  ok('…and says which rule fired', /absolute backstop/.test(crash.note));
  ok('the backstop is deep enough that no ordinary correction reaches it', AG_DD_ABS_BACKSTOP <= -0.15);
}

// ---- a stale benchmark is REFUSED, never trusted ---------------------------------------------------
// Invariant 3. data.hist.day goes stale PER SYMBOL; a stale bench reads as "the market did not move",
// which turns every market-wide fall into an apparent idiosyncratic one — the exact inverse of intent.
{
  const rows = S([
    ['2026-02-01', 1000, 0], ['2026-02-02', 1000, 0], ['2026-02-03', 1000, 0],
    ['2026-02-04', 950, 0], ['2026-02-05', 900, 0],
  ]);
  const staleBench = B([['2026-01-01', 100], ['2026-01-02', 100]]);   // a month behind
  const r = bookDrawdown(rows, { bench: staleBench });
  ok('a stale bench is flagged', r.benchStale === true);
  eqs('…and refused, falling back to the absolute basis', r.basis, 'absolute-only');
  eqs('…so a −10% book is NOT tripped on a bench that merely stopped updating', r.level, 'ok');
  ok('…and the note explains the refusal', /stale/.test(r.note));
  ok('the staleness bar is DD_BENCH_STALE_DAYS', DD_BENCH_STALE_DAYS >= 2 && DD_BENCH_STALE_DAYS <= 10);
  // …and with a fresh bench the very same decline IS caught.
  const fresh = bookDrawdown(rows, { bench: B([['2026-02-01', 100], ['2026-02-02', 100], ['2026-02-03', 100], ['2026-02-04', 100], ['2026-02-05', 100]]) });
  eqs('the same book against a FRESH flat bench trips hard', fresh.level, 'hard');
}
{
  const noBench = bookDrawdown(S([
    ['2026-01-01', 1000, 0], ['2026-01-02', 1000, 0], ['2026-01-03', 1000, 0],
    ['2026-01-04', 950, 0], ['2026-01-05', 900, 0],
  ]));
  eqs('no bench at all ⇒ absolute-only basis', noBench.basis, 'absolute-only');
  eqs('…and a −10% book is not tripped without evidence it underperformed', noBench.level, 'ok');
  eqs('…with no relative figure invented', noBench.relDd, null);
}

// ---- tiers + hysteresis (relative) -----------------------------------------------------------------
const at = (pct) => bookDrawdown(S([
  ['2026-01-01', 1000, 0], ['2026-01-02', 1000, 0], ['2026-01-03', 1000, 0],
  ['2026-01-04', 1000, 0], ['2026-01-05', +(1000 * (1 + pct)).toFixed(2), 0],
]), { bench: FLAT });
eqs('a shallow dip is ok', at(-0.02).level, 'ok');
eqs('past the soft threshold ⇒ soft', at(AG_DD_REL_SOFT - 0.005).level, 'soft');
eqs('past the hard threshold ⇒ hard', at(AG_DD_REL_HARD - 0.005).level, 'hard');
eqs('exactly at the soft threshold ⇒ soft', at(AG_DD_REL_SOFT).level, 'soft');
{
  // HYSTERESIS: an episode that reached soft does not clear the instant it ticks back above soft —
  // without this the breaker chatters around −5pp, redeploying into the conditions it just refused.
  const recovering = bookDrawdown(S([
    ['2026-01-01', 1000, 0], ['2026-01-02', 1000, 0], ['2026-01-03', 1000, 0],
    ['2026-01-04', 945, 0],   // −5.5pp: trips soft
    ['2026-01-05', 960, 0],   // −4.0pp: above soft but below resume
  ]), { bench: FLAT });
  eqs('still soft while recovering between the soft and resume thresholds', recovering.level, 'soft');
  ok('…and it remembers how deep it got, from the series alone', recovering.minRelSincePeak <= AG_DD_REL_SOFT);
  const cleared = bookDrawdown(S([
    ['2026-01-01', 1000, 0], ['2026-01-02', 1000, 0], ['2026-01-03', 1000, 0],
    ['2026-01-04', 945, 0], ['2026-01-05', 980, 0],   // −2.0pp: above resume ⇒ episode over
  ]), { bench: FLAT });
  eqs('the episode ends above the resume threshold', cleared.level, 'ok');
  ok('resume is strictly shallower than soft, or there is no hysteresis at all', AG_DD_REL_RESUME > AG_DD_REL_SOFT);
}
{
  // A NEW PEAK resets the episode — and must reset the BENCHMARK anchor with it, or the relative figure
  // is measured from one date on the book and another on the market.
  const newHigh = bookDrawdown(S([
    ['2026-01-01', 1000, 0], ['2026-01-02', 850, 0], ['2026-01-03', 1000, 0],
    ['2026-01-04', 1200, 0], ['2026-01-05', 1190, 0],
  ]), { bench: FLAT });
  eqs('a new peak clears an earlier episode', newHigh.level, 'ok');
  eqs('…and the peak date moves with it', newHigh.peakT, '2026-01-04');
  near('…and the relative figure is measured from the NEW peak, not the old one', newHigh.relDd, -0.0083, 0.002);
}

// ---- fails OPEN ------------------------------------------------------------
{
  const none = bookDrawdown(null);
  eqs('no series ⇒ ok (fail open)', none.level, 'ok');
  ok('…and says why', none.insufficient === true);
  const thin = bookDrawdown(S([['2026-01-01', 1000, 0], ['2026-01-02', 500, 0]]), { bench: FLAT });
  eqs('too few points ⇒ ok even on a huge apparent fall', thin.level, 'ok');
  ok('the threshold is DD_MIN_POINTS', DD_MIN_POINTS >= 3 && thin.points < DD_MIN_POINTS);
  // Rationale worth pinning: the equity series cannot be backfilled, so a young account is thin by
  // definition. A breaker that defaulted to "stop" on thin data would freeze a brand-new book forever.
}
{
  const junk = bookDrawdown([{ t: '2026-01-01', equity: 0 }, { t: 'x' }, null, { equity: 100 }], { bench: FLAT });
  eqs('unusable rows are dropped rather than throwing', junk.level, 'ok');
  const junkBench = bookDrawdown(S([
    ['2026-01-01', 1000, 0], ['2026-01-02', 1000, 0], ['2026-01-03', 1000, 0],
    ['2026-01-04', 950, 0], ['2026-01-05', 900, 0],
  ]), { bench: [null, { t: 'x' }, { t: '2026-01-01', c: 'abc' }] });
  eqs('an unusable bench degrades to absolute-only rather than throwing', junkBench.basis, 'absolute-only');
}

console.log(`\ndrawdown.test: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
