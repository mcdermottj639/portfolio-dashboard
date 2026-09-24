// producer/momentum.test.mjs — pins the rubric AND the staleness gate.
import assert from 'node:assert';
import { momentumFor, momentumScores, closes, sma, ret,
         FRESH_DAYS, AGING_DAYS, AGING_CONF, MIN_BARS } from './momentum.mjs';

const day = (i) => new Date(Date.UTC(2026, 0, 1) + i * 86400000).toISOString().slice(0, 10);
// n bars ending `endAgo` days before asOf, compounding at `drift` per bar.
const series = (n, start, drift, endAgo = 0, asOfIdx = 400) => {
  const out = []; let p = start;
  for (let i = 0; i < n; i++) { out.push({ begins_at: day(asOfIdx - endAgo - (n - 1 - i)), close_price: p.toFixed(4) }); p *= (1 + drift); }
  return out;
};
const ASOF = day(400);
const flat = (n, v = 100, endAgo = 0) => series(n, v, 0, endAgo);

let pass = 0; const ok = (m) => { pass++; console.log('  ok -', m); };

// ---- bar reading -------------------------------------------------------------------------------
{
  const mixed = [
    { begins_at: '2026-01-01', close_price: '10.5' },   // Claude shape
    { t: '2026-01-02', c: 11 },                          // Railway shape
    { t: '2026-01-03', c: 12, interpolated: true },      // placeholder — no real close
    { t: '2026-01-04', c: 13, live: true },              // intraday print, not a close
    { t: '2026-01-05', c: 0 },                           // junk
  ];
  assert.deepStrictEqual(closes(mixed).map(x => x.c), [10.5, 11]);
  ok('both bar shapes coalesced; interpolated/live/zero rows dropped');
  assert.strictEqual(sma([1, 2, 3, 4], 2), 3.5);
  assert.strictEqual(sma([1, 2], 5), null);
  assert.strictEqual(Math.round(ret([100, 110], 1)), 10);
  ok('sma/ret abstain rather than guess when the window is short');
}

// ---- THE DEFECT THIS GATE EXISTS FOR -----------------------------------------------------------
// A series that stops, stops at its own high. On 2026-08-14 that scored MU/WULF/NBIS a perfect 10.00
// at "0.0% off the high". A stale name must ABSTAIN, never rank.
{
  const spy = flat(200, 500).map(b => Number(b.close_price));
  const stale = series(200, 10, 0.004, 60);                 // strong uptrend, but 60 days old
  const r = momentumFor('GHOST', stale, spy, 40, ASOF);
  assert.strictEqual(r.score, null, 'a 60-day-stale series must not score');
  assert.strictEqual(r.status, 'missing');
  assert.deepStrictEqual(r.evidence, [], 'an abstention carries no evidence');
  assert.match(r.note, /stale/);
  ok('60-day-stale series ABSTAINS — the MU/WULF/NBIS phantom-10.00 regression');

  const fresh = series(200, 10, 0.004, 0);
  const rf = momentumFor('REAL', fresh, spy, fresh.at(-1).close_price * 1, ASOF);
  assert.ok(typeof rf.score === 'number' && rf.score > 7, 'the same uptrend, fresh, scores well');
  ok('identical trend scores when the bars actually reach the measurement date');
}

// ---- aging haircut binds on one side only ------------------------------------------------------
{
  const spy = flat(200, 500).map(b => Number(b.close_price));
  const mk = (endAgo) => { const b = series(200, 10, 0.004, endAgo); return momentumFor('X', b, spy, Number(b.at(-1).close_price), ASOF); };
  const fresh = mk(FRESH_DAYS - 1), aging = mk(FRESH_DAYS + 5);
  assert.ok(fresh.score > aging.score, 'an aging series cannot outrank a fresh one at equal merit');
  assert.ok(Math.abs(aging.score - fresh.score * AGING_CONF) < 0.25, 'the haircut is AGING_CONF, not an arbitrary penalty');
  assert.strictEqual(mk(AGING_DAYS + 1).score, null, 'past AGING_DAYS it abstains entirely');
  ok(`aging haircut x${AGING_CONF} binds between ${FRESH_DAYS} and ${AGING_DAYS} days, abstains past it`);
}

// ---- absent != zero ----------------------------------------------------------------------------
{
  const spy = flat(200, 500).map(b => Number(b.close_price));
  assert.strictEqual(momentumFor('NOQ', flat(200), spy, 0, ASOF).score, null, 'no quote => abstain');
  assert.strictEqual(momentumFor('THIN', flat(MIN_BARS - 1), spy, 100, ASOF).score, null, 'too few bars => abstain');
  ok('a missing quote or a thin series abstains rather than scoring a neutral 5');
}

