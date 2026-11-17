/* v244 — Apex v2.9 PAPER research view (pure + render).
   Reads ONE public file, data/apex-paper-v29.json (schema 1), and draws it. Nothing else.

   PAPER ONLY. This module never feeds, replaces or changes the live Apex v2.8 card, its targets,
   the Confirm flow, tickets or any agentic surface. ui/apex.js and ui/sd-rules.js do not read it
   (tests/apex-paper.test.cjs asserts neither file references this module or its data file).

   Every field is optional. A missing or non-numeric number is null and renders "—", never 0.
   A missing file, a failed run, partial coverage and a stale file are four different states and
   each one is named on screen; an old successful time is never shown as the current run.

   Loaded by index.html before the main inline script; require()-able from Node tests.
   Keep this file free of DOM access outside render(). */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ApexPaper = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const ET = 'America/New_York';
  const HOUR = 36e5, DAY = 864e5;
  const STALE_HOURS = 26;            // one daily run plus two hours of slack
  const RUN_H = 7, RUN_M = 52;       // the scheduled weekday paper run, ET
  const TECH_CAP_PCT = 40;           // v2.9 rule: tech at most 40% of a batch
  const OPEN_ROWS = 10;              // qualified rows shown before the "more" fold
  const OPEN_BARS = 8;               // rejection reasons shown before the "more" fold
  const SETUPS = { A: 'breakout', B: 'pullback', C: 'reversal' };
  const STATUS_LABEL = { buy: 'Buy (paper)', watch: 'Watch', blocked: 'Blocked', close: 'Close' };
  const DASH = '—';

  /* ── small pure helpers ── */
  const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
  const obj = (v) => (isObj(v) ? v : {});
  const arr = (v) => (Array.isArray(v) ? v : []);
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  const time = (v) => { const s = str(v); if (!s) return null; const t = Date.parse(s); return Number.isFinite(t) ? t : null; };
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const group = (n, d) => n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  const fmtInt = (v) => (num(v) === null ? DASH : group(Math.round(v), 0));
  const fmtNum = (v, d) => (num(v) === null ? DASH : group(v, d == null ? 1 : d));
  const fmtPx = (v) => (num(v) === null ? DASH : '$' + group(v, 2));
  const fmtPct = (v, d, signed) => (num(v) === null ? DASH : (signed && v > 0 ? '+' : '') + group(v, d == null ? 1 : d) + '%');
  const fmtX = (v) => (num(v) === null ? DASH : group(v, 2) + '×');

  /* ── Eastern time, without a date library ── */
  function etParts(ms) {
    const out = {};
    for (const p of new Intl.DateTimeFormat('en-US', { timeZone: ET, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' }).formatToParts(new Date(ms))) {
      if (p.type !== 'literal') out[p.type] = Number(p.value);
    }
    return out;
  }
  /* The instant of 7:52 AM ET on an ET calendar date (EDT or EST, whichever is in force). */
  function etRunMs(y, m, d) {
    for (const off of [4, 5]) {
      const t = Date.UTC(y, m - 1, d, RUN_H + off, RUN_M), p = etParts(t);
      if (p.hour === RUN_H && p.minute === RUN_M && p.day === d) return t;
    }
    return Date.UTC(y, m - 1, d, RUN_H + 5, RUN_M);
  }
  /* True when at least one weekday 7:52 AM ET run time falls after asOf and at or before now.
     Market holidays are not modelled: a holiday with no run reads as a missed run. */
  function missedWeekdayRun(asOfMs, nowMs) {
    if (!(nowMs > asOfMs)) return false;
    if (nowMs - asOfMs > 8 * DAY) return true;
    const p = etParts(asOfMs), start = Date.UTC(p.year, p.month - 1, p.day);
    for (let i = 0; i <= 9; i++) {
      const day = new Date(start + i * DAY), dow = day.getUTCDay();
      if (dow === 0 || dow === 6) continue;
      const t = etRunMs(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate());
      if (t > nowMs) break;
      if (t > asOfMs) return true;
    }
    return false;
  }
  function fmtET(v) {
    const t = typeof v === 'number' ? v : time(v);
    if (t === null || !Number.isFinite(t)) return null;
    return new Intl.DateTimeFormat('en-US', { timeZone: ET, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(t)) + ' ET';
  }

  /* ── freshness: the one place that decides what the chip says ──
     level: 'bad' (red) | 'warn' (amber) | 'ok' (green). Never green without a dated, successful run. */
  function status(doc, nowMs, error) {
    const now = num(nowMs) === null ? Date.now() : nowMs;
    const base = { level: 'bad', kind: 'missing', label: 'Research file missing', detail: null, lastSuccess: null, asOfText: null, nextRunText: null, stale: false, usable: false };
    if (!isObj(doc)) {
      if (doc != null || (error && /^unreadable/i.test(String(error)))) return Object.assign(base, { kind: 'unreadable', label: 'Research file unreadable', detail: str(error) || 'The file is not a JSON object.' });
      return Object.assign(base, { detail: str(error) || 'data/apex-paper-v29.json has not been published.' });
    }
    const asOf = time(doc.asOf), asOfText = fmtET(asOf), nextRunText = fmtET(doc.nextRun);
    const lastOk = fmtET(doc.lastSuccessAsOf), note = str(doc.statusNote);
    const out = Object.assign(base, { usable: true, asOfText, nextRunText, detail: note });
    const st = str(doc.status);
    if (st === 'failed') {
      return Object.assign(out, { kind: 'failed', label: 'Last run FAILED' + (asOfText ? ' · ' + asOfText : ''), lastSuccess: lastOk ? 'Last successful run ' + lastOk : 'No successful run recorded' });
    }
    const stale = asOf !== null && now - asOf > STALE_HOURS * HOUR && missedWeekdayRun(asOf, now);
    out.stale = stale;
    if (st === 'partial') {
      return Object.assign(out, { level: 'warn', kind: 'partial', label: 'Partial coverage' + (stale ? ' · STALE' : ''), detail: [note, stale && asOfText ? 'Last run ' + asOfText : null].filter(Boolean).join(' · ') || null });
    }
    if (st !== 'ok') return Object.assign(out, { level: 'warn', kind: 'unknown', label: 'Run status not recorded', detail: note || (asOfText ? 'File dated ' + asOfText : null) });
    if (asOf === null) return Object.assign(out, { level: 'warn', kind: 'undated', label: 'Run time not recorded' });
    if (asOf - now > 10 * 60e3) return Object.assign(out, { level: 'warn', kind: 'future', label: 'Run time is in the future · ' + asOfText });
    if (stale) return Object.assign(out, { level: 'warn', kind: 'stale', label: 'STALE — last run ' + asOfText });
    return Object.assign(out, { level: 'ok', kind: 'fresh', label: 'Updated ' + asOfText });
  }

  /* ── view model ── */
  function rowModel(r, i) {
    r = obj(r);
    const setup = SETUPS[r.setup] ? r.setup : null, st = STATUS_LABEL[r.status] ? r.status : null;
    return {
      sym: str(r.sym) || '?', name: str(r.name), sector: str(r.sector), theme: str(r.theme),
      setup, setupLabel: str(r.setupLabel) || (setup ? SETUPS[setup] : null),
      rank: num(r.rank) === null ? i + 1 : r.rank,
      composite: num(r.composite), momentum: num(r.momentum), fundamental: num(r.fundamental), rrScore: num(r.rrScore),
      rr: num(r.rr), last: num(r.last), entry: num(r.entry), entryType: str(r.entryType), stop: num(r.stop), stopBasis: str(r.stopBasis),
      tp1: num(r.tp1), tp1Basis: str(r.tp1Basis), atr: num(r.atr), rsi: num(r.rsi), rs3: num(r.rs3), rs6: num(r.rs6), relVol: num(r.relVol),
      revGrowthPct: num(r.revGrowthPct), pe: num(r.pe), peType: str(r.peType), marketCapB: num(r.marketCapB), earningsDate: str(r.earningsDate),
      status: st, statusLabel: st ? STATUS_LABEL[st] : 'Status not recorded', statusReason: str(r.statusReason),
      fails: arr(r.fails).map(str).filter(Boolean), unlock: str(r.unlock), halfSize: r.halfSize === true, why: str(r.why)
    };
  }
  const count = (declared, list) => (num(declared) !== null ? declared : Array.isArray(list) ? list.length : null);
  function sectorRows(sectors) {
    const u = obj(sectors.universe), q = obj(sectors.qualified), n = obj(sectors.near);
    const names = [...new Set([...Object.keys(u), ...Object.keys(q), ...Object.keys(n)])];
    const total = (o) => { const v = Object.values(o).map(num).filter((x) => x !== null); return v.length ? v.reduce((a, b) => a + b, 0) : null; };
    const tu = total(u), tq = total(q);
    const share = (v, t) => (num(v) === null || !t ? null : (v / t) * 100);
    const rows = names.map((name) => ({ name, universe: num(u[name]), qualified: num(q[name]), near: num(n[name]), universeShare: share(u[name], tu), qualifiedShare: share(q[name], tq) }));
    /* Bars are drawn against the largest share on the card, so a 16% sector is not a sliver. */
    const top = rows.reduce((m, r) => Math.max(m, r.universeShare || 0, r.qualifiedShare || 0), 0);
    rows.forEach((r) => { r.universeBar = r.universeShare === null || !top ? 0 : (r.universeShare / top) * 100; r.qualifiedBar = r.qualifiedShare === null || !top ? 0 : (r.qualifiedShare / top) * 100; });
    return rows
      .sort((a, b) => (b.universe || 0) - (a.universe || 0) || (b.qualified || 0) - (a.qualified || 0) || a.name.localeCompare(b.name));
  }

  function model(doc, nowMs, error) {
    const s = status(doc, nowMs, error), d = obj(doc);
    const u = obj(d.universe), f = obj(d.funnel), sm = obj(f.setupMatches), rk = obj(d.ranked), b = obj(d.batch), c = obj(d.concentration), v = obj(d.v28);
    const ranked = { qualified: arr(rk.qualified).map(rowModel), near: arr(rk.near).map(rowModel), emerging: arr(rk.emerging).map(rowModel) };
    const counts = { qualified: count(f.qualified, rk.qualified), near: count(f.near, rk.near), emerging: count(f.emerging, rk.emerging), rejected: num(f.rejected) };
    const rejections = arr(d.rejections).map(obj).map((r) => ({ key: str(r.key), label: str(r.label) || str(r.key) || 'Unlabelled', count: num(r.count) }))
      .sort((a, b2) => (b2.count === null ? -1 : b2.count) - (a.count === null ? -1 : a.count));
    const maxRej = rejections.reduce((m, r) => Math.max(m, r.count || 0), 0);
    rejections.forEach((r) => { r.pct = r.count === null || !maxRej ? null : (r.count / maxRej) * 100; });
    const picks = arr(b.picks).map(obj).map((p) => ({ sym: str(p.sym) || '?', weightPct: num(p.weightPct) }));
    const blocked = arr(b.blocked).map(obj).map((p) => ({ sym: str(p.sym) || '?', reason: str(p.reason) }));
    const techBatchPct = num(b.techBatchPct) !== null ? b.techBatchPct : num(c.techBatchPct);
    const paperNames = picks.length ? picks.map((p) => p.sym) : ranked.qualified.filter((r) => r.status === 'buy').map((r) => r.sym);
    const liveNames = arr(v.actionable).map(str).filter(Boolean);
    const marks = arr(d.marks).map(obj).map((m) => ({ asOf: str(m.asOf), sym: str(m.sym), horizon: str(m.horizon) || (num(m.horizon) !== null ? String(m.horizon) : null), ret: num(m.ret), spyRet: num(m.spyRet), alpha: num(m.alpha) }));
    const cohorts = arr(d.cohorts).map(obj).map((co) => ({
      asOf: str(co.asOf), asOfText: fmtET(co.asOf), rulesVersion: str(co.rulesVersion), spyAt: num(co.spyAt),
      picks: arr(co.picks).map(obj).map((p) => ({ sym: str(p.sym) || '?', w: num(p.w), setup: SETUPS[p.setup] ? p.setup : null, entryPx: num(p.entryPx), status: str(p.status) })),
      marks: marks.filter((m) => m.asOf && m.asOf === str(co.asOf))
    }));
    const bt = isObj(d.backtest) ? d.backtest : null;
    return {
      status: s,
      paper: d.paper === true,
      schema: num(d.schema),
      rulesVersion: str(d.rulesVersion),
      quoteBasis: str(d.quoteBasis),
      universe: { eligible: num(u.eligible), scanned: num(u.scanned), unique: num(u.unique), duplicatesRemoved: num(u.duplicatesRemoved), complete: typeof u.complete === 'boolean' ? u.complete : null,
        coverageNote: str(u.coverageNote), batches: arr(u.batches).map(obj).map((x) => ({ label: str(x.label) || 'Batch', total: num(x.total), rows: num(x.rows) })),
        filters: { minMarketCap: num(obj(u.filters).minMarketCap), minAvgVolume: num(obj(u.filters).minAvgVolume), minPrice: num(obj(u.filters).minPrice) } },
      counts,
      setups: [['A', 'breakout'], ['B', 'pullback'], ['C', 'reversal'], ['none', 'no setup']].map(([key, label]) => ({ key, label, count: num(sm[key]) })),
      rejections,
      ranked,
      batch: { present: isObj(d.batch), asOfText: fmtET(b.asOf), indicative: b.indicative === true, note: str(b.note), picks, blocked, techBatchPct, cashPct: num(b.cashPct), techCapPct: TECH_CAP_PCT, overCap: techBatchPct !== null && techBatchPct > TECH_CAP_PCT },
      sectors: sectorRows(obj(d.sectors)),
      concentration: { techBatchPct, v28TechOutsideCorePct: num(c.v28TechOutsideCorePct), note: str(c.note) },
      compare: { present: isObj(d.v28), liveAsOfText: fmtET(v.asOf), liveRules: str(v.rulesVersion), liveUniverse: num(v.universe), livePassed: num(v.passed), liveNames,
        liveTargets: Object.entries(obj(v.targets)).map(([sym, pct]) => ({ sym, pct: num(pct) })),
        paperUniverse: num(u.scanned), paperPassed: counts.qualified, paperNames, both: paperNames.filter((x) => liveNames.includes(x)) },
      cohorts, cohortNote: str(d.cohortNote), looseMarks: marks.filter((m) => !cohorts.some((co) => co.asOf && co.asOf === m.asOf)),
      metrics: Object.entries(obj(d.metrics)).filter(([, val]) => typeof val === 'number' || typeof val === 'string' || typeof val === 'boolean').map(([k, val]) => ({ key: k, value: typeof val === 'number' ? (Number.isFinite(val) ? group(val, Number.isInteger(val) ? 0 : 2) : DASH) : String(val) })),
      backtest: bt ? { status: ['pending', 'done', 'failed'].includes(bt.status) ? bt.status : 'unknown', asOfText: fmtET(bt.asOf), note: str(bt.note),
        rows: arr(bt.rows).map(obj).map((r) => ({ setup: str(r.setup) || DASH, signals: num(r.signals), netRetPct: num(r.netRetPct), netAlphaPct: num(r.netAlphaPct), gapStopPct: num(r.gapStopPct) })) } : null,
      notes: arr(d.notes).map(str).filter(Boolean),
      sources: arr(d.sources).map(str).filter(Boolean)
    };
  }

  /* One line for the pointer row on the Apex Plan page. */
  function pointer(doc, nowMs, error) {
    const m = model(doc, nowMs, error), s = m.status, head = '🧪 v2.9 paper research: ';
    if (!s.usable) return head + (s.kind === 'unreadable' ? 'file unreadable' : 'file missing') + ' — nothing to show yet →';
    if (s.kind === 'failed') return head + s.label + (s.lastSuccess ? ' · ' + s.lastSuccess.replace(/^L/, 'l') : '') + ' →';
    const body = fmtInt(m.counts.qualified) + ' qualified of ' + fmtInt(m.universe.scanned) + ' scanned';
    const when = s.kind === 'fresh' ? 'updated ' + s.asOfText : s.kind === 'stale' ? s.label : s.kind === 'partial' ? s.label.toLowerCase().replace('stale', 'STALE') + (s.asOfText ? ' · ' + s.asOfText : '') : s.label;
    return head + body + ' · ' + when + ' →';
  }

  /* ── markup ── */
  const chip = (text, tone) => '<span class="apx-chip' + (tone ? ' apx-' + tone : '') + '">' + esc(text) + '</span>';
  const fold = (key, summary, body, cls) => '<details class="apx-fold' + (cls ? ' ' + cls : '') + '" data-apx-key="' + esc(key) + '"><summary>' + summary + '</summary><div class="apx-fold-body">' + body + '</div></details>';
  const tile = (label, value, sub, tone) => '<div class="apx-tile' + (tone ? ' apx-t-' + tone : '') + '"><span class="apx-tl">' + esc(label) + '</span><b>' + esc(value) + '</b><small>' + esc(sub || '') + '</small></div>';
  const kv = (k, v) => '<div><span>' + esc(k) + '</span><b>' + esc(v) + '</b></div>';
  const statusTone = { buy: 'good', watch: 'info', blocked: 'bad', close: 'warn' };

  function rowHtml(r, list) {
    const setup = r.setup ? '<span class="apx-chip apx-setup"><b>' + esc(r.setup) + '</b><i> ' + esc(r.setupLabel || '') + '</i></span>' : chip('no setup', 'mute');
    const head = '<span class="apx-rk">' + esc(fmtInt(r.rank)) + '</span><span class="apx-sym">' + esc(r.sym) + '</span>' + setup +
      '<span class="apx-score" title="Composite score">' + esc(fmtNum(r.composite, 1)) + '</span>' + chip(r.statusLabel, statusTone[r.status] || 'mute');
    const levels = '<div class="apx-levels">' +
      '<div><span>Entry</span><b>' + esc(fmtPx(r.entry)) + '</b></div>' +
      '<div><span>Target</span><b class="apx-up">' + esc(fmtPx(r.tp1)) + '</b></div>' +
      '<div><span>Stop</span><b class="apx-dn">' + esc(fmtPx(r.stop)) + '</b></div>' +
      '<div><span>R/R</span><b>' + esc(fmtX(r.rr)) + '</b></div></div>';
    const facts = '<div class="apx-kv">' + kv('Last', fmtPx(r.last)) + kv('Momentum', fmtNum(r.momentum, 1)) + kv('Fundamental', fmtNum(r.fundamental, 1)) + kv('R/R score', fmtNum(r.rrScore, 1)) +
      kv('RS vs SPY 3m', fmtPct(r.rs3, 1, true)) + kv('RS vs SPY 6m', fmtPct(r.rs6, 1, true)) + kv('RSI', fmtNum(r.rsi, 0)) + kv('ATR', fmtPx(r.atr)) +
      kv('Rel. volume', fmtX(r.relVol)) + kv('Rev. growth', fmtPct(r.revGrowthPct, 0, true)) + kv('P/E' + (r.peType ? ' (' + r.peType + ')' : ''), fmtNum(r.pe, 1)) +
      kv('Mkt cap', r.marketCapB === null ? DASH : '$' + group(r.marketCapB, r.marketCapB >= 100 ? 0 : 1) + 'B') + kv('Earnings', r.earningsDate || DASH) + '</div>';
    const lines = [];
    if (r.halfSize) lines.push('<p>' + chip('Half size', 'warn') + ' sized at half weight by the paper rules</p>');
    if (r.statusReason) lines.push('<p><b>' + esc(r.statusLabel) + ':</b> ' + esc(r.statusReason) + '</p>');
    if (r.fails.length) lines.push('<p class="apx-fails"><b>Fails:</b> ' + r.fails.map((x) => chip(x, 'bad')).join('') + '</p>');
    if (r.unlock) lines.push('<p><b>Unlocks if:</b> ' + esc(r.unlock) + '</p>');
    if (r.why) lines.push('<p class="apx-muted">' + esc(r.why) + '</p>');
    const basis = [r.entryType ? 'Entry: ' + r.entryType : null, r.tp1Basis ? 'Target: ' + r.tp1Basis : null, r.stopBasis ? 'Stop: ' + r.stopBasis : null].filter(Boolean).join(' · ');
    return '<details class="apx-row" data-apx-row="' + esc(r.sym) + '" data-apx-key="row:' + esc(list) + ':' + esc(r.sym) + '"><summary>' + head + '</summary><div class="apx-row-body">' +
      '<div class="apx-name"><b>' + esc(r.name || r.sym) + '</b><span>' + esc([r.sector, r.theme].filter(Boolean).join(' · ') || 'Sector not recorded') + '</span></div>' +
      levels + (basis ? '<p class="apx-muted apx-basis">' + esc(basis) + '</p>' : '') + facts + lines.join('') + '</div></details>';
  }
  const rowsHtml = (rows, list, empty) => (rows.length ? rows.map((r) => rowHtml(r, list)).join('') : '<p class="apx-empty">' + esc(empty) + '</p>');

  function headerHtml(m) {
    const s = m.status;
    const tone = s.level === 'ok' ? 'good' : s.level === 'warn' ? 'warn' : 'bad';
    return '<section class="apx-head" data-apx-status="' + esc(s.kind) + '">' +
      '<div class="apx-head-top"><span class="apx-badge">Apex v2.9 · PAPER RESEARCH — not live</span>' + (m.rulesVersion ? '<span class="apx-rules">' + esc(m.rulesVersion) + '</span>' : '') + '</div>' +
      '<div class="apx-fresh">' + chip(s.label, tone + ' apx-freshchip') + (s.lastSuccess ? chip(s.lastSuccess, 'mute') : '') + '</div>' +
      (s.detail ? '<p class="apx-statusnote">' + esc(s.detail) + '</p>' : '') +
      (s.kind === 'failed' ? '<p class="apx-statusnote">Anything below is not from a successful run today.</p>' : '') +
      (s.usable ? '<p class="apx-next">Next paper run <b>' + esc(s.nextRunText || 'not scheduled in this file') + '</b></p>' : '') +
      '</section>';
  }

  function html(doc, nowMs, error) {
    const m = model(doc, nowMs, error), s = m.status;
    const boundary = '<p class="apx-boundary">Paper only. Nothing here feeds the live Apex card, its targets, Confirm or any order.</p>';
    if (!s.usable) {
      return '<div class="apx" data-apx-state="' + esc(s.kind) + '">' + headerHtml(m) +
        '<section class="card apx-card"><p class="apx-empty"><b>' + esc(s.label) + '.</b> ' + esc(s.detail || '') + '</p>' + boundary + '</section></div>';
    }
    const u = m.universe, c = m.counts;
    const coverage = u.complete === true ? 'complete' : u.complete === false ? 'partial' : 'coverage not recorded';
    const tiles = '<section class="apx-tiles">' +
      tile('Eligible', fmtInt(u.eligible), 'in the universe') +
      tile('Scanned', fmtInt(u.scanned), coverage + (u.unique !== null ? ' · ' + fmtInt(u.unique) + ' unique' : ''), u.complete === false ? 'warn' : '') +
      tile('Qualified', fmtInt(c.qualified), 'pass every gate', 'good') +
      tile('Near', fmtInt(c.near), 'emerging ' + fmtInt(c.emerging)) + '</section>';
    const filt = u.filters, filtLine = [filt.minMarketCap !== null ? 'market cap ≥ $' + group(filt.minMarketCap / 1e9, 1) + 'B' : null, filt.minAvgVolume !== null ? 'avg volume ≥ ' + group(filt.minAvgVolume, 0) : null, filt.minPrice !== null ? 'price ≥ ' + fmtPx(filt.minPrice) : null].filter(Boolean).join(' · ');
    const coverBody = [u.coverageNote ? '<p>' + esc(u.coverageNote) + '</p>' : '', filtLine ? '<p><b>Filters:</b> ' + esc(filtLine) + '</p>' : '',
      u.duplicatesRemoved !== null ? '<p><b>Duplicates removed:</b> ' + esc(fmtInt(u.duplicatesRemoved)) + '</p>' : '',
      u.batches.length ? '<div class="apx-kv">' + u.batches.map((b) => kv(b.label, fmtInt(b.rows) + ' / ' + fmtInt(b.total))).join('') + '</div>' : '',
      m.quoteBasis ? '<p><b>Quotes:</b> ' + esc(m.quoteBasis) + '</p>' : ''].join('');
    const cover = coverBody ? fold('coverage', 'Coverage and filters', coverBody) : '';

    const rejBar = (r) => '<div class="apx-bar" data-apx-rej="' + esc(r.key || '') + '"><span class="apx-bar-l">' + esc(r.label) + '</span><span class="apx-bar-t"><i style="width:' + (r.pct === null ? 0 : Math.max(2, r.pct).toFixed(1)) + '%"></i></span><b>' + esc(fmtInt(r.count)) + '</b></div>';
    const funnel = '<section class="card apx-card" data-apx-sec="funnel"><h2>Why names dropped out <span>' + esc(fmtInt(c.rejected)) + ' rejected</span></h2>' +
      '<div class="apx-setups">' + m.setups.map((x) => '<span class="apx-chip apx-setup' + (x.key === 'none' ? ' apx-mute' : '') + '"><b>' + esc(x.key === 'none' ? 'None' : x.key) + '</b><i> ' + esc(x.key === 'none' ? '' : x.label) + '</i> ' + esc(fmtInt(x.count)) + '</span>').join('') + '</div>' +
      (m.rejections.length ? '<div class="apx-bars">' + m.rejections.slice(0, OPEN_BARS).map(rejBar).join('') + '</div>' +
        (m.rejections.length > OPEN_BARS ? fold('more-rejections', (m.rejections.length - OPEN_BARS) + ' more reasons', '<div class="apx-bars">' + m.rejections.slice(OPEN_BARS).map(rejBar).join('') + '</div>') : '') +
        '<p class="apx-muted">A name can fail more than one check, so the bars do not add up to the rejected total.</p>'
        : '<p class="apx-empty">No rejection reasons recorded in this file.</p>') +
      '</section>';

    const q = m.ranked.qualified;
    const listed = (total, shown) => fmtInt(total) + (total !== null && shown < total ? ' · top ' + shown + ' listed' : '');
    const rankedSec = '<section class="card apx-card" data-apx-sec="ranked"><h2>Top ranked candidates <span>tap a row</span></h2>' +
      '<div class="apx-list" data-apx-list="qualified"><h3>Qualified <span>' + esc(listed(c.qualified, q.length)) + '</span></h3>' + rowsHtml(q.slice(0, OPEN_ROWS), 'qualified', 'Nothing qualified in this run.') +
      (q.length > OPEN_ROWS ? fold('more-qualified', 'Show all ' + q.length + ' qualified <span>' + (q.length - OPEN_ROWS) + ' more</span>', rowsHtml(q.slice(OPEN_ROWS), 'qualified', ''), 'apx-list-fold') : '') + '</div>' +
      fold('near', 'Near <span>' + esc(listed(c.near, m.ranked.near.length)) + '</span>', rowsHtml(m.ranked.near, 'near', 'No near-miss names listed.'), 'apx-list-fold') +
      fold('emerging', 'Emerging <span>' + esc(listed(c.emerging, m.ranked.emerging.length)) + '</span>', rowsHtml(m.ranked.emerging, 'emerging', 'No emerging names listed.'), 'apx-list-fold') +
      '</section>';

    const b = m.batch;
    const techPct = b.techBatchPct, meter = techPct === null ? '' : '<div class="apx-meter' + (b.overCap ? ' apx-over' : '') + '"><i style="width:' + Math.max(0, Math.min(100, techPct)).toFixed(1) + '%"></i><u style="left:' + TECH_CAP_PCT + '%"></u></div>';
    const batchSec = '<section class="card apx-card" data-apx-sec="batch"><h2>Paper buys vs blocked ' + (b.indicative ? chip('Indicative', 'warn') : '') + '</h2>' +
      (!b.present ? '<p class="apx-empty">No paper batch in this file.</p>' :
        '<div class="apx-picks">' + (b.picks.length ? b.picks.map((p) => '<span class="apx-pick"><b>' + esc(p.sym) + '</b>' + esc(p.weightPct === null ? 'sized Monday' : fmtPct(p.weightPct, 0)) + '</span>').join('') : '<p class="apx-empty">No paper buys in this batch.</p>') + '</div>' +
        (b.blocked.length ? '<div class="apx-blocked">' + b.blocked.map((p) => '<div><b>' + esc(p.sym) + '</b><span>' + esc(p.reason || 'Reason not recorded') + '</span></div>').join('') + '</div>' : '') +
        '<div class="apx-tech"><span>Tech share of batch</span><b class="' + (b.overCap ? 'apx-dn' : '') + '">' + esc(fmtPct(techPct, 0)) + '</b><span>rule: at most ' + TECH_CAP_PCT + '%</span></div>' + meter +
        '<p class="apx-muted">Cash ' + esc(fmtPct(b.cashPct, 0)) + (b.asOfText ? ' · batch as of ' + esc(b.asOfText) : '') + '</p>' +
        (b.note ? fold('batch-note', 'Batch note', '<p>' + esc(b.note) + '</p>') : '')) +
      '</section>';

    const sectorSec = '<section class="card apx-card" data-apx-sec="sectors"><h2>Sector coverage <span>share of universe vs qualified</span></h2>' +
      (m.sectors.length ? '<div class="apx-sectors">' + m.sectors.map((x) => '<div class="apx-sector"><span class="apx-bar-l">' + esc(x.name) + '</span><span class="apx-pair"><i class="apx-u" style="width:' + x.universeBar.toFixed(1) + '%"></i><i class="apx-q" style="width:' + x.qualifiedBar.toFixed(1) + '%"></i></span><b>' + esc(fmtInt(x.universe)) + ' · ' + esc(fmtInt(x.qualified)) + '</b></div>').join('') + '</div><p class="apx-key"><i class="apx-u"></i>universe <i class="apx-q"></i>qualified · counts: universe · qualified</p>' : '<p class="apx-empty">No sector breakdown in this file.</p>') +
      '<p class="apx-conc"><b>Concentration:</b> tech ' + esc(fmtPct(m.concentration.techBatchPct, 0)) + ' of the paper batch · live v2.8 tech outside core ' + esc(fmtPct(m.concentration.v28TechOutsideCorePct, 0)) + '</p>' +
      (m.concentration.note ? fold('conc-note', 'Concentration note', '<p>' + esc(m.concentration.note) + '</p>') : '') + '</section>';

    const cp = m.compare, names = (list) => (list.length ? list.map((x) => chip(x, cp.both.includes(x) ? 'info' : 'mute')).join('') : DASH);
    const compareSec = '<section class="card apx-card" data-apx-sec="compare"><h2>v2.9 vs v2.8</h2>' +
      (!cp.present ? '<p class="apx-empty">No v2.8 comparison in this file.</p>' :
        '<table class="apx-table apx-compare"><thead><tr><th></th><th>v2.8 ' + chip('LIVE', 'good') + '</th><th>v2.9 ' + chip('PAPER', 'warn') + '</th></tr></thead><tbody>' +
        '<tr><th>Universe screened</th><td>' + esc(fmtInt(cp.liveUniverse)) + '</td><td>' + esc(fmtInt(cp.paperUniverse)) + '</td></tr>' +
        '<tr><th>Passed gates</th><td>' + esc(fmtInt(cp.livePassed)) + '</td><td>' + esc(fmtInt(cp.paperPassed)) + '</td></tr>' +
        '<tr><th>Actionable names</th><td>' + names(cp.liveNames) + '</td><td>' + names(cp.paperNames) + '</td></tr>' +
        '<tr><th>As of</th><td>' + esc(cp.liveAsOfText || DASH) + '</td><td>' + esc(s.asOfText || DASH) + '</td></tr></tbody></table>' +
        '<p class="apx-muted">' + (cp.both.length ? 'In both: ' + esc(cp.both.join(', ')) + '. ' : 'No name is in both lists. ') + 'The live column is a copy for comparison; the Apex card is the only live source.</p>') +
      '</section>';

    const markRow = (k) => '<tr><td>' + esc(k.sym || DASH) + '</td><td>' + esc(k.horizon || DASH) + '</td><td>' + esc(fmtPct(k.ret, 1, true)) + '</td><td>' + esc(fmtPct(k.spyRet, 1, true)) + '</td><td class="' + (k.alpha === null ? '' : k.alpha >= 0 ? 'apx-up' : 'apx-dn') + '">' + esc(fmtPct(k.alpha, 1, true)) + '</td></tr>';
    const markTable = (marks) => '<table class="apx-table"><thead><tr><th>Name</th><th>Horizon</th><th>Return</th><th>SPY</th><th>Alpha</th></tr></thead><tbody>' + marks.map(markRow).join('') + '</tbody></table>';
    const cohortHtml = m.cohorts.length ? m.cohorts.map((co, i) => fold('cohort:' + (co.asOf || i), esc(co.asOfText || co.asOf || 'Undated cohort') + ' <span>' + co.picks.length + ' pick' + (co.picks.length === 1 ? '' : 's') + ' · ' + co.marks.length + ' mark' + (co.marks.length === 1 ? '' : 's') + '</span>',
      '<div class="apx-picks">' + co.picks.map((p) => '<span class="apx-pick"><b>' + esc(p.sym) + '</b>' + esc([p.w === null ? null : fmtPct(p.w, 0), p.setup, p.entryPx === null ? null : 'in ' + fmtPx(p.entryPx), p.status].filter(Boolean).join(' · ') || DASH) + '</span>').join('') + '</div>' +
      (co.marks.length ? markTable(co.marks) : '<p class="apx-empty">Not marked yet.</p>') + '<p class="apx-muted">SPY at entry ' + esc(fmtPx(co.spyAt)) + (co.rulesVersion ? ' · ' + esc(co.rulesVersion) : '') + '</p>')).join('')
      : '<p class="apx-empty" data-apx-nocohort>' + esc(m.cohortNote || 'No cohort yet — the first paper batch has not been recorded.') + '</p>';
    const bt = m.backtest, btTone = { pending: 'warn', done: 'info', failed: 'bad', unknown: 'mute' };
    const btHtml = '<div class="apx-bt" data-apx-backtest="' + esc(bt ? bt.status : 'none') + '"><h3>Backtest ' + chip(bt ? (bt.status === 'unknown' ? 'status not recorded' : bt.status) : 'not run', bt ? btTone[bt.status] : 'mute') + '</h3>' +
      (bt && bt.rows.length ? '<table class="apx-table"><thead><tr><th>Setup</th><th>Signals</th><th>Net ret.</th><th>Net alpha</th><th>Gap stops</th></tr></thead><tbody>' + bt.rows.map((r) => '<tr><td>' + esc(r.setup) + '</td><td>' + esc(fmtInt(r.signals)) + '</td><td>' + esc(fmtPct(r.netRetPct, 1, true)) + '</td><td class="' + (r.netAlphaPct === null ? '' : r.netAlphaPct >= 0 ? 'apx-up' : 'apx-dn') + '">' + esc(fmtPct(r.netAlphaPct, 1, true)) + '</td><td>' + esc(fmtPct(r.gapStopPct, 0)) + '</td></tr>').join('') + '</tbody></table>' : '') +
      '<p class="apx-caveat">Hypothetical and in-sample on today’s names (survivorship bias). Not proven out-of-sample.</p>' +
      (bt && (bt.note || bt.asOfText) ? fold('bt-note', 'Backtest note', (bt.note ? '<p>' + esc(bt.note) + '</p>' : '') + (bt.asOfText ? '<p>As of ' + esc(bt.asOfText) + '</p>' : '')) : '') + '</div>';
    const perfSec = '<section class="card apx-card" data-apx-sec="cohorts"><h2>Paper cohort performance</h2>' + cohortHtml +
      (m.cohorts.length && m.cohortNote ? '<p class="apx-muted">' + esc(m.cohortNote) + '</p>' : '') +
      (m.looseMarks.length ? fold('loose-marks', 'Marks without a cohort <span>' + m.looseMarks.length + '</span>', markTable(m.looseMarks)) : '') +
      (m.metrics.length ? fold('metrics', 'Metrics <span>' + m.metrics.length + '</span>', '<div class="apx-kv">' + m.metrics.map((x) => kv(x.key, x.value)).join('') + '</div>') : '') + btHtml + '</section>';

    const notesBody = (m.notes.length ? '<ul>' + m.notes.map((x) => '<li>' + esc(x) + '</li>').join('') + '</ul>' : '') + (m.sources.length ? '<p><b>Sources</b></p><ul>' + m.sources.map((x) => '<li>' + esc(x) + '</li>').join('') + '</ul>' : '') +
      (m.schema !== null && m.schema !== 1 ? '<p>File schema ' + esc(m.schema) + '; this view was written for schema 1.</p>' : '') + (!m.paper ? '<p>The file does not carry the paper flag; it is still treated as paper research here.</p>' : '');
    const notesSec = '<section class="card apx-card" data-apx-sec="notes">' + fold('notes', 'Notes and sources <span>' + (m.notes.length + m.sources.length) + '</span>', notesBody || '<p>None recorded.</p>') + boundary + '</section>';

    return '<div class="apx" data-apx-state="' + esc(s.kind) + '">' + headerHtml(m) +
      '<div class="apx-l">' + tiles + (cover ? '<div class="apx-cover">' + cover + '</div>' : '') + funnel + compareSec + batchSec + sectorSec + '</div>' +
      '<div class="apx-r">' + rankedSec + perfSec + notesSec + '</div></div>';
  }

  /* Repaint, keeping whatever the reader had opened. */
  function render(el, doc, opts) {
    if (!el) return;
    opts = opts || {};
    const open = new Set();
    try { el.querySelectorAll('details[open][data-apx-key]').forEach((d) => open.add(d.getAttribute('data-apx-key'))); } catch (_) {}
    el.innerHTML = html(doc, opts.now, opts.error);
    if (open.size) el.querySelectorAll('details[data-apx-key]').forEach((d) => { if (open.has(d.getAttribute('data-apx-key'))) d.open = true; });
  }

  return { STALE_HOURS, TECH_CAP_PCT, OPEN_ROWS, OPEN_BARS, RUN_H, RUN_M, etParts, etRunMs, missedWeekdayRun, fmtET, status, model, pointer, html, render };
});
