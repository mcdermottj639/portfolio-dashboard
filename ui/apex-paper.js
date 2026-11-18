/* v244 — Apex v2.9 PAPER research view (pure + render).
   Reads ONE public file, data/apex-paper-v29.json (schema 1), and draws it. Nothing else.

   PAPER ONLY. This module never feeds, replaces or changes the live Apex v2.8 card, its targets,
   the Confirm flow, tickets or any agentic surface. ui/apex.js and ui/sd-rules.js do not read it
   (tests/apex-paper.test.cjs asserts neither file references this module or its data file).

   Every field is optional. A missing or non-numeric number is null and renders "—", never 0.
   A missing file, a failed run, partial coverage and a stale file are four different states and
   each one is named on screen; an old successful time is never shown as the current run.

   #235 decision view: summary (counts, picks + weights + cash, blocked with reasons) first; open Duo / book width
   (≥ 740px) puts the filterable ranked list left and the selected stock right; narrower screens expand rows inline.
   Filters / selection are display state only (no storage, no route). Weights are shown as published; a sum other
   than 100% is noted, never adjusted. Tests: tests/apex-paper-view.test.cjs, tests/apex-paper-view-browser.mjs.

   Loaded by index.html before the main inline script; require()-able from Node tests.
   Keep this file free of DOM access outside render() and the interaction helpers it calls. */
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
      lastSuccessAsOf: str(d.lastSuccessAsOf),
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

  /* ── v246 (#235) decision view: pure helpers ──
     Everything below reads only the model above. Nothing is re-scored, re-sized or re-selected here:
     picks, weights, cash and blocked names are the file's own values, shown as published. */
  const fmtW = (v) => (num(v) === null ? DASH : v.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 }) + '%');
  const NO_SECTOR = 'Sector not recorded';
  const NO_REASON = 'reason not available';

  /* Every listed row once, in list order, tagged with its list. */
  function listedRows(m) {
    const out = [];
    for (const g of ['qualified', 'near', 'emerging']) arr(obj(m.ranked)[g]).forEach((r) => out.push({ r, group: g, key: 'row:' + g + ':' + r.sym }));
    return out;
  }

  /* Picks, blocked names, weights, cash and the counts for the summary.
     selected is null (unknown) when the file has no batch, 0 when the batch is empty. */
  function decision(m) {
    const rows = listedRows(m), first = new Map();
    rows.forEach((x) => { if (!first.has(x.r.sym)) first.set(x.r.sym, x); });
    const b = obj(m.batch), present = b.present === true;
    const picks = arr(b.picks).map((p) => { const x = first.get(p.sym); return { sym: p.sym, weightPct: p.weightPct, sector: x ? x.r.sector : null, listed: !!x, rank: x ? x.r.rank : null }; });
    const seen = new Set();
    const blocked = arr(b.blocked).map((p) => { const x = first.get(p.sym); seen.add(p.sym); return { sym: p.sym, reason: p.reason || (x && x.r.statusReason) || null, listed: !!x, rank: x ? x.r.rank : null }; });
    /* A row the engine marked blocked but left out of batch.blocked is still shown, never dropped. */
    rows.forEach((x) => { if (x.r.status === 'blocked' && !seen.has(x.r.sym)) { seen.add(x.r.sym); blocked.push({ sym: x.r.sym, reason: x.r.statusReason, listed: true, rank: x.r.rank }); } });
    blocked.sort((a, c) => (a.rank === null ? 1e9 : a.rank) - (c.rank === null ? 1e9 : c.rank));
    const weights = picks.map((p) => p.weightPct).filter((w) => w !== null);
    const invested = weights.length ? weights.reduce((a, c) => a + c, 0) : null;
    const cash = num(b.cashPct);
    const total = invested === null && cash === null ? null : (invested || 0) + (cash || 0);
    const allKnown = picks.length > 0 ? weights.length === picks.length && cash !== null : cash !== null;
    /* Shown when the published values do not add to 100 (source rounding): the values are never adjusted. */
    const roundingNote = allKnown && total !== null && Math.abs(total - 100) > 0.05 ? 'Source weights add to ' + fmtW(Math.round(total * 100) / 100) + ' (rounding in the file); shown as published.' : null;
    const bySector = new Map();
    picks.forEach((p) => { if (p.weightPct === null) return; const k = p.sector || NO_SECTOR; bySector.set(k, (bySector.get(k) || 0) + p.weightPct); });
    const sectorWeights = [...bySector.entries()].map(([name, w]) => ({ name, weightPct: w })).sort((a, c) => c.weightPct - a.weightPct || a.name.localeCompare(c.name));
    return {
      present, picks, blocked, cashPct: cash, investedPct: invested, totalPct: total, roundingNote, sectorWeights,
      selected: present ? picks.length : null,
      counts: { screened: obj(m.universe).scanned == null ? null : m.universe.scanned, qualified: obj(m.counts).qualified, near: obj(m.counts).near },
      scale: Math.max(100, total || 0)
    };
  }

  /* Flags used by the list filters; the batch is the only source of "paper selected". */
  function rowFlags(r, d) {
    const pick = d.picks.some((p) => p.sym === r.sym), blk = r.status === 'blocked' || d.blocked.some((p) => p.sym === r.sym);
    return { pick, blocked: blk };
  }
  const FILTER0 = { q: '', seg: 'all', sector: '', setup: '', minScore: null, minRR: null };
  function normFilter(f) {
    f = obj(f);
    const n = (v) => { const x = typeof v === 'string' && v.trim() !== '' ? Number(v) : v; return num(x); };
    return { q: (str(f.q) || '').toLowerCase(), seg: ['all', 'pick', 'qualified', 'near', 'blocked'].includes(f.seg) ? f.seg : 'all', sector: str(f.sector) || '', setup: str(f.setup) || '', minScore: n(f.minScore), minRR: n(f.minRR) };
  }
  const filterActive = (f) => { f = normFilter(f); return !!(f.q || f.seg !== 'all' || f.sector || f.setup || f.minScore !== null || f.minRR !== null); };
  function rowMatches(x, f, flags) {
    const r = x.r;
    if (f.seg === 'pick' && !flags.pick) return false;
    if (f.seg === 'blocked' && !flags.blocked) return false;
    if ((f.seg === 'qualified' || f.seg === 'near') && x.group !== f.seg) return false;
    if (f.sector && (f.sector === '__none' ? r.sector !== null : r.sector !== f.sector)) return false;
    if (f.setup && (f.setup === 'none' ? r.setup !== null : r.setup !== f.setup)) return false;
    if (f.minScore !== null && !(r.composite !== null && r.composite >= f.minScore)) return false;
    if (f.minRR !== null && !(r.rr !== null && r.rr >= f.minRR)) return false;
    if (f.q && !(r.sym.toLowerCase().includes(f.q) || (r.name || '').toLowerCase().includes(f.q))) return false;
    return true;
  }
  /* Keys of the listed rows that pass the filter, in list order. A missing number never passes a minimum. */
  function filterRows(m, f) {
    const d = decision(m), nf = normFilter(f);
    return listedRows(m).filter((x) => rowMatches(x, nf, rowFlags(x.r, d))).map((x) => x.key);
  }
  function segCounts(m) {
    const d = decision(m), rows = listedRows(m), c = { all: rows.length, pick: 0, qualified: 0, near: 0, blocked: 0 };
    rows.forEach((x) => { const fl = rowFlags(x.r, d); if (fl.pick) c.pick++; if (fl.blocked) c.blocked++; if (x.group === 'qualified') c.qualified++; if (x.group === 'near') c.near++; });
    return c;
  }
  /* The row the detail pane opens on: the first paper pick that is listed, else the top qualified, else the first row. */
  function defaultSelection(m) {
    const d = decision(m), rows = listedRows(m);
    const pick = rows.find((x) => d.picks.some((p) => p.sym === x.r.sym));
    const x = pick || rows.find((y) => y.group === 'qualified') || rows[0];
    return x ? x.key : null;
  }

  /* Sector bars: qualified COUNT per sector; a pass RATE only where the file has that sector's screened count. */
  function sectorView(m) {
    const rows = arr(m.sectors).filter((x) => x.qualified !== null && x.qualified > 0);
    const totalQ = num(obj(m.counts).qualified) !== null ? m.counts.qualified : rows.reduce((a, x) => a + x.qualified, 0);
    const max = rows.reduce((a, x) => Math.max(a, x.qualified), 0);
    const out = rows.map((x) => ({ name: x.name, qualified: x.qualified, universe: x.universe,
      passRate: x.universe !== null && x.universe > 0 ? (x.qualified / x.universe) * 100 : null,
      shareOfQualified: totalQ ? (x.qualified / totalQ) * 100 : null, bar: max ? (x.qualified / max) * 100 : 0 }))
      .sort((a, c) => c.qualified - a.qualified || a.name.localeCompare(c.name));
    const top = out[0] || null;
    return { rows: out, totalQualified: totalQ || 0, top };
  }

  /* ── markup ── */
  const chip = (text, tone) => '<span class="apx-chip' + (tone ? ' apx-' + tone : '') + '">' + esc(text) + '</span>';
  const fold = (key, summary, body, cls) => '<details class="apx-fold' + (cls ? ' ' + cls : '') + '" data-apx-key="' + esc(key) + '"><summary>' + summary + '</summary><div class="apx-fold-body">' + body + '</div></details>';
  const tile = (label, value, sub, tone, bar) => '<div class="apx-tile' + (tone ? ' apx-t-' + tone : '') + '"><span class="apx-tl">' + esc(label) + '</span><b>' + esc(value) + '</b><small>' + esc(sub || '') + '</small>' +
    (bar === undefined ? '' : '<span class="apx-tbar"><i style="width:' + (bar === null ? 0 : Math.max(bar > 0 ? 1.5 : 0, Math.min(100, bar))).toFixed(1) + '%"></i></span>') + '</div>';
  const kv = (k, v) => '<div><span>' + esc(k) + '</span><b>' + esc(v) + '</b></div>';
  const statusTone = { buy: 'good', watch: 'info', blocked: 'bad', close: 'warn' };
  const PALETTE = 6;

  /* The reason line: selected / blocked from the batch when present, else the row's own status reason. */
  function reasonOf(r, d) {
    const pick = d.picks.find((p) => p.sym === r.sym), blk = d.blocked.find((p) => p.sym === r.sym);
    if (pick) return { kind: 'pick', label: 'Why selected', text: r.statusReason || NO_REASON, weightPct: pick.weightPct };
    if (blk || r.status === 'blocked') return { kind: 'blocked', label: 'Why blocked', text: (blk && blk.reason) || r.statusReason || NO_REASON, weightPct: null };
    return { kind: 'other', label: r.statusLabel, text: r.statusReason || NO_REASON, weightPct: null };
  }

  function bodyHtml(r, d) {
    const why = reasonOf(r, d);
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
    lines.push('<p class="apx-reason apx-reason-' + why.kind + '"><b>' + esc(why.label) + ':</b> ' + esc(why.text) + '</p>');
    if (r.halfSize) lines.push('<p>' + chip('Half size', 'warn') + ' sized at half weight by the paper rules</p>');
    if (r.fails.length) lines.push('<p class="apx-fails"><b>Fails:</b> ' + r.fails.map((x) => chip(x, 'bad')).join('') + '</p>');
    if (r.unlock) lines.push('<p><b>Unlocks if:</b> ' + esc(r.unlock) + '</p>');
    if (r.why) lines.push('<p class="apx-muted"><b>Thesis:</b> ' + esc(r.why) + '</p>');
    const basis = [r.entryType ? 'Entry: ' + r.entryType : null, r.tp1Basis ? 'Target: ' + r.tp1Basis : null, r.stopBasis ? 'Stop: ' + r.stopBasis : null].filter(Boolean).join(' · ');
    const tags = (r.setup ? '<span class="apx-chip apx-setup"><b>' + esc(r.setup) + '</b><i> ' + esc(r.setupLabel || '') + '</i></span>' : chip('no setup', 'mute')) +
      (why.kind === 'pick' ? chip('Paper weight ' + (why.weightPct === null ? 'sized Monday' : fmtW(why.weightPct)), 'good') : '');
    return '<div class="apx-name"><b>' + esc(r.name || r.sym) + '</b><span>' + esc([r.sector || NO_SECTOR, r.theme && r.theme !== r.sector ? r.theme : null].filter(Boolean).join(' · ')) + '</span><span class="apx-tags">' + tags + '</span></div>' +
      levels + '<p class="apx-muted apx-basis">' + esc(basis ? basis + ' · ' : '') + 'levels from the research snapshot, not live quotes</p>' + facts + lines.join('');
  }

  function rowHtml(x, d) {
    const r = x.r, fl = rowFlags(r, d);
    const setup = r.setup ? '<span class="apx-chip apx-setup"><b>' + esc(r.setup) + '</b><i> ' + esc(r.setupLabel || '') + '</i></span>' : chip('no setup', 'mute');
    const head = '<span class="apx-rk">' + esc(fmtInt(r.rank)) + '</span><span class="apx-sym">' + esc(r.sym) + '</span>' + setup +
      '<span class="apx-score" title="Composite score">' + esc(fmtNum(r.composite, 1)) + '</span>' + chip(r.statusLabel, statusTone[r.status] || 'mute');
    return '<details class="apx-row' + (fl.pick ? ' apx-is-pick' : '') + (fl.blocked ? ' apx-is-blocked' : '') + '" data-apx-row="' + esc(r.sym) + '" data-apx-key="' + esc(x.key) + '"><summary>' + head + '</summary><div class="apx-row-body">' + bodyHtml(r, d) + '</div></details>';
  }
  const rowsHtml = (rows, d, empty) => (rows.length ? rows.map((x) => rowHtml(x, d)).join('') : '<p class="apx-empty">' + esc(empty) + '</p>');

  /* The right pane in open-Duo / book mode. Hidden by CSS below 740px, where rows expand inline instead. */
  function detailHtml(m, key) {
    const d = decision(m), x = listedRows(m).find((y) => y.key === key);
    if (!x) return '<section class="card apx-card apx-detail" data-apx-sec="detail" data-apx-detail="" aria-live="polite"><p class="apx-empty">Pick a candidate on the left to see its levels and the reason it was selected or blocked.</p></section>';
    const r = x.r;
    return '<section class="card apx-card apx-detail" data-apx-sec="detail" data-apx-detail="' + esc(x.key) + '" aria-live="polite">' +
      '<div class="apx-dhead"><span class="apx-rk">#' + esc(fmtInt(r.rank)) + ' ' + esc(x.group) + '</span><span class="apx-sym">' + esc(r.sym) + '</span><span class="apx-score">' + esc(fmtNum(r.composite, 1)) + '<i> score</i></span>' + chip(r.statusLabel, statusTone[r.status] || 'mute') + '</div>' +
      bodyHtml(r, d) + '</section>';
  }

  function stampsHtml(m) {
    const s = m.status, tone = s.level === 'ok' ? 'good' : s.level === 'warn' ? 'warn' : 'bad';
    const latest = m.cohorts.reduce((a, c) => { const t = time(c.asOf); return t !== null && (a === null || t > a) ? t : a; }, null);
    const cohortText = m.cohorts.length ? m.cohorts.length + ' recorded' + (latest !== null ? ' · latest ' + fmtET(latest) : '') : 'none graded yet';
    const out = ['<div class="apx-stamp"><span>Research run</span> ' + chip(s.label, tone + ' apx-freshchip') + '</div>'];
    if (s.lastSuccess) out.push('<div class="apx-stamp"><span>Last success</span> ' + chip(s.lastSuccess, 'mute') + '</div>');
    else if (s.usable) { const ok = fmtET(m.lastSuccessAsOf); if (ok && ok !== s.asOfText) out.push('<div class="apx-stamp"><span>Last success</span> <b>' + esc(ok) + '</b></div>'); }
    if (s.usable) out.push('<div class="apx-stamp apx-next"><span>Next paper run</span> <b>' + esc(s.nextRunText || 'not scheduled in this file') + '</b></div>');
    out.push('<div class="apx-stamp"><span>Model</span> <b>' + esc(m.rulesVersion || 'not recorded') + '</b></div>');
    if (s.usable) out.push('<div class="apx-stamp"><span>Cohorts</span> <b>' + esc(cohortText) + '</b></div>');
    return '<div class="apx-stamps">' + out.join('') + '</div>';
  }

  function headerHtml(m) {
    const s = m.status;
    return '<section class="apx-head" data-apx-status="' + esc(s.kind) + '">' +
      '<div class="apx-head-top"><span class="apx-paperonly">PAPER ONLY</span><span class="apx-badge">Apex v2.9 · PAPER RESEARCH — not live</span></div>' +
      stampsHtml(m) +
      (s.detail ? '<p class="apx-statusnote">' + esc(s.detail) + '</p>' : '') +
      (s.kind === 'failed' ? '<p class="apx-statusnote">Anything below is not from a successful run today.</p>' : '') +
      (s.stale ? '<p class="apx-statusnote apx-stalenote">Stale snapshot: prices and levels below are from the last run, not live.</p>' : '') +
      '</section>';
  }

  function decisionHtml(m, d) {
    const u = m.universe, c = m.counts;
    const coverage = u.complete === true ? 'complete' : u.complete === false ? 'partial' : 'coverage not recorded';
    const base = num(u.scanned) !== null && u.scanned > 0 ? u.scanned : null;
    const share = (v) => (base === null || num(v) === null ? null : (v / base) * 100);
    const pctSub = (v, word) => (share(v) === null ? word : group(share(v), share(v) < 10 ? 1 : 0) + '% of scanned');
    const tiles = '<div class="apx-tiles">' +
      tile('Eligible', fmtInt(u.eligible), 'in the universe', '', share(u.eligible)) +
      tile('Scanned', fmtInt(u.scanned), coverage + (u.unique !== null ? ' · ' + fmtInt(u.unique) + ' unique' : ''), u.complete === false ? 'warn' : '', base === null ? null : 100) +
      tile('Qualified', fmtInt(c.qualified), pctSub(c.qualified, 'pass every gate'), 'good', share(c.qualified)) +
      tile('Near', fmtInt(c.near), 'one or two tests short', '', share(c.near)) + '</div>';
    const b = m.batch;
    let alloc;
    if (!b.present) alloc = '<p class="apx-empty">No paper batch in this file.</p>';
    else {
      const segs = d.picks.map((p, i) => p.weightPct === null || p.weightPct <= 0 ? '' : '<i class="apx-seg-w apx-c' + (i % PALETTE) + '" style="width:' + ((p.weightPct / d.scale) * 100).toFixed(2) + '%" title="' + esc(p.sym + ' ' + fmtW(p.weightPct)) + '"></i>').join('') +
        (d.cashPct !== null && d.cashPct > 0 ? '<i class="apx-seg-w apx-cash" style="width:' + ((d.cashPct / d.scale) * 100).toFixed(2) + '%" title="Cash ' + esc(fmtW(d.cashPct)) + '"></i>' : '');
      const legend = d.picks.map((p, i) => '<span class="apx-pick"><i class="apx-dot apx-c' + (i % PALETTE) + '"></i><b>' + esc(p.sym) + '</b>' + esc(p.weightPct === null ? 'sized Monday' : fmtW(p.weightPct)) + (p.sector ? '<small>' + esc(p.sector) + '</small>' : '') + '</span>').join('') +
        '<span class="apx-pick apx-pick-cash"><i class="apx-dot apx-cash"></i><b>Cash</b>' + esc(fmtW(d.cashPct)) + '</span>';
      alloc = '<div class="apx-alloc"><div class="apx-alloc-h"><span>Paper picks <em>' + esc(d.selected === null ? DASH : String(d.selected)) + '</em></span><span>Cash <em>' + esc(fmtW(d.cashPct)) + '</em></span>' + (b.indicative ? chip('Indicative', 'warn') : '') + '</div>' +
        (d.picks.length ? '<div class="apx-stack" role="img" aria-label="Paper weights and cash">' + segs + '</div>' : '') +
        '<div class="apx-picks">' + (d.picks.length ? legend : '<p class="apx-empty">No paper buys in this batch.</p>' + (d.cashPct !== null ? '<span class="apx-pick apx-pick-cash"><b>Cash</b>' + esc(fmtW(d.cashPct)) + '</span>' : '')) + '</div>' +
        (d.roundingNote ? '<p class="apx-muted apx-rounding">' + esc(d.roundingNote) + '</p>' : '') + '</div>';
    }
    const blocked = d.blocked.length ? '<div class="apx-blocked"><span class="apx-tl">Blocked</span>' + d.blocked.map((p) => '<div data-apx-blocked="' + esc(p.sym) + '"><b>' + esc(p.sym) + '</b><span>' + esc(p.reason || NO_REASON) + (p.listed ? '' : ' · not in the listed rows') + '</span></div>').join('') + '</div>' : '';
    const techPct = b.techBatchPct, meter = techPct === null ? '' : '<div class="apx-meter' + (b.overCap ? ' apx-over' : '') + '"><i style="width:' + Math.max(0, Math.min(100, techPct)).toFixed(1) + '%"></i><u style="left:' + TECH_CAP_PCT + '%"></u></div>';
    const tech = b.present ? '<div class="apx-tech"><span>Tech share of batch</span><b class="' + (b.overCap ? 'apx-dn' : '') + '">' + esc(fmtPct(techPct, 0)) + '</b><span>rule: at most ' + TECH_CAP_PCT + '%</span></div>' + meter : '';
    const batchAsOf = b.asOfText && b.asOfText !== m.status.asOfText ? '<p class="apx-muted">Batch as of ' + esc(b.asOfText) + '</p>' : '';
    return '<section class="card apx-card apx-decision" data-apx-sec="decision"><h2>Decision summary <span>paper only · no order is placed</span></h2>' + tiles +
      '<div class="apx-dgrid"><div>' + alloc + '</div><div>' + blocked + tech + batchAsOf + '</div></div>' +
      (b.note ? fold('batch-note', 'Batch note', '<p>' + esc(b.note) + '</p>') : '') + '</section>';
  }

  function filtersHtml(m, d) {
    const c = segCounts(m), rows = listedRows(m);
    const seg = (v, label, n) => '<label class="apx-chip apx-segopt"><input type="radio" name="seg" value="' + v + '"' + (v === 'all' ? ' checked' : '') + '><span>' + esc(label) + ' <i>' + n + '</i></span></label>';
    const sectors = [...new Set(rows.map((x) => x.r.sector).filter(Boolean))].sort();
    const hasNone = rows.some((x) => x.r.sector === null);
    const opt = (v, t) => '<option value="' + esc(v) + '">' + esc(t) + '</option>';
    const sel = (name, label, opts) => '<label class="apx-sel"><span>' + esc(label) + '</span><select name="' + name + '">' + opts + '</select></label>';
    const more = '<div class="apx-selgrid">' +
      sel('sector', 'Sector', opt('', 'Any') + sectors.map((s) => opt(s, s)).join('') + (hasNone ? opt('__none', NO_SECTOR) : '')) +
      sel('setup', 'Setup', opt('', 'Any') + opt('A', 'A · breakout') + opt('B', 'B · pullback') + opt('C', 'C · reversal') + opt('none', 'No setup')) +
      sel('minScore', 'Min score', opt('', 'Any') + [6, 7, 8, 9].map((n) => opt(String(n), '≥ ' + n)).join('')) +
      sel('minRR', 'Min R/R', opt('', 'Any') + [1.5, 2, 3].map((n) => opt(String(n), '≥ ' + n + '×')).join('')) + '</div>';
    return '<form class="apx-filters" data-apx-filters role="search" autocomplete="off">' +
      '<input class="apx-search" type="search" name="q" placeholder="Search symbol or name" aria-label="Search candidates">' +
      '<div class="apx-segs" role="radiogroup" aria-label="Show">' + seg('all', 'All', c.all) + seg('pick', 'Paper picks', c.pick) + seg('qualified', 'Qualified', c.qualified) + seg('near', 'Near', c.near) + seg('blocked', 'Blocked', c.blocked) + '</div>' +
      fold('filters', 'More filters <span>sector · setup · score · R/R</span>', more, 'apx-morefilters') +
      '<div class="apx-fstat"><span data-apx-count>' + c.all + ' listed rows</span><input class="apx-reset" type="reset" value="Reset filters"></div>' +
      '</form>';
  }

  function rankedHtml(m, d) {
    const c = m.counts, q = m.ranked.qualified.map((r) => ({ r, group: 'qualified', key: 'row:qualified:' + r.sym }));
    const near = m.ranked.near.map((r) => ({ r, group: 'near', key: 'row:near:' + r.sym })), em = m.ranked.emerging.map((r) => ({ r, group: 'emerging', key: 'row:emerging:' + r.sym }));
    const listed = (total, shown) => fmtInt(total) + (total !== null && shown < total ? ' · top ' + shown + ' listed' : '');
    return '<section class="card apx-card" data-apx-sec="ranked"><h2>Ranked candidates <span>tap a row</span></h2>' + filtersHtml(m, d) +
      '<div class="apx-listpane">' +
      '<div class="apx-list" data-apx-list="qualified"><h3>Qualified <span>' + esc(listed(c.qualified, q.length)) + '</span></h3>' + rowsHtml(q.slice(0, OPEN_ROWS), d, 'Nothing qualified in this run.') +
      (q.length > OPEN_ROWS ? fold('more-qualified', 'Show all ' + q.length + ' qualified <span>' + (q.length - OPEN_ROWS) + ' more</span>', rowsHtml(q.slice(OPEN_ROWS), d, ''), 'apx-list-fold') : '') + '</div>' +
      fold('near', 'Near <span>' + esc(listed(c.near, near.length)) + '</span>', rowsHtml(near, d, 'No near-miss names listed.'), 'apx-list-fold') +
      fold('emerging', 'Emerging <span>' + esc(listed(c.emerging, em.length)) + '</span>', rowsHtml(em, d, 'No emerging names listed.'), 'apx-list-fold') +
      '<p class="apx-empty" data-apx-nomatch hidden>No listed candidate matches these filters.</p></div></section>';
  }

  function sectorsHtml(m, d) {
    const v = sectorView(m), anyRate = v.rows.some((x) => x.passRate !== null);
    const bars = v.rows.length ? '<div class="apx-sectors">' + v.rows.map((x) => '<div class="apx-sector" data-apx-sector="' + esc(x.name) + '"><span class="apx-bar-l">' + esc(x.name) + '</span><span class="apx-bar-t"><i style="width:' + x.bar.toFixed(1) + '%"></i></span><b>' + esc(fmtInt(x.qualified)) + '</b><small>' + esc(x.passRate === null ? 'no screened count' : fmtPct(x.passRate, x.passRate < 10 ? 1 : 0) + ' of ' + fmtInt(x.universe)) + '</small></div>').join('') + '</div>' +
      '<p class="apx-key">Bar and number = qualified count.' + (anyRate ? ' % = pass rate (qualified ÷ screened in that sector).' : '') + '</p>'
      : '<p class="apx-empty">No qualified names by sector in this file.</p>';
    const top = v.top && v.totalQualified ? '<div class="apx-conc-top"><span class="apx-tl">Concentration</span><b>' + esc(v.top.name) + '</b> <span>' + esc(fmtInt(v.top.qualified)) + ' of ' + esc(fmtInt(v.totalQualified)) + ' qualified · ' + esc(fmtPct(v.top.shareOfQualified, 0)) + '</span></div>' : '';
    const sw = d.sectorWeights.length || (d.cashPct !== null && d.present) ? '<div class="apx-sw"><span class="apx-tl">Paper weight by sector</span>' +
      d.sectorWeights.map((x) => '<div class="apx-bar"><span class="apx-bar-l">' + esc(x.name) + '</span><b>' + esc(fmtW(Math.round(x.weightPct * 100) / 100)) + '</b><span class="apx-bar-t"><i class="apx-wbar" style="width:' + Math.min(100, (x.weightPct / d.scale) * 100).toFixed(1) + '%"></i></span></div>').join('') +
      (d.cashPct !== null ? '<div class="apx-bar"><span class="apx-bar-l">Cash</span><b>' + esc(fmtW(d.cashPct)) + '</b><span class="apx-bar-t"><i class="apx-cash" style="width:' + Math.min(100, (d.cashPct / d.scale) * 100).toFixed(1) + '%"></i></span></div>' : '') + '</div>' : '';
    const pairs = m.sectors.length ? fold('sector-universe', 'Screened vs qualified share <span>all sectors</span>', '<div class="apx-sectors">' + m.sectors.map((x) => '<div class="apx-sector apx-sector-pair"><span class="apx-bar-l">' + esc(x.name) + '</span><span class="apx-pair"><i class="apx-u" style="width:' + x.universeBar.toFixed(1) + '%"></i><i class="apx-q" style="width:' + x.qualifiedBar.toFixed(1) + '%"></i></span><b>' + esc(fmtInt(x.universe)) + ' · ' + esc(fmtInt(x.qualified)) + '</b></div>').join('') + '</div><p class="apx-key"><i class="apx-u"></i>share of screened <i class="apx-q"></i>share of qualified · counts: screened · qualified</p>') : '';
    return '<section class="card apx-card" data-apx-sec="sectors"><h2>Qualified by sector <span>counts</span></h2>' + bars + top + sw +
      '<p class="apx-conc"><b>Tech:</b> ' + esc(fmtPct(m.concentration.techBatchPct, 0)) + ' of the paper batch · live v2.8 tech outside core ' + esc(fmtPct(m.concentration.v28TechOutsideCorePct, 0)) + '</p>' + pairs +
      (m.concentration.note ? fold('conc-note', 'Concentration note', '<p>' + esc(m.concentration.note) + '</p>') : '') + '</section>';
  }

  const PLANNED = ['Forward return per pick', 'SPY over the same window', 'Alpha (pick − SPY)', 'Drawdown while held', 'Risk-adjusted return', 'vs live v2.8, same dates', 'Fees / slippage, if recorded'];

  function cohortsHtml(m) {
    const markRow = (k) => '<tr><td>' + esc(k.sym || DASH) + '</td><td>' + esc(k.horizon || DASH) + '</td><td>' + esc(fmtPct(k.ret, 1, true)) + '</td><td>' + esc(fmtPct(k.spyRet, 1, true)) + '</td><td class="' + (k.alpha === null ? '' : k.alpha >= 0 ? 'apx-up' : 'apx-dn') + '">' + esc(fmtPct(k.alpha, 1, true)) + '</td></tr>';
    const markTable = (marks) => '<table class="apx-table"><thead><tr><th>Name</th><th>Horizon</th><th>Return</th><th>SPY</th><th>Alpha</th></tr></thead><tbody>' + marks.map(markRow).join('') + '</tbody></table>';
    /* Alpha bars: recorded marks only; a mark without alpha is not drawn. */
    const plot = (marks) => { const real = marks.filter((k) => k.alpha !== null); if (!real.length) return ''; const max = real.reduce((a, k) => Math.max(a, Math.abs(k.alpha)), 0) || 1;
      return '<div class="apx-alpha" aria-label="Recorded alpha by mark">' + real.map((k) => '<div class="apx-arow"><span>' + esc((k.sym || DASH) + (k.horizon ? ' · ' + k.horizon : '')) + '</span><span class="apx-axis"><i class="' + (k.alpha >= 0 ? 'apx-apos' : 'apx-aneg') + '" style="width:' + ((Math.abs(k.alpha) / max) * 50).toFixed(1) + '%"></i></span><b class="' + (k.alpha >= 0 ? 'apx-up' : 'apx-dn') + '">' + esc(fmtPct(k.alpha, 1, true)) + '</b></div>').join('') + '</div>'; };
    const measured = m.cohorts.length || m.looseMarks.length;
    const cohortHtml = m.cohorts.length ? m.cohorts.map((co, i) => fold('cohort:' + (co.asOf || i), esc(co.asOfText || co.asOf || 'Undated cohort') + ' <span>' + co.picks.length + ' pick' + (co.picks.length === 1 ? '' : 's') + ' · ' + co.marks.length + ' mark' + (co.marks.length === 1 ? '' : 's') + '</span>',
      '<div class="apx-picks">' + co.picks.map((p) => '<span class="apx-pick"><b>' + esc(p.sym) + '</b>' + esc([p.w === null ? null : fmtPct(p.w, 0), p.setup, p.entryPx === null ? null : 'in ' + fmtPx(p.entryPx), p.status].filter(Boolean).join(' · ') || DASH) + '</span>').join('') + '</div>' +
      (co.marks.length ? plot(co.marks) + markTable(co.marks) : '<p class="apx-empty">Not marked yet.</p>') + '<p class="apx-muted">SPY at entry ' + esc(fmtPx(co.spyAt)) + (co.rulesVersion ? ' · ' + esc(co.rulesVersion) : '') + '</p>')).join('')
      : '<div class="apx-nomeasure"><div class="apx-nm-h">' + chip('Not yet measured', 'warn') + '</div><p class="apx-empty" data-apx-nocohort>' + esc(m.cohortNote || 'No cohort yet — the first paper batch has not been recorded.') + '</p>' +
        '<span class="apx-tl">Measured once cohorts are graded</span><div class="apx-planned">' + PLANNED.map((x) => '<span>' + esc(x) + '</span>').join('') + '</div>' +
        '<p class="apx-muted">Only values the file records are shown; nothing here is estimated. No claim that v2.9 beats v2.8.</p></div>';
    const bt = m.backtest, btTone = { pending: 'warn', done: 'info', failed: 'bad', unknown: 'mute' };
    const btHtml = '<div class="apx-bt" data-apx-backtest="' + esc(bt ? bt.status : 'none') + '"><h3>Backtest ' + chip(bt ? (bt.status === 'unknown' ? 'status not recorded' : bt.status) : 'not run', bt ? btTone[bt.status] : 'mute') + '</h3>' +
      (bt && bt.rows.length ? '<table class="apx-table"><thead><tr><th>Setup</th><th>Signals</th><th>Net ret.</th><th>Net alpha</th><th>Gap stops</th></tr></thead><tbody>' + bt.rows.map((r) => '<tr><td>' + esc(r.setup) + '</td><td>' + esc(fmtInt(r.signals)) + '</td><td>' + esc(fmtPct(r.netRetPct, 1, true)) + '</td><td class="' + (r.netAlphaPct === null ? '' : r.netAlphaPct >= 0 ? 'apx-up' : 'apx-dn') + '">' + esc(fmtPct(r.netAlphaPct, 1, true)) + '</td><td>' + esc(fmtPct(r.gapStopPct, 0)) + '</td></tr>').join('') + '</tbody></table>' : '') +
      '<p class="apx-caveat">Hypothetical and in-sample on today’s names (survivorship bias). Not proven out-of-sample.</p>' +
      (bt && (bt.note || bt.asOfText) ? fold('bt-note', 'Backtest note', (bt.note ? '<p>' + esc(bt.note) + '</p>' : '') + (bt.asOfText ? '<p>As of ' + esc(bt.asOfText) + '</p>' : '')) : '') + '</div>';
    return '<section class="card apx-card" data-apx-sec="cohorts"><h2>Paper validation <span>' + (measured ? 'recorded results only' : 'not yet measured') + '</span></h2>' + cohortHtml +
      (m.cohorts.length && m.cohortNote ? '<p class="apx-muted">' + esc(m.cohortNote) + '</p>' : '') +
      (m.looseMarks.length ? fold('loose-marks', 'Marks without a cohort <span>' + m.looseMarks.length + '</span>', plot(m.looseMarks) + markTable(m.looseMarks)) : '') +
      (m.metrics.length ? fold('metrics', 'Metrics <span>' + m.metrics.length + '</span>', '<div class="apx-kv">' + m.metrics.map((x) => kv(x.key, x.value)).join('') + '</div>') : '') + btHtml + '</section>';
  }

  function html(doc, nowMs, error, ui) {
    const m = model(doc, nowMs, error), s = m.status;
    const boundary = '<p class="apx-boundary">Paper only. Nothing here feeds the live Apex card, its targets, Confirm or any order.</p>';
    if (!s.usable) {
      return '<div class="apx" data-apx-state="' + esc(s.kind) + '">' + headerHtml(m) +
        '<section class="card apx-card"><p class="apx-empty"><b>' + esc(s.label) + '.</b> ' + esc(s.detail || '') + '</p>' + boundary + '</section></div>';
    }
    const d = decision(m), u = m.universe, c = m.counts;
    const filt = u.filters, filtLine = [filt.minMarketCap !== null ? 'market cap ≥ $' + group(filt.minMarketCap / 1e9, 1) + 'B' : null, filt.minAvgVolume !== null ? 'avg volume ≥ ' + group(filt.minAvgVolume, 0) : null, filt.minPrice !== null ? 'price ≥ ' + fmtPx(filt.minPrice) : null].filter(Boolean).join(' · ');
    const coverBody = [u.coverageNote ? '<p>' + esc(u.coverageNote) + '</p>' : '', filtLine ? '<p><b>Filters:</b> ' + esc(filtLine) + '</p>' : '',
      u.duplicatesRemoved !== null ? '<p><b>Duplicates removed:</b> ' + esc(fmtInt(u.duplicatesRemoved)) + '</p>' : '',
      u.batches.length ? '<div class="apx-kv">' + u.batches.map((b) => kv(b.label, fmtInt(b.rows) + ' / ' + fmtInt(b.total))).join('') + '</div>' : '',
      m.quoteBasis ? '<p><b>Quotes:</b> ' + esc(m.quoteBasis) + '</p>' : ''].join('');
    const cover = coverBody ? '<div class="apx-cover">' + fold('coverage', 'Coverage, filters and quote basis', coverBody) + '</div>' : '';

    const rejBar = (r) => '<div class="apx-bar" data-apx-rej="' + esc(r.key || '') + '"><span class="apx-bar-l">' + esc(r.label) + '</span><span class="apx-bar-t"><i style="width:' + (r.pct === null ? 0 : Math.max(2, r.pct).toFixed(1)) + '%"></i></span><b>' + esc(fmtInt(r.count)) + '</b></div>';
    const funnel = '<section class="card apx-card" data-apx-sec="funnel"><h2>Why names dropped out <span>' + esc(fmtInt(c.rejected)) + ' rejected</span></h2>' +
      '<div class="apx-setups">' + m.setups.map((x) => '<span class="apx-chip apx-setup' + (x.key === 'none' ? ' apx-mute' : '') + '"><b>' + esc(x.key === 'none' ? 'None' : x.key) + '</b><i> ' + esc(x.key === 'none' ? '' : x.label) + '</i> ' + esc(fmtInt(x.count)) + '</span>').join('') + '</div>' +
      (m.rejections.length ? '<div class="apx-bars">' + m.rejections.slice(0, OPEN_BARS).map(rejBar).join('') + '</div>' +
        (m.rejections.length > OPEN_BARS ? fold('more-rejections', (m.rejections.length - OPEN_BARS) + ' more reasons', '<div class="apx-bars">' + m.rejections.slice(OPEN_BARS).map(rejBar).join('') + '</div>') : '') +
        '<p class="apx-muted">A name can fail more than one check, so the bars do not add up to the rejected total.</p>'
        : '<p class="apx-empty">No rejection reasons recorded in this file.</p>') +
      '</section>';

    const cp = m.compare, names = (list) => (list.length ? list.map((x) => chip(x, cp.both.includes(x) ? 'info' : 'mute')).join('') : DASH);
    const compareSec = '<section class="card apx-card" data-apx-sec="compare"><h2>v2.9 vs v2.8</h2>' +
      (!cp.present ? '<p class="apx-empty">No v2.8 comparison in this file.</p>' :
        '<table class="apx-table apx-compare"><thead><tr><th></th><th>v2.8 ' + chip('LIVE', 'good') + '</th><th>v2.9 ' + chip('PAPER', 'warn') + '</th></tr></thead><tbody>' +
        '<tr><th>Universe screened</th><td>' + esc(fmtInt(cp.liveUniverse)) + '</td><td>' + esc(fmtInt(cp.paperUniverse)) + '</td></tr>' +
        '<tr><th>Passed gates</th><td>' + esc(fmtInt(cp.livePassed)) + '</td><td>' + esc(fmtInt(cp.paperPassed)) + '</td></tr>' +
        '<tr><th>Actionable names</th><td>' + names(cp.liveNames) + '</td><td>' + names(cp.paperNames) + '</td></tr>' +
        '<tr><th>As of</th><td>' + esc(cp.liveAsOfText || DASH) + '</td><td>' + esc(s.asOfText ? 'research run above' : DASH) + '</td></tr></tbody></table>' +
        '<p class="apx-muted">' + (cp.both.length ? 'In both: ' + esc(cp.both.join(', ')) + '. ' : 'No name is in both lists. ') + 'The live column is a copy for comparison; the Apex card is the only live source.</p>') +
      '</section>';

    const notesBody = (m.notes.length ? '<ul>' + m.notes.map((x) => '<li>' + esc(x) + '</li>').join('') + '</ul>' : '') + (m.sources.length ? '<p><b>Sources</b></p><ul>' + m.sources.map((x) => '<li>' + esc(x) + '</li>').join('') + '</ul>' : '') +
      (m.schema !== null && m.schema !== 1 ? '<p>File schema ' + esc(m.schema) + '; this view was written for schema 1.</p>' : '') + (!m.paper ? '<p>The file does not carry the paper flag; it is still treated as paper research here.</p>' : '');
    const notesSec = '<section class="card apx-card" data-apx-sec="notes">' + fold('notes', 'Notes and sources <span>' + (m.notes.length + m.sources.length) + '</span>', notesBody || '<p>None recorded.</p>') + boundary + '</section>';

    const keys = listedRows(m).map((x) => x.key), sel = ui && ui.sel && keys.includes(ui.sel) ? ui.sel : defaultSelection(m);
    return '<div class="apx" data-apx-state="' + esc(s.kind) + '">' + headerHtml(m) + decisionHtml(m, d) +
      '<div class="apx-explore">' + rankedHtml(m, d) + detailHtml(m, sel) + '</div>' +
      sectorsHtml(m, d) + funnel + cohortsHtml(m) + compareSec + cover + notesSec + '</div>';
  }

  /* ── interaction (DOM only; inside render) ──
     Filters hide rows in place and open the list folds that hold matches; Reset closes the folds it opened.
     In two-pane mode (the detail pane is displayed, ≥ 740px) a row tap fills the right pane instead of expanding. */
  function readFilter(form) {
    if (!form) return normFilter(FILTER0);
    const v = (n) => { const e = form.elements[n]; return e ? e.value : ''; };
    const seg = form.querySelector('input[name="seg"]:checked');
    return normFilter({ q: v('q'), seg: seg ? seg.value : 'all', sector: v('sector'), setup: v('setup'), minScore: v('minScore'), minRR: v('minRR') });
  }
  function writeFilter(form, f) {
    if (!form || !f) return;
    const set = (n, val) => { const e = form.elements[n]; if (e && 'value' in e) e.value = val == null ? '' : String(val); };
    set('q', f.q); set('sector', f.sector); set('setup', f.setup); set('minScore', f.minScore); set('minRR', f.minRR);
    form.querySelectorAll('input[name="seg"]').forEach((r) => { r.checked = r.value === f.seg; });
  }
  function applyFilter(el) {
    const st = el.__apx; if (!st) return;
    const form = el.querySelector('[data-apx-filters]'), f = readFilter(form), active = filterActive(f);
    st.f = active ? f : null;
    const ok = new Set(filterRows(st.m, f));
    let shown = 0;
    el.querySelectorAll('[data-apx-sec="ranked"] .apx-row[data-apx-key]').forEach((row) => { const hit = !active || ok.has(row.getAttribute('data-apx-key')); row.hidden = !hit; if (hit) shown++; });
    el.querySelectorAll('[data-apx-sec="ranked"] details.apx-list-fold').forEach((fd) => {
      const hits = fd.querySelectorAll('.apx-row:not([hidden])').length;
      if (active && hits && !fd.open) { fd.open = true; fd.setAttribute('data-apx-auto', '1'); }
      if (!active && fd.hasAttribute('data-apx-auto')) { fd.open = false; fd.removeAttribute('data-apx-auto'); }
      fd.hidden = active && !hits;
    });
    el.querySelectorAll('[data-apx-sec="ranked"] .apx-list').forEach((l) => { l.classList.toggle('apx-filtered-empty', active && !l.querySelector('.apx-row:not([hidden])')); });
    const total = el.querySelectorAll('[data-apx-sec="ranked"] .apx-row[data-apx-key]').length;
    const cnt = el.querySelector('[data-apx-count]'); if (cnt) cnt.textContent = active ? 'Showing ' + shown + ' of ' + total + ' listed' : total + ' listed rows';
    const none = el.querySelector('[data-apx-nomatch]'); if (none) none.hidden = !(active && shown === 0);
    el.classList.toggle('apx-filtering', active);
  }
  function select(el, key) {
    const st = el.__apx; if (!st) return;
    st.sel = key;
    const pane = el.querySelector('[data-apx-sec="detail"]');
    if (pane) { const tmp = document.createElement('div'); tmp.innerHTML = detailHtml(st.m, key); pane.replaceWith(tmp.firstChild); }
    el.querySelectorAll('[data-apx-sec="ranked"] .apx-row').forEach((r) => { const on = r.getAttribute('data-apx-key') === key; r.classList.toggle('apx-on', on); if (on) r.setAttribute('aria-current', 'true'); else r.removeAttribute('aria-current'); });
  }
  const twoPane = (el) => { const p = el.querySelector('[data-apx-sec="detail"]'); return !!p && typeof getComputedStyle === 'function' && getComputedStyle(p).display !== 'none'; };
  function bind(el) {
    if (el.__apxBound) return;
    el.__apxBound = true;
    el.addEventListener('click', (e) => {
      const sum = e.target && e.target.closest ? e.target.closest('[data-apx-sec="ranked"] .apx-row>summary') : null;
      if (!sum || !twoPane(el)) return;
      e.preventDefault();
      select(el, sum.parentElement.getAttribute('data-apx-key'));
      // Book mode (v250): the list is pinned on the left page, so bring the selected stock to the top of the right page.
      const rk = sum.closest('[data-apx-sec="ranked"]'), np = el.querySelector('[data-apx-sec="detail"]');
      if (rk && np && rk.hasAttribute('data-duo-fill') && np.scrollIntoView) { const t = np.getBoundingClientRect().top; if (t < 96 || t > window.innerHeight * 0.45) np.scrollIntoView({ block: 'start' }); }
    });
    const onInput = (e) => { if (e.target && e.target.closest && e.target.closest('[data-apx-filters]')) applyFilter(el); };
    el.addEventListener('input', onInput); el.addEventListener('change', onInput);
    el.addEventListener('reset', (e) => { if (e.target && e.target.matches && e.target.matches('[data-apx-filters]')) setTimeout(() => applyFilter(el), 0); }, true);
    el.addEventListener('submit', (e) => { if (e.target && e.target.matches && e.target.matches('[data-apx-filters]')) e.preventDefault(); }, true);
  }

  /* Repaint, keeping whatever the reader had opened, filtered and selected. */
  function render(el, doc, opts) {
    if (!el) return;
    opts = opts || {};
    const open = new Set(), prev = el.__apx || {};
    try { el.querySelectorAll('details[open][data-apx-key]:not([data-apx-auto])').forEach((d) => open.add(d.getAttribute('data-apx-key'))); } catch (_) {}
    el.innerHTML = html(doc, opts.now, opts.error, { sel: prev.sel });
    if (open.size) el.querySelectorAll('details[data-apx-key]').forEach((d) => { if (open.has(d.getAttribute('data-apx-key'))) d.open = true; });
    const m = model(doc, opts.now, opts.error);
    if (!m.status.usable) { el.__apx = null; return; }
    const pane = el.querySelector('[data-apx-sec="detail"]');
    el.__apx = { m, f: prev.f || null, sel: pane ? pane.getAttribute('data-apx-detail') || null : null };
    bind(el);
    if (el.__apx.sel) el.querySelectorAll('[data-apx-sec="ranked"] .apx-row').forEach((r) => { if (r.getAttribute('data-apx-key') === el.__apx.sel) { r.classList.add('apx-on'); r.setAttribute('aria-current', 'true'); } });
    if (el.__apx.f) { writeFilter(el.querySelector('[data-apx-filters]'), el.__apx.f); applyFilter(el); }
  }

  return { STALE_HOURS, TECH_CAP_PCT, OPEN_ROWS, OPEN_BARS, RUN_H, RUN_M, etParts, etRunMs, missedWeekdayRun, fmtET, status, model, pointer, html, render,
    decision, rowFlags, filterRows, filterActive, normFilter, segCounts, defaultSelection, sectorView, detailHtml, listedRows, fmtW };
});
