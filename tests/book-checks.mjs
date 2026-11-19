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

// ── 4. Research (v253): the left page is navigation for the account's research; a name opens Analyze; Analyze keeps the compare list ──
await p.locator('#ex-subnav [data-ws-tab="research"]').click();await settle();
g=await panel();geometryOk(g,'apex research');assert.equal(g.tab,'findings');
assert.equal(await p.evaluate(()=>PFExperience.route),'acctresearch');
{
  const jumps=await p.evaluate(()=>[...document.querySelectorAll('#pf-book [data-bk-jump]')].map(b=>b.getAttribute('data-bk-jump')));
  assert.ok(jumps.length>=2,'the left page lists the research sections on the right page');
  for(const sel of jumps)assert.equal(await p.evaluate(sel=>{const n=document.querySelector('#page-picks '+sel);return !!n&&n.getClientRects().length>0;},sel),true,'every listed section is visible on the right page: '+sel);
  const fl=await p.evaluate(()=>parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--fold-right')));
  assert.ok((await p.evaluate(()=>document.getElementById('picks-app').getBoundingClientRect().left))>=fl-1,'the research cards are on the right page');
  const last=jumps[Math.min(1,jumps.length-1)];await p.locator('#pf-book [data-bk-jump="'+last.replace(/"/g,'\\"')+'"]').click();await settle();
  const top=await p.evaluate(sel=>{const n=document.querySelector('#page-picks '+sel);const t=n.matches('[data-toggle]')?n.closest('.card'):n;return t.getBoundingClientRect().top;},last);
  assert.ok(top>=0&&top<(await p.evaluate(()=>innerHeight))-60,'a section tap brings it into view on the right page (top '+Math.round(top)+')');
  assert.equal(await p.evaluate(()=>[...document.querySelectorAll('#pf-book *')].some(e=>/\$\d/.test(e.childNodes.length===1&&e.firstChild.nodeType===3?e.textContent:''))),false,'the navigation panel repeats no dollar figure');
  const names=await p.evaluate(()=>[...document.querySelectorAll('#pf-book [data-pj-sym]')].map(b=>b.getAttribute('data-pj-sym')));
  assert.ok(names.length>0,'the names in the research are listed');
  await p.locator('#pf-book [data-pj-sym="'+names[0]+'"]').click();await settle();
  assert.equal(await p.evaluate(()=>PFExperience.route),'analyze');assert.equal(await p.evaluate(()=>PFJourney.state.symbol),names[0]);
  assert.equal(await p.evaluate(()=>PFExperience.area),'apex','Analyze from Research keeps the Apex area');
}
g=await panel();geometryOk(g,'apex analyze');assert.equal(g.tab,'research');
await p.locator('#pf-book [data-pj-sym="'+rows[0]+'"]').click();await settle();
assert.equal(await p.evaluate(()=>PFExperience.route),'analyze');assert.equal(await p.evaluate(()=>PFJourney.state.symbol),rows[0]);
assert.equal(await p.evaluate(()=>PFExperience.area),'apex','Research keeps the Apex area');

// ── 5. Actions: the review queue is the Overview Action Center, same items ──
await p.locator('#ex-subnav [data-ws-tab="actions"]').click();await settle();
g=await panel();geometryOk(g,'apex actions');assert.equal(g.tab,'actions');
const q=await p.evaluate(()=>{const t=document.createElement('div');t.innerHTML=PFExperience.actionsHTML();return t.querySelectorAll('.ws-act').length;});
assert.equal(await p.locator('#pf-book .ws-act').count(),q,'review queue = Action Center items');
// v255: the Actions left page is filled: performance and the top holdings follow the queue (a tap opens Positions).
for(const t of ['PERFORMANCE','TOP HOLDINGS'])assert.ok(g.text.toUpperCase().includes(t),'apex actions shows '+t);
assert.deepEqual(await p.$$eval('#pf-book .bk-hold .bk-sym',n=>n.map(x=>x.textContent)),rows.slice(0,5),'actions top holdings = the five largest');
await p.locator('#pf-book [data-bk-sym="'+rows[0]+'"]').click();await settle();
assert.equal(await p.evaluate(()=>PFExperience.route),'holdings','a top-holding tap opens Positions');
// v255: Allocation sized to its pane — the two lists stack on the right page and every bar keeps a usable width.
await nav('accounts','main');
const al=await p.evaluate(()=>{const c=document.querySelector('#app>[data-sec="allocation"]');if(!c)return null;const b=c.querySelector('[id^="b-alloc"]');if(b&&b.style.display==='none')c.querySelector('.card-title').click();
  const cols=[...c.querySelectorAll('.two-col>div')].map(d=>d.getBoundingClientRect()),tr=[...c.querySelectorAll('.alloc-track')].map(t=>t.getBoundingClientRect().width),r=c.getBoundingClientRect();
  return {stacked:cols.length<2||cols[1].top>=cols[0].bottom-1,minTrack:tr.length?Math.min(...tr):null,right:r.right,fold:parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--fold-left'))};});
if(al){assert.ok(al.stacked,'allocation lists stack in the Book pane');if(al.minTrack!==null)assert.ok(al.minTrack>=60,'allocation bars keep their width ('+al.minTrack+')');}

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
// ── 8. v250: nothing on a Book right page keeps the viewport's two-column rules (Jack's Nov 18 12:15 ET screenshot of v2.9 Paper) ──
await p.evaluate(()=>PFDuo.setMode('book'));await nav('apexpaper','main');await p.waitForFunction(()=>document.querySelector('#apexpaper-app .apx'));await settle();
const paper=()=>p.evaluate(()=>{const R=document.documentElement,cs=getComputedStyle(R),box=s=>{const e=document.querySelector(s);if(!e||!e.getClientRects().length)return null;const r=e.getBoundingClientRect();return {l:r.left,r:r.right,t:r.top,b:r.bottom,w:r.width};};
  const rows=[...document.querySelectorAll('[data-apx-sec="ranked"] .apx-row>summary')].slice(0,6).map(sm=>{const k=[...sm.children].filter(c=>c.getClientRects().length).map(c=>c.getBoundingClientRect());let bad=0;for(let i=1;i<k.length;i++)if(k[i].left<k[i-1].right-1)bad++;return bad;});
  const cut=[...document.querySelectorAll('[data-apx-sec="detail"] .apx-levels b,[data-apx-sec="detail"] .apx-levels span,[data-apx-sec="detail"] .apx-kv span,[data-apx-sec="detail"] .apx-kv b')].filter(e=>e.scrollWidth>e.clientWidth+1).length;
  const cards=[...document.querySelectorAll('#apexpaper-app .apx>*')].filter(e=>e.getClientRects().length&&getComputedStyle(e).position!=='fixed').map(e=>e.getBoundingClientRect().width);
  return {fill:!!document.querySelector('[data-apx-sec="ranked"][data-duo-fill]'),ranked:box('[data-apx-sec="ranked"]'),detail:box('[data-apx-sec="detail"]'),key:(document.querySelector('[data-apx-sec="detail"]')||{getAttribute(){return null;}}).getAttribute('data-apx-detail'),
    foldL:parseFloat(cs.getPropertyValue('--fold-left')),foldR:parseFloat(cs.getPropertyValue('--fold-right')),pinB:Math.max(0,...[...document.querySelectorAll('[data-duo-pin]:not([data-duo-fill])')].map(e=>e.getBoundingClientRect().bottom)),
    rows,cut,minCard:Math.min(...cards),sw:R.scrollWidth,iw:innerWidth};});
let pg=await paper();
assert.equal(pg.fill,true,'book Paper: the ranked list is pinned on the left page');
assert.ok(pg.ranked.r<=pg.foldL+1&&pg.ranked.t>=pg.pinB-1&&pg.ranked.b<=669,'book Paper: list left of the crease, under the tiles, inside the screen '+JSON.stringify(pg.ranked));
assert.ok(pg.detail&&pg.detail.l>=pg.foldR-1&&pg.detail.w>=400,'book Paper: selected stock uses the whole right page '+JSON.stringify(pg.detail));
assert.deepEqual(pg.rows,[0,0,0,0,0,0],'book Paper: no list row has overlapping cells');assert.equal(pg.cut,0,'book Paper: no clipped level or figure in the selected stock');
assert.ok(pg.minCard>=400,'book Paper: every right-page card is full page width');assert.ok(pg.sw<=pg.iw+1,'book Paper: no sideways scroll');
await p.evaluate(()=>window.scrollTo(0,1200));const key0=pg.key;
await p.locator('[data-apx-sec="ranked"] .apx-row>summary').nth(2).click();await settle();pg=await paper();
assert.notEqual(pg.key,key0,'book Paper: a tap on the left changes the right page');assert.ok(pg.detail.t>=0&&pg.detail.t<669*0.5,'book Paper: the selected stock is brought into view');
assert.equal(await p.evaluate(()=>document.querySelector('[data-apx-sec="ranked"] .apx-row[open]')),null,'book Paper: rows do not expand inline while the detail page is shown');
await p.setViewportSize({width:466,height:677});await settle();pg=await paper();
assert.equal(pg.fill,false,'466 book Paper: left page too small, list stays in the flow');assert.equal(pg.detail,null,'466 book Paper: rows expand inline');assert.ok(pg.sw<=pg.iw+1);
await p.setViewportSize({width:951,height:669});await settle();
for(const m of ['standard','folded']){await p.evaluate(m=>PFDuo.setMode(m),m);await settle();assert.equal(await p.locator('[data-duo-fill]').count(),0,m+' Paper: nothing filled');}
await p.evaluate(()=>PFDuo.setMode('book'));await nav('plan','main');await settle();
const edge=sel=>p.evaluate(sel=>{const fr=parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--fold-right'));const es=[...document.querySelectorAll(sel)].filter(e=>e.getClientRects().length);return {n:es.length,maxR:Math.max(0,...es.map(e=>e.getBoundingClientRect().right)),minW:Math.min(...es.map(e=>e.getBoundingClientRect().width)),page:innerWidth-fr,iw:innerWidth};},sel);
let ed=await edge('#apex-content>*');ed.page=await p.evaluate(()=>document.querySelector('#apex-content').clientWidth);assert.ok(ed.n>2&&ed.minW>=ed.page*0.8,'book Actions: every Apex block is one full-width column '+JSON.stringify(ed));
ed=await edge('#plan-content .snap');assert.ok(ed.n>=4&&ed.maxR<=ed.iw+1,'book Actions: no plan tile runs off the page '+JSON.stringify(ed));
await nav('markets','main');await settle();ed=await edge('#markets-app .mkt-tile');assert.ok(ed.n>=4&&ed.maxR<=ed.iw+1,'book Markets: no tile runs off the page '+JSON.stringify(ed));
// ── 9. v251 trial: on Actions in Book the right page is its own scroller and the document is locked (independent of the left panel) ──
await nav('plan','main');await settle();
const ind=()=>p.evaluate(()=>{const R=document.documentElement,w=document.querySelector('[data-duo-scroller]'),bk=document.getElementById('pf-book');
  return {on:R.hasAttribute('data-duo-indep'),id:w&&w.id,y:w?w.scrollTop:null,canScroll:w?w.scrollHeight>w.clientHeight+50:null,docLocked:R.scrollHeight<=innerHeight+1,
    fixedInside:w?[...w.querySelectorAll('*')].filter(e=>e.getClientRects().length&&getComputedStyle(e).position==='fixed').length:null,
    sibling:w&&bk?!w.contains(bk)&&!bk.contains(w):null,winY:window.scrollY,top:w?w.getBoundingClientRect().top:null,subB:document.getElementById('ex-subnav').getBoundingClientRect().bottom,
    bookY:bk?bk.scrollTop:null,fresh:document.getElementById('pf-fresh').getBoundingClientRect().top,pin:Math.min(...[...document.querySelectorAll('[data-duo-pin]')].map(e=>e.getBoundingClientRect().top))};});
let iv=await ind();
assert.equal(iv.on,true,'book Actions: independent page scroller on');assert.equal(iv.id,'page-picks');assert.equal(iv.docLocked,true,'book Actions: the document itself cannot scroll');
assert.equal(iv.fixedInside,0,'book Actions: nothing fixed lives inside the page scroller (Safari safety condition)');assert.equal(iv.sibling,true,'book Actions: left panel and right page are siblings');
assert.ok(iv.canScroll&&iv.top>=iv.subB-1,'book Actions: the page scrolls under the tab row '+JSON.stringify(iv));assert.ok(iv.fresh<iv.pin,'book Actions: the freshness strip sits above the pinned header');
await p.mouse.move(700,420);await p.mouse.wheel(0,600);await settle();iv=await ind();
assert.ok(iv.y>500&&iv.winY===iv.y&&iv.bookY===0,'book Actions: wheeling the right page moves only the right page; window.scrollY follows it '+JSON.stringify(iv));
await p.evaluate(()=>window.scrollTo(0,240));await settle();assert.equal((await ind()).y,240,'book Actions: window.scrollTo drives the page scroller (Find / jumps / Back)');
await p.evaluate(()=>PFDuo.refresh());await settle();assert.equal((await ind()).y,240,'book Actions: a re-pin keeps the place');
await p.evaluate(()=>PFDuo.setMode('standard'));await settle();iv=await ind();
assert.equal(iv.on,false,'standard Actions: document scroll again');assert.ok(iv.winY>0,'standard Actions: the place carried back to the document '+JSON.stringify(iv));
assert.equal(await p.evaluate(()=>getComputedStyle(document.documentElement).overflowY!=='hidden'),true,'standard Actions: document unlocked');
await p.evaluate(()=>PFDuo.setMode('book'));await settle();assert.equal((await ind()).on,true);
await nav('plan','agentic');await settle();iv=await ind();assert.equal(iv.on,true,'book Agentic Actions: independent scroller on');assert.equal(iv.fixedInside,0);
await nav('holdings','main');await settle();iv=await ind();assert.equal(iv.on,false,'book Positions: still the document scroll (pinned blocks live inside that page)');
assert.equal(await p.evaluate(()=>window.scrollY),0);
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
