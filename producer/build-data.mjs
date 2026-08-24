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
import { fetchSocialPages, shapeSocial } from './social.mjs';
import { computeAlerts } from './alerts.mjs';
import { computeAgenticTriggers } from './agentic-triggers.mjs';
import { gradeDecisions } from './agentic-ledger.mjs';
import { bookDrawdown } from './drawdown.mjs';
import { appendEquityPoint } from './equityseries.mjs';
import { mergeEvents, detectClusters } from './polflow.mjs';
import { accountRealized, buildRealized, lossesFromTrades } from './realizedpnl.mjs';

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
// Carry forward prior quotes for any symbol missing from this run's fetch (same policy as hist/
// recorded): a transiently unquotable name keeps its last known price instead of dropping to $0
// in the positions table and the agentic re-pricer. Freshly-fetched quotes always win.
if (prior && prior.quotes) {
  for (const [sym, q] of Object.entries(prior.quotes)) if (!quotes[sym]) quotes[sym] = q;
}

// --- historicals (per-symbol bars, by interval) ---
const hist = {};
for (const f of filesMatching(/^hist-(day|week|month).*\.json$/)) {
  const interval = /hist-(day|week|month)/.exec(f)[1];
  hist[interval] = hist[interval] || {};
  const d = unwrap(readJSON(f));
  const results = d.data?.results ?? d.results ?? [];
  // Require CONTENT, not just an array: a transient empty-bars fetch ([] is still an array)
  // must fall through to carry-forward below, not wipe the good prior series for that symbol.
  for (const res of results) if (res.symbol && Array.isArray(res.bars) && res.bars.length) hist[interval][res.symbol] = res.bars;
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

// Supplementary fundamentals (Finnhub / FMP): producer/raw/ext-fund/overview-<SYM>.json, each a
// { structuredContent: <AV-shaped overview> } from extfund-fetch.mjs. Alpha Vantage stays PRIMARY —
// when AV covered a name this run we only FILL the fields AV is missing (so AV's ForwardPE/target win,
// and ext fills Rev growth / EPS / PEG / margin for names AV's daily cap skipped). When AV didn't
// cover the name at all, the ext overview stands in (and, being rich, beats the Robinhood synth below).
const extDir = join(RAWDIR, 'ext-fund');
let extCount = 0, extFilled = 0;
if (existsSync(extDir)) for (const f of readdirSync(extDir).filter((x) => x.endsWith('.json'))) {
  const sym = f.replace(/^overview-/, '').replace(/\.json$/, '');
  if (!sym) continue;
  const key = avKey('COMPANY_OVERVIEW', { symbol: sym.replace(/\./g, '-') });
  const extOv = (readJSON(join(extDir, f)) || {}).structuredContent;
  if (!extOv || typeof extOv !== 'object') continue;
  const cur = recorded[key];
  if (!cur) { recorded[key] = { structuredContent: extOv }; extCount++; continue; }
  const o = cur.structuredContent && typeof cur.structuredContent === 'object' ? cur.structuredContent : (cur.Symbol ? cur : null);
  if (!o) continue;
  let filled = 0;
  for (const [k, v] of Object.entries(extOv)) {
    if (v == null || v === '' || v === 'None') continue;
    if (o[k] == null || o[k] === '' || o[k] === 'None') { o[k] = v; filled++; }
  }
  if (filled) extFilled++;
}
if (extCount || extFilled) console.log(`fundamentals: ext providers added ${extCount} overview${extCount === 1 ? '' : 's'} + filled gaps on ${extFilled} AV-covered name${extFilled === 1 ? '' : 's'}`);

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

// --- Agentic account (the "Agentic Portfolio" card's ACTUAL holdings + cash) ---
// The recommended portfolio is no longer a restructuring of the margin book — it's the blueprint for
// the agentic account, which the consumer renders as its own card (target vs. actual vs. drift).
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
    // ⚠️ A fresh main-account portfolio.json is required for this build to run at all (see top),
    // so if we're here the agent fetched the MAIN account but NOT the agentic ••••3900 account —
    // the agentic-* rows were skipped this run. That's an every-run fetch (light AND full), so a
    // skip means the card's share counts / cash are FROZEN (only prices re-drift below). Warn loudly
    // so a persistent skip is visible in run logs instead of silently masquerading as fresh (the
    // asOf below is re-stamped to now regardless). Fix = fetch agentic-portfolio/positions.json every run.
    console.warn('⚠️  agentic: NO fresh agentic-portfolio.json this run — carrying forward FROZEN holdings/cash from the prior snapshot (only re-pricing). The ••••3900 fetch rows were skipped; new trades/deposits will NOT show until they are fetched every run (see PRODUCER.md step 2, agentic-* rows).');
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
  // The mechanics (one point per UTC day, the deposit inference, the cumFlow running total) live in
  // equityseries.mjs so this account and the self-directed one below record IDENTICALLY — the two
  // YTD figures the consumer shows can then differ only in their inputs, never in their math.
  if (data.agentic && data.agentic.equity > 0) {
    const r = appendEquityPoint({
      prev: (prior && prior.agentic && prior.agentic.equityHistory) || [],
      day: new Date(data.generatedAt).toISOString().slice(0, 10),
      equity: data.agentic.equity, positions: data.agentic.positions,
      priorEquity: prior && prior.agentic ? prior.agentic.equity : null,
      priorPositions: prior && prior.agentic ? prior.agentic.positions : null,
    });
    data.agentic.equityHistory = r.history;
    if (r.flow) console.log(`agentic: inferred net external cash flow ${fmtMoney(r.flow)} (cumFlow ${fmtMoney(r.cumFlow)}) — excluded from performance`);
  } else if (data.agentic && prior && prior.agentic && Array.isArray(prior.agentic.equityHistory)) {
    data.agentic.equityHistory = prior.agentic.equityHistory.slice(-260);
  }
  // ── data.agentic.drawdown (v121) — the book-level circuit breaker, computed ONCE here ─────────
  // The consumer needs this to explain why the executor has stopped deploying, and the exec gate needs
  // it to decide. Computing it in the producer (rather than re-deriving it in index.html) means the card
  // and the planner can never disagree about what the drawdown IS — the same reasoning behind
  // acctPerfStats being shared. Deposit-adjusted and memoryless; see drawdown.mjs.
  if (data.agentic && Array.isArray(data.agentic.equityHistory)) {
    const dd = bookDrawdown(data.agentic.equityHistory);
    data.agentic.drawdown = { dd: dd.dd, level: dd.level, peakT: dd.peakT, points: dd.points, insufficient: dd.insufficient, note: dd.note };
    if (dd.level !== 'ok') console.warn(`agentic DRAWDOWN ${dd.level.toUpperCase()}: ${dd.note}`);
  }
  // ── Self-directed account (••••0741) real equity history = data.main ──────────────────────────
  // The Accounts tab's YTD tile used to show two DIFFERENT kinds of number on the two sides: the
  // agentic side reported the account's real, deposit-adjusted return, while the self-directed side
  // reported the benchmark card's MODELLED figure — today's holdings priced back to Jan 1 at current
  // weights. That isn't the account's year at all. It ignores every position opened or closed since
  // January, it ignores realized P&L, and (worst on this book) it is a holdings-price return, so it
  // is blind to leverage: the same 1.66× that made "Margin Used" understate risk in v116 makes a
  // modelled return understate the real swing by exactly the leverage factor.
  //
  // So this account now records forward exactly like the agentic one, through the same module.
  // EQUITY IS `total_value`, never `equity_value` (v116) — on a margin book those differ by the whole
  // loan. Robinhood publishes no account-equity history, so this CANNOT be backfilled; the consumer
  // says "since {date}" until a full year accrues, and falls back to the modelled figure (clearly
  // labelled) while fewer than two points exist.
  {
    const eqTotal = parseFloat(portfolio.total_value ?? '');
    const optVal = parseFloat(portfolio.options_value ?? '');
    const cashVal = parseFloat(portfolio.cash ?? '') || 0;
    const pxOf = (sym) => { const q = quotes[sym]; if (!q) return 0;
      return parseFloat(q.last_extended_hours_trade_price || q.last_trade_price || q.adjusted_previous_close || q.previous_close || 0) || 0; };
    const mainPos = (Array.isArray(positions) ? positions : []).map((p) => {
      const symbol = p.symbol || p.ticker;
      const qty = parseFloat(p.quantity ?? p.qty ?? 0) || 0;
      const avgCost = parseFloat(p.average_buy_price ?? p.average_cost ?? 0) || 0;
      const px = pxOf(symbol) || avgCost;
      return { symbol, qty, px };
    }).filter((p) => p.symbol && p.qty > 0);
    if (Number.isFinite(eqTotal) && eqTotal > 0) {
      const priorMain = (prior && prior.main) || null;
      const r = appendEquityPoint({
        prev: (priorMain && priorMain.equityHistory) || [],
        day: new Date(data.generatedAt).toISOString().slice(0, 10),
        equity: eqTotal, positions: mainPos,
        priorEquity: priorMain && typeof priorMain.equity === 'number' ? priorMain.equity : null,
        priorPositions: priorMain ? priorMain.positions : null,
        optionsValue: Number.isFinite(optVal) ? optVal : undefined,
        priorOptionsValue: priorMain && typeof priorMain.optionsValue === 'number' ? priorMain.optionsValue : undefined,
      });
      data.main = {
        asOf: data.generatedAt, equity: +eqTotal.toFixed(2), cash: +cashVal.toFixed(2),
        optionsValue: Number.isFinite(optVal) ? +optVal.toFixed(2) : null,
        // Kept only so the NEXT run can difference prices for the flow inference — not rendered.
        positions: mainPos, equityHistory: r.history,
      };
      if (r.flow) console.log(`main: inferred net external cash flow ${fmtMoney(r.flow)} (cumFlow ${fmtMoney(r.cumFlow)}) — excluded from performance`);
      console.log(`main: equity ${fmtMoney(eqTotal)} recorded · ${r.history.length} day${r.history.length === 1 ? '' : 's'} of history`);
    } else if (prior && prior.main) {
      data.main = { ...prior.main, asOf: data.generatedAt };
      console.warn('⚠️  main: portfolio.total_value missing/invalid — carrying the prior equity history forward unchanged.');
    }
  }

  // ── Idle-cash clock (v102) = data.agentic.cashIdleSince ────────────────────────────────────────
  // The deploy planner's idle deadline needs to know HOW LONG cash has been sitting, and raw/ is wiped
  // every run, so the clock can only live in the snapshot (the ivHistory/ledger pattern). Semantics:
  // the first UTC day deployable cash crossed the floor and has stayed above it since. Falling back
  // under the floor RESETS it — otherwise a deposit spent down to nothing would leave a stale start
  // date that instantly "expires" the next deposit and force-deploys it on arrival.
  if (data.agentic) {
    const IDLE_FLOOR = 200;
    const day = String(data.generatedAt || '').slice(0, 10);
    const cashNow = +(data.agentic.cash || 0);
    const prevSince = (prior && prior.agentic && prior.agentic.cashIdleSince) || null;
    data.agentic.cashIdleSince = cashNow >= IDLE_FLOOR ? (prevSince || day) : null;
    if (data.agentic.cashIdleSince && day) {
      const d = Math.round((Date.parse(day + 'T00:00:00Z') - Date.parse(data.agentic.cashIdleSince + 'T00:00:00Z')) / 86400000);
      data.agentic.cashIdleDays = Number.isFinite(d) ? Math.max(0, d) : null;
    } else data.agentic.cashIdleDays = 0;
    // Index-parking ledger. Sourced from the COMMITTED producer/agentic-parked.json, not carried
    // forward from the prior snapshot: the executor is forbidden from writing data.json, so the
    // snapshot can never be the system of record for state the executor mutates. Same precedence
    // pattern as the target/decision ledgers — committed file wins, prior snapshot is the fallback.
    try {
      const pk = JSON.parse(readFileSync(new URL('./agentic-parked.json', import.meta.url), 'utf8'));
      // The committed ledger is authoritative INCLUDING ZERO — a reclassified/emptied waiting ground
      // (dollars 0) must not resurrect the prior snapshot's stale parked block. Prior-snapshot
      // fallback applies only when the file itself is missing or unreadable.
      if (pk && Number.isFinite(+pk.dollars)) {
        if (+pk.dollars > 0) data.agentic.parked = { vehicle: pk.vehicle || 'VTI', dollars: +pk.dollars, forNames: pk.forNames || [], since: pk.since || null };
      } else if (prior && prior.agentic && prior.agentic.parked) data.agentic.parked = prior.agentic.parked;
    } catch { if (prior && prior.agentic && prior.agentic.parked) data.agentic.parked = prior.agentic.parked; }
  }
  // ── Wash-sale ledger (taxable accounts) = data.agentic.recentLosses [{sym,date,realized?,avgCost?,exitPx,account?}],
  // rolling 31 days. The consumer's Agentic card and the deploy planner read it to BLOCK + flag
  // rebuying any name inside the 30-day window.
  //
  // CROSS-ACCOUNT (v105): the ledger merges BOTH taxable accounts' realized losses — the agentic
  // ••••3900 book (producer/raw/agentic-trades.json) AND the self-directed margin book
  // (producer/raw/main-trades.json), each entry tagged `account`. The IRS wash-sale window is per
  // TAXPAYER: on 2026-07-29 the owner sold 35 NVDA at −$431.76 in the margin account, and on 2026-08-11
  // the agentic executor — whose ledger only read ••••3900's (empty) trade history — bought NVDA back
  // inside the window, partially disallowing the loss. IRA losses aren't deductible, so only these two
  // accounts feed the ledger.
  //
  // PREFERRED SOURCE (v98): REAL closing trades per account — get_pnl_trade_history responses, each
  // account's portion rebuilt wholesale when its file is present, carried forward (and expired) when not.
  //
  // FALLBACK (agentic portion only): the original inference — diff prior→fresh positions and call a
  // holding "reduced while underwater" a realized loss, dated today. Kept for the Railway producer
  // (robin_stocks has no per-trade realized feed), but it is DEMONSTRABLY unsound and must never win
  // over real trades: any run whose agentic fetch returned the wrong account's positions makes the next
  // CORRECT fetch look like a mass liquidation. That is not hypothetical — it booked five losses on
  // 2026-08-03 (LLY/NVDA/TSM/CIFR/IREN) for an account that had no closing trades that week and had
  // never held three of those names, and NVDA was then wash-sale blocked out of a real buy for 30 days
  // off it. Hence: when real trades are available they REPLACE that portion (including stale inferred
  // entries). There is NO inference for the margin book — its positions aren't even fetched per-lot.
  if (data.agentic) {
    const day = new Date(data.generatedAt).toISOString().slice(0, 10);
    const cutoff = (() => { const d = new Date(day + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - 31); return d.toISOString().slice(0, 10); })();
    const priorLedger = ((prior && prior.agentic && prior.agentic.recentLosses) || []).filter((e) => e && e.date && e.date >= cutoff);
    // Legacy entries predate the account tag and were always agentic-sourced.
    const priorOf = (acct) => priorLedger.filter((e) => (e.account || 'agentic') === acct);

    // Agentic portion — trades file wins; else carry forward; else (Railway, never-trades ledgers) infer.
    let agLosses, agReal;
    const tradesFile = filesMatching(/^agentic-trades\.json$/)[0];
    if (tradesFile) {
      agLosses = lossesFromTrades(readJSON(tradesFile), { asOf: data.generatedAt, days: 31, account: 'agentic' });
      agReal = true;
      const dropped = priorOf('agentic').filter((e) => !agLosses.some((r) => r.sym === e.sym && r.date === e.date));
      if (dropped.length) console.log(`agentic wash-sale ledger: dropped ${dropped.length} INFERRED entr(ies) with no matching closing trade — ${dropped.map((e) => e.sym + '@' + e.date).join(' ')}`);
      console.log(`agentic wash-sale ledger: ${agLosses.length} real realized loss(es) in the last 31d${agLosses.length ? ' — ' + agLosses.map((e) => e.sym).join(' ') : ''} (broker trade history)`);
    } else {
      agLosses = priorOf('agentic');
      // Never mix sources: once a run has built the ledger from real closing trades, a later run that
      // merely lacks the trade file carries it forward and expires it — it does NOT layer inferences
      // back on top (that mixing is precisely what produced the phantom 2026-08-03 entries).
      agReal = !!(prior && prior.agentic && prior.agentic.lossSource === 'trades');
      if (!agReal && apFile && prior && prior.agentic && Array.isArray(prior.agentic.positions)) {
        const nowQty = Object.fromEntries((data.agentic.positions || []).map((p) => [p.symbol, p.qty || 0]));
        for (const pp of prior.agentic.positions) {
          if (!pp || !pp.symbol || !(pp.qty > 0)) continue;
          const underwater = pp.px != null && pp.avgCost != null && pp.px < pp.avgCost;
          const reduced = (nowQty[pp.symbol] || 0) < pp.qty - 1e-6;   // fully exited or partially trimmed
          if (underwater && reduced && !agLosses.some((e) => e.sym === pp.symbol && e.date === day))
            agLosses.push({ sym: pp.symbol, date: day, avgCost: pp.avgCost, exitPx: pp.px, account: 'agentic' });
        }
      }
      if (agLosses.length) console.log(`agentic wash-sale ledger: ${agLosses.length} ${agReal ? 'carried real' : 'INFERRED'} agentic loss(es) — ${agLosses.map((e) => e.sym).join(' ')} (no agentic-trades.json this run)`);
    }

    // Margin-book portion — trades file wins, else carry forward. No inference fallback, ever.
    let mainLosses;
    const mainTradesFile = filesMatching(/^main-trades\.json$/)[0];
    if (mainTradesFile) {
      mainLosses = lossesFromTrades(readJSON(mainTradesFile), { asOf: data.generatedAt, days: 31, account: 'main' });
      console.log(`cross-account wash ledger: ${mainLosses.length} margin-book realized loss(es) in the last 31d${mainLosses.length ? ' — ' + mainLosses.map((e) => e.sym).join(' ') : ''}`);
    } else {
      mainLosses = priorOf('main');
      if (mainLosses.length) console.log(`cross-account wash ledger: carried ${mainLosses.length} margin-book loss(es) forward — ${mainLosses.map((e) => e.sym).join(' ')} (no main-trades.json this run)`);
      else console.warn('cross-account wash ledger: no main-trades.json and nothing carried — margin-book losses are NOT guarding agentic buys this run');
    }

    // Most-recent-first; cap keeps the NEWEST entries (an old entry is days from expiring anyway).
    data.agentic.recentLosses = [...agLosses, ...mainLosses]
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)).slice(0, 60);
    data.agentic.lossSource = agReal ? 'trades' : 'inferred';   // describes the AGENTIC portion (main is always trades or carried-trades)
  }
  if (agenticTarget) {
    if (!data.agentic) data.agentic = { asOf: data.generatedAt, cash: 0, buyingPower: 0, equity: 0, positions: [] };
    data.agentic.target = agenticTarget;
    console.log(`agentic target: ${(agenticTarget.names || []).length} names (asOf ${agenticTarget.asOf})`);
  }
  // ── In-flight rebalance ticket (v96). producer/agentic-pending.json is the COMMITTED two-leg,
  // the ticket the executor drives (see agentic-pending.mjs for the state machine). Attach it
  // whenever it's live so the Agentic card can show "rebalance in flight" instead of a stale drift
  // table; done/aborted tickets are omitted (the card has nothing to say about finished ones).
  if (data.agentic) {
    try {
      const pf = join(__dirname, 'agentic-pending.json');
      if (existsSync(pf)) {
        const ticket = readJSON(pf);
        if (ticket && ticket.status && !['done', 'aborted'].includes(ticket.status)) {
          data.agentic.pending = ticket;
          console.log(`agentic pending ticket: ${ticket.id} · ${ticket.status} · turnover ${fmtMoney(ticket.turnover || 0)}`);
        }
      }
    } catch { /* unreadable ticket never breaks a build */ }
  }
  // ── Rebalance decision ledger (data.agentic.decisions). The committed producer/agentic-decisions.json is
  // the owner-confirmed log of each deploy/rebalance; grade every entry against THIS run's live quotes (+ vs
  // SPY when spyAt was recorded) so the consumer's "Rebalance Log" card can show whether each call worked.
  // Carry-forward like target when the file is absent (it's committed, so normally present).
  if (data.agentic) {
    let decisions = null;
    try { const df = join(__dirname, 'agentic-decisions.json'); if (existsSync(df)) decisions = readJSON(df); } catch { decisions = null; }
    const asOfDay = new Date(data.generatedAt).toISOString().slice(0, 10);
    if (decisions && Array.isArray(decisions.decisions) && decisions.decisions.length) {
      const graded = gradeDecisions(decisions.decisions, quotes, asOfDay);
      data.agentic.decisions = graded;
      console.log(`agentic decisions: ${graded.stats.total} logged · ${graded.stats.resolved} resolved (${graded.stats.ahead} ahead)${graded.stats.avgAlpha != null ? ` · avg alpha ${graded.stats.avgAlpha}%` : ''}`);
      // Sleeve attribution (v121) — which research sleeve is actually earning its keep. Thin sleeves are
      // labelled rather than hidden, so a small-n figure is never mistaken for a finding.
      const sv = Object.entries(graded.sleeves || {}).sort((a, b) => (b[1].alphaPct ?? -99) - (a[1].alphaPct ?? -99));
      if (sv.length) console.log(`agentic sleeves: ${sv.map(([k, v]) => `${k} ${v.alphaPct != null ? `${v.alphaPct > 0 ? '+' : ''}${v.alphaPct}pp α` : 'n/a'} (n=${v.n}${v.thin ? ', thin' : ''})`).join(' · ')}`);
    } else if (prior && prior.agentic && prior.agentic.decisions) {
      data.agentic.decisions = prior.agentic.decisions;
    }
  }
}
// Flow & Positioning signals (producer/raw/flow/<SYM>.json, written by flow-fetch.mjs — analyst revision
// momentum, insider Form 4 clusters, earnings-surprise drift; each already scored by flow.mjs). Merged
// PER SYMBOL over the prior snapshot, exactly like quotes: flow-fetch runs once/day and covers the held
// book, so on light runs (and for any name whose providers were briefly unusable) the prior read carries
// forward rather than the name dropping out of the card. DISPLAY-ONLY — nothing here touches
// agentic-target.json until the sleeve weight is switched on (PROPOSAL-flow-signals.md Phase 4).
{
  // ── Provider fetch-day stamps (data.fetchDays) ────────────────────────────────────────────────
  // The once/day gates in av-fetch.mjs / extfund-fetch.mjs USED to key off a `.fetched` marker inside
  // producer/raw/ — which is gitignored and empty on every scheduled run, so the gate never tripped and
  // both re-spent their full call budget on all ~13 runs of the day. Any once/day gating has to derive
  // from the COMMITTED snapshot (the standing rule in CLAUDE.md), so this records the ET day each
  // provider last actually landed data, and CARRIES IT FORWARD on runs where it didn't run — otherwise
  // the very act of skipping would clear the stamp and trigger a re-fetch on the next run.
  // (The flow layer keys off `data.flow.asOf`, which is part of the payload the card renders anyway.)
  {
    const day = new Date(data.generatedAt).toISOString().slice(0, 10);
    const priorDays = (prior && prior.fetchDays) || {};
    const fetchDays = { ...priorDays };
    if (avCount > 0) fetchDays.av = day;
    if (extCount > 0) fetchDays.extfund = day;
    if (Object.keys(fetchDays).length) data.fetchDays = fetchDays;
  }

  // ── data.vix (v121) — the regime input for deployment pacing ──────────────────────────────────
  // VIX is already recorded (the Markets tab's Macro Signals read it straight out of `recorded`), but
  // only the CONSUMER could parse it, so the producer-side deploy planner had no way to see the tape.
  // Surfacing it as a small top-level block lets agentic-deploy pace deployment by regime without the
  // exec gate having to re-implement the AV response parsing. ADDITIVE — nothing keys on it, so the
  // replay contract and validate.mjs are untouched. Carried forward like every other block, and simply
  // absent when unparseable, which the planner treats as 'calm' (fails open to today's behaviour).
  {
    const parseAVLite = (v) => {           // mirrors index.html's parseAV coalescing order
      if (!v) return null;
      if (v.structuredContent) return v.structuredContent;
      if (Array.isArray(v.content) && v.content[0] && v.content[0].text) { try { return JSON.parse(v.content[0].text); } catch { return null; } }
      if (typeof v.result === 'string') { try { return JSON.parse(v.result); } catch { return null; } }
      return v;
    };
    let vix = null;
    try {
      const d = parseAVLite(recorded[avKey('INDEX_DATA', { symbol: 'VIX', interval: 'daily' })]);
      const arr = d && (d.data || (Array.isArray(d) ? d : null));
      if (Array.isArray(arr) && arr.length) {
        const v = parseFloat(arr[0].close ?? arr[0].Close ?? arr[0]['4. close'] ?? 0);
        if (Number.isFinite(v) && v > 0) vix = { v: +v.toFixed(2), asOf: arr[0].date || arr[0].Date || new Date(data.generatedAt).toISOString().slice(0, 10) };
      }
    } catch { /* unparseable → carry forward / absent */ }
    const carried = prior && prior.vix;
    if (vix) data.vix = vix;
    else if (carried) data.vix = carried;
  }

  const flowDir = join(RAWDIR, 'flow');
  const flowDay = new Date(data.generatedAt).toISOString().slice(0, 10);
  const symbols = (prior && prior.flow && prior.flow.symbols) ? { ...prior.flow.symbols } : {};
  let fresh = 0;
  if (existsSync(flowDir)) {
    for (const f of readdirSync(flowDir).filter((x) => x.endsWith('.json') && !x.startsWith('_') && !x.startsWith('.'))) {
      try {
        const read = readJSON(join(flowDir, f));
        if (read && read.sym) { symbols[read.sym] = read; fresh++; }
      } catch { /* a corrupt sidecar keeps the carried-forward read */ }
    }
  }
  // Congressional disclosure ledger. The FMP tier serves only the ~50 newest rows market-wide per poll
  // and raw/ is wiped every scheduled run, so the ledger has to ACCUMULATE in the snapshot — this is the
  // ivHistory/equityHistory pattern, not a re-derivable projection. mergeEvents de-duplicates, so the
  // same trade re-served by tomorrow's rolling window can't inflate a cluster.
  let polEvents = (prior && prior.flow && Array.isArray(prior.flow.polEvents)) ? prior.flow.polEvents : [];
  let polClusters = (prior && prior.flow && prior.flow.polClusters) || {};
  const polFile = join(flowDir, '_polflow.json');
  if (existsSync(polFile)) {
    try {
      const freshPol = (readJSON(polFile) || {}).events || [];
      const before = polEvents.length;
      polEvents = mergeEvents(polEvents, freshPol, { asOf: flowDay });
      polClusters = detectClusters(polEvents, { asOf: flowDay });
      const added = polEvents.length - before;
      console.log(`congressional ledger: ${polEvents.length} events (+${added > 0 ? added : 0} new of ${freshPol.length} polled) · ${Object.keys(polClusters).length} cluster(s) — zero score weight by design`);
    } catch { /* a corrupt sidecar keeps the accumulated ledger */ }
  } else if (polEvents.length) {
    polEvents = mergeEvents(polEvents, [], { asOf: flowDay });   // still age out stale events
    polClusters = detectClusters(polEvents, { asOf: flowDay });
  }

  if (Object.keys(symbols).length || polEvents.length) {
    data.flow = { asOf: fresh ? flowDay : ((prior && prior.flow && prior.flow.asOf) || flowDay), symbols };
    if (polEvents.length) { data.flow.polEvents = polEvents; data.flow.polClusters = polClusters; }
    const scored = Object.values(symbols).filter((s) => s && s.flow).length;
    const clusters = Object.values(symbols).filter((s) => s && s.insider && s.insider.cluster).length;
    console.log(`flow signals: ${Object.keys(symbols).length} symbols (${fresh} fresh this run) · ${scored} with a composite · ${clusters} insider cluster(s)`);
    if (Object.keys(symbols).length && !fresh) console.warn('flow signals: none fetched this run — carrying the prior read forward');
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

// Realized P&L for the Income & Tax widget — PER ACCOUNT (v98).
//
// This used to be a single owner-maintained figure typed in from Robinhood's tax center
// (producer/realized.json), which meant it (a) froze at whatever was last typed, since it is carried
// forward on every run, and (b) described the MARGIN book only — the agentic ••••3900 account's
// realized gains appeared nowhere in the dashboard. The connector's get_realized_pnl endpoint gives
// the real numbers per account per asset class, so the producer now fetches them (PRODUCER.md step 2,
// realized-* rows) and this assembles data.realized:
//
//   { year, asOf, source:'robinhood', approx:false, accounts:{ main:{…}, agentic:{…} },
//     equity, options, total, premiumYTD }
//
// Top-level equity/options/total are ALL-ACCOUNT sums (so an older cached consumer that only knows
// the flat shape shows a correct combined figure rather than a margin-only one); `accounts` carries
// the per-account split the Income & Tax card renders.
//
// PRECEDENCE: fresh broker fetch → committed producer/realized.json (owner override / the fallback
// for the Railway producer, whose robin_stocks path has no realized endpoint) → prior snapshot.
{
  const rawPnl = (name) => { const f = filesMatching(new RegExp(`^${name}\\.json$`))[0]; return f ? readJSON(f) : null; };
  const mainEq = rawPnl('realized-main'), mainOpt = rawPnl('realized-main-opt');
  const agEq = rawPnl('realized-agentic'), agOpt = rawPnl('realized-agentic-opt');
  const year = String(new Date(data.generatedAt).getUTCFullYear()) + ' YTD';
  if (mainEq || agEq) {
    const accounts = {};
    if (mainEq || mainOpt) accounts.main = accountRealized({ equity: mainEq, options: mainOpt, label: 'Individual margin', mask: '••••0741' });
    if (agEq || agOpt) accounts.agentic = accountRealized({ equity: agEq, options: agOpt, label: 'Agentic', mask: '••••3900' });
    data.realized = buildRealized({ accounts, year, asOf: data.generatedAt });
    console.log(`realized: ${Object.entries(accounts).map(([k, a]) => `${k} ${fmtMoney(a.total)}`).join(' · ')} → total ${fmtMoney(data.realized.total)} (broker-reported)`);
  } else {
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
  }
}
// Options realized + premium-collected (YTD) come from options.json fresh every run (cheap). The
// PREMIUM figure is always worth carrying (it's the cash banked selling calls/puts, which the tile
// shows separately), but the realized OVERRIDE only applies to owner/carry-forward sourced figures —
// a broker-reported block already has the real per-account options realized and must not be
// clobbered by the options-book estimate, which would desync accounts.* from the totals.
if (data.options && (data.options.realizedYTD != null || data.options.premiumYTD != null)) {
  data.realized = data.realized || { approx: true };
  if (data.options.premiumYTD != null) data.realized.premiumYTD = data.options.premiumYTD;
  if (data.realized.source !== 'robinhood' && data.options.realizedYTD != null) {
    data.realized.options = data.options.realizedYTD;
    data.realized.total = (data.realized.equity || 0) + (data.realized.options || 0);
  }
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
// AV news sentiment. Surfaced on Analyze ("Social Pulse") + Markets ("Retail Buzz"). NOTE: this
// block is the DISPLAY layer only — the Picks composite DOES fold a social/buzz score in at 20%
// (picks.mjs, from its own fetchSocial call in picks-build.mjs). Absent → the cards just hide.
{
  const heldSyms = (positions || []).map((p) => p.symbol).filter(Boolean);
  const pickSyms = (data.picks && Array.isArray(data.picks.candidates))
    ? data.picks.candidates.map((c) => c.ticker).filter(Boolean) : [];
  const wantSet = [...new Set([...heldSyms, ...pickSyms].map((s) => String(s).toUpperCase()))];

  // Reuse the raw pages picks-build already fetched this run (FETCH_ALL sidecar) — one ApeWisdom
  // trip per run, and picks + data.social see identical data. Light runs (no sidecar) fetch live.
  let social = null, socialSrc = 'fresh fetch';
  try {
    const pagesFile = filesMatching(/^social-pages\.json$/)[0];
    const pages = pagesFile ? unwrap(readJSON(pagesFile)) : await fetchSocialPages();
    if (pagesFile) socialSrc = 'reused picks-build fetch';
    social = shapeSocial(pages, wantSet);
  } catch { social = null; }
  console.log(social
    ? `social: ApeWisdom ${social.universe} tracked (${socialSrc}) · ${Object.values(social.tickers).filter((t) => t.tracked).length}/${wantSet.length} of your names trending`
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

// --- Alerts: level crossings since the prior snapshot (alerts.mjs — pure transition detection,
// no sent-state to persist). Written to a raw sidecar; the AGENT delivers post-publish via
// PushNotification (best-effort, like the watchlist syncs — see PRODUCER.md step 8). The Railway
// entrypoint just logs them (no push channel there).
try {
  const heldSyms = [...new Set([
    ...(positions || []).map((p) => p.symbol),
    ...((data.agentic && data.agentic.positions) || []).map((p) => p.symbol),
  ])].filter(Boolean);
  const alerts = computeAlerts(prior, data, heldSyms);
  writeFileSync(join(RAWDIR, 'alerts.json'), JSON.stringify({ asOf: data.generatedAt, alerts }, null, 2));
  if (alerts.length) {
    console.log(`[alerts] ${alerts.length} crossing${alerts.length === 1 ? '' : 's'} since the prior snapshot:`);
    for (const a of alerts) console.log('[alerts]   ' + a.msg);
  } else console.log('[alerts] none');
} catch (e) { console.warn('[alerts] skipped:', e && e.message); }

// --- Agentic event triggers (agentic-triggers.mjs — pure): idle/new cash ready to deploy, and whether a
// deposit or a big held-name gap should force an EARLY research refresh this run (vs waiting out the weekly
// gate). Written to a raw sidecar; the AGENT reads it post-publish (PRODUCER.md step 7) — PushNotifies any
// 'deploy-cash' trigger and runs the research workflow when refreshResearch is set. Best-effort like alerts.
try {
  const trig = computeAgenticTriggers(prior, data);
  writeFileSync(join(RAWDIR, 'agentic-triggers.json'), JSON.stringify({ asOf: data.generatedAt, ...trig }, null, 2));
  if (trig.triggers.length || trig.refreshResearch) {
    for (const t of trig.triggers) console.log('[agentic-trigger]   ' + t.msg);
    if (trig.refreshResearch) console.log('[agentic-trigger]   ↻ refresh research early: ' + trig.refreshReasons.join(' · '));
  } else console.log('[agentic-trigger] none');
} catch (e) { console.warn('[agentic-trigger] skipped:', e && e.message); }

await emit(data);
console.log('built:',
  positions.length, 'positions ·', Object.keys(quotes).length, 'quotes ·',
  Object.entries(hist).map(([k, v]) => Object.keys(v).length + ' ' + k).join(' · ') || 'no hist',
  '·', Object.keys(recorded).length, 'recorded ·', avCount, 'AV ·', rhOvCount, 'RH-overview',
  '·', vix != null ? 'VIX ' + vix : 'no VIX',
  '·', data.picks && Array.isArray(data.picks.candidates) ? data.picks.candidates.length + ' picks' : 'no picks',
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
