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

// v267 (Jack, Nov 25 2026: "Yes, mark buys too"): ••••0741 BUY orders for the Apex morning ticket's "Placed" mark on
// buy rows. NO new fetch: it reads the two files the refresh already saves — the open orders above and the incremental
// filled-order window (raw/main-orders-incremental.json, EVERY-RUN) — both requested for the ••••0741 account only.
// Publishes symbol → { at, state } where `at` is the LATEST creation time among that symbol's buy orders that are open
// (queued / confirmed / partially filled) or filled. Cancelled, rejected, failed and expired orders never count, a sell
// never counts, and an order that carries an account number not ending 0741 is ignored. No prices, quantities or ids
// are kept. The ticket compares `at` with the research timestamp (a buy placed before the scan is not this ticket's).
// DISPLAY ONLY: never an input to rules, scoring, R/R or Confirm (v211). Both inputs unreadable ⇒ null (fail open).
const BUY_STATES = { open: new Set(['new', 'queued', 'confirmed', 'unconfirmed', 'partially_filled']), filled: new Set(['filled']) };

function ordersOf(input) {
  let p = input;
  for (let i = 0; i < 6 && p; i++) {
    if (p.structuredContent) p = p.structuredContent;
    else if (p.content && p.content[0] && typeof p.content[0].text === 'string') p = JSON.parse(p.content[0].text);
    else if (p.payload) p = p.payload;
    else if (p.data && !Array.isArray(p.orders) && !Array.isArray(p.results)) p = p.data;
    else break;
  }
  const list = p && (Array.isArray(p.orders) ? p.orders : Array.isArray(p.results) ? p.results : null);
  return list || null;
}

export function summarizeBuyOrders(openPayload, filledPayload, asOf) {
  const lists = [];
  for (const src of [openPayload, filledPayload]) { try { const l = src ? ordersOf(src) : null; if (l) lists.push(l); } catch (_) { /* unreadable input: skip */ } }
  if (!lists.length) return null;
  const bySym = {};
  for (const o of lists.flat()) {
    if (!o || o.side !== 'buy') continue;
    const state = String(o.state || '').toLowerCase();
    const kind = BUY_STATES.open.has(state) ? 'open' : BUY_STATES.filled.has(state) ? 'filled' : null;
    if (!kind) continue;
    if (o.account_number != null && !String(o.account_number).endsWith('0741')) continue;
    const sym = String(o.symbol || '').toUpperCase();
    const at = o.created_at && Number.isFinite(Date.parse(o.created_at)) ? new Date(Date.parse(o.created_at)).toISOString() : null;
    if (!sym || !at) continue;
    const r = bySym[sym];
    if (!r || at > r.at) bySym[sym] = { at, state: kind };
  }
  return { asOf: asOf || null, bySym };
}
