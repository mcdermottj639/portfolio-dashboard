// Suggested prediction markets for the Predict tab. Honest by design: prediction-market prices
// already encode the crowd's probability, so we don't claim an edge — we surface *notable* live
// Kalshi markets (most-active, closing-soon, coin-flips, longshots) for discovery.
//
// CLI: reads a raw Kalshi GetMarkets response (markets array) from producer/raw/kalshi-all.json
// and writes the scored shortlist to producer/raw/predict-picks.json (build-data embeds it as
// data.predictPicks). The producer fetches the raw markets with curl — see PRODUCER.md 3d.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };

// markets: array of Kalshi market objects. now: ms epoch. Returns up to `cap` shortlisted picks.
export function selectPredictPicks(markets, now = Date.now(), cap = 8) {
  const norm = [];
  for (const m of (markets || [])) {
    const tk = m.ticker || m.market_ticker; if (!tk) continue;
    const status = String(m.status || '').toLowerCase();
    if (status && status !== 'open' && status !== 'active') continue;
    const yb = num(m.yes_bid), ya = num(m.yes_ask), lp = num(m.last_price);
    let yes = lp != null ? lp : (yb != null && ya != null ? (yb + ya) / 2 : (yb != null ? yb : null));
    if (yes == null || yes <= 0 || yes >= 100) continue;             // skip resolved/degenerate
    const close = m.close_time ? new Date(m.close_time).getTime() : null;
    if (close == null || isNaN(close) || close < now) continue;       // must be open & future-dated
    const days = Math.round((close - now) / 86400000);
    const volume = num(m.volume_24h) ?? num(m.volume) ?? 0;
    norm.push({ ticker: String(tk).toUpperCase(), title: m.title || m.yes_sub_title || m.subtitle || tk,
      category: m.category || m.series_ticker || null, yes: +(+yes).toFixed(1), volume, days, close: m.close_time });
  }
  if (!norm.length) return [];

  const out = [], seen = new Set();
  const push = (x, tag, reason) => { if (out.length >= cap || seen.has(x.ticker)) return; seen.add(x.ticker); out.push({ ...x, tag, reason }); };
  const byVol = (a, b) => b.volume - a.volume;

  // 🔥 Most active (liquidity = tradeable)
  for (const x of [...norm].sort(byVol).slice(0, 3)) push(x, '🔥 Active', x.volume ? `${x.volume.toLocaleString()} contracts traded` : 'High activity');
  // ⏳ Closes soon (time-sensitive, decent volume)
  for (const x of norm.filter((x) => x.days <= 3 && x.volume > 0).sort(byVol).slice(0, 2)) push(x, '⏳ Closes soon', `Resolves in ${x.days <= 0 ? '<1' : x.days}d`);
  // 🪙 Coin-flip (max uncertainty — 45–55¢)
  for (const x of norm.filter((x) => x.yes >= 45 && x.yes <= 55).sort(byVol).slice(0, 2)) push(x, '🪙 Coin-flip', `${x.yes}¢ — near 50/50, biggest payoff swing`);
  // 🎯 Longshot (cheap YES = large payoff if it hits)
  for (const x of norm.filter((x) => x.yes <= 15).sort(byVol).slice(0, 1)) push(x, '🎯 Longshot', `${x.yes}¢ — ~${Math.round(100 / x.yes)}x if it resolves YES`);

  return out.slice(0, cap);
}

// CLI
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const inFile = join(__dirname, 'raw', 'kalshi-all.json');
  const outFile = join(__dirname, 'raw', 'predict-picks.json');
  if (!existsSync(inFile)) { console.error('no raw/kalshi-all.json — skip (fetch Kalshi markets first, see PRODUCER.md 3d)'); process.exit(0); }
  let raw = JSON.parse(readFileSync(inFile, 'utf8'));
  if (raw && raw.structuredContent) raw = raw.structuredContent;
  const markets = Array.isArray(raw) ? raw : (raw.markets ?? raw.data?.markets ?? []);
  const picks = selectPredictPicks(markets);
  writeFileSync(outFile, JSON.stringify(picks, null, 2));
  console.log(`predict-picks: ${picks.length} suggested from ${markets.length} markets →`, picks.map((p) => p.ticker).join(', ') || '(none)');
}
