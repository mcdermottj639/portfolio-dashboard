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
// Clear, secret-free confirmation of what's configured (handy right after adding a key).
console.log(`[extfund] keys → Finnhub: ${FINNHUB_KEY ? '✅ detected' : '❌ missing'} · FMP: ${FMP_KEY ? '✅ detected' : '❌ missing'}`);
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
  // FMP "stable" API (/stable) — the v3/v4 legacy paths return a "Legacy Endpoint" error for keys
  // created after 2025-08-31. fundamentals are broadly available; price-target/estimates are
  // tier-gated → tolerated as absent. analyst-estimates returns descending years, so we pull a
  // window and pick the nearest future fiscal year for a sensible forward P/E.
  const [profile, ratios, quote, target, est] = await Promise.all([
    getJSON(`https://financialmodelingprep.com/stable/profile?symbol=${s}&apikey=${k}`),
    getJSON(`https://financialmodelingprep.com/stable/ratios-ttm?symbol=${s}&apikey=${k}`),
    getJSON(`https://financialmodelingprep.com/stable/quote?symbol=${s}&apikey=${k}`),
    getJSON(`https://financialmodelingprep.com/stable/price-target-consensus?symbol=${s}&apikey=${k}`),
    getJSON(`https://financialmodelingprep.com/stable/analyst-estimates?symbol=${s}&period=annual&limit=10&apikey=${k}`),
  ]);
  if (!ok(profile) && !ok(ratios) && !ok(quote)) return { _err: (profile._err || ratios._err || quote._err) };
  const estRow = ok(est) && Array.isArray(est) ? nearestEstimate(est) : null;
  return fmpToOverview(sym, ok(profile) ? profile : null, ok(ratios) ? ratios : null,
    ok(quote) ? quote : null, ok(target) ? target : null, estRow);
}
// From a set of dated annual estimates, pick the earliest whose date is in the future (next fiscal
// year) for a meaningful forward P/E; fall back to the most recent if all are past.
function nearestEstimate(rows) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
  const dated = rows.filter((r) => r && r.date).sort((a, b) => String(a.date).localeCompare(String(b.date)));
  if (!dated.length) return rows[0] || null;
  return dated.find((r) => String(r.date) >= today) || dated[dated.length - 1];
}

const writeJSON = (f, o) => writeFileSync(f, JSON.stringify(o));
let wrote = 0, fail = 0, firstErr = null;
for (const sym of coverFromRaw(RAW)) {
  let fh = null, fm = null;
  try { if (FINNHUB_KEY) fh = await fromFinnhub(sym); } catch { /* tolerated */ }
  try { if (FMP_KEY) fm = await fromFMP(sym); } catch { /* tolerated */ }
  if (!firstErr) firstErr = (fh && fh._err) || (fm && fm._err) || null; // remember why, to hint allowlist vs key
  // FMP first so its forward P/E + analyst target win; Finnhub fills trailing-fundamentals gaps.
  const merged = mergeOverviews(ok(fm) ? fm : {}, ok(fh) ? fh : {});
  if (!merged.Symbol || Object.keys(merged).length <= 1) { fail++; console.warn(`[extfund] ${sym}: no usable data${firstErr ? ` (${firstErr})` : ''} — keeping prior`); continue; }
  writeJSON(join(EXTDIR, `overview-${sym}.json`), { structuredContent: merged });
  wrote++;
}

if (wrote > 0) writeFileSync(fetchedFile, todayET); // only claim "fetched today" if something landed
const src = [FINNHUB_KEY && 'Finnhub', FMP_KEY && 'FMP'].filter(Boolean).join('+');
if (wrote > 0) {
  console.log(`[extfund] ${src} fetch: ${wrote} written · ${fail} skipped · marked ${todayET}`);
} else {
  // Distinguish the two common setup mistakes from the captured error.
  const e = (firstErr || '').toLowerCase();
  const hint = /403|407|enotfound|eai_again|denied|blocked|timeout/.test(e)
    ? `looks like ${'finnhub.io'}/${'financialmodelingprep.com'} is NOT on the egress allowlist (err: ${firstErr})`
    : /401|invalid|api key|apikey|unauthor|limit/.test(e)
    ? `looks like a key problem (err: ${firstErr})`
    : firstErr ? `err: ${firstErr}` : 'no covered holdings to fetch';
  console.log(`[extfund] ${src} fetch: nothing written — ${hint}. Prior fundamentals kept.`);
}
