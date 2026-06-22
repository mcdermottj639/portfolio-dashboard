// producer/av-fetch.mjs — fetch Alpha Vantage directly over HTTP (no MCP connector, no agent),
// the same in-process pattern as social.mjs. Run by run.mjs ONLY when ALPHAVANTAGE_KEY is set.
//
// Requirements:
//   • env ALPHAVANTAGE_KEY = your free Alpha Vantage key
//   • `alphavantage.co` (or `www.alphavantage.co`) in the environment's network egress allowlist
//
// Writes the SAME files the agent/MCP path produced, in the SAME shape the consumer parses, so
// nothing downstream changes:
//   • producer/raw/av-src/<id>.json   (macro + company overviews; keyed by av.mjs `id`)
//   • producer/raw/news/<SYM>.json    (news sentiment, optional)
// Shape rules (verified against index.html parse()/fetchMacro()/azOverview()):
//   • macro indicators → the AV `.data` ARRAY wrapped as { content:[{type:'text',text:<json>}] }
//     (consumer's parse() JSON-parses it back to an array; fetchMacro reads rows[].value).
//   • COMPANY_OVERVIEW → { structuredContent: <object> } (consumer checks v.Symbol).
//   • NEWS_SENTIMENT  → the raw AV object (build-data's unwrap reads .feed).
//
// Respects the free 25/day cap: gated to once per ET day via producer/raw/av-src/.fetched, so the
// hourly loop only spends AV calls on the day's first run. Error/throttle responses are detected
// and NEVER overwrite a good prior snapshot. EARNINGS_CALENDAR is intentionally left to the
// existing path (CSV-only; not worth the extra shape risk here).
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { MACRO_CALLS, overviewCall, coverFromRaw, avSym } from './av.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RAW = join(__dirname, 'raw');
const AVDIR = join(RAW, 'av-src');
const NEWSDIR = join(RAW, 'news');
const KEY = process.env.ALPHAVANTAGE_KEY;
const BASE = 'https://www.alphavantage.co/query';
const NEWS_TICKERS = (process.env.PF_AV_NEWS || '').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);

if (!KEY) { console.log('[av] no ALPHAVANTAGE_KEY — skipping direct AV fetch'); process.exit(0); }
mkdirSync(AVDIR, { recursive: true });

// ET date for the once/day gate.
const todayET = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const fetchedFile = join(AVDIR, '.fetched');
if (existsSync(fetchedFile) && readFileSync(fetchedFile, 'utf8').trim() === todayET) {
  console.log(`[av] already fetched today (${todayET}) — replaying existing av-src, no AV calls spent`);
  process.exit(0);
}

async function avGet(params) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  try {
    const qs = new URLSearchParams({ ...params, apikey: KEY }).toString();
    const r = await fetch(`${BASE}?${qs}`, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
    if (!r.ok) return { _err: `HTTP ${r.status}` };
    const j = await r.json();
    // AV signals throttle/cap/errors as these keys rather than an HTTP error.
    if (j && (j.Note || j.Information || j['Error Message'])) return { _err: (j.Note || j.Information || j['Error Message']).slice(0, 120) };
    return j;
  } catch (e) { return { _err: e.name === 'AbortError' ? 'timeout' : e.message }; }
  finally { clearTimeout(timer); }
}
const writeJSON = (f, o) => writeFileSync(f, JSON.stringify(o));

let ok = 0, fail = 0;
// 1) Macro indicators → av-src/<id>.json as a wrapped array.
for (const c of MACRO_CALLS) {
  const j = await avGet({ function: c.tool, ...c.args });
  if (j._err || !Array.isArray(j.data)) { fail++; console.warn(`[av] ${c.id}: ${j._err || 'no .data array'} — keeping prior`); continue; }
  writeJSON(join(AVDIR, `${c.id}.json`), { content: [{ type: 'text', text: JSON.stringify(j.data) }] });
  ok++;
}
// 2) COMPANY_OVERVIEW for the same top holdings the consumer requests → av-src/overview-<SYM>.json.
for (const sym of coverFromRaw(RAW)) {
  const spec = overviewCall(sym); // { id:'overview-SYM', tool:'COMPANY_OVERVIEW', args:{symbol:avSym(sym)} }
  const j = await avGet({ function: spec.tool, ...spec.args });
  if (j._err || !j.Symbol) { fail++; console.warn(`[av] ${spec.id}: ${j._err || 'no Symbol'} — keeping prior`); continue; }
  writeJSON(join(AVDIR, `${spec.id}.json`), { structuredContent: j });
  ok++;
}
// 3) News sentiment (optional) → raw/news/<SYM>.json. Off unless PF_AV_NEWS lists tickers.
if (NEWS_TICKERS.length) {
  mkdirSync(NEWSDIR, { recursive: true });
  for (const sym of NEWS_TICKERS.slice(0, 4)) {
    const j = await avGet({ function: 'NEWS_SENTIMENT', tickers: avSym(sym) });
    if (j._err || !Array.isArray(j.feed)) { fail++; console.warn(`[av] news ${sym}: ${j._err || 'no feed'}`); continue; }
    writeJSON(join(NEWSDIR, `${sym}.json`), j);
    ok++;
  }
}

if (ok > 0) writeFileSync(fetchedFile, todayET); // only claim "fetched today" if something landed
console.log(`[av] direct fetch: ${ok} ok · ${fail} failed/throttled${ok ? ` · marked ${todayET}` : ' · nothing written (cap or host blocked?) — existing av-src kept'}`);
