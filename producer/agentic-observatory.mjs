import { recordedAccountReturn } from './agentic-account-return.mjs';
// Forward-only target vintages. No historical backtest of today's holdings; no invented dividends.
import { closeIndex } from './agentic-ledger.mjs';
import { provenance, targetIdentity } from './agentic-model.mjs';
import { validateTarget } from './riskweights.mjs';
const round = n => Number.isFinite(n) ? +n.toFixed(4) : null;
const dayAge = (a,b) => (Date.parse(b)-Date.parse(a))/86400000;
const mapSeries = rows => new Map(rows || []);
export function observeTargets({ prior = {}, target, histDay = {}, asOf, totalReturn = {}, actualCloses = [], equityHistory = [] } = {}) {
  const today = String(asOf || '').slice(0,10), prices = closeIndex(histDay);
  totalReturn = totalReturn && typeof totalReturn === 'object' ? totalReturn : {};
  actualCloses = Array.isArray(actualCloses) ? actualCloses : [];
  const tracks = structuredClone(Array.isArray(prior?.tracks) ? prior.tracks : []);
  const accountRows = [...new Map([...(Array.isArray(prior?.actualCloses) ? prior.actualCloses : []), ...actualCloses].filter(r=>r && r.day && r.day<today).map(r=>[r.day,r])).values()].filter(r=>dayAge(r.day,today)<=400);
  const id = validateTarget(target).valid ? targetIdentity(target) : null;
  if (id && validateTarget(target).valid && !tracks.some(t => t.targetId === id)) {
    tracks.push({ ...provenance(target), observedAt: asOf, observedDay: today, targetAsOf: target.asOf,
      names: target.names.map(n => ({ticker:n.ticker,weightPct:n.weightPct})), points: [], status:'awaiting-next-close' });
  }
  for (const t of tracks) {
    const syms = [...new Set([...t.names.map(n=>n.ticker),'SPY'])];
    // Total-return series must explicitly declare its dividend/split-adjusted basis and source.
    const triOK = syms.every(sym => totalReturn[sym]?.basis === 'total-return' && totalReturn[sym]?.source && totalReturn[sym]?.normalizationId
      && Array.isArray(totalReturn[sym]?.rows));
    if (!t.basis) {
      t.basis = triOK ? 'total-return' : 'price-return';
      if (triOK) t.normalizationIds = Object.fromEntries(syms.map(sym=>[sym,totalReturn[sym].normalizationId]));
    }
    const idx = t.basis === 'total-return' ? Object.fromEntries(syms.map(sym => [sym,
      totalReturn[sym]?.basis === 'total-return' && totalReturn[sym]?.normalizationId === t.normalizationIds?.[sym] ? (totalReturn[sym].rows || []).filter(r=>Array.isArray(r)&&/^\d{4}-\d{2}-\d{2}$/.test(r[0])&&Number.isFinite(r[1])&&r[1]>0) : []])) : prices;
    const maps = Object.fromEntries(syms.map(sym=>[sym,mapSeries(idx[sym])]));
    // Strictly later than observation day, strictly before today's still-forming daily bar.
    const dates = [...(maps.SPY?.keys() || [])].filter(day=>day>t.observedDay && day<today && syms.every(sym=>maps[sym]?.has(day))).sort();
    if (!t.startDay && dates.length) {
      t.startDay = dates[0]; t.startPrices = Object.fromEntries(syms.map(sym=>[sym,maps[sym].get(t.startDay)]));
    }
    if (!t.startDay) continue;
    for (const day of dates.filter(d=>d>=t.startDay)) {
      if (t.points.some(p=>p.day===day)) continue; // observed outcomes immutable
      const weightSum = t.names.reduce((sum,n)=>sum+n.weightPct,0);
      const model = 100/weightSum*t.names.reduce((v,n)=>v+n.weightPct*maps[n.ticker].get(day)/t.startPrices[n.ticker],0);
      const spy = 100*maps.SPY.get(day)/t.startPrices.SPY;
      t.points.push({day,model:round(model),spy:round(spy),excessPp:round(model-spy)});
    }
    t.points.sort((a,b)=>a.day.localeCompare(b.day));
    const last = t.points.at(-1);
    t.status = !last ? 'awaiting-next-close' : dayAge(last.day,today)>5 ? 'stale-coverage' : 'tracking';
    t.latest = last || null;
    t.accountEstimate = recordedAccountReturn(equityHistory,t.startDay,last?.day);
    t.actual = compareActual(accountRows,t.startDay,last?.day,t.basis,last);
  }
  // Keep complete vintages for one year, never rewrite them using the next target's weights.
  const kept = tracks.filter(t=>dayAge(t.observedDay,today)<=400 || t.targetId===id);
  return { version:2, asOf, accountSummary:recordedAccountReturn(equityHistory), currentTargetId:id, tracks:kept, actualCloses:accountRows,
    note:'Each target is a separate buy-and-hold shadow vintage, filled at the next available common close after first observation. No fees/slippage. Price basis excludes dividends. It is not a simulated rebalance strategy.' };
}
export function compareActual(rows,start,end,basis,model) {
  const unavailable = reason => ({status:'unavailable',reason});
  if (!start || !end || start===end) return unavailable('Needs two aligned completed closes');
  const list = rows.filter(r=>r.day>=start&&r.day<=end).sort((a,b)=>a.day.localeCompare(b.day));
  if (!list.length || list[0].day!==start || list.at(-1).day!==end) return unavailable('Matching account closing valuations missing');
  if (basis!=='total-return') return unavailable('Dividend-adjusted target and SPY series required for account comparison');
  let nav=100;
  for(let i=0;i<list.length;i++) {
    const r=list[i];
    if (!(r.equity>0) || !Number.isFinite(r.cumFlow) || r.verified!==true || r.flowTiming!=='end-of-day' || !r.source) return unavailable('Verified closing equity and timed external cash flows required; inferred flows are insufficient');
    if (i) {
      const prev=list[i-1];
      // The data adapter explicitly attests the covered interval, not just two isolated dates.
      if(r.previousDay!==prev.day) return unavailable('Account valuation interval has a coverage gap');
      const factor=(r.equity-(r.cumFlow-prev.cumFlow))/prev.equity;
      if (!(factor>0)) return unavailable('Invalid flow-adjusted account return');
      nav*=factor;
    }
  }
  return {status:'aligned',nav:round(nav),returnPct:round(nav-100),implementationGapPp:round(nav-model.model),
    note:'Actual minus frictionless shadow includes timing, cash, fees, taxes and execution constraints; not pure trading skill.'};
}
export function shadowSymbols(state={}) {
  return [...new Set(['SPY',...(state.tracks||[]).flatMap(t=>(t.names||[]).map(n=>n.ticker))])];
}

