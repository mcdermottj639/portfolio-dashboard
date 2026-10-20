// producer/snapshot-label.mjs — the snapshot's human-readable time label, derived from the clock.
//
// Why (2026-10-19): the label used to be whatever string the scheduled agent typed as run.mjs's
// first argument. On four early-morning runs (a47a832 Oct 14, f1422bd Oct 15, 203f9d8 Oct 16,
// c50b8d4 Oct 19) that string was ~4h AHEAD of the real commit time — the UTC wall-clock written
// with an "ET" suffix — so generatedAtLabel, the in-app freshness text and the commit subject all
// disagreed with generatedAt. The label now comes from the same instant as generatedAt, formatted
// explicitly in America/New_York. A supplied argument is still accepted (callers need not change)
// but is only compared and logged, never trusted.

const TZ = 'America/New_York';
export const LABEL_MISMATCH_MIN = 15;

const fmt = new Intl.DateTimeFormat('en-US', {
  timeZone: TZ, month: 'short', day: 'numeric', year: 'numeric',
  hour: 'numeric', minute: '2-digit', hour12: true,
});

// "Oct 19 2026, 6:45 AM ET" — the exact shape the scheduled prompts have always produced.
export function etLabel(date = new Date()) {
  const p = Object.fromEntries(fmt.formatToParts(date).map((x) => [x.type, x.value]));
  return `${p.month} ${p.day} ${p.year}, ${p.hour}:${p.minute} ${p.dayPeriod.toUpperCase()} ET`;
}

// Parse "Mon D YYYY, H:MM AM ET" back to an instant (ET offset resolved for that date). null if unparseable.
export function parseEtLabel(s) {
  const m = /^([A-Z][a-z]{2}) (\d{1,2}) (\d{4}), (\d{1,2}):(\d{2}) (AM|PM) ET$/.exec(String(s || '').trim());
  if (!m) return null;
  const mon = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'].indexOf(m[1]);
  if (mon < 0) return null;
  const h = (Number(m[4]) % 12) + (m[6] === 'PM' ? 12 : 0);
  const wall = Date.UTC(Number(m[3]), mon, Number(m[2]), h, Number(m[5]));
  // Find the ET offset in effect at that wall time (EDT -4h or EST -5h).
  for (const off of [4, 5]) {
    const t = new Date(wall + off * 3600e3);
    if (etLabel(t) === `${m[1]} ${Number(m[2])} ${m[3]}, ${Number(m[4])}:${m[5]} ${m[6]} ET`) return t;
  }
  return null;
}

// Returns { label, supplied, driftMin, warning }. label is always clock-derived.
export function resolveLabel(supplied, now = new Date()) {
  const label = etLabel(now);
  if (!supplied) return { label, supplied: null, driftMin: null, warning: null };
  const t = parseEtLabel(supplied);
  if (!t) return { label, supplied, driftMin: null, warning: `supplied label "${supplied}" is not "Mon D YYYY, H:MM AM ET" — using clock label "${label}"` };
  const driftMin = Math.round((t - now) / 60e3);
  const warning = Math.abs(driftMin) > LABEL_MISMATCH_MIN
    ? `supplied label "${supplied}" is ${driftMin > 0 ? '+' : ''}${driftMin} min from the clock — using clock label "${label}"`
    : null;
  return { label, supplied, driftMin, warning };
}
