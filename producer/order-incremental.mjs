// Explicit, non-destructive recent-order ingestion. Never authorizes a history sweep.
import { deriveLog } from './maindecisions.mjs';

export function deriveIncrementalOrders(input, { prior = [], spyCloses = {}, asOfDay } = {}) {
  const since = input?.createdAtGte;
  if (input?.mode !== 'incremental' || !/^\d{4}-\d{2}-\d{2}$/.test(since || '')
      || new Date(since).toISOString().slice(0, 10) !== since || since > asOfDay)
    throw new Error('Invalid incremental order request boundary.');
  let payload = input.payload;
  for (let i = 0; i < 6; i++) {
    if (payload?.isError) throw new Error('Broker order request failed.');
    if (payload?.structuredContent) payload = payload.structuredContent;
    else if (payload?.content?.[0]?.text) payload = JSON.parse(payload.content[0].text);
    else if (payload?.data) payload = payload.data;
    else break;
  }
  const rows = payload?.orders ?? payload?.results;
  if (!Array.isArray(rows)) throw new Error('Missing incremental orders array.');
  const seen = new Map();
  for (const row of rows) {
    if (!row?.id || !Number.isFinite(Date.parse(row.created_at)) || row.created_at.slice(0, 10) < since)
      throw new Error('Order lacks identity or falls outside its declared creation window.');
    if (seen.has(row.id) && JSON.stringify(seen.get(row.id)) !== JSON.stringify(row))
      throw new Error('Conflicting duplicate order.');
    seen.set(row.id, row);
  }
  const result = deriveLog({ data: { orders: [...seen.values()], next: payload.next || payload.next_cursor } }, { spyCloses });
  const blocked = [];
  // A creation-time filter can miss old GTC orders filled recently. Never replace a
  // saved day's aggregate with fewer shares in any known leg. Ambiguous corrections
  // require a full fetch; neither adding overlapping aggregates nor guessing is safe.
  result.decisions = result.decisions.filter(day => {
    const old = prior.find(p => p.id === day.id);
    if (!old) return true;
    const safe = (old.trades || []).every(t => {
      const fresh = day.trades.find(n => n.sym === t.sym && n.side === t.side);
      return fresh && Number.isFinite(t.shares) && fresh.shares + 1e-6 >= t.shares;
    });
    if (!safe) blocked.push(day.date);
    return safe;
  });
  return { ...result, windowFrom: null, requestedFrom: since, blocked,
    warning: blocked.length ? `Preserved incomplete existing day(s): ${blocked.join(', ')}` : result.warning,
    status: blocked.length || result.truncated ? 'partial' : 'incremental' };
}
