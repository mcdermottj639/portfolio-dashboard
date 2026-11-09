/* v186 — Apex leverage-loop rules (ui/apex.js, UMD).
   Run: node producer/apex.test.mjs
   Numbers are the 2026-11-05 00:15 ET snapshot of the margin book, rounded:
   IREN 900 @ $20.83 (cost 37.50), PLTR 100 @ $168.78 (cost 169.75), debt $23,686. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const A = require('../ui/apex.js');
// v201: IREN is owner-managed by default (no IREN sells). The mechanics stay tested under the old config.
const LEGACY = { coreOwner: false, ladder: [{ sym: 'IREN', px: 30, qty: 200, note: 'newest lots first' }] };

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
  const r = A.rules(s, { cfg: LEGACY });
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
  const lad = A.rules(s, { cfg: LEGACY }).find((x) => x.kind === 'ladder');
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
  const big = A.rules(A.state({ positions: [{ symbol: 'IREN', qty: 900, px: 100, avg: 100 }, { symbol: 'NVDA', qty: 10, px: 100, avg: 100 }], cash: 0 }), { friday: true, cfg: LEGACY });
  assert.ok(big.some((x) => x.kind === 'drift' && x.title.startsWith('IREN')), 'above the core, drift applies again (legacy cfg)');
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
  const r = A.rules(A.state({ positions: [{ symbol: 'IREN', qty: 700, px: 18, avg: 44.84 }], cash: 0 }), { cfg: LEGACY });
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

/* v195 — LAB-004-P1: the risk guard follows the maintenance requirement (ChatGPT's 2026-11-07 finding:
   with maint 0.50 the fixed 35% / 40% lines missed a book already under its call and sold only back to 40%).
   Guard = requirement + 5 pts, recovery = requirement + 10 pts (capped at no debt); the default 30% book is unchanged. */
const flat = (E, eq, maint, sym = 'X', px = 1) => ({ positions: [{ symbol: sym, qty: E / px, px, avg: px }], cash: -(E - eq), maint });
const risk = (st, opt) => A.rules(st, opt).filter((x) => x.kind === 'risk');
const lastCheck = (rs) => rs[rs.length - 1].after.check;

ok('v195 default 30%: guard 35%, recovery 40%, the 3x book sells the same 50-share PLTR tranche as v194', () => {
  const s = A.state(book);
  assert.equal(s.maint, 0.30); assert.equal(s.guardPct, 0.35); assert.ok(Math.abs(s.guardTarget - 0.40) < 1e-12);
  const r = risk(s);
  assert.equal(r.length, 1); assert.equal(r[0].ticket.sym, 'PLTR'); assert.equal(r[0].ticket.qty, 50);
  assert.ok(lastCheck(r).eqPct >= 0.40 && lastCheck(r).ok);
  assert.equal(A.C.GUARD_PCT, A.C.MAINT + A.C.GUARD_BUFFER);
});

ok('v195 25% maintenance: guard moves down to 30% — a 32% book holds, a 28% book sells back to ≥ 35%', () => {
  assert.equal(risk(A.state(flat(1000, 320, 0.25))).length, 0);
  const s = A.state(flat(1000, 280, 0.25));
  assert.ok(Math.abs(s.guardPct - 0.30) < 1e-12 && Math.abs(s.guardTarget - 0.35) < 1e-12);
  const r = risk(s); assert.equal(r.length, 1);
  const c = lastCheck(r); assert.ok(c.ok && c.eqPct >= 0.35 - 1e-9, `after ${c.eqPct}`);
});

ok('v195 30% maintenance: 34% fires, 36% holds', () => {
  assert.equal(risk(A.state(flat(1000, 340, 0.30))).length, 1);
  assert.equal(risk(A.state(flat(1000, 360, 0.30))).length, 0);
});

ok('v195 50% maintenance (ChatGPT case 1): 100/40/60 is under its call — the guard now fires', () => {
  const s = A.state(flat(100, 40, 0.50));
  assert.ok(s.cushion < 0, 'below maintenance');
  assert.equal(s.guardPct, 0.55); assert.ok(Math.abs(s.guardTarget - 0.60) < 1e-12);
  const r = risk(s); assert.equal(r.length, 1);
  assert.ok(lastCheck(r).eqPct >= 0.60 - 1e-9);
});

