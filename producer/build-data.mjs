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
import { emit, decryptEnvelope } from './emit.mjs';
import { MARKET_SYMBOLS } from './markets.mjs';
import { LEADERS } from './leaders.mjs';
import { avKey, specForId } from './av.mjs';
import { fetchSocial } from './social.mjs';

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

// Prior committed snapshot, decrypted ONCE — the only state that survives the producer's
// fresh-clone runs. Lets a light intraday run (which skips the heavy historicals/AV/picks fetch)
// carry that data forward so the snapshot stays visually complete. Null when there's no prior
// file, no passphrase, or decrypt fails → every merge below falls back to fresh-only, i.e. exactly
// the original behavior.
async function loadPrior() {
  try {
    const p = join(__dirname, '..', 'data.json');
    if (!existsSync(p)) return null;
    const prev = readJSON(p);
    if (prev && prev.enc) return process.env.PF_PASSPHRASE ? await decryptEnvelope(prev, process.env.PF_PASSPHRASE) : null;
    return prev; // plaintext dev snapshot
  } catch { return null; }
}
const prior = await loadPrior();

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
// Carry forward prior bars for any interval/symbol not freshly fetched this run, so a light
// intraday run (no hist-*.json) still ships the full YTD/5Y series. Freshly-fetched bars win.
if (prior && prior.hist) {
  for (const iv of Object.keys(prior.hist)) hist[iv] = { ...prior.hist[iv], ...(hist[iv] || {}) };
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

// Sector + dividends from Robinhood fundamentals (free, every run) → synthesize the AV
// COMPANY_OVERVIEW the dashboard reads for sector allocation + dividend income, but ONLY
// where AV didn't already supply one (AV adds revenue growth / forward P/E that RH lacks).
// Save get_equity_fundamentals for the covered holdings to producer/raw/holdings-fund.json.
let rhOvCount = 0;
const hfFile = filesMatching(/^holdings-fund\.json$/)[0];
if (hfFile) {
  const FREQ = { Quarterly: 4, Monthly: 12, 'Semi-Annual': 2, 'Semi-Annually': 2, Annual: 1, Annually: 1, Weekly: 52 };
  const hf = unwrap(readJSON(hfFile));
  for (const r of (hf.data?.results ?? hf.results ?? [])) {
    if (!r.symbol) continue;
    const key = avKey('COMPANY_OVERVIEW', { symbol: r.symbol.replace(/\./g, '-') });
    if (recorded[key]) continue; // AV already provided richer data — keep it
    const dps = r.dividend_per_share != null ? parseFloat(r.dividend_per_share) : 0;
    const annDps = dps ? dps * (FREQ[r.distribution_frequency] || 1) : 0;
    recorded[key] = { structuredContent: {
      Symbol: r.symbol, Name: r.symbol, Sector: r.sector || 'N/A', Industry: r.industry || '',
      PERatio: r.pe_ratio != null ? String(r.pe_ratio) : 'None',
      MarketCapitalization: r.market_cap != null ? String(Math.round(parseFloat(r.market_cap))) : 'None',
      '52WeekHigh': r.high_52_weeks != null ? String(r.high_52_weeks) : 'None',
      '52WeekLow': r.low_52_weeks != null ? String(r.low_52_weeks) : 'None',
      DividendPerShare: annDps ? annDps.toFixed(4) : '0',
      DividendYield: r.dividend_yield != null ? (parseFloat(r.dividend_yield) / 100).toFixed(4) : '0',
      ExDividendDate: r.ex_dividend_date || 'None',
    } };
    rhOvCount++;
  }
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

// Carry forward prior recorded entries (AV macro, synthesized COMPANY_OVERVIEW) not regenerated
// this run; fresh portfolio/positions/VIX win because they share the same key.
const recordedOut = prior && prior.recorded ? { ...prior.recorded, ...recorded } : recorded;

// COMPANY_OVERVIEW accumulation guard. The free Alpha Vantage tier (25 calls/day, plus burst
// throttling) only covers a rotating subset of holdings each run, so any holding the budget skipped
// falls back to the 11-field Robinhood synth above (PERatio/MarketCap/DividendYield only — no
// ForwardPE/EPS/RevGrowth). Without this guard that thin synth would CLOBBER a richer AV overview
// captured on a PRIOR day (this run's `recorded` wins the spread above), so AV fundamentals coverage
// could never accumulate past a single day's cap — Fwd P/E / Rev Growth / EPS would flicker blank for
// whichever names missed today's fetch. Fix: when this run only produced the thin synth for an overview
// the prior snapshot already holds AV-rich, KEEP the prior. Genuine AV refreshes (also rich) still win,
// so the 25/day cap becomes a refresh cadence, not a hard coverage ceiling.
if (prior && prior.recorded) {
  const ovObj = (e) => (e && typeof e === 'object')
    ? (e.structuredContent && typeof e.structuredContent === 'object' ? e.structuredContent : (e.Symbol ? e : null))
    : null;
  const ovRich = (e) => { const o = ovObj(e); return !!(o && ('ForwardPE' in o || 'EPS' in o || 'QuarterlyRevenueGrowthYOY' in o)); };
  let keptOv = 0;
  for (const k of Object.keys(recorded)) {
    const cur = recorded[k], pri = prior.recorded[k];
    if (ovObj(cur) && ovObj(pri) && !ovRich(cur) && ovRich(pri)) { recordedOut[k] = pri; keptOv++; }
  }
  if (keptOv) console.log(`fundamentals: preserved ${keptOv} carried-forward AV overview${keptOv === 1 ? '' : 's'} over this run's Robinhood synth (free-tier accumulation)`);
}

const data = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  generatedAtLabel: label,
  recorded: recordedOut, quotes, hist,
  // Mega-cap leaders bench for the Agentic Portfolio card's target. The consumer reads the bench +
  // sectors from here and prices each from data.quotes (the producer quotes LEADER_SYMBOLS every run).
  leaders: LEADERS,
};

// --- Agentic cash account (the "Agentic Portfolio" card's ACTUAL holdings + cash) ---
// The recommended portfolio is no longer a restructuring of the margin book — it's the blueprint for
// the agentic cash account, which the consumer renders as its own card (target vs. actual vs. drift).
// Optional raw inputs the producer fetches every run for that account: agentic-portfolio.json
// (get_portfolio) + agentic-positions.json (get_equity_positions). Emitted as
//   data.agentic = { asOf, cash, buyingPower, equity, positions:[{symbol,qty,avgCost,px,value}], target }
// Position values are priced from data.quotes (the producer quotes the agentic holdings each run),
// falling back to average cost. Carried forward from the prior snapshot when not re-supplied — so the
// card persists across the producer's fresh-clone runs — exactly like realized/options/picks.
// `target` is the committed, research-driven canonical allocation (producer/agentic-target.json,
// refreshed weekly by the deep multi-factor research — see AGENTIC.md). Read EVERY run and attached so
// the card renders drift against the REAL deployed basket, not the cheap oversold heuristic; present
// even before the first account snapshot lands (target-only state).
{
  let agenticTarget = null;
  try { const tf = join(__dirname, 'agentic-target.json'); if (existsSync(tf)) agenticTarget = readJSON(tf); } catch { agenticTarget = null; }
  const apFile = filesMatching(/^agentic-portfolio\.json$/)[0];
  if (apFile) {
    const pd = (() => { const r = unwrap(readJSON(apFile)); return r.data ?? r; })();
    const aposFile = filesMatching(/^agentic-positions\.json$/)[0];
    const aposRaw = aposFile ? unwrap(readJSON(aposFile)) : null;
    const aPositions = aposRaw ? (aposRaw.data?.positions ?? aposRaw.positions ?? aposRaw) : [];
    const pxOf = (sym) => {
      const q = quotes[sym]; if (!q) return 0;
      return parseFloat(q.last_extended_hours_trade_price || q.last_trade_price || q.adjusted_previous_close || q.previous_close || 0) || 0;
    };
    const positions = (Array.isArray(aPositions) ? aPositions : []).map((p) => {
      const symbol = p.symbol || p.ticker;
      const qty = parseFloat(p.quantity ?? p.qty ?? 0) || 0;
      const avgCost = parseFloat(p.average_buy_price ?? p.average_cost ?? p.avg_cost ?? 0) || 0;
      const px = pxOf(symbol) || avgCost;
      return { symbol, qty, avgCost, px, value: +(qty * px).toFixed(2) };
    }).filter((p) => p.symbol && p.qty > 0);
    const cash = parseFloat(pd.cash ?? 0) || 0;
    const bp = parseFloat((pd.buying_power && pd.buying_power.buying_power) ?? pd.buying_power ?? 0) || 0;
    const posVal = positions.reduce((s, p) => s + p.value, 0);
    data.agentic = { asOf: data.generatedAt, cash, buyingPower: bp, equity: +(cash + posVal).toFixed(2), positions };
    console.log(`agentic: ${positions.length} positions · ${fmtMoney(posVal)} invested · ${fmtMoney(cash)} cash`);
  } else if (prior && prior.agentic) {
    // No fresh agentic fetch this run (e.g. a light intraday run) — carry the holdings forward but
    // RE-PRICE each with THIS run's quotes, so the agentic values + drift track prices on every run
    // (3×/day), in step with the main account. The holdings are index/leader symbols that are quoted
    // every run, so a live price is available; falls back to the carried px / avg cost otherwise.
    const pxOf = (sym) => { const q = quotes[sym]; if (!q) return 0; return parseFloat(q.last_extended_hours_trade_price || q.last_trade_price || q.adjusted_previous_close || q.previous_close || 0) || 0; };
    const positions = (prior.agentic.positions || []).map((p) => { const px = pxOf(p.symbol) || p.px || p.avgCost || 0; return { ...p, px, value: +(px * (p.qty || 0)).toFixed(2) }; });
    const posVal = positions.reduce((s, p) => s + p.value, 0);
    const cash = prior.agentic.cash || 0;
    data.agentic = { ...prior.agentic, asOf: data.generatedAt, positions, equity: +(cash + posVal).toFixed(2) };
    console.log(`agentic: re-priced ${positions.length} carried positions · ${fmtMoney(posVal)} invested (no fresh fetch this run)`);
  }
  // ── Real account equity history (records FORWARD — Robinhood gives no account-equity-history endpoint,
  // so this can't be backfilled). One point per UTC day, latest wins, cap ~260 (~1y) — same shape as
  // options.ivHistory. The consumer overlays this as the REAL agentic performance line on the Portfolio
  // "Performance vs Benchmark" chart, spliced onto a synthetic modeled lead-in (its current holdings
  // priced back to Jan 1). Carried forward verbatim when there's no positive equity to record.
  if (data.agentic && data.agentic.equity > 0) {
    const prevEq = (prior && prior.agentic && Array.isArray(prior.agentic.equityHistory)) ? prior.agentic.equityHistory.slice() : [];
    const day = new Date(data.generatedAt).toISOString().slice(0, 10);
    const filtered = prevEq.filter((e) => e && e.t !== day);
    filtered.push({ t: day, equity: data.agentic.equity });
    filtered.sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0));
    data.agentic.equityHistory = filtered.slice(-260);
  } else if (data.agentic && prior && prior.agentic && Array.isArray(prior.agentic.equityHistory)) {
    data.agentic.equityHistory = prior.agentic.equityHistory.slice(-260);
  }
  if (agenticTarget) {
    if (!data.agentic) data.agentic = { asOf: data.generatedAt, cash: 0, buyingPower: 0, equity: 0, positions: [] };
    data.agentic.target = agenticTarget;
    console.log(`agentic target: ${(agenticTarget.names || []).length} names (asOf ${agenticTarget.asOf})`);
  }
}
function fmtMoney(n) { return '$' + (Math.round(n * 100) / 100).toLocaleString('en-US'); }
// Daily Picks (Robinhood scanner → scored in picks-build.mjs). Embedded as data.picks; the
// dashboard reads it directly. Fresh when built this run, else carried from the prior snapshot.
const picksFile = filesMatching(/^picks\.json$/)[0];
if (picksFile) data.picks = readJSON(picksFile);
else if (prior && prior.picks) data.picks = prior.picks;

