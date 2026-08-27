// Offline unit checks for maindecisions.mjs — no network, no I/O. Run: node producer/maindecisions.test.mjs
import { shiftDay, decisionsFromOrders, mergeDecisions, spyClosesFrom, deriveLog, closeOnOrBefore, DECISION_CAP, DECISION_RETAIN_YEARS } from './maindecisions.mjs';
import { gradeDecisions } from './agentic-ledger.mjs';

let pass = 0, fail = 0;
const ok = (label, cond) => { if (cond) pass++; else { fail++; console.error(`✗ ${label}`); } };
const eq = (label, got, want) => { const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) pass++; else { fail++; console.error(`✗ ${label}\n    got  ${g}\n    want ${w}`); } };
const near = (label, got, want, tol = 0.01) => { if (got != null && Math.abs(got - want) <= tol) pass++; else { fail++; console.error(`✗ ${label}\n    got ${got} want ~${want}`); } };

// ── Fixture: the real get_equity_orders payload shape (••••0741, 2026-08) ──────────────────────
const ORDERS = { data: { orders: [
  // Two fills on the SAME ET day, opposite sides → one 'rebalance' record.
  { id: 'o1', symbol: 'CIFR', side: 'sell', state: 'filled', quantity: '153.000000', cumulative_quantity: '153.000000',
    price: '15.540000', average_price: '15.562000', placed_agent: 'user',
    created_at: '2026-08-25T12:50:52.425993Z', last_transaction_at: '2026-08-25T12:50:52.727Z' },
  { id: 'o2', symbol: 'PLTR', side: 'buy', state: 'filled', quantity: '75.000000', cumulative_quantity: '75.000000',
    price: '178.900000', average_price: '175.607200', placed_agent: 'user',
    created_at: '2026-08-25T12:50:34.055028Z', last_transaction_at: '2026-08-25T12:50:34.269Z' },
  // A GTC limit PLACED 08-14 06:38Z but FILLED 08-14 17:21Z — must file under the FILL date.
  { id: 'o3', symbol: 'CIFR', side: 'sell', state: 'filled', quantity: '250', cumulative_quantity: '250',
    price: '18.000000', average_price: '18.000000', placed_agent: 'user',
    created_at: '2026-08-14T06:38:22.179293Z', last_transaction_at: '2026-08-14T17:21:49.446Z' },
  // Filled 2026-08-10T03:56Z = the EVENING OF AUG 9 in Eastern time.
  { id: 'o4', symbol: 'CIFR', side: 'buy', state: 'filled', quantity: '50', cumulative_quantity: '50',
    price: '17.410000', average_price: '17.410000', placed_agent: 'user',
    created_at: '2026-08-10T03:56:04.209692Z', last_transaction_at: '2026-08-10T03:56:04.38Z' },
  // Not a decision: cancelled, and a DRIP.
  { id: 'o5', symbol: 'NVDA', side: 'buy', state: 'cancelled', quantity: '10', cumulative_quantity: '0',
    average_price: null, placed_agent: 'user', last_transaction_at: '2026-08-25T14:00:00Z' },
  { id: 'o6', symbol: 'SPY', side: 'buy', state: 'filled', quantity: '0.1', cumulative_quantity: '0.1',
    average_price: '640.00', placed_agent: 'drip', last_transaction_at: '2026-08-25T14:00:00Z' },
] } };

const SPY_BARS = [
  { begins_at: '2026-08-09T00:00:00Z', close_price: '700.00' },
  { begins_at: '2026-08-14T00:00:00Z', close_price: '710.00' },
  { begins_at: '2026-08-25T00:00:00Z', close_price: '720.00' },
  { begins_at: '2026-08-26T00:00:00Z', close_price: '0' },              // junk close → skipped
  { t: '2026-08-27', c: 730 },                                          // Railway compact shape
  { begins_at: '2026-08-28T00:00:00Z', close_price: '999', interpolated: true }, // placeholder → skipped
  { t: '2026-08-29', c: 888, live: true },                              // spliced live bar → skipped
];