ok('v195 50% maintenance (ChatGPT case 2): 1000/340/660 sells back above 60%, never stops at 40%', () => {
  const s = A.state(flat(1000, 340, 0.50));
  const r = risk(s); assert.equal(r.length, 1);
  const c = lastCheck(r);
  assert.ok(c.ok && c.eqPct >= 0.60 - 1e-9 && c.eqPct > 0.50, `after ${c.eqPct}`);
  // exact sale: (500 + 100 − 340)/0.6 = 433.3 → 434 units (vs 150 under the old fixed 40% target)
  assert.equal(r[0].ticket.qty, 434);
});

ok('v195 100% requirement (non-marginable name): any debt fires and the plan pays it all down', () => {
  const s = A.state(flat(1000, 900, 1));
  assert.equal(s.guardPct, 1); assert.equal(s.guardTarget, 1);
  const r = risk(s); assert.equal(r.length, 1); assert.equal(r[0].after.debt, 0);
});

ok('v195 concentrated position: per-name 50% on IREN blends with 30% on PLTR; selling the low-requirement donor re-blends', () => {
  const pos = [{ symbol: 'IREN', qty: 1000, px: 20, avg: 40, maint: 0.50 }, { symbol: 'PLTR', qty: 60, px: 100, avg: 100, maint: 0.30 }];
  const s = A.state({ positions: pos, cash: -15000 });          // exposure 26,000 · equity 11,000 = 42.3%
  assert.equal(s.req, 0.5 * 20000 + 0.3 * 6000);                  // 11,800 — already under the call
  assert.ok(Math.abs(s.maint - 11800 / 26000) < 1e-12);
  assert.equal(A.state({ positions: pos, cash: -15000, maint: 0.30 }).req, s.req, 'per-name maint wins over the account default');
  assert.ok(s.eqPct > 0.40 && s.eqPct < s.guardPct, 'old fixed 35% line would have held this book');
  const r = risk(s, { cfg: LEGACY });
  assert.equal(r[0].ticket.sym, 'PLTR');
  assert.equal(r[0].ticket.qty, 60, 'the whole donor goes first');
  assert.ok(r.slice(1).every((x) => x.ticket.sym === 'IREN' && !x.ticket.core), 'then IREN shares above the 500-share core, core kept');
  const c = lastCheck(r);
  assert.ok(c.eqPct >= c.guardTarget - 1e-9, `post-sale ${c.eqPct} vs re-blended target ${c.guardTarget}`);
  assert.ok(c.maint > s.maint, 'selling the 30% name raises the blended requirement');
});

ok('v195 insufficient donor: next names, then core shares, core flagged; never stops short silently', () => {
  const pos = [{ symbol: 'IREN', qty: 500, px: 20, avg: 40 }, { symbol: 'PLTR', qty: 5, px: 100, avg: 100 }, { symbol: 'AMZN', qty: 10, px: 200, avg: 200 }];
  const s = A.state({ positions: pos, cash: -9000, maint: 0.50 });   // exposure 12,500 · equity 3,500
  const r = risk(s, { cfg: LEGACY });
  assert.deepEqual(r.map((x) => x.ticket.sym), ['PLTR', 'AMZN', 'IREN']);
  assert.equal(r[2].ticket.core, true); assert.match(r[2].title, /core IREN/);
  const c = lastCheck(r); assert.ok(c.ok && c.eqPct >= 0.60 - 1e-9);
  assert.ok(r[2].ticket.qty <= 500);
});

ok('v195 negative equity: selling everything is not enough — the last leg says how much to deposit', () => {
  const s = A.state({ positions: [{ symbol: 'PLTR', qty: 10, px: 100, avg: 100 }], cash: -1200, maint: 0.30 });
  const r = risk(s); const c = lastCheck(r);
  assert.equal(c.ok, false); assert.ok(c.short > 0); assert.match(r[r.length - 1].why, /deposit/);
});

