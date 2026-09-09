// producer/analyze-universe.test.mjs — the Analyze bench, and the mirror that keeps it honest.
// Run: node producer/analyze-universe.test.mjs
import { readFileSync } from 'node:fs';
import { ANALYZE_BENCH, SD_BENCH_SYMBOLS, analyzeUniverse, tierOf } from './analyze-universe.mjs';
import { MARKET_SYMBOLS } from './markets.mjs';
import { LEADER_SYMBOLS } from './leaders.mjs';
import { RESEARCH_SYMBOLS } from './research-universe.mjs';

let pass = 0, fail = 0;
const eq = (label, got, want) => { const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok  ${label}`); }
  else { fail++; console.log(`  FAIL ${label}\n       got  ${g}\n       want ${w}`); } };
const ok = (label, cond) => eq(label, !!cond, true);

console.log('analyze-universe');

// --- MIRROR CHECK: index.html's SD_BENCH is typed twice ---------------------------------------
// index.html is one static file served to a phone and cannot import a repo module, so its
// aggressive bench is hand-duplicated here. A drifted mirror would silently drop names out of the
// producer's fetch rotation — and a name that leaves the rotation keeps whatever bars it had when
// it left, which is exactly the stale-series failure this whole bench exists to prevent. So
// extract the real object out of the consumer source rather than trusting a comment.
{
  const src = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const m = /const SD_BENCH\s*=\s*\{([\s\S]*?)\n\};/.exec(src);
  ok('index.html still declares a SD_BENCH object', !!m);
  if (m) {
    const live = [...m[1].matchAll(/([A-Z][A-Z0-9.\-]*)\s*:\s*'(?:core|sat|asym)'/g)].map((x) => x[1]);
    ok('…with a plausible number of tickers in it', live.length >= 30);
    const missing = live.filter((t) => !SD_BENCH_SYMBOLS.includes(t));
    eq('every index.html SD_BENCH ticker is mirrored here', missing, []);
    const extra = SD_BENCH_SYMBOLS.filter((t) => !live.includes(t));
    eq('…and the mirror invents nothing index.html does not list', extra, []);
    ok('every SD_BENCH ticker reaches the bench', live.every((t) => ANALYZE_BENCH.includes(t)));
  }
}

// --- union shape -------------------------------------------------------------------------------
eq('bench is de-duplicated', ANALYZE_BENCH.length, new Set(ANALYZE_BENCH).size);
ok('every static tier is fully covered', [...MARKET_SYMBOLS, ...LEADER_SYMBOLS, ...RESEARCH_SYMBOLS]
  .every((s) => ANALYZE_BENCH.includes(s)));
ok('the park vehicle and the gold sleeve are present (they can appear in a ticket without being on any research bench)',
  ANALYZE_BENCH.includes('VTI') && ANALYZE_BENCH.includes('GLDM'));
ok('bench is large enough to be worth planning around', ANALYZE_BENCH.length > 170);

// --- priority order is the fetch order ---------------------------------------------------------
{
  const u = analyzeUniverse({ positions: ['iren', 'SPY', 'PLTR'], target: ['MA', 'SPY', 'JPM'] });
  eq('holdings lead, normalized and de-duplicated', u.slice(0, 3), ['IREN', 'SPY', 'PLTR']);
  eq('target names follow, minus anything already held', u.slice(3, 5), ['MA', 'JPM']);
  eq('no duplicates once the static tiers fold in', u.length, new Set(u).size);
  ok('a held name absent from every static tier is still included', u.includes('IREN'));
  ok('the static bench is a subset of the full universe', ANALYZE_BENCH.every((s) => u.includes(s)));
  eq('market symbols come before the research bench',
    u.indexOf('SPY') < u.indexOf(RESEARCH_SYMBOLS[RESEARCH_SYMBOLS.length - 1]), true);
}
eq('no positions/target still yields the static bench', analyzeUniverse(), ANALYZE_BENCH);
eq('junk input is ignored rather than fetched',
  analyzeUniverse({ positions: [null, '', 42, '  '] }), ANALYZE_BENCH);

// --- tier labelling (plan output only) ---------------------------------------------------------
eq('a held name reports held', tierOf('AAA', { positions: ['AAA'] }), 'held');
eq('a target name reports target', tierOf('MA', { target: ['MA'] }), 'target');
eq('holdings outrank the static tiers', tierOf('SPY', { positions: ['SPY'] }), 'held');
eq('an unlisted symbol reports other', tierOf('ZZZZ'), 'other');

console.log(`\nanalyze-universe.test: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
