// Weekly gate for the agentic-account research refresh — the deterministic "is the deep research due?"
// check the producer runs (post-publish, best-effort) before re-running the agentic-research workflow.
// Keyed off the committed producer/agentic-target.json `asOf` (the only state that survives the
// producer's fresh-clone runs), so it fires ~once a week regardless of which run lands on it and
// self-heals if a run is missed. Mirrors preflight.mjs's exit-code convention.
//
//   exit 0  → AGENTIC_DUE      (target missing, or not yet refreshed this week → run the research)
//   exit 20 → AGENTIC_NOT_DUE  (already refreshed this week and recently → skip; ~zero cost)
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { etDate } from './market.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

// THE GATE IS A CALENDAR-WEEK TEST, NOT AN AGE TEST (2026-09-03) — because an age test cannot be
// made to work here, and this is the SECOND time it silently ate a week.
//
// The Routine fires on a weekly cron (`12 11 * * 1`, Mondays) while `asOf` is stamped whenever
// finalize-target happens to write. An age threshold N therefore blocks the Monday fire for every
// target written 1..N-1 days before it — i.e. for a whole band of weekdays. The first version used
// `>= 7`, which blocked a target written any day but the previous Monday: on 2026-08-31 the Routine
// fired, ran 109 seconds, printed AGENTIC_NOT_DUE and stopped — reporting SUCCEEDED, because
// stopping cleanly IS success — and the target aged to 8 days, which pushed MA and V past
// ENTRY_ZONE_STALE_DAYS so the deploy planner waived their entry bands entirely.
//
// That was "fixed" by dropping to 6 on the reasoning that every committed target had landed on a
// TUESDAY (Monday minus the previous Tuesday = 6). Two of them had actually landed on a WEDNESDAY,
// and so did the current one: `asOf` 2026-09-02 is a Wednesday, so the 2026-09-07 fire would have
// seen a 5-day-old target, printed NOT_DUE, and skipped the week all over again. Picking a smaller
// N just moves which weekdays are fatal; it never removes them.
//
// The cadence is what is actually being expressed, so encode THAT: the research is due whenever the
// committed target was not refreshed during the current ET week (weeks starting Monday, matching the
// cron's own day). A target written any time last week makes Monday due; one written earlier today
// or later this week does not. REFRESH_DAYS survives only as an absolute-staleness backstop, so a
// schedule change or a stalled week still forces a refresh eventually.
//
// The asymmetry that settles the direction of the errors: running a day early costs one research
// pass, while not running costs a WHOLE WEEK — and a stale target is invisible, because what shows
// up downstream is the deploy planner quietly waiving entry bands. Err toward running.
export const REFRESH_DAYS = 6;

/* Monday of the ET week containing `day` (YYYY-MM-DD → YYYY-MM-DD). Weeks start Monday to match the
   research cron; a Sunday belongs to the week that began the previous Monday. */
export function weekStart(day) {
  const d = new Date(day + 'T00:00:00Z');
  if (isNaN(d)) return day;
  const dow = (d.getUTCDay() + 6) % 7;            // Mon=0 … Sun=6
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}

/* Pure gate. `asOf` = the committed target's date, `today` = the ET date of this run. */
export function researchDue(asOf, today) {
  if (!asOf || !/^\d{4}-\d{2}-\d{2}$/.test(String(asOf))) {
    return { due: true, asOf: asOf || null, ageDays: null, reason: 'no committed target' };
  }
  const ageDays = Math.floor((Date.parse(today + 'T00:00:00Z') - Date.parse(asOf + 'T00:00:00Z')) / 86400000);
  const ws = weekStart(today);
  // A future-dated target reads as this week's (asOf >= ws) and a negative age, so it correctly
  // fails both arms rather than forcing a refresh off a clock skew.
  if (asOf < ws) return { due: true, asOf, ageDays, reason: `last refreshed before this week (week of ${ws})` };
  if (ageDays >= REFRESH_DAYS) return { due: true, asOf, ageDays, reason: `${ageDays}d old ≥ ${REFRESH_DAYS}d staleness backstop` };
  return { due: false, asOf, ageDays, reason: `already refreshed this week (week of ${ws}), ${ageDays}d ago` };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const tf = join(__dirname, 'agentic-target.json');
  let r = { due: true, asOf: null, ageDays: null, reason: 'no committed target' };
  try {
    if (existsSync(tf)) {
      const t = JSON.parse(readFileSync(tf, 'utf8'));
      r = researchDue((t && t.asOf) || null, etDate());
    }
  } catch { r = { due: true, asOf: null, ageDays: null, reason: 'target unreadable — failing open' }; }

  console.log(r.due
    ? `AGENTIC_DUE (target asOf ${r.asOf || 'none'}${r.ageDays != null ? `, ${r.ageDays}d old` : ''} — ${r.reason} → refresh the research target)`
    : `AGENTIC_NOT_DUE (target asOf ${r.asOf} — ${r.reason} → skip)`);
  process.exit(r.due ? 0 : 20);
}
