import { clusterExposure, INDEX_SYMS, validateTarget } from './riskweights.mjs';

// Final holdings determine these numbers, never the allocator's pre-normalization prose.
export function targetFacts(target) {
  const names = target?.names || [], exposure = clusterExposure(names);
  const total = (test) => +names.filter(test).reduce((s,n) => s+n.weightPct,0).toFixed(2);
  return { names: names.length, active: names.filter(n => !n.phaseOut).length,
    phaseOut: names.filter(n => n.phaseOut).length,
    phaseOutWeightPct: total(n => n.phaseOut),
    indexPct: total(n => INDEX_SYMS.includes(n.ticker)),
    exposure, defensive: target?.defensive || null, diversifier: target?.diversifier || null,
    validation: validateTarget(target) };
}
export function finalTargetExplanation(target) {
  const f = targetFacts(target), tech = f.exposure['megacap-tech'] || {};
  return `${f.active} active names${f.phaseOut ? ` plus ${f.phaseOut} phase-out holdings (${f.phaseOutWeightPct.toFixed(2)}% of the final target)` : ''}. `
    + `Megacap-tech is ${(tech.direct || 0).toFixed(2)}% direct and ${(tech.total || 0).toFixed(2)}% including index look-through. `
    + `Index vehicles total ${f.indexPct.toFixed(2)}%. `
    + (f.defensive ? `Defensive exposure is ${f.defensive.direct.toFixed(2)}% direct and ${f.defensive.total.toFixed(2)}% including index look-through. ` : 'Defensive classification was not recorded. ')
    + (f.diversifier ? `Gold/bullion exposure is ${f.diversifier.direct.toFixed(2)}%. ` : '')
    + 'Figures describe the final weights after risk adjustment and phase-out retention. Thesis-review levels are monitored; they are not resting stop orders.';
}
