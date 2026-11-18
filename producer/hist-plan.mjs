import { shadowSymbols } from './agentic-observatory.mjs';
// producer/hist-plan.mjs — the day's HISTORICALS plan, printed as batches the agent can execute.
//
// Mirrors av-plan.mjs: a deterministic planner that reads what we already hold, decides what to
// fetch, and PRINTS it. It calls no MCP tool and writes no raw file — the agent does that.
//
//   node producer/hist-plan.mjs          # human-readable batch lines (FETCH_ALL step 2b)
//   node producer/hist-plan.mjs --json   # the same plan as JSON (tests / tooling)
//
// WHY THIS EXISTS. PRODUCER.md used to name the historicals symbols in prose — "top 15 holdings by
// value + every market symbol" — which the agent had to compute by hand from positions.json every
// run. Two consequences, both measured on the live 2026-09-08 snapshot:
//   · Coverage was whatever that rotation happened to contain, so 142 of 191 daily series were
//     STALE, some by two months. Analyze builds every technical off those bars, and backtesting its
//     label logic over deliberately-staled series flips the DIRECTION of the call 8% of the time at
//     10 stale bars and 15% at 40 — a stale series does not lag, it STOPS, usually at a high.
//   · Refreshing a wide bench the only way build-data supported (a whole-array replace) meant
//     re-fetching ~153 YTD bars per name per day: ~2.4MB/day into an encrypted blob committed
//     ~13x/day to a public repo, where git can delta none of it.
//
// SO THE PLAN HAS THREE GROUPS, and the split is the entire idea:
//   TAIL  — a series we already hold that is merely a few days behind. Fetch ~7 bars (0.5KB) and
//           let `mergeBars` glue them on. This is what keeps ~230 names fresh for ~1/20th the bytes.
//   FULL  — a series we don't hold, or one too far behind for a tail to bridge. Fetch YTD. Capped
//           per run (HIST_FULL_CAP) because these are the expensive ones, in bytes AND in agent
//           turns; the bench seeds over several days, in priority order, and says so.
//   MONTH — the 5Y monthly series the Analyze multi-timeframe row reads. Rarely changes; capped
//           lower still.
//
// A TAIL CANNOT BRIDGE AN ARBITRARY GAP, which is why HIST_TAIL_DAYS and the tail's `start_time`
// are tied together: the tail window must REACH BACK PAST the last bar we hold, or the merge leaves
// a hole in the middle of the series. HIST_TAIL_LOOKBACK (12 calendar days) covers a 10-day-old
// last bar plus a long weekend. Anything older is FULL — deliberately, because a gap is worse than
// a refetch: readers that align two series by tail index would silently mis-phase across it.
//
// PRIVACY: this prints SYMBOLS ONLY. It reads positions to get the priority order right, never to
// rank by value, and it must never print a quantity or a dollar figure — its output lands in a
// scheduled run's log.
//
// FAILS OPEN TOWARD FETCHING. No snapshot, no PF_PASSPHRASE, a plaintext dev snapshot or a decrypt
// failure all mean "we know nothing about what we hold", so every symbol lands in FULL (subject to
// the cap). Over-fetching costs calls; under-fetching leaves the Analyze tab reading stale bars,
// which is the failure this whole change exists to end.

import { readSnapshot } from './fetchgate.mjs';
import { analyzeUniverse, heldFromRaw, heldFromSnapshot, apexSymbols, targetSymbols, tierOf } from './analyze-universe.mjs';
import { gradingUniverse, gradingStarts } from './pickgrade.mjs';