ok('v195 broker requirement (options, house calls) raises the line when higher than the per-name sum', () => {
  const s = A.state({ ...flat(1000, 380, 0.30), maintReq: 400 });
  assert.equal(s.maint, 0.40); assert.ok(Math.abs(s.guardPct - 0.45) < 1e-12);
  assert.equal(risk(s).length, 1);
  assert.equal(A.state({ ...flat(1000, 380, 0.30), maintReq: 100 }).maint, 0.30, 'a lower broker figure never loosens it');
});

ok('v195 tripwire follows the requirement: at 50% it lands exactly on the 55% guard', () => {
  const s = A.state({ positions: [{ symbol: 'IREN', qty: 900, px: 30, avg: 37.5 }, { symbol: 'PLTR', qty: 100, px: 168.78, avg: 169.75 }], cash: -15000, maint: 0.50 });
  const x = A.tripwire(s, 'IREN');
  const s2 = A.state({ positions: [{ symbol: 'IREN', qty: 900, px: x, avg: 37.5 }, { symbol: 'PLTR', qty: 100, px: 168.78, avg: 169.75 }], cash: -15000, maint: 0.50 });
  assert.ok(Math.abs(s2.eqPct - 0.55) < 1e-9, `eq% at tripwire ${s2.eqPct}`);
});

ok('v195 render: the gauge and caption show the book\'s own guard, not a fixed 35%', () => {
  const el = { innerHTML: '', querySelector: () => null };
  const s = A.state(flat(1000, 340, 0.50, 'PLTR', 10));
  A.render(el, s, A.rules(s));
  assert.ok(/guard 55%/.test(el.innerHTML) && /call 50%/.test(el.innerHTML));
  assert.ok(!/undefined|NaN/.test(el.innerHTML));
});

/* v196 — Robinhood per-stock maintenance (Margin buffer screen, Jack 2026-11-08): IREN 30, AMZN 25, PLTR 25; rest 30. */
const withMaintBy = (positions, by = A.DEFAULT_CFG.maintBy) => positions.map((p) => (by[p.symbol] != null ? { ...p, maint: by[p.symbol] } : p));

ok('v196 DEFAULT_CFG.maintBy carries Robinhood\'s per-stock figures; S, ZS and the rest fall to 30%', () => {
  assert.deepEqual(A.DEFAULT_CFG.maintBy, { IREN: 0.30, AMZN: 0.25, PLTR: 0.25 });
  const s = A.state({ positions: withMaintBy([{ symbol: 'S', qty: 10, px: 20, avg: 20 }, { symbol: 'ZS', qty: 1, px: 300, avg: 300 }]), cash: 0 });
  assert.deepEqual(s.positions.map((p) => p.maint), [0.30, 0.30]);
});

ok('v196 blended requirement: Σ maint × value, guard = blend + 5, recovery = blend + 10', () => {
  const pos = withMaintBy([
    { symbol: 'IREN', qty: 500, px: 20, avg: 20 },   // 10,000 × .30 = 3,000
    { symbol: 'AMZN', qty: 8, px: 200, avg: 200 },   //  1,600 × .25 =   400
    { symbol: 'PLTR', qty: 10, px: 100, avg: 100 },  //  1,000 × .25 =   250
    { symbol: 'S', qty: 10, px: 20, avg: 20 },       //    200 × .30 =    60
  ]);
  const s = A.state({ positions: pos, cash: -3000 });
  assert.ok(Math.abs(s.req - 3710) < 1e-9, `req ${s.req}`);
  assert.ok(Math.abs(s.maint - 3710 / 12800) < 1e-12);
  assert.ok(Math.abs(s.guardPct - (3710 / 12800 + 0.05)) < 1e-12);
  assert.ok(Math.abs(s.guardTarget - (3710 / 12800 + 0.10)) < 1e-12);
  assert.ok(s.maint > 0.25 && s.maint < 0.30, 'blend sits between the 25% names and the 30% names');
  assert.equal(risk(s).length, 0, 'a 77% equity book trips nothing');
});

