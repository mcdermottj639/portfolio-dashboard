// Which get_option_orders fetch this run needs — prints ONE directive line (no MCP calls, no writes).
//
//   OPTION_ORDERS FULL                  → no full backfill is recorded in the committed snapshot yet:
//                                         fetch EVERY page (follow `next` until empty, no created_at_gte),
//                                         merge all pages' orders into ONE producer/raw/options-orders.json
//                                         as {"fullHistory":true,"data":{"orders":[…all pages…]}}.
//   OPTION_ORDERS SINCE <YYYY-MM-DD>    → incremental: pass created_at_gte:<date>, follow `next` only if
//                                         present, and write the plain {"data":{"orders":[…]}} (NO
//                                         fullHistory flag). Prior orders/settlements live in the encrypted
//                                         snapshot and are merged by id, so a short window loses nothing.
//
// The window is min(today − INCREMENTAL_DAYS, the creation date of any retained order that is still
// non-terminal − 1 day), because the only historical orders that can still CHANGE are working ones
// (a GTC sell-to-open filling weeks later). Filled/cancelled/rejected orders are final.
//
// Settlements need NO extra call: expirations are read from main-trades.json (get_pnl_trade_history,
// already EVERY-RUN) by option-history.mjs, and stored in the snapshot once matched.
//
// Fails OPEN to FULL (no snapshot / no PF_PASSPHRASE / decrypt failure): for this account a full
// fetch is one or two pages, while a silently short window could miss a fill.
import { readSnapshot } from './fetchgate.mjs';

export const INCREMENTAL_DAYS = 14;
const WORKING = new Set(['queued', 'confirmed', 'partially_filled', 'unconfirmed', 'pending_cancelled']);
const day = (d) => new Date(d).toISOString().slice(0, 10);

export function optionFetchPlan(ledger, now = new Date()) {
  if (!ledger || !ledger.fullHistoryAt) return { mode: 'FULL', reason: ledger ? 'no full backfill recorded' : 'no retained option ledger' };
  let since = new Date(now.getTime() - INCREMENTAL_DAYS * 864e5);
  for (const o of ledger.orders || []) {
    if (!WORKING.has(o.state)) continue;
    const t = Date.parse(o.created || o.date);
    if (!Number.isFinite(t)) return { mode: 'FULL', reason: `working order ${o.id} has no usable date` };
    if (t - 864e5 < since.getTime()) since = new Date(t - 864e5);
  }
  return { mode: 'SINCE', since: day(since), reason: `backfilled ${String(ledger.fullHistoryAt).slice(0, 10)}` };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const snap = await readSnapshot();
  const plan = optionFetchPlan(snap?.options?.incomeHistory);
  console.log(plan.mode === 'FULL' ? 'OPTION_ORDERS FULL' : `OPTION_ORDERS SINCE ${plan.since}`);
  console.log(`  (${plan.reason})`);
}
