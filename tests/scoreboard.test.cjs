const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs'),path=require('path');
const T=require('../ui/today-model.js');
const near=(a,b,m='')=>assert.ok(Math.abs(a-b)<1e-9,`${m}: ${a} vs ${b}`);
const A1='2026-11-23T10:29:38-05:00';
const pick=(sym,extra)=>({sym,w:10,status:'entered',entryDate:'2026-11-24',entryPx:100,...extra});
const paper=(over={})=>({cohorts:[{asOf:A1,picks:[pick('AAA'),pick('BBB')]}],marks:[],
  shadow:{cohorts:[{asOf:A1,liveStatus:'included',picks:[{sym:'LLL',gate:'live-pick',status:'entered'},{sym:'RRR',gate:'live-rr',status:'entered'}]}],marks:[]},...over});
const bars=o=>Object.entries(o).map(([d,c])=>({t:d+'T00:00:00Z',c}));
const rowOf=(sb,h,key)=>sb.byHorizon[h].find(r=>r.key===key);
const stub=(rows,start,end)=>{const r=rows.filter(x=>x.t>=start&&x.t<=end);return r.length>1&&r[0].t===start&&r.at(-1).t===end?{status:'estimated',returnPct:+((r.at(-1).eq/r[0].eq-1)*100).toFixed(4)}:{status:'pending',reason:'x'};};

