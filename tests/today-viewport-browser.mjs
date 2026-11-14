// The Duo controls column is outside Safari's content viewport. These sizes
// exercise the content area, without pretending an emulated CSS inset is it.
// WebKit here is Playwright's desktop engine, not a physical iPhone simulator.
import assert from 'node:assert/strict';
import fs from 'node:fs';
const runtime=await import(process.env.PF_PLAYWRIGHT||'playwright');
const engine=process.env.PF_BROWSER||'chromium';
assert.ok(['chromium','webkit'].includes(engine));
const base=(process.env.PF_PREVIEW_URL||'http://127.0.0.1:8767/').replace(/\/?$/,'/');
const sample=JSON.parse(fs.readFileSync('tmp/experience-preview/sample.json','utf8'));
sample.generatedAt=new Date(Date.now()-25*3600000).toISOString();
sample.generatedAtLabel='Sample, 4:41';
const stub=fs.readFileSync('producer/privacy-audit.mjs','utf8').match(/const CHART_STUB = `([\s\S]*?)`;/)[1];
const browser=await runtime[engine].launch(engine==='chromium'?{args:['--no-sandbox','--disable-dev-shm-usage']}:{});
const out='tmp/journey-evidence';fs.mkdirSync(out,{recursive:true});
try {
 const page=await browser.newPage({viewport:{width:373,height:678},timezoneId:'America/New_York',serviceWorkers:'block'});
 const errors=[],writes=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(!['GET','HEAD'].includes(r.method()))writes.push(r.url());});
 await page.addInitScript(stub);
 await page.route('https://**/*',r=>r.request().url().startsWith(base)?r.continue():r.abort());
 await page.route(/\/data\.json(?:\?.*)?$/,r=>r.fulfill({json:sample}));
 const ready=()=>page.waitForFunction(()=>window.__SNAP&&window.PFJourney&&document.querySelector('#ex-combined-equity'));
 await page.goto(base);await ready();
 await page.evaluate(()=>PFExperience.navigate('today'));await page.waitForTimeout(150);
 const initial=await page.locator('#ex-combined-equity').innerText();
 assert.match(await page.locator('#pf-fresh-left').innerText(),/⚠️.*Sample/,'stale warning stays visible');
 assert.equal(await page.locator('[data-td-freshness]').textContent(),'1 day old');
 const evidence=[];
 for(const [width,height] of [[373,678],[382,580],[385,571],[320,568],[594,368],[669,867],[951,585]]) {
  await page.setViewportSize({width,height});await page.evaluate(()=>scrollTo(0,0));
  for(const theme of ['light','dark']) {
   await page.evaluate(theme=>PFTheme.set(theme),theme);await page.waitForTimeout(120);
   // Save the render before assertions as evidence even when a layout check fails.
   await page.screenshot({path:`${out}/${base.startsWith('https:')?'live-':''}today-content-${width}x${height}-${theme}-${engine}.png`});
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`${engine} ${width}: horizontal overflow`);
   assert.equal(await page.locator('#ex-combined-equity').innerText(),initial,'layout keeps both account values');
   const clipped=await page.locator('#ex-combined-equity,#ex-combined-move,.td-account-value,.td-account-head .td-link').evaluateAll(nodes=>nodes.filter(el=>el.scrollWidth>el.clientWidth+2).map(el=>el.className||el.id));
   assert.deepEqual(clipped,[],`${engine} ${width}: numbers and account links fit`);
   const top=await page.locator('#ex-top').boundingBox(),hero=await page.locator('.td-hero').boundingBox(),waiting=await page.locator('.td-waiting').boundingBox();
   const previewBanner=page.getByText('LOCAL PREVIEW — SYNTHETIC SAMPLE DATA',{exact:true});
   const previewHeight=await previewBanner.count()?(await previewBanner.boundingBox()).height:0;
   const waitingContentTop=waiting.y-previewHeight;
   evidence.push({engine,theme,width,height,toolbarHeight:top.height,heroHeight:hero.height,waitingTop:waiting.y,previewHeight,waitingContentTop});
   fs.writeFileSync(`${out}/${base.startsWith('https:')?'live-':''}today-content-${engine}.json`,JSON.stringify(evidence,null,2));
   if(width<=739) {
    assert.ok(top.height<=60,'one compact toolbar replaces repeated headings');
    assert.equal(await page.locator('.ex-today-title').isVisible(),true);
    assert.equal(await page.locator('#ex-context').isVisible(),false,'truncated repeated caption is gone');
    assert.equal(await page.locator('#td-theme').isVisible(),false,'appearance remains in the sticky bar');
    for(const selector of ['#pj-back','#ex-classic','.td-account-head .td-link']) {
     const sizes=await page.locator(selector).evaluateAll(nodes=>nodes.map(el=>el.getBoundingClientRect().height));
     assert.ok(sizes.every(n=>n>=44),selector+' keeps usable touch targets');
    }
   }
   if(width>=373&&width<=385) {
    // The local-only sample banner stays in screenshots, but is not product UI.
    // Keep the actual visible-heading check below as well, without normalization.
    assert.ok(waitingContentTop<=425,`${engine} ${width}: action section reaches first screen ${waitingContentTop}`);
    const nav=await page.locator('.ex-main').boundingBox();
    const heading=await page.locator('.td-waiting h2').boundingBox();
    assert.ok(heading.y+heading.height<nav.y,'Waiting on you is visible above navigation');
   }
   assert.equal(await page.locator('.ex-main [data-ex-area]').count(),5);
  }
 }
 await page.setViewportSize({width:373,height:678});
 await page.evaluate(()=>PFTheme.set('light'));
 for(const wanted of ['dark','system','light']) {
  await page.locator('#theme-toggle').click();await page.waitForFunction(wanted=>PFTheme.preference()===wanted,wanted);
 }
 await page.locator('#theme-toggle').click();await page.reload();await ready();
 assert.equal(await page.evaluate(()=>PFTheme.preference()),'dark','compact theme control survives refresh');
 for(const account of ['main','agentic']) {
  await page.locator(`.td-account-head [data-ex-account="${account}"]`).click();
  await page.waitForFunction(account=>PFJourney.state.account===account&&PFJourney.state.route==='accounts',account);
  assert.equal(await page.locator('#ex-context').isVisible(),true,'other pages keep account context');
  await page.locator('#pj-back').click();await page.waitForFunction(()=>PFJourney.state.route==='today');
  assert.equal(await page.locator('#ex-combined-equity').innerText(),initial);
 }
 await page.locator('#pf-priv').click();await page.waitForFunction(()=>document.querySelector('#ex-combined-equity').textContent.includes('•••'));
 assert.doesNotMatch(await page.locator('.td-hero').innerText(),/\$\d/);
 await page.locator('#pf-priv').click();await page.waitForFunction(()=>!document.body.classList.contains('pf-private'));
 // The retained Classic button still uses its original handler and storage key.
 await page.locator('#ex-classic').click();await page.waitForSelector('.ex-classic-return');
 assert.equal(await page.evaluate(()=>localStorage.getItem('pf_classic')),'1');
 await page.locator('.ex-classic-return').click();await ready();
 assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);
 fs.writeFileSync(`${out}/${base.startsWith('https:')?'live-':''}today-content-${engine}.json`,JSON.stringify(evidence,null,2));
 console.log(`today-viewport-browser PASS (${engine}): actual content widths, first-screen action visibility, touch targets, themes/reload, account links/Back, privacy and Classic; synthetic data, no writes.`);
} finally {await browser.close();}
