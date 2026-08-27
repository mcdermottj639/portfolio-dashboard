// producer/maindecisions.mjs — PURE derivation of the SELF-DIRECTED account's (••••0741) rebalance log
// from its REAL filled equity orders. No network, no I/O; unit-tested (maindecisions.test.mjs).
//
// WHY THIS EXISTS, AND WHY IT DOESN'T LOOK EXACTLY LIKE THE AGENTIC ONE
// The agentic account already has a Rebalance Log: every deploy/rebalance the executor places is
// APPENDED to the committed producer/agentic-decisions.json at confirm time, then graded vs live
// quotes + SPY by agentic-ledger.mjs. That works because an executor Routine exists to do the
// appending. ••••0741 has no executor — the owner places its trades by hand — so a hand-appended
// ledger on this side would be a card that is empty forever. The account's decisions are already
// recorded somewhere authoritative, though: Robinhood's own order history. So this module DERIVES
// the same record shape from `get_equity_orders`, and everything downstream is genuinely the same
// process — the same `gradeDecisions` from agentic-ledger.mjs, the same SPY-alpha math, the same
// verdicts, the same card.
//
// THREE THINGS ARE LOAD-BEARING:
//
// (a) ORDERS, NEVER A POSITION DIFF. The repo already learned this the expensive way on the
//     wash-sale ledger (CLAUDE.md: "Never infer a realized loss from a position diff") — one run
//     that fetched the wrong account made the next correct fetch look like a mass liquidation, and
//     a phantom loss blocked a real buy for 30 days. A filled order is a fact with a price, a
//     quantity and a timestamp; it cannot drift like that. If the orders file is missing we carry
//     the prior log forward and derive NOTHING.
//
// (b) THE DATE IS THE FILL, IN EASTERN TIME. Two traps in one: `created_at` is when the order was
//     PLACED (a GTC limit sat from 2026-08-14T06:38Z until it filled at 17:21Z), and the raw
//     timestamp is UTC — a fill at 2026-08-10T03:56Z is really the evening of Aug 9 in ET. Group
//     on the placement date and a decision lands on a day nothing happened; group on the UTC date
//     and every after-hours fill is filed a day late, which then looks up the WRONG SPY close and
//     silently biases every alpha figure on the card.
//
// (c) MECHANICAL FILLS ARE NOT DECISIONS. A DRIP reinvestment or a recurring-buy tranche is a
//     standing instruction executing, not an allocation call, and grading it as one dilutes the
//     record with trades nobody chose that week. Same reasoning as flow.mjs's insider scorer
//     counting open-market P/S codes only and dropping the mechanical A/M/G/F ones.

import { etDate } from './market.mjs';

// placed_agent values that mean "a standing instruction fired", not "the owner decided something".
export const MECHANICAL_AGENTS = new Set(['recurring', 'drip']);

// The order-history window the producer asks for (PRODUCER.md step 2). There is deliberately NO
// matching "sweep window" constant: `get_equity_orders` caps its page, so what the fetch asks for and
// what it RETURNS are different things, and the sweep must key off the latter — see deriveLog().
export const FETCH_DAYS = 120;

// How long the snapshot keeps a decision. The fetch window only ever covers the recent past, so
// anything older survives purely by carry-forward, and this is what bounds that growth.
//
// RETENTION IS TIME-BASED, NOT A COUNT. A flat cap of 160 records looked generous and was not: this
// account filled orders on 22 of 78 calendar days, i.e. ~103 records a year, so the cap would have
// begun silently discarding the OLDEST history after ~1.6 years — exactly the history worth having,
// and exactly the kind of silent truncation the repo's own rule says to log rather than hide. Years
// are the honest unit for "keep the record so the model can be judged over time"; the count cap
// stays only as a runaway backstop, set far above any realistic rate.
export const DECISION_RETAIN_YEARS = 8;
export const DECISION_CAP = 2000;

const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };
const up = (s) => String(s || '').toUpperCase();

// Unwrap the MCP envelope the agent writes to raw/ ({data:{orders:[…]}}, {orders:[…]}, or a bare array).
function unwrapOrders(raw) {
  if (Array.isArray(raw)) return raw;
  const d = (raw && raw.data) || raw || {};
  if (Array.isArray(d.orders)) return d.orders;
  if (Array.isArray(d.results)) return d.results;
  return [];
}

