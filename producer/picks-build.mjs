// Assembles producer/raw/picks.json from the saved Daily Picks raw inputs, using
// the scoring engine in picks.mjs. build-data.mjs then embeds it as data.picks.
//
// Reads:
//   producer/raw/scan.json                 run_scan(SCAN_ID) result (finalist prices/RSI/mcap)
//   producer/raw/picks-fund.json           get_equity_fundamentals for the finalists
//   producer/raw/av-src/overview-<SYM>.json (optional) AV COMPANY_OVERVIEW per finalist
//
// Usage: node producer/picks-build.mjs
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { scanRows, selectFinalists, buildPicks, N_FINALISTS, WATCHLIST_ID, WATCHLIST_NAME } from './picks.mjs';
import { fetchSocial } from './social.mjs';

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

const scanFile = join(RAW, 'scan.json');
if (!existsSync(scanFile)) { console.error('Missing producer/raw/scan.json'); process.exit(1); }
const scanRaw = readJSON(scanFile);

// finalist rows (with price/rsi/name/mcap) in the same order picks-select printed
const rowsByTicker = Object.fromEntries(scanRows(scanRaw).map((r) => [r.ticker, r]));
const finalists = selectFinalists(scanRaw, N_FINALISTS).map((t) => rowsByTicker[t]).filter(Boolean);

// RH fundamentals by symbol
const fundBySym = {};
if (existsSync(join(RAW, 'picks-fund.json'))) {
  const d = unwrap(readJSON(join(RAW, 'picks-fund.json')));
  for (const r of (d.data?.results ?? d.results ?? [])) if (r.symbol) fundBySym[r.symbol] = r;
}

// AV overviews by symbol (optional, hybrid growth metrics)
const ovBySym = {};
const avDir = join(RAW, 'av-src');
if (existsSync(avDir)) for (const f of readdirSync(avDir).filter((x) => x.startsWith('overview-') && x.endsWith('.json'))) {
  const ov = unwrap(readJSON(join(avDir, f)));
  if (ov && ov.Symbol) ovBySym[ov.Symbol] = ov;
}

// Retail-sentiment for the finalists → folded into the composite (20%) by buildPicks. Keyless,
// in-process; degrades to {} (neutral social for all) if ApeWisdom is unreachable.
let socialMap = {};
try {
  const social = await fetchSocial(finalists.map((f) => f.ticker));
  if (social && social.tickers) socialMap = social.tickers;
} catch { socialMap = {}; }
const socialCovered = Object.values(socialMap).filter((t) => t && t.tracked).length;

const picks = buildPicks(finalists, fundBySym, ovBySym, socialMap);
writeFileSync(join(RAW, 'picks.json'), JSON.stringify(picks, null, 2));

// Sidecar for the Robinhood watchlist sync (FETCH_ALL only — this file's mere presence is the
// signal that picks rebuilt this run). The agent reads it after run.mjs and diffs it against the
// live list via sync-watchlist.mjs (MCP writes are agent-only, so Node can only emit the target).
const top = picks.candidates.map((c) => c.ticker);
writeFileSync(join(RAW, 'picks-watchlist.json'), JSON.stringify(
  { listId: WATCHLIST_ID, listName: WATCHLIST_NAME, date: picks.ts, tickers: top }, null, 2));

const avCount = Object.keys(ovBySym).length;
console.log(`picks: ${picks.candidates.length} candidates · top ${picks.picks.length}: ` +
  picks.picks.map((p) => `${p.ticker}(${p.composite} ${p.signal})`).join(', '));
console.log(`watchlist: queued sync of ${top.length} → "${WATCHLIST_NAME}" (${top.join(' ')})`);
console.log(`social: ${socialCovered}/${finalists.length} finalists with ApeWisdom buzz (20% of composite)`);
console.log(`fundamentals: ${Object.keys(fundBySym).length} RH · ${avCount} AV overview${avCount === 1 ? '' : 's'}` +
  (avCount ? '' : ' (value-only scoring — AV skipped/capped)'));
