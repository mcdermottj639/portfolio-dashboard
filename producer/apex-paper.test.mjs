// Apex v2.9 paper engine tests. Synthetic rows only; no network.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { markFailed, unwrap, mergeBatches, setupOf, scoreRow, buildBatch, build, fundamentalScore, rrPoints, tradingDaysBetween, mergeMarks, metricsOf, lin, C, RULES_VERSION } from './apex-paper.mjs';

let n = 0; const t = (name, fn) => { fn(); n++; };
const col = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v == null ? '' : String(v)]));
const row = (sym, o = {}) => ({ ticker: sym, columns: col({ Name: sym + ' Inc', Last: 100, lastClose: 100, sma20: 102, sma50: 96, sma70: 94, sma100: 90, sma200: 80, c63: 90, c126: 75, h20: 108, l20: 97, h63: 125, l63: 86, h126: 125, RSI: 45, 'Average true range': 4, revG: 0.3, 'P/E': 20, 'Earnings date': 20270210, sector: 'Energy', 'Market cap': 9e9, 'Average volume': 2e6, Volume: 1e6, ...o }) });
const payload = (rows, total) => JSON.stringify({ data: { result: { total_items: total ?? rows.length, results: rows } } });
const bench = { last: 700, c63: 700, c126: 700 };
const opts = { today: '2026-11-17' };

