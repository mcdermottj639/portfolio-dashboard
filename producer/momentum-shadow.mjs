// MOMENTUM-OFF PAPER SHADOW (2026-11-17, owner-approved). PAPER ONLY — nothing here feeds the target,
// the allocator, the executor or any order. It answers one question the sleeve attribution cannot:
// "would the research have RANKED better names with the momentum sleeve switched off?"
//
// Why attribution can't answer it: `drivers` only tags a buy with every sleeve that scored >=7, and
// 34 of the first 37 momentum-tagged buys also carried quality — the tag is not a separate allocation,
// so "momentum-backed buys beat SPY by X" says nothing about what the book would have held without it.
//
// What this records, once per research refresh, from the SAME `ranking` the live composite used:
//   live       — top N single names by the live composite (momentum at its real weight)
//   noMomentum — top N by a composite with momentum weight 0 and the other sleeves renormalized
// Both baskets are equal-weight, frozen at the refresh price, and never edited afterwards. The log
// lives INSIDE agentic-target.json as `momentumShadow` and is carried forward from the committed file at
// every refresh, so the research Routine (which commits only that one file) persists it with no extra step.
// It is outside targetIdentity, so it cannot change a targetId. Index
// vehicles are excluded from both (they are the benchmark, not a pick). Grading marks both to a later
// price; the number that matters is noMomentum minus live. Fewer than SHADOW_MIN_COHORTS graded
// cohorts is reported as `thin` — a curiosity, not a finding (same posture as SLEEVE_MIN_N).
//
// This isolates SELECTION by the composite. It does not replay the adversarial verify or the
// allocator's sizing, so it is evidence about the factor, not a simulated account.
import { FACTOR_WEIGHTS } from './agentic-model.mjs';
import { INDEX_SYMS } from './riskweights.mjs';

export const SHADOW_N = 10;
export const SHADOW_MIN_COHORTS = 4;
export const SHADOW_MIN_DAYS = 5;

const KEYS = [['momentum', 'm'], ['quality', 'q'], ['growth', 'g'], ['catalyst', 'c'], ['valuation', 'v']];
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

// Weights with `off` sleeves zeroed and the rest renormalized to 1. Flow is ignored (weight 0 in burn-in).
export function shadowWeights(off = ['momentum'], base = FACTOR_WEIGHTS) {
  const kept = KEYS.filter(([name]) => !off.includes(name));
  const total = kept.reduce((s, [name]) => s + (base[name] || 0), 0);
  if (!(total > 0)) throw new Error('shadowWeights: no weight left after switching sleeves off');
  return Object.fromEntries(KEYS.map(([name]) => [name, off.includes(name) ? 0 : (base[name] || 0) / total]));
}

// Same substitution the live composite uses (a missing sleeve scores the neutral 5). A row the live
// model could not score (composite null) is not scored here either, so both baskets draw from one pool.
export function compositeWith(row, weights) {
  if (!row || num(row.composite) == null || num(row.v) == null) return null;
  return +KEYS.reduce((s, [name, k]) => s + weights[name] * (k === 'v' ? row.v : (num(row[k]) ?? 5)), 0).toFixed(3);
}

export function shadowCohort(ranking, { asOf, spyAt = null, n = SHADOW_N, off = ['momentum'] } = {}) {
  if (!asOf) throw new Error('shadowCohort: asOf is required');
  const weights = shadowWeights(off);
  const pool = (ranking || []).map((r) => ({ t: String(r.t || r.ticker || '').toUpperCase(), px: num(r.px), live: num(r.composite), shadow: compositeWith(r, weights), m: num(r.m) }))
    .filter((r) => r.t && !INDEX_SYMS.includes(r.t) && r.px > 0 && r.live != null && r.shadow != null);
  if (pool.length < n) return null;   // too thin a universe to say anything — record nothing rather than a short basket
  const top = (key) => [...pool].sort((a, b) => b[key] - a[key] || a.t.localeCompare(b.t)).slice(0, n)
    .map((r) => ({ t: r.t, px: r.px, composite: r[key], momentum: r.m }));
  const live = top('live'), noMomentum = top('shadow');
  const inLive = new Set(live.map((r) => r.t)), inShadow = new Set(noMomentum.map((r) => r.t));
  const spy = num(spyAt) ?? num(((ranking || []).find((r) => String(r.t || r.ticker).toUpperCase() === 'SPY') || {}).px);
  return { asOf, n, off, weights, spyAt: spy, pool: pool.length, live, noMomentum,
    onlyLive: live.filter((r) => !inShadow.has(r.t)).map((r) => r.t),
    onlyNoMomentum: noMomentum.filter((r) => !inLive.has(r.t)).map((r) => r.t) };
}

// Frozen: a cohort already recorded for this asOf is NEVER replaced, so a re-run cannot rewrite history.
export function appendCohort(ledger, cohort) {
  const cohorts = Array.isArray(ledger?.cohorts) ? ledger.cohorts : [];
  if (!cohort || cohorts.some((c) => c.asOf === cohort.asOf)) return { version: 1, cohorts };
  return { version: 1, cohorts: [...cohorts, cohort].sort((a, b) => a.asOf.localeCompare(b.asOf)) };
}

const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);

// quotes: { SYM: price }. Every name in a basket needs a price — a missing one never improves a score by omission.
export function gradeShadow(ledger, quotes = {}, asOf) {
  const px = (t) => num(typeof quotes[t] === 'number' ? quotes[t] : parseFloat(quotes[t]?.last_trade_price ?? quotes[t]?.price));
  const basket = (rows) => {
    const rets = rows.map((r) => (px(r.t) > 0 ? 100 * (px(r.t) - r.px) / r.px : null));
    return rets.some((r) => r == null) ? null : +(rets.reduce((s, r) => s + r, 0) / rets.length).toFixed(2);
  };
  const cohorts = (ledger?.cohorts || []).map((c) => {
    const days = asOf ? daysBetween(c.asOf, asOf) : null;
    const live = basket(c.live), noMomentum = basket(c.noMomentum);
    const spy = c.spyAt > 0 && px('SPY') > 0 ? +(100 * (px('SPY') - c.spyAt) / c.spyAt).toFixed(2) : null;
    const open = days == null || days < SHADOW_MIN_DAYS;
    return { asOf: c.asOf, days, open, livePct: live, noMomentumPct: noMomentum, spyPct: spy,
      diffPp: live != null && noMomentum != null ? +(noMomentum - live).toFixed(2) : null,
      differ: c.onlyLive.length };
  });
  const graded = cohorts.filter((c) => !c.open && c.diffPp != null && c.differ > 0);
  const avg = graded.length ? +(graded.reduce((s, c) => s + c.diffPp, 0) / graded.length).toFixed(2) : null;
  return { cohorts, graded: graded.length, avgDiffPp: avg, noMomentumAhead: graded.filter((c) => c.diffPp > 0).length,
    thin: graded.length < SHADOW_MIN_COHORTS };   // true => "not yet measurable", never a verdict
}

// Carry the committed log forward and add this refresh's cohort. `committed` is the target currently on
// disk (may be null). Returns the object to store as target.momentumShadow, plus what happened.
export function nextShadow(committed, ranking, opts) {
  const prior = committed?.momentumShadow || { version: 1, cohorts: [] };
  const cohort = shadowCohort(ranking, opts);
  const next = appendCohort(prior, cohort);
  return { momentumShadow: next, cohort, added: next.cohorts.length > (prior.cohorts || []).length };
}
