// Prints the finalist tickers for the Daily Picks deep-dive, read from the saved
// scan result (producer/raw/scan.json). Run AFTER run_scan(SCAN_ID) is saved.
//   node producer/picks-select.mjs
// Then fetch get_equity_fundamentals for these (one batched call), and optionally
// AV COMPANY_OVERVIEW for each (hybrid growth metrics), before picks-build.mjs.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { selectFinalists, scanRows, N_FINALISTS } from './picks.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const scanFile = join(__dirname, 'raw', 'scan.json');
if (!existsSync(scanFile)) { console.error('Missing producer/raw/scan.json — run the scan first (run_scan SCAN_ID).'); process.exit(1); }

const raw = JSON.parse(readFileSync(scanFile, 'utf8'));
const finalists = selectFinalists(raw, N_FINALISTS);
const total = scanRows(raw).length;

console.log(`Scan matched ${total} oversold large-caps. Top ${finalists.length} most-oversold finalists:\n`);
console.log('  ' + finalists.join(' '));
console.log('\nNext:');
console.log('  1. get_equity_fundamentals { symbols: [the list above] }  → producer/raw/picks-fund.json');
console.log('  2. (hybrid) AV COMPANY_OVERVIEW for each  → producer/raw/av-src/overview-<SYM>.json  (skip if AV cap hit)');
console.log('  3. node producer/picks-build.mjs   → producer/raw/picks.json');
