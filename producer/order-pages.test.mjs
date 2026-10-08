import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mergeOrderPages } from './order-pages.mjs';
import { deriveLog, mergeDecisions } from './maindecisions.mjs';
const since = '2026-06-09';
const order = (id, day) => ({ id, symbol: 'TEST', state: 'filled', side: 'buy',
  cumulative_quantity: '1', average_price: '10', last_transaction_at: `${day}T16:00:00Z` });
const a = order('a', '2026-10-07'), b = order('b', '2026-10-06'), c = order('c', '2026-09-01');
const page = (requestCursor, rows, next = null) => ({ requestCursor, createdAtGte: since,
  payload: { structuredContent: { data: { orders: rows, next_cursor: next } } } });
test('full cursor chain merges pages and deduplicates overlapping broker IDs', () => {
  const raw = mergeOrderPages([page(null, [a, b], 'cursor2'), page('cursor2', [b, c])], since);
  assert.deepEqual(raw.data.orders.map(o => o.id), ['a', 'b', 'c']);
  assert.equal(raw.data.next, null);
  assert.equal(deriveLog(raw, { sinceDay: since }).decisions.length, 3);
});
test('unfinished chain retains cursor, protects boundary day and older recorded history', () => {
  const raw = mergeOrderPages([page(null, [a, b], 'cursor2')], since);
  const prior = deriveLog({ data: { orders: [a, b, c] } }, { sinceDay: since }).decisions;
  const result = deriveLog(raw, { sinceDay: since, prior });
  assert.equal(result.truncated, true);
  assert.equal(result.windowFrom, '2026-10-07');
  assert.equal(mergeDecisions(result.decisions, prior, result).length, 3);
});
test('reject missing first page, cursor gaps, loops and extra pages', () => {
  for (const pages of [[page('cursor2', [b])], [page(null, [a], 'cursor2'), page('wrong', [b])],
    [page(null, [a], 'cursor2'), page('cursor2', [b], 'cursor2'), page('cursor2', [c])],
    [page(null, [a]), page(null, [b])]]) assert.throws(() => mergeOrderPages(pages, since));
});
test('reject shortened window, malformed results, missing IDs and conflicting duplicates', () => {
  assert.throws(() => mergeOrderPages([{ ...page(null, [a]), createdAtGte: '2026-10-01' }], since));
  assert.throws(() => mergeOrderPages([{ ...page(null, []), payload: { isError: true } }], since));
  assert.throws(() => mergeOrderPages([page(null, [{ ...a, id: null }])], since));
  assert.throws(() => mergeOrderPages([page(null, [a], 'cursor2'), page('cursor2', [{ ...a, average_price: '20' }])], since));
});
