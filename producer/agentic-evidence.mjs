// Evidence checks validate traceability/coverage, not the truth of an LLM's claim.
export const RESEARCH_VERSION = 'evidence-v1';
export const RESEARCH_SLEEVES = ['momentum', 'quality', 'growth', 'catalyst'];
const age = (day, asOf) => (Date.parse(asOf) - Date.parse(day)) / 86400000;
export function validEvidence(rows, asOf, maxAge = 120) {
  return Array.isArray(rows) && rows.some(e => e && typeof e.source === 'string'
    && /^(https:\/\/|mcp:)/.test(e.source) && typeof e.claim === 'string' && e.claim.trim().length >= 8
    && /^\d{4}-\d{2}-\d{2}$/.test(e.asOf) && age(e.asOf, asOf) >= 0 && age(e.asOf, asOf) <= maxAge);
}
export function assessResearch(raw, asOf) {
  const rankings = raw.ranking || [], evidence = raw.research?.evidence || {};
  const rows = rankings.map(r => {
    const ticker = r.t || r.ticker, reasons = [], supported = [];
    for (const sleeve of RESEARCH_SLEEVES) {
      const x = evidence[ticker]?.[sleeve];
      if (x?.status === 'observed' && Number.isFinite(x.score) && x.score >= 0 && x.score <= 10
          && validEvidence(x.evidence, asOf, sleeve === 'momentum' || sleeve === 'catalyst' ? 14 : 120)) supported.push(sleeve);
    }
    if (supported.length < 3 || !supported.includes('quality')) reasons.push('need quality and at least three supported sleeves');
    if (!(r.px > 0 && r.hi >= r.px && r.lo > 0 && r.hi > r.lo)
        || !validEvidence(r.evidence, asOf, 5)) reasons.push('fresh, sourced price/range inputs missing');
    return { ticker, supported, eligible: !reasons.length, reasons };
  });
  const selected = (raw.allocation?.picks || raw.picks || []).filter(p => !['SPY', 'VTI', 'VOO', 'IVV'].includes(p.ticker));
  const errors = [];
  if (raw.researchVersion !== RESEARCH_VERSION) errors.push('full evidence-v1 workflow output required');
  for (const p of selected) {
    const row = rows.find(r => r.ticker === p.ticker), v = (raw.verdicts || []).find(v => v.t === p.ticker);
    if (!row?.eligible) errors.push(`${p.ticker}: ${row?.reasons.join('; ') || 'no research row'}`);
    if (!v || v.businessOk !== true || v.rec === 'avoid' || !validEvidence(v.evidence, asOf, 30)) errors.push(`${p.ticker}: supported adversarial verification required`);
  }
  return { version: RESEARCH_VERSION, status: errors.length ? 'incomplete' : 'verified-coverage',
    coverage: rows.length ? rows.filter(r => r.eligible).length / rows.length : 0,
    eligible: rows.filter(r => r.eligible).length, universe: rows.length, rows, errors,
    evidence, note: 'Traceable sources and coverage; not independent fact verification.' };
}