// Pick track-record ledger (data.picks.history). When a FRESH scan is built (new date), archive the
// OUTGOING (prior) top picks with their entry/target/stop so the consumer can grade them against
// subsequent prices (closing-basis: hit TP1/TP2, stopped, or still open) and show a real hit-rate.
// Carried forward unchanged on light runs; capped to the most recent 40 dated entries.
if (data.picks) {
  let history = (prior && prior.picks && Array.isArray(prior.picks.history)) ? prior.picks.history.slice() : [];
  const pp = prior && prior.picks;
  const replaced = picksFile && pp && Array.isArray(pp.picks) && pp.picks.length && pp.ts && pp.ts !== data.picks.ts;
  if (replaced && !history.some((h) => h.ts === pp.ts)) {
    const entryRef = (p) => { const m = /([\d.]+)/.exec(String(p.entry || '')); return m ? +m[1] : p.basePrice; };
    history.unshift({
      ts: pp.ts, date: pp.date,
      picks: pp.picks.map((p) => ({
        ticker: p.ticker, basePrice: p.basePrice, entry: p.entry, entryRef: entryRef(p),
        tp1: p.tp1 && p.tp1.price, tp2: p.tp2 && p.tp2.price, sl: p.sl && p.sl.price,
        composite: p.composite, signal: p.signal,
      })),
    });
    history = history.slice(0, 40);
  }
  data.picks.history = history;
}
// Options page (your positions/pending + directional ideas). Embedded as data.options.
const optionsFile = filesMatching(/^options\.json$/)[0];
if (optionsFile) data.options = readJSON(optionsFile);
else if (prior && prior.options) data.options = prior.options;

