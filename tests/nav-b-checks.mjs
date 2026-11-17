// Navigation B (Jack, Nov 17 2026, "Option B · by strategy"): Today · Apex · Agentic · Research · More.
// Called from journey-browser.mjs (the CI suite); also runnable alone: node tests/nav-b-checks.mjs
// All account data are synthetic. Nothing here submits an order; the suite asserts no non-GET requests.
import assert from 'node:assert/strict';
import fs from 'node:fs';

export const ROUTES=['today','accounts','holdings','performance','heatmap','risk','income','options','plan','markets','screens','analyze','technicals','fundamentals','flow','decisions','scenario','activity','log','smartmoney','predictions','apexpaper'];
const SCOPED=['plan','accounts','holdings','performance','heatmap','risk','income','technicals','fundamentals','flow','scenario'];
// v243: apexpaper (Apex v2.9 paper research) is Apex-only: it pins the self-directed account whatever pf_acct was.
const PINNED={apexpaper:'main'};
export const accountAfter=(route,acct)=>PINNED[route]||acct;
const STATIC={apexpaper:'apex',today:'today',markets:'research',screens:'research',analyze:'research',smartmoney:'research',predictions:'research',options:'more',decisions:'more',log:'more',activity:'more'};
export const expectedArea=(route,acct)=>SCOPED.includes(route)?(acct==='agentic'?'agentic':'apex'):STATIC[route];
const CHIPS={today:['Daily brief'],apex:['Plan','Account','Research','What if?','v2.9 Paper'],agentic:['Plan','Account','Research','What if?'],research:['Markets','Screens','Analyze','Smart $','Predict'],more:['Options','Decision evidence','Rebalance log','Activity']};
// Section routes with no chip: the card they scroll to, and its rail-chip text.
const RAIL={performance:'Performance',heatmap:'Heatmap',risk:'Risk',income:'Income',technicals:'Technical',fundamentals:'Fundamentals',flow:'Flow'};
// apexpaper is new in v243 and has no v236 baseline: its entry (1) is only the budget that admits the two taps it takes (Apex, then its chip).
// Taps from a fresh load (Today, self-directed) on v236 (measured with the same paths on the v236 shell, audit/nav/old.json).
const OLD_TAPS={main:{today:0,plan:1,accounts:1,holdings:2,performance:2,heatmap:2,risk:2,income:2,technicals:2,fundamentals:2,flow:2,scenario:2,markets:2,screens:2,analyze:2,smartmoney:1,predictions:2,options:2,decisions:2,log:2,activity:1,apexpaper:1},
  agentic:{plan:2,accounts:2,holdings:3,performance:3,heatmap:3,risk:3,income:3,technicals:3,fundamentals:3,flow:3,scenario:3,decisions:3,log:3,activity:2}};
// Smallest v236 nav / sub-nav chip boxes per viewport (width, height), measured on the v236 shell.
const OLD_MIN={'320x568':{item:[59,50],chip:44},'390x844':{item:[73,50],chip:44},'466x677':{item:[88,50],chip:44},'960x676':{item:[64,58],chip:42},'677x466':{item:[62,52],chip:42},'1280x800':{item:[159,48],chip:42}};
const GAP_MAX=40;
const VIEWPORTS=[['320x568',320,568,{}],['390x844',390,844,{}],['466x677',466,677,{right:84}],['960x676',960,676,{right:100}],['677x466',677,466,{left:85}],['1280x800',1280,800,{}]];