const spy = spyClosesFrom(SPY_BARS);
eq('spyClosesFrom reads BOTH bar shapes', [spy['2026-08-25'], spy['2026-08-27']], [700 + 20, 730]);
ok('spyClosesFrom skips interpolated placeholders', spy['2026-08-28'] === undefined);
ok('spyClosesFrom skips the consumer-spliced live bar', spy['2026-08-29'] === undefined);
ok('spyClosesFrom skips a zero/unusable close', spy['2026-08-26'] === undefined);

const D = decisionsFromOrders(ORDERS, { spyCloses: spy });
eq('one record per trading day, newest first', D.map((d) => d.date), ['2026-08-25', '2026-08-14', '2026-08-09']);
eq('a day with both sides is a rebalance', D[0].kind, 'rebalance');
eq('a sells-only day is a raise', D[1].kind, 'raise');
eq('a buys-only day is a deploy', D[2].kind, 'deploy');
ok('the GTC order files under its FILL date, not its placement date', D.some((d) => d.date === '2026-08-14'));
ok('a 03:56Z fill files under the PREVIOUS ET day', D.some((d) => d.date === '2026-08-09'));
ok('a cancelled order is not a decision', !D.some((d) => d.trades.some((t) => t.sym === 'NVDA')));
ok('a DRIP fill is not a decision', !D.some((d) => d.trades.some((t) => t.sym === 'SPY')));
near('dollars = filled shares × average fill price', D[0].trades.find((t) => t.sym === 'PLTR').dollars, 75 * 175.6072);
eq('sides map to the ledger vocabulary', [...new Set(D.flatMap((d) => d.trades.map((t) => t.side)))].sort(), ['BUY', 'SELL']);
eq('spyAt is stamped from that day\'s close', D[0].spyAt, 720);
eq('a day with no SPY bar stamps null rather than guessing', decisionsFromOrders(ORDERS, { spyCloses: {} })[0].spyAt, null);
ok('legs are ordered biggest-dollar first', D[0].trades[0].dollars >= D[0].trades[1].dollars);
eq('sinceDay drops orders older than the fetch window', decisionsFromOrders(ORDERS, { spyCloses: spy, sinceDay: '2026-08-15' }).map((d) => d.date), ['2026-08-25']);

// Same-day, same-side, multiple clips → ONE share-weighted leg (never triple-counted).
const CLIPS = { orders: [
  { symbol: 'PLTR', side: 'buy', state: 'filled', cumulative_quantity: '10', average_price: '100', last_transaction_at: '2026-08-20T15:00:00Z' },
  { symbol: 'PLTR', side: 'buy', state: 'filled', cumulative_quantity: '30', average_price: '120', last_transaction_at: '2026-08-20T16:00:00Z' },
] };
const clip = decisionsFromOrders(CLIPS, { spyCloses: {} })[0];
eq('same-day same-side clips collapse to one leg', clip.trades.length, 1);
near('…share-weighted, not averaged', clip.trades[0].priceAt, (10 * 100 + 30 * 120) / 40);
near('…with the whole day\'s dollars', clip.trades[0].dollars, 10 * 100 + 30 * 120);

