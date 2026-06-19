// Assembles producer/raw/options.json (embedded as data.options by build-data.mjs).
// Reads the option orders/positions + equity holdings + quotes + picks the producer saved.
//
// Inputs (producer/raw/):
//   options-orders.json     get_option_orders result
//   options-positions.json  (optional) get_option_positions result
//   positions.json          equity positions (for covered detection / covered-call ideas)
//   quotes*.json            equity quotes (underlying prices)
//   picks.json              (optional) Daily Picks candidates → bullish call ideas
//
// Usage: node producer/options-build.mjs
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { analyzeLeg, buildIdeas } from './options.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RAW = join(__dirname, 'raw');
const readJSON = (f) => JSON.parse(readFileSync(f, 'utf8'));
function unwrap(r) {
  if (r == null) return r;
  if (r.structuredContent) return r.structuredContent;
  if (r.content && r.content[0] && typeof r.content[0].text === 'string') {
    try { return JSON.parse(r.content[0].text); } catch { return r.content[0].text; }
  }
  return r;
}
const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };

// equity holdings → shares + avg cost by symbol
const sharesBySym = {}, costBySym = {};
if (existsSync(join(RAW, 'positions.json'))) {
  const d = unwrap(readJSON(join(RAW, 'positions.json')));
  for (const p of (d.data?.positions ?? d.positions ?? [])) {
    sharesBySym[p.symbol] = num(p.quantity) || 0; costBySym[p.symbol] = num(p.average_buy_price);
  }
}
// underlying prices from equity quotes
const pxBySym = {};
for (const f of readdirSync(RAW).filter((x) => /^quotes.*\.json$/.test(x))) {
  const d = unwrap(readJSON(join(RAW, f)));
  for (const it of (Array.isArray(d) ? d : (d.data?.results ?? d.results ?? []))) {
    const q = it.quote ?? it; const s = q && (q.symbol || q.ticker);
    if (s) pxBySym[s] = num(q.last_trade_price || q.adjusted_previous_close || q.previous_close);
  }
}

// live quotes for the user's OWN contracts (pending + open), keyed by option instrument id
const posQById = {};
if (existsSync(join(RAW, 'option-pos-quotes.json'))) {
  const d = unwrap(readJSON(join(RAW, 'option-pos-quotes.json')));
  for (const q of (Array.isArray(d) ? d : (d.data?.results ?? d.results ?? d.quotes ?? []))) {
    const id = q.instrument_id || q.id || q.option_id; if (id) posQById[id] = q.quote ?? q;
  }
}
function enrichLive(a, optionId) {
  const q = posQById[optionId]; if (!q || !a) return a;
  a.mark = num(q.mark_price ?? q.adjusted_mark_price);
  a.bid = num(q.bid_price); a.ask = num(q.ask_price);
  a.delta = q.delta != null ? +num(q.delta).toFixed(2) : null;
  a.theta = q.theta != null ? +num(q.theta).toFixed(3) : null;
  a.iv = q.implied_volatility != null ? +(num(q.implied_volatility) * 100).toFixed(0) : null;
  a.openInterest = num(q.open_interest);
  if (q.break_even_price != null) a.breakeven = num(q.break_even_price);
  if (a.mark != null && a.perShare != null)
    a.pnl = +(((a.side === 'short' ? (a.perShare - a.mark) : (a.mark - a.perShare)) * 100 * (a.contracts || 1))).toFixed(0);
  if (a.delta != null) a.assignProb = Math.round(Math.abs(a.delta) * 100); // ≈ chance ITM at expiry
  a.live = true;
  return a;
}

