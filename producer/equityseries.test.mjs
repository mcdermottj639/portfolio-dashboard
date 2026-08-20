// Unit tests for the recorded account-equity series — the shared basis of BOTH accounts' real YTD.
//   node producer/equityseries.test.mjs
import assert from 'node:assert/strict';
import { appendEquityPoint, inferFlow, flowThreshold, HISTORY_CAP } from './equityseries.mjs';

let n = 0; const t = (name, fn) => { fn(); n++; console.log(`  ✓ ${name}`); };
const pos = (o) => Object.entries(o).map(([symbol, [qty, px]]) => ({ symbol, qty, px }));

console.log('flowThreshold — scales with the book but is capped');
t('a small book uses the $40 absolute floor', () => { assert.equal(flowThreshold(300), 40); });
t('a $5k book uses 8% = $400', () => { assert.equal(flowThreshold(5000), 400); });
t('a big book is capped at $750, not 8% (a $19k book would need $1,520 otherwise)', () => {
  assert.equal(flowThreshold(19000), 750);
});

console.log('inferFlow — a deposit is what price moves cannot explain');
t('pure price appreciation is NOT a flow', () => {
  const before = pos({ AAPL: [10, 100] }), after = pos({ AAPL: [10, 130] });
  assert.equal(inferFlow(1000, before, 1300, after), 0);
});
t('a deposit that lands in cash IS a flow', () => {
  const before = pos({ AAPL: [10, 100] }), after = pos({ AAPL: [10, 100] });
  assert.equal(inferFlow(1000, before, 6000, after), 5000);
});
t('a deposit plus a price move separates cleanly', () => {
  const before = pos({ AAPL: [10, 100] }), after = pos({ AAPL: [10, 110] });
  // equity 1000 → 6100: +100 price, +5000 deposit
  assert.equal(inferFlow(1000, before, 6100, after), 5000);
});
t('an internal buy nets to ~0 (cash out, shares in)', () => {
  const before = pos({ AAPL: [10, 100] });                       // 1000 in stock + 500 cash = 1500
  const after = pos({ AAPL: [10, 100], MSFT: [5, 100] });        // 1500 in stock + 0 cash = 1500
  assert.equal(inferFlow(1500, before, 1500, after), 0);
});
t('a move inside the noise floor is ignored', () => {
  const before = pos({ AAPL: [10, 100] }), after = pos({ AAPL: [10, 100] });
  assert.equal(inferFlow(1000, before, 1030, after), 0);         // $30 < $40 floor
});
t('a withdrawal is a negative flow', () => {
  const before = pos({ AAPL: [10, 100] }), after = pos({ AAPL: [10, 100] });
  assert.equal(inferFlow(5000, before, 3000, after), -2000);
});
t('no prior snapshot → 0, never a phantom deposit', () => {
  assert.equal(inferFlow(null, null, 5000, []), 0);
});
t('an unquotable position holds its last price rather than reading as a transfer', () => {
  const before = pos({ AAPL: [10, 100] });
  assert.equal(inferFlow(1000, before, 1000, []), 0);
});

console.log('inferFlow — the options book is P&L, not a transfer (self-directed only)');
t('a short call moving against you is not a withdrawal', () => {
  const p = pos({ IREN: [350, 42] });
  // equity falls 300 purely because options_value went -597 → -897
  assert.equal(inferFlow(18648, p, 18348, p, -897, -597), 0);
});
t('a deposit is still caught with an options book present', () => {
  const p = pos({ IREN: [350, 42] });
  assert.equal(inferFlow(18648, p, 23648, p, -597, -597), 5000);
});
t('omitting the options terms leaves the old two-term behavior', () => {
  const p = pos({ IREN: [350, 42] });
  assert.equal(inferFlow(18648, p, 18348, p), 0);   // -300 is inside the $750 cap floor
});

console.log('appendEquityPoint — one point per day, latest wins');
t('records the first point with cumFlow 0', () => {
  const r = appendEquityPoint({ prev: [], day: '2026-08-20', equity: 18648, positions: [] });
  assert.deepEqual(r.history, [{ t: '2026-08-20', equity: 18648, cumFlow: 0 }]);
});
t('an intraday re-run OVERWRITES the day (13 runs ≠ 13 points)', () => {
  const a = appendEquityPoint({ prev: [], day: '2026-08-20', equity: 100, positions: [] });
  const b = appendEquityPoint({ prev: a.history, day: '2026-08-20', equity: 120, positions: [] });
  assert.equal(b.history.length, 1);
  assert.equal(b.history[0].equity, 120);
});
t('cumFlow accumulates across days', () => {
  const p = pos({ AAPL: [10, 100] });
  const a = appendEquityPoint({ prev: [], day: '2026-08-19', equity: 1000, positions: p });
  const b = appendEquityPoint({ prev: a.history, day: '2026-08-20', equity: 6000, positions: p,
    priorEquity: 1000, priorPositions: p });
  assert.equal(b.flow, 5000);
  assert.equal(b.history[1].cumFlow, 5000);
});
t('a flow-free day carries the running cumFlow forward, not 0', () => {
  const p = pos({ AAPL: [10, 100] });
  let h = appendEquityPoint({ prev: [], day: '2026-08-18', equity: 1000, positions: p }).history;
  h = appendEquityPoint({ prev: h, day: '2026-08-19', equity: 6000, positions: p, priorEquity: 1000, priorPositions: p }).history;
  const c = appendEquityPoint({ prev: h, day: '2026-08-20', equity: 6100, positions: pos({ AAPL: [10, 110] }),
    priorEquity: 6000, priorPositions: p });
  assert.equal(c.flow, 0);
  assert.equal(c.history[2].cumFlow, 5000);
});
t('points stay sorted even when supplied out of order', () => {
  const prev = [{ t: '2026-08-20', equity: 2, cumFlow: 0 }, { t: '2026-08-18', equity: 1, cumFlow: 0 }];
  const r = appendEquityPoint({ prev, day: '2026-08-19', equity: 3, positions: [] });
  assert.deepEqual(r.history.map((e) => e.t), ['2026-08-18', '2026-08-19', '2026-08-20']);
});
t('history is capped at a trading year', () => {
  const prev = Array.from({ length: HISTORY_CAP + 20 }, (_, i) =>
    ({ t: `2025-01-${String((i % 28) + 1).padStart(2, '0')}`, equity: 100 + i, cumFlow: 0 }));
  const r = appendEquityPoint({ prev, day: '2026-08-20', equity: 500, positions: [] });
  assert.equal(r.history.length, HISTORY_CAP);
  assert.equal(r.history[r.history.length - 1].t, '2026-08-20');
});
t('zero / negative / missing equity records nothing but keeps the history', () => {
  const prev = [{ t: '2026-08-19', equity: 100, cumFlow: 0 }];
  for (const eq of [0, -5, null, undefined, 'x']) {
    const r = appendEquityPoint({ prev, day: '2026-08-20', equity: eq, positions: [] });
    assert.deepEqual(r.history, prev);
  }
});
t('optionsValue is recorded so the next run can difference it', () => {
  const r = appendEquityPoint({ prev: [], day: '2026-08-20', equity: 18648, positions: [], optionsValue: -597 });
  assert.equal(r.history[0].optionsValue, -597);
});
t('an account with no options book records no optionsValue key', () => {
  const r = appendEquityPoint({ prev: [], day: '2026-08-20', equity: 5000, positions: [] });
  assert.ok(!('optionsValue' in r.history[0]));
});

console.log(`\n✅ equityseries: ${n} assertions passed`);