ok('v196 an all-IREN book is unchanged by maintBy (30% ⇒ guard 35% / 40%)', () => {
  const s = A.state({ positions: withMaintBy([{ symbol: 'IREN', qty: 1000, px: 10, avg: 10 }]), cash: -6600 });   // eq 34%
  assert.ok(Math.abs(s.guardPct - 0.35) < 1e-12 && Math.abs(s.guardTarget - 0.40) < 1e-12);
  assert.ok(risk(s).length >= 1);
});

ok('v196 a 25% name alone: guard 30%, recovery 35%; 32% holds, 29% sells back to ≥ 35%', () => {
  const hold = A.state({ positions: withMaintBy([{ symbol: 'PLTR', qty: 100, px: 10, avg: 10 }]), cash: -680 });
  assert.ok(Math.abs(hold.guardPct - 0.30) < 1e-12); assert.equal(risk(hold).length, 0);
  const trip = A.state({ positions: withMaintBy([{ symbol: 'PLTR', qty: 100, px: 10, avg: 10 }]), cash: -710 });
  const c = lastCheck(risk(trip)); assert.ok(c.ok && c.eqPct >= 0.35 - 1e-9, `after ${c && c.eqPct}`);
});

ok('v196 the app adapter merges DEFAULT_CFG.maintBy under any __APEX_CFG.maintBy override', () => {
  const fs = require('node:fs');
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /Object\.assign\(\{\},\(Apex\.DEFAULT_CFG&&Apex\.DEFAULT_CFG\.maintBy\)\|\|\{\},/);
});

ok('v197 research tiles: R/R at the shown entry, raw URLs become "source ↗" (Nov 6 live rows)', () => {
  const el = { innerHTML: '', querySelector: () => null };
  const url = 'https://www.sec.gov/Archives/edgar/data/0001018724/000101872426000038/amzn-20261029.htm';
  const rows = [
    { sym: 'AMZN', score: 7.02, target: 22.13, held: true, trigger: 274.6, limit: 277.35, tp1: 280.14, stop: 253.89, rr: 3.15, why: 'News: Q3 8-K [2026-10-29] ' + url },
    { sym: 'PANW', score: 5.64, trigger: 357.55, tp1: 432.32, stop: 312.12, rr: 46.14, why: 'Rev +34%; next print Nov 18' },
  ];
  A.render(el, A.state(nov5), [], {}, { rows, asOf: '2026-11-06' });
  const h = el.innerHTML;
  // AMZN (280.14 − 277.35) / (277.35 − 253.89) = 0.12 ; PANW limit 361.13 → (432.32 − 361.13) / (361.13 − 312.12) = 1.45
  assert.ok(/R\/R <span[^>]*>0\.12<\/span> at entry · under 1\.5/.test(h), 'AMZN at entry');
  assert.ok(/R\/R <span[^>]*>1\.45<\/span> at entry · under 1\.5/.test(h), 'PANW at entry, not 46.1');
  assert.ok(/Scan R\/R 46\.1 was measured from the prior close/.test(h), 'scan figure kept in the fold');
  assert.ok(/<summary[^>]*>📰 News · source<\/summary>/.test(h), 'news + link folded');
  assert.ok(h.includes('href="' + url + '"') && /source ↗/.test(h), 'link kept');
  assert.ok(!h.includes('>' + url) && !h.includes(url + '<'), 'URL not printed as text');
  assert.ok(!/undefined|NaN/.test(h));
});


