// v257: Apex v2.9 Paper page — measured results (eval-1 raw, sim-1 simulated), weekly cohorts and the rejected-names
// ledger. Synthetic documents only; no network, no account data. The view reads what the engine published and
// never estimates: a missing number is "—", raw and simulated stay in separate tables, nothing here feeds live Apex.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const A=require('../ui/apex-paper.js');
const RUN='2026-11-24T07:52:00-05:00', NOW=Date.parse(RUN)+36e5, A1='2026-11-23T07:52:00-05:00';
const hz=(x)=>({n:1,hit:1,avgAlpha:x,medianAlpha:x,avgAlphaNet:+(x-0.2).toFixed(2)});
const arm=(label,cohorts,h={})=>({label,cohorts,entered:cohorts,horizons:h,descriptive:true});
const pk=(sym,gate,st='entered',px=10)=>({sym,gate,source:/^live/.test(gate)?'live v2.8':'paper v2.9',composite:6.1,entryRule:'next session open',entryPx:st==='entered'?px:null,entryDate:st==='entered'?'2026-11-24':null,status:st});
const base={schema:1,paper:true,rulesVersion:'v2.9-paper-1',asOf:RUN,status:'ok',lastSuccessAsOf:RUN,nextRun:'2026-11-25T07:52:00-05:00',
  universe:{eligible:10,scanned:10,complete:true},funnel:{qualified:0,near:0,emerging:0,rejected:10},ranked:{qualified:[],near:[],emerging:[]},batch:{picks:[],blocked:[],cashPct:100},
  cohorts:[{asOf:A1,picks:[{sym:'AAA',w:30,status:'entered',entryPx:100,entryDate:'2026-11-24'}]}],marks:[],metrics:{}};
const full=(extra={})=>({...base,
  skipped:[{date:'2026-11-16',asOf:'2026-11-16T07:52:00-05:00',reason:'coverage partial: slice 7'}],
  shadow:{cohorts:[{asOf:A1,liveIncluded:true,liveStatus:'added-late',picks:[pk('DXCM','live-pick','entered',70),pk('ZS','live-tech-cap'),pk('RRR','live-rr'),pk('CCC','paper-pe'),pk('DDD','paper-rs3','pending')]}],
    marks:[{asOf:A1,sym:'ZS',horizon:5,ret:6,spyRet:1,alpha:5},{asOf:A1,sym:'CCC',horizon:5,ret:-3,spyRet:1,alpha:-4}],
    metrics:{'live-tech-cap':{label:'Live v2.8: blocked by the 40% tech cap',5:{n:1,hit:1,avgAlpha:5,avgAlphaNet:4.8}}},live:{asOf:A1,status:'added-late',note:null},note:'Rejected-names ledger, PAPER ONLY.'},
  evaluation:{version:'eval-1',arms:{live:arm('Live v2.8 picks',1,{5:hz(3)}),paper:arm('v2.9 paper picks',1,{5:hz(2)}),rejectedLive:arm('Rejected by a live rule',1,{5:hz(5)}),rejectedPaper:arm('Rejected by one paper test',1,{5:hz(-4)})},
    simulated:null,simulatedNote:'Simulated portfolio results are not measured yet: they need a daily price path per entered name.',note:'Raw per-name results.'},...extra});

