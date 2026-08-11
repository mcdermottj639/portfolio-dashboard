// producer/agentic-deploy.mjs — PURE deployment / rebalance planner for the agentic account (••••3900).
//
// Turns (research target + current holdings + idle cash + live prices) into a READY-TO-CONFIRM ticket,
// enforcing the execution discipline the old flow only described in prose:
//   • EARNINGS BLACKOUT — never put NEW money into a name inside `earningsBlackoutDays` (7) of its report.
//     A pre-print gap of 5-10% overnight can erase the edge; wait for the number, then buy with full info.
//   • POLICY BLACKOUT — the same rule for a SCHEDULED policy decision (tariff ruling, PDUFA date,
//     antitrust judgment) inside `policyBlackoutDays` (7), read from producer/policy.json via policy.mjs.
//     Only high-impact events block, and it no-ops entirely while that calendar is empty (the default).
//   • GAP-THROUGH-ENTRY RE-VERIFY — if a name has fallen BELOW its target stop (setup broken) or below its
//     planned entry zone (thesis in question), do NOT auto-buy the "bargain". Defer it for a fresh look —
//     a stock crashing through the level we planned to buy at is exactly when the thesis needs re-checking
//     (this is the GOOGL-gaps-after-earnings case that prompted the feature).
//   • WASH-SALE — never rebuy a name we booked a loss on inside the 30-day window (reads data.agentic
//     recentLosses via washMap).
//   • CASH-FLOW-FIRST / SETTLEMENT — deploying NEW cash needs no sells; when a trim is required (a name
//     drifted over target), it's sequenced first so its proceeds fund the buys.
//   • NO INTRADAY ROUND TRIPS — never sell a name this account bought TODAY (see PDT note below).
//
// v98 — LIMITED MARGIN (2026-08-11). The owner upgraded ••••3900 from a cash account to **limited
// margin**: proceeds from a closing order are spendable IMMEDIATELY, with no borrowing and no leverage
// (`unleveraged_buying_power == buying_power`). Two consequences, both encoded here:
//   1. THE T+1 LEG IS GONE. The planner used to split buys into `buys` (settled cash, today) and
//      `buysT1` (sale proceeds, next session) purely because a cash account can't spend unsettled
//      proceeds without freeriding. Now sale proceeds fund buys in the SAME session, so there is one
//      allocation pass over (cash + proceeds). This is also strictly better sizing: the old leg-1
//      pro-rated over settled cash alone and topped names up a day later, which could underfill a name
//      overnight. `buysT1` is retained in the RESULT as an always-empty array only so in-flight tickets
//      written under the old model (and the consumer that reads `legs.buysT1`) keep working — new plans
//      never populate it. Sells are still sequenced FIRST: instant settlement means "spendable once the
//      sell FILLS", not "spendable before it fills", so the executor still places sells, confirms the
//      fills, then places buys.
//   2. PDT NOW APPLIES. A limited-margin account is a margin account for FINRA purposes, so the
//      pattern-day-trader rule bites: 4+ day trades in 5 rolling business days with equity under
//      $25,000 gets the account restricted. This book is ~$5k, and the executor runs hourly — exactly
//      the shape that could stumble into it (buy a name at 10am, have the research drop it, sell it at
//      2pm = one day trade). A cash account had no such rule, so nothing guarded against it before.
//      Rather than count day trades and creep toward the limit, `accountActivity` blocks the whole
//      class: a name this account BOUGHT TODAY is not sold today. Zero round trips ⇒ PDT can never
//      accrue, and the only cost is that a same-day reversal waits one session — which the drift band
//      and the 5-day ticket staleness window already tolerate.
//
// v96 — the planner became FULL-BOOK (it used to see only target names, which left off-target
// holdings invisible — 40% of the book once sat in names the research had dropped, with no ticket):
//   • OFF-TARGET EXITS — a held name absent from the target is an explicit SELL-to-exit, sequenced
//     with the other sells. The research dropping a name IS the sell signal; before v96 it was a
//     prose footnote in the card hand-off and the deploy planner never saw it.
//   • TAX-AWARE SALE ORDERING + ESTIMATES — every sell (exit/trim/harvest) carries an estimated
//     realized P&L vs avg cost (all lots in this account are short-term); the combined `sells` list
//     is ordered losses-first (harvest what we're selling anyway), then smallest gain first.
//     `taxSummary` nets the ticket's ST gains against its losses.
//   • OPPORTUNISTIC TLH — a held TARGET name underwater ≥ max(TLH_MIN_LOSS, TLH_MIN_LOSS_PCT% of
//     cost) is harvested (full position — Robinhood MCP can't pick lots), then wash-blocked from
//     this ticket's buys; its target weight sits underweight until the 30-day window clears.
//   • CROSS-ACCOUNT WASH GUARD — IRS wash-sale spans accounts and the margin book trades the same
//     names. Pass `crossActivity` ({SYM:{lastBuyDate}}, from the margin account's recent orders —
//     the executor fetches this live at execution time); a loss-sale on a name the OTHER account
//     bought within 30d gets its harvest skipped (no tax benefit) or its exit flagged washRisk.
//   • AUTO TIER — `autoEligible` = turnover ≤ AUTO_TURNOVER_CAP (owner-approved $500): the executor
//     may place an auto-eligible ticket unattended; anything larger goes out as push + one-tap.
//
// Buys move each underweight name only toward its (already cluster/vol-capped) target weight, so honoring
// the target inherently respects the risk caps riskweights.mjs enforced when the target was built.
//
// PURE + unit-tested (agentic-deploy.test.mjs). The producer/agent turns `.sells` then `.buys` into
// review_equity_order → confirm → place (auto ≤ cap, owner-confirmed above; see AGENTIC.md).

