// Supported small broker calls + local screening; never reads protected spill files.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readSnapshot } from './fetchgate.mjs';
import { loadInputs } from './refresh-inputs.mjs';
import { etDate, etMinutes } from './market.mjs';
export const UNIVERSE = 'AAPL MSFT GOOGL AMZN META NVDA TSLA NFLX AVGO ORCL CRM ADBE CSCO QCOM TXN INTC AMD IBM MU AMAT DIS CMCSA VZ T COST WMT HD MCD NKE SBUX TGT LOW PG KO PEP PM MDLZ UNH JNJ LLY PFE MRK ABBV AMGN TMO ABT BMY GILD JPM BAC WFC GS MS C AXP V MA BLK SCHW BA CAT GE HON UNP XOM CVX COP LIN'.split(' ');
export function rsi(closes) {
  if (closes.length < 30 || closes.some(c => !(c > 0))) return null;
  let gain = 0, loss = 0;
  for (let i=1;i<closes.length;i++) {
    const d=closes[i]-closes[i-1], g=Math.max(d,0), l=Math.max(-d,0);
    if(i<=14) { gain+=g/14; loss+=l/14; }
    else { gain=(gain*13+g)/14; loss=(loss*13+l)/14; }
  }
  return loss === 0 ? (gain === 0 ? 50 : 100) : 100-100/(1+gain/loss);
}
export function localScreen(inputs, now = new Date(), universe = UNIVERSE) {
  const today=etDate(now), completed = rows => (rows || []).filter(b => {
    const day=String(b.t || b.begins_at || '').slice(0,10);
    return !b.live && !b.interpolated && day && (day < today || day === today && etMinutes(now)>=16*60)
      && Number(b.c ?? b.close_price)>0;
  }).sort((a,b)=>String(a.t||a.begins_at).localeCompare(String(b.t||b.begins_at)));
  const spy=completed(inputs.bars.SPY);
  const ref=String(spy.at(-1)?.t || spy.at(-1)?.begins_at || '').slice(0,10);
  const refFresh=ref && Date.parse(today)-Date.parse(ref)<=5*864e5;
  const missing={fundamentals:[],quotes:[],historicals:[]}, results=[];
  if(!refFresh) missing.historicals.push('SPY');
  for(const sym of universe) {
    const f=inputs.funds[sym], q=inputs.quotes[sym], bs=completed(inputs.bars[sym]);
    const price=Number(q?.last_trade_price ?? q?.previous_close), cap=Number(f?.market_cap);
    if(!f || !(cap>0)) missing.fundamentals.push(sym);
    if(!(price>0)) missing.quotes.push(sym);
    if(!refFresh || bs.length<30 || String(bs.at(-1)?.t||bs.at(-1)?.begins_at).slice(0,10)!==ref) missing.historicals.push(sym);
    const value=rsi(bs.map(b=>Number(b.c ?? b.close_price)));
    if(cap>1e10 && price>0 && value!==null && value<45) results.push({ticker:sym,columns:{
      Symbol:sym,Name:sym,Last:price,RSI:value,'Market cap':cap,
      '% Change':Number(q?.previous_close)>0 ? (price/Number(q.previous_close)-1)*100 : null }});
  }
  return { missing, data:{result:{results}}, screen:{source:'local-bounded-universe',
    universe, universeSize:universe.length, barsThrough:ref, asOf:now.toISOString(),
    note:'Limited universe; not the market-wide Robinhood saved scan.'} };
}
if(import.meta.url===`file://${process.argv[1]}`) {
  const raw=join(dirname(fileURLToPath(import.meta.url)),'raw');
  const inputs=loadInputs(raw,await readSnapshot());
  const result=localScreen(inputs);
  const missing=Object.values(result.missing).some(a=>a.length);
  if(process.argv.includes('--plan') || missing) {
    for(const [kind,syms] of Object.entries(result.missing)) {
      const size=kind==='historicals'?1:10;
      for(let i=0;i<syms.length;i+=size) console.log(`${kind}: ${syms.slice(i,i+size).join(' ')}`);
    }
    console.log('Save full tool outputs: picks-screen-fund-N.json / quotes-picks-screen-N.json / hist-day-picks-screen-N.json. Historicals: day, last 3 months; reuse existing fresh history.');
    if(missing && !process.argv.includes('--plan')) process.exitCode=1;
  } else {
    writeFileSync(join(raw,'scan.json'),JSON.stringify(result));
    const finalists=result.data.result.results.sort((a,b)=>a.columns.RSI-b.columns.RSI).slice(0,12).map(r=>r.ticker);
    writeFileSync(join(raw,'picks-fund.json'),JSON.stringify({data:{results:finalists.map(s=>inputs.funds[s])}}));
    console.log(`Local screen: ${result.screen.universeSize} names, ${result.data.result.results.length} matches; limited universe, bars through ${result.screen.barsThrough}.`);
  }
}
