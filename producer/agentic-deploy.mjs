// producer/agentic-deploy.mjs — PURE deployment / rebalance planner for the agentic cash account.
//
// Turns (research target + current holdings + idle cash + live prices) into a READY-TO-CONFIRM ticket,
// enforcing the execution discipline the old flow only described in prose:
//   • EARNINGS BLACKOUT — never put NEW money into a name inside `earningsBlackoutDays` (7) of its report.
//     A pre-print gap of 5-10% overnight can erase the edge; wait for the number, then buy with full info.
//   • GAP-THROUGH-ENTRY RE-VERIFY — if a name has fallen BELOW its target stop (setup broken) or below its
//     planned entry zone (thesis in question), do NOT auto-buy the "bargain". Defer it for a fresh look —
//     a stock crashing through the level we planned to buy at is exactly when the thesis needs re-checking
//     (this is the GOOGL-gaps-after-earnings case that prompted the feature).
//   • WASH-SALE — never rebuy a name we booked a loss on inside the 30-day window (reads data.agentic
//     recentLosses via washMap).
//   • CASH-FLOW-FIRST / SETTLEMENT — deploying NEW cash needs no sells; when a trim is required (a name
//     drifted over target), it's sequenced first and flagged T+1 (cash account, no freeriding).
//
// Buys move each underweight name only toward its (already cluster/vol-capped) target weight, so honoring
// the target inherently respects the risk caps riskweights.mjs enforced when the target was built.
//
// PURE + unit-tested (agentic-deploy.test.mjs). The producer/agent turns `.buys`/`.trims` into
// review_equity_order → confirm → place (owner-confirmed; alert & one-tap per AGENTIC.md).

export const EARNINGS_BLACKOUT_DAYS = 7;

const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };
const money = (n) => '$' + (Math.round(n * 100) / 100).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
// entry zones are "745-755" | "745–755" | "745" → numeric low
function entryLow(entry) {
  if (entry == null) return null;
  const m = String(entry).match(/-?\d+(\.\d+)?/g);
  return m && m.length ? num(m[0]) : null;
}

