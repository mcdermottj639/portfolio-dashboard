// Validates that data.json resolves through the dashboard's real parse/compute path.
// Mirrors the relevant functions from index.html. Run: node producer/validate.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { makeKey, RH } from './key.mjs';
import { decryptEnvelope } from './emit.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
let data = JSON.parse(readFileSync(join(__dirname, '..', 'data.json'), 'utf8'));
if (data && data.enc) {
  const pass = process.env.PF_PASSPHRASE;
  if (!pass) { console.error('data.json is encrypted — set PF_PASSPHRASE to validate it.'); process.exit(1); }
  data = await decryptEnvelope(data, pass);
  console.log('(decrypted encrypted data.json for validation)\n');
}
const rec = data.recorded;
// Mirror the PWA shim: quotes/historicals assemble per-symbol; everything else is exact-key.
const call = (server, args) => {
  args = args || {};
  if (/get_equity_quotes$/.test(server)) {
    const qs = data.quotes || {};
    return { structuredContent: { results: (args.symbols || []).filter((s) => qs[s]).map((s) => ({ symbol: s, ...qs[s] })) } };
  }
  if (/get_equity_historicals$/.test(server)) {
    const hh = (data.hist || {})[args.interval || 'day'] || {};
    return { structuredContent: { results: (args.symbols || []).filter((s) => hh[s]).map((s) => ({ symbol: s, bars: hh[s] })) } };
  }
  const k = makeKey(server, args);
  if (!(k in rec)) throw new Error('MISSING KEY: ' + k);
  return rec[k];
};

// --- functions copied from index.html ---
const parse = (r) => { if (!r || r.isError) return null; try { if (r.structuredContent) return r.structuredContent; if (r.content?.[0]?.text) return JSON.parse(r.content[0].text); } catch (e) {} return null; };
function buildQMap(raw) {
  const map = {}; if (!raw) return map;
  const addQ = (sym, q) => { if (!sym || !q) return; const price = parseFloat(q.last_extended_hours_trade_price || q.last_trade_price || q.ask_price || q.mark_price || q.price || 0) || 0; const prev = parseFloat(q.adjusted_previous_close || q.previous_close || 0) || 0; if (price > 0 || prev > 0) map[sym] = { price, prev }; };
  const d = raw.data ?? raw;
  const resArr = Array.isArray(d?.results) ? d.results : null;
  if (resArr) { for (const item of resArr) { const q = item.quote ?? item; const sym = q?.symbol; if (sym) addQ(sym, q); } }
  return map;
}
const risk = () => ({});
function enrich(positions, qMap, totalVal) {
  return positions.map((p) => { const q = qMap[p.symbol] || {}; const qty = parseFloat(p.quantity || 0), avg = parseFloat(p.average_buy_price || 0); const px = q.price || 0, val = px * qty, cost = avg * qty, pnlD = val - cost; const pnlP = cost > 0 ? (pnlD / cost) * 100 : 0; const dayD = q.prev > 0 ? (px - q.prev) * qty : 0; const pct = totalVal > 0 ? (val / totalVal) * 100 : 0; return { ...p, qty, avg, px, val, cost, pnlD, pnlP, dayD, pct }; });
}

// --- replay the load() sequence ---
const port = parse(call(RH + 'get_portfolio', { account_number: 'ACCT' }))?.data;
const positions = parse(call(RH + 'get_equity_positions', { account_number: 'ACCT' }))?.data?.positions;
const allSyms = [...new Set(positions.map((p) => p.symbol))];
const qMap = buildQMap(parse(call(RH + 'get_equity_quotes', { symbols: allSyms })));
const totalVal = parseFloat(port.total_value);
const enriched = enrich(positions, qMap, totalVal);
const hist = parse(call(RH + 'get_equity_historicals', { symbols: [...allSyms, 'SPY', 'QQQ'], interval: 'day' }))?.results;

console.log('✓ portfolio total_value :', '$' + totalVal.toLocaleString());
console.log('✓ positions parsed      :', positions.length);
console.log('✓ quotes mapped         :', Object.keys(qMap).length, 'of', allSyms.length);
console.log('✓ historicals symbols   :', hist.map((h) => h.symbol).join(', '), '(' + hist[0].bars.length + ' bars each)');
console.log('\nPer-position P&L:');
for (const p of enriched) console.log('  ' + p.symbol.padEnd(5), 'val $' + Math.round(p.val).toLocaleString().padStart(8), ' P&L ' + (p.pnlP >= 0 ? '+' : '') + p.pnlP.toFixed(0) + '%');
const totalPnL = enriched.reduce((s, p) => s + p.pnlD, 0), dayPnL = enriched.reduce((s, p) => s + p.dayD, 0);
console.log('\n✓ total P&L: ' + (totalPnL >= 0 ? '+$' : '-$') + Math.abs(Math.round(totalPnL)).toLocaleString() + '  ·  day P&L: ' + (dayPnL >= 0 ? '+$' : '-$') + Math.abs(Math.round(dayPnL)).toLocaleString());
console.log('\nAll keys resolved — replay contract is valid. ✅');
