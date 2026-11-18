// v247 central Duo layout state + mid-fold control (Auto / Folded / Book / Standard). Synthetic data; no orders.
// Called from journey-browser.mjs (reuses its browser; ONE context here); also runnable alone: node tests/duo-checks.mjs
// A fold is SIMULATED the way a browser would report it: window.viewport (an EventTarget with a settable `segments`) is
// stubbed before the page loads (plus navigator.devicePosture: 'folded' while segments are reported, else 'continuous'),
// and a change is announced with `segmentschange` / posture `change` events. Chromium has neither API, so
// this exercises the detector, never real Safari.
import assert from 'node:assert/strict';
export async function runDuoChecks({browser,base,sample,stub,apex:apexT,writes=[]}){
const errors=[];
const ctx=await browser.newContext({viewport:{width:466,height:677},timezoneId:'America/New_York',serviceWorkers:'block'});
const p=await ctx.newPage();
p.on('pageerror',e=>errors.push(e.message));p.on('request',r=>{if(!['GET','HEAD'].includes(r.method()))writes.push(r.url());});
await p.addInitScript(stub);
await p.addInitScript(()=>{
  const vp=new EventTarget();window.__segs=null;Object.defineProperty(vp,'segments',{get:()=>window.__segs});
  Object.defineProperty(window,'viewport',{value:vp,configurable:true});
  const dp=new EventTarget();window.__posture='continuous';Object.defineProperty(dp,'type',{get:()=>window.__posture});Object.defineProperty(navigator,'devicePosture',{value:dp,configurable:true});
  if(!sessionStorage.getItem('duo-init')){localStorage.setItem('pf_acct','main');localStorage.setItem('pf_experience_route','today');sessionStorage.setItem('duo-init','1');}
});
await p.route('https://**/*',r=>r.request().url().startsWith(base)?r.continue():r.abort());
await p.route(/\/data\.json(?:\?.*)?$/,r=>r.fulfill({json:sample}));await p.route(/\/data\/apex-targets\.json(?:\?.*)?$/,r=>r.fulfill({json:apexT}));
const boot=async()=>{await p.waitForFunction(()=>window.__SNAP&&window.PFJourney&&window.PFDuo);await p.waitForTimeout(500);};
await p.goto(base);await boot();
const settle=()=>p.waitForTimeout(220);
const nav=async(route,account)=>{await p.evaluate(([r,a])=>PFExperience.navigate(r,a?{account:a}:{}),[route,account]);await settle();};
const mode=async m=>{await p.evaluate(m=>PFDuo.setMode(m),m);await p.waitForTimeout(60);};
const attrs=()=>p.evaluate(()=>({mode:document.documentElement.dataset.duoMode,layout:document.documentElement.dataset.duoLayout,split:document.documentElement.dataset.duoSplit||null}));
const segs=async s=>{await p.evaluate(s=>{window.__segs=s;window.__posture=s?'folded':'continuous';window.viewport.dispatchEvent(new Event('segmentschange'));navigator.devicePosture.dispatchEvent(new Event('change'));},s);await p.waitForTimeout(260);};
const STACK=(w,h)=>[{top:0,bottom:Math.round(h*.45),left:0,right:w},{top:Math.round(h*.45)+24,bottom:h,left:0,right:w}];
const SIDE=(w,h)=>[{top:0,bottom:h,left:0,right:Math.round(w/2)-12},{top:0,bottom:h,left:Math.round(w/2)+12,right:w}];
const LANDING=[['today','main','.td-hero'],['accounts','main','#page-portfolio .header'],['accounts','agentic','#page-portfolio .header'],['markets','main','.picks-hero'],['analyze','main','#pj-context'],['apexpaper','main','.apx-head']];
const noOverflow=async(t)=>assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1&&[...document.querySelectorAll('[data-duo-pin]')].every(e=>e.scrollWidth<=e.clientWidth+1)),true,t+': no horizontal overflow, no clipped pinned block');
const STAMP=/^[A-Z][a-z]{2} \d{1,2}, \d{1,2}:\d{2}\s?(AM|PM) ET$|^SAMPLE DATA/;

