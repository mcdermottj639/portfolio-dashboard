// v244: Apex v2.9 PAPER research view. Pure status/model tests on synthetic documents; no network, no account data.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const A=require('../ui/apex-paper.js');
const root=path.join(__dirname,'..');
const at=s=>Date.parse(s);
// Nov 2026 is EST (UTC-5): 7:52 AM ET = 12:52Z. Nov 13 is a Friday, Nov 16 a Monday.
const FRI_RUN='2026-11-13T07:52:00-05:00', FRI_EVE='2026-11-13T18:30:00-05:00', MON_RUN='2026-11-16T07:52:00-05:00';
const row=(sym,extra={})=>({sym,name:sym+' Inc',sector:'Technology',theme:'AI compute',setup:'A',setupLabel:'breakout',rank:1,composite:8.4,momentum:9,fundamental:7,rrScore:6,rr:2.1,last:101.5,entry:102,entryType:'buy-stop-limit',stop:95,stopBasis:'2 ATR',tp1:117,tp1Basis:'3-month high',atr:3.4,rsi:61,rs3:12.5,rs6:30.1,relVol:1.4,revGrowthPct:28,pe:35,peType:'trailing',marketCapB:42,earningsDate:'2027-01-28',status:'buy',statusReason:'paper buy candidate',fails:[],unlock:'joins the Monday batch',halfSize:false,why:'breakout',...extra});
const doc=(extra={})=>({schema:1,paper:true,rulesVersion:'v2.9-paper-1',asOf:MON_RUN,status:'ok',statusNote:null,lastSuccessAsOf:MON_RUN,nextRun:'2026-11-17T07:52:00-05:00',quoteBasis:'synthetic',
  universe:{eligible:1500,scanned:1500,unique:1498,duplicatesRemoved:2,complete:true,coverageNote:'all batches',batches:[{label:'b1',total:750,rows:750}],bySector:{Technology:300},filters:{minMarketCap:2e9,minAvgVolume:5e5,minPrice:10}},
  funnel:{setupMatches:{A:40,B:30,C:10,none:1420},qualified:2,near:30,emerging:9,rejected:1459},
  rejections:[{key:'rr',label:'R/R under 1.5',count:300},{key:'none',label:'No setup',count:1420},{key:'x',label:'Unknown count'}],
  ranked:{qualified:[row('AAA'),row('BBB',{rank:2,setup:'B',setupLabel:'pullback',status:'blocked',statusReason:'sector limit'})],near:[row('CCC',{status:'watch',fails:['R/R 1.3 < 1.5']})],emerging:[]},
  batch:{asOf:MON_RUN,indicative:true,note:'n',picks:[{sym:'AAA',weightPct:15},{sym:'DDD',weightPct:null}],blocked:[{sym:'BBB',reason:'sector limit'}],techBatchPct:50,cashPct:40},
  sectors:{universe:{Technology:300,Energy:100},qualified:{Technology:2},near:{Energy:3}},
  concentration:{techBatchPct:50,v28TechOutsideCorePct:76.3,note:'c'},
  v28:{asOf:MON_RUN,rulesVersion:'v2.8',universe:80,passed:17,actionable:['AAA','ZZZ'],targets:{ZZZ:20}},
  cohorts:[],marks:[],metrics:{},cohortNote:'No paper cohort yet.',backtest:null,notes:['n1'],sources:['s1'],...extra});

