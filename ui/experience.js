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
    const paths={today:'M3 10 12 3l9 7v11h-6v-7H9v7H3Z',portfolio:'M12 3v9h9M9 3.5A9 9 0 1 0 20.5 15H9Z',research:'M5 3h10l4 4v14H5ZM9 11h6M9 15h6',activity:'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM12 7v5l3 2'};
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="'+paths[name]+'"/></svg>';
  };
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
  const jump = (key, text, scope) => '<button type="button" class="ex-link" data-ex-route="'+key+'"'+(scope?' data-ex-account="'+scope+'"':'')+'>'+esc(text || routes[key].label)+' →</button>';
  const row = (label, value, detail = '') => '<div class="ex-row"><span>'+esc(label)+(detail?'<small>'+esc(detail)+'</small>':'')+'</span><span>'+value+'</span></div>';
  const card = (title, html, wide = false) => '<section class="ex-card'+(wide?' ex-wide':'')+'"><h2>'+esc(title)+'</h2>'+html+'</section>';
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
  top.innerHTML='<div><div class="ex-brand">Portfolio <span>/</span></div><div class="ex-caption" id="ex-context">Your accounts, research, and activity</div></div><div class="ex-tools"><span id="ex-all-accounts" class="ex-badge" hidden>Both accounts</span><label id="ex-account-label">Account <select id="ex-account" aria-label="Account"><option value="main">Self-directed</option><option value="agentic">Agentic</option></select></label><button type="button" id="ex-find">Find a feature</button><button type="button" id="ex-classic" title="Return to the original five-tab layout">Classic view</button></div>';
  const main = document.createElement('nav'); main.className='ex-main'; main.setAttribute('aria-label','Main navigation');
  main.innerHTML='<div class="ex-wordmark">PORTFOLIO</div>'+Object.keys(defaults).map(a=>'<button type="button" data-ex-area="'+a+'" aria-current="false">'+icon(a)+'<span>'+a[0].toUpperCase()+a.slice(1)+'</span></button>').join('');
  const sub = document.createElement('nav'); sub.id='ex-subnav'; sub.className='ex-subnav'; sub.setAttribute('aria-label','Section navigation');
  const first = $('tabbar'); first.before(top,main,sub);
  ['today','activity','decisions','scenario'].forEach(name=>{
    const page=document.createElement('section'); page.id='page-ex-'+name; page.className='ex-page'; page.dataset.priv='on'; page.hidden=true; sub.after(page);
  });
  document.documentElement.classList.add('experience-on');
  function header() {
    const r=routes[routeKey]; $('ex-account').value=account();
    $('ex-account-label').hidden=routeKey==='today'; $('ex-all-accounts').hidden=routeKey!=='today';
    main.querySelectorAll('[data-ex-area]').forEach(b=>b.setAttribute('aria-current',b.dataset.exArea===r.area?'page':'false'));
    sub.innerHTML=Object.entries(routes).filter(([,v])=>v.area===r.area).map(([k,v])=>'<button type="button" data-ex-route="'+k+'" aria-current="'+(k===routeKey?'page':'false')+'">'+esc(v.label)+'</button>').join('');
    $('ex-context').textContent=routeKey==='today'?'Self-directed + Agentic · your big picture':r.tab==='options'?'Options · self-directed source (existing contracts and ideas)':(account()==='agentic'?'Agentic':'Self-directed')+' · '+r.label;
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
    html+=card('Agentic at a glance',row('Research dated',esc(s.target?.asOf||'Not recorded'))+row('Recorded ticket',esc(s.pending?.status?prettyStatus(s.pending.status):ag.available?'None in flight':'Unavailable'))+(dd?row('Deployment guard',esc(dd.insufficient?'Insufficient history':prettyStatus(dd.level)),M.number(dd.dd)!==null?'Recorded drawdown '+percent(dd.dd*100):''):'')+'<p class="ex-muted">Published research and execution records. Open the plan for current eligibility, deferrals and details.</p>'+cta('agentic','Open agentic plan')+jump('decisions','Research & sources','agentic'));
    const largest=s.positions.find(p=>p.value!==null),total=s.positions.reduce((n,p)=>n+(p.value||0),0),share=largest&&total>0?largest.value/total*100:0;
    html+=card('Where the weight sits',largest?'<div class="ex-exposure"><div class="ex-ring" style="--share:'+share.toFixed(1)+'%" role="img" aria-label="Largest holding represents '+share.toFixed(1)+' percent of priced long holdings"><div><strong>'+share.toFixed(0)+'%</strong><small>of longs</small></div></div><div><div class="ex-label">Largest combined holding</div><div class="ex-number">'+esc(largest.symbol)+'</div><div class="ex-holding-val">'+money(largest.value)+'</div><p class="ex-muted">'+(s.equity>0?(largest.value/s.equity*100).toFixed(1)+'% of combined equity. ':'')+esc(largest.shared?'Held in both accounts.':largest.sources[0].label+'.')+'</p></div></div>'+allocationVisual(s):'<p class="ex-muted">Position valuations are unavailable.</p>');
    html+=card('Combined value over time',historyChart(s.history,true));
    html+='<section class="ex-card ex-wide ex-brief-plans"><div><h2>Your next move</h2><p class="ex-muted">Open either account’s full plan from this shared brief.</p></div><div>'+cta('main','Open self-directed plan')+cta('agentic','Open agentic plan')+'</div></section>';
    html+='<details class="ex-wide ex-brief-method"><summary>Sources, coverage &amp; calculation notes</summary><p class="ex-muted">Combined equity uses each account’s published value, including account cash and option valuations, net of debt. '+(s.brokerageBasis?'The recorded brokerage basis excludes external prediction-market, futures and crypto sleeves.':'External sleeve coverage follows the recorded account basis and is not separately verified in this snapshot.')+' The stock move uses current quantities and captured prices against previous close; it does not reconstruct intraday trades, option changes, fees or cash flows. Cash and margin are shown separately across accounts. History sums only dates recorded for both accounts and includes deposits and withdrawals. Calendar coverage is limited to published records; no event listed does not mean no event exists.</p><p class="ex-muted">Snapshot published '+esc(date(s.generatedAt))+' · '+esc(ageText(s.generatedAt))+'. Options captured '+esc(date(s.options.positionsAsOf))+'.</p>'+jump('activity','Inspect data & routine status')+'</details></div>';
    $('page-ex-today').innerHTML=html;
  }
  function renderActivity() {
    const s=model(), d=window.__DATA, t=d?.agentic?.target, p=d?.agentic?.pending;
    const name=account()==='agentic'?'Agentic':'Self-directed';
    let html='<h1>See what actually happened.</h1><p class="ex-muted">Published records, with a clear view of what is available.</p>';
    html+='<div class="ex-status-strip"><div>'+icon('activity')+'<span class="ex-label">Published snapshot</span><strong>'+esc(d?ageText(d.generatedAt):'Not loaded')+'</strong></div><div><span class="ex-label">'+esc(name)+' account</span><strong>'+esc(s.available?'Present in snapshot':'Not available')+'</strong></div><div><span class="ex-label">Agentic ticket</span><strong>'+esc(p?.status?prettyStatus(p.status):d?'None in flight':'Not available')+'</strong></div></div>';
    html+='<div class="ex-grid">'+card('Published data',row('Snapshot',esc(d?'Loaded':'Not loaded'),d?date(d.generatedAt):'Unlock the snapshot first.')+row('Snapshot age',esc(ageText(d?.generatedAt)))+row('Selected account',esc(s.available?'Present in snapshot':'Not available'))+row('Agentic account as of',esc(date(d?.agentic?.asOf)))+note('This checks what the app received. Snapshot age is elapsed time, not a live broker or Routine health check.'));
    html+=card('Research & execution record',row('Agentic target',esc(t?.asOf || 'No target in this snapshot'))+row('Evidence coverage',esc(prettyStatus(t?.research?.status)))+row('Rebalance ticket',esc(p?.status ? prettyStatus(p.status) : d?'None in flight':'Not available'))+row('Ticket completed',p?.completedAt?esc(date(p.completedAt)):'—')+'<p class="ex-muted">These research and ticket records belong to the Agentic account.</p>'+jump('plan',account()==='agentic'?'Open the full plan':'Open selected account’s plan'));
    const events=[{label:'Snapshot published',at:d?.generatedAt,detail:'Data received by this app.'},{label:'Agentic account captured',at:d?.agentic?.asOf},{label:'Agentic research dated',at:t?.asOf}].filter(e=>M.age(e.at)!==null).sort((a,b)=>Date.parse(b.at)-Date.parse(a.at));
    html+=card('Published record timeline',timeline(events,'No dated records are available. Unlock a published snapshot to see them.')+'<p class="ex-muted">Dates from the snapshot; this is not a live execution feed.</p>');
    const history=(Array.isArray(p?.history)?p.history:[]).filter(h=>h && M.age(h.at)!==null).sort((a,b)=>Date.parse(a.at)-Date.parse(b.at)).slice(-12).reverse();
    html+=card('Agentic ticket timeline',timeline(history.map(h=>({label:prettyStatus(h.to || 'Recorded event'),at:h.at})),'No dated ticket history was included in this snapshot.'));
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
    const openDetails=routeKey==='today'?[...$('page-ex-today').querySelectorAll('details[open]')].map(el=>el.querySelector('summary')?.textContent):[];
    const r=routes[routeKey]; if(r.custom==='today')renderToday();if(r.custom==='activity')renderActivity();if(r.custom==='decisions')renderDecisions();if(r.custom==='scenario')renderScenario();
    if(routeKey==='today')$('page-ex-today').querySelectorAll('details').forEach(el=>{el.open=openDetails.includes(el.querySelector('summary')?.textContent);});
    protect();
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
    if(b.dataset.exAccount==='main'||b.dataset.exAccount==='agentic')save('pf_acct',b.dataset.exAccount);
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
  // Keep ET event countdowns and snapshot age current in a resident PWA.
  document.addEventListener('visibilitychange',()=>{if(!document.hidden&&routeKey==='today')queueRefresh();});
  setInterval(()=>{if(!document.hidden&&routeKey==='today')queueRefresh();},60000);
  window.__experienceRefresh=queueRefresh;
  navigate(routeKey,{keepScroll:true});
})();
