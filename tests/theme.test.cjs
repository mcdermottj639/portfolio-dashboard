const {test}=require('node:test');
const assert=require('node:assert/strict');
const createTheme=require('../ui/theme.js');

function environment({saved, dark=false, blocked=false, legacyMedia=false, noMedia=false}={}) {
  const attrs=new Map(), values=new Map(), windowEvents=new Map(), documentEvents=new Map(), mediaEvents=new Set();
  if(saved!==undefined)values.set('pf_theme',saved);
  const writes=[], events=[], calls=[];
  const storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>{values.set(key,value);writes.push([key,value]);}};
  const media={matches:dark};
  if(legacyMedia){media.addListener=fn=>mediaEvents.add(fn);media.removeListener=fn=>mediaEvents.delete(fn);}
  else {media.addEventListener=(event,fn)=>mediaEvents.add(fn);media.removeEventListener=(event,fn)=>mediaEvents.delete(fn);}
  const meta={setAttribute:(key,value)=>attrs.set('meta:'+key,value)};
  const document={
    documentElement:{style:{},setAttribute:(key,value)=>attrs.set(key,value)},
    querySelector:()=>meta,
    addEventListener:(event,fn)=>documentEvents.set(event,fn),
    dispatchEvent:event=>events.push(event)
  };
  const w={document,
    matchMedia:()=>{if(noMedia)throw new Error('No matchMedia');return media;},
    addEventListener:(event,fn)=>windowEvents.set(event,fn),
    CustomEvent:class {constructor(type,options){this.type=type;this.detail=options.detail;}}
  };
  Object.defineProperty(w,'localStorage',{get(){if(blocked)throw new Error('Storage denied');return storage;}});
  return {w,attrs,values,writes,events,calls,mediaEvents,
    os(value){media.matches=value;for(const fn of [...mediaEvents])fn({matches:value});},
    storage(value,key='pf_theme',storageArea=storage){windowEvents.get('storage')?.({key,newValue:value,storageArea});},
    ready(){documentEvents.get('DOMContentLoaded')?.();},
    renderHooks(){w.applyChartTheme=()=>calls.push('chart');w.renderHeatmap=suffix=>calls.push('heatmap'+suffix);}
  };
}