// Diagnostics use same-date-pair daily log returns; no correlation of mismatched trading intervals.
export function riskDiagnostics(names=[],histDay={},asOf) {
  names = Array.isArray(names) ? names.filter(n=>n?.ticker) : [];
  const idx=closeIndex(histDay), today=String(asOf).slice(0,10), series={};
  for (const n of names) {
    const rows=(idx[n.ticker]||[]).filter(r=>r[0]<today).slice(-64), ret=new Map();
    for(let i=1;i<rows.length;i++) if(dayAge(rows[i-1][0],rows[i][0])<=4) ret.set(rows[i-1][0]+'/'+rows[i][0],Math.log(rows[i][1]/rows[i-1][1]));
    series[n.ticker]={ret,last:rows.at(-1)?.[0]||null};
  }
  const variance=a=>{const mean=a.reduce((s,x)=>s+x,0)/a.length;return a.reduce((s,x)=>s+(x-mean)**2,0)/(a.length-1)};
  const vol=names.map(n=>{const s=series[n.ticker],a=[...s.ret.values()],stale=!s.last||dayAge(s.last,today)>5;return {ticker:n.ticker,n:a.length,last:s.last,stale,annualizedPct:a.length>=20&&!stale?round(Math.sqrt(variance(a)*252)*100):null}});
  const pairs=[];
  for(let i=0;i<names.length;i++) for(let j=i+1;j<names.length;j++) {
    const a=series[names[i].ticker],b=series[names[j].ticker],keys=[...a.ret.keys()].filter(k=>b.ret.has(k));
    if(keys.length<20 || !a.last || !b.last || dayAge(a.last,today)>5 || dayAge(b.last,today)>5) continue;
    const x=keys.map(k=>a.ret.get(k)),y=keys.map(k=>b.ret.get(k));
    const mx=x.reduce((s,v)=>s+v,0)/x.length,my=y.reduce((s,v)=>s+v,0)/y.length;
    const den=Math.sqrt(x.reduce((s,v)=>s+(v-mx)**2,0)*y.reduce((s,v)=>s+(v-my)**2,0));
    if(den>0) pairs.push({a:names[i].ticker,b:names[j].ticker,n:keys.length,correlation:round(x.reduce((s,v,k)=>s+(v-mx)*(y[k]-my),0)/den)});
  }
  return {asOf,window:63,minObservations:20,vol,pairs:pairs.sort((a,b)=>b.correlation-a.correlation),
    note:'Display only. Annualized realized price volatility; correlations use matching daily intervals. Unadjusted splits may distort these diagnostics. Existing risk caps remain unchanged.'};
}
