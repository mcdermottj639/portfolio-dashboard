// Unit tests for the recorded account-equity series — the shared basis of BOTH accounts' real YTD.
//   node producer/equityseries.test.mjs
import assert from 'node:assert/strict';
import { appendEquityPoint, inferFlow, inferCashFlow, flowThreshold, HISTORY_CAP, derivativesRealized, brokerageEquity, EXTERNAL_SLEEVE_KEYS } from './equityseries.mjs';

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


/* ── Derivatives sleeve: a prediction-market settlement is RETURN, not a deposit ───────────────────
   Regression for 2026-08-30. A 1,245-contract event position bought for $236.55 settled at $1.00,
   paying $1,245 into a book with $17,469.76 of equity. The payout arrives in cash with no equity
   position to explain it, which is precisely the shape the deposit inference keys on — so without the
   derivatives term ~$995 of REAL profit gets booked as a contribution and the consumer's
   time-weighted return silently drops it (~5.7pp on this book). */
console.log('derivativesRealized — the real Robinhood settlement payload');
// The live row, verbatim: prediction-market settlements carry an EMPTY symbol and side.
const SETTLED = { data: { account_number: '525340741', span: 'month', trades: [
  { timestamp: '2026-08-30T22:31:15Z', symbol: '', side: '', quantity: '1245', price: '1', realized_gain: '1008.45' },
  { timestamp: '2026-08-25T12:50:52Z', symbol: 'CIFR', side: 'sell', quantity: '153', price: '15.56', realized_gain: '-503.38' },
  { timestamp: '2026-08-25T12:50:11Z', symbol: 'TSM', side: 'sell', quantity: '30', price: '416.47', realized_gain: '-829.03' },
] } };
const STEP = { since: '2026-08-28T20:41:45.981Z', until: '2026-08-31T13:35:00.000Z' };

t('only the blank-symbol row counts — equity sells are already modelled by priceMove', () => {
  assert.equal(derivativesRealized(SETTLED, STEP), 1008.45);
});
t("the next run of the same day doesn't subtract the settlement twice", () => {
  assert.equal(derivativesRealized(SETTLED, { since: '2026-08-31T13:35:00.000Z', until: '2026-08-31T14:35:00.000Z' }), 0);
});
t('a settlement past `until` belongs to the NEXT step, not this one', () => {
  assert.equal(derivativesRealized(SETTLED, { since: '2026-08-28T20:41:45.981Z', until: '2026-08-29T00:00:00.000Z' }), 0);
});
t('no `since` ⇒ abstain (never subtract an unbounded 3-month span in one step)', () => {
  assert.equal(derivativesRealized(SETTLED, {}), 0);
  assert.equal(derivativesRealized(SETTLED), 0);
});
t('junk in ⇒ 0, never NaN (a NaN would poison cumFlow for the life of the series)', () => {
  assert.equal(derivativesRealized(null, STEP), 0);
  assert.equal(derivativesRealized({ data: { trades: 'nope' } }, STEP), 0);
  assert.equal(derivativesRealized({ data: { trades: [null,
    { symbol: '', timestamp: 'garbage', realized_gain: '5' },
    { symbol: '', timestamp: '2026-08-30T22:31:15Z', realized_gain: 'n/a' }] } }, STEP), 0);
});
t('a LOSING bet is the same bug sign-flipped — it would read as a withdrawal and flatter the return', () => {
  const lost = { data: { trades: [{ timestamp: '2026-08-30T22:31:15Z', symbol: '', side: '', quantity: '900', price: '0', realized_gain: '-900' }] } };
  assert.equal(derivativesRealized(lost, STEP), -900);
});

console.log('inferFlow — a settled prediction market is profit, not a contribution');
// The real book: positions unchanged and unmoved (markets shut all weekend), the whole $1,008.45
// arriving as cash. Prior equity 17,469.76 ⇒ the noise floor is the $750 cap, so it clears it.
const BOOK = [{ symbol: 'IREN', qty: 350, px: 60 }, { symbol: 'PLTR', qty: 40, px: 180 }];

