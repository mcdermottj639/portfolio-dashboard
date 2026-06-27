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
import { decryptEnvelope } from './emit.mjs';

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
  a.vega = q.vega != null ? +num(q.vega).toFixed(3) : null;
  a.gamma = q.gamma != null ? +num(q.gamma).toFixed(4) : null;
  a.iv = q.implied_volatility != null ? +(num(q.implied_volatility) * 100).toFixed(0) : null;
  a.openInterest = num(q.open_interest);
  if (q.break_even_price != null) a.breakeven = num(q.break_even_price);
  if (a.mark != null && a.perShare != null)
    a.pnl = +(((a.side === 'short' ? (a.perShare - a.mark) : (a.mark - a.perShare)) * 100 * (a.contracts || 1))).toFixed(0);
  if (a.delta != null) a.assignProb = Math.round(Math.abs(a.delta) * 100); // ≈ chance ITM at expiry
  a.live = true;
  return a;
}

// 3rd-Friday monthly expiry ~`targetDays` out (mirrors options.mjs.monthlyExpiry, kept local
// so the roll suggestion can name a concrete later expiry without importing internals).
function rollExpiry(targetDays = 35, from = new Date()) {
  const t = new Date(from.getTime() + targetDays * 86400000);
  const d = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), 1));
  const firstFri = 1 + ((5 - d.getUTCDay() + 7) % 7);
  d.setUTCDate(firstFri + 14);
  return d.toISOString().slice(0, 10);
}

// Roll guidance for a short call. When it warrants action, also name a CONCRETE roll target —
// a later monthly expiry and a strike nudged up out of the money — so the alert is actionable,
// not just "consider rolling".
function rollAlert(a) {
  if (!a || a.side !== 'short' || a.type !== 'call') return null;
  const px = a.underlyingPx;
  const newExp = rollExpiry(35);
  // Roll-up strike: ~5% OTM from spot (rounded to a clean $5 above price), never below current strike.
  const rawUp = px != null ? Math.max(a.strike, Math.ceil((px * 1.05) / 5) * 5) : a.strike;
  if (a.itm) return `In-the-money — assignment risk. Roll up/out: buy this back and sell the $${rawUp} call exp ${newExp} to defer assignment and collect more premium.`;
  if (a.dte != null && a.dte <= 10) return `Expires in ${a.dte}d — if it holds below $${a.strike} you keep the premium; otherwise roll to the $${rawUp} call exp ${newExp} for more income.`;
  return null;
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
  a.rollAlert = rollAlert(a);
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
    a.rollAlert = rollAlert(a);
    return a;
  }).filter(Boolean);
}

// ideas: bullish calls from picks + covered calls from 100+ share holdings
let picksCands = [];
if (existsSync(join(RAW, 'picks.json'))) picksCands = readJSON(join(RAW, 'picks.json')).candidates ?? [];
else {
  // Light intraday run: no fresh scan → no raw/picks.json (picks only build on the daily FETCH_ALL).
  // Fall back to the carried-forward picks in the prior committed snapshot so the picks-derived ideas
  // (long calls, cash-secured puts, the debit spread) persist across light runs instead of getting
  // wiped to a covered-calls-only set until the next full run. Decrypt once; ignore any failure.
  try {
    const prevPath = join(__dirname, '..', 'data.json');
    if (existsSync(prevPath) && process.env.PF_PASSPHRASE) {
      const env = JSON.parse(readFileSync(prevPath, 'utf8'));
      const prev = env && env.enc ? await decryptEnvelope(env, process.env.PF_PASSPHRASE) : env;
      if (prev && prev.picks && Array.isArray(prev.picks.candidates)) {
        picksCands = prev.picks.candidates;
        console.log(`options: no raw picks — carried ${picksCands.length} picks forward from prior snapshot for ideas`);
      }
    }
  } catch { /* no prior / wrong passphrase → covered-call ideas only, as before */ }
}
const holdings100 = Object.entries(sharesBySym).filter(([, sh]) => sh >= 100)
  .map(([symbol, shares]) => ({ symbol, underlying: symbol, shares, px: pxBySym[symbol] }))
  .filter((h) => h.px).sort((a, b) => b.shares * b.px - a.shares * a.px).slice(0, 3);

