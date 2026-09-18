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
  const date = value => { const d = value ? new Date(value) : null; return d && Number.isFinite(d.getTime()) ? d.toLocaleString() : 'Not recorded'; };
  const ageText = iso => { const n = M.age(iso); return n === null ? 'Age unavailable' : n < 60 ? Math.floor(n)+' min old' : n < 1440 ? (n/60).toFixed(1)+' hours old' : Math.floor(n/1440)+' days old'; };
  const routes = {
    today: {area:'today', label:'Daily brief', custom:'today'},
    accounts: {area:'portfolio', label:'Accounts overview', tab:'portfolio'},
    holdings: {area:'portfolio', label:'All positions', tab:'portfolio', section:'holdings'},
    performance: {area:'portfolio', label:'Performance', tab:'portfolio', section:'performance'},
    heatmap: {area:'portfolio', label:'Heatmap', tab:'portfolio', section:'heatmap'},
    risk: {area:'portfolio', label:'Risk & allocation', tab:'portfolio', section:'risk'},
    income: {area:'portfolio', label:'Income & tax', tab:'portfolio', section:'income'},
    options: {area:'portfolio', label:'Options', tab:'options'},
    plan: {area:'research', label:'Plan & Action Center', tab:'picks'},
    markets: {area:'research', label:'Markets', tab:'markets'},
    analyze: {area:'research', label:'Analyze', tab:'analyze'},
    technicals: {area:'portfolio', label:'Technicals', tab:'portfolio', section:'technicals'},
    fundamentals: {area:'portfolio', label:'Fundamentals', tab:'portfolio', section:'fundamentals'},
    flow: {area:'portfolio', label:'Flow & positioning', tab:'portfolio', section:'flow'},
    decisions: {area:'research', label:'Decision evidence', custom:'decisions'},
    scenario: {area:'research', label:'What if?', custom:'scenario'},
    activity: {area:'activity', label:'Snapshot & routine status', custom:'activity'},
    log: {area:'activity', label:'Rebalance log', tab:'portfolio', section:'rebalance-log'}
  };
  const defaults = {today:'today',portfolio:'accounts',research:'plan',activity:'activity'};
  const legacyTabs = ['portfolio','markets','picks','options','analyze'];
  const nativeSwitch = window.switchTab;
  const nativeAccount = window.setAccount;
  const nativePlanAccount = window.setPlanAccount;
  let routeKey = routes[read('pf_experience_route','today')] ? read('pf_experience_route','today') : 'today';
  let navigating = false, refreshTimer, jumpToken = 0;
  const account = () => read('pf_acct','main') === 'agentic' ? 'agentic' : 'main';
  const model = () => M.snapshot(window.__DATA, window.__SNAP, account());
  const jump = (key, text) => '<button type="button" class="ex-link" data-ex-route="'+key+'">'+esc(text || routes[key].label)+' →</button>';
  const row = (label, value, detail = '') => '<div class="ex-row"><span>'+esc(label)+(detail?'<small>'+esc(detail)+'</small>':'')+'</span><span>'+value+'</span></div>';
  const card = (title, html, wide = false) => '<section class="ex-card'+(wide?' ex-wide':'')+'"><h2>'+esc(title)+'</h2>'+html+'</section>';
  const note = text => '<div class="ex-note">'+esc(text)+'</div>';
  const unavailable = text => note(text || 'Unlock a published snapshot to view this account.');
  function goClassic() { save('pf_classic','1'); location.reload(); }
  if (read('pf_classic','0') === '1') {
    const back = document.createElement('button'); back.className='ex-btn ex-classic-return'; back.textContent='Open new navigation';
    back.addEventListener('click',()=>{ save('pf_classic','0'); location.reload(); }); document.body.append(back); return;
  }
  const top = document.createElement('header'); top.className='ex-top'; top.id='ex-top';
  top.innerHTML='<div><div class="ex-brand">Portfolio <span>/</span></div><div class="ex-caption" id="ex-context">Your accounts, research, and activity</div></div><div class="ex-tools"><label>Account <select id="ex-account" aria-label="Account"><option value="main">Self-directed</option><option value="agentic">Agentic</option></select></label><button type="button" id="ex-find">Find a feature</button><button type="button" id="ex-classic" title="Return to the original five-tab layout">Classic view</button></div>';
  const main = document.createElement('nav'); main.className='ex-main'; main.setAttribute('aria-label','Main navigation');
  main.innerHTML='<div class="ex-wordmark">PORTFOLIO</div>'+Object.keys(defaults).map(a=>'<button type="button" data-ex-area="'+a+'" aria-current="false">'+a[0].toUpperCase()+a.slice(1)+'</button>').join('');
  const sub = document.createElement('nav'); sub.id='ex-subnav'; sub.className='ex-subnav'; sub.setAttribute('aria-label','Section navigation');
  const first = $('tabbar'); first.before(top,main,sub);
  ['today','activity','decisions','scenario'].forEach(name=>{
    const page=document.createElement('section'); page.id='page-ex-'+name; page.className='ex-page'; page.dataset.priv='on'; page.hidden=true; sub.after(page);
  });
  document.documentElement.classList.add('experience-on');
  function header() {
    const r=routes[routeKey]; $('ex-account').value=account();
    main.querySelectorAll('[data-ex-area]').forEach(b=>b.setAttribute('aria-current',b.dataset.exArea===r.area?'page':'false'));
    sub.innerHTML=Object.entries(routes).filter(([,v])=>v.area===r.area).map(([k,v])=>'<button type="button" data-ex-route="'+k+'" aria-current="'+(k===routeKey?'page':'false')+'">'+esc(v.label)+'</button>').join('');
    $('ex-context').textContent=r.tab==='options'?'Options · self-directed source (existing contracts and ideas)':(account()==='agentic'?'Agentic':'Self-directed')+' · '+r.label;
  }
  function protect() { if(window.__privScan)window.__privScan(); }
  function renderToday() {
    const s=model(), d=window.__DATA, name=account()==='agentic'?'Agentic':'Self-directed';
    let html='<h1>Your daily brief.</h1><p class="ex-muted">'+esc(name)+' · '+esc(d?.generatedAtLabel || 'No published snapshot loaded')+'</p>';
    if(!s.available){ $('page-ex-today').innerHTML=html+unavailable(); return; }
    const largest=s.positions.find(p=>p.value!==null), weight=largest && s.equity>0?largest.value/s.equity*100:null;

    const dayLabel=s.partialDay?'Holdings move · partial':'Holdings move';
    const tone=s.day===null?'neutral':s.day>0?'up':s.day<0?'down':'neutral';
    const total=s.positions.reduce((sum,p)=>sum+(p.value||0),0);
    const share=largest&&total>0?largest.value/total*100:0;
    const peak=Math.max(...s.contributors.map(p=>Math.abs(p.day)),1);
    const movers=s.contributors.map(p=>{
      const pct=Math.abs(p.day)/peak*100;
      const cls=p.day>0?'up':p.day<0?'down':'neutral';
      const left=p.day<0?'<span class="ex-bar negative" style="width:'+pct+'%"></span>':'';
      const right=p.day>0?'<span class="ex-bar positive" style="width:'+pct+'%"></span>':'';
      return '<div class="ex-mover"><div class="ex-mover-label"><strong>'+esc(p.symbol)+'</strong><span class="ex-'+cls+' money">'+esc(money(p.day))+'</span></div><div class="ex-diverging" aria-hidden="true"><div class="ex-div-half ex-div-left">'+left+'</div><i></i><div class="ex-div-half ex-div-right">'+right+'</div></div></div>';
    }).join('');
    const cashChip=s.cash!==null && s.cash<0
      ? '<span class="ex-chip warn">Margin '+esc(money(s.cash))+'</span>'
      : '<span>Cash '+esc(money(s.cash))+'</span>';
    const cta=(key,text)=>'<button type="button" class="ex-cta" data-ex-route="'+key+'">'+esc(text)+'</button>';
    html+='<div class="ex-brief-hero"><div><div class="ex-label">Account value</div><div class="ex-hero-value">'+money(s.equity)+'</div><div class="ex-hero-meta"><span>'+s.positions.length+' holdings</span>'+cashChip+'</div>'+jump('performance','Performance & benchmarks')+'</div><div class="ex-move-tile"><div class="ex-label">'+esc(dayLabel)+'</div><div class="ex-daily-value ex-'+tone+'">'+money(s.day)+'</div><div class="ex-coverage"><span style="width:'+(s.positions.length?s.dayCoverage/s.positions.length*100:0)+'%"></span></div><p class="ex-muted">Quotes on '+s.dayCoverage+' / '+s.positions.length+' names. Stocks only.</p></div></div>';
    html+='<div class="ex-brief-grid">'+card('What moved',movers?movers+'<div class="ex-axis"><span>Detractors</span><span>Contributors</span></div><p class="ex-muted">Top names by absolute dollar move from captured quotes. Cash flows and option changes are excluded.</p>'+jump('heatmap','Open heatmap'):unavailable('Previous-close quotes are missing.'));
    html+=card('Where the weight sits',largest?'<div class="ex-exposure"><div class="ex-ring" style="--share:'+share.toFixed(1)+'%" role="img" aria-label="Largest holding represents '+share.toFixed(1)+' percent of priced long holdings"><div><strong>'+share.toFixed(0)+'%</strong><small>of longs</small></div></div><div><div class="ex-label">Largest holding</div><div class="ex-number">'+esc(largest.symbol)+'</div><div class="ex-holding-val">'+money(largest.value)+'</div><p class="ex-muted">'+(weight===null?'Equity share unavailable':weight.toFixed(1)+'% of account equity. Margin can make a long look larger than the book.')+'</p></div></div>'+jump('risk','Risk & allocation'):unavailable('Position valuations are unavailable.'));
    html+='<section class="ex-card ex-next-card"><div class="ex-next-head"><div><div class="ex-label">Next</div><h2>Action Center</h2></div><div class="ex-plan-mark" aria-hidden="true">→</div></div>'+(s.target?row('Research date',esc(s.target.asOf || 'Not recorded'))+row('Recorded ticket',esc(s.pending?.status || 'No ticket in snapshot'))+'<p class="ex-muted">Cash-raising, redeployment, and Picks — using this account’s rules.</p>'+cta('plan','Open the plan')+jump('decisions','Read the research & sources'):'<p class="ex-muted">Cash-raising, redeployment, and Picks — using this account’s rules.</p>'+cta('plan','Open the plan'))+'</section>';
    html+='<p class="ex-muted ex-brief-age">Published snapshot · '+esc(ageText(s.generatedAt))+' · '+esc(date(s.generatedAt))+'. '+jump('activity','Inspect data & routine status')+'</p></div>';
    $('page-ex-today').innerHTML=html;
  }
  function renderActivity() {
    const s=model(), d=window.__DATA, t=d?.agentic?.target, p=d?.agentic?.pending;
    let html='<h1>See what actually happened.</h1><p class="ex-muted">Published records and unavailable telemetry are kept separate.</p>';
    html+='<div class="ex-grid">'+card('Published data',row('Snapshot',esc(d?'Loaded':'Not loaded'),d?date(d.generatedAt):'Unlock the snapshot first.')+row('Snapshot age',esc(ageText(d?.generatedAt)))+row('Selected account',esc(s.available?'Present in snapshot':'Not available'))+row('Agentic account as of',esc(date(d?.agentic?.asOf)))+note('This checks what the app received. It does not verify the current broker balance or prove a scheduled run succeeded.'));
    html+=card('Research & execution record',row('Agentic target',esc(t?.asOf || 'Not recorded'))+row('Evidence coverage status',esc(t?.research?.status || 'Not recorded'))+row('Latest recorded agentic ticket',esc(p?.status || 'Not recorded'))+row('Ticket completion timestamp',esc(date(p?.completedAt)))+jump('plan','Open the full plan'));
    html+=card('Routine and delivery telemetry',row('Claude routine runs','Not connected')+row('Live broker reconciliation','Not connected')+row('Push delivery receipts','Not recorded in snapshot')+note('Snapshot presence and ticket status are historical records. Live routine health, retry queues, and confirmed alert delivery need a separate data feed; this interface does not invent those states.'),true);
    html+=card('Decision history','<p>Use the original account-specific Rebalance Log for filled decisions, grading, and benchmark methodology.</p>'+jump('log','Open this account’s Rebalance Log'));
    const history=Array.isArray(p?.history)?p.history:[];
    html+=card('Agentic ticket timeline',history.length?history.slice(-12).map(h=>row(String(h.to || 'Recorded event'),esc(date(h.at)))).join(''):'<p class="ex-muted">No ticket history was included in this snapshot.</p>')+'</div>';
    $('page-ex-activity').innerHTML=html;
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
        '<details><summary>Drivers, sources & dates</summary><p>'+esc(drivers)+'</p>'+(sources.length?sources.map(e=>'<div class="ex-evidence"><div class="ex-label">'+esc(e.sleeve)+' · '+esc(e.asOf || 'Date unavailable')+'</div><p>'+esc(e.claim)+'</p>'+(e.href?'<a href="'+esc(e.href)+'" target="_blank" rel="noopener noreferrer">Read source ↗</a>':'<span class="ex-muted">'+esc(e.source || 'Source unavailable')+'</span>')+'</div>').join(''):'<p>Claim-level source records are unavailable in this target. They have not been reconstructed or invented.</p>')+'</details>'+jump('plan','See current eligibility & deferrals'));
    }).join('')+'</div>'+note('Opposing evidence, tax estimates, and a complete do-nothing comparison are shown only where recorded. The stress test is hypothetical; it is not a forecast or recommendation.')+jump('scenario','Explore a what-if scenario')+jump('log','Review the measured record');
    $('page-ex-decisions').innerHTML=html;
  }
  const scenarioState={symbol:'',shock:-10,shift:0,bps:0};
  function renderScenario() {
    const s=model(), positions=s.positions.filter(p=>p.value>0);
    let html='<h1>Explore a what-if.</h1><p class="ex-muted">Use the selected account’s published positions to compare a price shock with shifting part of one position to cash.</p>';
    if(!(s.equity>0)||!positions.length){ $('page-ex-scenario').innerHTML=html+unavailable('A positive account equity and a priced holding are required.'); return; }
    if(!positions.some(p=>p.symbol===scenarioState.symbol))scenarioState.symbol=positions[0].symbol;
    html+='<div class="ex-grid">'+card('Choose the assumptions','<div class="ex-controls"><label>Holding<select id="ex-scenario-symbol">'+positions.map(p=>'<option value="'+esc(p.symbol)+'"'+(p.symbol===scenarioState.symbol?' selected':'')+'>'+esc(p.symbol)+'</option>').join('')+'</select></label><label for="ex-shock">Holding price move: <strong id="ex-shock-label">'+scenarioState.shock+'%</strong></label><input id="ex-shock" type="range" min="-50" max="50" step="1" value="'+scenarioState.shock+'"><label for="ex-shift">Shift this holding to cash: <strong id="ex-shift-label">'+scenarioState.shift+'%</strong></label><input id="ex-shift" type="range" min="0" max="100" step="5" value="'+scenarioState.shift+'"><label>Assumed trading cost (basis points on amount shifted)<input id="ex-cost" type="number" min="0" max="1000" step="1" value="'+scenarioState.bps+'"></label></div>'+row('Account equity',esc(money(s.equity)))+'<p class="ex-muted">0 basis points means costs are excluded. 40 basis points means 0.4% of the amount shifted.</p>')+card('Compare the scenario outcomes','<div id="ex-scenario-results" aria-live="polite"></div>')+'</div>';
    html+=note('All other assets stay flat. This excludes taxes, option Greeks, dividends, financing costs, and market impact. It does not check whether a sale is eligible under the mandate or whether shares are pledged. No orders or target changes are created.');
    html+='<p class="ex-muted">Valuation snapshot: '+esc(date(s.generatedAt))+' · '+esc(ageText(s.generatedAt))+'. Stale or partial inputs limit the usefulness of this scenario.</p>'+jump('risk','Return to existing risk analysis');
    $('page-ex-scenario').innerHTML=html; updateScenario();
  }
  function updateScenario() {
    const s=model(), p=s.positions.find(p=>p.symbol===scenarioState.symbol), r=M.scenario({equity:s.equity,positionValue:p?.value,shockPct:scenarioState.shock,shiftPct:scenarioState.shift,costBps:scenarioState.bps});
    if($('ex-shock-label'))$('ex-shock-label').textContent=scenarioState.shock+'%';
    if($('ex-shift-label'))$('ex-shift-label').textContent=scenarioState.shift+'%';
    if(!$('ex-scenario-results'))return;
    if(!r){$('ex-scenario-results').innerHTML=unavailable('Enter a valid trading cost between 0 and 1,000 basis points.');protect();return;}
    const max=Math.max(Math.abs(r.before),Math.abs(r.after),1);
    const bar=(value,y,label)=>'<text x="0" y="'+y+'" fill="currentColor" font-size="12">'+label+'</text><rect x="0" y="'+(y+8)+'" width="'+(Math.abs(value)/max*280)+'" height="12" rx="3" fill="'+(value<0?'var(--nx-red,#dc2626)':'var(--nx-grn,#059669)')+'"/>';
    $('ex-scenario-results').innerHTML=row('Published '+p.symbol+' value',esc(money(p.value)))+row('Keep current allocation',esc(money(r.before)),percent(r.beforePct)+' of account equity')+row('After hypothetical shift',esc(money(r.after)),percent(r.afterPct)+' including assumed costs')+row('Amount shifted / cost',esc(money(r.shifted)+' / '+money(r.cost)))+'<svg class="ex-scenario-chart" viewBox="0 0 300 128" role="img" aria-label="Magnitude of hypothetical portfolio changes; exact signed values listed above">'+bar(r.before,20,'Keep allocation')+bar(r.after,78,'After shift')+'</svg>'+note(r.difference===0?'Both choices have the same result under these assumptions.':money(Math.abs(r.difference))+(r.difference>0?' more':' less')+' after the hypothetical shift in this scenario.')+jump('decisions','Read the research before deciding');
    protect();
  }
  function renderCustom() {
    const r=routes[routeKey]; if(r.custom==='today')renderToday();if(r.custom==='activity')renderActivity();if(r.custom==='decisions')renderDecisions();if(r.custom==='scenario')renderScenario();protect();
  }
  function queueRefresh() { clearTimeout(refreshTimer);refreshTimer=setTimeout(()=>{header();renderCustom();},60); }
  function placeSection(section, token, attempts=0) {
    if(token!==jumpToken)return;
    const root=$(account()==='agentic'?'agentic-app':'app'), target=root?.querySelector('[data-sec="'+section+'"]');
    if(!target){if(attempts<12)setTimeout(()=>placeSection(section,token,attempts+1),100);return;}
    const title=target.querySelector('.card-title'), body=title?.dataset.toggle?$(title.dataset.toggle):target.querySelector('.card-body');
    if(body && body.style.display==='none')title?.click();
    requestAnimationFrame(()=>{if(token!==jumpToken)return;const y=target.getBoundingClientRect().top+window.scrollY-(window.__pfTopOffset?.()||8);window.scrollTo(0,Math.max(0,y));});
  }
  function navigate(key, options={}) {
    if(!routes[key])return; routeKey=key; save('pf_experience_route',key); const r=routes[key],token=++jumpToken;
    ['today','activity','decisions','scenario'].forEach(n=>$('page-ex-'+n).hidden=r.custom!==n);
    navigating=true;
    try {
      if(r.tab)nativeSwitch(r.tab);
      else legacyTabs.forEach(t=>{const page=$('page-'+t);if(page)page.style.display='none';});
    } finally {navigating=false;}
    header();renderCustom();
    if(r.section)placeSection(r.section,token);
    else if(!options.keepScroll)window.scrollTo(0,0);
    // Existing Chart.js instances resize when their original page becomes visible.
    requestAnimationFrame(()=>{if(window.Chart?.instances)Object.values(Chart.instances).forEach(c=>{if(c.canvas?.offsetParent)c.resize();});});
  }
  // Existing Find, heatmap drill-downs, pins, and Plan links continue through the same entry point.
  window.switchTab=function(tab){
    if(navigating)return nativeSwitch(tab);
    const key={portfolio:'accounts',picks:'plan',markets:'markets',options:'options',analyze:'analyze'}[tab];
    return key?navigate(key):nativeSwitch(tab);
  };
  window.setAccount=function(...args){const value=nativeAccount.apply(this,args);queueRefresh();return value;};
  window.setPlanAccount=function(...args){const value=nativePlanAccount.apply(this,args);queueRefresh();return value;};
  $('ex-account').addEventListener('change',e=>{save('pf_acct',e.target.value);const r=routes[routeKey];
    if(r.tab==='portfolio')window.setAccount(e.target.value,{keepSection:true});
    else if(r.tab==='picks')window.setPlanAccount(e.target.value);
    header();renderCustom();if(r.section)placeSection(r.section,++jumpToken);
  });
  document.addEventListener('click',e=>{
    const b=e.target.closest('[data-ex-route],[data-ex-area]');if(!b)return;
    if(b.dataset.exRoute)navigate(b.dataset.exRoute);else navigate(defaults[b.dataset.exArea]);
  });
  $('ex-find').addEventListener('click',()=>{if(window.__pfFind)window.__pfFind();});
  $('ex-classic').addEventListener('click',goClassic);
  $('page-ex-scenario').addEventListener('input',e=>{
    if(e.target.id==='ex-shock')scenarioState.shock=Number(e.target.value);
    else if(e.target.id==='ex-shift')scenarioState.shift=Number(e.target.value);
    else if(e.target.id==='ex-cost')scenarioState.bps=e.target.value===''?null:Number(e.target.value);
    else return;updateScenario();
  });
  $('page-ex-scenario').addEventListener('change',e=>{if(e.target.id==='ex-scenario-symbol'){scenarioState.symbol=e.target.value;updateScenario();}});
  const observe=new MutationObserver(queueRefresh);
  ['app','agentic-app'].forEach(id=>{if($(id))observe.observe($(id),{childList:true});});
  if(window.__dataReady?.then)window.__dataReady.then(queueRefresh,queueRefresh);
  window.__experienceRefresh=queueRefresh;
  navigate(routeKey,{keepScroll:true});
})();
