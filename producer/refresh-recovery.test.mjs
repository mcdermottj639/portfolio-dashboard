import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deriveIncrementalOrders } from './order-incremental.mjs';
import { mergeDecisions } from './maindecisions.mjs';
import { mainOrderPlan } from './main-order-plan.mjs';
import { localScreen, rsi } from './picks-local.mjs';
import { refreshCheck, needsResearchRefresh } from './refresh-check.mjs';
const order=(id,day,shares=2)=>({id,created_at:day+'T16:00:00Z',last_transaction_at:day+'T16:00:00Z',state:'filled',symbol:'AAA',side:'buy',cumulative_quantity:String(shares),average_price:'10'});
const input=(rows,next=null)=>({mode:'incremental',createdAtGte:'2026-10-01',payload:{data:{orders:rows,next}}});
const opts={asOfDay:'2026-10-08'};
const old={id:'2026-08-01-sd',date:'2026-08-01',source:'orders',trades:[{sym:'AAA',side:'BUY',shares:100}]};
test('recent/empty fetch never sweeps existing history; repeated overlap is idempotent',()=>{
  const r=deriveIncrementalOrders(input([order('a','2026-10-07')]),{...opts,prior:[old]});
  const merged=mergeDecisions(r.decisions,[old],r);
  assert.equal(merged.length,2);assert.deepEqual(merged.at(-1),old);
  assert.deepEqual(mergeDecisions(r.decisions,merged,r),merged);
  const empty=deriveIncrementalOrders(input([]),{...opts,prior:merged});
  assert.deepEqual(mergeDecisions(empty.decisions,merged,empty),merged);
});
test('old GTC fill missing from recent creation window cannot shrink an existing day',()=>{
  const prior=[{...old,id:'2026-10-07-sd',date:'2026-10-07'}];
  const r=deriveIncrementalOrders(input([order('a','2026-10-07')]),{...opts,prior});
  assert.equal(r.status,'partial');assert.deepEqual(r.blocked,['2026-10-07']);
  assert.deepEqual(mergeDecisions(r.decisions,prior,r),prior);
});
test('truncation protects boundary; duplicates dedupe; malformed input rejected',()=>{
  const a=order('a','2026-10-07'),b=order('b','2026-10-06');
  const r=deriveIncrementalOrders(input([a,a,b],'next'),opts);
  assert.equal(r.orders,2);assert.equal(r.decisions.length,1);assert.equal(r.windowFrom,null);
  assert.throws(()=>deriveIncrementalOrders(input([a,{...a,average_price:'20'}]),opts));
  assert.throws(()=>deriveIncrementalOrders(input([order('old','2026-09-01')]),opts));
  assert.throws(()=>deriveIncrementalOrders({...input([]),createdAtGte:'2026-02-30'},opts));
});
test('order planner overlaps recent history and expands after downtime',()=>{
  const now=new Date('2026-10-08T15:00:00Z');
  assert.equal(mainOrderPlan(null,now).createdAtGte,'2026-09-24');
  assert.equal(mainOrderPlan({main:{orderHistoryRefresh:{lastIncrementalAt:'2026-09-01T15:00:00Z'}}},now).createdAtGte,'2026-08-30');
});
const bars=Array.from({length:40},(_,i)=>({t:new Date(Date.UTC(2026,8,1+i)).toISOString(),c:100-i}));
const now=new Date('2026-10-11T03:00:00Z');
const inputs={bars:{AAA:bars,SPY:bars},quotes:{AAA:{last_trade_price:'61',previous_close:'62'}},funds:{AAA:{market_cap:'20000000000'}}};
test('local screen computes RSI from complete bars, market cap filter, and limited provenance',()=>{
  const s=localScreen(inputs,now,['AAA']);
  assert.deepEqual(s.missing,{fundamentals:[],quotes:[],historicals:[],rsi:[]});
  assert.equal(s.data.result.results.length,1);assert.equal(s.screen.universeSize,1);
  assert.equal(rsi(Array(40).fill(5)),50);assert.equal(rsi(Array.from({length:40},(_,i)=>i+1)),100);
  assert.equal(localScreen({...inputs,funds:{AAA:{market_cap:1e9}}},now,['AAA']).data.result.results.length,0);
});
test('local screen demands missing/stale bars and current fundamentals instead of fabricating',()=>{
  const s=localScreen({...inputs,bars:{...inputs.bars,AAA:bars.slice(0,-1)},funds:{}},now,['AAA']);
  assert.deepEqual(s.missing.rsi,['AAA']);assert.deepEqual(s.missing.historicals,[]);assert.deepEqual(s.missing.fundamentals,['AAA']);
  const stale=localScreen({...inputs,bars:{AAA:bars,SPY:bars.slice(0,-10)}},now,['AAA']);
  assert.deepEqual(stale.missing.historicals,['SPY']);assert.equal(stale.data.result.results.length,0);
});
test('local screen takes broker RSI for names without fresh bars (10 per call, not 3 months each)',()=>{
  const ref=bars.at(-1).t.slice(0,10);
  const pt=(day,value)=>({begins_at:day+'T00:00:00Z',value});
  const base={...inputs,bars:{SPY:bars},quotes:{...inputs.quotes,BBB:{last_trade_price:'50'},CCC:{last_trade_price:'50'}},
    funds:{...inputs.funds,BBB:{market_cap:'2e10'},CCC:{market_cap:'2e10'}}};
  const s=localScreen({...base,rsi:{AAA:[pt('2026-09-01',60),pt(ref,30)],BBB:[pt(ref,70)],CCC:[pt('2026-09-20',20)]}},now,['AAA','BBB','CCC']);
  assert.deepEqual(s.data.result.results.map(r=>[r.ticker,r.columns.RSI]),[['AAA',30]]);
  assert.deepEqual(s.missing.rsi,['CCC']);assert.equal(s.screen.rsiFromBroker,2);
  const live=localScreen({...base,rsi:{AAA:[pt('2026-10-10',10)]}},new Date('2026-10-10T15:00:00Z'),['AAA']);
  assert.deepEqual(live.missing.rsi,['AAA'],'an in-progress session bar never counts');
  const fresh=localScreen({...inputs,rsi:{AAA:[pt(ref,99)]}},now,['AAA']);
  assert.equal(fresh.screen.rsiFromBroker,0,'fresh local bars win');
});
test('full refresh names skipped fundamentals and live premiums despite valid JSON files',()=>{
  const status=refreshCheck({files:['scan.json','picks.json'],positions:[{symbol:'AAA',quantity:'2'}],quotes:inputs.quotes,funds:{}});
  assert.equal(status.status,'partial');assert(status.missing.some(s=>s.includes('AAA')));
  assert(status.missing.some(s=>s.includes('premiums')));
});

