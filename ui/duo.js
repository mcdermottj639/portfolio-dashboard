/* v220 — asymmetric safe-area fallback. v232 correction: Safari's Duo controls
   column is outside the web viewport, not reclaimable CSS padding. This applies
   only where an environment actually exposes a large asymmetric inset. It sets
   html.pf-side-status + --duo-r so ui/duo.css can keep just the top rows clear and let the cards run full width.
   Symmetric insets are left alone. Layout only; reads no data or screen identity. */
(function(){
  if(typeof document==='undefined')return; // node unit tests load this file for PFDuo.core only
  var probe, observer, frame;
  function measure(){
    try{
      if(!probe){
        probe=document.createElement('div');probe.id='pf-duo-insets';probe.setAttribute('aria-hidden','true');
        // Observe the environment itself. Insets can arrive after first paint or
        // change on PWA resume without a window resize/orientation event.
        probe.style.cssText='position:fixed;top:0;left:0;visibility:hidden;pointer-events:none;'+
          'width:env(safe-area-inset-right,0px);height:env(safe-area-inset-left,0px)';
        (document.body||document.documentElement).appendChild(probe);
        if(window.ResizeObserver){observer=new ResizeObserver(schedule);observer.observe(probe);}
      }
      var cs=getComputedStyle(probe), r=parseFloat(cs.width)||0, l=parseFloat(cs.height)||0;
      var on=r>=60&&l<20, root=document.documentElement;
      root.classList.toggle('pf-side-status',on);
      if(on) root.style.setProperty('--duo-r',r+'px'); else root.style.removeProperty('--duo-r');
      /* v222: folded + landscape puts the inset on the LEFT (about 85px); ui/duo.css hangs the nav rail in it. */
      if(l>0) root.style.setProperty('--duo-l',l+'px'); else root.style.removeProperty('--duo-l');
    }catch(_){}
  }
  function schedule(){cancelAnimationFrame(frame);frame=requestAnimationFrame(measure);}
  if(document.body) measure(); else document.addEventListener('DOMContentLoaded',measure);
  addEventListener('resize',schedule);addEventListener('pageshow',schedule);
  addEventListener('orientationchange',function(){schedule();setTimeout(schedule,250)});
  document.addEventListener('visibilitychange',function(){if(!document.hidden)schedule();});
  if(window.visualViewport)window.visualViewport.addEventListener('resize',schedule);
  window.__pfDuoMeasure=measure;
})();

/* v247 — central Duo layout state. ONE owner (this file) of html[data-duo-mode], html[data-duo-layout], html[data-duo-split],
   the --fold-* vars and window.PFDuo. Jack's rule (Sports Hub, Nov 2026): Duo optimization ALWAYS applies (the width rules
   in ui/duo.css never depend on this); the mode controls ONLY the mid-fold split of a landing view.
     mode   auto | folded | book | standard   (localStorage 'pf:duo-mode'; storage failure or junk = auto)
     layout standard | folded | book          (what is actually applied)
   auto    = the browser's own fold signals only (Viewport Segments API, or its CSS media queries + env() geometry, and
             Device Posture): two stacked segments -> folded, two side-by-side -> book, anything else -> standard.
             Never screen-size guessing. Safari without the flags (or any browser without the APIs) stays standard in auto.
   folded  = top / bottom split at the reported fold, or at 50% of the viewport height when none is reported.
   book    = left / right split at the reported fold, or at 50% of the viewport width.
   standard= the v246 layout, byte for byte (nothing below is applied).
   The split applies to landing views only (Today; Accounts = Apex/Agentic Overview; Markets and Analyze = Research; v2.9
   Paper). Every other route stays full screen in every mode. Layout only: no node is moved, removed or re-rendered;
   summary blocks are pinned in place (position:fixed, set from here) and the rest of the page keeps the document scroll. */
