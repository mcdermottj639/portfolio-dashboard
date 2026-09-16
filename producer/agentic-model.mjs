// Decision-time provenance. Never relabel an old decision with today's model version.
import { createHash } from 'node:crypto';
export const MODEL_VERSION = 'mandate-a-ai-evidence-v1';
export const MANDATE_VERSION = 'A-2026-09-08';
export const GRADING_VERSION = 2;
export const RISK_VERSION = 'hard-caps-v2';
export const FACTOR_WEIGHTS = { momentum: .22, quality: .24, growth: .22, catalyst: .14, valuation: .18, flow: 0 };
export function stableHash(value) {
  const canonical = (v) => Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object'
    ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])])) : v;
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex').slice(0, 20);
}
export function targetIdentity(target) {
  if (!target) return null;
  // Compute from contents, even if somebody edited a target without refreshing its recorded id.
  return stableHash({ asOf: target.asOf, riskVersion:target.riskVersion, riskSettings:target.riskSettings, factorWeights:target.factorWeights, universeVersion:target.universeVersion, modelVersion: target.modelVersion || 'legacy-unversioned',
    names: (target.names || []).map(n => ({ ticker: n.ticker, weightPct: n.weightPct,
      entry: n.entry, stop: n.stop, target: n.target, phaseOut: !!n.phaseOut })).sort((a,b) => a.ticker.localeCompare(b.ticker)) });
}
export function provenance(target) {
  return { modelVersion: target?.modelVersion || 'legacy-unversioned',
    mandateVersion: target?.mandateVersion || 'legacy-unversioned',
    riskVersion: target?.riskVersion || 'legacy-unversioned',
    targetId: targetIdentity(target), factorWeights: target?.factorWeights || null,
    universeVersion: target?.universeVersion || null,
    evidenceCoverage: target?.research?.coverage ?? null };
}
