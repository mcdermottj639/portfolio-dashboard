/* v180 — Compact reading layer for the Portfolio area (both accounts) and Options.
   Jack: "word blocks → visuals and collapsed info". The cards keep rendering exactly what they did;
   this layer only re-shapes what they render, so nothing here computes or hides a number:
     1. Long QUIET notes (fund-note / cov-note / gray-or-faded inline paragraphs, ≥170 chars, inline
        content only) fold into <details class="sd-more">. A note that opens with a bold lead keeps
        that lead as its summary ("💰 Money you added"); everything else reads "ⓘ How to read this".
     2. Tables with ≥5 header columns get class pf-stack + per-cell data-l labels; on phones
        (ui/experience.css, ≤520px) each row becomes one line: name + 3 key columns; the remaining
        columns open when the row is tapped. Header cells stay real <th>s, so click-to-sort still works.
   It runs synchronously in a MutationObserver (microtask, before paint), marks what it touched with
   data-pfc, and is idempotent, so re-renders and the privacy masker converge. */
(function(){
  'use strict';
  var ROOTS=['page-portfolio','page-options'];
  var BLOCK=/^(DIV|P|TABLE|UL|OL|DETAILS|SECTION|ARTICLE|CANVAS|SVG|FORM|H[1-6]|BUTTON|INPUT|SELECT)$/;
  var QUIET_CLS=/(^|\s)(fund-note|cov-note)(\s|$)/;
  var QUIET_STY=/opacity:\s*\.(7|75|8)\b|color:\s*#9ca3af/;
  var MIN_LEN=170;

  function isNote(el){
    if(el.nodeType!==1||el.getAttribute('data-pfc'))return false;
    if(el.tagName!=='DIV'&&el.tagName!=='P')return false;
    if(!QUIET_CLS.test(el.className||'')&&!QUIET_STY.test(el.getAttribute('style')||''))return false;
    if(el.closest('details,summary,td,th,button,.picks-hero,.snap,.pk-m,.box-warn,.no-compact'))return false;
    for(var i=0;i<el.children.length;i++){ if(BLOCK.test(el.children[i].tagName))return false; }
    return (el.textContent||'').trim().length>=MIN_LEN;
  }
  function leadOf(el){
    var f=el.firstElementChild;
    if(!f||f.tagName!=='B')return null;
    var before=''; for(var n=el.firstChild;n&&n!==f;n=n.nextSibling)before+=n.textContent||'';
    if(before.trim())return null;
    var t=(f.textContent||'').trim().replace(/[:—–-]\s*$/,'');
    return t&&t.length<=48?t:null;
  }
  function fold(el){
    el.setAttribute('data-pfc','1');
    var d=document.createElement('details'); d.className='sd-more pf-fold'; d.setAttribute('data-pfc','1');
    var s=document.createElement('summary'); var lead=leadOf(el);
    s.textContent=lead||'ⓘ How to read this';
    if(lead)el.firstElementChild.remove();
    el.parentNode.insertBefore(d,el); d.appendChild(s); d.appendChild(el);
  }
  /* Which columns stay on the one-line row; the rest open on tap. First match wins, up to 3. */
  var KEY=['value','p&l %','day %','signal','flow','result','buy return','fwd p/e','rev growth','unrealized p&l','realized ytd','% port','rsi (14d)','p/e','premium','dte','strike','p&l','pnl','price'];
  function norm(l){ return (l||'').toLowerCase().replace(/\s+/g,' ').trim(); }
  function stack(t){
    if(t.closest('.no-stack'))return;
    var ths=t.querySelectorAll('thead th'); if(ths.length<5)return;
    if(!t.classList.contains('pf-stack'))t.classList.add('pf-stack');
    var labels=[]; ths.forEach(function(th){ var span=+th.getAttribute('colspan')||1; var l=(th.textContent||'').replace(/[▲▼↕⇅↑↓]/g,'').trim();
      for(var k=0;k<span;k++)labels.push(k?'':l); });
    var keys=[]; KEY.forEach(function(k){ if(keys.length>=3)return; for(var i=1;i<labels.length;i++){ if(norm(labels[i])===k&&keys.indexOf(i)<0){keys.push(i);break;} } });
    for(var i=1;i<labels.length&&keys.length<3;i++){ if(keys.indexOf(i)<0)keys.push(i); }
    t.querySelectorAll('tbody tr').forEach(function(tr){
      if(tr.getAttribute('data-pfc'))return; tr.setAttribute('data-pfc','1');
      var idx=0, rest=0; Array.prototype.forEach.call(tr.children,function(td){
        var span=+td.getAttribute('colspan')||1;
        if(span>1)td.classList.add('pf-span');
        else if(idx>0){ if(labels[idx]&&!td.hasAttribute('data-l'))td.setAttribute('data-l',labels[idx]);
          if(keys.indexOf(idx)>=0)td.classList.add('pf-key'); else { td.classList.add('pf-rest'); rest++; } }
        idx+=span; });
      if(rest)tr.classList.add('pf-more');
    });
    if(!t.getAttribute('data-pfc')){ t.setAttribute('data-pfc','1');
      t.addEventListener('click',function(e){ if(!window.matchMedia||!matchMedia('(max-width:520px)').matches)return;
        var tr=e.target.closest('tbody tr.pf-more'); if(!tr||e.target.closest('a,button,input,select,.sym[onclick],[onclick]'))return;
        tr.classList.toggle('pf-open'); }); }
  }
  function pass(root){
    if(!root)return;
    var notes=root.querySelectorAll('.card div, .card p');
    for(var i=0;i<notes.length;i++){ try{ if(isNote(notes[i]))fold(notes[i]); }catch(e){} }
    root.querySelectorAll('.card table').forEach(function(t){ try{ stack(t); }catch(e){} });
  }
  var busy=false;
  function run(root){ if(busy)return; busy=true; try{ pass(root); }finally{ busy=false; } }
  function start(){
    ROOTS.forEach(function(id){
      var root=document.getElementById(id); if(!root)return;
      run(root);
      new MutationObserver(function(){ run(root); }).observe(root,{childList:true,subtree:true});
    });
  }
  window.PFCompact={pass:pass,isNote:isNote};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start); else start();
})();
