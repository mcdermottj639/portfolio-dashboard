// producer/realizedpnl.mjs — PURE normalizers for Robinhood's realized P&L endpoints.
//
// WHY THIS EXISTS. The Income & Tax card's "Realized — YTD" tile used to read producer/realized.json,
// an OWNER-MAINTAINED figure typed in by hand from Robinhood's tax center. Two things were wrong with
// that: it went stale the moment a trade closed (it was carried forward run after run, so it froze at
// whatever was last typed), and it only ever described the MARGIN book — the agentic ••••3900 cash
// account's realized gains were nowhere in the dashboard at all.
//
// The Robinhood connector does expose the real thing (it just wasn't wired up):
//   • get_realized_pnl        → bucketed realized gain + trade counts for a window, per asset class.
//   • get_pnl_trade_history   → the individual closing trades with their realized gain/loss.
// The producer fetches both PER ACCOUNT; these helpers turn the raw payloads into the snapshot shapes.
//
// Everything here is pure (no I/O, no clock) so it can be unit-tested offline — realizedpnl.test.mjs.

const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };

// Unwrap the connector's envelope. Responses arrive as {data:{…}}, occasionally already unwrapped,
// and sometimes wrapped again by the agent's Write (a {result:…} / {structuredContent:…} shell) —
// accept all of them rather than making the fetch step's exact shape load-bearing.
export function unwrapPnl(raw) {
  let r = raw;
  for (let i = 0; i < 4 && r && typeof r === 'object'; i++) {
    if (r.data_points || r.trades) return r;
    if (r.data) { r = r.data; continue; }
    if (r.structuredContent) { r = r.structuredContent; continue; }
    if (r.result) { r = typeof r.result === 'string' ? safeParse(r.result) : r.result; continue; }
    break;
  }
  return r && typeof r === 'object' ? r : {};
}
function safeParse(s) { try { return JSON.parse(s); } catch { return {}; } }

// One get_realized_pnl response → { total, trades, window }. Buckets with a null realized_gain are
// TRANSFER-ONLY buckets (lots with no cost basis) — per the endpoint's own guidance they are "n/a",
// not $0, so they contribute nothing to either the sum or the trade count.
export function sumRealized(raw) {
  const r = unwrapPnl(raw);
  const pts = Array.isArray(r.data_points) ? r.data_points : [];
  let total = 0, trades = 0, seen = 0;
  for (const p of pts) {
    const g = num(p && p.realized_gain);
    if (g == null) continue;
    total += g; seen++;
    trades += Math.max(0, parseInt(p.number_of_trades, 10) || 0);
  }
  // total_returns is the endpoint's own window total — prefer it when present (it is authoritative and
  // avoids float drift across ~30 buckets); fall back to the bucket sum when the field is absent.
  const stated = num(r.total_returns);
  return {
    total: +(stated != null ? stated : total).toFixed(2),
    trades,
    window: r.window || null,
    buckets: seen,
  };
}

// Per-account realized, assembled from the two asset-class calls. `equity`/`options` are raw
// get_realized_pnl responses (either may be absent — an account with no options level has none).
export function accountRealized({ equity, options, label, mask } = {}) {
  const e = equity ? sumRealized(equity) : null;
  const o = options ? sumRealized(options) : null;
  const out = {
    label: label || null,
    mask: mask || null,
    equity: e ? e.total : null,
    options: o ? o.total : null,
    trades: (e ? e.trades : 0) + (o ? o.trades : 0),
  };
  out.total = +(((out.equity || 0) + (out.options || 0))).toFixed(2);
  out.window = (e && e.window) || (o && o.window) || null;
  return out;
}

// Combine the per-account blocks into the snapshot's data.realized. The TOP-LEVEL equity/options/total
// are ALL-ACCOUNT sums — a consumer that only knows the old flat shape then shows a correct combined
// number rather than a margin-only one — and `accounts` carries the per-account split the card renders.
export function buildRealized({ accounts = {}, year, asOf } = {}) {
  const keys = Object.keys(accounts).filter((k) => accounts[k]);
  const sum = (f) => {
    const vals = keys.map((k) => accounts[k][f]).filter((v) => v != null);
    return vals.length ? +vals.reduce((s, v) => s + v, 0).toFixed(2) : null;
  };
  const equity = sum('equity'), options = sum('options');
  return {
    year: year || null,
    asOf: asOf || null,
    source: 'robinhood',
    approx: false,          // broker-reported, not an average-cost estimate — the old owner figure was
    accounts,
    equity,
    options,
    total: +(((equity || 0) + (options || 0))).toFixed(2),
  };
}

// get_pnl_trade_history → the REAL dated realized losses for the wash-sale ledger.
//
// This replaces an inference that was demonstrably wrong. Without a trade feed, build-data used to
// reconstruct losses by diffing prior→fresh agentic positions ("a holding reduced while underwater =
// a realized loss, dated today"). Any run where the agentic fetch returned the WRONG account's
// positions makes the next correct fetch look like a mass liquidation — which is exactly what
// happened: five losses were booked on 2026-08-03 (LLY/NVDA/TSM/CIFR/IREN) for an account that had
// no closing trades that week and had never held three of those names. NVDA was then wash-sale
// blocked for 30 days off a loss that never occurred. Real closing trades can't drift like that.
//
// Returns [{ sym, date, realized, exitPx, account? }] for LOSSES only (realized_gain < 0) inside the
// window, most recent first, one entry per symbol+date (the largest loss wins a same-day duplicate).
//
// `account` tags which taxable account booked the loss ('agentic' | 'main'). The IRS wash-sale window
// is PER TAXPAYER, not per account — a loss realized in the self-directed margin book is disallowed by
// an agentic rebuy just the same. The ledger therefore merges BOTH taxable accounts' losses (the 2026
// NVDA case: the owner sold 35 NVDA at a −$431.76 loss in ••••0741 on Jul 29 and the agentic executor,
// whose ledger only read ••••3900's empty trade history, bought NVDA back on Aug 11 inside the window).
export function lossesFromTrades(raw, { asOf, days = 31, account } = {}) {
  const r = unwrapPnl(raw);
  const trades = Array.isArray(r.trades) ? r.trades : [];
  const cutoff = asOf ? shiftDays(asOf.slice(0, 10), -days) : null;
  const byKey = new Map();
  for (const t of trades) {
    const g = num(t && t.realized_gain);
    if (g == null || g >= 0) continue;                       // gains aren't wash-sale relevant
    const sym = String(t.symbol || '').toUpperCase();
    const date = String(t.timestamp || '').slice(0, 10);
    if (!sym || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    if (cutoff && date < cutoff) continue;
    const key = sym + '|' + date;
    const entry = { sym, date, realized: +g.toFixed(2), exitPx: num(t.price) != null ? +num(t.price).toFixed(4) : null };
    if (account) entry.account = account;
    const prev = byKey.get(key);
    if (!prev || entry.realized < prev.realized) byKey.set(key, entry);
  }
  return [...byKey.values()].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

function shiftDays(day, delta) {
  const d = new Date(day + 'T00:00:00Z');
  if (isNaN(d)) return day;
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}
