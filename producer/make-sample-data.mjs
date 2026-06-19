// Generates a small, valid SAMPLE data.json so the PWA renders before the real
// producer ever runs. Deterministic (no randomness). The real snapshot replaces this.
// Run: node producer/make-sample-data.mjs   (writes ../data.json)
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { makeKey, RH } from './key.mjs';
import { emit } from './emit.mjs';
import { MARKET_SYMBOLS } from './markets.mjs';
import { avKey } from './av.mjs';
import { buildPicks } from './picks.mjs';
import { analyzeLeg, buildIdeas } from './options.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

// --- a tiny sample book (4 positions) ---
const POS = [
  { symbol: 'NVDA', quantity: '40',  average_buy_price: '95.00',  px: 168.4, prev: 165.1 },
  { symbol: 'MSFT', quantity: '18',  average_buy_price: '410.00', px: 498.2, prev: 495.0 },
  { symbol: 'AAPL', quantity: '30',  average_buy_price: '180.00', px: 296.0, prev: 299.3 },
  { symbol: 'GLD',  quantity: '25',  average_buy_price: '210.00', px: 252.7, prev: 251.9 },
];
const BENCH = [ { symbol: 'SPY', px: 612.4 }, { symbol: 'QQQ', px: 548.9 } ];

const equityVal = POS.reduce((s, p) => s + p.px * (+p.quantity), 0);
const totalVal = equityVal;       // no margin in the sample
const cash = 1200.0;

// --- build a deterministic ~120-bar daily series from Jan 1, trending to current px ---
function series(symbol, endPx, drift) {
  const out = [];
  const days = 120;
  const start = endPx / (1 + drift);          // so YTD return ≈ drift
  for (let i = 0; i < days; i++) {
    const t = i / (days - 1);
    // smooth trend + gentle wave, fully deterministic
    const wave = Math.sin(t * Math.PI * 3) * endPx * 0.02;
    const c = start + (endPx - start) * t + wave;
    const d = new Date(Date.UTC(2026, 0, 2 + i));
    out.push({ begins_at: d.toISOString(), close_price: c.toFixed(2), interpolated: false });
  }
  return { symbol, bars: out };
}

// Deterministic pseudo-price for a symbol so the sample Markets tab is fully populated.
function mktPx(sym) {
  let h = 0; for (let i = 0; i < sym.length; i++) h = (h * 31 + sym.charCodeAt(i)) >>> 0;
  return 40 + (h % 600); // stable 40–640 range
}
// ~60 monthly bars (5 years), trending up to endPx, fully deterministic.
function monthSeries(symbol, endPx, drift) {
  const out = [], months = 60, start = endPx / (1 + drift);
  for (let i = 0; i < months; i++) {
    const t = i / (months - 1);
    const wave = Math.sin(t * Math.PI * 4) * endPx * 0.03;
    const c = start + (endPx - start) * t + wave;
    const d = new Date(Date.UTC(2021, 5 + i, 1));
    out.push({ begins_at: d.toISOString(), close_price: c.toFixed(2), interpolated: false });
  }
  return { symbol, bars: out };
}

const recorded = {};   // exact-key calls: portfolio, positions, (AV in the real producer)
const quotes = {};     // per-symbol quote store
const hist = { day: {}, month: {} }; // per-symbol historicals, by interval

// get_portfolio
recorded[makeKey(RH + 'get_portfolio', { account_number: 'ACCT' })] = {
  structuredContent: { data: {
    total_value: totalVal.toFixed(2),
    equity_value: equityVal.toFixed(2),
    cash: cash.toFixed(2),
    buying_power: { buying_power: (cash * 2).toFixed(2) },
  } },
};

// get_equity_positions
recorded[makeKey(RH + 'get_equity_positions', { account_number: 'ACCT' })] = {
  structuredContent: { data: { positions: POS.map((p) => ({
    symbol: p.symbol, quantity: p.quantity, average_buy_price: p.average_buy_price,
  })) } },
};

// per-symbol quotes
for (const p of POS) quotes[p.symbol] = { last_trade_price: String(p.px), adjusted_previous_close: String(p.prev) };
for (const b of BENCH) quotes[b.symbol] = { last_trade_price: String(b.px), adjusted_previous_close: String((b.px * 0.997).toFixed(2)) };

// per-symbol daily historicals (positions + benchmarks)
const drift = { NVDA: 0.42, MSFT: 0.18, AAPL: -0.05, GLD: 0.21, SPY: 0.11, QQQ: 0.14 };
for (const s of [...POS.map((p) => p.symbol), 'SPY', 'QQQ']) {
  const endPx = s === 'SPY' ? 612.4 : s === 'QQQ' ? 548.9 : POS.find((p) => p.symbol === s).px;
  hist.day[s] = series(s, endPx, drift[s] ?? 0.1).bars;
}

