// Options Guardrail — the rules that would have caught the 2026-10-12 PLTR roll (pure, unit-tested).
//
// WHAT HAPPENED (the regression this module pins): a 100-share PLTR covered call sold 2026-09-15 at
// the $195 strike for $3.97 was rolled on 2026-10-12, four days before expiry, with PLTR ~$210:
// buy-to-close $16.64 (≈$15 intrinsic, ≈$1.64 extrinsic — ~10% of the price) and sell-to-open the
// Nov 20 $210 call at $16.14, a $0.50 NET DEBIT, into a stock that had run +7.7% in the prior two
// sessions. PLTR closed $186.03 on 2026-10-16: the original call would have EXPIRED WORTHLESS and
// kept the $397. The old `rollAlert` in options-build.mjs said, for ANY in-the-money short call,
// "assignment risk — roll up/out", which is precisely the advice that produced the loss.
//
// THE THREE GATES (every published roll framework the owner checked agrees on these — see the
// 2026-10-19 Options roll post-mortem doc):
//   1. Roll for a NET CREDIT, or don't roll.
//   2. Never roll a leg with little EXTRINSIC left (< EXTRINSIC_MIN_PCT of its price): a roll trades
//      time value for time value, and a deep-ITM leg has none — you pay full intrinsic to close and
//      get nothing back. Roll in the 14–21 DTE window, not the final week.
//   3. Never roll UP after a vertical move (3-day return > EXTENDED_3D_PCT or price > EXTENDED_SMA_PCT
//      over the 20-day SMA): that is buying back the upside at the top.
// Plus the reframing that was missing: assignment at a strike above cost basis is a WIN (the call
// was sold at a price the owner agreed to sell at), not a risk to be rolled away from.
//
// This module computes the per-position fields, assigns ONE alert tier, grades a proposed or
// completed roll, detects rolls in the order history and tracks each against its do-nothing path.
// It never trades. Thresholds are starting points from the cited sources, meant to be tuned by the
// roll scorecard — not law. `absent !== zero` throughout: a missing mark yields null fields and the
// HOLD tier, never a confident verdict.

const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };
const round = (v, d = 2) => (v == null ? null : +(+v).toFixed(d));

export const EXTRINSIC_MIN_PCT = 0.15;   // gate 2: a leg under this is "no time value left"
export const ROLL_DTE_MIN = 14, ROLL_DTE_MAX = 21; // the roll window
export const LATE_DTE = 7;              // inside this, choices are ride / take assignment / credit-only
export const PROFIT_CAPTURED_PCT = 0.50; // 50%+ captured with 21+ DTE = close/roll candidate
export const EXTENDED_3D_PCT = 0.08;    // gate 3: 3-session return above this = extended
export const EXTENDED_SMA_PCT = 0.12;   // gate 3: price this far over the 20-day SMA = extended
export const NEAR_STRIKE_PCT = 0.03;    // "stock within 3% of the strike" for the roll window
export const SMA_WINDOW = 20, RET_WINDOW = 3;

export const TIERS = ['LET_IT_RIDE', 'ASSIGNMENT_WIN', 'ROLL_WINDOW', 'STRIKE_UNDER_BASIS', 'EXTENDED_STOCK', 'HOLD', 'INSUFFICIENT_DATA'];

/* Stock extension from a daily close series (any of the repo's bar shapes). Returns nulls, never a
   guess, when the series is short or stale — a stale series stops at its own high and would read as
   "extended" on exactly the names that rotated out of the fetch.
   Bars are DEDUPED BY SESSION DATE, last occurrence wins — the caller concatenates the prior
   snapshot's series with this run's fresh tail, which overlaps it by design (hist-plan.mjs), so
   without the dedupe the 3-session lookback walked back over repeated days: four closes
   100/103/106/109 read +9.0% once and +2.8% when each bar appeared twice (ChatGPT review,
   2026-10-19). Put the fresher source LAST. */
