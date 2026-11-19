// #235: Apex v2.9 Paper decision view — summary, filters/Reset, two-pane list/detail, edge states, no overflow.
// Runs against tests/preview.mjs (synthetic account data). The paper page reads the committed public research
// file data/apex-paper-v29.json for the main pass; edge cases are painted from synthetic documents.
// Expected values are derived from the file at run time, never hardcoded. Nothing here submits anything.
//   node tests/preview.mjs &   then   node tests/apex-paper-view-browser.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';

const {chromium}=await import(process.env.PF_PLAYWRIGHT||'playwright');
const base=(process.env.PF_PREVIEW_URL||'http://127.0.0.1:8767/').replace(/\/?$/,'/');
const shots=process.env.PF_SCREENSHOT_DIR||'tmp/apex-paper-view';fs.mkdirSync(shots,{recursive:true});
const sample=JSON.parse(fs.readFileSync('tmp/experience-preview/sample.json','utf8'));
const stub=fs.readFileSync('producer/privacy-audit.mjs','utf8').match(/const CHART_STUB = `([\s\S]*?)`;/)[1];
const paper=JSON.parse(fs.readFileSync('data/apex-paper-v29.json','utf8'));
const apex={asOf:new Date().toISOString(),targets:{MSFT:20},top5:[{sym:'MSFT',composite:8,why:'Synthetic entry research',limit:420,trigger:420,stop:380,tp1:500,orderType:'limit',tradable:true}],heldLevels:[]};

// What the file says, computed here so the test follows the data.
const groups=['qualified','near','emerging'];
const listed=groups.flatMap(g=>(paper.ranked?.[g]||[]).map(r=>({g,r})));
const pickSyms=(paper.batch?.picks||[]).map(p=>p.sym);
const blockedSyms=new Set([...(paper.batch?.blocked||[]).map(b=>b.sym),...listed.filter(x=>x.r.status==='blocked').map(x=>x.r.sym)]);
const nBlockedRows=listed.filter(x=>blockedSyms.has(x.r.sym)).length;

const VP=[[320,690,{}],[390,844,{}],[466,677,{right:84}],[960,676,{right:100}]];
const browser=await chromium.launch({...(process.env.PF_CHROME?{executablePath:process.env.PF_CHROME}:{}),args:['--no-sandbox','--disable-dev-shm-usage']});
const writes=[];
async function open(viewport,inset){
  const ctx=await browser.newContext({viewport,timezoneId:'America/New_York',serviceWorkers:'block'});
  const p=await ctx.newPage(),errors=[];
  p.on('pageerror',e=>errors.push('pageerror: '+e.message));
  // Requests to other hosts are aborted on purpose below; that console line is noise, everything else counts.
  p.on('console',m=>{if(m.type()==='error'&&!/Failed to load resource|ERR_FAILED/.test(m.text()))errors.push('console: '+m.text());});
  p.on('request',r=>{if(!['GET','HEAD'].includes(r.method()))writes.push(r.url());});
  await p.addInitScript(stub);
  await p.addInitScript(()=>{if(!sessionStorage.getItem('apv')){localStorage.setItem('pf_acct','main');localStorage.setItem('pf_experience_route','apexpaper');sessionStorage.setItem('apv','1');}});
  await p.route('https://**/*',r=>r.request().url().startsWith(base)?r.continue():r.abort());
  await p.route(/\/data\.json(?:\?.*)?$/,r=>r.fulfill({json:sample}));
  await p.route(/\/data\/apex-targets\.json(?:\?.*)?$/,r=>r.fulfill({json:apex}));
  if(inset&&Object.keys(inset).length){const c=await ctx.newCDPSession(p);await c.send('Emulation.setSafeAreaInsetsOverride',{insets:{top:0,bottom:0,right:inset.right||0,left:inset.left||0}});}
  await p.goto(base+'#view=apexpaper');await p.waitForFunction(()=>window.__SNAP&&window.PFJourney);
  await p.waitForFunction(()=>document.querySelector('#apexpaper-app .apx'));await p.waitForTimeout(300);
  return {ctx,p,errors};
}
const noOverflow=async(p,label)=>{const o=await p.evaluate(()=>{const w=document.documentElement.clientWidth,bad=[];
  for(const e of document.querySelectorAll('#apexpaper-app *')){if(!e.offsetParent&&getComputedStyle(e).position!=='fixed')continue;const r=e.getBoundingClientRect();if(r.width&&(r.right>w+1||r.left<-1))bad.push((e.className||e.tagName)+':'+Math.round(r.left)+'-'+Math.round(r.right));}
  return {sw:document.documentElement.scrollWidth,iw:innerWidth,bad:bad.slice(0,5)};});
  assert.ok(o.sw<=o.iw,`${label}: scrollWidth ${o.sw} > innerWidth ${o.iw}`);assert.deepEqual(o.bad,[],`${label}: element outside the viewport`);};
