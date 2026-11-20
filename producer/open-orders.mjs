// v260 (Jack, Nov 20 2026 2:30 AM ET, on a ZS row of the morning ticket: "Why is this showing if the orders in").
// Read-only summary of the ••••0741 (Apex) OPEN sell orders, so the morning ticket can show a row whose order Jack
// already placed as "Placed" instead of a to-do. Source: `get_equity_orders { state_group: "open" }` saved to
// producer/raw/main-open-orders.json (EVERY-RUN). An OCO / TP-SL group's legs are ordinary open equity orders there,
// so one call covers them. DISPLAY ONLY: these prices are never inputs to rules, scoring, R/R or Confirm (v211).
// No order ids are kept. A missing or unreadable file yields null, and the ticket then shows every row (fail open).

const OPEN_STATES = new Set(['new', 'queued', 'confirmed', 'unconfirmed', 'partially_filled']);
const num = (v) => (v != null && v !== '' && Number.isFinite(+v) ? +v : null);

export function summarizeOpenOrders(payload, asOf) {
  const list = payload && payload.data && Array.isArray(payload.data.orders) ? payload.data.orders
    : payload && Array.isArray(payload.orders) ? payload.orders : null;
  if (!list) return null;
  const bySym = {};
  for (const o of list) {
    if (!o || o.side !== 'sell' || !OPEN_STATES.has(String(o.state || '').toLowerCase())) continue;
    const sym = String(o.symbol || '').toUpperCase();
    if (!sym) continue;
    const qty = Math.max(0, (num(o.quantity) || 0) - (num(o.cumulative_quantity) || 0));
    if (!(qty > 0)) continue;
    const isStop = o.trigger === 'stop' || num(o.stop_price) != null && num(o.price) == null;
    const r = bySym[sym] || (bySym[sym] = { stop: null, stopQty: 0, limit: null, limitQty: 0, market: false, placedAt: null });
    if (isStop) { r.stop = num(o.stop_price); r.stopQty = Math.max(r.stopQty, qty); }
    else if (o.type === 'market' || num(o.price) == null) { r.market = true; r.limitQty = Math.max(r.limitQty, qty); }
    else { r.limit = r.limit == null ? num(o.price) : Math.min(r.limit, num(o.price)); r.limitQty = Math.max(r.limitQty, qty); }
    const at = o.created_at || null;
    if (at && (!r.placedAt || at < r.placedAt)) r.placedAt = at;
  }
  return { asOf: asOf || null, bySym };
}
