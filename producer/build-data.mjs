// Assembles ../data.json from raw MCP tool outputs the producer agent drops in producer/raw/.
// Tolerant of the common response shapes (structuredContent / content[].text / plain).
//
// Expected files in producer/raw/ (see PRODUCER.md):
//   portfolio.json          raw get_portfolio response
//   positions.json          raw get_equity_positions response
//   quotes*.json            one or more raw get_equity_quotes responses
//   hist-day*.json          one or more raw get_equity_historicals (interval=day)
//   hist-month*.json        (optional) interval=month, for the Markets 5Y stats
//   av/<makeKey>.json       (optional) raw Alpha Vantage responses, filename = exact recorded key
//
// Usage: node producer/build-data.mjs "Jun 18 2026, 3:45 PM ET" [account_number]
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { makeKey, RH } from './key.mjs';
import { emit } from './emit.mjs';
import { MARKET_SYMBOLS } from './markets.mjs';
import { avKey, specForId } from './av.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RAWDIR = join(__dirname, 'raw');
const label = process.argv[2] || new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
// Keying account — a placeholder, NOT the real number. Must match ACCOUNT in index.html.
// The real account number is used only for the live MCP calls (from secret.local.json).
const account = process.argv[3] || 'ACCT';

const readJSON = (f) => JSON.parse(readFileSync(f, 'utf8'));
// Dig the meaningful payload out of whatever wrapper the MCP layer used.
function unwrap(r) {
  if (r == null) return r;
  if (r.structuredContent) return r.structuredContent;
  if (r.content && r.content[0] && typeof r.content[0].text === 'string') {
    try { return JSON.parse(r.content[0].text); } catch { return r.content[0].text; }
  }
  return r;
}
function filesMatching(re) {
  if (!existsSync(RAWDIR)) return [];
  return readdirSync(RAWDIR).filter((f) => re.test(f)).map((f) => join(RAWDIR, f));
}

// --- portfolio + positions ---
const pRaw = unwrap(readJSON(filesMatching(/^portfolio\.json$/)[0]));
const portfolio = pRaw.data ?? pRaw;
const posRaw = unwrap(readJSON(filesMatching(/^positions\.json$/)[0]));
const positions = posRaw.data?.positions ?? posRaw.positions ?? posRaw;

// --- quotes (per-symbol, fields preserved verbatim) ---
const quotes = {};
for (const f of filesMatching(/^quotes.*\.json$/)) {
  const d = unwrap(readJSON(f));
  const arr = Array.isArray(d) ? d : (d.data?.results ?? d.results ?? []);
  for (const item of arr) {
    const q = item.quote ?? item; const sym = q && (q.symbol || q.ticker);
    if (sym) quotes[sym] = q;
  }
}

// --- historicals (per-symbol bars, by interval) ---
const hist = {};
for (const f of filesMatching(/^hist-(day|week|month).*\.json$/)) {
  const interval = /hist-(day|week|month)/.exec(f)[1];
  hist[interval] = hist[interval] || {};
  const d = unwrap(readJSON(f));
  const results = d.data?.results ?? d.results ?? [];
  for (const res of results) if (res.symbol && Array.isArray(res.bars)) hist[interval][res.symbol] = res.bars;
}

// --- recorded: stable-key calls ---
const recorded = {};
recorded[makeKey(RH + 'get_portfolio', { account_number: account })] = { structuredContent: { data: portfolio } };
recorded[makeKey(RH + 'get_equity_positions', { account_number: account })] = { structuredContent: { data: { positions } } };
// optional Alpha Vantage passthroughs (legacy, hand-keyed): producer/raw/av/<exact key>.json
const avDir = join(RAWDIR, 'av');
if (existsSync(avDir)) for (const f of readdirSync(avDir).filter((x) => x.endsWith('.json'))) {
  recorded[decodeURIComponent(f.replace(/\.json$/, ''))] = readJSON(join(avDir, f));
}
// Alpha Vantage daily snapshots: producer/raw/av-src/<id>.json (id = friendly name
// from av.mjs). Refreshed ≤ once/day; replayed on every intra-day build. The id is
// mapped to the exact replay key the shim expects, so the agent never hand-keys.
const avSrcDir = join(RAWDIR, 'av-src');
let avCount = 0;
if (existsSync(avSrcDir)) for (const f of readdirSync(avSrcDir).filter((x) => x.endsWith('.json'))) {
  const id = f.replace(/\.json$/, '');
  const spec = specForId(id);
  if (!spec) { console.warn('⚠️  av-src: no spec for', f, '— skipped (rename to a known id, see av.mjs)'); continue; }
  recorded[avKey(spec.tool, spec.args)] = readJSON(join(avSrcDir, f));
  avCount++;
}

