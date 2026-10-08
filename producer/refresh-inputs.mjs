import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { mergeBars } from './histbars.mjs';
export function unwrap(raw) {
  for (let i = 0; i < 8; i++) {
    if (raw?.isError) throw new Error('Broker input contains an error.');
    if (raw?.structuredContent) raw = raw.structuredContent;
    else if (raw?.content?.[0]?.text) raw = JSON.parse(raw.content[0].text);
    else if (raw?.data) raw = raw.data;
    else return raw;
  }
  throw new Error('Unrecognized broker envelope.');
}
export function loadInputs(dir, prior = {}) {
  const files = existsSync(dir) ? readdirSync(dir).filter(f => f.endsWith('.json')).sort() : [];
  const read = f => unwrap(JSON.parse(readFileSync(join(dir, f), 'utf8')));
  const rows = r => Array.isArray(r) ? r : r?.results || [];
  const quotes = {}, funds = {}, bars = { ...prior?.hist?.day };
  for (const file of files) {
    if (/^quotes.*\.json$/.test(file)) for (const r of rows(read(file))) {
      const q = r.quote || r; if (q.symbol) quotes[q.symbol] = q;
    }
    if (/^(picks-screen-fund|holdings-fund)(-\d+)?\.json$/.test(file))
      for (const r of rows(read(file))) if (r.symbol) funds[r.symbol] = r;
    if (/^hist-day.*\.json$/.test(file)) for (const r of rows(read(file)))
      if (r.symbol && Array.isArray(r.bars)) bars[r.symbol] = mergeBars(bars[r.symbol], r.bars);
  }
  const positions = ['positions.json', 'agentic-positions.json'].flatMap(f => {
    if (!files.includes(f)) return [];
    const p = read(f); return Array.isArray(p) ? p : p.positions || [];
  });
  return { quotes, funds, bars, positions, files };
}
export function topHoldings({ positions, quotes }, n = 14) {
  const values = new Map();
  for (const p of positions) {
    const sym = p.symbol, q = quotes[sym];
    const price = Number(q?.last_trade_price ?? q?.previous_close);
    const value = Number(p.quantity) * price;
    if (sym && value > 0) values.set(sym, (values.get(sym) || 0) + value);
  }
  return [...values].sort((a,b) => b[1]-a[1]).slice(0,n).map(([s]) => s);
}