import { policyBlackout, POLICY_BLACKOUT_DAYS } from './policy.mjs';

export const EARNINGS_BLACKOUT_DAYS = 7;
export { POLICY_BLACKOUT_DAYS };
export const AUTO_TURNOVER_CAP = 500; // $/ticket the executor may place unattended (owner-approved tier)
export const TLH_MIN_LOSS = 75;       // opportunistic harvest floor, dollars…
export const TLH_MIN_LOSS_PCT = 5;    // …and as % of cost basis — must clear max() of both
export const MIN_EXIT = 5;            // ignore off-target dust below this value
export const WASH_WINDOW_DAYS = 30;   // IRS wash-sale window (either side of a loss sale)

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
    earnings = {}, washMap = {}, policy = null, crossActivity = {}, accountActivity = {}, opts = {},
  } = input;
  const blackout = opts.earningsBlackoutDays ?? EARNINGS_BLACKOUT_DAYS;
  const polBlackout = opts.policyBlackoutDays ?? POLICY_BLACKOUT_DAYS;
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

  const buys = [], trims = [], deferred = [], warnings = [], blockedSells = [];
  // PDT guard (v98, limited margin): a name BOUGHT TODAY in this account can't be sold today without
  // booking a day trade. `accountActivity` = {SYM:{lastBuyDate}} from ••••3900's own recent fills.
  const boughtToday = (sym) => {
    const a = accountActivity && accountActivity[sym];
    return !!(a && a.lastBuyDate && opts.asOf && String(a.lastBuyDate).slice(0, 10) === opts.asOf);
  };
  const dayTradeBlock = (row) => {
    if (opts.dayTradeGuard === false || !boughtToday(row.sym)) return false;
    blockedSells.push({ ...row, blocked: 'day-trade',
      note: `bought earlier today — selling now would be a day trade (PDT: this account is under $25k), deferred to the next session` });
    return true;
  };
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
    // Scheduled policy decision inside the blackout window — same logic as earnings: a dated binary
    // event we KNOW is coming is a reason to wait for the outcome, not to deploy into it. No-ops
    // entirely when policy.json is empty (the shipped default).
    const polEvent = policy ? policyBlackout(sym, policy, { asOf: opts.asOf, sector: n.sector, blackoutDays: polBlackout }) : null;

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
      if (polEvent) {
        deferred.push({ sym, reason: 'policy', detail: `${polEvent.title} on ${polEvent.date} (≤${polBlackout}d) — scheduled policy decision, wait for the outcome`, until: polEvent.date, dollars: gap });
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
      // over target beyond the drift band → trim (taxable — flag it, sequence before the buys it funds)
      const shares = px > 0 ? +(Math.abs(gap) / px).toFixed(4) : null;
      const pl = (h.avgCost != null && px != null && shares != null) ? +((px - h.avgCost) * shares).toFixed(2) : null;
      const trim = { sym, kind: 'trim', dollars: +Math.abs(gap).toFixed(2), shares, price: px, weightNow: cw, weightTarget: tw,
        pl, plPct: (h.avgCost > 0 && px != null) ? +((px / h.avgCost - 1) * 100).toFixed(2) : null, term: 'short',
        note: `over target by ${(cw - tw).toFixed(1)}pp — taxable trim, sequenced before the buys it funds` };
      if (!dayTradeBlock(trim)) trims.push(trim);
    }
  }

  // 1b. OFF-TARGET EXITS — held names the research target dropped. The drop IS the sell signal; the
  //     exit is what funds the underweight target names (before v96 these were invisible to the planner).
  //     A loss-exit on a name the MARGIN account bought within the wash window is flagged (loss may be
  //     disallowed) but still exits — the allocation reason dominates; only the tax benefit is at risk.
  const crossRecent = (sym) => {
    const c = crossActivity && crossActivity[sym];
    if (!c || !c.lastBuyDate) return false;
    const d = daysUntil(c.lastBuyDate, opts.asOf);
    return d != null && d <= 0 && d >= -WASH_WINDOW_DAYS;
  };
  const exits = [];
  for (const [sym, h] of Object.entries(held)) {
    if (targetWeights[sym] != null) continue;
    if (!(h.qty > 0) || h.value < (opts.minExit ?? MIN_EXIT)) continue;
    const pl = h.avgCost != null ? +((h.px - h.avgCost) * h.qty).toFixed(2) : null;
    const washRisk = pl != null && pl < 0 && crossRecent(sym);
    const exit = { sym, kind: 'exit', dollars: +h.value.toFixed(2), shares: +h.qty.toFixed(6), price: h.px,
      pl, plPct: h.avgCost > 0 ? +((h.px / h.avgCost - 1) * 100).toFixed(2) : null, term: 'short',
      ...(washRisk ? { washRisk: true } : {}),
      note: `not in the current target — exit funds the underweight names${washRisk ? ' (⚠️ loss may be wash-disallowed: margin account bought this within 30d)' : ''}` };
    if (!dayTradeBlock(exit)) exits.push(exit);
  }

  // 1c. OPPORTUNISTIC TLH — a held TARGET name underwater ≥ max($, % of cost) is harvested whole
  //     (position-level; the MCP can't select lots), then wash-blocked from the buy legs — its target
  //     weight sits underweight until the window clears. Skipped when the margin book bought the name
  //     within the window (no tax benefit) or the name is already inside a wash window (keep it simple).
  const harvests = [];
  if (opts.tlh !== false) {
    const minLoss = opts.tlhMinLoss ?? TLH_MIN_LOSS, minPct = opts.tlhMinLossPct ?? TLH_MIN_LOSS_PCT;
    for (const n of names) {
      const sym = n.ticker, h = held[sym];
      if (!h || !(h.qty > 0) || h.avgCost == null || !(h.px > 0)) continue;
      const cost = h.avgCost * h.qty, pl = (h.px - h.avgCost) * h.qty;
      if (!(cost > 0) || pl >= 0) continue;
      if (-pl < Math.max(minLoss, cost * minPct / 100)) continue;
      if (washMap[sym]) continue;
      if (crossRecent(sym)) { warnings.push(`TLH skipped on ${sym}: margin account bought it within ${WASH_WINDOW_DAYS}d — the loss would be wash-disallowed`); continue; }
      const hv = { sym, kind: 'harvest', dollars: +h.value.toFixed(2), shares: +h.qty.toFixed(6), price: h.px,
        pl: +pl.toFixed(2), plPct: +((h.px / h.avgCost - 1) * 100).toFixed(2), term: 'short',
        note: `tax-loss harvest — realize ${money(pl)} ST loss; rebuy blocked ${WASH_WINDOW_DAYS}d, target weight sits underweight until then` };
      if (!dayTradeBlock(hv)) harvests.push(hv);
    }
    for (const hv of harvests) {
      const i = candidates.findIndex((c) => c.sym === hv.sym);
      if (i >= 0) candidates.splice(i, 1);
      // wash outranks any earlier deferral (below-entry/earnings/…) — replace, don't stack, so the
      // deferred list stays one-entry-per-name and deferredCash isn't double-counted.
      const j = deferred.findIndex((d) => d.sym === hv.sym);
      if (j >= 0) deferred.splice(j, 1);
      deferred.push({ sym: hv.sym, reason: 'wash-sale', detail: `harvested this ticket — rebuy blocked ${WASH_WINDOW_DAYS}d`, dollars: +(book * (targetWeights[hv.sym] || 0) / 100).toFixed(2) });
    }
  }

  // 2. distribute the deployable pool across eligible buys, proportional to each name's gap and capped
  //    at the gap (never overshoot target → never breach the target's risk caps).
  //
  //    LIMITED MARGIN (v98): the pool is settled cash PLUS this ticket's sale proceeds, in ONE pass —
  //    proceeds are spendable the moment the sell fills, so there is no second-session leg any more.
  //    Harvested names were already pulled from `candidates`, so a harvest still can't fund its own
  //    wash-triggering rebuy. `buysT1` stays in the result as an empty array for wire-compatibility
  //    with tickets written under the old two-leg model (see the header note).
  const proceeds = +([...exits, ...harvests, ...trims].reduce((s, x) => s + x.dollars, 0)).toFixed(2);
  const settledNow = Math.max(0, num(cash) || 0);
  const deployable = +(settledNow + proceeds).toFixed(2);
  const buysT1 = [];
  const totalGap = candidates.reduce((s, c) => s + c.gap, 0);
  let spent = 0;
  if (candidates.length && deployable > 0 && totalGap > 0) {
    const scale = Math.min(1, deployable / totalGap); // pro-rate if the pool < total need
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
  // Sells still lead: instant settlement means spendable once a sell FILLS, not before it does. When the
  // buys lean on proceeds, the executor must confirm the sell fills before placing them.
  const buysNeedProceeds = proceeds > 0 && spent > settledNow + 1;

  // 3. tax-aware combined sell order (losses first — harvest what we're selling anyway — then smallest
  //    gain first) + the ticket's ST tax picture and the executor's autonomy tier.
  const sells = [...exits, ...harvests, ...trims].sort((a, b) => (a.pl ?? 0) - (b.pl ?? 0));
  const realizedGain = +sells.reduce((s, x) => s + Math.max(0, x.pl || 0), 0).toFixed(2);
  const realizedLoss = +sells.reduce((s, x) => s + Math.min(0, x.pl || 0), 0).toFixed(2);
  const taxSummary = { realizedGain, realizedLoss, net: +(realizedGain + realizedLoss).toFixed(2), term: 'short',
    note: sells.some((x) => x.washRisk) ? 'a flagged loss may be wash-disallowed (cross-account buy within 30d)'
      : (realizedLoss < 0 && realizedGain > 0 ? 'harvested losses offset the gains — net is ST, taxed as ordinary income' : null) };
  const turnover = +(sells.reduce((s, x) => s + x.dollars, 0) + spent).toFixed(2);
  const autoCap = opts.autoCap ?? AUTO_TURNOVER_CAP;
  const autoEligible = turnover > 0 && turnover <= autoCap;

  const deferredCash = deferred.reduce((s, d) => s + Math.max(0, d.dollars || 0), 0);
  const cashLeft = +(deployable - spent).toFixed(2);

  if (!names.length) warnings.push('no research target loaded — cannot plan a deployment');
  if (deferred.length) warnings.push(`${deferred.length} name(s) deferred (${deferred.map((d) => d.sym).join(', ')}) — ~${money(deferredCash)} of intended weight held pending earnings/re-verify/wash-sale`);
  if (blockedSells.length) warnings.push(`${blockedSells.length} sell(s) held to the next session (${blockedSells.map((b) => b.sym).join(', ')}) — bought today, selling now would be a day trade (PDT guard)`);
  if (candidates.length && deployable > 0 && spent < deployable - 1) warnings.push(`${money(cashLeft)} left uninvested (eligible buys fully funded to target; rest waits for deferred names to clear)`);

  const summary = buildSummary({ buys, buysT1, trims, exits, harvests, deferred, spent, cashLeft, book, taxSummary, turnover, buysNeedProceeds });
  return { book, cash: +settledNow.toFixed(2), deployable, currentWeights, targetWeights, buys, buysT1, trims, exits, harvests, sells,
    proceeds, buysNeedProceeds, blockedSells, taxSummary, turnover, autoCap, autoEligible,
    deferred, deferredCash: +deferredCash.toFixed(2), spent: +spent.toFixed(2), cashLeft, warnings, summary };
}

