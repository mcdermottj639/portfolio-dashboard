// Generates a small, valid SAMPLE data.json so the PWA renders before the real
// producer ever runs. Deterministic (no randomness). The real snapshot replaces this.
// Run: node producer/make-sample-data.mjs   (writes ../data.json)
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { makeKey, RH } from './key.mjs';
import { emit } from './emit.mjs';
import { MARKET_SYMBOLS } from './markets.mjs';

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

const now = new Date(); // sample stamp only
const data = {
  schemaVersion: 1,
  generatedAt: now.toISOString(),
  generatedAtLabel: 'SAMPLE DATA · ' + now.toISOString().slice(0, 16).replace('T', ' ') + ' UTC',
  sample: true,
  recorded,
  quotes,
  hist,
};

await emit(data);
console.log('  sample:', Object.keys(recorded).length, 'recorded ·',
  Object.keys(quotes).length, 'quotes ·', Object.keys(hist.day).length, 'daily histories');
