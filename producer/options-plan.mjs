// Prints the option contracts the Trade Ideas want priced, so the producer agent
// can fetch live quotes. Run AFTER picks.json + positions.json + quotes.json exist.
//   node producer/options-plan.mjs
//
// For each target: prefer the contract nearest its `targetDelta` (a defensible, IV-aware strike)
// among the listed strikes; fall back to the nearest `targetStrike` if deltas aren't handy. Resolve
// via get_option_instruments { chain_symbol, expiration_dates, type } → pick by delta/strike →
// get_option_quotes { instrument_ids:[id] }, and append one object to
//   producer/raw/option-quotes.json  (a JSON array):
//   { underlying, optionId, strike, expiration, mark, bid, ask, breakeven, iv, delta, theta, vega,
//     gamma, openInterest, volume, popLong }
// using the quote fields mark_price, bid_price, ask_price, break_even_price, implied_volatility,
// delta, theta, vega, gamma, open_interest, volume, chance_of_profit_long. **`optionId` is the
// instrument UUID you just resolved (the same id you passed to get_option_quotes)** — keep it, it's
// the contract the Robinhood options-watchlist sync adds (see PRODUCER.md "Sync the options watchlist").
// options-build.mjs then uses these exact figures (falls back to estimates if absent).
//
// NOTE: only the SINGLE-LEG ideas below are priced live. The defined-risk structures (call debit
// spread, collar) are built estimate-only inside options.mjs to avoid two-leg same-underlying quote
// collisions — no action needed here for them.
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { ideaTargets, sharesLockedByShortCalls } from './options.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RAW = join(__dirname, 'raw');
const readJSON = (f) => JSON.parse(readFileSync(f, 'utf8'));
const unwrap = (r) => r?.structuredContent ?? (r?.content?.[0]?.text ? JSON.parse(r.content[0].text) : r);

let picks = [];
if (existsSync(join(RAW, 'picks.json'))) picks = readJSON(join(RAW, 'picks.json')).candidates ?? [];
const sharesBySym = {}, pxBySym = {};
if (existsSync(join(RAW, 'positions.json'))) {
  const d = unwrap(readJSON(join(RAW, 'positions.json')));
  for (const p of (d.data?.positions ?? d.positions ?? [])) sharesBySym[p.symbol] = parseFloat(p.quantity) || 0;
}
for (const f of readdirSync(RAW).filter((x) => /^quotes.*\.json$/.test(x))) {
  const d = unwrap(readJSON(join(RAW, f)));
  for (const it of (Array.isArray(d) ? d : (d.data?.results ?? d.results ?? []))) {
    const q = it.quote ?? it; if (q && (q.symbol || q.ticker)) pxBySym[q.symbol || q.ticker] = parseFloat(q.last_trade_price);
  }
}
/* Mirror options-build.mjs exactly: only shares NOT already backing a short call can carry a new
   covered call. If the two disagreed, the agent would price a contract the build then discards (or
   worse, the build would emit an idea with no live quote). */
let openLegs = [];
for (const f of ['options-positions.json', 'options-orders.json']) {
  if (!existsSync(join(RAW, f))) continue;
  const d = unwrap(readJSON(join(RAW, f)));
  if (f === 'options-positions.json') openLegs.push(...(d.data?.positions ?? d.positions ?? []));
  else for (const o of (d.data?.orders ?? d.orders ?? [])) {
    if (!['queued', 'confirmed', 'partially_filled', 'unconfirmed'].includes(o.state)) continue;
    for (const l of (o.legs || [])) openLegs.push({ chain_symbol: o.chain_symbol, quantity: o.quantity,
      option_type: l.option_type, direction: l.side === 'sell' ? 'credit' : 'debit' });
  }
}
const lockedBySym = sharesLockedByShortCalls(openLegs);
const holdings100 = Object.entries(sharesBySym)
  .map(([symbol, shares]) => ({ symbol, shares, px: pxBySym[symbol],
    freeShares: Math.max(0, shares - (lockedBySym[symbol] || 0)) }))
  .filter((h) => h.px && h.freeShares >= 100)
  .sort((a, b) => b.freeShares * b.px - a.freeShares * a.px).slice(0, 3);

const targets = ideaTargets(picks, holdings100);
console.log(`Option idea contracts to price (${targets.length}) — save quotes to producer/raw/option-quotes.json:\n`);
for (const t of targets) {
  console.log(`  ${t.underlying}  ${t.type}  exp ${t.expiration}  ~Δ${t.targetDelta} (≈strike $${t.targetStrike})  (${t.strategy})`);
}
if (!targets.length) console.log('  (no targets — need picks.json and/or 100+ share holdings)');
console.log('\nFor each: get_option_instruments → contract nearest the target delta (or strike) → get_option_quotes → append the normalized object (incl. optionId = the resolved instrument UUID, + theta/vega/gamma).');
