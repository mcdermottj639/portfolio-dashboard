// v256 (Jack, Nov 18 2026): one page-level Expand all / Collapse all control above the card stack, on every page with foldable cards.
// Called from journey-browser.mjs (reuses its browser; ONE context). Synthetic data only; nothing here submits an order or writes.
// Checks: (a) one control per page, none in the old rail, none where cards don't fold; (b) Collapse all / Expand all reach every
// eligible card on the page and keep the label honest; (c) safety cards (Apex Confirm, Action Center, plan status) are never hidden
// by Collapse all, yet a header tap still folds them; (d) a fold choice survives an ordinary refresh (re-render) for cards that had
// no saved key before v256 (Risk & Diversification); (e) an opened empty card shows an empty state; (f) no horizontal overflow,
// no clipped control and a ≥40px target at folded Duo (primary), 320, 390, folded sideways, Book, open Duo and desktop.
import assert from 'node:assert/strict';

const KEY='pf_card_fold_v1';
// [w,h,safe-area inset, label]. 466×677 with the 84px hinge strip is the fully folded Duo front screen.
const VP=[[466,677,{right:84},'folded Duo'],[320,568,{},'320 phone'],[390,844,{},'390 phone'],[677,466,{left:85},'folded sideways'],
  [951,669,{},'Book'],[960,676,{right:100},'open Duo'],[1280,800,{},'desktop']];

