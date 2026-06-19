// Shared response-key logic for the replay pipeline.
// MUST stay identical to the makeKey/stable functions in ../index.html (the PWA shim),
// so the producer writes keys the consumer will look up. If you change one, change both.

export function stable(o) {
  if (o === null || typeof o !== 'object') return JSON.stringify(o);
  if (Array.isArray(o)) return '[' + o.map(stable).join(',') + ']';
  return '{' + Object.keys(o).sort().map((k) => JSON.stringify(k) + ':' + stable(o[k])).join(',') + '}';
}

// Exact key for stable calls (portfolio, positions, Alpha Vantage TOOL_CALL).
// Quotes and historicals are stored per-symbol (see data.quotes / data.hist) and
// assembled by the shim, so they do NOT go through makeKey.
export function makeKey(server, args) {
  return server + '|' + stable(args || {});
}

// The two MCP server-prefix constants the dashboard uses (from index.html).
export const RH = 'mcp__1ad8dd47-cf57-427a-8a28-facba69504fb__';
export const AV = 'mcp__4ae6f0d3-5112-4955-94dc-c6bea90e45dd__TOOL_CALL';
