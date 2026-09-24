import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, cpSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { riskAdjustWeights, validateTarget } from './riskweights.mjs';
import { gradeDecision, gradeDecisions, buyStats, applyMarks, markFromBars } from './agentic-ledger.mjs';
import { observeTargets, riskDiagnostics, compareActual, shadowSymbols } from './agentic-observatory.mjs';
import { assessResearch, validEvidence } from './agentic-evidence.mjs';
import { targetIdentity } from './agentic-model.mjs';
import { finalTargetExplanation } from './agentic-target-facts.mjs';
import { makeTicket } from './agentic-pending.mjs';
let tests=0; const test=(name,fn)=>{fn();tests++;console.log('ok',name)};
const target={asOf:'2026-09-01',names:[{ticker:'AAA',weightPct:25},{ticker:'BBB',weightPct:25},{ticker:'CCC',weightPct:25},{ticker:'DDD',weightPct:25}]};
test('infeasible concentrated books fail instead of restoring cap violations',()=>{
  assert.throws(()=>riskAdjustWeights([{ticker:'NVDA',weightPct:50},{ticker:'MSFT',weightPct:50}]),/INVALID_TARGET/);
  assert.equal(validateTarget({names:[{ticker:'NVDA',weightPct:100}]}).valid,false);
  for(const names of [[{ticker:'AAA',weightPct:NaN}],[{ticker:'AAA',weightPct:50},{ticker:'aaa',weightPct:50}]]) assert.equal(validateTarget({names}).valid,false);
  const feasible=riskAdjustWeights([{ticker:'NVDA',weightPct:50},{ticker:'MSFT',weightPct:25},{ticker:'SPY',weightPct:25}]);
  assert.equal(validateTarget({names:feasible.names}).valid,true);
  assert.equal(validateTarget({names:feasible.names,riskSettings:{indexMaxPct:10}}).valid,false);
});
const dec={id:'rotation',date:'2026-09-01',spyAt:100,trades:[{sym:'AAA',side:'SELL',dollars:1000,priceAt:100},{sym:'BBB',side:'BUY',dollars:1000,priceAt:100}]};
test('rotation +5, buy excess +2; no signed gross-dollar blend',()=>{
  const g=gradeDecision(dec,{AAA:105,BBB:110,SPY:108},'2026-09-10').grade;
  assert.equal(g.alpha,2);assert.equal(g.rotationPct,5);assert.equal(g.rotationBenefit,50);assert.equal(g.soldReturnPct,5);
});
test('missing benchmark unknown, missing buy prices cannot cherry-pick a basket',()=>{
  const d=gradeDecision(dec,{AAA:105,BBB:110},'2026-09-10');
  assert.equal(d.grade.verdict,'unknown');assert.equal(buyStats([d]).behind,0);assert.equal(buyStats([d]).unknown,1);
  const partial=gradeDecision({...dec,trades:[...dec.trades,{sym:'MISSING',side:'BUY',dollars:1000,priceAt:100}]},{AAA:105,BBB:110,SPY:108},'2026-09-10');
  assert.equal(partial.grade.alpha,null);assert.equal(partial.grade.rotationPct,null);
});
test('fixed horizons require a common date and never use future closes',()=>{
  const idx={AAA:[['2026-09-07',105]],BBB:[['2026-09-08',110]],SPY:[['2026-09-07',108]]};
  assert.equal(markFromBars(dec,idx,5,'2026-09-10'),null);
  idx.BBB=[['2026-09-07',110]];
  assert.equal(markFromBars(dec,idx,5,'2026-09-06'),null);
  assert.equal(markFromBars(dec,idx,5,'2026-09-10').alphaPct,2);
});
test('legacy marks excluded, preserved, and not relabeled as current evidence',()=>{
  const g=gradeDecisions([dec],{AAA:105,BBB:110,SPY:108},'2026-10-12');
  const old={...dec,marks:{5:{alphaPct:99,contribPct:99,src:'live'}}};
  const updated=applyMarks(g,[old],'2026-10-12');
  assert.equal(updated.markStats[5].n,0);assert.equal(updated.decisions[0].legacyMarks[5].alphaPct,99);
  const again=applyMarks(g,updated.decisions,'2026-10-12');assert.equal(again.decisions[0].legacyMarks[5].alphaPct,99);
  assert.ok(updated.byModelVersion['legacy-unversioned']);
});
const bar=(t,c)=>({t,c});
const hist={AAA:[bar('2026-09-01',1),bar('2026-09-02',100),bar('2026-09-03',110)],BBB:[bar('2026-09-02',100),bar('2026-09-03',110)],CCC:[bar('2026-09-02',100),bar('2026-09-03',110)],DDD:[bar('2026-09-02',100),bar('2026-09-03',110)],SPY:[bar('2026-09-02',100),bar('2026-09-03',108)]};
test('shadow waits until after observation, excludes current day, freezes observed marks',()=>{
  const first=observeTargets({target,histDay:hist,asOf:'2026-09-01T18:00:00Z'});
  assert.equal(first.tracks[0].points.length,0);
  const next=observeTargets({prior:first,target,histDay:hist,asOf:'2026-09-04T18:00:00Z'});
  assert.equal(next.tracks[0].startDay,'2026-09-02');assert.equal(next.tracks[0].latest.excessPp,2);
  const changed=structuredClone(hist);changed.AAA[2].c=999;
  const rerun=observeTargets({prior:next,target,histDay:changed,asOf:'2026-09-04T19:00:00Z'});
  assert.deepEqual(rerun.tracks[0].points,next.tracks[0].points);
  const newTarget={...target,asOf:'2026-09-04'};
  const vintage=observeTargets({prior:next,target:newTarget,histDay:hist,asOf:'2026-09-04T20:00:00Z'});
  assert.equal(vintage.tracks.length,2);assert.equal(vintage.tracks[1].points.length,0);
  assert.ok(shadowSymbols(vintage).includes('AAA'));
  assert.equal(next.tracks[0].actual.status,'unavailable');
});
test('verified total-return comparison neutralizes an end-of-day deposit',()=>{
  const rows=[{day:'2026-09-02',equity:1000,cumFlow:0},{day:'2026-09-03',equity:1600,cumFlow:500,previousDay:'2026-09-02'}].map(r=>({...r,verified:true,flowTiming:'end-of-day',source:'broker close'}));
  const a=compareActual(rows,'2026-09-02','2026-09-03','total-return',{model:110});
  assert.equal(a.returnPct,10);assert.equal(a.implementationGapPp,0);
  assert.equal(compareActual(rows,'2026-09-02','2026-09-03','price-return',{model:110}).status,'unavailable');
  rows[1].verified=false;assert.equal(compareActual(rows,'2026-09-02','2026-09-03','total-return',{model:110}).status,'unavailable');
});
test('volatility uses recorded dates and pairs require aligned intervals',()=>{
  const dates=Array.from({length:35},(_,i)=>new Date(Date.UTC(2026,7,1+i)).toISOString().slice(0,10));
  const a=dates.map((t,i)=>bar(t,100*Math.exp(.01*i+Math.sin(i)*.01)));
  const b=a.map(x=>bar(x.t,x.c*2));
  const d=riskDiagnostics([{ticker:'AAA'},{ticker:'BBB'}],{AAA:a,BBB:b},'2026-09-05');
  assert.ok(d.vol[0].annualizedPct>0);assert.equal(d.pairs[0].correlation,1);
  assert.equal(riskDiagnostics([{ticker:'AAA'}],{AAA:a},'2026-10-05').vol[0].annualizedPct,null);
});
const evidence=[{source:'mcp:provider/record-1',asOf:'2026-09-01',claim:'Observed close 100 and 52-week range 80 to 120'}];
test('source dates, missing sleeves and verifier evidence gate promotion',()=>{
  assert.equal(validEvidence(evidence,'2026-08-31'),false);
  const row={status:'observed',score:8,evidence};
  const raw={researchVersion:'evidence-v1',ranking:[{t:'AAA',px:100,hi:120,lo:80,evidence}],research:{evidence:{AAA:{quality:row,momentum:row,growth:row}}},allocation:{picks:[{ticker:'AAA'}]},verdicts:[{t:'AAA',businessOk:true,rec:'buy',evidence}]};
  assert.deepEqual(assessResearch(raw,'2026-09-02').errors,[]);
  raw.research.evidence.AAA.quality={...row,status:'missing'};
  assert.ok(assessResearch(raw,'2026-09-02').errors.length);
  assert.ok(assessResearch({...raw,researchVersion:undefined},'2026-09-02').errors.length);
});
test('target identity follows content and tickets preserve exact decision provenance',()=>{
  const id=targetIdentity(target);assert.notEqual(id,targetIdentity({...target,asOf:'2026-09-02'}));
  assert.equal(makeTicket({targetId:id,modelVersion:'v1'},{asOf:'2026-09-02'}).targetId,id);
  assert.match(finalTargetExplanation(target),/4 active names/);
});
test('scheduled research rejects incomplete evidence without touching canonical target',()=>{
  const root=dirname(fileURLToPath(import.meta.url)), tmp=mkdtempSync(join(tmpdir(),'agentic-sim-'));
  try {
    cpSync(root,join(tmp,'producer'),{recursive:true,filter:p=>!p.includes('/raw')});
    const path=join(tmp,'producer','agentic-target.json'), before=readFileSync(path,'utf8');
    writeFileSync(join(tmp,'candidate.json'),JSON.stringify({picks:target.names}));
    const result=spawnSync(process.execPath,[join(tmp,'producer','finalize-target.mjs'),join(tmp,'candidate.json'),'--write'],{encoding:'utf8'});
    assert.notEqual(result.status,0);assert.match(result.stderr,/RESEARCH_INCOMPLETE/);assert.equal(readFileSync(path,'utf8'),before);
  } finally {rmSync(tmp,{recursive:true,force:true});}
});
// Simulate the complete sandbox workflow and canonical promotion without network or broker calls.
{
  const root=dirname(fileURLToPath(import.meta.url));
  const symbols=['NVDA','MSFT','JPM','JNJ','UNP','XOM','NEM','CAT','WMT','SPY'];
  const universe=symbols.map((t,i)=>({t,sec:'Sector '+i,px:100,hi:110,lo:90,pe:20,evidence}));
  const picks=universe.map(u=>({ticker:u.t,sector:u.sec,weightPct:10,dollars:100,entryZone:'95-105',stop:90,target:120,thesis:'Synthetic test',rr:'2:1'}));
  const source=readFileSync(join(root,'../.claude/workflows/agentic-research.js'),'utf8').replace('export const meta','const meta');
  const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
  const run=new AsyncFunction('args','agent','parallel','phase','log',source);
  const agent=async (_prompt,opts)=>{
    if(opts.label==='source-inputs') return {rows:universe};
    if(opts.label==='synthesize') return {summary:'Synthetic proposal',picks};
    if(opts.label.startsWith('verify:')) return {verdicts:opts.label.slice(7).split('+').map(ticker=>({ticker,businessOk:true,recommendation:'buy',confidence:8,supports:true,entryQuality:6,biggestRisk:'test',entryRisk:'test',evidence}))};
    return {scores:symbols.map(ticker=>({ticker,score:8,status:'observed',note:'Synthetic test',evidence}))};
  };
  // Old server-side args shape: no evidence. The workflow's source-inputs stage must fill it.
  const raw=await run({universe:universe.map(({evidence,...u})=>u),book:1000},agent,fs=>Promise.all(fs.map(f=>f())),()=>{},()=>{});
  assert.equal(raw.researchVersion,'evidence-v1');assert.deepEqual(assessResearch(raw,'2026-09-02').errors,[]);
  const tmp=mkdtempSync(join(tmpdir(),'agentic-e2e-'));
  try {
    cpSync(root,join(tmp,'producer'),{recursive:true,filter:p=>!p.includes('/raw')});
    writeFileSync(join(tmp,'candidate.json'),JSON.stringify(raw));
    const promoted=spawnSync(process.execPath,[join(tmp,'producer/finalize-target.mjs'),join(tmp,'candidate.json'),'--asOf','2026-09-02','--no-prior','--write'],{encoding:'utf8'});
    assert.equal(promoted.status,0,promoted.stderr);
    const final=JSON.parse(readFileSync(join(tmp,'producer/agentic-target.json')));
    assert.equal(final.modelVersion,'mandate-a-ai-evidence-v1');assert.equal(final.research.coverage,1);assert.equal(validateTarget(final).valid,true);
    // Freeze the process clock in the test harness, never add a production trading override.
    const clock=join(tmp,'clock.mjs');
    writeFileSync(clock,`const OriginalDate=Date;globalThis.Date=class extends OriginalDate {constructor(...args){super(...(args.length?args:['2026-09-16T15:00:00Z']))}static now(){return OriginalDate.parse('2026-09-16T15:00:00Z')}};`);
    const broken={...final,names:[{ticker:'NVDA',weightPct:100}]};
    writeFileSync(join(tmp,'producer/agentic-target.json'),JSON.stringify(broken));
    writeFileSync(join(tmp,'producer/agentic-pending.json'),JSON.stringify({id:'test',created:'2026-09-16',status:'confirmed',targetId:targetIdentity(broken),legs:{buysNow:[{sym:'NVDA',dollars:100}]}}));
    const gated=spawnSync(process.execPath,['--import',clock,join(tmp,'producer/agentic-exec-gate.mjs')],{encoding:'utf8',env:{...process.env,PF_AGENTIC_AUTO:'on',PF_PASSPHRASE:''}});
    assert.equal(gated.status,30);assert.match(gated.stdout,/DEGRADED.*invalid research target/);assert.doesNotMatch(gated.stdout,/EXEC_TRADE|EXEC_BUYS/);
  } finally {rmSync(tmp,{recursive:true,force:true});}
  tests++;console.log('ok full scheduled workflow, promotion and resumed-ticket rejection simulation');
}
console.log(`${tests} correctness regressions passed`);