// ── 1. Control: visible, labelled, >=44px, four radios >=44px; the freshness stamp stays whole at 320 / 390 ──
for(const [w,h] of [[320,568],[390,844]]){
  await p.setViewportSize({width:w,height:h});await settle();
  for(const [route,account] of [['today','main'],['accounts','agentic'],['markets','main'],['apexpaper','main'],['options','main']]){
    await nav(route,account);
    const b=p.locator('#pf-duo');assert.equal(await b.isVisible(),true,`${w}: control visible on ${route}/${account}`);
    assert.match(await b.getAttribute('aria-label'),/^Duo layout: Auto/);assert.ok((await b.boundingBox()).height>=44,'control is a 44px target');
    const r=await p.evaluate(()=>{const l=document.getElementById('pf-fresh-left').getBoundingClientRect(),a=document.querySelector('#pf-fresh .pf-fresh-actions').getBoundingClientRect(),e=document.getElementById('pf-fresh-left');return {gap:a.left-l.right,clip:e.scrollWidth-e.clientWidth,bar:document.getElementById('pf-fresh').offsetHeight};});
    assert.ok(r.clip<=1&&r.gap>=-1,`${w}: freshness stamp not clipped by the control (clip ${r.clip}, gap ${r.gap})`);
    if(route==='today'&&account==='main'&&w===320)assert.ok(r.bar<=44,'the bar did not grow');
  }
}
await p.setViewportSize({width:390,height:844});await nav('today','main');
await p.locator('#pf-duo').click();assert.equal(await p.locator('#pf-duo-pop').isVisible(),true);
assert.equal(await p.locator('#pf-duo-pop [role="radiogroup"] [role="radio"]').count(),4);
for(const m of await p.locator('#pf-duo-pop [role="radio"]').all())assert.ok((await m.boundingBox()).height>=44,'radio target');
assert.equal(await p.locator('#pf-duo-pop [aria-checked="true"]').innerText(),'Auto');
await p.keyboard.press('Escape');assert.equal(await p.locator('#pf-duo-pop').isVisible(),false,'Escape closes');

// ── 2. Auto without a fold signal is Standard; the control changes it and it persists across reload; storage failure = Auto ──
assert.deepEqual(await attrs(),{mode:'auto',layout:'standard',split:null});
await p.locator('#pf-duo').click();await p.locator('#pf-duo-pop [data-duo-mode="folded"]').click();await settle();
assert.deepEqual(await attrs(),{mode:'folded',layout:'folded',split:'on'});assert.equal(await p.evaluate(()=>localStorage.getItem('pf:duo-mode')),'folded');
assert.equal(await p.locator('#pf-duo-pop').isVisible(),true,'the popover stays open to show the choice');
await p.reload();await boot();assert.deepEqual(await attrs(),{mode:'folded',layout:'folded',split:'on'},'folded survives reload');
await mode('book');await p.reload();await boot();assert.equal((await attrs()).layout,'book');
await p.evaluate(()=>localStorage.setItem('pf:duo-mode','sideways'));await p.reload();await boot();assert.equal((await attrs()).mode,'auto','junk = auto');
await p.evaluate(()=>{window.__setItem=Storage.prototype.setItem;Storage.prototype.setItem=function(){throw new Error('denied');};});
await mode('folded');assert.equal((await attrs()).layout,'folded','a failing store still switches (not persisted)');
await p.evaluate(()=>{Storage.prototype.setItem=window.__setItem;});await mode('auto');await p.evaluate(()=>localStorage.removeItem('pf:duo-mode'));