// Markets-tab symbols (indexes + risk gauges + sectors): quotes + day + month history,
// so the Markets tab renders fully in preview just like the real producer output.
for (const s of MARKET_SYMBOLS) {
  const endPx = quotes[s] ? parseFloat(quotes[s].last_trade_price) : mktPx(s);
  if (!quotes[s]) quotes[s] = { last_trade_price: String(endPx), adjusted_previous_close: (endPx * 0.997).toFixed(2) };
  const d = drift[s] ?? 0.12;
  if (!hist.day[s]) hist.day[s] = series(s, endPx, d).bars;
  hist.month[s] = monthSeries(s, endPx, d + 0.6).bars; // 5Y drift larger than YTD
}

// --- sample Alpha Vantage responses (macro + fundamentals + earnings) -------
// Shapes match what index.html's parseAV/fetchMacro/fetchOverviewBatch expect.
const avText = (obj) => ({ content: [{ type: 'text', text: typeof obj === 'string' ? obj : JSON.stringify(obj) }] });
const avStruct = (obj) => ({ structuredContent: obj });
// macro: the live free-tier connector returns CSV (header `timestamp,value`, newest first)
// for these economic indicators — mirror that here so preview exercises the parseCSV path.
// (VIX/INDEX_DATA is premium-only on the free key, so it's intentionally absent → tile "—".)
const csv = (rows) => 'timestamp,value\n' + rows.map((r) => `${r.t},${r.v}`).join('\n');
recorded[avKey('TREASURY_YIELD', { interval: 'monthly', maturity: '10year' })] =
  avText(csv([{ t: '2026-06-01', v: '4.32' }, { t: '2026-05-01', v: '4.48' }]));
recorded[avKey('FEDERAL_FUNDS_RATE', { interval: 'monthly' })] =
  avText(csv([{ t: '2026-06-01', v: '4.33' }, { t: '2026-05-01', v: '4.33' }]));
recorded[avKey('CPI', { interval: 'monthly' })] =
  avText(csv(Array.from({ length: 14 }, (_, i) => ({ t: `2026-${String(6 - i).padStart(2, '0')}-01`, v: (315.4 - i * 0.6).toFixed(1) }))));
// VIX: build-data.mjs synthesizes this INDEX_DATA shape from the free Robinhood index
// quote (AV's INDEX_DATA is premium). Mirror that here so the sample macro card shows it.
recorded[avKey('INDEX_DATA', { symbol: 'VIX', interval: 'daily' })] = { structuredContent: { data: [{ close: '16.4' }] } };
// earnings calendar → CSV string (parseAV returns it verbatim; consumer parseCSV's it)
const earnDate = new Date(Date.now() + 9 * 86400 * 1000).toISOString().slice(0, 10);
recorded[avKey('EARNINGS_CALENDAR', { horizon: '3month' })] =
  avText(`symbol,name,reportDate,fiscalDateEnding,estimate,currency\nNVDA,NVIDIA Corp,${earnDate},2026-07-31,1.05,USD`);
// company overview per sample holding → object with Symbol + fundamentals fields
const OV = {
  NVDA: { Sector: 'TECHNOLOGY', Industry: 'Semiconductors', PERatio: '52.1', ForwardPE: '38.4', PEGRatio: '1.3', Beta: '1.72', DividendYield: '0.0003', EPS: '3.10', QuarterlyRevenueGrowthYOY: '0.69', AnalystTargetPrice: '185', ProfitMargin: '0.55' },
  MSFT: { Sector: 'TECHNOLOGY', Industry: 'Software', PERatio: '36.8', ForwardPE: '31.2', PEGRatio: '2.1', Beta: '0.91', DividendYield: '0.0072', EPS: '13.05', QuarterlyRevenueGrowthYOY: '0.16', AnalystTargetPrice: '540', ProfitMargin: '0.36' },
  AAPL: { Sector: 'TECHNOLOGY', Industry: 'Consumer Electronics', PERatio: '31.0', ForwardPE: '28.5', PEGRatio: '2.6', Beta: '1.25', DividendYield: '0.0044', EPS: '6.95', QuarterlyRevenueGrowthYOY: '0.05', AnalystTargetPrice: '310', ProfitMargin: '0.25' },
  GLD:  { Sector: 'N/A', Industry: 'Exchange Traded Fund', PERatio: 'None', ForwardPE: 'None', PEGRatio: 'None', Beta: '0.12', DividendYield: '0.0', EPS: 'None', QuarterlyRevenueGrowthYOY: 'None', AnalystTargetPrice: 'None', ProfitMargin: 'None' },
};
for (const p of POS) recorded[avKey('COMPANY_OVERVIEW', { symbol: p.symbol.replace(/\./g, '-') })] =
  avStruct(Object.assign({ Symbol: p.symbol, Name: p.symbol }, OV[p.symbol] || {}));

