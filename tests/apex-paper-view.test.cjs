// #235: Apex v2.9 Paper decision view — pure helpers (decision, filters, sectors, detail, edge states).
// Synthetic documents only; no network, no account data.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const A=require('../ui/apex-paper.js');
const at=s=>Date.parse(s);
const RUN='2026-11-16T07:52:00-05:00', NOW=at(RUN)+36e5;
const row=(sym,extra={})=>({sym,name:sym+' Corp',sector:'Energy',setup:'B',setupLabel:'pullback',composite:8,rr:2,entry:50,stop:45,tp1:60,status:'watch',statusReason:'one test short',fails:[],...extra});
const doc=(extra={})=>({schema:1,paper:true,rulesVersion:'v2.9-paper-1',asOf:RUN,status:'ok',lastSuccessAsOf:RUN,nextRun:'2026-11-17T07:52:00-05:00',
  universe:{eligible:100,scanned:100,complete:true},funnel:{qualified:3,near:1,emerging:0,rejected:96},
  ranked:{qualified:[row('AAA',{rank:1,status:'buy',statusReason:'paper buy candidate'}),row('BBB',{rank:2,status:'blocked',statusReason:'valid candidate, blocked: sector limit'}),row('CCC',{rank:3,sector:'Technology',setup:'A',composite:9,rr:1.6,status:'buy',statusReason:null})],near:[row('NNN',{rank:1,composite:null,rr:null})],emerging:[]},
  batch:{asOf:RUN,indicative:true,picks:[{sym:'AAA',weightPct:30.5},{sym:'CCC',weightPct:30.5}],blocked:[{sym:'BBB',reason:'sector limit (2 per sector)'}],cashPct:40,techBatchPct:30.5},
  sectors:{universe:{Energy:40,Technology:60},qualified:{Energy:2,Technology:1},near:{Energy:1}},
  cohorts:[],marks:[],metrics:{},cohortNote:'No paper cohort yet.',...extra});