export async function runFoldbarChecks({browser,base,sample,stub,apex,writes=[]}){
  const errors=[];
  const ctx=await browser.newContext({viewport:{width:466,height:677},timezoneId:'America/New_York',serviceWorkers:'block'});
  const page=await ctx.newPage();
  page.on('pageerror',e=>errors.push(e.message));
  page.on('request',r=>{if(!['GET','HEAD'].includes(r.method()))writes.push(r.url());});
  await page.addInitScript(stub);
  await page.addInitScript(()=>{if(!sessionStorage.getItem('fb-init')){localStorage.setItem('pf_acct','main');localStorage.setItem('pf_experience_route','accounts');sessionStorage.setItem('fb-init','1');}});
  await page.route('https://**/*',r=>r.request().url().startsWith(base)?r.continue():r.abort());
  await page.route(/\/data\.json(?:\?.*)?$/,r=>r.fulfill({json:sample}));
  await page.route(/\/data\/apex-targets\.json(?:\?.*)?$/,r=>r.fulfill({json:apex}));
  await page.goto(base);await page.waitForFunction(()=>window.__SNAP&&window.PFJourney);
  const cdp=await ctx.newCDPSession(page);
  const inset=i=>cdp.send('Emulation.setSafeAreaInsetsOverride',{insets:{top:0,bottom:0,right:i.right||0,left:i.left||0}});
  await inset({right:84});
  const settle=()=>page.waitForTimeout(350);
  const nav=(route,account)=>page.evaluate(({route,account})=>PFExperience.navigate(route,account?{account}:{}),{route,account});
  const fresh=async()=>{await page.evaluate(k=>localStorage.removeItem(k),KEY);await page.reload();await page.waitForFunction(()=>window.__SNAP&&window.PFJourney);await settle();};
  // The visible foldable cards of a page, as the app counts them, with their fold state.
  const state=pageId=>page.evaluate(pageId=>{const pg=document.getElementById(pageId);
    const bodyOf=c=>{const b=c.querySelector(':scope > .card-body');if(b)return b;const t=c.querySelector(':scope > .card-title'),id=t&&t.getAttribute('data-toggle');return id?document.getElementById(id):null;};
    return [...pg.querySelectorAll('.card')].filter(c=>bodyOf(c)&&c.getClientRects().length>0).map(c=>({
      title:(c.querySelector(':scope > .card-title')?.textContent||'').replace(/\s+/g,' ').trim().slice(0,40),
      open:bodyOf(c).style.display!=='none',keep:!!window.__pfFold.keep(c),
      aria:c.querySelector(':scope > .card-title')?.getAttribute('aria-expanded')}));},pageId);
  const btn=pageId=>page.locator('#'+pageId+' > .pf-foldbar .pf-foldall');

  // (a) Apex Account page (workspace): exactly one control, visible, in the page (not the header or bottom nav); no rail button anywhere.
  await fresh();await nav('accounts','main');await settle();
  assert.equal(await page.locator('.cn-all').count(),0,'the old rail Expand/Collapse all button is gone everywhere');
  assert.equal(await page.locator('#page-portfolio .pf-foldall:visible').count(),1,'one Expand/Collapse all control on the Apex Account page');
  assert.equal(await page.locator('.ex-top .pf-foldall, #tabbar .pf-foldall, .ex-nav .pf-foldall').count(),0,'not in the global header or bottom nav');
  assert.match(await btn('page-portfolio').innerText(),/Collapse all/,'cards start open, so the label offers Collapse all');
  // It sits above the card stack: above every foldable card except those the workspace pins above the summary.
  const pos=await page.evaluate(()=>{const b=document.querySelector('#page-portfolio > .pf-foldbar').getBoundingClientRect();
    const sec=[...document.querySelectorAll('#app > .card[data-sec]')].filter(c=>c.getClientRects().length&&c.getAttribute('data-sec')!=='snapshot');
    return {bar:b.top,first:Math.min(...sec.map(c=>c.getBoundingClientRect().top))};});
  assert.ok(pos.bar<pos.first,'the toolbar sits above the card stack ('+Math.round(pos.bar)+' < '+Math.round(pos.first)+')');

  // (b) Collapse all → every eligible visible card folds; label flips; Expand all reopens all; saved like header taps.
  await btn('page-portfolio').click();await settle();
  let s=await state('page-portfolio');
  assert.ok(s.length>=5,'several foldable cards on the page ('+s.length+')');
  assert.ok(s.filter(x=>!x.keep).every(x=>!x.open&&x.aria==='false'),'Collapse all folds every eligible card: '+JSON.stringify(s.filter(x=>x.open)));
  assert.match(await btn('page-portfolio').innerText(),/Expand all/);
  const saved=await page.evaluate(k=>JSON.parse(localStorage.getItem(k)||'{}'),KEY);
  assert.equal(saved['main:risk'],0,'Risk & Diversification fold is saved (v256: every card is keyed)');
  await btn('page-portfolio').click();await settle();
  s=await state('page-portfolio');
  assert.ok(s.every(x=>x.open&&x.aria==='true'),'Expand all opens every card');
  assert.match(await btn('page-portfolio').innerText(),/Collapse all/);
  // the heatmap is drawn when Expand all opens it (a hidden treemap has no width)
  await btn('page-portfolio').click();await settle();await btn('page-portfolio').click();await settle();
  assert.ok(await page.locator('#app .card[data-sec="heatmap"] .hm-tile').count()>0,'heatmap tiles drawn after Expand all');
  // individual toggles still work and move the label
  await page.locator('#app .card[data-sec="risk"] > .card-title').click();await settle();
  assert.equal((await state('page-portfolio')).find(x=>/Risk/.test(x.title)).open,false,'header tap still folds a single card');
  assert.match(await btn('page-portfolio').innerText(),/Collapse all/,'other cards are still open');

  // (d) an ordinary refresh (the agentic page re-renders as new nodes) keeps a folded Risk card folded
  await nav('accounts','agentic');await settle();
  await page.locator('#agentic-app .card[data-sec="risk"] > .card-title').click();await settle();
  await page.evaluate(()=>{window.__fbOld=document.querySelector('#agentic-app .card[data-sec="risk"]');renderAgenticPage();});await settle();
  assert.equal(await page.evaluate(()=>document.contains(window.__fbOld)),false,'risk card really re-rendered');
  assert.equal(await page.locator('#agentic-app .card[data-sec="risk"] > .card-title').getAttribute('aria-expanded'),'false','folded Risk survives a refresh');
  assert.equal(await page.evaluate(()=>{const t=document.querySelector('#agentic-app .card[data-sec="risk"] > .card-title');return document.getElementById(t.getAttribute('data-toggle')).style.display;}),'none');
  await page.locator('#agentic-app .card[data-sec="risk"] > .card-title').click();await settle();
  await page.evaluate(()=>renderAgenticPage());await settle();
  assert.equal(await page.locator('#agentic-app .card[data-sec="risk"] > .card-title').getAttribute('aria-expanded'),'true','reopened Risk stays open after a refresh');

  // (c) safety: on the self-directed Plan, Collapse all leaves the Apex Confirm card and Action Center open
  await fresh();await nav('plan','main');await settle();
  assert.equal(await page.locator('#page-picks .pf-foldall:visible').count(),1,'one control on the Plan page');
  if((await btn('page-picks').innerText()).includes('Expand'))await btn('page-picks').click(),await settle();
  await btn('page-picks').click();await settle();
  s=await state('page-picks');
  const keepers=s.filter(x=>x.keep);
  assert.ok(keepers.length>=1,'the Plan page has protected cards: '+JSON.stringify(s.map(x=>x.title)));
  assert.ok(keepers.every(x=>x.open),'Collapse all never hides the Apex Confirm card / Action Center');
  assert.ok(s.filter(x=>!x.keep).every(x=>!x.open),'everything else on the Plan page folded');
  if(await page.locator('#apex-card').count()){
   assert.equal(await page.locator('#apex-card > .card-title').getAttribute('aria-expanded'),'true');
   await page.locator('#apex-card > .card-title').click();await settle();
   assert.equal(await page.locator('#apex-card > .card-title').getAttribute('aria-expanded'),'false','the owner can still fold the Apex card by hand');
   await page.locator('#apex-card > .card-title').click();await settle();
  }
  await btn('page-picks').click();await settle();
  assert.ok((await state('page-picks')).every(x=>x.open),'Expand all reopens the Plan page');

  // (a, cont.) Options: one control; pages whose cards don't fold get none
  await nav('options');await settle();
  assert.equal(await page.locator('#page-options .pf-foldall:visible').count(),1,'one control on Options');
  await nav('apexpaper','main');await settle();
  assert.equal(await page.locator('#page-apexpaper .pf-foldall:visible').count(),0,'v2.9 Paper cards do not fold, so no control');
  await nav('predictions');await settle();
  assert.equal(await page.locator('#page-predictions .pf-foldall:visible').count(),0,'Predict has no foldable cards, so no control');

  // (e) an empty foldable card shows an empty state when opened (shared toggle path), not a blank band
  await nav('options');await settle();
  await page.evaluate(()=>{const c=document.createElement('div');c.className='card';c.id='fb-empty';
    c.innerHTML='<div class="card-title collapsible" data-toggle="fb-empty-b" onclick="toggleSection(\'fb-empty-b\')"><span>Empty test card</span><span class="chevron">▼</span></div><div id="fb-empty-b" style="display:none"></div>';
    document.getElementById('options-app').appendChild(c);});await settle();
  await page.locator('#fb-empty > .card-title').click();await settle();
  assert.match(await page.locator('#fb-empty-b').innerText(),/Nothing to show here yet/,'empty state shown when an empty card opens');
  await page.evaluate(()=>document.getElementById('fb-empty').remove());await settle();

  // (f) every layout: control fully on screen, ≥40px tall, label readable, no sideways overflow folded or expanded
  for(const [w,h,ins,label] of VP){
   await page.setViewportSize({width:w,height:h});await inset(ins);
   for(const [route,acct,pg] of [['accounts','main','page-portfolio'],['plan','agentic','page-picks'],['options',null,'page-options']]){
    await nav(route,acct);await settle();
    const b=btn(pg);
    if(!(await b.isVisible()))continue;   // e.g. Book shows a page pair; the control is required only where cards are on screen
    await b.scrollIntoViewIfNeeded();
    const r=await b.boundingBox();const iw=await page.evaluate(()=>innerWidth);
    assert.ok(r.x>=0&&r.x+r.width<=iw+0.5,`${label} ${route}: control inside the screen (${Math.round(r.x)}..${Math.round(r.x+r.width)} of ${iw})`);
    assert.ok(r.height>=40,`${label} ${route}: touch target ${r.height}px`);
    assert.equal(await b.evaluate(e=>e.scrollWidth<=e.clientWidth+1),true,`${label} ${route}: label not clipped`);
    for(let i=0;i<2;i++){await b.click();await settle();
     assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`${label} ${route}: no horizontal overflow after toggle ${i+1}`);}
   }
  }
  await inset({});
  assert.deepEqual(errors,[],'no page errors');
  await ctx.close();
}