function analyzeOrder(o) {
  const leg = (o.legs || [])[0]; if (!leg) return null;
  const sym = o.chain_symbol; const px = pxBySym[sym];
  if (px == null) return { underlying: sym, type: leg.option_type, side: leg.side === 'sell' ? 'short' : 'long',
    strike: num(leg.strike_price), expiration: leg.expiration_date, contracts: num(o.quantity) || 1,
    premium: num(o.premium), state: o.state, summary: `Underlying quote unavailable for ${sym}.`, underlyingPx: null };
  const a = analyzeLeg(leg, px, sharesBySym[sym] || 0, {
    quantity: o.quantity, premium: num(o.premium), direction: o.direction,
    chain_symbol: sym, costBasis: costBySym[sym],
  });
  a.state = o.state; a.openingStrategy = o.opening_strategy || o.closing_strategy || null;
  a.costBasis = costBySym[sym] != null ? +costBySym[sym] : null;
  a.limitPrice = num(o.price);
  enrichLive(a, leg.option_id);
  return a;
}

const orders = existsSync(join(RAW, 'options-orders.json'))
  ? (unwrap(readJSON(join(RAW, 'options-orders.json'))).data?.orders ?? []) : [];
const PENDING = new Set(['queued', 'confirmed', 'partially_filled', 'unconfirmed']);
const pending = orders.filter((o) => PENDING.has(o.state)).map(analyzeOrder).filter(Boolean);

// open option positions (if any) — map by option_id to an order leg for strike/type/expiry
const legByOptId = {};
for (const o of orders) for (const l of (o.legs || [])) legByOptId[l.option_id] = { leg: l, o };
let positions = [];
if (existsSync(join(RAW, 'options-positions.json'))) {
  const d = unwrap(readJSON(join(RAW, 'options-positions.json')));
  positions = (d.data?.positions ?? d.positions ?? []).map((p) => {
    const ref = legByOptId[p.option_id]; if (!ref) return null;
    const a = analyzeLeg(ref.leg, pxBySym[p.chain_symbol] || 0, sharesBySym[p.chain_symbol] || 0,
      { quantity: p.quantity, premium: num(p.average_price) * 100 * (num(p.quantity) || 1), direction: ref.o.direction, chain_symbol: p.chain_symbol, costBasis: costBySym[p.chain_symbol] });
    a.costBasis = costBySym[p.chain_symbol] != null ? +costBySym[p.chain_symbol] : null;
    enrichLive(a, p.option_id);
    return a;
  }).filter(Boolean);
}

// ideas: bullish calls from picks + covered calls from 100+ share holdings
let picksCands = [];
if (existsSync(join(RAW, 'picks.json'))) picksCands = readJSON(join(RAW, 'picks.json')).candidates ?? [];
const holdings100 = Object.entries(sharesBySym).filter(([, sh]) => sh >= 100)
  .map(([symbol, shares]) => ({ symbol, underlying: symbol, shares, px: pxBySym[symbol] }))
  .filter((h) => h.px).sort((a, b) => b.shares * b.px - a.shares * a.px).slice(0, 3);
// live option quotes for the idea contracts (producer/raw/option-quotes.json), if fetched
const liveBySym = {};
if (existsSync(join(RAW, 'option-quotes.json'))) {
  const d = unwrap(readJSON(join(RAW, 'option-quotes.json')));
  for (const q of (Array.isArray(d) ? d : (d.quotes ?? d.results ?? []))) if (q && q.underlying) liveBySym[q.underlying] = q;
}
const ideas = buildIdeas(picksCands, holdings100, pxBySym, liveBySym);
const liveCount = ideas.ideas.filter((i) => i.live).length;

const out = {
  asOf: new Date().toISOString(),
  pending, positions, ideas,
};
writeFileSync(join(RAW, 'options.json'), JSON.stringify(out, null, 2));
console.log(`options: ${pending.length} pending · ${positions.length} open · ${ideas.ideas.length} ideas (${liveCount} live, ${ideas.ideas.length - liveCount} est)` +
  (pending[0] ? ` · pending: ${pending[0].underlying} ${pending[0].side} ${pending[0].type} $${pending[0].strike}` : ''));
