const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const M=require('../ui/smartmoney-model.js');

const asOf='2026-11-03';
const held={main:new Set(['NVDA','PLTR']),agentic:new Set(['GOOGL']),target:new Set(['LLY','GOOGL'])};
const flow={asOf,
  polEvents:[
    {sym:'PLTR',side:'buy',txn:'2026-10-09',disc:'2026-10-30',filer:'JANE Q MEMBER',chamber:'house',amount:'$15,001 - $50,000',lag:21},
    {sym:'PLTR',side:'buy',txn:'2026-10-09',disc:'2026-10-30',filer:'JANE Q MEMBER',chamber:'house',amount:'$15,001 - $50,000',lag:21},
    {sym:'MSFT',side:'sell',txn:'2026-09-20',disc:'2026-10-10',filer:'JANE Q MEMBER',chamber:'house',amount:'$1,001 - $15,000',lag:20},
    {sym:'XOM',side:'buy',txn:'2026-08-01',disc:'2026-10-20',filer:'JOHN SENATOR',chamber:'senate',amount:'$1,000,001 - $5,000,000'},
    {sym:'',side:'buy',txn:'2026-08-01',filer:'NO SYMBOL'},
    {sym:'AAPL',side:'exchange',txn:'2026-08-01',filer:'NO SIDE'},
    {sym:'AAPL',side:'buy',txn:'not-a-date',filer:'BAD DATE'},
  ],
  polClusters:{PLTR:{sym:'PLTR',side:'buy',filers:3,lastTxn:'2026-10-09',medianLagDays:24}},
  symbols:{
    NVDA:{sym:'NVDA',insider:{cluster:'sell',buyers:0,sellers:4,note:'cluster sell'},insiderTrades:[
      {name:'SAMPLE CFO',side:'sell',shares:12000,price:171.2,value:2054400,txn:'2026-10-25',filed:'2026-10-27'},
      {name:'SAMPLE EVP',side:'buy',shares:1500,price:158.4,value:237600,txn:'2026-10-20',filed:'2026-10-22'}]},
    LLY:{sym:'LLY',insider:{cluster:'buy',buyers:3,sellers:0,note:'CLUSTER BUY — 3 insiders in 90d'},insiderTrades:[
      {name:'A EXEC',side:'buy',shares:1000,price:800,value:800000,txn:'2026-10-28',filed:'2026-10-30'},
      {name:'B EXEC',side:'buy',shares:500,price:790,value:395000,txn:'2026-10-27',filed:'2026-10-29'}]},
    SPY:{sym:'SPY',insider:null},
  }};

test('labels: names, ranges and money are readable, never invented',()=>{
  assert.equal(M.titleCase('NANCY PELOSI'),'Nancy Pelosi');
  assert.equal(M.titleCase("o'NEILL-SMITH III"),"O'Neill-Smith III");
  assert.equal(M.bucketLabel('$1,001 - $15,000'),'$1K–$15K');
  assert.equal(M.bucketLabel('$1,000,001 - $5,000,000'),'$1M–$5M');
  assert.equal(M.bucketLabel('Over $50,000,000'),'Over $50M');
  assert.equal(M.bucketLabel(null),null);
  assert.equal(M.bucketLabel(''),null);
  assert.equal(M.compactMoney(2054400),'$2.1M');
  assert.equal(M.compactMoney(NaN),null);
});

test('feed: dedupes, drops unusable rows, tags your books, newest report first',()=>{
  const items=M.allItems(flow,held);
  const pol=items.filter(i=>i.kind==='politician');
  assert.equal(pol.length,3,'duplicate, no-symbol, no-side and bad-date rows are dropped');
  assert.deepEqual(items.map(i=>i.seen),[...items.map(i=>i.seen)].sort().reverse());
  const pltr=items.find(i=>i.sym==='PLTR');
  assert.deepEqual(pltr.mine,{main:true,agentic:false,target:false});
  assert.equal(pltr.who,'Jane Q Member');assert.equal(pltr.role,'House member');assert.equal(pltr.lag,21);assert.equal(pltr.amount,'$15K–$50K');
  const xom=items.find(i=>i.sym==='XOM');
  assert.equal(xom.mine,null);assert.equal(xom.lag,80,'lag derives from the two dates when the row lacks one');
  const lly=items.find(i=>i.sym==='LLY');
  assert.deepEqual(lly.mine,{main:false,agentic:false,target:true});assert.equal(M.mineLabel(lly.mine),'Agentic target');
  const goog=M.mineOf('GOOGL',held);assert.equal(goog.target,false,'a held agentic name is not also called a target');
  assert.equal(M.mineLabel(M.mineOf('NVDA',held)),'You hold · Self-directed');
  const ins=items.find(i=>i.kind==='insider'&&i.sym==='NVDA'&&i.side==='sell');
  assert.equal(ins.amount,'$2.1M');assert.equal(ins.lag,2);assert.equal(ins.role,'Insider at NVDA');
});

