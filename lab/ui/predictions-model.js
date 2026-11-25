/* Shared public-market math. No account data, orders, or credentials in this module. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.PFPredictionsModel=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const number=v=>!['number','string'].includes(typeof v)||String(v).trim()===''?null:(Number.isFinite(Number(v))?Number(v):null);
  const price=v=>{const n=number(v);return n!==null&&n>=0&&n<=1?n:null;};
  const stamp=v=>typeof v==='string'&&Number.isFinite(Date.parse(v))?v:null;
  const round=v=>Math.round(v*10000)/10000;
  function safeUrl(value){try{const u=new URL(value);return u.protocol==='https:'&&['kalshi.com','robinhood.com','www.robinhood.com'].includes(u.hostname)?u.href:null;}catch{return null;}}
  function normalizeMarket(raw,config,asOf){
    if(!raw||!raw.ticker||!raw.event_ticker)return null;
    const yesBid=price(raw.yes_bid_dollars),yesAsk=price(raw.yes_ask_dollars),noBid=price(raw.no_bid_dollars),noAsk=price(raw.no_ask_dollars);
    return {id:String(raw.ticker),eventId:String(raw.event_ticker),series:config.ticker,category:config.category,group:config.label,
      title:String(raw.title||raw.yes_sub_title||raw.ticker),subtitle:String(raw.subtitle||raw.yes_sub_title||''),
      yesBid,yesAsk,noBid,noAsk,spread:yesBid!==null&&yesAsk!==null&&yesAsk>=yesBid?round(yesAsk-yesBid):null,
      last:price(raw.last_price_dollars),previous:price(raw.previous_price_dollars),volume: number(raw.volume_fp),volume24h:number(raw.volume_24h_fp),
      closesAt:stamp(raw.close_time),expectedAt:stamp(raw.expected_expiration_time),asOf:stamp(asOf),status:String(raw.status||''),
      result:raw.result||null,settlementValue:price(raw.settlement_value_dollars),settledAt:stamp(raw.settlement_ts),
      rules:String(raw.rules_primary||''),secondaryRules:String(raw.rules_secondary||''),exchange:'Kalshi',
      sourceUrl:'https://kalshi.com/markets/'+encodeURIComponent(config.ticker.toLowerCase()),
      isCombo:!!raw.mve_collection_ticker||!!raw.mve_selected_legs?.length};
  }
  function isFresh(asOf,now=Date.now(),maxMinutes=45){const t=Date.parse(asOf||'');return Number.isFinite(t)&&t<=now+60000&&now-t<=maxMinutes*60000;}
  function horizonDays(category){return category==='Sports'?21:category==='Economics'?120:category==='Elections'?1095:365;}
  function eligible(m,now=Date.now()){
    const close=Date.parse(m.closesAt||'');
    return !m.isCombo&&['active','open'].includes(m.status)&&isFresh(m.asOf,now)&&close>now&&
      close-now<=horizonDays(m.category)*86400000&&String(m.rules||'').length>15&&m.yesBid>0&&m.yesAsk>0&&m.yesAsk<1&&
      m.spread!==null&&m.spread<=.08&&(m.volume24h??0)>=100;
  }
  function ideaScore(m,now){const move=m.last!==null&&m.previous!==null?Math.abs(m.last-m.previous):0;return Math.log10(1+(m.volume24h||0))*10-(m.spread||0)*100+Math.min(move,.1)*30+Math.max(0,4-(Date.parse(m.closesAt)-now)/86400000);}
  function selectIdeas(markets,now=Date.now(),limit=8,prior=[]){
    const originals=new Map(prior.map(i=>[i.eventId,i.marketId]));
    const sorted=markets.filter(m=>(!originals.has(m.eventId)||originals.get(m.eventId)===m.id)&&eligible(m,now)).sort((a,b)=>ideaScore(b,now)-ideaScore(a,now)||a.id.localeCompare(b.id));
    const selected=[],events=new Set(),topics=new Map();
    const topic=m=>/inflation/i.test(m.group||'')?'Inflation':m.group||m.series;
    const add=m=>{const t=topic(m);if(events.has(m.eventId)||(topics.get(t)||0)>=2)return false;selected.push(m);events.add(m.eventId);topics.set(t,(topics.get(t)||0)+1);return true;};
    // One active candidate per category first, then round-robin; topic cap stays firm.
    const categories=[...new Set(sorted.map(m=>m.category))];
    for(let round=0;round<limit&&selected.length<limit;round++){
      let added=false;
      for(const category of categories){if(selected.length>=limit)break;const m=sorted.find(m=>m.category===category&&!events.has(m.eventId)&&(topics.get(topic(m))||0)<2);if(m){add(m);added=true;}}
      if(!added)break;
    }
    return selected.slice(0,limit);
  }
  function whyWatch(m){
    const bits=[];
    if(number(m.spread)!==null)bits.push((m.spread*100).toFixed(1).replace('.0','')+'¢ bid–ask spread');
    if(number(m.volume24h)!==null)bits.push(new Intl.NumberFormat('en-US',{notation:'compact',maximumFractionDigits:1}).format(m.volume24h)+' contracts traded in 24h');
    if(price(m.last)!==null&&price(m.previous)!==null&&Math.abs(m.last-m.previous)>=.02)bits.push((m.last>m.previous?'+':'')+((m.last-m.previous)*100).toFixed(0)+'¢ since the previous reference price');
    return bits.join(' · ');
  }
  function publishedIdeas(prior,markets,now=Date.now()){
    const byId=new Map(markets.map(m=>[m.id,m]));
    const records=(Array.isArray(prior)?prior:[]).filter(i=>i&&i.id&&i.publishedAt).map(i=>{
      if(i.settledAt)return i;const m=byId.get(i.marketId);if(!m||!['finalized','settled'].includes(m.status)||m.settlementValue===null)return i;
      return {...i,settledAt:m.settledAt||new Date(now).toISOString(),settlementValue:m.settlementValue,result:m.result||'other',grossChange:round(m.settlementValue-i.entryAsk)};
    });
    const seen=new Set(records.map(i=>i.eventId));
    for(const m of selectIdeas(markets,now,8,records))if(!seen.has(m.eventId)){
      records.push({id:'liquidity-v1:'+m.id,marketId:m.id,eventId:m.eventId,series:m.series,title:m.title,category:m.category,group:m.group,
        side:'yes',publishedAt:new Date(now).toISOString(),entryAsk:m.yesAsk,entryBid:m.yesBid,modelVersion:'liquidity-v1',
        rationale:whyWatch(m),sourceUrl:m.sourceUrl,closesAt:m.closesAt,feeStatus:'not_verified',kind:'research_candidate'});seen.add(m.eventId);
    }
    return records; // Never silently cap or prune the published record.
  }
  function targetStatus(m,target,side='yes',now=Date.now()){
    const ask=side==='no'?m?.noAsk:m?.yesAsk,t=price(target);
    if(!m||!isFresh(m.asOf,now))return 'stale';
    if(!stamp(m.closesAt))return 'no_quote';
    if(!['active','open'].includes(m.status)||Date.parse(m.closesAt)<=now)return 'closed';
    if(ask===null||ask===undefined||ask<=0||ask>=1)return 'no_quote';
    return t===null?'unset':ask<=t?'reached':'watching';
  }
  // Import watchlist intent only. Imported quotes cannot trigger targets until the public feed
  // independently supplies that contract. Stored fallback rows keep their original timestamp.
  function cleanWatchlist(rows,importing=false){
    if(!Array.isArray(rows)||rows.length>500)throw Error('Invalid watchlist');
    const clean=new Map();
    for(const w of rows){
      if(!w||typeof w.id!=='string'||!/^[A-Za-z0-9_-]{1,180}$/.test(w.id)||!['yes','no'].includes(w.side)||
        (w.target!==null&&(price(w.target)===null||number(w.target)<=0||number(w.target)>=1))||w.market?.id!==w.id||typeof w.market.title!=='string')throw Error('Invalid saved market');
      const old=w.market,m={id:w.id};
      for(const key of ['title','subtitle','eventId','series','category','group','rules','secondaryRules','exchange','status'])m[key]=typeof old[key]==='string'?old[key].slice(0,16000):'';
      for(const key of ['yesBid','yesAsk','noBid','noAsk','last','previous','settlementValue'])m[key]=importing?null:price(old[key]);
      for(const key of ['spread','volume','volume24h'])m[key]=importing?null:number(old[key]);
      for(const key of ['closesAt','expectedAt','settledAt','asOf','historyAsOf'])m[key]=key==='asOf'&&importing?null:stamp(old[key]);
      m.sourceUrl=safeUrl(old.sourceUrl);m.isCombo=old.isCombo===true;
      m.history=importing?[]:(Array.isArray(old.history)?old.history:[]).slice(-200).filter(p=>p&&stamp(p.t)).map(p=>({t:p.t,price:price(p.price)}));
      if(!importing&&safeUrl(old.robinhood?.url))m.robinhood={url:safeUrl(old.robinhood.url),matchedAt:stamp(old.robinhood.matchedAt)};
      clean.set(w.id,{id:w.id,side:w.side,target:price(w.target),addedAt:stamp(w.addedAt),market:m});
    }
    return [...clean.values()];
  }
  return {horizonDays,number,price,stamp,safeUrl,normalizeMarket,isFresh,eligible,selectIdeas,whyWatch,publishedIdeas,targetStatus,cleanWatchlist};
});
