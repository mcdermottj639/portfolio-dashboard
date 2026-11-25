/* v150: additive navigation and read-only views. Original renderers remain authoritative. */
(function () {
  'use strict';
  const M = window.PFExperienceModel;
  if (!M || !window.switchTab) return; // The original app is the fallback if a shell asset fails.
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const read = (key, fallback) => { try { return localStorage.getItem(key) || fallback; } catch (_) { return fallback; } };
  const save = (key, value) => { try { localStorage.setItem(key, value); } catch (_) {} };
  const money = n => n === null || !Number.isFinite(n) ? 'Unavailable' : new Intl.NumberFormat('en-US', {style:'currency',currency:'USD',maximumFractionDigits:2}).format(n);
  const percent = n => n === null || !Number.isFinite(n) ? 'Unavailable' : (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  const date = value => { if(typeof value==='string' && /^\d{4}-\d{2}-\d{2}$/.test(value))return value; const d = value ? new Date(value) : null; return d && Number.isFinite(d.getTime()) ? d.toLocaleString() : 'Not recorded'; };
  const ageText = iso => { const n = M.age(iso); return n === null ? 'Age unavailable' : n < 60 ? Math.floor(n)+' min old' : n < 1440 ? (n/60).toFixed(1)+' hours old' : Math.floor(n/1440)+' days old'; };
  const icon = name => {
    const paths={today:'M3 10 12 3l9 7v11h-6v-7H9v7H3Z',portfolio:'M12 3v9h9M9 3.5A9 9 0 1 0 20.5 15H9Z',research:'M5 3h10l4 4v14H5ZM9 11h6M9 15h6',predictions:'M12 3 3 8l9 5 9-5-9-5ZM3 12l9 5 9-5M3 16l9 5 9-5',activity:'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM12 7v5l3 2',smartmoney:'M3 21h18M5 21v-9M9.5 21v-9M14.5 21v-9M19 21v-9M2.5 9 12 3.5 21.5 9Z'};
    paths.signals=paths.smartmoney;
    // Navigation B (Nov 17 2026): Apex reuses the portfolio chart mark; Agentic is a chip outline; More is three dots (same 24px / 1.6 stroke set).
    paths.apex=paths.portfolio;
    paths.agentic='M8 8h8v8H8ZM10 3v3M14 3v3M10 18v3M14 18v3M3 10h3M3 14h3M18 10h3M18 14h3';
    paths.more='M5 12a1.2 1.2 0 1 0 .01 0M12 12a1.2 1.2 0 1 0 .01 0M19 12a1.2 1.2 0 1 0 .01 0';
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="'+paths[name]+'"/></svg>';
  };
  // Navigation B (Jack, Nov 17 2026, "Option B · by strategy"): Today · Apex · Agentic · Research · More.
  // The route ids, hashes, pages and renderers are unchanged; only the grouping moved. A `scoped` route
  // belongs to Apex when pf_acct='main' and to Agentic when pf_acct='agentic' (see areaOf), so an
  // account area can never show the other account's plan, positions or actions. Entries are listed in
  // sub-nav chip order. `hidden` routes are deep links / card-rail targets with no chip.
  const routes = {
    today: {area:'today', label:'Daily brief', custom:'today'},
    plan: {area:'apex', scoped:true, label:'Plan', tab:'picks'},
    // v253 (Jack, Nov 18 2026: "Apex and agentic plans should be under the research for each"): the account's OWN research. Same page as
    // `plan` (page-picks, same renderers, every card drawn once); the cards tagged data-ws="research" show here and the ones tagged
    // data-ws="actions" show on Actions (ui/experience.css). Single-stock Analyze opens from inside it.
    acctresearch: {area:'apex', scoped:true, hidden:true, label:'Research', tab:'picks'},
    accounts: {area:'apex', scoped:true, label:'Account', tab:'portfolio'},
    holdings: {area:'apex', scoped:true, hidden:true, label:'All positions', tab:'portfolio', section:'holdings'},
    performance: {area:'apex', scoped:true, hidden:true, label:'Performance', tab:'portfolio', section:'performance'},
    heatmap: {area:'apex', scoped:true, hidden:true, label:'Heatmap', tab:'portfolio', section:'heatmap'},
    risk: {area:'apex', scoped:true, hidden:true, label:'Risk & allocation', tab:'portfolio', section:'risk'},
    income: {area:'apex', scoped:true, hidden:true, label:'Income & tax', tab:'portfolio', section:'income'},
    technicals: {area:'apex', scoped:true, hidden:true, label:'Technicals', tab:'portfolio', section:'technicals'},
    fundamentals: {area:'apex', scoped:true, hidden:true, label:'Fundamentals', tab:'portfolio', section:'fundamentals'},
    flow: {area:'apex', scoped:true, hidden:true, label:'Flow & positioning', tab:'portfolio', section:'flow'},
    // v244: Apex v2.9 PAPER research (display only). Apex-only: `account:'main'` pins the self-directed account, so it
    // never shows under Agentic; `transient` keeps it out of the area's "last route" memory, so tapping Apex always
    // reopens a LIVE page (Plan by default), never the paper one.
    apexpaper: {area:'apex', account:'main', transient:true, label:'v2.9 Paper', tab:'apexpaper'},
    // v204 (Jack, Nov 9): Markets · Screens · Analyze first, then (Nav B) Smart $ and Predict.
    markets: {area:'research', label:'Markets', tab:'markets'},
    screens: {area:'research', label:'Screens', tab:'screens'},
    analyze: {area:'research', label:'Analyze', tab:'analyze'},
    smartmoney: {area:'research', label:'Smart $', tab:'smartmoney'},
    predictions: {area:'research', label:'Predict', tab:'predictions'},
    // More = Options + Lab (the existing evidence routes Decision evidence and Rebalance log) + Activity.
    options: {area:'more', label:'Options', tab:'options'},
    decisions: {area:'more', lab:true, label:'Decision evidence', custom:'decisions'},
    log: {area:'more', lab:true, label:'Rebalance log', tab:'portfolio', section:'rebalance-log'},
    activity: {area:'more', label:'Activity', custom:'activity'}
  };
  const defaults = {today:'today',apex:'plan',agentic:'plan',research:'markets',more:'options'};
  const accountArea = {main:'apex',agentic:'agentic'};
  // The area a route lives in, for a given account. Only `scoped` routes depend on the account.
  const known = key => typeof key==='string'&&Object.prototype.hasOwnProperty.call(routes,key);
  // v242: Analyze opened FROM Apex or Agentic keeps that area highlighted (origin 'main' | 'agentic', carried in the journey's history
// state so refresh, Back and Forward agree). A bare #view=analyze, or the bottom-nav Research item, has no origin and stays in Research.
let origin = null;
const areaOf = (key, acct) => { const r=known(key)&&routes[key]; if(!r)return 'today'; if(key==='analyze'&&origin)return accountArea[origin]; return r.scoped?accountArea[acct==='agentic'?'agentic':'main']:r.area; };
  const inArea = (key, a) => { const r=known(key)&&routes[key]; return !!r&&(r.scoped?(a==='apex'||a==='agentic'):r.area===a); };
  // Tapping an area reopens the route last used there. Stored values from the five-area navigation
  // (pf_area_portfolio / _signals / _activity / old _research ids, pf_signals_last) are tolerated:
  // a value that does not belong to the area is ignored; the old Signals memory now maps into Research.
  const areaDefault = a => {
    const saved=[read('pf_area_'+a,'')];
    if(a==='research')saved.push(read('pf_signals_last',''));
    for(const key of saved)if(key&&inArea(key,a)&&!routes[key].transient)return key;
    return defaults[a];
  };
  const legacyTabs = ['portfolio','markets','picks','options','analyze','screens','predictions','smartmoney','apexpaper'];
  const nativeSwitch = window.switchTab;
  const nativeAccount = window.setAccount;
  const nativePlanAccount = window.setPlanAccount;
  let routeKey = known(read('pf_experience_route','today')) ? read('pf_experience_route','today') : 'today';
  let navigating = false, refreshTimer, jumpToken = 0;
  const account = () => read('pf_acct','main') === 'agentic' ? 'agentic' : 'main';
  const model = () => M.snapshot(window.__DATA, window.__SNAP, account());
  const jump = (key, text, scope) => '<button type="button" class="ex-link" data-ex-route="'+key+'"'+(scope?' data-ex-account="'+scope+'"':'')+'>'+esc(text || routes[key].label)+' →</button>';
  const row = (label, value, detail = '') => '<div class="ex-row"><span>'+esc(label)+(detail?'<small>'+esc(detail)+'</small>':'')+'</span><span>'+value+'</span></div>';
  const card = (title, html, wide = false, symbol = '') => '<section'+(symbol?' data-evidence-symbol="'+esc(symbol)+'"':'')+' class="ex-card'+(wide?' ex-wide':'')+'"><h2>'+esc(title)+'</h2>'+html+'</section>';
  const prettyStatus = value => {
    if (value === null || value === undefined || value === '') return 'Not in this snapshot';
    const s = String(value).trim();
    if (s === 'not-recorded') return 'Not recorded on this target';
    return s.replace(/-/g, ' ');
  };
  const note = text => '<div class="ex-note">'+esc(text)+'</div>';
  const unavailable = text => note(text || 'Unlock a published snapshot to view this account.');
  function goClassic() { save('pf_classic','1'); location.reload(); }
  if (read('pf_classic','0') === '1') {
    const back = document.createElement('button'); back.className='ex-btn ex-classic-return'; back.textContent='Open new navigation';
    back.addEventListener('click',()=>{ save('pf_classic','0'); location.reload(); }); document.body.append(back); return;
  }
  const top = document.createElement('header'); top.className='ex-top'; top.id='ex-top';
  top.innerHTML='<div><h1 class="ex-today-title">Today</h1><div class="ex-brand">Portfolio <span>/</span></div><div class="ex-caption" id="ex-context">Your accounts, research, and activity</div></div><div id="ws-stamps" class="ws-stamps" aria-label="Data freshness" hidden></div><div class="ex-tools"><span id="ex-all-accounts" class="ex-badge" hidden>Both accounts</span><label id="ex-account-label">Account <select id="ex-account" aria-label="Account"><option value="main">Self-directed</option><option value="agentic">Agentic</option></select></label><button type="button" id="ex-find">Find a feature</button><button type="button" id="ex-classic" title="Return to the classic tab layout">Classic view</button></div>';
  const main = document.createElement('nav'); main.className='ex-main'; main.setAttribute('aria-label','Main navigation');
  main.innerHTML='<div class="ex-wordmark">PORTFOLIO</div>'+Object.keys(defaults).map(a=>'<button type="button" data-ex-area="'+a+'" aria-current="false">'+icon(a)+'<span>'+(a[0].toUpperCase()+a.slice(1))+'</span></button>').join('');
  const sub = document.createElement('nav'); sub.id='ex-subnav'; sub.className='ex-subnav'; sub.setAttribute('aria-label','Section navigation');
  const first = $('tabbar'); first.before(top,main,sub);
  ['today','activity','decisions'].forEach(name=>{
    const page=document.createElement('section'); page.id='page-ex-'+name; page.className='ex-page'; page.dataset.priv='on'; page.hidden=true; sub.after(page);
  });
  document.documentElement.classList.add('experience-on');
  function header() {
    const r=routes[routeKey]; $('ex-account').value=account();
    // Navigation B follow-up: on the account-scoped pages under Apex / Agentic (Plan, Account and its section routes) the account is
    // chosen with the bottom nav, so the old Self-directed / Agentic switch is redundant there. It stays in the DOM (setAccount /
    // setPlanAccount / syncToggles keep .active and aria-selected in step; Classic view shows it) but is `hidden`: out of sight, the
    // accessibility tree and the tab order. The Rebalance log (More) is not scoped and has no header select, so its switch stays.
    document.querySelectorAll('.acct-seg-wrap').forEach(w=>{w.hidden=!!(r.scoped&&r.tab);});
    // Accounts and Plan carry their own Self-directed/Agentic switch, and Options is self-directed only,
    // so the header dropdown there was a second control for the same choice (v185).
    $('ex-account-label').hidden=['today','predictions','smartmoney','apexpaper'].includes(routeKey)||['portfolio','picks','options'].includes(r.tab)||(routeKey==='analyze'&&!!origin); $('ex-all-accounts').hidden=routeKey!=='today';
    main.querySelectorAll('[data-ex-area]').forEach(b=>b.setAttribute('aria-current',b.dataset.exArea===areaOf(routeKey,account())?'page':'false'));
    sub.hidden=false;
    // v185 (Jack, 2026-11-04: "nav widgets split between the buttons and the scroll bar"): this row
    // lists PAGES only. In-page sections (holdings, heatmap, risk…) are the card rail's job — it is
    // built from the cards actually on screen, so it covers every card and never drifts. The section
    // routes stay in the table for deep links (Today's "Review" buttons, the tape) but get no chip.
    // Exception: a section route in ANOTHER area (Activity › Rebalance log) is a cross-page link.
    // Navigation B: the chips are the routes of the highlighted area (account-scoped routes follow pf_acct).
    const area=areaOf(routeKey,account());
    // Apex / Agentic rows also carry a Research chip after Account (owner, Nov 17): it is the journey's "2 · Research" step
    // (data-pj-go="analyze" in ui/journey.js: opens Analyze for the area's selected holding, or the normal picker) — no new route.
    const wsMode=(area==='apex'||area==='agentic')&&routeKey!=='today';
    // v242 (owner, Nov 17 2026): ONE tab row for Apex and Agentic: Overview · Positions · Research · Actions. It replaces the Plan · Account ·
    // Research · What if? chips, the per-page card rail and the journey's three step buttons. Same route ids (accounts / holdings / analyze /
    // plan), no new route; What if? (scenario) was a row inside Overview until v255 removed it. Research is the journey's data-pj-go="analyze" step.
    // v253: Research is the account's own research page (route acctresearch); Analyze opens from inside it and keeps this tab lit.
    if(wsMode)sub.innerHTML=WS_TABS.map(([id,label,route])=>'<button type="button" data-ex-route="'+route+'" data-ws-tab="'+id+'" aria-current="'+(wsTab(routeKey)===id?'page':'false')+'">'+label+'</button>').join('');
    else sub.innerHTML=Object.entries(routes).filter(([k,v])=>inArea(k,area)&&!v.hidden).map(([k,v])=>'<button type="button" data-ex-route="'+k+'" aria-current="'+(k===routeKey?'page':'false')+'">'+esc(v.label)+'</button>'+(k==='accounts'&&(area==='apex'||area==='agentic')?'<button type="button" data-pj-go="analyze" data-ex-research aria-current="false">Research</button>':'')).join('')+(area==='more'?'<button type="button" id="ex-classic-more" class="ws-classic" title="Return to the classic tab layout">Classic view</button>':'');
    $('ex-context').textContent=routeKey==='predictions'?'Market research, watchlists, and recorded results':routeKey==='smartmoney'?'Politician and insider trades on your names · read-only':routeKey==='today'?'Self-directed + Agentic · your big picture':r.tab==='options'?'Options · self-directed source (existing contracts and ideas)':(r.scoped?(account()==='agentic'?'Agentic (automated)':'Apex (self-directed)'):(r.lab?'Lab · ':'')+(account()==='agentic'?'Agentic':'Self-directed'))+' · '+r.label;
    if(wsMode&&routeKey!=='apexpaper')$('ex-context').textContent=IDENT[account()];
    if(routeKey==='apexpaper')$('ex-context').textContent='Apex v2.9 · paper research · not live';
    wsChrome(area,wsMode);
  }
  function protect() { if(window.__privScan)window.__privScan(); }
  function historyChart(points=M.valueHistory(window.__DATA,account()),combined=false) {
    if(points.length<2)return '<p class="ex-muted">At least two matching recorded dates for both accounts are needed to draw the combined history.</p>';
    const values=points.map(p=>p.equity),low=Math.min(...values),high=Math.max(...values),span=high-low||Math.max(Math.abs(high)*.01,1);
    const start=points[0],end=points[points.length-1];
    const coords=points.map(p=>[(16+(p.stamp-start.stamp)/(end.stamp-start.stamp)*608).toFixed(1),(20+(high-p.equity)/span*110).toFixed(1)]);
    const path=coords.map((p,i)=>(i?'L':'M')+p.join(' ')).join(' ');
    return '<div class="ex-history-head"><div><span class="ex-label">Latest recorded value</span><strong>'+money(end.equity)+'</strong></div><span class="ex-badge">'+points.length+' observations</span></div><div class="ex-private-chart"><svg class="ex-value-chart" viewBox="0 0 640 152" role="img" aria-label="Account value history; includes deposits and withdrawals"><path d="M16 20H624M16 75H624M16 130H624" class="ex-chart-grid"/><path d="'+path+' L624 145 L16 145 Z" class="ex-chart-area"/><path d="'+path+'" class="ex-chart-line"/><circle cx="'+coords[coords.length-1][0]+'" cy="'+coords[coords.length-1][1]+'" r="4" class="ex-chart-dot"/></svg></div><div class="ex-history-range"><span>'+esc(start.t.slice(0,10))+'</span><span>'+esc(end.t.slice(0,10))+'</span></div><p class="ex-muted">'+(combined?'Combined recorded equity on matching dates. ':'Account value. ')+'Includes deposits and withdrawals; this is not investment return. Last '+points.length+' observations.</p><details><summary>View dated values</summary><div class="ex-history-values">'+points.map(p=>row(p.t.slice(0,10),money(p.equity))).join('')+'</div></details>';
  }
  function allocationVisual(s) {
    const groups=M.composition(s.positions);
    if(!groups.length)return '';
    return '<div class="ex-allocation" aria-hidden="true">'+groups.map((p,i)=>'<span class="ex-slice ex-slice-'+i+'" style="width:'+p.share+'%"></span>').join('')+'</div><div class="ex-allocation-key">'+groups.map((p,i)=>'<div><i class="ex-slice-'+i+'"></i><span>'+esc(p.label)+'</span><strong>'+p.share.toFixed(1)+'%</strong></div>').join('')+'</div><p class="ex-muted">Share of priced long holdings · '+s.pricedCount+' / '+s.positions.length+' valued. Excludes cash and options.</p>';
  }
  function breadthVisual(s) {
    const b=s.breadth||M.breadth(s.positions),labels={up:'Up',down:'Down',flat:'Flat',missing:'No quote'};
    return '<div class="ex-breadth">'+Object.entries(b).map(([key,n])=>'<div class="ex-breadth-'+key+'"><strong>'+n+'</strong><span>'+labels[key]+'</span></div>').join('')+'</div>';
  }
  function timeline(events,empty) {
    return events.length?'<ol class="ex-timeline">'+events.map(e=>'<li><div><strong>'+esc(e.label)+'</strong><time>'+esc(date(e.at))+'</time></div>'+(e.detail?'<p class="ex-muted">'+esc(e.detail)+'</p>':'')+'</li>').join('')+'</ol>':'<div class="ex-empty">'+icon('activity')+'<p>'+esc(empty)+'</p></div>';
  }
  function renderToday() {
    const d=window.__DATA;
    const calendar=d&&typeof window._earnMap==='function'?window._earnMap():{};
    const s=M.dailyBrief(d,window.__SNAP,{calendar});
    if(window.PFToday){window.PFToday.render($('page-ex-today'),{data:d,snapshot:window.__SNAP,brief:s,historyHTML:()=>historyChart(s.history,true)});return;}
    const tone=n=>n===null||Math.abs(n)<.005?'neutral':n>0?'up':'down';
    const amount=n=>'<span class="ex-'+tone(n)+'">'+esc(money(n))+'</span>';
    const when=n=>n===0?'Today':n===1?'Tomorrow':'In '+n+' days';
    const cta=(scope,text)=>'<button type="button" class="ex-cta" data-ex-route="plan" data-ex-account="'+scope+'">'+esc(text)+'</button>';
    let html='<div class="ex-brief-heading"><div><div class="ex-label">Self-directed + Agentic</div><h1>Your daily brief.</h1><p class="ex-muted">The big picture, the drivers, and what deserves a closer look.</p></div><span class="ex-badge">'+esc(d?ageText(d.generatedAt):'Snapshot not loaded')+'</span></div>';
    if(!d||!s.available){$('page-ex-today').innerHTML=html+unavailable('Unlock your published snapshot to see both accounts together.');return;}
    html+='<div class="ex-brief-hero"><div><div class="ex-label">Combined '+(s.brokerageBasis?'brokerage':'account')+' equity</div><div class="ex-hero-value" id="ex-combined-equity">'+money(s.equity)+'</div><p class="ex-muted">'+(s.equity===null?'A combined total needs both account values.':'Self-directed + Agentic · net of account debt.')+'</p><div class="ex-hero-meta"><span>'+s.positions.length+' unique holdings</span><span>·</span><span>'+s.positions.filter(p=>p.shared).length+' held in both</span></div></div><div class="ex-move-tile"><div class="ex-label">Stock move'+(s.partialDay?' · partial quotes':'')+'</div><div class="ex-daily-value ex-'+tone(s.day)+'" id="ex-combined-move">'+money(s.day)+'</div><div class="ex-coverage" aria-hidden="true"><span style="width:'+(s.positionCount?s.dayCoverage/s.positionCount*100:0)+'%"></span></div><p class="ex-muted">'+s.dayCoverage+' / '+s.positionCount+' account positions quoted vs. previous close. Excludes option moves, trading and cash flows.</p></div></div>';
    html+='<div class="ex-account-grid">'+s.accounts.map(a=>'<section class="ex-account-card" data-brief-account="'+a.account+'"><div class="ex-account-head"><h2>'+a.label+'</h2>'+jump('accounts','Open portfolio',a.account)+'</div><div class="ex-account-value">'+money(a.equity)+'</div><div class="ex-account-facts">'+row('Stock move',amount(a.day),a.dayCoverage+' / '+a.positions.length+' positions quoted')+row(a.cash!==null&&a.cash<0?'Margin owed':'Cash',money(a.cash===null?null:Math.abs(a.cash)))+'</div><p class="ex-muted ex-account-date">Captured '+esc(date(a.accountAsOf))+'</p></section>').join('')+'</div>';
    html+='<div class="ex-cash-strip"><div><span class="ex-label">Positive cash</span><strong>'+money(s.positiveCash)+'</strong></div><div><span class="ex-label">Margin debt</span><strong>'+money(s.marginDebt)+'</strong></div><p class="ex-muted">Cash stays in its own account. It does not offset the other account’s margin loan here.</p></div>';
    const attention=s.attention.map(a=>'<div class="ex-radar-row '+(a.tone==='warn'?'ex-radar-warn':'')+'"><div><strong>'+esc(a.title)+'</strong><p class="ex-muted">'+esc(a.detail)+'</p></div>'+jump(a.route,'Review',a.account)+'</div>');
    html+='<div class="ex-brief-grid">'+card('On your radar',attention.length?attention.slice(0,3).join('')+(attention.length>3?'<details><summary>'+ (attention.length-3)+' more items</summary>'+attention.slice(3).join('')+'</details>':''):'<p class="ex-muted">No near-term calendar or ticket flags in the available records.</p>'+jump('plan','Open the plan','main'),true);
    const peak=Math.max(...s.contributors.map(p=>Math.abs(p.day)),1);
    const movers=s.contributors.map(p=>{
      const pct=Math.abs(p.day)/peak*100;
      const left=p.day<0?'<span class="ex-bar negative" style="width:'+pct+'%"></span>':'';
      const right=p.day>0?'<span class="ex-bar positive" style="width:'+pct+'%"></span>':'';
      return '<div class="ex-mover"><div class="ex-mover-label"><strong>'+esc(p.symbol)+'</strong><span class="ex-'+tone(p.day)+' money">'+esc(money(p.day))+'</span></div><div class="ex-diverging" aria-hidden="true"><div class="ex-div-half ex-div-left">'+left+'</div><i></i><div class="ex-div-half ex-div-right">'+right+'</div></div><small class="ex-mover-scope">'+esc(p.shared?'Both accounts':p.sources[0].label)+(p.partialDay?' · partial quotes':'')+'</small></div>';
    }).join('');
    html+=card('What drove your day',breadthVisual(s)+(movers||'<p class="ex-muted">Previous-close quotes are unavailable.</p>')+'<p class="ex-muted">Largest dollar moves on current stock holdings. Shared tickers combine both accounts; this is not full account P&amp;L.</p>');
    const marketNames={SPY:'S&P 500',QQQ:'Nasdaq 100',IWM:'Small caps'};
    const marketContent='<div class="ex-market-grid" data-priv="off">'+s.markets.map(m=>'<div><span>'+esc(marketNames[m.symbol])+' <small>'+m.symbol+'</small></span><strong class="ex-'+tone(m.change)+'">'+esc(percent(m.change))+'</strong></div>').join('')+'</div>'+row('VIX',s.vix.value===null?'Unavailable':s.vix.value.toFixed(1),s.vix.asOf?'As of '+s.vix.asOf:'Date not recorded')+'<p class="ex-muted">Captured quotes vs. previous close · '+esc(date(s.generatedAt))+'.</p>'+jump('markets','Explore markets');
    const events=s.options.expirations.filter(p=>p.days>=0&&p.days<=30).map(p=>({days:p.days,date:p.expiration,title:p.underlying+' '+p.type+' expiration',detail:money(M.number(p.strike))+' strike · '+p.contracts+' contracts · Self-directed',route:'options',scope:'main'}))
      .concat(s.earnings.map(e=>({days:e.days,date:e.date,title:e.symbol+' earnings',detail:e.accounts.join(' + ')+(e.when?' · '+e.when:''),route:'markets'}))).sort((a,b)=>a.days-b.days||a.title.localeCompare(b.title));
    const eventRows=rows=>rows.map(e=>'<div class="ex-event"><div class="ex-event-date"><strong>'+esc(when(e.days))+'</strong><span>'+esc(e.date)+'</span></div><div><strong>'+esc(e.title)+'</strong><p class="ex-muted">'+esc(e.detail)+'</p></div>'+jump(e.route,'View',e.scope)+'</div>').join('');
    html+=card('Market backdrop',marketContent+'<h3 class="ex-calendar-title">Coming up · next 30 days</h3>'+(events.length?eventRows(events.slice(0,4))+(events.length>4?'<details><summary>Show '+(events.length-4)+' more events</summary>'+eventRows(events.slice(4))+'</details>':''):'<p class="ex-muted">No dated earnings or option expirations in the next 30 days were found in this snapshot.</p>'));
    html+='<section class="ex-card"><h2>Options income &amp; exposure</h2><span class="ex-label">Self-directed · '+esc(s.options.year||'Year not recorded')+' realized options P&amp;L</span><div class="ex-option-result">'+amount(s.options.broker)+'</div><p class="ex-muted">'+(s.options.broker===null?'Broker total unavailable.':'Broker reported · '+esc(date(s.options.asOf)))+'</p>'+(s.options.positionsKnown?row('Open contracts',esc(String(s.options.open.reduce((n,p)=>n+Number(p.contracts),0)))+' contracts'):'<p class="ex-muted">Open positions are unavailable.</p>')+(s.options.open.length?row('Open position P&L',amount(s.options.openPnl),'Unrealized · quoted marks, before fees'):'')+(s.options.sharesCapped>0?row('Shares capped by calls',esc(s.options.sharesCapped)+' shares','Open + pending contracts'):'')+(s.options.cspCash>0?row('Put collateral',money(s.options.cspCash)):'')+'<p class="ex-muted">'+(s.options.reconciled?'Matched contract results reconcile to the broker total.':'Contract history is not fully reconciled.')+'</p>'+jump('options','Open options & history','main')+'</section>';
    const ag=s.accounts[1], dd=s.drawdown;
    html+=card('Agentic at a glance',row('Research dated',esc(s.target?.asOf||'Not recorded'),(M.researchCycle(s.target?.asOf)||{}).text||'')+row('Recorded ticket',esc(s.pending?.status?M.ticketStatus(s.pending).compact:ag.available?'No active ticket':'Unavailable'))+(dd?row('Deployment guard',esc(dd.insufficient?'Insufficient history':prettyStatus(dd.level)),M.number(dd.dd)!==null?'Recorded drawdown '+percent(dd.dd*100):''):'')+'<p class="ex-muted">Published research and execution records. Open the plan for current eligibility, deferrals and details.</p>'+cta('agentic','Open agentic plan')+jump('decisions','Research & sources','agentic'));
    const largest=s.positions.find(p=>p.value!==null),total=s.positions.reduce((n,p)=>n+(p.value||0),0),share=largest&&total>0?largest.value/total*100:0;
    html+=card('Where the weight sits',largest?'<div class="ex-exposure"><div class="ex-ring" style="--share:'+share.toFixed(1)+'%" role="img" aria-label="Largest holding represents '+share.toFixed(1)+' percent of priced long holdings"><div><strong>'+share.toFixed(0)+'%</strong><small>of longs</small></div></div><div><div class="ex-label">Largest combined holding</div><div class="ex-number">'+esc(largest.symbol)+'</div><div class="ex-holding-val">'+money(largest.value)+'</div><p class="ex-muted">'+(s.equity>0?(largest.value/s.equity*100).toFixed(1)+'% of combined equity. ':'')+esc(largest.shared?'Held in both accounts.':largest.sources[0].label+'.')+'</p></div></div>'+allocationVisual(s):'<p class="ex-muted">Position valuations are unavailable.</p>');
    html+=card('Combined value over time',historyChart(s.history,true));
    html+='<section class="ex-card ex-wide ex-brief-plans"><div><h2>Your next move</h2><p class="ex-muted">Open either account’s full plan from this shared brief.</p></div><div>'+cta('main','Open self-directed plan')+cta('agentic','Open agentic plan')+'</div></section>';
    html+='<details class="ex-wide ex-brief-method"><summary>Sources, coverage &amp; calculation notes</summary><p class="ex-muted">Combined equity uses each account’s published value, including account cash and option valuations, net of debt. '+(s.brokerageBasis?'The recorded brokerage basis excludes external prediction-market, futures and crypto sleeves.':'External sleeve coverage follows the recorded account basis and is not separately verified in this snapshot.')+' The stock move uses current quantities and captured prices against previous close; it does not reconstruct intraday trades, option changes, fees or cash flows. Cash and margin are shown separately across accounts. History sums only dates recorded for both accounts and includes deposits and withdrawals. Calendar coverage is limited to published records; no event listed does not mean no event exists.</p><p class="ex-muted">Snapshot published '+esc(date(s.generatedAt))+' · '+esc(ageText(s.generatedAt))+'. Options captured '+esc(date(s.options.positionsAsOf))+'.</p>'+jump('activity','Inspect data & routine status')+'</details></div>';
    $('page-ex-today').innerHTML=html;
  }
  function renderActivity() {
    const s=model(), d=window.__DATA, t=d?.agentic?.target, p=d?.agentic?.pending, last=d?.agentic?.lastTicket;
    const completed=last?.status==='done'?last:p?.status==='done'?p:null;
    const name=account()==='agentic'?'Agentic':'Self-directed';
    let html='<h1>See what actually happened.</h1><p class="ex-muted">Published records, with a clear view of what is available.</p>';
    html+='<div class="ex-status-strip"><div>'+icon('activity')+'<span class="ex-label">Published snapshot</span><strong>'+esc(d?ageText(d.generatedAt):'Not loaded')+'</strong></div><div><span class="ex-label">'+esc(name)+' account</span><strong>'+esc(s.available?'Present in snapshot':'Not available')+'</strong></div><div><span class="ex-label">Agentic ticket</span><strong>'+esc(p?.status?M.ticketStatus(p).compact:d?'No active ticket':'Not available')+'</strong></div></div>';
    html+='<div class="ex-grid">'+card('Published data',row('Snapshot',esc(d?'Loaded':'Not loaded'),d?date(d.generatedAt):'Unlock the snapshot first.')+row('Snapshot age',esc(ageText(d?.generatedAt)))+row('Selected account',esc(s.available?'Present in snapshot':'Not available'))+row('Agentic account as of',esc(date(d?.agentic?.asOf)))+note('This checks what the app received. Snapshot age is elapsed time, not a live broker or Routine health check.'));
    html+=card('Research & execution record',row('Agentic target',esc(t?.asOf || 'No target in this snapshot'))+row('Evidence coverage',esc(prettyStatus(t?.research?.status)))+row('Rebalance ticket',esc(p?.status ? M.ticketStatus(p).compact : d?'No active ticket':'Not available'))+row('Last recorded ticket',esc(last?.status?M.ticketStatus(last).label:'Not available'),last?.created?'Ticket dated '+esc(date(last.created)):'')+row(M.ticketStatus({status:'done'}).label,completed?.completedAt?esc(date(completed.completedAt)):'—',completed?.completedAt?M.ticketStatus({status:'done'}).caveat.replace(/^./,c=>c.toUpperCase()):'')+'<p class="ex-muted">These research and ticket records belong to the Agentic account.</p>'+jump('plan',account()==='agentic'?'Open the full plan':'Open selected account’s plan'));
    const events=[{label:'Snapshot published',at:d?.generatedAt,detail:'Data received by this app.'},{label:'Agentic account captured',at:d?.agentic?.asOf},{label:'Agentic research dated',at:t?.asOf}].filter(e=>M.age(e.at)!==null).sort((a,b)=>Date.parse(b.at)-Date.parse(a.at));
    html+=card('Published record timeline',timeline(events,'No dated records are available. Unlock a published snapshot to see them.')+'<p class="ex-muted">Dates from the snapshot; this is not a live execution feed.</p>');
    const timelineTicket=Array.isArray(p?.history)&&p.history.length?p:last;
    const history=(Array.isArray(timelineTicket?.history)?timelineTicket.history:[]).filter(h=>h && M.age(h.at)!==null).sort((a,b)=>Date.parse(a.at)-Date.parse(b.at)).slice(-12).reverse();
    const decisions=Array.isArray(d?.agentic?.decisions?.decisions)?d.agentic.decisions.decisions:[];
    const decisionEvents=history.length?[]:decisions.filter(q=>q && M.age(q.date)!==null).slice(0,6).map(q=>({label:(q.kind==='rebalance'?'Rebalance':'Deployment')+' decision recorded',at:q.date,detail:'Decision ledger only; broker fill status not independently verified'}));
    html+=card('Agentic ticket timeline',(timelineTicket?.id?'<p class="ex-muted">Ticket '+esc(timelineTicket.id)+' · '+esc(M.ticketStatus(timelineTicket).label)+'</p>':'')+
      timeline(history.length?history.map(h=>({label:h.to?M.ticketStatusFor(h.to,timelineTicket).label:'Recorded event',at:h.at})):decisionEvents,'No dated ticket history or decisions were included in this snapshot.')+
      (history.length?note('Recorded ticket stages; not independent proof of broker fills.'):decisionEvents.length?note('Only decision records were published; lifecycle stages are unavailable in this snapshot.'):''));

    html+=card('Decision history','<p>Review '+esc(name.toLowerCase())+' filled decisions, grading, and benchmark methodology.</p>'+jump('log','Open this account’s Rebalance Log'));
    html+=card('What this app cannot see','<details class="ex-telemetry"><summary>Live services · not in this app</summary>'+row('Live Claude Routine heartbeat','Not in this app')+row('Live broker check','Not in this app')+row('Push receipts','Not in this app')+note('A fresh snapshot means a producer run finished and was published. This screen cannot watch Claude Routine, Robinhood, or push while you hold the phone.')+'</details>');
    $('page-ex-activity').innerHTML=html+'</div>';
  }
  function renderDecisions() {
    const target=window.__DATA?.agentic?.target;
    let html='<h1>Understand the decision.</h1><p class="ex-muted">The recorded thesis and its sources, without replacing the original Plan.</p>';
    if(account()!=='agentic') {
      $('page-ex-decisions').innerHTML=html+card('Self-directed decisions','<p>The self-directed Action Center and Analyze retain their own mandate, technical signals, and rationale. The agentic research target belongs to a different account.</p>'+jump('plan','Open the self-directed plan')+jump('analyze','Analyze a holding')+jump('log','Review executed decisions')); return;
    }
    const names=Array.isArray(target?.names)?target.names:[];
    if(!names.length){ $('page-ex-decisions').innerHTML=html+unavailable('No research target was included in this snapshot.'); return; }
    html+='<p><span class="ex-badge">Research as of '+esc(target.asOf || 'unknown')+'</span></p>';
    html+=card('Construction rationale','<details><summary>Read the recorded portfolio rationale</summary><p>'+esc(target.researchSummary || target.method || 'Not recorded')+'</p></details>'+note('Research conclusions are recorded opinions. Coverage checks establish traceability, not independent verification.'));
    html+='<div class="ex-grid">'+names.map(n=>{
      const symbol=String(n.ticker||n.t||''), sources=M.evidence(target,symbol);
      const drivers=Array.isArray(n.drivers)?n.drivers.map(v=>typeof v==='string'?v:JSON.stringify(v)).join(' · '):'Not recorded';
      return card(symbol+' · target '+(M.number(n.weightPct)===null?'unknown':M.number(n.weightPct).toFixed(1)+'%'),
        '<p>'+esc(n.thesis || 'No thesis text was recorded.')+'</p>'+row('Entry zone',esc(typeof n.entry==='object'?JSON.stringify(n.entry):n.entry || 'Not recorded'))+row('Research stop / target',esc((n.stop ?? '—')+' / '+(n.target ?? '—')))+
        '<details><summary>Drivers, sources & dates</summary><p>'+esc(drivers)+'</p>'+(sources.length?sources.map(e=>'<div class="ex-evidence"><div class="ex-label">'+esc(e.sleeve)+' · '+esc(e.asOf || 'Date unavailable')+'</div><p>'+esc(e.claim)+'</p>'+(e.href?'<a href="'+esc(e.href)+'" target="_blank" rel="noopener noreferrer">Read source ↗</a>':'<span class="ex-muted">'+esc(e.source || 'Source unavailable')+'</span>')+'</div>').join(''):'<p>Claim-level source records are unavailable in this target. They have not been reconstructed or invented.</p>')+'</details>'+jump('plan','See current eligibility & deferrals'),false,symbol);
    }).join('')+'</div>'+note('Opposing evidence, tax estimates, and a complete do-nothing comparison are shown only where recorded. The stress test is hypothetical; it is not a forecast or recommendation.')+jump('log','Review the measured record');
    $('page-ex-decisions').innerHTML=html;
  }
  function renderCustom() {
    const openDetails=routeKey==='today'?[...$('page-ex-today').querySelectorAll('details[open]')].map(el=>el.querySelector('summary')?.textContent):[];
    const r=routes[routeKey]; if(r.custom==='today')renderToday();if(r.custom==='activity')renderActivity();if(r.custom==='decisions')renderDecisions();
    if(routeKey==='today')$('page-ex-today').querySelectorAll('details').forEach(el=>{el.open=openDetails.includes(el.querySelector('summary')?.textContent);});
    if(r.tab==='predictions')window.PFPredictions?.mount($('predictions-app'));
    if(r.tab==='smartmoney')window.PFSmartMoney?.mount($('smartmoney-app'));
    protect();
  }
  function queueRefresh() { clearTimeout(refreshTimer);refreshTimer=setTimeout(()=>{header();renderCustom();wsBlocks();document.dispatchEvent(new Event('pf:render'));},60); }
  function placeSection(section, token, attempts=0) {
    if(token!==jumpToken)return;
    const root=$(account()==='agentic'?'agentic-app':'app'), target=root?.querySelector('[data-sec="'+section+'"]');
    if(!target){if(attempts<12)setTimeout(()=>placeSection(section,token,attempts+1),100);return;}
    const title=target.querySelector('.card-title'), body=title?.dataset.toggle?$(title.dataset.toggle):target.querySelector('.card-body');
    if(body && body.style.display==='none'){if(window.__pfFold)window.__pfFold.open(target);else title?.click();}
    requestAnimationFrame(()=>{if(token!==jumpToken)return;const y=target.getBoundingClientRect().top+window.scrollY-(window.__pfTopOffset?.()||8);window.scrollTo(0,Math.max(0,y));});
  }
  // The Plan toggle mirrors the Accounts toggle without swapping #app / #agentic-app (v108), so after
  // Plan -> Back to Accounts the original reconciliation in switchTab saw the right page and left a
  // stale toggle. In a strategy-grouped nav a stale toggle would label one account over the other's
  // positions, so the visible page's toggle is brought into line with pf_acct through the native setters.
  function syncToggles(tab) {
    const pair=tab==='portfolio'?['acct-tg-agentic',nativeAccount]:tab==='picks'?['plan-tg-agentic',nativePlanAccount]:null,btn=pair&&$(pair[0]);
    if(btn&&btn.classList.contains('active')!==(account()==='agentic'))pair[1](account());
  }
  function navigate(key, options={}) {
    if(!known(key))return; document.dispatchEvent(new CustomEvent('pf:before-route',{detail:{from:routeKey,to:key}}));
    if(options.account==='main'||options.account==='agentic')save('pf_acct',options.account);
    origin=key==='analyze'&&(options.origin==='main'||options.origin==='agentic')?options.origin:null;
    routeKey=key; if(routes[key].account)save('pf_acct',routes[key].account);
    if(!routes[key].transient&&!(key==='analyze'&&origin))save('pf_area_'+areaOf(key,account()),key); save('pf_experience_route',key); if(key==='smartmoney'||key==='predictions')save('pf_signals_last',key); const r=routes[key],token=++jumpToken;
    ['today','activity','decisions'].forEach(n=>$('page-ex-'+n).hidden=r.custom!==n);
    navigating=true;
    try {
      if(r.tab){nativeSwitch(r.tab);syncToggles(r.tab);}
      else legacyTabs.forEach(t=>{const page=$('page-'+t);if(page)page.style.display='none';});
    } finally {navigating=false;}
    header();renderCustom();wsBlocks();
    // The Positions tab IS the holdings section now (cards, then the All Positions table): open at the top of it.
    if(r.section&&!(key==='holdings'&&wsOn()))placeSection(r.section,token);
    else if(!options.keepScroll)window.scrollTo(0,0);
    document.dispatchEvent(new CustomEvent('pf:route',{detail:{route:key,account:account()}}));
    // Existing Chart.js instances resize when their original page becomes visible.
    requestAnimationFrame(()=>{if(window.Chart?.instances)Object.values(Chart.instances).forEach(c=>{if(c.canvas?.offsetParent)c.resize();});});
  }
  // Existing Find, heatmap drill-downs, pins, and Plan links continue through the same entry point.
  window.switchTab=function(tab){
    if(navigating)return nativeSwitch(tab);
    const key={portfolio:'accounts',picks:'plan',markets:'markets',options:'options',analyze:'analyze',screens:'screens',predictions:'predictions',smartmoney:'smartmoney',apexpaper:'apexpaper'}[tab];
    return key?navigate(key):nativeSwitch(tab);
  };
  window.setAccount=function(...args){const changed=!navigating&&args[0]!==account();if(changed)document.dispatchEvent(new Event('pf:before-account'));const value=nativeAccount.apply(this,args);queueRefresh();if(changed)document.dispatchEvent(new Event('pf:account'));return value;};
  window.setPlanAccount=function(...args){const changed=!navigating&&args[0]!==account();if(changed)document.dispatchEvent(new Event('pf:before-account'));const value=nativePlanAccount.apply(this,args);queueRefresh();if(changed)document.dispatchEvent(new Event('pf:account'));return value;};
  $('ex-account').addEventListener('change',e=>navigate(routeKey,{account:e.target.value}));
  document.addEventListener('click',e=>{
    // Without the journey module the Research chip still opens Analyze (journey.js handles it, with the selected holding, when present).
    if(!window.PFJourney){const g=e.target.closest('[data-ex-research]');if(g)navigate('analyze');}
    if(e.target.closest('#ex-classic-more')){goClassic();return;}
    const wc=e.target.closest('[data-ws-card]');
    if(wc){ if(typeof window.__pfGoCard==='function')window.__pfGoCard(wc.dataset.wsCard.replace(/&amp;/g,'&'),wc.dataset.wsCardTab); return; }
    const wp=e.target.closest('[data-ws-pos]');
    if(wp){ if(window.PFJourney)window.PFJourney.select(wp.dataset.wsPos); wsRefresh(); return; }
    const b=e.target.closest('[data-ex-route],[data-ex-area]');if(!b)return;
    const area=b.dataset.exArea;
    // Apex always means pf_acct='main' and Agentic always 'agentic'; the existing switchTab reconciliation
    // then drives setAccount / setPlanAccount so the Accounts toggle, Plan toggle and header select agree.
    if(area)navigate(areaDefault(area),{account:area==='apex'?'main':area==='agentic'?'agentic':undefined});
    else navigate(b.dataset.exRoute,{account:b.dataset.exAccount});
  });
  $('ex-find').addEventListener('click',()=>{if(window.__pfFind)window.__pfFind();});
  $('ex-classic').addEventListener('click',goClassic);
  // ── v242 workspace (owner, Nov 17 2026: "I see more navigation than investment information") ─────────────────────────────────
  // Display and organisation only. One compact header, one tab row (Overview · Positions · Research · Actions) for Apex and Agentic,
  // freshness stamps, a position card, and an action list. Nothing here calculates a number the app does not already calculate: it reads
  // the table's own rows (window.__pfPosRows), the Apex review (window.__PF_APEX_REVIEW through Apex.bookLines / bookReviews / exitLevelsFor),
  // the agentic target rows the plan already shows (window.__PF_AG_TARGET), the existing snapshot tiles (cloned) and Today's read-only model.
  const AREA_NAME = {apex:'Apex', agentic:'Agentic', research:'Research', more:'More'};
  const IDENT = {main:'Self-directed · ••••0741', agentic:'Automated · ••••3900'};
  const WS_TABS = [['overview','Overview','accounts'],['positions','Positions','holdings'],['research','Research','acctresearch'],['actions','Actions','plan']];
  const wsTab = key => key==='holdings'?'positions':key==='plan'?'actions':(key==='analyze'||key==='acctresearch')?'research':key==='apexpaper'?'':'overview';
  const wsOn = () => { const a=areaOf(routeKey,account()); return (a==='apex'||a==='agentic')&&routeKey!=='today'&&routeKey!=='apexpaper'; };
  const fD = n => typeof window.fmtD==='function'?window.fmtD(n):'—';
  const fP = n => typeof window.fmtP==='function'?window.fmtP(n):'—';
  const fN = (n,d) => typeof window.fmt==='function'?window.fmt(n,d):'—';
  const fS = n => typeof window.sc==='function'?window.sc(n):'neu';
  let stampList = [];
  function wsChrome(area, ws) {
    const root=document.documentElement, today=routeKey==='today';
    root.classList.toggle('ws-on',ws); root.classList.toggle('ws-chrome',!today);
    if(ws)root.dataset.wsTab=wsTab(routeKey); else delete root.dataset.wsTab;
    const brand=top.querySelector('.ex-brand'), want=today?'today':area;
    if(brand&&brand.dataset.wsFor!==want){brand.dataset.wsFor=want;brand.innerHTML=today?'Portfolio <span>/</span>':esc(AREA_NAME[area]||'Portfolio');}
    $('ex-classic').hidden=!today; // Classic view now lives in More; Today's own header is unchanged.
    wsStamps(ws);
  }
  // Three clocks, never blended: the account snapshot, the research behind the plan, the last completed scan. A stamp with no real
  // source for this account is not drawn. Stale ones keep the freshness bar's warning colours and a ⚠.
  function wsStamps(ws) {
    const box=$('ws-stamps'); if(!box)return; box.hidden=!ws; if(!ws){stampList=[];return;}
    stampList=M.freshnessStamps(window.__DATA,account(),{apexTarget:window.__APEX_TGT});
    const html=stampList.map(s=>'<span class="ws-stamp" data-stamp="'+s.key+'" data-state="'+s.state+'"><i>'+esc(s.label)+'</i> <b>'+(s.state==='stale'?'⚠ ':'')+esc(s.text)+(s.dateOnly?' <em>(date only)</em>':'')+'</b></span>').join('');
    if(box.innerHTML!==html)box.innerHTML=html;
  }
  const stampOf = key => stampList.find(s=>s.key===key)||null;
  let apexTried = '';
  // The Apex review the Plan and Today already compute. Read-only; renders the card once only if nothing has yet.
  function apexBook() {
    try {
      if(!window.Apex||!window.__SNAP||!window.__DATA)return null;
      const ok=c=>c&&c.sourceData===window.__DATA&&c.sourceSnap===window.__SNAP&&c.generatedAt===window.__DATA.generatedAt;
      let c=window.__PF_APEX_REVIEW;
      if(!ok(c)&&typeof window.renderApexCard==='function'&&apexTried!==window.__DATA.generatedAt){apexTried=window.__DATA.generatedAt;window.renderApexCard(window.__SNAP,{fromToday:true});c=window.__PF_APEX_REVIEW;}
      if(!ok(c))return null;
      return {c,lines:window.Apex.bookLines(c.st,c.out,c.cfg),reviews:window.Apex.bookReviews(c.st,c.out,c.cfg)};
    } catch(_) { return null; }
  }
  const qtyLabel = line => { const m=/^(Buy|Add|Sell) (\d[\d,.]*)( .+)$/.exec(line.text); return m?esc(m[1])+' <span data-priv="val">'+esc(m[2])+'</span>'+esc(m[3]):'<span data-priv="val">'+esc(line.text)+'</span>'; };
  const dataAttr = (route, acct) => 'data-ex-route="'+route+'"'+(acct?' data-ex-account="'+acct+'"':'');
  // The prioritised list. Every row comes from an item the app already produces for THIS account; each is one line, a small source
  // label and a tap target into the existing destination. Order: waiting on you, out of your hands, risk, options. No research-change
  // category: the app has no research-change notice to read.
  function actionItems() {
    const d=window.__DATA, acct=account(), items=[]; if(!d)return items;
    const calendar=typeof window._earnMap==='function'?window._earnMap():{};
    const brief=M.dailyBrief(d,window.__SNAP,{calendar}), T=window.PFTodayModel, label=acct==='agentic'?'Agentic':'Self-directed';
    const mine=a=>!a.account||a.account===acct;
    if(acct==='main') {
      const book=apexBook();
      if(book) {
        book.lines.slice(0,3).forEach(l=>items.push({cat:'waiting',html:qtyLabel(l)+(l.px?' <span class="ws-px">· '+esc(l.px)+'</span>':''),src:'Waiting on you · Confirm with Claude',go:dataAttr('plan')}));
        if(book.lines.length>3)items.push({cat:'waiting',html:'+'+(book.lines.length-3)+' more proposed trade'+(book.lines.length-3===1?'':'s'),src:'Waiting on you · Confirm with Claude',go:dataAttr('plan')});
        if(book.reviews.length)items.push({cat:'waiting',html:book.reviews.length+' review-only item'+(book.reviews.length===1?'':'s')+' · no orders',src:'Waiting on you · Apex review',go:dataAttr('plan')});
      }
    } else if(T) {
      const t=T.ticket(brief.pending);
      if(brief.pending?.status&&t.group==='waiting')items.push({cat:'waiting',html:esc(t.label),src:'Waiting on you · Agentic ticket',go:dataAttr('plan','agentic')});
      else if(brief.pending?.status&&t.group==='monitor')items.push({cat:'flight',html:esc(t.compact),src:'Out of your hands · recorded status',go:dataAttr('plan','agentic')});
    }
    brief.earnings.filter(e=>e.days<=7&&(e.accounts||[]).includes(label)).forEach(e=>items.push({cat:'waiting',html:esc(e.symbol)+' earnings · '+esc(e.days===0?'Today':e.days===1?'Tomorrow':'In '+e.days+' days'),src:'Waiting on you · Calendar',go:'data-pj-go="analyze" data-pj-sym="'+esc(e.symbol)+'"'}));
    brief.attention.filter(a=>mine(a)&&!a.title.startsWith('Agentic ticket:')&&a.title!=='Earnings in the week ahead').forEach(a=>{
      const opt=a.route==='options';
      if(opt&&acct!=='main')return;
      items.push({cat:opt?'options':'risk',html:esc(a.title),src:(opt?'Options · ':'Risk · ')+(opt?'self-directed':a.route==='activity'?'data check':'guard'),go:dataAttr(a.route==='markets'?'plan':a.route,a.account||undefined),warn:a.tone==='warn'});
    });
    if(acct==='main') {
      const book=apexBook();
      if(book){
        book.c.out.filter(r=>(r.kind==='risk'||r.kind==='lev')).forEach(r=>items.push({cat:'risk',html:esc(r.title),src:'Risk · Apex',go:dataAttr('plan'),warn:true}));
        try{ const th=window.Apex.themeShare(book.c.st,book.c.cfg); if(book.c.cfg.themeCap!==false&&th&&th.over)items.push({cat:'risk',html:'Tech outside '+esc(book.c.cfg.core||'core')+' over its '+Math.round(window.Apex.C.THEME_MAX*100)+'% cap',src:'Risk · Apex theme cap',go:dataAttr('acctresearch'),warn:true}); }catch(_){}
      }
      brief.options.expirations.filter(p=>p.days>=0&&p.days<=7).forEach(p=>items.push({cat:'options',html:esc(p.underlying)+' '+esc(M.number(p.strike)===null?'':'$'+M.number(p.strike))+' '+esc(String(p.type||'').toLowerCase())+' · expires '+esc(p.days===0?'today':p.expiration),src:'Options · expiration is a calendar event',go:dataAttr('options','main')}));
    } else {
      const dd=brief.drawdown; if(dd&&!dd.insufficient&&['soft','hard'].includes(dd.level)&&!items.some(i=>/deployment guard/i.test(i.html)))items.push({cat:'risk',html:'Agentic deployment guard is active',src:'Risk · Agentic',go:dataAttr('plan','agentic'),warn:true});
    }
    const rank={waiting:0,flight:1,risk:2,options:3};
    return items.map((it,i)=>({...it,i})).sort((a,b)=>rank[a.cat]-rank[b.cat]||a.i-b.i);
  }
  const catLabel = {waiting:'Waiting on you',flight:'Out of your hands',risk:'Risk',options:'Options'};
  function actionsHTML() {
    const items=actionItems();
    return '<h2 class="ws-h">Action Center'+(items.length?' <span class="ws-count" aria-label="'+items.length+' items">'+items.length+'</span>':'')+'</h2>'+(items.length
      ?'<div class="ws-acts" role="list">'+items.map((it,n)=>'<button type="button" role="listitem" class="ws-act" data-cat="'+it.cat+'"'+(it.warn?' data-warn="1"':'')+' '+it.go+'><em aria-hidden="true">'+(n+1)+'</em><span class="ws-act-t">'+it.html+'<small>'+esc(it.src)+'</small></span><span aria-hidden="true" class="ws-chev">›</span></button>').join('')+'</div>'
      :'<p class="ws-empty"><strong>Nothing needs you</strong><span>No waiting, risk or options items in the published records.</span></p>');
  }
  function moreHTML() {
    // v255 (Jack, Nov 18 2026: never uses What if, "can be removed everywhere"): the What if? row is gone, so Agentic has no rows left.
    const acct=account(); if(acct!=='main')return null;
    return '<h2 class="ws-h">More in Overview</h2><div class="ws-rows">'+(acct==='main'?'<button type="button" class="ws-row" data-ws-card="Options Income &amp; History" data-ws-card-tab="options"><span>Options income &amp; history</span><span aria-hidden="true">›</span></button>':'')+(acct==='main'?'<button type="button" class="ws-row" '+dataAttr('apexpaper')+'><span>v2.9 Paper research</span><span aria-hidden="true">›</span></button>':'')+'</div>';
  }
  // ── Position card ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
  function posCard(r, o) {
    const sym=esc(r.symbol), acct=account(), open=o.open;
    const next=o.next?'<p class="ws-next"><span>Next</span><b>'+o.next+'</b></p>':'<p class="ws-next"><span>Next</span><b>—</b></p>';
    const head='<div class="ws-pos-h"><b class="ws-sym">'+sym+'</b><span class="ws-pos-px">'+(r.px?'$'+fN(r.px):'—')+'</span><span class="ws-pos-w">'+(r.pct!=null?fN(r.pct,1)+'% of book':'— of book')+'</span></div>';
    if(!open)return '<button type="button" class="ws-pos ws-compact" data-ws-pos="'+sym+'" aria-label="Show '+sym+' details">'+head+'<div class="ws-pos-s"><span class="'+fS(r.pnlP)+'">'+(r.pnlP==null?'—':fP(r.pnlP))+'</span><span>'+fD(r.val)+'</span></div>'+next+'</button>';
    const cell=(l,v,cls)=>'<div><dt>'+l+'</dt><dd'+(cls?' class="'+cls+'"':'')+'>'+v+'</dd></div>';
    const day=(r.dayD!=null?fD(r.dayD):'—')+(r.dayP!=null?' · '+fP(r.dayP):'');
    const grid=cell('Value',fD(r.val))+cell('Total gain',fD(r.pnlD),fS(r.pnlD))+cell('Return',r.pnlP==null?'—':fP(r.pnlP),fS(r.pnlP))+cell('Today',day,fS(r.dayD!=null?r.dayD:r.dayP))
      +cell('Risk',r.r?'<span title="Position concentration label; not a trading instruction">'+esc(r.r.level)+'</span>':'—')
      +(acct==='agentic'?cell('Target · drift',o.tgt?fN(o.tgt.tgt,1)+'% · '+(o.tgt.drift>0?'+':'')+fN(o.tgt.drift,1)+'pp':'—')
        :cell('Stop · target',o.levels?(o.levels.stop>0?fD(o.levels.stop):'—')+' · '+(o.levels.tp1>0?fD(o.levels.tp1):'—'):'—'));
    return '<article class="ws-pos ws-open" data-ws-sym="'+sym+'"'+(o.selected?' data-selected="1"':'')+'>'+head+'<dl class="ws-grid">'+grid+'</dl>'+next
      +'<p class="ws-research"><span>Research</span><b>'+(o.research||'—')+'</b></p>'
      +'<nav class="ws-stage" aria-label="'+sym+' stages"><span aria-current="step">Holding</span><i aria-hidden="true"></i><button type="button" data-pj-go="analyze" data-pj-sym="'+sym+'">Research · View thesis</button><i aria-hidden="true"></i><button type="button" data-pj-go="plan" data-pj-sym="'+sym+'" data-pj-focus="'+sym+'">Plan · Review plan</button></nav></article>';
  }
  // The per-row context a position card shows (next action, levels, research stamp, agentic target) — one source for the Positions list
  // and Book's selected-holding block (v248).
  function posOpts(r, acct) {
    const o={};
    const rs=stampOf('research'), rsTxt=rs?(rs.state==='stale'?'⚠ ':'')+esc(rs.text)+(rs.dateOnly?' (date only)':''):'';
    if(acct==='main'){
      const book=apexBook(), T=window.__APEX_TGT;
      const line=book?.lines.find(l=>l.sym===r.symbol), core=book?.c.out.find(x=>x.kind==='core'&&String(x.title).startsWith(r.symbol+' ')), rev=book?.reviews.find(x=>x.sym===r.symbol);
      o.next=line?qtyLabel(line)+(line.px?' <span class="ws-px">· '+esc(line.px)+'</span>':''):core?esc(core.title):rev?esc(rev.why):'';
      try{ o.levels=book?window.Apex.exitLevelsFor(book.c.cfg,r.symbol):null; }catch(_){ o.levels=null; }
      const held=Array.isArray(T?.heldLevels)&&T.heldLevels.some(x=>x&&x.sym===r.symbol), entry=Array.isArray(T?.top5)&&T.top5.some(x=>x&&x.sym===r.symbol);
      o.research=(held||entry)&&rsTxt?(held?'Held-name research record':'New-entry research')+' · '+rsTxt:'';
    } else {
      const agT=window.__PF_AG_TARGET, names=window.__DATA?.agentic?.target?.names;
      o.tgt=agT?.rows?.find(x=>x.sym===r.symbol)||null;
      o.next=o.tgt?esc(o.tgt.status):'';
      o.research=o.tgt&&rsTxt&&Array.isArray(names)&&names.some(x=>x&&x.ticker===r.symbol)?'Target research · '+rsTxt:'';
    }
    return o;
  }
  function posCards() {
    const acct=account(), rows=(typeof window.__pfPosRows==='function'?window.__pfPosRows(acct):[]).filter(r=>r&&r.symbol);
    if(!rows.length)return '<p class="ws-empty"><strong>No open positions</strong><span>'+(acct==='agentic'&&!Array.isArray(window.__DATA?.agentic?.positions)?'Agentic holdings unavailable in this snapshot.':'Nothing to show for this account.')+'</span></p>';
    const sel=window.PFJourney?.state?.symbol||'';
    const ordered=rows.slice().sort((a,b)=>(a.symbol===sel?-1:b.symbol===sel?1:0)||((b.val==null?-1:b.val)-(a.val==null?-1:a.val)));
    return '<h2 class="ws-h">Positions <span class="ws-count">'+rows.length+'</span></h2>'+ordered.map((r,n)=>posCard(r,{...posOpts(r,acct),open:n===0,selected:r.symbol===sel})).join('');
  }
  // v248 Book: a holding tapped on the left page (ui/book.js sets window.__pfBookPick) opens at the top of Overview's right page.
  function selectedHTML() {
    const acct=account(), pick=window.__pfBookPick;
    if(document.documentElement.getAttribute('data-book')!=='on'||!pick||pick.acct!==acct)return null;
    const r=(typeof window.__pfPosRows==='function'?window.__pfPosRows(acct):[]).find(x=>x&&x.symbol===pick.sym);
    if(!r)return null;
    return '<h2 class="ws-h"><span>Selected</span><button type="button" data-bk-clear aria-label="Close the selected holding">✕ Close</button></h2>'+posCard(r,{...posOpts(r,acct),open:true,selected:true});
  }
  // ── placing the blocks (inside the active account's root, so a re-render of that root removes them and they are re-added) ──────
  function placeBlock(root, id, html, after) {
    let el=root.querySelector(':scope>#'+id);
    if(html===null){ if(el)el.remove(); return null; }
    if(!el){ el=document.createElement('section'); el.id=id; el.className='ws-block ws-'+id.slice(3); }
    if(el.dataset.src!==html){el.innerHTML=html;el.dataset.src=html;}   // privacy masking rewrites the text in place; compare the source, not the DOM
    if(el.previousElementSibling!==after)after.after(el);
    return el;
  }
  // v253 Research tab: one slim row into single-stock Analyze (the existing route; the journey opens it for the selected name and keeps
  // this tab lit), at the top of the account's research page. Removed everywhere else, so Actions and Classic view never show it.
  function researchEntry(ws, acct) {
    const on=ws&&routeKey==='acctresearch';
    ['picks-app','plan-agentic-app'].forEach(id=>{
      const root=$(id); if(!root)return;
      let el=root.querySelector(':scope>#ws-analyze');
      if(!on||id!==(acct==='agentic'?'plan-agentic-app':'picks-app')||!root.children.length){ if(el)el.remove(); return; }
      if(!el){ el=document.createElement('section'); el.id='ws-analyze'; el.className='ws-block ws-analyze';
        el.innerHTML='<div class="ws-rows"><button type="button" class="ws-row" data-pj-go="analyze" data-ex-research><span>Analyze a stock <small>technical + fundamental read for one name</small></span><span aria-hidden="true">›</span></button></div>'; }
      const hero=root.querySelector(':scope>.picks-hero');
      if(hero){ if(hero.nextElementSibling!==el)hero.after(el); } else if(root.firstElementChild!==el)root.prepend(el);
    });
  }
  let blocksBusy = false;
  function wsBlocks() {
    if(blocksBusy)return; blocksBusy=true;
    try {
      const ws=wsOn(), acct=account();
      document.querySelectorAll('#app>.ws-block,#agentic-app>.ws-block').forEach(n=>{ if(!ws||n.parentElement.id!==(acct==='agentic'?'agentic-app':'app'))n.remove(); });
      researchEntry(ws,acct);
      if(!ws)return;
      const root=$(acct==='agentic'?'agentic-app':'app'), hdr=root?.querySelector(':scope>.header'); if(!root||!hdr)return;
      const tab=wsTab(routeKey);
      if(tab==='overview') {
        // The snapshot's own Day change / Leverage (or Idle cash) tiles, cloned: the same rendered figures, no second calculation.
        const labels=acct==='agentic'?['Idle Cash']:['Day Change','Leverage'];
        const tiles=[...(root.querySelectorAll(':scope>[data-sec="snapshot"] .snap'))].filter(t=>labels.includes((t.querySelector('.snap-lbl')?.textContent||'').trim()));
        let strip=root.querySelector(':scope>#ws-strip'), sig=tiles.map(t=>t.outerHTML.replace(' data-book-dup=""','')).join('');
        if(!strip||strip.dataset.sig!==sig){ const n=document.createElement('section'); n.id='ws-strip'; n.className='ws-block ws-strip'; n.dataset.sig=sig; n.setAttribute('aria-label','Account summary'); tiles.forEach(t=>{const k=t.cloneNode(true);k.removeAttribute('data-book-dup');n.appendChild(k);}); if(strip)strip.replaceWith(n); else hdr.after(n); strip=n; }
        if(!tiles.length)strip.remove();
        const lead=tiles.length?strip:hdr, picked=placeBlock(root,'ws-selected',selectedHTML(),lead), prev=picked||lead;
        const act=placeBlock(root,'ws-actions',actionsHTML(),prev), more=placeBlock(root,'ws-more',moreHTML(),act);
        placeBlock(root,'ws-poscards',null,more);
      } else if(tab==='positions') {
        ['ws-strip','ws-selected','ws-actions','ws-more'].forEach(id=>placeBlock(root,id,null,hdr));
        placeBlock(root,'ws-poscards',posCards(),hdr);
      } else ['ws-strip','ws-selected','ws-actions','ws-more','ws-poscards'].forEach(id=>placeBlock(root,id,null,hdr));
      protect();
    } finally { blocksBusy=false; }
  }
  let blocksTimer;
  const wsRefresh = () => { clearTimeout(blocksTimer); blocksTimer=setTimeout(wsBlocks,60); };
  // Plan scrolled to a holding: the first visible row that names it, in the account's own plan page.
  function focusPlan(sym, attempts=0) {
    const root=$(account()==='agentic'?'plan-agentic-app':'picks-app'); if(!root||!sym)return;
    const re=new RegExp('(^|[^A-Za-z0-9.])'+String(sym).replace(/[.]/g,'\\.')+'($|[^A-Za-z0-9])');
    const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT); let n, hit=null;
    while((n=walker.nextNode())){ if(!re.test(n.nodeValue))continue; const el=n.parentElement; if(!el||!el.offsetParent)continue; hit=el.closest('tr,li,details.tg-row,.ac-row,.xr-row')||el; break; }
    if(!hit){ if(attempts<15)setTimeout(()=>focusPlan(sym,attempts+1),120); return; }
    const y=hit.getBoundingClientRect().top+window.scrollY-(window.__pfTopOffset?.()||8)-8;
    window.scrollTo(0,Math.max(0,y));
    const prev=hit.style.boxShadow; hit.style.boxShadow='0 0 0 2px #6366f1'; setTimeout(()=>{hit.style.boxShadow=prev;},900);
  }
  const observe=new MutationObserver(queueRefresh);
  ['app','agentic-app'].forEach(id=>{if($(id))observe.observe($(id),{childList:true});});
  // The blocks read renderers that finish after the page root is replaced (the position table, the Apex card, the agentic target), so a
  // late change anywhere under the four account roots refreshes them. Our own writes are ignored.
  const wsWatch=new MutationObserver(records=>{ if(records.some(r=>!r.target.closest?.('.ws-block')&&![...r.addedNodes,...r.removedNodes].every(n=>n.nodeType===1&&n.classList?.contains('ws-block'))))wsRefresh(); });
  ['app','agentic-app','picks-app','plan-agentic-app'].forEach(id=>{if($(id))wsWatch.observe($(id),{childList:true,subtree:true});});
  document.addEventListener('change',e=>{if(e.target.id==='pj-symbol')wsRefresh();});
  if(window.__dataReady?.then)window.__dataReady.then(queueRefresh,queueRefresh);
  // Keep ET event countdowns and snapshot age current in a resident PWA.
  document.addEventListener('visibilitychange',()=>{if(!document.hidden&&routeKey==='today')queueRefresh();});
  setInterval(()=>{if(!document.hidden&&routeKey==='today')queueRefresh();},60000);
  window.__experienceRefresh=queueRefresh;
  window.PFExperience=Object.freeze({navigate,focusPlan,refreshBlocks:wsBlocks,actionsHTML:()=>actionsHTML(),get route(){return routeKey;},get account(){return account();},get origin(){return origin;},get area(){return areaOf(routeKey,account());}});
  navigate(routeKey,{keepScroll:true});
})();