test('filters: by kind, and "mine only" keeps your names plus people you follow',()=>{
  const items=M.allItems(flow,held);
  assert.ok(M.feed(items,{kind:'insider'}).every(i=>i.kind==='insider'));
  const follow=new Set(['pol|JOHN SENATOR']);
  const mine=M.feed(items,{mineOnly:true,follow});
  assert.ok(mine.some(i=>i.sym==='XOM'),'a followed person shows even on a name you do not hold');
  assert.ok(!mine.some(i=>i.sym==='MSFT'),'MSFT is not held and its filer is not followed');
  assert.deepEqual(M.yourNames(items,asOf,30).map(n=>n.sym+':'+n.count),['LLY:2','NVDA:2','PLTR:1']);
});

test('person: stats, overlap and month bars come from the reported trades only',()=>{
  const items=M.allItems(flow,held);
  const p=M.person(items,'pol|JANE Q MEMBER',asOf,6);
  assert.equal(p.trades,2);assert.equal(p.buys,1);assert.equal(p.sells,1);
  assert.deepEqual(p.overlap,['PLTR']);
  assert.equal(p.bars.length,6);assert.equal(p.bars[5].month,'2026-11');
  assert.deepEqual(p.bars.find(b=>b.month==='2026-10'),{month:'2026-10',label:'Oct',buys:1,sells:0});
  assert.equal(M.person(items,'pol|NOBODY',asOf),null);
});

test('ticker: groups and a conservative read',()=>{
  const items=M.allItems(flow,held);
  const lly=M.ticker(items,flow,'lly',asOf);
  assert.equal(lly.insiders.buys,2);assert.equal(lly.read.title,'Insiders are buying');
  const nvda=M.ticker(items,flow,'NVDA',asOf);
  assert.equal(nvda.read.title,'Mixed or light activity');
  const pltr=M.ticker(items,flow,'PLTR',asOf);
  assert.equal(pltr.read.title,'Politicians lean buy');assert.equal(pltr.covered,false);
  const none=M.ticker(items,flow,'ZZZZ',asOf);
  assert.equal(none.read.tone,'none');
  const sellOnly=M.readOf({buys:0,sells:0},{buys:0,sells:3},{cluster:'sell'},null);
  assert.equal(sellOnly.title,'Insider selling only');
});

test('flags: cluster buys first, Congress clusters only on your names, follows flagged',()=>{
  const items=M.allItems(flow,held);
  const f=M.flags(items,flow,{asOf,follow:new Set(['pol|JANE Q MEMBER'])});
  assert.equal(f[0].tag,'Cluster buy');assert.equal(f[0].sym,'LLY');assert.equal(f[0].stats[0].value,'$1.2M');
  assert.ok(f.some(x=>x.tag==='Congress cluster'&&x.sym==='PLTR'));
  assert.ok(f.some(x=>x.tag==='Insider buy'&&x.sym==='NVDA'),'one insider buying a held name');
  assert.ok(!f.some(x=>x.tag==='Insider buy'&&x.sym==='LLY'),'no duplicate single-buy flag under a cluster');
  assert.ok(f.some(x=>x.tag==='Someone you follow'&&x.sym==='PLTR'));
  assert.equal(new Set(f.map(x=>x.id)).size,f.length);
  assert.equal(M.flags([],null,{asOf}).length,0);
});

test('decisions: local state is cleaned, snooze expires, dismiss sticks',()=>{
  const now=Date.parse('2026-11-03T15:00:00Z');
  const s=M.cleanState({follow:['a','a',5,'b'],decisions:{x:{choice:'snooze',until:'2026-11-10T00:00:00Z'},y:{choice:'dismiss'},z:{choice:'buy'}}});
  assert.deepEqual(s.follow,['a','b']);assert.deepEqual(Object.keys(s.decisions),['x','y']);
  assert.equal(M.isOpen({id:'x'},s.decisions,now),false);
  assert.equal(M.isOpen({id:'x'},s.decisions,Date.parse('2026-11-11T00:00:00Z')),true);
  assert.equal(M.isOpen({id:'y'},s.decisions,now),false);
  assert.equal(M.isOpen({id:'new'},s.decisions,now),true);
  assert.deepEqual(M.cleanState('junk'),{follow:[],decisions:{}});
});

test('research prompt is read-only and carries the evidence',()=>{
  const items=M.allItems(flow,held);
  const f=M.flags(items,flow,{asOf})[0];
  const p=M.researchPrompt('flag',f);
  assert.match(p,/read-only, nothing to trade/);assert.match(p,/LLY/);assert.match(p,/Facts with sources only/);
});

