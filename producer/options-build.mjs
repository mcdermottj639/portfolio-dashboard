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
import { analyzeLeg, buildIdeas, sharesLockedByShortCalls, positionPremium, orderPremium } from './options.mjs';
import { decryptEnvelope } from './emit.mjs';
import { optionHistory } from './option-history.mjs';
import { buildIvBySym, VOL_WINDOW_BARS } from './optvol.mjs';
import { guardrail, stockExtension, detectRolls, settleRolls, rollStats } from './option-guardrail.mjs';

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
  /* get_option_quotes returns results[] of `{ quote:{instrument_id,…}, close:{…} }` — the id lives
     INSIDE `quote`, not on the wrapper. Reading it off the wrapper silently yielded `undefined` for
     every row, so posQById never populated and enrichLive was a no-op: your own contracts showed no
     mark, no greeks, no P&L, no IV (hence a flat netDelta of 0 and ivRank 0 on a 97%-IV name) while
     the idea quotes — saved pre-normalized by the agent — worked fine. Look in both places. */
  for (const row of (Array.isArray(d) ? d : (d.data?.results ?? d.results ?? d.quotes ?? []))) {
    const q = row.quote ?? row;
    const id = q.instrument_id || q.id || q.option_id || row.instrument_id || row.id || row.option_id;
    if (id) posQById[id] = q;
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
  /* RH's break_even_price is the LONG-side breakeven off today's mark (strike + mark), not off the
     premium YOU took in. For a position we already know our own basis, so ours wins; only borrow
     theirs when we have no premium (e.g. a leg with no recorded fill price). */
  if (q.break_even_price != null && a.perShare == null) a.breakeven = num(q.break_even_price);
  if (a.mark != null && a.perShare != null)
    a.pnl = +(((a.side === 'short' ? (a.perShare - a.mark) : (a.mark - a.perShare)) * 100 * (a.contracts || 1))).toFixed(0);
  if (a.delta != null) a.assignProb = Math.round(Math.abs(a.delta) * 100); // ≈ chance ITM at expiry
  a.live = true;
  return a;
}

/* ROLL GUIDANCE comes from the Options Guardrail (option-guardrail.mjs) since 2026-10-19. The old
   `rollAlert` said, for ANY in-the-money short call, "assignment risk — roll up/out", and on
   2026-10-12 that is exactly what the owner did: a $0.50 NET-DEBIT roll of a deep-ITM PLTR call with
   ~10% extrinsic left, four days before expiry, into a stock up ~9% in three sessions. The call would
   have expired worthless. Assignment above cost basis is the plan WORKING, not a risk; a roll is only
   ever for a net credit, with time value left in the leg you close, and never UP into a vertical move.
   `rollAlert` is kept as the field name the consumer renders; its text is now the guardrail's. */
const earningsBySym = {};
if (existsSync(join(RAW, 'earnings.json'))) {
  try {
    const d = unwrap(readJSON(join(RAW, 'earnings.json')));
    for (const e of (d.data?.earnings ?? d.earnings ?? d.results ?? [])) {
      const sym = e.symbol || e.ticker; const dt = (e.report_date || e.date || e.reportDate || '').slice(0, 10);
      if (sym && dt && (!earningsBySym[sym] || dt < earningsBySym[sym])) earningsBySym[sym] = dt;
    }
  } catch { /* optional input */ }
}
let histForExt = {}; // set once prevSnap is loaded (below); raw hist-day batches are merged in too
function applyGuardrail(a) {
  if (!a || a.side !== 'short' || a.type !== 'call') { if (a) a.rollAlert = null; return a; }
  const bars = histForExt[a.underlying] || [];
  const g = guardrail(a, { extension: stockExtension(bars, a.underlyingPx, { asOf: new Date().toISOString() }), earningsDate: earningsBySym[a.underlying] || null });
  a.guardrail = g;
  a.rollAlert = g ? `${g.tier.replace(/_/g, ' ')} — ${g.text}` : null;
  return a;
}

function analyzeOrder(o) {
  const leg = (o.legs || [])[0]; if (!leg) return null;
  const sym = o.chain_symbol; const px = pxBySym[sym];
  if (px == null) return { underlying: sym, type: leg.option_type, side: leg.side === 'sell' ? 'short' : 'long',
    strike: num(leg.strike_price), expiration: leg.expiration_date, contracts: num(o.quantity) || 1,
    premium: orderPremium(o), state: o.state, summary: `Underlying quote unavailable for ${sym}.`, underlyingPx: null };
  const a = analyzeLeg(leg, px, sharesBySym[sym] || 0, { quantity: o.quantity, premium: orderPremium(o),
    direction: o.direction, chain_symbol: sym, costBasis: costBySym[sym] });
  a.state = o.state; a.openingStrategy = o.opening_strategy || o.closing_strategy || null;
  a.costBasis = costBySym[sym] != null ? +costBySym[sym] : null;
  a.limitPrice = num(o.price);
  enrichLive(a, leg.option_id);
  return a; // guardrail applied after the snapshot's bars are loaded
}

