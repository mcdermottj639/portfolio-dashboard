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
  /* Funds hold many businesses, so there is no single promise to check. A record can also set
     `fund: true` for anything not on this list. */
  const FUNDS = new Set(['SPY', 'VOO', 'IVV', 'VTI', 'QQQ', 'QQQM', 'IWM', 'DIA', 'VXUS', 'VEA', 'VWO', 'BND', 'AGG', 'TLT', 'IEF', 'SHY', 'GLD', 'IAU', 'SLV', 'SCHD', 'VIG', 'VUG', 'VTV', 'SMH', 'SOXX', 'ARKK', 'XLK', 'XLF', 'XLE', 'XLV', 'XLI', 'XLY', 'XLP', 'XLU', 'XLB', 'XLRE', 'XLC', 'SGOV', 'BIL']);
  const isFund = (sym, rec) => FUNDS.has(sym) || !!(rec && rec.fund);

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
      return { sym, rec, view: assess(rec, opts.today), held: !!pos, fromCost, core: !!(opts.core && opts.core === sym), fund: isFund(sym, rec) };
    });
  }

  /* ── render ─────────────────────────────────────────────────────────────── */
  const COL = { improving: ['#d1fae5', '#065f46'], intact: ['#dbeafe', '#1e40af'], weakening: ['#fef3c7', '#92400e'], broken: ['#fee2e2', '#991b1b'], unverified: ['#f3f4f6', '#4b5563'] };
  const MS = { met: ['✓', '#10b981'], 'on-track': ['●', '#3b82f6'], late: ['⏳', '#f59e0b'], open: ['…', '#6b7280'], missed: ['✗', '#ef4444'], unverified: ['?', '#9ca3af'] };
  const label = (s) => s.charAt(0).toUpperCase() + s.slice(1);

  const pctTxt = (v) => (v >= 0 ? '+' : '') + (v * 100).toFixed(0) + '%';
  /* v193 compact view (Jack: "it'll take up a lot of room when we have them all"): every assessed
     name is ONE tappable row — ticker · three milestone glyphs · price from cost · verdict — and the
     full card (milestones, flunks-if, next check, sources) opens on tap. Worst verdicts sort first. */
  const ORDER = { broken: 0, weakening: 1, unverified: 2, intact: 3, improving: 4 };
  const CSS = '<style>.biz-row{border:1px solid var(--border,#e5e7eb);border-left-width:3px;border-radius:8px;margin:0 0 6px;min-width:0;background:var(--surface,transparent)}' +
    '.biz-row>summary{list-style:none;cursor:pointer;display:grid;grid-template-columns:minmax(0,1fr) auto auto auto;gap:8px;align-items:center;padding:8px 10px;min-width:0}' +
    '.biz-row>summary::-webkit-details-marker{display:none}.biz-chev{display:inline-block;color:#9ca3af;font-size:10px;transition:transform .15s;margin-right:4px}' +
    '.biz-row[open]>summary .biz-chev{transform:rotate(90deg)}.biz-body{padding:0 10px 10px;min-width:0}.biz-ms{letter-spacing:2px;font-size:12px;white-space:nowrap}' +
    '.biz-tally{display:flex;flex-wrap:wrap;gap:4px;margin:2px 0 8px}.biz-tally span{font-size:10.5px;font-weight:700;padding:2px 7px;border-radius:10px}</style>';

  function rowHtml(r, esc) {
    const c = COL[r.view.status] || COL.unverified;
    const R = r.rec;
    const glyphs = (R.milestones || []).map((m) => { const g = MS[m.state] || MS.unverified; return `<span style="color:${g[1]}" title="${esc(m.name)}: ${esc(m.state)}">${g[0]}</span>`; }).join('');
    const price = r.fromCost != null ? `<span style="font-size:11.5px;font-weight:600;color:${r.fromCost < 0 ? '#ef4444' : '#10b981'}">${pctTxt(r.fromCost)}</span>` : `<span style="font-size:10.5px;color:#9ca3af">${r.held ? '—' : 'target'}</span>`;
    const verdict = `<span class="act-tag" style="background:${c[0]};color:${c[1]};margin:0">${esc(label(r.view.status))}</span>`;
    const name = `<span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"><span class="biz-chev">▶</span><b style="font-size:13px">${esc(r.sym)}</b>${r.core ? ' <span style="font-size:9.5px;font-weight:700;color:#075985;background:#e0f2fe;border-radius:6px;padding:1px 5px;vertical-align:1px">CORE</span>' : ''}</span>`;
    const ms = (R.milestones || []).map((m) => { const g = MS[m.state] || MS.unverified; return `<div style="display:flex;gap:6px;font-size:11.5px;line-height:1.35;margin-top:3px;min-width:0"><span style="color:${g[1]};width:14px;flex:none;text-align:center">${g[0]}</span><span style="min-width:0;overflow-wrap:anywhere"><b>${esc(m.name)}</b> · ${esc(m.metric || '')}</span></div>`; }).join('');
    const why = r.view.reason ? `<div style="font-size:11px;color:#b45309;margin-top:4px">${esc(r.view.reason)} — stored verdict was ${esc(label(r.view.stored || 'none'))}.</div>` : '';
    const nr = R.nextReview ? `<div style="font-size:11px;color:#6b7280;margin-top:6px">⏭ Next check: ${esc(R.nextReview.trigger || '')}${R.nextReview.date ? ' · ' + esc(R.nextReview.date) : ''}</div>` : '';
    const inv = (R.invalidators || []);
    const src = (R.sources || []).map((x) => `<li><a href="${esc(x.url)}" target="_blank" rel="noopener" style="color:#2563eb">${esc(x.title || x.url)}</a> · ${esc(x.date)}</li>`).join('');
    const fold = `<details style="margin-top:6px;font-size:11.5px"><summary style="cursor:pointer;color:#6b7280">What changed · what breaks it · sources</summary>
      <div style="margin-top:6px;line-height:1.45"><b>Changed:</b> ${esc(R.changed || '—')}</div>
      <div style="margin-top:6px"><b>Thesis breaks if:</b><ul style="margin:2px 0 0 16px;padding:0">${inv.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>
      <div style="margin-top:6px"><b>Sources:</b><ul style="margin:2px 0 0 16px;padding:0;overflow-wrap:anywhere">${src}</ul></div>
      <div style="margin-top:6px;color:#9ca3af">Assessed ${esc(R.asOf)} by ${esc(R.assessor || '—')}${R.refClose ? ` · frozen vs ${esc(R.refClose.date)} close $${(+R.refClose.px).toFixed(2)}` : ''}${Array.isArray(R.history) && R.history.length ? ` · ${R.history.length} earlier assessment(s) kept` : ''}</div></details>`;
    const body = `<div class="biz-body">${r.core ? '<div style="font-size:10.5px;color:#075985;margin-bottom:4px">core · your rule — kept by your call; the grade below is separate</div>' : ''}${R.summary ? `<div style="font-size:12px;color:var(--text)">${esc(R.summary)}</div>` : ''}${ms}${why}<div style="font-size:11px;margin-top:6px"><b style="color:#991b1b">Flunks if:</b> ${esc(inv[0] || '—')}</div>${nr}${fold}</div>`;
    return `<details class="biz-row" data-biz="${esc(r.sym)}" data-biz-status="${esc(r.view.status)}" style="border-left-color:${c[1]}"><summary>${name}<span class="biz-ms">${glyphs}</span>${price}${verdict}</summary>${body}</details>`;
  }

  function html(rows) {
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    rows = rows || [];
    const funds = rows.filter((r) => r.fund);
    const full = rows.filter((r) => r.rec && !r.fund).sort((a, b) => ((ORDER[a.view.status] ?? 2) - (ORDER[b.view.status] ?? 2)) || (b.core - a.core) || (b.held - a.held));
    const none = rows.filter((r) => !r.rec && !r.fund);
    /* Tally strip: one colored count per verdict, so the whole book reads in one glance. */
    const counts = {};
    full.forEach((r) => { counts[r.view.status] = (counts[r.view.status] || 0) + 1; });
    if (none.length) counts.unverified = (counts.unverified || 0) + none.length;
    const tally = Object.keys(ORDER).filter((k) => counts[k]).map((k) => `<span style="background:${COL[k][0]};color:${COL[k][1]}">${counts[k]} ${label(k)}</span>`).join('');
    const chips = none.map((r) => `<span data-biz="${esc(r.sym)}" data-biz-status="unverified" style="display:inline-block;font-size:11px;padding:2px 7px;border-radius:10px;background:#f3f4f6;color:#4b5563;margin:2px 4px 2px 0;white-space:nowrap"><b>${esc(r.sym)}</b>${r.fromCost != null ? ` ${pctTxt(r.fromCost)}` : r.held ? '' : ' · target'}</span>`).join('');
    const noneRow = none.length ? `<div style="margin:4px 0 2px;min-width:0"><div style="font-size:11px;color:#6b7280;margin-bottom:2px"><b>Not assessed yet</b> · Unverified — not a health signal</div>${chips}</div>` : '';
    const fundRow = funds.length ? `<div style="font-size:11px;color:#6b7280;margin:4px 0">Funds — no single business to check: ${funds.map((r) => `<span data-biz="${esc(r.sym)}" data-biz-status="fund"><b>${esc(r.sym)}</b></span>`).join(' · ')}</div>` : '';
    const key = `<details style="font-size:11px;color:#9ca3af;margin-top:6px"><summary style="cursor:pointer">How to read this</summary><div style="margin-top:4px;line-height:1.5">Tap a row for the full card. Glyphs = the 3 milestones: <span style="color:#10b981">✓</span> met · <span style="color:#3b82f6">●</span> on track · <span style="color:#f59e0b">⏳</span> late · … open · <span style="color:#ef4444">✗</span> missed · ? unverified. % = price from your cost. Worst grades sort first. Informational only — no stop, trim, weight, leverage or ticket reads this. Missing or stale evidence shows Unverified, never healthy.</div></details>`;
    const body = rows.length ? full.map((r) => rowHtml(r, esc)).join('') + noneRow + fundRow : '<div class="tech-empty">No holdings or targets to check yet.</div>';
    return `${CSS}<div class="ac-tier">🧾 Business check <span class="card-hint">(is the company doing what it promised?)</span></div>${tally ? `<div class="biz-tally">${tally}</div>` : ''}${body}${key}`;
  }

  function render(el, rows) { if (el) el.innerHTML = html(rows); }

  return { FUNDS, isFund, STATUSES, MILESTONE_STATES, MAX_AGE_DAYS, GRACE_DAYS, problems, assess, forSymbols, html, render };
});
