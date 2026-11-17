// Dashboard 2.0 Phase 3b (v239): Plan (agentic), Screens and Predict keep decisions open; reference cards start folded.
// Called from journey-browser.mjs (the CI suite). One context, one page. All account data are synthetic; nothing here submits an order.
//   Plan, agentic   folded: "How the loop runs".   Always open: Where the plan stands, Model correctness & forward record, The target,
//                    Business check, What's blocked, The waiting ground, Guardrails.
//   Plan, self-directed  nothing qualifies: Apex card and Action Center stay open, no card is folded.
//   Screens         folded: "Scoring Breakdown".   Always open: Top 3 Picks, Composite Scores, Track Record (+ note, hero).
//   Predict         nothing qualifies (tabs; every reference block is already a closed <details>): no card is folded by this change.
import assert from 'node:assert/strict';

const KEY='pf_card_fold_v1';
const VP=[[390,844,{}],[466,677,{right:84}],[960,676,{right:100}],[677,466,{left:85}],[1280,800,{}]];
const PLAN_AG={fold:[/How the loop runs/],open:[/Where the plan stands/,/Model correctness/,/The target/,/Business check/,/What's blocked/,/waiting ground/,/Guardrails/]};
const SCREENS={fold:[/Scoring Breakdown/],open:[/Top 3 Picks/,/Composite Scores/,/Track Record/]};

export async function runResearchFoldChecks({browser,base,sample,stub,apex,writes=[]}){
  const errors=[];
  const ctx=await browser.newContext({viewport:{width:390,height:844},timezoneId:'America/New_York',serviceWorkers:'block'});
  const page=await ctx.newPage();
  page.on('pageerror',e=>errors.push(e.message));
  page.on('request',r=>{if(!['GET','HEAD'].includes(r.method()))writes.push(r.url());});
  await page.addInitScript(stub);
  await page.addInitScript(()=>{if(!sessionStorage.getItem('p3b-init')){localStorage.setItem('pf_acct','main');localStorage.setItem('pf_experience_route','today');sessionStorage.setItem('p3b-init','1');}});
  await page.route('https://**/*',r=>r.request().url().startsWith(base)?r.continue():r.abort());
  await page.route(/\/data\.json(?:\?.*)?$/,r=>r.fulfill({json:sample}));
  await page.route(/\/data\/apex-targets\.json(?:\?.*)?$/,r=>r.fulfill({json:apex}));
  await page.goto(base);await page.waitForFunction(()=>window.__SNAP&&window.PFJourney);
  const cdp=await ctx.newCDPSession(page);
  const settle=()=>page.waitForTimeout(250);
  const nav=(route,account)=>page.evaluate(({route,account})=>PFExperience.navigate(route,account?{account}:{}),{route,account});
  const reload=async keep=>{await page.evaluate(([k,keep])=>{if(!keep)localStorage.removeItem(k);},[KEY,!!keep]);await page.reload();await page.waitForFunction(()=>window.__SNAP&&window.PFJourney);await settle();};
  // A new render of one page with the saved choices cleared (the cheap way back to the defaults); reload() is used only where a reload is the thing under test.
  const fresh=async which=>{await page.evaluate(k=>localStorage.removeItem(k),KEY);
    if(which==='ag'){await nav('plan','agentic');await page.evaluate(()=>renderAgenticPlan());}else{await nav('screens');await page.evaluate(()=>renderScreensPage());}await settle();};
  const stored=()=>page.evaluate(k=>JSON.parse(localStorage.getItem(k)||'null'),KEY);
  const noOverflow=async label=>assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,label+': no horizontal overflow');
  // Every top-level card of a page root: its title, data-sec, fold state and how much content its body holds.
  const cardsOf=root=>page.evaluate(root=>[...document.querySelectorAll(root+' > .card')].map(c=>{
    const t=c.querySelector(':scope > .card-title'),id=t&&t.getAttribute('data-toggle');
    const body=t?(id?document.getElementById(id):c.querySelector(':scope > .card-body')):null;
    const clone=t&&t.cloneNode(true);clone&&clone.querySelectorAll('.chevron,.card-hint,.help-btn,.pin-btn').forEach(x=>x.remove());
    return {title:clone?clone.textContent.replace(/\s+/g,' ').trim():'',sec:c.getAttribute('data-sec'),hasBody:!!body,folded:!!body&&body.style.display==='none',
      aria:t&&t.getAttribute('aria-expanded'),chars:body?(body.textContent||'').trim().length:-1,visible:c.offsetHeight>0};
  }),root);
  const find=(cards,re)=>{const c=cards.find(x=>re.test(x.title));assert.ok(c,'card '+re+' exists');return c;};
  const hdr=(root,re)=>page.locator(root+' > .card > .card-title',{hasText:re}).first();
  const AG='#plan-agentic-app', SC='#screens-app', MAIN='#picks-app', PR='#predictions-app';
  const toPlanAg=async()=>{await nav('plan','agentic');await settle();};
  const toScreens=async()=>{await nav('screens');await settle();};
  await page.evaluate(()=>{localStorage.removeItem('pf_card_fold_v1');localStorage.removeItem('pf_pins');});

  // (a) the folded set and the always-open set, per page and account. Defaults write nothing.
  await page.setViewportSize({width:390,height:844});
  await toPlanAg();
  let c=await cardsOf(AG);
  for(const re of PLAN_AG.fold){const x=find(c,re);assert.equal(x.folded,true,x.title+' starts folded');assert.equal(x.aria,'false',x.title+' aria-expanded=false');assert.equal(x.sec,'agp-loop');}
  for(const re of PLAN_AG.open){const x=find(c,re);assert.equal(x.folded,false,x.title+' stays open');assert.equal(x.aria,'true',x.title+' aria-expanded=true');assert.ok(x.chars>20,x.title+' has content');assert.equal(x.sec,null,x.title+' carries no fold key');}
  assert.equal(c.filter(x=>x.folded).length,1,'agentic Plan: exactly one card folded');
  // (b) the folded card is still rendered: all five steps, the link, and its disclaimer stays visible (it sits outside the foldable body)
  assert.equal(await page.locator(AG+' [data-sec="agp-loop"] .gr-row').count(),5,'five loop steps rendered while folded');
  assert.ok(find(c,/How the loop runs/).chars>400,'loop body text present while folded');
  assert.equal(await page.locator(AG+' [data-sec="agp-loop"] > .disclaimer').isVisible(),true,'the "Not financial advice / monitor-only" disclaimer stays visible while the explainer is folded');
  assert.match(await page.locator(AG+' [data-sec="agp-loop"] > .disclaimer').innerText(),/Levels are monitor-only/);
  // self-directed Plan: nothing folded, Apex and Action Center open and rendered
  await nav('plan','main');await settle();
  c=await cardsOf(MAIN);
  assert.ok(c.length>=3,'self-directed Plan cards present');
  assert.ok(c.every(x=>!x.folded&&x.sec===null),'self-directed Plan: no card folded, none carries a fold key');
  for(const re of [/Apex/,/Action Center/]){const x=find(c,re);assert.equal(x.folded,false);assert.ok(x.chars>50,x.title+' content present');}
  assert.ok(await page.locator('#apex-content').innerText().then(t=>t.length>100),'#apex-content rendered');
  assert.ok(await page.evaluate(()=>!!window.__PF_APEX_REVIEW),'__PF_APEX_REVIEW still built');
  // Screens
  await toScreens();
  c=await cardsOf(SC);
  for(const re of SCREENS.fold){const x=find(c,re);assert.equal(x.folded,true,x.title+' starts folded');assert.equal(x.aria,'false');assert.equal(x.sec,'scr-breakdown');}
  for(const re of SCREENS.open){const x=find(c,re);assert.equal(x.folded,false,x.title+' stays open');assert.ok(x.visible,x.title+' visible');}
  assert.equal(c.filter(x=>x.folded).length,1,'Screens: exactly one card folded');
  assert.ok(await page.locator(SC+' #picks-table tbody tr').count()>=3,'scoring rows rendered while folded');
  assert.ok(await page.locator('#picks-chart').isVisible(),'Composite Scores chart stays visible');
  assert.ok(await page.locator('[data-sd-screens-note]').isVisible(),'reference-not-buys note stays visible');
  // Predict: nothing qualifies, nothing folded by this change; the five tabs and their content are as before
  await nav('predictions');await settle();
  assert.equal(await page.locator(PR+' [data-sec]').count(),0,'Predict has no fold keys');
  for(const tab of ['positions','ideas','watchlist','results','settled']){
    await page.locator('#pred-tab-'+tab).click();await settle();
    assert.ok((await page.locator('#pred-content').innerText()).trim().length>40,'Predict '+tab+' tab content visible');
    assert.equal(await page.locator('#pred-content').isVisible(),true);
  }
  await page.locator('#pred-tab-ideas').click();await settle();
  assert.equal(await page.locator(PR+' details[open]').count(),0,'every Predict reference block is already a closed details');
  assert.equal(await stored(),null,'defaults write nothing to storage');

  // (c) choices persist across a re-render and a reload, per account. The loop is agentic-only: the self-directed Plan has no key.
  await toPlanAg();
  await hdr(AG,/How the loop runs/).click();await settle();
  assert.equal(find(await cardsOf(AG),/How the loop runs/).folded,false,'opened by tap');
  assert.equal(find(await cardsOf(AG),/How the loop runs/).aria,'true');
  assert.deepEqual(await stored(),{'plan-agentic:agp-loop':1},'only the per-account key is saved');
  await page.evaluate(()=>{window.__old=document.querySelector('#plan-agentic-app [data-sec="agp-loop"]');renderAgenticPlan();});await settle();
  assert.equal(await page.evaluate(()=>document.contains(window.__old)),false,'loop card really re-rendered');
  assert.equal(find(await cardsOf(AG),/How the loop runs/).folded,false,'open survives a re-render');
  await reload(true);await toPlanAg();
  assert.equal(find(await cardsOf(AG),/How the loop runs/).folded,false,'open survives a reload');
  await nav('plan','main');await settle();
  assert.ok((await cardsOf(MAIN)).every(x=>!x.folded),'the agentic choice does not reach the self-directed Plan');
  await nav('accounts','agentic');await settle();
  assert.equal(await page.locator('#agentic-app .card[data-sec="allocation"] > .card-title').getAttribute('aria-expanded'),'false','the agentic Accounts page keeps its own folds');
  assert.equal(await page.locator('#agentic-app .card[data-sec="income"] > .card-title').getAttribute('aria-expanded'),'false');
  // and the reverse: an Accounts choice does not open the loop; closing the loop persists too
  await page.locator('#agentic-app .card[data-sec="income"] > .card-title').click();await settle();
  assert.deepEqual(await stored(),{'plan-agentic:agp-loop':1,'agentic:income':1});
  await toPlanAg();
  await hdr(AG,/How the loop runs/).click();await settle();
  assert.equal(JSON.parse(await page.evaluate(k=>localStorage.getItem(k),KEY))['plan-agentic:agp-loop'],0,'closed choice saved');
  await reload(true);await toPlanAg();
  assert.equal(find(await cardsOf(AG),/How the loop runs/).folded,true,'closed choice survives a reload');
  // Screens: same
  await toScreens();
  await hdr(SC,/Scoring Breakdown/).click();await settle();
  assert.equal(find(await cardsOf(SC),/Scoring Breakdown/).folded,false);assert.equal(find(await cardsOf(SC),/Scoring Breakdown/).aria,'true');
  assert.equal((await stored())['screens:scr-breakdown'],1);
  await page.evaluate(()=>{window.__old=document.querySelector('#screens-app [data-sec="scr-breakdown"]');renderScreensPage();});await settle();
  assert.equal(await page.evaluate(()=>document.contains(window.__old)),false,'breakdown card really re-rendered');
  assert.equal(find(await cardsOf(SC),/Scoring Breakdown/).folded,false,'open survives a re-render');
  await reload(true);await toScreens();
  assert.equal(find(await cardsOf(SC),/Scoring Breakdown/).folded,false,'open survives a reload');
  const box=await page.locator('#picks-table').boundingBox();assert.ok(box&&box.width>100&&box.x>=0&&box.x+box.width<=391,'scoring table visible and inside the phone width once opened');
  await hdr(SC,/Scoring Breakdown/).click();await settle();await reload(true);await toScreens();
  assert.equal(find(await cardsOf(SC),/Scoring Breakdown/).folded,true,'closed choice survives a reload');

  // (d) navigation opens a folded card: rail chip, Find / My view jump, Expand/Collapse all
  await fresh('ag');
  assert.equal(find(await cardsOf(AG),/How the loop runs/).folded,true);
  assert.equal(await page.locator('#page-picks .card-nav-chip:visible').count(),0,'v242: the card rail is not shown on Apex / Agentic Actions');
  await page.locator('#plan-agentic-app [data-sec="agp-loop"] > .card-title').click();await settle();
  let x=find(await cardsOf(AG),/How the loop runs/);assert.equal(x.folded,false,'its own header opens it');assert.equal(x.aria,'true');
  assert.deepEqual(await stored(),{'plan-agentic:agp-loop':1},'a header tap is the owner\'s own choice and is saved (v242: the rail chip that opened it for the session only is gone)');
  await fresh('ag');
  await page.evaluate(()=>{const c=document.querySelector('#plan-agentic-app [data-sec="agp-loop"]');__pfGoCard(__navTitleOf(c),'picks');});await settle();
  assert.equal(find(await cardsOf(AG),/How the loop runs/).folded,false,'Find / My view jump opens it');
  await page.waitForTimeout(700);
  const top=await page.evaluate(()=>{const r=document.querySelector('#plan-agentic-app [data-sec="agp-loop"]').getBoundingClientRect();return [r.top,r.bottom];});assert.ok(top[0]<844&&top[1]>0,'scrolled into view');
  await fresh('ag');
  await page.evaluate(()=>document.querySelectorAll('#page-picks [data-sec] > .card-title[aria-expanded="false"]').forEach(t=>t.click()));await settle();assert.ok((await cardsOf(AG)).every(y=>!y.folded),'every folded card opens from its own header');
  // Research > Screens has no section rail and is not in Find / My view's page index (existing), so the card's header is only reached by opening the page.

  // (e) a card pinned to My view starts open (both pages)
  await page.evaluate(()=>{localStorage.removeItem('pf_card_fold_v1');});
  await toPlanAg();const t1=await page.evaluate(()=>__navTitleOf(document.querySelector('#plan-agentic-app [data-sec="agp-loop"]')));
  await toScreens();const t2=await page.evaluate(()=>__navTitleOf(document.querySelector('#screens-app [data-sec="scr-breakdown"]')));   // Screens is outside the pin UI today; a stored title is still honoured
  await page.evaluate(([a,b])=>localStorage.setItem('pf_pins',JSON.stringify([a,b])),[t1,t2]);
  await fresh('ag');
  assert.equal(find(await cardsOf(AG),/How the loop runs/).folded,false,'pinned loop card starts open');
  await fresh('sc');assert.equal(find(await cardsOf(SC),/Scoring Breakdown/).folded,false,'pinned Scoring Breakdown starts open');
  await page.evaluate(()=>localStorage.removeItem('pf_pins'));

  // (f) privacy: a card opened after being folded reads exactly like one that was never folded
  await fresh('ag');
  await page.evaluate(()=>setPrivacy(true));await settle();
  await hdr(AG,/How the loop runs/).click();await settle();
  const afterFold=await page.locator(AG+' [data-sec="agp-loop"]').innerText();
  await page.evaluate(()=>setPrivacy(false));await settle();
  await reload(true);await toPlanAg();await page.evaluate(()=>setPrivacy(true));await settle();   // open choice saved by the tap above
  const neverFolded=await page.locator(AG+' [data-sec="agp-loop"]').innerText();
  assert.equal(afterFold,neverFolded,'loop card: privacy view is identical whether opened after being folded or never folded');
  assert.doesNotMatch(await page.locator(AG+' [data-sec="agp-loop"]').evaluate(e=>e.closest('#plan-agentic-app').querySelector('.card:not([data-priv="off"])')?.innerText||''),/\$\d{3,}/,'private agentic figures stay masked beside it');
  await page.evaluate(()=>setPrivacy(false));await settle();
  await fresh('sc');
  await page.evaluate(()=>setPrivacy(true));await settle();
  await hdr(SC,/Scoring Breakdown/).click();await settle();
  const norm=t=>t.replace(/\$[\d,]+\.\d\d/g,'$').split('\n').filter(l=>!/vs scan|scan price|live/.test(l)).join('\n');   // live price refresh timing is not what is under test
  const sFold=norm(await page.locator('#picks-table').innerText());
  await page.evaluate(()=>setPrivacy(false));await settle();await reload(true);await toScreens();
  await page.evaluate(()=>setPrivacy(true));await settle();
  assert.equal(norm(await page.locator('#picks-table').innerText()),sFold,'Scoring Breakdown: privacy view identical opened-after-folded vs never folded');
  await page.evaluate(()=>setPrivacy(false));await settle();

  // (g) no horizontal overflow at five sizes, folded and expanded, all four pages (Duo insets as in holdings-duo-browser)
  const quick=()=>page.waitForTimeout(110);
  for(const [w,h,ins] of VP){
    await page.setViewportSize({width:w,height:h});await cdp.send('Emulation.setSafeAreaInsetsOverride',{insets:{top:0,bottom:0,right:ins.right||0,left:ins.left||0}});await quick();
    await toPlanAg();await noOverflow(`plan agentic ${w}x${h} folded`);
    await page.evaluate(()=>document.querySelectorAll('#page-picks [data-sec] > .card-title[aria-expanded="false"]').forEach(t=>t.click()));await quick();await noOverflow(`plan agentic ${w}x${h} expanded`);
    await nav('plan','main');await quick();await noOverflow(`plan self-directed ${w}x${h}`);
    await toScreens();await noOverflow(`screens ${w}x${h} folded`);
    await hdr(SC,/Scoring Breakdown/).click();await quick();await noOverflow(`screens ${w}x${h} expanded`);
    await nav('predictions');await quick();await noOverflow(`predict ${w}x${h}`);
    await fresh('ag');await fresh('sc');
  }
  await cdp.send('Emulation.setSafeAreaInsetsOverride',{insets:{top:0,bottom:0,right:0,left:0}});await page.setViewportSize({width:390,height:844});

  // (h) empty state: no candidate rows leaves the Scoring Breakdown card open (it would hold only a notice)
  await page.evaluate(()=>{window.__cands=PICK_CANDIDATES.slice();PICK_CANDIDATES.length=0;});
  await toScreens();await page.evaluate(()=>renderScreensPage());await settle();
  x=find(await cardsOf(SC),/Scoring Breakdown/);assert.equal(x.folded,false,'empty-state card is left open');
  await page.evaluate(()=>{PICK_CANDIDATES.push(...window.__cands);renderScreensPage();});await settle();
  assert.equal(find(await cardsOf(SC),/Scoring Breakdown/).folded,true,'restored data folds again');
  await page.evaluate(()=>{localStorage.removeItem('pf_card_fold_v1');localStorage.removeItem('pf_pins');});
  assert.deepEqual(errors,[],'no page errors');
  await ctx.close();
}
