/* v220 — side status area (iPhone Duo). Jack, Nov 12 2026, on a strip of empty page beside the clock/Wi-Fi
   icons: "Reclaim what u can". The Duo reports those icons as a large RIGHT safe-area inset with no matching left
   one; the page padded its whole height by it. This measures the insets and, only for that lopsided shape, sets
   html.pf-side-status + --duo-r so ui/duo.css can keep just the top rows clear and let the cards run full width.
   A normal iPhone in landscape reports both sides (the notch) and is left alone. Layout only; reads no data. */
(function(){
  function measure(){
    try{
      var p=document.createElement('div');
      p.style.cssText='position:fixed;top:0;left:0;width:0;height:0;visibility:hidden;pointer-events:none;'+
        'padding-right:env(safe-area-inset-right);padding-left:env(safe-area-inset-left)';
      (document.body||document.documentElement).appendChild(p);
      var cs=getComputedStyle(p), r=parseFloat(cs.paddingRight)||0, l=parseFloat(cs.paddingLeft)||0;
      p.remove();
      var on=r>=60&&l<20, root=document.documentElement;
      root.classList.toggle('pf-side-status',on);
      if(on) root.style.setProperty('--duo-r',r+'px'); else root.style.removeProperty('--duo-r');
    }catch(_){}
  }
  if(document.body) measure(); else document.addEventListener('DOMContentLoaded',measure);
  addEventListener('resize',measure); addEventListener('orientationchange',function(){setTimeout(measure,250)});
  window.__pfDuoMeasure=measure;
})();