test('saved light/gold are honored before DOM ready without migration flags',()=>{
  for(const saved of ['light','gold']){
    const e=environment({saved,dark:saved==='light'}),t=createTheme(e.w);
    assert.equal(e.attrs.get('data-theme'),saved);
    assert.equal(t.preference(),saved==='gold'?'dark':'light');
    assert.equal(e.w.document.documentElement.style.colorScheme,saved==='gold'?'dark':'light');
    assert.deepEqual(e.writes,[],'initialization must not overwrite a valid existing preference');
    assert.equal(e.mediaEvents.size,0,'explicit choices do not follow OS changes');
  }
});
test('old dark/neon values migrate to the existing gold CSS and storage namespace',()=>{
  for(const saved of ['dark','neon']){
    const e=environment({saved}),t=createTheme(e.w);
    assert.equal(t.preference(),'dark');assert.equal(t.resolved(),'gold');
    assert.equal(e.values.get('pf_theme'),'gold');
  }
});
test('missing or invalid preference retains the existing light default, even on a dark OS',()=>{
  for(const saved of [undefined,'broken','',null]){
    const e=environment({saved,dark:true}),t=createTheme(e.w);
    assert.equal(t.preference(),'light');assert.equal(t.resolved(),'light');
  }
});
test('system resolves synchronously and follows OS changes only while selected',()=>{
  const e=environment({saved:'system',dark:true}),t=createTheme(e.w);
  assert.equal(t.resolved(),'gold');assert.equal(e.mediaEvents.size,1);
  e.os(false);assert.equal(t.resolved(),'light');assert.equal(t.preference(),'system');
  t.set('dark');assert.equal(e.mediaEvents.size,0);e.os(false);assert.equal(t.resolved(),'gold');
  t.set('system');assert.equal(t.resolved(),'light');assert.equal(e.mediaEvents.size,1);
});
test('older Safari media listeners attach and detach with the same system-only behavior',()=>{
  const e=environment({saved:'system',legacyMedia:true}),t=createTheme(e.w);
  e.os(true);assert.equal(t.resolved(),'gold');
  t.set('light');assert.equal(e.mediaEvents.size,0);e.os(true);assert.equal(t.resolved(),'light');
});
test('storage denial does not block first paint or interactive theme changes',()=>{
  const e=environment({blocked:true,dark:true}),t=createTheme(e.w);
  assert.equal(t.resolved(),'light');
  assert.doesNotThrow(()=>t.set('dark'));assert.equal(t.resolved(),'gold');
  t.set('system');e.os(false);assert.equal(t.resolved(),'light');
});
test('system remains usable where matchMedia is unavailable',()=>{
  const e=environment({saved:'system',noMedia:true}),t=createTheme(e.w);
  assert.equal(t.preference(),'system');assert.equal(t.resolved(),'light');
  t.set('dark');assert.equal(t.resolved(),'gold');
});
test('cycle exposes Light, Dark, System and persists legacy-compatible values',()=>{
  const e=environment(),t=createTheme(e.w);
  assert.equal(t.cycle().preference,'dark');assert.equal(e.values.get('pf_theme'),'gold');
  assert.equal(t.cycle().preference,'system');assert.equal(e.values.get('pf_theme'),'system');
  assert.equal(t.cycle().preference,'light');assert.equal(e.values.get('pf_theme'),'light');
  const count=e.writes.length;t.set('invalid');assert.equal(e.writes.length,count);
});
test('cross-tab updates follow the exact preference without writing an echo',()=>{
  const e=environment({saved:'light',dark:true}),t=createTheme(e.w);
  e.storage('gold');assert.equal(t.preference(),'dark');assert.equal(t.resolved(),'gold');
  e.storage('system');assert.equal(t.preference(),'system');assert.equal(e.mediaEvents.size,1);
  e.os(false);assert.equal(t.resolved(),'light');
  e.storage('gold','unrelated');assert.equal(t.preference(),'system');
  e.storage('gold','pf_theme',{});assert.equal(t.preference(),'system');
  e.storage(null,null);assert.equal(t.preference(),'light');assert.equal(e.mediaEvents.size,0);
  assert.deepEqual(e.writes,[]);
});
test('theme changes call only existing chart/heatmap hooks, including the Agentic map',()=>{
  const e=environment(),t=createTheme(e.w);e.renderHooks();
  e.w.load=()=>assert.fail('Theme must not reload the app or its data');
  t.set('dark');assert.deepEqual(e.calls,['chart','heatmap','heatmap-ag']);
  e.calls.length=0;t.set('dark');assert.deepEqual(e.calls,[]);
});
test('preference changes notify even when the resolved color stays the same',()=>{
  const e=environment({saved:'gold',dark:true}),t=createTheme(e.w),seen=[];e.renderHooks();
  const unsubscribe=t.subscribe(value=>seen.push(value));
  t.set('system');assert.deepEqual(seen,[{preference:'dark',resolved:'gold'},{preference:'system',resolved:'gold'}]);
  assert.deepEqual(e.calls,[],'unchanged chart colors need no redraw');
  unsubscribe();t.set('light');assert.equal(seen.length,2);
  assert.equal(e.events.at(-1).type,'pf:theme');assert.equal(e.events.at(-1).detail.resolved,'light');
});
test('one failing chart or subscriber does not prevent the rest of the appearance update',()=>{
  const e=environment(),t=createTheme(e.w),seen=[];
  e.w.applyChartTheme=()=>{throw new Error('Chart unavailable');};
  e.w.renderHeatmap=suffix=>{e.calls.push(suffix);if(!suffix)throw new Error('Main map unavailable');};
  t.subscribe(()=>{throw new Error('Stale control');});t.subscribe(value=>seen.push(value));
  assert.doesNotThrow(()=>t.set('dark'));assert.deepEqual(e.calls,['','-ag']);
  assert.equal(seen.at(-1).resolved,'gold');
});
test('status-bar color defers to the existing ticker-aware helper when available',()=>{
  const e=environment({saved:'gold'}),t=createTheme(e.w);
  assert.equal(e.attrs.get('meta:content'),'#101923');
  e.w.themeColor=()=> '#0a120f';e.ready();assert.equal(e.attrs.get('meta:content'),'#0a120f');
  t.set('light');assert.equal(e.attrs.get('meta:content'),'#0a120f');
});
