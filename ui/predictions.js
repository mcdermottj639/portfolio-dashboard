/* Read-only Predict view. Public research is separate from encrypted personal account records. */
(function(){
  'use strict';
  const M=window.PFPredictionsModel;if(!M)return;
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const read=(k,f)=>{try{return JSON.parse(localStorage.getItem(k))??f;}catch{return f;}};
  const put=(k,v)=>{try{localStorage.setItem(k,JSON.stringify(v));return true;}catch{return false;}};
  const money=v=>M.number(v)===null?'—':new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(v);
  const cents=v=>M.price(v)===null?'—':(v*100).toFixed(1).replace(/\.0$/,'')+'¢';
  const date=v=>M.stamp(v)?new Date(v).toLocaleString('en-US',{month:'short',day:'numeric',year:new Date(v).getFullYear()!==new Date().getFullYear()?'numeric':undefined,hour:'numeric',minute:'2-digit',timeZoneName:'short'}):'Time unavailable';
  const age=v=>{const n=(Date.now()-Date.parse(v||''))/60000;return !Number.isFinite(n)?'Not collected':n<1?'Just collected':n<60?Math.floor(n)+'m ago':n<1440?Math.floor(n/60)+'h ago':Math.floor(n/1440)+'d ago';};
  const compact=n=>M.number(n)===null?'—':new Intl.NumberFormat('en-US',{notation:'compact',maximumFractionDigits:1}).format(n);
  const tone=n=>n>0?'pred-up':n<0?'pred-down':'';
  const labels={positions:'Positions',ideas:'Ideas',watchlist:'Watchlist',results:'Results'};
  let root,snapshot=null,busy=false,lastFetch=0,error='',notice='',tab=read('pf_predict_tab','ideas'),category='All',query='',sort='activity',rhOnly=false;
  if(!labels[tab])tab='ideas';
  function readWatches(){try{return M.cleanWatchlist(read('pf_prediction_watchlist_v1',[]));}catch{return [];}}
  let watches=readWatches();
  const drafts=new Map(),sideDrafts=new Map();
  const account=()=>{const a=window.__DATA?.predictions;return a?.schemaVersion===1&&a.source==='robinhood'&&a.coverage&&Array.isArray(a.positions)&&Array.isArray(a.transactions)?a:null;};
  const find=id=>snapshot?.markets?.find(m=>m.id===id)||watches.find(w=>w.id===id)?.market||null;
  const watched=id=>watches.some(w=>w.id===id);
  const button=(action,text,id='',cls='')=>'<button type="button" class="pred-button '+cls+'" data-pred-action="'+action+'"'+(id?' data-id="'+esc(id)+'"':'')+'>'+text+'</button>';
  const empty=(title,text,extra='')=>'<div class="pred-empty"><span class="pred-empty-icon" aria-hidden="true">◈</span><h2>'+esc(title)+'</h2><p>'+esc(text)+'</p>'+extra+'</div>';
  const badge=(text,cls='')=>'<span class="pred-badge '+cls+'">'+esc(text)+'</span>';
  function persist(){if(!put('pf_prediction_watchlist_v1',watches))notice='Device storage is unavailable. Export your watchlist to keep it.';}
  function openLink(url,label){const u=M.safeUrl(url);return u?'<a class="pred-link" href="'+esc(u)+'" target="_blank" rel="noopener noreferrer">'+esc(label)+' ↗</a>':'';}
  function stat(label,value,detail,cls=''){return '<div class="pred-stat"><span>'+esc(label)+'</span><strong class="'+cls+'">'+value+'</strong><small>'+esc(detail)+'</small></div>';}
  function spark(m){
    const bars=m.history||[],valid=bars.filter(p=>M.price(p.price)!==null&&M.stamp(p.t));if(valid.length<2)return '<div class="pred-no-chart">Price history is not available for this contract.</div>';
    const values=valid.map(p=>p.price),min=Math.min(...values),max=Math.max(...values),range=max-min||.01;
    const start=Date.parse(bars[0].t),end=Date.parse(bars[bars.length-1].t);if(end<=start)return '';
    let d='',continuing=false;
    for(const p of bars){if(M.price(p.price)===null||!M.stamp(p.t)){continuing=false;continue;}d+=(continuing?' L':' M')+(10+(Date.parse(p.t)-start)/(end-start)*570).toFixed(1)+' '+(12+(max-p.price)/range*76).toFixed(1);continuing=true;}
    return '<figure class="pred-chart"><figcaption>Yes trade prices · recorded 24h window <span>'+cents(min)+'–'+cents(max)+'</span></figcaption><svg viewBox="0 0 590 100" role="img" aria-label="Recorded Yes trade prices; missing intervals are gaps"><path d="'+d+'" fill="none" stroke="currentColor" stroke-width="2.5"/></svg><div><time>'+esc(date(bars[0].t))+'</time><time>'+esc(date(bars[bars.length-1].t))+'</time></div><p class="pred-muted">History captured '+esc(date(m.historyAsOf))+'</p></figure>';
  }
  function card(m,watch=false){
    const w=watches.find(w=>w.id===m.id),i=snapshot?.ideas?.find(i=>i.marketId===m.id),fresh=M.isFresh(m.asOf),closed=!['active','open'].includes(m.status)||Date.parse(m.closesAt)<=Date.now();
    const change=m.last!==null&&m.previous!==null?Math.round((m.last-m.previous)*100):null;
    const target=drafts.has(m.id)?drafts.get(m.id):w?.target===null||w?.target===undefined?'':String(Math.round(w.target*10000)/100);
    const side=sideDrafts.get(m.id)||w?.side||'yes';
    const status=w?M.targetStatus(m,w.target,w.side):null;
    const statusText={stale:'Quote stale',closed:'Market closed',no_quote:'No usable quote',unset:'Set a price target',reached:'Target price reached',watching:'Watching your price'}[status];
    return '<article class="pred-market" data-market="'+esc(m.id)+'"><div class="pred-card-head"><div class="pred-kicker">'+esc(m.group)+' <span>·</span> Resolves ~ '+esc(date(m.expectedAt||m.closesAt))+'</div><button type="button" class="pred-star" data-pred-action="watch" data-id="'+esc(m.id)+'" aria-label="'+(w?'Remove from watchlist':'Add to watchlist')+'" aria-pressed="'+!!w+'">'+(w?'★':'☆')+'</button></div><h3>'+esc(m.title)+'</h3><div class="pred-price-row"><div><span>Yes ask</span><strong>'+(closed?'Closed':cents(m.yesAsk))+'</strong></div><div><span>No ask</span><strong>'+(closed?'Closed':cents(m.noAsk))+'</strong></div><div class="pred-price-move '+tone(change)+'"><span>Reference move</span><b>'+(change===null?'—':(change>0?'+':'')+change+'¢')+'</b></div></div><p class="pred-reason">'+esc(M.whyWatch(m))+'</p><div class="pred-card-foot">'+badge(closed?'Closed':fresh?'Kalshi · '+age(m.asOf):'Stale · '+age(m.asOf),!fresh?'pred-warning':'')+(m.robinhood?openLink(m.robinhood.url,'Robinhood'):badge('No verified Robinhood link'))+'</div>'+
      (watch?'<form class="pred-target" data-target="'+esc(m.id)+'"><label>Watch side<select name="side" id="pred-side-'+esc(m.id)+'" data-side-input="'+esc(m.id)+'" aria-label="Watch side"><option value="yes"'+(side==='yes'?' selected':'')+'>Yes</option><option value="no"'+(side==='no'?' selected':'')+'>No</option></select></label><label>Target ask (¢)<input type="number" name="target" id="pred-target-'+esc(m.id)+'" data-target-input="'+esc(m.id)+'" min="0.1" max="99.9" step="0.1" placeholder="e.g. 45" value="'+esc(target)+'" inputmode="decimal"></label><button class="pred-button" type="submit">Save target</button><span class="pred-target-state '+(status==='reached'?'pred-up':'')+'">'+esc(statusText)+'</span></form>':'')+
      '<details class="pred-details" data-detail="'+esc(m.id)+'"><summary>Research &amp; price history</summary>'+spark(m)+'<dl><div><dt>Yes bid / ask</dt><dd>'+cents(m.yesBid)+' / '+cents(m.yesAsk)+'</dd></div><div><dt>Volume in 24 hours</dt><dd>'+compact(m.volume24h)+' contracts</dd></div><div><dt>Market closes</dt><dd>'+esc(date(m.closesAt))+'</dd></div><div><dt>Quote snapshot</dt><dd>'+esc(date(m.asOf))+'</dd></div></dl><h4>What to check next</h4><p>'+esc(m.category==='Sports'?'Check lineups, injuries and the event rules before comparing the current price with a supported forecast.':'Check the next official release, the exact threshold and the settlement source before making a probability estimate.')+'</p><p class="pred-muted">Activity and a narrow spread make this a research candidate. They do not establish that Yes or No is underpriced. Entry targets are yours; fees are not included in these quotes.</p><h4>Settlement rules</h4><p>'+esc(m.rules||'Rules not available in the current snapshot.')+'</p>'+(m.secondaryRules?'<p>'+esc(m.secondaryRules)+'</p>':'')+(i?'<p class="pred-muted">First recorded '+esc(date(i.publishedAt))+' · Yes ask '+cents(i.entryAsk)+' · '+esc(i.modelVersion)+'. This reference is preserved for outcome tracking.</p>':'')+'<div class="pred-source-links">'+openLink(m.sourceUrl,'Kalshi series')+(m.robinhood?openLink(m.robinhood.url,'Open this event on Robinhood'):'')+'</div><p class="pred-muted pred-id">Contract '+esc(m.id)+(m.robinhood?' · Robinhood link matched '+esc(date(m.robinhood.matchedAt)):'')+'</p></details></article>';
  }
  function filters(){return '<div class="pred-filters"><div class="pred-pills" aria-label="Market category">'+['All',...new Set((snapshot?.markets||[]).map(m=>m.category).filter(Boolean))].map(c=>'<button type="button" data-pred-category="'+esc(c)+'" aria-pressed="'+(category===c)+'">'+esc(c)+'</button>').join('')+'</div><div class="pred-search"><label><span class="pred-sr">Search markets</span><input type="search" id="pred-search" placeholder="Search teams or markets" value="'+esc(query)+'"></label><select id="pred-sort" aria-label="Sort markets"><option value="activity"'+(sort==='activity'?' selected':'')+'>Most active</option><option value="soon"'+(sort==='soon'?' selected':'')+'>Closing soon</option><option value="move"'+(sort==='move'?' selected':'')+'>Biggest move</option></select></div></div><label class="pred-rh-filter"><input type="checkbox" id="pred-rh-only"'+(rhOnly?' checked':'')+'> With a matched Robinhood link</label>';}
  function filtered(rows){return rows.filter(m=>(category==='All'||m.category===category)&&(!rhOnly||m.robinhood)&&(!query||[m.title,m.group,m.rules,m.eventId].join(' ').toLowerCase().includes(query.toLowerCase()))).sort((a,b)=>sort==='soon'?Date.parse(a.closesAt)-Date.parse(b.closesAt):sort==='move'?Math.abs((b.last??0)-(b.previous??b.last??0))-Math.abs((a.last??0)-(a.previous??a.last??0)):(b.volume24h||0)-(a.volume24h||0));}
  function ideas(){
    if(!snapshot)return empty(busy?'Collecting the market view…':'Market data is unavailable',error||'The page will show the latest published market snapshot here.',button('refresh','Try again'));
    const featured=(snapshot.featured||[]).map(find).filter(Boolean),rows=filtered(featured);
    let html='<div class="pred-section-head"><div><h2>Worth a closer look</h2><p>Active markets with tighter spreads. Open a card to inspect the evidence.</p></div>'+badge('Research candidates')+'</div>'+filters();
    html+=rows.length?'<div class="pred-grid">'+rows.map(m=>card(m)).join('')+'</div>':empty('No matching ideas','Try another category or clear your search. Candidates require usable quotes and recent activity.');
    const rest=filtered(snapshot.markets.filter(m=>['active','open'].includes(m.status)&&!featured.some(f=>f.id===m.id)));
    html+='<details class="pred-browse" data-detail="browse"><summary>Browse more markets <span>'+rest.length+'</span></summary><p class="pred-muted">The broader feed includes markets that do not meet the Ideas liquidity checks.</p><div class="pred-grid">'+rest.slice(0,40).map(m=>card(m)).join('')+'</div>'+(rest.length>40?'<p class="pred-muted">Showing the first 40 matches. Search for a team or topic to narrow the list.</p>':'')+'</details>';
    return html;
  }
  function watchlist(){
    const rows=filtered(watches.map(w=>find(w.id)).filter(Boolean));
    return '<div class="pred-section-head"><div><h2>Your watchlist</h2><p>Saved on this device. Targets are checked when a fresh snapshot arrives.</p></div><div class="pred-tools">'+button('export','Export')+button('import','Import')+'<input id="pred-import" type="file" accept="application/json,.json" hidden></div></div>'+filters()+(rows.length?'<div class="pred-grid">'+rows.map(m=>card(m,true)).join('')+'</div>':empty(watches.length?'No matching saved markets':'Build your radar','Tap a star on any market to save it. Export and import to move your watchlist between devices.',button('ideas','Explore ideas')));
  }
  function positions(){
    const a=account();
    if(!a)return empty('Your Predict account is not connected yet','Public markets and your watchlist are ready. Named positions, account cash and profit need the authenticated Robinhood Predict feed.',openLink('https://robinhood.com/us/en/prediction-markets/','Open Robinhood')+button('ideas','Explore market ideas'))+legacy();
    let html='<div class="pred-section-head"><h2>Your Predict account</h2>'+badge((M.isFresh(a.asOf,Date.now(),90)?'Captured ':'Stale · ')+date(a.asOf))+'</div>';
    html+='<div class="pred-stats" data-priv="on">'+stat('Account value',money(a.balance?.value),'Broker snapshot')+stat('Available cash',money(a.balance?.availableCash),'Predict account')+stat('Open positions',a.coverage.positions?String(a.positions.filter(p=>p.quantity>0).length):'—','Verified coverage required')+stat('Realized net P&L',money(a.realizedNet),a.historyStart?'Since '+date(a.historyStart):'History coverage not established',tone(a.realizedNet))+'</div>';
    if(!a.coverage.positions)return html+empty('Position coverage is incomplete','The last account payload did not establish a complete list of open event contracts.');
    if(!a.positions.some(p=>p.quantity>0))return html+empty('No open positions','The connected snapshot reports no open event-contract positions.');
    return html+'<div class="pred-positions" data-priv="on">'+a.positions.filter(p=>p.quantity>0).map(p=>'<article class="pred-position"><div><h3>'+esc(p.name)+'</h3><p>'+esc(p.side.toUpperCase())+' · <span data-priv="val">'+p.quantity+'</span> contracts · average '+cents(p.averagePrice)+'</p></div><div><span>Market value</span><strong>'+money(p.marketValue)+'</strong></div><div><span>Recorded cost basis</span><strong>'+money(p.costBasis)+'</strong></div></article>').join('')+'</div>';
  }
  function legacy(){const pm=window.__DATA?.realized?.predictionMarket;if(!pm?.count)return '';return '<details class="pred-browse" data-detail="legacy"><summary>Existing derivatives history</summary><div data-priv="on"><p>'+money(pm.ytd)+' recorded across <span data-priv="val">'+pm.count+'</span> settlement rows.</p><p class="pred-muted">This legacy feed identifies activity from blank symbols. Contract names, fees and event-only classification are not verified, so it is excluded from Predict account results.</p></div></details>';}
  function results(){
    const all=snapshot?.ideas||[],done=all.filter(i=>i.settledAt&&M.price(i.settlementValue)!==null),positive=done.filter(i=>i.grossChange>0).length;
    let html='<div class="pred-section-head"><div><h2>The recorded research</h2><p>Every published candidate keeps its original date, price and reason.</p></div>'+badge('Hypothetical · before fees')+'</div><div class="pred-stats">'+stat('Published candidates',String(all.length),'Original observations kept')+stat('Resolved',String(done.length),'Exchange-confirmed outcomes')+stat('Positive references',done.length?positive+' / '+done.length:'—','One Yes contract, before fees')+stat('Reference change',done.length?money(done.reduce((s,i)=>s+i.grossChange,0)):'—','Sum for one contract per candidate')+'</div><p class="pred-method">This tracks a hypothetical Yes contract at each recorded asking price. It is not a recommendation, an actual trade, or your profit. Execution and fees are not verified.</p>';
    html+=all.length?'<div class="pred-result-list">'+[...all].reverse().map(i=>'<details class="pred-result" data-detail="result-'+esc(i.id)+'"><summary><span><strong>'+esc(i.title)+'</strong><small>'+esc(date(i.publishedAt))+' · Yes at '+cents(i.entryAsk)+'</small></span><span class="'+tone(i.grossChange)+'">'+(i.settledAt?money(i.grossChange):'Pending')+'</span></summary><p>'+esc(i.rationale)+'</p><p>'+esc(i.modelVersion)+' · '+(i.settledAt?'Settled '+date(i.settledAt)+' · payout '+cents(i.settlementValue):'Waiting for an explicit exchange settlement. A missing or closed market is not a result.')+'</p>'+openLink(i.sourceUrl,'Source market series')+'</details>').join('')+'</div>':empty('The record starts here','The next successful collector run will save qualifying research candidates. Past picks are not reconstructed.');
    const a=account();if(a?.coverage.transactions)html+='<details class="pred-browse" data-detail="actual"><summary>Your actual account results</summary><div data-priv="on"><p>Net realized '+money(a.realizedNet)+(a.historyStart?' since '+esc(date(a.historyStart)):'')+'</p>'+a.transactions.filter(t=>t.type!=='buy').map(t=>'<p>'+esc(t.name)+' · '+esc(date(t.at))+' · '+money(t.realizedNet)+'</p>').join('')+'</div></details>';
    return html;
  }
  function render(){
    if(!root)return;
    const opened=[...root.querySelectorAll('details[open]')].map(d=>d.dataset.detail),focus=document.activeElement;
    const focusId=focus?.id,selection=focus?.selectionStart;
    const fresh=M.isFresh(snapshot?.generatedAt),failed=snapshot?.coverage?.filter(c=>c.status!=='ok').length||0;
    const active=snapshot?.markets?.filter(m=>['active','open'].includes(m.status)).length;
    root.innerHTML='<div class="pred-head"><div><div class="pred-eyebrow">YOUR PREDICTION DESK</div><h1>Predictions</h1><p>Your positions. Your next idea.</p></div><div class="pred-head-tools">'+badge(snapshot?(fresh?'Market snapshot · ':'Stale snapshot · ')+age(snapshot.generatedAt):(busy?'Market feed loading':'Market feed unavailable'),!fresh?'pred-warning':'')+button('refresh',busy?'Refreshing…':'Refresh')+openLink('https://robinhood.com/us/en/prediction-markets/','Robinhood')+'</div></div>'+
      '<div class="pred-tabs" role="tablist" aria-label="Prediction sections">'+Object.entries(labels).map(([k,v])=>'<button type="button" role="tab" id="pred-tab-'+k+'" aria-controls="pred-content" aria-selected="'+(tab===k)+'" tabindex="'+(tab===k?'0':'-1')+'" data-pred-tab="'+k+'">'+v+(k==='watchlist'&&watches.length?' <span>'+watches.length+'</span>':'')+'</button>').join('')+'</div>'+
      (notice?'<p class="pred-notice" role="status">'+esc(notice)+'</p>':'')+
      (error||failed||snapshot&&!fresh?'<div class="pred-feed-note">'+esc(error||(!fresh?'This snapshot is older than 45 minutes. Targets are paused until fresh prices arrive.':failed+' source checks failed. Each market retains its own collection time.'))+'</div>':'')+
      '<div id="pred-content" role="tabpanel" aria-labelledby="pred-tab-'+tab+'">'+(tab==='ideas'?ideas():tab==='watchlist'?watchlist():tab==='positions'?positions():results())+'</div>'+
      '<footer class="pred-footer"><span>'+esc(active===undefined?'Market snapshot not loaded':active+' active contracts in the published feed')+'</span><span>Kalshi quotes · refresh target 15 min · fees excluded</span><details data-detail="method"><summary>Sources &amp; coverage</summary><p>'+esc(snapshot?.method?.description||'Market data is collected independently of your account snapshot.')+'</p><p>Robinhood links are matched by exact exchange symbol from public pages. A matching link does not verify your eligibility or the price in your account. Unmatched contracts remain available for research.</p><p>The scheduled collector runs evenings and weekends. Refresh reloads the latest published file; it does not force the background job to run. Failed sources retain their original timestamp.</p><p>'+esc((snapshot?.coverage||[]).map(c=>c.label||c.series).join(' · '))+'</p></details></footer>';
    root.querySelectorAll('details').forEach(d=>{d.open=opened.includes(d.dataset.detail);});
    if(focusId&&root.querySelector('#'+CSS.escape(focusId))){const el=root.querySelector('#'+CSS.escape(focusId));el.focus({preventScroll:true});try{el.setSelectionRange(selection,selection);}catch{}}
    window.__privScan?.();
  }
  async function refresh(){
    if(busy)return;busy=true;error='';if(!snapshot)render();
    try{
      // Bot commits do not trigger a GitHub Pages rebuild. Read the public main-branch file
      // directly in production; local previews stay on their own branch's fixture/snapshot.
      const local=['localhost','127.0.0.1','[::1]'].includes(location.hostname);
      const urls=local?['data/predictions.json']:['https://raw.githubusercontent.com/mcdermottj639/portfolio-dashboard/main/data/predictions.json','data/predictions.json'];
      let d;
      for(const [index,url] of urls.entries()){
        try{
          const r=await fetch(url,{cache:'no-cache',signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('Market snapshot unavailable.');
          const candidate=await r.json();if(candidate.schemaVersion!==1||!Array.isArray(candidate.markets)||!Array.isArray(candidate.ideas)||!M.stamp(candidate.generatedAt))throw Error('The market snapshot could not be read.');
          d=candidate;if(index)error='Public feed unavailable. Showing the site snapshot with its original timestamp.';break;
        }catch(e){if(index===urls.length-1)throw e;}
      }
      snapshot=d;lastFetch=Date.now();
      for(const w of watches){const m=d.markets.find(m=>m.id===w.id);if(m)w.market=m;}
      if(watches.length)persist();
    }catch(e){error=snapshot?'Could not refresh. Showing the previous snapshot with its original timestamp.':'Market data is temporarily unavailable. Try Refresh again.';}
    finally{busy=false;render();}
  }
  function setTab(next){if(!labels[next])return;tab=next;put('pf_predict_tab',tab);notice='';render();}
  function mount(el){if(!el)return;if(root!==el){root=el;root.classList.add('pred-page');root.dataset.priv='off';bind();}render();if(Date.now()-lastFetch>60000)refresh();}
  function bind(){
    root.addEventListener('click',e=>{
      const t=e.target.closest('[data-pred-tab]');if(t){setTab(t.dataset.predTab);return;}
      const c=e.target.closest('[data-pred-category]');if(c){category=c.dataset.predCategory;render();return;}
      const b=e.target.closest('[data-pred-action]');if(!b)return;
      const id=b.dataset.id,action=b.dataset.predAction;
      if(action==='refresh'){refresh();return;}if(action==='ideas'){setTab('ideas');return;}
      if(action==='watch'){
        if(watched(id))watches=watches.filter(w=>w.id!==id);
        else {const m=find(id);if(!m)return;watches.push({id,side:'yes',target:null,addedAt:new Date().toISOString(),market:m});}
        persist();render();return;
      }
      if(action==='export'){
        const blob=new Blob([JSON.stringify({schemaVersion:1,watchlist:watches},null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='prediction-watchlist.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
      }
      if(action==='import')root.querySelector('#pred-import')?.click();
    });
    root.addEventListener('keydown',e=>{const t=e.target.closest('[data-pred-tab]');if(!t||!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();const keys=Object.keys(labels),i=keys.indexOf(tab),n=e.key==='Home'?0:e.key==='End'?3:(i+(e.key==='ArrowRight'?1:3))%4;setTab(keys[n]);root.querySelector('#pred-tab-'+keys[n]).focus();});
    root.addEventListener('input',e=>{
      if(e.target.id==='pred-search'){query=e.target.value;render();}
      if(e.target.dataset.targetInput)drafts.set(e.target.dataset.targetInput,e.target.value);
    });
    root.addEventListener('change',async e=>{
      if(e.target.dataset.sideInput)sideDrafts.set(e.target.dataset.sideInput,e.target.value);
      if(e.target.id==='pred-sort'){sort=e.target.value;render();}
      if(e.target.id==='pred-rh-only'){rhOnly=e.target.checked;render();}
      if(e.target.id==='pred-import'){
        try{
          const f=e.target.files[0];if(!f)return;if(f.size>2000000)throw Error();
          const d=JSON.parse(await f.text());if(d.schemaVersion!==1||!Array.isArray(d.watchlist)||d.watchlist.length>500)throw Error();
          const imported=M.cleanWatchlist(d.watchlist,true);
          const merged=new Map(watches.map(w=>[w.id,w]));imported.forEach(w=>merged.set(w.id,w));if(merged.size>500)throw Error();watches=[...merged.values()];persist();notice='Watchlist imported on this device.';
        }catch{notice='That file is not a valid prediction watchlist. Your saved markets were kept.';}render();
      }
    });
    root.addEventListener('submit',e=>{
      const f=e.target.closest('[data-target]');if(!f)return;e.preventDefault();const w=watches.find(w=>w.id===f.dataset.target);if(!w)return;
      const raw=f.elements.target.value,n=raw===''?null:Number(raw)/100;if(n!==null&&(!Number.isFinite(n)||n<=0||n>=1)){notice='Enter a target between 0.1¢ and 99.9¢.';render();return;}
      w.target=n;w.side=f.elements.side.value;drafts.delete(w.id);sideDrafts.delete(w.id);persist();notice='Target saved. Checks use fresh published quotes; no order is placed.';render();
    });
  }
  window.PFPredictions={mount,refresh};
  if(document.getElementById('page-predictions')?.offsetParent)mount(document.getElementById('predictions-app'));
  document.addEventListener('visibilitychange',()=>{if(!document.hidden&&root?.offsetParent)refresh();});
  setInterval(()=>{if(!document.hidden&&root?.offsetParent)refresh();},60000);
  window.addEventListener('storage',e=>{if(e.key==='pf_prediction_watchlist_v1'){watches=readWatches();render();}});
})();