// ── 3. REAL transitions on a live page: simulated segments flip the layout without reload; explicit modes win over the sensor ──
await p.setViewportSize({width:466,height:677});await nav('accounts','main');
await p.evaluate(()=>{window.__marker='kept';});
await segs(STACK(466,677));assert.deepEqual(await attrs(),{mode:'auto',layout:'folded',split:'on'},'stacked segments -> folded');
assert.equal(await p.evaluate(()=>parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--fold-top'))),Math.round(677*.45),'--fold-top is the reported top segment');
await segs(SIDE(466,677));assert.equal((await attrs()).layout,'book','side-by-side segments -> book');
await segs(null);assert.deepEqual(await attrs(),{mode:'auto',layout:'standard',split:null},'segments gone -> standard');
await segs(STACK(466,677));await mode('standard');await segs(STACK(466,677));assert.equal((await attrs()).layout,'standard','an explicit Standard survives a fold report and a reload');
await p.reload();await boot();await segs(STACK(466,677));assert.deepEqual(await attrs(),{mode:'standard',layout:'standard',split:null});
await mode('auto');assert.equal((await attrs()).layout,'folded');await segs(null);
await mode('book');assert.equal((await attrs()).layout,'book','explicit Book without a sensor');
assert.equal(await p.evaluate(()=>window.__marker),undefined,'(the reload above cleared the marker)');
await p.evaluate(()=>{window.__marker='kept';});await mode('folded');await mode('standard');await mode('auto');assert.equal(await p.evaluate(()=>window.__marker),'kept','mode changes never reload');
// A transition that other tabs/listeners can observe.
const evt=await p.evaluate(()=>new Promise(res=>{document.addEventListener('pf:duo-change',e=>res(e.detail),{once:true});PFDuo.setMode('folded');}));
assert.deepEqual([evt.mode,evt.layout],['folded','folded']);assert.equal(await p.evaluate(()=>[PFDuo.mode,PFDuo.layout].join()),'folded,folded');

// ── 4. Folded split on each landing view at three sizes: summary above the crease, rest below, nav in the bottom region ──
await mode('folded');
for(const [w,h] of [[390,844],[466,677],[960,676]]){
  await p.setViewportSize({width:w,height:h});await settle();
  for(const [route,account,sel] of LANDING){
    await nav(route,account);if(route==='analyze')await p.evaluate(()=>PFJourney.select('AAPL')),await settle();
    const fold=await p.evaluate(()=>({top:parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--fold-top')),bottom:parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--fold-bottom'))}));
    assert.deepEqual(await attrs(),{mode:'folded',layout:'folded',split:'on'},`${w}x${h} ${route}`);
    const pins=await p.evaluate(()=>[...document.querySelectorAll('[data-duo-pin]')].map(e=>({id:e.id||e.className.split(' ')[0],top:e.getBoundingClientRect().top,bottom:e.getBoundingClientRect().bottom,sel:e.matches('.td-hero,#page-portfolio .header,.picks-hero,#pj-context,.apx-head')})));
    assert.ok(pins.length>=2&&pins.every(x=>x.bottom<=fold.top+1),`${w}x${h} ${route}: pinned blocks sit above the crease ${JSON.stringify(pins)}`);
    assert.ok(pins.some(x=>x.sel),`${w}x${h} ${route}/${account}: the view's own summary is in the top region`);
    assert.equal(await p.locator(sel+':visible').first().evaluate(e=>e.hasAttribute('data-duo-pin')),true,`${route}: ${sel} is pinned`);
    await noOverflow(`${w}x${h} ${route}`);
    // The nav stays at the bottom; the page scrolls, the pinned summary does not.
    const nb=await p.locator('.ex-main').boundingBox();assert.ok(w>=740||nb.y>h-100,'bottom nav in the bottom region');
    const before=await p.locator('[data-duo-pin]').first().boundingBox();await p.evaluate(()=>scrollTo(0,400));await p.waitForTimeout(120);
    const after=await p.locator('[data-duo-pin]').first().boundingBox();assert.equal(Math.round(after.y),Math.round(before.y),`${route}: top region does not scroll`);
    assert.ok(await p.evaluate(()=>scrollY)>0||await p.evaluate(()=>document.documentElement.scrollHeight)<=await p.evaluate(()=>innerHeight)+1,'the bottom region scrolls');
    // Nothing visible under the pane: the first thing painted below the crease is page content, not a hidden duplicate.
    const hit=await p.evaluate(f=>{const e=document.elementFromPoint(innerWidth/2,f.top-4);return e?(e.closest('[data-duo-pin]')?'pinned':e.closest('#pf-fresh')?'fresh':'other:'+e.tagName):'none';},fold);
    assert.ok(['pinned','fresh'].includes(hit)||hit==='other:HTML','above the crease only the pane is hit-testable: '+hit);
    await p.evaluate(()=>scrollTo(0,0));
    if(route==='today'&&w===466)assert.equal(await p.locator('.td-hero #ex-combined-equity').evaluate(e=>e.getBoundingClientRect().bottom<=parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--fold-top'))),true,'466x677: Today shows the combined equity above the crease');
  }
  // A non-landing route is full screen with the split ON.
  for(const [route,account] of [['holdings','main'],['options','main'],['plan','agentic'],['activity','main'],['decisions','agentic']]){
    await nav(route,account);assert.equal((await attrs()).split,null,`${route}: no split`);assert.equal(await p.locator('[data-duo-pin]').count(),0);
    assert.equal(await p.evaluate(()=>getComputedStyle(document.documentElement,'::before').content),'none',`${route}: no top-pane backdrop`);
  }
}

// ── 5. Book: summary left of the crease, the rest right of it; no overflow at 390 and ~700 ──
await mode('book');
for(const [w,h] of [[390,844],[700,520]]){
  await p.setViewportSize({width:w,height:h});await settle();
  for(const [route,account] of LANDING.filter(x=>x[1]==='main'||x[0]==='accounts'&&w===390)){
    await nav(route,account);if(route==='analyze')await p.evaluate(()=>PFJourney.select('AAPL')),await settle();
    assert.deepEqual(await attrs(),{mode:'book',layout:'book',split:'on'});
    const fold=await p.evaluate(()=>({l:parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--fold-left')),r:parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--fold-right'))}));
    const pins=await p.evaluate(()=>[...document.querySelectorAll('[data-duo-pin]')].map(e=>e.getBoundingClientRect().right));
    assert.ok(pins.length>=2&&pins.every(x=>x<=fold.l+1),`${w} ${route}: pinned left of the crease`);
    const rest=await p.evaluate(r=>{const e=[...document.querySelectorAll('#page-portfolio .card,#page-ex-today .td-waiting,#markets-app .card,#page-analyze .card,.apx-card')].find(x=>x.getClientRects().length&&!x.closest('[data-duo-pin]'));return e?e.getBoundingClientRect().left:null;},fold.r);
    assert.ok(rest===null||rest>=fold.r-1,`${w} ${route}: page content right of the crease (${rest} vs ${fold.r})`);
    await noOverflow(`book ${w} ${route}`);
  }
}

