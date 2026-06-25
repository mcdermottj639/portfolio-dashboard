// Prints the option contracts the Trade Ideas want priced, so the producer agent
// can fetch live quotes. Run AFTER picks.json + positions.json + quotes.json exist.
//   node producer/options-plan.mjs
//
// For each target: prefer the contract nearest its `targetDelta` (a defensible, IV-aware strike)
// among the listed strikes; fall back to the nearest `targetStrike` if deltas aren't handy. Resolve
// via get_option_instruments { chain_symbol, expiration_dates, type } → pick by delta/strike →
// get_option_quotes { instrument_ids:[id] }, and append one object to
//   producer/raw/option-quotes.json  (a JSON array):
//   { underlying, strike, expiration, mark, bid, ask, breakeven, iv, delta, theta, vega, gamma,
//     openInterest, volume, popLong }
// using the quote fields mark_price, bid_price, ask_price, break_even_price, implied_volatility,
// delta, theta, vega, gamma, open_interest, volume, chance_of_profit_long.
// options-build.mjs then uses these exact figures (falls back to estimates if absent).
//
// NOTE: only the SINGLE-LEG ideas below are priced live. The defined-risk structures (call debit
// spread, collar) are built estimate-only inside options.mjs to avoid two-leg same-underlying quote
// collisions — no action needed here for them.
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { ideaTargets } from './options.mjs';

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
const holdings100 = Object.entries(sharesBySym).filter(([, s]) => s >= 100)
  .map(([symbol, shares]) => ({ symbol, shares, px: pxBySym[symbol] })).filter((h) => h.px)
  .sort((a, b) => b.shares * b.px - a.shares * a.px).slice(0, 3);

const targets = ideaTargets(picks, holdings100);
console.log(`Option idea contracts to price (${targets.length}) — save quotes to producer/raw/option-quotes.json:\n`);
for (const t of targets) {
  console.log(`  ${t.underlying}  ${t.type}  exp ${t.expiration}  ~Δ${t.targetDelta} (≈strike $${t.targetStrike})  (${t.strategy})`);
}
if (!targets.length) console.log('  (no targets — need picks.json and/or 100+ share holdings)');
console.log('\nFor each: get_option_instruments → contract nearest the target delta (or strike) → get_option_quotes → append the normalized object (incl. theta/vega/gamma).');