// Per-symbol annualized realized vol from daily historicals (when present this run) — sharpens
// the estimate-path premiums vs a flat 0.55/0.60 proxy. On light runs (no hist-day raw) this is
// empty and buildIdeas falls back to the defaults. Read straight from the raw bars the agent saved.
const ivBySym = {};
for (const f of readdirSync(RAW).filter((x) => /^hist-day.*\.json$/.test(x))) {
  const d = unwrap(readJSON(join(RAW, f)));
  for (const res of (d.data?.results ?? d.results ?? [])) {
    if (!res.symbol || !Array.isArray(res.bars) || res.bars.length < 20) continue;
    const closes = res.bars.map((b) => num(b.close_price ?? b.close)).filter((v) => v != null && v > 0);
    if (closes.length < 20) continue;
    const rets = [];
    for (let i = 1; i < closes.length; i++) rets.push(Math.log(closes[i] / closes[i - 1]));
    const mean = rets.reduce((s, r) => s + r, 0) / rets.length;
    const variance = rets.reduce((s, r) => s + (r - mean) ** 2, 0) / (rets.length - 1);
    ivBySym[res.symbol] = +(Math.sqrt(variance) * Math.sqrt(252)).toFixed(3); // annualized
  }
}

// live option quotes for the idea contracts (producer/raw/option-quotes.json), if fetched
const liveBySym = {};
if (existsSync(join(RAW, 'option-quotes.json'))) {
  const d = unwrap(readJSON(join(RAW, 'option-quotes.json')));
  for (const q of (Array.isArray(d) ? d : (d.quotes ?? d.results ?? []))) if (q && q.underlying) liveBySym[q.underlying] = q;
}
const ideas = buildIdeas(picksCands, holdings100, pxBySym, liveBySym, ivBySym);
const liveCount = ideas.ideas.filter((i) => i.live).length;

// Sidecar for the Robinhood OPTIONS-watchlist sync — the single-leg Trade Ideas that resolved to a
// real contract this run (live quote → optionId). Multi-leg structures (debit spread, collar) and
// estimate-only ideas have no contract UUID, so they're excluded. Emitted ONLY on FETCH_ALL (gated on
// the presence of a fresh raw/picks.json, exactly like the equity picks-watchlist) so the list tracks
// the daily ideas without intraday churn. All adds use position_type "long" — the options watchlist
// is a watch list (the read-back doesn't return side), so long-only keeps the daily remove-diff
// deterministic. The agent diffs this against the live list via sync-option-watchlist.mjs.
if (existsSync(join(RAW, 'picks.json'))) {
  const watchContracts = ideas.ideas
    .filter((i) => i.live && i.optionId)
    .map((i) => ({ optionId: i.optionId, underlying: i.underlying, strategy: i.strategy,
      side: i.optSide || 'long', name: `${i.underlying} $${i.strike} ${i.optType === 'put' ? 'Put' : 'Call'}` }));
  writeFileSync(join(RAW, 'option-watchlist.json'), JSON.stringify(
    { positionType: 'long', optionIds: watchContracts.map((c) => c.optionId), contracts: watchContracts }, null, 2));
  console.log(`options-watchlist: queued sync of ${watchContracts.length} live contract(s)` +
    (watchContracts.length ? ` → ${watchContracts.map((c) => c.name).join(', ')}` : ' (no live single-leg ideas this run)'));
}

// IV observations (today's live implied vol per underlying) — collected from every contract that
// carried a live IV: your positions/pending + the idea quotes. build-data.mjs accumulates these
// into a rolling per-symbol history and derives an IV RANK (where today sits in the trailing range)
// so the consumer can show whether options are currently cheap or rich.
const ivObserved = {};
const noteIv = (sym, ivPct) => { if (sym && ivPct != null && Number.isFinite(ivPct)) ivObserved[sym] = ivPct; };
for (const a of [...pending, ...positions]) noteIv(a.underlying, a.iv);
for (const i of ideas.ideas) if (i.live) noteIv(i.underlying, i.iv);