// VIX from Robinhood index quotes (free, every run) → synthesize the AV INDEX_DATA
// response the macro card reads. AV's own INDEX_DATA is premium-only, so this is how
// the VIX tile gets a live value on the free tier. Save the raw get_index_quotes
// result to producer/raw/index-quotes.json (see PRODUCER.md).
const idxFile = filesMatching(/^index-quotes\.json$/)[0];
let vix = null;
if (idxFile) {
  const d = unwrap(readJSON(idxFile));
  const idxQuotes = d.data?.quotes ?? d.quotes ?? [];
  const vq = idxQuotes.find((q) => q.symbol === 'VIX');
  if (vq && (vq.value || vq.last_trade_price)) {
    vix = parseFloat(vq.value || vq.last_trade_price);
    recorded[avKey('INDEX_DATA', { symbol: 'VIX', interval: 'daily' })] =
      { structuredContent: { data: [{ close: String(vix) }] } };
  }
}

const data = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  generatedAtLabel: label,
  recorded, quotes, hist,
};
// Daily Picks (Robinhood scanner → scored in picks-build.mjs). Embedded as data.picks;
// the dashboard reads it directly (the old Kyle-note path is retired).
const picksFile = filesMatching(/^picks\.json$/)[0];
if (picksFile) data.picks = readJSON(picksFile);
// Options page (your positions/pending + directional ideas). Embedded as data.options.
const optionsFile = filesMatching(/^options\.json$/)[0];
if (optionsFile) data.options = readJSON(optionsFile);

// Breadth / Movers (the Markets "Breadth" card → MKTX via data.picks.markets). Computed from
// data already collected — VIX (Robinhood) + biggest movers in your own book — no extra calls.
// News sentiment is left out unless AV supplies it (rate-limited); the card degrades gracefully.
(() => {
  const fmtChg = (v) => (v >= 0 ? '+' : '') + v.toFixed(1) + '%';
  const held = new Set((positions || []).map((p) => p.symbol));
  const moves = [];
  for (const sym of held) {
    const q = quotes[sym]; if (!q) continue;
    const px = parseFloat(q.last_trade_price || 0), pv = parseFloat(q.adjusted_previous_close || q.previous_close || 0);
    if (px > 0 && pv > 0) moves.push({ t: sym, n: (px / pv - 1) * 100 });
  }
  moves.sort((a, b) => b.n - a.n);
  const top = (arr) => arr.slice(0, 4).map((m) => ({ t: m.t, chg: fmtChg(m.n) }));
  const markets = {};
  if (vix != null) markets.vix = { level: vix.toFixed(2), chg: '' };
  if (moves.length) markets.movers = { gainers: top(moves), losers: top([...moves].reverse()) };
  if (Object.keys(markets).length) { data.picks = data.picks || {}; data.picks.markets = markets; }
})();

await emit(data);
console.log('built:',
  positions.length, 'positions ·', Object.keys(quotes).length, 'quotes ·',
  Object.entries(hist).map(([k, v]) => Object.keys(v).length + ' ' + k).join(' · ') || 'no hist',
  '·', Object.keys(recorded).length, 'recorded ·', avCount, 'AV',
  '·', vix != null ? 'VIX ' + vix : 'no VIX',
  '·', data.picks ? data.picks.candidates.length + ' picks' : 'no picks',
  avCount ? '' : '(macro/fundamentals will show "—" until av-src is populated)');

// --- Markets-tab coverage check ---------------------------------------------
// The Markets tab renders a fixed set of benchmark/risk/sector tickers. Anything
// missing here renders as "—" on the phone, so surface it loudly — it almost
// always means the producer didn't fetch quotes/historicals for those symbols.
const missingQuotes = MARKET_SYMBOLS.filter((s) => !quotes[s]);
const missingDay = MARKET_SYMBOLS.filter((s) => !(hist.day && hist.day[s]));
const missingMonth = MARKET_SYMBOLS.filter((s) => !(hist.month && hist.month[s]));
const warn = (label, syms) => { if (syms.length) console.warn(`⚠️  Markets tab will show "—" — missing ${label} for: ${syms.join(', ')}`); };
warn('quotes (price + day%)', missingQuotes);
warn('day historicals (YTD%)', missingDay);
warn('month historicals (5Y%)', missingMonth);
if (!missingQuotes.length && !missingDay.length && !missingMonth.length) {
  console.log('Markets coverage: ✅ all', MARKET_SYMBOLS.length, 'index/risk/sector symbols present');
}
