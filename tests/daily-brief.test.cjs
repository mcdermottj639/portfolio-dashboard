const assert = require('node:assert/strict');
const M = require('../ui/experience-model.js');
const now = Date.parse('2026-10-03T00:30:00Z'); // Friday evening in New York, Saturday UTC.
const data = {
  generatedAt:'2026-10-02T23:30:00Z',
  main:{equity:800,cash:-200,asOf:'2026-10-02T23:30:00Z',positions:[{symbol:'A',qty:10,px:100}],
    equityHistory:[{t:'2026-09-30',equity:700},{t:'2026-10-01',equity:750},{t:'2026-10-02',equity:800}]},
  agentic:{equity:400,cash:100,asOf:'2026-10-02T23:30:00Z',positions:[{symbol:'A',qty:2,px:100,value:200},{symbol:'B',qty:1,px:100,value:100}],
    equityHistory:[{t:'2026-09-30',equity:300},{t:'2026-10-02',equity:390},{t:'2026-10-02',equity:400},{t:'2026-10-03',equity:410},{t:'2026-02-30',equity:2}],
    target:{asOf:'2026-09-28'},pending:{status:'proposed'},drawdown:{level:'soft',dd:-.1}},
  quotes:{A:{last_trade_price:'100',previous_close:'90'},B:{last_trade_price:'100'},SPY:{last_trade_price:'102',previous_close:'100'},QQQ:{last_trade_price:'99',previous_close:'100'}},
  earnings:{A:{date:'2026-10-02'},B:{date:'2026-10-08'}},
  options:{asOf:'2026-10-02T23:30:00Z',positions:[
    {underlying:'A',contracts:2,strike:110,type:'call',expiration:'2026-10-02',dte:-5,pnl:0},
    {underlying:'B',contracts:1,strike:90,type:'put',expiration:'2026-09-25',dte:50,pnl:null},
    {underlying:'C',contracts:0,expiration:'2026-10-05'},
    {underlying:'D',contracts:1,expiration:'not a date'}],
    pending:[{underlying:'E',contracts:8}],exposure:{sharesCapped:300,cspCash:500},
    incomeHistory:{version:2,trades:[{date:'2026-08-01',net:100},{date:'2024-03-01',net:-61}],awaitingSettlement:[]}},
  realized:{source:'robinhood',year:'2026 YTD',asOf:'2026-10-02',options:999,accounts:{main:{options:100},agentic:{options:899}}}
};
const main={stats:{totalVal:1800,cashVal:-200},enriched:[{symbol:'A',qty:10,px:100,val:1000,dayD:100,dayP:11.11}]};
const before=JSON.stringify({data,main});
let b=M.dailyBrief(data,main,{now});
assert.equal(b.equity,1200,'canonical brokerage equity, not total_value with external sleeves');
assert.equal(b.positiveCash,100,'cash cannot net against debt in the other account');
assert.equal(b.marginDebt,200);
assert.equal(b.positions.length,2);assert.equal(b.positionCount,3);
assert.equal(b.positions[0].value,1200);assert.equal(b.positions[0].shared,true);
assert.equal(b.positions[0].day,120);assert.equal(b.day,120);
assert.equal(b.partialDay,true);assert.equal(b.dayCoverage,2);
assert.deepEqual(b.breadth,{up:1,down:0,flat:0,missing:1});
assert.deepEqual(b.history.map(p=>[p.t,p.equity]),[['2026-09-30',1000],['2026-10-02',1200]],'only common dates, latest duplicate wins');
assert.equal(b.today,'2026-10-02');assert.equal(b.earnings[0].days,0);
assert.equal(b.options.expirations[1].days,0,'recompute expiry in ET; ignore stale persisted dte');
assert.equal(b.options.expirations[0].days,-7);
assert.equal(b.options.open.length,3,'pending orders are not filled positions');
assert.equal(b.options.openPnl,null,'unknown contract P&L cannot become zero');
assert.equal(b.options.broker,100,'self-directed broker options subtotal only');
assert.equal(b.options.reconciled,true,'past-year result excluded');
assert.equal(b.markets[0].change,2);assert.equal(b.markets[1].change,-1);assert.equal(b.markets[2].change,null);
assert.ok(b.attention.some(a=>a.title==='Agentic deployment guard is active'));
assert.ok(b.attention.some(a=>a.title==='Option outcomes need a refresh'));
assert.ok(b.attention.some(a=>a.title==='Options expire within 7 days'));
assert.equal(JSON.stringify({data,main}),before,'derived brief must not mutate snapshot or trading state');
assert.equal(M.dailyBrief(data,null,{now}).equity,1200,'both accounts render before legacy main UI initializes');
assert.equal(M.dailyBrief(data,null,{now}).day,120);
const invalidMain=structuredClone(data);invalidMain.main.equity=null;invalidMain.main.cash=null;
assert.equal(M.dailyBrief(invalidMain,main,{now}).equity,null,'invalid recorded value cannot fall back to a different equity perimeter');
assert.equal(M.dailyBrief(invalidMain,main,{now}).positiveCash,null);
for(const value of [' ',[],{},true])assert.equal(M.number(value),null);
const staleAccount=structuredClone(data);staleAccount.agentic.asOf='2026-09-01';
assert.ok(M.dailyBrief(staleAccount,main,{now}).attention.some(a=>a.title==='An account capture is older'));
const missing=structuredClone(data);delete missing.agentic;
b=M.dailyBrief(missing,main,{now});assert.equal(b.equity,null);assert.equal(b.positiveCash,null);assert.equal(b.marginDebt,null);assert.equal(b.partialDay,true);assert.deepEqual(b.history,[]);
const partial=structuredClone(data);partial.agentic.positions[0].px=null;partial.agentic.positions[0].value=null;
b=M.dailyBrief(partial,main,{now});assert.equal(b.positions.find(p=>p.symbol==='A').value,null);assert.equal(b.positions.find(p=>p.symbol==='A').partialDay,true);assert.equal(b.day,100);
assert.equal(b.breadth.missing,2,'missing quote in either account cannot look like a fully observed ticker');
const noValues=structuredClone(data);noValues.agentic.equity=null;assert.equal(M.dailyBrief(noValues,main,{now}).equity,null);
const zero=structuredClone(data);zero.agentic.equity=0;zero.agentic.cash=0;zero.agentic.positions=[];
b=M.dailyBrief(zero,main,{now});assert.equal(b.equity,800);assert.equal(b.positiveCash,0);assert.equal(b.partialDay,false);
const noPositions=structuredClone(data);delete noPositions.agentic.positions;assert.equal(M.dailyBrief(noPositions,main,{now}).partialDay,true);
const missingIncome=structuredClone(data);delete missingIncome.realized.accounts.main.options;
assert.equal(M.dailyBrief(missingIncome,main,{now}).options.broker,null,'never fall back to combined broker income or gross premiums');
const mismatch=structuredClone(data);mismatch.options.incomeHistory.trades[0].net=90;
assert.equal(M.dailyBrief(mismatch,main,{now}).options.reconciled,false);
mismatch.options.incomeHistory.trades[0].net=100;mismatch.options.incomeHistory.awaitingSettlement=[{}];
assert.equal(M.dailyBrief(mismatch,main,{now}).options.reconciled,false);
const empty=M.dailyBrief({},null,{now});assert.equal(empty.available,false);assert.equal(empty.day,null);assert.equal(empty.equity,null);assert.deepEqual(empty.positions,[]);
const previous=structuredClone(data);previous.generatedAt='2026-09-01';
assert.ok(M.dailyBrief(previous,main,{now}).attention.some(a=>a.title==='Check the snapshot date'));
assert.equal(M.easternDay(Date.parse('2026-11-01T03:30:00Z')),'2026-10-31','DST boundary respects ET date');
assert.equal(M.easternDay(Date.parse('2026-03-08T04:30:00Z')),'2026-03-07');
console.log('PASS: combined equity, shared holdings, cash/margin isolation, partial quotes, matched dates, ET events, options reconciliation and read-only behavior');
