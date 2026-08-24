// Generates a small, valid SAMPLE data.json so the PWA renders before the real
// producer ever runs. Deterministic (no randomness). The real snapshot replaces this.
// Run: node producer/make-sample-data.mjs   (writes ../data.json)
import { writeFileSync } from 'node:fs';
import { makeDecision, gradeDecisions } from './agentic-ledger.mjs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { makeKey, RH } from './key.mjs';
import { emit } from './emit.mjs';
import { MARKET_SYMBOLS } from './markets.mjs';
import { LEADERS } from './leaders.mjs';
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
  /* A 100+ share, underwater, high-vol name — the only kind that can carry a covered call. Without
     one, NOTHING in local preview exercised the option-collateral rules: no idea could be generated,
     no position could pledge shares, and the Plan tab's "held back by your own covered calls" path
     was unreachable. Mirrors the real ••••0741 IREN lot (350 sh @ $46.94, 300 of them pledged). */
  { symbol: 'IREN', quantity: '350', average_buy_price: '46.94', px: 42.85, prev: 42.84 },
];
/* `PF_SAMPLE_CONCENTRATED=1` shrinks the rest of the book so IREN breaches the 50% single-name cap
   by MORE than its 50 unpledged shares can cover. That is the case the reserve exists for and the
   only way to see it: the plan must trim what it can, then say plainly that the remaining overage is
   locked behind the covered calls and name buying them back as the way out. Same pattern as
   PF_SAMPLE_MARGIN — the default fixture stays a normal book. */
if (process.env.PF_SAMPLE_CONCENTRATED) {
  POS.splice(POS.findIndex((p) => p.symbol === 'GLD'), 1);
  POS.find((p) => p.symbol === 'AAPL').quantity = '10';
}
const BENCH = [ { symbol: 'SPY', px: 612.4 }, { symbol: 'QQQ', px: 548.9 } ];

const equityVal = POS.reduce((s, p) => s + p.px * (+p.quantity), 0);
/* Mirror the real payload contract: total_value = equity_value + options_value + cash. `equity_value`
   is GROSS long market value, so on margin (cash < 0) the two diverge by the whole loan — the fixture
   used to set total_value = equity_value and carry positive cash, which is internally inconsistent and
   meant the margin banner / Margin Used tile were never exercised in local preview. That is how the
   v116 "37.7% of equity" bug (loan ÷ gross exposure) survived. `PF_SAMPLE_MARGIN=1` renders a levered
   book so those surfaces can be eyeballed. */
const cash = process.env.PF_SAMPLE_MARGIN ? -11282.65 : 1200.0;
const totalVal = equityVal + cash;

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
    /* In margin mode use the real account's buying power, so the fixture reproduces the reported
       screen exactly: margin total = buying_power + loan = 16,976.33 + 11,282.65 = 28,258.98, which
       is the figure the Leverage tile's "% of line" divides by. */
    buying_power: { buying_power: (process.env.PF_SAMPLE_MARGIN ? 16976.33 : Math.max(0, totalVal * 2 - equityVal)).toFixed(2) },
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
// Monthly (5Y) history for holdings too — powers the Analyze tab's Multi-Timeframe card's
// true monthly row (the producer fetches monthly bars for top holdings, not just markets).
for (const p of POS) hist.month[p.symbol] = monthSeries(p.symbol, p.px, (drift[p.symbol] ?? 0.1) + 0.6).bars;

// Markets-tab symbols (indexes + risk gauges + sectors): quotes + day + month history,
// so the Markets tab renders fully in preview just like the real producer output.
for (const s of MARKET_SYMBOLS) {
  const endPx = quotes[s] ? parseFloat(quotes[s].last_trade_price) : mktPx(s);
  if (!quotes[s]) quotes[s] = { last_trade_price: String(endPx), adjusted_previous_close: (endPx * 0.997).toFixed(2) };
  const d = drift[s] ?? 0.12;
  if (!hist.day[s]) hist.day[s] = series(s, endPx, d).bars;
  hist.month[s] = monthSeries(s, endPx, d + 0.6).bars; // 5Y drift larger than YTD
}

