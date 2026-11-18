// v244: Apex v2.9 PAPER research view. Called from journey-browser.mjs (the CI suite); also runnable alone:
//   node tests/apex-paper-checks.mjs   (against tests/preview.mjs)
// Synthetic fixture only, fed by intercepting data/apex-paper-v29.json; the committed file is never read here.
// Nothing here submits an order; the suite asserts no non-GET requests.
import assert from 'node:assert/strict';
import fs from 'node:fs';

const VP=[[320,568,{}],[390,844,{}],[466,677,{right:84}],[677,466,{left:85}],[960,676,{right:100}]];
const SECTORS=['Technology','Healthcare','Energy','Industrials','Financial Services','Consumer Cyclical'];
const row=(sym,i,extra={})=>({sym,name:sym+' Holdings Corporation',sector:SECTORS[i%SECTORS.length],theme:SECTORS[i%SECTORS.length],setup:'ABC'[i%3],setupLabel:['breakout','pullback','reversal'][i%3],rank:i+1,
  composite:9-i*0.11,momentum:9.1,fundamental:7.4,rrScore:6,rr:2.05,last:1234.56+i,entry:1240.1+i,entryType:i%2?'limit':'buy-stop-limit',stop:1150.25+i,stopBasis:'50-day average',tp1:1420.75+i,tp1Basis:'3-month high',
  atr:31.2,rsi:58.3,rs3:14.2,rs6:41.8,relVol:1.31,revGrowthPct:27.5,pe:33.4,peType:'trailing',marketCapB:48.2,earningsDate:'2027-02-11',status:'buy',statusReason:'paper buy candidate for the next Monday batch (paper only; not an order)',
  fails:[],unlock:'joins the Monday paper batch if it still ranks',halfSize:false,why:'momentum 9.1, growth 28%, R/R 2.05',...extra});
export function paperFixture(now=Date.now(),extra={}){
  const iso=ms=>new Date(ms).toISOString();
  return {schema:1,paper:true,rulesVersion:'v2.9-paper-1',asOf:iso(now-36e5),status:'ok',statusNote:null,lastSuccessAsOf:iso(now-36e5),nextRun:iso(now+20*36e5),quoteBasis:'Synthetic quotes for the layout test',
    universe:{eligible:1555,scanned:1555,unique:1553,duplicatesRemoved:2,complete:true,coverageNote:'Synthetic: every batch returned every row.',batches:[{label:'batch-01',total:800,rows:800},{label:'batch-02',total:755,rows:755}],bySector:{Technology:257},filters:{minMarketCap:2e9,minAvgVolume:5e5,minPrice:10}},
    funnel:{setupMatches:{A:414,B:291,C:137,none:713},qualified:4,near:20,emerging:10,rejected:1521},
    rejections:[['no-setup','No setup (not a breakout, pullback or reversal)',713],['rr','Reward/risk under 1.5 at entry',623],['growth-neg','Revenue growth negative',218],['not-near-high','Breakout: too far below 3-month high',138],
      ['slope','Reversal: 50-day not rising',105],['rs3','Not ahead of SPY over 3 months',91],['pe','P/E over 100',69],['earnings','Earnings inside 3 trading days',53]].map(([key,label,count])=>({key,label,count})),
    ranked:{qualified:[row('QAAA',0),row('QBBB',1,{halfSize:true}),row('QCCC',2,{status:'blocked',statusReason:'sector limit (2 per sector)'}),row('QDDD',3,{status:'watch',statusReason:'earnings in 4 trading days',pe:null,revGrowthPct:null,earningsDate:null})],
      near:Array.from({length:20},(_,i)=>row('N'+String(i).padStart(3,'A'),i,{status:'close',statusReason:'one check short',fails:['Reward/risk 1.38 under 1.5 at entry'],unlock:'entry at or below $1,198.40 lifts reward/risk to 1.5'})),
      emerging:Array.from({length:10},(_,i)=>row('E'+String(i).padStart(3,'B'),i,{status:'watch',statusReason:'setup forming',fails:['Not at the 20-day yet','Relative volume under 1'],unlock:'a close above the 20-day on rising volume'}))},
    batch:{asOf:iso(now-36e5),indicative:true,note:'Indicative only: what the Monday paper batch would hold if it were picked from today’s list.',picks:[{sym:'QAAA',weightPct:15.5},{sym:'QBBB',weightPct:null},{sym:'QDDD',weightPct:16.2}],blocked:[{sym:'QCCC',reason:'sector limit (2 per sector)'}],techBatchPct:33.3,cashPct:40},
    sectors:{universe:{Technology:257,Healthcare:215,Energy:100,Industrials:210,'Financial Services':230,'Consumer Cyclical':180,'Communication Services':65},qualified:{Technology:1,Healthcare:1,Energy:1,Industrials:1},near:{Technology:8,Healthcare:6,Energy:6}},
    concentration:{techBatchPct:33.3,v28TechOutsideCorePct:76.3,note:'Tech share of this paper batch vs the 40% batch rule.'},
    v28:{asOf:iso(now-26*36e5),rulesVersion:'v2.8',universe:80,passed:17,actionable:['MSFT'],targets:{MSFT:20}},
    cohorts:[],marks:[],metrics:{},cohortNote:'No paper cohort yet. The first one is frozen on the next Monday run.',
    backtest:{status:'pending',asOf:null,note:'Synthetic backtest note.',rows:[]},
    notes:['PAPER ONLY. No ticket, alert, order or live rule reads this file.','Synthetic fixture for the layout test.'],sources:['Synthetic scanner batches'],...extra};
}

