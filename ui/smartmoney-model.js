/* Smart Money — pure model (v174). Read-only view of disclosed trades already in the snapshot:
   congressional STOCK Act reports (data.flow.polEvents) and open-market insider Form 4 trades
   (data.flow.symbols[SYM].insiderTrades). Nothing here posts, shares, scores or trades. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.PFSmartMoneyModel=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const DAY=86400000;
  const isDay=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v.slice(0,10))&&Number.isFinite(Date.parse(v.slice(0,10)));
  const day=v=>isDay(v)?v.slice(0,10):null;
  const num=v=>{if(v===null||v===undefined||v==='')return null;const n=Number(v);return Number.isFinite(n)?n:null;};
  const daysBetween=(a,b)=>Math.round((Date.parse(a)-Date.parse(b))/DAY);
  const sym=v=>String(v||'').toUpperCase().trim();
  const MONTHS=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const shortDay=v=>{const d=day(v);return d?MONTHS[+d.slice(5,7)-1]+' '+(+d.slice(8,10)):'—';};
  // "NANCY PELOSI" → "Nancy Pelosi"; keeps short all-caps suffixes (II, III, JR) readable.
  function titleCase(v){
    return String(v||'').trim().toLowerCase().replace(/\s+/g,' ').replace(/(^|[\s\-'.])([a-z])/g,(m,p,c)=>p+c.toUpperCase())
      .replace(/\b(Ii|Iii|Iv|Ceo|Cfo|Cto|Coo|Evp|Svp|Llc|Lp)\b/g,s=>s.toUpperCase());
  }
  // "$1,001 - $15,000" → "$1K–$15K". Unknown shapes pass through trimmed; nothing invents a size.
  function compactMoney(n){
    if(!Number.isFinite(n))return null;
    if(n>=1e6)return '$'+(Math.round(n/1e5)/10).toString().replace(/\.0$/,'')+'M';
    if(n>=1e3)return '$'+Math.round(n/1e3)+'K';
    return '$'+Math.round(n);
  }
  // Numeric [lo,hi] for a reported range, so grouped rows can sum sizes honestly. null when unparseable.
  function bucketRange(v){
    if(v===null||v===undefined)return null;
    const nums=(String(v).match(/\$?\s*[\d,]+(?:\.\d+)?/g)||[]).map(x=>Number(x.replace(/[$,\s]/g,''))).filter(Number.isFinite);
    if(nums.length>=2)return [nums[0]>=1000&&nums[0]%1000===1?nums[0]-1:nums[0],nums[1]];
    if(nums.length===1&&!/over|\+|more/i.test(String(v)))return [nums[0],nums[0]];
    return null;
  }
  function bucketLabel(v){
    if(v===null||v===undefined)return null;
    const s=String(v).trim();if(!s)return null;
    const nums=(s.match(/\$?\s*[\d,]+(?:\.\d+)?/g)||[]).map(x=>Number(x.replace(/[$,\s]/g,''))).filter(Number.isFinite);
    if(nums.length>=2)return compactMoney(nums[0]>=1000&&nums[0]%1000===1?nums[0]-1:nums[0])+'–'+compactMoney(nums[1]);
    if(nums.length===1)return (/over|\+|more/i.test(s)?'Over ':'')+compactMoney(nums[0]);
    return s.slice(0,40);
  }
  // Which of Jack's books a ticker sits in. `held` = { main:Set, agentic:Set, target:Set }.
  function mineOf(s,held){
    const h=held||{};const m=!!(h.main&&h.main.has(s)),a=!!(h.agentic&&h.agentic.has(s)),t=!!(h.target&&h.target.has(s));
    return (m||a||t)?{main:m,agentic:a,target:t&&!a}:null;
  }
  function mineLabel(mine){
    if(!mine)return '';
    const p=[];if(mine.main)p.push('Self-directed');if(mine.agentic)p.push('Agentic');
    return p.length?'You hold · '+p.join(' + '):'Agentic target';
  }
  // ---- Normalize the snapshot into one feed ---------------------------------------------------
  function politicianItems(flow,held){
    const out=[];
    for(const e of (flow&&Array.isArray(flow.polEvents)?flow.polEvents:[])){
      if(!e||!e.sym||!e.filer||(e.side!=='buy'&&e.side!=='sell'))continue;
      const txn=day(e.txn);if(!txn)continue;
      const disc=day(e.disc);const s=sym(e.sym);
      const lag=Number.isFinite(e.lag)?Math.round(e.lag):(disc?daysBetween(disc,txn):null);
      const chamber=e.chamber==='senate'?'Senate':e.chamber==='house'?'House':null;
      out.push({id:'pol|'+String(e.filer).toUpperCase()+'|'+s+'|'+e.side+'|'+txn,kind:'politician',
        who:titleCase(e.filer),whoKey:'pol|'+String(e.filer).toUpperCase(),role:chamber?chamber+' member':'Member of Congress',
        sym:s,side:e.side,txn,seen:disc||txn,disclosed:disc,lag:Number.isFinite(lag)?lag:null,
        amount:bucketLabel(e.amount),range:bucketRange(e.amount),value:null,shares:null,source:'STOCK Act report',mine:mineOf(s,held)});
    }
    return out;
  }
  function insiderItems(flow,held){
    const out=[];const syms=(flow&&flow.symbols)||{};
    for(const k of Object.keys(syms)){
      const rows=syms[k]&&Array.isArray(syms[k].insiderTrades)?syms[k].insiderTrades:[];
      const s=sym(syms[k].sym||k);
      for(const r of rows){
        if(!r||!r.name||(r.side!=='buy'&&r.side!=='sell'))continue;
        const txn=day(r.txn);if(!txn)continue;
        const filed=day(r.filed);const value=num(r.value),shares=num(r.shares);
        out.push({id:'ins|'+s+'|'+String(r.name).toUpperCase()+'|'+r.side+'|'+txn,kind:'insider',
          who:titleCase(r.name),whoKey:'ins|'+String(r.name).toUpperCase()+'|'+s,role:'Insider at '+s,
          sym:s,side:r.side,txn,seen:filed||txn,disclosed:filed,lag:filed?daysBetween(filed,txn):null,
          amount:value!=null?compactMoney(value):null,range:value!=null?[value,value]:null,value,shares,price:num(r.price),source:'SEC Form 4 · open market',mine:mineOf(s,held)});
      }
    }
    return out;
  }
  function allItems(flow,held){
    const seen=new Set();
    return [...politicianItems(flow,held),...insiderItems(flow,held)].filter(i=>!seen.has(i.id)&&seen.add(i.id))
      .sort((a,b)=>b.seen.localeCompare(a.seen)||b.txn.localeCompare(a.txn)||a.id.localeCompare(b.id));
  }
  // filter: 'all' | 'mine' (names you hold or target) | 'following' | 'buy' | 'sell' (v176 chips).
  function feed(items,{kind='all',mineOnly=false,follow=null,filter='all'}={}){
    const f=i=>filter==='mine'?!!i.mine:filter==='following'?!!(follow&&follow.has(i.whoKey)):filter==='buy'||filter==='sell'?i.side===filter:true;
    return items.filter(i=>(kind==='all'||i.kind===kind)&&(!mineOnly||i.mine||(follow&&follow.has(i.whoKey)))&&f(i));
  }
  // ---- Grouped rows (v176) --------------------------------------------------------------------
  // The same person buying the same stock three times was three full cards. One row per
  // person+ticker+side (by:'person') or per ticker+side (by:'stock'); the trades stay inside it.
  // Size is a SUM of reported ranges only when every trade has one, else null (never a partial sum
  // presented as the total).
  function groupItems(items,{by='person'}={}){
    const map=new Map();
    for(const i of items){
      const k=(by==='stock'?'':i.whoKey+'|')+i.sym+'|'+i.side;
      let g=map.get(k);
      if(!g){g={key:'g|'+by+'|'+k,by,sym:i.sym,side:i.side,kind:i.kind,who:i.who,whoKey:i.whoKey,role:i.role,mine:i.mine,items:[]};map.set(k,g);}
      g.items.push(i);
    }
    const out=[];
    for(const g of map.values()){
      const L=g.items;const txns=L.map(i=>i.txn).sort();const lags=L.map(i=>i.lag).filter(Number.isFinite).sort((a,b)=>a-b);
      const full=L.every(i=>Array.isArray(i.range));
      const lo=full?L.reduce((a,i)=>a+i.range[0],0):null,hi=full?L.reduce((a,i)=>a+i.range[1],0):null;
      const people=[...new Set(L.map(i=>i.whoKey))];
      out.push({...g,count:L.length,first:txns[0],last:txns[txns.length-1],seen:L.map(i=>i.seen).sort().pop(),
        lagMin:lags.length?lags[0]:null,lagMax:lags.length?lags[lags.length-1]:null,
        amount:full?(lo===hi?compactMoney(lo):compactMoney(lo)+'–'+compactMoney(hi)):(L.length===1?L[0].amount:null),
        people:people.length,names:[...new Set(L.map(i=>i.who))],mixedKinds:new Set(L.map(i=>i.kind)).size>1});
    }
    return out.sort((a,b)=>b.seen.localeCompare(a.seen)||b.last.localeCompare(a.last)||a.key.localeCompare(b.key));
  }
  function dayRange(a,b){return a===b?shortDay(a):shortDay(a)+'–'+(a.slice(0,7)===b.slice(0,7)?String(+b.slice(8,10)):shortDay(b));}
  function lagRange(g){return g.lagMin==null?null:g.lagMin===g.lagMax?g.lagMin+'d late':g.lagMin+'–'+g.lagMax+'d late';}
  // Summary tiles: filings first seen in the last `days` days, and the most-bought name over 30 days.
  function summary(items,asOf,days=7){
    const age=i=>daysBetween(asOf,i.seen);
    const fresh=items.filter(i=>age(i)>=0&&age(i)<=days);
    const c=new Map();for(const i of items){const a=age(i);if(i.side!=='buy'||a<0||a>30)continue;c.set(i.sym,(c.get(i.sym)||0)+1);}
    const top=[...c.entries()].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]))[0]||null;
    return {fresh:fresh.length,freshMine:fresh.filter(i=>i.mine).length,days,topBuy:top?{sym:top[0],count:top[1]}:null};
  }
  // Your names with a move reported in the last `days` days, most active first.
  function yourNames(items,asOf,days=30){
    const c=new Map();
    for(const i of items){if(!i.mine)continue;const age=daysBetween(asOf,i.seen);if(age<0||age>days)continue;c.set(i.sym,(c.get(i.sym)||0)+1);}
    return [...c.entries()].map(([sym,count])=>({sym,count})).sort((a,b)=>b.count-a.count||a.sym.localeCompare(b.sym));
  }
  // ---- One person -----------------------------------------------------------------------------
  function person(items,key,asOf,months=6){
    const list=items.filter(i=>i.whoKey===key);
    if(!list.length)return null;
    const first=list[0];const buys=list.filter(i=>i.side==='buy').length;
    const lags=list.map(i=>i.lag).filter(Number.isFinite).sort((a,b)=>a-b);
    const syms=[...new Set(list.map(i=>i.sym))];
    const overlap=syms.filter(s=>list.find(i=>i.sym===s).mine);
    const end=new Date(Date.parse(asOf));const bars=[];
    for(let k=months-1;k>=0;k--){
      const d=new Date(Date.UTC(end.getUTCFullYear(),end.getUTCMonth()-k,1));const key=d.toISOString().slice(0,7);
      const inM=list.filter(i=>i.txn.slice(0,7)===key);
      bars.push({month:key,label:d.toLocaleString('en-US',{month:'short',timeZone:'UTC'}),buys:inM.filter(i=>i.side==='buy').length,sells:inM.filter(i=>i.side==='sell').length});
    }
    return {key,kind:first.kind,who:first.who,role:first.role,source:first.source,trades:list.length,buys,sells:list.length-buys,
      medianLag:lags.length?lags[Math.floor(lags.length/2)]:null,symbols:syms,overlap,bars,items:list};
  }
  // ---- One ticker -----------------------------------------------------------------------------
  function ticker(items,flow,s,asOf,days=90){
    s=sym(s);
    const list=items.filter(i=>i.sym===s&&daysBetween(asOf,i.txn)<=days);
    const group=kind=>{const g=list.filter(i=>i.kind===kind);return {buys:g.filter(i=>i.side==='buy').length,sells:g.filter(i=>i.side==='sell').length,people:new Set(g.map(i=>i.whoKey)).size};};
    const f=(flow&&flow.symbols&&flow.symbols[s])||null;
    const insider=f&&f.insider?{cluster:f.insider.cluster||null,buyers:num(f.insider.buyers),sellers:num(f.insider.sellers),note:f.insider.note||null}:null;
    const cl=flow&&flow.polClusters&&flow.polClusters[s]||null;
    const pol=group('politician'),ins=group('insider');
    return {sym:s,days,items:list,politicians:pol,insiders:ins,insider,polCluster:cl,covered:!!f,mine:list.length?list[0].mine:null,read:readOf(pol,ins,insider,cl)};
  }
  // A plain-English read, deliberately conservative: insider BUYING is the informative side;
  // politician trades lag weeks to months and carry zero weight anywhere else in this app.
  function readOf(pol,ins,insider,cl){
    if((insider&&insider.cluster==='buy')||ins.buys>=2)return {tone:'up',title:'Insiders are buying',text:'Open-market insider buying is the stronger signal in this feed. Still check the chart and earnings before acting.'};
    if(cl&&cl.side==='buy'||pol.buys>pol.sells&&pol.buys>=2)return {tone:'mild',title:'Politicians lean buy',text:'Congressional reports arrive weeks to months after the trade, so treat this as weak, late context.'};
    if(ins.sells>0&&!ins.buys)return {tone:'flat',title:'Insider selling only',text:'Large companies see routine insider selling for pay and diversification. On its own it is a weak signal.'};
    if(!pol.buys&&!pol.sells&&!ins.buys&&!ins.sells)return {tone:'none',title:'No reported moves',text:'Nothing disclosed on this name in the window covered by the snapshot.'};
    return {tone:'flat',title:'Mixed or light activity',text:'Not enough one-sided activity to read anything into it.'};
  }
  // ---- Scorecard (v175) ---------------------------------------------------------------------
  // The producer marks every tracked trade from the day it was first seen, against SPY (smartmoney-perf.mjs).
  function perfIndex(flow){
    const m=new Map();
    for(const t of (flow&&flow.perf&&Array.isArray(flow.perf.trades)?flow.perf.trades:[])){if(t&&t.id&&t.res)m.set(t.id,{...t.res,entryDay:t.entryDay||null,lastDay:t.lastDay||null});}
    return m;
  }
  function whoLabel(key){
    const parts=String(key||'').split('|');
    if(parts[0]==='pol')return {who:titleCase(parts[1]),role:'Member of Congress',kind:'politician'};
    if(parts[0]==='ins')return {who:titleCase(parts[1]),role:'Insider at '+(parts[2]||''),kind:'insider'};
    return {who:titleCase(parts[1]||key),role:'',kind:null};
  }
  function board(flow,{kind='all'}={}){
    const rows=(flow&&Array.isArray(flow.scoreboard)?flow.scoreboard:[]).filter(r=>r&&r.who&&(kind==='all'||r.kind===kind));
    return rows.map(r=>{const l=whoLabel(r.who);return {...r,key:r.who,name:l.who,role:l.role,kind:r.kind||l.kind};});
  }
  function personRecord(flow,key){return board(flow).find(r=>r.key===key)||null;}
  const pct=v=>v===null||v===undefined||!Number.isFinite(v)?'—':(v>0?'+':v<0?'−':'')+(Math.abs(v)*100).toFixed(1).replace(/\.0$/,'')+'%';
  // ---- Flags (Jarvis-style decisions) ---------------------------------------------------------
  function flags(items,flow,{asOf,follow=null,days=30}={}){
    const out=[];const symbols=(flow&&flow.symbols)||{};
    const recent=i=>{const a=daysBetween(asOf,i.seen);return a>=0&&a<=days;};
    const mineSyms=[...new Set(items.filter(i=>i.mine).map(i=>i.sym))];
    for(const s of Object.keys(symbols).map(sym)){
      const ins=symbols[s]&&symbols[s].insider;if(!ins||ins.cluster!=='buy')continue;
      const rows=items.filter(i=>i.kind==='insider'&&i.sym===s&&i.side==='buy');
      const mine=rows[0]?rows[0].mine:null;
      const total=rows.reduce((a,i)=>a+(i.value||0),0);
      out.push({id:'cluster-buy|'+s+'|'+(rows[0]?rows[0].txn:flow.asOf||''),sym:s,level:'high',tag:'Cluster buy',mine,
        title:(num(ins.buyers)||rows.length)+' insiders bought '+s,
        stats:[{label:'Bought',value:total?compactMoney(total):'—'},{label:'Latest',value:rows[0]?shortDay(rows[0].txn):'—'},{label:'Signal',value:'Strong'}],
        why:['Open-market buys, not grants, option exercises or gifts','Several different insiders, not one person','Form 4 is filed within days, so this is fresh'].concat(ins.note?[ins.note]:[])});
    }
    const clusters=(flow&&flow.polClusters)||{};
    for(const s of Object.keys(clusters)){const c=clusters[s];if(!c||!mineSyms.includes(sym(s)))continue;
      out.push({id:'pol-cluster|'+sym(s)+'|'+c.lastTxn,sym:sym(s),level:'low',tag:'Congress cluster',mine:mineOf(sym(s),null)||items.find(i=>i.sym===sym(s)).mine,
        title:c.filers+' members of Congress '+(c.side==='buy'?'bought':'sold')+' '+sym(s),
        stats:[{label:'Members',value:String(c.filers)},{label:'Last trade',value:shortDay(c.lastTxn)},{label:'Signal',value:'Weak'}],
        why:['Reported '+(c.medianLagDays!=null?'about '+c.medianLagDays+' days':'weeks')+' after the trades','Context only. Never a reason to buy on its own']});
    }
    for(const i of items){
      if(!recent(i))continue;
      if(i.kind==='insider'&&i.side==='buy'&&i.mine&&!out.some(f=>f.sym===i.sym&&f.tag==='Cluster buy'))
        out.push({id:'ins-buy|'+i.id,sym:i.sym,level:'mid',tag:'Insider buy',mine:i.mine,title:i.who+' bought '+i.sym,
          stats:[{label:'Bought',value:i.amount||'—'},{label:'Traded',value:shortDay(i.txn)},{label:'Signal',value:'Moderate'}],
          why:['Open-market purchase on a name you hold','One insider. A cluster of several would be stronger']});
      if(follow&&follow.has(i.whoKey))
        out.push({id:'follow|'+i.id,sym:i.sym,level:'mid',tag:'Someone you follow',mine:i.mine,title:i.who+' '+(i.side==='buy'?'bought':'sold')+' '+i.sym,
          stats:[{label:'Size',value:i.amount||'—'},{label:'Reported',value:shortDay(i.seen)},{label:'Lag',value:i.lag!=null?i.lag+'d':'—'}],
          why:['You follow '+i.who,i.kind==='politician'?'Congressional reports lag the trade by weeks':'Form 4 filed within days of the trade']});
    }
    const rank={high:0,mid:1,low:2};
    return out.filter((f,k)=>out.findIndex(g=>g.id===f.id)===k).sort((a,b)=>rank[a.level]-rank[b.level]||(b.mine?1:0)-(a.mine?1:0)||a.sym.localeCompare(b.sym));
  }
  // Decisions are local to this device: { [flagId]: { choice:'research'|'snooze'|'dismiss', at, until } }.
  function isOpen(flag,decisions,nowMs){
    const d=decisions&&decisions[flag.id];if(!d)return true;
    if(d.choice==='snooze')return !(Date.parse(d.until)>nowMs);
    return false;
  }
  function cleanState(v){
    const o=v&&typeof v==='object'?v:{};
    const follow=Array.isArray(o.follow)?[...new Set(o.follow.filter(k=>typeof k==='string'&&k.length<200))].slice(0,200):[];
    const decisions={};
    if(o.decisions&&typeof o.decisions==='object')for(const [k,d] of Object.entries(o.decisions)){
      if(typeof k!=='string'||k.length>300||!d||!['research','snooze','dismiss'].includes(d.choice))continue;
      decisions[k]={choice:d.choice,at:typeof d.at==='string'?d.at:null,until:typeof d.until==='string'?d.until:null};
    }
    return {follow,decisions};
  }
  function researchPrompt(kind,subject){
    const L=['Smart Money check from my Portfolio Dashboard (read-only, nothing to trade yet).',''];
    if(kind==='flag')L.push('Flag: '+subject.title,'Ticker: '+subject.sym,...subject.why.map(w=>'• '+w));
    else if(kind==='ticker')L.push('Ticker: '+subject.sym,'Politicians (last '+subject.days+'d): '+subject.politicians.buys+' buys / '+subject.politicians.sells+' sells','Insiders (last '+subject.days+'d): '+subject.insiders.buys+' buys / '+subject.insiders.sells+' sells','Read: '+subject.read.title);
    else if(kind==='person')L.push('Person: '+subject.who+' ('+subject.role+')','Reported trades: '+subject.trades+' ('+subject.buys+' buys / '+subject.sells+' sells)','Names: '+subject.symbols.slice(0,12).join(', '));
    L.push('','Verify these disclosures against the source filings, check the chart, news and earnings date, and tell me whether this changes anything for my holdings. Facts with sources only.');
    return L.join('\n');
  }
  return {bucketRange,groupItems,dayRange,lagRange,summary,perfIndex,whoLabel,board,personRecord,pct,shortDay,titleCase,bucketLabel,compactMoney,mineOf,mineLabel,politicianItems,insiderItems,allItems,feed,yourNames,person,ticker,readOf,flags,isOpen,cleanState,researchPrompt,daysBetween};
});
