// Integration regression: the next incremental producer run must keep older live contracts.
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, copyFileSync, readdirSync, writeFileSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {encryptEnvelope} from './emit.mjs';
import {optionHistory} from './option-history.mjs';
const source = dirname(fileURLToPath(import.meta.url));
const root = mkdtempSync(join(tmpdir(), 'open-option-history-'));
const producer = join(root, 'producer'), raw = join(producer, 'raw');
mkdirSync(raw, {recursive:true});
for (const f of readdirSync(source).filter(f=>f.endsWith('.mjs') && !f.endsWith('.test.mjs')))
  copyFileSync(join(source,f),join(producer,f));
const pass = 'synthetic-test-only';
const write = (f,v)=>writeFileSync(join(raw,f),JSON.stringify(v));
const order = (id,symbol,side='sell',effect='open',qty='2',contract=id)=>({id,chain_symbol:symbol,
  state:'filled',quantity:qty,direction:side==='sell'?'credit':'debit',processed_premium:'400',
  created_at:'2026-08-01T15:00:00Z',legs:[{option_id:contract,side,position_effect:effect,
    option_type:'call',strike_price:'200',expiration_date:'2027-01-15'}]});
const old = order('pltr-open','PLTR');
const recent = order('iren-open','IREN');
const pos = (id,symbol,qty='2',type='short')=>({option_id:id,chain_symbol:symbol,quantity:qty,type,average_price:'-200'});
const run = ()=>spawnSync(process.execPath,[join(producer,'options-build.mjs')],
  {cwd:root,encoding:'utf8',env:{...process.env,PF_PASSPHRASE:pass}});
const read = ()=>JSON.parse(readFileSync(join(raw,'options.json'),'utf8'));
const snapshot = async options=>writeFileSync(join(root,'data.json'),JSON.stringify(await encryptEnvelope(JSON.stringify({options}),pass)));
try {
  await snapshot({incomeHistory:optionHistory([old,order('closed-old','OLD')],null,'2026-09-30')});
  write('options-orders.json',{data:{orders:[recent]}});
  write('options-positions.json',{data:{positions:[pos('pltr-open','PLTR'),pos('iren-open','IREN'),pos('closed-old','OLD','0')]}});
  write('positions.json',{positions:[{symbol:'PLTR',quantity:'200',average_buy_price:'150'},{symbol:'IREN',quantity:'200',average_buy_price:'150'}]});
  write('quotes.json',{results:[{symbol:'PLTR',last_trade_price:'180'},{symbol:'IREN',last_trade_price:'180'}]});
  write('option-pos-quotes.json',{results:[{quote:{instrument_id:'pltr-open',mark_price:'1',delta:'.25'}}]});
  let result=run(); assert.equal(result.status,0,result.stderr);
  let out=read(); assert.deepEqual(out.positions.map(p=>p.underlying),['PLTR','IREN']);
  const pltr=out.positions[0];
  assert.equal(pltr.strike,200); assert.equal(pltr.contracts,2); assert.equal(pltr.side,'short');
  assert.equal(pltr.premium,400); assert.equal(pltr.pnl,200); assert.equal(pltr.covered,true);
  assert.equal(out.exposure.sharesCapped,400); assert.equal(out.incomeHistory.orders.length,3);
  // Another fresh-clone run with no new orders retains both contracts and their ledger.
  await snapshot(out); write('options-orders.json',{data:{orders:[]}});
  result=run(); assert.equal(result.status,0,result.stderr); out=read(); assert.equal(out.positions.length,2);
  // A partial close changes only live quantity, never the direction of the surviving position.
  write('options-orders.json',{data:{orders:[order('partial-close','PLTR','buy','close','1','pltr-open')]}});
  write('options-positions.json',{positions:[pos('pltr-open','PLTR','1')]});
  result=run(); assert.equal(result.status,0,result.stderr); out=read();
  assert.equal(out.positions.length,1); assert.equal(out.positions[0].contracts,1);
  assert.equal(out.positions[0].side,'short'); assert.equal(out.positions[0].premium,200);
  // Position direction beats stale order direction; long residual positions stay long.
  write('options-positions.json',{positions:[pos('pltr-open','PLTR','1','long')]});
  result=run(); assert.equal(result.status,0,result.stderr); assert.equal(read().positions[0].side,'long');
  // Without explicit position type, opening metadata still beats a later closing order.
  const untyped=pos('pltr-open','PLTR','1'); delete untyped.type;
  write('options-positions.json',{positions:[untyped]});
  result=run(); assert.equal(result.status,0,result.stderr); assert.equal(read().positions[0].side,'short');
  // If only a close is available, infer the surviving position's opposite side.
  await snapshot({incomeHistory:{orders:[]}});
  result=run(); assert.equal(result.status,0,result.stderr); assert.equal(read().positions[0].side,'short');
  // Unknown metadata cannot silently replace a complete options snapshot with a partial one.
  const before=readFileSync(join(raw,'options.json'),'utf8');
  write('options-positions.json',{positions:[pos('unknown-contract','PLTR','1')]});
  result=run(); assert.notEqual(result.status,0); assert.match(result.stderr,/FULL option-order fetch/);
  assert.equal(readFileSync(join(raw,'options.json'),'utf8'),before);
  // Saved orders alone never resurrect contracts the broker has closed.
  write('options-positions.json',{positions:[]});
  result=run(); assert.equal(result.status,0,result.stderr); assert.deepEqual(read().positions,[]);
  console.log('Open option history integration passed: encrypted incremental runs, quantities, side, live P&L, collateral, closure, missing metadata');
} finally { rmSync(root,{recursive:true,force:true}); }
