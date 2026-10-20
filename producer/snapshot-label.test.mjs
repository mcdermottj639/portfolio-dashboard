// Offline unit checks for snapshot-label.mjs — no network, no I/O. Run: node producer/snapshot-label.test.mjs
import { etLabel, parseEtLabel, resolveLabel, LABEL_MISMATCH_MIN } from './snapshot-label.mjs';

let pass = 0, fail = 0;
const ok = (label, cond) => { if (cond) pass++; else { fail++; console.error(`✗ ${label}`); } };
const eq = (label, a, b) => ok(`${label} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`, a === b);

// Formatting in America/New_York, both sides of DST, regardless of host TZ.
eq('EDT morning', etLabel(new Date('2026-10-19T10:40:38Z')), 'Oct 19 2026, 6:40 AM ET');
eq('EDT afternoon', etLabel(new Date('2026-10-19T20:42:04Z')), 'Oct 19 2026, 4:42 PM ET');
eq('EST', etLabel(new Date('2026-12-01T14:05:00Z')), 'Dec 1 2026, 9:05 AM ET');
eq('midnight is 12 AM', etLabel(new Date('2026-10-20T04:03:00Z')), 'Oct 20 2026, 12:03 AM ET');
eq('noon is 12 PM', etLabel(new Date('2026-10-19T16:00:00Z')), 'Oct 19 2026, 12:00 PM ET');
eq('ET date differs from UTC date', etLabel(new Date('2026-10-20T01:30:00Z')), 'Oct 19 2026, 9:30 PM ET');

// Round trip.
for (const iso of ['2026-10-19T10:40:00Z', '2026-12-01T14:05:00Z', '2026-10-20T04:03:00Z']) {
  const d = new Date(iso);
  eq(`round trip ${iso}`, parseEtLabel(etLabel(d))?.toISOString(), d.toISOString());
}
eq('unparseable → null', parseEtLabel('2026-10-19 10:40 UTC'), null);

// The real regressions: commit time vs supplied label from git history.
const cases = [
  ['a47a832', '2026-10-14T10:39:34Z', 'Oct 14 2026, 10:45 AM ET'],
  ['f1422bd', '2026-10-15T09:40:01Z', 'Oct 15 2026, 9:40 AM ET'],
  ['203f9d8', '2026-10-16T09:40:23Z', 'Oct 16 2026, 9:45 AM ET'],
  ['c50b8d4', '2026-10-19T09:45:56Z', 'Oct 19 2026, 9:40 AM ET'],
];
for (const [sha, iso, supplied] of cases) {
  const r = resolveLabel(supplied, new Date(iso));
  ok(`${sha}: label is clock-derived, not the supplied one`, r.label === etLabel(new Date(iso)) && r.label !== supplied);
  ok(`${sha}: ~4h drift flagged`, r.warning && r.driftMin > 3.5 * 60 && r.driftMin < 4.5 * 60);
}

// Benign rounding (+5 min, e.g. 27172e4) is not flagged, but the label is still the clock.
const benign = resolveLabel('Oct 19 2026, 6:45 AM ET', new Date('2026-10-19T10:40:38Z'));
eq('benign label = clock', benign.label, 'Oct 19 2026, 6:40 AM ET');
eq('benign drift', benign.driftMin, 4);
eq('benign no warning', benign.warning, null);
ok('threshold sane', LABEL_MISMATCH_MIN >= 10 && LABEL_MISMATCH_MIN <= 30);

// No argument / garbage argument.
eq('no arg → clock', resolveLabel(undefined, new Date('2026-10-19T10:40:38Z')).label, 'Oct 19 2026, 6:40 AM ET');
const junk = resolveLabel('6:45ish', new Date('2026-10-19T10:40:38Z'));
ok('garbage arg warns and uses clock', junk.warning && junk.label === 'Oct 19 2026, 6:40 AM ET');

console.log(`\nsnapshot-label.test: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
