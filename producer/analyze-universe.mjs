// producer/analyze-universe.mjs — THE ANALYZE BENCH.
//
// One ordered union of every symbol this dashboard can be asked to analyze, and the ORDER is the
// fetch order: whatever the day's cap can afford is taken off the front, so the account's own
// money is always seeded before the wider bench.
//
// WHY THIS EXISTS. The Analyze tab will happily accept any ticker, but its technicals are built
// out of `data.hist.day`, and a symbol's daily series only advances on days that symbol is in the
// producer's fetch rotation. The rotation was "top 15 holdings by value + the market ETFs", so
// everything else kept whatever series it had WHEN IT LEFT — measured 2026-09-08, 142 of 191
// series were stale, some by two months. A stale series is not merely a lagging one: it stops at
// whatever level it stopped at, and backtesting the Analyze label logic over deliberately-staled
// bars flips the DIRECTION of the call 8% of the time at 10 stale bars and 15% at 40. So the
// bench is the list of names we promise to keep FRESH, and `hist-plan.mjs` is what keeps them so.
//
// PRIORITY ORDER, and why each tier sits where it does:
//   1. holdings (both accounts)  — real money; a stale series here misprices a position.
//   2. agentic target names      — the executor trades these; entry bands are read off bars.
//   3. MARKET_SYMBOLS            — the Markets tab and every beta/relative-strength denominator.
//   4. LEADER_SYMBOLS            — the Plan page's Ideal Portfolio bench (quoted every run already).
//   5. SD_BENCH                  — the self-directed momentum lens (index.html; mirrored below).
//   6. RESEARCH_SYMBOLS          — the weekly research bench: the widest tier, and the one whose
//                                  members are most likely to be looked up cold on Analyze.
//   7. PARK/DIVERSIFIER vehicles — VTI (the waiting ground) and GLDM (the gold sleeve).
//
// SD_BENCH IS A COPY, AND THE TEST IS WHAT MAKES A COPY SAFE. index.html cannot import a repo
// module (it is one static file served to a phone), so its bench is typed there and mirrored here
// — the same problem `finalists.mjs` has with the research workflow, solved the same way:
// `analyze-universe.test.mjs` regex-extracts the real `SD_BENCH` object out of index.html and
// asserts every ticker in it is present here. A drifted mirror fails the suite instead of quietly
// leaving the self-directed lens reading stale bars.

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { MARKET_SYMBOLS } from './markets.mjs';
import { LEADER_SYMBOLS } from './leaders.mjs';
import { RESEARCH_SYMBOLS } from './research-universe.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RAWDIR = join(__dirname, 'raw');

// Mirror of index.html's `const SD_BENCH={…}` (~line 2133) — tickers only; the core/sat/asym tier
// is the consumer's sizing concern, not a fetch concern. Kept in the same order for diffability.
export const SD_BENCH_SYMBOLS = [
  'NVDA', 'AVGO', 'TSM', 'MSFT', 'META', 'GOOGL', 'AMZN',
  'ORCL', 'MU', 'KLAC', 'NXPI', 'CRWD', 'PLTR', 'APP',
  'NFLX', 'QCOM', 'CRM', 'ADBE', 'AAPL', 'AMD', 'MRVL', 'AMAT',
  'IREN', 'CIFR', 'WULF', 'CLSK', 'NBIS', 'VRT', 'MTSI', 'RBLX',
  'TSLA', 'GFS', 'IBIT', 'AMKR', 'TTMI', 'CRDO', 'SMCI',
  'SPCX', 'INIO', 'GNRC', 'ALB',
];

// The park vehicle and the gold diversifier. Neither is guaranteed to be held (both floors are 0
// under Mandate A) and neither is on any research bench, but both can appear in a ticket, so both
// need a live series. Same reasoning as `--symbols` appending GLDM for the research batch quote.
export const VEHICLE_SYMBOLS = ['VTI', 'GLDM'];

const clean = (s) => (typeof s === 'string' ? s.trim().toUpperCase() : '');

/**
 * Ordered, de-duplicated union. Static tiers only — call `analyzeUniverse()` to fold in the live
 * holdings and target, which is what the producer actually fetches against.
 */
export function benchTiers() {
  return [
    { name: 'market', syms: MARKET_SYMBOLS },
    { name: 'leaders', syms: LEADER_SYMBOLS },
    { name: 'sd-bench', syms: SD_BENCH_SYMBOLS },
    { name: 'research', syms: RESEARCH_SYMBOLS },
    { name: 'vehicles', syms: VEHICLE_SYMBOLS },
  ];
}