test('Eastern-time helper: 7:52 AM ET in winter and summer, and the missed-run rule',()=>{
  assert.equal(A.etRunMs(2026,11,16),at('2026-11-16T12:52:00Z'),'EST');
  assert.equal(A.etRunMs(2026,7,6),at('2026-07-06T11:52:00Z'),'EDT');
  assert.equal(A.missedWeekdayRun(at(FRI_EVE),at('2026-11-16T07:00:00-05:00')),false,'weekend holds no run time');
  assert.equal(A.missedWeekdayRun(at(FRI_EVE),at('2026-11-16T07:52:00-05:00')),true,'Monday 7:52 has passed');
  assert.equal(A.missedWeekdayRun(at(MON_RUN),at(MON_RUN)+60e3),false,'a run does not miss itself');
  assert.equal(A.missedWeekdayRun(at(MON_RUN),at(MON_RUN)-1),false,'now before asOf');
  assert.match(A.fmtET(MON_RUN),/^Mon, Nov 16, 7:52 AM ET$/);
  assert.equal(A.fmtET('garbage'),null);assert.equal(A.fmtET(null),null);
});
test('fresh: green, dated in ET, with the next run',()=>{
  const s=A.status(doc(),at('2026-11-16T10:00:00-05:00'));
  assert.equal(s.level,'ok');assert.equal(s.kind,'fresh');assert.equal(s.label,'Updated Mon, Nov 16, 7:52 AM ET');
  assert.equal(s.nextRunText,'Tue, Nov 17, 7:52 AM ET');assert.equal(s.stale,false);
  // 25h59 later, even though Tuesday 7:52 has passed, the two-hour slack holds.
  assert.equal(A.status(doc(),at(MON_RUN)+25.9*36e5).kind,'fresh');
});
test('weekend gap is allowed: Friday evening file is not stale Monday at 7 AM',()=>{
  for(const asOf of [FRI_RUN,FRI_EVE]){
    const s=A.status(doc({asOf}),at('2026-11-16T07:00:00-05:00'));
    assert.equal(s.kind,'fresh',asOf);assert.equal(s.level,'ok');
  }
  assert.equal(A.status(doc({asOf:FRI_RUN}),at('2026-11-14T12:00:00-05:00')).kind,'fresh','Saturday noon, 28h old, no weekday run missed');
});
test('stale: the Monday 7:52 run is missing by Monday 10 AM',()=>{
  const s=A.status(doc({asOf:FRI_EVE}),at('2026-11-16T10:00:00-05:00'));
  assert.equal(s.level,'warn');assert.equal(s.kind,'stale');assert.equal(s.label,'STALE — last run Fri, Nov 13, 6:30 PM ET');
  const t=A.status(doc(),at('2026-11-17T10:00:00-05:00'));
  assert.equal(t.kind,'stale','Tuesday run missed, 26h08 old');
  assert.match(A.pointer(doc({asOf:FRI_EVE}),at('2026-11-16T10:00:00-05:00')),/2 qualified of 1,500 scanned · STALE — last run Fri, Nov 13/);
});
test('failed: red, and the last success is a separate line, never the current time',()=>{
  const d=doc({status:'failed',asOf:MON_RUN,lastSuccessAsOf:FRI_RUN,statusNote:'scanner returned 3 of 12 batches'});
  const s=A.status(d,at('2026-11-16T10:00:00-05:00'));
  assert.equal(s.level,'bad');assert.equal(s.kind,'failed');
  assert.equal(s.label,'Last run FAILED · Mon, Nov 16, 7:52 AM ET');
  assert.equal(s.lastSuccess,'Last successful run Fri, Nov 13, 7:52 AM ET');
  assert.doesNotMatch(s.label,/Updated|Nov 13/);
  assert.equal(A.status(doc({status:'failed',lastSuccessAsOf:null}),Date.now()).lastSuccess,'No successful run recorded');
  const h=A.html(d,at('2026-11-16T10:00:00-05:00'));
  assert.match(h,/data-apx-status="failed"/);assert.match(h,/Last run FAILED/);assert.match(h,/Last successful run Fri, Nov 13/);assert.doesNotMatch(h,/>Updated /);
  assert.match(A.pointer(d,at('2026-11-16T10:00:00-05:00')),/Last run FAILED · Mon, Nov 16.*last successful run Fri, Nov 13/);
});
test('partial: amber with the status note; never green',()=>{
  const s=A.status(doc({status:'partial',statusNote:'9 of 12 batches'}),at('2026-11-16T10:00:00-05:00'));
  assert.equal(s.level,'warn');assert.equal(s.kind,'partial');assert.equal(s.label,'Partial coverage');assert.equal(s.detail,'9 of 12 batches');
  assert.match(A.status(doc({status:'partial',asOf:FRI_EVE}),at('2026-11-16T10:00:00-05:00')).label,/Partial coverage · STALE/);
});
test('missing and unreadable are explicit and distinct',()=>{
  for(const v of [null,undefined]){const s=A.status(v,Date.now());assert.equal(s.kind,'missing');assert.equal(s.level,'bad');assert.equal(s.label,'Research file missing');assert.equal(s.usable,false);}
  for(const v of ['<html>',42,[],true]){const s=A.status(v,Date.now());assert.equal(s.kind,'unreadable',JSON.stringify(v));assert.equal(s.level,'bad');}
  assert.equal(A.status(null,Date.now(),'Unreadable: the file is not valid JSON.').kind,'unreadable');
  assert.equal(A.status(null,Date.now(),'data/apex-paper-v29.json is not published (HTTP 404).').kind,'missing','a 404 is missing, not unreadable');
  assert.equal(A.status(null,Date.now(),'data/apex-paper-v29.json is not published (HTTP 404).').detail,'data/apex-paper-v29.json is not published (HTTP 404).');
  assert.match(A.html(null,Date.now()),/data-apx-state="missing"/);assert.match(A.html(null,Date.now()),/Research file missing/);
  assert.match(A.pointer(null,Date.now()),/file missing/);assert.match(A.pointer('x',Date.now()),/file unreadable/);
});
test('never green without a dated successful run',()=>{
  assert.equal(A.status({},Date.now()).level,'warn');assert.equal(A.status({},Date.now()).kind,'unknown');
  assert.equal(A.status({status:'ok'},Date.now()).kind,'undated');
  assert.equal(A.status({status:'ok',asOf:'not a date'},Date.now()).kind,'undated');
  assert.equal(A.status({status:'ok',asOf:'2030-01-01T00:00:00Z'},at('2026-11-16T00:00:00Z')).kind,'future');
  assert.equal(A.status({status:'weird',asOf:MON_RUN},at(MON_RUN)).level,'warn');
});
test('malformed documents never throw and never invent a zero',()=>{
  const bad=[{},{universe:null,funnel:'x',rejections:{},ranked:[],batch:7,sectors:'s',concentration:[],v28:null,cohorts:{},marks:'m',metrics:[],backtest:'b',notes:{},sources:3},
    {ranked:{qualified:[null,7,'x',{}],near:null,emerging:[[]]},rejections:[null,{}],cohorts:[null,{picks:[null]}],marks:[null],backtest:{rows:[null,{}]},batch:{picks:[null],blocked:[null]},universe:{batches:[null]},v28:{actionable:[1,null],targets:[]}},
    {funnel:{qualified:'12',near:NaN,emerging:Infinity},universe:{eligible:'1500',scanned:null}}];
  for(const d of bad){
    const m=A.model(d,Date.now());const h=A.html(d,Date.now());
    assert.ok(h.length>200);assert.doesNotMatch(h,/undefined|NaN|\[object/);
    assert.equal(m.universe.eligible,null);assert.equal(m.universe.scanned,null);
  }
  const m=A.model(bad[3],Date.now());
  assert.equal(m.counts.qualified,null,'a numeric string is not a count');assert.equal(m.counts.near,null);assert.equal(m.counts.emerging,null);
  const h=A.html({status:'ok',asOf:MON_RUN},at(MON_RUN)+1);
  assert.match(h,/Eligible<\/span><b>—<\/b>/);assert.match(h,/Scanned<\/span><b>—<\/b>/);assert.match(h,/Qualified<\/span><b>—<\/b>/);
  assert.doesNotMatch(h,/<b>0<\/b>/,'no missing figure is drawn as 0');
});
test('empty lists read as empty, with real zero counts kept',()=>{
  const d=doc({funnel:{setupMatches:{A:0,B:0,C:0,none:1500},qualified:0,near:0,emerging:0,rejected:1500},ranked:{qualified:[],near:[],emerging:[]},rejections:[],batch:{picks:[],blocked:[],techBatchPct:null,cashPct:100}});
  const m=A.model(d,at(MON_RUN)+1),h=A.html(d,at(MON_RUN)+1);
  assert.equal(m.counts.qualified,0);assert.match(h,/Qualified<\/span><b>0<\/b>/);
  assert.match(h,/Nothing qualified in this run\./);assert.match(h,/No paper buys in this batch\./);assert.match(h,/No rejection reasons recorded/);
  assert.match(h,/data-apx-nocohort>No paper cohort yet\./);
  assert.equal(A.model({ranked:{qualified:[row('AAA')]}},0).counts.qualified,1,'a listed row is a real count when the funnel is absent');
});
test('a row with nulls shows dashes, keeps entry and target visible, and escapes text',()=>{
  const r=row('<b>X',{name:null,sector:null,theme:null,setup:'Q',rank:null,composite:null,rr:null,last:null,entry:null,entryType:null,stop:null,tp1:null,atr:null,rsi:null,rs3:null,rs6:null,relVol:null,revGrowthPct:null,pe:null,peType:null,marketCapB:null,earningsDate:null,status:'??',statusReason:null,fails:null,unlock:null,why:'<script>x</script>'});
  const d=doc({ranked:{qualified:[r],near:[],emerging:[]}}),m=A.model(d,at(MON_RUN)+1),h=A.html(d,at(MON_RUN)+1);
  const q=m.ranked.qualified[0];
  assert.equal(q.entry,null);assert.equal(q.tp1,null);assert.equal(q.setup,null);assert.equal(q.status,null);assert.equal(q.statusLabel,'Status not recorded');assert.equal(q.rank,1);
  assert.match(h,/<span>Entry<\/span><b>—<\/b>/);assert.match(h,/<span>Target<\/span><b class="apx-up">—<\/b>/);
  assert.doesNotMatch(h,/<script>|<b>X/);assert.match(h,/&lt;script&gt;/);
  assert.doesNotMatch(h,/\$0\.00|>0\.0</);
});
test('model: counts, sorted rejections, batch, comparison and concentration',()=>{
  const m=A.model(doc(),at(MON_RUN)+1);
  assert.deepEqual(m.rejections.map(r=>r.key),['none','rr','x'],'sorted by count, unknown count last');
  assert.equal(m.rejections[0].pct,100);assert.equal(m.rejections[2].count,null);assert.equal(m.rejections[2].pct,null);
  assert.deepEqual(m.setups.map(s=>[s.key,s.count]),[['A',40],['B',30],['C',10],['none',1420]]);
  assert.deepEqual(m.batch.picks,[{sym:'AAA',weightPct:15},{sym:'DDD',weightPct:null}]);
  assert.equal(m.batch.overCap,true,'50% tech is over the 40% rule');assert.equal(m.batch.techCapPct,40);
  assert.deepEqual(m.compare.paperNames,['AAA','DDD']);assert.deepEqual(m.compare.liveNames,['AAA','ZZZ']);assert.deepEqual(m.compare.both,['AAA']);
  assert.equal(m.compare.liveUniverse,80);assert.equal(m.compare.paperUniverse,1500);assert.equal(m.compare.livePassed,17);assert.equal(m.compare.paperPassed,2);
  assert.equal(m.sectors[0].name,'Technology');assert.equal(m.sectors[0].qualifiedShare,100);assert.equal(m.sectors[1].qualified,null);
  const h=A.html(doc(),at(MON_RUN)+1);
  assert.match(h,/Apex v2\.9 · PAPER RESEARCH — not live/);assert.match(h,/v2\.8 <span class="apx-chip apx-good">LIVE/);assert.match(h,/v2\.9 <span class="apx-chip apx-warn">PAPER/);
  assert.match(h,/sized Monday/);assert.match(h,/Buy \(paper\)/);assert.match(h,/<span>Entry<\/span><b>\$102\.00<\/b>/);assert.match(h,/Entry: buy-stop-limit · Target: 3-month high · Stop: 2 ATR/);assert.match(h,/<span>Target<\/span><b class="apx-up">\$117\.00<\/b>/);
  assert.match(h,/Hypothetical and in-sample on today’s names \(survivorship bias\)\. Not proven out-of-sample\./,'caveat present even with no backtest');
  assert.match(h,/data-apx-backtest="none"/);
});
test('cohorts with marks and a finished backtest render; the caveat stays',()=>{
  const d=doc({cohorts:[{asOf:'2026-11-09T07:52:00-05:00',rulesVersion:'v2.9-paper-1',picks:[{sym:'AAA',w:15,setup:'A',entryPx:100,status:'open'}],spyAt:680}],
    marks:[{asOf:'2026-11-09T07:52:00-05:00',sym:'AAA',horizon:'5d',ret:3.2,spyRet:1,alpha:2.2},{asOf:'2020-01-01',sym:'OLD',horizon:'5d',ret:null,spyRet:null,alpha:null}],
    metrics:{cohorts:1,hitRate:0.5,nested:{a:1}},cohortNote:'descriptive until 12 cohorts',
    backtest:{status:'done',asOf:MON_RUN,note:'bt',rows:[{setup:'A',signals:120,netRetPct:4.1,netAlphaPct:-0.6,gapStopPct:8}]}});
  const m=A.model(d,at(MON_RUN)+1),h=A.html(d,at(MON_RUN)+1);
  assert.equal(m.cohorts.length,1);assert.equal(m.cohorts[0].marks.length,1);assert.equal(m.looseMarks.length,1);
  assert.deepEqual(m.metrics.map(x=>x.key),['cohorts','hitRate']);
  assert.match(h,/data-apx-backtest="done"/);assert.match(h,/<td>120<\/td><td>\+4\.1%<\/td><td class="apx-dn">-0\.6%<\/td>/);
  assert.match(h,/Not proven out-of-sample/);assert.doesNotMatch(h,/data-apx-nocohort/);
  for(const st of ['pending','failed'])assert.match(A.html(doc({backtest:{status:st,rows:[]}}),at(MON_RUN)+1),new RegExp('data-apx-backtest="'+st+'"'));
});
test('long lists: the first rows stay open, the rest fold, and a listed subset is labelled',()=>{
  const many=Array.from({length:23},(_,i)=>row('Q'+i,{rank:i+1}));
  const d=doc({funnel:{qualified:23,near:343,emerging:9,rejected:1},ranked:{qualified:many,near:[row('N1')],emerging:[]},rejections:Array.from({length:11},(_,i)=>({key:'k'+i,label:'L'+i,count:100-i}))});
  const h=A.html(d,at(MON_RUN)+1);
  assert.match(h,/Show all 23 qualified <span>13 more<\/span>/);assert.match(h,/3 more reasons/);assert.match(h,/343 · top 1 listed/);
  assert.equal((h.match(/data-apx-row=/g)||[]).length,24,'every listed row is in the page');
});
test('display-only boundary: the live Apex engine never references the paper module or its file',()=>{
  for(const f of ['ui/apex.js','ui/sd-rules.js']){
    const src=fs.readFileSync(path.join(root,f),'utf8');
    assert.doesNotMatch(src,/apex-paper/i,f+' must not reference apex-paper');
    assert.doesNotMatch(src,/ApexPaper|__APEX_PAPER|apexpaper/,f+' must not read the paper view or its data');
  }
  const paper=fs.readFileSync(path.join(root,'ui/apex-paper.js'),'utf8');
  assert.doesNotMatch(paper,/\bApex\.(rules|render|bookLines|portfolioPrompt)|__APEX_TGT|__APEX_CFG|fetch\(|localStorage|place_equity_order|review_equity_order/,'the paper view reads nothing live and writes nothing');
  const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
  const card=html.slice(html.indexOf('function renderApexCard'),html.indexOf('function sdApexRuns'));
  assert.doesNotMatch(card,/APEX_PAPER|ApexPaper|apex-paper/,'renderApexCard does not read the paper document');
  assert.equal((html.match(/data\/apex-paper-v29\.json\?t=/g)||[]).length,1,'the file is fetched in exactly one place');
});
test('page, route, assets and offline shell are wired together',()=>{
  const html=fs.readFileSync(path.join(root,'index.html'),'utf8'),sw=fs.readFileSync(path.join(root,'sw.js'),'utf8');
  const v=html.match(/APP_VERSION='v(\d+)'/)[1];
  for(const a of ['apex-paper.js','apex-paper.css']){assert.ok(html.includes('ui/'+a+'?v='+v),a+' linked');assert.ok(sw.includes('./ui/'+a+'?v='+v),a+' precached');}
  assert.match(html,/<div id="page-apexpaper" style="display:none" data-priv="off">/);
  assert.match(html,/apexpaper:'page-apexpaper'/);assert.match(html,/data-apex-paper-link/);
  assert.equal(require('../ui/journey.js').pageRoute('#view=apexpaper'),'apexpaper');
});