test('preflight repairs old snapshots and retries missing research once without an infinite full-fetch loop',()=>{
 const now=new Date('2026-10-08T15:00:00Z');
 const base={generatedAt:now.toISOString()};
 assert.equal(needsResearchRefresh(base,now),true);
 const quality={full:true,fullAttempts:1,missing:['daily-picks: missing']};
 assert.equal(needsResearchRefresh({...base,refreshInputs:quality},now),true);
 assert.equal(needsResearchRefresh({...base,refreshInputs:{...quality,fullAttempts:2}},now),false);
 assert.equal(needsResearchRefresh({...base,refreshInputs:{...quality,missing:[]}},now),false);
 // v252: a held name with no usable daily bars after a FULL run earns the same single retry.
 assert.equal(needsResearchRefresh({...base,refreshInputs:{full:true,fullAttempts:1,missing:['holdings-history: DXCM']}},now),true);
 assert.equal(needsResearchRefresh({...base,refreshInputs:{full:true,fullAttempts:2,missing:['holdings-history: DXCM']}},now),false);
 assert.equal(needsResearchRefresh({...base,refreshInputs:{full:false,fullAttempts:0,missing:['holdings-history: DXCM']}},now),false);
});
test('loadInputs reads saved RSI indicator calls (picks-screen-rsi-N.json, MCP shape)',async()=>{
  const { mkdtempSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os'); const { join } = await import('node:path');
  const { loadInputs } = await import('./refresh-inputs.mjs');
  const dir=mkdtempSync(join(tmpdir(),'rsi-'));
  writeFileSync(join(dir,'picks-screen-rsi-1.json'),JSON.stringify({data:{results:[
    {symbol:'MSFT',interval:'day',bounds:'regular',indicators:[{type:'rsi',params:{period:14},series:[{begins_at:'2026-11-19T00:00:00Z',value:42.9}]}]},
    {symbol:'WEEK',interval:'week',indicators:[{type:'rsi',params:{period:14},series:[{begins_at:'2026-11-16T00:00:00Z',value:10}]}]}]}}));
  const got=loadInputs(dir,{});
  assert.deepEqual(Object.keys(got.rsi),['MSFT']);assert.equal(got.rsi.MSFT[0].value,42.9);
});