// IV RANK: maintain a rolling per-symbol implied-vol history (the only options state that must
// survive the producer's fresh-clone runs — options-build can't see the prior snapshot, build-data
// can). Append today's observed IVs (one point per UTC day, latest wins), cap to ~1y of points, and
// derive IV rank = where today's IV sits in its trailing min/max range (0 = cheapest, 100 = richest).
// Then decorate every position/pending/idea with `ivRank` so the consumer can flag cheap vs. rich
// options without re-deriving it. Skipped cleanly when options were merely carried forward.
if (data.options && optionsFile) {
  const today = data.generatedAt.slice(0, 10);
  const histPrev = (prior && prior.options && prior.options.ivHistory) || {};
  const ivHistory = {};
  for (const sym of Object.keys(histPrev)) ivHistory[sym] = histPrev[sym].slice();
  const observed = data.options.ivObserved || {};
  for (const [sym, iv] of Object.entries(observed)) {
    if (!(iv > 0)) continue;
    const series = (ivHistory[sym] = ivHistory[sym] || []);
    if (series.length && series[series.length - 1].d === today) series[series.length - 1].v = iv;
    else series.push({ d: today, v: iv });
    if (series.length > 260) ivHistory[sym] = series.slice(-260);
  }
  const ivRank = {};
  for (const [sym, series] of Object.entries(ivHistory)) {
    if (!series || series.length < 5) continue;            // need a little history to be meaningful
    const vals = series.map((p) => p.v);
    const lo = Math.min(...vals), hi = Math.max(...vals), cur = vals[vals.length - 1];
    ivRank[sym] = hi > lo ? Math.round(((cur - lo) / (hi - lo)) * 100) : 50;
  }
  data.options.ivHistory = ivHistory;
  data.options.ivRank = ivRank;
  const decorate = (a) => { if (a && a.underlying && ivRank[a.underlying] != null) a.ivRank = ivRank[a.underlying]; };
  (data.options.positions || []).forEach(decorate);
  (data.options.pending || []).forEach(decorate);
  if (data.options.ideas && Array.isArray(data.options.ideas.ideas)) data.options.ideas.ideas.forEach(decorate);
}

