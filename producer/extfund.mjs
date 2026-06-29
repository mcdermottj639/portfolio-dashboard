// producer/extfund.mjs — normalize supplementary fundamentals providers (Finnhub + Financial
// Modeling Prep) into the SAME shape Alpha Vantage's COMPANY_OVERVIEW uses, so they flow through
// build-data.mjs → data.recorded → the consumer's azOverview() with zero downstream changes.
//
// WHY: Alpha Vantage's free tier (25 calls/day) only refreshes a rotating subset of holdings per
// run, so Fwd P/E / Rev growth / EPS coverage fills in slowly. Finnhub (60 calls/min, no tight
// daily cap) covers trailing fundamentals + breadth every run; FMP adds PEG / analyst-target /
// forward fields where its tier exposes them. AV stays PRIMARY (it uniquely supplies ForwardPE +
// AnalystTargetPrice on the free tier); these two only FILL fields AV hasn't captured for a name.
//
// CONVENTIONS — match Alpha Vantage exactly (the consumer multiplies several of these by 100):
//   • QuarterlyRevenueGrowthYOY, ProfitMargin, DividendYield are stored as FRACTIONS (0.25 = 25%).
//     Finnhub returns these as PERCENTS → divide by 100. FMP TTM ratios are already fractions.
//   • MarketCapitalization is whole dollars as a string. Finnhub profile2.marketCapitalization is
//     in MILLIONS → ×1e6. FMP mktCap is already whole dollars.
//   • All values are emitted as STRINGS (AV does), and ONLY when finite — a missing field is simply
//     absent, so a wrong/empty provider key degrades to "no data" rather than garbage.
// Pure functions only (no I/O) so they're unit-testable offline — see extfund.test.mjs.

const num = (v) => { if (v == null || v === '') return null; const n = parseFloat(v); return Number.isFinite(n) ? n : null; };
const put = (o, k, v, dp) => { if (v == null) return; o[k] = dp != null ? (+v).toFixed(dp) : String(v); };

// Robinhood symbols use dots (BRK.B); AV/this overview key uses dashes (BRK-B).
export const avSym = (s) => String(s).replace(/\./g, '-');

// ---- Finnhub → overview ----------------------------------------------------
// profile2: GET /stock/profile2?symbol=   ({ name, ticker, finnhubIndustry, marketCapitalization(millions) })
// metric:   GET /stock/metric?symbol=&metric=all  ({ metric: { peTTM, epsTTM, revenueGrowthQuarterlyYoy(%),
//           epsGrowthQuarterlyYoy(%), netProfitMarginTTM(%), dividendYieldIndicatedAnnual(%), beta,
//           '52WeekHigh', '52WeekLow' } })
export function finnhubToOverview(sym, profile2, metric) {
  const m = (metric && metric.metric) || {};
  const p = profile2 || {};
  const o = { Symbol: avSym(sym) };
  if (p.name) o.Name = p.name;
  if (p.finnhubIndustry) { o.Sector = p.finnhubIndustry; o.Industry = p.finnhubIndustry; }
  const pe = num(m.peTTM != null ? m.peTTM : m.peExclExtraTTM);
  const eps = num(m.epsTTM != null ? m.epsTTM : (m.epsInclExtraItemsTTM != null ? m.epsInclExtraItemsTTM : m.epsBasicExclExtraItemsTTM));
  const revGrowthPct = num(m.revenueGrowthQuarterlyYoy != null ? m.revenueGrowthQuarterlyYoy : m.revenueGrowthTTMYoy); // percent
  const epsGrowthPct = num(m.epsGrowthQuarterlyYoy != null ? m.epsGrowthQuarterlyYoy : m.epsGrowthTTMYoy);             // percent
  const marginPct = num(m.netProfitMarginTTM);                                                                        // percent
  const divYieldPct = num(m.dividendYieldIndicatedAnnual != null ? m.dividendYieldIndicatedAnnual : m.currentDividendYieldTTM); // percent
  const mktM = num(p.marketCapitalization);                                                                           // millions
  put(o, 'PERatio', pe, pe != null ? 4 : null);
  put(o, 'EPS', eps, eps != null ? 4 : null);
  if (revGrowthPct != null) put(o, 'QuarterlyRevenueGrowthYOY', revGrowthPct / 100, 4);
  if (pe != null && epsGrowthPct != null && epsGrowthPct > 0) put(o, 'PEGRatio', pe / epsGrowthPct, 3);
  if (marginPct != null) put(o, 'ProfitMargin', marginPct / 100, 4);
  if (divYieldPct != null) put(o, 'DividendYield', divYieldPct / 100, 4);
  if (mktM != null) put(o, 'MarketCapitalization', Math.round(mktM * 1e6));
  put(o, '52WeekHigh', num(m['52WeekHigh']), num(m['52WeekHigh']) != null ? 2 : null);
  put(o, '52WeekLow', num(m['52WeekLow']), num(m['52WeekLow']) != null ? 2 : null);
  put(o, 'Beta', num(m.beta), num(m.beta) != null ? 3 : null);
  return o;
}

