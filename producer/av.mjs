// Alpha Vantage wiring for the producer — keeps the dashboard's macro,
// fundamentals and earnings sections live while respecting the FREE tier
// (25 requests/day). The 15-min Robinhood loop never touches AV; AV is refreshed
// at most ONCE PER DAY (see PRODUCER.md), and those snapshots are replayed on
// every intra-day build.
//
// How replay keying works (must match index.html exactly):
//   The consumer calls callMcpTool(AV, { tool_name, arguments: JSON.stringify(args) }).
//   The shim looks it up by makeKey(AV, { tool_name, arguments }). Because `arguments`
//   is the *stringified* args object, the key only matches if we reproduce
//   JSON.stringify(args) byte-for-byte — i.e. the SAME property order the consumer
//   uses. Do NOT reorder keys in the `args` objects below.

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { makeKey, AV } from './key.mjs';

// Mirrors index.html: top holdings to pull fundamentals/beta/sector for, and the
// $ floor below which a position is ignored for that enrichment.
export const OVERVIEW_COVER = 14;
export const SMALL_THR = 250;

// index.html avSym(): Alpha Vantage uses dashes, not dots (e.g. BRK.B → BRK-B).
export const avSym = (s) => s.replace(/\./g, '-');

// --- the canonical daily call set -------------------------------------------
// `id` is the friendly filename the agent saves each raw response under
// (producer/raw/av-src/<id>.json). `tool`/`args` must match index.html's avCall().
// Verified against the live free-tier connector (2026-06): the economic
// indicators return CSV (timestamp,value), which the consumer's parseCSV path
// handles; COMPANY_OVERVIEW returns a JSON object with Symbol/Beta/PERatio/etc.
export const MACRO_CALLS = [
  { id: 'macro-treasury10y', tool: 'TREASURY_YIELD',     args: { interval: 'monthly', maturity: '10year' } },
  { id: 'macro-cpi',         tool: 'CPI',                args: { interval: 'monthly' } },
  { id: 'macro-fedfunds',    tool: 'FEDERAL_FUNDS_RATE', args: { interval: 'monthly' } },
];
// PREMIUM-ONLY on Alpha Vantage — the free key returns "not yet entitled to index
// data access". We do NOT spend an AV call on VIX; instead build-data.mjs sources
// the VIX level from the free Robinhood index quote and synthesizes this same
// INDEX_DATA response, so the macro tile is live on the free tier. Kept here so
// specForId still resolves the key (e.g. if a premium AV key later supplies it).
export const PREMIUM_CALLS = [
  { id: 'macro-vix', tool: 'INDEX_DATA', args: { symbol: 'VIX', interval: 'daily' } },
];
export const EARNINGS_CALL = { id: 'earnings-cal', tool: 'EARNINGS_CALENDAR', args: { horizon: '3month' } };

// COMPANY_OVERVIEW per holding — symbol is the *Robinhood* symbol (dot form);
// the AV arg uses the dash form. id keeps the original symbol so we can recover it.
export const overviewCall = (sym) => ({ id: `overview-${sym}`, tool: 'COMPANY_OVERVIEW', args: { symbol: avSym(sym) } });

// The replay key the shim will look up for a given AV call.
export function avKey(tool, args) {
  return makeKey(AV, { tool_name: tool, arguments: JSON.stringify(args) });
}

// Recover the call spec from a raw/av-src/<id>.json filename. Includes premium
// calls so a premium key's snapshot is keyed correctly even though the free-tier
// daily plan omits them.
export function specForId(id) {
  for (const c of [...MACRO_CALLS, ...PREMIUM_CALLS, EARNINGS_CALL]) if (c.id === id) return c;
  if (id.startsWith('overview-')) return overviewCall(id.slice('overview-'.length));
  return null;
}

// --- cover selection (top holdings) -----------------------------------------
// Computed from the same raw files build-data.mjs reads, so the producer fetches
// overviews for exactly the symbols the consumer will request.
function unwrap(r) {
  if (r == null) return r;
  if (r.structuredContent) return r.structuredContent;
  if (r.content && r.content[0] && typeof r.content[0].text === 'string') {
    try { return JSON.parse(r.content[0].text); } catch { return r.content[0].text; }
  }
  return r;
}
const readJSON = (f) => JSON.parse(readFileSync(f, 'utf8'));

export function coverFromRaw(rawDir) {
  const posFile = join(rawDir, 'positions.json');
  if (!existsSync(posFile)) return [];
  const posRaw = unwrap(readJSON(posFile));
  const positions = posRaw.data?.positions ?? posRaw.positions ?? posRaw;
  // assemble quotes from any quotes*.json
  const quotes = {};
  if (existsSync(rawDir)) for (const f of readdirSync(rawDir).filter((x) => /^quotes.*\.json$/.test(x))) {
    const d = unwrap(readJSON(join(rawDir, f)));
    const arr = Array.isArray(d) ? d : (d.data?.results ?? d.results ?? []);
    for (const item of arr) { const q = item.quote ?? item; const sym = q && (q.symbol || q.ticker); if (sym) quotes[sym] = q; }
  }
  const valued = (positions || []).map((p) => {
    const q = quotes[p.symbol] || {};
    const px = parseFloat(q.last_trade_price || q.adjusted_previous_close || q.previous_close || 0) || 0;
    return { symbol: p.symbol, val: px * (parseFloat(p.quantity) || 0) };
  }).filter((p) => p.val >= SMALL_THR);
  valued.sort((a, b) => b.val - a.val);
  return valued.slice(0, OVERVIEW_COVER).map((p) => p.symbol);
}
