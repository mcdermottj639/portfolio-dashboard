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
import { riskAdjustWeights, AG_DEFENSIVE_MIN } from './riskweights.mjs';
import { etDate } from './market.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

// A sleeve counts as a "driver" of a name at or above this score (0-10). 7 = clearly strong, not merely
// non-negative, so `drivers` stays a short, meaningful list rather than tagging every sleeve.
export const DRIVER_THRESHOLD = 7;

// ── Churn governor: two-strike phase-out (2026-08-12) ───────────────────────────────────────────
// The weekly research is memoryless — each run builds a target from scratch, so a name sitting at
// 51/49 conviction flips fully in or out of the book week to week. Live cost: the 08-05 target
// dropped GE/LLY/AMZN/MSFT (all exited 08-10), the 08-11 target re-included all four and dropped
// AAPL/UNH/V (bought 08-10, all exited 08-12) — a near-total book flip in 48 hours, every leg
// short-term taxable. So absence from ONE refresh is no longer an exit signal:
//   • strike 1 — a HELD name in the prior target but missing from the new allocation is RETAINED at
//     its prior weight, flagged `phaseOut:true`. Zero trades: if next week's research re-includes it
//     (the whipsaw case), nothing was ever sold. The deploy planner holds it but never adds to it.
//   • strike 2 — still missing on the NEXT refresh → genuinely dropped; the planner's off-target
//     exit fires. One week of patience is the price of certainty.
//   • override — a verdict that says the BUSINESS is broken (businessOk=false / rec 'avoid') drops
//     immediately, recorded in `target.dropped` with reason 'business-broken', which also unlocks
//     the planner's 14-day min-hold. Churn discipline never holds a broken thesis.
// `meta.held` (currently-held tickers) scopes retention to names that would otherwise be EXITED —
// a prior-target name that was never actually bought has nothing to churn-protect.

// allocation: the workflow's { picks:[{ticker,sector,weightPct,entryZone,stop,target,thesis,...}], summary? }
// meta: { asOf, book, account, method, driftTriggerPp, universe?:[{t,px,hi,lo}], ranked?:[{t,m,q,g,c,v,f}],
//   prior?:<the previous committed target>, held?:['SYM',…], verdicts?:[{t,rec,businessOk,risk},…] }
//   universe feeds the vol proxy; ranked feeds the deterministic `drivers` attribution; prior+held+verdicts
//   feed the two-strike phase-out (all optional — omit prior and the churn guard is inert)
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
  // Two-strike phase-out (churn governor — see the header note). Runs BEFORE riskAdjustWeights so the
  // retained names participate in the renormalization and the caps hold over the whole book.
  const prior = (meta.prior && Array.isArray(meta.prior.names)) ? meta.prior : null;
  const heldSet = Array.isArray(meta.held) ? new Set(meta.held.map((s) => String(s).toUpperCase())) : null;
  const verdictMap = Object.fromEntries((meta.verdicts || [])
    .map((v) => [String(v.t || v.ticker || '').toUpperCase(), v]));
  const dropped = [];
  const phaseOuts = [];
  if (prior) {
    const newSyms = new Set(named.map((n) => n.ticker));
    for (const p of prior.names) {
      if (!p || !p.ticker) continue;
      const sym = String(p.ticker).toUpperCase();
      if (newSyms.has(sym)) continue;
      if (heldSet && !heldSet.has(sym)) { dropped.push({ ticker: sym, reason: 'not-held' }); continue; }
      const v = verdictMap[sym];
      const rec = String((v && (v.rec || v.recommendation)) || '').toLowerCase();
      if (v && (v.businessOk === false || rec === 'avoid')) {
        dropped.push({ ticker: sym, reason: 'business-broken', detail: (v.risk || v.biggestRisk || '') });
        continue;
      }
      if (p.phaseOut) { dropped.push({ ticker: sym, reason: 'phase-out-complete', detail: 'absent from two consecutive research targets' }); continue; }
      phaseOuts.push({
        ticker: sym, sector: p.sector || '', weightPct: +p.weightPct || 0,
        entry: p.entry || '', stop: p.stop != null ? +p.stop : null, target: p.target != null ? +p.target : null,
        phaseOut: true,
        thesis: `PHASE-OUT (churn governor) — dropped by the ${meta.asOf || 'latest'} research but held one more cycle at its prior weight: exits on the NEXT refresh unless re-included; no new money goes in meanwhile. Was: ${p.thesis || '(no prior thesis)'}`,
        px: p.px ?? (uni[sym] && uni[sym].px), hi: p.hi ?? (uni[sym] && uni[sym].hi), lo: p.lo ?? (uni[sym] && uni[sym].lo),
      });
    }
  }
  // DEFENSIVE FLOOR (v124) — see the header note above DEFENSIVE_CLUSTERS in riskweights.mjs. The
  // synthesis prompt asks the research for defensive weight; this is the deterministic guarantee, exactly
  // as the cluster/vol caps are. meta.defensiveMin overrides the mandate dial (0 disables it).
  const defensiveMin = meta.defensiveMin != null ? +meta.defensiveMin : AG_DEFENSIVE_MIN;
  const adj = riskAdjustWeights([...named, ...phaseOuts], { defensiveMin });
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
      + (adj.notes.length ? ` — ${adj.notes.join('; ')}` : '')
      + (phaseOuts.length ? ` | phase-out retained (churn governor, strike 1): ${phaseOuts.map((p) => p.ticker).join(', ')}` : ''),
    account: meta.account || 'AGENTIC',
    book: meta.book != null ? Math.round(meta.book) : null,
    driftTriggerPp: meta.driftTriggerPp != null ? meta.driftTriggerPp : 5,
    names,
    // What ballast the book actually carries, and against what floor. Emitted so the shortfall is visible
    // on the Plan tab and in the run log rather than only inside a `method` string nobody re-reads.
    defensive: adj.defensive,
    // Why prior names left the target — the deploy planner reads 'business-broken' entries to unlock
    // its min-hold (a broken thesis exits regardless of position age). Only present when a prior
    // target was supplied, so pre-governor callers see an unchanged shape.
    ...(prior ? { dropped } : {}),
  };
  return { target: out, notes: adj.notes, clusters: adj.clusters, defensive: adj.defensive, phaseOuts: phaseOuts.map((p) => p.ticker), dropped };
}

