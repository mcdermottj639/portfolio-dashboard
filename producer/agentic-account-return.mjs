// Shared producer/browser calculation. Recorded account observations, never synthetic holdings history.
// Inferred external flows and intraday valuations make this an ESTIMATE, not verified closing TWR.
export function recordedAccountReturn(history, start, end) {
  const pending = reason => ({status:'pending',reason});
  const rows = Array.isArray(history) ? history.filter(r=>r && /^\d{4}-\d{2}-\d{2}$/.test(r.t)
    && (!start || r.t>=start) && (!end || r.t<=end)).slice().sort((a,b)=>a.t.localeCompare(b.t)) : [];
  if(rows.length<2) return pending('Needs two recorded account dates');
  if(start && rows[0].t!==start || end && rows.at(-1).t!==end) return pending('Account history does not cover both comparison dates');
  if(new Set(rows.map(r=>r.t)).size!==rows.length) return pending('Duplicate account dates need reconciliation');
  if(rows.some(r=>!Number.isFinite(r.equity)||r.equity<=0||!Number.isFinite(r.cumFlow))) return pending('Account values or cash-flow estimates are missing');
  let nav=100;
  for(let i=1;i<rows.length;i++) {
    const previous=rows[i-1],row=rows[i];
    if(row.basisShift) return pending('Account measurement changed inside this window');
    const factor=(row.equity-(row.cumFlow-previous.cumFlow))/previous.equity;
    if(!Number.isFinite(factor)||factor<=0) return pending('Invalid flow-adjusted account interval');
    nav*=factor;
  }
  return {status:'estimated',start:rows[0].t,end:rows.at(-1).t,observations:rows.length,
    returnPct:+(nav-100).toFixed(4),method:'recorded-account-inferred-flows',
    note:'Estimated from recorded account values and inferred external flows. Dates match the selected window, but valuation times and dividend treatment may differ from the shadow; no execution gap is inferred.'};
}