export function planDeployment(input = {}) {
  const {
    target = {}, positions = [], cash = 0, quotes = {},
    earnings = {}, washMap = {}, opts = {},
  } = input;
  const blackout = opts.earningsBlackoutDays ?? EARNINGS_BLACKOUT_DAYS;
  const gapReverify = opts.gapReverify !== false;
  const names = (target.names || []).filter((n) => n && n.ticker).map((n) => ({ ...n, ticker: String(n.ticker).toUpperCase() }));
  const driftPp = num(target.driftTriggerPp) ?? 5;

  const pxOf = (sym) => {
    const q = quotes[sym];
    if (q == null) return null;
    if (typeof q === 'number') return q;
    return num(q.last_trade_price ?? q.px ?? q.price ?? q.last_extended_hours_trade_price ?? q.adjusted_previous_close);
  };
  const held = {};
  for (const p of positions) {
    const s = String(p.symbol || p.ticker || '').toUpperCase(); if (!s) continue;
    const qty = num(p.qty ?? p.quantity) || 0;
    const px = pxOf(s) ?? num(p.px) ?? num(p.avgCost) ?? 0;
    held[s] = { qty, px, value: qty * px, avgCost: num(p.avgCost ?? p.average_buy_price) };
  }
  const investedVal = Object.values(held).reduce((s, h) => s + h.value, 0);
  const book = opts.book != null ? opts.book : +(investedVal + (num(cash) || 0)).toFixed(2);

  const buys = [], trims = [], deferred = [], warnings = [];
  const currentWeights = {}, targetWeights = {};

  // 1. classify each target name: underweight → buy candidate; over-drift → trim; then apply guardrails.
  const candidates = [];
  for (const n of names) {
    const sym = n.ticker;
    const tw = num(n.weightPct) || 0;
    targetWeights[sym] = tw;
    const h = held[sym] || { qty: 0, px: pxOf(sym) || 0, value: 0 };
    const cw = book > 0 ? +(100 * h.value / book).toFixed(2) : 0;
    currentWeights[sym] = cw;
    const targetDollars = book * tw / 100;
    const gap = +(targetDollars - h.value).toFixed(2); // >0 underweight (buy), <0 overweight
    const px = pxOf(sym) ?? h.px;
    const stop = num(n.stop), eLow = entryLow(n.entry);
    const ern = earnings[sym];
    const daysAway = ern ? (num(ern.daysAway) ?? daysUntil(ern.date, opts.asOf)) : null;

    if (gap > 0.5) {
      // guardrails (order = most-blocking first)
      if (washMap[sym]) {
        deferred.push({ sym, reason: 'wash-sale', detail: `loss booked recently; rebuy blocked to ${washMap[sym].until || '?'}`, until: washMap[sym].until, dollars: gap });
        continue;
      }
      if (daysAway != null && daysAway >= 0 && daysAway <= blackout) {
        deferred.push({ sym, reason: 'earnings', detail: `reports ${ern.date || `in ${daysAway}d`} (≤${blackout}d) — wait for the print, then buy`, until: ern.date, dollars: gap });
        continue;
      }
      if (gapReverify && px != null && stop != null && px <= stop) {
        deferred.push({ sym, reason: 'below-stop', detail: `${money(px)} is at/below target stop ${money(stop)} — setup broken, re-verify before buying`, dollars: gap });
        continue;
      }
      if (gapReverify && px != null && eLow != null && px < eLow) {
        deferred.push({ sym, reason: 'below-entry', detail: `${money(px)} gapped below planned entry ${n.entry} — re-verify the thesis (esp. post-earnings) before deploying`, dollars: gap });
        continue;
      }
      candidates.push({ sym, gap, px, cw, tw, sector: n.sector, entry: n.entry, stop, tgt: num(n.target) });
    } else if (gap < 0 && (cw - tw) >= driftPp && h.qty > 0) {
      // over target beyond the drift band → trim (taxable — flag, sequence first, T+1 settle)
      const shares = px > 0 ? +(Math.abs(gap) / px).toFixed(4) : null;
      trims.push({ sym, dollars: +Math.abs(gap).toFixed(2), shares, price: px, weightNow: cw, weightTarget: tw,
        note: `over target by ${(cw - tw).toFixed(1)}pp — taxable trim, sells settle T+1 (sequence before buys)` });
    }
  }

  // 2. distribute available cash across eligible buys, proportional to each name's gap, capped at the gap
  //    (never overshoot target → never breach the target's risk caps). Trims free cash too, but as a cash
  //    account their proceeds are unsettled (T+1) so we deploy only the settled `cash` today.
  const deployable = Math.max(0, num(cash) || 0);
  const totalGap = candidates.reduce((s, c) => s + c.gap, 0);
  let spent = 0;
  if (candidates.length && deployable > 0 && totalGap > 0) {
    const scale = Math.min(1, deployable / totalGap); // pro-rate if cash < total need
    for (const c of candidates) {
      const dollars = +(Math.min(c.gap, c.gap * scale)).toFixed(2);
      if (dollars < 1) continue;
      const shares = c.px > 0 ? +(dollars / c.px).toFixed(4) : null;
      spent += dollars;
      buys.push({ sym: c.sym, dollars, shares, price: c.px, weightNow: c.cw, weightTarget: c.tw, sector: c.sector,
        entry: c.entry, stop: c.stop, target: c.tgt,
        note: `${c.cw.toFixed(1)}% → ${c.tw}% target` });
    }
  }
  const deferredCash = deferred.reduce((s, d) => s + Math.max(0, d.dollars || 0), 0);
  const cashLeft = +(deployable - spent).toFixed(2);

  if (!names.length) warnings.push('no research target loaded — cannot plan a deployment');
  if (deferred.length) warnings.push(`${deferred.length} name(s) deferred (${deferred.map((d) => d.sym).join(', ')}) — ~${money(deferredCash)} of intended weight held pending earnings/re-verify/wash-sale`);
  if (candidates.length && deployable > 0 && spent < deployable - 1) warnings.push(`${money(cashLeft)} left uninvested (eligible buys fully funded to target; rest waits for deferred names to clear)`);

  const summary = buildSummary({ buys, trims, deferred, spent, cashLeft, book });
  return { book, cash: deployable, currentWeights, targetWeights, buys, trims, deferred, deferredCash: +deferredCash.toFixed(2), spent: +spent.toFixed(2), cashLeft, warnings, summary };
}

function buildSummary({ buys, trims, deferred, spent, cashLeft, book }) {
  const parts = [];
  if (buys.length) parts.push(`Deploy ${moneyS(spent)} across ${buys.length} name(s): ${buys.map((b) => `${b.sym} ${moneyS(b.dollars)}`).join(', ')}.`);
  else parts.push('No eligible buys this pass.');
  if (trims.length) parts.push(`Trim first (T+1): ${trims.map((t) => `${t.sym} ${moneyS(t.dollars)}`).join(', ')}.`);
  if (deferred.length) parts.push(`Hold ${moneyS(deferred.reduce((s, d) => s + Math.max(0, d.dollars || 0), 0))} for ${deferred.map((d) => `${d.sym} (${d.reason})`).join(', ')}.`);
  if (cashLeft > 1) parts.push(`${moneyS(cashLeft)} stays in cash.`);
  return parts.join(' ');
}
function moneyS(n) { return '$' + (Math.round(n * 100) / 100).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 }); }
function daysUntil(dateStr, asOf) {
  if (!dateStr) return null;
  const a = asOf ? Date.parse(asOf + 'T00:00:00Z') : Date.now();
  const d = Date.parse(String(dateStr).slice(0, 10) + 'T00:00:00Z');
  if (!Number.isFinite(a) || !Number.isFinite(d)) return null;
  return Math.round((d - a) / 86400000);
}
