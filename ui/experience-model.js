/* Read-only display models. No broker, producer, or execution dependencies. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PFExperienceModel = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  function number(value) {
    if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  function snapshot(data, main, account) {
    const agentic = account === 'agentic';
    const source = agentic ? data?.agentic : main?.stats;
    const raw = agentic ? data?.agentic?.positions : main?.enriched;
    const positions = (Array.isArray(raw) ? raw : []).filter(p => p && p.symbol).map(p => {
      const qty = number(p.qty ?? p.quantity), px = number(p.px);
      const reported = number(agentic ? p.value : p.val);
      const value = reported !== null && reported > 0 ? reported : qty > 0 && px > 0 ? qty * px : null;
      const q = data?.quotes?.[p.symbol];
      const previous = number(q?.adjusted_previous_close ?? q?.previous_close);
      const day = agentic
        ? (qty > 0 && px > 0 && previous > 0 ? qty * (px - previous) : null)
        : (number(p.dayP) !== null ? number(p.dayD) : null);
      return { symbol: String(p.symbol), qty, px, value, day };
    }).filter(p => p.qty > 0).sort((a, b) => (b.value ?? -1) - (a.value ?? -1));
    const priced = positions.filter(p => p.value !== null);
    const daily = positions.filter(p => p.day !== null);
    const equity = number(agentic ? source?.equity : source?.totalVal);
    const cash = number(agentic ? source?.cash : source?.cashVal);
    // Missing quotes are unknown, never a zero-move holding.
    const day = daily.length ? daily.reduce((s, p) => s + p.day, 0) : null;
    return {
      account, available: !!source, equity, cash, positions, pricedCount: priced.length,
      day, dayCoverage: daily.length, partialDay: daily.length !== positions.length,
      dayPct: day !== null && equity !== null && equity - day > 0 ? day / (equity - day) * 100 : null,
      generatedAt: data?.generatedAt || null,
      accountAsOf: agentic ? data?.agentic?.asOf || null : null,
      target: agentic ? data?.agentic?.target || null : null,
      pending: agentic ? data?.agentic?.pending || null : null,
      contributors: [...daily].sort((a, b) => Math.abs(b.day) - Math.abs(a.day)).slice(0, 3)
    };
  }
  function age(iso, now = Date.now()) {
    if (!iso) return null;
    const stamp = Date.parse(iso);
    if (!Number.isFinite(stamp) || stamp > now + 60000) return null;
    return Math.max(0, (now - stamp) / 60000);
  }
  function scenario({ equity, positionValue, shockPct, shiftPct, costBps }) {
    const values = [equity, positionValue, shockPct, shiftPct, costBps].map(number);
    if (values.some(n => n === null)) return null;
    [equity, positionValue, shockPct, shiftPct, costBps] = values;
    if (equity <= 0 || positionValue < 0 || shockPct < -100 || shockPct > 100 || shiftPct < 0 || shiftPct > 100 || costBps < 0 || costBps > 1000) return null;
    const shifted = positionValue * shiftPct / 100;
    const cost = shifted * costBps / 10000;
    const before = positionValue * shockPct / 100;
    const after = (positionValue - shifted) * shockPct / 100 - cost;
    return { before, after, difference: after - before, cost, shifted, beforePct: before / equity * 100, afterPct: after / equity * 100 };
  }
  function evidence(target, ticker) {
    const sleeves = target?.research?.evidence?.[ticker] || {};
    return Object.entries(sleeves).flatMap(([sleeve, row]) =>
      (Array.isArray(row?.evidence) ? row.evidence : []).filter(e => e && typeof e.claim === 'string').map(e => ({
        sleeve, claim: e.claim, asOf: e.asOf || null,
        source: typeof e.source === 'string' ? e.source : '',
        href: typeof e.source === 'string' && /^https:\/\//i.test(e.source) ? e.source : null
      })));
  }
  return { number, snapshot, age, scenario, evidence };
});
