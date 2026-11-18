// v252 — Analyze reads ONE account's book: the account in context, never the other one.
// Jack, Nov 18 2026: Research > Analyze with Account = Agentic listed the self-directed holdings.
// Called from journey-browser.mjs; also runnable alone: node tests/analyze-account-checks.mjs
// All account data are synthetic. Nothing here submits an order.
import assert from 'node:assert/strict';
import fs from 'node:fs';

export async function runAnalyzeAccountChecks({browser,base,sample,stub,apex,writes=[]}){
  const errors=[];
  const mainSyms=sample.main?sample.main.positions.filter(p=>p.qty>0).map(p=>p.symbol):null;
  const agSyms=sample.agentic.positions.filter(p=>+p.qty>0).map(p=>p.symbol);
  const ctx=await browser.newContext({viewport:{width:390,height:844},timezoneId:'America/New_York',serviceWorkers:'block'});
  const p=await ctx.newPage();
  p.on('pageerror',e=>errors.push(e.message));
  p.on('request',r=>{if(!['GET','HEAD'].includes(r.method()))writes.push(r.url());});
  await p.addInitScript(stub);
  await p.addInitScript(()=>{if(!sessionStorage.getItem('aza-init')){localStorage.setItem('pf_acct','agentic');localStorage.setItem('pf_experience_route','today');localStorage.removeItem('pf_az_last');sessionStorage.setItem('aza-init','1');}});
  await p.route('https://**/*',r=>r.request().url().startsWith(base)?r.continue():r.abort());
  await p.route(/\/data\.json(?:\?.*)?$/,r=>r.fulfill({json:sample}));
  await p.route(/\/data\/apex-targets\.json(?:\?.*)?$/,r=>r.fulfill({json:apex}));
  await p.goto(base);await p.waitForFunction(()=>window.__SNAP&&window.PFJourney&&window.__PORT&&window.__PORT.enriched);
  const settle=()=>p.waitForTimeout(500);
  const held=await p.evaluate(()=>({main:window.__PORT.enriched.filter(x=>x.val>0).map(x=>x.symbol),ag:(window.agenticEnriched()||[]).map(x=>x.symbol)}));
  const M=mainSyms||held.main, A=agSyms;
  const onlyMain=held.main.filter(s=>!held.ag.includes(s)), onlyAg=held.ag.filter(s=>!held.main.includes(s)), both=held.main.filter(s=>held.ag.includes(s));
  assert.ok(onlyMain.length&&onlyAg.length,'the fixture needs a holding unique to each account');
  assert.deepEqual([...held.ag].sort(),[...A].sort(),'agentic rows come from the agentic snapshot block');
  const shell=()=>p.evaluate(()=>{const a=document.getElementById('analyze-app');const c=a.querySelector('[data-az-chips-for]');
    return {acct:(a.querySelector('[data-az-acct]')||{}).dataset?.azAcct,forAcct:c?c.dataset.azChipsFor:null,label:c?c.textContent.trim():'',chips:[...a.querySelectorAll('.card[data-az-acct] .az-chip')].map(x=>x.textContent.trim()),
      scan:window.azScanSyms?[...window.azScanSyms()]:null,book:window.azBook().enriched.map(x=>x.symbol),notice:(document.querySelector('[data-pj-az-scope]')||{}).textContent||''};});
  const pos=()=>p.evaluate(()=>{const b=document.querySelector('#az-result [data-az-pos-acct]');return b?{acct:b.dataset.azPosAcct,text:b.textContent.trim(),card:b.closest('.card').textContent}:null;});
  const run=async s=>{await p.evaluate(s=>window.runAnalysis(s),s);await settle();};
  const fmtQty=q=>q<10?q.toFixed(2):q.toLocaleString('en-US',{maximumFractionDigits:0});
  const qtyOf=async(acct,sym)=>p.evaluate(({acct,sym})=>{const r=acct==='agentic'?window.agenticEnriched():window.__PORT.enriched;return r.find(x=>x.symbol===sym).qty;},{acct,sym});

  // 1 · Research > Analyze with the account set to Agentic (the reported screen).
  await p.evaluate(()=>PFExperience.navigate('analyze',{account:'agentic'}));await settle();
  let s=await shell();
  assert.equal(s.acct,'agentic');assert.equal(s.forAcct,'agentic');assert.match(s.label,/Agentic/);
  assert.ok(s.chips.length>0,'agentic holdings are offered');
  for(const c of s.chips)assert.ok(held.ag.includes(c),`chip ${c} is not an agentic holding`);
  for(const m of onlyMain)assert.ok(!s.chips.includes(m),`self-directed-only ${m} listed under Agentic`);
  assert.deepEqual([...s.book].sort(),[...held.ag].sort());
  if(s.scan)for(const m of onlyMain)assert.ok(!s.scan.includes(m)||false===held.main.includes(m)||(await p.evaluate(m=>[...(typeof PICK_PICKS!=='undefined'?PICK_PICKS:[]),...(typeof PICK_CANDIDATES!=='undefined'?PICK_CANDIDATES:[])].some(x=>x&&x.ticker===m),m)),`pattern scan lists self-directed-only ${m} under Agentic`);
  assert.match(s.notice,/Agentic positions only/);
  // A self-directed-only name has NO position card under Agentic; an agentic-only name has one.
  await run(onlyMain[0]);assert.equal(await pos(),null,`${onlyMain[0]} shows a position card under Agentic`);
  await run(onlyAg[0]);let c=await pos();assert.ok(c,'an agentic holding shows its position');assert.equal(c.acct,'agentic');assert.equal(c.text,'Agentic');
  assert.ok(c.card.includes(fmtQty(await qtyOf('agentic',onlyAg[0]))),'the shares shown are the agentic lot');
  // Overlap-with-your-book rows name only this account's holdings.
  const corrAg=await p.evaluate(s=>{const r=window._bookCorrAll?window._bookCorrAll(s):null;return r&&r.all?r.all.map(x=>x.sym):Array.isArray(r)?r.map(x=>x.sym):null;},onlyAg[0]);
  if(corrAg)for(const x of corrAg)assert.ok(held.ag.includes(x),`overlap row ${x} is not an agentic holding`);

  // 2 · Switch the account on the same screen: the shell and the open ticker follow it.
  await p.evaluate(()=>PFExperience.navigate('analyze',{account:'main'}));await settle();
  s=await shell();
  assert.equal(s.acct,'main');assert.match(s.label,/Apex/);
  for(const x of s.chips)assert.ok(held.main.includes(x),`chip ${x} is not a self-directed holding`);
  for(const a of onlyAg)assert.ok(!s.chips.includes(a),`agentic-only ${a} listed under Apex`);
  assert.match(s.notice,/Self-directed positions only/);
  assert.equal(await pos(),null,`${onlyAg[0]} (agentic only) still shows a position after switching to Apex`);
  await run(onlyMain[0]);c=await pos();assert.ok(c);assert.equal(c.acct,'main');assert.equal(c.text,'Apex');

  // 3 · A name held in BOTH accounts shows each account's own lot.
  if(both.length){
    const qm=await qtyOf('main',both[0]), qa=await qtyOf('agentic',both[0]);
    await run(both[0]);c=await pos();assert.ok(c.card.includes(fmtQty(qm)));
    await p.evaluate(()=>PFExperience.navigate('analyze',{account:'agentic'}));await settle();
    c=await pos();assert.ok(c,'the open ticker is redrawn for the new account');assert.equal(c.acct,'agentic');assert.ok(c.card.includes(fmtQty(qa)));
    if(fmtQty(qm)!==fmtQty(qa))assert.ok(!c.card.includes('Shares'+fmtQty(qm)),'the self-directed lot is not shown under Agentic');
  }

  // 4 · Analyze opened from each workspace's Research tab keeps that workspace's account.
  for(const acct of ['agentic','main']){
    await p.evaluate(a=>PFExperience.navigate('accounts',{account:a}),acct);await settle();
    await p.locator('#ex-subnav [data-ws-tab="research"]').click();await settle();
    let st=await p.evaluate(()=>({route:PFExperience.route,account:PFExperience.account}));
    assert.equal(st.route,'acctresearch');assert.equal(st.account,acct);   // v253: the account's own research page
    await p.locator('#ws-analyze [data-pj-go="analyze"]').click();await settle();
    st=await p.evaluate(()=>({route:PFExperience.route,account:PFExperience.account}));
    assert.equal(st.route,'analyze');assert.equal(st.account,acct);
    s=await shell();assert.equal(s.acct,acct,`workspace Research (${acct}) opened Analyze for ${s.acct}`);
    const own=acct==='agentic'?held.ag:held.main;for(const x of s.chips)assert.ok(own.includes(x),`${x} is not a ${acct} holding`);
  }

  // 5 · Privacy mode still hides the lot on the account-scoped card.
  await p.evaluate(()=>PFExperience.navigate('analyze',{account:'agentic'}));await settle();await run(onlyAg[0]);
  await p.evaluate(()=>{if(!document.body.classList.contains('pf-private'))(window.togglePrivacy||function(){})();});await settle();
  const priv=await p.evaluate(()=>({on:document.body.classList.contains('pf-private'),card:(document.querySelector('#az-result [data-az-pos-acct]')||{closest(){return{textContent:''}}}).closest('.card').textContent}));
  if(priv.on)assert.ok(!/\$\d/.test(priv.card),'a dollar figure is readable on the position card in private mode');
  await p.evaluate(()=>{if(document.body.classList.contains('pf-private'))(window.togglePrivacy||function(){})();});

  assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth-innerWidth),0,'Analyze drifts sideways at 390px');
  assert.deepEqual(errors,[]);
  await ctx.close();
}

if(import.meta.url===`file://${process.argv[1]}`){
  const {chromium}=await import(process.env.PF_PLAYWRIGHT||'playwright');
  const base=(process.env.PF_PREVIEW_URL||'http://127.0.0.1:8767/').replace(/\/?$/,'/');
  const sample=JSON.parse(fs.readFileSync('tmp/experience-preview/sample.json','utf8'));
  const stub=fs.readFileSync('producer/privacy-audit.mjs','utf8').match(/const CHART_STUB = `([\s\S]*?)`;/)[1];
  const apex={asOf:new Date().toISOString(),targets:{MSFT:20},top5:[{sym:'MSFT',composite:8,why:'Synthetic entry research',limit:420,trigger:420,stop:380,tp1:500,orderType:'limit',tradable:true}]};
  const browser=await chromium.launch({...(process.env.PF_CHROME?{executablePath:process.env.PF_CHROME}:{}),args:['--no-sandbox','--disable-dev-shm-usage']});
  const writes=[];
  try{await runAnalyzeAccountChecks({browser,base,sample,stub,apex,writes});assert.deepEqual(writes,[]);console.log('analyze-account-checks PASS');}finally{await browser.close();}
}