// Realized P&L for the Income & Tax widget. There is no cost-basis/realized endpoint, so this is
// an owner-maintained figure (authoritative source: Robinhood's tax center) committed to
// producer/realized.json as { year, equity, options, total, approx }. Embedded verbatim as
// data.realized; the widget simply hides the tile when the file is absent.
const realizedFile = join(__dirname, 'realized.json');
if (existsSync(realizedFile)) {
  const r = readJSON(realizedFile);
  if (r && r.total == null) r.total = (r.equity || 0) + (r.options || 0);
  data.realized = r;
} else if (prior && prior.realized) {
  // No fresh figure this run — carry forward the prior snapshot's realized (already decrypted in
  // loadPrior) so the tile persists across the routine's fresh-clone runs.
  data.realized = prior.realized;
}
// Options realized + premium-collected (YTD) come from options.json fresh every run (cheap), and
// override whatever the equity figure carried. Equity realized stays owner/carry-forward sourced.
if (data.options && (data.options.realizedYTD != null || data.options.premiumYTD != null)) {
  data.realized = data.realized || { approx: true };
  if (data.options.realizedYTD != null) data.realized.options = data.options.realizedYTD;
  if (data.options.premiumYTD != null) data.realized.premiumYTD = data.options.premiumYTD;
  data.realized.total = (data.realized.equity || 0) + (data.realized.options || 0);
  if (data.realized.year == null) data.realized.year = String(new Date().getUTCFullYear()) + ' YTD';
}

// Owner editorial notes (OPTIONAL). A small, hand-maintained producer/notes.json lets the owner
// attach short context that renders in the dashboard (e.g. the Risk card's concentration commentary)
// WITHOUT baking ticker-/date-specific prose into index.html. Shape: a plain string, or
// { risk: "…" } for section-targeted notes. Absent → the UI derives everything from live data.
// Carried forward from the prior snapshot when not re-supplied, like realized/picks.
const notesFile = join(__dirname, 'notes.json');
if (existsSync(notesFile)) {
  const n = readJSON(notesFile);
  if (n != null && (typeof n === 'string' ? n.trim() : (n.risk || Object.keys(n).length))) data.notes = n;
} else if (prior && prior.notes) {
  data.notes = prior.notes;
}

