/* v248 — Book mode vNext: the left page is a command panel, the right page is the analysis (Jack, Nov 17 2026, screen recording
   of v247 Book mode: "the left page is significantly underused while the right page requires too much scrolling").
   Book only (html[data-duo-split="on"][data-duo-layout="book"]): Today (v249: both accounts' command blocks), and in the Apex / Agentic
   areas Overview (accounts + its section routes), Positions (holdings), Research (analyze opened from an account) and Actions (plan). Folded, Standard, phone and every other route are
   untouched.
   DISPLAY ONLY. Every figure is one the app already computes for the same account:
     window.__pfPosRows(acct)       the All Positions rows (weight, value, return, today)
     window.__PF_APEX_REVIEW        the Apex review (state: leverage band, margin cushion; Apex.themeShare for the tech cap)
     window.acctPerfStats           the deposit-adjusted, time-weighted account return the Performance cards use
     window.agenticBook             invested / idle cash for ••••3900
     window.__PF_AG_TARGET          the agentic target rows (drift) the plan already shows
     PFExperienceModel.ticketStatus the unified ticket wording (v240)
     PFExperience.actionsHTML       the Overview Action Center list, re-used as the Actions review queue
   Nothing here places, proposes or sizes an order, and no rule, threshold or model is read differently. A figure that is missing
   is shown as "—" or left out, never as zero.
   Layout: one fixed panel (#pf-book, a child of <body>) under the blocks duo.js pins in the left pane; it scrolls on its own, so the
   right page keeps the document scroll (Back / Find / anchors unchanged). Its scroll position is kept per account + tab. */
