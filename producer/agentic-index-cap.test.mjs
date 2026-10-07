// Synthetic allocation regressions. No broker calls and no writes to the live target.
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, cpSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { riskAdjustWeights, validateTarget, INDEX_SYMS, clusterExposure } from './riskweights.mjs';
import { finalizeTarget } from './finalize-target.mjs';

let passed = 0, failed = 0;
const test = (label, fn) => {
  try { fn(); passed++; console.log('ok', label); }
  catch (error) { failed++; console.error('FAIL', label, error.message); }
};
const names = (rows) => rows.map(([ticker, weightPct]) => ({ ticker, weightPct }));
const indexPct = (rows) => rows.filter(n => INDEX_SYMS.includes(n.ticker)).reduce((s, n) => s + n.weightPct, 0);
const sum = (rows) => rows.reduce((s, n) => s + n.weightPct, 0);
const valid = (rows, cap = 10) => {
  const result = validateTarget({ names: rows, riskSettings: { indexMaxPct: cap } });
  assert.equal(result.valid, true, result.errors.join('; '));
  assert.ok(Math.abs(sum(rows) - 100) < 1e-8);
  assert.ok(indexPct(rows) <= cap + 1e-8);
};
const techHeavy = names([['AAPL',22],['MSFT',20],['AMZN',20],['JPM',13],['XOM',5],['UNP',10],['SPY',10]]);

test('tech trimming redistributes within the index cap even when other names have room', () => {
  const before = structuredClone(techHeavy);
  const result = riskAdjustWeights(techHeavy, { indexMaxPct: 10 });
  valid(result.names);
  assert.deepEqual(techHeavy, before, 'caller input must remain unchanged');
  assert.ok(clusterExposure(result.names)['megacap-tech'].direct <= 48 + 1e-8);
});

test('several index vehicles share one residual budget during redistribution', () => {
  const input = names([['AAPL',25],['MSFT',25],['AMZN',12],['JPM',12],['XOM',10],['UNP',9],['SPY',4],['VTI',3]]);
  const result = riskAdjustWeights(input, { indexMaxPct: 10 });
  valid(result.names);
  assert.ok(result.names.some(n => n.ticker === 'SPY') && result.names.some(n => n.ticker === 'VTI'));
});

test('an initially oversized combined index sleeve is trimmed and fully reallocated', () => {
  const result = riskAdjustWeights(names([['AAPL',20],['MSFT',20],['JPM',10],['XOM',10],['UNP',10],['SPY',15],['VTI',15]]), { indexMaxPct: 10 });
  valid(result.names);
});

test('cent rounding cannot overfill a fractional combined index limit', () => {
  const result = riskAdjustWeights(names([['AAPL',24],['MSFT',24],['MA',10],['V',10],['CVX',18],['UNP',4.0006],['SPY',6.006],['VTI',3.9934]]), { indexMaxPct: 9.995 });
  valid(result.names, 9.995);
});

test('a zero index budget reallocates the sleeve and drops zero-weight rows', () => {
  const result = riskAdjustWeights(names([['AAPL',20],['MSFT',20],['JPM',20],['XOM',15],['UNP',15],['SPY',10]]), { indexMaxPct: 0 });
  valid(result.names, 0);
  assert.ok(result.names.every(n => n.weightPct > 0));
});

test('infeasible books fail instead of parking excess above the index limit', () => {
  assert.throws(() => riskAdjustWeights(names([['NVDA',45],['MSFT',45],['SPY',10]]), { indexMaxPct: 10 }), /INVALID_TARGET.*cannot be allocated within hard caps/);
});

test('invalid cap settings fail explicitly', () => {
  for (const indexMaxPct of [-1, 101, NaN, Infinity, '10']) {
    assert.throws(() => riskAdjustWeights(techHeavy, { indexMaxPct }), /INVALID_TARGET.*indexMaxPct/);
  }
});

test('legacy callers retain their uncapped index policy', () => {
  const result = riskAdjustWeights(names([['NVDA',50],['MSFT',25],['SPY',25]]));
  assert.ok(indexPct(result.names) > 10);
  assert.equal(validateTarget({ names: result.names }).valid, true);
});

test('combined weights are brought to 100 before measuring concentration', () => {
  const result = riskAdjustWeights(names([['AAPL',25],['MSFT',25],['AMZN',7.6],['SPY',12],['JNJ',12],['NEM',12],['CVX',14],['UNP',12.4]]), { indexMaxPct: 10 });
  valid(result.names);
  assert.ok(Math.abs(clusterExposure(result.names)['megacap-tech'].direct - 48) < 0.02);
  assert.ok(result.notes.some(n => /normalized.*120.*100/.test(n)));
});