// Portfolio-level options exposure roll-up (across open positions + pending) — the at-a-glance
// posture the per-card view can't give: net delta (share-equivalent directional tilt), cash tied
// up securing short puts, shares capped by short calls, and total open premium currently at risk.
const exposure = (() => {
  let netDelta = 0, cspCash = 0, sharesCapped = 0, openPremium = 0, contracts = 0, n = 0;
  for (const a of [...positions, ...pending]) {
    n++;
    const qty = a.contracts || 1; contracts += qty;
    if (a.delta != null) netDelta += a.delta * 100 * qty * (a.side === 'short' ? -1 : 1);
    if (a.side === 'short' && a.type === 'put' && a.strike != null) cspCash += a.strike * 100 * qty;
    if (a.side === 'short' && a.type === 'call') sharesCapped += 100 * qty;
    const prem = a.mark != null ? a.mark : a.perShare;
    if (prem != null) openPremium += Math.abs(prem) * 100 * qty;
  }
  if (!n) return null;
  return { positions: n, contracts, netDelta: Math.round(netDelta),
    cspCash: +cspCash.toFixed(0), sharesCapped, openPremium: +openPremium.toFixed(0) };
})();

// Realized P&L history from filled orders: net per chain that has a closing fill.
const byChain = {};
for (const o of orders) {
  if (o.state !== 'filled') continue;
  const c = (byChain[o.chain_id] = byChain[o.chain_id] || { symbol: o.chain_symbol, net: 0, trades: 0, closed: false, last: '' });
  const pp = num(o.processed_premium) || 0;
  c.net += (o.direction === 'credit' ? pp : -pp);
  c.trades++;
  if (o.closing_strategy) c.closed = true;
  const d = o.last_transaction_at || o.updated_at || o.created_at || ''; if (d > c.last) c.last = d;
}
const history = Object.values(byChain).filter((c) => c.closed)
  .map((c) => ({ symbol: c.symbol, net: +c.net.toFixed(2), trades: c.trades, date: (c.last || '').slice(0, 10) }))
  .sort((a, b) => (a.date < b.date ? 1 : -1));
const realized = +history.reduce((s, h) => s + h.net, 0).toFixed(2);

// Year-to-date views for the Income & Tax widget:
//  • realizedYTD  — realized option P&L from chains CLOSED this calendar year (expired / bought
//    back / assigned). An open covered call contributes $0 here until it resolves.
//  • premiumYTD   — gross premium COLLECTED this year from opening income trades (sell-to-open
//    credits), e.g. the IREN covered call. Cash in hand, but unrealized until the trade closes.
const YEAR = String(new Date().getUTCFullYear());
const realizedYTD = +history.filter((h) => (h.date || '').startsWith(YEAR)).reduce((s, h) => s + h.net, 0).toFixed(2);
let premiumYTD = 0;
for (const o of orders) {
  if (o.state !== 'filled' || o.direction !== 'credit') continue;
  if (o.closing_strategy && !o.opening_strategy) continue;          // skip pure buy-to-close credits
  const d = o.last_transaction_at || o.created_at || '';
  if (d.startsWith(YEAR)) premiumYTD += num(o.processed_premium) || 0;
}
premiumYTD = +premiumYTD.toFixed(2);

const out = {
  asOf: new Date().toISOString(),
  pending, positions, ideas, exposure, ivObserved,
  history, realized, realizedYTD, premiumYTD,
};
writeFileSync(join(RAW, 'options.json'), JSON.stringify(out, null, 2));
console.log(`options: ${pending.length} pending · ${positions.length} open · ${ideas.ideas.length} ideas (${liveCount} live, ${ideas.ideas.length - liveCount} est)` +
  (pending[0] ? ` · pending: ${pending[0].underlying} ${pending[0].side} ${pending[0].type} $${pending[0].strike}` : ''));