// SPY's daily CLOSES keyed by date, for stamping each decision's benchmark price. Accepts BOTH bar
// shapes the two producers emit (raw Robinhood {begins_at,close_price} vs Railway's compact {t,c}) —
// a hard `.begins_at` read throws on Railway data and gets swallowed, which is exactly how histMap
// silently emptied at v50. `interpolated` placeholders and the consumer's spliced `live` bar are
// skipped: neither is a close, and the v111 lesson is that an intraday print must never be treated
// as one.
// SPY's close ON or BEFORE `day`. A fill can legitimately carry a NON-TRADING ET date: an order
// queued or filled in extended/overnight hours gets stamped on the weekend (live check on ••••0741:
// three of 22 trading days derived from real order history landed on a SUNDAY). There is no SPY
// close for a Sunday, and a strict lookup would hand those days `spyAt: null` — dropping the
// benchmark entirely on ~14% of the log. The honest benchmark for a weekend-stamped fill is the last
// close that had actually happened, i.e. Friday's. Walks back at most a week so a genuinely absent
// series still abstains instead of reaching for an arbitrarily old price.
export function closeOnOrBefore(spyCloses, day, maxBack = 7) {
  for (let i = 0; i <= maxBack; i++) {
    const c = spyCloses[shiftDay(day, -i)];
    if (c != null) return { close: c, day: shiftDay(day, -i), stale: i > 0 };
  }
  return null;
}

export function spyClosesFrom(bars = []) {
  const out = {};
  for (const b of bars) {
    if (!b || b.interpolated === true || b.live === true) continue;
    const day = String(b.begins_at || b.t || '').slice(0, 10);
    const close = num(b.close_price ?? b.c);
    if (/^\d{4}-\d{2}-\d{2}$/.test(day) && close > 0) out[day] = close;
  }
  return out;
}

// One filled order → the leg fields we care about, or null if it isn't a real, countable fill.
function legFromOrder(o) {
  if (!o || String(o.state || '').toLowerCase() !== 'filled') return null;
  if (MECHANICAL_AGENTS.has(String(o.placed_agent || '').toLowerCase())) return null;
  const sym = up(o.symbol || o.ticker);
  const qty = num(o.cumulative_quantity ?? o.quantity);
  const px = num(o.average_price ?? o.price);
  if (!sym || !(qty > 0) || !(px > 0)) return null;
  const side = String(o.side || '').toLowerCase() === 'sell' ? 'SELL' : 'BUY';
  // The FILL, not the placement (see (b) above); fall back to created_at only when a payload omits it.
  const stamp = o.last_transaction_at || (Array.isArray(o.executions) && o.executions.length
    ? o.executions[o.executions.length - 1].timestamp : null) || o.created_at;
  const t = Date.parse(stamp);
  if (!Number.isFinite(t)) return null;
  return { sym, side, qty, px, date: etDate(new Date(t)) };
}

// Filled orders → one decision record per trading day, in agentic-ledger.mjs's exact shape so
// gradeDecisions() can grade this side with no special-casing at all.
//   spyCloses: { 'YYYY-MM-DD': close } from spyClosesFrom(data.hist.day.SPY)
//   sinceDay:  optional lower bound; orders older than this are ignored (the fetch window)
export function decisionsFromOrders(raw, { spyCloses = {}, sinceDay = null } = {}) {
  const byDay = new Map();
  for (const o of unwrapOrders(raw)) {
    const leg = legFromOrder(o);
    if (!leg) continue;
    if (sinceDay && leg.date < sinceDay) continue;
    const day = byDay.get(leg.date) || new Map();
    // Several fills of the same name on the same side in one day are ONE leg, share-weighted — the
    // owner adding to PLTR in three clips made one decision, and splitting it would triple-count it
    // in the dollar-weighted contribution.
    const key = leg.sym + '|' + leg.side;
    const prev = day.get(key);
    if (prev) { prev.px = (prev.px * prev.qty + leg.px * leg.qty) / (prev.qty + leg.qty); prev.qty += leg.qty; prev.n += 1; }
    else day.set(key, { sym: leg.sym, side: leg.side, qty: leg.qty, px: leg.px, n: 1 });
    byDay.set(leg.date, day);
  }

  const out = [];
  for (const [date, legs] of byDay) {
    const trades = [...legs.values()]
      .map((l) => ({ sym: l.sym, side: l.side, dollars: +(l.qty * l.px).toFixed(2), shares: +l.qty.toFixed(6), priceAt: +l.px.toFixed(4) }))
      .sort((a, b) => b.dollars - a.dollars);
    const bought = trades.filter((t) => t.side === 'BUY').reduce((s, t) => s + t.dollars, 0);
    const sold = trades.filter((t) => t.side === 'SELL').reduce((s, t) => s + t.dollars, 0);
    const kind = bought > 0 && sold > 0 ? 'rebalance' : (bought > 0 ? 'deploy' : 'raise');
    const fills = [...legs.values()].reduce((s, l) => s + l.n, 0);
    out.push({
      id: `${date}-sd`, date, kind,
      // No historical account equity to attach: Robinhood publishes none, and inventing one from
      // today's book would be a fabricated number on a card whose whole point is honesty.
      book: null, equityAtDecision: null,
      spyAt: (() => { const c = closeOnOrBefore(spyCloses, date); return c ? +c.close : null; })(),
      source: 'orders',
      rationale: `${fills} filled order${fills === 1 ? '' : 's'}${bought > 0 ? ` · bought ${money(bought)}` : ''}${sold > 0 ? ` · sold ${money(sold)}` : ''}`,
      trades,
    });
  }
  return out.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)); // newest first
}

