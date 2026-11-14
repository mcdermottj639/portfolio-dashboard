// Synthetic account data and actual Chromium safe-area emulation. No broker calls.
import assert from 'node:assert/strict';
import fs from 'node:fs';
const {chromium}=await import(process.env.PF_PLAYWRIGHT||'playwright');
const base=(process.env.PF_PREVIEW_URL||'http://127.0.0.1:8767/').replace(/\/?$/,'/');
const sample=JSON.parse(fs.readFileSync('tmp/experience-preview/sample.json','utf8'));
sample.agentic.positions=[{symbol:'AAPL',qty:1.25,avgCost:100,px:120,value:150},{symbol:'TINY',qty:.025,avgCost:10,px:20,value:.5}];
sample.agentic.cash=49.5;sample.agentic.equity=200;
sample.quotes.AAPL={...(sample.quotes.AAPL||{}),previous_close:100,adjusted_previous_close:100};
sample.quotes.TINY={previous_close:20};
const stub=fs.readFileSync('producer/privacy-audit.mjs','utf8').match(/const CHART_STUB = `([\s\S]*?)`;/)[1];
const browser=await chromium.launch({...(process.env.PF_CHROME?{executablePath:process.env.PF_CHROME}:{}),args:['--no-sandbox','--disable-dev-shm-usage']});
const out='tmp/journey-evidence';fs.mkdirSync(out,{recursive:true});
try{
 const page=await browser.newPage({viewport:{width:373,height:678},timezoneId:'America/New_York',serviceWorkers:'block'});
 const errors=[],writes=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(!['GET','HEAD'].includes(r.method()))writes.push(r.url());});
 await page.addInitScript(stub);
 await page.route('https://**/*',r=>r.request().url().startsWith(base)?r.continue():r.abort());
 await page.route(/\/data\.json(?:\?.*)?$/,r=>r.fulfill({json:sample}));
 await page.goto(base);await page.waitForFunction(()=>window.__SNAP&&window.PFJourney);
 const settle=()=>page.waitForTimeout(300);
 const nav=async(route,account='agentic')=>{await page.evaluate(({route,account})=>PFExperience.navigate(route,{account}),{route,account});await settle();};
 await nav('holdings');
 await page.waitForSelector('#pos-table-ag .sym');
 const row=page.locator('#pos-table-ag tbody tr').filter({has:page.locator('.sym', {hasText:'AAPL'})});
 await row.locator('.pj-row-toggle').click();
 assert.match(await row.innerText(),/1\.25/);assert.match(await row.innerText(),/\$100\.00/);assert.match(await row.innerText(),/\$120\.00/);assert.match(await row.innerText(),/\$150\.00/);assert.match(await row.innerText(),/\$25\.00/);assert.match(await row.innerText(),/20\.00%/);
 assert.equal(await page.locator('#pos-table-ag .sym').count(),2,'fractional position below $1 stays visible');
 await page.locator('#pj-holding-search-ag').fill('TINY');assert.equal(await page.locator('#pos-table-ag tbody tr:not([hidden]) .sym').count(),1);
 await page.reload();await page.waitForFunction(()=>window.PFJourney&&window.__SNAP);await settle();
 assert.equal(await page.locator('#pj-holding-search-ag').inputValue(),'TINY','refresh retains agentic query');
 await nav('holdings','main');await page.locator('#pj-holding-search').fill('AAPL');
 await nav('holdings');assert.equal(await page.locator('#pj-holding-search-ag').inputValue(),'TINY','account filters are independent');
 await page.locator('#pj-clear-ag').click();
 await page.locator('#pos-table-ag th').filter({hasText:/^Value/}).click();await settle();
 assert.equal(await page.locator('#pos-table-ag .sym').first().innerText(),'TINY');
 await page.locator('#pos-table-ag .az-link').filter({hasText:'AAPL'}).click();await settle();
 assert.equal(await page.evaluate(()=>PFJourney.state.account),'agentic');assert.equal(await page.evaluate(()=>PFJourney.state.symbol),'AAPL');
 await page.goBack();await settle();assert.equal(await page.evaluate(()=>PFJourney.state.route),'holdings');
 await page.evaluate(()=>setPrivacy(true));await settle();assert.doesNotMatch(await page.locator('#pos-table-ag').innerText(),/\$\d/);
 await page.evaluate(()=>setPrivacy(false));await settle();
 // Assert delayed safe-area changes, not manual class injection. The old one-shot
 // probe missed this event when no window resize/orientation event was sent.
 const cdp=await page.context().newCDPSession(page);
 const insets=async(right=0,left=0)=>{await cdp.send('Emulation.setSafeAreaInsetsOverride',{insets:{top:0,bottom:0,right,left}});await settle();};
 await page.setViewportSize({width:466,height:678});await insets();
 await insets(84);await page.waitForFunction(()=>document.documentElement.classList.contains('pf-side-status'));
 assert.equal(await page.evaluate(()=>parseFloat(getComputedStyle(document.body).paddingRight)),12,'cards reclaim measurable right inset');
 assert.equal(await page.evaluate(()=>document.documentElement.style.getPropertyValue('--duo-r')),'84px');
 await insets();await page.waitForFunction(()=>!document.documentElement.classList.contains('pf-side-status'));
 await insets(44,44);assert.equal(await page.evaluate(()=>document.documentElement.classList.contains('pf-side-status')),false,'ordinary symmetric notch is protected');
 for(const mode of [
  {name:'phone',width:320,height:844},{name:'duo-host-inset',width:373,height:678},
  {name:'duo-folded',width:466,height:678,right:84},
  {name:'duo-open',width:960,height:676,right:100,rail:true},
  {name:'duo-sideways',width:678,height:453,left:85,rail:true},
  {name:'desktop',width:1440,height:900,rail:true}
 ]){
  await page.setViewportSize({width:mode.width,height:mode.height});await insets(mode.right||0,mode.left||0);
  for(const theme of ['light','dark']){
   await page.evaluate(theme=>PFTheme.set(theme),theme);
   for(const account of ['main','agentic']){
    await nav('holdings',account);
    const suffix=account==='agentic'?'-ag':'';await page.locator('#pj-clear'+suffix).click();
    const first=page.locator('#pos-table'+suffix+' .pj-row-toggle').first();
    if(await first.isVisible()&&await first.getAttribute('aria-expanded')!=='true')await first.click();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`${mode.name} ${account}: page overflow`);
    const table=page.locator('#pos-table'+suffix),box=await table.boundingBox();assert.ok(box.x>=0&&box.x+box.width<=mode.width+1);
    const clipped=await table.locator('tbody tr.pf-open td').evaluateAll(cells=>cells.filter(c=>getComputedStyle(c).display!=='none'&&c.scrollWidth>c.clientWidth+2).map(c=>c.dataset.l||'symbol'));
    assert.deepEqual(clipped,[],`${mode.name} ${account}: clipped holding details`);
    const rail=await page.locator('.ex-main').boundingBox();assert.equal(rail.width<200,!!mode.rail,`${mode.name}: navigation orientation`);
    await page.screenshot({path:`${out}/${base.startsWith('https:')?'live-':''}holdings-${mode.name}-${account}-${theme}.png`});
   }
   for(const route of ['today','plan','markets','options']){await nav(route);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`${mode.name} ${route}: page overflow`);}
  }
 }
 await page.setViewportSize({width:373,height:678});await insets();await nav('holdings');
 await page.evaluate(()=>{__DATA.agentic.positions.push({symbol:'MISS',qty:1,avgCost:null,px:0,value:0});renderAgenticPage();});await settle();
 const missing=page.locator('#pos-table-ag tbody tr').filter({has:page.locator('.sym',{hasText:'MISS'})});
 await missing.locator('.pj-row-toggle').click();assert.doesNotMatch(await missing.innerText(),/\$0\.00|GOOD|0\.00%/);
 await page.locator('.ag-trade-review summary').click();assert.ok(await page.locator('#agentic-content').isVisible(),'original target/trade review remains available');
 assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);
 console.log('holdings-duo-browser PASS: account parity, fractional/unknown rows, sort/search/Back/refresh/privacy; delayed inset + symmetric notch; folded/open/sideways, 2 accounts × 2 themes; original trade review, no writes.');
}finally{await browser.close();}
