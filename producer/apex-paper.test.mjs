// Apex v2.9 paper engine tests. Synthetic rows only; no network.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { markFailed, unwrap, mergeBatches, setupOf, scoreRow, buildBatch, build, fundamentalScore, rrPoints, tradingDaysBetween, mergeMarks, metricsOf, lin, C, RULES_VERSION, shadowPicks, shadowMetrics, SHADOW, liveLedger, nextOpenMs, settleLive, EVAL, evaluate, SIM, mergePaths, simName, simulate } from './apex-paper.mjs';

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
t('rejected-names ledger: frozen once with the Monday cohort, live gates only from a same-day live file, graded per gate', () => {
  const mon = { today: '2026-11-23', asOf: '2026-11-23T07:55:00-05:00', cohort: true };
  const live = { asOf: '2026-11-23T07:13:00-05:00', rulesVersion: 'v2.8', targets: {}, blockedByTheme: [{ sym: 'ZS', composite: 7.1 }, { sym: 'IREN', composite: 9 }], vetoed: [{ sym: 'REGN', composite: 7.5, why: 'R/R at entry 0.31 < 1.5' }, { sym: 'NVDA', why: 'below SMA200 (1 vs 2)' }] };
  assert.equal(mk().shadow.cohorts.length, 0, 'never frozen off-Monday');
  const d1 = mk({ ...mon, v28: live }); const sc = d1.shadow.cohorts[0];
  assert.equal(d1.shadow.cohorts.length, 1); assert.equal(sc.liveIncluded, true);
  assert.deepEqual(sc.picks.map(p => p.gate + ':' + p.sym), ['live-tech-cap:ZS', 'live-rr:REGN', 'paper-growth-low:NEAR']);
  assert.ok(sc.picks.every(p => p.status === 'pending' && p.entryPx === null && p.entryRule === 'next session open'));
  assert.ok(!d1.cohorts[0].picks.some(p => sc.picks.some(x => x.sym === p.sym)), 'a ledger name is never also a pick');
  const stale = mk({ ...mon }); assert.equal(stale.shadow.cohorts[0].liveIncluded, false);
  assert.deepEqual(stale.shadow.cohorts[0].picks.map(p => p.sym), ['NEAR'], 'a stale live file adds no live names');
  assert.equal(mk({ ...mon, asOf: '2026-11-23T12:00:00-05:00', prior: d1 }).shadow.cohorts.length, 1, 'no second ledger the same day');
  const part = build({ batches: [{ label: 'a', payload: payload([row('AAA')], 300) }], bench, ...mon }); assert.equal(part.shadow.cohorts.length, 0);
  const d3 = mk({ today: '2026-12-01', asOf: '2026-12-01T07:55:00-05:00', prior: d1,
    shadowFills: { [sc.asOf]: { ZS: { entryPx: 200, entryDate: '2026-11-24', status: 'entered' }, REGN: { entryPx: 900, entryDate: '2026-11-24', status: 'entered' } } },
    shadowMarks: [{ asOf: sc.asOf, sym: 'ZS', horizon: 5, ret: 4, spyRet: 1, alpha: 3 }, { asOf: sc.asOf, sym: 'REGN', horizon: 5, ret: -1, spyRet: 1, alpha: -2 }, { asOf: sc.asOf, sym: 'NEAR', horizon: 5, ret: 9, spyRet: 1, alpha: 8 }] });
  assert.equal(d3.shadow.cohorts[0].picks.find(p => p.sym === 'ZS').entryPx, 200);
  assert.deepEqual(d3.shadow.metrics['live-tech-cap'][5], { n: 1, hit: 1, avgAlpha: 3, avgAlphaNet: 2.8 });
  assert.deepEqual(d3.shadow.metrics['live-rr'][5], { n: 1, hit: 0, avgAlpha: -2, avgAlphaNet: -2.2 });
  assert.equal(d3.shadow.metrics['paper-growth-low'], undefined, 'a name with no paper fill is never graded');
  assert.equal(d3.metrics[5], undefined, 'ledger marks never leak into the pick record');
  const d4 = mk({ today: '2026-12-02', asOf: '2026-12-02T07:55:00-05:00', prior: d3, shadowMarks: [{ asOf: sc.asOf, sym: 'ZS', horizon: 5, alpha: 99 }] });
  assert.equal(d4.shadow.metrics['live-tech-cap'][5].avgAlpha, 3, 'a stored ledger mark is never recomputed');
  assert.equal(markFailed(d3, 'x', 'y').shadow.cohorts.length, 1, 'a failed run keeps the ledger');
  const many = Array.from({ length: 9 }, (_, i) => ({ sym: 'N' + i, composite: 9 - i, failKeys: ['rr'] }));
  assert.equal(shadowPicks(many, null, '2026-11-23').picks.length, SHADOW.PER_GATE);
  assert.equal(shadowPicks([{ sym: 'E', failKeys: ['earnings'] }, { sym: 'T', failKeys: ['rr', 'pe'] }], null, 'x').picks.length, 0);
  assert.deepEqual(shadowMetrics(null, null), {});
});
t('late live names: added on any run before the next open, marked missing after it, never silent', () => {
  const mon = { today: '2026-11-23', asOf: '2026-11-23T07:52:00-05:00', cohort: true };
  const live = { asOf: '2026-11-23T07:13:00-05:00', rulesVersion: 'v2.8', targets: { DXCM: 20, IREN: 40 }, top5: [{ sym: 'DXCM', composite: 7.9 }], blockedByTheme: [{ sym: 'ZS', composite: 7.1 }], vetoed: [{ sym: 'REGN', composite: 7.5, why: 'R/R at entry 0.31 < 1.5' }] };
  const d1 = mk({ ...mon, v28: { ...live, asOf: '2026-11-16T07:13:00-05:00' } }); const c1 = d1.shadow.cohorts[0];
  assert.equal(c1.liveIncluded, false); assert.equal(c1.liveStatus, 'pending'); assert.match(c1.liveNote, /targets copy/);
  assert.equal(d1.shadow.live.status, 'pending');
  const d2 = mk({ today: '2026-11-24', asOf: '2026-11-24T07:52:00-05:00', prior: d1, v28: live }); const c2 = d2.shadow.cohorts[0];
  assert.equal(c2.liveIncluded, true); assert.equal(c2.liveStatus, 'added-late'); assert.equal(c2.liveAddedAt, '2026-11-24T07:52:00-05:00');
  assert.deepEqual(c2.picks.filter(p => p.source === 'live v2.8').map(p => p.gate + ':' + p.sym), ['live-pick:DXCM', 'live-tech-cap:ZS', 'live-rr:REGN']);
  assert.equal(c2.picks.find(p => p.gate === 'live-pick').composite, 7.9);
  assert.ok(c2.picks.every(p => p.status === 'pending' && p.entryRule === 'next session open'), 'late names enter at the same open as the rest');
  assert.ok(!c2.picks.some(p => p.sym === 'IREN'), 'owner-managed core never enters the ledger');
  assert.equal(c2.asOf, c1.asOf, 'the cohort date never moves');
  assert.equal(mk({ today: '2026-11-24', asOf: '2026-11-24T08:30:00-05:00', prior: d2, v28: live }).shadow.cohorts[0].picks.length, c2.picks.length, 'settling twice adds nothing');
  const late = mk({ today: '2026-11-24', asOf: '2026-11-24T09:45:00-05:00', prior: d1, v28: live }).shadow.cohorts[0];
  assert.equal(late.liveIncluded, false); assert.equal(late.liveStatus, 'missing'); assert.ok(!late.picks.some(p => p.source === 'live v2.8'), 'no live name after the open (no look-ahead)');
  assert.match(late.liveNote, /missing/);
  const sameDay = mk({ ...mon, asOf: '2026-11-23T12:31:00-05:00', prior: d1, v28: live }).shadow.cohorts[0];
  assert.equal(sameDay.liveStatus, 'added-late', 'the 12:30 PM copy also counts');
  assert.equal(settleLive(late, live, '2026-11-25T07:52:00-05:00'), late, 'a missing week stays missing');
  assert.equal(nextOpenMs('2026-11-27T07:52:00-05:00'), Date.parse('2026-11-30T09:30:00-05:00'), 'Friday rolls to Monday');
  assert.deepEqual(liveLedger(null), []);
});
t('a Monday that freezes no cohort is recorded as skipped, with the reason', () => {
  const part = build({ batches: [{ label: 'tech-a', payload: payload([row('AAA')], 300) }], bench, today: '2026-11-23', asOf: '2026-11-23T07:52:00-05:00', cohort: true });
  assert.equal(part.cohorts.length, 0); assert.deepEqual(part.skipped.map(x => x.date), ['2026-11-23']); assert.match(part.skipped[0].reason, /coverage partial: tech-a/);
  const again = build({ batches: [{ label: 'tech-a', payload: payload([row('AAA')], 300) }], bench, today: '2026-11-23', asOf: '2026-11-23T08:00:00-05:00', cohort: true, prior: part });
  assert.equal(again.skipped.length, 1, 'one entry per Monday');
  assert.deepEqual(mk().skipped, [], 'a weekday run skips nothing');
  const f = markFailed(mk(), '2026-11-30T07:58:00-05:00', 'scanner refused'); assert.equal(f.skipped[0].date, '2026-11-30'); assert.match(f.skipped[0].reason, /run failed: scanner refused/);
  assert.equal(markFailed(mk(), '2026-12-01T07:58:00-05:00', 'x').skipped.length, 0, 'a failed Tuesday is not a skipped Monday');
});
t('evaluation spec eval-1 is locked and every arm is measured the same way', () => {
  assert.equal(EVAL.version, 'eval-1'); assert.deepEqual(EVAL.horizons, [5, 30, 60, 90]); assert.equal(EVAL.primaryHorizon, 30);
  assert.equal(EVAL.costPctRoundTrip, 0.20); assert.equal(EVAL.costPctRoundTrip, SHADOW.COST_PP); assert.equal(EVAL.minCohorts, 12); assert.equal(EVAL.noFillDays, 10);
  assert.deepEqual(EVAL.arms.map(a => a.key), ['live', 'paper', 'rejectedLive', 'rejectedPaper']);
  assert.ok(Object.isFrozen(EVAL) && Object.isFrozen(EVAL.arms));
  const co = [{ asOf: 'c1', picks: [{ sym: 'AAA', status: 'entered' }, { sym: 'BBB', status: 'pending' }] }];
  const sc = [{ asOf: 'c1', picks: [{ sym: 'DXCM', gate: 'live-pick', status: 'entered' }, { sym: 'ZS', gate: 'live-tech-cap', status: 'entered' }, { sym: 'N', gate: 'paper-rr', status: 'entered' }, { sym: 'N', gate: 'paper-pe', status: 'entered' }] }];
  const e = evaluate(co, [{ asOf: 'c1', sym: 'AAA', horizon: 5, alpha: 2 }, { asOf: 'c1', sym: 'BBB', horizon: 5, alpha: 50 }],
    sc, [{ asOf: 'c1', sym: 'DXCM', horizon: 5, alpha: -1 }, { asOf: 'c1', sym: 'ZS', horizon: 5, alpha: 3 }, { asOf: 'c1', sym: 'N', horizon: 5, alpha: 4 }, { asOf: 'c1', sym: 'ZS', horizon: 7, alpha: 9 }]);
  assert.deepEqual(e.arms.paper.horizons[5], { n: 1, hit: 1, avgAlpha: 2, medianAlpha: 2, avgAlphaNet: 1.8 }, 'a pending pick is never graded');
  assert.deepEqual(e.arms.live.horizons[5], { n: 1, hit: 0, avgAlpha: -1, medianAlpha: -1, avgAlphaNet: -1.2 });
  assert.equal(e.arms.rejectedLive.horizons[7], undefined, 'only spec horizons count');
  assert.equal(e.arms.rejectedPaper.horizons[5].n, 1, 'a name under two paper gates counts once in its arm');
  assert.equal(e.arms.live.descriptive, true); assert.equal(e.simulated, null); assert.match(e.simulatedNote, /daily price path/);
  assert.deepEqual(evaluate(null, null, null, null).arms.live, { label: 'Live v2.8 picks', cohorts: 0, entered: 0, horizons: {}, descriptive: true });
  assert.ok(mk().evaluation && mk().evaluation.version === 'eval-1', 'every published file carries the evaluation block');
});
t('sim-1: daily paths merge without overwriting a stored day, and only the newest 26 cohorts are kept', () => {
  assert.equal(SIM.version, 'sim-1'); assert.equal(SIM.holdDays, 30); assert.equal(SIM.costPctRoundTrip, EVAL.costPctRoundTrip); assert.ok(Object.isFrozen(SIM));
  const a = mergePaths({ c1: { AAA: [['2026-11-24', 10, 9, 10]] } }, { c1: { AAA: [['2026-11-24', 99, 99, 99], ['2026-11-25', 10, 9.5, 11], ['bad', 1, 1, 1], ['2026-11-26', 10, -1, 10]] } });
  assert.deepEqual(a.c1.AAA, [['2026-11-24', 10, 9, 10], ['2026-11-25', 10, 9.5, 11]]);
  const many = {}; for (let i = 0; i < 30; i++) many['2026-' + String(100 + i)] = { X: [['2026-11-24', 1, 1, 1]] };
  const kept = Object.keys(mergePaths(many, null)); assert.equal(kept.length, 26); assert.equal(kept[0], '2026-104');
  assert.deepEqual(mergePaths(null, null), {});
});
t('sim-1: a name exits at its stop, at the open on a gap below it, or after the hold', () => {
  const pk = { sym: 'AAA', status: 'entered', entryPx: 100, entryDate: '2026-11-24', stop: 90 };
  const rows = [['2026-11-24', 100, 95, 98], ['2026-11-25', 97, 93, 96], ['2026-11-26', 85, 80, 82], ['2026-11-27', 90, 88, 89]];
  const gap = simName(pk, rows, 5);
  assert.equal(gap.stopped, true); assert.equal(gap.exitDate, '2026-11-26'); assert.equal(gap.retPct, -15, 'gap through the stop fills at the open'); assert.equal(gap.maxDrawdownPct, -15);
  const touch = simName(pk, [['2026-11-24', 100, 89, 95]], 5); assert.equal(touch.retPct, -10); assert.equal(touch.stopped, true);
  const held = simName(pk, rows.slice(0, 2), 1); assert.equal(held.complete, true); assert.equal(held.stopped, false); assert.equal(held.retPct, -4); assert.equal(held.maxDrawdownPct, -7);
  const open = simName(pk, rows.slice(0, 2), 5); assert.equal(open.complete, false, 'still inside the hold');
  assert.equal(simName(pk, rows.slice(1), 5), null, 'a path must start on the entry day');
  assert.equal(simName({ ...pk, status: 'pending' }, rows, 5), null);
  assert.equal(simName({ ...pk, stop: null }, rows, 5).stopped, false, 'no stop, no stop exit');
});
t('sim-1: cohort portfolios keep frozen weights (rest cash), live picks equal weight, SPY-relative and net of cost', () => {
  const co = [{ asOf: 'c1', picks: [{ sym: 'AAA', w: 30, stop: 90, status: 'entered', entryPx: 100, entryDate: '2026-11-24' }, { sym: 'BBB', w: 20, status: 'entered', entryPx: 50, entryDate: '2026-11-24' }] }];
  const sc = [{ asOf: 'c1', picks: [{ sym: 'AAA', gate: 'live-pick', status: 'entered', entryPx: 100, entryDate: '2026-11-24' }, { sym: 'ZS', gate: 'live-tech-cap', status: 'entered', entryPx: 10, entryDate: '2026-11-24' }] }];
  const paths = { c1: { AAA: [['2026-11-24', 100, 99, 110], ['2026-11-25', 110, 88, 89]], BBB: [['2026-11-24', 50, 49, 55], ['2026-11-25', 55, 54, 60]], SPY: [['2026-11-24', 700, 690, 700], ['2026-11-25', 700, 700, 707]] } };
  assert.equal(simulate(co, sc, null), null); assert.equal(evaluate(co, [], sc, [], null).simulated, null);
  const s = simulate(co, sc, paths, 1);
  const p = s.arms.paper.perCohort[0];
  assert.equal(p.complete, true); assert.equal(p.stops, 1); assert.equal(p.investedPct, 50);
  assert.equal(p.retNetPct, 0.9, '30% x -10% (stop) + 20% x +20% = +1.0, minus 0.20 x 50% invested');
  assert.equal(p.spyRetPct, 1); assert.equal(p.alphaNetPct, -0.1); assert.equal(p.maxDrawdownPct, -3.81, 'peak 105 after day 1, 101 after the stop');
  assert.equal(s.arms.paper.cohorts, 1); assert.equal(s.arms.paper.descriptive, true);
  const l = s.arms.live.perCohort[0];
  assert.equal(l.names, 1, 'only live-pick names form the live arm'); assert.equal(l.investedPct, 100); assert.equal(l.stops, 0, 'live picks carry no stored stop');
  assert.equal(l.retNetPct, -11.2);
  const inProg = simulate(co, sc, paths, 5); assert.equal(inProg.arms.paper.cohorts, 0); assert.equal(inProg.arms.paper.inProgress, 1, 'a cohort inside its hold is counted as in progress, not graded');
  assert.equal(evaluate(co, [], sc, [], paths).simulated.version, 'sim-1');
});
t('sim-1: a Monday freeze stores each pick\'s stop and target; --paths rows are kept in the published file', () => {
  const mon = { today: '2026-11-23', asOf: '2026-11-23T07:52:00-05:00', cohort: true };
  const d = mk(mon); const pk = d.cohorts[0] && d.cohorts[0].picks[0];
  assert.ok(pk, 'a cohort was frozen'); assert.ok(pk.stop > 0 && pk.tp1 > pk.stop, 'stop and target frozen with the pick');
  const q = d.ranked.qualified.find(x => x.sym === pk.sym); assert.equal(pk.stop, q.stop); assert.equal(pk.tp1, q.tp1);
  const d2 = mk({ today: '2026-11-24', asOf: '2026-11-24T07:52:00-05:00', prior: d, newPaths: { [d.cohorts[0].asOf]: { [pk.sym]: [['2026-11-24', 100, 99, 101]] } } });
  assert.deepEqual(d2.paths[d.cohorts[0].asOf][pk.sym], [['2026-11-24', 100, 99, 101]]);
  assert.ok(d2.evaluation.simulated, 'simulation block present once paths exist');
  assert.deepEqual(mk().paths, {});
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