test('scorecard: board rows keep the person key and a readable name; per-trade results index by id',()=>{
  const f={perf:{trades:[{id:'pol|JANE Q MEMBER|PLTR|buy|2026-10-09',res:{ret:0.1,spy:0.02,excess:0.08,sinceTrade:null,heldDays:15}}]},
    scoreboard:[{who:'pol|JANE Q MEMBER',kind:'politician',tracked:2,scored:1,hitRate:1,avgExcess:0.08,enough:false},{who:'ins|SAM EXEC|NVDA',kind:'insider',tracked:1,scored:0,enough:false}]};
  const b=M.board(f);
  assert.equal(b[0].key,'pol|JANE Q MEMBER');assert.equal(b[0].name,'Jane Q Member');assert.equal(b[1].role,'Insider at NVDA');
  assert.equal(M.board(f,{kind:'insider'}).length,1);
  assert.equal(M.personRecord(f,'pol|JANE Q MEMBER').avgExcess,0.08);assert.equal(M.personRecord(f,'nobody'),null);
  assert.equal(M.perfIndex(f).get('pol|JANE Q MEMBER|PLTR|buy|2026-10-09').excess,0.08);
  assert.equal(M.perfIndex(null).size,0);assert.deepEqual(M.board(null),[]);
  assert.equal(M.pct(0.048),'+4.8%');assert.equal(M.pct(-0.07),'−7%');assert.equal(M.pct(null),'—');
  const items=M.allItems(flow,held);assert.ok(items.some(i=>i.id==='pol|JANE Q MEMBER|PLTR|buy|2026-10-09'),'UI ids match the producer scorecard ids');
});

test('shell: smart money assets are versioned with the app and precached',()=>{
  const root=path.resolve(__dirname,'..');
  const html=fs.readFileSync(path.join(root,'index.html'),'utf8'),sw=fs.readFileSync(path.join(root,'sw.js'),'utf8');
  const v=(html.match(/var APP_VERSION='v(\d+)'/)||[])[1];assert.ok(v);
  for(const f of ['ui/smartmoney.css','ui/smartmoney-model.js','ui/smartmoney.js']){
    assert.ok(html.includes(f+'?v='+v),f+' in index.html');assert.ok(sw.includes('./'+f+'?v='+v),f+' in sw.js');
  }
  assert.ok(sw.includes("'pf-v"+v+"'"));
  assert.match(html,/smartmoney:'page-smartmoney'/);
  assert.match(html,/id="tab-smartmoney"/);
});

// ---- v176 compact grouped feed ----
test('grouping: same person + ticker + side folds into one row with summed ranges',()=>{
  const ev=d=>({sym:'MU',side:'buy',txn:d,disc:'2026-11-02',filer:'JOHN MCGUIRE',chamber:'house',amount:'$1,001 - $15,000'});
  const f={asOf,polEvents:[ev('2026-10-01'),ev('2026-09-25'),ev('2026-09-24'),{...ev('2026-10-02'),side:'sell'}]};
  const items=M.allItems(f,{main:new Set(['MU'])});
  const g=M.groupItems(items,{by:'person'});
  assert.equal(g.length,2);
  const buy=g.find(x=>x.side==='buy');
  assert.equal(buy.count,3);
  assert.equal(buy.amount,'$3K–$45K');
  assert.equal(M.dayRange(buy.first,buy.last),'Sep 24–Oct 1');
  assert.equal(M.lagRange(buy),'32–39d late');
  assert.ok(buy.mine&&buy.mine.main);
});
test('grouping: a missing size never becomes a partial total',()=>{
  const f={asOf,polEvents:[
    {sym:'MU',side:'buy',txn:'2026-10-01',disc:'2026-11-02',filer:'A B',amount:'$1,001 - $15,000'},
    {sym:'MU',side:'buy',txn:'2026-10-02',disc:'2026-11-02',filer:'A B',amount:null}]};
  const g=M.groupItems(M.allItems(f,{}),{by:'person'});
  assert.equal(g.length,1);assert.equal(g[0].count,2);assert.equal(g[0].amount,null);
});
test('grouping by stock merges people, keeps sides apart',()=>{
  const g=M.groupItems(M.allItems(flow,held),{by:'stock'});
  const lly=g.find(x=>x.sym==='LLY'&&x.side==='buy');
  assert.equal(lly.people,2);assert.equal(lly.count,2);assert.equal(lly.amount,'$1.2M');
  assert.ok(g.some(x=>x.sym==='NVDA'&&x.side==='buy')&&g.some(x=>x.sym==='NVDA'&&x.side==='sell'));
});
test('filter chips and summary tiles',()=>{
  const items=M.allItems(flow,held);
  assert.ok(M.feed(items,{filter:'buy'}).every(i=>i.side==='buy'));
  assert.ok(M.feed(items,{filter:'sell'}).every(i=>i.side==='sell'));
  assert.ok(M.feed(items,{filter:'mine'}).every(i=>i.mine));
  assert.equal(M.feed(items,{filter:'following',follow:new Set()}).length,0);
  const s=M.summary(items,asOf,7);
  assert.equal(s.fresh,4); // LLY x2 (10-29, 10-30), NVDA sell 10-27, PLTR 10-30 (deduped)
  assert.equal(s.topBuy.sym,'LLY');
});