(function(){
  'use strict';
  var G=typeof window!=='undefined'?window:globalThis;
  var KEY='pf:duo-mode', MODES=['auto','folded','book','standard'], GAP=24, FORCED_GAP=8;   // a reported crease gets a 24px gutter; a forced split has no crease, so only a hairline gap
  var LANDING={today:1,accounts:1,markets:1,analyze:1,apexpaper:1};
  // v248: in Book only, the rest of the Apex / Agentic workspace (Positions, Actions and Overview's section routes) splits too, so
  // ui/book.js can keep the command panel on the left page. Folded keeps the v247 set above.
  var BOOK_ROUTES={holdings:1,plan:1,performance:1,heatmap:1,risk:1,income:1,technicals:1,fundamentals:1,flow:1};
  function normalizeMode(v){return MODES.indexOf(v)>=0?v:'auto';}
  function readMode(store){try{return normalizeMode(store&&store.getItem(KEY));}catch(_){return 'auto';}}
  function writeMode(store,m){try{store.setItem(KEY,m);return true;}catch(_){return false;}}
  function rectOk(r){return !!r&&['top','bottom','left','right'].every(function(k){return Number.isFinite(r[k]);})&&r.bottom>r.top&&r.right>r.left;}
  // Two segments, ordered by position. Anything else (0, 1, 3+, malformed) is "no usable fold".
  function pair(list){
    if(!list||list.length!==2)return null;
    var p=Array.prototype.slice.call(list);
    if(!p.every(rectOk))return null;
    return p.sort(function(a,b){return a.top-b.top||a.left-b.left;});
  }
  // sig: {segments:[rect,rect]|null, posture:'folded'|'continuous'|''}. Stacked + not continuous -> folded;
  // side by side + not continuous -> book. A posture alone (no geometry) cannot place a split, so it never decides.
  function detect(sig){
    var p=pair(sig&&sig.segments), post=sig&&sig.posture||'';
    if(!p||post==='continuous')return {layout:'standard',a:null,b:null};
    var a=p[0],b=p[1];
    if(b.top>=a.bottom-1&&Math.abs(a.left-b.left)<2)return {layout:'folded',a:a,b:b};
    if(b.left>=a.right-1&&Math.abs(a.top-b.top)<2)return {layout:'book',a:a,b:b};
    return {layout:'standard',a:null,b:null};
  }
  function resolve(mode,detected){mode=normalizeMode(mode);return mode==='auto'?(detected||'standard'):mode;}
  // Fold geometry in px. Real segments set the crease (with a gutter of at least GAP px); otherwise half the viewport.
  function geometry(layout,W,H,det){
    if(layout==='folded'){
      if(det&&det.layout==='folded'){var mid=(det.a.bottom+det.b.top)/2;return {top:Math.round(Math.min(det.a.bottom,mid-GAP/2)),bottom:Math.round(Math.max(det.b.top,mid+GAP/2)),real:true};}
      var h=Math.round(H/2);return {top:h-FORCED_GAP/2,bottom:h+FORCED_GAP/2,real:false};
    }
    if(layout==='book'){
      if(det&&det.layout==='book'){var m=(det.a.right+det.b.left)/2;return {left:Math.round(Math.min(det.a.right,m-GAP/2)),right:Math.round(Math.max(det.b.left,m+GAP/2)),real:true};}
      var w=Math.round(W/2);return {left:w-FORCED_GAP/2,right:w+FORCED_GAP/2,real:false};
    }
    return null;
  }
  var core={KEY:KEY,MODES:MODES,LANDING:LANDING,BOOK_ROUTES:BOOK_ROUTES,GAP:GAP,FORCED_GAP:FORCED_GAP,normalizeMode:normalizeMode,readMode:readMode,writeMode:writeMode,detect:detect,resolve:resolve,geometry:geometry};
  var api=G.PFDuo=G.PFDuo||{};api.core=core;
  if(typeof document==='undefined'||!G.document)return;

  var root=document.documentElement, mode=readMode((function(){try{return G.localStorage;}catch(_){return null;}})());
  var layout='standard', split=false, det={layout:'standard'}, lastSig='', pinned=[], mo=null, raf=0, applying=false;
  function mq(q){try{return G.matchMedia?G.matchMedia(q):null;}catch(_){return null;}}
  var MQ={v2:mq('(vertical-viewport-segments: 2)'),h2:mq('(horizontal-viewport-segments: 2)'),folded:mq('(device-posture: folded)'),cont:mq('(device-posture: continuous)')};
  function envPx(expr){
    if(!document.body)return NaN;
    var d=document.createElement('div');d.setAttribute('aria-hidden','true');
    d.style.cssText='position:fixed;top:0;left:0;width:0;height:0;visibility:hidden;pointer-events:none;padding-top:'+expr;
    document.body.appendChild(d);var v=parseFloat(getComputedStyle(d).paddingTop);d.remove();return v;
  }
  // Segments from the JS list when it exists, else from the CSS media queries + env() (Safari can expose one half of the API).
  function segmentsNow(){
    var s=G.viewport&&G.viewport.segments, p=pair(s);
    if(p)return {src:'js',list:p};
    var W=G.innerWidth,H=G.innerHeight;
    if(MQ.v2&&MQ.v2.matches){
      var t=envPx('env(viewport-segment-bottom 0 0, -1px)'),n=envPx('env(viewport-segment-top 0 1, -1px)');
      if(t>0&&n>0)return {src:'css',list:[{top:0,bottom:t,left:0,right:W},{top:n,bottom:H,left:0,right:W}]};
    }
    if(MQ.h2&&MQ.h2.matches){
      var r=envPx('env(viewport-segment-right 0 0, -1px)'),l=envPx('env(viewport-segment-left 1 0, -1px)');
      if(r>0&&l>0)return {src:'css',list:[{top:0,bottom:H,left:0,right:r},{top:0,bottom:H,left:l,right:W}]};
    }
    return {src:'none',list:null};
  }
  function postureNow(){
    var dp=G.navigator&&G.navigator.devicePosture;
    if(dp&&dp.type)return dp.type;
    if(MQ.folded&&MQ.folded.matches)return 'folded';
    if(MQ.cont&&MQ.cont.matches)return 'continuous';
    return '';
  }
  var $=function(id){return document.getElementById(id);};
  function route(){try{return G.PFExperience&&G.PFExperience.route||'';}catch(_){return '';}}
  function landing(){
    var E=G.PFExperience,r=route();if(!E)return false;
    return !!LANDING[r]||(layout==='book'&&!!BOOK_ROUTES[r]&&(E.area==='apex'||E.area==='agentic'));
  }
  function vis(e){return !!e&&e.getClientRects().length>0;}
  // Summary blocks per landing view, in the order they stack in the top (or left) pane. Chrome first. Existing nodes only.
  function atoms(){
    var out=[],r=route(),q=function(s){return Array.prototype.slice.call(document.querySelectorAll(s)).filter(vis);};
    q('#ex-top').forEach(function(e){out.push(e);});   // the tab row (#ex-subnav) is interactive: it stays in the flow, at the top of the scrolling part
    if(r==='today')q('#page-ex-today .td-hero').forEach(function(e){out.push(e);});
    else if(r==='accounts'||(BOOK_ROUTES[r]&&r!=='plan')){q('#page-portfolio .header').slice(0,1).forEach(function(e){out.push(e);});q('#page-portfolio #ws-strip').forEach(function(e){out.push(e);});}
    else if(r==='markets')q('#markets-app > .picks-hero').forEach(function(e){out.push(e);});
    else if(r==='analyze'){q('#pj-context').forEach(function(e){out.push(e);});q('#az-result > .card:first-child').forEach(function(e){out.push(e);});}
    else if(r==='apexpaper'){q('#apexpaper-app .apx-head').forEach(function(e){out.push(e);});q('#apexpaper-app .apx-decision .apx-tiles').forEach(function(e){out.push(e);});}
    return out;
  }
  function unpin(){
    pinned.forEach(function(e){e.removeAttribute('data-duo-pin');e.style.removeProperty('--duo-x');e.style.removeProperty('--duo-y');e.style.removeProperty('--duo-w');});
    pinned=[];
    ['--duo-lead','--duo-padl','--duo-x0','--duo-ground','--duo-fresh-top'].forEach(function(k){root.style.removeProperty(k);});
    root.removeAttribute('data-duo-ready');
  }
  function pin(geo){
    var fresh=$('pf-fresh'); if(!fresh)return;
    // The strip sticks 8px higher than it sits at scroll 0, so measure where it naturally is (document position) and keep it
    // there while this split is on: the pinned blocks hang from it and must not move relative to it.
    var ps=fresh.style.getPropertyValue('position'), pp=fresh.style.getPropertyPriority('position');
    var ts=fresh.style.getPropertyValue('top'), tp=fresh.style.getPropertyPriority('top');
    fresh.style.setProperty('position','relative','important');fresh.style.setProperty('top','0','important');
    var fr=fresh.getBoundingClientRect(), natTop=Math.round(fr.top+(G.scrollY||0));
    if(ps)fresh.style.setProperty('position',ps,pp);else fresh.style.removeProperty('position');
    if(ts)fresh.style.setProperty('top',ts,tp);else fresh.style.removeProperty('top');
    var x0=fr.left, w0=fr.width, top0=Math.round(natTop+fr.height+4), H=G.innerHeight;
    root.style.setProperty('--duo-fresh-top',natTop+'px');
    var bg=''; try{bg=getComputedStyle(document.body).backgroundColor;}catch(_){}
    if(bg&&bg!=='rgba(0, 0, 0, 0)')root.style.setProperty('--duo-ground',bg);
    var paneBottom, x=x0, w=w0;
    if(layout==='folded'){paneBottom=geo.top;}
    else{
      var nav=document.querySelector('.ex-main'),nb=H;
      if(nav){var nr=nav.getBoundingClientRect();if(nr.top>H/2)nb=nr.top;}
      paneBottom=nb-8; w=Math.max(120,geo.left-x0);
    }
    var y=top0, list=atoms();
    for(var i=0;i<list.length;i++){
      var e=list[i];
      e.setAttribute('data-duo-pin','');e.style.setProperty('--duo-x',x+'px');e.style.setProperty('--duo-w',w+'px');e.style.setProperty('--duo-y',y+'px');
      var h=e.getBoundingClientRect().height;
      if(y+h>paneBottom+0.5){e.removeAttribute('data-duo-pin');e.style.removeProperty('--duo-x');e.style.removeProperty('--duo-w');e.style.removeProperty('--duo-y');break;}
      pinned.push(e);y=Math.round(y+h+4);
    }
    if(layout==='folded')root.style.setProperty('--duo-lead',Math.max(8,Math.round(geo.bottom+8-(natTop+fr.height)))+'px');
    else{root.style.setProperty('--duo-padl',geo.right+'px');root.style.setProperty('--duo-x0',Math.round(x0)+'px');}
    root.setAttribute('data-duo-ready','');   // CSS that depends on the measured vars waits for this
  }
  // The place the reader is at: the element under the top of the scrolling region and its offset from that region's top.
  function regionTop(){
    var fresh=$('pf-fresh');if(!fresh)return 0;
    var b=fresh.getBoundingClientRect().bottom;
    if(root.getAttribute('data-duo-split')==='on'&&root.getAttribute('data-duo-layout')==='folded'){var v=parseFloat(getComputedStyle(root).getPropertyValue('--fold-bottom'));if(v>0)return v+8;}
    return b+8;
  }
  function anchorSave(){
    try{
      var rt=regionTop(), bookNow=root.getAttribute('data-duo-split')==='on'&&root.getAttribute('data-duo-layout')==='book';
      var px=bookNow?Math.min(G.innerWidth-8,(parseFloat(getComputedStyle(root).getPropertyValue('--fold-right'))||0)+24):G.innerWidth/2;
      var el=document.elementFromPoint(px,Math.min(G.innerHeight-2,rt+6));
      if(!el||el===document.body||el===root)return null;
      // Climb to the card-sized block (not the whole page container) so its offset is a stable reference.
      for(var pr=el.parentElement,hh;pr&&pr!==document.body&&(hh=pr.getBoundingClientRect().height)>0&&hh<=G.innerHeight;pr=el.parentElement)el=pr;
      return {el:el,off:el.getBoundingClientRect().top-rt};
    }catch(_){return null;}
  }
  function anchorRestore(a){
    if(!a||!a.el.isConnected)return;
    var want=regionTop()+a.off,now=a.el.getBoundingClientRect().top;
    if(Math.abs(now-want)>1)G.scrollBy(0,Math.round(now-want));
  }
  function setVars(geo){
    ['--fold-top','--fold-bottom','--fold-left','--fold-right'].forEach(function(k){root.style.removeProperty(k);});
    if(!geo)return;
    if(layout==='folded'){root.style.setProperty('--fold-top',geo.top+'px');root.style.setProperty('--fold-bottom',geo.bottom+'px');}
    else{root.style.setProperty('--fold-left',geo.left+'px');root.style.setProperty('--fold-right',geo.right+'px');}
  }
  function sigNow(){
    var s=segmentsNow(),p=postureNow();
    return {s:s,p:p,key:p+'|'+(s.list?s.list.map(function(r){return [r.top,r.bottom,r.left,r.right].map(Math.round).join(',');}).join('/'):'-')+'|'+G.innerWidth+'x'+G.innerHeight+'|'+mode+'|'+route()};
  }
  function apply(force){
    if(applying||!document.body)return;
    applying=true;
    try{
      var sg=sigNow();
      if(!force&&sg.key===lastSig&&root.hasAttribute('data-duo-layout'))return;
      lastSig=sg.key;
      det=detect({segments:sg.s.list,posture:sg.p});
      var prevLayout=layout,prevSplit=split;
      layout=resolve(mode,det.layout);
      split=layout!=='standard'&&landing();
      var a=(prevSplit||split)?anchorSave():null;
      var geo=geometry(layout,G.innerWidth,G.innerHeight,det);
      root.setAttribute('data-duo-mode',mode);root.setAttribute('data-duo-layout',layout);
      root.setAttribute('data-duo-source',layout==='standard'?'none':(geo&&geo.real?'sensor':'forced'));
      setVars(geo);
      unpin();
      if(split){root.setAttribute('data-duo-split','on');pin(geo);watch(true);}
      else{root.removeAttribute('data-duo-split');watch(false);}
      if(a&&(prevSplit!==split||prevLayout!==layout))anchorRestore(a);
      paintControl(sg);
      if(prevLayout!==layout||prevSplit!==split||force==='mode')
        document.dispatchEvent(new CustomEvent('pf:duo-change',{detail:{mode:mode,layout:layout,split:split}}));
    }finally{applying=false;}
  }
  function soon(){if(!raf)raf=G.requestAnimationFrame(function(){raf=0;apply(true);});}
  var later=(function(){var t=0;return function(){clearTimeout(t);t=setTimeout(function(){apply(false);},60);};})();
  // Re-pin when a landing page repaints (its blocks are new nodes). childList only: our own attribute changes never loop.
  function watch(on){
    if(!on){if(mo){mo.disconnect();mo=null;}return;}
    if(mo||!G.MutationObserver)return;
    mo=new MutationObserver(function(){soon();});
    Array.prototype.slice.call(document.querySelectorAll('[id^="page-"],#pj-context,#ex-top,#ex-subnav')).forEach(function(n){mo.observe(n,{childList:true,subtree:true});});
  }
  // ── the control ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
  var LABEL={auto:'Auto',folded:'Folded',book:'Book',standard:'Standard'};
  var HINT={auto:'Follows the fold sensor when the browser reports one; otherwise Standard.',folded:'Top / bottom split on Today, Apex, Agentic, Research and Paper.',book:'Left / right: in Apex and Agentic a command panel on the left, the analysis on the right. Today, Research and Paper split too.',standard:'The normal layout. No split.'};
  var ICON={standard:'<rect x="3" y="2.5" width="10" height="11" rx="1.5"/>',folded:'<rect x="3" y="2.5" width="10" height="11" rx="1.5"/><path d="M3 8h10"/>',book:'<rect x="2.5" y="3" width="11" height="10" rx="1.5"/><path d="M8 3v10"/>'};
  var pop=null,btn=null;
  function ensureControl(){
    var acts=document.querySelector('#pf-fresh .pf-fresh-actions');
    if(!acts||!document.body)return;
    if(!btn||!btn.isConnected){
      btn=document.createElement('button');btn.type='button';btn.id='pf-duo';btn.className='pf-duo-btn';
      btn.setAttribute('aria-haspopup','true');btn.setAttribute('aria-expanded','false');btn.setAttribute('aria-controls','pf-duo-pop');
      btn.addEventListener('click',function(){togglePop();});
      var th=$('theme-toggle');acts.insertBefore(btn,th||null);
    }
    if(!pop){
      pop=document.createElement('div');pop.id='pf-duo-pop';pop.hidden=true;
      pop.innerHTML='<div class="pf-duo-t" id="pf-duo-t">Duo layout</div><div class="pf-duo-seg" role="radiogroup" aria-labelledby="pf-duo-t">'+
        MODES.map(function(m){return '<button type="button" role="radio" data-duo-mode="'+m+'" aria-checked="false">'+LABEL[m]+'</button>';}).join('')+
        '</div><p class="pf-duo-note" id="pf-duo-note"></p>';
      document.body.appendChild(pop);
      pop.addEventListener('click',function(e){var b=e.target.closest('[data-duo-mode]');if(b){api.setMode(b.dataset.duoMode);}});
      pop.addEventListener('keydown',function(e){
        var k=e.key,bs=Array.prototype.slice.call(pop.querySelectorAll('[data-duo-mode]')),i=bs.indexOf(document.activeElement);
        if(k==='Escape'){togglePop(false);btn.focus();e.preventDefault();}
        else if(i>=0&&(k==='ArrowRight'||k==='ArrowDown')){bs[(i+1)%bs.length].focus();e.preventDefault();}
        else if(i>=0&&(k==='ArrowLeft'||k==='ArrowUp')){bs[(i+bs.length-1)%bs.length].focus();e.preventDefault();}
      });
      document.addEventListener('click',function(e){if(pop&&!pop.hidden&&!e.target.closest('#pf-duo-pop,#pf-duo'))togglePop(false);});
    }
  }
  function togglePop(on){
    ensureControl();if(!pop)return;
    var open=on===undefined?pop.hidden:on;pop.hidden=!open;btn.setAttribute('aria-expanded',String(open));
    if(open){var fr=$('pf-fresh');if(fr){pop.style.top=Math.round(fr.getBoundingClientRect().bottom+4)+'px';}
      var cur=pop.querySelector('[aria-checked="true"]');if(cur)cur.focus();}
  }
  function paintControl(sg){
    ensureControl();if(!btn)return;
    var shown=layout;
    btn.innerHTML='<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true">'+ICON[shown]+'</svg><span class="pf-duo-word">'+LABEL[mode]+'</span>';
    var txt='Duo layout: '+LABEL[mode]+(mode==='auto'?' (currently '+LABEL[layout]+')':'')+'. Change layout';
    btn.setAttribute('aria-label',txt);btn.title=txt;btn.setAttribute('data-duo-state',mode);
    if(pop){
      Array.prototype.slice.call(pop.querySelectorAll('[data-duo-mode]')).forEach(function(b){var on=b.dataset.duoMode===mode;b.setAttribute('aria-checked',String(on));b.tabIndex=on?0:-1;});
      var note=pop.querySelector('#pf-duo-note');
      if(note)note.textContent=HINT[mode]+(mode==='auto'?' Sensor: '+(sg&&sg.s.list?(det.layout==='standard'?'two segments, no usable fold':'reports a '+det.layout+' fold'):'none reported')+'.':'');
    }
  }
  // ── public API ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
  Object.defineProperty(api,'mode',{get:function(){return mode;},configurable:true});
  Object.defineProperty(api,'layout',{get:function(){return layout;},configurable:true});
  Object.defineProperty(api,'split',{get:function(){return split;},configurable:true});
  api.setMode=function(m){
    var n=normalizeMode(m);
    mode=n;try{writeMode(G.localStorage,n);}catch(_){}
    apply('mode');return mode;
  };
  api.refresh=function(){apply(true);};
  // Jumps (Find, My view, section routes) clear the pinned pane as well as the freshness strip.
  function patchOffset(){
    var o=G.__pfTopOffset;if(typeof o!=='function'||o.__duo)return;
    var f=function(){var y=o.apply(this,arguments);if(root.getAttribute('data-duo-split')==='on'&&root.getAttribute('data-duo-layout')==='folded'){var b=parseFloat(getComputedStyle(root).getPropertyValue('--fold-bottom'))||0;if(b+8>y)return b+8;}return y;};
    f.__duo=true;G.__pfTopOffset=f;
  }
  // The fold often fires no resize: listen to its own signals, plus a slow visible-only backstop (only when a fold API exists).
  function start(){
    patchOffset();ensureControl();apply(true);
    G.addEventListener('resize',later);G.addEventListener('pageshow',later);
    G.addEventListener('orientationchange',function(){later();setTimeout(later,250);});
    document.addEventListener('visibilitychange',function(){if(!document.hidden)later();});
    if(G.visualViewport)G.visualViewport.addEventListener('resize',later);
    [MQ.v2,MQ.h2,MQ.folded,MQ.cont].forEach(function(m){if(!m)return;if(m.addEventListener)m.addEventListener('change',later);else if(m.addListener)m.addListener(later);});
    var dp=G.navigator&&G.navigator.devicePosture;if(dp&&dp.addEventListener)dp.addEventListener('change',later);
    if(G.viewport&&G.viewport.addEventListener){try{G.viewport.addEventListener('segmentschange',later);}catch(_){}}
    document.addEventListener('pf:route',function(){apply(true);});
    document.addEventListener('pf:render',soon);
    if(G.MutationObserver)new MutationObserver(function(){if(split)soon();}).observe(root,{attributes:true,attributeFilter:['data-theme','class']});
    var apis=!!(G.viewport||(G.navigator&&G.navigator.devicePosture)||(MQ.v2&&MQ.v2.media!=='not all'));
    if(apis)setInterval(function(){if(document.visibilityState==='visible')apply(false);},1000);
    // The freshness strip is built by the app's boot; the control joins it as soon as it exists.
    if(!$('pf-duo')&&G.MutationObserver){var w=new MutationObserver(function(){ensureControl();if($('pf-duo'))w.disconnect();});w.observe(document.body,{childList:true});}
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();
})();