export function stockExtension(bars = [], px = null, { asOf = null, maxAgeDays = 10 } = {}) {
  const byDate = new Map();
  for (const b of (bars || [])) {
    if (!b || b.interpolated || b.live) continue;
    const t = String(b.t || b.begins_at || '').slice(0, 10), c = num(b.c ?? b.close_price);
    if (t && c != null) byDate.set(t, { t, c });
  }
  const pts = [...byDate.values()].sort((a, b) => a.t < b.t ? -1 : 1);
  const out = { ret3d: null, vsSma20: null, barsAsOf: pts.length ? pts[pts.length - 1].t : null, stale: false };
  if (!pts.length) return out;
  if (asOf) {
    const age = (new Date(String(asOf).slice(0, 10)) - new Date(out.barsAsOf)) / 86400000;
    if (age > maxAgeDays) { out.stale = true; return out; }
  }
  const last = px != null ? px : pts[pts.length - 1].c;
  if (pts.length > RET_WINDOW) {
    const base = pts[pts.length - 1 - RET_WINDOW].c;
    if (base > 0) out.ret3d = round(last / base - 1, 4);
  }
  if (pts.length >= SMA_WINDOW) {
    const sma = pts.slice(-SMA_WINDOW).reduce((s, b) => s + b.c, 0) / SMA_WINDOW;
    if (sma > 0) out.vsSma20 = round(last / sma - 1, 4);
  }
  return out;
}

export const isExtended = (ext) => !!ext && !ext.stale &&
  ((ext.ret3d != null && ext.ret3d > EXTENDED_3D_PCT) || (ext.vsSma20 != null && ext.vsSma20 > EXTENDED_SMA_PCT));

/* The per-position fields and tier. `a` is an analyzed leg from options.mjs (side/type/strike/dte/
   expiration/underlyingPx/perShare/mark/delta/costBasis/contracts/covered). `ctx.extension` from
   stockExtension(); `ctx.earningsDate` ISO date or null. */
