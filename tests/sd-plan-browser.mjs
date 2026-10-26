// Start tests/preview.mjs first. All account values and stock inputs below are
// synthetic. PF_PLAYWRIGHT / PF_CHROME select an existing local browser.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const {chromium}=await import(process.env.PF_PLAYWRIGHT||'playwright');
const source=fs.readFileSync(path.join(root,'producer/privacy-audit.mjs'),'utf8');
const stub=source.match(/const CHART_STUB = `([\s\S]*?)`;/)[1];
const browser=await chromium.launch({...(process.env.PF_CHROME?{executablePath:process.env.PF_CHROME}:{}),args:['--no-sandbox','--disable-dev-shm-usage']});
try {
  const page=await browser.newPage({viewport:{width:390,height:844},timezoneId:'America/New_York'});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(stub);
  await page.addInitScript(()=>{localStorage.setItem('pf_acct','main');localStorage.setItem('pf_experience_route','today');});
  await page.route('https://**/*',r=>r.abort());
  await page.goto(process.env.PF_PREVIEW_URL||'http://127.0.0.1:8767');
  await page.waitForFunction(()=>window.__SNAP&&document.querySelector('#ex-combined-equity')?.textContent.includes('$'));
  await page.locator('#page-ex-today [data-ex-route="plan"][data-ex-account="main"]').first().click();
  await page.waitForFunction(()=>getComputedStyle(document.querySelector('#picks-app')).display!=='none');
  const actualRange=await page.evaluate(()=>{
    // The shared sample has deliberately old historical dates. Give this
    // pipeline check its own fresh, synthetic history instead of bypassing age.
    window.__DATA.generatedAt='2030-01-15T15:00:00Z';
    const end=Date.parse('2030-01-15T00:00:00Z');
    const bars=Array.from({length:160},(_,i)=>({t:new Date(end-(159-i)*864e5).toISOString(),c:80+i/8+Math.sin(i)*3}));
    window.__DATA.hist.day.MSFT=bars;
    window.__DATA.hist.day.SPY=bars.map(b=>({...b,c:b.c/2}));
    window.__DATA.quotes.MSFT={last_trade_price:'100'};
    const m=sdMomentum('MSFT');
    return m&&m.range20!=null?{got:m.range20,want:SDRules.closeRange(bars.map(b=>b.c),20)}:null;
  });
  assert.ok(actualRange,'synthetic preview exercises the real momentum pipeline');
  assert.equal(actualRange.got,actualRange.want,'observed price range reaches the consumer');
  const render=async(mode)=>page.evaluate(mode=>{
    const m={sym:'MSFT',px:100,score:8,rank:8,tier:'core',fromHi20:-10,vol:20,atr:2,s50:90,s100:85,range20:12,theme:'megacap-software'};
    if(mode==='weak')m.score=m.rank=4.9;
    if(mode==='extended'){m.score=m.rank=9.5;m.fromHi20=0;}
    if(mode==='no-target')delete m.range20;
    window.sdMomentum=sym=>sym==='MSFT'?m:{sym,score:null,reason:'not in synthetic fixture'};
    window.__DATA.generatedAt='2030-01-15T15:00:00Z';
    window.__DATA.agentic.recentLosses=mode==='wash'?[{sym:'MSFT',date:'2030-01-14',realized:-100,account:'main'}]:[];
    window.__DATA.options={positions:[],orders:[]};
    window.__SNAP.stats={totalVal:10000,cashVal:mode==='unfunded'?-8000:1000,bpVal:1000};
    renderActionPlan([],[],10000,null,{},mode==='no-target'?{}:{MSFT:{AnalystTargetPrice:130}},{},{});
  },mode);
  await render('funded');
  assert.equal(await page.locator('#sd-stock-ideas .sd-idea[data-status="ready"]').count(),1);
  assert.match(await page.locator('#plan-content').innerText(),/buy ~[1-9]\d* sh MSFT/);
  assert.match(await page.locator('#sd-stock-ideas').innerText(),/118\.00/);
  assert.equal(await page.getByText('Build this buy with Claude',{exact:false}).count(),1);
  await render('unfunded');
  assert.equal(await page.locator('#sd-stock-ideas .sd-idea[data-status="funding"]').count(),1);
  assert.equal(await page.getByText('Build this buy with Claude',{exact:false}).count(),0);
  assert.match(await page.locator('#plan-content').innerText(),/70% ceiling/);
  const details=page.locator('#plan-content details').filter({hasText:'Why other stocks are waiting'});
  assert.equal(await details.getAttribute('open'),null);
  for(const width of [320,390,768,1440]){
    await page.setViewportSize({width,height:900});
    if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)){
      console.log(await page.evaluate(()=>[...document.querySelectorAll('body *')].map(e=>({tag:e.tagName,id:e.id,cls:String(e.className),right:e.getBoundingClientRect().right,width:e.getBoundingClientRect().width})).filter(e=>e.right>innerWidth+1&&e.width>0).slice(0,16)));
      if(process.env.PF_SCREENSHOT_DIR){fs.mkdirSync(process.env.PF_SCREENSHOT_DIR,{recursive:true});await page.locator('#plan-content').screenshot({path:path.join(process.env.PF_SCREENSHOT_DIR,'plan-overflow.png')});}
    }
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'no horizontal overflow at '+width);
    assert.equal(await page.locator('#sd-stock-ideas').isVisible(),true);
  }
  await page.setViewportSize({width:390,height:844});
  if(process.env.PF_SCREENSHOT_DIR){
    fs.mkdirSync(process.env.PF_SCREENSHOT_DIR,{recursive:true});
    await page.locator('#sd-stock-ideas').screenshot({path:path.join(process.env.PF_SCREENSHOT_DIR,'stock-ideas-unfunded-mobile.png')});
  }
  for(const [mode,status] of [['wash','wash'],['weak','below-floor'],['extended','entry'],['no-target','no-target']]){
    await render(mode);
    assert.equal(await page.locator('#sd-stock-ideas .sd-idea[data-status="'+status+'"]').count(),1,mode+' visible with truthful status');
    assert.equal(await page.getByText('Build this buy with Claude',{exact:false}).count(),0,mode+' has no buy ticket');
  }
  await render('funded');
  await page.evaluate(()=>setPrivacy(true));
  await page.evaluate(()=>setPrivacy(false));
  await page.evaluate(()=>document.documentElement.setAttribute('data-theme','gold'));
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  if(process.env.PF_SCREENSHOT_DIR)await page.locator('#sd-stock-ideas').screenshot({path:path.join(process.env.PF_SCREENSHOT_DIR,'stock-ideas-midnight-mobile.png')});
  await page.locator('#sd-stock-ideas .sd-idea-link').click();
  await page.waitForFunction(()=>getComputedStyle(document.querySelector('#page-analyze')).display!=='none');
  assert.equal(await page.locator('#az-ticker').inputValue(),'MSFT');
  assert.deepEqual(errors,[]);
  console.log('PASS: funded buy, zero-funding research, tax/floor/entry/missing-target rejection, collapsed details, 320–1440px layout, privacy round-trip, Midnight and Analyze link');
}finally{await browser.close();}
