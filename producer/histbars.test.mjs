// producer/histbars.test.mjs — bar compaction (see histbars.mjs for why it exists).
import { compactBar, compactSeries, compactHist, mergeBars, mergeHist } from './histbars.mjs';
import { twrSeries, benchSeries } from './drawdown.mjs';
import { spyClosesFrom } from './maindecisions.mjs';

let pass = 0, fail = 0;
const eq = (label, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok  ${label}`); }
  else { fail++; console.log(`  FAIL ${label}\n       got  ${g}\n       want ${w}`); }
};
const ok = (label, cond) => eq(label, !!cond, true);

console.log('histbars');

// The real payload shape, copied verbatim from the live 2026-09-08 snapshot (NVDA).
const RAW = {
  begins_at: '2026-09-04T00:00:00Z',
  open_price: '231.090000',
  close_price: '230.360000',
  high_price: '234.760000',
  low_price: '229.630000',
  volume: 135352420,
  session: 'reg',
};

eq('raw bar → compact', compactBar(RAW), {
  t: '2026-09-04T00:00:00Z', c: 230.36, h: 234.76, l: 229.63, v: 135352420,
});

ok('open_price is gone', compactBar(RAW).open_price === undefined);
ok('session is gone', compactBar(RAW).session === undefined);
ok('compaction actually shrinks the bar',
  JSON.stringify(compactBar(RAW)).length < JSON.stringify(RAW).length * 0.6);

// (a) IDEMPOTENT — build-data re-compacts its own carried-forward output every run.
eq('idempotent', compactBar(compactBar(RAW)), compactBar(RAW));
eq('idempotent over a whole series',
  compactSeries(compactSeries([RAW, RAW])), compactSeries([RAW, RAW]));

// Already-compact (Railway) input is accepted unchanged in substance.
eq('railway {t,c,v} shape survives',
  compactBar({ t: '2026-06-02T00:00:00Z', c: 12.5, v: 100 }),
  { t: '2026-06-02T00:00:00Z', c: 12.5, v: 100 });

// (c) timestamp copied verbatim, never reformatted.
eq('timestamp untouched', compactBar(RAW).t, '2026-09-04T00:00:00Z');
eq('a date-only timestamp is equally untouched',
  compactBar({ t: '2026-09-04', c: '10' }).t, '2026-09-04');

// (d) omit a field only where the reader's fallback is the same value.
eq('h/l equal to close are dropped (reader falls back to c)',
  compactBar({ begins_at: 'T', close_price: '10', high_price: '10', low_price: '10' }),
  { t: 'T', c: 10 });
eq('zero volume dropped (reader falls back to 0)',
  compactBar({ begins_at: 'T', close_price: '10', volume: 0 }), { t: 'T', c: 10 });
eq('a real high/low is KEPT',
  compactBar({ begins_at: 'T', close_price: '10', high_price: '11', low_price: '9' }),
  { t: 'T', c: 10, h: 11, l: 9 });

// interpolated: stored only when true, but never lost when it is.
eq('interpolated:false is dropped',
  compactBar({ begins_at: 'T', close_price: '10', interpolated: false }), { t: 'T', c: 10 });
eq('interpolated:true SURVIVES (readers filter on it)',
  compactBar({ begins_at: 'T', close_price: '10', interpolated: true }),
  { t: 'T', c: 10, interpolated: true });
eq('live:true survives (gradePick filters on it)',
  compactBar({ t: 'T', c: 10, live: true }), { t: 'T', c: 10, live: true });

// (b) length preserved, junk passed through untouched.
const withJunk = [RAW, { begins_at: 'T2', close_price: '0' }, { begins_at: 'T3' }, RAW];
eq('series length preserved exactly', compactSeries(withJunk).length, 4);
eq('a zero close is still a bar (never dropped — tail-index alignment)',
  compactSeries(withJunk)[1], { t: 'T2', c: 0 });
eq('a bar with no close passes through UNTOUCHED',
  compactSeries(withJunk)[2], { begins_at: 'T3' });

// hist block shape.
const H = compactHist({ day: { NVDA: [RAW] }, month: { SPY: [RAW] }, junk: null });
eq('day compacted', H.day.NVDA[0].c, 230.36);
eq('month compacted', H.month.SPY[0].c, 230.36);
eq('non-object interval passes through', H.junk, null);
eq('compactHist is idempotent', compactHist(H), H);
eq('null hist is inert', compactHist(null), null);

// ---------------------------------------------------------------------------
// The point of the whole exercise: every real downstream reader must produce
// IDENTICAL output from the raw bars and from the compacted ones.
// ---------------------------------------------------------------------------
const day = (d, c, extra = {}) => ({
  begins_at: `2026-06-${String(d).padStart(2, '0')}T00:00:00Z`,
  open_price: String(c - 0.5), close_price: c.toFixed(6),
  high_price: (c + 1).toFixed(6), low_price: (c - 1).toFixed(6),
  volume: 1000 + d, session: 'reg', ...extra,
});
const rawSeries = [day(1, 100), day(2, 101), day(3, 99, { interpolated: true }), day(4, 103), day(5, 105)];
const cmpSeries = compactSeries(rawSeries);

eq('drawdown.benchSeries: identical from both shapes',
  benchSeries(cmpSeries), benchSeries(rawSeries));
ok('drawdown.benchSeries actually returned data', benchSeries(rawSeries).length > 0);

eq('maindecisions.spyClosesFrom: identical from both shapes',
  spyClosesFrom(cmpSeries), spyClosesFrom(rawSeries));
ok('spyClosesFrom actually returned data', Object.keys(spyClosesFrom(rawSeries)).length > 0);

// The consumer's azSeries, reproduced exactly as index.html:5878 writes it.
const azSeries = (bars) => {
  const out = [];
  for (const x of bars) {
    const c = parseFloat(x.close_price != null ? x.close_price : x.c);
    if (!(c > 0)) continue;
    out.push({
      c,
      h: parseFloat(x.high_price || x.h || c),
      l: parseFloat(x.low_price || x.l || c),
      v: parseFloat(x.volume || x.v || 0),
      t: x.begins_at || x.t,
    });
  }
  return out;
};
eq('consumer azSeries: identical from both shapes', azSeries(cmpSeries), azSeries(rawSeries));
ok('azSeries actually returned data', azSeries(rawSeries).length === 5);

// twrSeries is fed equity points, not bars, but drawdown passes a bench through benchSeries —
// prove the pairing end to end on the shape build-data actually hands it.
const eqHist = [{ t: '2026-06-01', equity: 100, cumFlow: 0 }, { t: '2026-06-05', equity: 110, cumFlow: 0 }];
ok('twrSeries unaffected by bar shape', twrSeries(eqHist).length === 2);

// Measured saving on the real shape.
const before = JSON.stringify(rawSeries).length;
const after = JSON.stringify(cmpSeries).length;
console.log(`  ..  ${before} → ${after} bytes (${(100 - (100 * after) / before).toFixed(0)}% smaller)`);
ok('saves at least 45% on the real bar shape', after < before * 0.55);


// --- TAIL MERGE (v140) -------------------------------------------------------------------------
// The whole point of the wide bench: a 7-bar tail must glue onto a series we already hold, without
// losing anything, without duplicating a date, and without churning the snapshot on a re-run.
console.log('histbars — mergeBars');
{
  const day = (d, c, extra) => ({ t: `2026-0${d.slice(0,1)}-${d.slice(1)}T00:00:00Z`, c, ...(extra || {}) });
  const prior = [day('601', 10), day('602', 11), day('603', 12)];

  // 1. A tail that overlaps by one bar: the series grows by exactly the NEW dates.
  const fresh = [day('603', 12.5), day('604', 13), day('605', 14)];
  const m = mergeBars(prior, fresh);
  eq('tail merge keeps prior head and appends the new dates', m.map((b) => b.t.slice(0, 10)),
    ['2026-06-01', '2026-06-02', '2026-06-03', '2026-06-04', '2026-06-05']);
  eq('fresh wins the shared date', m[2].c, 12.5);
  eq('no duplicate dates', m.length, new Set(m.map((b) => b.t.slice(0, 10))).size);

  // 2. IDEMPOTENT — build-data re-runs this over its own output every hour.
  eq('merge(merge(x)) === merge(x)', mergeBars(m, fresh), m);
  eq('merging a series with itself is a no-op', mergeBars(m, m), m);
  eq('an empty fresh fetch leaves the series alone', mergeBars(prior, []), prior);
  eq('no prior at all yields the fresh tail', mergeBars(undefined, fresh), fresh);

  // 3. A SHORT/whole-range fetch must never truncate. This is the case the old whole-array spread
  //    got wrong: a fetch that came back short replaced the series and the history was gone.
  const short = [day('604', 13), day('605', 14)];
  eq('a fetch shorter than the series we hold cannot shorten it', mergeBars(prior, short).length, 5);
  const full = [day('601', 9), day('602', 9.5), day('604', 13)];
  const fm = mergeBars(prior, full);
  eq('a full refetch wins every date it reports', [fm[0].c, fm[1].c], [9, 9.5]);
  eq('…and a date only PRIOR holds survives (a gap is data we own, not data to discard)',
    fm.map((b) => b.t.slice(0, 10)), ['2026-06-01', '2026-06-02', '2026-06-03', '2026-06-04']);

  // 4. Sorting + the placeholder/live rules.
  eq('output is sorted ascending regardless of input order',
    mergeBars([day('605', 14), day('601', 10)], [day('603', 12)]).map((b) => b.c), [10, 12, 14]);
  const withInterp = mergeBars([day('601', 10), day('602', 11, { interpolated: true })], [day('603', 12)]);
  eq('interpolated placeholders are kept exactly as today (readers filter them, not us)',
    withInterp[1].interpolated, true);
  eq('a live:true bar is dropped defensively — an intraday print is not a close',
    mergeBars([day('601', 10), day('602', 99, { live: true })], [day('603', 12)]).map((b) => b.c), [10, 12]);

  // 5. Compaction still sees every bar exactly once, and its invariants are untouched.
  eq('merge then compact preserves the merged length', compactSeries(m).length, m.length);
  eq('compacting a merged series is idempotent', compactSeries(compactSeries(m)), compactSeries(m));

  // 6. mergeHist: per interval, per symbol, with one-sided intervals passing through.
  const h = mergeHist(
    { day: { AAA: prior, BBB: prior }, month: { AAA: prior } },
    { day: { AAA: fresh, CCC: fresh } });
  eq('a freshly-fetched symbol merges', h.day.AAA.length, 5);
  eq('an unfetched symbol carries forward untouched', h.day.BBB.length, 3);
  eq('a brand-new symbol is added', h.day.CCC.length, 3);
  eq('an interval with no fresh fetch at all carries forward', h.month.AAA.length, 3);
  eq('mergeHist is idempotent', mergeHist(h, {}), h);
}
console.log(`\nhistbars: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);