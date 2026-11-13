const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const M=require('../ui/journey.js');
test('only valid symbols are carried into read-only research',()=>{
 for(const v of [null,undefined,{},'<img>',"A');alert(1)//",'a b','',123])assert.equal(M.symbol(v),'');
 assert.equal(M.symbol(' brk.b '),'BRK.B');assert.equal(M.symbol('nvda'),'NVDA');
});
test('account aliases cannot cross into another namespace',()=>{
 assert.equal(M.account('agentic'),'agentic');for(const v of ['main',null,'margin','all'])assert.equal(M.account(v),'main');
});
test('unknown numbers remain unknown and real zero remains zero',()=>{
 for(const v of ['',null,undefined,{},false,NaN,Infinity])assert.equal(M.num(v),null);
 assert.equal(M.num(0),0);assert.equal(M.num('10.5'),10.5);
});
test('route hash admits only app destinations, never bootstrap keys or ticker data',()=>{
 assert.equal(M.pageRoute('#view=plan'),'plan');assert.equal(M.pageRoute('#view=holdings'),'holdings');
 for(const h of ['#key=private','#view=analyze&symbol=AAPL','#view=notfound','#view=javascript',''])assert.equal(M.pageRoute(h),null);
});
test('history schema discards arbitrary secrets and raw financial fields',()=>{
 const r=M.clean({v:1,route:'plan',account:'agentic',symbol:'NVDA',index:2,y:100,details:[1,3],pass:'secret',value:80000});
 assert.deepEqual(Object.keys(r),['v','route','account','symbol','index','y','details']);assert.equal(r.account,'agentic');
 assert.deepEqual(r.details,[1,3]);assert.equal(r.index,2);
});
test('malformed history entries fail closed',()=>{
 assert.equal(M.clean(null),null);assert.equal(M.clean({v:2,route:'today'}),null);assert.equal(M.clean({v:1,route:'unknown'}),null);
 const r=M.clean({v:1,route:'today',index:-10,y:Infinity,details:[-1,0,2.1,1000,'3'],symbol:'javascript:bad'});
 assert.equal(r.index,0);assert.equal(r.y,0);assert.equal(r.symbol,'');assert.deepEqual(r.details,[0]);
});
test('selection choices deduplicate but retain a researched, unheld name',()=>{
 const s={positions:[{symbol:'AAPL'},{symbol:'AAPL'}]},t=[{ticker:'MSFT'},{sym:'AAPL'},{sym:'BAD<script>'}];
 assert.deepEqual(M.choices(s,t,'GOOGL'),['AAPL','MSFT','GOOGL']);assert.deepEqual(s.positions,[{symbol:'AAPL'},{symbol:'AAPL'}]);
});
test('missing source coverage creates no invented holding',()=>assert.deepEqual(M.choices(null,null,''),[]));
test('new assets, version and offline shell move together',()=>{
 const html=fs.readFileSync('index.html','utf8'),sw=fs.readFileSync('sw.js','utf8');
 for(const name of ['journey.js','journey.css']){assert.ok(html.includes('ui/'+name+'?v=225'));assert.ok(sw.includes('ui/'+name+'?v=225'));}
 assert.ok(html.includes('ui/duo.css?v=225')&&sw.includes('ui/duo.css?v=225'),'Duo layouts are linked and precached');
 assert.ok(html.includes('ui/duo.js?v=225')&&sw.includes('ui/duo.js?v=225'),'side-status measure script is linked and precached');
 assert.ok(html.includes("APP_VERSION='v225'"));assert.ok(sw.includes("'pf-v225'"));
});
test('source integration is display-only and preserves confirmation entry points',()=>{
 const j=fs.readFileSync('ui/journey.js','utf8');assert.doesNotMatch(j,/place_equity_order|review_equity_order|fetch\([^)]*,\s*\{[^}]*method\s*:/);
 const html=fs.readFileSync('index.html','utf8');assert.ok(html.includes('Apex.render'));assert.ok(html.includes('function azConfirmGo'));
 assert.ok(html.includes('function setPlanAccount'));assert.ok(html.includes('window.__privScan'));
});