test('evidence-v1 finalization uses the same index cap as its final validation', () => {
  const result = finalizeTarget({ picks: techHeavy }, { asOf: '2026-10-07', researchVersion: 'evidence-v1' });
  valid(result.target.names);
  assert.equal(result.target.riskSettings.indexMaxPct, 10);
  assert.equal(result.target.riskSettings.singleNameCaps.SPY, 10);
  assert.equal(result.target.riskVersion, 'hard-caps-v3');
});

const root = dirname(fileURLToPath(import.meta.url));
const prior = { asOf: '2026-09-24', names: names([
  ['NVDA',9.25],['LLY',8.79],['NEM',10.18],['MSFT',7.47],['KO',8.76],['JNJ',6.76],['GOOGL',6.41],
  ['AMZN',6.05],['SPY',9.23],['AVGO',4.27],['MA',6.99],['V',6.01],['UNP',5.95],['AAPL',3.88],
]).map(n => ['MA','V','UNP','AAPL'].includes(n.ticker) ? { ...n, phaseOut: true } : n) };
// Synthetic proposal using the reported retention pattern; this is not the unavailable failed run.
const proposal = names([['NVDA',15],['MSFT',11],['AVGO',9],['AAPL',8],['META',7.24],['LLY',9],['KO',8],['MA',6],['V',6],['CVX',5],['BKNG',6.51],['SPY',9.25]]);
const symbols = [...new Set([...proposal, ...prior.names].map(n => n.ticker))];
const universe = symbols.map(t => ({ t, px: 100, hi: 110, lo: 90 }));
const held = prior.names.map(n => n.ticker);
const meta = { asOf: '2026-10-07', researchVersion: 'evidence-v1', universe, prior, held };

test('one-cycle retained holdings participate in the complete capped book', () => {
  const result = finalizeTarget({ picks: proposal }, meta);
  valid(result.target.names);
  for (const ticker of ['NEM','JNJ','GOOGL','AMZN']) {
    assert.equal(result.target.names.find(n => n.ticker === ticker)?.phaseOut, true, ticker);
  }
  assert.ok(result.target.dropped.some(n => n.ticker === 'UNP' && n.reason === 'phase-out-complete'));
  assert.ok(result.target.names.some(n => n.ticker === 'META' && !n.phaseOut));
});

test('scheduled CLI publishes a feasible candidate and preserves it on infeasible retry', () => {
  const temp = mkdtempSync(join(tmpdir(), 'agentic-index-cap-'));
  try {
    cpSync(root, join(temp, 'producer'), { recursive: true, filter: p => !p.includes('/raw') });
    const evidence = [{ source: 'mcp:test/synthetic-fixture', asOf: '2026-10-07', claim: 'Synthetic test quote, range and research evidence' }];
    const raw = {
      researchVersion: 'evidence-v1',
      ranking: universe.map(u => ({ ...u, evidence })),
      research: { evidence: Object.fromEntries(symbols.map(t => [t, Object.fromEntries(['quality','momentum','growth','catalyst'].map(s => [s, { score: 8, status: 'observed', evidence }]))])) },
      verdicts: symbols.map(t => ({ t, businessOk: true, rec: 'buy', evidence })),
      allocation: { picks: proposal },
    };
    const candidate = join(temp, 'candidate.json');
    const canonical = join(temp, 'producer/agentic-target.json');
    writeFileSync(canonical, JSON.stringify(prior));
    const run = (extra = []) => spawnSync(process.execPath, [join(temp, 'producer/finalize-target.mjs'), candidate, '--asOf', '2026-10-07', '--held', held.join(','), '--write', ...extra], { encoding: 'utf8' });
    writeFileSync(candidate, JSON.stringify(raw));
    const good = run();
    assert.equal(good.status, 0, good.stderr);
    const saved = readFileSync(canonical, 'utf8');
    const target = JSON.parse(saved);
    valid(target.names);
    assert.equal(target.research.status, 'verified-coverage');
    raw.allocation.picks = names([['NVDA',45],['MSFT',45],['SPY',10]]);
    writeFileSync(candidate, JSON.stringify(raw));
    const bad = run(['--no-prior']);
    assert.notEqual(bad.status, 0);
    assert.match(bad.stderr, /INVALID_TARGET.*cannot be allocated within hard caps/);
    assert.equal(readFileSync(canonical, 'utf8'), saved, 'failed retry must preserve the last valid target byte-for-byte');
  } finally { rmSync(temp, { recursive: true, force: true }); }
});

console.log(`${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