test('trading-day math skips weekends and the Thanksgiving closure: first 5-day score is Dec 2',()=>{
  assert.equal(T.addTradingDays('2026-11-24',5),'2026-12-02');
  assert.equal(T.addTradingDays('2026-11-24',1),'2026-11-25');
  assert.equal(T.addTradingDays('2026-11-25',1),'2026-11-27');
});
test('four rows in fixed order, v2.9 always labelled paper, percent only',()=>{
  const sb=T.scoreboard({paper:paper(),today:'2026-11-25'});
  assert.deepEqual(sb.byHorizon[5].map(r=>r.key),['spy','live','paper','agentic']);
  const p=rowOf(sb,5,'paper');assert.match(p.name,/paper/i);assert.equal(p.paper,true);
  assert.equal(sb.startLabel,'Nov 24');assert.equal(sb.firstScore,'Dec 2');assert.deepEqual(sb.chips,[5,30,60,90,'start']);
});
test('published file as it stands opens in the honest too-early state with a computed first-score date',()=>{
  const doc=JSON.parse(fs.readFileSync(path.join(__dirname,'../data/apex-paper-v29.json'),'utf8'));
  const sb=T.scoreboard({paper:doc,today:'2026-11-25'});
  assert.equal(sb.start,'2026-11-24');assert.equal(sb.firstScore,'Dec 2');
  assert.equal(rowOf(sb,5,'paper').state,'early');assert.equal(rowOf(sb,5,'paper').reason,'too early');
  assert.equal(rowOf(sb,5,'live').state,'missing');
  assert.equal(rowOf(sb,5,'spy').state,'early');assert.equal(sb.pills[5].text,'Too early');
  for(const r of sb.byHorizon[5])assert.equal(r.value,null,'no invented number');
});
test('SPY: close to close from the day before the start; early before the date, missing after, none without a basis',()=>{
  const spy=bars({'2026-11-23':100,'2026-11-24':101,'2026-11-25':102});
  let sb=T.scoreboard({paper:paper(),today:'2026-11-25',spyBars:spy});
  near(rowOf(sb,'start','spy').value,2);assert.equal(rowOf(sb,'start','spy').thru,'Nov 25');
  assert.equal(rowOf(sb,5,'spy').state,'early');
  const later=bars({'2026-11-23':100,'2026-12-02':110});
  sb=T.scoreboard({paper:paper(),today:'2026-12-03',spyBars:later});
  near(rowOf(sb,5,'spy').value,10);
  sb=T.scoreboard({paper:paper(),today:'2026-12-03',spyBars:bars({'2026-11-23':100})});
  assert.equal(rowOf(sb,5,'spy').state,'missing');
  sb=T.scoreboard({paper:paper(),today:'2026-12-03',spyBars:bars({'2026-12-02':110})});
  assert.equal(rowOf(sb,5,'spy').state,'none');assert.equal(rowOf(sb,5,'spy').reason,'no history yet');
  sb=T.scoreboard({paper:paper(),today:'2026-11-25'});
  assert.equal(rowOf(sb,'start','spy').state,'none');
  const junk=bars({'2026-11-23':100,'2026-11-24':-5});junk.push({t:'2026-11-25',c:200,live:true},null,{t:'bad',c:1});
  sb=T.scoreboard({paper:paper(),today:'2026-11-25',spyBars:junk});assert.equal(rowOf(sb,'start','spy').state,'none');
});
test('a score date of today is still too early until its close is recorded',()=>{
  const sb=T.scoreboard({paper:paper(),today:'2026-12-02',spyBars:bars({'2026-11-23':100})});
  assert.equal(rowOf(sb,5,'spy').state,'early');
});
test('Agentic: uses only the supplied account-return calculation on recorded dates; no function or no history is a named dash',()=>{
  const hist=[{t:'2026-11-23',eq:1000},{t:'2026-11-24',eq:1010},{t:'2026-11-25',eq:1030}];
  let sb=T.scoreboard({paper:paper(),today:'2026-11-25',agentic:hist,accountReturn:(h,s,e)=>stub(h,s,e)});
  near(rowOf(sb,'start','agentic').value,3);assert.equal(rowOf(sb,5,'agentic').state,'early');
  sb=T.scoreboard({paper:paper(),today:'2026-11-25',agentic:hist});
  assert.equal(rowOf(sb,'start','agentic').state,'none');
  sb=T.scoreboard({paper:paper(),today:'2026-12-05',agentic:[{t:'2026-11-24',eq:1}],accountReturn:stub});
  assert.equal(rowOf(sb,5,'agentic').state,'none','no record on the basis day');
  sb=T.scoreboard({paper:paper(),today:'2026-12-05',agentic:[{t:'2026-11-23',eq:1000},{t:'2026-11-24',eq:1}],accountReturn:stub});
  assert.equal(rowOf(sb,5,'agentic').state,'missing','basis exists but the score date was never recorded');
  sb=T.scoreboard({paper:paper(),today:'2026-12-03',agentic:[{t:'2026-11-23',eq:1000},{t:'2026-12-02',eq:900}],accountReturn:stub});
  near(rowOf(sb,5,'agentic').value,-10);assert.equal(sb.pills[5].text,'Partial');
});
test('Apex paper: equal-weight raw marks, every entered name required, never filled in',()=>{
  const marks=[{asOf:A1,sym:'AAA',horizon:5,ret:4,spyRet:1,alpha:3},{asOf:A1,sym:'BBB',horizon:'5d',ret:-2,spyRet:1,alpha:-3}];
  let sb=T.scoreboard({paper:paper({marks}),today:'2026-12-03'});
  near(rowOf(sb,5,'paper').value,1);near(rowOf(sb,'start','paper').value,1);assert.equal(rowOf(sb,'start','paper').thru,'5d');
  assert.equal(rowOf(sb,30,'paper').state,'early');
  sb=T.scoreboard({paper:paper({marks:[marks[0]]}),today:'2026-12-03'});
  assert.equal(rowOf(sb,5,'paper').state,'missing','one name has no mark: not scored');
  sb=T.scoreboard({paper:paper({marks:[marks[0],{...marks[1],ret:null}]}),today:'2026-12-03'});
  assert.equal(rowOf(sb,5,'paper').value,null);
  sb=T.scoreboard({paper:paper({marks:[{...marks[0],asOf:'other'},marks[1]]}),today:'2026-12-03'});
  assert.equal(rowOf(sb,5,'paper').state,'missing','a mark from another cohort does not count');
});
test('Apex current: live picks missing, pending, absent and scored',()=>{
  const shadow=(status,picks,marks)=>({cohorts:[{asOf:A1,liveStatus:status,picks}],marks:marks||[]});
  const lp=[{sym:'LLL',gate:'live-pick',status:'entered'}];
  assert.equal(rowOf(T.scoreboard({paper:paper({shadow:shadow('missing',[])}),today:'2026-12-03'}),5,'live').reason,'missing');
  assert.equal(rowOf(T.scoreboard({paper:paper({shadow:shadow('pending',[])}),today:'2026-12-03'}),5,'live').reason,'pending');
  assert.equal(rowOf(T.scoreboard({paper:paper({shadow:null}),today:'2026-12-03'}),5,'live').reason,'no history yet');
  assert.equal(rowOf(T.scoreboard({paper:paper({shadow:shadow('included',lp)}),today:'2026-11-25'}),5,'live').reason,'too early');
  const sb=T.scoreboard({paper:paper({shadow:shadow('added-late',lp,[{asOf:A1,sym:'LLL',horizon:5,ret:-6}])}),today:'2026-12-03'});
  near(rowOf(sb,5,'live').value,-6);
});
test('empty states: no file, malformed file, no cohort, cohort not yet entered',()=>{
  for(const p of [null,[],'x',42]){const sb=T.scoreboard({paper:p,today:'2026-11-25'});assert.equal(sb.start,null);assert.equal(sb.pill.text,'Data missing');
    for(const r of sb.byHorizon[5]){assert.equal(r.state,'missing');assert.equal(r.value,null);}}
  let sb=T.scoreboard({paper:{cohorts:[]},today:'2026-11-25'});assert.equal(sb.pill.text,'Not started');assert.equal(rowOf(sb,5,'spy').reason,'no history yet');
  sb=T.scoreboard({paper:{cohorts:[{asOf:A1,picks:[{sym:'AAA',status:'pending',entryDate:null}]}]},today:'2026-11-25'});assert.equal(sb.start,null);
  sb=T.scoreboard({paper:paper(),today:'bad'});assert.equal(sb.pill.text,'Data missing');
  assert.doesNotThrow(()=>T.scoreboard());assert.doesNotThrow(()=>T.scoreboard({paper:{cohorts:[null,{picks:null}],marks:'x'},today:'2026-11-25'}));
});
test('the earliest cohort with an entered pick sets the start, and inputs are not mutated',()=>{
  const doc=paper({cohorts:[{asOf:'2026-11-30T10:00:00-05:00',picks:[pick('ZZZ',{entryDate:'2026-12-01'})]},{asOf:A1,picks:[pick('AAA')]}]});
  const before=JSON.stringify(doc);
  const sb=T.scoreboard({paper:doc,today:'2026-11-25'});
  assert.equal(sb.start,'2026-11-24');assert.equal(JSON.stringify(doc),before);
});
test('card source is display-only: no order, ticket, Apex rules or private data helpers',()=>{
  const src=fs.readFileSync(path.join(__dirname,'../ui/today-model.js'),'utf8');
  const part=src.slice(src.indexOf('Scoreboard (v264)'));
  assert.ok(!/fetch\(|localStorage|place_|Apex\./.test(part));
});
