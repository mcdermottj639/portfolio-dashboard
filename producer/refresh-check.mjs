import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { loadInputs, topHoldings } from './refresh-inputs.mjs';
import { readSnapshot } from './fetchgate.mjs';
import { etDate } from './market.mjs';
export function needsResearchRefresh(prior, now = new Date()) {
  if (!prior?.refreshInputs || !prior.generatedAt || etDate(new Date(prior.generatedAt)) !== etDate(now)) return true;
  return prior.refreshInputs.full && (prior.refreshInputs.fullAttempts || 1) < 2
    && prior.refreshInputs.missing.some(s => /^(daily-picks|holdings-fundamentals|holdings-quotes):/.test(s));
}
export function refreshCheck(inputs, { full = true, optionQuotes = null } = {}) {
  const missing = [];
  const files = new Set(inputs.files);
  if(![...files].some(f=>/^main-orders(?:-incremental|-page-\d+)?\.json$/.test(f))) missing.push('order-history: no current input');
  if(full) {
    if(!files.has('scan.json')) missing.push('daily-picks: no current screen');
    if(!files.has('picks.json')) missing.push('daily-picks: rebuild missing or failed');
    const uncovered=topHoldings(inputs).filter(s=>!inputs.funds[s]);
    if(uncovered.length) missing.push(`holdings-fundamentals: ${uncovered.join(', ')}`);
    const unpriced=inputs.positions.filter(p=>Number(p.quantity)>0 && !inputs.quotes[p.symbol]).map(p=>p.symbol);
    if(unpriced.length) missing.push(`holdings-quotes: ${[...new Set(unpriced)].join(', ')}`);
  }
  if(!Array.isArray(optionQuotes) || !optionQuotes.some(q=>q.optionId && Number(q.mark)>0)) missing.push('option-idea-premiums: no usable live quotes; estimates');
  return { status:missing.length?'partial':'inputs-present', full, missing };
}
export async function checkRaw(raw, prior, full) {
  let optionQuotes=null;
  try { optionQuotes=JSON.parse(readFileSync(join(raw,'option-quotes.json'),'utf8')); } catch {}
  const status = refreshCheck(loadInputs(raw,prior),{full,optionQuotes});
  try {
    const options=JSON.parse(readFileSync(join(raw,'options.json'),'utf8'));
    const estimated=(options.ideas?.ideas || []).filter(i=>!i.legs && !i.live);
    if(estimated.length) status.missing.push('option-idea-premiums: estimates for '+estimated.map(i=>i.underlying).join(', '));
  } catch { status.missing.push('options: no current build'); }
  if(status.missing.length) status.status='partial';
  return status;
}
if(import.meta.url===`file://${process.argv[1]}`) {
  const raw=join(dirname(fileURLToPath(import.meta.url)),'raw');
  const prior=await readSnapshot();
  const full=process.argv.includes('--full') || needsResearchRefresh(prior);
  console.log(JSON.stringify(await checkRaw(raw,prior,full),null,2));
  console.log(`Holdings fundamentals batches: ${JSON.stringify(topHoldings(loadInputs(raw,prior)).reduce((a,s,i)=>{if(i%10===0)a.push([]);a.at(-1).push(s);return a;},[]))}`);
}
