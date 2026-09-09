/* Tests for producer/pickgrade.mjs — the Daily-Picks track record.
   Every case here maps to a defect the shipped card actually had on the live 2026-09-08 snapshot. */
import assert from 'node:assert/strict';
import {
  closeSeries, pickEpisodes, gradeEpisode, gradeAll, gradeStats, gradingUniverse,
  EPISODE_GAP_DAYS, GRADE_HORIZON_DAYS, BAR_REACH_DAYS,
} from './pickgrade.mjs';

const bar = (t, c, extra = {}) => ({ begins_at: t + 'T00:00:00Z', close_price: String(c), ...extra });
const compact = (t, c, extra = {}) => ({ t, c, ...extra });
// A run of consecutive weekday-ish dates; good enough for a closing-basis walk.
function seriesFrom(startISO, closes, shape = bar) {
  const d0 = Date.parse(startISO + 'T00:00:00Z');
  return closes.map((c, i) => shape(new Date(d0 + i * 864e5).toISOString().slice(0, 10), c));
}
const PK = { ticker: 'XYZ', entryRef: 100, basePrice: 100, tp1: 110, tp2: 120, sl: 90 };
const scan = (ts, picks) => ({ ts, date: ts, picks });

let n = 0; const t = (name, fn) => { fn(); n++; };

/* ── closeSeries: the documented two bar shapes, and what must be dropped ─────────────────────── */
t('closeSeries accepts BOTH producer bar shapes and drops junk rows', () => {
  const s = closeSeries([
    bar('2026-07-01', 10), compact('2026-07-02', 11),
    bar('2026-07-03', 12, { interpolated: true }),   // gap-fill, carries no information
    compact('2026-07-04', 13, { live: true }),        // the consumer's spliced intraday print
    bar('2026-07-05', 0),                             // unpriced
  ]);
  assert.deepEqual(s.map((x) => x.t), ['2026-07-01', '2026-07-02']);
  assert.deepEqual(s.map((x) => x.c), [10, 11]);
});
t('closeSeries dedupes a date (latest wins) and sorts ascending', () => {
  const s = closeSeries([bar('2026-07-03', 30), bar('2026-07-01', 10), bar('2026-07-01', 11)]);
  assert.deepEqual(s, [{ t: '2026-07-01', c: 11 }, { t: '2026-07-03', c: 30 }]);
});

/* ── episodes: one broken thesis re-picked daily is ONE outcome (the ORCL 0W·10L distortion) ──── */
t('pickEpisodes collapses re-picks inside the gap window into one episode', () => {
  const eps = pickEpisodes([
    scan('2026-07-01', [{ ...PK }]), scan('2026-07-02', [{ ...PK }]), scan('2026-07-08', [{ ...PK }]),
  ]);
  assert.equal(eps.length, 1);
  assert.equal(eps[0].count, 3);
  assert.equal(eps[0].firstTs, '2026-07-01');   // graded from the EARLIEST entry
  assert.equal(eps[0].key, 'XYZ|2026-07-01');
});
t('pickEpisodes starts a new episode past the gap window', () => {
  const gap = EPISODE_GAP_DAYS + 1;
  const later = new Date(Date.parse('2026-07-01T00:00:00Z') + gap * 864e5).toISOString().slice(0, 10);
  const eps = pickEpisodes([scan('2026-07-01', [{ ...PK }]), scan(later, [{ ...PK }])]);
  assert.equal(eps.length, 2);
});