t('unwrap reads bare, string and MCP-envelope payloads; junk is null', () => {
  const p = payload([row('AAA')]);
  assert.equal(unwrap(p).rows.length, 1);
  assert.equal(unwrap(JSON.parse(p)).total, 1);
  assert.equal(unwrap(JSON.stringify([{ type: 'text', text: p }])).rows[0].ticker, 'AAA');
  assert.equal(unwrap({ content: [{ type: 'text', text: p }] }).rows.length, 1);
  assert.equal(unwrap('not json'), null); assert.equal(unwrap({}), null);
});
t('mergeBatches de-duplicates and flags a short batch as incomplete', () => {
  const full = mergeBatches([{ label: 'a', payload: payload([row('AAA'), row('BBB')]) }, { label: 'b', payload: payload([row('BBB'), row('CCC')]) }]);
  assert.equal(full.rows.length, 3); assert.equal(full.duplicatesRemoved, 1); assert.equal(full.complete, true);
  const short = mergeBatches([{ label: 'a', payload: payload([row('AAA')], 250) }]);
  assert.equal(short.complete, false);
  assert.equal(mergeBatches([{ label: 'x', payload: 'garbage' }]).complete, false);
});
t('blank cells stay unknown, never zero', () => {
  const s = scoreRow(mergeBatches([{ label: 'a', payload: payload([row('AAA', { revG: null, 'P/E': null })]) }]).rows[0], bench, opts);
  assert.equal(s.revGrowthPct, null); assert.equal(s.pe, null);
  assert.ok(s.failKeys.includes('growth-unknown'));
});
const one = (o, b = bench, op = opts) => scoreRow(mergeBatches([{ label: 'a', payload: payload([row('AAA', o)]) }]).rows[0], b, op);
t('three setups classify on price structure', () => {
  assert.equal(one({}).setup, 'B');
  assert.equal(one({ RSI: 62, Last: 120, sma20: 115 }).setup, 'A');
  assert.equal(one({ Last: 78, sma200: 80, sma50: 74, sma20: 76, RSI: 58 }).setup, 'C');
  assert.equal(one({ RSI: 20 }).setup, null);
  assert.equal(setupOf({ last: null }), null);
});
t('a clean pullback qualifies; levels reconcile', () => {
  const s = one({});
  assert.deepEqual(s.fails, []);
  assert.equal(s.entry, 100.3); assert.equal(s.tp1, 125); assert.equal(s.stop, 96); assert.equal(s.stopBasis, '50-day average');
  assert.equal(s.rr, Math.round((125 - 100.3) / (100.3 - 96) * 100) / 100);
  assert.ok(Math.abs(s.composite - (0.4 * s.momentum + 0.35 * s.fundamental + 0.25 * s.rrScore)) < 0.06);
});
t('thresholds hold: R/R floor, P/E cap, negative growth, pullback growth, earnings window', () => {
  assert.ok(one({ h63: 103 }).failKeys.includes('rr'));
  assert.ok(one({ 'P/E': 140 }).failKeys.includes('pe'));
  assert.ok(one({ revG: -0.05 }).failKeys.includes('growth-neg'));
  assert.ok(one({ revG: 0.06 }).failKeys.includes('growth-low'));
  assert.ok(one({ 'Earnings date': 20261119 }).failKeys.includes('earnings'));
  assert.ok(!one({ 'Earnings date': 20261116 }).failKeys.includes('earnings'), 'a past report is not a block');
  assert.equal(C.RR_MIN, 1.5); assert.equal(C.TECH_BATCH_MAX, 0.4); assert.equal(RULES_VERSION, 'v2.9-paper-1');
});
t('R/R unlock price reaches exactly 1.5 with target and stop held', () => {
  const s = one({ h63: 103 }); const m = /entry at \$([\d.]+)/.exec(s.unlock); assert.ok(m);
  const e = Number(m[1]); assert.ok(Math.abs((s.tp1 - e) / (e - s.stop) - 1.5) < 0.02);
});
t('a reversal fails closed until its growth trend is checked, and is half size', () => {
  const c = { Last: 78, sma200: 80, sma50: 74, sma20: 76, sma70: 72, RSI: 58, l63: 60, h63: 95, c63: 70 };
  const s = one(c); assert.equal(s.setup, 'C'); assert.ok(s.failKeys.includes('growth-trend-unchecked')); assert.equal(s.halfSize, true);
  assert.deepEqual(one(c, bench, { ...opts, checks: { AAA: { improving: true } } }).fails, []);
  assert.ok(one(c, bench, { ...opts, checks: { AAA: { improving: false } } }).failKeys.includes('growth-not-improving'));
});
t('theme: tech sectors, a scan themeMap label, and a missing sector all count as tech', () => {
  assert.equal(one({ sector: 'Technology' }).theme, 'tech'); assert.equal(one({ sector: 'Communication Services' }).theme, 'tech');
  assert.equal(one({ sector: null }).theme, 'tech'); assert.equal(one({}).theme, 'Energy');
  assert.equal(one({}, bench, { ...opts, themeMap: { AAA: 'ai-software' } }).theme, 'tech');
});
t('score helpers', () => {
  assert.equal(lin(5, 0, 10), 5); assert.equal(lin(-5, 0, 10), 0); assert.equal(lin(50, 0, 10), 10);
  assert.equal(fundamentalScore(null, 10), 5); assert.equal(fundamentalScore(-1, 10), 2); assert.equal(fundamentalScore(30, 20), 9.5);
  assert.equal(fundamentalScore(30, 90), 3); assert.equal(fundamentalScore(15, 30), 7.5); assert.equal(fundamentalScore(30, null), 5);
  assert.equal(rrPoints(3.5), 9.5); assert.equal(rrPoints(2), 6); assert.equal(rrPoints(1.5), 4); assert.ok(rrPoints(1) < 3);
  assert.equal(tradingDaysBetween('2026-11-17', '2026-11-20'), 3); assert.equal(tradingDaysBetween('2026-11-20', '2026-11-23'), 1);
  assert.equal(tradingDaysBetween('2026-11-17', '2026-11-16'), -1);
});
const Q = (sym, o) => ({ sym, sector: 'Energy', theme: 'Energy', setup: 'B', composite: 8, atr: 2, last: 100, entry: 100.3, entryType: 'limit', ...o });
t('batch: 4 slots, 2 per sector, tech at most 40% of the batch, never others scaled up', () => {
  const b = buildBatch([Q('E1'), Q('E2'), Q('E3'), Q('H1', { sector: 'Healthcare', theme: 'Healthcare' }), Q('I1', { sector: 'Industrials', theme: 'Industrials' }), Q('X1', { sector: 'Utilities', theme: 'Utilities' })]);
  assert.deepEqual(b.picks.map(p => p.sym), ['E1', 'E2', 'H1', 'I1']);
  assert.deepEqual(b.blocked.map(x => x.sym), ['E3']);
  const tech = buildBatch([Q('T1', { sector: 'Technology', theme: 'tech' }), Q('T2', { sector: 'Technology', theme: 'tech' }), Q('E1'), Q('H1', { sector: 'Healthcare', theme: 'Healthcare' })]);
  assert.ok(tech.techBatchPct <= 40.05, 'tech share ' + tech.techBatchPct);
  for (const p of tech.picks) assert.ok(p.weightPct <= C.W_MAX + 0.05);
  const allTech = buildBatch([Q('T1', { sector: 'Technology', theme: 'tech' }), Q('T2', { sector: 'Communication Services', theme: 'tech' })]);
  assert.equal(allTech.picks.length, 0, 'an all-tech batch cannot satisfy the 40% rule and is not forced');
  assert.equal(buildBatch([]).picks.length, 0);
});
const mk = (extra = {}) => build({
  batches: [{ label: 'a', payload: payload([row('AAA'), row('BBB', { sector: 'Healthcare' }), row('ZZZ', { RSI: 20 }), row('NEAR', { revG: 0.06 })]) }],
  bench, today: '2026-11-17', asOf: '2026-11-17T09:22:00-05:00', nextRun: '2026-11-18T07:52:00-05:00',
  v28: { asOf: 'x', rulesVersion: 'v2.8', universeCount: 80, gatedCount: 17, targets: { DXCM: 20 }, themeCap: { current: 76.3 } }, ...extra,
});
t('build: counts reconcile, lists are disjoint, statuses separate candidates from allowed trades', () => {
  const d = mk();
  assert.equal(d.status, 'ok'); assert.equal(d.paper, true); assert.equal(d.universe.scanned, 4); assert.equal(d.universe.eligible, 4);
  assert.equal(d.funnel.setupMatches.B + d.funnel.setupMatches.none + d.funnel.setupMatches.A + d.funnel.setupMatches.C, 4);
  assert.equal(d.funnel.qualified + d.funnel.rejected, 4);
  assert.deepEqual(d.ranked.qualified.map(q => q.sym).sort(), ['AAA', 'BBB']);
  assert.deepEqual(d.ranked.near.map(q => q.sym), ['NEAR']);
  for (const q of d.ranked.qualified) { assert.equal(q.status, 'buy'); assert.ok(q.entry > 0 && q.tp1 > q.entry && q.stop < q.entry); }
  assert.equal(d.ranked.near[0].status, 'watch');
  assert.deepEqual(d.v28.actionable, ['DXCM']); assert.equal(d.v28.universe, 80); assert.equal(d.v28.passed, 17);
  assert.equal(d.lastSuccessAsOf, d.asOf); assert.equal(d.batch.indicative, true); assert.equal(d.cohorts.length, 0);
});
t('build: a short batch is published as partial and keeps the previous success time', () => {
  const d = build({ batches: [{ label: 'a', payload: payload([row('AAA')], 300) }], bench, today: '2026-11-18', asOf: '2026-11-18T07:55:00-05:00', prior: { lastSuccessAsOf: '2026-11-17T09:22:00-05:00' } });
  assert.equal(d.status, 'partial'); assert.equal(d.universe.complete, false); assert.equal(d.lastSuccessAsOf, '2026-11-17T09:22:00-05:00');
  assert.match(d.statusNote, /1 of 1/);
});
t('cohort: frozen once on a complete Monday run; never on a partial run; old picks only gain fills', () => {
  const mon = { today: '2026-11-23', asOf: '2026-11-23T07:55:00-05:00', cohort: true };
  const d1 = mk(mon); assert.equal(d1.cohorts.length, 1); assert.equal(d1.batch.indicative, false);
  assert.ok(d1.cohorts[0].picks.every(p => p.status === 'pending' && p.entryPx === null));
  const d2 = mk({ ...mon, asOf: '2026-11-23T12:00:00-05:00', prior: d1 }); assert.equal(d2.cohorts.length, 1, 'no second cohort the same day');
  const d3 = mk({ today: '2026-11-24', asOf: '2026-11-24T07:55:00-05:00', prior: d1, fills: { [d1.cohorts[0].asOf]: { AAA: { entryPx: 101, entryDate: '2026-11-24', status: 'entered' } } } });
  assert.equal(d3.cohorts[0].picks.find(p => p.sym === 'AAA').entryPx, 101);
  assert.equal(d3.cohorts[0].picks.find(p => p.sym === 'BBB').status, 'pending');
  const part = build({ batches: [{ label: 'a', payload: payload([row('AAA')], 300) }], bench, ...mon }); assert.equal(part.cohorts.length, 0);
});
t('marks are stamped once and metrics come only from stored marks', () => {
  const a = { asOf: 'c1', sym: 'AAA', horizon: 5, ret: 2, spyRet: 1, alpha: 1 };
  const m = mergeMarks([a], [{ ...a, alpha: 9 }, { asOf: 'c1', sym: 'BBB', horizon: 5, alpha: -3 }]);
  assert.equal(m.length, 2); assert.equal(m[0].alpha, 1);
  assert.deepEqual(metricsOf(m)[5], { n: 2, hit: 0.5, avgAlpha: -1 });
  assert.deepEqual(metricsOf([]), {});
});
t('a failed run is marked failed and keeps the last success time separate', () => {
  const ok = mk(); const f = markFailed(ok, '2026-11-18T07:58:00-05:00', 'scanner refused');
  assert.equal(f.status, 'failed'); assert.equal(f.asOf, '2026-11-18T07:58:00-05:00'); assert.equal(f.lastSuccessAsOf, ok.asOf);
  const f2 = markFailed(f, '2026-11-19T07:58:00-05:00', 'again'); assert.equal(f2.lastSuccessAsOf, ok.asOf);
  assert.equal(markFailed(null, 'x', 'y').status, 'failed'); assert.equal(markFailed(null, 'x', 'y').lastSuccessAsOf, null);
});
t('scan spec keeps the approved universe floor and covers all 11 sectors once', () => {
  const spec = JSON.parse(fs.readFileSync(new URL('./apex-paper-scan.json', import.meta.url), 'utf8'));
  assert.deepEqual(spec.universe, { instrumentType: 'STOCK', minMarketCap: 2e9, minAvgVolume30d: 500000, minLast: 10 });
  const whole = spec.batches.filter(b => !b.cap).flatMap(b => b.sectors); const split = [...new Set(spec.batches.filter(b => b.cap).flatMap(b => b.sectors))];
  assert.equal(new Set([...whole, ...split]).size, 11); assert.equal(whole.length + split.length, 11);
  for (const s of split) { const caps = spec.batches.filter(b => b.cap && b.sectors[0] === s).map(b => b.cap); assert.equal(caps.length, 2); assert.equal(caps[0][0], 2e9); assert.equal(caps[0][1], caps[1][0]); assert.equal(caps[1][1], null); }
});
t('paper boundary: the live Apex rules never read this module or its output', () => {
  for (const f of ['../ui/apex.js', '../ui/sd-rules.js']) {
    const src = fs.readFileSync(new URL(f, import.meta.url), 'utf8');
    assert.ok(!/apex-paper/i.test(src), f + ' must not reference the paper research');
  }
});
t('published file, when present, is structurally sound', () => {
  let d; try { d = JSON.parse(fs.readFileSync(new URL('../data/apex-paper-v29.json', import.meta.url), 'utf8')); } catch { return; }
  assert.equal(d.schema, 1); assert.equal(d.paper, true); assert.ok(['ok', 'partial', 'failed'].includes(d.status));
  assert.equal(d.universe.scanned, d.universe.unique);
  const syms = new Set(); for (const k of ['qualified', 'near', 'emerging']) for (const r of d.ranked[k]) { assert.ok(!syms.has(r.sym), 'duplicate ' + r.sym); syms.add(r.sym); }
  for (const r of d.ranked.qualified) { assert.ok(r.rr >= 1.5); assert.ok(r.stop < r.entry && r.entry < r.tp1); assert.equal(r.fails.length, 0); assert.notEqual(r.sym, 'IREN'); }
  if (d.batch.techBatchPct != null) assert.ok(d.batch.techBatchPct <= 40.05);
  assert.ok(!JSON.stringify(d).match(/\b\d{9}\b/), 'no account numbers');
});
console.log(`apex-paper: ${n}/${n} passed`);
