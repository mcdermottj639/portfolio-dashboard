// Options page data — fully Robinhood-driven. Two parts:
//   1. "Your Options": analyze open option positions + pending option orders
//      (covered-vs-naked, days-to-expiry, moneyness, breakeven, max profit/loss).
//   2. "Trade Ideas": directional ideas generated from the Daily Picks oversold
//      scan (bullish long calls) + covered-call income ideas on stocks you own
//      100+ shares of. Education/research only — NOT financial advice.
//
// Premiums for ideas are rough estimates (labeled "est.") — the app is read-only
// and can't place orders; confirm live premiums in the chain before trading.

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };
const fmtPct = (v) => (v >= 0 ? '+' : '') + v.toFixed(1) + '%';

const dteFrom = (iso, from = new Date()) =>
  Math.max(0, Math.round((new Date(iso + 'T00:00:00Z') - from) / 86400000));

// 3rd-Friday monthly expiry roughly `targetDays` out (ISO date).
function monthlyExpiry(targetDays = 35, from = new Date()) {
  const t = new Date(from.getTime() + targetDays * 86400000);
  const d = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), 1));
  const dow = d.getUTCDay();
  const firstFri = 1 + ((5 - dow + 7) % 7);
  d.setUTCDate(firstFri + 14); // third Friday
  return d.toISOString().slice(0, 10);
}

// Crude premium estimate (no live chain): scales with price, vol proxy, time.
function estPremium(px, strike, dte, callPut, ivProxy) {
  const t = Math.sqrt(Math.max(dte, 1) / 365);
  const atm = px * ivProxy * t * 0.4;                 // ~ATM time value
  const otm = callPut === 'call' ? strike - px : px - strike;
  const moneyAdj = Math.exp(-Math.max(0, otm) / (px * ivProxy * t + 1e-6)); // decay when OTM
  return Math.max(0.05, +(atm * clamp(moneyAdj, 0.12, 1.4)).toFixed(2));
}

// Analyze one option position/leg. `sharesOwned` = underlying shares held.
export function analyzeLeg(leg, underlyingPx, sharesOwned = 0, opts = {}) {
  const { side, option_type: cp, strike_price, expiration_date } = leg;
  const strike = num(strike_price), dte = dteFrom(expiration_date);
  const qty = Math.abs(num(opts.quantity ?? leg.quantity ?? 1)) || 1;
  const contracts = qty;                       // 1 contract = 100 shares
  const isShort = side === 'sell' || opts.direction === 'credit';
  const premium = num(opts.premium) != null ? num(opts.premium) : null; // total $ for the order
  const perSh = premium != null ? premium / (100 * contracts) : null;
  const covered = cp === 'call' && isShort ? sharesOwned >= 100 * contracts : null;
  const itm = cp === 'call' ? underlyingPx > strike : underlyingPx < strike;
  const moneyPct = ((underlyingPx - strike) / strike) * 100 * (cp === 'call' ? 1 : -1);
  let breakeven = null, maxProfit = null, maxLossNote = null, summary = '';
  if (isShort && cp === 'call') { // covered/naked call (income)
    breakeven = perSh != null ? strike + perSh : strike;
    maxProfit = premium != null ? premium + (covered ? (strike - (opts.costBasis ?? strike)) * 100 * contracts : 0) : premium;
    summary = covered === false
      ? 'NAKED short call — risk is open-ended above the strike. Consider closing or buying shares to cover.'
      : `Covered call — income trade. Keep the $${premium?.toFixed(0)} premium; ${100 * contracts} sh capped at $${strike} until ${expiration_date}.`;
  } else if (isShort && cp === 'put') { // cash-secured / naked put
    breakeven = perSh != null ? strike - perSh : strike;
    summary = `Short put — you may be assigned ${100 * contracts} sh at $${strike} (effective ~$${breakeven?.toFixed(2)}). Keep the premium if it expires above $${strike}.`;
  } else { // long call/put (directional)
    breakeven = perSh != null ? (cp === 'call' ? strike + perSh : strike - perSh) : strike;
    maxLossNote = premium != null ? `Max loss the $${Math.abs(premium).toFixed(0)} premium paid` : 'Max loss = premium paid';
    summary = `Long ${cp} — directional bet; ${maxLossNote.toLowerCase()}.`;
  }
  return {
    underlying: leg.chain_symbol || opts.chain_symbol, type: cp, side: isShort ? 'short' : 'long',
    contracts, strike, expiration: expiration_date, dte,
    premium, perShare: perSh, covered, itm,
    moneyness: (itm ? 'ITM ' : 'OTM ') + fmtPct(moneyPct),
    breakeven: breakeven != null ? +breakeven.toFixed(2) : null,
    maxProfit: maxProfit != null ? +maxProfit.toFixed(0) : null,
    summary, underlyingPx: +underlyingPx.toFixed(2),
  };
}

