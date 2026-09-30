import assert from 'node:assert/strict';
import { optionHistory } from './option-history.mjs';
import { lossesFromTrades } from './realizedpnl.mjs';

const asOf = '2026-09-30T20:00:00Z';
const expiry = {symbol:'TEST', side:'', quantity:'1', price:'0', realized_gain:'-100', timestamp:'2026-09-18T20:00:00Z'};
const order = {id:'long-open', state:'filled', chain_symbol:'TEST', quantity:'1', processed_premium:'100',
  created_at:'2026-09-01T15:00:00Z', legs:[{option_id:'test-contract', option_type:'call', strike_price:'50',
    expiration_date:'2026-09-18', side:'buy', position_effect:'open'}]};
const history = optionHistory([order], null, asOf, [], {pnlTrades:[expiry]});
assert.equal(history.trades[0].net, -100);
assert.equal(history.events.length, 1);
const stock = {...expiry, side:'sell', price:'45', realized_gain:'-40'};
const cashInLieu = {...expiry, symbol:'CASH', price:'30', quantity:'.5', realized_gain:'-30'};
const raw = {data:{trades:[expiry, stock, cashInLieu]}};
const losses = lossesFromTrades(raw, {asOf, account:'main', optionHistory:history});
assert.deepEqual(losses.map(l=>[l.sym,l.realized]), [['TEST',-40],['CASH',-30]]);
// No evidence / different account / conflicting quantity: retain the conservative block.
assert.equal(lossesFromTrades(raw,{asOf,account:'agentic'})[0].realized,-100);
assert.equal(lossesFromTrades({trades:[{...expiry,quantity:'2'}]},{asOf,optionHistory:history}).length,1);
assert.equal(lossesFromTrades({trades:[{...expiry,price:null}]},{asOf,optionHistory:history}).length,1);
// An option loss must not push a same-day sub-floor stock loss above the stock guard floor.
assert.equal(lossesFromTrades({trades:[expiry,{...stock,realized_gain:'-20'}]},{asOf,optionHistory:history}).length,0);
assert.equal(lossesFromTrades({trades:[expiry,{...stock,realized_gain:'-20'},{...stock,realized_gain:'-10'}]},
  {asOf,optionHistory:history}).length,1);
// Retained history still classifies the exact settlement after a subsequent incremental build.
const retained = optionHistory([], history, asOf, [], {pnlTrades:[expiry]});
assert.equal(lossesFromTrades({trades:[expiry]}, {asOf,optionHistory:retained}).length,0);
assert.equal(retained.trades[0].net,-100);
console.log('Confirmed option expiry vs stock wash guard regressions passed');