/* ── the three rules ──────────────────────────────────────────────────────────────────────────── */
t('RULE (a): a series that stops days after the scan is UNMEASURED, never OPEN', () => {
  // The exact live failure: picked 2026-07-08, bars stop 2026-07-15, "today" is 2026-09-08.
  const g = gradeEpisode(PK, seriesFrom('2026-07-08', [100, 101, 102, 101, 103, 102]), { from: '2026-07-08', asOf: '2026-09-08' });
  assert.equal(g.status, 'UNMEASURED');
  assert.equal(g.resolved, false);
  assert.equal(g.ret, null, 'must not price a return off a series that merely stops');
});
t('RULE (a): ZERO bars after the scan date is UNMEASURED, not OPEN', () => {
  const g = gradeEpisode(PK, seriesFrom('2026-06-01', [95, 96, 97]), { from: '2026-07-08', asOf: '2026-09-08' });
  assert.equal(g.status, 'UNMEASURED');
  assert.equal(g.measuredThrough, null);
});
t('a series that DOES reach the measurement date is OPEN, with a return', () => {
  const g = gradeEpisode(PK, seriesFrom('2026-09-01', [100, 101, 102, 103, 104, 105, 104, 103]), { from: '2026-09-01', asOf: '2026-09-08' });
  assert.equal(g.status, 'OPEN');
  assert.ok(Number.isFinite(g.ret));
  assert.equal(g.retBasis, 'mark');
});
t('the reach tolerance covers a weekend/holiday tail but not a stale series', () => {
  const closes = new Array(20).fill(100);
  const justInside = gradeEpisode(PK, seriesFrom('2026-08-20', closes), { from: '2026-08-20', asOf: '2026-09-12' });
  assert.equal(justInside.status, 'OPEN');   // last bar 2026-09-08, asOf 09-12, inside BAR_REACH_DAYS
  const justOutside = gradeEpisode(PK, seriesFrom('2026-08-20', closes), { from: '2026-08-20', asOf: '2026-09-20' });
  assert.equal(justOutside.status, 'UNMEASURED');
  assert.ok(BAR_REACH_DAYS >= 3, 'must tolerate a long weekend');
});

t('RULE (c): a STOPPED episode returns at its STOP, not marked to a later rally', () => {
  // ORCL live: stopped out, then rallied — the card showed "⛔ STOPPED · +18.3%".
  const g = gradeEpisode(PK, seriesFrom('2026-08-01', [100, 95, 89, 95, 130, 140]), { from: '2026-08-01', asOf: '2026-08-06' });
  assert.equal(g.status, 'STOPPED');
  assert.equal(g.statusDate, '2026-08-03');
  assert.equal(g.exitPx, 90);
  assert.equal(g.ret, -10, 'a stopped trade returns -10%, not the +40% it went on to make without us');
  assert.equal(g.retBasis, 'exit');
});
t('RULE (c): a TP2 episode returns at its target', () => {
  const g = gradeEpisode(PK, seriesFrom('2026-08-01', [100, 105, 121, 100]), { from: '2026-08-01', asOf: '2026-08-04' });
  assert.equal(g.status, 'TP2');
  assert.equal(g.ret, 20);
});
t('TP1 banks first, and a later stop cannot turn that win into a loss', () => {
  const g = gradeEpisode(PK, seriesFrom('2026-08-01', [100, 111, 105, 89]), { from: '2026-08-01', asOf: '2026-08-04' });
  assert.equal(g.status, 'TP1');
  assert.equal(g.ret, 10);
});
t('the stop is tested BEFORE the targets on the same bar (a close cannot be both)', () => {
  const g = gradeEpisode({ ...PK, sl: 121 }, seriesFrom('2026-08-01', [100, 125]), { from: '2026-08-01', asOf: '2026-08-02' });
  assert.equal(g.status, 'STOPPED');
});
t('grading is CLOSING-basis: an intraday spliced bar cannot trip a stop', () => {
  const bars = [...seriesFrom('2026-08-01', [100, 101, 102]), compact('2026-08-04', 80, { live: true })];
  const g = gradeEpisode(PK, bars, { from: '2026-08-01', asOf: '2026-08-03' });
  assert.notEqual(g.status, 'STOPPED');
});

t('past the horizon an untouched episode EXPIRES rather than running forever', () => {
  const closes = new Array(GRADE_HORIZON_DAYS + 12).fill(100);
  const g = gradeEpisode(PK, seriesFrom('2026-06-01', closes), { from: '2026-06-01', asOf: '2026-08-10' });
  assert.equal(g.status, 'EXPIRED');
  assert.ok(Number.isFinite(g.ret));
});
t('the horizon CLOSES the window — a level touched after it does not count', () => {
  const closes = new Array(GRADE_HORIZON_DAYS + 5).fill(100); closes[GRADE_HORIZON_DAYS + 3] = 125;
  const g = gradeEpisode(PK, seriesFrom('2026-06-01', closes), { from: '2026-06-01', asOf: '2026-08-10' });
  assert.equal(g.status, 'EXPIRED', 'a target hit two months after the scan is not this pick working');
});
t('a pick with no levels at all cannot resolve, and says so', () => {
  const g = gradeEpisode({ ticker: 'Z', entryRef: 100 }, seriesFrom('2026-09-01', [100, 200, 50, 100, 100, 100]), { from: '2026-09-01', asOf: '2026-09-06' });
  assert.equal(g.status, 'OPEN');
  assert.equal(g.resolved, false);
});