// The contracts the ideas want priced — used by options-plan.mjs to tell the agent
// exactly which chains to look up, and by buildIdeas to match live quotes.
//   picks: Daily Picks candidates (oversold, bullish). holdings: [{symbol,shares,px}].
// Each target carries a `targetDelta` so the agent can pick the contract nearest a target
// delta (a defensible, IV-aware strike) instead of a naive fixed-% OTM strike; `targetStrike`
// remains as a fallback hint and for the estimate path. Single-leg only (covered/CSP/long
// call) — the defined-risk structures (spreads/collars) are estimate-only, built in buildIdeas.
export function ideaTargets(picks, holdings) {
  const expiration = monthlyExpiry(35), dte = dteFrom(expiration);
  const targets = [];
  for (const c of (picks || []).slice(0, 3)) {
    if (!c.price) continue;
    targets.push({ underlying: c.ticker, kind: 'long_call', type: 'call', direction: 'Bullish',
      strategy: 'Long call', expiration, dte, targetStrike: Math.round(c.price * 1.05), targetDelta: 0.45,
      px: c.price, rsi: c.rsi, composite: c.composite });
  }
  for (const h of (holdings || [])) {
    if (h.shares < 100 || !h.px) continue;
    targets.push({ underlying: h.symbol, kind: 'covered_call', type: 'call', direction: 'Income',
      strategy: 'Covered call', expiration, dte, targetStrike: Math.round(h.px * 1.12), targetDelta: 0.30,
      px: h.px, shares: h.shares });
  }
  // Cash-secured puts on the next oversold names (distinct underlyings from the long calls,
  // so live quotes don't collide) — get paid to potentially own them ~7% cheaper.
  for (const c of (picks || []).slice(3, 5)) {
    if (!c.price) continue;
    targets.push({ underlying: c.ticker, kind: 'csp', type: 'put', direction: 'Income',
      strategy: 'Cash-secured put', expiration, dte, targetStrike: Math.round(c.price * 0.93), targetDelta: 0.30,
      px: c.price, rsi: c.rsi });
  }
  return targets;
}

// Per-symbol IV proxy for the estimate path. Prefers an annualized realized-vol figure
// (ivBySym, computed from historicals by options-build); falls back to a strategy default.
function ivProxyFor(ivBySym, sym, kind) {
  const rv = num(ivBySym && ivBySym[sym]);
  if (rv != null && rv > 0.05 && rv < 4) return rv;       // sane realized-vol range
  return kind === 'long_call' ? 0.55 : 0.6;
}

