// Offline unit checks for drawdown.mjs — no network, no I/O. Run: node producer/drawdown.test.mjs
import { bookDrawdown, twrSeries, AG_DRAWDOWN_SOFT, AG_DRAWDOWN_HARD, AG_DRAWDOWN_RESUME, DD_MIN_POINTS } from './drawdown.mjs';

let pass = 0, fail = 0;
const ok = (label, cond) => { if (cond) pass++; else { fail++; console.error(`✗ ${label}`); } };
const near = (label, got, want, tol = 0.005) => { if (Number.isFinite(got) && Math.abs(got - want) <= tol) pass++; else { fail++; console.error(`✗ ${label}\n    got ${got} want ~${want}`); } };
const eqs = (label, got, want) => { if (got === want) pass++; else { fail++; console.error(`✗ ${label}\n    got ${got} want ${want}`); } };

// series helper: equities with an optional running cumFlow
const S = (rows) => rows.map(([t, equity, cumFlow]) => ({ t, equity, ...(cumFlow === undefined ? {} : { cumFlow }) }));

// ---- twrSeries -------------------------------------------------------------
{
  const s = twrSeries(S([['2026-01-01', 1000, 0], ['2026-01-02', 1100, 0], ['2026-01-03', 1210, 0]]));
  eqs('one index point per equity point', s.length, 3);
  near('index starts at 1', s[0].idx, 1, 1e-9);
  near('two +10% steps compound to 1.21', s[2].idx, 1.21, 1e-6);
}
// THE POINT OF THE MODULE: a deposit must not create return, and must not cancel a drawdown.
{
  // Book falls 1000 → 850 (−15%), then a $500 deposit lands. RAW equity (1350) is a new all-time high.
  const withFlow = bookDrawdown(S([
    ['2026-01-01', 1000, 0], ['2026-01-02', 950, 0], ['2026-01-03', 900, 0],
    ['2026-01-04', 870, 0], ['2026-01-05', 850, 0], ['2026-01-06', 1350, 500],
  ]));
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
  ]));
  near('a withdrawal is not a loss', w.dd, 0, 0.005);
  eqs('…and does not trip the breaker', w.level, 'ok');
}
// The >20% implausible-step fallback applies ONLY where cumFlow is missing on BOTH ends (v119 lesson):
// on an annotated series a >20% step is a real move and must NOT be zeroed.
{
  const legacy = bookDrawdown(S([   // no cumFlow anywhere → un-annotated legacy deposit is neutralised
    ['2026-01-01', 1000], ['2026-01-02', 1000], ['2026-01-03', 1500],
    ['2026-01-04', 1500], ['2026-01-05', 1500],
  ]));
  near('an un-annotated >20% jump is treated as a deposit, not a gain', legacy.dd, 0, 0.005);
  const annotated = bookDrawdown(S([  // cumFlow present and flat → the move is REAL
    ['2026-01-01', 1000, 0], ['2026-01-02', 1000, 0], ['2026-01-03', 700, 0],
    ['2026-01-04', 700, 0], ['2026-01-05', 700, 0],
  ]));
  near('an annotated −30% step is a real loss, not discarded', annotated.dd, -0.30, 0.005);
  eqs('…and trips the hard tier', annotated.level, 'hard');
}

// ---- tiers + hysteresis ----------------------------------------------------
const at = (pct) => bookDrawdown(S([
  ['2026-01-01', 1000, 0], ['2026-01-02', 1000, 0], ['2026-01-03', 1000, 0],
  ['2026-01-04', 1000, 0], ['2026-01-05', +(1000 * (1 + pct)).toFixed(2), 0],
]));
eqs('a shallow dip is ok', at(-0.03).level, 'ok');
eqs('past the soft threshold ⇒ soft', at(AG_DRAWDOWN_SOFT - 0.005).level, 'soft');
eqs('past the hard threshold ⇒ hard', at(AG_DRAWDOWN_HARD - 0.005).level, 'hard');
eqs('exactly at the soft threshold ⇒ soft', at(AG_DRAWDOWN_SOFT).level, 'soft');
{
  // HYSTERESIS: an episode that reached soft does not clear the instant it ticks back above soft —
  // without this the breaker chatters around −8%, redeploying into the conditions it just refused.
  const recovering = bookDrawdown(S([
    ['2026-01-01', 1000, 0], ['2026-01-02', 1000, 0], ['2026-01-03', 1000, 0],
    ['2026-01-04', 915, 0],   // −8.5%: trips soft
    ['2026-01-05', 930, 0],   // −7.0%: above soft but below resume
  ]));
  eqs('still soft while recovering between the soft and resume thresholds', recovering.level, 'soft');
  ok('…and it remembers how deep it got, from the series alone', recovering.minDdSincePeak <= AG_DRAWDOWN_SOFT);
  const cleared = bookDrawdown(S([
    ['2026-01-01', 1000, 0], ['2026-01-02', 1000, 0], ['2026-01-03', 1000, 0],
    ['2026-01-04', 915, 0], ['2026-01-05', 950, 0],   // −5.0%: above resume ⇒ episode over
  ]));
  eqs('the episode ends above the resume threshold', cleared.level, 'ok');
  ok('resume is strictly shallower than soft, or there is no hysteresis at all', AG_DRAWDOWN_RESUME > AG_DRAWDOWN_SOFT);
}
{
  // A NEW PEAK resets the episode: depth reached before the peak must not keep the breaker tripped.
  const newHigh = bookDrawdown(S([
    ['2026-01-01', 1000, 0], ['2026-01-02', 850, 0], ['2026-01-03', 1000, 0],
    ['2026-01-04', 1200, 0], ['2026-01-05', 1190, 0],
  ]));
  eqs('a new peak clears an earlier episode', newHigh.level, 'ok');
  eqs('…and the peak date moves with it', newHigh.peakT, '2026-01-04');
}

// ---- fails OPEN ------------------------------------------------------------
{
  const none = bookDrawdown(null);
  eqs('no series ⇒ ok (fail open)', none.level, 'ok');
  ok('…and says why', none.insufficient === true);
  const thin = bookDrawdown(S([['2026-01-01', 1000, 0], ['2026-01-02', 500, 0]]));
  eqs('too few points ⇒ ok even on a huge apparent fall', thin.level, 'ok');
  ok('the threshold is DD_MIN_POINTS', DD_MIN_POINTS >= 3 && thin.points < DD_MIN_POINTS);
  // Rationale worth pinning: the equity series cannot be backfilled, so a young account is thin by
  // definition. A breaker that defaulted to "stop" on thin data would freeze a brand-new book forever.
}
{
  const junk = bookDrawdown([{ t: '2026-01-01', equity: 0 }, { t: 'x' }, null, { equity: 100 }]);
  eqs('unusable rows are dropped rather than throwing', junk.level, 'ok');
}

console.log(`\ndrawdown.test: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
