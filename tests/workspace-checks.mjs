// Apex / Agentic workspace (Jack, Nov 17 2026, after the folded-Duo screenshot of Apex > Plan): one header, one tab row
// (Overview · Positions · Research · Actions), freshness stamps, decision cards, an action list. Synthetic data only; no orders.
// Standalone and lean: node tests/workspace-browser.mjs   (PF_PREVIEW_URL, PF_CHROME, PF_PLAYWRIGHT as in the other browser suites)
// Called from journey-browser.mjs (reusing its browser, no extra launch); also runnable alone: node tests/workspace-checks.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
export async function runWorkspaceChecks({browser,base,sample,stub,apex:apexT,writes=[]}){
const errors=[];
const STAMP=/^(Account|Research|Last scan)\s+[A-Z][a-z]{2} \d{1,2}, \d{1,2}:\d{2}\s?(AM|PM) ET$/;   // full date + time + AM/PM (+ zone)
const DATE_ONLY=/^(Research|Last scan)\s+[A-Z][a-z]{2} \d{1,2} \(date only\)$/;                     // sources that record a day, never a time
async function open({data=sample,viewport={width:390,height:844},inset=null,seed={}}={}){
  const ctx=await browser.newContext({viewport,timezoneId:'America/New_York',serviceWorkers:'block'});const p=await ctx.newPage();
  p.on('pageerror',e=>errors.push(e.message));p.on('request',r=>{if(!['GET','HEAD'].includes(r.method()))writes.push(r.url());});
  await p.addInitScript(stub);
  await p.addInitScript(s=>{if(!sessionStorage.getItem('ws-init')){const d={pf_acct:'main',pf_experience_route:'today',...s};for(const[k,v]of Object.entries(d))localStorage.setItem(k,v);sessionStorage.setItem('ws-init','1');}},seed);
  await p.route('https://**/*',r=>r.request().url().startsWith(base)?r.continue():r.abort());
  await p.route(/\/data\.json(?:\?.*)?$/,r=>r.fulfill({json:data}));await p.route(/\/data\/apex-targets\.json(?:\?.*)?$/,r=>r.fulfill({json:apexT}));
  await p.goto(base);await p.waitForFunction(()=>window.__SNAP&&window.PFJourney);
  if(inset){const c=await ctx.newCDPSession(p);await c.send('Emulation.setSafeAreaInsetsOverride',{insets:{top:0,bottom:0,right:inset.right||0,left:inset.left||0}});}
  await p.waitForTimeout(400);return {ctx,p};
}
const settle=p=>p.waitForTimeout(300);
const area=a=>`.ex-main [data-ex-area="${a}"]`,tab=t=>`#ex-subnav [data-ws-tab="${t}"]`;
const st=p=>p.evaluate(()=>({route:PFExperience.route,account:PFExperience.account,area:PFExperience.area,j:PFJourney.state}));
const areas=p=>p.evaluate(()=>[...document.querySelectorAll('.ex-main [data-ex-area]')].filter(b=>b.getAttribute('aria-current')==='page').map(b=>b.dataset.exArea));
// Top of the first dollar figure in the page body (not the header, ticker or bottom nav).
const firstMoney=p=>p.evaluate(()=>{for(const e of document.querySelectorAll('body *')){if(e.children.length||e.closest('#ex-top,.ex-main,#pf-tape,#pf-fresh,script,style'))continue;
  const r=e.getBoundingClientRect(),cs=getComputedStyle(e);if(r.height>0&&cs.visibility!=='hidden'&&/\$\d/.test(e.textContent||'')&&r.top>0)return Math.round(r.top);}return null;});
const goArea=async(p,a)=>{await p.locator(area(a)).click();await settle(p);};

{
  // ── 1. One header, one tab row; the removed layers are gone; mapping Overview/Positions/Research/Actions ──
  for(const [A,acct] of [['apex','main'],['agentic','agentic']]){
    const {ctx,p}=await open();await goArea(p,A);
    assert.deepEqual(await p.locator('#ex-subnav button').allInnerTexts().then(a=>a.map(x=>x.trim())),['Overview','Positions','Research','Actions'],A+': exactly four tabs');
    for(const sel of ['.card-nav:visible','.pj-steps:visible','.pj-metrics:visible','#acct-seg-wrap:visible','#plan-seg-wrap:visible','#ex-classic:visible'])assert.equal(await p.locator(sel).count(),0,`${A}: ${sel} is not shown`);
    assert.equal(await p.locator('#pj-back').getAttribute('aria-label')!==null,true,A+': Back keeps its accessible name');
    assert.match((await p.locator('#pj-back').innerText()).trim(),/^←$/,A+': Back is icon-only');
    assert.match(await p.locator('#ex-context').innerText(),acct==='main'?/^Self-directed · ••••0741$/:/^Automated · ••••3900$/,A+': identity line');
    for(const [t,route] of [['overview','accounts'],['positions','holdings'],['actions','plan']]){await p.locator(tab(t)).click();await settle(p);const s=await st(p);
      assert.deepEqual([s.route,s.account,s.area],[route,acct,A],`${A}: ${t} tab`);assert.equal(await p.locator(tab(t)).getAttribute('aria-current'),'page');}
    // The holding selector stays on Positions and Research.
    await p.locator(tab('positions')).click();await settle(p);assert.equal(await p.locator('#pj-symbol').isVisible(),true,A+': selector on Positions');
    // Research entered from the area keeps the area highlighted across refresh, Back and Forward; a bare #view=analyze is Research.
    await p.locator(tab('research')).click();await settle(p);
    assert.deepEqual([(await st(p)).route,...(await areas(p))],['analyze',A],A+': Research tab keeps the area highlighted');
    assert.equal(await p.locator(tab('research')).getAttribute('aria-current'),'page');assert.equal(await p.locator('#pj-symbol').isVisible(),true,A+': selector on Research');
    await p.reload();await p.waitForFunction(()=>window.__SNAP&&window.PFJourney);await settle(p);assert.deepEqual(await areas(p),[A],A+': origin survives a refresh');
    await p.locator(tab('actions')).click();await settle(p);await p.goBack();await settle(p);assert.deepEqual([(await st(p)).route,...(await areas(p))],['analyze',A],A+': Back');
    await p.goForward();await settle(p);assert.equal((await st(p)).route,'plan',A+': Forward');
    await ctx.close();
  }
  {const {ctx,p}=await open({seed:{pf_acct:'main'}});await p.goto(base+'#view=analyze');await p.reload();await p.waitForFunction(()=>window.__SNAP&&window.PFJourney);await settle(p);
   assert.deepEqual(await areas(p),['research'],'a bare #view=analyze highlights Research');await ctx.close();}

  // ── 2. Vertical budget above the first investment number (chrome rows before → after, measured on v241: 328 / 348 px) ──
  for(const [name,vp,inset,budget] of [['466x677',{width:466,height:677},{right:84},{accounts:280,holdings:360}],['390x844',{width:390,height:844},null,{accounts:340,holdings:420}]]){
    for(const [A,acct] of [['apex','main'],['agentic','agentic']]){
      const {ctx,p}=await open({viewport:vp,inset});await goArea(p,A);
      for(const [t,route] of [['overview','accounts'],['positions','holdings']]){await p.locator(tab(t)).click();await settle(p);await p.evaluate(()=>scrollTo(0,0));
        const y=await firstMoney(p);assert.ok(y!==null&&y<=budget[route],`${name} ${A} ${t}: first dollar figure at ${y}px (budget ${budget[route]})`);}
      await ctx.close();
    }
  }

  // ── 3. Freshness stamps: labelled, full date + time + AM/PM, real sources only; stale is flagged ──
  for(const [A,expect] of [['apex',['Research','Last scan']],['agentic',['Research']]]){
    const {ctx,p}=await open();await goArea(p,A);const stamps=await p.locator('#ws-stamps .ws-stamp').evaluateAll(n=>n.map(e=>({text:e.innerText.replace(/\s+/g,' ').trim(),key:e.dataset.stamp,state:e.dataset.state})));
    assert.deepEqual(stamps.map(x=>x.text.split(/ (?=[A-Z][a-z]{2} \d)/)[0].replace('⚠ ','')),expect,A+': stamp labels (a stamp with no source is omitted)');
    for(const s of stamps){const t=s.text.replace('⚠ ','');assert.ok(STAMP.test(t)||DATE_ONLY.test(t),`${A}: "${s.text}" is a full date and time with AM/PM (or a recorded day, flagged date only)`);}
    assert.equal(stamps.some(s=>/^Account/.test(s.text)),false,A+': no Account stamp (the freshness bar is the one account time)');
    assert.equal(await p.locator('.ws-stamp').first().evaluate(e=>e.getBoundingClientRect().right<=innerWidth+1),true);
    await ctx.close();
  }
  {const old=structuredClone(sample);old.generatedAt=new Date(Date.now()-6*3600e3).toISOString();
   const {ctx,p}=await open({data:old});await goArea(p,'apex');
   assert.match(await p.locator('#pf-fresh-left').innerText(),/^⚠️/,'stale account snapshot: the one account stamp (freshness bar) warns');
   assert.equal(await p.locator('#ws-stamps .ws-stamp[data-stamp="account"]').count(),0,'no second account stamp');await ctx.close();}

  // ── 4. Position card: one card per holding, fields equal the All Positions table, stage line = journey transitions ──
  for(const [A,acct] of [['apex','main'],['agentic','agentic']]){
    const {ctx,p}=await open();await goArea(p,A);await p.locator(tab('positions')).click();await settle(p);
    const rows=await p.evaluate(a=>__pfPosRows(a).map(r=>r.symbol),acct);const cards=await p.locator('.ws-pos').count();
    assert.equal(cards,rows.length,A+': one card per holding');
    const table=await p.locator(acct==='main'?'#pos-table tbody':'#pos-table-ag tbody').innerText();
    const open1=p.locator('.ws-pos.ws-open').first(),sym=await open1.getAttribute('data-ws-sym');
    const dd=await open1.locator('dd').allInnerTexts();assert.equal(dd.length,6,A+': value, gain, return, today, risk, '+(acct==='main'?'stop/target':'target/drift'));
    const row=(await p.locator((acct==='main'?'#pos-table':'#pos-table-ag')+' tbody tr',{has:p.locator('.sym',{hasText:sym})}).first().evaluate(e=>e.textContent)).replace(/\s+/g,' ');
    for(const v of dd.slice(0,3).filter(x=>/\d/.test(x)))assert.ok(row.includes(v.split(' · ')[0].trim())||table.includes(v.trim()),`${A} ${sym}: "${v}" is the table's own figure`);
    assert.ok(/[\d.]+% of book/.test(await open1.innerText()),A+': weight');assert.match(await open1.locator('.ws-pos-px').innerText(),/\$|—/,A+': price');
    assert.equal(await open1.locator('.ws-next').count(),1,A+': next action line (— when none is recorded)');
    assert.doesNotMatch(await p.locator('.ws-pos').first().innerText(),/place order|execute|market order/i,A+': no trading controls');
    if(acct==='agentic')assert.doesNotMatch(await p.locator('#ws-stamps, .ws-pos, .ws-acts').allInnerTexts().then(a=>a.join(' ')),/\b(you (should|must|need to) (buy|sell|place)|place (a |an )?(buy|sell|order)|manual)\b/i,'Agentic: no manual-action wording');
    // stage links call the same journey transitions
    await open1.locator('[data-pj-go="analyze"]').click();await settle(p);assert.deepEqual([(await st(p)).route,(await st(p)).j.symbol,...(await areas(p))],['analyze',sym,A],A+': Research stage link');
    await p.goBack();await settle(p);assert.equal((await st(p)).route,'holdings',A+': Back returns to Positions');
    await p.locator('.ws-pos.ws-open [data-pj-go="plan"]').first().click();await settle(p);assert.deepEqual([(await st(p)).route,(await st(p)).account],['plan',acct],A+': Plan stage link');
    await ctx.close();
  }

  // ── v244 placement: the paper view is an Overview row and keeps its pointer under the live Apex card (Actions); Apex-only; no fifth tab ──
  {const {ctx,p}=await open();await goArea(p,'apex');
   assert.equal(await p.locator('#ex-subnav button').count(),4,'no fifth tab for the paper view');
   await p.locator(tab('overview')).click();await settle(p);await p.locator('.ws-row[data-ex-route="apexpaper"]').click();await settle(p);
   assert.deepEqual([(await st(p)).route,...(await areas(p))],['apexpaper','apex'],'Overview row opens the paper view, Apex highlighted');
   assert.equal(await p.locator('#ex-subnav [aria-current="page"]').count(),0,'no workspace tab claims the paper page');
   await p.goto(base+'#view=apexpaper');await p.reload();await p.waitForFunction(()=>window.__SNAP&&window.PFJourney);await settle(p);assert.deepEqual(await areas(p),['apex'],'#view=apexpaper highlights Apex');
   await p.locator(tab('actions')).click();await settle(p);assert.equal(await p.locator('[data-apx-pointer]:visible').count()>0,true,'the pointer under the live Apex card stays on Actions');
   await ctx.close();
   const a=await open();await goArea(a.p,'agentic');await a.p.locator(tab('overview')).click();await settle(a.p);
   assert.equal(await a.p.locator('.ws-row[data-ex-route="apexpaper"], [data-apx-pointer]:visible').count(),0,'never in Agentic');await a.ctx.close();}

  // ── 5. Action list: existing items only, each opens its destination; explicit empty state; privacy masks every dollar value ──
  for(const [A,acct] of [['apex','main'],['agentic','agentic']]){
    const {ctx,p}=await open();await goArea(p,A);await p.locator(tab('overview')).click();await settle(p);
    const n=await p.locator('.ws-act').count();
    if(n){const first=p.locator('.ws-act').first();assert.ok(await first.evaluate(e=>e.hasAttribute('data-ex-route')||e.hasAttribute('data-pj-go')||e.hasAttribute('data-ws-card')),A+': item has a destination');
      const cats=await p.locator('.ws-act').evaluateAll(n=>n.map(e=>e.dataset.cat));const rank={waiting:0,flight:1,risk:2,options:3};
      assert.deepEqual(cats,cats.slice().sort((a,b)=>rank[a]-rank[b]),A+': waiting on you, then risk, then options');
      await first.click();await settle(p);assert.ok((await st(p)).route!=='accounts'||(await p.locator('.card:visible').count())>0,A+': tap opens something');
    }else assert.equal(await p.locator('.ws-empty strong').first().innerText(),'Nothing needs you');
    await p.evaluate(()=>PFExperience.navigate('accounts'));await settle(p);
    await p.evaluate(()=>setPrivacy(true));await settle(p);
    for(const sel of ['.ws-strip','.ws-acts, .ws-empty'])if(await p.locator(sel).count())assert.doesNotMatch(await p.locator(sel).first().innerText(),/\$\d/,`${A}: ${sel} masked in privacy mode`);
    await p.locator(tab('positions')).click();await settle(p);assert.doesNotMatch(await p.locator('.ws-pos').evaluateAll(n=>n.map(e=>e.innerText).join(' ')),/\$\d/,A+': cards masked');
    await p.evaluate(()=>setPrivacy(false));await ctx.close();
  }
  {const quiet=structuredClone(sample);quiet.agentic.pending=null;quiet.agentic.drawdown=null;quiet.agentic.blockedSells=[];
   const {ctx,p}=await open({data:quiet});await goArea(p,'agentic');await p.locator(tab('overview')).click();await settle(p);
   if(await p.locator('.ws-act').count()===0)assert.equal(await p.locator('.ws-empty strong').first().innerText(),'Nothing needs you','empty state is explicit');
   else assert.ok((await p.locator('.ws-act').allInnerTexts()).every(t=>!/ticket|deployment guard/i.test(t)),'items come only from remaining records');
   await ctx.close();}

  // ── 6. Overview row for Options Income & History, What if? stays reachable, Classic view moved into More ──
  {const {ctx,p}=await open();await goArea(p,'apex');await p.locator(tab('overview')).click();await settle(p);
   await p.locator('[data-ws-card-tab="options"]').click();await settle(p);assert.equal((await st(p)).route,'options','Options Income & History row opens Options');
   await p.evaluate(()=>PFExperience.navigate('accounts'));await settle(p);await p.locator('.ws-row[data-ex-route="scenario"]').click();await settle(p);assert.equal((await st(p)).route,'scenario','What if? row');
   await goArea(p,'more');assert.equal(await p.locator('#ex-classic-more').isVisible(),true,'Classic view lives in More');
   await p.locator('#ex-classic-more').click();await p.waitForSelector('.ex-classic-return');assert.equal(await p.locator('#tabbar').isVisible(),true,'Classic view still opens');await p.locator('.ex-classic-return').click();await settle(p);
   await goArea(p,'today');assert.equal(await p.locator('#ex-classic').isVisible(),true,'Today keeps its own Classic button');await ctx.close();}

  // ── 7. No horizontal overflow, every size, every tab, light and dark ──
  for(const [w,h,ins] of [[320,568,null],[390,844,null],[466,677,{right:84}],[960,676,{right:100}],[677,466,{left:85}],[1280,800,null]]){
    const {ctx,p}=await open({viewport:{width:w,height:h},inset:ins});
    for(const A of ['apex','agentic']){await goArea(p,A);for(const t of (A==='apex'?['overview','positions','research','actions']:['overview','actions'])){await p.locator(tab(t)).click();await settle(p);
      assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`${w}x${h} ${A} ${t}: no overflow`);}}
    if(w===390){await p.evaluate(()=>PFTheme.set('dark'));await settle(p);for(const t of ['overview','positions']){await p.locator(tab(t)).click();await settle(p);assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'dark '+t);}}
    await ctx.close();
  }
  assert.deepEqual(errors,[],'no page errors');assert.deepEqual(writes,[],'no non-GET requests');
}
}
if(import.meta.url===`file://${process.argv[1]}`){
  const {chromium}=await import(process.env.PF_PLAYWRIGHT||'playwright');
  const base=(process.env.PF_PREVIEW_URL||'http://127.0.0.1:8767/').replace(/\/?$/,'/');
  const sample=JSON.parse(fs.readFileSync('tmp/experience-preview/sample.json','utf8'));
  const stub=fs.readFileSync('producer/privacy-audit.mjs','utf8').match(/const CHART_STUB = `([\s\S]*?)`;/)[1];
  const apex={asOf:new Date().toISOString(),targets:{MSFT:20},top5:[{sym:'MSFT',composite:8,why:'Synthetic entry research',limit:420,trigger:420,stop:380,tp1:500,orderType:'limit',tradable:true}],heldLevels:[{sym:'AAPL',stop:170,tp1:230,why:'Synthetic held-name evidence'}]};
  const browser=await chromium.launch({...(process.env.PF_CHROME?{executablePath:process.env.PF_CHROME}:{}),args:['--no-sandbox','--disable-dev-shm-usage']});
  const writes=[];
  try{await runWorkspaceChecks({browser,base,sample,stub,apex,writes});assert.deepEqual(writes,[]);console.log('workspace-checks PASS');}finally{await browser.close();}
}