// Directional trade ideas. `liveBySym[underlying]` (optional) holds a real option quote
// { strike, expiration, mark, bid, ask, breakeven, iv, delta, theta, vega, gamma, openInterest,
// volume, popLong } from Robinhood; when present the idea uses exact figures (live:true), else an
// estimate. `ivBySym` (optional) supplies per-symbol annualized realized vol for sharper estimates.
export function buildIdeas(picks, holdings, quotesBySym = {}, liveBySym = {}, ivBySym = {}) {
  const targets = ideaTargets(picks, holdings);
  const expiration = targets[0]?.expiration || monthlyExpiry(35);
  const ideas = targets.map((t) => {
    const px = num(quotesBySym[t.underlying]) || t.px;
    const live = liveBySym[t.underlying];
    const optSide = t.kind === 'long_call' ? 'long' : 'short';
    const base = { underlying: t.underlying, direction: t.direction, strategy: t.strategy,
      expiration: t.expiration, dte: t.dte, optType: t.type, optSide, covered: t.kind === 'covered_call',
      confidence: t.composite ? Math.round(t.composite * 9) : 60 };
    const hasLive = live && num(live.mark) != null;
    let strike, prem;
    if (hasLive) {
      strike = num(live.strike) ?? t.targetStrike; prem = num(live.mark);
      Object.assign(base, { live: true, expiration: live.expiration || t.expiration, strike, premium: prem,
        optionId: live.optionId || null, // resolved contract UUID → Robinhood options-watchlist sync

        iv: live.iv != null ? +(num(live.iv) * 100).toFixed(0) : null,
        delta: live.delta != null ? +num(live.delta).toFixed(2) : null,
        theta: live.theta != null ? +num(live.theta).toFixed(3) : null,
        vega: live.vega != null ? +num(live.vega).toFixed(3) : null,
        gamma: live.gamma != null ? +num(live.gamma).toFixed(4) : null,
        openInterest: live.openInterest != null ? num(live.openInterest) : null,
        volume: live.volume != null ? num(live.volume) : null,
        pop: live.popLong != null ? +(num(live.popLong) * 100).toFixed(0) : null });
    } else {
      strike = t.kind === 'covered_call' ? (Math.round(px * 1.12 / 5) * 5 || Math.round(px * 1.12))
             : t.kind === 'csp' ? Math.round(px * 0.93) : Math.round(px * 1.05);
      prem = estPremium(px, strike, t.dte, t.type, ivProxyFor(ivBySym, t.underlying, t.kind));
      Object.assign(base, { live: false, strike, estPremium: prem });
    }
    const L = base.live;
    if (t.kind === 'long_call') {
      base.breakeven = (hasLive && num(live.breakeven) != null) ? num(live.breakeven) : +(strike + prem).toFixed(2);
      base.maxLoss = +(prem * 100).toFixed(0);
      base.thesis = L ? [
        `${t.underlying} oversold (RSI ${t.rsi}) — long $${strike} call exp ${base.expiration} at the ~$${prem.toFixed(2)} live mark.`,
        `Breakeven $${base.breakeven} (${((base.breakeven / px - 1) * 100).toFixed(1)}%); max loss the $${base.maxLoss} premium. Δ${base.delta ?? '—'} · IV ${base.iv ?? '—'}% · OI ${base.openInterest ?? '—'}.`,
        `Live as of this snapshot — model POP(long) ~${base.pop ?? '—'}%. Not a recommendation; confirm before trading.`,
      ] : [
        `${t.underlying} screens oversold (RSI ${t.rsi}) — a long $${strike} call (~${t.dte}d) plays a bounce with defined risk.`,
        `Est. premium ~$${prem.toFixed(2)}; breakeven ~$${(strike + prem).toFixed(2)}; max loss ~$${(prem * 100).toFixed(0)}.`,
        `Estimate — confirm the live ask/OI in the chain before trading.`,
      ];
    } else if (t.kind === 'covered_call') {
      base.income = +(prem * 100).toFixed(0);
      base.annYield = px > 0 ? Math.round((prem / px) * (365 / t.dte) * 100) : null;
      base.shares = Math.floor(t.shares || 0);
      base.thesis = [
        `You own ${base.shares} sh of ${t.underlying} — sell the $${strike} call (~${t.dte}d) for ~$${base.income} income${L ? ` (live mark $${prem.toFixed(2)})` : ' (est)'}.`,
        `Caps 100 sh at $${strike} (+${((strike / px - 1) * 100).toFixed(0)}%)${base.annYield != null ? `, ≈${base.annYield}% annualized` : ''}. Keep premium + shares if it expires below.`,
        L ? `Δ${base.delta ?? '—'} · Θ${base.theta ?? '—'} · IV ${base.iv ?? '—'}% · OI ${base.openInterest ?? '—'}.` : `Defined-risk income — the premium cushions a pullback while you keep the shares below the strike.`,
      ];
    } else { // cash-secured put
      base.income = +(prem * 100).toFixed(0);
      base.breakeven = (hasLive && num(live.breakeven) != null) ? num(live.breakeven) : +(strike - prem).toFixed(2);
      base.cashSecured = +(strike * 100).toFixed(0);
      base.annYield = strike > 0 ? Math.round((prem / strike) * (365 / t.dte) * 100) : null;
      base.thesis = [
        `Sell the $${strike} put (~${t.dte}d) on ${t.underlying} for ~$${base.income}${L ? ` (live mark $${prem.toFixed(2)})` : ' (est)'} — get paid to maybe buy it ${((1 - strike / px) * 100).toFixed(0)}% lower.`,
        `Effective buy ~$${base.breakeven} if assigned; needs ~$${base.cashSecured} cash secured${base.annYield != null ? `, ≈${base.annYield}% annualized` : ''}.`,
        L ? `Δ${base.delta ?? '—'} · IV ${base.iv ?? '—'}% · OI ${base.openInterest ?? '—'}. Keep the premium if it stays above $${strike}.` : `Estimate — confirm the live bid in the chain.`,
      ];
    }
    return base;
  });
  ideas.push(...structuredIdeas(picks, holdings, quotesBySym, ivBySym, expiration));
  return { expiration, ideas };
}