// ── A NON-TRADING fill date benchmarks against the last real close ────────────────────────────
// Three of the 22 trading days derived from ••••0741's real order history landed on a SUNDAY (an
// order queued or filled in extended/overnight hours). A strict lookup drops the benchmark on 14%
// of the log; the honest answer is Friday's close, which is what SPY was actually worth then.
const WEEKEND = { orders: [
  { symbol: 'CIFR', side: 'buy', state: 'filled', cumulative_quantity: '50', average_price: '17.41',
    last_transaction_at: '2026-08-10T03:56:04Z' },   // = Sunday 2026-08-09 in ET
] };
const wk = decisionsFromOrders(WEEKEND, { spyCloses: { '2026-08-07': 750, '2026-08-10': 760 } })[0];
eq('a weekend-stamped fill files on that ET day', wk.date, '2026-08-09');
eq("…and benchmarks against the last close BEFORE it, never the next one", wk.spyAt, 750);
eq('closeOnOrBefore reports it walked back', closeOnOrBefore({ '2026-08-07': 750 }, '2026-08-09').stale, true);
eq('…and abstains rather than reaching for an arbitrarily old price',
  closeOnOrBefore({ '2026-01-02': 600 }, '2026-08-09'), null);

// ── deriveLog: the pagination rule ────────────────────────────────────────────────────────────
// get_equity_orders caps its page. A live 120-day fetch came back with 200 orders covering only
// ~78 days plus a `next` cursor — so a fixed 90-day sweep would have deleted twelve days of real,
// correctly-recorded history on every run.
const full = deriveLog(ORDERS, { spyCloses: spy, sinceDay: '2026-05-01' });
eq('an un-truncated payload sweeps the whole requested window', [full.truncated, full.windowFrom], [false, '2026-05-01']);
eq('…and keeps every derived day', full.decisions.map((d) => d.date), ['2026-08-25', '2026-08-14', '2026-08-09']);

const cut = deriveLog({ ...ORDERS, data: { ...ORDERS.data, next: 'http://…&cursor=abc' } }, { spyCloses: spy, sinceDay: '2026-05-01' });
eq('a truncated payload sweeps only from the day AFTER its oldest', [cut.truncated, cut.windowFrom], [true, '2026-08-10']);
eq('…and discards that oldest day, which the page boundary may have split', cut.decisions.map((d) => d.date), ['2026-08-25', '2026-08-14']);
ok('a truncated payload with nothing usable sweeps NOTHING',
  deriveLog({ data: { orders: [], next: 'x' } }, {}).windowFrom === null);

// End-to-end: the truncated case must leave the older snapshot record alone.
const kept = mergeDecisions(cut.decisions, [
  { id: '2026-08-09-sd', date: '2026-08-09', source: 'orders', trades: [{ sym: 'REAL', side: 'BUY', dollars: 870, priceAt: 17.4 }] },
], { windowFrom: cut.windowFrom });
ok('a real record just past the truncation point survives', kept.some((d) => d.trades.some((t) => t.sym === 'REAL')));

// ── The derived log grades through the SAME ledger the agentic side uses ───────────────────────
const graded = gradeDecisions(D, { CIFR: 14.0, PLTR: 200.0, SPY: 756.0 }, '2026-09-05');
ok('grades through agentic-ledger.gradeDecisions unchanged', graded.stats.total === 3 && graded.stats.resolved === 3);
ok('a sell of a name that then FELL contributes positively',
  graded.decisions.find((d) => d.date === '2026-08-14').grade.byTrade[0].contribPct > 0);
ok('alpha is measured against the SPY close stamped at decision time',
  graded.decisions[0].grade.alpha != null && Math.abs(graded.decisions[0].grade.alpha - (graded.decisions[0].grade.avgContrib - graded.decisions[0].grade.spyRet)) < 1e-6);
ok('sleeve attribution stays EMPTY on this side (no research sleeves here)', Object.keys(graded.sleeves).length === 0);

// ── mergeDecisions: snapshot accumulation ──────────────────────────────────────────────────────
const PRIOR = [
  { id: '2026-08-25-sd', date: '2026-08-25', kind: 'deploy', source: 'orders', trades: [{ sym: 'STALE', side: 'BUY', dollars: 1, priceAt: 1 }] },
  { id: '2026-05-02-sd', date: '2026-05-02', kind: 'deploy', source: 'orders', trades: [{ sym: 'OLD', side: 'BUY', dollars: 500, priceAt: 50 }] },
];
const merged = mergeDecisions(D, PRIOR, { windowFrom: '2026-08-01' });
ok('records older than the window carry forward', merged.some((d) => d.id === '2026-05-02-sd'));
ok('a fresh derivation REPLACES the prior record for the same day',
  !merged.find((d) => d.id === '2026-08-25-sd').trades.some((t) => t.sym === 'STALE'));
