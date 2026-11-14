/* v220 — asymmetric safe-area fallback. v232 correction: Safari's Duo controls
   column is outside the web viewport, not reclaimable CSS padding. This applies
   only where an environment actually exposes a large asymmetric inset. It sets
   html.pf-side-status + --duo-r so ui/duo.css can keep just the top rows clear and let the cards run full width.
   Symmetric insets are left alone. Layout only; reads no data or screen identity. */
(function(){
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
