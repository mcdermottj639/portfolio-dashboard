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
 assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);
 console.log('journey-browser PASS: Back/Forward/reload, scroll, account-local selection, search/evidence filters, expansion, privacy, keyboard, 12 destinations × 5 widths, themes; no writes.');
}finally{await browser.close();}