// ---- RS actually discriminates, and is measured vs SPY -----------------------------------------
{
  const spyUp = series(200, 500, 0.004, 0).map(b => Number(b.close_price));
  const bars  = series(200, 10, 0.004, 0);                 // same trend as the benchmark
  const px    = Number(bars.at(-1).close_price);
  const matched = momentumFor('MATCH', bars, spyUp, px, ASOF);
  const flatSpy = momentumFor('LEAD',  bars, flat(200, 500).map(b => Number(b.close_price)), px, ASOF);
  assert.ok(flatSpy.score > matched.score, 'beating a flat market must score above matching a rising one');
  ok('relative strength is measured against SPY, not in absolute terms');

  const down = series(200, 60, -0.004, 0);
  const rd = momentumFor('BROKEN', down, spyUp, Number(down.at(-1).close_price), ASOF);
  assert.ok(rd.score < 3, `a name deep below its MAs against a rising tape scores low (got ${rd.score})`);
  ok('a broken downtrend scores low, per the sleeve rubric it replaces');
}

// ---- the sleeve-agent shape --------------------------------------------------------------------
{
  const histDay = { SPY: flat(200, 500), AAA: series(200, 10, 0.004, 0), STALE: series(200, 10, 0.004, 60) };
  const out = momentumScores({ symbols: ['AAA', 'STALE', 'MISSING'], histDay,
    quotes: { AAA: { last_trade_price: '22.1' }, STALE: 40, MISSING: 5 }, asOf: ASOF });
  assert.ok(Array.isArray(out.scores) && out.scores.length === 3, 'returns { scores: [...] } like a sleeve');
  const byT = Object.fromEntries(out.scores.map(s => [s.ticker, s]));
  assert.strictEqual(byT.STALE.status, 'missing');
  assert.strictEqual(byT.MISSING.status, 'missing', 'a symbol with no bars abstains');
  assert.strictEqual(byT.AAA.status, 'observed');
  assert.ok(byT.AAA.evidence.length === 1 && /^mcp:Robinhood-get_equity_historicals/.test(byT.AAA.evidence[0].source),
    'evidence cites the PROVIDER RECORD the bars came from — validEvidence rejects anything else');
  assert.match(byT.AAA.evidence[0].claim, /momentum\.mjs/, 'the claim names the module that computed the score');
  assert.ok(/\d{4}-\d{2}-\d{2}/.test(byT.AAA.evidence[0].asOf), 'evidence asOf is the last real bar date');
  assert.ok(out.scores.every(s => 'ticker' in s && 'score' in s && 'note' in s && 'status' in s && 'evidence' in s),
    'every row matches SLEEVE_SCHEMA required keys');
  ok('momentumScores returns exactly the sleeve-agent contract');
}

// ---- quote shapes ------------------------------------------------------------------------------
{
  const histDay = { SPY: flat(200, 500), AAA: series(200, 10, 0.004, 0) };
  const a = momentumScores({ symbols: ['AAA'], histDay, quotes: { AAA: 22.1 }, asOf: ASOF }).scores[0];
  const b = momentumScores({ symbols: ['AAA'], histDay, quotes: { AAA: { last_trade_price: '22.1' } }, asOf: ASOF }).scores[0];
  const c = momentumScores({ symbols: ['AAA'], histDay, quotes: { AAA: { c: 22.1 } }, asOf: ASOF }).scores[0];
  assert.strictEqual(a.score, b.score); assert.strictEqual(b.score, c.score);
  ok('bare number, Robinhood quote and compact bar shapes all price identically');
}

// ---- score is bounded --------------------------------------------------------------------------
{
  const spy = flat(200, 500).map(b => Number(b.close_price));
  for (const d of [-0.02, -0.004, 0, 0.004, 0.02]) {
    const bars = series(200, 50, d, 0);
    const r = momentumFor('B', bars, spy, Number(bars.at(-1).close_price), ASOF);
    if (r.score != null) assert.ok(r.score >= 0 && r.score <= 10, `score in range for drift ${d} (got ${r.score})`);
  }
  ok('score stays within 0-10 across the whole drift range');
}

// ---- THE EVIDENCE GATE IS THE REAL CONTRACT ------------------------------------------------------
// momentum rows were being silently dropped from the supported-sleeve count because the source named
// the CALCULATOR ('producer/momentum.mjs') rather than a provider record, which agentic-evidence.mjs
// requires. A target built on it was refused with an error that never mentioned momentum. Assert
// against the real validator, not a hand-rolled shape check.
{
  const { validEvidence } = await import('./agentic-evidence.mjs');
  const spy = flat(200, 500).map(b => Number(b.close_price));
  const bars = series(200, 10, 0.004, 0);
  const r = momentumFor('X', bars, spy, Number(bars.at(-1).close_price), ASOF);
  assert.ok(validEvidence(r.evidence, ASOF, 14), 'momentum evidence must pass validEvidence at the 14-day momentum window');
  assert.match(r.evidence[0].source, /^mcp:/, 'source names the provider record, not the transform');
  assert.match(r.evidence[0].claim, /momentum\.mjs/, 'the claim still names the module that computed it');
  assert.ok(r.evidence[0].claim.trim().length >= 8, 'claim meets the minimum length the validator enforces');
  const stale = momentumFor('OLD', series(200, 10, 0.004, 20), spy, 40, ASOF);
  assert.ok(stale.score === null || !validEvidence(stale.evidence, ASOF, 14),
    'a series too old to be momentum evidence must not present passing evidence');
  ok('evidence satisfies agentic-evidence.validEvidence — the gate that actually admits a target');
}

console.log(`\nmomentum.test.mjs — ${pass} groups passed`);
