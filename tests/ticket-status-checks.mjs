// v240: one wording for agentic ticket status on every screen. Called from journey-browser.mjs (the CI suite).
// One context, one page, synthetic data only; nothing here submits an order. For each ticket status fixture the
// text on Today, Agentic Plan ("Where the plan stands"), the Agentic Accounts strip, the market tape and Activity
// must come from PFExperienceModel.ticketStatus - never a raw status word or one of the retired phrases.
import assert from 'node:assert/strict';

const VP=[[320,568,{}],[390,844,{}],[466,677,{right:84}],[960,676,{right:100}],[677,466,{left:85}]];
const ID='synthetic-wording-ticket';
const FIX=[
  ['proposed-needs-approval',{status:'proposed',autoEligible:false}],
  ['auto-eligible-queued',{status:'proposed',autoEligible:true}],
  ['owner-confirmed-queued',{status:'confirmed'}],
  ['sells-submitted',{status:'sells-placed'}],
  ['buys-submitted',{status:'buys-placed'}],
  ['done',{status:'done',completedAt:'2026-11-12T15:00:00Z'}],
  ['aborted',{status:'aborted'}],
  ['cancelled',{status:'cancelled'}],
  ['rejected',{status:'rejected'}],
  ['partial-fill',{status:'partial-fill'}],
  ['unknown',{status:'weird-state'}],
];
// Retired phrases and raw stored words. Word-bounded so "Recorded ticket complete" or "Submission reported" never trip them.
const RETIRED=[/sells are in/i,/buys are in/i,/sells placed/i,/buys placed/i,/\bTicket completed\b/,/waiting on your confirm\b/i,/awaiting your confirm\b/i,
  /\bsells-placed\b/,/\bbuys-placed\b/,/\bpartial-fill\b/,/·\s*(done|proposed|confirmed)\s*·/i,/Rebalance in flight[^.]*·\s*(done|aborted)\b/i];