test('decision: picks, weights, cash and blocked come straight from the file',()=>{
  const d=A.decision(A.model(doc(),NOW));
  assert.equal(d.selected,2);assert.deepEqual(d.picks.map(p=>[p.sym,p.weightPct,p.sector]),[['AAA',30.5,'Energy'],['CCC',30.5,'Technology']]);
  assert.equal(d.cashPct,40);assert.equal(d.investedPct,61);assert.equal(d.totalPct,101);
  assert.equal(d.roundingNote,'Source weights add to 101% (rounding in the file); shown as published.','a 101% sum is noted, never adjusted');
  assert.deepEqual(d.blocked.map(b=>[b.sym,b.reason]),[['BBB','sector limit (2 per sector)']]);
  assert.deepEqual(d.sectorWeights,[{name:'Technology',weightPct:30.5},{name:'Energy',weightPct:30.5}].sort((a,b)=>b.weightPct-a.weightPct||a.name.localeCompare(b.name)));
  const h=A.html(doc(),NOW);
  assert.match(h,/30\.5%/);assert.match(h,/Source weights add to 101%/);assert.match(h,/PAPER ONLY/);assert.match(h,/Paper picks <em>2<\/em>/);
  assert.equal(A.decision(A.model(doc({batch:{...doc().batch,picks:[{sym:'AAA',weightPct:60}],cashPct:40}}),NOW)).roundingNote,null,'100% has no note');
});
test('0 selected and 0 qualified: zeros are real, empty states are named, nothing throws',()=>{
  const d0=doc({funnel:{qualified:0,near:0,emerging:0,rejected:100},ranked:{qualified:[],near:[],emerging:[]},batch:{picks:[],blocked:[],cashPct:100},sectors:{universe:{Energy:40},qualified:{},near:{}}});
  const m=A.model(d0,NOW),d=A.decision(m),h=A.html(d0,NOW);
  assert.equal(d.selected,0);assert.equal(d.investedPct,null);assert.equal(d.roundingNote,null);
  assert.match(h,/Paper picks <em>0<\/em>/);assert.match(h,/No paper buys in this batch\./);assert.match(h,/Nothing qualified in this run\./);assert.match(h,/No qualified names by sector/);
  assert.equal(A.defaultSelection(m),null);assert.match(A.detailHtml(m,null),/Pick a candidate/);
  assert.deepEqual(A.filterRows(m,{seg:'pick'}),[]);
  assert.doesNotMatch(h,/undefined|NaN|\[object/);
  // No batch at all is unknown, not zero.
  const nb=A.decision(A.model(doc({batch:null}),NOW));assert.equal(nb.selected,null);assert.match(A.html(doc({batch:null}),NOW),/No paper batch in this file\./);
});
test('absent blocked reason: "reason not available"; a blocked row never drops out',()=>{
  const d1=doc({batch:{...doc().batch,blocked:[{sym:'BBB'},{sym:'OFF'}]},ranked:{...doc().ranked,qualified:doc().ranked.qualified.map(r=>r.sym==='BBB'?{...r,statusReason:null}:r)}});
  const m=A.model(d1,NOW),d=A.decision(m),h=A.html(d1,NOW);
  assert.deepEqual(d.blocked.map(b=>[b.sym,b.reason,b.listed]),[['BBB',null,true],['OFF',null,false]]);
  assert.match(h,/<b>BBB<\/b><span>reason not available<\/span>/);assert.match(h,/<b>OFF<\/b><span>reason not available · not in the listed rows<\/span>/);
  assert.match(A.detailHtml(m,'row:qualified:BBB'),/Why blocked:<\/b> reason not available/);
  // A row the engine marked blocked but left out of batch.blocked is still listed as blocked.
  const d2=A.decision(A.model(doc({batch:{...doc().batch,blocked:[]}}),NOW));
  assert.deepEqual(d2.blocked.map(b=>[b.sym,b.reason]),[['BBB','valid candidate, blocked: sector limit']]);
  // The detail says why a pick was selected, and a row without a reason says so.
  assert.match(A.detailHtml(m,'row:qualified:AAA'),/Why selected:<\/b> paper buy candidate/);
  assert.match(A.detailHtml(m,'row:qualified:CCC'),/Why selected:<\/b> reason not available/);
});
test('absent cohorts: "not yet measured" with the planned measures; recorded marks are plotted only when present',()=>{
  const h=A.html(doc(),NOW);
  assert.match(h,/Not yet measured/);assert.match(h,/data-apx-nocohort>No paper cohort yet\./);assert.match(h,/Forward return per pick/);assert.doesNotMatch(h,/apx-alpha/);
  assert.match(h,/Cohorts<\/span> <b>none graded yet<\/b>/);
  const withMarks=doc({cohorts:[{asOf:RUN,picks:[{sym:'AAA',w:30}]}],marks:[{asOf:RUN,sym:'AAA',horizon:'5d',ret:2,spyRet:1,alpha:1},{asOf:RUN,sym:'CCC',horizon:'5d',ret:null,spyRet:null,alpha:null}]});
  const hm=A.html(withMarks,NOW);
  assert.match(hm,/apx-alpha/);assert.equal((hm.match(/class="apx-arow"/g)||[]).length,1,'a mark without alpha is not drawn');
  assert.doesNotMatch(hm,/Not yet measured/);assert.match(hm,/Cohorts<\/span> <b>1 recorded · latest Mon, Nov 16, 7:52 AM ET<\/b>/);
});
test('stale asOf: labelled STALE with a not-live note; identical times are not repeated',()=>{
  const old='2026-11-06T07:52:00-05:00', h=A.html(doc({asOf:old,lastSuccessAsOf:old}),NOW);
  assert.match(h,/STALE — last run Fri, Nov 6, 7:52 AM ET/);assert.match(h,/Stale snapshot: prices and levels below are from the last run, not live\./);
  assert.equal((h.match(/Fri, Nov 6, 7:52 AM ET/g)||[]).length,1,'research time shown once (no repeated last-success / batch time)');
  const fresh=A.html(doc(),NOW);assert.doesNotMatch(fresh,/Stale snapshot/);assert.doesNotMatch(fresh,/Last success/);assert.doesNotMatch(fresh,/Batch as of/);
  assert.match(A.html(doc({lastSuccessAsOf:'2026-11-13T07:52:00-05:00'}),NOW),/Last success<\/span> <b>Fri, Nov 13, 7:52 AM ET<\/b>/,'a different last success is shown');
});
test('unexpected / missing sector: counts kept, no invented pass rate, "Sector not recorded"',()=>{
  const d3=doc({sectors:{universe:{Energy:40},qualified:{Energy:2,'Space Mining':1},near:{}},ranked:{...doc().ranked,qualified:[row('AAA',{status:'buy',sector:'Space Mining'}),row('BBB',{sector:null,status:'blocked'})]},batch:{...doc().batch,picks:[{sym:'AAA',weightPct:30},{sym:'ZZZ',weightPct:30}]}});
  const m=A.model(d3,NOW),v=A.sectorView(m);
  const sm=v.rows.find(r=>r.name==='Space Mining');assert.equal(sm.qualified,1);assert.equal(sm.passRate,null);
  const en=v.rows.find(r=>r.name==='Energy');assert.equal(en.passRate,5);assert.equal(v.top.name,'Energy');assert.equal(Math.round(v.top.shareOfQualified),67);
  const h=A.html(d3,NOW);assert.match(h,/no screened count/);assert.match(h,/Sector not recorded/);
  assert.deepEqual(A.decision(m).sectorWeights.map(x=>x.name).sort(),['Sector not recorded','Space Mining']);
  assert.deepEqual(A.filterRows(m,{sector:'__none'}),['row:qualified:BBB']);
});
test('filters: segments, sector, setup, minimums, search; a missing number never passes a minimum',()=>{
  const m=A.model(doc(),NOW);
  assert.deepEqual(A.filterRows(m,{}),['row:qualified:AAA','row:qualified:BBB','row:qualified:CCC','row:near:NNN']);
  assert.deepEqual(A.filterRows(m,{seg:'pick'}),['row:qualified:AAA','row:qualified:CCC']);
  assert.deepEqual(A.filterRows(m,{seg:'blocked'}),['row:qualified:BBB']);
  assert.deepEqual(A.filterRows(m,{seg:'near'}),['row:near:NNN']);
  assert.deepEqual(A.filterRows(m,{sector:'Technology'}),['row:qualified:CCC']);
  assert.deepEqual(A.filterRows(m,{setup:'A'}),['row:qualified:CCC']);
  assert.deepEqual(A.filterRows(m,{minScore:'8.5'}),['row:qualified:CCC']);
  assert.deepEqual(A.filterRows(m,{minRR:2}),['row:qualified:AAA','row:qualified:BBB'],'NNN has no R/R and CCC is 1.6');
  assert.deepEqual(A.filterRows(m,{q:'ccc corp'}),['row:qualified:CCC']);
  assert.equal(A.filterActive({}),false);assert.equal(A.filterActive({seg:'all',q:'  '}),false);assert.equal(A.filterActive({minRR:'1.5'}),true);
  assert.deepEqual(A.segCounts(m),{all:4,pick:2,qualified:3,near:1,blocked:1});
  assert.equal(A.defaultSelection(m),'row:qualified:AAA','opens on the first paper pick');
});
test('the page has no button, no order wording, and every listed row once',()=>{
  const h=A.html(doc(),NOW);
  assert.doesNotMatch(h,/<button/);assert.match(h,/type="reset"/);
  assert.equal((h.match(/data-apx-row=/g)||[]).length,4);
  assert.doesNotMatch(h,/place_equity_order|review_equity_order|data-apex-confirm/);
});