// Defined-risk, multi-leg educational structures — ESTIMATE-ONLY (premiums modeled, not live,
// to avoid two-leg same-underlying live-quote collisions). Each carries a `legs` array the
// consumer uses to draw the combined payoff and to build the trade prompt:
//   • Call debit spread — the bullish-bounce thesis with capped cost AND capped risk (cheaper
//     than a naked long call). Built from the top oversold pick.
//   • Collar — on the largest 100+ share holding: long protective put + short call (financed by
//     the call), locking a floor and ceiling. A cheap way to protect a big winner.
function structuredIdeas(picks, holdings, quotesBySym = {}, ivBySym = {}, expiration) {
  const out = [];
  const dte = dteFrom(expiration);
  // Call debit spread off the most-oversold pick.
  const top = (picks || []).find((c) => c && c.price);
  if (top) {
    const px = num(quotesBySym[top.ticker]) || top.price;
    const longK = Math.round(px * 1.03), shortK = Math.round(px * 1.12);
    const iv = ivProxyFor(ivBySym, top.ticker, 'long_call');
    const longPrem = estPremium(px, longK, dte, 'call', iv);
    const shortPrem = estPremium(px, shortK, dte, 'call', iv);
    const net = Math.max(0.05, +(longPrem - shortPrem).toFixed(2));
    const width = shortK - longK;
    out.push({
      underlying: top.ticker, direction: 'Bullish', strategy: 'Call debit spread',
      expiration, dte, optType: 'call', optSide: 'debit_spread', live: false,
      strike: longK, longStrike: longK, shortStrike: shortK, estPremium: net, netDebit: net,
      maxLoss: +(net * 100).toFixed(0), maxProfit: +((width - net) * 100).toFixed(0),
      breakeven: +(longK + net).toFixed(2),
      confidence: top.composite ? Math.round(top.composite * 9) : 60, rsi: top.rsi,
      legs: [
        { type: 'call', side: 'long', strike: longK, prem: longPrem },
        { type: 'call', side: 'short', strike: shortK, prem: shortPrem },
      ],
      thesis: [
        `${top.ticker} screens oversold (RSI ${top.rsi}) — buy the $${longK} / sell the $${shortK} call (~${dte}d) to play a bounce with capped cost.`,
        `Net debit ~$${net.toFixed(2)} ($${net * 100 | 0} max loss); max profit ~$${((width - net) * 100).toFixed(0)} if it closes above $${shortK}; breakeven ~$${(longK + net).toFixed(2)}.`,
        `Defined-risk alternative to a naked long call — cheaper, but upside is capped at the short strike. Estimate; confirm both legs in the chain.`,
      ],
    });
  }
  // Collar on the largest 100+ share holding.
  const big = (holdings || []).filter((h) => h.shares >= 100 && h.px)
    .sort((a, b) => b.shares * b.px - a.shares * a.px)[0];
  if (big) {
    const px = num(quotesBySym[big.symbol || big.underlying]) || big.px;
    const putK = Math.round(px * 0.92), callK = Math.round(px * 1.10);
    const iv = ivProxyFor(ivBySym, big.symbol || big.underlying, 'covered_call');
    const putPrem = estPremium(px, putK, dte, 'put', iv);
    const callPrem = estPremium(px, callK, dte, 'call', iv);
    const net = +(putPrem - callPrem).toFixed(2); // >0 = net cost, <0 = net credit
    out.push({
      underlying: big.symbol || big.underlying, direction: 'Hedge', strategy: 'Collar',
      expiration, dte, optType: 'collar', optSide: 'collar', live: false,
      putStrike: putK, callStrike: callK, strike: putK, shares: 100,
      netCost: +(net * 100).toFixed(0), estPremium: Math.abs(net),
      floor: putK, ceiling: callK,
      confidence: 55,
      legs: [
        { type: 'put', side: 'long', strike: putK, prem: putPrem },
        { type: 'call', side: 'short', strike: callK, prem: callPrem },
      ],
      stock: { shares: 100, basis: +px.toFixed(2) },
      thesis: [
        `You own ${big.shares} sh of ${big.symbol || big.underlying} — buy the $${putK} put, sell the $${callK} call (~${dte}d) to lock a floor and ceiling.`,
        net >= 0
          ? `Net cost ~$${(net * 100).toFixed(0)} for 100 sh of downside protection below $${putK}; caps upside at $${callK}.`
          : `Net credit ~$${(-net * 100).toFixed(0)} — the call more than pays for the put; floor $${putK}, ceiling $${callK}.`,
        `Protects a big position into events; you keep dividends. Estimate — confirm both legs in the chain.`,
      ],
    });
  }
  return out;
}