// --- CLI ---
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith('--'));
  const flag = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
  if (!file || !existsSync(file)) { console.error('usage: node producer/finalize-target.mjs <raw-allocation.json> [--book N] [--asOf YYYY-MM-DD] [--held SYM,SYM,…] [--no-prior] [--write]'); process.exit(1); }
  const raw = JSON.parse(readFileSync(file, 'utf8'));
  const allocation = raw.allocation || raw; // accept the whole workflow return or just .allocation
  // CHURN GOVERNOR: the committed target IS the prior by definition — read it unless told not to.
  // --held scopes retention to what the account actually holds (pass ••••3900's current tickers);
  // without it every prior name is churn-protected, which fails safe (extra retention, never an
  // extra exit) — the planner refuses to BUY a phaseOut name, so an unheld retained name is inert.
  let prior = null;
  if (!args.includes('--no-prior')) {
    try { const pf = join(__dirname, 'agentic-target.json'); if (existsSync(pf)) prior = JSON.parse(readFileSync(pf, 'utf8')); } catch { prior = null; }
  }
  const heldArg = flag('held');
  const { target, notes, clusters, defensive, phaseOuts, dropped } = finalizeTarget(allocation, {
    book: flag('book') != null ? +flag('book') : (allocation.book || null),
    asOf: flag('asOf'),
    ranked: raw.ranking || null,   // present when fed the whole workflow return → enables `drivers`
    prior,
    held: heldArg ? heldArg.split(',').map((s) => s.trim()).filter(Boolean) : null,
    verdicts: raw.verdicts || null, // the workflow return's adversarial verdicts → business-broken drops
  });
  console.log('risk-adjust notes:', notes.length ? notes.join('\n  ') : '(none — allocation already within caps)');
  console.log('cluster weights:', JSON.stringify(clusters));
  console.log('defensive:', `${defensive.total.toFixed(1)}% (${defensive.direct.toFixed(1)}% direct + ${defensive.lookThrough.toFixed(1)}% via index) vs a ${defensive.floor}% floor`
    + (defensive.shortfall > 0.5 ? `  ⚠️  SHORT ${defensive.shortfall.toFixed(1)}pp` : '  ✅'));
  if (phaseOuts.length) console.log('phase-out retained (strike 1):', phaseOuts.join(', '));
  if (dropped.length) console.log('dropped:', dropped.map((d) => `${d.ticker} (${d.reason})`).join(', '));
  console.log(JSON.stringify(target, null, 2));
  if (args.includes('--write')) {
    writeFileSync(join(__dirname, 'agentic-target.json'), JSON.stringify(target, null, 2) + '\n');
    console.log('→ wrote producer/agentic-target.json');
  }
}
