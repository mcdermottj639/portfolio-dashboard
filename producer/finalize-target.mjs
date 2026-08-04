// producer/finalize-target.mjs — turn the agentic-research workflow's raw allocation into the committed
// producer/agentic-target.json, ENFORCING the deterministic risk caps (riskweights.mjs) on top of the
// model's conviction weights. The workflow proposes; this disposes — so correlation-cluster and vol-scaled
// caps are guaranteed regardless of what the LLM returned.
//
// Used two ways:
//   • import { finalizeTarget } and call it programmatically (on-demand rebalance in a session), or
//   • CLI: node producer/finalize-target.mjs <raw-allocation.json> [--book N] [--asOf YYYY-MM-DD] [--write]
//     where raw-allocation.json is the workflow's return `.allocation` (or { picks:[…] }).
//
// Output shape matches AGENTIC.md: { asOf, method, account, book, driftTriggerPp, names:[{ticker,sector,
// weightPct,entry,stop,target,thesis}] }.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { riskAdjustWeights } from './riskweights.mjs';
import { etDate } from './market.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

// A sleeve counts as a "driver" of a name at or above this score (0-10). 7 = clearly strong, not merely
// non-negative, so `drivers` stays a short, meaningful list rather than tagging every sleeve.
export const DRIVER_THRESHOLD = 7;

// allocation: the workflow's { picks:[{ticker,sector,weightPct,entryZone,stop,target,thesis,...}], summary? }
// meta: { asOf, book, account, method, driftTriggerPp, universe?:[{t,px,hi,lo}], ranked?:[{t,m,q,g,c,v,f}] }
//   universe feeds the vol proxy; ranked feeds the deterministic `drivers` attribution (both optional)
export function finalizeTarget(allocation, meta = {}) {
  const picks = (allocation && (allocation.picks || allocation.names)) || [];
  const uni = Object.fromEntries((meta.universe || []).map((u) => [String(u.t || u.ticker).toUpperCase(), u]));
  // carry price/52wk range into each name so riskweights can compute a vol proxy
  const named = picks.filter((p) => p && p.ticker).map((p) => {
    const sym = String(p.ticker).toUpperCase();
    const u = uni[sym] || {};
    return {
      ticker: sym,
      sector: p.sector || u.sec || '',
      weightPct: +p.weightPct || 0,
      entry: p.entry || p.entryZone || '',
      stop: p.stop != null ? +p.stop : null,
      target: p.target != null ? +p.target : null,
      thesis: p.thesis || '',
      px: p.px ?? u.px, hi: p.hi ?? u.hi, lo: p.lo ?? u.lo,
    };
  });
  const adj = riskAdjustWeights(named);
  // ATTRIBUTION (v95): tag each name with the sleeves that actually earned it a slot, derived
  // DETERMINISTICALLY from the workflow's sleeve scores rather than trusted from the model's prose. This
  // is what lets the Rebalance Log eventually answer "is the flow sleeve earning its weight?" — and
  // therefore what makes adding a new sleeve reversible instead of permanent. Pass meta.ranked (the
  // workflow's `ranking` array); omit it and names simply carry no drivers.
  const rankMap = Object.fromEntries((meta.ranked || [])
    .map((r) => [String(r.t || r.ticker).toUpperCase(), r]));
  const SLEEVE_KEYS = { m: 'momentum', q: 'quality', g: 'growth', c: 'catalyst', v: 'valuation', f: 'flow' };
  const driversFor = (sym) => {
    const r = rankMap[sym];
    if (!r) return null;
    const hits = Object.entries(SLEEVE_KEYS)
      .filter(([k]) => Number.isFinite(r[k]) && r[k] >= DRIVER_THRESHOLD)
      .sort((a, b) => r[b[0]] - r[a[0]])
      .map(([, name]) => name);
    return hits.length ? hits : null;
  };
  // strip the vol-proxy helper fields from the committed target
  const names = adj.names.map(({ px, hi, lo, ...rest }) => {
    const d = driversFor(rest.ticker);
    return d ? { ...rest, drivers: d } : rest;
  });
  const out = {
    asOf: meta.asOf || etDate(),
    method: (meta.method || (allocation && allocation.summary) || 'deep multi-factor research → adversarial verify → synthesis')
      + ' | risk-adjusted (finalize-target.mjs: correlation-cluster + vol-scaled caps)'
      + (adj.notes.length ? ` — ${adj.notes.join('; ')}` : ''),
    account: meta.account || 'AGENTIC',
    book: meta.book != null ? Math.round(meta.book) : null,
    driftTriggerPp: meta.driftTriggerPp != null ? meta.driftTriggerPp : 5,
    names,
  };
  return { target: out, notes: adj.notes, clusters: adj.clusters };
}

// --- CLI ---
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith('--'));
  const flag = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
  if (!file || !existsSync(file)) { console.error('usage: node producer/finalize-target.mjs <raw-allocation.json> [--book N] [--asOf YYYY-MM-DD] [--write]'); process.exit(1); }
  const raw = JSON.parse(readFileSync(file, 'utf8'));
  const allocation = raw.allocation || raw; // accept the whole workflow return or just .allocation
  const { target, notes, clusters } = finalizeTarget(allocation, {
    book: flag('book') != null ? +flag('book') : (allocation.book || null),
    asOf: flag('asOf'),
    ranked: raw.ranking || null,   // present when fed the whole workflow return → enables `drivers`
  });
  console.log('risk-adjust notes:', notes.length ? notes.join('\n  ') : '(none — allocation already within caps)');
  console.log('cluster weights:', JSON.stringify(clusters));
  console.log(JSON.stringify(target, null, 2));
  if (args.includes('--write')) {
    writeFileSync(join(__dirname, 'agentic-target.json'), JSON.stringify(target, null, 2) + '\n');
    console.log('→ wrote producer/agentic-target.json');
  }
}