// --- dials -------------------------------------------------------------------------------------
export const HIST_TAIL_DAYS = 10;      // last bar this recent (cal days) ⇒ a tail fetch suffices
export const HIST_TAIL_LOOKBACK = 12;  // …and the tail must reach back FURTHER than that, or it gaps
export const HIST_TAIL_BATCH = 8;      // ~56 bars/call — small enough to return inline (see below)
export const HIST_FULL_BATCH = 3;      // ~460 bars/call — the documented ≤3-symbol rule
export const HIST_FULL_CAP = 30;       // YTD seeds per run; the bench fills in over ~7 FETCH_ALL days
export const HIST_MONTH_BATCH = 3;
export const HIST_MONTH_CAP = 15;
export const HIST_MONTH_STALE_DAYS = 35;
export const QUOTES_BATCH = 60;        // the every-run quotes call already carries ~60 inline
// v252 — A CALL IS SIZED BY BARS, NOT BY SYMBOL COUNT. "≤3 symbols" was written on 2026-09-08, when a
// YTD series was ~153 bars. The series grows every session: on 2026-11-18 a three-symbol YTD call
// returned 115,017 characters (~222 bars each) and the harness refused to return it inline, so the
// batch the plan printed could not be written to raw/ at all. Measured ~173 characters per bar.
export const HIST_CALL_BARS = 265;     // ≈46K characters: one whole-year series, or 3 names in spring
export const HIST_FULL_CALLS = 12;     // YTD calls per run (was 10 = 30 names ÷ 3)
export const HIST_HELD_GAP_MAX = 6;    // held names a LIGHT run is asked to seed (preflight)

// WHY 8 SYMBOLS IS SAFE FOR A TAIL WHILE FULL STAYS AT 3. The ≤3 rule exists because an oversized
// MCP result is spilled by the harness to a temp file and only its PATH comes back — at which point
// the payload was never in context, `Write` has nothing to write, and `cp` (the trap) looks like the
// only way out. The constraint is PAYLOAD SIZE, not symbol count: a YTD batch is ~153 bars/symbol,
// a 7-bar tail is ~7. Eight symbols of tail is ~56 bars — a fifth of one three-symbol YTD call.

