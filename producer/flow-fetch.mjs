// producer/flow-fetch.mjs — fetch the Flow & Positioning inputs over HTTP and write per-symbol scored
// sidecars, the same in-process pattern as extfund-fetch.mjs. Run by run.mjs when FINNHUB_KEY is set.
//
// Requirements:
//   • env FINNHUB_KEY → Finnhub (analyst recommendations, insider Form 4 + sentiment, earnings surprises).
//   • env FMP_KEY     → optional, only for the treasury curve sidecar (see below).
//   • egress allowlist must include `finnhub.io` (and `financialmodelingprep.com` for the curve).
//   • PF_FLOW=off disables the whole layer.
//
// Writes producer/raw/flow/<SYM>.json = the SCORED read from flow.mjs (compact — a few hundred bytes),
// not the raw provider payloads, which run to hundreds of insider rows per name. build-data.mjs folds
// these into data.flow with carry-forward. Gated to once per ET day like av-fetch/extfund-fetch, and it
// never overwrites a good prior with a bad response.
//
// SCOPE: covers the HELD book (coverFromRaw), which is what the consumer renders. The weekly research
// workflow scores its own (wider) universe in-session via the same flow.mjs functions, so the producer
// and the workflow can never disagree about what a given payload means.
//
// RATE LIMIT: Finnhub allows 60 calls/min. This spends 3 calls per symbol, paced to stay under ~55/min,
// so a ~36-name book takes roughly two minutes — acceptable for a once-a-day step, and it runs after
// data.json is already published so it can never delay a publish.
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { coverFromRaw } from './av.mjs';
import { avSym } from './extfund.mjs';
import { scoreSymbol } from './flow.mjs';
import { etDate } from './market.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RAW = join(__dirname, 'raw');
const FLOWDIR = join(RAW, 'flow');
const FINNHUB_KEY = process.env.FINNHUB_KEY;
const FMP_KEY = process.env.FMP_KEY;

if (String(process.env.PF_FLOW || '').toLowerCase() === 'off') { console.log('[flow] PF_FLOW=off — skipping flow signals'); process.exit(0); }
if (!FINNHUB_KEY) { console.log('[flow] no FINNHUB_KEY — skipping flow signals'); process.exit(0); }
console.log(`[flow] keys → Finnhub: ✅ detected · FMP (treasury curve): ${FMP_KEY ? '✅ detected' : '— absent'}`);
mkdirSync(FLOWDIR, { recursive: true });

const todayET = etDate();
const fetchedFile = join(FLOWDIR, '.fetched');
if (existsSync(fetchedFile) && readFileSync(fetchedFile, 'utf8').trim() === todayET) {
  console.log(`[flow] already fetched today (${todayET}) — replaying existing sidecars, no provider calls spent`);
  process.exit(0);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
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

const FH = 'https://finnhub.io/api/v1';
const tok = encodeURIComponent(FINNHUB_KEY);
// Insider sentiment is a rolling monthly series; a 6-month lookback is enough to read the latest MSPR.
const sentFrom = (() => { const d = new Date(`${todayET}T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() - 6); return d.toISOString().slice(0, 10); })();

let wrote = 0, skipped = 0, firstErr = null;
const symbols = coverFromRaw(RAW);
for (const sym of symbols) {
  const s = encodeURIComponent(avSym(sym));
  const [recommendation, insiderTx, insiderSentiment, earnings] = await Promise.all([
    getJSON(`${FH}/stock/recommendation?symbol=${s}&token=${tok}`),
    getJSON(`${FH}/stock/insider-transactions?symbol=${s}&token=${tok}`),
    getJSON(`${FH}/stock/insider-sentiment?symbol=${s}&from=${sentFrom}&to=${todayET}&token=${tok}`),
    getJSON(`${FH}/stock/earnings?symbol=${s}&token=${tok}`),
  ]);
  if (!firstErr) firstErr = [recommendation, insiderTx, insiderSentiment, earnings].map((x) => x && x._err).find(Boolean) || null;

  const read = scoreSymbol({
    recommendation: ok(recommendation) ? recommendation : null,
    insiderTx: ok(insiderTx) ? insiderTx : null,
    insiderSentiment: ok(insiderSentiment) ? insiderSentiment : null,
    earnings: ok(earnings) ? earnings : null,
  }, { asOf: todayET });

  // Only claim a read when SOMETHING scored — otherwise leave the prior sidecar in place. A name that
  // abstains on the composite but has one live component is still worth keeping for display.
  if (!read.flow && !read.revision && !read.insider && !read.surprise) {
    skipped++;
    console.warn(`[flow] ${sym}: no usable data${firstErr ? ` (${firstErr})` : ''} — keeping prior`);
  } else {
    writeFileSync(join(FLOWDIR, `${sym}.json`), JSON.stringify({ sym, asOf: todayET, ...read }));
    wrote++;
  }
  await sleep(3300); // ~55 Finnhub calls/min at 4 calls per symbol
}

// Treasury curve sidecar — one FMP call returns the ENTIRE curve (1m…30y) for the latest session. This
// exists because the Markets 2s10s tile reads AV's TREASURY_YIELD per maturity, and a run that captured
// the 10-year but not the 2-year leaves the curve showing "—" until the next FETCH_ALL happens to record
// both (documented in CLAUDE.md). One call removes that failure mode. Written as a sidecar only; wiring
// it into the 2s10s tile touches the replay-key contract and is handled separately.
if (FMP_KEY) {
  const curve = await getJSON(`https://financialmodelingprep.com/stable/treasury-rates?apikey=${encodeURIComponent(FMP_KEY)}`);
  const row = Array.isArray(curve) ? curve[0] : null;
  if (row && Number.isFinite(parseFloat(row.year10))) {
    writeFileSync(join(FLOWDIR, '_treasury.json'), JSON.stringify(row));
    console.log(`[flow] treasury curve ${row.date}: 2y ${row.year2} · 10y ${row.year10} · 2s10s ${(parseFloat(row.year10) - parseFloat(row.year2)).toFixed(2)}`);
  } else {
    console.log(`[flow] treasury curve unavailable${curve && curve._err ? ` (${curve._err})` : ''} — keeping prior`);
  }
}

if (wrote > 0) writeFileSync(fetchedFile, todayET); // only claim "fetched today" if something landed
if (wrote > 0) {
  console.log(`[flow] Finnhub fetch: ${wrote} scored · ${skipped} skipped · marked ${todayET}`);
} else {
  const e = (firstErr || '').toLowerCase();
  const hint = /403|407|enotfound|eai_again|denied|blocked|timeout/.test(e)
    ? `looks like finnhub.io is NOT on the egress allowlist (err: ${firstErr})`
    : /401|invalid|api key|token|unauthor|limit|access/.test(e)
    ? `looks like a key/tier problem (err: ${firstErr})`
    : firstErr ? `err: ${firstErr}` : 'no covered holdings to fetch';
  console.log(`[flow] Finnhub fetch: nothing written — ${hint}. Prior flow signals kept.`);
}