const visibleRows=p=>p.locator('#apexpaper-app [data-apx-sec="ranked"] .apx-row:not([hidden])').count();
const paint=(p,doc)=>p.evaluate(d=>{window.__APEX_PAPER=d;window.__APEX_PAPER_ERR=null;window.__apexPaperPaint();},doc);

try{
  for(const [w,h,inset] of VP){
    const label=`${w}x${h}`;const {ctx,p,errors}=await open({width:w,height:h},inset);
    const two=w>=740;
    // Summary: visible, PAPER ONLY, pick count and names from the file, model version.
    const sum=p.locator('#apexpaper-app [data-apx-sec="decision"]');
    assert.equal(await sum.isVisible(),true,label+': decision summary visible');
    const top=(await p.locator('#apexpaper-app .apx-head').innerText()).replace(/\s+/g,' ');
    assert.match(top,/PAPER ONLY/);assert.ok(top.includes(paper.rulesVersion),label+': model version');
    const st=(await sum.innerText()).replace(/\s+/g,' ');
    assert.ok(st.includes('Paper picks '+pickSyms.length),label+': pick count from the file');
    for(const s of pickSyms)assert.ok(st.includes(s),label+': pick '+s);
    for(const s of blockedSyms)assert.ok(st.includes(s),label+': blocked '+s+' shown');
    assert.ok(await sum.evaluate(e=>e.getBoundingClientRect().top<innerHeight),label+': summary starts on the first screen');
    await noOverflow(p,label+' top');
    await p.screenshot({path:`${shots}/apex-paper-${label}-top.png`});

    // Filters + Reset.
    const total=listed.length;
    assert.equal(await visibleRows(p),total,label+': every listed row present');
    await p.locator('#apexpaper-app .apx-segopt:has(input[value="blocked"])').click();await p.waitForTimeout(120);
    assert.equal(await visibleRows(p),nBlockedRows,label+': Blocked filter shows the blocked rows');
    assert.match(await p.locator('[data-apx-count]').innerText(),new RegExp('Showing '+nBlockedRows+' of '+total));
    await p.locator('#apexpaper-app .apx-segopt:has(input[value="pick"])').click();await p.waitForTimeout(120);
    assert.equal(await visibleRows(p),listed.filter(x=>pickSyms.includes(x.r.sym)).length,label+': Paper picks filter');
    await p.locator('#apexpaper-app .apx-search').fill('zzzz-no-such');await p.waitForTimeout(120);
    assert.equal(await visibleRows(p),0);assert.equal(await p.locator('[data-apx-nomatch]').isVisible(),true,label+': no-match line');
    await p.locator('#apexpaper-app .apx-reset').click();await p.waitForTimeout(150);
    assert.equal(await visibleRows(p),total,label+': Reset restores every row');
    assert.equal(await p.locator('#apexpaper-app input[name="seg"][value="all"]').isChecked(),true);
    assert.equal(await p.locator('#apexpaper-app .apx-search').inputValue(),'');
    assert.equal(await p.locator('#apexpaper-app details.apx-list-fold[open]').count(),0,label+': Reset closes the folds the filter opened');
    // Sector + min score via the More filters fold.
    await p.locator('#apexpaper-app details[data-apx-key="filters"]>summary').click();
    const sector=listed[0].r.sector;await p.locator('#apexpaper-app select[name="sector"]').selectOption(sector);await p.waitForTimeout(120);
    assert.equal(await visibleRows(p),listed.filter(x=>x.r.sector===sector).length,label+': sector filter');
    await p.locator('#apexpaper-app select[name="minScore"]').selectOption('8');await p.waitForTimeout(120);
    assert.equal(await visibleRows(p),listed.filter(x=>x.r.sector===sector&&x.r.composite>=8).length,label+': sector + min score');
    await noOverflow(p,label+' filtered');
    await p.locator('#apexpaper-app .apx-reset').click();await p.waitForTimeout(150);
    assert.equal(await visibleRows(p),total);
    await p.locator('#apexpaper-app details[data-apx-key="filters"]>summary').click();

    // Selection: right pane in two-pane mode, inline expansion otherwise.
    const target=listed.find(x=>x.g==='qualified'&&!pickSyms.includes(x.r.sym))||listed[1]||listed[0];
    const key=`row:${target.g}:${target.r.sym}`, row=p.locator(`#apexpaper-app .apx-row[data-apx-key="${key}"]`);
    const pane=p.locator('#apexpaper-app [data-apx-sec="detail"]');
    if(two){
      assert.equal(await pane.isVisible(),true,label+': detail pane shown');
      const geo=await p.evaluate(()=>{const l=document.querySelector('#apexpaper-app [data-apx-sec="ranked"]').getBoundingClientRect(),r=document.querySelector('#apexpaper-app [data-apx-sec="detail"]').getBoundingClientRect();return {l:l.right,r:r.left,lw:l.width,rw:r.width};});
      assert.ok(geo.r>=geo.l-1,label+': list left, detail right');
      assert.match(await pane.getAttribute('data-apx-detail'),new RegExp(':'+pickSyms[0]+'$'),label+': opens on the first paper pick');
      await row.locator('summary').scrollIntoViewIfNeeded();await row.locator('summary').click();await p.waitForTimeout(120);
      assert.equal(await pane.getAttribute('data-apx-detail'),key,label+': selection updates the pane in place');
      assert.equal(await row.evaluate(e=>e.open),false,label+': the row does not also expand');
      const dt=(await pane.innerText()).replace(/\s+/g,' ');
      assert.ok(dt.includes(target.r.sym));assert.match(dt,/Entry .*Target .*Stop .*R\/R/i);
      assert.match(dt,/Why (selected|blocked)|reason not available|:/,label+': a reason line');
      await p.evaluate(()=>{const e=document.querySelector('#apexpaper-app .apx-explore');scrollTo(0,e.getBoundingClientRect().top+scrollY-90);});await p.waitForTimeout(100);
      await p.screenshot({path:`${shots}/apex-paper-${label}-twopane.png`});
    }else{
      assert.equal(await pane.isVisible(),false,label+': no detail pane in single column');
      await row.locator('summary').scrollIntoViewIfNeeded();await row.locator('summary').click();await p.waitForTimeout(120);
      assert.equal(await row.evaluate(e=>e.open),true,label+': tap expands inline');
      assert.equal(await row.locator('.apx-levels').isVisible(),true);
      await noOverflow(p,label+' row open');
      await row.locator('summary').evaluate(e=>e.scrollIntoView({block:'start'}));await p.evaluate(()=>scrollBy(0,-60));
      await p.screenshot({path:`${shots}/apex-paper-${label}-row.png`});
      await row.locator('summary').click();
    }
    // Lower panels: sectors and validation.
    await p.locator('#apexpaper-app [data-apx-sec="sectors"]').scrollIntoViewIfNeeded();
    await p.screenshot({path:`${shots}/apex-paper-${label}-panels.png`});
    await noOverflow(p,label+' panels');

    // Edge documents, painted in place: never an error, never an invented number.
    const now=Date.now(),iso=ms=>new Date(ms).toISOString();
    const clone=()=>JSON.parse(JSON.stringify(paper));
    const edge={
      zero:Object.assign(clone(),{asOf:iso(now-36e5),status:'ok',funnel:{...paper.funnel,qualified:0},ranked:{qualified:[],near:paper.ranked.near.slice(0,3),emerging:[]},batch:{...paper.batch,picks:[],blocked:[],cashPct:100},sectors:{universe:paper.sectors.universe,qualified:{},near:{}}}),
      noReason:Object.assign(clone(),{asOf:iso(now-36e5),status:'ok',batch:{...paper.batch,blocked:(paper.batch.blocked||[]).map(b=>({sym:b.sym})).concat([{sym:'ZZOFF'}])},ranked:{...paper.ranked,qualified:paper.ranked.qualified.map(r=>r.status==='blocked'?{...r,statusReason:null}:r)}}),
      stale:Object.assign(clone(),{asOf:iso(now-9*864e5),lastSuccessAsOf:iso(now-9*864e5),status:'ok',cohorts:[],marks:[]}),
      // v257: measured results, simulated portfolio, weekly cohorts and the rejected-names ledger (long names, every horizon).
      measured:(()=>{const A='2026-11-23T07:52:00-05:00',hz=x=>({n:3,hit:0.67,avgAlpha:x,medianAlpha:x,avgAlphaNet:+(x-0.2).toFixed(2)}),arm=(l,h)=>({label:l,cohorts:2,entered:6,horizons:{5:hz(h),30:hz(h*2),60:hz(h*3),90:hz(h*4)},descriptive:true});
        const pk=(sym,gate,i)=>({sym,gate,source:/^live/.test(gate)?'live v2.8':'paper v2.9',composite:6.1+i,entryRule:'next session open',entryPx:123.45+i,entryDate:'2026-11-24',status:i%3?'entered':'pending'});
        const gates=['live-pick','live-tech-cap','live-rr','paper-rr','paper-trend','paper-not-near-high','paper-not-pulled-back','paper-growth-low','paper-growth-neg','paper-pe','paper-rs3','paper-slope','paper-off-low'];
        const picks=gates.flatMap((g,i)=>[pk('W'+i+'LONGX',g,i),pk('V'+i,g,i+1)]);
        const sa=x=>({cohorts:2,inProgress:1,names:6,stops:2,avgRetNetPct:x,avgAlphaNetPct:x-1.25,worstDrawdownPct:-12.34,avgExposurePct:61.5});
        return Object.assign(clone(),{asOf:iso(now-36e5),status:'ok',skipped:[{date:'2026-11-16',reason:'coverage partial: slice 7 and slice 11 short of their totals'}],
          shadow:{cohorts:[{asOf:A,liveIncluded:true,liveStatus:'added-late',picks},{asOf:'2026-11-09T07:52:00-05:00',liveStatus:'missing',liveNote:'Live v2.8 names missing for this week.',picks:picks.slice(0,6)}],
            marks:picks.map((x,i)=>({asOf:A,sym:x.sym,horizon:5,ret:i-10.5,spyRet:1.25,alpha:i-11.75})),metrics:{},live:{asOf:A,status:'added-late',note:null},note:'Rejected-names ledger, PAPER ONLY.'},
          evaluation:{version:'eval-1',arms:{live:arm('Live v2.8 picks',1.5),paper:arm('v2.9 paper picks',-2.25),rejectedLive:arm('Rejected by a live rule',3.5),rejectedPaper:arm('Rejected by one paper test',-12.75)},
            simulated:{version:'sim-1',holdDays:30,arms:{paper:sa(4.56),live:sa(-7.89)},note:'Simulated from stored daily prices.'},note:'Raw per-name results.'}});})(),
      oddSector:Object.assign(clone(),{asOf:iso(now-36e5),status:'ok',sectors:{...paper.sectors,qualified:{...paper.sectors.qualified,'Space Mining':2}},ranked:{...paper.ranked,qualified:[{...paper.ranked.qualified[0],sector:'Space Mining'},...paper.ranked.qualified.slice(1).map(r=>({...r,sector:null}))]},batch:{...paper.batch,picks:[{sym:'QX',weightPct:30.4},{sym:'QY',weightPct:30.4}],cashPct:40}})
    };
    for(const [name,doc] of Object.entries(edge)){
      await paint(p,doc);await p.waitForTimeout(80);
      const t=(await p.locator('#apexpaper-app').innerText()).replace(/\s+/g,' ');
      assert.doesNotMatch(t,/undefined|NaN|\[object/,label+' '+name);
      if(name==='zero'){assert.match(t,/Paper picks 0/);assert.match(t,/No paper buys in this batch\./);assert.match(t,/Nothing qualified in this run\./);assert.match(t,/No qualified names by sector/);}
      if(name==='noReason'){assert.match(t,/reason not available/);assert.match(t,/ZZOFF reason not available · not in the listed rows/);}
      if(name==='stale'){assert.match(t,/STALE — last run/);assert.match(t,/Stale snapshot/);assert.match(t,/Not yet measured/);}
      if(name==='measured'){
        assert.match(t,/Results by arm/);assert.match(t,/Simulated portfolio/);assert.match(t,/Weekly cohorts/);assert.match(t,/Skipped/);assert.match(t,/Live names missing/);
        const rows='#apexpaper-app [data-apx-sec="rejected"] .apx-lrow';
        await p.locator('#apexpaper-app [data-apx-rejf] input[value="live-rej"]').check({force:true});await p.waitForTimeout(50);
        const vis=await p.$$eval(rows,rs=>rs.filter(r=>!r.hidden).map(r=>r.getAttribute('data-apx-grp')));
        assert.ok(vis.length>0&&vis.every(g=>g==='live-rej'),label+': live-rejects filter shows only live rejects');
        await p.selectOption('#apexpaper-app [data-apx-rejf] select[name="gate"]','live-rr');await p.waitForTimeout(50);
        const vis2=await p.$$eval(rows,rs=>rs.filter(r=>!r.hidden).map(r=>r.getAttribute('data-apx-gate')));
        assert.ok(vis2.length>0&&vis2.every(g=>g==='live-rr'),label+': rule filter');
        await p.locator('#apexpaper-app [data-apx-rejf] input[value="paper-rej"]').check({force:true});await p.waitForTimeout(50);
        assert.equal(await p.locator('#apexpaper-app [data-apx-lnomatch]').isVisible(),true,label+': no-match line when nothing fits');
        await p.locator('#apexpaper-app [data-apx-rejf] input[value="all"]').check({force:true});await p.selectOption('#apexpaper-app [data-apx-rejf] select[name="gate"]','');
        await p.evaluate(()=>document.querySelectorAll('#apexpaper-app [data-apx-sec="results"] details,#apexpaper-app [data-apx-sec="rejected"] details,#apexpaper-app [data-apx-sec="history"] details').forEach(d=>{d.open=true;}));
        await p.locator('#apexpaper-app [data-apx-sec="results"]').scrollIntoViewIfNeeded();
        await p.screenshot({path:`${shots}/apex-paper-${label}-results.png`});
      }
      if(name==='oddSector'){assert.match(t,/Space Mining 2 no screened count/);assert.match(t,/Source weights add to 100\.8% \(rounding in the file\); shown as published\./);assert.match(t,/Sector not recorded/);}
      await noOverflow(p,label+' '+name);
      if(two&&name==='zero')await p.screenshot({path:`${shots}/apex-paper-${label}-zero.png`});
    }
    assert.deepEqual(errors,[],label+': no page or console errors');
    await ctx.close();
  }
  assert.deepEqual(writes,[],'no non-GET requests');
  console.log('apex-paper-view-browser PASS');
}finally{await browser.close();}