// --- sample Daily Picks (exercises the same scoring engine the producer uses) ---
const pickFinalists = [
  { ticker: 'NFLX',  name: 'Netflix Inc.',        price: 77.33,  rsi: 28, marketCap: 3.26e11 },
  { ticker: 'PEP',   name: 'PepsiCo Inc.',        price: 142.5,  rsi: 36, marketCap: 1.95e11 },
  { ticker: 'KLAC',  name: 'KLA Corporation',     price: 261.1,  rsi: 41, marketCap: 3.39e11 },
  { ticker: 'CVX',   name: 'Chevron Corporation', price: 173.9,  rsi: 43, marketCap: 3.46e11 },
];
const pickFund = {
  NFLX: { symbol: 'NFLX', pe_ratio: '24.0', pb_ratio: '9.1', sector: 'Communication Services', dividend_yield: '0.0', high_52_weeks: '112.0', low_52_weeks: '70.0' },
  PEP:  { symbol: 'PEP',  pe_ratio: '16.5', pb_ratio: '11.2', sector: 'Consumer Defensive', dividend_yield: '3.6', high_52_weeks: '180.0', low_52_weeks: '138.0' },
  KLAC: { symbol: 'KLAC', pe_ratio: '28.4', pb_ratio: '18.0', sector: 'Technology', dividend_yield: '0.8', high_52_weeks: '310.0', low_52_weeks: '230.0' },
  CVX:  { symbol: 'CVX',  pe_ratio: '13.8', pb_ratio: '1.8', sector: 'Energy', dividend_yield: '4.5', high_52_weeks: '195.0', low_52_weeks: '160.0' },
};
const pickOv = { // hybrid: AV growth on a couple of finalists; others fall back to value-only
  NFLX: { Symbol: 'NFLX', Sector: 'Communication Services', ForwardPE: '24.0', QuarterlyRevenueGrowthYOY: '0.162' },
  PEP:  { Symbol: 'PEP',  Sector: 'Consumer Defensive', ForwardPE: '16.5', QuarterlyRevenueGrowthYOY: '0.085' },
};
const picks = buildPicks(pickFinalists, pickFund, pickOv);

// --- sample Options (pending covered call + directional ideas) ---
const optPending = [ analyzeLeg(
  { chain_symbol:'IREN', side:'sell', option_type:'call', strike_price:'70', expiration_date:'2026-07-17' },
  60.02, 174, { quantity:1, premium:340, direction:'credit', chain_symbol:'IREN', costBasis:49.37 }) ];
optPending[0].state='queued';
const options = {
  asOf: new Date().toISOString(), pending: optPending, positions: [],
  ideas: buildIdeas(picks.candidates, [
    { symbol:'IREN', underlying:'IREN', shares:174, px:60.02 },
    { symbol:'GRAB', underlying:'GRAB', shares:124, px:4.50 },
  ], { NFLX:'77.33', PEP:'142.5', KLAC:'261.1' }, {
    // sample live quotes so preview shows the LIVE path (real producer fills these from RH)
    NFLX:{ strike:81, expiration:'2026-07-17', mark:3.45, bid:3.40, ask:3.50, breakeven:84.45, iv:1.02, delta:0.35, openInterest:10412, volume:2969, popLong:0.20 },
    IREN:{ strike:65, expiration:'2026-07-17', mark:4.10, bid:4.00, ask:4.20, breakeven:69.10, iv:0.95, delta:0.42, openInterest:8800, volume:1500, popLong:0.30 },
  }),
};

const now = new Date(); // sample stamp only
const data = {
  schemaVersion: 1,
  generatedAt: now.toISOString(),
  generatedAtLabel: 'SAMPLE DATA · ' + now.toISOString().slice(0, 16).replace('T', ' ') + ' UTC',
  sample: true,
  recorded,
  quotes,
  hist,
  picks,
  options,
};

await emit(data);
console.log('  sample:', Object.keys(recorded).length, 'recorded (incl. AV macro/fundamentals/earnings) ·',
  Object.keys(quotes).length, 'quotes ·', Object.keys(hist.day).length, 'daily ·', Object.keys(hist.month).length, 'monthly histories ·',
  picks.candidates.length, 'picks (top:', picks.picks.map((p) => p.ticker).join('/') + ')');