/** The static half of the bench (no snapshot / no raw files needed). */
export const ANALYZE_BENCH = (() => {
  const seen = new Set(), out = [];
  for (const tier of benchTiers()) for (const s of tier.syms) {
    const t = clean(s); if (t && !seen.has(t)) { seen.add(t); out.push(t); }
  }
  return out;
})();

/**
 * The full bench, in fetch-priority order.
 *
 * @param {object}   [opts]
 * @param {string[]} [opts.positions]  held tickers (both accounts), highest priority
 * @param {string[]} [opts.target]     agentic target tickers, second
 * @returns {string[]} de-duplicated, upper-cased, ordered
 */
export function analyzeUniverse({ positions = [], target = [] } = {}) {
  const seen = new Set(), out = [];
  const push = (list) => { for (const s of list || []) { const t = clean(s); if (t && !seen.has(t)) { seen.add(t); out.push(t); } } };
  push(positions);
  push(target);
  for (const tier of benchTiers()) push(tier.syms);
  return out;
}

/** Which tier a symbol came from — for the plan's human-readable output only. */
export function tierOf(sym, { positions = [], target = [] } = {}) {
  const t = clean(sym);
  if ((positions || []).some((s) => clean(s) === t)) return 'held';
  if ((target || []).some((s) => clean(s) === t)) return 'target';
  for (const tier of benchTiers()) if (tier.syms.some((s) => clean(s) === t)) return tier.name;
  return 'other';
}

// --- the LIVE half of the universe -------------------------------------------------------------
// Both readers are best-effort by design: `producer/raw/` is gitignored and EMPTY at the start of
// every scheduled run, and the committed target may be absent on a fresh clone. Missing input means
// the bench falls back to its static tiers, which is a smaller fetch list, never a wrong one.

const readJSON = (f) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return null; } };
const unwrap = (r) => {
  if (r == null) return r;
  if (r.structuredContent) return r.structuredContent;
  if (r.content && r.content[0] && typeof r.content[0].text === 'string') { try { return JSON.parse(r.content[0].text); } catch { return r.content[0].text; } }
  return r;
};

/** Held tickers across BOTH accounts, from this run's raw position files. Symbols only — never
 *  quantities or values: this feeds output that lands in a scheduled run's log. */
export function heldFromRaw(rawDir = RAWDIR) {
  const out = [];
  if (!existsSync(rawDir)) return out;
  for (const f of readdirSync(rawDir).filter((x) => /^(positions|agentic-positions)\.json$/.test(x))) {
    const raw = unwrap(readJSON(join(rawDir, f)));
    if (!raw) continue;
    const positions = raw.data?.positions ?? raw.positions ?? (Array.isArray(raw) ? raw : []);
    for (const p of positions || []) if (p && p.symbol) out.push(p.symbol);
  }
  return [...new Set(out)];
}

/** The agentic target's tickers, from the COMMITTED file (the executor's own source of truth). */
export function targetSymbols(dir = __dirname) {
  const t = readJSON(join(dir, 'agentic-target.json'));
  return (t && Array.isArray(t.names) ? t.names : []).map((n) => n && (n.ticker || n.t || n.sym || n.symbol)).filter(Boolean);
}

/** The bench as the producer will actually fetch it this run: holdings → target → static tiers. */
export function liveUniverse(rawDir = RAWDIR) {
  return analyzeUniverse({ positions: heldFromRaw(rawDir), target: targetSymbols() });
}

// CLI: `node producer/analyze-universe.mjs [--symbols] [--stats]` — mirrors research-universe.mjs.
if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2);
  if (argv.includes('--symbols')) console.log(ANALYZE_BENCH.join(','));
  else if (argv.includes('--stats')) {
    console.log(`ANALYZE_BENCH: ${ANALYZE_BENCH.length} symbols (static tiers only — holdings/target fold in at run time)`);
    const seen = new Set();
    for (const tier of benchTiers()) {
      const fresh = tier.syms.filter((s) => { const t = clean(s); if (seen.has(t)) return false; seen.add(t); return true; });
      console.log(`  ${tier.name.padEnd(9)} ${String(tier.syms.length).padStart(4)} listed · ${String(fresh.length).padStart(4)} new here`);
    }
  } else {
    console.log(ANALYZE_BENCH.join('\n'));
  }
}
