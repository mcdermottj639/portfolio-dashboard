/* v191 — Business check: is the company doing what it promised? (pure + render)
   The Apex card's price rules only see the price. This is the second card beside it:
   one frozen assessment per symbol from data/business.json — verdict, three
   milestones, dated sources, what changed, what would break the thesis, next review.

   INFORMATIONAL ONLY. No stop, trim, weight, leverage or ticket logic reads this
   module (producer/business.test.mjs asserts ui/apex.js never references it).

   Never defaults to healthy: a missing record, an unknown verdict, no dated source,
   evidence older than MAX_AGE_DAYS, or a review date passed by more than GRACE_DAYS
   all display "Unverified". An owner-directed core designation is shown as its own
   chip and never changes the verdict.

   Loaded by index.html before the main inline script; require()-able from Node
   tests. Keep this file free of DOM access outside render(). */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Business = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const STATUSES = ['improving', 'intact', 'weakening', 'broken', 'unverified'];
  const MILESTONE_STATES = ['met', 'on-track', 'late', 'open', 'missed', 'unverified'];
  const MAX_AGE_DAYS = 120;   // about one quarter plus a month: older evidence is not current
  const GRACE_DAYS = 7;       // a review date may slip a week before the tile goes Unverified
  const DAY = 864e5;

  const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s + 'T00:00:00Z'));
  const toDay = (s) => Date.parse(s + 'T00:00:00Z');
  const todayISO = (d) => (d instanceof Date ? d : new Date()).toISOString().slice(0, 10);

  /* Structural problems with a record. Empty list = valid. */
  function problems(rec) {
    const p = [];
    if (!rec || typeof rec !== 'object') return ['no record'];
    if (!STATUSES.includes(rec.status)) p.push('unknown verdict');
    if (!isDate(rec.asOf)) p.push('no assessment date');
    const src = Array.isArray(rec.sources) ? rec.sources.filter((s) => s && /^https?:\/\//.test(s.url || '') && isDate(s.date)) : [];
    if (!src.length) p.push('no dated source');
    const ms = Array.isArray(rec.milestones) ? rec.milestones : [];
    if (ms.length !== 3) p.push('needs 3 milestones');
    if (ms.some((m) => !m || !m.name || !MILESTONE_STATES.includes(m.state))) p.push('milestone missing a name or state');
    if (!Array.isArray(rec.invalidators) || !rec.invalidators.length) p.push('no invalidator');
    if (rec.nextReview && rec.nextReview.date && !isDate(rec.nextReview.date)) p.push('bad review date');
    if (Array.isArray(rec.history) && rec.history.some((h) => !h || !isDate(h.asOf) || (isDate(rec.asOf) && toDay(h.asOf) > toDay(rec.asOf)))) p.push('history newer than current');
    return p;
  }

  /* The verdict to DISPLAY. {status, stored, reason, ageDays}. */
  function assess(rec, today) {
    const t = toDay(isDate(today) ? today : todayISO());
    if (!rec) return { status: 'unverified', stored: null, reason: 'No assessment yet', ageDays: null };
    const bad = problems(rec);
    if (bad.length) return { status: 'unverified', stored: rec.status || null, reason: 'Incomplete: ' + bad.join(', '), ageDays: null };
    const ageDays = Math.floor((t - toDay(rec.asOf)) / DAY);
    if (ageDays < 0) return { status: 'unverified', stored: rec.status, reason: 'Assessment dated in the future', ageDays };
    const nr = rec.nextReview && rec.nextReview.date;
    if (nr && t > toDay(nr) + GRACE_DAYS * DAY) return { status: 'unverified', stored: rec.status, reason: `Review overdue since ${nr}`, ageDays };
    if (ageDays > MAX_AGE_DAYS) return { status: 'unverified', stored: rec.status, reason: `Evidence is ${ageDays} days old`, ageDays };
    return { status: rec.status, stored: rec.status, reason: '', ageDays };
  }

  /* One row per symbol, in the order given (held names first, then targets). */
  function forSymbols(symbols, file, opts) {
    opts = opts || {};
    const names = (file && file.names) || {};
    const seen = new Set();
    return (symbols || []).filter((s) => s && !seen.has(s) && seen.add(s)).map((sym) => {
      const rec = names[sym] || null;
      const pos = (opts.positions || []).find((p) => p.symbol === sym) || null;
      const fromCost = pos && pos.avg > 0 && pos.px > 0 ? pos.px / pos.avg - 1 : null;
      return { sym, rec, view: assess(rec, opts.today), held: !!pos, fromCost, core: !!(opts.core && opts.core === sym) };
    });
  }

  /* ── render ─────────────────────────────────────────────────────────────── */
  const COL = { improving: ['#d1fae5', '#065f46'], intact: ['#dbeafe', '#1e40af'], weakening: ['#fef3c7', '#92400e'], broken: ['#fee2e2', '#991b1b'], unverified: ['#f3f4f6', '#4b5563'] };
  const MS = { met: ['✓', '#10b981'], 'on-track': ['●', '#3b82f6'], late: ['⏳', '#f59e0b'], open: ['…', '#6b7280'], missed: ['✗', '#ef4444'], unverified: ['?', '#9ca3af'] };
  const label = (s) => s.charAt(0).toUpperCase() + s.slice(1);

  function tileHtml(r, esc) {
    const c = COL[r.view.status] || COL.unverified;
    const chip = (txt, bg, fg) => `<span class="act-tag" style="background:${bg};color:${fg};margin:0">${esc(txt)}</span>`;
    const coreChip = r.core ? chip('core · your rule', '#e0f2fe', '#075985') : '';
    const price = r.fromCost != null ? `<span style="color:${r.fromCost < 0 ? '#ef4444' : '#10b981'}">${r.fromCost >= 0 ? '+' : ''}${(r.fromCost * 100).toFixed(0)}% from cost</span>` : (r.held ? '—' : 'not held');
    const head = `<div style="display:flex;justify-content:space-between;gap:6px;align-items:center;flex-wrap:wrap"><b style="font-size:13px">${esc(r.sym)}</b><span style="display:flex;gap:4px;flex-wrap:wrap">${coreChip}${chip(label(r.view.status), c[0], c[1])}</span></div>`;
    const vs = `<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:6px;font-size:11px"><div><div style="color:#9ca3af">Price says</div><b>${price}</b></div><div><div style="color:#9ca3af">Business says</div><b style="color:${c[1]}">${esc(label(r.view.status))}</b></div></div>`;
    if (!r.rec || r.view.status === 'unverified' && !r.rec.milestones) {
      return `<div class="flag-card" data-biz="${esc(r.sym)}" data-biz-status="unverified" style="border-left-color:${c[1]};min-width:0">${head}${vs}<div class="flag-body" style="margin-top:6px">${esc(r.view.reason || 'No assessment yet')} — not a health signal.</div></div>`;
    }
    const R = r.rec;
    const ms = (R.milestones || []).map((m) => { const g = MS[m.state] || MS.unverified; return `<div style="display:flex;gap:6px;font-size:11.5px;line-height:1.35;margin-top:3px;min-width:0"><span style="color:${g[1]};width:14px;flex:none;text-align:center">${g[0]}</span><span style="min-width:0;overflow-wrap:anywhere"><b>${esc(m.name)}</b> · ${esc(m.metric || '')}</span></div>`; }).join('');
    const why = r.view.reason ? `<div style="font-size:11px;color:#b45309;margin-top:4px">${esc(r.view.reason)} — stored verdict was ${esc(label(r.view.stored || 'none'))}.</div>` : '';
    const nr = R.nextReview ? `<div style="font-size:11px;color:#6b7280;margin-top:6px">⏭ Next check: ${esc(R.nextReview.trigger || '')}${R.nextReview.date ? ' · ' + esc(R.nextReview.date) : ''}</div>` : '';
    const inv = (R.invalidators || []);
    const src = (R.sources || []).map((s) => `<li><a href="${esc(s.url)}" target="_blank" rel="noopener" style="color:#2563eb">${esc(s.title || s.url)}</a> · ${esc(s.date)}</li>`).join('');
    const fold = `<details style="margin-top:6px;font-size:11.5px"><summary style="cursor:pointer;color:#6b7280">What changed · what breaks it · sources</summary>
      <div style="margin-top:6px;line-height:1.45"><b>Changed:</b> ${esc(R.changed || '—')}</div>
      <div style="margin-top:6px"><b>Thesis breaks if:</b><ul style="margin:2px 0 0 16px;padding:0">${inv.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>
      <div style="margin-top:6px"><b>Sources:</b><ul style="margin:2px 0 0 16px;padding:0;overflow-wrap:anywhere">${src}</ul></div>
      <div style="margin-top:6px;color:#9ca3af">Assessed ${esc(R.asOf)} by ${esc(R.assessor || '—')}${R.refClose ? ` · frozen vs ${esc(R.refClose.date)} close $${(+R.refClose.px).toFixed(2)}` : ''}${Array.isArray(R.history) && R.history.length ? ` · ${R.history.length} earlier assessment(s) kept` : ''}</div></details>`;
    return `<div class="flag-card" data-biz="${esc(r.sym)}" data-biz-status="${esc(r.view.status)}" style="border-left-color:${c[1]};min-width:0">${head}${vs}${R.summary ? `<div style="font-size:11.5px;margin-top:6px;color:var(--text)">${esc(R.summary)}</div>` : ''}${ms}${why}<div style="font-size:11px;margin-top:6px"><b style="color:#991b1b">Flunks if:</b> ${esc(inv[0] || '—')}</div>${nr}${fold}</div>`;
  }

  function html(rows) {
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    rows = rows || [];
    /* Assessed names get a full tile, listed first. Names with no record at all collapse into one
       compact row so a 20-name book stays one screen — each still marked Unverified. */
    const full = rows.filter((r) => r.rec).sort((a, b) => (b.core - a.core) || (b.held - a.held));
    const none = rows.filter((r) => !r.rec);
    const chips = none.map((r) => `<span data-biz="${esc(r.sym)}" data-biz-status="unverified" style="display:inline-block;font-size:11px;padding:2px 7px;border-radius:10px;background:#f3f4f6;color:#4b5563;margin:2px 4px 2px 0;white-space:nowrap"><b>${esc(r.sym)}</b>${r.fromCost != null ? ` ${r.fromCost >= 0 ? '+' : ''}${(r.fromCost * 100).toFixed(0)}%` : r.held ? '' : ' · target'}</span>`).join('');
    const noneRow = none.length ? `<div class="flag-card" style="border-left-color:#9ca3af;min-width:0"><div style="display:flex;justify-content:space-between;gap:6px;align-items:center"><b style="font-size:12px">Not assessed yet</b><span class="act-tag" style="background:#f3f4f6;color:#4b5563;margin:0">Unverified</span></div><div style="margin-top:4px">${chips}</div><div class="flag-body" style="margin-top:2px">% = price from cost. No business evidence on file — not a health signal.</div></div>` : '';
    const body = rows.length ? full.map((r) => tileHtml(r, esc)).join('') + noneRow : '<div class="tech-empty">No holdings or targets to check yet.</div>';
    return `<div class="ac-tier">🧾 Business check <span class="card-hint">(is the company doing what it promised?)</span></div>${body}<div style="font-size:11px;color:#9ca3af;margin-top:4px">Informational only — no stop, trim, weight, leverage or ticket reads this. Missing or stale evidence shows Unverified, never healthy.</div>`;
  }

  function render(el, rows) { if (el) el.innerHTML = html(rows); }

  return { STATUSES, MILESTONE_STATES, MAX_AGE_DAYS, GRACE_DAYS, problems, assess, forSymbols, html, render };
});
