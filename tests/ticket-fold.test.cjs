// v266 (Jack, Nov 25 2026: "Fold into one line"): on the Apex "Morning order ticket", rows he already placed collapse into ONE
// summary row per section ("✓ N placed · tap to see"). Display only: this feeds Apex.ticketHtml synthetic ticket objects and
// reads the HTML back; no rule, price, order or data file is involved. Browser expand/collapse: tests/apex-browser.mjs.
const test = require('node:test');
const assert = require('node:assert/strict');
const A = require('../ui/apex.js');

const base = { name: null, qty: 5, last: 100, est: false, tp1: 120, stop: 90 };
const placed = (sym) => Object.assign({ side: 'stop', sym }, base, { placed: { stop: 90, limit: 120, qty: 5, at: null } });
const todo = (sym) => Object.assign({ side: 'stop', sym, toStopPct: -10, toTargetPct: 20 }, base);
const buy = (sym) => ({ side: 'buy', sym, name: null, qty: 3, action: 'Buy', price: 'limit', entry: 50, tp1: 60, stop: 45, rewardPct: 20, riskPct: -10, rr: 2, trigger: 50, note: 'x', est: false });
const mk = (buys, sells, stops) => ({ state: 'ready', researchStamp: 'Nov 25', quotesAge: '5 min', fresh: true, buys, sells, stops, ordersStamp: null,
  toPlace: [...sells, ...stops].filter((r) => !r.placed).length, placed: [...sells, ...stops].filter((r) => r.placed).length });
const H = (T) => A.ticketHtml(T, (x) => String(x));
const folds = (h) => (h.match(/data-apex-placed-fold="/g) || []).length;

test('none placed: no fold row, every row as before', () => {
  const h = H(mk([buy('Y')], [], [todo('NET'), todo('CRWD')]));
  assert.equal(folds(h), 0);
  assert.ok(!/✓|\d placed|data-placed|data-apex-ticket-placed/.test(h.replace(/<style>[\s\S]*?<\/style>/, '')), 'no placed text or marker anywhere');
  for (const s of ['NET', 'CRWD', 'Y']) assert.ok(h.includes(`data-apex-ticket-row="${s}"`), s);
});

test('some placed: to-dos stay above ONE summary row; placed rows live inside it', () => {
  const h = H(mk([buy('Y')], [], [todo('NET'), placed('ZS'), placed('DXCM'), todo('CRWD')]));
  assert.equal(folds(h), 1);
  assert.match(h, /✓ 2 placed<\/span>/); assert.match(h, /tap to see/);
  const f = h.indexOf('data-apex-placed-fold="sell"');
  assert.ok(h.indexOf('data-apex-ticket-row="NET"') < f && h.indexOf('data-apex-ticket-row="CRWD"') < f, 'to-do rows above the fold');
  assert.ok(h.indexOf('data-apex-ticket-row="ZS"') > f && h.indexOf('data-apex-ticket-row="DXCM"') > f, 'placed rows inside the fold');
  assert.match(h, /Sells &amp; sell stops <span[^>]*>\(2\) <span data-apex-ticket-placed-count[^>]*>· 2 placed/, 'header counts only what is left');
  assert.ok(!/undefined|NaN/.test(h));
});

test('all placed: just the header and the single summary row', () => {
  const h = H(mk([], [], [placed('ZS'), placed('NET'), placed('DXCM')]));
  assert.equal(folds(h), 1);
  assert.match(h, /✓ 3 placed<\/span>/);
  assert.match(h, /Sells &amp; sell stops <span[^>]*>\(0\) <span data-apex-ticket-placed-count[^>]*>· 3 placed/);
  const outside = h.slice(0, h.indexOf('data-apex-placed-fold="sell"'));
  assert.ok(!/data-apex-ticket-row=/.test(outside), 'no to-do row before the fold');
});

test('buys section folds the same way when a buy line carries a placed mark', () => {
  const pb = Object.assign(buy('Z'), { placed: { stop: null, limit: null, qty: 3, at: null } });
  const h = H(mk([buy('Y'), pb], [], []));
  assert.match(h, /data-apex-placed-fold="buy"/); assert.match(h, /✓ 1 placed<\/span>/);
  assert.ok(h.indexOf('data-apex-ticket-row="Y"') < h.indexOf('data-apex-placed-fold="buy"'));
});