export async function runApexPaperChecks({browser,base,sample,stub,apex,writes=[],shots=null}){
  const errors=[];
  async function open({paper='fixture',seed={},viewport={width:390,height:844},hash=''}={}){
    const ctx=await browser.newContext({viewport,timezoneId:'America/New_York',serviceWorkers:'block'});
    const p=await ctx.newPage();const hits=[];
    p.on('pageerror',e=>errors.push(e.message));
    p.on('request',r=>{if(!['GET','HEAD'].includes(r.method()))writes.push(r.url());});
    await p.addInitScript(stub);
    await p.addInitScript(s=>{if(!sessionStorage.getItem('apx-init')){const d={pf_acct:'main',pf_experience_route:'today',...s};for(const[k,v]of Object.entries(d))localStorage.setItem(k,v);sessionStorage.setItem('apx-init','1');}},seed);
    await p.route('https://**/*',r=>r.request().url().startsWith(base)?r.continue():r.abort());
    await p.route(/\/data\.json(?:\?.*)?$/,r=>r.fulfill({json:sample}));
    await p.route(/\/data\/apex-targets\.json(?:\?.*)?$/,r=>r.fulfill({json:apex}));
    await p.route(/\/data\/apex-paper-v29\.json(?:\?.*)?$/,r=>{hits.push(r.request().url());
      if(paper==='missing')return r.fulfill({status:404,body:'Not found'});
      if(paper==='garbage')return r.fulfill({status:200,contentType:'application/json',body:'<html>not json'});
      if(paper==='array')return r.fulfill({json:[1,2,3]});
      return r.fulfill({json:paper==='fixture'?paperFixture():paper});});
    await p.goto(base+hash);await p.waitForFunction(()=>window.__SNAP&&window.PFJourney);await p.waitForTimeout(450);
    return {ctx,p,hits};
  }
  const settle=p=>p.waitForTimeout(350);
  const area=a=>`.ex-main [data-ex-area="${a}"]`, chip=r=>`#ex-subnav [data-ex-route="${r}"]`;
  const st=p=>p.evaluate(()=>({route:PFExperience.route,account:PFExperience.account}));
  const chips=p=>p.evaluate(()=>[...document.querySelectorAll('#ex-subnav button')].map(b=>b.textContent.trim()));
  const pageText=async p=>(await p.locator('#apexpaper-app').innerText()).replace(/\s+/g,' ');
  const paint=(p,doc,err=null)=>p.evaluate(({doc,err})=>{window.__APEX_PAPER=doc;window.__APEX_PAPER_ERR=err;window.__apexPaperPaint();},{doc,err});
  const overflow=p=>p.evaluate(()=>{const w=document.documentElement.clientWidth,bad=[];
    for(const e of document.querySelectorAll('#apexpaper-app .apx-head,#apexpaper-app .apx-tile,#apexpaper-app .apx-card,#apexpaper-app .apx-row>summary,#apexpaper-app .apx-levels>div,#apexpaper-app .apx-kv>div,#apexpaper-app .apx-chip,#apexpaper-app .apx-table,#apexpaper-app .apx-bar,[data-apex-paper-link]')){
      const r=e.getBoundingClientRect();if(r.width&&(r.right>w+1||r.left<-1))bad.push((e.className||e.tagName)+':'+Math.round(r.left)+'-'+Math.round(r.right));}
    const clipped=[...document.querySelectorAll('#apexpaper-app .apx-levels b,#apexpaper-app .apx-tile b,#apexpaper-app .apx-sym,#apexpaper-app .apx-score')].filter(e=>e.offsetParent&&e.scrollWidth>e.clientWidth+1).map(e=>e.textContent);
    window.scrollTo(400,scrollY);const sx=scrollX;window.scrollTo(0,scrollY);
    return {sw:document.documentElement.scrollWidth,iw:innerWidth,bad:bad.slice(0,6),clipped:clipped.slice(0,6),sx};});

  // ── 1. Reachable from Apex > Overview ("v2.9 Paper research" row) and the pointer under the live Apex card; no fifth tab (v245 workspace); never under Agentic; Apex always reopens a live page ──
  {
    const {ctx,p,hits}=await open();
    await p.locator(area('apex')).click();await settle(p);
    assert.deepEqual(await chips(p),['Overview','Positions','Research','Actions'],'four Apex tabs, no paper tab');
    await p.locator(chip('accounts')).click();await settle(p);
    await p.locator('.ws-row[data-ex-route="apexpaper"]').click();await settle(p);
    assert.deepEqual(await st(p),{route:'apexpaper',account:'main'});
    assert.equal(await p.locator('#page-apexpaper').isVisible(),true,'paper page visible');
    assert.equal(await p.locator('#picks-app').isVisible(),false,'the live plan is not on the paper page');
    assert.equal(await p.locator('#apexpaper-app [data-apex-confirm], #apexpaper-app a[href*="claude.ai"], #apexpaper-app button').count(),0,'no confirm, link-out or button on the paper page');
    assert.deepEqual(await p.evaluate(()=>[...document.querySelectorAll('.ex-main [aria-current="page"][data-ex-area]')].map(b=>b.dataset.exArea)),['apex'],'Apex stays highlighted on the paper page');
    assert.match(await p.locator('#ex-context').innerText(),/^Apex v2\.9 · paper research · not live$/);
    assert.equal(await p.locator('#ex-account-label').isVisible(),false,'no account picker on an Apex-only page');
    assert.match(p.url(),/#view=apexpaper$/,'route-only hash');
    const t=await pageText(p);
    assert.match(t,/Apex v2\.9 · PAPER RESEARCH — not live/);assert.match(t,/v2\.9-paper-1/);assert.match(t,/Updated .* ET/);assert.match(t,/Next paper run .* ET/);
    assert.equal(await p.locator('#apexpaper-app .apx').getAttribute('data-apx-state'),'fresh');
    assert.deepEqual(await p.locator('#apexpaper-app .apx-tile b').allInnerTexts(),['1,555','1,555','4','20'],'tiles: eligible, scanned, qualified, near');
    assert.match(t,/complete · 1,553 unique/);
    assert.equal(await p.locator('#apexpaper-app [data-apx-rej]').count(),8,'eight rejection bars');
    assert.match(t,/A breakout 414/);assert.match(t,/None 713/);
    assert.match(t,/LIVE/);assert.match(t,/PAPER/);assert.match(t,/sized Monday/);assert.match(t,/rule: at most 40%/);assert.match(t,/No paper cohort yet/);
    assert.match(t,/Hypothetical and in-sample on today’s names \(survivorship bias\)\. Not proven out-of-sample\./);
    assert.equal(hits.length,1,'the file is fetched once');
    // refresh keeps the route; Back returns to the plan
    await p.reload();await p.waitForFunction(()=>window.__SNAP&&window.PFJourney);await settle(p);
    assert.deepEqual(await st(p),{route:'apexpaper',account:'main'},'refresh keeps the paper route');
    assert.equal(await p.locator('#apexpaper-app .apx').getAttribute('data-apx-state'),'fresh','renders after a reload');
    // Agentic never shows it
    await p.locator(area('agentic')).click();await settle(p);
    assert.deepEqual(await chips(p),['Overview','Positions','Research','Actions'],'four Agentic tabs');
    assert.equal(await p.locator('.ws-row[data-ex-route="apexpaper"]').count(),0,'no paper row under Agentic');
    assert.equal(await p.locator('#page-apexpaper').isVisible(),false);
    assert.equal(await p.locator('#plan-agentic-app [data-apex-paper-link], #agentic-app [data-apex-paper-link]').count(),0,'no paper pointer on any agentic page');
    // Apex reopens Plan, not the paper page, even though the paper page was the last Apex page opened
    await p.locator(area('apex')).click();await settle(p);
    assert.deepEqual(await st(p),{route:'accounts',account:'main'},'Apex reopens a live page (its last live tab, Overview), never the paper page');
    await p.locator(chip('accounts')).click();await settle(p);await p.locator('.ws-row[data-ex-route="apexpaper"]').click();await settle(p);await p.goBack();await settle(p);
    assert.deepEqual(await st(p),{route:'accounts',account:'main'},'Back from the paper page returns to Overview');
    await ctx.close();
  }
  // A deep link while the agentic account is selected lands in Apex on the self-directed account.
  {
    const {ctx,p}=await open({seed:{pf_acct:'agentic'},hash:'#view=apexpaper'});
    assert.deepEqual(await st(p),{route:'apexpaper',account:'main'});
    assert.deepEqual(await p.evaluate(()=>[...document.querySelectorAll('.ex-main [data-ex-area]')].filter(b=>b.getAttribute('aria-current')==='page').map(b=>b.dataset.exArea)),['apex']);
    await p.locator(chip('plan')).click();await settle(p);
    assert.equal(await p.locator('#picks-app').isVisible(),true,'its Plan chip opens the Apex plan');assert.equal(await p.locator('#plan-agentic-app').isVisible(),false);
    await ctx.close();
  }

  // ── 2. Pointer row under the Apex card; the live card, its rules and Confirm are identical with and without the paper file ──
  {
    const {ctx,p}=await open();
    await p.locator(area('apex')).click();await settle(p);await p.locator('#ex-subnav [data-ws-tab="research"]').click();await settle(p);   // v253: the pointer is on the Research tab
    const link=p.locator('#picks-app [data-apex-paper-link]');
    assert.equal(await link.count(),1,'one pointer row');
    assert.match(await link.locator('[data-apx-pointer]').innerText(),/^🧪 v2\.9 paper research: 4 qualified of 1,555 scanned · updated .* ET →$/);
    assert.equal(await p.evaluate(()=>{const c=document.getElementById('apex-content').closest('.card'),l=document.querySelector('[data-apex-paper-link]');return c.nextElementSibling===l&&!c.contains(l);}),true,'the row sits directly under the Apex card, outside it');
    const live=await p.evaluate(()=>{
      // renderApexCard hands Apex.rules its inputs and Apex.render the same state/out/cfg; bookLines is recomputed from those.
      const rec=[],keep={rules:Apex.rules,render:Apex.render};
      const wrap=k=>function(...a){const out=keep[k].apply(this,a);
        if(k==='rules')rec.push('rules:'+JSON.stringify(out));
        else rec.push('bookLines:'+JSON.stringify(Apex.bookLines(a[1],a[2],a[3])),'cfg:'+JSON.stringify(a[3]),'research:'+JSON.stringify(a[4]||null));
        return out;};
      const snap=()=>{rec.length=0;renderApexCard(window.__SNAP);const el=document.getElementById('apex-content');
        return {html:el.innerHTML,calls:rec.slice(),confirm:el.querySelectorAll('[data-apex-confirm]').length,href:el.querySelector('a[href^="https://claude.ai/new?q="]')?.href||''};};
      for(const k of Object.keys(keep))Apex[k]=wrap(k);
      const realNow=Date.now,fixed=realNow.call(Date);Date.now=()=>fixed; // the card stamps quote age in minutes; hold the clock so only the paper document differs
      const doc=window.__APEX_PAPER;const withDoc=snap();
      window.__APEX_PAPER=undefined;window.__APEX_PAPER_REQ=1;const without=snap();
      window.__APEX_PAPER=null;window.__APEX_PAPER_ERR='gone';const missing=snap();
      window.__APEX_PAPER=doc;window.__APEX_PAPER_ERR=null;Object.assign(Apex,keep);Date.now=realNow;
      return {hadDoc:!!(doc&&doc.paper),withDoc,without,missing};});
    assert.equal(live.hadDoc,true,'the paper document was loaded for this comparison');
    assert.ok(live.withDoc.calls.some(c=>c.startsWith('rules:')),'Apex.rules ran');assert.ok(live.withDoc.calls.some(c=>c.startsWith('bookLines:')),'Apex.bookLines ran');
    assert.deepEqual(live.withDoc.calls,live.without.calls,'Apex.rules output, bookLines, cfg and research rows identical with and without the paper document');
    assert.deepEqual(live.withDoc.calls,live.missing.calls,'and with the paper document missing');
    assert.equal(live.withDoc.html,live.without.html,'the Apex card markup is identical');assert.equal(live.withDoc.html,live.missing.html);
    assert.equal(live.withDoc.confirm,live.without.confirm,'Confirm unchanged');assert.equal(live.withDoc.href,live.without.href,'Confirm prompt unchanged');
    assert.doesNotMatch(live.withDoc.html+live.withDoc.href,/QAAA|QBBB|paper research|v2\.9-paper/,'no paper name or wording inside the live card or its prompt');
    // privacy on: the pointer is not account data and stays readable
    await p.evaluate(()=>setPrivacy(true));await settle(p);
    assert.match(await link.locator('[data-apx-pointer]').innerText(),/4 qualified of 1,555 scanned/);
    await p.evaluate(()=>setPrivacy(false));
    await link.locator('[data-apx-pointer]').click();await settle(p);
    assert.deepEqual(await st(p),{route:'apexpaper',account:'main'},'the pointer opens the paper page');

    // ── 3. Rows: one line each, expand to entry → target · stop and the detail; Near and Emerging start folded ──
    assert.equal(await p.locator('#apexpaper-app [data-apx-list="qualified"] > .apx-row').count(),4,'four qualified rows, all listed');
    assert.equal(await p.locator('#apexpaper-app details[data-apx-key="near"] .apx-row').count(),20);assert.equal(await p.locator('#apexpaper-app details[data-apx-key="emerging"] .apx-row').count(),10);
    assert.equal(await p.locator('#apexpaper-app details[data-apx-key="near"]').evaluate(e=>e.open),false,'Near starts folded');
    assert.equal(await p.locator('#apexpaper-app details[data-apx-key="emerging"]').evaluate(e=>e.open),false,'Emerging starts folded');
    assert.equal(await p.locator('#apexpaper-app details[open]').count(),0,'every note and row starts closed');
    const first=p.locator('#apexpaper-app .apx-row[data-apx-row="QAAA"]');
    assert.match((await first.locator('summary').innerText()).replace(/\s+/g,' '),/^1 QAAA A breakout 9\.0 Buy \(paper\)$/);
    assert.ok((await first.locator('summary').boundingBox()).height<=52,'a collapsed row is one line');
    assert.equal(await first.locator('.apx-levels').isVisible(),false);
    await first.locator('summary').click();
    assert.equal(await first.locator('.apx-levels').isVisible(),true,'row expands');
    const lv=(await first.locator('.apx-levels').innerText()).replace(/\s+/g,' ');
    assert.match(lv,/ENTRY \$1,240\.10 TARGET \$1,420\.75 STOP \$1,150\.25 R\/R 2\.05×/i,'entry, target, stop and R/R are visible');
    const body=await first.locator('.apx-row-body').innerText();
    for(const want of [/QAAA Holdings Corporation/,/Technology/,/Entry: buy-stop-limit/,/Last\s+\$1,234\.56/,/Momentum\s+9\.1/,/Fundamental\s+7\.4/,/R\/R score\s+6\.0/,/RS vs SPY 3m\s+\+14\.2%/,/RS vs SPY 6m\s+\+41\.8%/,/RSI\s+58/,/ATR\s+\$31\.20/,/Rel\. volume\s+1\.31×/,/Rev\. growth\s+\+28%/,/P\/E \(trailing\)\s+33\.4/,/Earnings\s+2027-02-11/,/paper buy candidate/,/Unlocks if:/])assert.match(body,want);
    await p.locator('#apexpaper-app .apx-row[data-apx-row="QBBB"] summary').click();assert.match(await p.locator('#apexpaper-app .apx-row[data-apx-row="QBBB"] .apx-row-body').innerText(),/Half size/);
    await p.locator('#apexpaper-app .apx-row[data-apx-row="QDDD"] summary').click();
    assert.match(await p.locator('#apexpaper-app .apx-row[data-apx-row="QDDD"] .apx-row-body').innerText(),/Rev\. growth\s+—[\s\S]*P\/E \(trailing\)\s+—[\s\S]*Earnings\s+—/,'missing numbers are dashes');
    await p.locator('#apexpaper-app details[data-apx-key="near"] > summary').click();
    await p.locator('#apexpaper-app details[data-apx-key="near"] .apx-row').first().locator('summary').click();
    assert.match(await p.locator('#apexpaper-app details[data-apx-key="near"] .apx-row').first().innerText(),/Fails:[\s\S]*Reward\/risk 1\.38 under 1\.5/);
    // market prices are not account data: privacy mode leaves them readable; a repaint keeps what was opened
    await p.evaluate(()=>setPrivacy(true));await settle(p);
    assert.match(await first.locator('.apx-levels').innerText(),/\$1,240\.10/,'prices are not privacy-masked');
    await p.evaluate(()=>{setPrivacy(false);window.__apexPaperPaint();});
    assert.equal(await first.evaluate(e=>e.open),true,'a repaint keeps an opened row open');
    assert.equal(await p.locator('#apexpaper-app details[data-apx-key="near"]').evaluate(e=>e.open),true);

    // ── 4. Explicit states: failed (with last success, never "Updated"), stale, partial ──
    const now=Date.now(),iso=ms=>new Date(ms).toISOString();
    await paint(p,paperFixture(now,{status:'failed',statusNote:'scanner returned 3 of 12 batches',asOf:iso(now-2*36e5),lastSuccessAsOf:iso(now-26*36e5)}));
    let t=await pageText(p);
    assert.equal(await p.locator('#apexpaper-app .apx').getAttribute('data-apx-state'),'failed');
    assert.match(t,/Last run FAILED · /);assert.match(t,/Last successful run /);assert.match(t,/scanner returned 3 of 12 batches/);assert.doesNotMatch(t,/Updated /);
    assert.match(await p.locator('#apexpaper-app .apx-freshchip').getAttribute('class'),/apx-bad/);
    await paint(p,paperFixture(now,{asOf:iso(now-9*864e5),lastSuccessAsOf:iso(now-9*864e5)}));
    t=await pageText(p);
    assert.equal(await p.locator('#apexpaper-app .apx').getAttribute('data-apx-state'),'stale');assert.match(t,/STALE — last run /);assert.doesNotMatch(t,/Updated /);
    assert.match(await p.locator('#apexpaper-app .apx-freshchip').getAttribute('class'),/apx-warn/);
    await paint(p,paperFixture(now,{status:'partial',statusNote:'9 of 12 batches returned',universe:{eligible:1555,scanned:1100,unique:1100,complete:false}}));
    t=await pageText(p);
    assert.equal(await p.locator('#apexpaper-app .apx').getAttribute('data-apx-state'),'partial');assert.match(t,/Partial coverage/);assert.match(t,/9 of 12 batches returned/);assert.match(t,/partial · 1,100 unique/);
    await p.locator(area('apex')).click();await settle(p);await p.locator('#ex-subnav [data-ws-tab="research"]').click();await settle(p);
    assert.match(await p.locator('[data-apx-pointer]').innerText(),/4 qualified of 1,100 scanned · partial coverage/,'the pointer names partial coverage');
    await paint(p,paperFixture(now,{asOf:iso(now-9*864e5)}));
    assert.match(await p.locator('[data-apx-pointer]').innerText(),/STALE — last run /,'the pointer says stale');
    await paint(p,paperFixture(now,{status:'failed',lastSuccessAsOf:null}));
    assert.match(await p.locator('[data-apx-pointer]').innerText(),/Last run FAILED .* no successful run recorded/i,'the pointer says failed');
    await ctx.close();
  }
  // Missing / unreadable file: an explicit line on the page and on the pointer, never a spinner.
  for(const [paper,state,words] of [['missing','missing',/Research file missing[\s\S]*HTTP 404/],['garbage','unreadable',/Research file unreadable[\s\S]*not valid JSON/],['array','unreadable',/Research file unreadable[\s\S]*not a JSON object/]]){
    const {ctx,p}=await open({paper});
    await p.locator(area('apex')).click();await settle(p);await p.locator('#ex-subnav [data-ws-tab="research"]').click();await settle(p); // v253: the pointer sits under the Apex card on the Research tab
    assert.match(await p.locator('[data-apx-pointer]').innerText(),state==='missing'?/file missing — nothing to show yet/:/file unreadable — nothing to show yet/,paper+': pointer');
    assert.equal(await p.locator('#apex-content [data-apex-confirm], #apex-content [data-apex-lev]').count()>0,true,paper+': the live Apex card still renders');
    await p.locator('[data-apx-pointer]').click();await settle(p);
    assert.equal(await p.locator('#apexpaper-app .apx').getAttribute('data-apx-state'),state,paper+': state');
    assert.match(await pageText(p),words,paper+': reason shown');
    assert.equal(await p.locator('#apexpaper-app .spinner, #apexpaper-app .loading-wrap, #apexpaper-app .spin-sm').count(),0,paper+': no spinner');
    assert.equal(await p.locator('#apexpaper-app .apx-tile, #apexpaper-app .apx-row').count(),0,paper+': no figures are invented');
    const o=await overflow(p);assert.ok(o.sw<=o.iw,paper+': no overflow');
    await ctx.close();
  }

  // ── 5. Layout: no sideways overflow at the five viewports, Light and Dark, folded and with everything opened ──
  for(const [w,h,inset] of VP)for(const theme of ['light','dark']){
    const {ctx,p}=await open({viewport:{width:w,height:h},seed:{pf_experience_route:'apexpaper'}});
    if(Object.keys(inset).length){const c=await ctx.newCDPSession(p);await c.send('Emulation.setSafeAreaInsetsOverride',{insets:{top:0,bottom:0,right:inset.right||0,left:inset.left||0}});}
    await p.evaluate(t=>PFTheme.set(t),theme);await settle(p);
    const label=`${w}x${h} ${theme}`;
    for(const mode of ['folded','open']){
      if(mode==='open')await p.evaluate(()=>document.querySelectorAll('#apexpaper-app details').forEach(d=>{d.open=true;}));
      const o=await overflow(p);
      assert.ok(o.sw<=o.iw,`${label} ${mode}: scrollWidth ${o.sw} > ${o.iw}`);assert.equal(o.sx,0,`${label} ${mode}: page cannot be dragged sideways`);
      assert.deepEqual(o.bad,[],`${label} ${mode}: element outside the viewport`);assert.deepEqual(o.clipped,[],`${label} ${mode}: clipped figure`);
    }
    const cols=await p.evaluate(()=>{const l=document.querySelector('#apexpaper-app [data-apx-sec="ranked"]').getBoundingClientRect(),de=document.querySelector('#apexpaper-app [data-apx-sec="detail"]'),r=de&&de.offsetParent?de.getBoundingClientRect():null;return {two:!!r&&r.left>=l.right-1,lw:l.width,rw:r?r.width:0,bg:getComputedStyle(document.body).backgroundColor,html:getComputedStyle(document.documentElement).backgroundColor};});
    if(w>=740){assert.equal(cols.two,true,label+': v246 (#235) candidate list left, selected stock right');assert.ok(cols.lw>=200&&cols.rw>=200,label+': both panes usable');}
    else assert.equal(cols.two,false,label+': single column');
    assert.equal(cols.bg,cols.html,label+': page and overscroll background match');
    if(shots&&theme==='light'){fs.mkdirSync(shots,{recursive:true});await p.evaluate(()=>{document.querySelectorAll('#apexpaper-app details').forEach(d=>{d.open=false;});scrollTo(0,0);});await p.screenshot({path:`${shots}/apex-paper-${w}x${h}.png`});}
    await ctx.close();
  }
  assert.deepEqual(errors,[],'no page errors in the Apex paper checks');
}

if(import.meta.url===`file://${process.argv[1]}`){
  const {chromium}=await import(process.env.PF_PLAYWRIGHT||'playwright');
  const base=(process.env.PF_PREVIEW_URL||'http://127.0.0.1:8767/').replace(/\/?$/,'/');
  const sample=JSON.parse(fs.readFileSync('tmp/experience-preview/sample.json','utf8'));
  const stub=fs.readFileSync('producer/privacy-audit.mjs','utf8').match(/const CHART_STUB = `([\s\S]*?)`;/)[1];
  const apex={asOf:new Date().toISOString(),targets:{MSFT:20},top5:[{sym:'MSFT',composite:8,why:'Synthetic entry research',limit:420,trigger:420,stop:380,tp1:500,orderType:'limit',tradable:true}],heldLevels:[{sym:'AAPL',stop:170,tp1:230,why:'Synthetic held-name evidence'}]};
  const browser=await chromium.launch({...(process.env.PF_CHROME?{executablePath:process.env.PF_CHROME}:{}),args:['--no-sandbox','--disable-dev-shm-usage']});
  const writes=[];
  try{await runApexPaperChecks({browser,base,sample,stub,apex,writes,shots:process.env.PF_SCREENSHOT_DIR||null});assert.deepEqual(writes,[]);console.log('apex-paper-checks PASS');}finally{await browser.close();}
}