// Mega-cap leaders bench (Plan-page Ideal Portfolio) — give each a sample quote so the preview can
// price + bracket them, just like the real producer (which quotes LEADER_SYMBOLS every run).
const leaderPx = { NVDA:164.3, MSFT:498.2, AAPL:295.9, AVGO:338.1, ORCL:201.4, GOOGL:359.5, META:712.6, NFLX:76.5, AMZN:238.7, HD:412.0, LLY:842.3, UNH:498.6, JPM:289.4, V:357.8, MA:561.2, COST:955.8, WMT:104.6, PG:168.9, XOM:118.3 };
for (const l of LEADERS) {
  if (!quotes[l.sym]) { const px = leaderPx[l.sym] || 100; quotes[l.sym] = { last_trade_price: String(px), adjusted_previous_close: (px * 0.996).toFixed(2) }; }
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
recorded[avKey('TREASURY_YIELD', { interval: 'monthly', maturity: '2year' })] =
  avText(csv([{ t: '2026-06-01', v: '3.95' }, { t: '2026-05-01', v: '4.05' }]));
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
  // The agentic book's names — real runs record these too (load() covers ••••3900's holdings since
  // v98), so without them the Accounts page's agentic Allocation/Fundamentals/Income cards render
  // mostly "Uncategorized" in preview and can't show whether those paths actually work.
  V:    { Sector: 'FINANCIAL SERVICES', Industry: 'Credit Services', PERatio: '31.4', ForwardPE: '26.8', PEGRatio: '2.2', Beta: '0.95', DividendYield: '0.0071', EPS: '10.75', QuarterlyRevenueGrowthYOY: '0.10', AnalystTargetPrice: '385', ProfitMargin: '0.54' },
  GOOGL:{ Sector: 'COMMUNICATION SERVICES', Industry: 'Internet Content', PERatio: '25.8', ForwardPE: '22.4', PEGRatio: '1.4', Beta: '1.04', DividendYield: '0.0042', EPS: '13.20', QuarterlyRevenueGrowthYOY: '0.22', AnalystTargetPrice: '405', ProfitMargin: '0.31' },
  SPY:  { Sector: 'N/A', Industry: 'Exchange Traded Fund', PERatio: 'None', ForwardPE: 'None', PEGRatio: 'None', Beta: '1.00', DividendYield: '0.0118', DividendPerShare: '7.20', ExDividendDate: '2026-09-19', EPS: 'None', QuarterlyRevenueGrowthYOY: 'None', AnalystTargetPrice: 'None', ProfitMargin: 'None' },
};
// Margin holdings ∪ the agentic book, so both sides of the Accounts tab have overviews in preview.
const OV_SYMS = [...new Set([...POS.map((p) => p.symbol), 'V', 'GOOGL', 'SPY'])];
for (const sym of OV_SYMS) recorded[avKey('COMPANY_OVERVIEW', { symbol: sym.replace(/\./g, '-') })] =
  avStruct(Object.assign({ Symbol: sym, Name: sym }, OV[sym] || {}));

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
// sample breadth (VIX + your-book movers) for the Markets "Breadth" card
picks.markets = {
  vix: { level: '16.40', chg: '' },
  movers: { gainers: [{ t: 'NVDA', chg: '+2.0%' }, { t: 'MSFT', chg: '+0.6%' }],
            losers: [{ t: 'AAPL', chg: '-1.1%' }, { t: 'GLD', chg: '-0.2%' }] },
};

// --- sample Options (pending covered call + directional ideas) ---
/* A QUEUED sell-to-open on the same IREN lot. It reserves collateral just like a filled one — the
   shares are spoken for the moment the order is live — so the fixture keeps the pledge internally
   consistent: 2 open contracts + 1 pending = 300 of the 350 shares, leaving 50 free. `premium` is
   the whole order's credit ($3.40/sh × 100 × 1). */
const optPending = [ analyzeLeg(
  { chain_symbol:'IREN', side:'sell', option_type:'call', strike_price:'52', expiration_date:'2026-09-18' },
  42.85, 350, { quantity:1, premium:340, direction:'credit', chain_symbol:'IREN', costBasis:46.94 }) ];
optPending[0].state='queued';
Object.assign(optPending[0], { mark:3.45, bid:3.40, ask:3.50, delta:0.35, theta:-0.114, vega:0.082, gamma:0.0125, iv:102, ivRank:68, openInterest:10412, assignProb:35, itm:false, costBasis:46.94, limitPrice:3.40, live:true });
/* IREN is passed with freeShares 50, so the generator must DECLINE to write a fourth call on it and
   fall through to GRAB. That refusal is the fix under test — before it, the sample cheerfully
   offered a covered call on shares that were already pledged. */