// ── 6. Transitions keep the place: route, account, holding, open details, filters and scroll ──
await p.setViewportSize({width:466,height:677});await mode('standard');
await nav('accounts','agentic');await p.evaluate(()=>scrollTo(0,520));await p.waitForTimeout(250);
const y0=await p.evaluate(()=>scrollY);const probe=await p.evaluate(()=>{const e=document.elementFromPoint(innerWidth/2,300);return e?e.textContent.trim().slice(0,40):'';});
await mode('folded');await mode('standard');
const st=await p.evaluate(()=>({r:PFExperience.route,a:PFExperience.account,y:scrollY}));assert.deepEqual([st.r,st.a],['accounts','agentic']);assert.ok(Math.abs(st.y-y0)<=60,`scroll restored after folded and back (${y0} -> ${st.y})`);
await mode('folded');await mode('book');await mode('standard');
assert.ok(Math.abs(await p.evaluate(()=>scrollY)-y0)<=90,'scroll kept across folded -> book -> standard');
await nav('analyze','main');await p.evaluate(()=>PFJourney.select('AAPL'));await settle();
await mode('folded');assert.equal(await p.evaluate(()=>PFJourney.state.symbol),'AAPL','selected holding kept');assert.equal(await p.locator('#pj-symbol').inputValue(),'AAPL');
await nav('apexpaper','main');await p.locator('.apx-explore input[type="search"],.apx-explore input').first().fill('A').catch(()=>{});
await mode('standard');await mode('folded');
assert.equal(await p.evaluate(()=>PFExperience.route),'apexpaper');
// Privacy masks the pinned summary; Back / Forward across a split and a non-split route; resize updates without reload.
await nav('today','main');await p.evaluate(()=>setPrivacy(true));await settle();
assert.doesNotMatch(await p.locator('.td-hero').innerText(),/\$\d/,'privacy masks the pinned hero');await p.evaluate(()=>setPrivacy(false));await settle();
await nav('accounts','main');await nav('holdings','main');assert.equal((await attrs()).split,null);
await p.goBack();await settle();assert.equal(await p.evaluate(()=>PFExperience.route),'accounts');assert.equal((await attrs()).split,'on','Back into a split view re-splits');
await p.goForward();await settle();assert.equal((await attrs()).split,null,'Forward to a non-split route is full screen');
await p.evaluate(()=>{window.__marker='kept';});
await mode('auto');await p.setViewportSize({width:960,height:676});await segs(STACK(960,676));assert.equal((await attrs()).layout,'folded');
await p.setViewportSize({width:466,height:677});await segs(STACK(466,677));await settle();assert.equal((await attrs()).layout,'folded');
await p.setViewportSize({width:677,height:466});await segs(SIDE(677,466));await settle();assert.equal((await attrs()).layout,'book','rotated: stacked -> side by side without a reload');
await segs(null);await settle();assert.equal((await attrs()).layout,'standard');
assert.equal(await p.evaluate(()=>window.__marker),'kept','resizes and rotations never reload');

