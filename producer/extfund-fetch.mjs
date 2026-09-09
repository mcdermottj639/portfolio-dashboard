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
import { wideCover } from './av.mjs';
import { liveUniverse } from './analyze-universe.mjs';
import { finnhubToOverview, fmpToOverview, mergeOverviews, isRich, avSym,
  extAsOfMap, fmpRotation, FMP_DAILY_SYMS } from './extfund.mjs';
import { alreadyFetchedToday, readSnapshot } from './fetchgate.mjs';

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
// Gate on the COMMITTED snapshot (data.fetchDays.extfund), not just the raw/ marker — raw/ is wiped on
// every scheduled run, so a marker-only gate never tripped and this re-spent ~70 FMP calls per run
// against a ~250/day free cap, exhausting it within the first few runs of each day.
const fetchedFile = join(EXTDIR, '.fetched');
if (await alreadyFetchedToday('extfund', todayET, fetchedFile)) {
  console.log(`[extfund] already fetched today (${todayET}) — replaying existing ext-fund, no provider calls spent`);
  process.exit(0);
}

// --- pacing (v141) -------------------------------------------------------------------------------
// Finnhub is 60 calls/minute and now covers the WHOLE Analyze bench (2 calls/symbol, ~180 names), so
// the old fire-and-hope loop would trip the limit within seconds. This is a sliding-window limiter,
// not a fixed sleep: it only waits when the last minute is actually full, so a slow provider costs
// nothing extra. FINNHUB_RPM is set below the documented 60 because the window is measured on OUR
// clock, not theirs, and a burst that lands on a boundary is what gets rate-limited.
const FINNHUB_RPM = 55;
const stamps = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function pace() {
  const now = Date.now();
  while (stamps.length && now - stamps[0] > 60000) stamps.shift();
  if (stamps.length >= FINNHUB_RPM) await sleep(Math.max(0, 60000 - (Date.now() - stamps[0])) + 50);
  stamps.push(Date.now());
}
// A hard limit means STOP — every further call is wasted and the provider may start counting them
// against tomorrow. `limitHit` short-circuits the rest of the run and we keep whatever landed, which
// is strictly better than the alternative: a partially-covered bench is partially useful, and the
// rotation below means the names we missed sort FIRST tomorrow.
let limitHit = null;

async function getJSON(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
    if (r.status === 429) { limitHit = limitHit || 'HTTP 429 (rate/daily limit)'; return { _err: 'HTTP 429' }; }
    if (!r.ok) return { _err: `HTTP ${r.status}` };
    const j = await r.json();
    if (j && (j.error || j['Error Message'])) {
      const msg = String(j.error || j['Error Message']).slice(0, 120);
      if (/limit|quota|exceed/i.test(msg)) limitHit = limitHit || msg;
      return { _err: msg };
    }
    return j;
  } catch (e) { return { _err: e.name === 'AbortError' ? 'timeout' : e.message }; }
  finally { clearTimeout(timer); }
}
const ok = (j) => j && !j._err;

async function fromFinnhub(sym) {
  const s = encodeURIComponent(avSym(sym));
  // Paced SEQUENTIALLY, not Promise.all'd: the limiter counts calls, and firing both at once makes
  // the window under-count by exactly a factor of two — which is how a 60/min budget becomes 120.
  await pace(); const profile = await getJSON(`https://finnhub.io/api/v1/stock/profile2?symbol=${s}&token=${FINNHUB_KEY}`);
  await pace(); const metric = await getJSON(`https://finnhub.io/api/v1/stock/metric?symbol=${s}&metric=all&token=${FINNHUB_KEY}`);
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

// --- who gets covered today (v141) ---------------------------------------------------------------
// Cover was `coverFromRaw` — the top ~14 holdings by value, i.e. the ALPHA VANTAGE cover, borrowed
// because these providers were bolted on beside AV. But they are not on AV's 25/day budget, and the
// consequence of the narrow list was that every bench name the Analyze tab can be asked about had
// NO fundamentals at all, so its `_fundScore` abstained and the read was technicals-only.
//
// Finnhub takes the WHOLE bench each day (2 calls/symbol, paced). FMP cannot — 5 calls/symbol
// against ~250/day is ~45 names — so it rotates least-recently-refreshed first off the `_extAsOf`
// stamp build-data writes into each overview. Both lists keep the bench's own priority order
// (holdings → target → market → leaders → SD bench → research), so the account's own money is
// always covered even on a day the run is cut short by a provider limit.
const cover = wideCover(RAW, liveUniverse(RAW));
const snap = await readSnapshot();                       // best-effort; no snapshot ⇒ no stamps ⇒ plain order
const fmpList = FMP_KEY ? new Set(fmpRotation(cover, extAsOfMap(snap, cover), FMP_DAILY_SYMS)) : new Set();
console.log(`[extfund] cover: ${cover.length} symbols` +
  `${FINNHUB_KEY ? ` · Finnhub ${cover.length}` : ''}` +
  `${FMP_KEY ? ` · FMP ${fmpList.size} (rotation, ${FMP_DAILY_SYMS}/day)` : ''}`);

let wrote = 0, fail = 0, firstErr = null, stopped = 0;
for (const sym of cover) {
  if (limitHit) { stopped++; continue; }               // a hard limit means every further call is wasted
  let fh = null, fm = null;
  try { if (FINNHUB_KEY) fh = await fromFinnhub(sym); } catch { /* tolerated */ }
  try { if (FMP_KEY && fmpList.has(sym)) fm = await fromFMP(sym); } catch { /* tolerated */ }
  if (!firstErr) firstErr = (fh && fh._err) || (fm && fm._err) || null; // remember why, to hint allowlist vs key
  // FMP first so its forward P/E + analyst target win; Finnhub fills trailing-fundamentals gaps.
  const merged = mergeOverviews(ok(fm) ? fm : {}, ok(fh) ? fh : {});
  // A name with nothing usable keeps whatever the snapshot already holds — never write an empty
  // overview, or the AV-rich guard in build-data has nothing to protect and coverage goes backwards.
  if (!merged.Symbol || Object.keys(merged).length <= 1) { fail++; continue; }
  writeJSON(join(EXTDIR, `overview-${sym}.json`), { structuredContent: merged });
  wrote++;
}

if (wrote > 0) writeFileSync(fetchedFile, todayET); // only claim "fetched today" if something landed
const src = [FINNHUB_KEY && 'Finnhub', FMP_KEY && 'FMP'].filter(Boolean).join('+');
if (wrote > 0) {
  console.log(`[extfund] ${src} fetch: ${wrote} written · ${fail} no-data · marked ${todayET}` +
    (limitHit ? ` — STOPPED EARLY at a provider limit (${limitHit}); ${stopped} symbol(s) not attempted, they sort first tomorrow` : ''));
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