test('results: a file from before eval-1 says results come with the next run, never a blank or a zero',()=>{
  const r=A.research(base,NOW); assert.equal(r.present,false); assert.equal(r.ledgerPresent,false);
  const h=A.html(base,NOW);
  assert.match(h,/data-apx-res="waiting"/); assert.match(h,/data-apx-ledger="waiting"/);
  assert.match(h,/data-sec="apx-results"/); assert.match(h,/data-sec="apx-rejected"/); assert.match(h,/data-sec="apx-history"/);
  assert.ok(!/card-title/.test(h),'no shared card header: it would add the My view pin button, and this page has no button');
});
test('results: four arms in the locked order; before any 30-day mark the 5-day table is labelled an early look',()=>{
  const r=A.research(full(),NOW);
  assert.deepEqual(r.arms.map(a=>a.key),['live','paper','rejectedLive','rejectedPaper']);
  assert.equal(r.shownH,5); assert.equal(A.PRIMARY_H,30); assert.equal(A.MIN_COHORTS,12);
  const h=A.html(full(),NOW);
  assert.match(h,/data-apx-early/); assert.match(h,/1 of 12 weeks/);
  assert.match(h,/data-apx-arm="rejectedLive"><th>Rejected by a live rule<\/th><td>1<\/td><td>1<\/td><td>100%<\/td><td class="apx-up">\+4\.8%<\/td>/);
  const r30=A.research(full({evaluation:{...full().evaluation,arms:{...full().evaluation.arms,paper:arm('v2.9 paper picks',1,{5:hz(2),30:hz(7)})}}}),NOW);
  assert.equal(r30.shownH,30,'the 30-day primary horizon wins once any arm has it');
  assert.ok(!A.html(full({evaluation:{...full().evaluation,arms:{...full().evaluation.arms,paper:arm('v2.9 paper picks',1,{30:hz(7)})}}}),NOW).includes('data-apx-early'));
});
test('results: graded nowhere yet gives "about" dates from the first Monday, holidays not counted',()=>{
  const ev={...full().evaluation,arms:{live:arm('L',1),paper:arm('P',1),rejectedLive:arm('RL',1),rejectedPaper:arm('RP',1)}};
  const r=A.research(full({evaluation:ev,skipped:[]}),NOW);
  assert.equal(r.graded,false); assert.deepEqual([r.firstMarks.h5,r.firstMarks.h30],['2026-12-01','2027-01-05']);
  assert.match(A.html(full({evaluation:ev,skipped:[]}),NOW),/First 5-day marks about Tue, Dec 1/);
  assert.equal(A.addWeekdays('2026-11-27',1),'2026-11-30','Friday plus one weekday is Monday');
});
test('simulated: separate table when sim-1 exists, an honest wait line when it does not',()=>{
  assert.match(A.html(full(),NOW),/data-apx-sim="off"/);
  const sa=(x)=>({cohorts:1,inProgress:1,names:2,stops:1,avgRetNetPct:x,avgAlphaNetPct:x-1,worstDrawdownPct:-3.81,avgExposurePct:48.5});
  const h=A.html(full({evaluation:{...full().evaluation,simulated:{version:'sim-1',holdDays:30,arms:{paper:sa(0.9),live:sa(-2)},note:'Simulated from stored daily prices.'}}}),NOW);
  assert.match(h,/data-apx-sim="on"/); assert.match(h,/1 \(\+1 open\)/); assert.match(h,/-3\.8%/); assert.match(h,/never added together/);
});
test('ledger: every frozen name is listed with its rule, entry and latest mark; groups and rules filter',()=>{
  const r=A.research(full(),NOW);
  assert.equal(r.ledger.length,5); assert.deepEqual(r.ledger.map(x=>x.gate.group),['live-pick','live-rej','live-rej','paper-rej','paper-rej']);
  const zs=r.ledger.find(x=>x.sym==='ZS'); assert.equal(zs.latest.alpha,5); assert.equal(zs.gate.label,'Live v2.8: blocked by the 40% tech cap');
  assert.equal(r.ledger.find(x=>x.sym==='DDD').status,'pending');
  assert.deepEqual(r.byGate.map(g=>g.gate.key),['live-pick','live-tech-cap','live-rr','paper-pe','paper-rs3']);
  assert.equal(r.byGate.find(g=>g.gate.key==='live-tech-cap').avgAlphaNet,4.8);
  const h=A.html(full(),NOW);
  assert.match(h,/data-apx-grp="live-rej"/); assert.match(h,/name="grp" value="paper-rej"><span>Paper rejects <i>2<\/i>/);
  assert.match(h,/<option value="paper-pe">P\/E · 1<\/option>/);
  assert.equal((h.match(/class="apx-lrow"/g)||[]).length,5,'every ledger name once');
  const odd=A.research(full({shadow:{...full().shadow,cohorts:[{asOf:A1,picks:[pk('ODD','paper-new-test')]}]}}),NOW);
  assert.equal(odd.ledger[0].gate.group,'paper-rej','an unknown paper rule is still listed, never dropped');
});
test('history: weeks newest first, a skipped Monday is shown with its reason, live copy status named',()=>{
  const r=A.research(full(),NOW);
  assert.deepEqual(r.history.map(h=>h.day),['2026-11-23','2026-11-16']);
  assert.deepEqual([r.history[0].livePicks,r.history[0].liveRej,r.history[0].paperRej,r.history[0].liveStatus],[1,2,2,'added-late']);
  assert.equal(r.history[1].skipped,'coverage partial: slice 7');
  const h=A.html(full(),NOW); assert.match(h,/Skipped<\/span> coverage partial: slice 7/); assert.match(h,/Live names added late/);
  assert.match(A.html(full({shadow:{...full().shadow,cohorts:[{...full().shadow.cohorts[0],liveStatus:'missing',liveNote:'Live v2.8 names missing for this week.'}]}}),NOW),/Live names missing/);
});
test('the new cards stay paper-only: no button, no order words, nothing to place',()=>{
  const h=A.html(full(),NOW);
  assert.ok(!/<button/i.test(h)); assert.ok(!/\b(place order|buy now|sell now|submit)\b/i.test(h));
});
