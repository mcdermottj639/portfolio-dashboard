/* v186 — Apex leverage-loop rules (ui/apex.js, UMD).
   Run: node producer/apex.test.mjs
   Numbers are the 2026-11-05 00:15 ET snapshot of the margin book, rounded:
   IREN 900 @ $20.83 (cost 37.50), PLTR 100 @ $168.78 (cost 169.75), debt $23,686. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const A = require('../ui/apex.js');

let n = 0; const ok = (name, fn) => { fn(); n++; console.log('  ✓', name); };

const book = { positions: [
  { symbol: 'IREN', qty: 900, px: 20.83, avg: 37.5 },
  { symbol: 'PLTR', qty: 100, px: 168.78, avg: 169.75 },
], cash: -23686 };

ok('state: leverage, equity %, cushion from exposure − debt', () => {
  const s = A.state(book);
  assert.equal(Math.round(s.exposure), 35625);
  assert.equal(Math.round(s.equity), 11939);
  assert.ok(s.lev > 2.9 && s.lev < 3.05, 'about 3x');
  assert.ok(s.eqPct > 0.33 && s.eqPct < 0.34);
  assert.equal(Math.round(s.cushion), Math.round(11939 - 0.30 * 35625));
  assert.equal(s.band, 'over');
});

ok('state: explicit equity wins over exposure − debt (options / event contracts sit in equity)', () => {
  const s = A.state({ ...book, equity: 11811 });
  assert.equal(s.equity, 11811);
});

ok('tripwire: IREN price that puts equity on the 35% guard line', () => {
  const s = A.state(book);
  const tw = A.tripwire(s, 'IREN');
  // (900x + 16878)·0.65 = 23686 ⇒ x ≈ 21.73 at the 35% guard; at 30% maintenance ≈ 18.84
  assert.ok(Math.abs(tw - 21.73) < 0.05, `guard tripwire ${tw}`);
  const call = A.tripwire(s, 'IREN', 0.30);
  assert.ok(Math.abs(call - 18.84) < 0.05, `call line ${call}`);
});

ok('rules: 3x book → risk guard sells the donor in 50-share tranches and the ladder is armed', () => {
  const s = A.state(book);
  const r = A.rules(s);
  assert.equal(r[0].kind, 'risk');
  assert.equal(r[0].ticket.sym, 'PLTR');
  assert.equal(r[0].ticket.qty % 50, 0);
  assert.ok(r[0].after.lev < r[0].before.lev);
  const lad = r.find((x) => x.kind === 'ladder');
  assert.ok(lad && lad.ticket.armed === true && lad.ticket.px === 30 && lad.ticket.gtc === true);
  assert.ok(r.some((x) => x.kind === 'lev' && /cap/.test(x.title)));
});

ok('rules: through the ladder rung the sell goes live and shows debt after', () => {
  const s = A.state({ ...book, positions: [{ symbol: 'IREN', qty: 900, px: 31, avg: 37.5 }, book.positions[1]] });
  const lad = A.rules(s).find((x) => x.kind === 'ladder');
  assert.equal(lad.ticket.armed, false);
  assert.equal(Math.round(lad.after.debt), 23686 - 6000);
});

ok('rules: winner trims 25% at +25% from cost; waits inside the earnings window', () => {
  const s = A.state({ positions: [{ symbol: 'NVDA', qty: 40, px: 250, avg: 190 }], cash: 0 });
  const r = A.rules(s);
  assert.equal(r[0].kind, 'win'); assert.equal(r[0].ticket.qty, 10);
  const g = A.rules(s, { earningsMap: { NVDA: { daysAway: 2 } } });
  assert.equal(g[0].kind, 'guard');
});

ok('rules: 25% stop is an exit (same dial as sdBroken)', () => {
  const s = A.state({ positions: [{ symbol: 'RKLB', qty: 100, px: 30, avg: 42 }], cash: 0 });
  const r = A.rules(s);
  assert.equal(r[0].kind, 'lose'); assert.equal(r[0].ticket.qty, 100);
});

ok('rules: reload only under 1.2x with 2/3 of names above their 50-day', () => {
  const pos = [{ symbol: 'A', qty: 10, px: 100, avg: 90 }, { symbol: 'B', qty: 10, px: 100, avg: 90 }, { symbol: 'C', qty: 10, px: 100, avg: 90 }];
  const s = A.state({ positions: pos, cash: -300 }); // 3000 / 2700 = 1.11x
  const sma = { A: { s50: 90 }, B: { s50: 90 }, C: { s50: 120 } };
  assert.ok(A.rules(s, { smaMap: sma }).some((x) => x.kind === 'reload'));
  assert.ok(!A.rules(s, { smaMap: { A: { s50: 90 }, B: { s50: 120 }, C: { s50: 120 } } }).some((x) => x.kind === 'reload'));
  const hi = A.state({ positions: pos, cash: -1200 }); // 1.67x
  assert.ok(!A.rules(hi, { smaMap: sma }).some((x) => x.kind === 'reload'));
});

ok('rules: drift only on Fridays, 5-point band, targets are % of equity', () => {
  const s = A.state({ positions: [{ symbol: 'IREN', qty: 100, px: 100, avg: 100 }, { symbol: 'NVDA', qty: 10, px: 100, avg: 100 }], cash: 0 });
  assert.ok(!A.rules(s).some((x) => x.kind === 'drift'));
  const fr = A.rules(s, { friday: true }).filter((x) => x.kind === 'drift');
  assert.ok(fr.some((x) => x.title.startsWith('IREN')), 'IREN 91% vs 20%');
  assert.ok(fr.some((x) => x.title.startsWith('NVDA')), 'NVDA 9% vs 20%');
});

ok('sellToLev: dollars to reach the cap with debt paid 1:1', () => {
  const s = A.state(book);
  const need = A.sellToLev(s, 1.5);
  assert.equal(Math.round(need), Math.round(35625 - 1.5 * 11939));
});

ok('render: no DOM outside render; render writes tiles and rules into the element', () => {
  const calls = [];
  const el = { innerHTML: '', querySelector: () => null };
  A.render(el, A.state(book), A.rules(A.state(book)));
  assert.ok(/Leverage/.test(el.innerHTML) && /Risk guard/.test(el.innerHTML) && /Jarvis/.test(el.innerHTML));
  assert.ok(!/undefined|NaN/.test(el.innerHTML), 'no undefined/NaN in markup');
  void calls;
});

console.log(`apex: ${n}/${n} passed`);
