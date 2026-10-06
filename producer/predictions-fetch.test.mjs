import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
test('collector follows pagination, exact RH symbols, historical settlement, and preserves failure timestamps',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pf-predict-test-')),out=path.join(dir,'snapshot.json');
  const run=mode=>spawnSync(process.execPath,['--import',path.join(root,'tests/predictions-fetch-fixture.mjs'),path.join(root,'producer/predictions-fetch.mjs')],{encoding:'utf8',env:{...process.env,PREDICTIONS_OUTPUT:out,PREDICTION_TEST_MODE:mode},timeout:15000});
  try{
    const first=run('success');assert.equal(first.status,0,first.stderr);let d=JSON.parse(fs.readFileSync(out));
    assert.equal(d.markets.length,2);assert.equal(d.ideas.length,2);assert.equal(d.markets.find(m=>m.id==='KXNFLGAME-FIXTURE').robinhood.name,'Fixture event');assert.equal(d.robinhoodLinks.WRONG,undefined);assert.equal(d.markets[0].history.at(-1).price,null);
    const original=structuredClone(d.ideas),old='2026-01-01T00:00:00Z';
    d.markets.forEach(m=>{m.historyAsOf=old;});
    d.markets.push({...d.markets[0],id:'KXFED-OLD',eventId:'FED-OLD',series:'KXFED',category:'Economics',asOf:old});
    d.ideas.push({...d.ideas[0],id:'liquidity-v1:ARCHIVED',marketId:'ARCHIVED',eventId:'ARCHIVED-E',entryAsk:.6});
    fs.writeFileSync(out,JSON.stringify(d));
    const partial=run('partial');assert.equal(partial.status,0,partial.stderr);d=JSON.parse(fs.readFileSync(out));
    assert.equal(d.markets.find(m=>m.id==='KXFED-OLD').asOf,old);
    assert.equal(d.markets.find(m=>m.id==='KXNFLGAME-FIXTURE').historyAsOf,old);
    assert.ok(d.coverage.some(c=>c.series==='KXFED'&&c.status==='unavailable'));
    assert.ok(d.coverage.some(c=>c.series.endsWith(' history')&&c.status==='unavailable'));
    assert.deepEqual(d.ideas.slice(0,2),original);const settled=d.ideas.find(i=>i.marketId==='ARCHIVED');assert.equal(settled.grossChange,-.1);assert.equal(settled.settlementValue,.5);
    const recovered=run('throttle');assert.equal(recovered.status,0,recovered.stderr);
    const retried=JSON.parse(fs.readFileSync(out));assert.equal(retried.coverage.filter(c=>c.status!=='ok').length,0,'transient 429 chart responses recover');
    const before=fs.readFileSync(out,'utf8');assert.notEqual(run('fail').status,0);assert.equal(fs.readFileSync(out,'utf8'),before,'total provider failure cannot overwrite the last snapshot');
    for(const key of ['balance','positions','transactions','account','watchlist'])assert.equal(d[key],undefined);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
