// Start tests/preview.mjs first. Uses its synthetic snapshot; no production data/credentials.
// PF_PLAYWRIGHT and PF_CHROME locate an existing browser install (no new dependency).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {runTodayChecks} from './today-browser.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const {chromium}=await import(process.env.PF_PLAYWRIGHT||'playwright');
const source=fs.readFileSync(path.join(root,'producer/privacy-audit.mjs'),'utf8');
const stub=source.match(/const CHART_STUB = `([\s\S]*?)`;/)[1];
const browser=await chromium.launch({...(process.env.PF_CHROME?{executablePath:process.env.PF_CHROME}:{}),args:['--no-sandbox','--disable-dev-shm-usage']});
try {
  const page=await browser.newPage({viewport:{width:1440,height:1000},timezoneId:'America/New_York'});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(stub);
  await page.addInitScript(()=>{localStorage.setItem('pf_acct','agentic');localStorage.setItem('pf_experience_route','today');});
  await page.route('https://**/*',r=>r.abort());
  await page.route('**/data.json',async route=>{
    const response=await route.fetch();
    const data=await response.json();
    data.generatedAtLabel='Nov 13, 12:40 PM ET';
    await route.fulfill({response,contentType:'application/json',body:JSON.stringify(data)});
  });
  await page.goto(process.env.PF_PREVIEW_URL||'http://127.0.0.1:8767');
  await page.waitForFunction(()=>window.__SNAP&&document.querySelector('#ex-combined-equity')?.textContent.includes('$'));
  assert.equal(await page.locator('#ex-account').isVisible(),false);
  assert.equal(await page.locator('[data-brief-account]').count(),2);
  const initial=await page.locator('#ex-combined-equity').innerText();
  const expected=await page.evaluate(()=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:2}).format(__DATA.main.equity+__DATA.agentic.equity));
  assert.equal(initial,expected,'headline contains both accounts even when Agentic was last selected');
  const today=()=>page.locator('[data-ex-area="today"]').click();
  const choose=scope=>page.locator('#page-ex-today [data-ex-route="plan"][data-ex-account="'+scope+'"]').first().click();
  await choose('main');
  await page.waitForFunction(()=>document.querySelector('#ex-account')?.value==='main'&&getComputedStyle(document.querySelector('#picks-app')).display!=='none');
  // v185: Plan/Accounts carry their own account switcher, so the header dropdown is hidden there.
  assert.equal(await page.locator('#ex-account').isVisible(),false);assert.equal(await page.locator('#plan-tg-main').isVisible(),true);
  await today();assert.equal(await page.locator('#ex-combined-equity').innerText(),initial);
  await choose('agentic');
  await page.waitForFunction(()=>document.querySelector('#ex-account')?.value==='agentic'&&getComputedStyle(document.querySelector('#plan-agentic-app')).display!=='none');
  await today();assert.equal(await page.locator('#ex-combined-equity').innerText(),initial);
  await page.locator('[data-brief-account="main"] [data-ex-route="accounts"]').click();
  await page.waitForFunction(()=>getComputedStyle(document.querySelector('#app')).display!=='none'&&localStorage.getItem('pf_acct')==='main');
  assert.equal(await page.locator('#ex-account').isVisible(),false);
  await page.locator('#acct-tg-agentic').click();
  await page.waitForFunction(()=>getComputedStyle(document.querySelector('#agentic-app')).display!=='none');
  await today();assert.equal(await page.locator('#ex-combined-equity').innerText(),initial);
  await page.locator('[data-td-details="options"] > summary').click();
  await page.locator('[data-td-details="options"] [data-ex-route="options"]').click();
  await page.waitForFunction(()=>getComputedStyle(document.querySelector('#page-options')).display!=='none');
  assert.equal(await page.evaluate(()=>localStorage.getItem('pf_acct')),'main');
  await today();
  for(const width of [320,390,768,1440]) {
    await page.setViewportSize({width,height:900});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'no horizontal overflow at '+width);
    if(width<=390){
      assert.equal(await page.locator('#pf-fresh-left').innerText(),'Nov 13, 12:40','whole timestamp at '+width);
      const fits=await page.evaluate(()=>{
        const left=document.querySelector('#pf-fresh-left').getBoundingClientRect();
        const right=document.querySelector('#pf-fresh .pf-fresh-actions').getBoundingClientRect();
        return left.right+3<=right.left;
      });
      assert.equal(fits,true,'timestamp does not overlap actions at '+width);
    }
  }
  await page.locator('.ex-brief-method summary').click();
  await page.evaluate(()=>window.__experienceRefresh());
  await page.waitForTimeout(150);
  assert.equal(await page.locator('.ex-brief-method').getAttribute('open'),'','open details survive updates');
  await page.evaluate(()=>setPrivacy(true));
  assert.match(await page.locator('#ex-combined-equity').innerText(),/•••/);
  assert.equal(await page.locator('.ex-private-chart').evaluate(el=>getComputedStyle(el).visibility),'hidden');
  await page.evaluate(()=>{window.__experienceRefresh();});
  await page.waitForTimeout(150);
  assert.match(await page.locator('#ex-combined-equity').innerText(),/•••/,'rerender remains private');
  await page.evaluate(()=>setPrivacy(false));
  assert.equal(await page.locator('#ex-combined-equity').innerText(),initial);
  await page.evaluate(()=>document.documentElement.setAttribute('data-theme','gold'));
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  if(process.env.PF_SCREENSHOT_DIR) {
    const dir=path.resolve(process.env.PF_SCREENSHOT_DIR);fs.mkdirSync(dir,{recursive:true});
    await page.screenshot({path:path.join(dir,'daily-brief-midnight.png'),fullPage:true});
    await page.evaluate(()=>document.documentElement.removeAttribute('data-theme'));
    await page.screenshot({path:path.join(dir,'daily-brief-desktop.png'),fullPage:true});
    await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(dir,'daily-brief-mobile.png'),fullPage:true});
  }
  await runTodayChecks(page);
  await page.evaluate(()=>{delete window.__DATA.agentic;window.__experienceRefresh();});
  await page.waitForFunction(()=>document.querySelector('#ex-combined-equity').textContent==='Unavailable');
  assert.ok((await page.locator('#page-ex-today').innerText()).includes('Account totals are incomplete'));
  assert.deepEqual(errors,[]);
  console.log('PASS: combined initial load, both account plans, account links/switcher, options, 320–1440px layout, updates, privacy, Midnight and missing-account state');
} finally {await browser.close();}
