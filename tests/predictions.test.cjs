const {test}=require('node:test');
const assert=require('node:assert/strict');
const M=require('../ui/predictions-model.js');
const now=Date.parse('2026-10-06T21:00:00Z');
const fresh=new Date(now).toISOString(),future=new Date(now+86400000).toISOString();
const market=(extra={})=>({id:'NFL-A-YES',eventId:'NFL-A',series:'NFL',category:'Sports',group:'NFL',title:'A wins',rules:'A must win the scheduled game.',asOf:fresh,closesAt:future,status:'active',yesBid:.48,yesAsk:.51,noAsk:.52,spread:.03,volume24h:1000,last:.5,previous:.45,sourceUrl:'https://kalshi.com/markets/nfl',...extra});
test('quotes: unknown is not zero; crossed, absent, stale and expired markets cannot qualify',()=>{
  for(const v of [null,undefined,'',false,[],{},'   ','unknown',Infinity])assert.equal(M.number(v),null);
  assert.equal(M.price('0'),0);assert.equal(M.price(1.01),null);
  assert.ok(M.eligible(market(),now));
  for(const patch of [{asOf:new Date(now-46*60000).toISOString()},{asOf:new Date(now+2*60000).toISOString()},{yesAsk:null},{yesAsk:0},{yesBid:0},{spread:null},{spread:.09},{volume24h:99},{isCombo:true},{rules:''},{closesAt:fresh},{status:'settled'}])assert.equal(M.eligible(market(patch),now),false,JSON.stringify(patch));
  const normalized=M.normalizeMarket({ticker:'X',event_ticker:'E',yes_bid_dollars:'.6',yes_ask_dollars:'.5'}, {ticker:'S'},fresh);
  assert.equal(normalized.spread,null);assert.equal(normalized.noAsk,null);assert.equal(normalized.volume24h,null);
});
test('selection diversifies events and never replaces a saved reference with its opposite outcome',()=>{
  const rows=Array.from({length:10},(_,i)=>market({id:'M'+i,eventId:'E'+i,category:i<5?'Sports':'Economics',group:'Topic'+i}));
  rows.push({...rows[0],id:'M0-OPPOSITE',volume24h:100000});
  const selected=M.selectIdeas(rows,now);assert.equal(selected.length,8);assert.equal(new Set(selected.map(m=>m.eventId)).size,8);assert.equal(selected.filter(m=>m.category==='Economics').length,4);
  const prior=M.publishedIdeas([], [rows[0]],now);
  assert.equal(M.selectIdeas([rows[0],rows.at(-1)],now,8,prior)[0].id,'M0');
  assert.equal(M.selectIdeas([{...rows[0],yesAsk:null},rows.at(-1)],now,8,prior).length,0);
});
test('research record keeps original price/reason/date and requires explicit settlement, including partial payouts',()=>{
  const first=M.publishedIdeas([], [market()],now);const original=structuredClone(first);
  const moved=M.publishedIdeas(first,[market({yesAsk:.7,title:'Renamed',last:.7})],now+60000);
  assert.deepEqual(moved,original);assert.deepEqual(first,original);
  for(const patch of [{status:'closed',settlementValue:1},{status:'settled',settlementValue:null}])assert.equal(M.publishedIdeas(first,[market(patch)],now)[0].settledAt,undefined);
  const result=M.publishedIdeas(first,[market({status:'finalized',result:'scalar',settlementValue:.5,settledAt:fresh})],now)[0];
  assert.equal(result.grossChange,-.01);assert.equal(result.entryAsk,.51);assert.equal(result.settlementValue,.5);
  assert.deepEqual(M.publishedIdeas([result],[market({status:'finalized',settlementValue:1})],now),[result]);
});
test('target checks require an unexpired fresh side-specific ask, without fabricating price',()=>{
  assert.equal(M.targetStatus(market(),.51,'yes',now),'reached');
  assert.equal(M.targetStatus(market(),.51,'no',now),'watching');
  assert.equal(M.targetStatus(market(),null,'yes',now),'unset');
  assert.equal(M.targetStatus(market({asOf:new Date(now-3600000).toISOString()}),.9,'yes',now),'stale');
  assert.equal(M.targetStatus(market({closesAt:fresh}),.9,'yes',now),'closed');
  assert.equal(M.targetStatus(market({yesAsk:null}),.9,'yes',now),'no_quote');
  assert.equal(M.targetStatus(market({closesAt:null}),.9,'yes',now),'no_quote');
});
test('watch imports preserve intent but cannot smuggle live quotes or unsafe links into target checks',()=>{
  const saved={id:'NFL-A-YES',side:'no',target:.45,addedAt:fresh,market:market({robinhood:{url:'javascript:alert(1)'}})};
  const imported=M.cleanWatchlist([saved],true)[0];assert.equal(imported.target,.45);assert.equal(imported.side,'no');assert.equal(imported.market.yesAsk,null);assert.equal(imported.market.asOf,null);assert.equal(imported.market.robinhood,undefined);
  assert.equal(M.targetStatus(imported.market,imported.target,imported.side,now),'stale');
  const stored=M.cleanWatchlist([saved])[0];assert.equal(stored.market.asOf,fresh);assert.equal(stored.market.yesAsk,.51);
  assert.throws(()=>M.cleanWatchlist([{...saved,target:2}]));assert.throws(()=>M.cleanWatchlist([{...saved,market:null}]));assert.throws(()=>M.cleanWatchlist([null]));
  assert.equal(M.safeUrl('https://kalshi.com.attacker.example/'),null);assert.equal(M.safeUrl('http://robinhood.com'),null);
});
test('service worker keeps public JSON network-first, including raw GitHub, with honest offline fallback',async()=>{
  const vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
  const handlers={},stored=new Map();let offline=false,fetches=0;
  const context={URL,Response,Promise,self:{location:{origin:'https://dashboard.example'},addEventListener:(k,fn)=>handlers[k]=fn},caches:{open:async()=>({put:async(req,res)=>stored.set(req.url,res),add:async()=>{}}),match:async req=>stored.get(req.url)?.clone()},fetch:async()=>{fetches++;if(offline)throw Error('offline');return Response.json({generatedAt:fresh});}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../sw.js'),'utf8'),context);
  for(const url of ['https://dashboard.example/data/predictions.json','https://raw.githubusercontent.com/mcdermottj639/portfolio-dashboard/main/data/predictions.json']){
    const req={method:'GET',mode:'cors',url};let result;
    const request=()=>{handlers.fetch({request:req,respondWith:p=>result=p});return result;};
    offline=false;assert.equal((await (await request()).json()).generatedAt,fresh);
    const before=fetches;await request();assert.equal(fetches,before+1,'each request tries the network even with a cache');
    offline=true;assert.equal((await (await request()).json()).generatedAt,fresh,'cached timestamp preserved');
    stored.clear();const missing=await request();assert.equal(missing.status,503);assert.deepEqual(await missing.json(),{error:'offline'});
  }
});

test('broad categories and topic caps prevent CPI flooding while permitting long election horizons',()=>{
  const rows=Array.from({length:12},(_,i)=>market({id:'C'+i,eventId:'C'+i,category:'Economics',group:i%2?'Core inflation':'Inflation',volume24h:100000}));
  for(const category of ['Elections','Climate','Commodities','Crypto','Financials','Technology'])rows.push(market({id:category,eventId:category,category,group:category,closesAt:new Date(now+180*86400000).toISOString()}));
  const chosen=M.selectIdeas(rows,now);assert.equal(chosen.length,8);assert.equal(chosen.filter(m=>m.category==='Economics').length,2);assert.ok(chosen.some(m=>m.category==='Elections'));
  assert.ok(M.eligible(market({category:'Elections',closesAt:new Date(now+700*86400000).toISOString()}),now));
  assert.equal(M.eligible(market({category:'Sports',closesAt:new Date(now+30*86400000).toISOString()}),now),false);
});