t('the payout clears the noise floor, so it cannot be ignored into silence', () => {
  assert.equal(flowThreshold(17469.76), 750);
});
t('WITHOUT the term it books a phantom $1,008 deposit (the 2026-08-30 bug, pinned)', () => {
  assert.equal(inferFlow(17469.76, BOOK, 18478.21, BOOK, -27, -27), 1008.45);
});
t('WITH it, no transfer is inferred and the win stays in the return', () => {
  assert.equal(inferFlow(17469.76, BOOK, 18478.21, BOOK, -27, -27, 1008.45), 0);
});
t('a REAL deposit in the same step is still caught, net of the settlement', () => {
  assert.equal(inferFlow(17469.76, BOOK, 20478.21, BOOK, -27, -27, 1008.45), 2000);
});
t('a losing bet would read as a withdrawal and flatter the return; the term cancels it', () => {
  assert.equal(inferFlow(17469.76, BOOK, 16569.76, BOOK, -27, -27), -900);
  assert.equal(inferFlow(17469.76, BOOK, 16569.76, BOOK, -27, -27, -900), 0);
});
t('a non-numeric / absent extraPnl is inert, never NaN-poisoning the series', () => {
  for (const bad of [undefined, NaN, null, 'x']) {
    assert.equal(inferFlow(17469.76, BOOK, 18478.21, BOOK, -27, -27, bad), 1008.45);
  }
});

console.log('appendEquityPoint — the settlement does not move cumFlow');
t('the win raises recorded equity but leaves cumFlow alone (return, not funding)', () => {
  const p = [{ symbol: 'IREN', qty: 350, px: 60 }];
  const prev = [{ t: '2026-08-28', equity: 17469.76, cumFlow: 799.55, optionsValue: -27 }];
  const r = appendEquityPoint({ prev, day: '2026-08-31', equity: 18478.21, positions: p,
    priorEquity: 17469.76, priorPositions: p, optionsValue: -27, priorOptionsValue: -27,
    extraPnl: 1008.45 });
  assert.equal(r.flow, 0);
  assert.equal(r.cumFlow, 799.55);
  assert.equal(r.history[r.history.length - 1].equity, 18478.21);
});

/* ── The cash-based primary (2026-08-30) ──────────────────────────────────────────────────────────
   Regression for the phantom flows traced out of git on the real book: `equity` comes from the
   broker's total_value but position prices come from data.quotes, and quotes carry forward on
   pre-market runs — so the two are sampled on different clocks and the gap landed in `flow`.
   Measured on 2026-08-28: −$1,070.39 at 05:07 (quotes frozen, total_value live), +$920.69 at 14:39
   (quotes caught up and re-booked a move total_value had already absorbed). Cash never moved. */
console.log('inferCashFlow — external money must land in cash; trades cancel themselves out');
const P = (o) => Object.entries(o).map(([symbol, [qty, px]]) => ({ symbol, qty, px }));

t('a pure price move is NOT a flow — even with completely stale quotes (THE bug)', () => {
  // Identical quote prices on both sides while the account value moved: the exact 05:07 shape.
  const held = P({ IREN: [350, 40.54], PLTR: [100, 185.9] });
  assert.equal(inferCashFlow({ priorCash: -13928.24, cash: -13928.24, priorPositions: held, positions: held }), 0);
});
t('a deposit that lands in cash IS caught', () => {
  const held = P({ AAA: [10, 100] });
  assert.equal(inferCashFlow({ priorCash: 300, cash: 5300, priorPositions: held, positions: held }), 5000);
});
t('a deposit DEPLOYED the same run is still caught (it moves qty instead of cash)', () => {
  assert.equal(inferCashFlow({ priorCash: 300, cash: 300,
    priorPositions: P({ AAA: [10, 100] }), positions: P({ AAA: [60, 100] }) }), 5000);
});
t('a withdrawal is a negative flow', () => {
  const held = P({ AAA: [10, 100] });
  assert.equal(inferCashFlow({ priorCash: 5300, cash: 300, priorPositions: held, positions: held }), -5000);
});
t('an internal BUY nets to zero (cash out, shares in)', () => {
  assert.equal(inferCashFlow({ priorCash: 1000, cash: 0,
    priorPositions: P({ AAA: [0, 100] }), positions: P({ AAA: [10, 100] }) }), 0);
});
t('an internal SELL nets to zero — the full-exit case the old formula mispriced', () => {
  assert.equal(inferCashFlow({ priorCash: 0, cash: 900,
    priorPositions: P({ AAA: [10, 90] }), positions: [] }), 0);
});
t('a prediction-market settlement nets to zero via extraPnl', () => {
  const held = P({ IREN: [350, 40.54] });
  assert.equal(inferCashFlow({ priorCash: -13928.24, cash: -12933.21,
    priorPositions: held, positions: held, extraPnl: 995.03 }), 0);
});
t('a real deposit ARRIVING WITH a settlement separates cleanly', () => {
  const held = P({ IREN: [350, 40.54] });
  assert.equal(inferCashFlow({ priorCash: 0, cash: 2995.03,
    priorPositions: held, positions: held, extraPnl: 995.03 }), 2000);
});
t('no recorded cash on either side ⇒ null, so the caller uses the legacy fallback', () => {
  const held = P({ AAA: [10, 100] });
  assert.equal(inferCashFlow({ cash: 100, priorPositions: held, positions: held }), null);
  assert.equal(inferCashFlow({ priorCash: 100, priorPositions: held, positions: held }), null);
  assert.equal(inferCashFlow(), null);
});
t('a traded symbol that cannot be priced ⇒ null (abstain, never guess)', () => {
  assert.equal(inferCashFlow({ priorCash: 0, cash: 900,
    priorPositions: P({ AAA: [10, 0] }), positions: [] }), null);
});

