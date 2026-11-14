/* v220 — side status area (iPhone Duo). Jack, Nov 12 2026, on a strip of empty page beside the clock/Wi-Fi
   icons: "Reclaim what u can". The Duo reports those icons as a large RIGHT safe-area inset with no matching left
   one; the page padded its whole height by it. This measures the insets and, only for that lopsided shape, sets
   html.pf-side-status + --duo-r so ui/duo.css can keep just the top rows clear and let the cards run full width.
   A normal iPhone in landscape reports both sides (the notch) and is left alone. Layout only; reads no data. */
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