const ymd = (d) => d.toISOString().slice(0, 10);
const todayET = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
const isoAgo = (days, from) => { const d = new Date(`${from}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - days); return `${ymd(d)}T00:00:00Z`; };

/**
 * The last date a series carries a REAL bar for. Interpolated placeholders don't count — they are a
 * calendar slot with no close, every reader filters them, and treating one as freshness would let a
 * padded series masquerade as current. `live` bars are client-side only and are ignored too.
 */
export function lastBarDate(bars) {
  if (!Array.isArray(bars)) return null;
  let best = null;
  for (const b of bars) {
    if (!b || b.interpolated || b.live) continue;
    const t = b.t ?? b.begins_at;
    if (typeof t !== 'string' || t.length < 10) continue;
    const d = t.slice(0, 10);
    if (best == null || d > best) best = d;
  }
  return best;
}

/**
 * Pure grouping — the whole decision, testable without a snapshot.
 *
 * @param {string[]} universe  symbols in FETCH PRIORITY order (holdings → target → benches)
 * @param {object}   hist      the snapshot's `hist` block ({day:{SYM:bars}, month:{…}}), may be {}
 * @param {string}   today     ET date, YYYY-MM-DD
 * @param {object}   [dials]   overrides for the caps/thresholds (tests)
 */
export function planHistoricals(universe, hist, today, dials = {}) {
  const d = {
    tailDays: HIST_TAIL_DAYS, fullCap: HIST_FULL_CAP,
    monthCap: HIST_MONTH_CAP, monthStale: HIST_MONTH_STALE_DAYS, ...dials,
  };
  const day = (hist && (hist.day || hist.daily)) || {};
  const month = (hist && hist.month) || {};

  // v204: `pinned` = {SYM: 'YYYY-MM-DD'} — open Daily-Picks episodes (pickgrade.gradingStarts). A pinned
  // symbol too stale for a tail gets a since-the-scan fetch in its own group, OUTSIDE the YTD cap, so an
  // open pick can never be starved by holdings/target/shadow seeds. A pinned symbol that is fresh or
  // tail-able takes the normal path. `pin` reaches back to the scan date (or a full series, if older).
  const pinned = d.pinned || {};
  const tail = [], full = [], fullDeferred = [], fresh = [], pin = [];
  const monthDue = [], monthDeferred = [];

  for (const sym of universe) {
    const last = lastBarDate(day[sym]);
    const age = last ? daysBetween(last, today) : null;
    // A future-dated bar (clock skew, a bad fixture) is not evidence of staleness — treat it as 0.
    const a = age == null ? null : Math.max(0, age);
    if (a != null && a <= 0) fresh.push({ sym, age: a, last });
    else if (a != null && a <= d.tailDays) tail.push({ sym, age: a, last });
    else if (pinned[sym]) {
      // Start the day after the last bar we hold (never leave a hole that skews a moving average), or
      // YTD with no series — and never later than the scan date the grade needs.
      const after = last ? new Date(Date.parse(last + 'T00:00:00Z') + 864e5).toISOString().slice(0, 10) : `${today.slice(0, 4)}-01-01`;
      pin.push({ sym, age: a, last, start: after < pinned[sym] ? after : pinned[sym] });
    }
    else if (full.length < d.fullCap) full.push({ sym, age: a, last });
    else fullDeferred.push({ sym, age: a, last });

    const mLast = lastBarDate(month[sym]);
    const mAge = mLast ? Math.max(0, daysBetween(mLast, today)) : null;
    if (mAge == null || mAge > d.monthStale) {
      if (monthDue.length < d.monthCap) monthDue.push({ sym, age: mAge, last: mLast });
      else monthDeferred.push({ sym, age: mAge, last: mLast });
    }
  }
  return { tail, full, fullDeferred, fresh, pin, month: monthDue, monthDeferred };
}

/** Upper bound on the daily bars a fetch from `start` (YYYY-MM-DD…) to `today` returns: weekdays, so
 *  holidays only ever make it an over-estimate. */
export function estBars(start, today) {
  const a = Date.parse(`${String(start).slice(0, 10)}T00:00:00Z`), b = Date.parse(`${today}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return 0;
  let n = 0; for (let t = a; t <= b; t += 864e5) { const d = new Date(t).getUTCDay(); if (d !== 0 && d !== 6) n++; }
  return n;
}
/** How many symbols one call may carry for a window, so the result returns inline. Never under 1. */
export function symbolsPerCall(start, today, max = HIST_FULL_BATCH, budget = HIST_CALL_BARS) {
  const bars = Math.max(1, estBars(start, today));
  return Math.max(1, Math.min(max, Math.floor(budget / bars)));
}
/**
 * Held names whose daily series a tail cannot repair: none at all, or last real bar older than
 * HIST_TAIL_DAYS. Pure. `held` is symbols; returns [{sym,last,start}] in the given order, capped.
 * preflight prints these on LIGHT runs so a holding bought today is readable within the hour.
 */
export function heldHistoryGaps(held, hist, today, max = HIST_HELD_GAP_MAX) {
  const day = (hist && (hist.day || hist.daily)) || {}, out = [];
  for (const raw of held || []) {
    const sym = String(raw || '').toUpperCase(); if (!sym || out.some((r) => r.sym === sym)) continue;
    const last = lastBarDate(day[sym]);
    const age = last ? Math.max(0, daysBetween(last, today)) : null;
    if (age != null && age <= HIST_TAIL_DAYS) continue;
    out.push({ sym, last, age, start: `${today.slice(0, 4)}-01-01` });
  }
  return out.slice(0, max);
}

// v252 — a HELD name with no usable daily series is seeded on LIGHT runs too. Historicals are a
// FETCH_ALL step, so a holding bought after the morning run (or one whose seed was missed) read
// "STALE DATA" on Analyze until the next day at best. One symbol per call: a whole-year series is
// ~45K characters and two no longer return inline (see hist-plan.mjs HIST_CALL_BARS). Symbols only.
export function heldHistoryDirective(prior, today) {
  let gaps = [];
  try { gaps = heldHistoryGaps(heldFromSnapshot(prior), prior && prior.hist, today); } catch { gaps = []; }
  if (!gaps.length) return '';
  return 'PREFLIGHT ALSO: held names with no usable daily history — fetch them on THIS run (FETCH_LIGHT included), ONE symbol per call: ' +
    gaps.map((g, i) => `Robinhood · get_equity_historicals { symbols:["${g.sym}"], interval:"day", start_time:"${g.start}T00:00:00Z" } → Write the VERBATIM result to producer/raw/hist-day-held-${i + 1}.json`).join(' ; ') +
    '. Best-effort: a failure never stops the run.';
}

/** Chunk a symbol list into fetch batches. */
export function batches(rows, size) {
  const out = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size).map((r) => r.sym ?? r));
  return out;
}

