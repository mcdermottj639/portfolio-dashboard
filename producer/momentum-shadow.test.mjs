// Synthetic tests for the momentum-off paper shadow. No broker calls; the CLI test writes only to a temp copy.
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, cpSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { shadowWeights, compositeWith, shadowCohort, appendCohort, gradeShadow, nextShadow, SHADOW_MIN_COHORTS } from './momentum-shadow.mjs';
import { FACTOR_WEIGHTS, targetIdentity } from './agentic-model.mjs';

let passed = 0, failed = 0;
const test = (label, fn) => { try { fn(); passed++; console.log('ok', label); } catch (e) { failed++; console.error('FAIL', label, e.message); } };
const live = (r) => +(FACTOR_WEIGHTS.momentum * r.m + FACTOR_WEIGHTS.quality * r.q + FACTOR_WEIGHTS.growth * r.g + FACTOR_WEIGHTS.catalyst * r.c + FACTOR_WEIGHTS.valuation * r.v).toFixed(3);
const row = (t, m, q, g = 6, c = 5, v = 5, px = 100) => { const r = { t, m, q, g, c, v, px }; return { ...r, composite: live(r) }; };
// 12 single names + SPY. HOT* are momentum-led, QUAL* quality-led.
const ranking = [
  row('HOT1', 10, 5), row('HOT2', 10, 5.1), row('QUAL1', 3, 9), row('QUAL2', 3, 9.1),
  ...Array.from({ length: 8 }, (_, i) => row('MID' + i, 7, 7 + i / 100)),
  row('SPY', 9, 9, 9, 9, 9, 700), { t: 'NOSCORE', m: 9, q: 9, g: 9, c: 9, v: 9, px: 50, composite: null },
];