const cancelled = mergeDecisions([], PRIOR, { windowFrom: '2026-08-01' });
ok('a day the broker no longer reports is dropped, not stranded', !cancelled.some((d) => d.id === '2026-08-25-sd'));
ok('…while the out-of-window record survives that sweep', cancelled.some((d) => d.id === '2026-05-02-sd'));
eq('merged output is newest-first', merged.map((d) => d.date), ['2026-08-25', '2026-08-14', '2026-08-09', '2026-05-02']);

const owned = mergeDecisions(D, PRIOR, { windowFrom: '2026-08-01', committed: [{ id: '2026-08-25-sd', date: '2026-08-25', rationale: 'Rotated CIFR into PLTR on the momentum read.' }] });
const o = owned.find((d) => d.id === '2026-08-25-sd');
eq('an owner note overlays the derived record', o.rationale, 'Rotated CIFR into PLTR on the momentum read.');
ok('…without discarding the broker-derived legs', o.trades.some((t) => t.sym === 'PLTR'));
eq('…and is tagged as owner-annotated', o.source, 'owner');

// An owner-annotated record is not swept: the sweep only clears broker-DERIVED records, so a day the
// owner wrote a rationale for survives even if a fill is later cancelled. (The committed file is
// re-applied every run anyway — this is belt-and-braces, and it is a real branch.)
ok('the sweep spares an owner-annotated record',
  mergeDecisions([], [{ id: '2026-08-25-sd', date: '2026-08-25', source: 'owner', rationale: 'kept', trades: [] }], { windowFrom: '2026-08-01' })
    .some((d) => d.rationale === 'kept'));

// RETENTION IS TIME-BASED. A flat count cap looked generous and was not: this account filled orders
// on 22 of 78 calendar days (~103 records/yr), so the old 160 cap would have begun discarding the
// OLDEST history — the part worth keeping — after ~1.6 years, silently.
const yearly = (n) => Array.from({ length: n }, (_, i) => ({ id: `y${i}`, date: shiftDay('2026-08-27', -i * 3), trades: [] }));
const fourYears = mergeDecisions([], yearly(500), { asOf: '2026-08-27' });   // 500 × 3d ≈ 4.1 years
eq('four years of records at this account\'s real rate are ALL kept', fourYears.length, 500);
ok(`retention is ${DECISION_RETAIN_YEARS} years, not the old ~1.6`, DECISION_RETAIN_YEARS >= 5);
const ancient = mergeDecisions([], [{ id: 'old', date: '2010-01-04', trades: [] }, ...yearly(3)], { asOf: '2026-08-27' });
ok('a record past the retention horizon is dropped', !ancient.some((d) => d.id === 'old'));
ok('…and everything inside it survives', ancient.length === 3);
eq('with no asOf the time filter is inert (never drops on a caller that omits it)',
  mergeDecisions([], [{ id: 'old', date: '2010-01-04', trades: [] }], {}).length, 1);
const many = Array.from({ length: DECISION_CAP + 25 }, (_, i) => ({ id: `x${i}`, date: `2020-01-${String((i % 28) + 1).padStart(2, '0')}`, trades: [] }));
ok('a hard cap still backstops a runaway', mergeDecisions([], many, {}).length === DECISION_CAP);

// Missing/garbage input never throws — the card degrades to "nothing logged yet".
eq('an absent orders file derives nothing', decisionsFromOrders(null, {}), []);
eq('a garbage payload derives nothing', decisionsFromOrders({ data: {} }, {}), []);

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