const sampleIdeas = buildIdeas(picks.candidates, [
  { symbol:'IREN', underlying:'IREN', shares:350, freeShares:50, px:42.85 },
  { symbol:'GRAB', underlying:'GRAB', shares:124, px:4.50 },
], { NFLX:'77.33', PEP:'142.5', KLAC:'261.1', GRAB:'4.50' }, {
  // sample live quotes so preview shows the LIVE path (real producer fills these from RH)
  NFLX:{ strike:81, expiration:'2026-07-17', mark:3.45, bid:3.40, ask:3.50, breakeven:84.45, iv:1.02, delta:0.35, theta:-0.118, vega:0.090, gamma:0.011, openInterest:10412, volume:2969, popLong:0.20 },
});
// sample IV ranks so preview shows the cheap/rich badge
const sampleIvRank = { NFLX:62, IREN:68, PEP:24, KLAC:55, GRAB:71 };
sampleIdeas.ideas.forEach((i) => { if (sampleIvRank[i.underlying] != null) i.ivRank = sampleIvRank[i.underlying]; });
/* Two OPEN short calls against the 350-share IREN lot; a third is queued below, so 300 of the 350
   shares are pledged and 50 are free. This is the real
   account's position, and it makes every option-collateral surface reachable in local preview: the
   Plan tab must hold those 300 shares back from any exit or cap trim (selling them would leave the
   calls NAKED), and the idea generator must decline to write a fourth call on 50 free shares.
   Units mirror the real payload and are the whole point of the fixture: `premium` is the WHOLE
   position's credit in dollars ($2.92/sh × 100 × 2 = $584) and `perShare` is per share. Confusing
   the two by 100× is precisely the bug that reported an $87,600 credit on an $876 trade. */
const optPositions = [{
  underlying: 'IREN', type: 'call', side: 'short', contracts: 2, strike: 50, expiration: '2026-09-11',
  dte: 22, premium: 584, perShare: 2.92, covered: true, itm: false, moneyness: 'OTM -14.3%',
  breakeven: 52.92, maxProfit: 1196, underlyingPx: 42.85, costBasis: 46.94,
  mark: 1.99, bid: 1.81, ask: 2.17, delta: 0.32, theta: -0.088, vega: 0.038, gamma: 0.0327,
  iv: 102, openInterest: 966, pnl: 186, assignProb: 32, live: true, ivRank: 41,
  summary: 'Covered call — income trade. Keep the $584 premium; 200 sh capped at $50 until 2026-09-11.',
  rollAlert: null,
}];
const options = {
  asOf: new Date().toISOString(), pending: optPending, positions: optPositions,
  history: [{ symbol: 'AMC', net: -61, trades: 2, date: '2024-05-17' }], realized: -61,
  ideas: sampleIdeas,
  ivObserved: { NFLX:102, IREN:95, PEP:31, KLAC:48 }, ivRank: sampleIvRank,
  premiumYTD: 924,
  exposure: { positions:2, contracts:3, netDelta:-99, cspCash:0, sharesCapped:300, openPremium:743 },
};

// --- sample news sentiment (Analyze tab News card; real producer fills from AV NEWS_SENTIMENT) ---
const news = {
  NVDA: { score: 0.28, label: 'Somewhat-Bullish', n: 42, recent: [
    { title: 'NVIDIA data-center demand stays strong into next quarter', url: 'https://example.com/nvda1', source: 'Newswire', sentiment: 'Bullish' },
    { title: 'Analysts nudge NVDA targets higher on AI capex', url: 'https://example.com/nvda2', source: 'MarketDesk', sentiment: 'Somewhat-Bullish' },
    { title: 'Chip supply normalizing, margins watched', url: 'https://example.com/nvda3', source: 'TechWire', sentiment: 'Neutral' },
  ] },
  AAPL: { score: -0.12, label: 'Neutral', n: 31, recent: [
    { title: 'Apple services growth offsets hardware softness', url: 'https://example.com/aapl1', source: 'Newswire', sentiment: 'Neutral' },
    { title: 'Regulatory scrutiny continues in EU', url: 'https://example.com/aapl2', source: 'PolicyDesk', sentiment: 'Somewhat-Bearish' },
  ] },
};