function buildSummary({ buys, buysT1 = [], trims, exits = [], harvests = [], deferred, spent, cashLeft, taxSummary, turnover, buysNeedProceeds }) {
  const parts = [];
  const sellBits = [
    ...exits.map((x) => `${x.sym} ${moneyS(x.dollars)} exit`),
    ...harvests.map((x) => `${x.sym} ${moneyS(x.dollars)} harvest`),
    ...trims.map((t) => `${t.sym} ${moneyS(t.dollars)} trim`),
  ];
  if (sellBits.length) parts.push(`Sell first (losses first): ${sellBits.join(', ')}.`);
  if (buys.length) parts.push(`Then deploy ${moneyS(spent)}${buysNeedProceeds ? ' (cash + these proceeds, same session — limited margin)' : ' of settled cash'}: ${buys.map((b) => `${b.sym} ${moneyS(b.dollars)}`).join(', ')}.`);
  else if (!sellBits.length) parts.push('No eligible buys this pass.');
  if (buysT1.length) parts.push(`Carried leg: ${buysT1.map((b) => `${b.sym} ${moneyS(b.dollars)}`).join(', ')}.`);
  if (taxSummary && (taxSummary.realizedGain > 0 || taxSummary.realizedLoss < 0)) parts.push(`Est. ST tax: ${moneyS(taxSummary.realizedGain)} gains ${taxSummary.realizedLoss < 0 ? `− ${moneyS(-taxSummary.realizedLoss)} losses ` : ''}= net ${moneyS(taxSummary.net)}.`);
  if (deferred.length) parts.push(`Hold ${moneyS(deferred.reduce((s, d) => s + Math.max(0, d.dollars || 0), 0))} for ${deferred.map((d) => `${d.sym} (${d.reason})`).join(', ')}.`);
  if (cashLeft > 1) parts.push(`${moneyS(cashLeft)} stays in cash.`);
  if (turnover > 0) parts.push(`Turnover ${moneyS(turnover)}.`);
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
