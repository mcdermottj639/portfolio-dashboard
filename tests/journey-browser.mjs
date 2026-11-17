// Full browser task-flow checks. All account data are synthetic; never submit a trade.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const {chromium}=await import(process.env.PF_PLAYWRIGHT||'playwright');
const base=(process.env.PF_PREVIEW_URL||'http://127.0.0.1:8767/').replace(/\/?$/,'/');
const live=base.startsWith('https:');
const sample=JSON.parse(fs.readFileSync('tmp/experience-preview/sample.json','utf8'));
const stub=fs.readFileSync('producer/privacy-audit.mjs','utf8').match(/const CHART_STUB = `([\s\S]*?)`;/)[1];
const browser=await chromium.launch({...(process.env.PF_CHROME?{executablePath:process.env.PF_CHROME}:{}),args:['--no-sandbox','--disable-dev-shm-usage']});
const out=process.env.PF_SCREENSHOT_DIR||'tmp/journey-evidence';fs.mkdirSync(out,{recursive:true});
try{
 const page=await browser.newPage({viewport:{width:390,height:844},timezoneId:'America/New_York',serviceWorkers:'block'});
 const errors=[],writes=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(!['GET','HEAD'].includes(r.method()))writes.push(r.url());});
 await page.addInitScript(stub);
 await page.addInitScript(()=>{
  if(!sessionStorage.getItem('journey-test-initialized')){localStorage.setItem('pf_acct','main');localStorage.setItem('pf_experience_route','today');sessionStorage.setItem('journey-test-initialized','1');}
 });
 await page.route('https://**/*',r=>r.request().url().startsWith(base)?r.continue():r.abort());
 // Match query strings too: production deliberately cache-busts these read-only feeds.
 await page.route(/\/data\.json(?:\?.*)?$/,r=>r.fulfill({json:sample}));
 await page.route(/\/data\/apex-targets\.json(?:\?.*)?$/,r=>r.fulfill({json:{asOf:new Date().toISOString(),targets:{MSFT:20},top5:[{sym:'MSFT',composite:8,why:'Synthetic entry research',limit:420,trigger:420,stop:380,tp1:500,orderType:'limit',tradable:true}],heldLevels:[{sym:'AAPL',stop:170,tp1:230,why:'Synthetic held-name evidence'}]}}));
 await page.goto(base);await page.waitForFunction(()=>window.__SNAP&&window.PFJourney);
 const nav=(route,account)=>page.evaluate(({route,account})=>PFExperience.navigate(route,account?{account}:{}),{route,account});
 const settle=()=>page.waitForTimeout(800);
 const state=()=>page.evaluate(()=>PFJourney.state);
 await nav('holdings','main');await settle();
 await page.locator('#pj-holding-search').fill('AAPL');
 assert.equal(await page.locator('#pos-table tbody tr:not([hidden]) .sym').count(),1);
 await page.evaluate(()=>window.scrollBy(0,160));await page.waitForTimeout(250);const before=await state();
 await page.locator('#pos-table tbody tr:not([hidden]) .az-link').first().click();await settle();
 assert.equal((await state()).route,'analyze');assert.equal((await state()).symbol,'AAPL');
 assert.equal(await page.locator('#az-confirm:visible').count(),0,'read-only analysis does not add a confirmation');
 assert.equal(await page.locator('#pj-symbol').inputValue(),'AAPL');
 assert.match(await page.locator('#pj-context').innerText(),/Self-directed/);
 assert.ok(!page.url().includes('AAPL')&&!page.url().includes('account='),'URL contains navigation only');
 await page.goBack();await settle();
 assert.equal((await state()).route,'holdings');assert.equal(await page.locator('#pj-holding-search').inputValue(),'AAPL');
 assert.ok(Math.abs(await page.evaluate(()=>scrollY)-before.y)<80,'Back restores the source reading position');
 await page.goForward();await settle();assert.equal((await state()).symbol,'AAPL');
 await page.reload();await page.waitForFunction(()=>window.__SNAP&&window.PFJourney);await settle();
 assert.equal((await state()).route,'analyze');assert.equal((await state()).symbol,'AAPL');assert.equal(await page.locator('#pj-symbol').inputValue(),'AAPL');
 await page.locator('#ex-account').selectOption('agentic');await settle();assert.equal((await state()).account,'agentic');
 const ag=await page.evaluate(()=>PFExperienceModel.snapshot(__DATA,__SNAP,'agentic').positions[0]?.symbol);
 assert.ok(ag);await page.locator('#pj-symbol').selectOption(ag);await settle();
 const expected=await page.evaluate(sym=>PFExperienceModel.snapshot(__DATA,__SNAP,'agentic').positions.find(p=>p.symbol===sym).value,ag);
 assert.match(await page.locator('#pj-context').innerText(),new RegExp(expected.toLocaleString('en-US',{style:'currency',currency:'USD'}).replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
 await page.locator('[data-pj-go="plan"]').first().click();await settle();
 assert.equal(await page.locator('#plan-agentic-app').isVisible(),true);assert.equal(await page.locator('#picks-app').isVisible(),false);
 await nav('analyze','main');await settle();assert.equal(await page.locator('#pj-symbol').inputValue(),'AAPL','selection is account-local');
 await page.evaluate(()=>setPrivacy(true));await settle();
 assert.doesNotMatch(await page.locator('#pj-context .pj-metrics').innerText(),/\$\d/);await page.evaluate(()=>setPrivacy(false));await settle();
 assert.match(await page.locator('#pj-context .pj-metrics').innerText(),/\$\d/);
 await nav('plan','main');await settle();await nav('decisions','main');await settle();
 assert.match(await page.locator('#pj-apex-evidence').innerText(),/Synthetic entry research/);
 await page.locator('#pj-evidence-filter select').selectOption('selected');await settle();
 assert.equal(await page.locator('[data-evidence-symbol]:visible').count(),1);
 assert.equal(await page.locator('[data-evidence-symbol]:visible').getAttribute('data-evidence-symbol'),'AAPL');
 await page.locator('[data-evidence-symbol]:visible details summary').click();await settle();
 await nav('activity');await page.goBack();await settle();assert.equal(await page.locator('[data-evidence-symbol]:visible details').getAttribute('open'),'');
 for(const width of [320,390,768,1280,1440]){
  await page.setViewportSize({width,height:900});
  for(const route of ['today','accounts','plan','analyze','decisions','scenario','markets','screens','options','activity','smartmoney','predictions']){
   await nav(route);await settle();
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`${route} ${width}: page width`);
   for(const selector of ['#pj-context','#pj-back']){
    const el=page.locator(selector);if(await el.isVisible()){const box=await el.boundingBox();assert.ok(box.x>=0&&box.x+box.width<=width+1,`${selector} ${width}: no clipped control`);}
   }
  }
 }
 await page.setViewportSize({width:390,height:844});await nav('analyze','main');await page.evaluate(()=>runAnalysis('AAPL'));await settle();
 if(live)await page.evaluate(()=>{const n=document.createElement('div');n.textContent='LIVE SHELL CHECK — SYNTHETIC ACCOUNT DATA';n.style.cssText='font-size:10px;padding:3px;text-align:center';document.querySelector('#ex-top').before(n);});
 await page.screenshot({path:path.join(out,(live?'live-':'')+'research-390.png')});
 await page.setViewportSize({width:320,height:844});await settle();await page.screenshot({path:path.join(out,(live?'live-':'')+'research-320.png')});
 await page.evaluate(()=>toggleTheme());await settle();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await page.screenshot({path:path.join(out,(live?'live-':'')+'research-320-dark.png')});
 await page.setViewportSize({width:390,height:844});await nav('holdings','main');await settle();await page.locator('#pj-clear').click();
 const row=page.locator('#pos-table .pj-row-toggle').first();await row.focus();await page.keyboard.press('Enter');assert.equal(await row.getAttribute('aria-expanded'),'true');
 // ── v235 Dashboard 2.0 Phase 1a: Accounts leads with decisions; secondary cards start folded (display only) ──
 {
  const KEY='pf_card_fold_v1';
  const FOLDED=['heatmap','allocation','income','technicals','fundamentals','flow','rebalance-log'];   // + 'smalls' where the card exists
  const OPEN=['holdings','performance','risk'];
  const reloadFresh=async(keepKey)=>{
   await page.evaluate(k=>{if(!k)localStorage.removeItem('pf_card_fold_v1');},keepKey);
   await page.reload();await page.waitForFunction(()=>window.__SNAP&&window.PFJourney);await settle();
  };
  const cards=acct=>page.evaluate(a=>{
   const root=document.getElementById(a==='main'?'app':'agentic-app'),out={};
   root.querySelectorAll(':scope .card[data-sec]').forEach(c=>{
    const t=c.querySelector(':scope > .card-title'),id=t&&t.getAttribute('data-toggle');
    const body=id?document.getElementById(id):c.querySelector(':scope > .card-body');
    out[c.getAttribute('data-sec')]={hasTitle:!!t,hasBody:!!body,folded:!!body&&body.style.display==='none',aria:t&&t.getAttribute('aria-expanded'),
     chev:(t&&t.querySelector('.chevron')&&t.querySelector('.chevron').style.transform)||'',chars:body?(body.textContent||'').trim().length:-1,
     tiles:c.querySelectorAll('.hm-tile').length};
   });
   return out;
  },acct);
  const header=(acct,sec)=>page.locator((acct==='main'?'#app':'#agentic-app')+' .card[data-sec="'+sec+'"] > .card-title');
  const stored=()=>page.evaluate(k=>localStorage.getItem(k),KEY);
  await page.setViewportSize({width:390,height:844});
  await nav('accounts','main');await reloadFresh(false);
  for(const acct of ['main','agentic']){
   await nav('accounts',acct);await settle();
   const c=await cards(acct);
   const want=FOLDED.concat(c.smalls?['smalls']:[]);
   // (a) listed cards start folded, everything else stays open exactly as before
   for(const sec of want){assert.ok(c[sec],acct+' '+sec+' card exists');assert.equal(c[sec].folded,true,acct+' '+sec+' starts folded');assert.equal(c[sec].aria,'false',acct+' '+sec+' aria-expanded=false');assert.match(c[sec].chev,/rotate/,acct+' '+sec+' chevron turned');}
   for(const sec of OPEN){assert.equal(c[sec].folded,false,acct+' '+sec+' stays open');assert.equal(c[sec].aria,'true',acct+' '+sec+' aria-expanded=true');}
   assert.equal(c.snapshot.hasTitle,false,acct+' snapshot has no fold control and stays visible');
   assert.equal(await page.locator((acct==='main'?'#app':'#agentic-app')+' [data-sec="snapshot"] .snap-grid').isVisible(),true);
   // (b) every card still rendered into the DOM while folded (the renderer ran; only the body is hidden)
   for(const sec of want.filter(x=>x!=='heatmap')){assert.ok(c[sec].chars>20,acct+' '+sec+' has rendered content while folded ('+c[sec].chars+' chars)');}
   assert.ok(c.heatmap.hasBody,acct+' heatmap container exists while folded');
  }
  assert.ok(await page.evaluate(()=>!!(window.__SNAP&&window.__SNAP.perf&&window.__SNAP.alloc&&window.__SNAP.ovMap)),'renderPerformance / load() still stash __SNAP.perf, alloc, ovMap');
  assert.equal(await stored(),null,'defaults write nothing to storage');
  assert.match(await page.locator('#page-portfolio .cn-all').innerText(),/Collapse all/,'rail label: open cards remain');
  // (b2) the treemap draws when its card opens (it cannot be laid out at zero width)
  for(const acct of ['main','agentic']){
   await nav('accounts',acct);await settle();
   await header(acct,'heatmap').click();await settle();
   const c=await cards(acct);assert.equal(c.heatmap.folded,false);assert.ok(c.heatmap.tiles>0,acct+' heatmap draws tiles on open ('+c.heatmap.tiles+')');
   const box=await page.locator((acct==='main'?'#heatmap':'#heatmap-ag')).boundingBox();assert.ok(box.width>100&&box.x>=0&&box.x+box.width<=391,acct+' heatmap fits the phone');
  }
  // (c) opening persists across a re-render of the card and across a reload; closing persists too
  for(const [acct,sec] of [['main','allocation'],['agentic','income']]){
   await nav('accounts',acct);await settle();
   await header(acct,sec).click();
   assert.equal((await cards(acct))[sec].folded,false,acct+' '+sec+' opened by tap');assert.equal((await cards(acct))[sec].aria,'true');
   assert.equal(JSON.parse(await stored())[acct+':'+sec],1,'open choice saved per card+account');
   await page.evaluate(([a,s])=>{window.__oldCard=document.querySelector((a==='main'?'#app':'#agentic-app')+' .card[data-sec="'+s+'"]');return a==='main'?load():renderAgenticPage();},[acct,sec]);await settle();
   assert.equal(await page.evaluate(()=>document.contains(window.__oldCard)),false,acct+' '+sec+' really re-rendered as a new node');
   assert.equal((await cards(acct))[sec].folded,false,acct+' '+sec+' stays open across a re-render');
   const other=acct==='main'?'agentic':'main';
   assert.equal(JSON.parse(await stored())[other+':'+sec],undefined,'the other account is not affected');
  }
  await reloadFresh(true);
  await nav('accounts','main');await settle();assert.equal((await cards('main')).allocation.folded,false,'main allocation open after reload');assert.equal((await cards('main')).income.folded,true,'untouched card still folded');
  await nav('accounts','agentic');await settle();assert.equal((await cards('agentic')).income.folded,false,'agentic income open after reload');assert.equal((await cards('agentic')).allocation.folded,true,'allocation is per account: agentic still folded');
  await nav('accounts','agentic');await settle();await header('agentic','income').click();
  assert.equal(JSON.parse(await stored())['agentic:income'],0);await reloadFresh(true);await nav('accounts','agentic');await settle();assert.equal((await cards('agentic')).income.folded,true,'a closed choice is honoured too');
  // storage failure = defaults, no error, toggling still works for the session
  await page.evaluate(()=>{Storage.prototype.setItem=function(){throw new Error('quota');};});
  await header('agentic','flow').click();assert.equal((await cards('agentic')).flow.folded,false,'toggle works with storage failing');
  await page.evaluate(()=>{window.__old2=document.querySelector('#agentic-app .card[data-sec="flow"]');renderAgenticPage();});await settle();
  assert.equal((await cards('agentic')).flow.folded,false,'session memory keeps the choice when storage fails');
  await reloadFresh(false);
  // (d) navigation opens a folded card: rail chip, rail expand/collapse-all, hidden routes, Find/My view target
  const opens=async(acct,how,sec)=>{await reloadFresh(false);await nav('accounts',acct);await settle();assert.equal((await cards(acct))[sec].folded,true,acct+' '+sec+' folded before '+how);await how();await settle();
   const c=(await cards(acct))[sec];assert.equal(c.folded,false,acct+' '+sec+' opened by '+how.label);assert.equal(c.aria,'true');
   const y=await page.locator((acct==='main'?'#app':'#agentic-app')+' .card[data-sec="'+sec+'"]').boundingBox();assert.ok(y.y<844&&y.y+y.height>0,acct+' '+sec+' scrolled into view');return c;};
  const chip=(acct,label)=>{const f=()=>page.locator('#page-portfolio .card-nav-chip',{hasText:label}).first().click();f.label='rail chip '+label;return f;};
  const route=(name,acct)=>{const f=()=>nav(name,acct);f.label='route '+name;return f;};
  for(const acct of ['main','agentic']){
   await opens(acct,chip(acct,'Technical Signals'),'technicals');
   await opens(acct,chip(acct,'Rebalance Log'),'rebalance-log');
   const h=await opens(acct,chip(acct,'Holdings Heatmap'),'heatmap');assert.ok(h.tiles>0,acct+' heatmap drawn after chip jump');
   for(const [r,sec] of [['heatmap','heatmap'],['income','income'],['technicals','technicals'],['fundamentals','fundamentals'],['flow','flow'],['log','rebalance-log']])await opens(acct,route(r,acct),sec);
   const find=()=>page.evaluate(([a])=>{const c=document.querySelector((a==='main'?'#app':'#agentic-app')+' .card[data-sec="allocation"]');return __pfGoCard(__navTitleOf(c),'portfolio');},[acct]);find.label='Find / My view jump';
   if(acct==='main')await opens(acct,find,'allocation');   // Find/My view index by title and pick the first match, so a shared title lands on the self-directed card (existing behaviour)
  }
  // expand/collapse-all keeps its label in sync and reaches every card
  await reloadFresh(false);await nav('accounts','main');await settle();
  await page.locator('#page-portfolio .cn-all').click();await settle();
  let c=await cards('main');assert.ok(Object.entries(c).filter(([k,v])=>v.hasBody).every(([k,v])=>v.folded),'collapse all folds every card');assert.match(await page.locator('#page-portfolio .cn-all').innerText(),/Expand all/);
  await page.locator('#page-portfolio .cn-all').click();await settle();
  c=await cards('main');assert.ok(Object.entries(c).filter(([k,v])=>v.hasBody).every(([k,v])=>!v.folded),'expand all opens every card');assert.match(await page.locator('#page-portfolio .cn-all').innerText(),/Collapse all/);
  assert.ok(c.heatmap.tiles>0,'expand all draws the heatmap');
  // a card pinned to My view does not start folded
  await reloadFresh(false);await nav('accounts','main');await settle();
  const pinTitle=await page.evaluate(()=>__navTitleOf(document.querySelector('#app .card[data-sec="fundamentals"]')));
  await page.evaluate(t=>{localStorage.setItem('pf_pins',JSON.stringify([t]));localStorage.removeItem('pf_card_fold_v1');},pinTitle);
  await page.reload();await page.waitForFunction(()=>window.__SNAP&&window.PFJourney);await settle();await nav('accounts','main');await settle();
  c=await cards('main');assert.equal(c.fundamentals.folded,false,'pinned card starts open');assert.equal(c.technicals.folded,true,'unpinned sibling still folded');
  await page.evaluate(()=>localStorage.removeItem('pf_pins'));
  // (e) no horizontal overflow, folded and fully expanded
  for(const [w,h] of [[390,844],[466,677],[960,676]]){
   await page.setViewportSize({width:w,height:h});
   for(const acct of ['main','agentic']){
    await reloadFresh(false);await nav('accounts',acct);await settle();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`${acct} ${w}x${h} folded: page width`);
    await page.locator('#page-portfolio .cn-all').click();await page.locator('#page-portfolio .cn-all').click();await settle();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`${acct} ${w}x${h} expanded: page width`);
   }
  }
  await page.setViewportSize({width:390,height:844});
  // (f) privacy masking still applies to a card opened after being folded
  await reloadFresh(false);await nav('accounts','main');await settle();
  assert.equal((await cards('main')).income.folded,true);
  assert.match(await page.evaluate(()=>document.getElementById('b-inc').textContent),/\$\d/,'income holds dollar figures while folded');
  await page.evaluate(()=>setPrivacy(true));await settle();
  await header('main','income').click();await settle();
  assert.doesNotMatch(await page.locator('#b-inc').innerText(),/\$\d/,'opened-after-folded income card is masked in privacy mode');
  await page.evaluate(()=>setPrivacy(false));await settle();assert.match(await page.locator('#b-inc').innerText(),/\$\d/);
  // (g) v237 contract (supersedes the v235 "unchanged" pin): the Agentic header carries value, today's move and Invested; the snapshot is the four tiles left; self-directed unchanged
  await nav('accounts','agentic');await settle();
  assert.match(await page.locator('#agentic-app .header .h-value').first().innerText(),/\$[\d,]+\.\d\d/);
  assert.match(await page.locator('#agentic-app .header').innerText(),/today.*Invested \$[\d,]+\.\d\d/s);
  assert.deepEqual(await page.locator('#agentic-app [data-sec="snapshot"] .snap-lbl').allTextContents(),['Unrealized','YTD Return','Idle Cash','Portfolio Beta']);
  await nav('accounts','main');await settle();
  assert.deepEqual(await page.locator('#app [data-sec="snapshot"] .snap-lbl').allTextContents(),['Buying Power','Day Change','Unrealized','YTD Return','Leverage','Portfolio Beta'],'self-directed snapshot labels');
  await page.evaluate(()=>{localStorage.removeItem('pf_card_fold_v1');localStorage.removeItem('pf_pins');});
 }
 // ── v236 Dashboard 2.0 Phase 3a: Options leads with what you hold and the income rankers; three secondary cards start folded (display only) ──
 {
  const KEY='pf_card_fold_v1';
  const ORDER=['Options Exposure','Your Options','Upcoming Expirations','Covered-Call Income','Cash-Secured Put Income','Trade Ideas','Options Income & History','Roll Scorecard','Options Knowledge'];
  const FOLD={'opt-history':'Options Income & History','opt-rolls':'Roll Scorecard','opt-knowledge':'Options Knowledge'};
  const T=(sym,date,net,opened,exp,strike)=>({symbol:sym,date,net,opening:Math.abs(net)+80,closing:-80,status:'Closed',opened,expiration:exp,strike,type:'call',quantity:1});
  const rich=()=>{sample.options.rolls=[{symbol:'IREN',date:'2026-10-20',contracts:2,old:{strike:45,expiration:'2026-10-23'},new:{strike:50,expiration:'2026-11-20'},netCredit:0.35,dteAtRoll:3,grade:{verdict:'green',reasons:['Net credit.']},settle:{rollVsDoNothingPerSh:0.12}}];
   sample.options.rollSummary={vsDoNothing:24,estimated:true,forCredit:1,forDebit:0,settled:1,green:1};
   sample.options.incomeHistory={version:2,asOf:'2026-11-16',premiumYTD:2498,trades:[T('IREN','2026-11-10',212,'2026-10-20','2026-11-20',50),T('AAPL','2026-10-14',-61,'2026-09-30','2026-10-18',230),T('MSFT','2026-10-02',140,'2026-09-12','2026-10-16',450)],unresolved:0,pendingResolution:0,coverage:'Synthetic ledger.'};};
  const plain=()=>{delete sample.options.rolls;delete sample.options.rollSummary;delete sample.options.incomeHistory;};
  const reload=async(keep)=>{await page.evaluate(k=>{if(!k)localStorage.removeItem('pf_card_fold_v1');},keep);await page.reload();await page.waitForFunction(()=>window.__SNAP&&window.PFJourney);await settle();await nav('options');await settle();};
  const opt=()=>page.evaluate(()=>[...document.querySelectorAll('#options-app>.card')].map(c=>{
   const t=c.querySelector(':scope > .card-title'),b=c.querySelector(':scope > .card-body');
   const clone=t&&t.cloneNode(true);clone&&clone.querySelectorAll('.chevron,.card-hint,.help-btn,.pin-btn').forEach(x=>x.remove());
   return {title:clone?clone.textContent.replace(/^\W+/u,'').replace(/\s+/g,' ').trim():'',sec:c.getAttribute('data-sec'),folded:!!b&&b.style.display==='none',aria:t&&t.getAttribute('aria-expanded'),chars:b?(b.textContent||'').trim().length:-1,
    box:(r=>[Math.round(r.left),Math.round(r.top+scrollY),Math.round(r.width),Math.round(r.height)])(c.getBoundingClientRect())};}));
  const by=(cards,name)=>cards.find(c=>c.title===name);
  const hdr=name=>page.locator('#options-app>.card>.card-title',{hasText:name}).first();
  rich();
  await page.setViewportSize({width:390,height:844});await nav('options');await reload(false);
  // (a) the new order, and exactly three cards folded
  let c=await opt();
  assert.deepEqual(c.map(x=>x.title),ORDER,'Options card order');
  for(const x of c){const f=Object.values(FOLD).includes(x.title);assert.equal(x.folded,f,x.title+(f?' starts folded':' stays open'));assert.equal(x.aria,f?'false':'true',x.title+' aria-expanded');}
  for(const [sec,title] of Object.entries(FOLD))assert.equal(by(c,title).sec,sec,title+' stable data-sec');
  // (b) every card is still rendered while folded
  for(const x of c)assert.ok(x.chars>20,x.title+' has rendered content ('+x.chars+' chars)');
  assert.ok(await page.evaluate(()=>document.querySelectorAll('#options-app canvas').length>0),'payoff canvases still rendered');
  assert.equal(await page.evaluate(k=>localStorage.getItem(k),KEY),null,'defaults write nothing');
  // (c) open persists across a re-render and a reload; a closed choice too
  await hdr('Options Income & History').click();await settle();
  assert.equal(by(await opt(),'Options Income & History').folded,false);
  assert.equal(JSON.parse(await page.evaluate(k=>localStorage.getItem(k),KEY))['options:opt-history'],1);
  await page.evaluate(()=>{window.__old=document.querySelector('#options-app>.card[data-sec="opt-history"]');renderOptions(document.getElementById('options-app'),__DATA.options,__DATA.realized);});await settle();
  assert.equal(await page.evaluate(()=>document.contains(window.__old)),false,'history card really re-rendered');
  assert.equal(by(await opt(),'Options Income & History').folded,false,'open survives a re-render');
  assert.equal(by(await opt(),'Roll Scorecard').folded,true);
  await reload(true);c=await opt();
  assert.equal(by(c,'Options Income & History').folded,false,'open survives a reload');assert.equal(by(c,'Options Knowledge').folded,true);
  await hdr('Options Income & History').click();await settle();await reload(true);
  assert.equal(by(await opt(),'Options Income & History').folded,true,'closed choice survives a reload');
  // history scoreboard draws once opened
  await hdr('Options Income & History').click();await settle();
  const sb=await page.locator('#options-app .oh-score').boundingBox();assert.ok(sb&&sb.width>100&&sb.x>=0&&sb.x+sb.width<=391,'history scoreboard visible and inside the phone width');
  // (d) navigation lands on an open, visible card: Covered-Call chip, and each folded card's rail chip
  await reload(false);
  const chip=async label=>{await page.locator('#page-options .card-nav-chip',{hasText:label}).first().click();await settle();};
  const seen=async name=>{const x=by(await opt(),name);assert.equal(x.folded,false,name+' open after navigation');assert.equal(x.aria,'true');
   const r=await page.evaluate(n=>{const c=[...document.querySelectorAll('#options-app>.card')].find(k=>(k.querySelector('.card-title')?.textContent||'').includes(n));const b=c.getBoundingClientRect();return [b.top,b.bottom];},name);assert.ok(r[0]<844&&r[1]>0,name+' scrolled into view');};
  await chip('Covered-Call Income');await seen('Covered-Call Income');
  for(const name of Object.values(FOLD)){await reload(false);assert.equal(by(await opt(),name).folded,true);await chip(name);await seen(name);}
  await reload(false);await page.evaluate(()=>{const c=document.querySelector('#options-app>.card[data-sec="opt-rolls"]');__pfGoCard(__navTitleOf(c),'options');});await settle();await seen('Roll Scorecard');
  // rail Expand/Collapse all reaches the folded cards and keeps its label
  await reload(false);
  assert.match(await page.locator('#page-options .cn-all').innerText(),/Collapse all/);
  await page.locator('#page-options .cn-all').click();await settle();assert.ok((await opt()).every(x=>x.folded),'collapse all');
  await page.locator('#page-options .cn-all').click();await settle();assert.ok((await opt()).every(x=>!x.folded),'expand all');assert.match(await page.locator('#page-options .cn-all').innerText(),/Collapse all/);
  // a card pinned to My view starts open
  await page.evaluate(()=>{localStorage.setItem('pf_pins',JSON.stringify([__navTitleOf(document.querySelector('#options-app>.card[data-sec="opt-knowledge"]'))]));localStorage.removeItem('pf_card_fold_v1');});
  await reload(true);c=await opt();assert.equal(by(c,'Options Knowledge').folded,false,'pinned card starts open');assert.equal(by(c,'Roll Scorecard').folded,true);
  await page.evaluate(()=>localStorage.removeItem('pf_pins'));
  // (e) no horizontal overflow at four sizes, folded and expanded; open-Duo pairing keeps the v234 layout
  const cdp=await page.context().newCDPSession(page);
  for(const [w,h,inset] of [[390,844,{}],[466,677,{right:84}],[960,676,{right:100}],[677,466,{left:85}]]){
   await page.setViewportSize({width:w,height:h});await cdp.send('Emulation.setSafeAreaInsetsOverride',{insets:{top:0,bottom:0,right:inset.right||0,left:inset.left||0}});
   await reload(false);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`options ${w}x${h} folded: page width`);
   if(w===960){
    const k=await opt(),cc=by(k,'Covered-Call Income').box,cs=by(k,'Cash-Secured Put Income').box,ex=by(k,'Upcoming Expirations').box,ti=by(k,'Trade Ideas').box;
    assert.equal(cc[1],cs[1],'the two income rankers sit on one row');assert.equal(cc[2],cs[2],'and are the same width');assert.ok(cs[0]>cc[0]+cc[2]-2,'side by side');
    assert.ok(cc[2]<ex[2]*0.6,'rankers are half width');assert.ok(ex[2]>=ti[2]-1&&ti[2]>cc[2]*1.8,'Expirations and Trade Ideas stay full width');
    assert.ok(cc[1]>=ex[1]+ex[3]&&ti[1]>=cc[1]+cc[3],'order down the page: Expirations, rankers, Trade Ideas');
    for(const t of ['Options Income & History','Roll Scorecard','Options Knowledge'])assert.ok(by(k,t).box[2]>=ti[2]-1,t+' is full width');
   }
   await page.locator('#page-options .cn-all').click();await page.locator('#page-options .cn-all').click();await settle();
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`options ${w}x${h} expanded: page width`);
  }
  await cdp.send('Emulation.setSafeAreaInsetsOverride',{insets:{top:0,bottom:0,right:0,left:0}});
  await page.setViewportSize({width:390,height:844});
  // (f) privacy masking applies to a card opened after being folded
  await reload(false);
  assert.equal(by(await opt(),'Options Income & History').folded,true);
  assert.match(await page.locator('#options-app>.card[data-sec="opt-history"]').evaluate(e=>e.textContent),/\$\d/,'history holds dollar figures while folded');
  await page.evaluate(()=>setPrivacy(true));await settle();
  await hdr('Options Income & History').click();await settle();
  assert.doesNotMatch(await page.locator('#options-app>.card[data-sec="opt-history"] .opt-income-amount').innerText(),/\$\d/,'opened-after-folded history is masked in privacy mode');
  await page.evaluate(()=>setPrivacy(false));await settle();
  // (g) empty state: no ledger and no rolls. The history notice stays visible, no Roll Scorecard card, page unchanged otherwise
  plain();await reload(false);c=await opt();
  assert.deepEqual(c.map(x=>x.title),ORDER.filter(t=>t!=='Roll Scorecard'),'order without a Roll Scorecard');
  assert.equal(by(c,'Options Income & History').folded,false,'empty-state history card is left open');
  assert.match(await page.locator('#options-app>.card[data-sec="opt-history"]').innerText(),/Trade history is not in this snapshot yet/);
  assert.equal(by(c,'Options Knowledge').folded,true);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.evaluate(()=>{localStorage.removeItem('pf_card_fold_v1');localStorage.removeItem('pf_pins');});
 }

 // ── v237 Dashboard 2.0 Phase 1b: Agentic header carries Invested, repeated tiles removed; the tape stops repeating account numbers on Today and Accounts (display only) ──
 {
  const cdp=await page.context().newCDPSession(page);
  const AGH='#agentic-app .header', AGT='#agentic-app [data-sec="snapshot"] .snap-lbl';
  const hdr=async()=>({val:await page.locator(AGH+' .h-value').innerText(),sub:await page.locator(AGH+' .h-sub-ag').count()?await page.locator(AGH+' .h-sub-ag').innerText():null,all:await page.locator(AGH).innerText()});
  const withAgentic=async(mut)=>{await page.evaluate(m=>{window.__v237bak=window.__v237bak||JSON.stringify({a:__DATA.agentic,g:__DATA.generatedAt});const A=JSON.parse(window.__v237bak).a;const gen=JSON.parse(window.__v237bak).g;__DATA.agentic=A;__DATA.generatedAt=gen;if(m)(new Function('d',m))(__DATA);renderAgenticPage();renderAgenticAnalytics();},mut||'');await settle();};
  const restore=async()=>{await page.evaluate(()=>{if(window.__v237bak){const b=JSON.parse(window.__v237bak);__DATA.agentic=b.a;__DATA.generatedAt=b.g;renderAgenticPage();renderAgenticAnalytics();}});await settle();};
  await nav('accounts','agentic');await settle();
  // (a) every data state: value, today's move and Invested in the header; privacy masks all three
  const present=await hdr();
  assert.match(present.val,/^\$793\.14$/);assert.match(present.sub,/^[▲▼] \$[\d,.]+ today \(.*%\) · Invested \$597\.14$/);
  assert.deepEqual(await page.locator(AGT).allTextContents(),['Unrealized','YTD Return','Idle Cash','Portfolio Beta']);
  assert.equal(await page.locator('#agentic-app [data-sec="snapshot"] .snap').count(),4);
  await page.evaluate(()=>setPrivacy(true));await settle();
  assert.doesNotMatch((await hdr()).all,/\$\d/,'privacy masks the header value, move and Invested');
  assert.match((await hdr()).all,/Invested/);
  await page.evaluate(()=>setPrivacy(false));await settle();
  // invested missing: positions carry no value => Invested is unknown ("—"), never $0.00; value and move stay
  await withAgentic('d.agentic.positions.forEach(p=>{p.value=0;});');
  let h=await hdr();assert.match(h.val,/^\$793\.14$/);assert.match(h.sub,/today.* · Invested —$/);assert.doesNotMatch(h.sub,/Invested \$0/);
  assert.equal(await page.locator('#agentic-app [data-sec="snapshot"] .snap').count(),4);
  // equity missing: header value falls back to cash + invested (unchanged rule); Invested still shown
  await withAgentic('delete d.agentic.equity;');
  h=await hdr();assert.match(h.val,/^\$\d[\d,]*\.\d\d$/);assert.match(h.sub,/Invested \$597\.14$/);
  // equity below invested (stale equity vs fresher quotes): header keeps the producer equity, Invested shows the priced total
  await withAgentic('d.agentic.equity=500;');
  h=await hdr();assert.match(h.val,/^\$500\.00$/);assert.match(h.sub,/Invested \$597\.14$/);
  // prior close unknown: no invented $0.00 move; Invested alone
  await withAgentic('d.agentic.positions.forEach(p=>{p.symbol="ZZ"+p.symbol;});');
  h=await hdr();assert.doesNotMatch(h.all,/today/);
  // stale snapshot: the same header and four tiles (staleness is the freshness bar's job, as before)
  await withAgentic('d.generatedAt=new Date(Date.now()-9*3600e3).toISOString();');
  h=await hdr();assert.match(h.val,/^\$793\.14$/);assert.match(h.sub,/today.* · Invested \$597\.14$/);
  assert.deepEqual(await page.locator(AGT).allTextContents(),['Unrealized','YTD Return','Idle Cash','Portfolio Beta']);
  // account not captured: no figure, no today, no Invested, no tiles
  await withAgentic('d.agentic=null;');
  h=await hdr();assert.equal(h.val,'—');assert.equal(h.sub,null);assert.equal(await page.locator('#agentic-app [data-sec="snapshot"] .snap').count(),0);
  await restore();
  // (b) self-directed header and six tiles unchanged
  await nav('accounts','main');await settle();
  assert.deepEqual(await page.locator('#app [data-sec="snapshot"] .snap-lbl').allTextContents(),['Buying Power','Day Change','Unrealized','YTD Return','Leverage','Portfolio Beta']);
  assert.doesNotMatch(await page.locator('#app .header').first().innerText(),/Invested/);
  // (c) no horizontal overflow, clean tile layout, at the five widths (with the Duo status inset used by holdings-duo-browser)
  const VP=[[390,844,{},2],[466,677,{right:84},2],[960,676,{right:100},4],[677,466,{left:85},2],[1280,800,{},4]];
  const SIX={390:2,466:3,960:6,677:3,1280:5};
  for(const [w,hh,ins,agCols] of VP){
   await page.setViewportSize({width:w,height:hh});await cdp.send('Emulation.setSafeAreaInsetsOverride',{insets:{top:0,bottom:0,right:ins.right||0,left:ins.left||0}});await settle();
   for(const acct of ['agentic','main']){
    await nav('accounts',acct);await settle();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`${acct} ${w}x${hh} page width`);
    const root=acct==='agentic'?'#agentic-app':'#app';
    const boxes=await page.locator(root+' [data-sec="snapshot"] .snap').evaluateAll(a=>a.map(e=>{const r=e.getBoundingClientRect();return [Math.round(r.left),Math.round(r.top),Math.round(r.width),Math.round(r.height)];}));
    const cols=new Set(boxes.map(b=>b[0])).size,grid=await page.locator(root+' [data-sec="snapshot"] .snap-grid').evaluate(e=>e.getBoundingClientRect().right);
    assert.ok(boxes.every(b=>b[0]+b[2]<=grid+2),`${acct} ${w}x${hh} tiles inside the card`);
    if(acct==='agentic'){assert.equal(boxes.length,4);assert.equal(cols,agCols,`agentic ${w}x${hh}: ${agCols} tile columns (2x2 or one row of four)`);assert.equal(new Set(boxes.map(b=>b[2])).size,1,'tiles are equal width (no stretched/orphan tile)');assert.equal(new Set(boxes.map(b=>b[1])).size,agCols===4?1:2,`${w}: rows`);}
    else{assert.equal(boxes.length,6);assert.equal(cols,Math.min(6,SIX[w]),`self-directed ${w}x${hh} keeps its ${SIX[w]}-column grid`);}
    // header does not overflow its card either
    assert.equal(await page.locator((acct==='agentic'?'#agentic-app':'#app')+' .header').first().evaluate(e=>e.scrollWidth<=e.clientWidth+1),true,`${acct} ${w}: header fits`);
   }
  }
  await cdp.send('Emulation.setSafeAreaInsetsOverride',{insets:{top:0,bottom:0,right:0,left:0}});await page.setViewportSize({width:390,height:844});await settle();
  // (d) the tape: account value / today's move items are hidden on Today and the Accounts routes; everything else stays; same strip height and page offset everywhere
  const tape=()=>page.evaluate(()=>{const t=document.getElementById('pf-tape'),h=t.querySelector('.tk-half'),its=[...h.querySelectorAll('.tk-it')];
   return {h:Math.round(t.getBoundingClientRect().height*100)/100,pad:getComputedStyle(document.body).paddingTop,fresh:Math.round(document.getElementById('pf-fresh').getBoundingClientRect().top+scrollY),
    combined:its.filter(x=>x.getAttribute('aria-label')==='Combined day move').length,accts:its.filter(x=>x.matches('[data-ex-route="accounts"]')).length,
    breadth:its.filter(x=>x.getAttribute('aria-label')==='Holdings up and down').length,syms:its.filter(x=>x.hasAttribute('data-tk-sym')).length,
    secs:[...h.querySelectorAll('.tk-sec')].map(x=>x.textContent),stat:t.querySelector('.tk-stat-txt').textContent.trim(),n:its.length};});
  const HIDE=['today','accounts','holdings','performance','heatmap','risk','income'],SHOW=['options','plan','markets','analyze','smartmoney','predictions','activity','decisions'];
  await page.evaluate(()=>setPrivacy(false));
  let ref=null;const seen={};
  for(const r of [...HIDE,...SHOW]){
   await nav(r,r==='accounts'?'main':undefined);await settle();await page.evaluate(()=>scrollTo(0,0));await page.waitForTimeout(150);
   const t=await tape();seen[r]=t;
   if(HIDE.includes(r)){assert.equal(t.combined,0,r+': no combined day move item');assert.equal(t.accts,0,r+': no per-account value items');}
   else{assert.equal(t.combined,1,r+': combined day move shown');assert.equal(t.accts,2,r+': both account items shown');}
   assert.ok(t.breadth===1&&t.syms>=7&&t.secs.includes('Markets')&&t.secs.includes('Holdings')&&t.stat.length>0,r+': market, holdings, breadth and status stay');
   if(!ref)ref=t;assert.equal(t.h,ref.h,r+': strip height');assert.equal(t.pad,ref.pad,r+': page top padding');
   if(!['holdings','performance','heatmap','risk','income'].includes(r))assert.equal(t.fresh,ref.fresh,r+': page offset under the strip');
  }
  assert.equal(seen.today.n+3,seen.options.n,'exactly the three account items are removed');
  assert.deepEqual(seen.today.secs,seen.options.secs,'same strip sections on Today and Options');
  // route change, Back/Forward, account switch and reload keep it in step
  await nav('today');await settle();assert.equal((await tape()).combined,0);
  await nav('options');await settle();assert.equal((await tape()).combined,1);
  await page.goBack();await settle();assert.equal((await state()).route,'today');assert.equal((await tape()).combined,0,'Back to Today hides them');
  await page.goForward();await settle();assert.equal((await state()).route,'options');assert.equal((await tape()).combined,1,'Forward to Options shows them');
  await nav('accounts','agentic');await settle();assert.equal((await tape()).accts,0);
  await page.evaluate(()=>setAccount('main'));await settle();assert.equal((await state()).account,'main');assert.equal((await tape()).accts,0,'account switch on Accounts keeps them hidden');await nav('plan','main');await settle();await page.evaluate(()=>setAccount('agentic'));await settle();assert.equal((await tape()).accts,2,'account switch on Plan keeps them');await nav('accounts','agentic');await settle();
  await nav('plan','agentic');await settle();assert.equal((await tape()).accts,2,'Plan keeps them, either account');
  await page.reload();await page.waitForFunction(()=>window.__SNAP&&window.PFJourney);await settle();assert.equal((await state()).route,'plan');assert.equal((await tape()).accts,2);
  await nav('today');await settle();await page.reload();await page.waitForFunction(()=>window.__SNAP&&window.PFJourney);await settle();assert.equal((await tape()).combined,0,'reload on Today');
  // privacy on Today: the strip still has no account dollar figures; on Options it masks them
  await page.evaluate(()=>setPrivacy(true));await settle();
  assert.doesNotMatch(await page.locator('#pf-tape .tk-half').first().innerText(),/Self-directed|Agentic\s*\$/);
  await nav('options');await settle();assert.doesNotMatch(await page.locator('#pf-tape .tk-half').first().locator('[data-ex-account]').first().innerText().catch(()=>''),/\$\d/);
  await page.evaluate(()=>setPrivacy(false));await settle();
  // no data / locked states keep their message on every route (unchanged paths)
  await page.evaluate(()=>{window.__v237d=window.__DATA;window.__DATA={locked:true};PFTape.render();});await nav('today');await settle();
  assert.match(await page.locator('#pf-tape .tk-half').first().innerText(),/Unlock/);
  await page.evaluate(()=>{window.__DATA=window.__v237d;PFTape.render();});await settle();
  await page.evaluate(()=>{localStorage.removeItem('pf_card_fold_v1');localStorage.removeItem('pf_pins');});
 }
 // ── Navigation B (Jack, Nov 17 2026): Today · Apex · Agentic · Research · More — grouping only, all 21 routes, both accounts ──
 {
  const {runNavChecks}=await import('./nav-b-checks.mjs');
  await runNavChecks({browser,base,sample,stub,writes,tapOut:process.env.PF_TAP_JSON,
   apex:{asOf:new Date().toISOString(),targets:{MSFT:20},top5:[{sym:'MSFT',composite:8,why:'Synthetic entry research',limit:420,trigger:420,stop:380,tp1:500,orderType:'limit',tradable:true}],heldLevels:[{sym:'AAPL',stop:170,tp1:230,why:'Synthetic held-name evidence'}]}});
 }
 // ── v239 Dashboard 2.0 Phase 3b: Plan (agentic), Screens and Predict keep decisions open; reference cards start folded (display only) ──
 {
  const {runResearchFoldChecks}=await import('./research-folds-checks.mjs');
  await runResearchFoldChecks({browser,base,sample,stub,writes,
   apex:{asOf:new Date().toISOString(),targets:{MSFT:20},top5:[{sym:'MSFT',composite:8,why:'Synthetic entry research',limit:420,trigger:420,stop:380,tp1:500,orderType:'limit',tradable:true}],heldLevels:[{sym:'AAPL',stop:170,tp1:230,why:'Synthetic held-name evidence'}]}});
 }
 assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);
 console.log('journey-browser PASS: Back/Forward/reload, scroll, account-local selection, search/evidence filters, expansion, privacy, keyboard, 12 destinations × 5 widths, themes; Accounts default-fold, persistence and navigation; Options order, folds, Duo pairing and empty state; Plan/Screens/Predict folds (v239); Navigation B (five areas, 21 routes x both accounts, tap counts, deep links, stored prefs, Back/Forward, account sync, Classic, layouts); no writes.');
}finally{await browser.close();}
