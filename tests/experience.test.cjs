const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const M = require('../ui/experience-model.js');

// Missing quotes must not look like zero-return observations; margin weights are not capped.
const data={generatedAt:'2026-09-16T15:00:00Z',quotes:{A:{previous_close:90}},agentic:{equity:1000,cash:100,positions:[{symbol:'A',qty:5,px:100,value:500},{symbol:'B',qty:2,px:200,value:400}]}};
const before=JSON.stringify(data);
const ag=M.snapshot(data,null,'agentic');
assert.equal(ag.day,50); assert.equal(ag.dayCoverage,1); assert.equal(ag.partialDay,true);
assert.equal(ag.positions[1].day,null); assert.equal(ag.equity,1000);
assert.equal(JSON.stringify(data),before,'read-only model must not mutate producer state');
assert.equal(M.snapshot({},null,'agentic').equity,null);
assert.equal(M.snapshot({},null,'main').available,false);
const main=M.snapshot({}, {stats:{totalVal:500,cashVal:-500},enriched:[{symbol:'A',qty:10,px:100,val:1000,dayP:null,dayD:0}]},'main');
assert.equal(main.equity,500);assert.equal(main.cash,-500);assert.equal(main.day,null);
for(const v of [null,undefined,'',false,NaN,Infinity])assert.equal(M.number(v),null);
assert.equal(M.number(0),0);
assert.equal(M.age('invalid'),null);
assert.equal(M.age('2026-09-17',Date.parse('2026-09-16')),null);
assert.equal(M.age('2026-09-16T14:00:00Z',Date.parse('2026-09-16T15:00:00Z')),60);
// A cash shift helps on the downside and sacrifices upside; costs always reduce the shifted result.
const base={equity:25000,positionValue:11500,shiftPct:50,costBps:40};
let r=M.scenario({...base,shockPct:-10});assert.equal(r.before,-1150);assert.equal(r.after,-598);assert.equal(r.cost,23);assert.equal(r.difference,552);
r=M.scenario({...base,shockPct:10});assert.equal(r.after,552);assert.equal(r.difference,-598);
r=M.scenario({...base,shiftPct:0,shockPct:-10});assert.equal(r.difference,0);
assert.equal(M.scenario({...base,equity:0,shockPct:-10}),null);
assert.equal(M.scenario({...base,costBps:'',shockPct:-10}),null);
assert.equal(M.scenario({...base,shiftPct:101,shockPct:-10}),null);
const evidence=M.evidence({research:{evidence:{A:{quality:{evidence:[{claim:'untrusted',source:'javascript:alert(1)'},{claim:'file source',source:'https://example.com/filing',asOf:'2026-09-15'}]}}}}},'A');
assert.equal(evidence[0].href,null);assert.equal(evidence[1].href,'https://example.com/filing');
const root=path.join(__dirname,'..'),html=fs.readFileSync(path.join(root,'index.html'),'utf8');
for(const id of ['page-portfolio','page-picks','page-markets','page-options','page-analyze','app','agentic-app','picks-app','plan-agentic-app'])assert.ok(html.includes('id="'+id+'"'),'preserve '+id);
for(const key of ['snapshot','holdings','performance','heatmap','risk','allocation','income','technicals','fundamentals','smalls','flow','rebalance-log'])assert.ok(html.includes('data-sec="'+key+'"'),'preserve '+key);
for(const script of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)){
  if(!script[0].includes('application/json'))new Function(script[1]);
}
new Function(fs.readFileSync(path.join(root,'ui/experience.js'),'utf8'));
assert.ok(html.includes("APP_VERSION='v150'"));
const sw=fs.readFileSync(path.join(root,'sw.js'),'utf8');assert.ok(sw.includes("'pf-v150'"));
for(const asset of ['experience.css','experience-model.js','experience.js']){
  assert.ok(html.includes('ui/'+asset+'?v=150'));assert.ok(sw.includes('ui/'+asset+'?v=150'));
}
console.log('PASS: display models, missing data, scenarios, source links, preserved destinations, script syntax, cache versions');
