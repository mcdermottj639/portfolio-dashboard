/* Pure Today presentation helpers. Existing account/strategy models stay authoritative. */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./experience-model.js'));
  else root.PFTodayModel = factory(root.PFExperienceModel);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (M) {
  'use strict';
  const number = M.number;
  const list = value => Array.isArray(value) ? value : [];

  function holdings(brief) {
    return list(brief?.positions).map(row => {
      const sources = list(row?.sources);
      let prior = 0, day = 0;
      let complete = sources.length > 0 && row?.partialDay !== true;
      for (const source of sources) {
        const qty = number(source?.qty), px = number(source?.px), move = number(source?.day);
        if (!(qty > 0 && px > 0) || move === null || !Number.isFinite(qty * px)) {
          complete = false;
          break;
        }
        prior += qty * px - move;
        day += move;
      }
      const changePct = complete && prior > 0 && Number.isFinite(prior) && Number.isFinite(day)
        && Number.isFinite(day / prior * 100) ? day / prior * 100 : null;
      return {...row, changePct};
    });
  }

  function treemap(rows, width = 640, height = 260) {
    const W = number(width), H = number(height);
    if (!(W > 0 && H > 0)) return [];
    const items = list(rows).flatMap((row, order) => {
      const value = number(row?.value);
      return value > 0 ? [{row, value, order}] : [];
    }).sort((a, b) => b.value - a.value || a.order - b.order);
    if (!items.length) return [];
    // Scaling avoids overflow when adding otherwise finite positive values.
    const max = items[0].value;
    items.forEach(item => { item.weight = item.value / max; });
    const total = items.reduce((sum, item) => sum + item.weight, 0), output = [];
    function split(group, x, y, w, h) {
      if (group.length === 1) {
        const item = group[0];
        output.push({...item.row, x:x / W * 100, y:y / H * 100, w:w / W * 100,
          h:h / H * 100, share:item.weight / total * 100});
        return;
      }
      const weight = group.reduce((sum, item) => sum + item.weight, 0);
      let sum = 0, best = Infinity, cut = 1, leftWeight = group[0].weight;
      for (let i = 0; i < group.length - 1; i++) {
        sum += group[i].weight;
        const distance = Math.abs(weight / 2 - sum);
        if (distance < best) { best = distance; cut = i + 1; leftWeight = sum; }
      }
      const ratio = weight > 0 ? leftWeight / weight : cut / group.length;
      const first = group.slice(0, cut), second = group.slice(cut);
      if (w >= h) {
        const firstWidth = w * ratio;
        split(first, x, y, firstWidth, h);
        split(second, x + firstWidth, y, w - firstWidth, h);
      } else {
        const firstHeight = h * ratio;
        split(first, x, y, w, firstHeight);
        split(second, x, y + firstHeight, w, h - firstHeight);
      }
    }
    split(items, 0, 0, W, H);
    return output;
  }

  // Wording lives in PFExperienceModel.ticketStatus (one map for every screen); Today adds nothing of its own.
  function ticket(pending) {
    const t = M.ticketStatus(pending);
    return {group:t.group, label:t.label, detail:t.detail, tone:t.tone, key:t.key, text:t.text, compact:t.compact};
  }

  function levels(value) {
    const stop = number(value?.stop), entry = number(value?.limit), target = number(value?.tp1);
    if (!(stop > 0 && entry > stop && target > entry)) return null;
    const entryPct = (entry - stop) / (target - stop) * 100;
    return Number.isFinite(entryPct) ? {stop, entry, target, entryPct} : null;
  }

  function biggestDrag(rows) {
    let worst = null, move = 0;
    for (const row of list(rows)) {
      const day = number(row?.day);
      if (row?.partialDay === false && day !== null && day < move) { worst = row; move = day; }
    }
    return worst;
  }

  // ---- Scoreboard (v264): four rows measured from ONE start date. Pure display math over published records.
  // Nothing is estimated or backfilled: a number that does not exist yet is a named empty state, never 0.
  const SB_HORIZONS = [5, 30, 60, 90];
  // NYSE full-day closures 2026-2027 (Dec 24 2027 stands in for Christmas on a Saturday). After 2027 only weekends are skipped.
  const SB_HOLIDAYS = new Set(['2026-01-01','2026-01-19','2026-02-16','2026-04-03','2026-05-25','2026-06-19','2026-07-03','2026-09-07','2026-11-26','2026-12-25',
    '2027-01-01','2027-01-18','2027-02-15','2027-03-26','2027-05-31','2027-06-18','2027-07-05','2027-09-06','2027-11-25','2027-12-24']);
  const isDay = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v + 'T12:00:00Z'));
  const dayOf = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) && isDay(v.slice(0, 10)) ? v.slice(0, 10) : null;
  const isTrading = day => { const d = new Date(day + 'T12:00:00Z').getUTCDay(); return d !== 0 && d !== 6 && !SB_HOLIDAYS.has(day); };
  function stepDay(day, dir) { const d = new Date(day + 'T12:00:00Z'); do { d.setUTCDate(d.getUTCDate() + dir); } while (!isTrading(d.toISOString().slice(0, 10))); return d.toISOString().slice(0, 10); }
  function addTradingDays(day, n) { let out = day; for (let i = 0; i < n; i++) out = stepDay(out, 1); return out; }
  const sbDate = day => isDay(day) ? new Intl.DateTimeFormat('en-US', {timeZone:'UTC', month:'short', day:'numeric'}).format(new Date(day + 'T12:00:00Z')) : null;
  const finite = v => typeof v === 'number' && Number.isFinite(v);
  const closeMap = bars => {
    const out = {};
    for (const b of list(bars)) {
      if (!b || b.interpolated === true || b.live === true) continue;
      const day = dayOf(String(b.begins_at || b.t || '')), close = Number(b.close_price ?? b.c);
      if (day && close > 0) out[day] = close;
    }
    return out;
  };
  const pctOf = (end, base) => finite(end) && finite(base) && base > 0 ? (end / base - 1) * 100 : null;
  const horizonNum = h => { const n = Number(String(h ?? '').replace(/d$/i, '')); return Number.isFinite(n) ? n : null; };

  function sbStart(paper) {
    const cohorts = list(paper?.cohorts).filter(c => c && typeof c === 'object').slice().sort((a, b) => String(a.asOf).localeCompare(String(b.asOf)));
    for (const c of cohorts) {
      const entered = list(c.picks).filter(p => p && p.status === 'entered' && isDay(p.entryDate));
      if (entered.length) return {cohort: c, entered, entry: entered.map(p => p.entryDate).sort()[0]};
    }
    return null;
  }

  // Equal-weight mean of recorded raw marks. Every entered name must carry a finite mark, or the horizon is not scored.
  function armReturn(syms, marks, asOf, h) {
    if (!syms.length) return null;
    let sum = 0;
    for (const sym of syms) {
      const m = list(marks).find(x => x && x.asOf === asOf && x.sym === sym && horizonNum(x.horizon) === h);
      if (!m || !finite(m.ret)) return null;
      sum += m.ret;
    }
    return sum / syms.length;
  }

  function scoreboard(input) {
    const o = input || {}, paper = o.paper && typeof o.paper === 'object' && !Array.isArray(o.paper) ? o.paper : null;
    const today = isDay(o.today) ? o.today : null;
    const ROW = [['spy','SPY','Yardstick',true],['live','Apex current','v2.8 live picks',false],
      ['paper','Apex v2.9 · paper','Paper · no trades',false],['agentic','Agentic','Acct ••3900 · est.',false]];
    const stateRow = (r, state, reason, extra) => ({key:r[0], name:r[1], sub:r[2], gray:r[3], paper:r[0] === 'paper', state, value:null, reason, ...extra});
    const blank = (reason, state) => ({start:null, startLabel:null, pill:{tone:'warn', text:reason === 'missing' ? 'Data missing' : 'Not started'},
      chips:[...SB_HORIZONS, 'start'], firstScore:null, byHorizon:Object.fromEntries([...SB_HORIZONS, 'start'].map(h => [h, ROW.map(r => stateRow(r, state, reason))]))});
    if (!today) return blank('missing', 'missing');
    if (!paper) return blank('missing', 'missing');
    const st = sbStart(paper);
    if (!st) return blank('no history yet', 'none');
    const {cohort, entered, entry} = st, basis = stepDay(entry, -1), asOf = cohort.asOf;
    const spy = closeMap(o.spyBars), history = list(o.agentic).filter(r => r && isDay(r.t));
    const accountReturn = typeof o.accountReturn === 'function' ? o.accountReturn : null;
    const paperSyms = entered.map(p => p.sym);
    const shadow = list(paper.shadow?.cohorts).find(c => c && c.asOf === asOf);
    const liveSyms = list(shadow?.picks).filter(p => p && p.gate === 'live-pick' && p.status === 'entered').map(p => p.sym);
    const liveStatus = shadow ? String(shadow.liveStatus || '') : '';
    const lastOnOrAfter = (days) => days.filter(d => d >= entry && d <= today).sort().pop() || null;

    const rowFor = (r, h) => {
      const date = h === 'start' ? null : addTradingDays(entry, h);
      const early = () => stateRow(r, 'early', 'too early', {scoreDate:date});
      const ok = (value, thru) => ({key:r[0], name:r[1], sub:r[2], gray:r[3], paper:r[0] === 'paper', state:'ok', value, reason:null, thru:thru || null});
      if (r[0] === 'spy' || r[0] === 'agentic') {
        const days = r[0] === 'spy' ? Object.keys(spy) : history.map(x => x.t);
        const end = h === 'start' ? lastOnOrAfter(days) : date;
        if (h === 'start' && !end) return today < entry ? early() : stateRow(r, 'none', 'no history yet');
        let value = null;
        if (r[0] === 'spy') value = pctOf(spy[end], spy[basis]);
        else if (accountReturn) { const res = accountReturn(history, basis, end); value = res && res.status === 'estimated' && finite(res.returnPct) ? res.returnPct : null; }
        if (value !== null) return ok(value, h === 'start' ? sbDate(end) : null);
        if (h !== 'start' && date >= today) return early();   // today's close may not be recorded yet
        const noBasis = r[0] === 'spy' ? !(spy[basis] > 0) : !history.some(x => x.t === basis);
        return h === 'start' || noBasis ? stateRow(r, 'none', 'no history yet') : stateRow(r, 'missing', 'missing');
      }
      const syms = r[0] === 'paper' ? paperSyms : liveSyms, marks = r[0] === 'paper' ? paper.marks : paper.shadow?.marks;
      if (r[0] === 'live' && (liveStatus === 'missing' || (shadow && !liveSyms.length && liveStatus !== 'pending'))) return stateRow(r, 'missing', 'missing');
      if (r[0] === 'live' && !shadow) return stateRow(r, 'none', 'no history yet');
      if (r[0] === 'live' && !liveSyms.length) return stateRow(r, 'early', 'pending');
      if (h === 'start') {
        for (const hz of SB_HORIZONS.slice().reverse()) { const v = armReturn(syms, marks, asOf, hz); if (v !== null) return ok(v, hz + 'd'); }
        return addTradingDays(entry, SB_HORIZONS[0]) >= today ? early() : stateRow(r, 'missing', 'missing');
      }
      const v = armReturn(syms, marks, asOf, h);
      if (v !== null) return ok(v);
      return date >= today ? early() : stateRow(r, 'missing', 'missing');
    };

    const byHorizon = {};
    for (const h of [...SB_HORIZONS, 'start']) byHorizon[h] = ROW.map(r => rowFor(r, h));
    const first = addTradingDays(entry, SB_HORIZONS[0]);
    const pillFor = h => {
      const rows = byHorizon[h], n = rows.filter(r => r.state === 'ok').length;
      if (n === rows.length) return {tone:'up', text:'Scored'};
      if (n) return {tone:'info', text:'Partial'};
      return rows.some(r => r.state === 'early') ? {tone:'warn', text:'Too early'} : {tone:'warn', text:'No data'};
    };
    return {start:entry, startLabel:sbDate(entry), chips:[...SB_HORIZONS, 'start'], firstScore:sbDate(first), firstScoreDay:first, byHorizon,
      pills:Object.fromEntries(Object.keys(byHorizon).map(h => [h, pillFor(h)])),
      scoreDates:Object.fromEntries(SB_HORIZONS.map(h => [h, sbDate(addTradingDays(entry, h))]))};
  }

  return {holdings, treemap, ticket, levels, biggestDrag, scoreboard, addTradingDays};
});
