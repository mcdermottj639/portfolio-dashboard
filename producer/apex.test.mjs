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
  assert.ok(!fr.some((x) => x.title.startsWith('IREN')), 'v188: IREN core (100 ≤ 500 sh) is not drift-trimmed');
  const big = A.rules(A.state({ positions: [{ symbol: 'IREN', qty: 900, px: 100, avg: 100 }, { symbol: 'NVDA', qty: 10, px: 100, avg: 100 }], cash: 0 }), { friday: true });
  assert.ok(big.some((x) => x.kind === 'drift' && x.title.startsWith('IREN')), 'above the core, drift applies again');
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

/* v188 — tonight's real book (2026-11-05 19:06 ET): IREN 500 @ $18.02 (cost 44.84), no debt, equity $9,918. */
const nov5 = { positions: [{ symbol: 'IREN', qty: 500.07, px: 18.015, avg: 44.84 }], cash: 445.91, equity: 9917.94 };

ok('v188 core: IREN ≤ 500 sh below the 25% stop is HELD, not exited', () => {
  const r = A.rules(A.state(nov5));
  assert.ok(!r.some((x) => x.kind === 'lose'), 'no stop ticket on the core');
  assert.ok(r.some((x) => x.kind === 'core'));
});

ok('v188 core: shares above the core still follow the stop', () => {
  const r = A.rules(A.state({ positions: [{ symbol: 'IREN', qty: 700, px: 18, avg: 44.84 }], cash: 0 }));
  const lose = r.find((x) => x.kind === 'lose');
  assert.ok(lose && lose.ticket.qty === 200);
});

ok('v188 build: lev < 1.2x, trend shut → armed buys split 20/15/15/10 to 1.35x, never the core', () => {
  const s = A.state(nov5);
  const px = { NVDA: { px: 181.59 }, PLTR: { px: 154.85 }, RKLB: { px: 45.98 }, CRWD: { px: 217.2 } };
  const r = A.rules(s, { smaMap: px });
  const b = r.filter((x) => x.kind === 'build');
  assert.deepEqual(b.map((x) => x.ticket && x.ticket.sym), ['NVDA', 'PLTR', 'RKLB', 'CRWD']);
  assert.ok(b.every((x) => x.ticket.armed && x.ticket.side === 'buy'));
  const room = 1.35 * 9917.94 - 500.07 * 18.015;
  const spend = b.reduce((a, x) => a + x.ticket.qty * x.ticket.px, 0);
  assert.ok(spend <= room + 0.01 && spend > room * 0.8, `spend ${spend} vs room ${room}`);
  assert.equal(b[0].ticket.qty, Math.floor((room * 20 / 60) / 181.59));
});

ok('v188 build: does not fire when the reload rule is open', () => {
  const pos = [{ symbol: 'NVDA', qty: 10, px: 200, avg: 150 }, { symbol: 'PLTR', qty: 10, px: 170, avg: 150 }, { symbol: 'CRWD', qty: 5, px: 250, avg: 230 }];
  const sma = { NVDA: { s50: 190 }, PLTR: { s50: 160 }, CRWD: { s50: 240 } };
  const r = A.rules(A.state({ positions: pos, cash: 2000 }), { smaMap: sma });
  assert.ok(r.some((x) => x.kind === 'reload') && !r.some((x) => x.kind === 'build'));
});

ok('v188 render: research tiles show top names; empty state is explicit', () => {
  const el = { innerHTML: '', querySelector: () => null };
  const res = { rows: [{ sym: 'AVGO', score: 7.4, px: 300, rs3: 12, fromHi: -6, s50: 290 }], asOf: '2026-11-05', source: 'momentum lens' };
  A.render(el, A.state(nov5), A.rules(A.state(nov5)), {}, res);
  assert.ok(/Research — top 5/.test(el.innerHTML) && /AVGO/.test(el.innerHTML) && /7\.4/.test(el.innerHTML));
  assert.ok(!/undefined|NaN/.test(el.innerHTML));
  A.render(el, A.state(nov5), [], {}, null);
  assert.ok(/No scored names yet/.test(el.innerHTML));
});

