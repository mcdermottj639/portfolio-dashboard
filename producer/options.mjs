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

// Directional trade ideas. `picks` = the Daily Picks candidates (oversold large-caps,
// bullish bias). `holdings` = [{symbol, shares, px}] for covered-call income ideas.
export function buildIdeas(picks, holdings, quotesBySym = {}) {
  const ideas = [];
  const expiry = monthlyExpiry(35);
  const dte = dteFrom(expiry);
  // Bullish long-call ideas on the top oversold names (mean-reversion bounce).
  for (const c of (picks || []).slice(0, 3)) {
    const px = num(quotesBySym[c.ticker]) || c.price; if (!px) continue;
    const strike = Math.round(px * 1.05);
    const iv = 0.55; // large-cap proxy; momentum/miners run higher
    const prem = estPremium(px, strike, dte, 'call', iv);
    ideas.push({
      underlying: c.ticker, direction: 'Bullish', strategy: 'Long call',
      expiration: expiry, dte, strike, estPremium: prem,
      breakeven: +(strike + prem).toFixed(2), maxLoss: +(prem * 100).toFixed(0),
      confidence: c.composite ? Math.round(c.composite * 9) : 55,
      thesis: [
        `${c.ticker} screens oversold (RSI ${c.rsi}) — a long $${strike} call (~${dte}d) plays a bounce with defined risk.`,
        `Max loss is the ~$${(prem * 100).toFixed(0)} premium; breakeven ~$${(strike + prem).toFixed(2)} (+${(((strike + prem) / px - 1) * 100).toFixed(1)}%).`,
        `Estimated premium — confirm the live ask in the chain before trading.`,
      ],
    });
  }
  // Covered-call income ideas on stocks you own 100+ shares of.
  for (const h of (holdings || [])) {
    if (h.shares < 100 || !h.px) continue;
    const strike = Math.round(h.px * 1.12 / 5) * 5 || Math.round(h.px * 1.12);
    const iv = 0.6;
    const prem = estPremium(h.px, strike, dte, 'call', iv);
    ideas.push({
      underlying: h.symbol, direction: 'Income', strategy: 'Covered call',
      expiration: expiry, dte, strike, estPremium: prem,
      breakeven: null, maxLoss: null, income: +(prem * 100).toFixed(0),
      confidence: 60,
      thesis: [
        `You own ${Math.floor(h.shares)} sh of ${h.underlying || h.symbol} — selling a $${strike} call (~${dte}d) collects ~$${(prem * 100).toFixed(0)} income.`,
        `Caps ${100} sh at $${strike} (+${((strike / h.px - 1) * 100).toFixed(0)}%); you keep the premium and your shares if it expires below.`,
        `Conservative, defined-risk income — the same kind of trade as your pending IREN call.`,
      ],
    });
  }
  return { expiration: expiry, ideas };
}