// Accumulate the log in the SNAPSHOT. producer/raw/ is wiped on every scheduled run and the fetch
// only ever covers a recent window, so the snapshot is the only place a full history can live — the
// same reasoning that puts ivHistory and the congressional ledger there rather than in raw/.
//
// Authority rule: for any date the fetch window COVERS, the freshly-derived record wins outright
// (an order may have been added, amended or cancelled since the last run). Dates outside the window
// carry forward untouched. An optional owner-committed producer/main-decisions.json overlays last
// and wins on annotation — that is the manual half of "same process", letting a rebalance carry a
// real rationale — but it never invents legs for a day the broker has no orders for.
export function mergeDecisions(derived = [], prior = [], { windowFrom = null, committed = [], cap = DECISION_CAP, asOf = null, retainYears = DECISION_RETAIN_YEARS } = {}) {
  const byId = new Map();
  for (const d of prior) if (d && d.id) byId.set(d.id, d);
  // Drop stale prior records inside the window: a day the broker no longer reports orders for did
  // not happen (a cancelled/corrected fill), and leaving it would strand a phantom decision forever.
  if (windowFrom) for (const [id, d] of [...byId]) if (d.date >= windowFrom && d.source === 'orders') byId.delete(id);
  for (const d of derived) if (d && d.id) byId.set(d.id, d);
  for (const c of committed) {
    if (!c || !c.id) continue;
    const base = byId.get(c.id);
    byId.set(c.id, base ? { ...base, ...c, trades: (c.trades && c.trades.length) ? c.trades : base.trades, source: 'owner' } : { ...c, source: 'owner' });
  }
  const floor = asOf && retainYears ? shiftDay(asOf, -Math.round(retainYears * 365.25)) : null;
  return [...byId.values()]
    .filter((d) => !floor || !d.date || d.date >= floor)
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
    .slice(0, cap);
}

// 'YYYY-MM-DD' ± n days, UTC-anchored (these are calendar bounds for a window, not market times).
export function shiftDay(day, delta) {
  const d = new Date(String(day).slice(0, 10) + 'T00:00:00Z');
  if (isNaN(d)) return day;
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

// The whole derivation in one call, because the PAGINATION rule below is policy, not plumbing, and
// it must not live in build-data where it can't be tested.
//
// `get_equity_orders` caps its page: a live 120-day fetch on ••••0741 returned 200 orders reaching
// back only ~78 days, with a `next` cursor for the rest. That breaks the naive sweep in the worst
// possible way — the sweep deletes any in-window snapshot record the fresh fetch no longer reports,
// so sweeping a fixed 90 days against a payload that only covers 78 would DELETE twelve days of real,
// correctly-recorded history on every single run. So the sweep window is derived from what the
// payload ACTUALLY covers, never from a constant.
//
// Two rules fall out:
//   · truncated (a `next` cursor)  → the oldest day in the payload may be only PARTIALLY reported
//     (the page boundary can fall mid-day), so that day's derived record is discarded in favour of
//     whatever a complete earlier fetch already recorded, and sweeping starts the day AFTER it.
//   · not truncated               → the payload genuinely covers the whole requested window, so a
//     record inside it that no longer appears really is gone (a cancelled or corrected fill) and
//     sweeping from `sinceDay` is safe.
export function deriveLog(raw, { spyCloses = {}, sinceDay = null } = {}) {
  const orders = unwrapOrders(raw);
  const truncated = !!((raw && raw.data && raw.data.next) || (raw && raw.next));
  let decisions = decisionsFromOrders(raw, { spyCloses, sinceDay });
  const coveredFrom = decisions.length ? decisions[decisions.length - 1].date : null;
  let windowFrom = sinceDay;
  if (truncated) {
    if (coveredFrom) { decisions = decisions.filter((d) => d.date > coveredFrom); windowFrom = shiftDay(coveredFrom, 1); }
    else windowFrom = null;   // truncated with nothing usable ⇒ sweep nothing at all
  }
  return { decisions, windowFrom, truncated, coveredFrom, orders: orders.length };
}

function money(v) { return '$' + Math.round(v).toLocaleString('en-US'); }