// v199 — one "Confirm this week's Apex book" prompt: whole book, read-only wording, every armed rung listed.
{
  const cfg = Object.assign({}, A.DEFAULT_CFG, { targets: { IREN: 20, AMZN: 22, ZS: 12 }, levels: { AMZN: { trigger: 274.6, limit: 277.35, tp1: 280.14, stop: 253.89, name: 'Amazon' }, ZS: { trigger: 229.22, tp1: 267.87, stop: 177.73 } } });
  const st = A.state({ equity: 11073, debt: 0, positions: [{ symbol: 'IREN', qty: 500, px: 21.24, avg: 40.99 }], cash: 446 });
  const out = A.rules(st, { cfg, smaMap: { AMZN: { px: 252 }, ZS: { px: 214 } }, earningsMap: {}, review: false });
  const p = A.portfolioPrompt(st, out, cfg, null);
  assert.match(p, /FULL recommended portfolio/);
  assert.match(p, /never review_equity_order or place_equity_order/);
  assert.match(p, /BUY \d+ sh AMZN \(Amazon\) — trigger \$274\.60 · limit \$277\.35 · target \$280\.14 · stop \$253\.89/);
  assert.match(p, /BUY \d+ sh ZS — trigger \$229\.22/);
  assert.match(p, /IREN 500 sh @ \$21\.24 \(OWNER-MANAGED/);
  console.log('ok portfolioPrompt (v199)');
}

// v201 — Jack (Nov 8 22:38 ET): "stop telling me to sell the iren to clear margin. Just build the portfolio and I'll handle the iren."
ok('v201 default: no rule ever sells, trims, ladders or drift-flags IREN — at 3x, below the stop, above +25%, or over 500 sh', () => {
  const cases = [
    A.state(book),                                                                                         // 3x book, guard + cap fire
    A.state({ positions: [{ symbol: 'IREN', qty: 900, px: 18, avg: 44.84 }], cash: 0 }),                    // 900 sh through the stop
    A.state({ positions: [{ symbol: 'IREN', qty: 900, px: 60, avg: 40 }, { symbol: 'NVDA', qty: 1, px: 100, avg: 100 }], cash: 0 }),   // winner +50%
    A.state({ positions: [{ symbol: 'IREN', qty: 1000, px: 20, avg: 40 }, { symbol: 'PLTR', qty: 5, px: 100, avg: 100 }], cash: -15000 }), // donor too small
  ];
  for (const s of cases) {
    const r = A.rules(s, { review: true });
    assert.ok(!r.some((x) => x.ticket && x.ticket.sym === 'IREN'), 'no IREN ticket');
    assert.ok(!r.some((x) => (x.kind === 'drift' || x.kind === 'ladder' || x.kind === 'win' || x.kind === 'lose') && /IREN/.test(x.title)), 'no IREN drift/ladder/win/lose row');
    const c = r.find((x) => x.kind === 'core'); assert.ok(c && /your call/.test(c.title));
  }
  const r4 = A.rules(cases[3]).filter((x) => x.kind === 'risk');
  assert.deepEqual(r4.map((x) => x.ticket && x.ticket.sym).filter(Boolean), ['PLTR']);
  assert.match(r4[r4.length - 1].why, /IREN excluded — your call/);
});

ok('v201 confirm prompt: IREN marked owner-managed and Claude is told never to propose selling it', () => {
  const st = A.state(book);
  const p = A.portfolioPrompt(st, A.rules(st), A.DEFAULT_CFG, null);
  assert.match(p, /IREN \d+ sh @ \$[\d.]+ \(OWNER-MANAGED/);
  assert.match(p, /never tell me to sell or trim IREN/);
});

// v202 — Jack chose "Apex only" for ••0741 (Nov 8 ~23:05 ET). The old plan's wash-sale guard now reaches Apex, the
// owner-managed core stops reading as "over target", and the research tile names the limit its R/R uses.
ok('v202 tax hold: a wash-window target is a dated hold row, never a buy rung; the other targets still build', () => {
  const cfg = Object.assign({}, A.DEFAULT_CFG, { targets: { IREN: 20, AMZN: 22, PLTR: 14 },
    levels: { AMZN: { trigger: 274.6, limit: 277.35, tp1: 300, stop: 253.89 }, PLTR: { trigger: 181.02, limit: 182.83, tp1: 212.94, stop: 152.6 } },
    wash: { PLTR: { clear: '2030-02-01' } } });
  const st = A.state({ equity: 11073, positions: [{ symbol: 'IREN', qty: 500, px: 21.24, avg: 40.99 }], cash: 446 });
  const out = A.rules(st, { cfg, smaMap: { AMZN: { px: 252 }, PLTR: { px: 160 } }, earningsMap: {} });
  const hold = out.find((r) => r.kind === 'wash');
  assert.ok(hold && /PLTR — tax hold to 2030-02-01/.test(hold.title), 'dated hold row');
  assert.equal(hold.ticket, null, 'no ticket on a hold');
  assert.ok(!out.some((r) => r.ticket && r.ticket.sym === 'PLTR'), 'no PLTR order of any kind');
  const amzn = out.find((r) => r.kind === 'build' && r.levels && r.levels.sym === 'AMZN');
  assert.ok(amzn && amzn.levels.qty === 7, 'AMZN still builds: 20% of $11,073 ÷ $277.35 = 7 sh');
  const p = A.portfolioPrompt(st, out, cfg, null);
  assert.match(p, /TAX HOLD \(wash sale[^)]*\): PLTR until 2030-02-01 — WAIT/);
  assert.match(p, /a TAX HOLD name ⇒ WAIT until its date/);
  assert.match(p, /Target weights \(% of equity\): AMZN 22% · PLTR 14% — plus IREN, owner-managed \(no target\)\./);
  // without a hold the same book still arms PLTR — the hold is the only thing that removed it
  const free = A.rules(st, { cfg: Object.assign({}, cfg, { wash: {} }), smaMap: { AMZN: { px: 252 }, PLTR: { px: 160 } }, earningsMap: {} });
  assert.ok(free.some((r) => r.kind === 'build' && r.levels && r.levels.sym === 'PLTR'));
});

ok('v202 weights: the owner-managed core is a neutral bar with no target; a tax-hold target carries 🚫', () => {
  const el = { innerHTML: '', querySelector: () => null };
  const cfg = Object.assign({}, A.DEFAULT_CFG, { targets: { IREN: 20, AMZN: 22, PLTR: 14 }, wash: { PLTR: { clear: '2030-02-01' } } });
  const st = A.state({ equity: 11073, positions: [{ symbol: 'IREN', qty: 500, px: 21.24, avg: 40.99 }], cash: 446 });
  A.render(el, st, A.rules(st, { cfg }), cfg, null);
  const h = el.innerHTML;
  assert.match(h, />IREN<\/span><div class="gauge"[^>]*><div style="width:95\.9\d*%;height:100%;background:#9ca3af"><\/div><\/div><span[^>]*>96% · yours<\/span>/, 'IREN 500 × $21.24 ÷ $11,073 = 96%, grey, no target');
  assert.ok(!/96% \/ 20%/.test(h), 'no IREN target shown');
  assert.match(h, /PLTR <span title="tax hold to 2030-02-01">🚫<\/span>/);
  assert.ok(!/undefined|NaN/.test(h));
  // legacy core (not owner-managed) keeps the old target bar
  const el2 = { innerHTML: '', querySelector: () => null };
  const cfg2 = Object.assign({}, cfg, LEGACY);
  A.render(el2, st, A.rules(st, { cfg: cfg2 }), cfg2, null);
  assert.match(el2.innerHTML, /96% \/ 20%/);
});

ok('v202 research tiles: a tax-hold target is flagged and the tile names the limit its R/R is measured at', () => {
  const el = { innerHTML: '', querySelector: () => null };
  const rows = [{ sym: 'PLTR', score: 5.5, target: 14.03, trigger: 181.02, limit: 182.83, tp1: 212.94, stop: 152.6, vol: 0.499, why: 'Rev +96% YoY', wash: '2030-02-01' },
    { sym: 'ZS', score: 6.79, target: 12.31, trigger: 229.22, tp1: 267.87, stop: 177.73, vol: 70.2, why: 'pullback' }];
  A.render(el, A.state(nov5), [], {}, { rows, asOf: '2026-11-06' });
  const h = el.innerHTML;
  assert.match(h, /#1 PLTR 🎯 14\.03% · 🚫/);
  assert.match(h, /Entry \$181\.02 \(limit \$182\.83\) → \$212\.94 · stop \$152\.60/);
  assert.match(h, /🚫 Tax hold to 2030-02-01/);
  // (212.94 − 182.83) / (182.83 − 152.60) = 1.00 at the limit (LAB-010: 0.996)
  assert.match(h, /R\/R <span[^>]*>1\.00<\/span> at entry · under 1\.5/);
  // a row with no stored limit shows the trigger × 1.01 limit the R/R uses: 229.22 × 1.01 = 231.51
  assert.match(h, /Entry \$229\.22 \(limit \$231\.51\)/);
  // vol arrives as a fraction from the scan (0.499 = 50%), and an already-percent figure is left alone
  assert.match(h, /vol 50% · Rev \+96%/);
  assert.match(h, /vol 70% · pullback/);
  assert.ok(!/undefined|NaN/.test(h));
});

ok('v203 weights rows carry held / target / this-week shares and dollars; core shows held only', () => {
  const el = { innerHTML: '', querySelector: () => null };
  const st = A.state(nov6);
  const out = A.rules(st, { cfg: nov6cfg, smaMap: nov6px });
  A.render(el, st, out, nov6cfg, null);
  const h = el.innerHTML;
  const rung = out.find((r) => r.kind === 'build' && r.ticket && r.ticket.sym === 'AMZN');
  assert.ok(rung && rung.ticket.qty > 0, 'fixture arms an AMZN rung');
  assert.ok(new RegExp(`this week: buy ${rung.ticket.qty} sh ≈ \\$`).test(h), 'the weights row quotes the rung\'s share count');
  assert.ok(/hold \d[\d.]* sh · \$[\d.]+K? · yours/.test(h), 'core row: held shares and dollars, no target');
  assert.ok(/target \$[\d.]+K? \(\d+ sh( at the scan limit)?\)/.test(h), 'a target row: target dollars and shares at the current price');
  assert.ok(!/undefined|NaN/.test(h), 'no undefined/NaN in markup');
});


ok('v205 bookGaps: at 1.25x (no build rungs) the week\'s book still counts — adds for under-target names, exits for dropped ones, IREN never', () => {
  const cfg = Object.assign({}, A.DEFAULT_CFG, { targets: { IREN: 20, S: 16.18, ZS: 14.45, PLTR: 13.26, SNPS: 16.11 }, levels: { SNPS: { sym: 'SNPS', name: 'Synopsys', trigger: 460.31, limit: 464.91, tp1: 512.49, stop: 441.61, rr: 2.04 } } });
  const pos = [{ symbol: 'IREN', qty: 500.07, px: 20.73, avg: 40.99 }, { symbol: 'AMZN', qty: 6.07, px: 266.2, avg: 263.47 }, { symbol: 'PLTR', qty: 6.10, px: 162, avg: 168.45 }, { symbol: 'S', qty: 14, px: 21.77, avg: 21.91 }, { symbol: 'ZS', qty: 1, px: 197.66, avg: 202.18 }];
  const st = A.state({ positions: pos, cash: -2653 });
  const out = A.rules(st, { cfg, smaMap: {}, earningsMap: {}, review: true });
  assert.ok(!out.some((r) => r.kind === 'build'), 'no build rungs above 1.2x');
  const g = A.bookGaps(st, out, cfg);
  assert.deepEqual(g.adds.map((a) => a.sym).sort(), ['PLTR', 'S', 'SNPS', 'ZS']);
  assert.deepEqual(A.bookGaps(st, out, Object.assign({}, cfg, { wash: { PLTR: { clear: '2026-11-20' } } })).adds.map((a) => a.sym).sort(), ['S', 'SNPS', 'ZS'], 'a wash-window name stays a TAX HOLD, never an ADD');
  assert.deepEqual(g.exits.map((e) => e.sym), ['AMZN']);
  const p = A.portfolioPrompt(st, out, cfg, null);
  assert.match(p, /ADD SNPS \(Synopsys\) — held 0\.0% → target 16\.1%/);
  assert.match(p, /SELL 6\.07 AMZN/);
  assert.ok(!/SELL [\d.]+ IREN/.test(p) && !/ADD IREN/.test(p));
  assert.doesNotMatch(p, /undefined|NaN/);
});

console.log(`apex: ${n}/${n} passed`);