/* The prior COMMITTED snapshot, decrypted ONCE and shared by open-position metadata,
   picks carry-forward, income history, and the realized-vol IV proxy. Plaintext dev snapshots are
   supported; missing/unreadable snapshots degrade to null and require fresh contract metadata. */
let prevSnap = null;
try {
  const prevPath = join(__dirname, '..', 'data.json');
  if (existsSync(prevPath)) {
    const env = JSON.parse(readFileSync(prevPath, 'utf8'));
    prevSnap = env && env.enc ? await decryptEnvelope(env, process.env.PF_PASSPHRASE) : env;
  }
} catch { prevSnap = null; }

const ordersRaw = existsSync(join(RAW, 'options-orders.json')) ? unwrap(readJSON(join(RAW, 'options-orders.json'))) : null;
const orders = ordersRaw?.data?.orders ?? ordersRaw?.orders ?? [];
// `fullHistory:true` is written ONLY after every page of an unfiltered get_option_orders was merged
// (option-fetch-plan.mjs prints FULL until the snapshot records one). Incremental runs omit it.
const ordersFullHistory = ordersRaw?.fullHistory === true;
const PENDING = new Set(['queued', 'confirmed', 'partially_filled', 'unconfirmed']);
const pending = orders.filter((o) => PENDING.has(o.state)).map(analyzeOrder).filter(Boolean);

// Orders provide contract metadata, never evidence that a position is still open.
// Incremental fetches omit older opening orders; their exact-contract legs live in the snapshot.
const retainedOrders = new Map((prevSnap?.options?.incomeHistory?.orders || []).map(o => [o.id, o]));
for (const o of orders) retainedOrders.set(o.id, o);
const legByOptId = {};
for (const o of retainedOrders.values()) for (const l of (o.legs || [])) {
  if (!l.option_id) continue;
  // Prefer opening side: a buy-to-close must not turn a surviving short into a long.
  const prior = legByOptId[l.option_id];
  if (!prior || l.position_effect === 'open' || prior.leg.position_effect !== 'open')
    legByOptId[l.option_id] = { leg: l, o };
}
let positions = [];
if (existsSync(join(RAW, 'options-positions.json'))) {
  const d = unwrap(readJSON(join(RAW, 'options-positions.json')));
  positions = (d.data?.positions ?? d.positions ?? []).filter(p => Math.abs(num(p.quantity) || 0) > 0).map((p) => {
    const ref = legByOptId[p.option_id];
    const leg = ref?.leg;
    if (!leg || !['call', 'put'].includes(leg.option_type) || !(num(leg.strike_price) > 0) ||
        !/^\d{4}-\d{2}-\d{2}$/.test(leg.expiration_date || '') || !['buy', 'sell'].includes(leg.side))
      throw new Error(`Open option ${p.chain_symbol} (${p.option_id}) has no complete contract metadata. Run a FULL option-order fetch; refusing to silently drop an open position.`);
    const positionType = p.position_type || p.type;
    const side = positionType === 'short' ? 'sell' : positionType === 'long' ? 'buy'
      : leg.position_effect === 'close' ? (leg.side === 'buy' ? 'sell' : 'buy') : leg.side;
    const a = analyzeLeg({...leg, side}, pxBySym[p.chain_symbol] || 0, sharesBySym[p.chain_symbol] || 0,
      { quantity: p.quantity, premium: positionPremium(p), direction: side === 'sell' ? 'credit' : 'debit',
        chain_symbol: p.chain_symbol, costBasis: costBySym[p.chain_symbol] });
    a.optionId = p.option_id;
    a.costBasis = costBySym[p.chain_symbol] != null ? +costBySym[p.chain_symbol] : null;
    enrichLive(a, p.option_id);
    return a;
  }).filter(Boolean);
}