export function guardrail(a, ctx = {}) {
  if (!a || a.side !== 'short' || a.type !== 'call') return null; // covered calls only, for now
  const px = num(a.underlyingPx), strike = num(a.strike), mark = num(a.mark), perSh = num(a.perShare);
  const basis = num(a.costBasis), dte = num(a.dte);
  const intrinsic = px != null && strike != null ? round(Math.max(px - strike, 0)) : null;
  const extrinsic = mark != null && intrinsic != null ? round(mark - intrinsic) : null;
  const extrinsicPct = extrinsic != null && mark > 0 ? round(extrinsic / mark, 3) : null;
  const moneyness = px != null && strike > 0 ? round(px / strike - 1, 4) : null;
  const strikeVsBasis = basis != null && strike != null ? round(strike - basis) : null;
  const ifAssignedPerSh = strikeVsBasis != null && perSh != null ? round(strikeVsBasis + perSh) : null;
  const ifAssignedTotal = ifAssignedPerSh != null ? round(ifAssignedPerSh * 100 * (num(a.contracts) || 1), 0) : null;
  const profitCaptured = mark != null && perSh > 0 ? round(1 - mark / perSh, 3) : null;
  const ext = ctx.extension || null;
  const extended = isExtended(ext);
  const earningsInside = !!(ctx.earningsDate && a.expiration && String(ctx.earningsDate).slice(0, 10) < a.expiration);
  const itm = px != null && strike != null ? px > strike : null;
  const nearStrike = moneyness != null && Math.abs(moneyness) <= NEAR_STRIKE_PCT;

  const flags = [];
  if (strikeVsBasis != null && strikeVsBasis < 0) flags.push('STRIKE_UNDER_BASIS');
  if (extended && itm) flags.push('EXTENDED_STOCK');
  if (earningsInside) flags.push('EARNINGS_INSIDE');
  if (extrinsicPct != null && extrinsicPct < EXTRINSIC_MIN_PCT) flags.push('NO_EXTRINSIC');
  if (a.covered === false) flags.push('NAKED');
  if (mark == null) flags.push('NO_MARK');

  let tier = 'HOLD', text = '';
  /* Required inputs for ANY tier: a stock price, a strike and days to expiry. Without them every
     branch below would fall through to a confident-sounding HOLD (ChatGPT review, 2026-10-19). */
  if (px == null || strike == null || dte == null) {
    const missing = [px == null && 'stock price', strike == null && 'strike', dte == null && 'expiry'].filter(Boolean).join(', ');
    return { tier: 'INSUFFICIENT_DATA', flags, text: `Can't assess this call — missing ${missing}. No verdict until the next successful quote.`,
      intrinsic, extrinsic, extrinsicPct, moneyness, itm, dte, strikeVsBasis, ifAssignedPerSh, ifAssignedTotal, profitCaptured,
      extension: ext, extended, earningsInside, nearStrike };
  }
  const ifA = ifAssignedPerSh != null ? ` (assignment = ${ifAssignedPerSh >= 0 ? '+' : '−'}$${Math.abs(ifAssignedPerSh).toFixed(2)}/sh vs your cost)` : '';
  if (strikeVsBasis != null && strikeVsBasis < 0) {
    tier = 'STRIKE_UNDER_BASIS';
    text = `Strike $${strike} is $${Math.abs(strikeVsBasis).toFixed(2)} UNDER your $${basis.toFixed(2)} cost — assignment realizes a loss${ifA}. Fine if this is a deliberate premium harvest; decide it consciously.`;
  } else if (extended && itm) {
    tier = 'EXTENDED_STOCK';
    text = `Stock is extended (${ext.ret3d != null ? (ext.ret3d * 100).toFixed(1) + '% in 3 sessions' : ''}${ext.ret3d != null && ext.vsSma20 != null ? ', ' : ''}${ext.vsSma20 != null ? (ext.vsSma20 * 100).toFixed(1) + '% over the 20-day' : ''}). Do NOT roll up into this. Take assignment${ifA} or wait for a pullback.`;
  } else if (dte != null && dte <= LATE_DTE && itm === true) {
    tier = 'ASSIGNMENT_WIN';
    text = extrinsicPct != null
      ? `In the money with ${dte}d left and ${Math.round(extrinsicPct * 100)}% extrinsic: a roll here is a debit for nothing. Let it be assigned${ifA} — you sold the right to sell at $${strike} and that is the plan working.`
      : `In the money with ${dte}d left; no live mark, so the extrinsic left is UNKNOWN — confirm the quote before any roll. Assignment${ifA} is still the plan working: you sold the right to sell at $${strike}.`;
  } else if (dte != null && dte <= LATE_DTE && itm === false) {
    tier = 'LET_IT_RIDE';
    text = `${dte}d left, out of the money: nothing to do. Expires worthless if ${a.underlying || 'the stock'} stays under $${strike}; you keep the $${(perSh != null ? perSh * 100 * (num(a.contracts) || 1) : 0).toFixed(0)}.`;
  } else if (dte != null && dte >= ROLL_DTE_MIN && dte <= ROLL_DTE_MAX && ((profitCaptured != null && profitCaptured >= PROFIT_CAPTURED_PCT) || nearStrike)) {
    tier = 'ROLL_WINDOW';
    text = `${dte} DTE${profitCaptured != null ? `, ${Math.round(profitCaptured * 100)}% of the premium captured` : ''}${nearStrike ? ', stock within 3% of the strike' : ''}: this is the window to close or roll — for a NET CREDIT only, keeping ≥${Math.round(EXTRINSIC_MIN_PCT * 100)}% extrinsic in the leg you close${earningsInside ? '; earnings land before this expiry' : ''}.`;
  } else if (profitCaptured != null && profitCaptured >= PROFIT_CAPTURED_PCT && dte != null && dte > ROLL_DTE_MAX) {
    tier = 'HOLD';
    text = `${Math.round(profitCaptured * 100)}% captured with ${dte}d left — hold; the roll window opens at ${ROLL_DTE_MAX} DTE.`;
  } else {
    tier = 'HOLD';
    text = `Hold. ${dte != null ? dte + 'd left' : ''}${profitCaptured != null ? `, ${Math.round(profitCaptured * 100)}% of premium captured` : ''}${itm ? `; in the money — assignment${ifA}` : ''}.`;
  }
  if (a.covered === false) text = 'NAKED short call — open-ended risk above the strike. ' + text;

  return { tier, flags, text, intrinsic, extrinsic, extrinsicPct, moneyness, itm, dte, strikeVsBasis,
    ifAssignedPerSh, ifAssignedTotal, profitCaptured, extension: ext, extended, earningsInside, nearStrike };
}

/* Grade a roll — proposed (the pre-check) or completed (the scorecard). All per-share figures.
   closeMark = what the old leg costs to buy back; closeIntrinsic = its intrinsic; openCredit = what the
   new leg pays; extension = stockExtension() at roll time. GREEN only when ALL three gates pass. */