(function(){
  'use strict';
  if(typeof document==='undefined')return;
  var G=window, root=document.documentElement;
  var TAB={accounts:'overview',performance:'overview',heatmap:'overview',risk:'overview',income:'overview',technicals:'overview',
    fundamentals:'overview',flow:'overview',holdings:'positions',analyze:'research',plan:'actions',acctresearch:'findings'};
  var MIN_W=200, MIN_H=120, OVERVIEW_ROWS=8, ACTION_ROWS=5;
  var el=null, raf=0, src='', key='', scrolls={}, lastOn=false;
  function E(){return G.PFExperience||null;}
  function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  function num(v){return typeof v==='number'&&isFinite(v)?v:null;}
  function pct(v,d){v=num(v);if(v===null)return '—';return (v>0?'+':v<0?'−':'')+Math.abs(v).toFixed(d==null?1:d)+'%';}
  function plain(v,d){v=num(v);return v===null?'—':v.toFixed(d==null?1:d)+'%';}
  function tone(v){v=num(v);return v===null||v===0?'':(v>0?' bk-up':' bk-dn');}
  function money(v){if(num(v)===null)return '—';return typeof G.fmtD==='function'?G.fmtD(v):'$'+Math.round(v).toLocaleString('en-US');}
  function clamp(x,a,b){return Math.max(a,Math.min(b,x));}

  // ── when the panel applies ─────────────────────────────────────────────────────────────────────────────────────────────────────
  function ctx(){
    var e=E();if(!e)return null;
    if(root.getAttribute('data-duo-split')!=='on'||root.getAttribute('data-duo-layout')!=='book'||!root.hasAttribute('data-duo-ready'))return null;
    if(e.route==='today')return {route:'today',tab:'today',acct:'both'};   // v249: Today = both accounts' command blocks
    var tab=TAB[e.route];if(!tab)return null;
    var area=e.area;if(area!=='apex'&&area!=='agentic')return null;
    return {route:e.route,tab:tab,acct:e.account==='agentic'?'agentic':'main'};
  }
  // The free part of the left pane: below the blocks duo.js pinned there, above the bottom nav (phone) or the screen edge (rail).
  function geo(){
    var cs=getComputedStyle(root),x0=parseFloat(cs.getPropertyValue('--duo-x0')),fl=parseFloat(cs.getPropertyValue('--fold-left'));
    if(!(x0>=0)||!(fl>0))return null;
    var top=0;
    Array.prototype.forEach.call(document.querySelectorAll('[data-duo-pin]'),function(n){var r=n.getBoundingClientRect();if(r.height>0&&r.left<fl)top=Math.max(top,r.bottom);});
    if(!top){var f=document.getElementById('pf-fresh');if(f)top=f.getBoundingClientRect().bottom;}
    var H=G.innerHeight,bottom=H-8,nav=document.querySelector('.ex-main');
    if(nav){var nr=nav.getBoundingClientRect();if(nr.height>0&&nr.top>H/2)bottom=nr.top-8;}
    var g={left:Math.round(x0),top:Math.round(top+8),width:Math.round(fl-x0),height:Math.round(bottom-top-8)};
    return g.width>=MIN_W&&g.height>=MIN_H?g:null;
  }

  // ── data (read only) ─────────────────────────────────────────────────────────────────────────────────────────────────────────
  function rows(acct){
    try{var r=typeof G.__pfPosRows==='function'?G.__pfPosRows(acct):[];return r.filter(function(x){return x&&x.symbol;})
      .sort(function(a,b){return (num(b.val)==null?-1:b.val)-(num(a.val)==null?-1:a.val);});}catch(_){return [];}
  }
  function apex(){
    var c=G.__PF_APEX_REVIEW,d=G.__DATA;
    return c&&d&&G.Apex&&c.sourceData===d&&c.sourceSnap===G.__SNAP&&c.generatedAt===d.generatedAt?c:null;
  }
  function perf(acct){
    try{var d=G.__DATA;if(!d||typeof G.acctPerfStats!=='function')return null;
      var spy=typeof G.azSeries==='function'?G.azSeries('SPY'):null;return G.acctPerfStats(acct==='agentic'?d.agentic:d.main,spy);}catch(_){return null;}
  }
  function selected(){try{return (G.PFJourney&&G.PFJourney.state&&G.PFJourney.state.symbol)||'';}catch(_){return '';}}
  function shortDate(t){try{return new Date(String(t).slice(0,10)+'T00:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric'});}catch(_){return String(t).slice(0,10);}}

  // ── pieces ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  function sec(title,meta,body,cls){return '<section class="bk-sec'+(cls?' '+cls:'')+'"><h3 class="bk-h"><span>'+title+'</span>'+(meta?'<small>'+meta+'</small>':'')+'</h3>'+body+'</section>';}
  // A tappable row that opens the matching analysis on the right page.
  function goRow(attrs,label,value,sub,extra){
    return '<button type="button" class="bk-row" '+attrs+'><span class="bk-row-l">'+label+(sub?'<small>'+sub+'</small>':'')+'</span><span class="bk-row-v">'+value+'</span><i aria-hidden="true">›</i>'+(extra||'')+'</button>';
  }
  // A 0–100% track with an optional limit tick.
  function bar(fill,tick,warn){
    return '<span class="bk-bar'+(warn?' bk-warn':'')+'" aria-hidden="true"><b style="width:'+clamp(fill,0,100).toFixed(1)+'%"></b>'+(tick!=null?'<em style="left:'+clamp(tick,0,100).toFixed(1)+'%"></em>':'')+'</span>';
  }
  function spark(st){
    var m=st&&Array.isArray(st.mult)?st.mult.slice(-60):[];
    if(m.length<2)return '';
    var lo=Math.min.apply(null,m),hi=Math.max.apply(null,m),span=hi-lo||1,n=m.length-1;
    var pts=m.map(function(v,i){return (i/n*100).toFixed(2)+','+(30-(v-lo)/span*28+1).toFixed(2);}).join(' ');
    var base=(30-(m[0]-lo)/span*28+1).toFixed(2), up=m[m.length-1]>=m[0];
    return '<svg class="bk-spark'+(up?' bk-up':' bk-dn')+'" viewBox="0 0 100 32" preserveAspectRatio="none" aria-hidden="true"><line x1="0" x2="100" y1="'+base+'" y2="'+base+'" class="bk-base"/><polyline points="'+pts+'" vector-effect="non-scaling-stroke"/></svg>';
  }
  function perfSec(acct){
    var st=perf(acct);
    if(!st)return sec('Performance','','<p class="bk-empty">Needs two recorded days of account equity.</p>');
    var alpha=num(st.spy)!==null?st.ret-st.spy:null;
    var meta='deposit-adjusted · since '+esc(shortDate(st.since));
    var body='<button type="button" class="bk-perf" data-bk-card="performance" data-bk-acct="'+acct+'" aria-label="Open the Performance card">'+spark(st)+
      '<span class="bk-perf-n"><b class="'+tone(st.ret).trim()+'">'+pct(st.ret)+'</b><span>S&amp;P '+(num(st.spy)===null?'—':pct(st.spy))+' same window'+(alpha!==null?' · '+(alpha>=0?'ahead':'behind')+' '+Math.abs(alpha).toFixed(1)+'pp':'')+'</span></span><i aria-hidden="true">›</i></button>';
    return sec('Performance',meta,body);
  }
  function holdRow(r,max,sel,attrs){
    var w=num(r.pct);
    return '<button type="button" class="bk-hold'+(r.symbol===sel?' bk-sel':'')+'" '+attrs+(r.symbol===sel?' aria-current="true"':'')+'>'+
      '<b class="bk-sym">'+esc(r.symbol)+'</b>'+
      '<span class="bk-w">'+bar(w===null||!max?0:w/max*100)+'<small>'+(w===null?'—':w.toFixed(1)+'%')+'</small></span>'+
      '<span class="bk-day'+tone(r.dayP)+'">'+pct(r.dayP)+'</span>'+
      '<span class="bk-ret'+tone(r.pnlP)+'">'+pct(r.pnlP)+'</span></button>';
  }
  function holdHead(){return '<div class="bk-hold-h" aria-hidden="true"><span>Name</span><span>Weight</span><span>Today</span><span>Return</span></div>';}
  function holdings(acct,limit,mode){
    var rs=rows(acct),sel=selected();
    if(!rs.length)return sec('Holdings','','<p class="bk-empty">'+(acct==='agentic'&&!Array.isArray(G.__DATA&&G.__DATA.agentic&&G.__DATA.agentic.positions)?'Agentic holdings unavailable in this snapshot.':'No open positions.')+'</p>');
    var max=Math.max.apply(null,rs.map(function(r){return num(r.pct)||0;}))||0;
    var shown=limit?rs.slice(0,limit):rs;
    var attr=function(r){return mode==='research'?'data-pj-go="analyze" data-pj-sym="'+esc(r.symbol)+'"':'data-bk-sym="'+esc(r.symbol)+'"';};
    var more=limit&&rs.length>limit?'<button type="button" class="bk-more" data-ex-route="holdings">All '+rs.length+' positions ›</button>':'';
    var title=mode==='research'?'Compare holdings':mode==='positions'?'All holdings':mode==='actions'?'Top holdings':'Holdings';
    var meta=mode==='research'?'tap one to research it':mode==='positions'||mode==='actions'?'tap one to open it':'tap one to see it on the right';
    return sec(title+' <span class="bk-count">'+rs.length+'</span>',meta,holdHead()+'<div class="bk-holds">'+shown.map(function(r){return holdRow(r,max,sel,attr(r));}).join('')+'</div>'+more);
  }

  // Apex: margin, leverage, concentration, portfolio risk.
  function apexRisk(acct){
    var c=apex(),rs=rows(acct),out='';
    if(c){
      var st=c.st,C=G.Apex.C,lev=num(st.lev),cap=C.LEV_CAP,lo=1;
      if(lev!==null){
        var at=function(v){return clamp((v-lo)/(cap-lo),0,1)*100;};
        var debt=num(st.debt)>0;
        var short=st.band==='over'?'Over cap':st.band==='high'?'Above cruise':st.band==='normal'?'In band':debt?'Room':'No margin';
        var word=st.band==='over'?'Over the '+cap+'× cap · no new buys':st.band==='high'?'Above '+C.LEV_NORMAL+'× cruise · no new buys':st.band==='normal'?'Between reload and '+C.LEV_NORMAL+'× cruise':debt?'Under the '+C.LEV_RELOAD+'× reload line':'No borrowing';
        var gauge='<span class="bk-gauge" aria-hidden="true"><span class="bk-zone" style="left:'+at(C.LEV_RELOAD)+'%;width:'+(at(C.LEV_NORMAL)-at(C.LEV_RELOAD))+'%"></span><span class="bk-zone bk-zone-hi" style="left:'+at(C.LEV_NORMAL)+'%;width:'+(100-at(C.LEV_NORMAL))+'%"></span><b style="left:'+at(lev)+'%"></b></span>';
        out+=goRow('data-ex-route="plan" data-ex-account="main" data-bk-why="leverage"','Leverage band',esc(short),esc(word),gauge);
      }
      if(num(st.debt)>0&&num(st.callDrop)!==null)out+=goRow('data-bk-card="risk" data-bk-acct="main"','Margin cushion',plain(st.callDrop*100,0),'the book can fall this far before a call');
      try{
        if(c.cfg.themeCap!==false){var th=G.Apex.themeShare(st,c.cfg);if(th&&th.outside>0){
          out+=goRow('data-ex-route="acctresearch" data-ex-account="main" data-bk-why="theme"','Tech outside '+esc(c.cfg.core||'core'),plain(th.share*100,0),'cap '+Math.round(th.max*100)+'%'+(th.over?' · over':''),bar(th.share*100,th.max*100,th.over));}}
      }catch(_){}
    }
    if(rs.length){var top=rs.slice().sort(function(a,b){return (num(b.pct)||0)-(num(a.pct)||0);})[0];
      if(num(top.pct)!==null)out+=goRow('data-bk-sym="'+esc(top.symbol)+'" data-bk-acct="'+acct+'"','Largest position',plain(top.pct,1),esc(top.symbol)+' · share of book',bar(top.pct));}
    if(!out)return '';
    return sec('Risk','Apex band '+(c?G.Apex.C.LEV_RELOAD+' / '+G.Apex.C.LEV_NORMAL+' / '+G.Apex.C.LEV_CAP+'×':''),'<div class="bk-rows">'+out+'</div>');
  }
  // Agentic: deployment, available cash, strategy health, review status.
  function agenticStrategy(){
    var d=G.__DATA,A=d&&d.agentic,out='';
    if(A&&typeof G.agenticBook==='function'){
      try{var b=G.agenticBook(A),eq=num(b.equity);
        if(eq&&eq>0){var inv=num(b.invested)||0,cash=num(b.cash)||0,ip=inv/eq*100;
          out+=goRow('data-ex-route="plan" data-ex-account="agentic"','Deployed',plain(ip,1),money(inv)+' invested of '+money(eq),bar(ip));}}catch(_){}
    }
    var M=G.PFExperienceModel;
    if(A&&M&&typeof M.ticketStatus==='function'){
      if(A.pending&&A.pending.status){var t=M.ticketStatus(A.pending);out+=goRow('data-ex-route="plan" data-ex-account="agentic"',esc(t.heading||'Ticket'),'',esc(t.label),'');}
      else out+=goRow('data-ex-route="plan" data-ex-account="agentic"','Ticket','','No active ticket','');
    }
    // v255: research age against the 14-day cycle it runs on.
    var rc=A&&A.target&&M&&typeof M.researchCycle==='function'?M.researchCycle(A.target.asOf):null;
    if(rc)out+=goRow('data-ex-route="acctresearch" data-ex-account="agentic"','Research',rc.days+'d',rc.overdue?(rc.days-rc.cycle)+'d past the '+rc.cycle+'-day cycle':'of a '+rc.cycle+'-day cycle',bar(rc.fill,null,rc.overdue));
    var T=G.__PF_AG_TARGET;
    if(T&&Array.isArray(T.rows)&&T.rows.length){
      var dr=T.rows.filter(function(r){return num(r.drift)!==null;}).sort(function(a,b){return Math.abs(b.drift)-Math.abs(a.drift);})[0];
      if(dr)out+=goRow('data-ex-route="acctresearch" data-ex-account="agentic"','Largest drift',(dr.drift>0?'+':'−')+Math.abs(dr.drift).toFixed(1)+'pp',esc(dr.sym)+' vs its '+(num(dr.tgt)===null?'—':dr.tgt.toFixed(1)+'%')+' target'+(T.asOf?' · research '+esc(shortDate(T.asOf)):''));
    }
    if(!out)return '';
    return sec('Strategy','••••3900 · automated','<div class="bk-rows">'+out+'</div>');
  }
  // v253 Research tab (Jack, Nov 18 2026: Book = navigation / context left, detail right). The left page lists the research
  // sections that are on the right page (tap = scroll the right page to it) and the names that research is about (tap = the
  // existing single-stock Analyze). It repeats no figure from the right page: labels and tickers only.
  function onPage(sel){try{var n=document.querySelector('#page-picks '+sel);return !!n&&n.getClientRects().length>0;}catch(_){return false;}}
  function jumpRow(sel,label){return onPage(sel)?goRow('data-bk-jump="'+esc(sel)+'"',label,'',''):'';}
  function nameRow(sym,sub){return goRow('data-pj-go="analyze" data-pj-sym="'+esc(sym)+'"','<b class="bk-sym">'+esc(sym)+'</b>','',sub?esc(sub):'');}
  function findings(acct){
    var nav='',names=[],seen={};
    var add=function(sym,sub){sym=String(sym||'').toUpperCase();if(!sym||seen[sym])return;seen[sym]=1;names.push(nameRow(sym,sub));};
    if(acct==='agentic'){
      nav=jumpRow('[data-toggle="b-agp-target"]','The target and why')+jumpRow('.cr-card','Model correctness')+jumpRow('[data-toggle="b-agp-biz"]','Business check');
      try{var ns=G.__DATA&&G.__DATA.agentic&&G.__DATA.agentic.target&&G.__DATA.agentic.target.names;
        (Array.isArray(ns)?ns:[]).forEach(function(n){if(n&&n.ticker)add(n.ticker,n.phaseOut?'phase-out':'target');});}catch(_){}
    } else {
      nav=jumpRow('[data-apex-research]','This week\u2019s research')+jumpRow('[data-apex-opps]','Ranked opportunities')+jumpRow('[data-apex-veto]','Screened out')
        +jumpRow('[data-apex-weights]','Weights vs target')+jumpRow('[data-apex-business]','Business check')+jumpRow('[data-apex-paper-link]','v2.9 Paper research');
      try{var T=G.__APEX_TGT||{};
        Object.keys(T.targets&&typeof T.targets==='object'?T.targets:{}).forEach(function(k){add(k,'this week\u2019s target');});
        (Array.isArray(T.top5)?T.top5:[]).forEach(function(r){if(r&&r.sym)add(r.sym,'top five');});
        (Array.isArray(T.heldLevels)?T.heldLevels:[]).forEach(function(r){if(r&&r.sym)add(r.sym,'held name');});}catch(_){}
    }
    nav+=goRow('data-pj-go="analyze"','Analyze a stock','','');
    return sec('On this page','tap to jump','<div class="bk-rows">'+nav+'</div>')+
      (names.length?sec('Names in this research <span class="bk-count">'+names.length+'</span>','tap one to analyze it','<div class="bk-rows">'+names.join('')+'</div>'):'');
  }
  function queue(){
    var e=E(),h='';
    try{h=e&&typeof e.actionsHTML==='function'?e.actionsHTML():'';}catch(_){h='';}
    return h?'<section class="bk-sec bk-queue">'+h.replace('Action Center','Review queue')+'</section>':'';
  }

  // v249 Today (Jack, Nov 18 01:21 ET, Book screenshot of Today: the left page held only the combined hero). Today's right page
  // already carries the combined holdings map, Waiting on you, Out of your hands, value history and the market backdrop, so the
  // left page adds only what Today does not show: each account's own command block and its deposit-adjusted performance.
  // No combined holdings list here (that would repeat the right page's map).
  function group(label,body){return body?'<div class="bk-group"><div class="bk-eyebrow">'+label+'</div>'+body+'</div>':'';}
  function build(c){
    if(c.tab==='today')return group('Apex · self-directed ••••0741',apexRisk('main')+perfSec('main'))+group('Agentic · automated ••••3900',agenticStrategy()+perfSec('agentic'));
    var a=c.acct,head=a==='agentic'?agenticStrategy():apexRisk(a);
    if(c.tab==='overview')return head+perfSec(a)+holdings(a,OVERVIEW_ROWS,'overview');
    if(c.tab==='positions')return holdings(a,0,'positions')+head;
    if(c.tab==='research')return holdings(a,0,'research');
    if(c.tab==='findings')return findings(a);
    // v255 (audit, Nov 18 2026): the Actions left page held only the queue and the strategy block and left most of the page blank;
    // it now also carries the account's performance and its top holdings (a tap opens that holding in Positions).
    return queue()+head+perfSec(a)+holdings(a,ACTION_ROWS,'actions');
  }

  // ── duplicate figures (owner: "Don't repeat the same account numbers in multiple sections") ─────────────────────────────────────
  // On Overview the left page already carries the cloned Day change / Leverage (Idle cash) tiles, so their originals in the right
  // page's snapshot grid are hidden while Book is on. Display only; the tiles stay in the DOM and come back the moment Book is off.
  function dedup(c){
    var on=!!c&&c.route==='accounts';
    Array.prototype.forEach.call(document.querySelectorAll('[data-book-dup],[data-book-n]'),function(n){if(!on){n.removeAttribute('data-book-dup');n.removeAttribute('data-book-n');}});
    if(!on)return;
    var r=document.getElementById(c.acct==='agentic'?'agentic-app':'app'),strip=r&&r.querySelector(':scope>#ws-strip');
    if(!strip||!strip.hasAttribute('data-duo-pin'))return;
    var labels=Array.prototype.map.call(strip.querySelectorAll('.snap-lbl'),function(n){return n.textContent.trim();});
    var grid=r.querySelector(':scope>[data-sec="snapshot"] .snap-grid');if(!grid)return;
    var tiles=Array.prototype.slice.call(grid.querySelectorAll(':scope>.snap')),shown=0;
    tiles.forEach(function(t){var l=(t.querySelector('.snap-lbl')||{}).textContent;l=l?l.trim():'';
      if(labels.indexOf(l)>=0){if(!t.hasAttribute('data-book-dup'))t.setAttribute('data-book-dup','');}else{t.removeAttribute('data-book-dup');shown++;}});
    var n=String(shown);if(grid.getAttribute('data-book-n')!==n)grid.setAttribute('data-book-n',n);
  }

  // ── paint ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  function ensure(){
    if(el&&el.isConnected)return el;
    el=document.createElement('aside');el.id='pf-book';el.className='pf-book';el.setAttribute('data-priv','on');el.setAttribute('aria-label','Command panel');el.hidden=true;
    el.addEventListener('scroll',function(){if(key)scrolls[key]=el.scrollTop;},{passive:true});
    document.body.appendChild(el);return el;
  }
  function paint(){
    raf=0;
    var c=ctx(),g=c?geo():null,on=!!(c&&g);
    if(on!==lastOn){lastOn=on;if(on)root.setAttribute('data-book','on');else root.removeAttribute('data-book');var e=E();if(e&&e.refreshBlocks)try{e.refreshBlocks();}catch(_){}}
    dedup(on?c:null);
    if(!on){if(el){el.hidden=true;}key='';return;}
    var p=ensure(),k=c.acct+':'+c.tab;
    p.style.left=g.left+'px';p.style.top=g.top+'px';p.style.width=g.width+'px';p.style.height=g.height+'px';
    p.setAttribute('data-tab',c.tab);p.setAttribute('data-acct',c.acct);
    var html=build(c);
    if(html!==src||k!==key){
      var keep=k===key?p.scrollTop:(scrolls[k]||0);
      src=html;p.innerHTML=html||'<p class="bk-empty">Nothing to show for this account yet.</p>';
      key=k;p.scrollTop=keep;
    }
    p.hidden=false;
  }
  function soon(){if(!raf)raf=G.requestAnimationFrame(paint);}

  // ── taps ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  // A holding on Overview or Positions selects it (the journey's own selection, so Research / Plan follow it) and shows its card at
  // the top of the right page; a card link scrolls the right page to that card on Overview. Route links (data-ex-route) and the
  // Research list (data-pj-go) are handled by the existing experience / journey listeners.
  function showCard(sec,acct){
    var e=E();if(!e)return;acct=acct==='agentic'||acct==='main'?acct:e.account;
    var go=function(){
      var r=document.getElementById(e.account==='agentic'?'agentic-app':'app'),card=r&&r.querySelector(':scope>[data-sec="'+sec+'"]');
      if(!card)return false;
      var body=card.querySelector(':scope>[data-toggle], :scope>.card-body'),t=card.querySelector(':scope>.card-title');
      if(t&&t.getAttribute('aria-expanded')==='false')t.click();   // the card's own toggle: opens it the way a tap would (v235 fold contract)
      var y=card.getBoundingClientRect().top+G.scrollY-((G.__pfTopOffset&&G.__pfTopOffset())||8)-8;G.scrollTo(0,Math.max(0,y));return true;
    };
    if(e.route!=='accounts'||e.account!==acct){e.navigate('accounts',{account:acct});setTimeout(go,260);}else go();
  }
  // v253: scroll the right page to a research section. Opens the card if it is folded (its own toggle), never re-renders it.
  function jumpTo(sel){
    var n=null;try{n=document.querySelector('#page-picks '+sel);}catch(_){n=null;}
    if(!n)return;
    var card=n.closest('.card')||n,t=card.querySelector(':scope>.card-title');
    if(t&&t.getAttribute('aria-expanded')==='false')t.click();
    var target=n.matches('[data-toggle]')?card:n;
    var y=target.getBoundingClientRect().top+G.scrollY-((G.__pfTopOffset&&G.__pfTopOffset())||8)-8;G.scrollTo(0,Math.max(0,y));
    var prev=target.style.boxShadow;target.style.boxShadow='0 0 0 2px #6366f1';setTimeout(function(){target.style.boxShadow=prev;},900);
  }
  document.addEventListener('click',function(ev){
    if(!el||!el.contains(ev.target))return;
    var s=ev.target.closest('[data-bk-sym]'),cd=ev.target.closest('[data-bk-card]');
    if(s){
      var e=E(),sym=s.getAttribute('data-bk-sym'),acct=s.getAttribute('data-bk-acct')||(e?e.account:'main');
      // From Today (or the other account) the tap opens that account's Positions first, so the selection lands in the right book.
      if(e&&(e.account!==acct||(e.route!=='accounts'&&e.route!=='holdings')))e.navigate('holdings',{account:acct});
      try{if(G.PFJourney)G.PFJourney.select(sym);}catch(_){}
      G.__pfBookPick={acct:acct,sym:sym};
      try{if(e&&e.refreshBlocks)e.refreshBlocks();}catch(_){}
      G.scrollTo(0,0);soon();
    } else if(cd){showCard(cd.getAttribute('data-bk-card'),cd.getAttribute('data-bk-acct'));}
    else { var j=ev.target.closest('[data-bk-jump]'); if(j)jumpTo(j.getAttribute('data-bk-jump')); }
  });
  document.addEventListener('click',function(ev){var x=ev.target.closest('[data-bk-clear]');if(!x)return;G.__pfBookPick=null;var e=E();try{if(e&&e.refreshBlocks)e.refreshBlocks();}catch(_){}});

  // ── when to repaint ─────────────────────────────────────────────────────────────────────────────────────────────────────────
  // duo.js re-pins on route / render / fold changes and stamps html[data-duo-ready]; the panel follows those, any change under the
  // account roots (late renderers, selection on the right page) and resizes. Its own writes are ignored.
  function start(){
    new MutationObserver(soon).observe(root,{attributes:true,attributeFilter:['data-duo-ready','data-duo-split','data-duo-layout','data-ws-tab','data-theme']});
    var mo=new MutationObserver(function(rec){for(var i=0;i<rec.length;i++){if(!el||!el.contains(rec[i].target)){soon();return;}}});
    ['app','agentic-app','picks-app','plan-agentic-app','az-result','pj-context'].forEach(function(id){var n=document.getElementById(id);if(n)mo.observe(n,{childList:true,subtree:true});});
    ['pf:route','pf:render','pf:duo-change','pf:account'].forEach(function(t){document.addEventListener(t,soon);});
    document.addEventListener('change',soon);
    G.addEventListener('resize',soon);
    if(G.visualViewport)G.visualViewport.addEventListener('resize',soon);
    soon();
  }
  G.PFBook={refresh:soon,get on(){return lastOn;},core:{TAB:TAB}};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();
})();