// ideas: bullish calls from picks + covered calls from 100+ share holdings
let picksCands = [];
if (existsSync(join(RAW, 'picks.json'))) picksCands = readJSON(join(RAW, 'picks.json')).candidates ?? [];
else if (prevSnap && prevSnap.picks && Array.isArray(prevSnap.picks.candidates)) {
  // Light intraday run: no fresh scan → no raw/picks.json (picks only build on the daily FETCH_ALL).
  // Fall back to the carried-forward picks in the prior committed snapshot so the picks-derived ideas
  // (long calls, cash-secured puts, the debit spread) persist across light runs instead of getting
  // wiped to a covered-calls-only set until the next full run.
  picksCands = prevSnap.picks.candidates;
  console.log(`options: no raw picks — carried ${picksCands.length} picks forward from prior snapshot for ideas`);
}
/* Covered-call ideas may only be written against UNPLEDGED shares. Both open positions and pending
   sell-to-open orders reserve collateral, so both count — otherwise a queued order would be double
   sold. `freeShares` gates the ≥100 filter; `shares` is kept for display. */
const lockedBySym = sharesLockedByShortCalls([...positions, ...pending]);
const holdings100 = Object.entries(sharesBySym)
  .map(([symbol, shares]) => ({ symbol, underlying: symbol, shares, px: pxBySym[symbol],
    freeShares: Math.max(0, shares - (lockedBySym[symbol] || 0)) }))
  .filter((h) => h.px && h.freeShares >= 100)
  .sort((a, b) => b.freeShares * b.px - a.freeShares * a.px).slice(0, 3);
for (const [sym, lk] of Object.entries(lockedBySym))
  console.log(`options: ${sym} — ${lk} sh pledged to open/pending short calls, ${Math.max(0, (sharesBySym[sym] || 0) - lk)} free for new covered calls`);

/* Per-symbol annualized realized vol → the IV proxy for every ESTIMATE-path premium (`optvol.mjs`).
   TWO sources, this run's raw bars first and the prior snapshot's merged series as the fill. The raw
   half alone is NOT enough: since v141 most historicals arrive as 7-bar tails, which cannot support a
   vol estimate, so a raw-only proxy comes back nearly empty and every idea silently falls through to
   ivProxyFor's flat 0.55/0.60 default — the 2026-09-11 RCL bug (see optvol.mjs). Tail and full batches
   for the same symbol are concatenated because closeSeries dedupes by date, so a tail simply refreshes
   the head of the snapshot series. */
const rawSeries = {};
for (const f of readdirSync(RAW).filter((x) => /^hist-day.*\.json$/.test(x))) {
  try {
    const d = unwrap(readJSON(join(RAW, f)));
    for (const res of (d.data?.results ?? d.results ?? []))
      if (res && res.symbol && Array.isArray(res.bars))
        rawSeries[res.symbol] = (rawSeries[res.symbol] || []).concat(res.bars);
  } catch { /* one malformed batch must not take the whole proxy down */ }
}
const snapSeries = (prevSnap && prevSnap.hist && (prevSnap.hist.day || prevSnap.hist.daily)) || {};
const ivBySym = buildIvBySym([rawSeries, snapSeries]);
/* Options Guardrail: extension needs the same bars the vol proxy uses (raw tails over the snapshot's
   series), so it runs here, after both are loaded, and decorates every short call — open AND pending. */
histForExt = {};
for (const [sym, bars] of Object.entries(snapSeries)) histForExt[sym] = bars;
for (const [sym, bars] of Object.entries(rawSeries)) histForExt[sym] = [...(histForExt[sym] || []), ...bars];
for (const a of [...positions, ...pending]) applyGuardrail(a);
{
  const flagged = positions.filter((a) => a.guardrail && a.guardrail.tier !== 'HOLD');
  if (flagged.length) console.log(`options guardrail: ${flagged.map((a) => `${a.underlying} $${a.strike} ${a.expiration} → ${a.guardrail.tier}`).join(' · ')}`);
}
/* Roll scorecard: every filled order with a buy-to-close AND a sell-to-open leg on one chain is a
   roll. Records accumulate in the snapshot (raw/ is wiped) and settle against the do-nothing path
   once the OLD leg's expiration close is in the daily bars. Entry #1 is the 2026-10-12 PLTR roll. */
const openPremByOptId = {};
for (const o of retainedOrders.values()) for (const l of (o.legs || []))
  if (l.option_id && l.position_effect === 'open' && l.side === 'sell') { const e = (l.executions || [])[0]; if (e) openPremByOptId[l.option_id] = parseFloat(e.price); }
const rolls = settleRolls(prevSnap?.options?.rolls || [], detectRolls([...retainedOrders.values()]), snapSeries, openPremByOptId,
  (r) => stockExtension((snapSeries[r.symbol] || []).filter((b) => String(b.t || b.begins_at || '').slice(0, 10) <= r.date), null, { asOf: r.date }));
