// Shared market-clock helpers, used by run.mjs (build gate) and preflight.mjs (run-mode gate).
// Single source of truth so the two never drift. Market holidays aren't modeled — a holiday just
// produces a few harmless extra full runs/year.

function etParts(now = new Date()) {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(now).reduce((o, x) => (o[x.type] = x.value, o), {});
  return { weekday: p.weekday, mins: (parseInt(p.hour, 10) % 24) * 60 + parseInt(p.minute, 10) };
}

// US cash session: Mon–Fri 09:30–16:00 America/New_York.
export function isMarketOpen(now = new Date()) {
  const { weekday, mins } = etParts(now);
  if (weekday === 'Sat' || weekday === 'Sun') return false;
  return mins >= 570 && mins < 960; // 9:30 .. 16:00
}

// Is `now` a weekday (Mon–Fri) in ET — i.e. a potential trading day.
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