// ── 7. Standard is the v246 layout: nothing is pinned, no state-owned style is left behind, containers return to where they were ──
const geom=()=>p.evaluate(()=>['#ex-top','#ex-subnav','#page-portfolio .header','#ws-strip','#page-ex-today .td-hero','.ex-main','#pf-fresh','#markets-app > .picks-hero','.apx-head','#pj-context'].map(s=>{const e=document.querySelector(s),r=e&&e.getClientRects().length?e.getBoundingClientRect():null;return s+':'+(r?[r.left,r.top+scrollY,r.width,r.height].map(Math.round).join(','):'-');}).join('|'));
await p.setViewportSize({width:466,height:677});
const base0={};
for(const [route,account] of LANDING){
  await mode('auto');await nav(route,account);await p.evaluate(()=>scrollTo(0,0));base0[route+account]=await geom();
  await mode('folded');await mode('book');await mode('standard');await nav(route,account);await p.evaluate(()=>scrollTo(0,0));
  assert.equal(await geom(),base0[route+account],`${route}/${account}: Standard geometry is the geometry Auto-without-fold gave`);
  assert.equal(await p.evaluate(()=>[document.querySelectorAll('[data-duo-pin]').length,document.documentElement.hasAttribute('data-duo-split'),document.documentElement.hasAttribute('data-duo-ready'),['--duo-lead','--duo-padl','--fold-top','--fold-left'].filter(k=>document.documentElement.style.getPropertyValue(k)).length].join()),'0,false,false,0');
}
await mode('auto');
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
  try{await runDuoChecks({browser,base,sample,stub,apex:{asOf:new Date().toISOString(),targets:{MSFT:20},top5:[{sym:'MSFT',composite:8,why:'Synthetic entry research',limit:420,trigger:420,stop:380,tp1:500,orderType:'limit',tradable:true}],heldLevels:[{sym:'AAPL',stop:170,tp1:230,why:'Synthetic'}]}});
    console.log('duo-checks PASS in '+((Date.now()-t)/1000).toFixed(1)+'s');}finally{await browser.close();}
}