ok('v189 render: scan research rows (composite + why + target badge) render; IREN-only targets build nothing', () => {
  const el = { innerHTML: '', querySelector: () => null };
  const st = A.state(nov5);
  const out = A.rules(st, { cfg: { targets: { IREN: 20 } } });
  assert.ok(!out.some((x) => x.kind === 'build'), 'no fixed list ⇒ no build rungs');
  const res = { rows: [{ sym: 'VRT', score: 7.8, px: 150, target: 20, why: 'AI power leader, earnings beat', rr: 2.4, held: false }], asOf: '2026-11-06', source: 'Friday research' };
  A.render(el, st, out, { targets: { IREN: 20, VRT: 20 } }, res);
  assert.ok(/VRT 🎯 20%/.test(el.innerHTML) && /R\/R 2\.4/.test(el.innerHTML) && /AI power leader/.test(el.innerHTML));
  assert.ok(!/undefined|NaN/.test(el.innerHTML));
});

ok('v190 render: record line, vetoed names, vol + extended badge', () => {
  const el = { innerHTML: '', querySelector: () => null };
  const res = { rows: [{ sym: 'VRT', score: 7.8, px: 150, target: 14, why: 'AI power leader', rr: 2.4, vol: 62, extended: true }], asOf: '2026-11-06', source: 'Friday research',
    record: { n5: 4, hit5: 0.75, avgAlpha5: 1.2, n30: 0, n90: 0 }, vetoed: [{ sym: 'SMCI', why: 'accounting probe' }] };
  A.render(el, A.state(nov5), [], { targets: { IREN: 20, VRT: 14 } }, res);
  assert.ok(/5d 75% beat · \+1\.2pp \(n=4\)/.test(el.innerHTML), 'record line');
  assert.ok(/News veto: SMCI — accounting probe/.test(el.innerHTML));
  assert.ok(/vol 62%/.test(el.innerHTML) && /⏳ extended/.test(el.innerHTML));
  assert.ok(!/undefined|NaN/.test(el.innerHTML));
  A.render(el, A.state(nov5), [], {}, { rows: res.rows, record: { n5: 0, n30: 0, n90: 0 } });
  assert.ok(/no graded picks yet/.test(el.innerHTML));
});

/* v194 — Jack 2026-11-06 11:34 "always put the entry target prices" · 11:35 "make sure all can be bought on
   Robinhood always". Levels are the live Nov 6 scan rows (data/apex-targets.json); book = Nov 6 7:40 AM. */
const nov6 = { positions: [{ symbol: 'IREN', qty: 500.07, px: 21.25, avg: 44.84 }], cash: 445.91, equity: 11073.3 };
const lv = {
  AMZN: { trigger: 274.6, limit: 277.35, tp1: 280.14, stop: 253.89, name: 'Amazon', tradable: true },
  PLTR: { trigger: 181.02, limit: 182.83, tp1: 212.94, stop: 152.6, name: 'Palantir', tradable: true },
  S: { trigger: 23.62, limit: 23.86, tp1: 26.5, stop: 19.07, name: 'SentinelOne', tradable: true },
  ZS: { trigger: 229.22, tp1: 267.87, stop: 177.73, name: 'Zscaler', tradable: true },
};
const nov6cfg = { targets: { IREN: 20, AMZN: 22.13, PLTR: 14.03, S: 11.53, ZS: 12.31 }, levels: lv };
const nov6px = { AMZN: { px: 263.23 }, PLTR: { px: 162.03 }, S: { px: 21.93 }, ZS: { px: 204.18 } };

ok('v194 levelsFor: limit defaults to trigger × 1.01; R/R is measured at the LIMIT, not the prior close', () => {
  const z = A.levelsFor(nov6cfg, 'ZS');
  assert.equal(z.limit, 231.51);
  assert.ok(Math.abs(z.rr - (267.87 - 231.51) / (231.51 - 177.73)) < 1e-9);
  const a = A.levelsFor(nov6cfg, 'AMZN');
  assert.ok(Math.abs(a.rr - 0.119) < 0.001, `AMZN rr ${a.rr}`);   // $2.79 reward vs $23.46 risk
  assert.equal(A.levelsFor(nov6cfg, 'NVDA'), null);
});

