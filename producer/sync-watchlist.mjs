// producer/sync-watchlist.mjs — deterministic diff for the "Dashboard Top 10 Picks" Robinhood
// watchlist. MCP writes are agent-only (Node can't reach the connector), so — exactly like
// av-plan.mjs / options-plan.mjs — this script does NOT touch Robinhood. It only reads the two
// small JSON files and PRINTS the exact add/remove the agent then executes via MCP.
//
// Reads:
//   producer/raw/picks-watchlist.json    { listId, listName, date, tickers:[…] }  — the desired set,
//                                         written by picks-build.mjs on a FETCH_ALL run.
//   producer/raw/watchlist-current.json  the raw get_watchlist_items result the agent just saved
//                                         (the live list). Absent → treat the list as empty.
// Prints (one directive per line, machine-simple for the agent to act on):
//   LIST <list_id>
//   ADD <T1> <T2> …      → call add_to_watchlist { list_id, symbols:[…] }
//   REMOVE <T3> …        → call remove_from_watchlist { list_id, symbols:[…] }
//   IN SYNC              → nothing to do
// Exit 0 always (this is a planner, never fatal to the run — data.json already published).
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RAW = join(__dirname, 'raw');
const readJSON = (f) => JSON.parse(readFileSync(f, 'utf8'));

const wlFile = join(RAW, 'picks-watchlist.json');
if (!existsSync(wlFile)) {
  // No sidecar → picks didn't rebuild this run (FETCH_LIGHT, or picks-build skipped). Leave the
  // list untouched — the carried-forward picks haven't changed.
  console.log('NO-OP — producer/raw/picks-watchlist.json absent (light run / no picks rebuild). Leave the watchlist as-is.');
  process.exit(0);
}

const desired = readJSON(wlFile);
const want = [...new Set((desired.tickers || []).map((t) => String(t).trim().toUpperCase()).filter(Boolean))];

// Current items — the agent saves the get_watchlist_items result here. Tolerate the wrapped
// ({data:{items}}) and bare ({items}) shapes; only stock/ETF rows (object_type=instrument) carry a
// ticker we sync.
let have = [];
const curFile = join(RAW, 'watchlist-current.json');
if (existsSync(curFile)) {
  const c = readJSON(curFile);
  const items = c?.data?.items ?? c?.items ?? [];
  have = [...new Set(items.map((i) => String(i.symbol || '').trim().toUpperCase()).filter(Boolean))];
}

const haveSet = new Set(have), wantSet = new Set(want);
const add = want.filter((t) => !haveSet.has(t));
const remove = have.filter((t) => !wantSet.has(t));

console.log(`LIST ${desired.listId || `(unknown — look up "${desired.listName || ''}" via get_watchlists)`}`);
if (!add.length && !remove.length) { console.log(`IN SYNC — list already matches the ${want.length} top picks (${want.join(' ')}).`); process.exit(0); }
if (add.length) console.log(`ADD ${add.join(' ')}`);
if (remove.length) console.log(`REMOVE ${remove.join(' ')}`);
