/* v191 — Business check (ui/business.js, UMD) + the committed data/business.json.
   Run: node producer/business.test.mjs
   The contract: never default to healthy, keep the core designation apart from the verdict,
   and stay out of every trading rule. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const B = require('../ui/business.js');
const file = JSON.parse(readFileSync(new URL('../data/business.json', import.meta.url), 'utf8'));

let n = 0; const ok = (name, fn) => { fn(); n++; console.log('  ✓', name); };
const iren = file.names.IREN;
const clone = (o) => JSON.parse(JSON.stringify(o));

ok('committed file: schema 1 and every record is structurally complete', () => {
  assert.equal(file.schema, 1);
  for (const [sym, rec] of Object.entries(file.names)) assert.deepEqual(B.problems(rec), [], sym);
});

ok('committed IREN record: 3 milestones, dated sources, invalidators, frozen reference close', () => {
  assert.equal(iren.milestones.length, 3);
  assert.ok(iren.sources.every((s) => /^https:\/\//.test(s.url) && /^\d{4}-\d{2}-\d{2}$/.test(s.date)));
  assert.ok(iren.invalidators.length >= 1);
  assert.ok(iren.refClose && iren.refClose.px > 0 && iren.refClose.date <= iren.asOf);
  assert.ok(Date.parse(iren.frozenAt) >= Date.parse(iren.asOf + 'T00:00:00Z'));
});

ok('fresh record shows its stored verdict', () => {
  const v = B.assess(iren, '2026-11-06');
  assert.equal(v.status, 'intact');
  assert.equal(v.reason, '');
});

ok('no record → Unverified, never healthy', () => {
  assert.equal(B.assess(null, '2026-11-06').status, 'unverified');
  assert.equal(B.assess(undefined, '2026-11-06').status, 'unverified');
});

ok('no dated source → Unverified even if the verdict says improving', () => {
  const r = clone(iren); r.status = 'improving'; r.sources = [{ title: 'x', url: 'https://x.test' }];
  const v = B.assess(r, '2026-11-06');
  assert.equal(v.status, 'unverified');
  assert.match(v.reason, /no dated source/);
  assert.equal(v.stored, 'improving');
});

ok('unknown verdict word → Unverified', () => {
  const r = clone(iren); r.status = 'healthy';
  assert.equal(B.assess(r, '2026-11-06').status, 'unverified');
});

ok('fewer than 3 milestones → Unverified', () => {
  const r = clone(iren); r.milestones = r.milestones.slice(0, 2);
  assert.equal(B.assess(r, '2026-11-06').status, 'unverified');
});

ok('review date passed by more than the grace → Unverified (review overdue)', () => {
  const nr = iren.nextReview.date;
  const inGrace = new Date(Date.parse(nr + 'T00:00:00Z') + B.GRACE_DAYS * 864e5).toISOString().slice(0, 10);
  const past = new Date(Date.parse(nr + 'T00:00:00Z') + (B.GRACE_DAYS + 1) * 864e5).toISOString().slice(0, 10);
  assert.equal(B.assess(iren, inGrace).status, 'intact');
  const v = B.assess(iren, past);
  assert.equal(v.status, 'unverified');
  assert.match(v.reason, /Review overdue/);
});

ok('evidence older than MAX_AGE_DAYS → Unverified even with no review date', () => {
  const r = clone(iren); delete r.nextReview;
  const old = new Date(Date.parse(r.asOf + 'T00:00:00Z') + (B.MAX_AGE_DAYS + 1) * 864e5).toISOString().slice(0, 10);
  assert.equal(B.assess(r, old).status, 'unverified');
});

ok('history must be older than the current assessment (append-only freeze)', () => {
  const r = clone(iren); r.history = [{ asOf: '2026-12-01', status: 'improving' }];
  assert.match(B.problems(r).join(), /history newer/);
});

ok('forSymbols: one row per symbol, deduped, unknown names Unverified, core flag separate from verdict', () => {
  const rows = B.forSymbols(['IREN', 'NVDA', 'IREN'], file, { positions: [{ symbol: 'IREN', qty: 500, px: 18.03, avg: 44.84 }], core: 'IREN', today: '2026-11-06' });
  assert.deepEqual(rows.map((r) => r.sym), ['IREN', 'NVDA']);
  assert.equal(rows[0].core, true);
  assert.equal(rows[0].view.status, 'intact');
  assert.equal(rows[1].view.status, 'unverified');
  assert.equal(rows[1].held, false);
  assert.ok(Math.abs(rows[0].fromCost - (18.03 / 44.84 - 1)) < 1e-9);
});

ok('html: unverified tile says it is not a health signal; core chip does not change the verdict', () => {
  const rows = B.forSymbols(['IREN', 'NVDA'], file, { positions: [{ symbol: 'IREN', qty: 500, px: 18.03, avg: 44.84 }], core: 'IREN', today: '2026-11-06' });
  const h = B.html(rows);
  assert.match(h, /data-biz="NVDA" data-biz-status="unverified"/);
  assert.match(h, /not a health signal/);
  assert.match(h, /Not assessed yet/);
  assert.match(h, /<details class="biz-row" data-biz="IREN" data-biz-status="intact"/, 'assessed name is one collapsed row');
  assert.match(h, /1 Intact/); assert.match(h, /1 Unverified/);
  assert.ok(h.indexOf('data-biz="IREN"') < h.indexOf('data-biz="NVDA"'), 'assessed tiles come first');
  assert.match(h, /data-biz="IREN" data-biz-status="intact"/);
  assert.match(h, /core · your rule/);
  assert.match(h, /Informational only/);
  assert.ok(!/<script/i.test(h));
});

ok('funds (SPY, VTI…) get no business check and are listed apart, not as Unverified', () => {
  const rows = B.forSymbols(['SPY', 'IREN', 'VTI'], file, { today: '2026-11-06' });
  assert.equal(rows[0].fund, true);
  const h = B.html(rows);
  assert.match(h, /data-biz="SPY" data-biz-status="fund"/);
  assert.ok(!/data-biz="VTI" data-biz-status="unverified"/.test(h));
  assert.match(h, /Funds — no single business/);
});

ok('index.html: both books paint through one loader; neither rule path reads it', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /data-apex-business/);
  assert.match(html, /data-ag-business/);
  assert.equal((html.match(/fetch\('data\/business\.json/g) || []).length, 1, 'one fetch site (bizLoad)');
});

ok('compact: worst verdict sorts first and rows start collapsed', () => {
  const w = clone(iren); w.status = 'weakening';
  const f = { names: { IREN: iren, ABC: w } };
  const h = B.html(B.forSymbols(['IREN', 'ABC'], f, { today: '2026-11-06' }));
  assert.ok(h.indexOf('data-biz="ABC"') < h.indexOf('data-biz="IREN"'));
  assert.ok(!/<details class="biz-row"[^>]*\sopen/.test(h));
});

ok('html escapes record text', () => {
  const r = clone(iren); r.summary = '<img onerror=x>';
  const h = B.html(B.forSymbols(['IREN'], { names: { IREN: r } }, { today: '2026-11-06' }));
  assert.ok(!h.includes('<img onerror'));
});

ok('trading rules never read the business check', () => {
  const apex = readFileSync(new URL('../ui/apex.js', import.meta.url), 'utf8');
  const sd = readFileSync(new URL('../ui/sd-rules.js', import.meta.url), 'utf8');
  for (const src of [apex, sd]) {
    assert.ok(!/Business\.|business\.json|__BIZ/.test(src), 'rule modules must not reference the business check');
  }
  // Apex only reserves an empty slot for the tiles.
  assert.equal((apex.match(/data-apex-business/g) || []).length, 1);
});

console.log(`business: ${n}/${n} passed`);