// News sentiment (OPTIONAL — Alpha Vantage NEWS_SENTIMENT). The agent may save a raw AV
// result to producer/raw/news/<SYM>.json for a few top holdings if AV budget remains (it's
// rate-limited, so this is opt-in and never required). Aggregated per ticker for the Analyze
// tab's News card; absent → the card simply hides. data.news = { SYM: {score,label,n,recent[]} }.
const newsDir = join(RAWDIR, 'news');
if (existsSync(newsDir)) {
  const news = {};
  for (const f of readdirSync(newsDir).filter((x) => x.endsWith('.json'))) {
    const sym = f.replace(/\.json$/, '').toUpperCase();
    const d = unwrap(readJSON(join(newsDir, f)));
    const feed = d.feed ?? d.data?.feed ?? [];
    if (!Array.isArray(feed) || !feed.length) continue;
    const recent = [], scores = [];
    for (const item of feed.slice(0, 12)) {
      let ts = null, lab = item.overall_sentiment_label;
      const tk = (item.ticker_sentiment || []).find((t) => (t.ticker || '').toUpperCase() === sym);
      if (tk) { ts = parseFloat(tk.ticker_sentiment_score); lab = tk.ticker_sentiment_label || lab; }
      else if (item.overall_sentiment_score != null) ts = parseFloat(item.overall_sentiment_score);
      if (ts != null && Number.isFinite(ts)) scores.push(ts);
      if (recent.length < 4) recent.push({ title: item.title, url: item.url, source: item.source || null, sentiment: lab || null });
    }
    if (!scores.length) continue;
    const avg = scores.reduce((s, v) => s + v, 0) / scores.length;
    const label = avg >= 0.35 ? 'Bullish' : avg >= 0.15 ? 'Somewhat-Bullish'
      : avg <= -0.35 ? 'Bearish' : avg <= -0.15 ? 'Somewhat-Bearish' : 'Neutral';
    news[sym] = { score: +avg.toFixed(2), label, n: feed.length, recent };
  }
  if (Object.keys(news).length) data.news = news;
}

// Social / retail-sentiment signal (data.social). ApeWisdom Reddit/social buzz (fetched
// in-process every build — keyless, degrades to nothing if apewisdom.io isn't in the egress
// allowlist), blended with Robinhood retail-popularity rank (raw/popular.json, optional) and our
// AV news sentiment. Surfaced on Analyze ("Social Pulse") + Markets ("Retail Buzz") as a SIGNAL
// layer — deliberately NOT folded into the Picks composite score. Absent → the cards just hide.
{
  const heldSyms = (positions || []).map((p) => p.symbol).filter(Boolean);
  const pickSyms = (data.picks && Array.isArray(data.picks.candidates))
    ? data.picks.candidates.map((c) => c.ticker).filter(Boolean) : [];
  const wantSet = [...new Set([...heldSyms, ...pickSyms].map((s) => String(s).toUpperCase()))];

  let social = null;
  try { social = await fetchSocial(wantSet); }
  catch { social = null; }
  console.log(social
    ? `social: ApeWisdom ${social.universe} tracked · ${Object.values(social.tickers).filter((t) => t.tracked).length}/${wantSet.length} of your names trending`
    : 'social: ApeWisdom unreachable (add apewisdom.io to the egress allowlist) — using RH popularity / news only');

  // Robinhood retail popularity: the "100 most popular" watchlist items in rank order. The agent
  // optionally saves a get_watchlist_items result to producer/raw/popular.json; rank = list order.
  const rhRank = {};
  const popFile = filesMatching(/^popular\.json$/)[0];
  if (popFile) {
    const d = unwrap(readJSON(popFile));
    const items = d.data?.items ?? d.items ?? d.data?.results ?? d.results ?? (Array.isArray(d) ? d : []);
    items.forEach((it, i) => { const s = (it.symbol || it.ticker || '').toUpperCase(); if (s && !(s in rhRank)) rhRank[s] = i + 1; });
  }

  if (social || Object.keys(rhRank).length || data.news) {
    social = social || { asOf: new Date().toISOString(), source: 'rh', universe: 0, tickers: {}, trending: [] };
    for (const sym of wantSet) {
      const t = (social.tickers[sym] = social.tickers[sym] || { tracked: false });
      if (rhRank[sym] != null) t.rhRank = rhRank[sym];
      const nw = data.news && data.news[sym];
      if (nw) t.news = { label: nw.label, score: nw.score };
    }
    data.social = social;
  }
}

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
  '·', Object.keys(recorded).length, 'recorded ·', avCount, 'AV ·', rhOvCount, 'RH-overview',
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