// --- CLI -----------------------------------------------------------------------------------------
if (import.meta.url === `file://${process.argv[1]}`) {
  const asJson = process.argv.includes('--json');
  const today = todayET();

  const snap = await readSnapshot();          // best-effort; null ⇒ everything is FULL
  // Holdings: this run's raw files AND the last published snapshot, so the plan does not depend on
  // being run after the position rows were written. Apex research names ride with the target tier.
  const positions = [...new Set([...heldFromRaw(), ...heldFromSnapshot(snap)])];
  const target = [...new Set([...targetSymbols(), ...apexSymbols()])];
  // The picks GRADING universe (pickgrade.mjs — archived Daily Picks whose outcome is still being
  // measured) rides in right behind holdings + target: the Track Record can only grade a name whose
  // closes kept arriving, and this is the fetch that keeps them arriving. Read from the same snapshot,
  // so it costs no extra decrypt; a missing/ungradeable snapshot yields an empty list, never a throw.
  let grading = [], pinned = {};
  try { const pk = snap && snap.picks; grading = gradingUniverse((pk && pk.history) || [], { asOf: today, grades: pk && pk.grades });
        pinned = gradingStarts((pk && pk.history) || [], { asOf: today, grades: pk && pk.grades }); } catch { grading = []; pinned = {}; }
  const base = analyzeUniverse({ positions, target });
  const pri = new Set([...positions, ...target].map((x) => String(x || '').toUpperCase()));
  const universe = [...new Set([...base.filter((x) => pri.has(x)), ...shadowSymbols(snap?.agentic?.correctness?.shadow), ...grading.map((x) => String(x).toUpperCase()), ...base.filter((x) => !pri.has(x))])];
  const tailStart = isoAgo(HIST_TAIL_LOOKBACK, today);
  const fullStart = `${today.slice(0, 4)}-01-01T00:00:00Z`;
  const fullPer = symbolsPerCall(fullStart, today);
  const fullCap = Math.min(HIST_FULL_CAP, fullPer * HIST_FULL_CALLS);
  const plan = planHistoricals(universe, (snap && snap.hist) || {}, today, { pinned, fullCap });

  const monthStart = isoAgo(365 * 5, today);

  const tailBatches = batches(plan.tail, HIST_TAIL_BATCH);
  const fullBatches = batches(plan.full, fullPer);
  const monthBatches = batches(plan.month, HIST_MONTH_BATCH);
  const quoteBatches = batches(universe, QUOTES_BATCH);
  // Pinned (open-pick) fetches group by start date so each call has one window; ≤3 per call like FULL.
  const pinByStart = {}; for (const r of plan.pin) (pinByStart[r.start] = pinByStart[r.start] || []).push(r.sym);
  const pinBatches = Object.keys(pinByStart).sort().flatMap((st) => batches(pinByStart[st], symbolsPerCall(st, today)).map((syms) => ({ st, syms })));
  const calls = tailBatches.length + pinBatches.length + fullBatches.length + monthBatches.length + quoteBatches.length;

  const out = {
    asOf: today,
    snapshot: snap ? 'read' : 'unavailable',
    universe: universe.length,
    counts: {
      fresh: plan.fresh.length, tail: plan.tail.length, pin: plan.pin.length, full: plan.full.length,
      fullDeferred: plan.fullDeferred.length, month: plan.month.length, monthDeferred: plan.monthDeferred.length,
    },
    calls,
    lines: [
      ...tailBatches.map((syms, i) => ({ kind: 'hist-day-tail', interval: 'day', start_time: tailStart, file: `hist-day-tail-${i + 1}.json`, symbols: syms })),
      ...pinBatches.map((b, i) => ({ kind: 'hist-day-pick', interval: 'day', start_time: `${b.st}T00:00:00Z`, file: `hist-day-pick-${i + 1}.json`, symbols: b.syms })),
      ...fullBatches.map((syms, i) => ({ kind: 'hist-day-full', interval: 'day', start_time: fullStart, file: `hist-day-full-${i + 1}.json`, symbols: syms })),
      ...monthBatches.map((syms, i) => ({ kind: 'hist-month', interval: 'month', start_time: monthStart, file: `hist-month-${i + 1}.json`, symbols: syms })),
      ...quoteBatches.map((syms, i) => ({ kind: 'quotes-bench', file: `quotes-bench-${i + 1}.json`, symbols: syms })),
    ],
  };

  if (asJson) { console.log(JSON.stringify(out, null, 2)); process.exit(0); }

  console.log(`Historicals plan — ${today} · bench ${universe.length} symbols · snapshot ${out.snapshot}`);
  if (!snap) console.log('  ⚠️  no readable snapshot (no data.json / no PF_PASSPHRASE / decrypt failed) —\n' +
    `      failing OPEN: every symbol is treated as unseeded, capped at ${fullCap} YTD fetches this run.`);
  console.log('');
  for (const l of out.lines) {
    if (l.kind === 'quotes-bench') console.log(`QUOTES bench          file=${l.file}  symbols=${l.symbols.join(',')}\n`);
    else console.log(`HIST ${l.interval} ${l.kind.includes('tail') ? 'tail' : l.kind.includes('pick') ? 'pick' : l.kind.includes('full') ? 'full' : '5y  '}  start=${l.start_time}  file=${l.file}  symbols=${l.symbols.join(',')}\n`);
  }
  if (plan.fullDeferred.length) {
    console.log(`  ⏳ ${plan.fullDeferred.length} symbol(s) queued for a later run (YTD cap ${fullCap}/run, priority order) — ` +
      `~${Math.ceil(plan.fullDeferred.length / fullCap)} more FETCH_ALL day(s) to finish seeding.`);
    console.log(`     next up: ${plan.fullDeferred.slice(0, 12).map((r) => `${r.sym}(${tierOf(r.sym, { positions, target })})`).join(', ')}${plan.fullDeferred.length > 12 ? ', …' : ''}`);
  }
  if (plan.monthDeferred.length) console.log(`  ⏳ ${plan.monthDeferred.length} symbol(s) queued for a later monthly refresh (cap ${HIST_MONTH_CAP}/run).`);
  console.log(`\nSUMMARY bench=${universe.length} fresh=${plan.fresh.length} tail=${plan.tail.length} pick=${plan.pin.length} ` +
    `full=${plan.full.length} full-deferred=${plan.fullDeferred.length} month=${plan.month.length} ` +
    `month-deferred=${plan.monthDeferred.length} · calls=${calls} ` +
    `(tail ${tailBatches.length} + pick ${pinBatches.length} + full ${fullBatches.length} + month ${monthBatches.length} + quotes ${quoteBatches.length})`);
  console.log('\nFetch each line with `Robinhood · get_equity_historicals { symbols:[…], interval, start_time }`\n' +
    '(quotes lines use `get_equity_quotes { symbols:[…] }`) and `Write` the VERBATIM result to\n' +
    'producer/raw/<file>. build-data.mjs merges every hist-day*/hist-month*/quotes* file by symbol —\n' +
    'a tail is glued onto the series already held (histbars.mergeBars), never replacing it.');
}
