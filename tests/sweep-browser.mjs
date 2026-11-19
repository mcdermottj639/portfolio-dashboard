// Layout sweep (v255): every route × 7 screen sizes × both accounts, measured on real element edges. Synthetic data only;
// no orders, no writes. Prints a defect list and writes tmp/sweep/sweep.json + sweep.md. It REPORTS; it fails only on
// page errors, sideways document scroll or a non-GET request, so the list can be read even when layout defects exist.
// Run: node tests/preview.mjs & node tests/sweep-browser.mjs   (PF_SWEEP_STRICT=1 also fails on edge defects)
import fs from 'node:fs';
const {chromium}=await import(process.env.PF_PLAYWRIGHT||'playwright');
const base=(process.env.PF_PREVIEW_URL||'http://127.0.0.1:8767/').replace(/\/?$/,'/');
const sample=JSON.parse(fs.readFileSync('tmp/experience-preview/sample.json','utf8'));
const stub=fs.readFileSync('producer/privacy-audit.mjs','utf8').match(/const CHART_STUB = `([\s\S]*?)`;/)[1];
const apexT={asOf:new Date().toISOString(),targets:{MSFT:20},top5:[{sym:'MSFT',composite:8,why:'Synthetic entry research',limit:420,trigger:420,stop:380,tp1:500,orderType:'limit',tradable:true}],heldLevels:[]};
const out='tmp/sweep';fs.mkdirSync(out,{recursive:true});
// 320 small phone · 390 phone · Duo folded · Duo folded sideways · Duo open Book · Duo open Standard · desktop
const sizes=[{n:'320',w:320,h:568},{n:'390',w:390,h:844},{n:'folded',w:466,h:677},{n:'folded-side',w:678,h:453},
  {n:'book',w:951,h:669,mode:'book'},{n:'open',w:960,h:676,mode:'standard'},{n:'desktop',w:1280,h:800}];