export async function runNavChecks({browser,base,sample,stub,apex,writes=[],tapOut}){
  const errors=[];
  const settle=p=>p.waitForTimeout(450);
  async function open({seed={},hash='',viewport={width:390,height:844},inset=null,block=null}={}){
    const ctx=await browser.newContext({viewport,timezoneId:'America/New_York',serviceWorkers:'block'});
    const p=await ctx.newPage();
    p.on('pageerror',e=>errors.push(e.message));
    p.on('request',r=>{if(!['GET','HEAD'].includes(r.method()))writes.push(r.url());});
    await p.addInitScript(stub);
    await p.addInitScript(s=>{if(!sessionStorage.getItem('navb-init')){const d={pf_acct:'main',pf_experience_route:'today',...s};for(const[k,v]of Object.entries(d)){if(v===null)localStorage.removeItem(k);else localStorage.setItem(k,v);}sessionStorage.setItem('navb-init','1');}},seed);
    await p.route('https://**/*',r=>r.request().url().startsWith(base)?r.continue():r.abort());
    if(block)await p.route(block,r=>r.abort());
    await p.route(/\/data\.json(?:\?.*)?$/,r=>r.fulfill({json:sample}));
    await p.route(/\/data\/apex-targets\.json(?:\?.*)?$/,r=>r.fulfill({json:apex}));
    await p.goto(base+hash);await p.waitForFunction(()=>window.__SNAP&&window.PFJourney);
    if(inset){const c=await ctx.newCDPSession(p);await c.send('Emulation.setSafeAreaInsetsOverride',{insets:{top:0,bottom:0,right:inset.right||0,left:inset.left||0}});}
    await settle(p);return {ctx,p};
  }
  const st=p=>p.evaluate(()=>({route:PFExperience.route,account:PFExperience.account,j:PFJourney.state}));
  const areas=p=>p.evaluate(()=>[...document.querySelectorAll('.ex-main [data-ex-area]')].filter(b=>b.getAttribute('aria-current')==='page').map(b=>b.dataset.exArea));
  const chipsOf=p=>p.evaluate(()=>[...document.querySelectorAll('#ex-subnav button')].map(b=>b.textContent.trim()));
  const area=a=>`.ex-main [data-ex-area="${a}"]`, chip=r=>`#ex-subnav [data-ex-route="${r}"]`;
  const vis=(p,sel)=>p.locator(sel).first().isVisible();
  // Navigation B follow-up: inside Apex / Agentic the old two-account switches are hidden (display:none, so also out of the
  // accessibility tree and the tab order) but stay in the DOM and in step with the account.
  async function assertTogglesHidden(p,label){
    const m=await p.evaluate(()=>['acct-seg-wrap','plan-seg-wrap'].map(id=>{const w=document.getElementById(id);
      const ids=[...w.querySelectorAll('button')].map(b=>{b.focus();return {id:b.id,focused:document.activeElement===b,vis:!!(b.offsetWidth||b.offsetHeight||b.getClientRects().length)};});
      return {id,hiddenAttr:w.hidden,display:getComputedStyle(w).display,h:w.offsetHeight,ids};}));
    for(const w of m){assert.equal(w.hiddenAttr,true,`${label}: #${w.id} has the hidden attribute`);assert.equal(w.display,'none',`${label}: #${w.id} is display:none`);assert.equal(w.h,0,`${label}: #${w.id} takes no space`);
      assert.equal(w.ids.length,2,`${label}: #${w.id} keeps its two buttons in the DOM`);
      for(const b of w.ids){assert.equal(b.vis,false,`${label}: #${b.id} not rendered`);assert.equal(b.focused,false,`${label}: #${b.id} cannot take focus`);}}
  }
  // The account whose content a scoped page shows. Apex = main only, Agentic = agentic only.
  async function assertContent(p,route,acct,label){
    const [mainSel,agSel]=route==='plan'?['#picks-app','#plan-agentic-app']:SCOPED.includes(route)&&route!=='scenario'?['#app','#agentic-app']:[null,null];
    if(mainSel){
      assert.equal(await vis(p,mainSel),acct==='main',`${label}: ${mainSel} visible only for the self-directed account`);
      assert.equal(await vis(p,agSel),acct==='agentic',`${label}: ${agSel} visible only for the agentic account`);
      const tg=route==='plan'?['#plan-tg-main','#plan-tg-agentic']:['#acct-tg-main','#acct-tg-agentic'];
      assert.match(await p.locator(acct==='main'?tg[0]:tg[1]).getAttribute('class'),/\bactive\b/,`${label}: own toggle shows ${acct}`);
      assert.doesNotMatch(await p.locator(acct==='main'?tg[1]:tg[0]).getAttribute('class'),/\bactive\b/,`${label}: other toggle is not active`);
      for(const [i,id] of tg.entries())assert.equal(await p.locator(id).getAttribute('aria-selected'),String((i===0)===(acct==='main')),`${label}: ${id} aria-selected in step`);
      if(route!=='scenario')await assertTogglesHidden(p,label);
    }
    if(route==='scenario')assert.match(await p.locator('#ex-context').innerText(),acct==='main'?/^Apex \(self-directed\)/:/^Agentic \(automated\)/,`${label}: scenario names its account`);
    assert.equal(await p.locator('#ex-account').inputValue(),acct,`${label}: header select agrees`);
  }
  // What names the account on the Accounts / Plan pages now that the switch is gone: caption + hero.
  async function assertIdentity(p,route,acct,label){
    const cap=await p.locator('#ex-context').innerText(),vis=await p.locator('#ex-context').isVisible();
    assert.equal(vis,true,`${label}: caption visible`);
    if(route==='accounts'){
      assert.match(cap,acct==='main'?/^Apex \(self-directed\) · Account$/:/^Agentic \(automated\) · Account$/,`${label}: caption names the account`);
      const tag=await p.locator(acct==='main'?'#app .h-tag':'#agentic-app .h-tag').first();
      assert.equal(await tag.isVisible(),true,`${label}: hero pill visible`);
      const shown=await tag.evaluate(e=>e.innerText+JSON.parse(getComputedStyle(e,'::after').content.replace(/^none$/,'""')));
      assert.match(shown,acct==='main'?/Individual Margin · ••••0741$/:/Agentic ••••3900 · limited margin/,`${label}: hero pill names the account suffix and type`);
    }else if(route==='plan'){
      assert.match(cap,acct==='main'?/^Apex \(self-directed\) · Plan$/:/^Agentic \(automated\) · Plan$/,`${label}: caption names the account`);
      if(acct==='agentic')assert.match(await p.locator('#plan-agentic-app .ph-label').first().innerText(),/Agentic Strategy · ••••3900/i,`${label}: plan hero names the account`);
    }
  }
  async function assertArea(p,route,acct,label){
    const want=expectedArea(route,acct);
    assert.deepEqual(await areas(p),[want],`${label}: highlighted area`);
    assert.equal(await p.locator('.ex-main [data-ex-area]').count(),5,`${label}: five items`);
    assert.deepEqual(await chipsOf(p),CHIPS[want],`${label}: sub-nav chips`);
  }

  // ── 1. Five items, new order and labels; same five on every route ──
  {
    const {ctx,p}=await open();
    assert.deepEqual(await p.locator('.ex-main [data-ex-area]').evaluateAll(n=>n.map(e=>e.dataset.exArea)),['today','apex','agentic','research','more']);
    assert.deepEqual(await p.locator('.ex-main [data-ex-area] span').allInnerTexts(),['Today','Apex','Agentic','Research','More']);
    assert.equal(await p.locator('.ex-main [data-ex-area] svg').count(),5,'each item keeps an icon');
    await ctx.close();
  }

  // ── 2. Tap paths from a fresh load: every route reachable within (v236 taps + 1) ──
  const tapTable={};
  {
    const step=r=>`[data-pj-go="${r}"]`, rail=l=>`#page-portfolio .card-nav-chip:has-text("${l}")`;
    const PATH=(r,a)=>{const ag=a==='agentic',A=ag?'agentic':'apex',sel=ag?['SELECT']:[];
      const m={today:[],plan:[area(A)],accounts:[area(A),chip('accounts')],scenario:[area(A),chip('scenario')],holdings:[area(A),step('holdings')],
        options:[area('more')],markets:[area('research')],screens:[area('research'),chip('screens')],analyze:[area('research'),chip('analyze')],
        apexpaper:[area('apex'),chip('apexpaper')],smartmoney:[area('research'),chip('smartmoney')],predictions:[area('research'),chip('predictions')],
        decisions:[area('more'),chip('decisions'),...sel],log:[area('more'),chip('log'),...(ag?['#acct-tg-agentic']:[])],activity:[area('more'),chip('activity'),...sel]};
      for(const k of Object.keys(RAIL))m[k]=[area(A),chip('accounts'),rail(RAIL[k])];return m[r];};
    for(const acct of ['main','agentic'])for(const route of ROUTES){
      if(acct==='agentic'&&!(route in OLD_TAPS.agentic))continue;
      const path=PATH(route,acct),{ctx,p}=await open(),label=`tap path ${acct}:${route}`;
      for(const s of path){if(s==='SELECT')await p.locator('#ex-account').selectOption('agentic');else await p.locator(s).first().click();await p.waitForTimeout(350);}
      await settle(p);
      const s=await st(p),want=RAIL[route]?'accounts':route;
      assert.equal(s.route,want,label+': lands on its route');assert.equal(s.account,acct,label+': account');
      assert.ok(path.length<=OLD_TAPS[acct][route]+1,`${label}: ${path.length} taps vs v236 ${OLD_TAPS[acct][route]} (+1 allowed)`);
      tapTable[acct+':'+route]={before:OLD_TAPS[acct][route],after:path.length,path};
      if(RAIL[route]||route==='holdings'){
        const sec=route==='holdings'?'holdings':{performance:'performance',heatmap:'heatmap',risk:'risk',income:'income',technicals:'technicals',fundamentals:'fundamentals',flow:'flow'}[route];
        const box=await p.locator((acct==='main'?'#app':'#agentic-app')+` .card[data-sec="${sec}"]`).first().boundingBox();
        assert.ok(box&&box.y<844&&box.y+box.height>0,`${label}: card is on screen`);
      }
      if(!RAIL[route]&&route!=='holdings')await assertArea(p,route,acct,label);
      else assert.deepEqual(await areas(p),[expectedArea(route,acct)],label+': area');
      await ctx.close();
    }
    if(tapOut)fs.writeFileSync(tapOut,JSON.stringify(tapTable,null,1));
  }

  // ── 3. Every route's hash loads on refresh and highlights the right area for BOTH accounts ──
  for(const acct of ['main','agentic'])for(const route of ROUTES){
    const label=`deep link ${acct}:${route}`,{ctx,p}=await open({seed:{pf_acct:acct},hash:'#view='+route});
    const s=await st(p);assert.equal(s.route,route,label);assert.equal(s.account,accountAfter(route,acct),label+': account kept (an Apex-only route pins the self-directed account)');
    assert.equal(await areas(p).then(a=>a.length),1,label+': exactly one highlighted area');
    assert.deepEqual(await areas(p),[expectedArea(route,acct)],label+': area');
    if(SCOPED.includes(route))await assertContent(p,route,acct,label);
    assert.ok((await p.locator('body').innerText()).length>(route==='apexpaper'?150:400),label+': page is not blank');
    // refresh keeps the same route and area
    await p.reload();await p.waitForFunction(()=>window.__SNAP&&window.PFJourney);await settle(p);
    assert.equal((await st(p)).route,route,label+': after refresh');assert.deepEqual(await areas(p),[expectedArea(route,acct)],label+': area after refresh');
    await ctx.close();
  }

  // ── 4. Old stored preferences: every old route id, old area memories, garbage ──
  for(const [i,route] of ROUTES.entries()){
    const acct=i%2?'agentic':'main',label=`stored pf_experience_route=${route} (${acct})`,{ctx,p}=await open({seed:{pf_acct:acct,pf_experience_route:route}});
    assert.equal((await st(p)).route,route,label);assert.deepEqual(await areas(p),[expectedArea(route,acct)],label);
    assert.ok((await p.locator('body').innerText()).length>(route==='apexpaper'?150:400),label+': not blank');await ctx.close();
  }
  for(const bad of ['constructor','__proto__','toString','','zzz','Plan'])for(const acct of ['weird','agentic']){
    const {ctx,p}=await open({seed:{pf_acct:acct,pf_experience_route:bad}});
    assert.equal((await st(p)).route,'today',`stored route ${JSON.stringify(bad)} falls back to Today`);assert.deepEqual(await areas(p),['today']);await ctx.close();
  }
  {
    // The old Signals memory maps into Research; an old Research value that no longer belongs there is ignored.
    let {ctx,p}=await open({seed:{pf_area_research:'plan',pf_signals_last:'predictions',pf_area_portfolio:'options',pf_area_signals:'predictions',pf_area_activity:'log'}});
    await p.locator(area('research')).click();await settle(p);assert.equal((await st(p)).route,'predictions','pf_signals_last lands Research on Predict');
    await p.locator(area('more')).click();await settle(p);assert.equal((await st(p)).route,'options','More opens Options when nothing new is stored');
    await p.locator(area('apex')).click();await settle(p);assert.equal((await st(p)).route,'plan','Apex opens the plan; old pf_area_portfolio is not an Apex route memory');await ctx.close();
    ({ctx,p}=await open({seed:{pf_area_research:'analyze',pf_signals_last:'predictions'}}));
    await p.locator(area('research')).click();await settle(p);assert.equal((await st(p)).route,'analyze','a valid Research memory wins over the Signals memory');await ctx.close();
    ({ctx,p}=await open({seed:{pf_area_apex:'predictions',pf_area_agentic:'options',pf_area_more:'plan',pf_area_research:'constructor'}}));
    for(const [a,want] of [['apex','plan'],['agentic','plan'],['more','options'],['research','markets']]){await p.locator(area(a)).click();await settle(p);assert.equal((await st(p)).route,want,`garbage memory for ${a} falls back to ${want}`);}
    await ctx.close();
    // Last-used memory per area, per account side.
    ({ctx,p}=await open());
    await p.locator(area('apex')).click();await p.locator(chip('accounts')).click();await settle(p);
    await p.locator(area('agentic')).click();await settle(p);assert.equal((await st(p)).route,'plan','Agentic has its own memory (default plan)');
    await p.locator(chip('scenario')).click();await settle(p);
    await p.locator(area('apex')).click();await settle(p);assert.deepEqual([(await st(p)).route,(await st(p)).account],['accounts','main'],'Apex reopens its last-used route');
    await p.locator(area('agentic')).click();await settle(p);assert.deepEqual([(await st(p)).route,(await st(p)).account],['scenario','agentic'],'Agentic reopens its last-used route');
    await ctx.close();
  }

  // ── 5. Account separation, sync of the three controls, Back/Forward across areas and across an account flip ──
  {
    const {ctx,p}=await open();
    await p.locator(area('apex')).click();await settle(p);
    await assertContent(p,'plan','main','Apex plan');assert.deepEqual(await areas(p),['apex']);
    await p.locator(area('agentic')).click();await settle(p);
    await assertContent(p,'plan','agentic','Agentic plan');assert.deepEqual(await areas(p),['agentic']);
    assert.match(await p.locator('#acct-tg-agentic').getAttribute('class'),/\bactive\b/,'Accounts toggle mirrors the area while the plan shows');
    await p.locator(chip('accounts')).click();await settle(p);await assertContent(p,'accounts','agentic','Agentic account');
    await p.locator(area('apex')).click();await settle(p);await assertContent(p,'plan','main','Apex plan again');
    assert.equal((await st(p)).account,'main');
    await p.locator(area('research')).click();await settle(p);
    assert.equal((await st(p)).route,'markets');assert.deepEqual(await areas(p),['research']);
    // Back/Forward across areas
    await p.goBack();await settle(p);assert.deepEqual([(await st(p)).route,(await st(p)).account],['plan','main']);assert.deepEqual(await areas(p),['apex']);await assertContent(p,'plan','main','Back to Apex plan');
    await p.goBack();await settle(p);assert.deepEqual([(await st(p)).route,(await st(p)).account],['accounts','agentic']);assert.deepEqual(await areas(p),['agentic']);await assertContent(p,'accounts','agentic','Back to Agentic account');
    await p.goForward();await settle(p);assert.deepEqual(await areas(p),['apex']);await assertContent(p,'plan','main','Forward to Apex plan');
    await ctx.close();
  }
  {
    // Switching account on Plan and Account is done with the Apex / Agentic nav items: ONE history step each (its own entry), Back undoes it.
    const {ctx,p}=await open();
    await p.locator(area('agentic')).click();await p.locator(chip('accounts')).click();await settle(p);
    await p.locator(area('apex')).click();await p.locator(chip('accounts')).click();await settle(p);
    await assertContent(p,'accounts','main','apex account');await assertIdentity(p,'accounts','main','apex account');
    let j=(await st(p)).j;
    await p.locator(area('agentic')).click();await settle(p);
    assert.deepEqual([(await st(p)).route,(await st(p)).account],['accounts','agentic'],'Agentic nav item switches the Account page to the agentic account');
    assert.deepEqual(await areas(p),['agentic']);await assertContent(p,'accounts','agentic','agentic account');await assertIdentity(p,'accounts','agentic','agentic account');
    assert.equal((await st(p)).j.index,j.index+1,'exactly one history step for the flip');
    await p.locator('#pj-back').click();await settle(p);
    assert.deepEqual(await areas(p),['apex'],'Back undoes the flip');await assertContent(p,'accounts','main','Back after account flip');assert.equal((await st(p)).j.index,j.index);
    await p.goForward();await settle(p);assert.deepEqual(await areas(p),['agentic']);await assertContent(p,'accounts','agentic','Forward after account flip');
    // Plan
    await p.locator(chip('plan')).click();await settle(p);await assertContent(p,'plan','agentic','agentic plan');await assertIdentity(p,'plan','agentic','agentic plan');
    await p.locator(area('apex')).click();await settle(p);await p.locator(chip('plan')).click();await settle(p);
    await assertContent(p,'plan','main','apex plan');await assertIdentity(p,'plan','main','apex plan');
    j=(await st(p)).j;
    await p.locator(area('agentic')).click();await settle(p);
    assert.deepEqual(await areas(p),['agentic'],'Agentic nav item flips the plan');await assertContent(p,'plan','agentic','plan flip');
    assert.equal((await st(p)).j.index,j.index+1,'exactly one history step for the plan flip');
    await p.locator('#pj-back').click();await settle(p);
    assert.deepEqual(await areas(p),['apex'],'Back undoes the plan flip');await assertContent(p,'plan','main','Back after plan flip');assert.equal((await st(p)).j.index,j.index);
    await p.goForward();await settle(p);assert.deepEqual(await areas(p),['agentic']);await assertContent(p,'plan','agentic','Forward after plan flip');
    // The hidden switches still work programmatically (legacy code, tests and journey steps call setAccount / setPlanAccount).
    await p.evaluate(()=>setPlanAccount('main'));await settle(p);
    assert.equal(await p.locator('#plan-tg-main').getAttribute('aria-selected'),'true','setPlanAccount still updates the hidden plan switch');
    await p.evaluate(()=>setPlanAccount('agentic'));await settle(p);
    await p.locator(chip('scenario')).click();await settle(p);
    assert.equal(await p.locator('#ex-account').isVisible(),true,'header select is the account control on What if?');
    await p.locator('#ex-account').selectOption('main');await settle(p);
    assert.deepEqual(await areas(p),['apex'],'header select flips Agentic to Apex');await assertContent(p,'scenario','main','header select');
    await p.goBack();await settle(p);assert.deepEqual(await areas(p),['agentic']);await assertContent(p,'scenario','agentic','Back after header-select flip');
    // The header select is not shown on Plan / Account (it was already hidden there before this change).
    for(const r of ['plan','accounts','holdings'])for(const a of ['main','agentic']){await p.evaluate(([r,a])=>PFExperience.navigate(r,{account:a}),[r,a]);await settle(p);
      assert.equal(await p.locator('#ex-account-label').isVisible(),false,`header select hidden on ${a}:${r}`);}
    // Non-scoped, account-aware pages keep their area and show the account in the caption, as before.
    await p.locator(area('more')).click();await p.locator(chip('decisions')).click();await settle(p);
    assert.deepEqual(await areas(p),['more']);assert.match(await p.locator('#ex-context').innerText(),/^Lab · Agentic · Decision evidence/);
    await p.locator('#ex-account').selectOption('main');await settle(p);
    assert.deepEqual(await areas(p),['more'],'flipping the account on Decision evidence stays in More');assert.match(await p.locator('#ex-context').innerText(),/^Lab · Self-directed · Decision evidence/);
    await p.locator(chip('log')).click();await settle(p);assert.deepEqual(await areas(p),['more']);assert.match(await p.locator('#ex-context').innerText(),/^Lab · /);
    assert.equal(await p.locator('#acct-tg-agentic').isVisible(),true,'Rebalance log (More, not account-scoped, no header select) keeps its account switch');
    await p.locator('#acct-tg-agentic').click();await settle(p);assert.deepEqual(await areas(p),['more'],'Rebalance log toggle stays in More');
    await p.locator(chip('options')).click();await settle(p);assert.match(await p.locator('#ex-context').innerText(),/^Options · self-directed source/);
    await ctx.close();
  }
  // Research chip (Apex / Agentic rows): the journey's "2 · Research" step as a sub-nav chip. It opens Analyze for THIS area's selected holding.
  {
    const {ctx,p}=await open();
    const syms=await p.evaluate(()=>({main:PFExperienceModel.snapshot(__DATA,__SNAP,'main').positions.map(x=>x.symbol),ag:PFExperienceModel.snapshot(__DATA,__SNAP,'agentic').positions.map(x=>x.symbol)}));
    const onlyMain=syms.main.find(x=>!syms.ag.includes(x)),onlyAg=syms.ag.find(x=>!syms.main.includes(x));
    assert.ok(onlyMain&&onlyAg,'sample has a holding unique to each account');
    await p.evaluate(([a,b])=>localStorage.setItem('pf-journey-ui-v1',JSON.stringify({main:{symbol:a},agentic:{symbol:b}})),[onlyMain,onlyAg]);await p.reload();await p.waitForFunction(()=>window.__SNAP&&window.PFJourney);await settle(p);
    for(const [acct,A,own,other] of [['main','apex',onlyMain,onlyAg],['agentic','agentic',onlyAg,onlyMain]]){
      await p.locator(area(A)).click();await settle(p);
      assert.deepEqual(await chipsOf(p),CHIPS[A],A+': chips Plan · Account · Research · What if?');
      assert.equal(await p.locator('#ex-subnav [data-ex-research]').count(),1,A+': one Research chip');
      const order=await chipsOf(p);assert.equal(order.indexOf('Research'),order.indexOf('Account')+1,A+': Research sits right after Account');
      await p.locator(chip('accounts')).click();await settle(p);
      const j=(await st(p)).j;
      await p.locator('#ex-subnav [data-ex-research]').focus();assert.equal(await p.evaluate(()=>document.activeElement.hasAttribute('data-ex-research')),true,A+': Research chip is keyboard focusable');
      await p.keyboard.press('Enter');await settle(p);
      const s=await st(p);assert.deepEqual([s.route,s.account],['analyze',acct],A+': Research chip opens Analyze in the same account');
      assert.deepEqual(await areas(p),['research'],A+': Research tab highlighted after the tap');
      assert.equal(s.j.index,j.index+1,A+': one history step');
      assert.equal(await p.locator('#pj-symbol').inputValue(),own,A+': Analyze opens the selected holding of this account');
      assert.notEqual(await p.locator('#pj-symbol').inputValue(),other,A+': never the other account\'s holding');
      await p.locator('#pj-back').click();await settle(p);
      assert.deepEqual([(await st(p)).route,(await st(p)).account,...(await areas(p))],['accounts',acct,A],A+': Back returns to the account page it came from');
    }
    // No holding selected: Analyze opens with its normal picker, still in the same account.
    await p.evaluate(()=>localStorage.setItem('pf-journey-ui-v1','{}'));await p.reload();await p.waitForFunction(()=>window.__SNAP&&window.PFJourney);await settle(p);
    await p.locator(area('apex')).click();await p.locator('#ex-subnav [data-ex-research]').click();await settle(p);
    assert.deepEqual([(await st(p)).route,(await st(p)).account],['analyze','main'],'no selection: Analyze opens with its normal picker');
    // Research's own row does not carry a second Research chip.
    assert.equal(await p.locator('#ex-subnav [data-ex-research]').count(),0,'no duplicate Research chip in Research');
    assert.deepEqual(await chipsOf(p),CHIPS.research);
    await ctx.close();
  }
  // Apex never renders agentic content and vice versa: scan every scoped route in both areas.
  for(const acct of ['main','agentic']){
    const {ctx,p}=await open();await p.locator(area(acct==='main'?'apex':'agentic')).click();await settle(p);
    for(const route of SCOPED){
      await p.evaluate(r=>PFExperience.navigate(r),route);await settle(p);
      const s=await st(p);assert.equal(s.account,acct,`${acct}:${route} keeps the account`);assert.deepEqual(await areas(p),[acct==='main'?'apex':'agentic'],`${acct}:${route} area`);
      await assertContent(p,route,acct,`${acct}:${route}`);
    }
    await ctx.close();
  }

  // ── 6. Legacy switchTab rewrites, Find target, journey steps ──
  for(const acct of ['main','agentic']){
    const {ctx,p}=await open({seed:{pf_acct:acct,pf_experience_route:'markets'}});const A=acct==='main'?'apex':'agentic';
    await p.evaluate(()=>switchTab('portfolio'));await settle(p);assert.deepEqual([(await st(p)).route,...(await areas(p))],['accounts',A],'switchTab(portfolio) opens the selected account');
    await p.evaluate(()=>switchTab('picks'));await settle(p);assert.deepEqual([(await st(p)).route,...(await areas(p))],['plan',A],'switchTab(picks)');
    await p.evaluate(()=>switchTab('options'));await settle(p);assert.deepEqual([(await st(p)).route,...(await areas(p))],['options','more'],'switchTab(options)');
    await p.evaluate(()=>switchTab('smartmoney'));await settle(p);assert.deepEqual([(await st(p)).route,...(await areas(p))],['smartmoney','research']);
    await p.evaluate(()=>switchTab('predictions'));await settle(p);assert.deepEqual([(await st(p)).route,...(await areas(p))],['predictions','research']);
    await p.evaluate(()=>{const c=document.querySelector((window.PFExperience.account==='agentic'?'#agentic-app':'#app')+' .card[data-sec="allocation"]');return __pfGoCard(__navTitleOf(c),'portfolio');});
    await settle(p);assert.deepEqual([(await st(p)).route,...(await areas(p))],['accounts',A],'Find / My view target lands in the account area');
    // Journey step buttons keep the account of the area.
    await p.evaluate(()=>PFExperience.navigate('plan'));await settle(p);
    await p.locator('[data-pj-go="holdings"]').first().click();await settle(p);assert.deepEqual([(await st(p)).route,(await st(p)).account,...(await areas(p))],['holdings',acct,A]);
    await p.evaluate(()=>PFExperience.navigate('plan'));await settle(p);
    const sym=await p.locator('#pj-symbol option:not([disabled])').first().getAttribute('value')||await p.locator('#pj-symbol option:not([disabled])').first().innerText();
    await p.locator('#pj-symbol').selectOption(sym);await settle(p);
    await p.locator('[data-pj-go="analyze"]').first().click();await settle(p);assert.deepEqual([(await st(p)).route,...(await areas(p))],['analyze','research'],'2 · Research');
    await p.locator('[data-pj-go="decisions"]').first().click();await settle(p);assert.deepEqual([(await st(p)).route,...(await areas(p))],['decisions','more'],'Sources →');
    await p.evaluate(()=>PFExperience.navigate('analyze'));await settle(p);await p.locator('[data-pj-go="plan"]').first().click();await settle(p);
    assert.deepEqual([(await st(p)).route,(await st(p)).account,...(await areas(p))],['plan',acct,A],'3 · Plan returns to the area of the selected account');
    await ctx.close();
  }
  {
    // Today's own links carry their account: Open portfolio / Open agentic plan land in that account's area.
    const {ctx,p}=await open();
    for(const [acct,A] of [['main','apex'],['agentic','agentic']]){
      await p.locator(area('today')).click();await settle(p);
      await p.locator(`#page-ex-today [data-ex-route="plan"][data-ex-account="${acct}"], #page-ex-today [data-ex-route="accounts"][data-ex-account="${acct}"]`).first().click();await settle(p);
      assert.deepEqual([(await st(p)).account,...(await areas(p))],[acct,A],`Today link for ${acct}`);
    }
    await ctx.close();
  }

  // ── 7. Classic view both ways, privacy, themes, Today fallback renderer ──
  {
    const {ctx,p}=await open();
    await p.locator('#ex-classic').click();await p.waitForFunction(()=>document.querySelector('.ex-classic-return'));await settle(p);
    assert.equal(await p.locator('#tabbar').isVisible(),true,'classic tab bar returns');assert.equal(await p.locator('.ex-main').count(),0,'new navigation is not built in Classic');
    // Classic view is unchanged: both switches are visible, focusable and working.
    for(const id of ['#acct-tg-main','#acct-tg-agentic'])assert.equal(await p.locator(id).isVisible(),true,'Classic: '+id+' visible');
    await p.locator('#acct-tg-agentic').click();await settle(p);assert.equal(await p.locator('#agentic-app').isVisible(),true,'Classic: Accounts switch shows the agentic account');
    await p.locator('#acct-tg-main').click();await settle(p);assert.equal(await p.locator('#app').isVisible(),true,'Classic: Accounts switch shows the self-directed account');
    await p.evaluate(()=>switchTab('picks'));await settle(p);
    for(const id of ['#plan-tg-main','#plan-tg-agentic'])assert.equal(await p.locator(id).isVisible(),true,'Classic: '+id+' visible');
    await p.locator('#plan-tg-agentic').focus();assert.equal(await p.evaluate(()=>document.activeElement.id),'plan-tg-agentic','Classic: plan switch is focusable');
    await p.locator('#plan-tg-agentic').click();await settle(p);assert.equal(await p.locator('#plan-agentic-app').isVisible(),true,'Classic: Plan switch shows the agentic plan');
    await p.locator('#plan-tg-main').click();await settle(p);assert.equal(await p.locator('#picks-app').isVisible(),true,'Classic: Plan switch shows the self-directed plan');
    await p.locator('.ex-classic-return').click();await p.waitForFunction(()=>document.querySelectorAll('.ex-main [data-ex-area]').length===5);await settle(p);
    assert.deepEqual(await areas(p).then(a=>a.length),1);
    await p.locator(area('agentic')).click();await settle(p);assert.deepEqual(await areas(p),['agentic']);
    // privacy: labels and counts are not private data, dollar amounts stay masked, switching keeps working
    await p.evaluate(()=>setPrivacy(true));await settle(p);
    assert.doesNotMatch(await p.locator('.ex-main').innerText()+await p.locator('#ex-subnav').innerText(),/\$\d/);
    await p.locator(area('apex')).click();await settle(p);assert.deepEqual(await areas(p),['apex']);await assertContent(p,'plan','main','privacy on');
    await p.evaluate(()=>setPrivacy(false));await settle(p);
    for(const theme of ['light','dark','system']){await p.evaluate(t=>PFTheme.set(t),theme);await p.waitForTimeout(150);
      assert.equal(await p.locator('.ex-main [data-ex-area]').evaluateAll(n=>n.every(e=>e.getBoundingClientRect().width>40&&getComputedStyle(e).visibility==='visible')),true,'nav visible in '+theme);
      assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'no overflow in '+theme);}
    await ctx.close();
  }
  {
    const {ctx,p}=await open({block:/\/ui\/today(?:-model)?\.js(?:\?.*)?$/});
    assert.equal(await p.evaluate(()=>typeof window.PFToday),'undefined','today.js blocked: the original renderer is the fallback');
    assert.equal(await p.locator('#page-ex-today .ex-brief-hero').count(),1,'fallback Today renders');
    await p.locator(area('agentic')).click();await settle(p);assert.deepEqual(await areas(p),['agentic']);
    await p.locator(area('today')).click();await settle(p);assert.deepEqual(await areas(p),['today']);assert.equal(await p.locator('#page-ex-today .ex-brief-hero').count(),1);
    await p.locator('#page-ex-today [data-ex-route="plan"][data-ex-account="agentic"]').first().click();await settle(p);
    assert.deepEqual([(await st(p)).route,(await st(p)).account,...(await areas(p))],['plan','agentic','agentic'],'fallback Today link opens the Agentic plan');
    await ctx.close();
  }

  // ── 8. Layout: five items, no horizontal overflow, touch targets not smaller than v236, every area ──
  for(const [name,w,h,inset] of VIEWPORTS){
    const {ctx,p}=await open({viewport:{width:w,height:h},inset:Object.keys(inset).length?inset:null});
    for(const a of ['today','apex','agentic','research','more']){
      await p.locator(area(a)).click();await settle(p);
      const m=await p.evaluate(()=>({sw:document.documentElement.scrollWidth,iw:innerWidth,
        items:[...document.querySelectorAll('.ex-main [data-ex-area]')].map(e=>{const r=e.getBoundingClientRect();return {w:r.width,h:r.height,l:r.left,r:r.right};}),
        chips:getComputedStyle(document.getElementById('ex-subnav')).display==='none'?[]:[...document.querySelectorAll('#ex-subnav button')].map(e=>e.getBoundingClientRect().height),sub:(()=>{const s=document.getElementById('ex-subnav');return s?[s.scrollWidth,s.clientWidth]:null;})()}));
      const label=`${name} ${a}`;
      assert.equal(m.items.length,5,label+': five items');assert.ok(m.sw<=m.iw,label+': no horizontal overflow');
      for(const it of m.items){assert.ok(it.w>=OLD_MIN[name].item[0]-1&&it.h>=OLD_MIN[name].item[1]-1,`${label}: nav item ${Math.round(it.w)}x${Math.round(it.h)} not smaller than v236`);assert.ok(it.l>=-1&&it.r<=w+1,label+': nav item inside the viewport');}
      for(const c of m.chips)assert.ok(c>=OLD_MIN[name].chip-1,`${label}: sub-nav chip height ${c}`);
      if(a==='apex'||a==='agentic')for(const route of ['plan','accounts']){
        await p.evaluate(r=>PFExperience.navigate(r),route);await p.waitForTimeout(250);
        const g=await p.evaluate(()=>{const page=document.querySelector('#page-picks').style.display==='none'?document.getElementById('page-portfolio'):document.getElementById('page-picks');
          // Above the page: the sub-nav, or on Plan the journey context block that follows it.
          let prev=page.previousElementSibling;while(prev&&!(prev.offsetHeight>0&&getComputedStyle(prev).position!=='fixed'))prev=prev.previousElementSibling;
          const sb=(prev||document.getElementById('ex-subnav')).getBoundingClientRect().bottom;
          const first=[...page.children].find(e=>e.offsetHeight>0&&getComputedStyle(e).position!=='absolute');
          return {sw:document.documentElement.scrollWidth,iw:innerWidth,gap:first?first.getBoundingClientRect().top-sb:null,wraps:[...document.querySelectorAll('.acct-seg-wrap')].map(e=>e.offsetHeight),cap:document.getElementById('ex-context').scrollWidth<=document.getElementById('ex-context').parentElement.clientWidth+1};});
        const l2=`${label} ${route}`;
        assert.ok(g.sw<=g.iw,l2+': no horizontal overflow');assert.deepEqual(g.wraps,[0,0],l2+': no switch space');
        assert.ok(g.gap!==null&&g.gap<=GAP_MAX,l2+': no empty gap above the first card/rail ('+Math.round(g.gap)+'px)');
        await assertTogglesHidden(p,l2);
      }
    }
    await ctx.close();
  }
  assert.deepEqual(errors,[],'no page errors in the navigation checks');
  return tapTable;
}

