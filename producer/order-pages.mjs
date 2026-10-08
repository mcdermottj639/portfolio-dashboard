// Merge smaller broker pages without shortening the requested history window.
// Each file records the actual request cursor alongside the untouched tool response.
function unwrap(raw) {
  for (let i = 0; i < 5; i++) {
    if (raw?.isError) throw new Error('Broker returned an order-page error.');
    if (raw?.structuredContent) raw = raw.structuredContent;
    else if (raw?.content?.[0]?.text) raw = JSON.parse(raw.content[0].text);
    else if (raw?.data) raw = raw.data;
    else return raw;
  }
  throw new Error('Unrecognized order-page envelope.');
}

export function mergeOrderPages(pages, sinceDay) {
  if (!pages.length) throw new Error('No order pages.');
  const orders = [], seen = new Map(), cursors = new Set();
  let cursor = null, since = null;
  for (const page of pages) {
    if (page.requestCursor !== cursor || (cursor !== null && cursors.has(cursor))) {
      throw new Error('Missing, repeated or out-of-order broker cursor.');
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(page.createdAtGte || '') || page.createdAtGte > sinceDay
        || (since && since !== page.createdAtGte)) throw new Error('Order pages must retain the full requested history window.');
    since = page.createdAtGte;
    cursors.add(cursor);
    const payload = unwrap(page.payload);
    const rows = payload?.orders ?? payload?.results;
    if (!Array.isArray(rows)) throw new Error('Order page contains no orders array.');
    for (const row of rows) {
      if (!row?.id) throw new Error('Paged orders require broker order IDs for deduplication.');
      const previous = seen.get(row.id);
      if (previous && JSON.stringify(previous) !== JSON.stringify(row)) throw new Error('Conflicting duplicate order; fetch a fresh consistent set of pages.');
      if (!previous) { seen.set(row.id, row); orders.push(row); }
    }
    cursor = payload.next || payload.next_cursor || null;
    if (cursor !== null && typeof cursor !== 'string') throw new Error('Invalid order cursor.');
    if (cursor === null && page !== pages.at(-1)) throw new Error('Unexpected page after end of history.');
  }
  // Preserve an outstanding cursor: the existing derivation then protects the partial
  // boundary day and all older history instead of treating a partial fetch as complete.
  return { data: { orders, next: cursor } };
}
