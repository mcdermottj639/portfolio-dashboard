// Offline unit checks for extfund.mjs normalizers — no network. Run: node producer/extfund.test.mjs
import { finnhubToOverview, fmpToOverview, mergeOverviews, isRich } from './extfund.mjs';

let pass = 0, fail = 0;
const eq = (label, got, want) => { const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.error(`✗ ${label}\n    got  ${g}\n    want ${w}`); } };

// --- Finnhub: percents → AV fractions, millions → dollars, derived PEG ---
const fh = finnhubToOverview('NVDA',
  { name: 'NVIDIA Corp', ticker: 'NVDA', finnhubIndustry: 'Semiconductors', marketCapitalization: 4_200_000 },
  { metric: { peTTM: 55.2, epsTTM: 3.05, revenueGrowthQuarterlyYoy: 122.4, epsGrowthQuarterlyYoy: 80,
              netProfitMarginTTM: 55.0, dividendYieldIndicatedAnnual: 0.03, beta: 1.7, '52WeekHigh': 175, '52WeekLow': 86.6 } });
eq('finnhub PERatio', fh.PERatio, '55.2000');
eq('finnhub EPS', fh.EPS, '3.0500');
eq('finnhub revGrowth→fraction', fh.QuarterlyRevenueGrowthYOY, '1.2240'); // 122.4% → 1.224
eq('finnhub PEG (pe/epsGrowth%)', fh.PEGRatio, '0.690');                  // 55.2/80
eq('finnhub margin→fraction', fh.ProfitMargin, '0.5500');                 // 55% → 0.55
eq('finnhub divYield→fraction', fh.DividendYield, '0.0003');              // 0.03% → 0.0003
eq('finnhub mktcap millions→dollars', fh.MarketCapitalization, '4200000000000');
eq('finnhub 52wk high', fh['52WeekHigh'], '175.00');
eq('finnhub beta', fh.Beta, '1.700');
eq('finnhub isRich', isRich(fh), true);

// --- FMP: TTM ratios already fractions, derived ForwardPE, analyst target ---
const fmp = fmpToOverview('NVDA',
  [{ companyName: 'NVIDIA', sector: 'Technology', industry: 'Semiconductors', mktCap: 4.2e12, beta: 1.65, range: '86.62-175.00' }],
  [{ peRatioTTM: 54.9, pegRatioTTM: 1.1, netProfitMarginTTM: 0.55, dividendYieldTTM: 0.0003 }],
  [{ pe: 55.0, eps: 3.05, marketCap: 4.2e12, yearHigh: 175, yearLow: 86.62, price: 168 }],
  { targetConsensus: 190 },
  [{ estimatedEpsAvg: 4.2 }]);
eq('fmp PERatio (from quote)', fmp.PERatio, '55.0000');
eq('fmp PEG', fmp.PEGRatio, '1.100');
eq('fmp margin stays fraction', fmp.ProfitMargin, '0.5500');
eq('fmp divYield stays fraction', fmp.DividendYield, '0.0003');
eq('fmp ForwardPE = price/estEps', fmp.ForwardPE, '40.0000');            // 168/4.2
eq('fmp AnalystTargetPrice', fmp.AnalystTargetPrice, '190.00');
eq('fmp sector', fmp.Sector, 'Technology');
eq('fmp 52wk from quote', fmp['52WeekHigh'], '175.00');

// --- FMP: stable field names + ADR/currency-mismatch ForwardPE guard ---
const fmpStable = fmpToOverview('TSM',
  [{ companyName: 'Taiwan Semiconductor', sector: 'Technology', marketCap: 1.1e12, beta: 1.1, range: '133.57-317.40' }],
  [{ priceToEarningsRatioTTM: 31.86, priceToEarningsGrowthRatioTTM: 0.67, netProfitMarginTTM: 0.47 }],
  [{ price: 455, marketCap: 1.1e12, yearHigh: 317.4, yearLow: 199.26 }],
  [{ targetConsensus: 566 }],
  [{ epsAvg: 500.78 }]); // TWD-denominated estimate vs USD ADR price → fwd P/E 0.91, must be dropped
eq('fmp stable PERatio (priceToEarningsRatioTTM)', fmpStable.PERatio, '31.8600');
eq('fmp stable PEG (priceToEarningsGrowthRatioTTM)', fmpStable.PEGRatio, '0.670');
eq('fmp stable EPS derived from price/PE', fmpStable.EPS, '14.2812');
eq('fmp ForwardPE dropped on currency mismatch', 'ForwardPE' in fmpStable, false);
eq('fmp stable AnalystTargetPrice', fmpStable.AnalystTargetPrice, '566.00');

// --- missing/garbage fields degrade to absent, not garbage ---
const sparse = finnhubToOverview('XYZ', null, { metric: { peTTM: 'n/a', epsTTM: 1.2 } });
eq('sparse: bad PE omitted', 'PERatio' in sparse, false);
eq('sparse: good EPS kept', sparse.EPS, '1.2000');
eq('sparse isRich (has EPS)', isRich(sparse), true);
const empty = fmpToOverview('XYZ', [], [], [], null, null);
eq('empty FMP not rich', isRich(empty), false);

// --- merge: first source wins per field, others fill gaps ---
const merged = mergeOverviews(fmp, fh);
eq('merge: FMP ForwardPE wins (FMP-only)', merged.ForwardPE, '40.0000');
eq('merge: FMP target wins (FMP-only)', merged.AnalystTargetPrice, '190.00');
eq('merge: FMP PERatio wins (first arg)', merged.PERatio, '55.0000');
eq('merge: fills from finnhub when FMP missing', mergeOverviews({ Symbol: 'X' }, fh).QuarterlyRevenueGrowthYOY, '1.2240');
eq('merge: skips None', mergeOverviews({ PERatio: 'None' }, { PERatio: '12' }).PERatio, '12');

console.log(`\nextfund.test: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
