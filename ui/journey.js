/* v217 — read-only journey state. No producer, strategy, broker, or order writes. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root.document) api.mount(root);
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const ROUTES = ['today','accounts','holdings','performance','heatmap','risk','income','options','plan','markets','screens','analyze','technicals','fundamentals','flow','decisions','scenario','activity','log','smartmoney','predictions'];
  const symbol = value => typeof value === 'string' && /^[A-Z][A-Z0-9.-]{0,14}$/.test(value.trim().toUpperCase()) ? value.trim().toUpperCase() : '';
  const account = value => value === 'agentic' ? 'agentic' : 'main';
  const num = value => (typeof value === 'number' || (typeof value === 'string' && value.trim())) && Number.isFinite(Number(value)) ? Number(value) : null;
  function clean(value) {
    if (!value || value.v !== 1 || !ROUTES.includes(value.route)) return null;
    return {v:1, route:value.route, account:account(value.account), symbol:symbol(value.symbol), index:Math.max(0,Math.min(10000,Math.trunc(num(value.index)||0))),
      y:Math.max(0,Math.min(1000000,num(value.y)||0)), details:Array.isArray(value.details)?value.details.filter(n=>Number.isInteger(n)&&n>=0&&n<1000).slice(0,1000):[]};
  }
  function pageRoute(hash) {
    const m = /^#view=([a-z]+)$/.exec(hash || '');
    return m && ROUTES.includes(m[1]) ? m[1] : null;
  }
  function choices(snapshot, target, selected) {
    const held = (snapshot?.positions || []).map(p=>symbol(p.symbol)).filter(Boolean);
    const researched = (target || []).map(p=>symbol(p.ticker || p.sym || p.t)).filter(Boolean);
    return [...new Set([...held,...researched,symbol(selected)].filter(Boolean))];
  }
  function mount(w) {
    const E=w.PFExperience, M=w.PFExperienceModel, d=w.document;
    if (!E || !M || w.PFJourney) return;
    const $=id=>d.getElementById(id), esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const read=(store,key,fallback)=>{try{return JSON.parse(w[store].getItem(key))??fallback;}catch(_){return fallback;}};
    const write=(store,key,value)=>{try{w[store].setItem(key,JSON.stringify(value));}catch(_){}};
    const savedPrefs=read('localStorage','pf-journey-ui-v1',{});
    const prefs=savedPrefs&&typeof savedPrefs==='object'&&!Array.isArray(savedPrefs)?savedPrefs:{};
    const pref=a=>{if(!prefs[a]||typeof prefs[a]!=='object')prefs[a]={};return prefs[a];};
    let current={v:1,route:E.route,account:E.account,symbol:symbol(pref(E.account).symbol),index:0,y:0,details:[]};
    let ready=false,replay=false,restoring=false,restoreToken=0,refreshTimer,scrollTimer,lastContext='';
    const visibleRoot=()=> d.querySelector('.ex-page:not([hidden])') || [...d.querySelectorAll('body > [id^="page-"]')].find(el=>el.style.display!=='none') || $('page-'+({accounts:'portfolio',holdings:'portfolio',plan:'picks'}[E.route]||E.route));
    const allDetails=()=>[...(visibleRoot()?.querySelectorAll('details')||[])];
    const snap=()=>M.snapshot(w.__DATA,w.__SNAP,E.account);
    function capture() {
      if(restoring)return current;
      current={...current,y:w.scrollY,details:allDetails().flatMap((el,i)=>el.open?[i]:[])};
      return current;
    }
    function store(replace=true) {
      if(!ready)return;
      // No account, holding, balance, or key is placed in the URL.
      try{w.history[replace?'replaceState':'pushState']({pfJourney:clean(current)},'',w.location.pathname+w.location.search+'#view='+current.route);}catch(_){}
      write('sessionStorage','pf-journey-v1',clean(current));
      const back=$('pj-back');if(back)back.disabled=current.index===0;
    }
    function before() { if(ready&&!replay){capture();store();} }
    function after() {
      if(!ready){schedule();return;}
      if(!replay){
        const changed=current.route!==E.route||current.account!==E.account;
        current={v:1,route:E.route,account:E.account,symbol:symbol(pref(E.account).symbol),index:current.index+(changed?1:0),y:0,details:[]};
        store(!changed);
      }
      schedule();
    }
    function restore(entry) {
      const token=++restoreToken;
      restoring=true;
      const apply=()=>{
        if(token!==restoreToken)return;
        allDetails().forEach((el,i)=>{el.open=entry.details.includes(i);});
        w.scrollTo(0,entry.y);
      };
      // Initial render and lazy account cards can complete on separate frames.
      w.requestAnimationFrame(()=>w.requestAnimationFrame(apply));
      w.setTimeout(apply,180);
      w.setTimeout(()=>{apply();if(token===restoreToken)restoring=false;},600);
    }
    function cancelRestore() {if(restoring){restoreToken++;restoring=false;}}
    ['wheel','touchstart','pointerdown','keydown'].forEach(type=>w.addEventListener(type,cancelRestore,{passive:true}));
    function use(entry) {
      if(!entry)return;
      replay=true;current=entry;pref(entry.account).symbol=entry.symbol;
      E.navigate(entry.route,{account:entry.account,keepScroll:true});
      if(entry.route==='analyze'&&entry.symbol)w.runAnalysis?.(entry.symbol);
      replay=false;render();restore(entry);
    }
    d.addEventListener('pf:before-route',before);
    d.addEventListener('pf:route',after);
    d.addEventListener('pf:before-account',before);
    d.addEventListener('pf:account',after);
    d.addEventListener('pf:render',schedule);
    w.addEventListener('popstate',e=>{const entry=clean(e.state?.pfJourney);if(entry)use(entry);});
    w.addEventListener('scroll',()=>{clearTimeout(scrollTimer);scrollTimer=w.setTimeout(()=>{if(!replay&&!restoring){capture();store();}},140);},{passive:true});
    w.addEventListener('pagehide',()=>{capture();store();});
    d.addEventListener('toggle',e=>{if(e.target.tagName==='DETAILS'&&!restoring){capture();store();}},true);
    function select(sym) {
      const s=symbol(sym);if(!s)return;
      pref(E.account).symbol=s;write('localStorage','pf-journey-ui-v1',prefs);
      current.symbol=s;store();schedule();
    }
    const nativeRun=w.runAnalysis;
    if(nativeRun)w.runAnalysis=function(sym){const s=symbol(sym);if(!s)return;const value=nativeRun(s);if(E.route==='analyze')select(s);return value;};
    function openResearch(sym) {
      const s=symbol(sym);if(!s)return;
      // Reading research is not a trade and needs no confirmation modal.
      before();pref(E.account).symbol=s;write('localStorage','pf-journey-ui-v1',prefs);
      E.navigate('analyze');w.runAnalysis?.(s);
    }
    w.azConfirm=openResearch; // Trade/whole-book confirmation functions remain untouched.
    const money=v=>num(v)===null?'Unavailable':new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:2}).format(Number(v));
    const time=v=>v&&Number.isFinite(Date.parse(v))?new Date(v).toLocaleString('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZone:'America/New_York'})+' ET':'Date unavailable';
    const scope=a=>a==='agentic'?'Agentic':'Self-directed';
    function context() {
      const show=['analyze','decisions','plan'].includes(E.route), host=$('pj-context');
      d.documentElement.classList.toggle('pj-analyzing',E.route==='analyze');
      if(!show){if(host)host.hidden=true;return;}
      const s=snap(), selected=symbol(pref(E.account).symbol), p=s.positions.find(p=>p.symbol===selected);
      const target=E.account==='agentic'?w.__DATA?.agentic?.target?.names:w.__APEX_TGT?.top5;
      const list=choices(s,target,selected);
      // Retain an explicitly selected research-only name. Never silently substitute another holding.
      const ticker=selected, age=M.age(s.generatedAt);
      const status=age===null?'Age unavailable':age<60?Math.floor(age)+'m old':age<1440?(age/60).toFixed(1)+'h old':Math.floor(age/1440)+'d old';
      const signature=JSON.stringify([E.route,E.account,ticker,list,p,s.generatedAt,status]);
      if(host&&signature===lastContext){host.hidden=false;return;}
      lastContext=signature;
      const el=host||d.createElement('section');el.id='pj-context';el.className='pj-context';el.hidden=false;el.setAttribute('aria-label','Holding research journey');
      el.innerHTML='<div class="pj-context-head"><strong>'+scope(E.account)+'</strong><label>Selected name<select id="pj-symbol" aria-label="Selected holding or research name"><option value="" disabled>Choose a name</option>'+list.map(t=>'<option'+(t===ticker?' selected':'')+'>'+esc(t)+'</option>').join('')+'</select></label></div>'+
        (ticker?'<div class="pj-metrics" data-priv="on"><div><span>Position value</span><b>'+ (p?esc(money(p.value)):'Not held here')+'</b></div><div><span>Day contribution</span><b>'+esc(p?money(p.day):'Not held here')+'</b></div></div>':'')+
        '<div class="pj-steps" aria-label="Research progression"><button type="button" data-pj-go="holdings">1 · Holding</button><button type="button" data-pj-go="analyze"'+(!ticker?' disabled':'')+' aria-current="'+(E.route==='analyze'?'step':'false')+'">2 · Research</button><button type="button" data-pj-go="plan" aria-current="'+(E.route==='plan'?'step':'false')+'">3 · Plan</button></div>'+
        '<details class="pj-source"><summary>Snapshot · '+esc(status)+'</summary><p>Published '+esc(time(s.generatedAt))+'. These are saved observations, not live quotes. Day contribution is the selected holding’s recorded dollar move, not account return.</p>'+(E.route==='analyze'?'<p>Analyze is a general research screen. Its legacy position, sizing and correlation sections use the self-directed book; they are not the Agentic plan. Use Account plan for account-specific eligibility and the existing confirmation controls.</p>':'<p>Research selection changes only this view. The existing account plan and confirmation remain authoritative; no order is submitted here.</p>')+'</details>'+
        (E.route==='analyze'?'<p class="pj-notice"><span>General screen · self-directed context</span><button type="button" data-pj-go="decisions">Sources →</button></p>':'');
      if(!host)$('ex-subnav').after(el);
      w.__privScan?.();
    }
    function mainEvidence() {
      if(E.route!=='decisions'||E.account!=='main')return;
      const root=$('page-ex-decisions'), t=w.__APEX_TGT;
      if(!root)return;
      let host=$('pj-apex-evidence');
      if(!host){host=d.createElement('section');host.id='pj-apex-evidence';root.append(host);}
      const rows=new Map();
      for(const r of (Array.isArray(t?.top5)?t.top5:[])){const k=symbol(r.sym);if(k)rows.set(k,{...r,kind:'New-entry research'});}
      for(const r of (Array.isArray(t?.heldLevels)?t.heldLevels:[])){const k=symbol(r.sym);if(k&&!rows.has(k))rows.set(k,{...r,kind:'Held-name research record'});}
      const signature=JSON.stringify([t?.asOf,[...rows]]);
      if(host._pjSignature===signature)return;host._pjSignature=signature;
      const link=url=>{try{const u=new URL(url);return /^https?:$/.test(u.protocol)?u.href:null;}catch(_){return null;}};
      host.innerHTML='<h2>Saved Apex evidence</h2><p class="ex-muted">Research dated '+esc(time(t?.asOf))+'. Entry research is not a held-exit instruction. Current eligibility and reconciled actions remain in the account plan.</p>'+
        (rows.size?'<div class="ex-grid">'+[...rows].map(([sym,r])=>'<section class="ex-card" data-evidence-symbol="'+esc(sym)+'"><h2>'+esc(sym)+'</h2><p class="ex-muted">'+esc(r.kind)+'</p><p>'+esc(r.why||r.thesis||r.note||'No explanatory thesis was supplied for this record.')+'</p><details><summary>Source record & limitations</summary><p>'+esc(r.news||r.stopBasis||'No additional source narrative was supplied.')+'</p>'+(link(r.newsUrl||r.sourceUrl)?'<a href="'+esc(link(r.newsUrl||r.sourceUrl))+'" target="_blank" rel="noopener noreferrer">Open recorded source ↗</a>':'<p>No direct source link was supplied for this row.</p>')+'<p>Saved research can be stale. Open the account plan for validated levels, review-only states and the unchanged whole-book confirmation.</p></details><button type="button" class="ex-link" data-pj-go="plan">Open account plan →</button></section>').join('')+'</div>':'<p class="ex-muted">No saved Apex research is loaded. Open the self-directed plan to load its published record; missing research is not a sell instruction.</p>');
    }
    function filterEvidence() {
      const root=$('page-ex-decisions');if(!root||E.route!=='decisions')return;
      const cards=[...root.querySelectorAll('[data-evidence-symbol]')];if(!cards.length)return;
      let control=$('pj-evidence-filter');
      if(!control){control=d.createElement('label');control.id='pj-evidence-filter';control.className='pj-evidence-filter';control.innerHTML='Research view <select aria-label="Filter recorded evidence"><option value="all">All researched names</option><option value="selected">Selected name only</option></select><span role="status"></span>';cards[0].parentElement.before(control);}
      const value=pref(E.account).evidence==='selected'?'selected':'all';control.querySelector('select').value=value;
      const selected=symbol(pref(E.account).symbol);let count=0;
      cards.forEach(c=>{c.hidden=value==='selected'&&c.dataset.evidenceSymbol!==selected;if(!c.hidden)count++;});
      control.querySelector('[role="status"]').textContent=count?count+' shown':selected?'No recorded thesis for '+selected+'. Open the account plan for its current status.':'Choose a name above, or show all research.';
    }
    function enhanceHoldings() {
      // Filter the existing position table; no positions or totals are recomputed.
      const table=$('pos-table');if(!table)return;
      let tools=$('pj-holding-filter');
      if(!tools){tools=d.createElement('div');tools.id='pj-holding-filter';tools.className='pj-filter';tools.innerHTML='<label>Find a position<input id="pj-holding-search" type="search" placeholder="Ticker" autocomplete="off" aria-label="Filter self-directed positions"></label><button type="button" id="pj-clear">Clear</button><span id="pj-found" role="status"></span>';table.before(tools);}
      const query=String(pref('main').query||'').slice(0,20).toUpperCase();const input=$('pj-holding-search');if(d.activeElement!==input)input.value=query;
      const rows=[...table.querySelectorAll('tbody tr')];let found=0;
      rows.forEach(row=>{const s=symbol(row.querySelector('.sym')?.textContent||'');if(!s)return;row.hidden=!!query&&!s.includes(query);if(!row.hidden)found++;});
      $('pj-found').textContent=query?(found+' matching position'+(found===1?'':'s')):'';
    }
    function accessible() {
      d.querySelectorAll('.az-link[onclick],.az-chip[onclick]').forEach(el=>{
        if(el.tagName==='BUTTON'||el.dataset.pjKeyboard)return;
        el.dataset.pjKeyboard='1';el.tabIndex=0;el.setAttribute('role','button');
        el.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();el.click();}});
      });
      d.querySelectorAll('tr.pf-more').forEach(row=>{
        if(row.querySelector('.pj-row-toggle'))return;
        const first=row.querySelector('td');if(!first)return;
        const btn=d.createElement('button');btn.type='button';btn.className='pj-row-toggle';btn.textContent='Details';btn.setAttribute('aria-label','Expand position row details');btn.setAttribute('aria-expanded',String(row.classList.contains('pf-open')));
        btn.addEventListener('click',()=>{row.classList.toggle('pf-open');btn.setAttribute('aria-expanded',String(row.classList.contains('pf-open')));});first.append(btn);
      });
    }
    function render() {
      if(!$('pj-back')){const b=d.createElement('button');b.type='button';b.id='pj-back';b.textContent='← Back';b.setAttribute('aria-label','Back to previous dashboard view');b.disabled=current.index===0;b.addEventListener('click',()=>{if(current.index>0)w.history.back();});$('ex-top')?.prepend(b);}
      if($('pf-fresh')?.querySelector('.pf-find')&&$('ex-find'))$('ex-find').hidden=true;
      if($('pj-back'))$('pj-back').disabled=current.index===0;
      context();mainEvidence();filterEvidence();enhanceHoldings();accessible();
      const selected=d.querySelector('#ex-subnav [aria-current="page"]');if(selected){const rail=$('ex-subnav');if(selected.offsetLeft<rail.scrollLeft||selected.offsetLeft+selected.offsetWidth>rail.scrollLeft+rail.clientWidth)rail.scrollLeft=selected.offsetLeft;}
    }
    function schedule(){clearTimeout(refreshTimer);refreshTimer=w.setTimeout(render,40);}
    d.addEventListener('input',e=>{if(e.target.id==='pj-holding-search'){pref('main').query=e.target.value.slice(0,20).toUpperCase();write('localStorage','pf-journey-ui-v1',prefs);enhanceHoldings();}});
    d.addEventListener('change',e=>{
      if(e.target.id==='pj-symbol'){select(e.target.value);if(E.route==='analyze'&&symbol(e.target.value))w.runAnalysis?.(symbol(e.target.value));filterEvidence();}
      if(e.target.closest('#pj-evidence-filter')){pref(E.account).evidence=e.target.value;write('localStorage','pf-journey-ui-v1',prefs);filterEvidence();}
    });
    d.addEventListener('click',e=>{
      if(e.target.closest('#pj-clear')){pref('main').query='';write('localStorage','pf-journey-ui-v1',prefs);$('pj-holding-search').value='';enhanceHoldings();$('pj-holding-search').focus();}
      const b=e.target.closest('[data-pj-go]');if(!b)return;
      const route=b.dataset.pjGo,s=symbol(pref(E.account).symbol);if(route==='decisions'&&s){pref(E.account).evidence='selected';write('localStorage','pf-journey-ui-v1',prefs);}E.navigate(route);
      if(route==='analyze'&&s)w.runAnalysis?.(s);
    });
    // Observe only native content roots, never this module's own context/filter nodes.
    ['app','agentic-app','analyze-app','picks-app','plan-agentic-app','page-ex-decisions'].forEach(id=>{const el=$(id);if(el)new MutationObserver(records=>{if(records.some(r=>[...r.addedNodes].some(n=>n.nodeType===1&&!n.matches?.('.pj-filter,.pj-row-toggle,.priv-m,#pj-evidence-filter'))))schedule();}).observe(el,{childList:true,subtree:true});});
    function init() {
      if(ready)return;
      const saved=clean(w.history.state?.pfJourney), requested=pageRoute(w.location.hash);
      ready=true;
      if(saved&&(!requested||requested===saved.route)){current=saved;use(saved);}
      else {const route=requested||E.route;E.navigate(route,{keepScroll:true});current={...current,route,account:E.account,index:0};store();render();}
    }
    w.PFJourney=Object.freeze({select,openResearch,refresh:schedule,get state(){return {...current};}});
    if(w.__dataReady?.then)w.__dataReady.then(init,init);else init();
  }
  return {symbol,account,num,clean,pageRoute,choices,mount};
});