console.log('appendEquityPoint — prefers the cash path, falls back when cash is absent');
t('the stale-quote phantom is gone end-to-end', () => {
  const held = P({ IREN: [350, 40.54] });
  const r = appendEquityPoint({ prev: [{ t: '2026-08-27', equity: 18687.37, cumFlow: 0 }],
    day: '2026-08-28', equity: 17616.98, positions: held,
    priorEquity: 18687.37, priorPositions: held, cash: -13928.24, priorCash: -13928.24 });
  assert.equal(r.flow, 0);            // legacy formula produced -1070.39 here
  assert.equal(r.cumFlow, 0);
  assert.equal(r.history.at(-1).equity, 17616.98);
});
t('a real deposit still reaches cumFlow through the cash path', () => {
  const held = P({ AAA: [10, 100] });
  const r = appendEquityPoint({ prev: [{ t: '2026-08-27', equity: 1000, cumFlow: 0 }],
    day: '2026-08-28', equity: 6000, positions: held,
    priorEquity: 1000, priorPositions: held, cash: 5000, priorCash: 0 });
  assert.equal(r.flow, 5000);
});
t('no recorded cash ⇒ the legacy quote-priced result, unchanged', () => {
  const before = P({ AAA: [10, 100] }), after = P({ AAA: [10, 100] });
  const r = appendEquityPoint({ prev: [{ t: '2026-08-27', equity: 1000, cumFlow: 0 }],
    day: '2026-08-28', equity: 6000, positions: after, priorEquity: 1000, priorPositions: before });
  assert.equal(r.flow, 5000);
});
t('a first point can never be a transfer, even with cash present', () => {
  const r = appendEquityPoint({ prev: [], day: '2026-08-28', equity: 6000,
    positions: [], priorEquity: null, priorPositions: null, cash: 5000, priorCash: 0 });
  assert.equal(r.flow, 0);
  assert.equal(r.cumFlow, 0);
});

console.log('brokerageEquity — the measured perimeter, derived from components not total_value');
// The LIVE 2026-09-10 self-directed payload, pinned verbatim. This is the one that disproved the
// old "sleeves sit outside total_value" premise: total_value exceeds the brokerage book by exactly
// the open event-contract position.
const LIVE_INSIDE = { total_value: '20374.14550084', equity_value: '41351.32550084',
  options_value: '-51', futures_value: '0', event_contracts_value: '220.75', crypto_value: '0',
  cash: '-21146.93' };