const rollSummary = rollStats(rolls);
if (rolls.length) console.log(`options rolls: ${rollSummary.rolls} recorded (${rollSummary.forCredit} credit / ${rollSummary.forDebit} debit) · ${rollSummary.settled} settled · ${rollSummary.vsDoNothing != null ? (rollSummary.vsDoNothing >= 0 ? '+' : '−') + '$' + Math.abs(rollSummary.vsDoNothing) : '—'} vs do-nothing`);
console.log(`options: realized-vol IV proxy — ${Object.keys(ivBySym).length} symbols over a ${VOL_WINDOW_BARS}-bar window (raw batches ${Object.keys(rawSeries).length}, prior snapshot ${Object.keys(snapSeries).length})`);

// live option quotes for the idea contracts (producer/raw/option-quotes.json), if fetched
const liveBySym = {};
if (existsSync(join(RAW, 'option-quotes.json'))) {
  const d = unwrap(readJSON(join(RAW, 'option-quotes.json')));
  for (const q of (Array.isArray(d) ? d : (d.quotes ?? d.results ?? []))) if (q && q.underlying) liveBySym[q.underlying] = q;
}
const ideas = buildIdeas(picksCands, holdings100, pxBySym, liveBySym, ivBySym);
const liveCount = ideas.ideas.filter((i) => i.live).length;
/* A guard that fires silently is indistinguishable from a broken system: an estimate-path idea with
   no realized vol is priced off a flat default that can be 2-3x the name's real volatility, and the
   only place that shows is a premium nobody can check. Name them in the run log. */
const noVol = [...new Set(ideas.ideas.filter((i) => !i.live && i.underlying && ivBySym[i.underlying] == null).map((i) => i.underlying))];
if (noVol.length) console.warn(`options: WARNING — no realized vol for ${noVol.join(', ')}; their ESTIMATE premiums use the flat default and may be far off. Fix is upstream: keep these symbols' daily bars in the fetch.`);

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
/* A held contract with no live quote is a SILENT failure mode: the card still renders, just with no
   mark, no greeks, no P&L and no IV — which is how the v119 keying bug survived. Say so in the log.
   Either step 2b didn't run, or the ids didn't match. */
{
  const missing = [...positions, ...pending].filter((a) => a && a.mark == null);
  if (missing.length) console.warn(`⚠️  options: ${missing.length} of ${positions.length + pending.length} own contract(s) have NO live quote (${missing.map((a) => a.underlying).join(', ')}) — greeks/P&L/IV will be blank and portfolio netDelta will read 0. Check PRODUCER.md step 2b wrote producer/raw/option-pos-quotes.json for these option_ids.`);
}

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

// Preserve exact-contract fills; legacy chain totals are not reliable realized profit.
const eventFile = join(RAW, 'options-events.json');
const eventData = existsSync(eventFile) ? unwrap(readJSON(eventFile)) : null;
const events = eventData?.data?.events ?? eventData?.events ?? eventData?.results ?? [];
// Settlement evidence: the self-directed P&L rows the producer already fetches EVERY-RUN (no extra call).
const pnlFile = join(RAW, 'main-trades.json');
const pnlData = existsSync(pnlFile) ? unwrap(readJSON(pnlFile)) : null;
const pnlTrades = pnlData?.data?.trades ?? pnlData?.trades ?? [];
const incomeHistory = optionHistory(orders, prevSnap?.options?.incomeHistory, new Date().toISOString(),
  Array.isArray(events) ? events : [], {pnlTrades: Array.isArray(pnlTrades) ? pnlTrades : [], fullHistory: ordersFullHistory});
if (incomeHistory.awaitingSettlement.length) console.warn(`options history: ${incomeHistory.awaitingSettlement.length} expired contract(s) still lack settlement evidence — ` +
  incomeHistory.awaitingSettlement.map((t) => `${t.symbol} ${t.strike}${t.type?.[0] || ''} ${t.expiration}`).join(', '));
const history = incomeHistory.trades;
const realized = null, realizedYTD = null; // broker aggregate is authoritative, never a partial ledger sum
const premiumYTD = incomeHistory.premiumYTD;

const out = {
  asOf: new Date().toISOString(),
  pending, positions, ideas, exposure, ivObserved,
  incomeHistory, history, realized, realizedYTD, premiumYTD,
  rolls, rollSummary,
};
writeFileSync(join(RAW, 'options.json'), JSON.stringify(out, null, 2));
console.log(`options: ${pending.length} pending · ${positions.length} open · ${ideas.ideas.length} ideas (${liveCount} live, ${ideas.ideas.length - liveCount} est)` +
  (pending[0] ? ` · pending: ${pending[0].underlying} ${pending[0].side} ${pending[0].type} $${pending[0].strike}` : ''));
