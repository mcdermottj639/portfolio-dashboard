// Synthetic regression cases for entry/hold/exit separation. No broker calls.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const A = createRequire(import.meta.url)('../ui/apex.js');
const level = (overrides = {}) => ({ trigger: 100, limit: 100, stop: 90, tp1: 120, orderType: 'limit', tradable: true, ...overrides });
const config = (overrides = {}) => ({ ...A.DEFAULT_CFG, targets: { IREN: 20, X: 20 }, levels: { X: level() }, snapAgeMin: 5, ...overrides });
const book = (positions = [], equity = 10000) => A.state({ positions: [{ symbol: 'IREN', qty: 50, px: 100, avg: 100 }, ...positions], equity, cash: 0 });
const run = (st, cfg, opt = {}) => { const rows = A.rules(st, { cfg, ...opt }); return { rows, lines: A.bookLines(st, rows, cfg), reviews: A.bookReviews(st, rows, cfg), prompt: A.portfolioPrompt(st, rows, cfg) }; };
let n = 0;
const test = (name, fn) => { fn(); n++; console.log('  ✓', name); };

test('1: omitted holding is review/no-add, never a sale or a Plan sell note', () => {
  const st = book([{ symbol: 'X', qty: 10, px: 100, avg: 100 }]);
  const cfg = config({ targets: { IREN: 20 }, levels: {} }), r = run(st, cfg);
  assert.equal(r.lines.length, 0); assert.equal(r.reviews[0].sym, 'X');
  assert.match(r.prompt, /REVIEW X/); assert.doesNotMatch(r.prompt, /• SELL/);
  assert.equal(A.planSellNote(st, r.rows, cfg), '');
});
test('2: loading, missing and stale research cannot liquidate or add', () => {
  const st = book([{ symbol: 'X', qty: 10, px: 100, avg: 100 }]);
  for (const targets of [{ IREN: 20 }, { IREN: 20, X: 20 }]) {
    const r = run(st, config({ researchReady: false, targets }));
    assert.equal(r.lines.length, 0); assert.ok(r.reviews.some(r => r.sym === 'X'));
  }
});
test('3: R/R floor is a hard gate at the executable limit on both build and gap paths', () => {
  for (const [target, eligible] of [[114.9, false], [115, true], [115.1, true]]) {
    const cfg = config({ levels: { X: level({ tp1: target }) } });
    const st = book(), r = run(st, cfg);
    assert.equal(r.lines.some(l => l.side === 'buy'), eligible);
    assert.equal(A.bookGaps(st, [], cfg).adds.length > 0, eligible);
    assert.equal(/^• BUY/m.test(r.prompt), eligible);
  }
});
test('4: missing, non-finite and reversed levels cannot create an entry', () => {
  const invalid = [{ stop: null }, { stop: 0 }, { stop: -2 }, { stop: 100 }, { stop: 101 }, { stop: Infinity }, { tp1: null }, { tp1: 99 }, { tp1: Infinity }, { limit: NaN }, { limit: 0 }, { orderType: 'market' }, { orderType: 'stop_limit', trigger: 101 }, { maxPx: 99 }];
  for (const row of invalid) {
    const r = run(book(), config({ levels: { X: level(row) } }));
    assert.equal(r.lines.length, 0, JSON.stringify(row));
  }
  assert.equal(run(book(), config({ levels: {} })).lines.length, 0);
});
test('5: dropped holding below the hard stop produces exactly one full exit', () => {
  const r = run(book([{ symbol: 'X', qty: 10.5, px: 70, avg: 100 }]), config({ targets: { IREN: 20 } }));
  assert.deepEqual(r.lines.map(l => [l.side, l.sym, l.qty]), [['sell', 'X', 10.5]]);
  assert.equal((r.prompt.match(/^• SELL/gm) || []).length, 1);
});
test('6: underweight holding through a research stop cannot also receive a buy', () => {
  const r = run(book([{ symbol: 'X', qty: 10, px: 85, avg: 100 }]), config());
  assert.deepEqual(r.lines.map(l => [l.side, l.sym, l.qty]), [['sell', 'X', 10]]);
  assert.equal(r.rows.filter(r => r.ticket && r.ticket.sym === 'X').length, 1);
  assert.doesNotMatch(r.prompt, /^• (BUY|ADD)/m);
});
test('7: changing quantity or refreshing a winner cannot repeat a mechanical trim', () => {
  for (const qty of [100, 75, 56, 25]) {
    const r = run(book([{ symbol: 'X', qty, px: 130, avg: 100 }], 30000), config({ levels: { X: level({ tp1: 200 }) } }));
    assert.equal(r.lines.length, 0);
    assert.match(r.reviews.find(r => r.sym === 'X').why, /reconciled execution history/);
  }
});
test('profit review never suppresses an independent planned target or stop exit', () => {
  for (const levels of [{ stop: 90, tp1: 120 }, { stop: 135, tp1: 150 }]) {
    const r = run(book([{ symbol: 'X', qty: 100, px: 130, avg: 100 }], 30000), config({ exitLevels: { X: levels } }));
    assert.deepEqual(r.lines.map(l => [l.side, l.qty]), [['sell', 100]]);
  }
});
test('owner stop replacement is a labelled estimate, not a researched exit or entry approval', () => {
  const cfg = config({ levels: { X: level({ stop: 95, stopBasis: "owner stop", atr: 5 }) } });
  assert.match(A.levelsFor(cfg, 'X').stopBasis, /estimate/);
  assert.equal(A.exitLevelsFor(cfg, 'X').stop, null);
  const r = run(book([{ symbol: 'X', qty: 10, px: 85, avg: 100 }]), cfg);
  assert.equal(r.lines.length, 0);
});
test('held research takes precedence over a different new-entry stop', () => {
  const cfg = config({ levels: { X: level({ stop: 95 }) }, exitLevels: { X: { stop: 80, tp1: 150, stopBasis: 'verified held support' } } });
  assert.equal(A.exitLevelsFor(cfg, 'X').stop, 80);
  assert.ok(!run(book([{ symbol: 'X', qty: 10, px: 90, avg: 100 }]), cfg).lines.some(l => l.side === 'sell'));
  assert.ok(run(book([{ symbol: 'X', qty: 10, px: 79, avg: 100 }]), cfg).lines.some(l => l.side === 'sell'));
});
test('combined entries respect remaining cruise room and target/per-name caps without netting sells first', () => {
  const cfg = config({ targets: { IREN: 20, X: 60, Y: 20, Z: 20 }, levels: { X: level(), Y: level(), Z: level() } });
  for (const equity of [3300, 4000, 10000]) {
    const st = book([], equity), r = run(st, cfg), buys = r.lines.filter(l => l.side === 'buy');
    assert.ok(buys.reduce((sum, l) => sum + l.qty * 100, 0) <= Math.max(0, A.C.LEV_NORMAL * equity - st.exposure) + 1e-8);
    for (const l of buys) assert.ok(l.qty * 100 <= equity * A.C.SINGLE_MAX_EQ + 1e-8);
    assert.equal(new Set(r.lines.map(l => l.sym)).size, r.lines.length);
  }
});
test('earnings and tradability gates also cover gap adds', () => {
  const st = book(), cfg = config();
  assert.equal(run(st, cfg, { earningsMap: { X: { daysAway: 1 } } }).lines.length, 0);
  assert.equal(run(st, config({ levels: { X: level({ tradable: false }) } })).lines.length, 0);
});
test('limit and breakout order types survive the shared action list and prompt', () => {
  for (const type of ['limit', 'stop_limit']) {
    const r = run(book(), config({ levels: { X: level({ orderType: type }) } }));
    assert.equal(r.lines.length, 1);
    assert.match(r.lines[0].sub, type === 'limit' ? /limit entry/ : /buy-stop trigger/);
    assert.ok(r.prompt.includes(r.lines[0].text.toUpperCase()));
  }
});
test('review-only book is visible but never counted as an order', () => {
  const st = book([{ symbol: 'X', qty: 10, px: 100, avg: 100 }]), cfg = config({ targets: { IREN: 20 } });
  const r = run(st, cfg), el = { innerHTML: '', querySelector: () => null };
  A.render(el, st, r.rows, cfg);
  assert.match(el.innerHTML, /Review · no order/);
  assert.match(el.innerHTML, /· 0 orders/);
  assert.doesNotMatch(el.innerHTML, /data-apex-trade=/);
});
console.log(`apex-turnover: ${n}/${n} passed`);
