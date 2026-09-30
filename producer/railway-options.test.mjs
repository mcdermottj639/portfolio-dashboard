import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {optionHistory} from './option-history.mjs';
const code=String.raw`
import ast, json, sys, types
from pathlib import Path
source=ast.parse(Path('producer/railway/fetch_rh.py').read_text())
selected=[n for n in source.body if isinstance(n,ast.FunctionDef) and n.name in ['_opt_id','fetch_options']]
helper=types.ModuleType('robin_stocks.robinhood.helper')
calls=[]
def request_get(url):
    calls.append(url)
    return {'type':'call','strike_price':'50','expiration_date':'2026-09-25'}
helper.request_get=request_get
sys.modules['robin_stocks.robinhood.helper']=helper
saved={}
ns={'log':lambda _:None,'write_raw':lambda name,data:saved.update({name:data}),'_num':lambda x:float(x) if x is not None else None}
exec(compile(ast.Module(body=selected,type_ignores=[]),'<test>','exec'),ns)
def order(id,effect,side,premium,date):
    return {'id':id,'state':'filled','quantity':'1','processed_premium':str(premium),'direction':'credit' if side=='sell' else 'debit','chain_symbol':'TEST','last_transaction_at':date,'legs':[{'option':'https://api.example/options/test-id/','side':side,'position_effect':effect}]}
rh=types.SimpleNamespace(get_all_option_orders=lambda:[order('open','open','sell',200,'2026-09-01'),order('close','close','buy',50,'2026-09-20')],get_open_option_positions=lambda:[])
ns['fetch_options'](rh)
assert len(calls)==1, 'historical contract metadata should be cached per instrument'
print(json.dumps(saved['options-orders.json']['data']['orders']))
`;
const r=spawnSync('python3',['-c',code],{encoding:'utf8'});
assert.equal(r.status,0,r.stderr);
const orders=JSON.parse(r.stdout);
const h=optionHistory(orders,null,'2026-09-30');
assert.equal(h.orders.length,2,'Railway keeps the order identifiers required by the ledger');
assert.equal(h.trades.length,1);assert.equal(h.trades[0].net,150);
assert.equal(h.trades[0].strike,50);assert.equal(h.trades[0].expiration,'2026-09-25');
console.log('Railway normalization → contract history passed');