t('the sleeve is carved out of the recorded equity', () => {
  assert.equal(brokerageEquity(LIVE_INSIDE).equity, 20153.4);
});
t('the sleeve total is reported alongside it', () => {
  assert.equal(brokerageEquity(LIVE_INSIDE).sleeves, 220.75);
});
t('THE INVARIANT: total_value is fully explained by the brokerage book plus known sleeves', () => {
  assert.equal(brokerageEquity(LIVE_INSIDE).residual, 0);
});
// The whole point of deriving from components: the SAME formula is right under the other reading,
// so the question of which convention Robinhood uses never has to be settled again.
t('a sleeve-OUTSIDE payload yields the IDENTICAL equity (the basis is convention-independent)', () => {
  const outside = { ...LIVE_INSIDE, total_value: '20153.39550084' };
  const r = brokerageEquity(outside);
  assert.equal(r.equity, 20153.4);
  assert.equal(r.residual, -220.75); // total omits the sleeve, so the known sleeve is unexplained…
  // …which is exactly why the invariant is a DIAGNOSTIC on total_value, never an input to equity:
  // the recorded basis is right either way.
});
// The live agentic account the same run — sleeve 0, identity holds to nine decimals. This is the
// shape that made the old premise LOOK verified: it is vacuously true whenever the sleeve is empty.
t('a zero-sleeve account reconciles exactly (the vacuous case that hid the bug)', () => {
  const r = brokerageEquity({ total_value: '13210.065267674', equity_value: '13197.145267674',
    options_value: '0', event_contracts_value: '0', futures_value: '0', crypto_value: '0', cash: '12.92' });
  assert.equal(r.residual, 0);
  assert.equal(r.sleeves, 0);
});
t('an UNKNOWN asset bucket shows up as a residual rather than silently skewing the basis', () => {
  const r = brokerageEquity({ ...LIVE_INSIDE, total_value: '21374.14550084' });
  assert.equal(r.residual, 1000);
});
t('v116 holds: equity_value alone would overstate a margin book by the whole loan', () => {
  assert.ok(brokerageEquity(LIVE_INSIDE).equity < parseFloat(LIVE_INSIDE.equity_value) - 21000);
});
t('missing components fail BACK to total_value — never worse than the old behaviour', () => {
  const r = brokerageEquity({ total_value: '1000' });
  assert.equal(r.equity, 1000);
  assert.equal(r.basis, 'total');
  assert.equal(r.residual, null);
});
// The Railway producer writes {total_value, equity_value, cash, buying_power} and NO options_value.
// Coercing that absence to 0 would drop the entire options mark out of the basis — silently, and
// only on the producer that is not usually live. `absent !== zero`.
t('a RAILWAY-shaped payload (no options_value) falls back rather than dropping the options mark', () => {
  const r = brokerageEquity({ total_value: '18032.86', equity_value: '29906.51', cash: '-11282.65' });
  assert.equal(r.basis, 'total');
  assert.equal(r.equity, 18032.86);          // NOT 29906.51 - 11282.65 + 0 = 18623.86
});
t('…and reports sleeves as null, so the caller cannot stamp a value it never computed', () => {
  assert.equal(brokerageEquity({ total_value: '18032.86', equity_value: '29906.51', cash: '-11282.65' }).sleeves, null);
});
t('an options-free account still uses the brokerage basis — the broker sends "0", not nothing', () => {
  const r = brokerageEquity({ total_value: '13210.07', equity_value: '13197.15', options_value: '0', cash: '12.92' });
  assert.equal(r.basis, 'brokerage');
});
t('a null sleeveValue never counts as "already on the brokerage basis"', () => {
  // Railway records a point; a later Claude run with a complete payload must STILL owe the shift.
  const railway = appendEquityPoint({ prev: [{ t: '2026-09-10', equity: 20374.15, cumFlow: 0 }],
    day: '2026-09-11', equity: 20374.15, positions: [], priorPositions: [], priorEquity: 20374.15,
    cash: -21146.93, priorCash: -21146.93, sleeveValue: undefined });
  assert.equal(railway.history[railway.history.length - 1].sleeveValue, undefined);
  const claude = appendEquityPoint({ prev: railway.history, day: '2026-09-12', equity: 20153.40,
    positions: [], priorPositions: [], priorEquity: 20374.15, cash: -21146.93, priorCash: -21146.93,
    sleeveValue: 220.75 });
  assert.equal(claude.basisShift, true);
});
t('mutual funds / fixed income are deliberately NOT external sleeves', () => {
  assert.deepEqual(EXTERNAL_SLEEVE_KEYS, ['event_contracts_value', 'futures_value', 'crypto_value']);
});

