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
// Cash-flow changes remain visible as account value; invalid/duplicate observations cannot
// create spurious chart points. Account selection must never borrow the other account's history.
const histories={main:{equityHistory:[{t:'2026-09-02',equity:1200},{t:'bad',equity:8},{t:'2026-09-01',equity:1000},{t:'2026-09-02',equity:1500},{t:'2026-09-03',equity:null}]},agentic:{equityHistory:[{t:'2026-09-01',equity:50}]}};
assert.deepEqual(M.valueHistory(histories,'main').map(p=>p.equity),[1000,1500]);
assert.deepEqual(M.valueHistory(histories,'agentic').map(p=>p.equity),[50]);
assert.deepEqual(M.valueHistory({},'main'),[]);
const groups=M.composition([{symbol:'A',value:800},{symbol:'B',value:100},{symbol:'C',value:50},{symbol:'D',value:50},{symbol:'X',value:null}]);
assert.deepEqual(groups.map(p=>[p.label,p.share]),[['A',80],['B',10],['C',5],['Other',5]]);
assert.deepEqual(M.composition([]),[]);
assert.deepEqual(M.breadth([{day:null},{day:0},{day:2},{day:-1},{}]),{up:1,down:1,flat:1,missing:2});
// v255: What if? removed (Jack, Nov 18 2026); the model no longer exports scenario().
assert.equal(M.scenario,undefined);
const evidence=M.evidence({research:{evidence:{A:{quality:{evidence:[{claim:'untrusted',source:'javascript:alert(1)'},{claim:'file source',source:'https://example.com/filing',asOf:'2026-09-15'}]}}}}},'A');
assert.equal(evidence[0].href,null);assert.equal(evidence[1].href,'https://example.com/filing');
const root=path.join(__dirname,'..'),html=fs.readFileSync(path.join(root,'index.html'),'utf8');
for(const id of ['page-portfolio','page-picks','page-markets','page-options','page-analyze','app','agentic-app','picks-app','plan-agentic-app'])assert.ok(html.includes('id="'+id+'"'),'preserve '+id);
for(const key of ['snapshot','holdings','performance','heatmap','risk','allocation','income','technicals','fundamentals','smalls','flow','rebalance-log'])assert.ok(html.includes('data-sec="'+key+'"'),'preserve '+key);
for(const script of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)){
  if(!script[0].includes('application/json'))new Function(script[1]);
}
new Function(fs.readFileSync(path.join(root,'ui/experience.js'),'utf8'));
const experience=fs.readFileSync(path.join(root,'ui/experience.js'),'utf8');
// Navigation B (Jack, Nov 17 2026) supersedes the five-area labels Today / Portfolio / Research / Signals / Activity.
// Areas are Today / Apex / Agentic / Research / More; account-scoped routes live in Apex (pf_acct main) or Agentic (agentic).
for(const route of ['technicals','fundamentals','flow']){
  assert.match(experience,new RegExp(route+": \\{area:'apex', scoped:true, hidden:true"),'account area owns '+route);
}
assert.match(experience,/const defaults = \{today:'today',apex:'plan',agentic:'plan',research:'markets',more:'options'\}/,'five areas, in order, with their defaults');
const routeIds=[...experience.matchAll(/^    (\w+): \{area:'(\w+)'/gm)].map(m=>m[1]);
assert.deepEqual(routeIds.slice().sort(),['accounts','acctresearch','activity','analyze','apexpaper','decisions','flow','fundamentals','heatmap','holdings','income','log','markets','options','performance','plan','predictions','risk','screens','smartmoney','technicals','today'],'the Navigation B route ids are kept (v255 removed What if?, scenario), plus apexpaper (v244) and acctresearch (v253: the account research tab)');
assert.match(experience,/    acctresearch: \{area:'apex', scoped:true, hidden:true, label:'Research', tab:'picks'\}/,'the account research tab is the plan page, account-scoped');
// v244: the Apex v2.9 paper page is an Apex-only route (not account-scoped, pinned to the self-directed account, never the area's remembered route).
assert.match(experience,/    apexpaper: \{area:'apex', account:'main', transient:true, label:'v2.9 Paper', tab:'apexpaper'\}/);
assert.ok(html.includes('id="page-apexpaper"')&&html.includes('id="apexpaper-app"'),'paper research page container');
assert.equal(require('../ui/journey.js').pageRoute('#view=scenario'),null,'v255: an old What if? link opens the default page');
for(const id of routeIds)assert.match(require('../ui/journey.js').pageRoute('#view='+id)||'',new RegExp('^'+id+'$'),'journey admits #view='+id);
for(const route of ['plan','accounts','holdings','performance','heatmap','risk','income','technicals','fundamentals','flow'])assert.match(experience,new RegExp('    '+route+": \\{area:'apex', scoped:true"),route+' is account-scoped');
for(const route of ['markets','screens','analyze','smartmoney','predictions'])assert.match(experience,new RegExp('    '+route+": \\{area:'research'"),route+' is in Research');
for(const route of ['options','decisions','log','activity'])assert.match(experience,new RegExp('    '+route+": \\{area:'more'"),route+' is in More');
assert.match(experience,/areaOf = \(key, acct\)/);assert.match(experience,/accountArea = \{main:'apex',agentic:'agentic'\}/);
assert.match(experience,/area==='apex'\?'main':area==='agentic'\?'agentic':undefined/,'Apex always selects the self-directed account, Agentic the agentic one');
const version=html.match(/APP_VERSION='v(\d+)'/)[1];
const sw=fs.readFileSync(path.join(root,'sw.js'),'utf8');assert.ok(sw.includes("'pf-v"+version+"'"));
for(const asset of ['experience.css','experience-model.js','experience.js','sd-rules.js','predictions.css','predictions-model.js','predictions.js','apex-paper.js','apex-paper.css']){
  assert.ok(html.includes('ui/'+asset+'?v='+version));assert.ok(sw.includes('ui/'+asset+'?v='+version));
}
assert.doesNotMatch(experience,/01 \/ What moved|02 \/ Where|03 \/ Your next/);
assert.match(experience,/class="ex-cta"/);
assert.match(experience,/ex-div-left/);
assert.match(experience,/Open the plan/);
assert.match(experience,/No active ticket/);assert.doesNotMatch(experience,/None in flight/);
assert.match(experience,/d\?\.agentic\?\.lastTicket/,'Activity uses separately published finished-ticket history');
assert.match(experience,/decisionEvents=history.length\?\[\]:decisions/,'Activity falls back to the decision ledger without inventing ticket stages');
assert.match(experience,/not independent proof of broker fills/,'historical ticket stages keep the execution-evidence caveat');
assert.match(experience,/Not in this app/);
assert.doesNotMatch(experience,/Not connected/);
const css=fs.readFileSync(path.join(root,'ui/experience.css'),'utf8');
assert.match(css,/\.ex-brief-hero\{display:grid/);
assert.match(css,/\.ex-ring\{width:112px/);
assert.match(css,/\.ex-cta\{display:block/);
// Workspace stamps: full date + time + AM/PM + ET from the same toLocaleString options as Today/journey; a day-only source shows no invented time; no source = omitted.
assert.deepEqual(M.stamp('2026-11-17T14:41:00Z'),{text:'Nov 17, 9:41 AM ET',dateOnly:false});
assert.match(M.stamp('2026-07-04T22:05:00Z').text,/^Jul 4, 6:05 PM ET$/);
assert.deepEqual(M.stamp('2026-11-11'),{text:'Nov 11',dateOnly:true});
assert.equal(M.stamp('garbage'),null);assert.equal(M.stamp(null),null);
{const now=Date.parse('2026-11-17T17:00:00Z');
 const d={generatedAt:'2026-11-17T14:41:00Z',picks:{ts:'2026-11-16'},agentic:{target:{asOf:'2026-11-01'}}};
 const mainS=M.freshnessStamps(d,'main',{now,apexTarget:{asOf:'2026-11-17T12:00:00Z'}});
 assert.deepEqual(mainS.map(x=>x.key),['research','scan'],'no Account stamp: the freshness bar is the one account time');assert.equal(mainS[0].text,'Nov 17, 7:00 AM ET');assert.equal(mainS[1].dateOnly,true);
 const agS=M.freshnessStamps(d,'agentic',{now});assert.deepEqual(agS.map(x=>x.key),['research'],'Agentic has no Last scan and no Account stamp');assert.equal(agS[0].state,'stale','a target older than the 14-day cycle is stale');
 assert.equal(M.freshnessStamps({agentic:{target:{asOf:'2026-11-08'}}},'agentic',{now})[0].state,'ok','9 days into the 14-day cycle is not stale (v255)');
 assert.equal(M.researchCycle('2026-11-08',now).text,'9 days into the 14-day cycle');assert.equal(M.researchCycle('2026-11-01',now).text,'16 days old · 2 days past the 14-day cycle');assert.equal(M.researchCycle('2026-11-01',now).overdue,true);assert.equal(M.researchCycle(null,now),null);
 assert.deepEqual(M.freshnessStamps({generatedAt:'2026-11-17T10:00:00Z'},'main',{now}),[],'the account time is never a workspace stamp');
 assert.deepEqual(M.freshnessStamps({},'main',{now}),[],'no sources, no stamps');}
console.log('PASS: display models, missing data, source links, preserved destinations, script syntax, cache versions, today brief visuals');