export async function runTicketStatusChecks({browser,base,sample,stub,apex,writes=[],shots=null}){
  const errors=[];
  const ctx=await browser.newContext({viewport:{width:390,height:844},timezoneId:'America/New_York',serviceWorkers:'block'});
  const page=await ctx.newPage();
  page.on('pageerror',e=>errors.push(e.message));
  page.on('request',r=>{if(!['GET','HEAD'].includes(r.method()))writes.push(r.url());});
  await page.addInitScript(stub);
  await page.addInitScript(()=>{if(!sessionStorage.getItem('v240-init')){localStorage.setItem('pf_acct','agentic');localStorage.setItem('pf_experience_route','today');sessionStorage.setItem('v240-init','1');}});
  await page.route('https://**/*',r=>r.request().url().startsWith(base)?r.continue():r.abort());
  await page.route(/\/data\.json(?:\?.*)?$/,r=>r.fulfill({json:sample}));
  await page.route(/\/data\/apex-targets\.json(?:\?.*)?$/,r=>r.fulfill({json:apex}));
  await page.goto(base);await page.waitForFunction(()=>window.__SNAP&&window.PFJourney&&window.PFTape);
  const cdp=await ctx.newCDPSession(page);
  const settle=()=>page.waitForTimeout(120);
  // The strip sits inside the folded "Target comparison & trade review" details on the Account page; open it so it is measured.
  const openStrip=()=>page.evaluate(()=>{const d=document.querySelector('details.ag-trade-review');if(d)d.open=true;});
  const nav=(route,account)=>page.evaluate(({route,account})=>PFExperience.navigate(route,account?{account}:{}),{route,account});
  const original=await page.evaluate(()=>JSON.stringify(__DATA.agentic.pending||null));
  const setTicket=(fix)=>page.evaluate(({fix,ID})=>{
    __DATA.agentic.pending={id:ID,created:new Date().toISOString().slice(0,10),legs:{sells:[{sym:'AAA'}],buysNow:[{sym:'BBB'}]},turnover:1200,
      history:[{at:new Date(Date.now()-3600e3).toISOString(),to:'proposed'},{at:new Date().toISOString(),to:fix.status}],...fix};
    __experienceRefresh();renderAgenticCard();renderAgenticPlan();document.dispatchEvent(new Event('pf:render'));PFTape.render();
  },{fix,ID});
  const text=sel=>page.evaluate(sel=>[...document.querySelectorAll(sel)].map(e=>e.textContent).join(' | '),sel);
  const noOverflow=label=>page.evaluate(label=>{
    const w=document.documentElement.clientWidth,bad=[];
    for(const e of document.querySelectorAll('#pf-tape,#page-ex-today .td-status-row,#page-ex-today .td-attention-row,#agentic-content .fund-note,#plan-agentic-app .fund-note,#page-ex-activity .ex-status-strip,#page-ex-activity .ex-row,#page-ex-activity .ex-timeline li')){
      const r=e.getBoundingClientRect();if(r.width&&(r.right>w+1||r.left<-1))bad.push((e.className||e.id)+':'+Math.round(r.left)+'-'+Math.round(r.right));
    }
    return {over:document.documentElement.scrollWidth>innerWidth+1,bad,label};
  },label);
  const check=(o)=>{assert.equal(o.over,false,o.label+': page overflows');assert.deepEqual(o.bad,[],o.label+': element outside the viewport');};
  try{
    const model=await page.evaluate(fixes=>fixes.map(([n,f])=>[n,PFExperienceModel.ticketStatus(f)]),FIX);
    const seen=new Set();
    for(const [i,[name,fix]] of FIX.entries()){
      const t=model[i][1];seen.add(t.label+'|'+t.compact);
      await setTicket(fix);
      // Today
      await nav('today');await settle();
      const today=await text('#page-ex-today');
      assert.ok(today.includes(t.label),name+': Today shows the map label "'+t.label+'"');
      assert.ok(today.includes(t.detail),name+': Today shows the map detail');
      // Agentic Plan
      await nav('plan','agentic');await page.evaluate(()=>renderAgenticPlan());await settle();
      const plan=await text('#b-agp-status .fund-note');
      assert.ok(plan.includes(t.compact),name+': Plan shows "'+t.compact+'" got '+plan.slice(0,300));
      assert.ok(plan.includes(t.terminal?'Last ticket':t.key==='unknown'?'Latest ticket':'Rebalance in flight'),name+': Plan heading');
      // Agentic Accounts strip
      // v245 workspace: the trade review (with this strip) lives with All Positions, i.e. Agentic > Positions; Overview carries the ticket in its action list.
      await nav('holdings','agentic');await page.evaluate(()=>renderAgenticCard());await page.evaluate(()=>{const c=document.querySelector('#agentic-app>[data-sec="holdings"]');if(c&&window.__pfFold&&__pfFold.open)__pfFold.open(c);});await openStrip();await settle();
      const strip=await text('#agentic-content .fund-note');
      assert.equal(await page.locator('#agentic-content .fund-note').first().isVisible(),true,name+': the strip is visible');
      assert.ok(strip.includes(t.compact),name+': strip shows "'+t.compact+'" got '+strip.slice(0,300));
      if(t.terminal){assert.ok(!/in flight/i.test(strip),name+': a finished ticket is not "in flight"');assert.ok(/Last ticket/.test(strip),name+': strip says Last ticket');assert.ok(!/reflects the book/i.test(strip),name+': strip does not promise a fill');}
      else if(t.key!=='unknown')assert.ok(/Rebalance in flight/.test(strip),name+': an unfinished ticket is in flight');
      // Tape pill (the tape hides done / aborted / cancelled tickets, as before)
      const tape=await text('#pf-tape .tk-track .tk-half:first-child');
      if(['done','aborted','cancelled'].includes(fix.status))assert.ok(!/Ticket<\/?/.test(tape)&&!tape.includes(t.label),name+': the tape draws no pill for a finished ticket');
      else assert.ok(tape.includes(t.compact),name+': tape pill shows "'+t.compact+'" got '+tape.slice(-300));
      // Activity: strip, record row and timeline
      await nav('activity','agentic');await settle();
      const act=await text('#page-ex-activity');
      assert.ok(act.includes(t.compact),name+': Activity shows "'+t.compact+'"');
      const tl=await page.evaluate(fix=>PFExperienceModel.ticketStatus({...__DATA.agentic.pending,status:fix.status}).compact,fix);
      assert.ok((await text('#page-ex-activity .ex-timeline'))?.includes(tl)||act.includes(tl),name+': Activity timeline uses the map');
      if(fix.status==='done'){assert.ok(act.includes('Recorded ticket complete'),name+': completion row uses the map label');assert.ok(/does not independently confirm broker fills/i.test(act),name+': Activity carries the record-not-fill caveat');}
      // Nothing raw, nothing retired, on any surface
      const all=[today,plan,strip,tape,act].join(' ¦ ');
      for(const re of RETIRED)assert.doesNotMatch(all,re,name+': retired or raw phrase '+re);
      if(t.known)assert.ok(!all.includes('“'+fix.status+'”'),name+': no raw status quoted');
      else assert.ok(/Status needs review: “weird-state”/.test(act)&&/Status needs review: “weird-state”/.test(strip),name+': unknown status is shown explicitly with its raw value');
    }
    assert.equal(seen.size,FIX.length,'every fixture status reads differently from every other (queued, submitted and failed states stay distinct)');
  }finally{}
  // Widths: no overflow on Today, Plan, strip, tape and Activity for the longest texts (done caveat, unknown raw, owner-confirmed queued).
  for(const name of ['done','owner-confirmed-queued','unknown','sells-submitted']){
    await setTicket(Object.fromEntries(FIX)[name]);
    for(const [w,h,ins] of VP){
      await page.setViewportSize({width:w,height:h});await cdp.send('Emulation.setSafeAreaInsetsOverride',{insets:{top:0,bottom:0,right:ins.right||0,left:ins.left||0}});
      for(const [route,acct,after] of [['today',null,null],['plan','agentic','renderAgenticPlan'],['accounts','agentic','renderAgenticCard'],['activity','agentic',null]]){
        await nav(route,acct);if(after)await page.evaluate(f=>window[f](),after);if(route==='accounts')await openStrip();await settle();
        check(await noOverflow(name+' '+route+' '+w+'x'+h));
      }
    }
  }
  await cdp.send('Emulation.setSafeAreaInsetsOverride',{insets:{top:0,bottom:0,right:0,left:0}});await page.setViewportSize({width:390,height:844});
  if(shots){ // screenshots for review (not used by CI)
    for(const name of ['sells-submitted','done']){
      await setTicket(Object.fromEntries(FIX)[name]);
      for(const [route,acct,after,file] of [['today',null,null,'today'],['plan','agentic','renderAgenticPlan','plan'],['accounts','agentic','renderAgenticCard','account'],['activity','agentic',null,'activity']]){
        await nav(route,acct);if(after)await page.evaluate(f=>window[f](),after);if(route==='accounts')await openStrip();await settle();await page.evaluate(sel=>{const e=sel&&document.querySelector(sel);if(e)window.scrollTo(0,e.getBoundingClientRect().top+scrollY-150);else scrollTo(0,0);},{today:'.td-monitor',plan:'#b-agp-status',account:'#agentic-content .fund-note',activity:'.ex-status-strip'}[file]);await settle();await page.screenshot({path:shots+'/'+file+'-'+name+'.png'});
      }
    }
  }
  await page.evaluate(o=>{__DATA.agentic.pending=JSON.parse(o);__experienceRefresh();},original);
  assert.deepEqual(errors,[]);
  await ctx.close();
}
