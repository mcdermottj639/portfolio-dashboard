// v248 Book mode vNext: left page = command panel (ui/book.js), right page = analysis. Synthetic data; no orders, no writes.
// Called from journey-browser.mjs (reuses its browser; ONE context); also runnable alone: node tests/book-checks.mjs
// Book is forced with the visible control's own API (PFDuo.setMode('book')): Chromium has no fold sensor, and Book does not need one.
import assert from 'node:assert/strict';
export async function runBookChecks({browser,base,sample,stub,apex:apexT,writes=[]}){
const errors=[];
const ctx=await browser.newContext({viewport:{width:951,height:669},timezoneId:'America/New_York',serviceWorkers:'block'});
const p=await ctx.newPage();
p.on('pageerror',e=>errors.push(e.message));p.on('request',r=>{if(!['GET','HEAD'].includes(r.method()))writes.push(r.url());});
await p.addInitScript(stub);
await p.addInitScript(()=>{if(!sessionStorage.getItem('book-init')){localStorage.setItem('pf_acct','main');localStorage.setItem('pf_experience_route','accounts');localStorage.setItem('pf:duo-mode','book');sessionStorage.setItem('book-init','1');}});
await p.route('https://**/*',r=>r.request().url().startsWith(base)?r.continue():r.abort());
await p.route(/\/data\.json(?:\?.*)?$/,r=>r.fulfill({json:sample}));await p.route(/\/data\/apex-targets\.json(?:\?.*)?$/,r=>r.fulfill({json:apexT}));
await p.goto(base);await p.waitForFunction(()=>window.__SNAP&&window.PFJourney&&window.PFDuo&&window.PFBook);await p.waitForTimeout(700);
const settle=()=>p.waitForTimeout(320);
const nav=async(route,account)=>{await p.evaluate(([r,a])=>PFExperience.navigate(r,a?{account:a}:{}),[route,account]);await settle();};
const panel=()=>p.evaluate(()=>{const b=document.getElementById('pf-book'),R=document.documentElement;
  if(!b||b.hidden)return {shown:false,book:R.getAttribute('data-book')};
  const r=b.getBoundingClientRect(),cs=getComputedStyle(R);
  const pinB=Math.max(0,...[...document.querySelectorAll('[data-duo-pin]')].map(e=>e.getBoundingClientRect().bottom));
  return {shown:true,book:R.getAttribute('data-book'),tab:b.dataset.tab,acct:b.dataset.acct,left:r.left,right:r.right,top:r.top,bottom:r.bottom,
    foldL:parseFloat(cs.getPropertyValue('--fold-left')),pinB,text:b.innerText,sw:document.documentElement.scrollWidth,iw:innerWidth,overflowX:b.scrollWidth>b.clientWidth+1};});
const geometryOk=(g,t)=>{assert.ok(g.shown,t+': panel shown');assert.ok(g.right<=g.foldL+1,t+': panel left of the crease '+JSON.stringify(g));
  assert.ok(g.top>=g.pinB-1,t+': panel under the pinned blocks');assert.ok(g.bottom<=669,t+': panel inside the screen');
  assert.equal(g.sw<=g.iw+1,true,t+': no sideways scroll');assert.equal(g.overflowX,false,t+': panel never overflows sideways');};

// ── 1. Apex Overview: risk (band, tech cap, largest position), performance, holdings; duplicate tiles hidden on the right ──
let g=await panel();geometryOk(g,'apex overview');
assert.equal(g.book,'on');assert.equal(g.tab,'overview');assert.equal(g.acct,'main');
for(const s of ['RISK','Leverage band','Tech outside','Largest position','PERFORMANCE','HOLDINGS'])assert.ok(g.text.toUpperCase().includes(s.toUpperCase()),'apex overview shows '+s);
assert.doesNotMatch(g.text,/Deployed|Rebalance in flight/,'Apex panel never shows the agentic strategy');
const dup=await p.evaluate(()=>{const tiles=[...document.querySelectorAll('#app>[data-sec="snapshot"] .snap')].map(t=>({l:t.querySelector('.snap-lbl')?.textContent.trim(),vis:t.getClientRects().length>0}));
  const strip=[...document.querySelectorAll('#app>#ws-strip .snap-lbl')].map(n=>n.textContent.trim());return {tiles,strip,stripPinned:document.querySelector('#app>#ws-strip')?.hasAttribute('data-duo-pin')};});
assert.ok(dup.stripPinned,'Day change / Leverage stay on the left page');
for(const t of dup.tiles)assert.equal(t.vis,!dup.strip.includes(t.l),'right-page snapshot: '+t.l+(dup.strip.includes(t.l)?' hidden (already on the left)':' visible'));
// Every holding row reads the All Positions rows: same names, same order (largest first).
const rows=await p.evaluate(()=>window.__pfPosRows('main').slice().sort((a,b)=>(b.val??-1)-(a.val??-1)).map(r=>r.symbol));
const shownSyms=await p.$$eval('#pf-book .bk-hold .bk-sym',n=>n.map(x=>x.textContent));
assert.deepEqual(shownSyms,rows.slice(0,8),'overview holdings = the All Positions rows, largest first');

// ── 2. A tap on the left page updates the right page in place (no route change); Close clears it; panel scroll survives repaints ──
await p.locator('#pf-book [data-bk-sym="'+rows[2]+'"]').click();await settle();
assert.equal(await p.evaluate(()=>PFExperience.route),'accounts','selecting a holding keeps Overview');
assert.equal(await p.evaluate(()=>PFJourney.state.symbol),rows[2],'the journey selection follows the tap');
assert.match(await p.locator('#ws-selected').innerText(),new RegExp(rows[2]),'the right page shows the selected holding');
const selTop=await p.locator('#ws-selected').boundingBox();assert.ok(selTop.y<300&&selTop.x>=g.foldL,'selected card at the top of the right page');
assert.equal(await p.locator('#pf-book .bk-hold[aria-current="true"] .bk-sym').innerText(),rows[2],'the left row is marked selected');
await p.locator('#ws-selected [data-bk-clear]').click();await settle();assert.equal(await p.locator('#ws-selected').count(),0,'Close removes the selected block');
await p.evaluate(()=>{document.getElementById('pf-book').scrollTop=90;});
await p.evaluate(()=>{document.dispatchEvent(new Event('pf:render'));window.__experienceRefresh&&window.__experienceRefresh();});await settle();
assert.ok(Math.abs(await p.evaluate(()=>document.getElementById('pf-book').scrollTop)-90)<=2,'panel scroll is kept across a refresh');
// Performance opens the right page's Performance card.
await p.evaluate(()=>{document.getElementById('pf-book').scrollTop=0;});
await p.locator('#pf-book [data-bk-card="performance"]').click();await p.waitForTimeout(500);
const perfY=await p.evaluate(()=>document.querySelector('#app>[data-sec="performance"]').getBoundingClientRect().top);
assert.ok(perfY>=0&&perfY<200,'Performance tap scrolls the right page to the Performance card ('+perfY+')');
await p.evaluate(()=>scrollTo(0,0));

// ── 3. Positions: the full list on the left; a tap opens that card first on the right ──
await p.locator('#ex-subnav [data-ws-tab="positions"]').click();await settle();
g=await panel();geometryOk(g,'apex positions');assert.equal(g.tab,'positions');
assert.equal(await p.locator('#pf-book .bk-hold').count(),rows.length,'Positions lists every holding');
await p.locator('#pf-book [data-bk-sym="'+rows[1]+'"]').click();await settle();
assert.equal(await p.locator('#ws-poscards .ws-pos').first().getAttribute('data-ws-sym'),rows[1],'tapped holding opens first on the right');

// ── 4. Research: compare list; a tap researches that name in the same account ──
await p.locator('#ex-subnav [data-ws-tab="research"]').click();await settle();
g=await panel();geometryOk(g,'apex research');assert.equal(g.tab,'research');
await p.locator('#pf-book [data-pj-sym="'+rows[0]+'"]').click();await settle();
assert.equal(await p.evaluate(()=>PFExperience.route),'analyze');assert.equal(await p.evaluate(()=>PFJourney.state.symbol),rows[0]);
assert.equal(await p.evaluate(()=>PFExperience.area),'apex','Research keeps the Apex area');

// ── 5. Actions: the review queue is the Overview Action Center, same items ──
await p.locator('#ex-subnav [data-ws-tab="actions"]').click();await settle();
g=await panel();geometryOk(g,'apex actions');assert.equal(g.tab,'actions');
const q=await p.evaluate(()=>{const t=document.createElement('div');t.innerHTML=PFExperience.actionsHTML();return t.querySelectorAll('.ws-act').length;});
assert.equal(await p.locator('#pf-book .ws-act').count(),q,'review queue = Action Center items');

// ── 6. Agentic gets its own priorities: deployment, ticket, performance; no Apex leverage band ──
await nav('accounts','agentic');
g=await panel();geometryOk(g,'agentic overview');assert.equal(g.acct,'agentic');
for(const s of ['STRATEGY','Deployed','PERFORMANCE','HOLDINGS'])assert.ok(g.text.toUpperCase().includes(s.toUpperCase()),'agentic overview shows '+s);
assert.doesNotMatch(g.text,/Leverage band|Tech outside/,'Agentic panel never shows the Apex band');
const agRows=await p.evaluate(()=>window.__pfPosRows('agentic').map(r=>r.symbol).sort());
const agShown=(await p.$$eval('#pf-book .bk-hold .bk-sym',n=>n.map(x=>x.textContent))).sort();
assert.ok(agShown.every(s=>agRows.includes(s)),'agentic panel lists agentic holdings only');

// ── 7. Privacy masks the panel's money; percentages stay ──
await p.evaluate(()=>setPrivacy(true));await settle();
const priv=await p.locator('#pf-book').innerText();assert.doesNotMatch(priv,/\$\d/,'privacy masks dollar figures in the panel');assert.match(priv,/\d%/,'percentages stay readable');
await p.evaluate(()=>setPrivacy(false));await settle();

// ── 7b. Today (v249): both accounts' command blocks; taps open the right account ──
await nav('today','main');
g=await panel();geometryOk(g,'today');assert.equal(g.tab,'today');
for(const s of ['APEX · SELF-DIRECTED','AGENTIC · AUTOMATED','Leverage band','Deployed'])assert.ok(g.text.toUpperCase().includes(s.toUpperCase()),'today shows '+s);
assert.equal((g.text.match(/PERFORMANCE/gi)||[]).length,2,'one performance block per account');
assert.equal(await p.locator('#pf-book .bk-hold').count(),0,'no holdings list on Today (the right page has the holdings map)');
await p.locator('#pf-book [data-bk-why="leverage"]').click();await settle();
assert.deepEqual(await p.evaluate(()=>[PFExperience.route,PFExperience.account]),['plan','main'],'Apex row opens Apex Actions');
await nav('today','agentic');
await p.locator('#pf-book [data-bk-card="performance"][data-bk-acct="agentic"]').click();await p.waitForTimeout(600);
assert.deepEqual(await p.evaluate(()=>[PFExperience.route,PFExperience.account]),['accounts','agentic'],'Agentic performance opens Agentic Overview');
await nav('accounts','agentic');

// ── 8. Themes, widths and the other modes ──
await p.evaluate(()=>{document.documentElement.setAttribute('data-theme','gold');});await settle();
geometryOk(await panel(),'gold theme');
await p.evaluate(()=>{document.documentElement.removeAttribute('data-theme');});
await p.setViewportSize({width:466,height:677});await settle();g=await panel();geometryOk({...g,bottom:Math.min(g.bottom,669)},'466 book');
await p.setViewportSize({width:390,height:844});await settle();g=await panel();
assert.equal(g.shown,false,'390 book: the left page is too narrow for the panel; v247 pinned summary only');
assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,'390 book: no sideways scroll');
await p.setViewportSize({width:951,height:669});
for(const m of ['folded','standard']){
  await p.evaluate(m=>PFDuo.setMode(m),m);await settle();
  g=await panel();assert.equal(g.shown,false,m+': no command panel');assert.equal(g.book,null,m+': data-book off');
  assert.equal(await p.locator('[data-book-dup]').count(),0,m+': no tile is hidden');
  assert.equal(await p.locator('#ws-selected').count(),0,m+': no selected block');
}
// Book only splits Positions / Actions; Folded keeps v247 (full screen there).
await p.evaluate(()=>PFDuo.setMode('folded'));await nav('holdings','main');
assert.equal(await p.evaluate(()=>document.documentElement.getAttribute('data-duo-split')),null,'folded Positions stays full screen');
await p.evaluate(()=>PFDuo.setMode('book'));await settle();
assert.equal(await p.evaluate(()=>document.documentElement.getAttribute('data-duo-split')),'on','book Positions splits for the panel');
// Mode switches keep route, account and selection.
assert.deepEqual(await p.evaluate(()=>[PFExperience.route,PFExperience.account]),['holdings','main']);
await p.evaluate(()=>PFDuo.setMode('auto'));
assert.deepEqual(errors,[]);
await ctx.close();
}
// Standalone
if(import.meta.url===`file://${process.argv[1]}`){
  const fs=await import('node:fs');const {chromium}=await import(process.env.PF_PLAYWRIGHT||'playwright');
  const base=(process.env.PF_PREVIEW_URL||'http://127.0.0.1:8767/').replace(/\/?$/,'/');
  const sample=JSON.parse(fs.readFileSync('tmp/experience-preview/sample.json','utf8'));
  const stub=fs.readFileSync('producer/privacy-audit.mjs','utf8').match(/const CHART_STUB = `([\s\S]*?)`;/)[1];
  const browser=await chromium.launch({...(process.env.PF_CHROME?{executablePath:process.env.PF_CHROME}:{}),args:['--no-sandbox','--disable-dev-shm-usage']});
  const t=Date.now();
  try{await runBookChecks({browser,base,sample,stub,apex:{asOf:new Date().toISOString(),targets:{MSFT:20},top5:[{sym:'MSFT',composite:8,why:'Synthetic entry research',limit:420,trigger:420,stop:380,tp1:500,orderType:'limit',tradable:true}],heldLevels:[{sym:'AAPL',stop:170,tp1:230,why:'Synthetic'}]}});
    console.log('book-checks PASS in '+((Date.now()-t)/1000).toFixed(1)+'s');}finally{await browser.close();}
}
