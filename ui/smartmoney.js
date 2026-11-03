/* Smart Money tab (v174; compact grouped feed v176) — read-only. Politician (STOCK Act) and insider (Form 4) trades from the
   snapshot, pinned to your names. Follows, flag decisions and filters stay on this device only.
   Nothing is posted, shared or traded from here. */
(function(){
  'use strict';
  const M=window.PFSmartMoneyModel;if(!M)return;
  const KEY='pf_smartmoney_v1';
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const load=()=>{try{return M.cleanState(JSON.parse(localStorage.getItem(KEY)));}catch{return M.cleanState(null);}};
  let state=load();
  const save=()=>{try{localStorage.setItem(KEY,JSON.stringify(state));}catch{toast('Device storage is unavailable, so this choice will not be kept.');}};
  const FILTERS=[['all','All'],['mine','You hold'],['following','Following'],['buy','Buys'],['sell','Sells']];
  const ui={view:'feed',kind:'all',filter:'all',by:'person',who:null,sym:null,showHandled:false,open:new Set()};
  try{const v=JSON.parse(localStorage.getItem(KEY+'_ui'));
    if(v&&['all','politician','insider','fund'].includes(v.kind))ui.kind=v.kind;
    if(v&&FILTERS.some(f=>f[0]===v.filter))ui.filter=v.filter;else if(v&&v.mineOnly===true)ui.filter='mine';
    if(v&&(v.by==='person'||v.by==='stock'))ui.by=v.by;}catch{}
  const saveUi=()=>{try{localStorage.setItem(KEY+'_ui',JSON.stringify({kind:ui.kind,filter:ui.filter,by:ui.by}));}catch{}};
  let root=null,bound=false,PERF=new Map();
  const toast=m=>{try{window.toast?window.toast(m):null;}catch{}};
  const asOf=()=>{const g=window.__DATA&&window.__DATA.generatedAt;return (typeof g==='string'&&g.slice(0,10))||new Date().toISOString().slice(0,10);};
  const fmtDay=d=>{if(!d)return '—';const t=new Date(d+'T12:00:00Z');return t.toLocaleDateString('en-US',{month:'short',day:'numeric',timeZone:'UTC'});};
  function held(){
    const D=window.__DATA||{};
    const main=new Set([...((D.main&&Array.isArray(D.main.positions))?D.main.positions:[]).filter(p=>p&&p.symbol&&+p.qty>0).map(p=>String(p.symbol).toUpperCase()),
      ...((window.__SNAP&&Array.isArray(window.__SNAP.enriched))?window.__SNAP.enriched:[]).map(p=>p&&String(p.symbol||'').toUpperCase()).filter(Boolean)]);
    const AG=D.agentic||{};
    const agentic=new Set((Array.isArray(AG.positions)?AG.positions:[]).filter(p=>p&&p.symbol&&+p.qty>0).map(p=>String(p.symbol).toUpperCase()));
    const target=new Set(((AG.target&&AG.target.names)||[]).map(n=>n&&String(n.ticker||'').toUpperCase()).filter(Boolean));
    return {main,agentic,target};
  }
  function model(){
    const flow=(window.__DATA&&window.__DATA.flow)||null;
    const items=M.allItems(flow,held());
    const follow=new Set(state.follow);
    PERF=M.perfIndex(flow);
    return {flow,items,follow,asOf:asOf()};
  }
  const ico={
    back:'<svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>',
    info:'<svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg>',
    lock:'<svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>'
  };
  const pl=(n,w)=>n+' '+w+(n===1?'':'s');
  const side=s=>'<span class="sm-side sm-'+s+'">'+(s==='buy'?'BUY':'SELL')+'</span>';
  const initials=n=>esc(String(n||'').split(/\s+/).filter(Boolean).slice(0,2).map(w=>w[0]).join('').toUpperCase()||'?');
  // Compact grouped row (v176). One row per person+ticker+side (or ticker+side when grouped by
  // stock); the individual trades fold underneath and open with the "N trades" button.
  function groupPerf(g){
    const rs=g.items.map(i=>PERF.get(i.id)).filter(Boolean);
    const ex=rs.map(r=>r.excess).filter(Number.isFinite),st=rs.map(r=>r.sinceTrade).filter(Number.isFinite);
    const avg=a=>a.reduce((x,y)=>x+y,0)/a.length;
    if(ex.length)return '<span class="sm-pf">vs S&amp;P <b class="'+tone(avg(ex))+'">'+M.pct(avg(ex))+'</b>'+(ex.length<g.count?' <small>('+ex.length+' of '+g.count+')</small>':'')+'</span>';
    if(st.length)return '<span class="sm-pf">Since trade <b class="'+tone(avg(st))+'">'+M.pct(avg(st))+'</b></span>';
    return '';
  }
  function subLine(i,showWho){
    const r=PERF.get(i.id);
    const bits=[fmtDay(i.txn),esc(i.amount||'size n/a')];
    if(i.kind==='politician'&&i.lag!=null)bits.push(i.lag+'d late');
    if(i.kind==='insider'&&i.shares)bits.push(i.shares.toLocaleString('en-US')+' sh');
    return '<li>'+(showWho?'<button type="button" class="sm-linkbtn" data-sm-who="'+esc(i.whoKey)+'">'+esc(i.who)+'</button> · ':'')+bits.join(' · ')+
      (r&&Number.isFinite(r.excess)?' · vs S&amp;P <b class="'+tone(r.excess)+'">'+M.pct(r.excess)+'</b>':'')+'</li>';
  }
  function row(g,opt){
    opt=opt||{};const byStock=g.by==='stock';const open=ui.open.has(g.key);
    const badge='<span class="sm-badge sm-'+g.side+'">'+(g.side==='buy'?'Buy':'Sell')+(g.count>1?' ×'+g.count:'')+'</span>';
    const symBtn='<button type="button" class="sm-linkbtn sm-sym" data-sm-sym="'+esc(g.sym)+'">'+esc(g.sym)+'</button>';
    const whoBtn='<button type="button" class="sm-linkbtn" data-sm-who="'+esc(g.whoKey)+'">'+esc(g.who)+'</button>';
    let r1,r2lead;
    if(byStock){
      r1='<span class="sm-who">'+symBtn+(g.people>1?'<small>'+g.people+' people</small>':'')+'</span>'+badge;
      r2lead=g.people===1?whoBtn+' <small class="sm-muted">'+esc(g.role)+'</small>':esc(g.names.slice(0,2).join(', '))+(g.names.length>2?' +'+(g.names.length-2):'');
      r2lead+=' · '+M.dayRange(g.first,g.last);
    }else if(opt.hideWho){
      r1='<span class="sm-who">'+symBtn+'</span>'+badge;r2lead=M.dayRange(g.first,g.last);
    }else{
      r1='<span class="sm-who">'+whoBtn+'<small>'+esc(g.role.replace(' member',''))+'</small></span>'+badge;
      r2lead=symBtn+' · '+M.dayRange(g.first,g.last);
    }
    const lag=g.kind==='politician'&&!g.mixedKinds?M.lagRange(g):null;
    const meta=[g.mine?'<span class="sm-mine">'+esc(M.mineLabel(g.mine))+'</span>':'',lag?'<span class="sm-late">Filed '+esc(lag)+'</span>':'',groupPerf(g)].filter(Boolean).join('');
    const more=g.count>1?'<button type="button" class="sm-more" data-sm-open="'+esc(g.key)+'" aria-expanded="'+open+'">'+g.count+' trades<svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg></button>':'';
    return '<article class="sm-row">'+
      '<div class="sm-r1">'+r1+'</div>'+
      '<div class="sm-r2"><span>'+r2lead+'</span><b>'+esc(g.amount||'Size n/a')+'</b></div>'+
      ((meta||more)?'<div class="sm-r3">'+meta+more+'</div>':'')+
      (g.count>1&&open?'<ul class="sm-sub">'+g.items.map(i=>subLine(i,byStock||g.mixedKinds)).join('')+'</ul>':'')+
    '</article>';
  }
  function rows(items,by,opt){return M.groupItems(items,{by}).map(g=>row(g,opt));}
  // One banner instead of "Tracking starts…" on every card (v176).
  function trackBanner(items){
    const n=items.filter(i=>{const r=PERF.get(i.id);return !r||!Number.isFinite(r.excess);}).length;
    return n?'<p class="sm-banner">'+ico.info+'<span>vs S&amp;P tracking for '+pl(n,'trade')+' starts at the next daily price check.</span></p>':'';
  }
  const tone=v=>v>0?'sm-good':v<0?'sm-bad':'';
  const empty=(t,p)=>'<div class="sm-empty"><h3>'+esc(t)+'</h3><p>'+esc(p)+'</p></div>';
  function head(m,openFlags){
    const names=M.yourNames(m.items,m.asOf,30);
    return '<header class="sm-head"><h1>Smart Money</h1>'+
      '<span class="sm-ro">'+ico.lock+'Read-only</span></header>'+
      '<div class="sm-views" role="tablist" aria-label="Smart Money views">'+
        '<button type="button" role="tab" aria-selected="'+(ui.view==='feed')+'" data-sm-view="feed">Feed</button>'+
        '<button type="button" role="tab" aria-selected="'+(ui.view==='flags')+'" data-sm-view="flags">Flags'+(openFlags?' <b>'+openFlags+'</b>':'')+'</button>'+
        '<button type="button" role="tab" aria-selected="'+(ui.view==='board')+'" data-sm-view="board">Who\'s good</button>'+
        '<button type="button" role="tab" aria-selected="'+(ui.view==='following')+'" data-sm-view="following">Following'+(state.follow.length?' <b>'+state.follow.length+'</b>':'')+'</button>'+
      '</div>'+
      (names.length&&ui.view!=='feed'?'<div class="sm-names"><span>New on your names</span>'+names.slice(0,8).map(n=>'<button type="button" class="sm-chip" data-sm-sym="'+esc(n.sym)+'">'+esc(n.sym)+' · '+n.count+'</button>').join('')+'</div>':'');
  }
  function feedView(m){
    const kinds=[['all','All'],['politician','Politicians'],['insider','Insiders'],['fund','Funds']];
    let h='<div class="sm-seg" role="group" aria-label="Who">'+kinds.map(([k,l])=>'<button type="button" aria-pressed="'+(ui.kind===k)+'" data-sm-kind="'+k+'">'+l+'</button>').join('')+'</div>';
    if(ui.kind==='fund')return h+empty('Fund holdings are not connected yet','Hedge fund 13F filings are not in this dashboard\'s current data feeds. They are also quarterly and up to 45 days old, so they would show positions, not live trades.');
    if(!m.flow)return h+empty('No flow data in this snapshot yet','It lands on the next full producer run.');
    const base=M.feed(m.items,{kind:ui.kind});
    const sum=M.summary(base,m.asOf,7);
    h+='<div class="sm-tiles sm-sum">'+
      tile('New filings · 7d',String(sum.fresh),sum.freshMine?sum.freshMine+' on your names':'None on your names')+
      tile('Most bought · 30d',sum.topBuy?sum.topBuy.sym:'—',sum.topBuy?pl(sum.topBuy.count,'buy'):'No buys reported')+'</div>';
    h+='<div class="sm-chips" role="group" aria-label="Filter">'+FILTERS.map(([k,l])=>'<button type="button" class="sm-fchip" aria-pressed="'+(ui.filter===k)+'" data-sm-filter="'+k+'">'+l+'</button>').join('')+'</div>';
    const list=M.feed(base,{filter:ui.filter,follow:m.follow});
    if(!list.length)return h+empty('Nothing to show here','No reported trades match this filter in the current snapshot.')+coverage(m);
    h+=trackBanner(list);
    const pinned=ui.filter==='all';
    const mine=pinned?list.filter(i=>i.mine||m.follow.has(i.whoKey)):[],rest=pinned?list.filter(i=>!(i.mine||m.follow.has(i.whoKey))):list;
    const block=(title,items,cap)=>{const g=rows(items,ui.by);return '<h2 class="sm-h2">'+title+'</h2><div class="sm-rows">'+g.slice(0,cap).join('')+'</div>'+(g.length>cap?'<p class="sm-note">Showing the newest '+cap+' of '+g.length+' groups.</p>':'');};
    if(mine.length)h+=block('Your names &amp; people you follow',mine,40);
    if(rest.length)h+=block(pinned?'Everything else':'Trades',rest,60);
    h+='<p class="sm-by">Group by <button type="button" aria-pressed="'+(ui.by==='person')+'" data-sm-by="person">Person</button> · <button type="button" aria-pressed="'+(ui.by==='stock')+'" data-sm-by="stock">Stock</button></p>';
    return h+coverage(m);
  }
  function coverage(m){
    return '<details class="sm-notes"><summary>Where this comes from</summary><ul>'+
      '<li><b>Politicians:</b> STOCK Act reports. Members have up to 45 days to report, and many file later, so every trade here is weeks to months old. Amounts are only reported as ranges.</li>'+
      '<li><b>Insiders:</b> SEC Form 4, open-market buys and sells only (no grants, option exercises or gifts). Covers the names in your two accounts and the agentic target.</li>'+
      '<li><b>Funds:</b> not connected.</li>'+
      '<li>The politician list builds up from a rolling window of the newest reports, so it is not a complete record of every member\'s trades.</li>'+
      '<li>Snapshot flow data as of '+esc(fmtDay((m.flow&&m.flow.asOf)||null))+'. Nothing on this tab is a recommendation.</li></ul></details>';
  }
  function back(){return '<button type="button" class="sm-back" data-sm-back aria-label="Back">'+ico.back+'</button>';}
  function personView(m){
    const p=M.person(m.items,ui.who,m.asOf);
    if(!p)return back()+empty('No trades for this person','They have no reported trades in the current snapshot.');
    const following=m.follow.has(p.key);const max=Math.max(1,...p.bars.map(b=>Math.max(b.buys,b.sells)));
    return back()+
      '<section class="sm-person"><span class="sm-av sm-av-lg" aria-hidden="true">'+initials(p.who)+'</span><div><h2>'+esc(p.who)+'</h2><p>'+esc(p.role)+'</p><p class="sm-muted">Source: '+esc(p.source)+'</p></div></section>'+
      '<div class="sm-two"><button type="button" class="sm-btn '+(following?'sm-btn-on':'sm-btn-primary')+'" data-sm-follow="'+esc(p.key)+'" aria-pressed="'+following+'">'+(following?'Following':'Follow')+'</button>'+
        '<a class="sm-btn" href="https://claude.ai/new?q='+encodeURIComponent(M.researchPrompt('person',p))+'" target="_blank" rel="noopener">Discuss in Claude</a></div>'+
      '<div class="sm-tiles">'+
        tile('Reported trades',String(p.trades),pl(p.buys,'buy')+' · '+pl(p.sells,'sell'))+
        tile('Typical delay',p.medianLag!=null?p.medianLag+' d':'—',p.kind==='politician'?'Legal limit is 45 d':'Form 4 is due in 2 business days')+
        tile('Overlap with you',p.overlap.length?p.overlap.length+(p.overlap.length===1?' name':' names'):'None',p.overlap.slice(0,4).join(', ')||'No shared names')+
        tile('Names traded',String(p.symbols.length),p.symbols.slice(0,4).join(', '))+
      '</div>'+
      recordPanel(m,p)+
      '<section class="sm-panel"><div class="sm-panel-h"><h3>Trades by month</h3>'+legend()+'</div><div class="sm-bars" role="img" aria-label="Buys and sells per month">'+
        p.bars.map(b=>'<div class="sm-bar"><div class="sm-bar-pair"><i class="sm-b-buy" style="height:'+Math.round(b.buys/max*72)+'px"></i><i class="sm-b-sell" style="height:'+Math.round(b.sells/max*72)+'px"></i></div><span>'+esc(b.label)+'</span></div>').join('')+
      '</div></section>'+
      '<h2 class="sm-h2">Recent trades</h2>'+trackBanner(p.items)+'<div class="sm-rows">'+rows(p.items,'person',{hideWho:true}).slice(0,30).join('')+'</div>';
  }
  function recordPanel(m,p){
    const r=M.personRecord(m.flow,p.key);
    const head='<div class="sm-panel-h"><h3>Track record</h3><span class="sm-muted sm-small">vs S&amp;P 500, from the day each trade was reported</span></div>';
    if(!r)return '<section class="sm-panel">'+head+'<p class="sm-note">Scoring starts at the next daily price check. Each trade is marked from the day it was first reported here.</p></section>';
    const tiles='<div class="sm-tiles">'+
      tile('Beat the S&P',r.hitRate!=null?Math.round(r.hitRate*100)+'%':'—',r.scored+' of '+r.tracked+' trades scored')+
      tile('Average vs S&P',M.pct(r.avgExcess),'Median '+M.pct(r.medianExcess))+
      tile('Best call',r.best?M.pct(r.best.excess):'—',r.best?(r.best.side==='buy'?'Bought ':'Sold ')+r.best.sym:'')+
      tile('Worst call',r.worst?M.pct(r.worst.excess):'—',r.worst?(r.worst.side==='buy'?'Bought ':'Sold ')+r.worst.sym:'')+
      (r.sinceTradeN?tile('Since their trade price',M.pct(r.avgSinceTrade),'Average of '+r.sinceTradeN+' Form 4 trades'):'')+
    '</div>';
    return '<section class="sm-panel">'+head+(r.enough?'':'<p class="sm-note">Not enough history yet: '+r.scored+' of 5 trades needed are at least 5 days old. Read these numbers as early.</p>')+tiles+'</section>';
  }
  function boardView(m){
    const kinds=[['all','All'],['politician','Politicians'],['insider','Insiders']];
    const k=ui.boardKind||'all';
    let h='<div class="sm-seg" role="group" aria-label="Who">'+kinds.map(([v,l])=>'<button type="button" aria-pressed="'+(k===v)+'" data-sm-bkind="'+v+'">'+l+'</button>').join('')+'</div>';
    const rows=M.board(m.flow,{kind:k});
    if(!rows.length)return h+empty('Scores start building today','Every tracked trade is priced from the day it was reported, then marked daily against the S&P 500. A person is ranked once 5 of their trades are at least 5 days old.')+boardNotes();
    const ranked=rows.filter(r=>r.enough),early=rows.filter(r=>!r.enough);
    const row=(r,n)=>'<article class="sm-card sm-rank"><div class="sm-card-top">'+(n?'<span class="sm-rank-n">'+n+'</span>':'<span class="sm-av" aria-hidden="true">'+initials(r.name)+'</span>')+
      '<span class="sm-who"><button type="button" class="sm-linkbtn" data-sm-who="'+esc(r.key)+'">'+esc(r.name)+'</button><small>'+esc(r.role)+'</small></span>'+
      '<span class="sm-score"><b class="'+tone(r.avgExcess)+'">'+M.pct(r.avgExcess)+'</b><small>vs S&amp;P</small></span></div>'+
      '<div class="sm-card-foot"><span>'+(r.hitRate!=null?'Beat the S&amp;P on '+Math.round(r.hitRate*100)+'% · ':'')+r.scored+' scored of '+r.tracked+'</span>'+(r.best?'<span>Best: '+esc((r.best.side==='buy'?'bought ':'sold ')+r.best.sym)+' '+M.pct(r.best.excess)+'</span>':'')+'</div></article>';
    if(ranked.length)h+='<h2 class="sm-h2">Ranked · 5+ scored trades</h2><div class="sm-list">'+ranked.slice(0,50).map((r,i)=>row(r,i+1)).join('')+'</div>';
    else h+='<p class="sm-note">No one has 5 scored trades yet, so nobody is ranked. Early results are below.</p>';
    if(early.length)h+='<details class="sm-notes"'+(ranked.length?'':' open')+'><summary>Too early to judge ('+early.length+')</summary><div class="sm-list">'+early.slice(0,80).map(r=>row(r,0)).join('')+'</div></details>';
    return h+boardNotes();
  }
  function boardNotes(){
    return '<details class="sm-notes"><summary>How the scores work</summary><ul>'+
      '<li>Each trade is priced on the first day it shows up in this dashboard. That is the earliest price you could have copied it at.</li>'+
      '<li>It is then marked every day against the S&amp;P 500 (SPY). A buy scores the stock\'s move minus SPY\'s. A sell scores the reverse, so selling before a stock lags the market counts as a good call.</li>'+
      '<li>Insider Form 4s also report the trade price, so insiders get a second number: the move since their own trade.</li>'+
      '<li>Only trades marked for at least 5 days count, and a person needs 5 of them to be ranked. Past results are not a promise of future ones.</li>'+
      '<li>History starts on Nov 3, 2026. Trades before then are not back-filled, because the data feeds have no historical prices.</li></ul></details>';
  }
  const tile=(l,v,s)=>'<div class="sm-tile"><span>'+esc(l)+'</span><strong>'+esc(v)+'</strong><small>'+esc(s)+'</small></div>';
  const legend=()=>'<span class="sm-legend"><span><i class="sm-b-buy"></i>Buys</span><span><i class="sm-b-sell"></i>Sells</span></span>';
  function tickerView(m){
    const t=M.ticker(m.items,m.flow,ui.sym,m.asOf,90);
    const bar=(name,g,note)=>{const tot=g.buys+g.sells;const bw=tot?g.buys/tot*100:0;
      return '<div class="sm-group"><div class="sm-group-h"><b>'+esc(name)+'</b><span>'+pl(g.buys,'buy')+' · '+pl(g.sells,'sell')+'</span></div>'+
        '<div class="sm-meter" aria-hidden="true">'+(tot?'<i class="sm-b-buy" style="width:'+bw+'%"></i><i class="sm-b-sell" style="width:'+(100-bw)+'%"></i>':'')+'</div><small>'+esc(note)+'</small></div>';};
    const mineLbl=t.mine?M.mineLabel(t.mine):(M.mineOf(t.sym,held())?M.mineLabel(M.mineOf(t.sym,held())):'');
    return back()+
      '<section class="sm-tk-head"><p class="sm-muted">Who\'s moving</p><div><h2>'+esc(t.sym)+'</h2>'+(mineLbl?'<span class="sm-mine">'+esc(mineLbl)+'</span>':'')+'</div><p class="sm-muted">Reported trades from the last 90 days</p></section>'+
      '<section class="sm-panel"><div class="sm-panel-h"><h3>Buys vs sells</h3>'+legend()+'</div>'+
        bar('Politicians',t.politicians,'Reported weeks to months after the trade')+
        bar('Insiders',t.insiders,t.covered?(t.insider&&t.insider.note?t.insider.note:'Open-market Form 4 trades'):'This name is outside the insider data coverage')+
        '<div class="sm-group"><div class="sm-group-h"><b>Funds (13F)</b><span>Not connected</span></div><div class="sm-meter" aria-hidden="true"></div><small>Quarterly holdings are not in the current data feeds</small></div>'+
      '</section>'+
      '<section class="sm-read sm-read-'+esc(t.read.tone)+'"><h3>'+esc(t.read.title)+'</h3><p>'+esc(t.read.text)+'</p></section>'+
      '<div class="sm-two"><a class="sm-btn" href="https://claude.ai/new?q='+encodeURIComponent(M.researchPrompt('ticker',t))+'" target="_blank" rel="noopener">Discuss in Claude</a>'+
        '<button type="button" class="sm-btn sm-btn-primary" data-sm-analyze="'+esc(t.sym)+'">Open in Analyze</button></div>'+
      (t.items.length?'<h2 class="sm-h2">The trades</h2>'+trackBanner(t.items)+'<div class="sm-rows">'+rows(t.items,'person').slice(0,30).join('')+'</div>':'');
  }
  function flagCard(f,handled){
    const d=state.decisions[f.id];
    const status=d?(d.choice==='research'?'Sent to Claude for research':d.choice==='dismiss'?'Dismissed':'Snoozed until '+fmtDay((d.until||'').slice(0,10))):'';
    return '<article class="sm-flag sm-flag-'+esc(f.level)+'">'+
      '<div class="sm-flag-tags"><span class="sm-tag">'+esc(f.tag)+'</span>'+(f.mine?'<span class="sm-mine">'+esc(M.mineLabel(f.mine))+'</span>':'')+'</div>'+
      '<h3><button type="button" class="sm-linkbtn" data-sm-sym="'+esc(f.sym)+'">'+esc(f.title)+'</button></h3>'+
      '<div class="sm-tiles sm-tiles-3">'+f.stats.map(s=>tile(s.label,s.value,'')).join('')+'</div>'+
      '<ul class="sm-why">'+f.why.map(w=>'<li>'+esc(w)+'</li>').join('')+'</ul>'+
      (handled?'<p class="sm-status">'+esc(status)+' <button type="button" class="sm-linkbtn" data-sm-undo="'+esc(f.id)+'">Undo</button></p>':
      '<div class="sm-decide"><a class="sm-btn sm-btn-primary sm-btn-wide" href="https://claude.ai/new?q='+encodeURIComponent(M.researchPrompt('flag',f))+'" target="_blank" rel="noopener" data-sm-decide="research" data-id="'+esc(f.id)+'">Research it in Claude</a>'+
        '<div class="sm-two"><button type="button" class="sm-btn" data-sm-decide="snooze" data-id="'+esc(f.id)+'">Snooze 7 days</button><button type="button" class="sm-btn" data-sm-decide="dismiss" data-id="'+esc(f.id)+'">Dismiss</button></div></div>')+
    '</article>';
  }
  function flagsView(m,all){
    const now=Date.now();const open=all.filter(f=>M.isOpen(f,state.decisions,now)),done=all.filter(f=>!M.isOpen(f,state.decisions,now));
    let h=open.length?'<div class="sm-list">'+open.map(f=>flagCard(f,false)).join('')+'</div>':empty('No open flags','Flags appear for insider cluster buys, an insider buying a name you hold, Congress clusters on your names, and new trades from people you follow.');
    if(done.length)h+='<details class="sm-notes"'+(ui.showHandled?' open':'')+' data-sm-handled><summary>Handled ('+done.length+')</summary><div class="sm-list">'+done.map(f=>flagCard(f,true)).join('')+'</div></details>';
    return h+'<p class="sm-foot">'+ico.lock+' Read-only. Your choices stay on this device. Nothing is posted or shared.</p>';
  }
  function followingView(m){
    if(!state.follow.length)return empty('You are not following anyone yet','Open a politician or insider from the feed and tap Follow. Their new trades get pinned and flagged.');
    return '<div class="sm-list">'+state.follow.map(k=>{const p=M.person(m.items,k,m.asOf);
      return '<article class="sm-card"><div class="sm-card-top"><span class="sm-av" aria-hidden="true">'+initials(p?p.who:k.split('|')[1])+'</span><span class="sm-who"><button type="button" class="sm-linkbtn" data-sm-who="'+esc(k)+'">'+esc(p?p.who:M.titleCase(k.split('|')[1]))+'</button><small>'+esc(p?p.role:'No trades in this snapshot')+'</small></span>'+
        '<button type="button" class="sm-btn sm-btn-sm" data-sm-follow="'+esc(k)+'" aria-pressed="true">Unfollow</button></div>'+
        (p&&p.items[0]?'<div class="sm-card-foot"><span>Latest: '+(p.items[0].side==='buy'?'bought ':'sold ')+esc(p.items[0].sym)+' · '+esc(fmtDay(p.items[0].seen))+'</span></div>':'')+'</article>';}).join('')+'</div>';
  }
  function render(){
    if(!root)return;
    if(!window.__DATA){root.innerHTML='<div class="loading-wrap">Loading Smart Money…</div>';return;}
    const m=model();const all=M.flags(m.items,m.flow,{asOf:m.asOf,follow:m.follow});
    const openCount=all.filter(f=>M.isOpen(f,state.decisions,Date.now())).length;
    let body;
    if(ui.who)body=personView(m);
    else if(ui.sym)body=tickerView(m);
    else body=ui.view==='flags'?flagsView(m,all):ui.view==='following'?followingView(m):ui.view==='board'?boardView(m):feedView(m);
    const y=window.scrollY;
    root.innerHTML='<div class="sm-wrap">'+((ui.who||ui.sym)?'':head(m,openCount))+body+'</div>';
    if(root.dataset.keepScroll==='1'){window.scrollTo(0,y);root.dataset.keepScroll='';}
  }
  function bind(){
    if(bound)return;bound=true;
    root.addEventListener('click',e=>{
      const t=e.target.closest('[data-sm-open],[data-sm-filter],[data-sm-by],[data-sm-bkind],[data-sm-view],[data-sm-kind],[data-sm-who],[data-sm-sym],[data-sm-back],[data-sm-follow],[data-sm-decide],[data-sm-undo],[data-sm-analyze]');
      if(!t||!root.contains(t))return;
      if(t.dataset.smOpen){const k=t.dataset.smOpen;ui.open.has(k)?ui.open.delete(k):ui.open.add(k);root.dataset.keepScroll='1';render();return;}
      if(t.dataset.smFilter){ui.filter=t.dataset.smFilter;saveUi();root.dataset.keepScroll='1';render();return;}
      if(t.dataset.smBy){ui.by=t.dataset.smBy;ui.open.clear();saveUi();root.dataset.keepScroll='1';render();return;}
      if(t.dataset.smBkind){ui.boardKind=t.dataset.smBkind;root.dataset.keepScroll='1';render();return;}
      if(t.dataset.smView){ui.view=t.dataset.smView;ui.who=ui.sym=null;render();return;}
      if(t.dataset.smKind){ui.kind=t.dataset.smKind;saveUi();root.dataset.keepScroll='1';render();return;}
      if(t.dataset.smWho){ui.who=t.dataset.smWho;ui.sym=null;render();window.scrollTo(0,0);return;}
      if(t.dataset.smSym){ui.sym=t.dataset.smSym;ui.who=null;render();window.scrollTo(0,0);return;}
      if(t.hasAttribute('data-sm-back')){ui.who=ui.sym=null;render();window.scrollTo(0,0);return;}
      if(t.dataset.smFollow){const k=t.dataset.smFollow;state.follow=state.follow.includes(k)?state.follow.filter(x=>x!==k):[...state.follow,k];save();root.dataset.keepScroll='1';render();return;}
      if(t.dataset.smUndo){delete state.decisions[t.dataset.smUndo];save();ui.showHandled=true;root.dataset.keepScroll='1';render();return;}
      if(t.dataset.smAnalyze){const s=t.dataset.smAnalyze;try{window.switchTab('analyze');if(typeof window.runAnalysis==='function')window.runAnalysis(s);else{const i=document.getElementById('az-ticker');if(i){i.value=s;window.azGo&&window.azGo();}}}catch{}return;}
      if(t.dataset.smDecide){
        const choice=t.dataset.smDecide,id=t.dataset.id;const at=new Date().toISOString();
        state.decisions[id]={choice,at,until:choice==='snooze'?new Date(Date.now()+7*86400000).toISOString():null};save();
        if(choice==='research'){try{navigator.clipboard&&navigator.clipboard.writeText(decodeURIComponent(t.getAttribute('href').split('q=')[1]||''));}catch{}toast('Prompt copied too, in case Claude opens in the browser');}
        root.dataset.keepScroll='1';setTimeout(render,choice==='research'?400:0);return;}
    });
    root.addEventListener('toggle',e=>{if(e.target.matches&&e.target.matches('[data-sm-handled]'))ui.showHandled=e.target.open;},true);
    window.addEventListener('storage',e=>{if(e.key===KEY){state=load();render();}});
  }
  function mount(el){
    if(!el)return;
    if(root!==el){root=el;root.classList.add('sm-page');bind();}
    render();
    if(!window.__DATA&&window.__dataReady&&typeof window.__dataReady.then==='function')window.__dataReady.then(()=>render()).catch(()=>{});
  }
  window.PFSmartMoney={mount,render};
  const pg=document.getElementById('page-smartmoney');
  if(pg&&pg.offsetParent)mount(document.getElementById('smartmoney-app'));
})();
