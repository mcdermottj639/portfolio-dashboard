// producer/sync-option-watchlist.mjs — deterministic diff for the account's single Robinhood
// OPTIONS watchlist (there is exactly one per account; add/remove take no list_id). Like
// sync-watchlist.mjs / av-plan.mjs, this does NOT touch Robinhood — MCP writes are agent-only. It
// reads two small JSON files and PRINTS the exact add/remove the agent then executes.
//
// Reads:
//   producer/raw/option-watchlist.json          { positionType:"long", optionIds:[…], contracts:[…] }
//                                                — the desired set, written by options-build.mjs on a
//                                                FETCH_ALL run (only the single-leg ideas that resolved
//                                                to a live contract UUID).
//   producer/raw/option-watchlist-current.json   the raw get_option_watchlist result the agent saved
//                                                (the live list). Absent → treat the list as empty.
// Prints:
//   ADD <id> <id> …      → add_option_to_watchlist    { option_ids:[…], position_type:"long" }
//   REMOVE <id> …        → remove_option_from_watchlist{ option_ids:[…], position_type:"long" }
//   IN SYNC              → nothing to do
// Everything is position_type "long" (the watchlist read-back doesn't return side, so adding/removing
// long-only keeps the diff deterministic). Exit 0 always — the run already published.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RAW = join(__dirname, 'raw');
const readJSON = (f) => JSON.parse(readFileSync(f, 'utf8'));

const wlFile = join(RAW, 'option-watchlist.json');
if (!existsSync(wlFile)) {
  console.log('NO-OP — producer/raw/option-watchlist.json absent (light run / no picks rebuild). Leave the options watchlist as-is.');
  process.exit(0);
}

const desired = readJSON(wlFile);
const byId = new Map((desired.contracts || []).map((c) => [c.optionId, c]));
const want = [...new Set((desired.optionIds || []).filter(Boolean))];

// Current contracts — the agent saves the get_option_watchlist result here. Each item carries
// option_ids:[<uuid>] (single-leg). Tolerate wrapped/bare shapes.
let have = [];
const curFile = join(RAW, 'option-watchlist-current.json');
if (existsSync(curFile)) {
  const c = readJSON(curFile);
  const items = c?.data?.items ?? c?.items ?? [];
  have = [...new Set(items.flatMap((i) => i.option_ids ?? (i.option_id ? [i.option_id] : [])).filter(Boolean))];
}

const haveSet = new Set(have), wantSet = new Set(want);
const add = want.filter((id) => !haveSet.has(id));
const remove = have.filter((id) => !wantSet.has(id));

const label = (id) => (byId.get(id)?.name ? ` (${byId.get(id).name})` : '');
if (!add.length && !remove.length) {
  console.log(`IN SYNC — options watchlist already matches the ${want.length} live idea contract(s).`);
  process.exit(0);
}
if (add.length) console.log(`ADD ${add.join(' ')}`);
if (remove.length) console.log(`REMOVE ${remove.join(' ')}`);
// Human-readable echo (comment lines the agent ignores when parsing ADD/REMOVE).
for (const id of add) console.log(`# add ${id}${label(id)}`);
for (const id of remove) console.log(`# remove ${id}`);