ok('v194 build: rungs carry entry/target/stop/R-R + name, sized at the limit like the Jarvis tickets', () => {
  const b = A.rules(A.state(nov6), { cfg: nov6cfg, smaMap: nov6px }).filter((x) => x.kind === 'build');
  assert.deepEqual(b.map((x) => x.levels.sym), ['AMZN', 'PLTR', 'S', 'ZS']);
  const amzn = b[0];
  assert.equal(amzn.levels.trigger, 274.6); assert.equal(amzn.levels.limit, 277.35);
  assert.equal(amzn.levels.tp1, 280.14); assert.equal(amzn.levels.stop, 253.89);
  assert.equal(amzn.levels.name, 'Amazon');
  assert.ok(/at \$274\.60/.test(amzn.title), amzn.title);
  const room = 1.35 * 11073.3 - 500.07 * 21.25, W = 22.13 + 14.03 + 11.53 + 12.31;
  assert.equal(amzn.ticket.qty, Math.floor(Math.min(0.2 * 11073.3, room * 22.13 / W) / 277.35));
  assert.ok(b.every((x) => x.lowRR), 'all four Nov 6 rungs sit under the 1.5 floor at their real entry');
});

ok('v194 build: a name the scan marked untradable on Robinhood never becomes a buy rung', () => {
  const cfg = { ...nov6cfg, levels: { ...lv, S: { ...lv.S, tradable: false, tradableAt: '2026-11-06 11:35 ET' } } };
  const r = A.rules(A.state(nov6), { cfg, smaMap: nov6px });
  assert.ok(!r.some((x) => x.kind === 'build' && x.levels && x.levels.sym === 'S'));
  const sk = r.find((x) => x.kind === 'skip');
  assert.ok(sk && /S skipped — not buyable on Robinhood/.test(sk.title) && !sk.ticket);
});

ok('v194 render: 2×2 entry · target · stop · R/R grid, floor warning, name + Robinhood link', () => {
  const el = { innerHTML: '', querySelector: () => null };
  const st = A.state(nov6);
  A.render(el, st, A.rules(st, { cfg: nov6cfg, smaMap: nov6px }), nov6cfg, null);
  const h = el.innerHTML;
  assert.ok(/Entry/.test(h) && /\$274\.60/.test(h) && /limit \$277\.35/.test(h));
  assert.ok(/\$280\.14/.test(h) && /\$253\.89/.test(h) && /R\/R at entry/.test(h) && /0\.12/.test(h));
  assert.ok(/below R\/R floor/.test(h) && /Under your 1\.5 R\/R floor/.test(h));
  assert.ok(/SentinelOne/.test(h) && /https:\/\/robinhood\.com\/stocks\/S"/.test(h) && /Open in Robinhood/.test(h));
  assert.ok(!/undefined|NaN/.test(h), 'no undefined/NaN in markup');
});

ok('v194 drift: weekly review flag (Monday) — `friday` still accepted; copy says Monday', () => {
  const big = A.state({ positions: [{ symbol: 'IREN', qty: 900, px: 100, avg: 100 }, { symbol: 'NVDA', qty: 10, px: 100, avg: 100 }], cash: 0 });
  const d1 = A.rules(big, { review: true }).filter((x) => x.kind === 'drift');
  const d2 = A.rules(big, { friday: true }).filter((x) => x.kind === 'drift');
  assert.ok(d1.length && d1.length === d2.length);
  assert.ok(!A.rules(big, {}).some((x) => x.kind === 'drift'));
  assert.ok(d1.every((x) => !/Friday/.test(x.why)));
});

ok('v194 build without levels keeps the v188 live-price sizing (old snapshots)', () => {
  const s = A.state(nov5);
  const b = A.rules(s, { smaMap: { NVDA: { px: 181.59 }, PLTR: { px: 154.85 }, RKLB: { px: 45.98 }, CRWD: { px: 217.2 } } }).filter((x) => x.kind === 'build');
  assert.ok(b.every((x) => !x.levels));
});

console.log(`apex: ${n}/${n} passed`);
