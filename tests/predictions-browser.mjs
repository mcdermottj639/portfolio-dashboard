// Start tests/preview.mjs first. Account data is synthetic; public markets use the committed snapshot.
// PF_PLAYWRIGHT and PF_CHROME may point to an existing local Playwright/Chromium installation.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const {chromium}=await import(process.env.PF_PLAYWRIGHT||'playwright');
const stub=fs.readFileSync(path.join(root,'producer/privacy-audit.mjs'),'utf8').match(/const CHART_STUB = `([\s\S]*?)`;/)[1];
const publicData=JSON.parse(fs.readFileSync(path.join(root,'data/predictions.json')));
let response=publicData,fail=false;
const browser=await chromium.launch({...(process.env.PF_CHROME?{executablePath:process.env.PF_CHROME}:{}),args:['--no-sandbox','--disable-dev-shm-usage']});
try{
  const page=await browser.newPage({viewport:{width:1440,height:1000},timezoneId:'America/New_York'}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(stub);
  await page.addInitScript(()=>{localStorage.setItem('pf_experience_route','predictions');});
  await page.route('https://**/*',r=>r.abort());
  await page.route('**/data/predictions.json',r=>fail?r.fulfill({status:503,body:'unavailable'}):r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(response)}));
  await page.goto(process.env.PF_PREVIEW_URL||'http://127.0.0.1:8767');
  await page.waitForSelector('#predictions-app .pred-market');
  assert.equal(await page.locator('#ex-account').isVisible(),false);
  assert.equal(await page.locator('[data-ex-area="predictions"]').getAttribute('aria-current'),'page');
  assert.equal(await page.locator('#page-ex-today').isVisible(),false);
  assert.equal(await page.locator('#predictions-app>.pred-head h1').innerText(),'Predictions');
  for(const width of [320,390,768,1440]){
    await page.setViewportSize({width,height:960});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'no horizontal overflow at '+width);
  }
  const first=page.locator('.pred-market').first(),id=await first.getAttribute('data-market');
  await first.locator('.pred-details summary').click();
  assert.ok(await first.locator('svg').count());
  await page.locator('[data-pred-action="refresh"]').first().click();
  await page.waitForFunction(()=>!document.querySelector('.pred-head').textContent.includes('Refreshing'));
  assert.equal(await first.locator('details').getAttribute('open'),'','expanded research survives refresh');
  await first.locator('.pred-details summary').click();
  const screenshotDir=process.env.PF_SCREENSHOT_DIR;
  if(screenshotDir){fs.mkdirSync(screenshotDir,{recursive:true});await page.screenshot({path:path.join(screenshotDir,'predictions-desktop.png'),fullPage:false});await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(screenshotDir,'predictions-mobile.png'),fullPage:false});await page.setViewportSize({width:1440,height:1000});}
  await page.locator('#pred-search').fill('nonsensezzzz');assert.equal(await page.locator('.pred-market').count(),0);
  await page.locator('#pred-search').fill('');
  await page.locator('[data-pred-category="Economics"]').click();
  assert.ok((await page.locator('.pred-market').evaluateAll(nodes=>nodes.map(n=>n.dataset.market))).every(id=>publicData.markets.find(m=>m.id===id)?.category==='Economics'));
  await page.locator('[data-pred-category="Elections"]').click();
  assert.ok(await page.locator('.pred-market').count()>0);
  assert.ok((await page.locator('.pred-market').evaluateAll(nodes=>nodes.map(n=>n.dataset.market))).every(id=>publicData.markets.find(m=>m.id===id)?.category==='Elections'));
  await page.locator('[data-pred-category="All"]').click();
  await page.locator('[data-pred-category="All"]').click();
  await first.locator('[data-pred-action="watch"]').click();
  await page.locator('#pred-tab-watchlist').click();
  assert.equal(await page.locator('.pred-market').count(),1);
  await page.locator('[name="target"]').fill('49.5');await page.locator('[name="side"]').selectOption('no');
  await page.evaluate(()=>window.PFPredictions.refresh());
  assert.equal(await page.locator('[name="target"]').inputValue(),'49.5');assert.equal(await page.locator('[name="side"]').inputValue(),'no','unsaved side survives a background refresh');
  await page.locator('button[type="submit"]').click();
  assert.match(await page.locator('.pred-notice').innerText(),/Target saved/);
  await page.reload();await page.waitForSelector('.pred-target');
  assert.equal(await page.locator('[name="target"]').inputValue(),'49.5');assert.equal(await page.locator('[name="side"]').inputValue(),'no');
  const downloadPromise=page.waitForEvent('download');await page.locator('[data-pred-action="export"]').click();const download=await downloadPromise;const exported=JSON.parse(fs.readFileSync(await download.path()));assert.equal(exported.watchlist[0].id,id);
  await page.locator('#pred-import').setInputFiles({name:'invalid.json',mimeType:'application/json',buffer:Buffer.from('{"schemaVersion":1,"watchlist":[null]}')});
  assert.match(await page.locator('.pred-notice').innerText(),/not a valid/);assert.equal(await page.locator('.pred-market').count(),1);
  await page.locator('[data-pred-action="watch"]').click();assert.equal(await page.locator('.pred-market').count(),0);
  await page.locator('#pred-import').setInputFiles({name:'valid.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(exported))});
  await page.waitForFunction(()=>document.querySelector('.pred-notice')?.textContent.includes('imported'));
  assert.match(await page.locator('.pred-notice').innerText(),/imported/);assert.equal(await page.locator('.pred-market').count(),1);
  response=structuredClone(publicData);response.generatedAt=new Date().toISOString();response.markets.forEach(m=>{m.asOf=response.generatedAt;m.closesAt=new Date(Date.now()+86400000).toISOString();});
  response.markets.find(m=>m.id===id).noAsk=.4;
  await page.evaluate(()=>window.PFPredictions.refresh());assert.match(await page.locator('.pred-target-state').innerText(),/Target price reached/);
  response.markets.find(m=>m.id===id).asOf=new Date(Date.now()-3600000).toISOString();
  await page.evaluate(()=>window.PFPredictions.refresh());assert.match(await page.locator('.pred-target-state').innerText(),/Quote stale/);
  fail=true;await page.evaluate(()=>window.PFPredictions.refresh());assert.match(await page.locator('.pred-feed-note').innerText(),/previous snapshot/);
  await page.locator('#pred-tab-positions').click();assert.match(await page.locator('#pred-content').innerText(),/not connected yet/);
  await page.evaluate(()=>{window.__DATA.predictions={schemaVersion:1,source:'robinhood',asOf:new Date().toISOString(),historyStart:'2026-01-01',coverage:{positions:true,transactions:true},balance:{value:123.45,availableCash:67.89},realizedNet:12.34,positions:[{name:'Synthetic private position',contractId:'PRIVATE',quantity:17,side:'yes',averagePrice:.45,marketValue:12.34,costBasis:7.65}],transactions:[]};window.PFPredictions.mount(document.getElementById('predictions-app'));});
  assert.match(await page.locator('#pred-content').innerText(),/123\.45/);
  await page.evaluate(()=>setPrivacy(true));assert.doesNotMatch(await page.locator('.pred-stats').innerText(),/123\.45|67\.89|12\.34|\b17\b/);
  await page.evaluate(()=>window.PFPredictions.mount(document.getElementById('predictions-app')));
  assert.doesNotMatch(await page.locator('.pred-stats').innerText(),/123\.45/);
  await page.evaluate(()=>setPrivacy(false));assert.match(await page.locator('.pred-stats').innerText(),/123\.45/);
  await page.locator('#pred-tab-positions').press('End');assert.equal(await page.locator('#pred-tab-results').getAttribute('aria-selected'),'true');assert.match(await page.locator('#pred-content').innerText(),/Hypothetical/);
  await page.locator('[data-ex-area="today"]').click();assert.equal(await page.locator('#page-predictions').isVisible(),false);
  await page.locator('[data-ex-area="predictions"]').click();assert.equal(await page.locator('#page-predictions').isVisible(),true);
  await page.evaluate(()=>document.documentElement.setAttribute('data-theme','gold'));
  for(const section of ['positions','ideas','watchlist','results']){
    await page.locator('#pred-tab-'+section).click();
    for(const width of [320,390,768,1440]){await page.setViewportSize({width,height:960});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,section+' no overflow at '+width);}
  }
  // Invalid/offline first load must still offer retry and existing local watchlist.
  await page.reload();await page.waitForSelector('.pred-feed-note');assert.match(await page.locator('.pred-head').innerText(),/unavailable/);
  // Production fetches main's public raw file independently of a Pages build; a failure uses
  // the same-origin snapshot. Serve a virtual origin locally so this test makes no web requests.
  const production=await browser.newPage({viewport:{width:1280,height:900}});
  await production.addInitScript(stub);
  await production.addInitScript(()=>localStorage.setItem('pf_experience_route','predictions'));
  production.on('pageerror',e=>errors.push(e.message));
  await production.route('https://**/*',r=>r.abort());
  let rawRequests=0,rawUnavailable=false;
  await production.route('https://raw.githubusercontent.com/**/data/predictions.json',r=>{rawRequests++;return r.fulfill({status:rawUnavailable?503:200,contentType:'application/json',body:JSON.stringify(publicData)});});
  await production.route('http://predict.example/**',r=>{
    const pathname=new URL(r.request().url()).pathname;
    if(pathname==='/sw.js')return r.fulfill({status:404,body:''});
    const file=pathname==='/data.json'?path.join(root,'tmp/experience-preview/sample.json'):path.join(root,pathname==='/'?'index.html':pathname.slice(1));
    if(!fs.existsSync(file))return r.fulfill({status:404,body:''});
    const ext=path.extname(file),contentType={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json'}[ext]||'application/octet-stream';
    return r.fulfill({status:200,contentType,body:fs.readFileSync(file)});
  });
  await production.goto('http://predict.example/');await production.waitForSelector('.pred-market');assert.ok(rawRequests>0);
  rawUnavailable=true;await production.evaluate(()=>window.PFPredictions.refresh());assert.match(await production.locator('.pred-feed-note').innerText(),/site snapshot/);
  await production.evaluate(()=>{localStorage.setItem('pf_classic','1');localStorage.setItem('dash_tab','predictions');});
  await production.reload();await production.waitForSelector('.pred-market');assert.equal(await production.locator('#tabbar').isVisible(),true);
  await production.setViewportSize({width:320,height:844});assert.equal(await production.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'classic six-tab layout fits narrow phones');
  await production.close();
  assert.deepEqual(errors,[]);
  console.log('PASS: public data rendering, 320–1440px layouts, history, filters, targets, refresh, export/import, stale/offline, keyboard, navigation, account privacy, Midnight');
}finally{await browser.close();}