// ---- FMP → overview --------------------------------------------------------
// profile:    GET /api/v3/profile/<SYM>          ([{ companyName, sector, industry, mktCap, beta, range:"lo-hi" }])
// ratiosTTM:  GET /api/v3/ratios-ttm/<SYM>        ([{ peRatioTTM, pegRatioTTM, netProfitMarginTTM, dividendYieldTTM }]) — fractions
// quote:      GET /api/v3/quote/<SYM>             ([{ pe, eps, marketCap, yearHigh, yearLow }])
// priceTarget:GET /api/v4/price-target-consensus  ({ targetConsensus, targetMedian }) — gated on some tiers
// estimates:  GET /api/v3/analyst-estimates/<SYM> ([{ estimatedEpsAvg }]) — gated on some tiers (for ForwardPE)
export function fmpToOverview(sym, profile, ratiosTTM, quote, priceTarget, estimates) {
  const pr = Array.isArray(profile) ? profile[0] : profile;
  const rt = Array.isArray(ratiosTTM) ? ratiosTTM[0] : ratiosTTM;
  const q = Array.isArray(quote) ? quote[0] : quote;
  const pt = Array.isArray(priceTarget) ? priceTarget[0] : priceTarget;
  const est = Array.isArray(estimates) ? estimates[0] : estimates;
  const o = { Symbol: avSym(sym) };
  if (pr && pr.companyName) o.Name = pr.companyName;
  if (pr && pr.sector) o.Sector = pr.sector;
  if (pr && pr.industry) o.Industry = pr.industry;
  const pe = num((q && q.pe) != null ? q.pe : (rt && rt.peRatioTTM));
  const eps = num(q && q.eps);
  put(o, 'PERatio', pe, pe != null ? 4 : null);
  put(o, 'EPS', eps, eps != null ? 4 : null);
  put(o, 'PEGRatio', num(rt && rt.pegRatioTTM), num(rt && rt.pegRatioTTM) != null ? 3 : null);
  put(o, 'ProfitMargin', num(rt && rt.netProfitMarginTTM), num(rt && rt.netProfitMarginTTM) != null ? 4 : null); // already fraction
  put(o, 'DividendYield', num(rt && rt.dividendYieldTTM), num(rt && rt.dividendYieldTTM) != null ? 4 : null);    // already fraction
  const mkt = num((pr && pr.mktCap) != null ? pr.mktCap : (q && q.marketCap));
  if (mkt != null) put(o, 'MarketCapitalization', Math.round(mkt));
  put(o, 'Beta', num(pr && pr.beta), num(pr && pr.beta) != null ? 3 : null);
  // 52wk: prefer the quote's numeric fields, else parse profile "lo-hi" range string.
  let hi = num(q && q.yearHigh), lo = num(q && q.yearLow);
  if ((hi == null || lo == null) && pr && typeof pr.range === 'string' && pr.range.includes('-')) {
    const [a, b] = pr.range.split('-').map((x) => num(x));
    if (lo == null) lo = a; if (hi == null) hi = b;
  }
  put(o, '52WeekHigh', hi, hi != null ? 2 : null);
  put(o, '52WeekLow', lo, lo != null ? 2 : null);
  // Forward-looking (tier-gated; emitted only when present): analyst target + a derived forward P/E.
  const tgt = num(pt && (pt.targetConsensus != null ? pt.targetConsensus : pt.targetMedian));
  put(o, 'AnalystTargetPrice', tgt, tgt != null ? 2 : null);
  const fwdEps = num(est && est.estimatedEpsAvg), px = num(q && q.price);
  if (fwdEps != null && fwdEps > 0 && px != null) put(o, 'ForwardPE', px / fwdEps, 4);
  return o;
}

// Merge overviews field-by-field; the FIRST argument that defines a (non-null, non-empty) field wins.
// Symbol/Name from the first that has them. Use to combine providers (pass higher-trust source first).
export function mergeOverviews(...sources) {
  const out = {};
  for (const s of sources) {
    if (!s || typeof s !== 'object') continue;
    for (const [k, v] of Object.entries(s)) {
      if (v == null || v === '' || v === 'None') continue;
      if (out[k] == null || out[k] === '' || out[k] === 'None') out[k] = v;
    }
  }
  return out;
}

// A normalized overview is "rich" (worth winning over the thin Robinhood synth + the accumulation
// guard) when it carries at least one forward/growth/EPS field — same test build-data.mjs uses.
export const isRich = (o) => !!(o && ('ForwardPE' in o || 'EPS' in o || 'QuarterlyRevenueGrowthYOY' in o));
