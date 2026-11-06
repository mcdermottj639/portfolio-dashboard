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
const clone = (o) => JSON.parse(JSON.stringify(o));
/* v194: behavior tests run on a FROZEN FIXTURE (the Nov 6 2026 IREN record), never on the live file.
   The weekly writer replaces data/business.json records with new grades; a real "weakening" or
   "broken" grade must never fail CI. The live file only gets the structural checks below. */
const iren = {
  "thesis": "AI cloud capacity gets built, accepted by customers and turned into recognized revenue, funded without heavy dilution.",
  "status": "intact",
  "summary": "Demand up, delivery late, financing still open.",
  "asOf": "2026-11-05",
  "frozenAt": "2026-11-06T06:15:00Z",
  "assessor": "Claude (Jack's chat), from LAB-009 + the Nov 5 issuer release",
  "refClose": {
    "px": 18.03,
    "date": "2026-11-05",
    "source": "crypto.news, Nov 5 close"
  },
  "milestones": [
    {
      "name": "Revenue conversion",
      "state": "met",
      "metric": "AI Cloud revenue $200M in Q1 FY27, up 182% from $71M",
      "asOf": "2026-11-05"
    },
    {
      "name": "Delivery",
      "state": "late",
      "metric": ">$4B ARR target moved from year-end 2026 to Jan 31 2027, may extend to end of Feb",
      "asOf": "2026-11-05"
    },
    {
      "name": "Financing & dilution",
      "state": "open",
      "metric": "$4B ARR program stated fully funded; $6B of FY27 capex still to be financed; net debt $4.4B",
      "asOf": "2026-11-05"
    }
  ],
  "changed": "Nov 5 print: revenue beat and backlog up 22% to $20.3B, but the >$4B ARR date slipped 1–2 months (customer-requested design change + supplier timing). ARR is a run-rate target, not recognized revenue.",
  "invalidators": [
    ">$4B ARR not operating by Feb 28 2027, or customer acceptance fails",
    "AI Cloud revenue falls quarter over quarter at the Q2 FY27 print",
    "The $6B FY27 capex is funded mainly by new shares rather than contracted prepayments or GPU debt",
    "A major customer contract is cut or cancelled"
  ],
  "nextReview": {
    "date": "2027-01-31",
    "trigger": "ARR target date — delivery / customer acceptance update; then the Q2 FY27 print"
  },
  "sources": [
    {
      "title": "IREN Q1 FY27 results (issuer release)",
      "url": "https://www.globenewswire.com/news-release/2026/11/05/3397020/0/en/iren-reports-q1-fy27-results.html",
      "date": "2026-11-05"
    },
    {
      "title": "Blockspace: Q1 FY27 recap (net debt, $6B capex to finance)",
      "url": "https://blockspace.media/insight/iren-ai-cloud-revenue-growth/",
      "date": "2026-11-05"
    },
    {
      "title": "Research Lab LAB-009 (ChatGPT) — Nov 5 earnings update",
      "url": "https://docs.google.com/document/d/1bQE67vEyivZDlKpbGsuD5R9-m5iy_4b02ND1hCIgCjg/edit",
      "date": "2026-11-05"
    }
  ],
  "history": []
};
const fixture = { schema: 1, names: { IREN: iren } };

ok('committed file: schema 1; every graded record is complete; unverified records may be partial', () => {
  assert.equal(file.schema, 1);
  for (const [sym, rec] of Object.entries(file.names)) {
    assert.ok(B.STATUSES.includes(rec.status), sym + ': known verdict');
    assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(rec.asOf || ''), sym + ': asOf date');
    if (rec.status !== 'unverified' && !rec.fund) assert.deepEqual(B.problems(rec), [], sym);
    if (rec.refClose && rec.refClose.date) assert.ok(rec.refClose.date <= rec.asOf, sym + ': refClose on or before asOf');
    if (Array.isArray(rec.history)) for (const h of rec.history) assert.ok(!h.asOf || h.asOf <= rec.asOf, sym + ': history older than current');
  }
});

ok('an unverified record with no sources renders as Unverified (writer may publish one)', () => {
  const r = { status: 'unverified', asOf: '2026-11-06', summary: 'no dated primary evidence', changed: 'none found', history: [] };
  const h = B.html(B.forSymbols(['ZZZ'], { names: { ZZZ: r } }, { today: '2026-11-06' }));
  assert.match(h, /data-biz="ZZZ" data-biz-status="unverified"/);
});

ok('fixture IREN record: 3 milestones, dated sources, invalidators, frozen reference close', () => {
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
  const rows = B.forSymbols(['IREN', 'NVDA', 'IREN'], fixture, { positions: [{ symbol: 'IREN', qty: 500, px: 18.03, avg: 44.84 }], core: 'IREN', today: '2026-11-06' });
  assert.deepEqual(rows.map((r) => r.sym), ['IREN', 'NVDA']);
  assert.equal(rows[0].core, true);
  assert.equal(rows[0].view.status, 'intact');
  assert.equal(rows[1].view.status, 'unverified');
  assert.equal(rows[1].held, false);
  assert.ok(Math.abs(rows[0].fromCost - (18.03 / 44.84 - 1)) < 1e-9);
});

ok('html: unverified tile says it is not a health signal; core chip does not change the verdict', () => {
  const rows = B.forSymbols(['IREN', 'NVDA'], fixture, { positions: [{ symbol: 'IREN', qty: 500, px: 18.03, avg: 44.84 }], core: 'IREN', today: '2026-11-06' });
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
  const rows = B.forSymbols(['SPY', 'IREN', 'VTI'], fixture, { today: '2026-11-06' });
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
