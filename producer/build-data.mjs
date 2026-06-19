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
// optional Alpha Vantage passthroughs: producer/raw/av/<exact key>.json
const avDir = join(RAWDIR, 'av');
if (existsSync(avDir)) for (const f of readdirSync(avDir).filter((x) => x.endsWith('.json'))) {
  recorded[decodeURIComponent(f.replace(/\.json$/, ''))] = readJSON(join(avDir, f));
}

const data = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  generatedAtLabel: label,
  recorded, quotes, hist,
};
await emit(data);
console.log('built:',
  positions.length, 'positions ·', Object.keys(quotes).length, 'quotes ·',
  Object.entries(hist).map(([k, v]) => Object.keys(v).length + ' ' + k).join(' · ') || 'no hist',
  '·', Object.keys(recorded).length, 'recorded');