/* ── RULE (b): frozen outcomes ────────────────────────────────────────────────────────────────── */
t('RULE (b): a resolved outcome is stamped once and survives its bars going stale', () => {
  const hist = [scan('2026-08-01', [PK])];
  const bars = { XYZ: seriesFrom('2026-08-01', [100, 95, 89]) };
  const first = gradeAll(hist, bars, { asOf: '2026-08-03' });
  assert.equal(first.episodes[0].status, 'STOPPED');
  // Months later the series is long stale — without the freeze this would fall back to UNMEASURED.
  const later = gradeAll(hist, bars, { asOf: '2026-11-01', prior: first });
  assert.equal(later.episodes[0].status, 'STOPPED');
  assert.equal(later.episodes[0].ret, -10);
  assert.equal(later.episodes[0].frozen, true);
});
t('a frozen mark is NOT re-derived even when new bars would grade it differently', () => {
  const hist = [scan('2026-08-01', [PK])];
  const first = gradeAll(hist, { XYZ: seriesFrom('2026-08-01', [100, 95, 89]) }, { asOf: '2026-08-03' });
  const rich = gradeAll(hist, { XYZ: seriesFrom('2026-08-01', [100, 105, 121, 130]) }, { asOf: '2026-08-04', prior: first });
  assert.equal(rich.episodes[0].status, 'STOPPED', 'history does not get rewritten by later data');
});
t('an UNMEASURED episode is retried (fresh bars must be able to rescue it)', () => {
  const hist = [scan('2026-08-01', [PK])];
  const blind = gradeAll(hist, { XYZ: [] }, { asOf: '2026-09-08' });
  assert.equal(blind.episodes[0].status, 'UNMEASURED');
  const seeing = gradeAll(hist, { XYZ: seriesFrom('2026-08-01', [100, 105, 121]) }, { asOf: '2026-08-03', prior: blind });
  assert.equal(seeing.episodes[0].status, 'TP2', 'abstention is not frozen — only a real outcome is');
});
t('a frozen outcome survives its own first scan AGEING OUT of the capped history', () => {
  // picks.history is capped at 40 scans, so an episode's earliest scan eventually falls off and its
  // `sym|firstTs` key shifts. Without the contiguity fallback a recorded WIN silently reverts to
  // "can't be graded" — the very failure this module exists to prevent, re-entering by the back door.
  const bars = { XYZ: seriesFrom('2026-08-01', [100, 112, 113]) };
  const full = gradeAll([scan('2026-08-01', [PK]), scan('2026-08-05', [PK])], bars, { asOf: '2026-08-05' });
  assert.equal(full.episodes[0].status, 'TP1');
  const truncated = gradeAll([scan('2026-08-05', [PK])], { XYZ: [] }, { asOf: '2026-11-01', prior: full });
  assert.equal(truncated.episodes[0].status, 'TP1');
  assert.equal(truncated.episodes[0].key, 'XYZ|2026-08-01', 'identity must not shift again next run');
  assert.equal(truncated.episodes[0].frozen, true);
});
t('a genuinely SEPARATE later episode never inherits an older outcome', () => {
  const bars = { XYZ: seriesFrom('2026-08-01', [100, 112, 113]) };
  const first = gradeAll([scan('2026-08-01', [PK])], bars, { asOf: '2026-08-03' });
  assert.equal(first.episodes[0].status, 'TP1');
  // A fresh scan well past the gap window is a NEW thesis and must be graded on its own merits.
  const far = new Date(Date.parse('2026-08-03T00:00:00Z') + (EPISODE_GAP_DAYS + 10) * 864e5).toISOString().slice(0, 10);
  const next = gradeAll([scan(far, [PK])], { XYZ: [] }, { asOf: far, prior: first });
  assert.equal(next.episodes[0].status, 'UNMEASURED');
  assert.notEqual(next.episodes[0].frozen, true);
});
t('a re-pick that extends a frozen episode keeps the outcome but updates the count', () => {
  const first = gradeAll([scan('2026-08-01', [PK])], { XYZ: seriesFrom('2026-08-01', [100, 95, 89]) }, { asOf: '2026-08-03' });
  const again = gradeAll([scan('2026-08-01', [PK]), scan('2026-08-05', [PK])], { XYZ: [] }, { asOf: '2026-08-06', prior: first });
  assert.equal(again.episodes[0].status, 'STOPPED');
  assert.equal(again.episodes[0].count, 2);
});

