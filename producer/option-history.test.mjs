import assert from 'node:assert/strict';
import {optionHistory} from './option-history.mjs';
const asOf='2026-09-30T12:00:00Z';
const order=(id,contract,effect,side,quantity,premium,date)=>({id,state:'filled',chain_symbol:'TEST',quantity,processed_premium:premium,direction:side==='sell'?'credit':'debit',last_transaction_at:date,legs:[{option_id:contract,option_type:'call',strike_price:'50',expiration_date:'2026-10-16',position_effect:effect,side}]});
const a=order('a','old','open','sell',2,400,'2026-09-01');
const b=order('b','old','close','buy',1,50,'2026-09-05');
const c=order('c','new','open','sell',1,900,'2026-09-06');
let h=optionHistory([a,b,c],null,asOf);
assert.equal(h.trades[0].net,150,'open contract on same stock must not inflate closed P&L');
assert.equal(h.trades[0].opening,200,'partial close allocates only matched opening cost');
assert.equal(h.premiumYTD,1300);
assert.deepEqual(optionHistory([a,b,c],h,asOf),h,'repeated refresh is idempotent');
assert.deepEqual(optionHistory([],h,asOf),h,'missing fetch retains ledger');
const d=order('d','old','close','buy',1,75,'2026-09-07');
h=optionHistory([d],h,asOf);
assert.equal(h.trades[0].net,125,'rolling window keeps original opening basis');
assert.equal(h.trades.length,2);
assert.equal(optionHistory([b],null,asOf).trades[0].net,null,'unknown basis never becomes a gain');
const long=optionHistory([order('x','long','open','buy',1,100,'2026-09-01'),order('y','long','close','sell',1,40,'2026-09-02')],null,asOf);
assert.equal(long.trades[0].net,-60);assert.equal(long.premiumYTD,null);
assert.equal(optionHistory([a],null,'2027-01-01').trades.length,0,'passing expiry never implies worthless settlement');
assert.equal(optionHistory([a],null,'2027-01-01').premiumYTD,null);
assert.equal(optionHistory([{...a,legs:[...a.legs,...a.legs]}],null,asOf).unresolved,1);
assert.equal(optionHistory([{...a,processed_premium:null}],null,asOf).unresolved,1);
console.log('Option history tests passed');
// Settlement history is essential for premium sellers who let contracts expire.
const expiredOrder={...order('expiry-open','expiry','open','sell',2,400,'2026-09-01'),legs:[{...a.legs[0],option_id:'expiry',expiration_date:'2026-09-18'}]};
const event={id:'expiry-event',option_id:'expiry',type:'expiration',state:'confirmed',quantity:'2',event_date:'2026-09-18',total_cash_amount:'0.00',equity_components:[]};
let settled=optionHistory([expiredOrder],null,asOf,[event]);
assert.equal(settled.trades[0].net,400);
assert.equal(settled.trades[0].status,'Expired');
assert.equal(settled.awaitingSettlement.length,0);
assert.deepEqual(optionHistory([expiredOrder],settled,asOf,[event,event]),settled,'repeat event fetch cannot double count');
assert.deepEqual(optionHistory([],settled,asOf),settled,'missing event fetch retains confirmed settlements');
const missing=optionHistory([expiredOrder],null,asOf);
assert.equal(missing.trades.length,0);
assert.equal(missing.awaitingSettlement[0].opening,400);
assert.equal(missing.awaitingSettlement[0].net,null,'past expiry without evidence is not profit');
for (const patch of [{state:'pending'},{total_cash_amount:null},{total_cash_amount:'100'},{equity_components:[{quantity:'200'}]}]) {
  const result=optionHistory([expiredOrder],null,asOf,[{...event,...patch}]);
  assert(!result.trades.some(t=>t.net!==null),'incomplete or cash/equity settlement cannot invent a gain');
}
const assigned=optionHistory([expiredOrder],null,asOf,[{...event,type:'assignment',total_cash_amount:'10000',equity_components:[{quantity:'200'}]}]);
assert.equal(assigned.trades[0].net,null,'assignment stock proceeds never become option earnings');
assert.equal(assigned.trades[0].opening,400);
const partialClose=order('expiry-buyback','expiry','close','buy',1,50,'2026-09-10');
settled=optionHistory([expiredOrder,partialClose],null,asOf,[{...event,quantity:1}]);
assert.equal(settled.trades.reduce((sum,t)=>sum+t.net,0),350,'buyback and remaining expiration allocate basis exactly once');
const longExpired={...expiredOrder,legs:[{...expiredOrder.legs[0],side:'buy'}]};
assert.equal(optionHistory([longExpired],null,asOf,[event]).trades[0].net,-400);
console.log('Expiration, assignment, missing settlements and retention tests passed');
// Broker P&L expiry rows (the only settlement evidence the Robinhood connector exposes) — live shapes.
{
  const open=(id,contract,sym,strike,exp,qty,prem,date)=>({id,state:'filled',chain_symbol:sym,quantity:String(qty),processed_premium:String(prem),direction:'credit',created_at:date,updated_at:date,opening_strategy:'short_call',legs:[{option_id:contract,option_type:'call',strike_price:strike,expiration_date:exp,side:'sell',position_effect:'open'}]});
  const orders=[open('o1','c-iren70','IREN','70.0000','2026-07-17',1,350,'2026-06-22T13:30:17Z'),
    open('o2','c-cifr30','CIFR','30.0000','2026-07-17',1,200,'2026-06-24T13:30:07Z'),
    open('o3','c-iren50','IREN','50.0000','2026-09-11',3,876,'2026-08-14T13:30:12Z')];
  const pnl=[{timestamp:'2026-09-16T23:30:57Z',symbol:'IREN',side:'sell',quantity:'50',price:'43.4808',realized_gain:'-52.68'},
    {timestamp:'2026-09-11T20:00:00Z',symbol:'IREN',side:'',quantity:'3',price:'0',realized_gain:'876'},
    {timestamp:'2026-09-11T03:59:50Z',symbol:'',side:'',quantity:'1766',price:'0',realized_gain:'-220.75'},
    {timestamp:'2026-07-17T20:00:00Z',symbol:'CIFR',side:'',quantity:'1',price:'0',realized_gain:'200'},
    {timestamp:'2026-07-17T20:00:00Z',symbol:'IREN',side:'',quantity:'1',price:'0',realized_gain:'350'},
    {timestamp:'2026-02-19T21:00:00Z',symbol:'MSFT',side:'',quantity:'0.025372',price:'398.47',realized_gain:'-2.01'}];
  const h=optionHistory(orders,null,asOf,[],{pnlTrades:pnl});
  assert.equal(h.awaitingSettlement.length,0,'all three expirations confirmed from broker rows');
  assert.equal(h.unresolved,0);
  assert.equal(h.trades.filter(t=>t.date.startsWith('2026')).reduce((s,t)=>s+t.net,0),1426,'matches broker options YTD');
  assert(h.trades.every(t=>t.status==='Expired'));
  assert.equal(h.events.length,3,'matched rows are stored as confirmed events');
  assert.deepEqual(optionHistory(orders,h,asOf,[],{pnlTrades:pnl}),h,'re-delivered rows cannot double count');
  assert.deepEqual(optionHistory([],h,asOf,[],{pnlTrades:[]}),h,'history survives once rows leave the 3-month window');
  // Mismatched amount, quantity, or an equity trade at the strike (assignment) → never an expiry.
  for (const bad of [{realized_gain:'870'},{quantity:'2'}]) {
    const r=optionHistory(orders,null,asOf,[],{pnlTrades:[{...pnl[1],...bad}]});
    assert(r.awaitingSettlement.some(t=>t.symbol==='IREN'&&t.strike===50),'unreconciled row leaves contract awaiting evidence');
    assert.equal(r.unresolved,1);
  }
  const assigned=optionHistory(orders,null,asOf,[],{pnlTrades:[pnl[1],{timestamp:'2026-09-11T20:00:00Z',symbol:'IREN',side:'sell',quantity:'300',price:'50',realized_gain:'100'}]});
  assert(assigned.awaitingSettlement.some(t=>t.strike===50),'equity sale at the strike blocks the expiry reading');
  // Two contracts on one underlying/expiry: only the one that reconciles exactly is matched.
  const twin=[...orders,open('o4','c-iren55','IREN','55.0000','2026-09-11',2,400,'2026-08-15T13:30:00Z')];
  const t2=optionHistory(twin,null,asOf,[],{pnlTrades:[pnl[1]]});
  assert.equal(t2.awaitingSettlement.filter(t=>t.expiration==='2026-09-11').map(t=>t.strike).join(),'55');
  // Full-backfill marker is recorded once and carried forward.
  const f=optionHistory(orders,null,asOf,[],{fullHistory:true});
  assert.equal(f.fullHistoryAt,asOf);
  assert.equal(optionHistory([],f,'2026-10-01T00:00:00Z').fullHistoryAt,asOf);
  assert.equal(h.fullHistoryAt,null);
}
console.log('Broker P&L expiry evidence tests passed');
