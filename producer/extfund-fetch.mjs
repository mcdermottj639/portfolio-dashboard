// producer/extfund-fetch.mjs — fetch supplementary fundamentals (Finnhub + Financial Modeling Prep)
// directly over HTTP, the same in-process pattern as av-fetch.mjs. Run by run.mjs ONLY when at least
// one of FINNHUB_KEY / FMP_KEY is set. Both providers are independently optional.
//
// Requirements (whatever you want live — each is optional and skipped if its key is absent):
//   • env FINNHUB_KEY  → Finnhub (60 calls/min; trailing P/E, EPS, growth, margins, beta, 52wk).
//   • env FMP_KEY      → Financial Modeling Prep (PEG, margins; analyst target / forward P/E on
//                        tiers that expose them).
//   • egress allowlist must include `finnhub.io` and/or `financialmodelingprep.com`.
//
// Writes producer/raw/ext-fund/overview-<SYM>.json as { structuredContent: <AV-shaped object> } —
// build-data.mjs merges these UNDER Alpha Vantage (AV stays primary) and OVER the Robinhood synth.
// Like av-fetch, it's gated to once per ET day and never overwrites a good prior on a bad response.
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { coverFromRaw } from './av.mjs';
import { finnhubToOverview, fmpToOverview, mergeOverviews, isRich, avSym } from './extfund.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RAW = join(__dirname, 'raw');
const EXTDIR = join(RAW, 'ext-fund');
const FINNHUB_KEY = process.env.FINNHUB_KEY;
const FMP_KEY = process.env.FMP_KEY;

if (!FINNHUB_KEY && !FMP_KEY) { console.log('[extfund] no FINNHUB_KEY / FMP_KEY — skipping supplementary fundamentals'); process.exit(0); }
mkdirSync(EXTDIR, { recursive: true });

// Once/day ET gate (mirrors av-fetch.mjs) so the intraday loop doesn't re-spend provider calls.
const todayET = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const fetchedFile = join(EXTDIR, '.fetched');
if (existsSync(fetchedFile) && readFileSync(fetchedFile, 'utf8').trim() === todayET) {
  console.log(`[extfund] already fetched today (${todayET}) — replaying existing ext-fund, no provider calls spent`);
  process.exit(0);
}

async function getJSON(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
    if (!r.ok) return { _err: `HTTP ${r.status}` };
    const j = await r.json();
    if (j && (j.error || j['Error Message'])) return { _err: String(j.error || j['Error Message']).slice(0, 120) };
    return j;
  } catch (e) { return { _err: e.name === 'AbortError' ? 'timeout' : e.message }; }
  finally { clearTimeout(timer); }
}
const ok = (j) => j && !j._err;

async function fromFinnhub(sym) {
  const s = encodeURIComponent(avSym(sym));
  const [profile, metric] = await Promise.all([
    getJSON(`https://finnhub.io/api/v1/stock/profile2?symbol=${s}&token=${FINNHUB_KEY}`),
    getJSON(`https://finnhub.io/api/v1/stock/metric?symbol=${s}&metric=all&token=${FINNHUB_KEY}`),
  ]);
  if (!ok(profile) && !ok(metric)) return { _err: (profile._err || metric._err) };
  return finnhubToOverview(sym, ok(profile) ? profile : null, ok(metric) ? metric : null);
}
async function fromFMP(sym) {
  const s = encodeURIComponent(avSym(sym));
  const k = encodeURIComponent(FMP_KEY);
  // v3 fundamentals are broadly available; price-target/estimates are tier-gated → tolerated as absent.
  const [profile, ratios, quote, target, est] = await Promise.all([
    getJSON(`https://financialmodelingprep.com/api/v3/profile/${s}?apikey=${k}`),
    getJSON(`https://financialmodelingprep.com/api/v3/ratios-ttm/${s}?apikey=${k}`),
    getJSON(`https://financialmodelingprep.com/api/v3/quote/${s}?apikey=${k}`),
    getJSON(`https://financialmodelingprep.com/api/v4/price-target-consensus?symbol=${s}&apikey=${k}`),
    getJSON(`https://financialmodelingprep.com/api/v3/analyst-estimates/${s}?limit=1&apikey=${k}`),
  ]);
  if (!ok(profile) && !ok(ratios) && !ok(quote)) return { _err: (profile._err || ratios._err || quote._err) };
  return fmpToOverview(sym, ok(profile) ? profile : null, ok(ratios) ? ratios : null,
    ok(quote) ? quote : null, ok(target) ? target : null, ok(est) ? est : null);
}

const writeJSON = (f, o) => writeFileSync(f, JSON.stringify(o));
let wrote = 0, fail = 0;
for (const sym of coverFromRaw(RAW)) {
  let fh = null, fm = null;
  try { if (FINNHUB_KEY) fh = await fromFinnhub(sym); } catch { /* tolerated */ }
  try { if (FMP_KEY) fm = await fromFMP(sym); } catch { /* tolerated */ }
  // FMP first so its forward P/E + analyst target win; Finnhub fills trailing-fundamentals gaps.
  const merged = mergeOverviews(ok(fm) ? fm : {}, ok(fh) ? fh : {});
  if (!merged.Symbol || Object.keys(merged).length <= 1) { fail++; console.warn(`[extfund] ${sym}: no usable data — keeping prior`); continue; }
  if (!isRich(merged)) { /* still useful (sector/mktcap), but won't override a carried-forward AV-rich one */ }
  writeJSON(join(EXTDIR, `overview-${sym}.json`), { structuredContent: merged });
  wrote++;
}

if (wrote > 0) writeFileSync(fetchedFile, todayET); // only claim "fetched today" if something landed
const src = [FINNHUB_KEY && 'Finnhub', FMP_KEY && 'FMP'].filter(Boolean).join('+');
console.log(`[extfund] ${src} fetch: ${wrote} written · ${fail} skipped${wrote ? ` · marked ${todayET}` : ' — nothing written (cap/host blocked?), prior kept'}`);