export function gradeRoll({ closeMark, closeIntrinsic, openCredit, dte, extension = null, strikeUp = null } = {}) {
  const reasons = [], warnings = [];
  const cm = num(closeMark), ci = num(closeIntrinsic), oc = num(openCredit), d = num(dte);
  const net = cm != null && oc != null ? round(oc - cm) : null;
  if (net == null) reasons.push('Net credit unknown — cannot grade.');
  else if (net < 0) reasons.push(`NET DEBIT of $${Math.abs(net).toFixed(2)}/sh — rule 1: roll for a credit or don't roll.`);
  const extr = cm != null && ci != null ? round(cm - ci) : null;
  const extrPct = extr != null && cm > 0 ? round(extr / cm, 3) : null;
  if (extrPct != null && extrPct < EXTRINSIC_MIN_PCT) reasons.push(`Only ${Math.round(extrPct * 100)}% extrinsic left in the leg being closed — rule 2: you are paying full intrinsic to close and buying no time.`);
  if (d != null && d < LATE_DTE) reasons.push(`${d} DTE — inside the final week; the roll window is ${ROLL_DTE_MIN}–${ROLL_DTE_MAX} DTE.`);
  if (isExtended(extension) && (strikeUp == null || strikeUp > 0)) reasons.push(`Stock is extended (${extension.ret3d != null ? (extension.ret3d * 100).toFixed(1) + '% in 3 sessions' : (extension.vsSma20 * 100).toFixed(1) + '% over the 20-day'}) — rule 3: rolling up here buys back the upside at the top.`);
  /* GREEN needs every gate CHECKED and passed. A gate that cannot be checked (no intrinsic, no DTE, no
     or stale price history) makes the verdict UNKNOWN, never green — gradeRoll({closeMark:1,openCredit:2})
     used to grade green with the extrinsic gate silently skipped (ChatGPT review, 2026-10-19). */
  if (extrPct == null) warnings.push('Extrinsic unknown: no intrinsic supplied for the leg being closed (rule 2 unchecked).');
  if (d == null) warnings.push('DTE unknown (final-week rule unchecked).');
  if (!extension || extension.stale || (extension.ret3d == null && extension.vsSma20 == null)) warnings.push(extension && extension.stale ? 'Extension unknown: price history is stale (rule 3 unchecked).' : 'Extension unknown: no price history supplied (rule 3 unchecked).');
  const red = reasons.some((r) => /rule \d|DTE —|unknown/.test(r));
  const verdict = red ? 'red' : warnings.length ? 'unknown' : 'green';
  if (verdict === 'green') reasons.push(`Net credit $${net.toFixed(2)}/sh with ${Math.round(extrPct * 100)}% extrinsic in the closed leg at ${d} DTE; stock not extended.`);
  else if (verdict === 'unknown') reasons.push(`Net credit $${net.toFixed(2)}/sh, but ${warnings.length} gate${warnings.length > 1 ? 's' : ''} could not be checked — not a green light.`);
  return { verdict, netCredit: net, extrinsicPct: extrPct, reasons, warnings };
}

/* Detect rolls in filled option orders: one order with a buy-to-close leg and a sell-to-open leg on
   the same chain (Robinhood files these as one multi-leg order with both opening_strategy and
   closing_strategy set). Returns one record per roll, keyed on the order id. */
export function detectRolls(orders = []) {
  const rolls = [];
  for (const o of orders || []) {
    if (!o || o.state !== 'filled') continue;
    const legs = o.legs || [];
    const close = legs.find((l) => l.position_effect === 'close' && l.side === 'buy');
    const open = legs.find((l) => l.position_effect === 'open' && l.side === 'sell');
    if (!close || !open || close.option_type !== open.option_type) continue;
    const px = (l) => { const e = (l.executions || [])[0]; return e ? num(e.price) : null; };
    const closePx = px(close), openPx = px(open);
    const date = String(o.updated_at || o.created_at || '').slice(0, 10);
    rolls.push({
      id: o.id, symbol: o.chain_symbol, date, type: close.option_type, contracts: num(o.quantity) || 1,
      old: { strike: num(close.strike_price), expiration: close.expiration_date, optionId: close.option_id, closePx },
      new: { strike: num(open.strike_price), expiration: open.expiration_date, optionId: open.option_id, openPx },
      netCredit: closePx != null && openPx != null ? round(openPx - closePx) : null,
      direction: o.direction || null,
      status: 'pending', // settled by settleRolls once the OLD leg's expiry close is known
    });
  }
  return rolls;
}