console.log('appendEquityPoint — the one-time basis shift off total_value');
// Prior point recorded under the OLD basis (total_value, sleeve included). Nothing traded and no
// money moved: the only change is that the perimeter shrank by the sleeve.
const oldPoint = [{ t: '2026-09-10', equity: 20374.15, cumFlow: 0 }];
t('the carve-out is booked as a flow, so it cannot read as a loss', () => {
  const r = appendEquityPoint({ prev: oldPoint, day: '2026-09-11', equity: 20153.40,
    positions: [], priorPositions: [], priorEquity: 20374.15, cash: -21146.93, priorCash: -21146.93,
    sleeveValue: 220.75 });
  assert.equal(r.flow, -220.75);
  assert.equal(r.basisShift, true);
  // The return for the step nets to zero — which is the whole point.
  const p = r.history[r.history.length - 1];
  assert.equal(+((p.equity - r.flow) / 20374.15 - 1).toFixed(6), 0);
});
t('it is NOT subject to the noise floor — it is read off the payload, not inferred', () => {
  // $220.75 is far below flowThreshold($20k) = $750, so an inferred flow this size would be zeroed.
  assert.ok(220.75 < flowThreshold(20374.15));
  const r = appendEquityPoint({ prev: oldPoint, day: '2026-09-11', equity: 20153.40,
    positions: [], priorPositions: [], priorEquity: 20374.15, cash: -21146.93, priorCash: -21146.93,
    sleeveValue: 220.75 });
  assert.equal(r.flow, -220.75);
});
t('the point carries basisShift so the consumer does not list it as a transfer', () => {
  const r = appendEquityPoint({ prev: oldPoint, day: '2026-09-11', equity: 20153.40,
    positions: [], priorPositions: [], priorEquity: 20374.15, cash: -21146.93, priorCash: -21146.93,
    sleeveValue: 220.75 });
  assert.equal(r.history[r.history.length - 1].basisShift, true);
});
t('IT FIRES EXACTLY ONCE — the next run sees sleeveValue on the prior point', () => {
  const first = appendEquityPoint({ prev: oldPoint, day: '2026-09-11', equity: 20153.40,
    positions: [], priorPositions: [], priorEquity: 20374.15, cash: -21146.93, priorCash: -21146.93,
    sleeveValue: 220.75 });
  const second = appendEquityPoint({ prev: first.history, day: '2026-09-12', equity: 20153.40,
    positions: [], priorPositions: [], priorEquity: 20153.40, cash: -21146.93, priorCash: -21146.93,
    sleeveValue: 220.75 });
  assert.equal(second.flow, 0);
  assert.equal(second.basisShift, false);
  assert.equal(second.history[second.history.length - 1].basisShift, undefined);
});
t('a zero-sleeve account records sleeveValue anyway, so it can never fire later', () => {
  const r = appendEquityPoint({ prev: [{ t: '2026-09-10', equity: 5000, cumFlow: 0 }],
    day: '2026-09-11', equity: 5000, positions: [], priorPositions: [], priorEquity: 5000,
    cash: 100, priorCash: 100, sleeveValue: 0 });
  assert.equal(r.flow, 0);
  assert.equal(r.basisShift, false);
  assert.equal(r.history[r.history.length - 1].sleeveValue, 0);
  // A sleeve appearing later must NOT be read as a perimeter change — the basis was already right.
  const later = appendEquityPoint({ prev: r.history, day: '2026-09-12', equity: 5000,
    positions: [], priorPositions: [], priorEquity: 5000, cash: 100, priorCash: 100, sleeveValue: 300 });
  assert.equal(later.basisShift, false);
});
t('omitting sleeveValue entirely reproduces the pre-2026-09-10 behaviour exactly', () => {
  const r = appendEquityPoint({ prev: oldPoint, day: '2026-09-11', equity: 20374.15,
    positions: [], priorPositions: [], priorEquity: 20374.15, cash: -21146.93, priorCash: -21146.93 });
  assert.equal(r.flow, 0);
  assert.equal(r.basisShift, false);
  assert.equal(r.history[r.history.length - 1].sleeveValue, undefined);
});
t('THE HOURLY CADENCE: the shift fires once and its flag survives every same-day re-run', () => {
  // The producer fires ~13x/day and each run REPLACES the day's point. The shift must not re-fire
  // (which would double the carve-out) and its flag must not be dropped (which would make the
  // consumer list the perimeter change as an owner transfer from the second run onward).
  let hist = oldPoint;
  for (let i = 0; i < 4; i++) {
    const r = appendEquityPoint({ prev: hist, day: '2026-09-11', equity: 20153.40,
      positions: [], priorPositions: [], priorEquity: 20374.15, cash: -21146.93,
      priorCash: -21146.93, sleeveValue: 220.75 });
    hist = r.history;
    assert.equal(r.cumFlow, -220.75, `cumFlow drifted on run ${i + 1}`);
    assert.equal(r.flow, i === 0 ? -220.75 : 0, `flow re-fired on run ${i + 1}`);
    assert.equal(hist[hist.length - 1].basisShift, true, `flag lost on run ${i + 1}`);
  }
  assert.equal(hist.length, 2); // still one point for the day
});
t('REGRESSION: the real 08-30 settlement still nets to no transfer under the new basis', () => {
  // 1245 contracts settle at $1 on a $236.55 cost. The payout lands in brokerage cash; the sleeve
  // it came from is outside the perimeter, so the gain is RETURN and only the cost basis reads as a
  // transfer — and that is below the $750 floor, exactly as it was on the live run.
  const r = appendEquityPoint({
    prev: [{ t: '2026-08-28', equity: 17469.76, cumFlow: 0, sleeveValue: 236.55 }],
    day: '2026-08-31', equity: 18960.57, positions: [], priorPositions: [],
    priorEquity: 17469.76, cash: 1245, priorCash: 0, extraPnl: 1008.45, sleeveValue: 0 });
  assert.equal(r.flow, 0);
  assert.equal(r.cumFlow, 0);
});

console.log(`\n✅ equityseries: ${n} assertions passed`);
