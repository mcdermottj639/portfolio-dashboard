// Public-only Predict collector. Safe to publish: no broker login, balances, positions or watchlists.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),M=require('../ui/predictions-model.js');
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const OUT=path.resolve(process.env.PREDICTIONS_OUTPUT||path.join(ROOT,'data/predictions.json'));
const API='https://external-api.kalshi.com/trade-api/v2';
const now=Date.now(),asOf=new Date(now).toISOString();
const configs=[['KXNFLGAME','NFL','Sports'],['KXNCAAFGAME','College football','Sports'],['KXMLBGAME','MLB','Sports'],['KXUFCFIGHT','MMA','Sports'],['KXFED','Fed rates','Economics'],['KXCPI','Inflation','Economics'],['KXCPICORE','Core inflation','Economics']].map(([ticker,label,category])=>({ticker,label,category}));
let prior={};try{prior=JSON.parse(fs.readFileSync(OUT,'utf8'));}catch{}
async function get(url,json=true){
  const res=await fetch(url,{signal:AbortSignal.timeout(25000)});
  if(!res.ok)throw Error('HTTP '+res.status);
  return json?res.json():res.text();
}
async function pool(items,fn,size=3){const results=Array(items.length);let cursor=0;await Promise.all(Array.from({length:Math.min(size,items.length)},async()=>{while(cursor<items.length){const i=cursor++;try{results[i]={ok:true,value:await fn(items[i],i)};}catch(e){results[i]={ok:false,error:e.message};}}}));return results;}
const coverage=[];
const batches=await pool(configs,async cfg=>{
  const rows=[];let cursor='';
  for(let page=0;page<5;page++){
    const params=new URLSearchParams({series_ticker:cfg.ticker,status:'open',limit:'1000',mve_filter:'exclude',...(cursor?{cursor}:{})});
    const data=await get(API+'/markets?'+params);
    if(!Array.isArray(data.markets))throw Error('Missing markets array');
    rows.push(...data.markets);cursor=data.cursor||'';if(!cursor)break;
  }
  if(cursor)throw Error('Market pagination incomplete');
  return rows.map(r=>M.normalizeMarket(r,cfg,asOf)).filter(m=>m&&Date.parse(m.closesAt)>now&&Date.parse(m.closesAt)-now<=(cfg.category==='Economics'?120:21)*86400000);
});
let markets=[];
batches.forEach((r,i)=>{
  const cfg=configs[i];coverage.push({series:cfg.ticker,label:cfg.label,status:r.ok?'ok':'unavailable',checkedAt:asOf,...(!r.ok?{reason:r.error}:{})});
  markets.push(...(r.ok?r.value:(prior.markets||[]).filter(m=>m.series===cfg.ticker)));
});
if(!batches.some(r=>r.ok))throw Error('All market requests failed; retaining the last published file.');
// Refresh unresolved published observations explicitly. A market disappearing from the open list
// is not a result. Archived records use the documented historical endpoint.
const pending=(prior.ideas||[]).filter(i=>!i.settledAt&&!markets.some(m=>m.id===i.marketId)).sort((a,b)=>String(a.lastCheckedAt||'').localeCompare(String(b.lastCheckedAt||''))).slice(0,60);
const resolved=await pool(pending,async i=>{
  let d;
  try{d=await get(API+'/markets/'+encodeURIComponent(i.marketId));}catch(e){if(!e.message.includes('404'))throw e;d=await get(API+'/historical/markets/'+encodeURIComponent(i.marketId));}
  if(!d.market)throw Error('Missing market');
  return M.normalizeMarket(d.market,{ticker:i.series,label:i.group,category:i.category},asOf);
});
resolved.forEach((r,i)=>{if(r.ok&&r.value)markets.push(r.value);else coverage.push({series:pending[i].marketId,status:'unavailable',checkedAt:asOf,reason:r.error});});
const ids=new Map(markets.map(m=>[m.id,m]));markets=[...ids.values()];
// Exact symbol matching from public Robinhood pages. Page HTML is a best-effort discovery source,
// not a supported personal-account API. Cached mappings retain their own observation time.
let rhMap={...(prior.robinhoodLinks||{})},discoveryAt=prior.discoveryAt||null;
if(!discoveryAt||now-Date.parse(discoveryAt)>6*3600000){
  try{
    const html=await get('https://robinhood.com/us/en/prediction-markets/',false);
    const paths=[...new Set([...html.matchAll(/href="([^\"]*\/prediction-markets\/[^\"]*\/events\/[^\"]+)"/g)].map(m=>m[1]))].filter(p=>/\/(pro-football|college-football|baseball|economics|mma)\//.test(p)).slice(0,18);
    let success=0;
    await pool(paths,async p=>{
      const url=M.safeUrl(p.startsWith('/')?'https://robinhood.com'+p:p);if(!url)throw Error('Unsupported URL');
      const body=await get(url,false),match=body.match(/<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
      if(!match)throw Error('Public page schema changed');
      const pp=JSON.parse(match[1])?.props?.pageProps,event=pp?.event;if(!event?.eventContracts)throw Error('Missing public contracts');
      success++;
      for(const c of Object.values(event.eventContracts))if(c?.symbol&&c.exchange==='EXCHANGE_SOURCE_KALSHI'){
        rhMap[c.symbol]={url,name:event.name,matchedAt:asOf,listedTradable:c.tradability==='EVENT_CONTRACT_TRADABILITY_TRADABLE'};
      }
    });
    if(success)discoveryAt=asOf;else throw Error('No matching public event pages');
  }catch(e){coverage.push({series:'Robinhood public links',status:'unavailable',checkedAt:asOf,reason:e.message});}
}
for(const m of markets)if(rhMap[m.id])m.robinhood=rhMap[m.id];
// Prior title/reason/entry quote are immutable. Only an explicit settlement adds an outcome.
const ideas=M.publishedIdeas(prior.ideas,markets,now).map(i=>{
  const k=pending.findIndex(p=>p.id===i.id);return k>=0?{...i,lastCheckedAt:asOf}:i;
});
const featured=M.selectIdeas(markets,now,8,ideas).map(m=>m.id);
const chartIds=[...new Set(featured)].slice(0,8);
const chartResults=await pool(chartIds,async id=>{
  const m=ids.get(id),q=new URLSearchParams({start_ts:String(Math.floor(now/1000)-86400),end_ts:String(Math.floor(now/1000)),period_interval:'60'});
  const d=await get(API+'/series/'+encodeURIComponent(m.series)+'/markets/'+encodeURIComponent(id)+'/candlesticks?'+q);
  if(!Array.isArray(d.candlesticks))throw Error('Missing price history');
  m.history=d.candlesticks.map(c=>({t:new Date(c.end_period_ts*1000).toISOString(),price:M.price(c.price?.close_dollars)}));m.historyAsOf=asOf;
});
chartResults.forEach((r,i)=>{if(!r.ok)coverage.push({series:chartIds[i]+' history',status:'unavailable',checkedAt:asOf,reason:r.error});});
// Carry charts only with their original timestamp. Null prices remain gaps.
for(const m of markets)if(!m.history){const old=(prior.markets||[]).find(p=>p.id===m.id);if(old?.history){m.history=old.history;m.historyAsOf=old.historyAsOf;}}
const snapshot={schemaVersion:1,generatedAt:asOf,source:'Kalshi public API',targetRefreshMinutes:15,coverage,discoveryAt,robinhoodLinks:rhMap,
  markets,featured,ideas,method:{version:'liquidity-v1',description:'Research candidates selected for recent activity, narrow spreads, and upcoming resolution. Not directional forecasts or purchase recommendations. Reference outcomes track one Yes contract at the recorded ask, before fees; fills are hypothetical.'}};
fs.mkdirSync(path.dirname(OUT),{recursive:true});fs.writeFileSync(OUT+'.tmp',JSON.stringify(snapshot));fs.renameSync(OUT+'.tmp',OUT);
console.log(JSON.stringify({at:asOf,markets:markets.length,featured:featured.length,publishedIdeas:ideas.length,settled:ideas.filter(i=>i.settledAt).length,links:Object.keys(rhMap).length,failedSources:coverage.filter(c=>c.status!=='ok').length,output:OUT}));