/* Merge fresh rolls into the retained ledger (raw/ is wiped every run — the ivHistory pattern) and
   settle each against its do-nothing path once the old leg's expiration close is in the daily bars.
   doNothing = what the old leg would have paid at expiry: short call settles worth max(close−strike,0),
   so the owner's P&L on that leg = perShare received − intrinsic at expiry (per share). The roll's own
   outcome is graded at the SAME date so the two paths are compared over the same window; the new leg
   is marked at the old expiry using the daily close against its strike (intrinsic only — a
   conservative stand-in when no option close is retained). */
export function settleRolls(prior = [], fresh = [], histDay = {}, openPremiumByOptId = {}, extensionAt = null) {
  const byId = new Map((prior || []).map((r) => [r.id, r]));
  for (const r of fresh || []) if (!byId.has(r.id)) byId.set(r.id, r);
  const out = [];
  for (const r of byId.values()) {
    const rec = { ...r };
    if (rec.grade == null && rec.old && rec.new) {
      const openPrem = num(openPremiumByOptId[rec.old.optionId]);
      const closeIntr = rec.closeIntrinsic != null ? rec.closeIntrinsic : null;
      const dte = rec.old.expiration && rec.date ? Math.round((new Date(rec.old.expiration + 'T00:00:00Z') - new Date(rec.date + 'T00:00:00Z')) / 86400000) : null;
      rec.dteAtRoll = dte;
      rec.grade = gradeRoll({ closeMark: rec.old.closePx, closeIntrinsic: closeIntr, openCredit: rec.new.openPx, dte,
        extension: rec.extension || (typeof extensionAt === 'function' ? extensionAt(rec) : null), strikeUp: rec.new.strike - rec.old.strike });
      if (openPrem != null) rec.old.openPremium = openPrem;
    }
    if (rec.status === 'pending' && rec.old && rec.old.expiration) {
      const bars = (histDay && histDay[rec.symbol]) || [];
      const bar = bars.find((b) => b && !b.interpolated && !b.live && String(b.t || b.begins_at || '').slice(0, 10) === rec.old.expiration);
      const close = bar ? num(bar.c ?? bar.close_price) : null;
      if (close != null) {
        const oldIntr = Math.max(close - rec.old.strike, 0);
        const newIntr = Math.max(close - rec.new.strike, 0);
        const openPrem = num(rec.old.openPremium);
        rec.settle = {
          /* ESTIMATE, not an observed outcome: the still-open replacement leg is marked at INTRINSIC
             on the old expiry date, so any time value it still carries is omitted (it is a liability
             the roller still holds, so this proxy FLATTERS the roll). Keep estimates out of threshold
             tuning until a same-date option mark is retained (ChatGPT review, 2026-10-19). */
          basis: 'intrinsic-proxy', estimated: true,
          expiryClose: close, oldExpiredWorthless: oldIntr === 0,
          doNothingPerSh: openPrem != null ? round(openPrem - oldIntr) : null,
          rollPerSh: openPrem != null && rec.netCredit != null ? round(openPrem + rec.netCredit - newIntr) : null,
        };
        if (rec.settle.doNothingPerSh != null && rec.settle.rollPerSh != null)
          rec.settle.rollVsDoNothingPerSh = round(rec.settle.rollPerSh - rec.settle.doNothingPerSh);
        rec.status = 'settled';
      }
    }
    out.push(rec);
  }
  return out.sort((a, b) => (a.date < b.date ? 1 : -1));
}

export function rollStats(rolls = []) {
  const settled = rolls.filter((r) => r.status === 'settled' && r.settle && r.settle.rollVsDoNothingPerSh != null);
  const credit = rolls.filter((r) => r.netCredit != null && r.netCredit >= 0).length;
  const sum = settled.reduce((s, r) => s + r.settle.rollVsDoNothingPerSh * 100 * (r.contracts || 1), 0);
  return { rolls: rolls.length, forCredit: credit, forDebit: rolls.filter((r) => r.netCredit != null && r.netCredit < 0).length,
    settled: settled.length, vsDoNothing: round(sum, 0), vsDoNothingBasis: 'intrinsic-proxy', estimated: settled.length > 0,
    green: rolls.filter((r) => r.grade && r.grade.verdict === 'green').length,
    unknown: rolls.filter((r) => r.grade && r.grade.verdict === 'unknown').length };
}