test('weights drop momentum and renormalize to 1', () => {
  const w = shadowWeights();
  assert.equal(w.momentum, 0);
  assert.ok(Math.abs(Object.values(w).reduce((s, x) => s + x, 0) - 1) < 1e-12);
  assert.ok(Math.abs(w.quality - 0.24 / 0.78) < 1e-12);
});
test('shadow composite ignores the momentum score and uses 5 for a missing sleeve', () => {
  const w = shadowWeights();
  assert.equal(compositeWith(row('A', 0, 8), w), compositeWith(row('A', 10, 8), w));
  assert.equal(compositeWith({ ...row('A', 5, 8), g: null }, w), compositeWith(row('A', 5, 8, 5), w));
  assert.equal(compositeWith({ t: 'X', composite: null, v: 5 }, w), null);
});
test('cohort: momentum-led names leave, quality-led names enter, index and unscored rows excluded', () => {
  const c = shadowCohort(ranking, { asOf: '2026-11-18', n: 10 });
  assert.deepEqual(c.onlyLive.sort(), ['HOT1', 'HOT2']);
  assert.deepEqual(c.onlyNoMomentum.sort(), ['QUAL1', 'QUAL2']);
  for (const b of [c.live, c.noMomentum]) { assert.equal(b.length, 10); assert.ok(!b.some((r) => r.t === 'SPY' || r.t === 'NOSCORE')); }
  assert.equal(c.spyAt, 700);
  assert.equal(c.pool, 12);
});
test('too small a universe records nothing', () => assert.equal(shadowCohort(ranking.slice(0, 5), { asOf: '2026-11-18' }), null));
test('a recorded cohort is frozen: same asOf is never replaced', () => {
  const c1 = shadowCohort(ranking, { asOf: '2026-11-18' });
  const l1 = appendCohort({ cohorts: [] }, c1);
  const l2 = appendCohort(l1, { ...c1, live: [] });
  assert.equal(l2.cohorts.length, 1); assert.equal(l2.cohorts[0].live.length, 10);
  assert.equal(appendCohort(l1, null).cohorts.length, 1);
});
test('grading: diff is noMomentum minus live, missing price voids the basket, thin until enough cohorts', () => {
  const dates = ['2026-11-04', '2026-11-11', '2026-11-18', '2026-11-25'];
  let ledger = { cohorts: [] };
  for (const d of dates) ledger = appendCohort(ledger, shadowCohort(ranking, { asOf: d }));
  const quotes = Object.fromEntries(ranking.map((r) => [r.t, r.px]));
  quotes.HOT1 = 80; quotes.HOT2 = 80; quotes.QUAL1 = 110; quotes.QUAL2 = 110; quotes.SPY = 714;
  const g = gradeShadow(ledger, quotes, '2026-12-15');
  assert.equal(g.cohorts[0].livePct, -4); assert.equal(g.cohorts[0].noMomentumPct, 2);
  assert.equal(g.cohorts[0].diffPp, 6); assert.equal(g.cohorts[0].spyPct, 2);
  assert.equal(g.graded, SHADOW_MIN_COHORTS); assert.equal(g.thin, false); assert.equal(g.avgDiffPp, 6); assert.equal(g.noMomentumAhead, 4);
  const early = gradeShadow(ledger, quotes, '2026-11-27');
  assert.equal(early.cohorts[3].open, true); assert.equal(early.thin, true);
  delete quotes.QUAL1;
  assert.equal(gradeShadow(ledger, quotes, '2026-12-15').cohorts[0].diffPp, null);
});
test('nextShadow carries the committed log forward, adds once, and survives a missing ranking', () => {
  const first = nextShadow(null, ranking, { asOf: '2026-11-18' });
  assert.equal(first.added, true); assert.equal(first.momentumShadow.cohorts.length, 1);
  const committed = { names: [], momentumShadow: first.momentumShadow };
  const again = nextShadow(committed, ranking, { asOf: '2026-11-18' });
  assert.equal(again.added, false); assert.deepEqual(again.momentumShadow.cohorts, first.momentumShadow.cohorts);
  const second = nextShadow(committed, ranking, { asOf: '2026-11-25' });
  assert.deepEqual(second.momentumShadow.cohorts.map((c) => c.asOf), ['2026-11-18', '2026-11-25']);
  const none = nextShadow(committed, null, { asOf: '2026-12-02' });
  assert.equal(none.added, false); assert.equal(none.momentumShadow.cohorts.length, 1);
});
test('the shadow log is outside the target identity', () => {
  const t = { asOf: '2026-11-18', names: [{ ticker: 'A', weightPct: 100 }] };
  assert.equal(targetIdentity(t), targetIdentity({ ...t, momentumShadow: nextShadow(null, ranking, { asOf: t.asOf }).momentumShadow }));
});
test('finalize CLI: stores the log on the target, keeps it across --no-prior, never changes the targetId', () => {
  const root = dirname(fileURLToPath(import.meta.url));
  const temp = mkdtempSync(join(tmpdir(), 'momentum-shadow-'));
  try {
    cpSync(root, join(temp, 'producer'), { recursive: true, filter: (p) => !p.includes('/raw') });
    const build = (asOf) => { const evidence = [{ source: 'mcp:test/synthetic-fixture', asOf, claim: 'Synthetic test quote, range and research evidence' }];
    const secs = ['Energy Minerals', 'Finance', 'Health Technology', 'Producer Manufacturing', 'Transportation', 'Retail Trade', 'Non-Energy Minerals', 'Process Industries', 'Consumer Services', 'Commercial Services', 'Distribution Services', 'Industrial Services'];
    const syms = ['XOM', 'JPM', 'LLY', 'CAT', 'UNP', 'COST', 'NEM', 'LIN', 'BKNG', 'SPGI', 'MCK', 'SLB'];
    const rows = syms.map((t, i) => ({ ...row(t, i < 2 ? 10 : 5, i < 2 ? 5 : 8 - i / 100), sec: secs[i], hi: 120, lo: 90, evidence }));
    return { researchVersion: 'evidence-v1', ranking: [...rows, { ...row('SPY', 7, 7, 7, 7, 7, 700), sec: 'Index', hi: 760, lo: 600, evidence }],
      research: { evidence: Object.fromEntries(syms.map((t) => [t, Object.fromEntries(['quality', 'momentum', 'growth', 'catalyst'].map((k) => [k, { score: 8, status: 'observed', evidence }]))])) },
      verdicts: syms.map((t) => ({ t, businessOk: true, rec: 'buy', evidence })),
      allocation: { picks: [...syms.slice(0, 9).map((ticker) => ({ ticker, weightPct: 10 })), { ticker: 'SPY', weightPct: 10 }] } };
    };
    const candidate = join(temp, 'candidate.json'), canonical = join(temp, 'producer/agentic-target.json');
    rmSync(canonical, { force: true });
    const run = (asOf, extra = []) => { writeFileSync(candidate, JSON.stringify(build(asOf))); return spawnSync(process.execPath, [join(temp, 'producer/finalize-target.mjs'), candidate, '--asOf', asOf, '--write', ...extra], { encoding: 'utf8' }); };
    const a = run('2026-11-18'); assert.equal(a.status, 0, a.stderr);
    const t1 = JSON.parse(readFileSync(canonical, 'utf8'));
    assert.equal(t1.momentumShadow.cohorts.length, 1);
    assert.equal(t1.momentumShadow.cohorts[0].spyAt, 700);
    assert.equal(t1.targetId, targetIdentity(t1));
    const { momentumShadow, ...bare } = t1; assert.equal(targetIdentity(bare), t1.targetId);
    const b = run('2026-11-25', ['--no-prior']); assert.equal(b.status, 0, b.stderr);
    const t2 = JSON.parse(readFileSync(canonical, 'utf8'));
    assert.deepEqual(t2.momentumShadow.cohorts.map((c) => c.asOf), ['2026-11-18', '2026-11-25']);
    assert.deepEqual(t2.momentumShadow.cohorts[0], t1.momentumShadow.cohorts[0]);
  } finally { rmSync(temp, { recursive: true, force: true }); }
});
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
