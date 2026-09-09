// producer/hist-plan.test.mjs — the historicals planner's grouping, caps and batching.
// Pure: no snapshot, no network, no raw files. Run: node producer/hist-plan.test.mjs
import { planHistoricals, batches, lastBarDate, HIST_TAIL_DAYS, HIST_TAIL_LOOKBACK,
  HIST_TAIL_BATCH, HIST_FULL_BATCH, HIST_FULL_CAP, HIST_MONTH_CAP, HIST_MONTH_STALE_DAYS } from './hist-plan.mjs';

let pass = 0, fail = 0;
const eq = (label, got, want) => { const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok  ${label}`); }
  else { fail++; console.log(`  FAIL ${label}\n       got  ${g}\n       want ${w}`); } };
const ok = (label, cond) => eq(label, !!cond, true);

console.log('hist-plan');

const TODAY = '2026-09-09';
const bar = (d, extra) => ({ t: `${d}T00:00:00Z`, c: 100, ...(extra || {}) });
const syms = (rows) => rows.map((r) => r.sym);

// --- lastBarDate: what counts as "the series reaches this date" --------------------------------
eq('reads the newest real bar', lastBarDate([bar('2026-09-01'), bar('2026-09-04')]), '2026-09-04');
eq('accepts the raw Robinhood shape too',
  lastBarDate([{ begins_at: '2026-09-04T13:30:00Z', close_price: '1' }]), '2026-09-04');
eq('is order-independent', lastBarDate([bar('2026-09-04'), bar('2026-09-01')]), '2026-09-04');
// An interpolated bar is a calendar slot with no close — every reader filters it, so a series padded
// with one must NOT read as current, or a padded series masquerades as fresh and never gets refetched.
eq('an interpolated tail does not count as freshness',
  lastBarDate([bar('2026-09-01'), bar('2026-09-08', { interpolated: true })]), '2026-09-01');
eq('a spliced live bar does not count either (it is an intraday print, not a close)',
  lastBarDate([bar('2026-09-01'), bar('2026-09-08', { live: true })]), '2026-09-01');
eq('no series at all is null', lastBarDate(undefined), null);
eq('an empty series is null', lastBarDate([]), null);

// --- the three groups ---------------------------------------------------------------------------
{
  const hist = { day: {
    FRESH: [bar(TODAY)],
    TAIL1: [bar('2026-09-08')],                    // 1 day  → tail
    TAILE: [bar('2026-08-30')],                    // 10 days → tail (boundary, inclusive)
    OLD:   [bar('2026-08-29')],                    // 11 days → full
    ANCIENT: [bar('2026-06-01')],
  } };
  const p = planHistoricals(['FRESH', 'TAIL1', 'TAILE', 'OLD', 'ANCIENT', 'NEVER'], hist, TODAY);
  eq('a series already at today needs nothing', syms(p.fresh), ['FRESH']);
  eq('a series inside the tail window gets a tail fetch', syms(p.tail), ['TAIL1', 'TAILE']);
  eq(`…and the boundary (${HIST_TAIL_DAYS}d) is inclusive`, p.tail.some((r) => r.sym === 'TAILE'), true);
  eq('anything staler, or absent entirely, gets a full YTD fetch', syms(p.full), ['OLD', 'ANCIENT', 'NEVER']);
  eq('ages are reported', p.tail.map((r) => r.age), [1, 10]);
  eq('an unseen symbol reports no age rather than 0', p.full.find((r) => r.sym === 'NEVER').age, null);
}

// A future-dated bar (clock skew, a hand-built fixture) is not evidence of staleness.
eq('a future bar is treated as current, not as a negative age',
  syms(planHistoricals(['X'], { day: { X: [bar('2026-12-01')] } }, TODAY).fresh), ['X']);

// The `daily` alias the picks-build reader also tolerates.
eq('the hist.daily alias is read as well',
  syms(planHistoricals(['X'], { daily: { X: [bar('2026-09-08')] } }, TODAY).tail), ['X']);

// --- the tail window must REACH BACK past the oldest bar a tail is allowed to bridge ------------
// If it did not, a tail would land with a hole in the middle of the series and mergeBars would
// faithfully preserve the hole. This is the pairing that makes the tail group safe at all.
ok('the tail lookback reaches further back than the oldest tail-eligible bar',
  HIST_TAIL_LOOKBACK > HIST_TAIL_DAYS);

// --- caps: the bench seeds over several runs, in priority order ---------------------------------
{
  const universe = Array.from({ length: 100 }, (_, i) => `S${String(i).padStart(3, '0')}`);
  const p = planHistoricals(universe, { day: {} }, TODAY, { fullCap: 30 });
  eq('the YTD cap binds', p.full.length, 30);
  eq('…and the rest is DEFERRED, not dropped', p.fullDeferred.length, 70);
  eq('the cap takes the highest-priority symbols first', syms(p.full).slice(0, 3), ['S000', 'S001', 'S002']);
  eq('deferred picks up exactly where full left off', syms(p.fullDeferred)[0], 'S030');
  eq('every symbol is accounted for exactly once',
    p.fresh.length + p.tail.length + p.full.length + p.fullDeferred.length, universe.length);
  eq('a tail is never capped — it is the cheap group, and capping it is what causes staleness',
    planHistoricals(universe, { day: Object.fromEntries(universe.map((s) => [s, [bar('2026-09-08')]])) }, TODAY).tail.length, 100);
}

// --- monthly: its own staleness threshold and its own cap ---------------------------------------
{
  const universe = ['A', 'B', 'C'];
  const hist = { day: {}, month: { A: [bar('2026-09-01')], B: [bar('2026-07-01')] } };
  const p = planHistoricals(universe, hist, TODAY);
  eq(`a monthly series inside ${HIST_MONTH_STALE_DAYS}d is left alone`, p.month.find((r) => r.sym === 'A'), undefined);
  eq('a stale or absent monthly series is due', syms(p.month), ['B', 'C']);
  const many = Array.from({ length: 40 }, (_, i) => `M${i}`);
  const q = planHistoricals(many, { day: {} }, TODAY, { monthCap: 15 });
  eq('the monthly cap binds', q.month.length, 15);
  eq('…and defers the remainder', q.monthDeferred.length, 25);
  eq('the day and month groups are decided independently',
    q.full.length + q.fullDeferred.length, many.length);
}

// --- no snapshot ⇒ fail OPEN toward fetching -----------------------------------------------------
{
  const p = planHistoricals(['A', 'B', 'C'], {}, TODAY);
  eq('an unreadable snapshot puts everything in the full group', syms(p.full), ['A', 'B', 'C']);
  eq('…and claims nothing is fresh', p.fresh.length + p.tail.length, 0);
}

// --- batching ------------------------------------------------------------------------------------
{
  const rows = Array.from({ length: 17 }, (_, i) => ({ sym: `S${i}` }));
  eq('tails batch 8 at a time', batches(rows, HIST_TAIL_BATCH).map((b) => b.length), [8, 8, 1]);
  eq('full/month keep the ≤3-symbol rule', batches(rows, HIST_FULL_BATCH).map((b) => b.length).every((n) => n <= 3), true);
  eq('batching a plain symbol list works too', batches(['A', 'B', 'C'], 2), [['A', 'B'], ['C']]);
  eq('nothing to fetch is no calls', batches([], 8), []);
  eq('every symbol survives batching', batches(rows, HIST_TAIL_BATCH).flat().length, 17);
}
// The size rule is about PAYLOAD, not symbol count: a 7-bar tail is ~1/20th of a YTD series, so 8
// symbols of tail is smaller than one 3-symbol YTD call. Keep the two constants asymmetric.
ok('the tail batch is larger than the full batch, deliberately', HIST_TAIL_BATCH > HIST_FULL_BATCH);
ok('the caps are the ones the runbook quotes', HIST_FULL_CAP === 30 && HIST_MONTH_CAP === 15);

console.log(`\nhist-plan.test: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