/* CLI — for the Jarvis investing agent, which cannot decrypt data.json but CAN clone this repo and
   call Robinhood read-only tools. Feed it the raw tool results and it prints one JSON line per
   short call with the tier and text, plus a roll grade for any --roll proposal.
     node producer/option-guardrail.mjs --positions pos.json --quotes q.json --equity eq.json --prices px.json [--bars bars.json] [--earnings earn.json]
     node producer/option-guardrail.mjs --grade '{"closeMark":16.64,"closeIntrinsic":15,"openCredit":16.14,"dte":4,"ret3d":0.077}'
   pos.json = get_option_positions result; q.json = get_option_quotes; eq.json = get_equity_positions;
   px.json = get_equity_quotes; bars.json = {SYM:[bars]}; earn.json = {SYM:"YYYY-MM-DD"}. Strikes and
   expirations come from a `--instruments` get_option_instruments dump or from `legs` on an orders file. */
if (import.meta.url === `file://${process.argv[1]}`) {
  const fs = await import('node:fs');
  const args = process.argv.slice(2); const arg = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
  const rd = (k) => { const p = arg(k); return p ? JSON.parse(fs.readFileSync(p, 'utf8')) : null; };
  if (arg('--grade')) {
    const g = JSON.parse(arg('--grade'));
    const ext = g.ret3d != null || g.vsSma20 != null ? { ret3d: g.ret3d ?? null, vsSma20: g.vsSma20 ?? null, stale: false } : null;
    console.log(JSON.stringify(gradeRoll({ ...g, extension: ext }), null, 2)); process.exit(0);
  }
  const { analyzeLeg, positionPremium } = await import('./options.mjs');
  const un = (r) => (r && (r.data || r)) || {};
  const pos = un(rd('--positions')).positions || [];
  const quotes = {}; for (const row of (un(rd('--quotes')).results || [])) { const q = row.quote || row; if (q.instrument_id) quotes[q.instrument_id] = q; }
  const shares = {}, basis = {}; for (const p of (un(rd('--equity')).positions || [])) { shares[p.symbol] = num(p.quantity) || 0; basis[p.symbol] = num(p.average_buy_price); }
  const px = {}; for (const row of (un(rd('--prices')).results || [])) { const q = row.quote || row; if (q.symbol) px[q.symbol] = num(q.last_trade_price || q.previous_close); }
  const inst = {}; for (const r of (un(rd('--instruments')).results || un(rd('--instruments')).instruments || [])) if (r.id) inst[r.id] = r;
  for (const o of (un(rd('--orders')).orders || [])) for (const l of (o.legs || [])) if (l.option_id && !inst[l.option_id]) inst[l.option_id] = { strike_price: l.strike_price, expiration_date: l.expiration_date, type: l.option_type };
  const bars = rd('--bars') || {}, earn = rd('--earnings') || {};
  const asOf = new Date().toISOString().slice(0, 10);
  for (const p of pos) {
    const m = inst[p.option_id]; if (!m) { console.log(JSON.stringify({ symbol: p.chain_symbol, optionId: p.option_id, error: 'no strike/expiry metadata' })); continue; }
    const side = (p.type || p.position_type) === 'short' ? 'sell' : 'buy';
    const a = analyzeLeg({ side, option_type: m.type || m.option_type, strike_price: m.strike_price, expiration_date: m.expiration_date, chain_symbol: p.chain_symbol },
      px[p.chain_symbol] || 0, shares[p.chain_symbol] || 0, { quantity: p.quantity, premium: positionPremium(p), direction: side === 'sell' ? 'credit' : 'debit', chain_symbol: p.chain_symbol, costBasis: basis[p.chain_symbol] });
    a.costBasis = basis[p.chain_symbol] ?? null;
    const q = quotes[p.option_id]; if (q) { a.mark = num(q.mark_price ?? q.adjusted_mark_price); a.delta = num(q.delta); }
    const g = guardrail(a, { extension: stockExtension(bars[p.chain_symbol] || [], px[p.chain_symbol], { asOf }), earningsDate: earn[p.chain_symbol] || null });
    console.log(JSON.stringify({ symbol: p.chain_symbol, strike: a.strike, expiration: a.expiration, contracts: a.contracts, underlyingPx: a.underlyingPx, mark: a.mark, perShare: a.perShare, costBasis: a.costBasis, ...g }));
  }
}
