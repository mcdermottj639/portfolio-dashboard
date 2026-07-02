// Shared market-clock helpers, used by run.mjs (build gate), preflight.mjs (run-mode gate) and the
// freshness watchdog (alarm gate). Single source of truth so they never drift.
//
// Holidays/half-days ARE modeled via the small hardcoded NYSE calendar below — before that,
// a full-closure holiday meant a whole day of pointless runs pushing stale prior-day prices (and a
// stale forward-recorded agentic-equity point), and on a 13:00-close half-day the closing-snapshot
// gate kept re-pushing until 16:00. **Extend the lists once a year.** An unlisted future date fails
// SAFE: it just behaves like the old holiday-blind clock (harmless extra runs, nothing breaks).

// NYSE FULL closures, as ET dates. (Observed dates: when the holiday lands on a weekend the
// adjacent Friday/Monday is listed.)
const HOLIDAYS = new Set([
  // 2026
  '2026-01-01', '2026-01-19', '2026-02-16', '2026-04-03', '2026-05-25',
  '2026-06-19', '2026-07-03', '2026-09-07', '2026-11-26', '2026-12-25',
  // 2027
  '2027-01-01', '2027-01-18', '2027-02-15', '2027-03-26', '2027-05-31',
  '2027-06-18', '2027-07-05', '2027-09-06', '2027-11-25', '2027-12-24',
]);

// NYSE 13:00-ET early closes: the day after Thanksgiving, and Christmas Eve / July 3 when they
// fall on a trading weekday.
const HALF_DAYS = new Set([
  '2026-11-27', '2026-12-24',
  '2027-11-26',
]);

function etParts(now = new Date()) {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(now).reduce((o, x) => (o[x.type] = x.value, o), {});
  return { weekday: p.weekday, mins: (parseInt(p.hour, 10) % 24) * 60 + parseInt(p.minute, 10) };
}

// Is `now` a modeled NYSE full-closure holiday (in ET)?
export function isHoliday(now = new Date()) { return HOLIDAYS.has(etDate(now)); }

// Session close for `now`'s ET date, in minutes-since-midnight: 13:00 on a half-day, else 16:00.
export function closeMinutes(now = new Date()) { return HALF_DAYS.has(etDate(now)) ? 780 : 960; }

// US cash session: Mon–Fri 09:30–close America/New_York, minus full-closure holidays.
export function isMarketOpen(now = new Date()) {
  const { weekday, mins } = etParts(now);
  if (weekday === 'Sat' || weekday === 'Sun') return false;
  if (isHoliday(now)) return false;
  return mins >= 570 && mins < closeMinutes(now); // 9:30 .. 16:00 (13:00 on half-days)
}

// Is `now` a weekday (Mon–Fri) in ET — i.e. a potential trading day. (Holiday-blind by design:
// preflight checks isHoliday separately so its SKIP message can say which gate fired.)
export function isWeekday(now = new Date()) {
  const { weekday } = etParts(now);
  return weekday !== 'Sat' && weekday !== 'Sun';
}

// Minutes-since-midnight of `now` in ET (used to tell a pre-close snapshot from a post-close one).
export function etMinutes(now = new Date()) { return etParts(now).mins; }

// Current Eastern-time calendar date as YYYY-MM-DD (the unit the daily fetch gate keys on).
export function etDate(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d);
}
