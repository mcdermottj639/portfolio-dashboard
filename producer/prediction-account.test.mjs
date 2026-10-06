import {test} from 'node:test';
import assert from 'node:assert/strict';
import {normalizePredictionAccount as normalize} from './prediction-account.mjs';
const at='2026-10-06T21:00:00Z';
const position={assetClass:'event_contract',contractId:'C1',name:'A wins',side:'yes',quantity:10,averagePrice:.4,marketValue:5,costBasis:4,feesPaid:.1};
const trade={assetClass:'event_contract',id:'T1',contractId:'C1',name:'A wins',at,type:'settlement',quantity:10,price:1,fees:.1,realizedNet:5.9};
const raw=(extra={})=>({schemaVersion:1,source:'robinhood',asOf:at,historyStart:'2026-01-01',historyComplete:true,coverage:{balance:true,positions:true,transactions:true,fees:true},balance:{value:105,availableCash:100},positions:[position],transactions:[trade],...extra});
test('requires explicit provenance and identity; blank-symbol derivatives/futures never become Predict positions',()=>{
  assert.equal(normalize({}),null);assert.equal(normalize(raw({source:'legacy'})),null);
  for(const p of [{...position,assetClass:'future'},{...position,assetClass:undefined,symbol:''},{...position,quantity:null},{...position,quantity:-1},{...position,averagePrice:2}]){
    const result=normalize(raw({positions:[p]}));assert.equal(result.positions.length,0);assert.equal(result.coverage.positions,false);assert.equal(result.realizedNet,null);
  }
});
test('broker transaction IDs preserve distinct equal-valued settlements and detect conflicts',()=>{
  const separate={...trade,id:'T2',contractId:'C2'};
  const result=normalize(raw({transactions:[trade,trade,separate]}));assert.equal(result.transactions.length,2);assert.equal(result.realizedNet,11.8);
  const conflict=normalize(raw({transactions:[trade,{...trade,realizedNet:2}]}));assert.equal(conflict.realizedNet,null);assert.equal(conflict.coverage.transactions,false);assert.ok(conflict.issues.length);
});
test('net account profit needs full history, fees and explicit broker net values; missing never becomes zero',()=>{
  assert.equal(normalize(raw()).realizedNet,5.9);
  for(const extra of [{historyComplete:false},{historyStart:null},{coverage:{transactions:true,fees:false}},{transactions:[{...trade,fees:null}]},{transactions:[{...trade,fees:-1}]},{transactions:[{...trade,realizedNet:null}]},{transactions:[{...trade,quantity:null}]}]){
    const result=normalize(raw(extra));assert.equal(result.realizedNet,null);assert.equal(result.coverage.transactions,false);
  }
  assert.equal(normalize(raw({transactions:[]})).realizedNet,0);
  assert.equal(normalize(raw({balance:{value:null,availableCash:null}})).balance.value,null);
  assert.equal(normalize(raw({coverage:{}})).balance,null);
});
