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
import { analyzeUniverse, heldFromRaw, targetSymbols, tierOf } from './analyze-universe.mjs';
import { gradingUniverse } from './pickgrade.mjs';

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

  const tail = [], full = [], fullDeferred = [], fresh = [];
  const monthDue = [], monthDeferred = [];

  for (const sym of universe) {
    const last = lastBarDate(day[sym]);
    const age = last ? daysBetween(last, today) : null;
    // A future-dated bar (clock skew, a bad fixture) is not evidence of staleness — treat it as 0.
    const a = age == null ? null : Math.max(0, age);
    if (a != null && a <= 0) fresh.push({ sym, age: a, last });
    else if (a != null && a <= d.tailDays) tail.push({ sym, age: a, last });
    else if (full.length < d.fullCap) full.push({ sym, age: a, last });
    else fullDeferred.push({ sym, age: a, last });

    const mLast = lastBarDate(month[sym]);
    const mAge = mLast ? Math.max(0, daysBetween(mLast, today)) : null;
    if (mAge == null || mAge > d.monthStale) {
      if (monthDue.length < d.monthCap) monthDue.push({ sym, age: mAge, last: mLast });
      else monthDeferred.push({ sym, age: mAge, last: mLast });
    }
  }
  return { tail, full, fullDeferred, fresh, month: monthDue, monthDeferred };
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
  const positions = heldFromRaw();
  const target = targetSymbols();
  // The picks GRADING universe (pickgrade.mjs — archived Daily Picks whose outcome is still being
  // measured) rides in right behind holdings + target: the Track Record can only grade a name whose
  // closes kept arriving, and this is the fetch that keeps them arriving. Read from the same snapshot,
  // so it costs no extra decrypt; a missing/ungradeable snapshot yields an empty list, never a throw.
  let grading = [];
  try { const pk = snap && snap.picks; grading = gradingUniverse((pk && pk.history) || [], { asOf: today, grades: pk && pk.grades }); } catch { grading = []; }
  const base = analyzeUniverse({ positions, target });
  const pri = new Set([...positions, ...target].map((x) => String(x || '').toUpperCase()));
  const universe = [...new Set([...base.filter((x) => pri.has(x)), ...grading.map((x) => String(x).toUpperCase()), ...base.filter((x) => !pri.has(x))])];
  const plan = planHistoricals(universe, (snap && snap.hist) || {}, today);

  const tailStart = isoAgo(HIST_TAIL_LOOKBACK, today);
  const fullStart = `${today.slice(0, 4)}-01-01T00:00:00Z`;
  const monthStart = isoAgo(365 * 5, today);

  const tailBatches = batches(plan.tail, HIST_TAIL_BATCH);
  const fullBatches = batches(plan.full, HIST_FULL_BATCH);
  const monthBatches = batches(plan.month, HIST_MONTH_BATCH);
  const quoteBatches = batches(universe, QUOTES_BATCH);
  const calls = tailBatches.length + fullBatches.length + monthBatches.length + quoteBatches.length;

  const out = {
    asOf: today,
    snapshot: snap ? 'read' : 'unavailable',
    universe: universe.length,
    counts: {
      fresh: plan.fresh.length, tail: plan.tail.length, full: plan.full.length,
      fullDeferred: plan.fullDeferred.length, month: plan.month.length, monthDeferred: plan.monthDeferred.length,
    },
    calls,
    lines: [
      ...tailBatches.map((syms, i) => ({ kind: 'hist-day-tail', interval: 'day', start_time: tailStart, file: `hist-day-tail-${i + 1}.json`, symbols: syms })),
      ...fullBatches.map((syms, i) => ({ kind: 'hist-day-full', interval: 'day', start_time: fullStart, file: `hist-day-full-${i + 1}.json`, symbols: syms })),
      ...monthBatches.map((syms, i) => ({ kind: 'hist-month', interval: 'month', start_time: monthStart, file: `hist-month-${i + 1}.json`, symbols: syms })),
      ...quoteBatches.map((syms, i) => ({ kind: 'quotes-bench', file: `quotes-bench-${i + 1}.json`, symbols: syms })),
    ],
  };

  if (asJson) { console.log(JSON.stringify(out, null, 2)); process.exit(0); }

  console.log(`Historicals plan — ${today} · bench ${universe.length} symbols · snapshot ${out.snapshot}`);
  if (!snap) console.log('  ⚠️  no readable snapshot (no data.json / no PF_PASSPHRASE / decrypt failed) —\n' +
    `      failing OPEN: every symbol is treated as unseeded, capped at ${HIST_FULL_CAP} YTD fetches this run.`);
  console.log('');
  for (const l of out.lines) {
    if (l.kind === 'quotes-bench') console.log(`QUOTES bench          file=${l.file}  symbols=${l.symbols.join(',')}\n`);
    else console.log(`HIST ${l.interval} ${l.kind.includes('tail') ? 'tail' : l.kind.includes('full') ? 'full' : '5y  '}  start=${l.start_time}  file=${l.file}  symbols=${l.symbols.join(',')}\n`);
  }
  if (plan.fullDeferred.length) {
    console.log(`  ⏳ ${plan.fullDeferred.length} symbol(s) queued for a later run (YTD cap ${HIST_FULL_CAP}/run, priority order) — ` +
      `~${Math.ceil(plan.fullDeferred.length / HIST_FULL_CAP)} more FETCH_ALL day(s) to finish seeding.`);
    console.log(`     next up: ${plan.fullDeferred.slice(0, 12).map((r) => `${r.sym}(${tierOf(r.sym, { positions, target })})`).join(', ')}${plan.fullDeferred.length > 12 ? ', …' : ''}`);
  }
  if (plan.monthDeferred.length) console.log(`  ⏳ ${plan.monthDeferred.length} symbol(s) queued for a later monthly refresh (cap ${HIST_MONTH_CAP}/run).`);
  console.log(`\nSUMMARY bench=${universe.length} fresh=${plan.fresh.length} tail=${plan.tail.length} ` +
    `full=${plan.full.length} full-deferred=${plan.fullDeferred.length} month=${plan.month.length} ` +
    `month-deferred=${plan.monthDeferred.length} · calls=${calls} ` +
    `(tail ${tailBatches.length} + full ${fullBatches.length} + month ${monthBatches.length} + quotes ${quoteBatches.length})`);
  console.log('\nFetch each line with `Robinhood · get_equity_historicals { symbols:[…], interval, start_time }`\n' +
    '(quotes lines use `get_equity_quotes { symbols:[…] }`) and `Write` the VERBATIM result to\n' +
    'producer/raw/<file>. build-data.mjs merges every hist-day*/hist-month*/quotes* file by symbol —\n' +
    'a tail is glued onto the series already held (histbars.mergeBars), never replacing it.');
}