/* ── stats ────────────────────────────────────────────────────────────────────────────────────── */
t('hit rate counts RESOLVED only; unmeasured episodes never enter the average', () => {
  const s = gradeStats([
    { status: 'TP2', ret: 20 }, { status: 'STOPPED', ret: -10 },
    { status: 'OPEN', ret: 3 }, { status: 'UNMEASURED', ret: null }, { status: 'EXPIRED', ret: 1 },
  ]);
  assert.equal(s.resolved, 2); assert.equal(s.hitRate, 50);
  assert.equal(s.unmeasured, 1); assert.equal(s.open, 1); assert.equal(s.expired, 1);
  assert.equal(s.avgRetN, 4);
  assert.equal(Math.round(s.avgRet * 100) / 100, 3.5);
});
t('a card with nothing measurable reports NO hit rate rather than 0%', () => {
  const s = gradeStats([{ status: 'UNMEASURED', ret: null }, { status: 'UNMEASURED', ret: null }]);
  assert.equal(s.hitRate, null, '0% is a claim; "—" is the truth when nothing could be graded');
  assert.equal(s.avgRet, null);
});

/* ── the fetch universe ───────────────────────────────────────────────────────────────────────── */
t('gradingUniverse asks only for episodes still running inside their horizon', () => {
  const hist = [
    scan('2026-09-01', [{ ...PK, ticker: 'RUN' }]),
    scan('2026-09-01', [{ ...PK, ticker: 'DONE' }]),
    scan('2026-05-01', [{ ...PK, ticker: 'OLD' }]),
  ];
  const grades = { episodes: [{ key: 'DONE|2026-09-01', resolved: true, status: 'TP2' }] };
  const u = gradingUniverse(hist, { asOf: '2026-09-08', grades });
  assert.ok(u.includes('RUN'));
  assert.ok(!u.includes('DONE'), 'frozen — never needs a price again');
  assert.ok(!u.includes('OLD'), 'past its horizon — never needs a price again');
});
t('gradingUniverse is ordered most-starved first and respects the cap', () => {
  const hist = [scan('2026-09-06', [{ ...PK, ticker: 'FRESH' }]), scan('2026-08-15', [{ ...PK, ticker: 'STARVED' }])];
  const u = gradingUniverse(hist, { asOf: '2026-09-08', grades: null, cap: 1 });
  assert.deepEqual(u, ['STARVED']);
});
t('gradingUniverse DRAINS as episodes resolve (this is what bounds the fetch)', () => {
  const hist = [scan('2026-09-01', [{ ...PK, ticker: 'A' }]), scan('2026-09-01', [{ ...PK, ticker: 'B' }])];
  assert.equal(gradingUniverse(hist, { asOf: '2026-09-08', grades: null }).length, 2);
  const after = { episodes: [{ key: 'A|2026-09-01', resolved: true }, { key: 'B|2026-09-01', resolved: true }] };
  assert.equal(gradingUniverse(hist, { asOf: '2026-09-08', grades: after }).length, 0);
});
t('empty / malformed history is inert everywhere', () => {
  assert.deepEqual(pickEpisodes(null), []);
  assert.deepEqual(gradingUniverse(undefined, { asOf: '2026-09-08' }), []);
  const g = gradeAll(null, {}, { asOf: '2026-09-08' });
  assert.deepEqual(g.episodes, []);
  assert.equal(g.stats.hitRate, null);
});

console.log(`pickgrade.test.mjs — ${n} assertions groups passed ✅`);