const browser=await chromium.launch({...(process.env.PF_CHROME?{executablePath:process.env.PF_CHROME}:{}),args:['--no-sandbox','--disable-dev-shm-usage']});
// Every route id in ui/experience.js; account-free routes run once, the rest under Apex (main) and Agentic.
const routes=['today','plan','acctresearch','accounts','holdings','performance','heatmap','risk','income','technicals','fundamentals','flow','scenario','apexpaper','markets','screens','analyze','smartmoney','predictions','options','decisions','log','activity'];
const single=['today','apexpaper','markets','screens','smartmoney','predictions','options'];
const results=[],errors=[],writes=[];
try{
 for(const sz of sizes){
  const ctx=await browser.newContext({viewport:{width:sz.w,height:sz.h},timezoneId:'America/New_York',serviceWorkers:'block'});
  const p=await ctx.newPage();
  p.on('pageerror',e=>errors.push(sz.n+': '+e.message));p.on('request',r=>{if(!['GET','HEAD'].includes(r.method()))writes.push(r.url());});
  await p.addInitScript(stub);
  await p.addInitScript(m=>{if(!sessionStorage.getItem('sweep-init')){localStorage.setItem('pf_acct','main');localStorage.setItem('pf_experience_route','today');if(m)localStorage.setItem('pf:duo-mode',m);sessionStorage.setItem('sweep-init','1');}},sz.mode||'');
  await p.route('https://**/*',r=>r.request().url().startsWith(base)?r.continue():r.abort());
  await p.route(/\/data\.json(?:\?.*)?$/,r=>r.fulfill({json:sample}));await p.route(/\/data\/apex-targets\.json(?:\?.*)?$/,r=>r.fulfill({json:apexT}));
  await p.goto(base);await p.waitForFunction(()=>window.__SNAP&&window.PFExperience);await p.waitForTimeout(700);
  for(const route of routes){
   for(const acct of (single.includes(route)?['main']:['main','agentic'])){
    const ok=await p.evaluate(([r,a])=>{try{PFExperience.navigate(r,{account:a});return PFExperience.route===r;}catch(e){return String(e);}},[route,acct]);
    if(ok===false)continue;   // route not in this build (e.g. What if? after v255)
    await p.waitForTimeout(420);
    const m=await p.evaluate(()=>{
     const W=innerWidth,R=document.documentElement,book=R.getAttribute('data-book')==='on'||!!document.querySelector('#pf-book:not([hidden])');
     const fold=parseFloat(getComputedStyle(R).getPropertyValue('--fold-left'))||null;
     const vis=e=>{const r=e.getBoundingClientRect();if(!r.width||!r.height)return false;const cs=getComputedStyle(e);return cs.visibility!=='hidden'&&cs.display!=='none'&&+cs.opacity!==0;};
     const inScroller=e=>{for(let a=e.parentElement;a&&a!==document.body;a=a.parentElement){const cs=getComputedStyle(a);if(/(auto|scroll|hidden|clip)/.test(cs.overflowX)&&a.scrollWidth>a.clientWidth+1)return true;}return false;};
     const name=e=>{let s=e.tagName.toLowerCase();if(e.id)s+='#'+e.id;else if(e.classList.length)s+='.'+[...e.classList].slice(0,2).join('.');const sec=e.closest('[data-sec],[id^="page-"],.ex-card,.card');if(sec&&sec!==e)s=(sec.dataset.sec||sec.id||sec.className.split(' ')[0])+' › '+s;return s;};
     const defects=[];
     for(const e of document.querySelectorAll('body *')){
      if(!vis(e)||e.closest('svg')&&e.tagName.toLowerCase()!=='svg')continue;
      const r=e.getBoundingClientRect();
      if((r.right>W+1||r.left<-1)&&!inScroller(e)&&getComputedStyle(e).position!=='fixed')defects.push({k:'off-screen',el:name(e),x:Math.round(r.left),r:Math.round(r.right)});
      else if(book&&fold&&r.left<fold-2&&r.right>fold+2&&r.width<W*0.9&&!e.closest('#pf-book')&&e.offsetParent&&!inScroller(e)&&e.children.length===0&&e.textContent.trim())defects.push({k:'crosses-fold',el:name(e),x:Math.round(r.left),r:Math.round(r.right)});
      if(e.children.length===0&&/[\d$%]/.test(e.textContent)&&e.scrollWidth>e.clientWidth+1&&/(hidden|clip)/.test(getComputedStyle(e).overflowX))defects.push({k:'clipped-figure',el:name(e),text:e.textContent.trim().slice(0,40)});
     }
     // collapsed-card count (Accounts/Plan folds) and the height a reader scrolls
     const folded=[...document.querySelectorAll('[data-sec] .card-body,[data-ws] details:not(.ex-method)')].filter(b=>b.closest('[id^="page-"]')&&vis(b.closest('[data-sec],[data-ws]'))&&(b.tagName==='DETAILS'?!b.open:b.style.display==='none')).length;
     const sc=document.querySelector('[data-duo-scroller]');
     const pane=document.getElementById('pf-book');
     const uniq=[...new Map(defects.map(d=>[d.k+d.el,d])).values()].slice(0,25);
     return {sw:R.scrollWidth,iw:W,book,height:sc?sc.scrollHeight:document.scrollingElement.scrollHeight,vh:innerHeight,left:pane&&!pane.hidden?pane.scrollHeight:null,folded,defects:uniq};
    });
    results.push({size:sz.n,route,acct,nav:ok,...m});
    if(m.sw>m.iw+1)errors.push(sz.n+' '+route+'/'+acct+': sideways scroll '+m.sw+'>'+m.iw);
   }
  }
  await ctx.close();
 }
}finally{await browser.close();}
fs.writeFileSync(out+'/sweep.json',JSON.stringify(results,null,1));
const bad=results.filter(r=>r.defects.length||r.sw>r.iw+1);
const md=['# Layout sweep — '+results.length+' route/size/account views','','| Size | Route | Acct | Screens tall | Folded | Defects |','|---|---|---|---|---|---|',
 ...results.map(r=>'| '+r.size+' | '+r.route+' | '+r.acct+' | '+(r.height/r.vh).toFixed(1)+(r.left?(' / left '+(r.left/r.vh).toFixed(1)):'')+' | '+r.folded+' | '+(r.sw>r.iw+1?'SIDEWAYS ':'')+r.defects.map(d=>d.k+' '+d.el+(d.text?' "'+d.text+'"':'')).join('; ')+' |'),
 '','## Errors',...errors.map(e=>'- '+e),...writes.map(w=>'- WRITE '+w)];
fs.writeFileSync(out+'/sweep.md',md.join('\n'));
console.log('views',results.length,'with defects',bad.length,'errors',errors.length);
for(const r of bad.slice(0,200))console.log(r.size,r.route,r.acct,JSON.stringify(r.defects.slice(0,4)));
// Page length per view (screens tall; Book also the left page), so a before/after run can be compared from the log alone.
for(const r of results)console.log('H',r.size,r.route,r.acct,(r.height/r.vh).toFixed(2),r.left?(r.left/r.vh).toFixed(2):'-',r.folded);
if(errors.length||writes.length){console.error(errors.join('\n'),writes.join('\n'));process.exit(1);}
if(process.env.PF_SWEEP_STRICT&&bad.length)process.exit(1);