if(import.meta.url===`file://${process.argv[1]}`){
  const {chromium}=await import(process.env.PF_PLAYWRIGHT||'playwright');
  const base=(process.env.PF_PREVIEW_URL||'http://127.0.0.1:8767/').replace(/\/?$/,'/');
  const sample=JSON.parse(fs.readFileSync('tmp/experience-preview/sample.json','utf8'));
  const stub=fs.readFileSync('producer/privacy-audit.mjs','utf8').match(/const CHART_STUB = `([\s\S]*?)`;/)[1];
  const apex={asOf:new Date().toISOString(),targets:{MSFT:20},top5:[{sym:'MSFT',composite:8,why:'Synthetic entry research',limit:420,trigger:420,stop:380,tp1:500,orderType:'limit',tradable:true}],heldLevels:[{sym:'AAPL',stop:170,tp1:230,why:'Synthetic held-name evidence'}]};
  const browser=await chromium.launch({...(process.env.PF_CHROME?{executablePath:process.env.PF_CHROME}:{}),args:['--no-sandbox','--disable-dev-shm-usage']});
  const writes=[];
  try{await runNavChecks({browser,base,sample,stub,apex,writes,tapOut:process.env.PF_TAP_JSON});assert.deepEqual(writes,[]);console.log('nav-b-checks PASS');}finally{await browser.close();}
}
