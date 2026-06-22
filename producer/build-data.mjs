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

// Realized P&L for the Income & Tax widget. There is no cost-basis/realized endpoint, so this is
// an owner-maintained figure (authoritative source: Robinhood's tax center) committed to
// producer/realized.json as { year, equity, options, total, approx }. Embedded verbatim as
// data.realized; the widget simply hides the tile when the file is absent.
const realizedFile = join(__dirname, 'realized.json');
if (existsSync(realizedFile)) {
  const r = readJSON(realizedFile);
  if (r && r.total == null) r.total = (r.equity || 0) + (r.options || 0);
  data.realized = r;
} else {
  // No fresh figure this run — carry forward the prior snapshot's realized (decrypted) so the
  // tile persists across the routine's fresh-clone runs without committing the plaintext figure.
  try {
    const prevPath = join(__dirname, '..', 'data.json');
    if (existsSync(prevPath) && process.env.PF_PASSPHRASE) {
      const prev = readJSON(prevPath);
      const dec = prev && prev.enc ? await decryptEnvelope(prev, process.env.PF_PASSPHRASE) : prev;
      if (dec && dec.realized) data.realized = dec.realized;
    }
  } catch { /* no carry-forward available */ }
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