const now = new Date(); // sample stamp only
const data = {
  schemaVersion: 1,
  generatedAt: now.toISOString(),
  generatedAtLabel: 'SAMPLE DATA · ' + now.toISOString().slice(0, 16).replace('T', ' ') + ' UTC',
  sample: true,
  // v121: the regime input for deployment pacing. PF_SAMPLE_VIX=33 (or 25) exercises the stressed /
  // elevated banner + the stretched idle-cash deadline; default is a calm tape, which renders nothing.
  vix: { v: +(process.env.PF_SAMPLE_VIX || 15.9), asOf: now.toISOString().slice(0, 10) },
  recorded,
  quotes,
  hist,
  picks,
  options,
  news,
  leaders: LEADERS,
  // Sample flow read spanning BOTH books: each account side of the Accounts tab renders its OWN
  // Flow card filtered to its own names, so the fixture needs margin names (NVDA/MSFT/AAPL/GLD)
  // AND agentic ones (SPY/NVDA/V/GOOGL + LLY, a target name not yet opened) to exercise both.
  flow: {
    asOf: now.toISOString().slice(0, 10),
    symbols: {
      NVDA: { sym: 'NVDA', flow: { score: 6.8 }, revision: { score: 6.4, delta: 0.05 }, insider: { score: 3.2, cluster: 'sell', buyers: 1, sellers: 6 }, surprise: { score: 7.5 } },
      SPY:  { sym: 'SPY',  flow: null, revision: null, insider: null, surprise: null },
      AAPL: { sym: 'AAPL', flow: { score: 5.4 }, revision: { score: 5.9, delta: 0 }, insider: { score: 4.8, cluster: null, buyers: 2, sellers: 3 }, surprise: { score: 6.1 } },
      MSFT: { sym: 'MSFT', flow: { score: 6.2 }, revision: { score: 6.6, delta: 0.04 }, insider: { score: 4.1, cluster: 'sell', buyers: 0, sellers: 4 }, surprise: { score: 7.0 } },
      GLD:  { sym: 'GLD',  flow: null, revision: null, insider: null, surprise: null },
      V:    { sym: 'V',    flow: { score: 6.9 }, revision: { score: 6.8, delta: 0.06 }, insider: { score: 5.2, cluster: null, buyers: 2, sellers: 2 }, surprise: { score: 7.4 } },
      GOOGL:{ sym: 'GOOGL',flow: { score: 7.5 }, revision: { score: 7.3, delta: 0.14 }, insider: { score: 6.0, cluster: 'buy', buyers: 3, sellers: 1 }, surprise: { score: 8.1 } },
      LLY:  { sym: 'LLY',  flow: { score: 7.2 }, revision: { score: 7.0, delta: 0.11 }, insider: { score: 6.5, cluster: 'buy', buyers: 4, sellers: 1 }, surprise: { score: 7.8 }, award: { score: 4.0 } },
    },
    polEvents: [{ filer: 'Sample Member', sym: 'NVDA', side: 'buy', date: '2026-07-20' }],
  },
  // Sample agentic account so the Agentic Portfolio card renders populated in local preview
  // (real runs emit this from agentic-portfolio.json/agentic-positions.json in build-data.mjs).
  /* The self-directed account's REAL recorded equity history — the same shape build-data.mjs writes
     from get_portfolio.total_value, so the Accounts tab's YTD tile and the "This account since …"
     stat render in preview instead of falling back to the modelled figure (which is what they did
     before this account had a series at all). Anchored to the SPY bar dates for the same reason the
     agentic one is: a now-relative history would sit past the last bar and every benchmark
     comparison would show "—", masking whether the code path works. Carries a mid-series deposit so
     the deposit-adjusted math is exercised, and an `optionsValue` on each point so the flow
     inference's options term is visible in the fixture. */
  main: (() => {
    const spy = hist.day.SPY || [];
    const dates = spy.slice(-15).map((b) => String(b.begins_at || b.t).slice(0, 10));
    const DEPOSIT = 2000, AT = 6;
    const start = +(totalVal - DEPOSIT - 640).toFixed(2);   // ends on today's equity, ~$640 earned
    const out = []; let cumFlow = 0;
    dates.forEach((t, n) => {
      if (n === AT) cumFlow += DEPOSIT;
      const grown = start * (1 + 0.0052 * n) + (n % 2 ? 22 : -14);
      out.push({ t, equity: +(grown + cumFlow).toFixed(2), cumFlow, optionsValue: -597 });
    });
    out[out.length - 1].equity = +totalVal.toFixed(2);      // end exactly on the live figure
    return { asOf: new Date().toISOString(), equity: +totalVal.toFixed(2), cash: +cash.toFixed(2),
      optionsValue: -597, positions: POS.map((p) => ({ symbol: p.symbol, qty: +p.quantity, px: p.px })),
      equityHistory: out };
  })(),
  agentic: (() => {
    // Priced FROM the fixture's own quotes — the real producer prices agentic positions off the
    // same quote table, and two consumer surfaces cross-check them in preview: the day-move hero
    // computes qty×(px − quote prev close), and Account Performance reads equity against the
    // history. Hardcoded px values that disagree with the quotes made the hero show a fake ~+5%
    // day on a flat sample book (and a made-up round equity contradicted "money made").
    const pos = [['SPY', 0.231, 0.006], ['NVDA', 0.770, 0.007], ['V', 0.416, 0.005], ['GOOGL', 0.381, 0.001], ['VTI', 0.402, 0.002]]
      .map(([symbol, qty, gain]) => {
        const px = parseFloat((quotes[symbol] || {}).last_trade_price) || 100;
        return { symbol, qty, avgCost: +(px * (1 - gain)).toFixed(2), px, value: +(qty * px).toFixed(2) };
      });
    const cash = 196.0;
    const equity = +(cash + pos.reduce((s, p) => s + p.value, 0)).toFixed(2);
    return {
    asOf: now.toISOString(),
    cash,
    buyingPower: cash,
    equity,
    positions: pos,
    // Sample research target: the four held names + one not yet opened (LLY), so preview
    // exercises the research-target path, the Targets-to-open strip, and the Flow card's 🎯 tag.
    target: { asOf: now.toISOString().slice(0, 10), method: 'sample', driftTriggerPp: 5, names: [
      { ticker: 'SPY',   weightPct: 30, sector: 'Index', thesis: 'Uncapped index ballast; core hold, not a trade.' },
      // Entry zone deliberately BELOW the fixture's NVDA quote so the Plan page's `above-entry`
      // deferral (and the VTI parking that follows it) actually renders in preview.
      { ticker: 'NVDA',  weightPct: 22, sector: 'Technology', entry: '150 – 160', stop: 138, target: 205, drivers: ['momentum', 'growth'], thesis: 'AI capex cycle leader; sized under the cluster cap.' },
      { ticker: 'V',     weightPct: 18, sector: 'Financial Services', thesis: 'Toll booth on card volume; steady compounder.' },
      { ticker: 'GOOGL', weightPct: 18, sector: 'Communication Services', thesis: 'Search cash flows fund the cloud/AI build.' },
      { ticker: 'LLY',   weightPct: 12, sector: 'Healthcare', entry: '$610 – $630', stop: 585, target: 690, thesis: 'Incretin franchise still supply-constrained.' },
    ] },
    // ── Plan-tab (v108) fixtures: the executor/planner state the agentic PLAN page reads. Without
    //    these, local preview shows every card in its empty state and the deferral/parking/ticket
    //    paths go unexercised. Mirrors the shapes build-data.mjs emits from the committed
    //    agentic-parked.json / agentic-pending.json / trade history.
    cashIdleSince: (() => { const d = new Date(now); d.setUTCDate(d.getUTCDate() - 4); return d.toISOString().slice(0, 10); })(),
    parked: { vehicle: 'VTI', dollars: 120.4, forNames: ['NVDA'], since: now.toISOString().slice(0, 10) },
    // A cross-account loss (booked in the self-directed book) — the v105 case the wash guard exists
    // for: the IRS window is per taxpayer, so it must block a rebuy in the agentic account too.
    recentLosses: [{ sym: 'GOOGL', date: (() => { const d = new Date(now); d.setUTCDate(d.getUTCDate() - 9); return d.toISOString().slice(0, 10); })(), realized: -84.2, account: 'main' }],
    lossSource: 'trades',
    // v121: a graded decision ledger WITH sleeve drivers, so the Rebalance Log's "By research sleeve"
    // strip renders in preview instead of sitting invisible. Built through the REAL gradeDecisions /
    // makeDecision path rather than hand-written, so the fixture can't drift from the shipped shape.
    decisions: (() => {
      const d = (n) => { const x = new Date(now); x.setUTCDate(x.getUTCDate() - n); return x.toISOString().slice(0, 10); };
      const tgt = { names: [
        { ticker: 'SPY', drivers: ['quality'] },
        { ticker: 'NVDA', drivers: ['momentum', 'growth'] },
        { ticker: 'GOOGL', drivers: ['quality', 'valuation'] },
        { ticker: 'LLY', drivers: ['growth'] },
      ]};
      const decs = [
        makeDecision({ date: d(38), book: 9000, spyAt: 690, target: tgt, rationale: 'initial deploy into the verified target',
          buys: [{ sym: 'SPY', dollars: 900, shares: 1.2, price: 700 }, { sym: 'NVDA', dollars: 700, shares: 3.4, price: 205 }] }),
        makeDecision({ date: d(24), book: 9600, spyAt: 715, target: tgt, rationale: 'deposit deployed',
          buys: [{ sym: 'GOOGL', dollars: 600, shares: 1.8, price: 330 }, { sym: 'NVDA', dollars: 400, shares: 1.9, price: 210 }] }),
        makeDecision({ date: d(11), book: 10050, spyAt: 733, target: tgt, rationale: 'drift top-up',
          buys: [{ sym: 'LLY', dollars: 500, shares: 0.8, price: 620 }, { sym: 'GOOGL', dollars: 300, shares: 0.9, price: 335 }] }),
      ];
      return gradeDecisions(decs, quotes, now.toISOString().slice(0, 10));
    })(),
    // ── v121 fixtures: the surfaces added with the drawdown breaker / regime pacing / sleeve
    //    attribution. A surface that can't be previewed rots (the v116 lesson), so each of these
    //    exists purely so the local preview exercises the new card states.
    //    PF_SAMPLE_DRAWDOWN=soft|hard trips the book-level breaker banner + its guardrail row.
    drawdown: (() => {
      const lvl = String(process.env.PF_SAMPLE_DRAWDOWN || '').toLowerCase();
      if (lvl !== 'soft' && lvl !== 'hard') return { dd: -0.016, level: 'ok', peakT: now.toISOString().slice(0, 10), points: 39, insufficient: false, note: 'book -1.6% from its peak — deployment normal' };
      const dd = lvl === 'hard' ? -0.141 : -0.093;
      return { dd, level: lvl, peakT: (() => { const d = new Date(now); d.setUTCDate(d.getUTCDate() - 21); return d.toISOString().slice(0, 10); })(),
        points: 39, insufficient: false, note: `book ${(dd * 100).toFixed(1)}% from its peak — new deployment paused` };
    })(),
    pending: { id: now.toISOString().slice(0, 10) + '-sample', created: now.toISOString().slice(0, 10), status: 'proposed',
      autoEligible: false, turnover: 1420.5, book: equity, taxSummary: { gains: 61.4, losses: -22.8, net: 38.6 },
      legs: { sells: [{ sym: 'V', kind: 'trim', dollars: 62.4 }], buysNow: [{ sym: 'SPY', dollars: 48.1 }, { sym: 'LLY', dollars: 120.6 }], buysT1: [] } },
    // Sample real equity history (~2 trading weeks) so the consumer's REAL agentic line, the
    // "Agentic since" stat and the Account Performance card all render. Includes a mid-series
    // $250 DEPOSIT (annotated via the running cumFlow, exactly as build-data.mjs infers it) so the
    // deposit-adjusted math is actually exercised in local preview: raw equity jumps, but the
    // time-weighted return must not — and the Value-mode chart shows the contribution step.
    equityHistory: (() => {
      // Anchor the points to the LAST 15 SPY bar dates rather than to `now`. The fixture's daily
      // bars are a fixed historical stub, so a now-relative history would sit entirely after the
      // last bar — SPY-since would find no starting bar and every benchmark comparison would show
      // "—" in preview (masking whether that code path works at all).
      const spy = hist.day.SPY || [];
      const dates = spy.slice(-15).map((b) => String(b.begins_at || b.t).slice(0, 10));
      const DEPOSIT = 250, AT = 8;                          // a $250 deposit lands at point 8
      const start = +(equity - DEPOSIT - 51.8).toFixed(2);  // ends on today's equity, ~$51.80 earned
      const out = []; let cumFlow = 0;
      dates.forEach((t, n) => {
        if (n === AT) cumFlow += DEPOSIT;
        const grown = start * (1 + 0.0037 * n) + (n % 2 ? 1.5 : -1);
        out.push({ t, equity: +(grown + cumFlow).toFixed(2), cumFlow });
      });
      out[out.length - 1].equity = equity;                  // end exactly on the live figure
      return out;
    })(),
    };
  })(),
};

await emit(data);
console.log('  sample:', Object.keys(recorded).length, 'recorded (incl. AV macro/fundamentals/earnings) ·',
  Object.keys(quotes).length, 'quotes ·', Object.keys(hist.day).length, 'daily ·', Object.keys(hist.month).length, 'monthly histories ·',
  picks.candidates.length, 'picks (top:', picks.picks.map((p) => p.ticker).join('/') + ')');
