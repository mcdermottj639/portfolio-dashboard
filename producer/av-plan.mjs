// Prints today's Alpha Vantage call plan for the producer agent to follow.
// Auto-computes the "cover" (top holdings) from producer/raw/positions.json +
// quotes*.json so it matches what the consumer will request. Run AFTER the
// Robinhood raw files are saved, on the day's FIRST run only:
//
//   node producer/av-plan.mjs
//
// For each line, call the Alpha Vantage MCP tool:
//   TOOL_CALL { tool_name: "<tool>", arguments: "<args JSON>" }
// and save the VERBATIM result object to the printed path. Then build-data.mjs
// keys them into data.json automatically.
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { MACRO_CALLS, EARNINGS_CALL, overviewCall, coverFromRaw } from './av.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RAWDIR = join(__dirname, 'raw');

// Cover symbols: from raw files if present, else from CLI args (node av-plan.mjs NVDA MSFT …).
let cover = coverFromRaw(RAWDIR);
if (!cover.length) cover = process.argv.slice(2);

const calls = [...MACRO_CALLS, EARNINGS_CALL, ...cover.map(overviewCall)];
const FREE_LIMIT = 25;

console.log(`Alpha Vantage daily plan — ${calls.length} calls (free tier: ${FREE_LIMIT}/day)\n`);
if (!cover.length) console.log('  (no cover symbols found — fundamentals will be skipped; pass symbols as args to include them)\n');
for (const c of calls) {
  console.log(`  • ${c.tool}  ${JSON.stringify(c.args)}`);
  console.log(`      → producer/raw/av-src/${c.id}.json\n`);
}
if (calls.length > FREE_LIMIT) {
  console.warn(`⚠️  ${calls.length} calls EXCEEDS the ${FREE_LIMIT}/day free tier. ` +
    `Reduce OVERVIEW_COVER in av.mjs or drop the earnings call to fit.`);
} else {
  console.log(`Budget OK: ${calls.length}/${FREE_LIMIT} used today (${FREE_LIMIT - calls.length} to spare).`);
}
