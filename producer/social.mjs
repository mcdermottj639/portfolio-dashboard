// Retail social-sentiment signal from ApeWisdom (free, KEYLESS Reddit/social mention tracker).
//   https://apewisdom.io/api/  — aggregates mentions / upvotes / sentiment across r/wallstreetbets,
//   r/stocks, r/investing, r/options, StockTwits, etc.
//
// Fetched in-process with Node's global fetch on every build (cheap, no MCP, no agent tool call,
// so it stays fully hands-off). Degrades to `null` if the host is unreachable — e.g. apewisdom.io
// is not in the environment's network egress allowlist — so a blocked host never fails the build.
//
// No API key is required for the public endpoint. If ApeWisdom ever rate-limits the shared pool,
// set PF_APEWISDOM_KEY and it's appended as ?api_key=… (harmless if the endpoint ignores it).

const AW_BASE = 'https://apewisdom.io/api/v1.0/filter';
const TIMEOUT_MS = 9000;
const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };
// % change in mentions vs 24h ago (retail-attention velocity).
function pctChg(now, prev) {
  const a = num(now), b = num(prev);
  if (a == null || b == null || b <= 0) return null;
  return +(((a - b) / b) * 100).toFixed(0);
}

async function awPage(filter, page) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const key = process.env.PF_APEWISDOM_KEY;
    const url = `${AW_BASE}/${filter}/page/${page}` + (key ? `?api_key=${encodeURIComponent(key)}` : '');
    const r = await fetch(url, {
      signal: ctrl.signal,
      headers: { Accept: 'application/json', 'User-Agent': 'portfolio-dashboard/1.0' },
    });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; } finally { clearTimeout(timer); }
}

// One ApeWisdom row → our compact shape. ApeWisdom returns sentiment as a 0..1 ratio on some
// endpoints; normalize it to a −1..+1 score so it lines up with our AV news score.
function shapeRow(r) {
  let sentScore = null;
  if (r.sentiment != null && Number.isFinite(parseFloat(r.sentiment))) {
    const s = parseFloat(r.sentiment);
    sentScore = +(s > 1 ? (s / 100) * 2 - 1 : s <= 1 && s >= 0 ? s * 2 - 1 : s).toFixed(2);
  }
  return {
    rank: num(r.rank),
    rank24h: num(r.rank_24h_ago),
    mentions: num(r.mentions),
    mentions24h: num(r.mentions_24h_ago),
    mentionChg: pctChg(r.mentions, r.mentions_24h_ago),
    upvotes: num(r.upvotes),
    sentiment: sentScore,
  };
}

// Fetch retail buzz for the requested tickers + an overall trending list.
//   symbols: array of tickers to look up (held + picks).
// Returns { asOf, source, universe, tickers:{SYM:{tracked,...}}, trending:[...] } or null.
export async function fetchSocial(symbols = [], { pages = 2 } = {}) {
  const want = new Set(symbols.map((s) => String(s).toUpperCase()).filter(Boolean));
  const byTicker = {};
  let pagesGot = 0;
  for (let p = 1; p <= pages; p++) {
    const d = await awPage('all-stocks', p);
    if (!d || !Array.isArray(d.results)) break;
    pagesGot++;
    for (const r of d.results) {
      const t = (r.ticker || '').toUpperCase();
      if (t && !byTicker[t]) byTicker[t] = r;
    }
    if (d.pages && p >= d.pages) break;
  }
  if (!pagesGot) return null; // host unreachable / blocked — caller leaves data.social unset

  const all = Object.values(byTicker).sort((a, b) => (num(a.rank) ?? 999) - (num(b.rank) ?? 999));
  const trending = all.slice(0, 8).map((r) => ({
    t: (r.ticker || '').toUpperCase(),
    name: r.name || null,
    mentions: num(r.mentions),
    chg: pctChg(r.mentions, r.mentions_24h_ago),
    rank: num(r.rank),
  }));

  const tickers = {};
  for (const sym of want) {
    const r = byTicker[sym];
    tickers[sym] = r ? { tracked: true, ...shapeRow(r) } : { tracked: false };
  }
  return { asOf: new Date().toISOString(), source: 'apewisdom', universe: all.length, tickers, trending };
}
