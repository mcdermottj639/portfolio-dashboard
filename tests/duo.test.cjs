'use strict';
// v247 central Duo state: mode resolution, detection and persistence (pure core of ui/duo.js; no DOM).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const src = fs.readFileSync(path.join(__dirname, '../ui/duo.js'), 'utf8');
const sandbox = {}; sandbox.window = sandbox;
vm.runInNewContext(src, sandbox);   // no `document`: only PFDuo.core is built
const core = sandbox.PFDuo.core;
const stacked = (w = 466) => [{top:0,bottom:300,left:0,right:w},{top:324,bottom:677,left:0,right:w}];
const side = () => [{top:0,bottom:676,left:0,right:475},{top:0,bottom:676,left:499,right:951}];

// Detection: only real two-segment geometry decides; posture alone, one/three segments, junk and "continuous" never do.
assert.equal(core.detect({segments:stacked(),posture:'folded'}).layout, 'folded');
assert.equal(core.detect({segments:stacked(),posture:''}).layout, 'folded');
assert.equal(core.detect({segments:side(),posture:'folded'}).layout, 'book');
assert.equal(core.detect({segments:stacked().reverse(),posture:''}).layout, 'folded', 'array order does not matter');
assert.equal(core.detect({segments:stacked(),posture:'continuous'}).layout, 'standard');
assert.equal(core.detect({segments:null,posture:'folded'}).layout, 'standard', 'posture without geometry cannot place a split');
assert.equal(core.detect({segments:[stacked()[0]],posture:'folded'}).layout, 'standard');
assert.equal(core.detect({segments:[...stacked(),stacked()[0]],posture:''}).layout, 'standard');
assert.equal(core.detect({segments:[{top:0,bottom:NaN,left:0,right:1},stacked()[1]],posture:''}).layout, 'standard');
assert.equal(core.detect({segments:[{top:0,bottom:10,left:0,right:10},{top:5,bottom:20,left:5,right:20}],posture:''}).layout, 'standard', 'overlapping segments are not a fold');
assert.equal(core.detect(undefined).layout, 'standard');

// Resolution: auto follows detection (standard when none); the three explicit modes ignore it.
for (const det of ['standard','folded','book']) {
  assert.equal(core.resolve('auto',det), det);
  assert.equal(core.resolve('standard',det), 'standard');
  assert.equal(core.resolve('folded',det), 'folded');
  assert.equal(core.resolve('book',det), 'book');
}
assert.equal(core.resolve('auto',undefined), 'standard');
assert.equal(core.resolve('nonsense','book'), 'book', 'an unknown mode is auto');

// Geometry: a reported crease keeps a 24px gutter; a forced split falls back to half the viewport.
const d = core.detect({segments:stacked(),posture:'folded'});
assert.deepEqual(JSON.parse(JSON.stringify(core.geometry('folded',466,677,d))), {top:300,bottom:324,real:true});
assert.deepEqual(JSON.parse(JSON.stringify(core.geometry('folded',466,677,{layout:'standard'}))), {top:335,bottom:343,real:false});
const db = core.detect({segments:side(),posture:'folded'});
assert.deepEqual(JSON.parse(JSON.stringify(core.geometry('book',951,676,db))), {left:475,right:499,real:true});
assert.equal(core.geometry('book',700,500,{layout:'standard'}).left, 346);
assert.equal(core.geometry('standard',700,500,d), null);
assert.equal(core.geometry('book',700,500,d).real, false, 'stacked segments do not place a book split');

// Persistence: valid modes round-trip; junk, missing and a throwing store all mean auto; a failed write is not fatal.
const mem = () => { const m = new Map(); return { getItem: k => m.has(k) ? m.get(k) : null, setItem: (k,v) => { m.set(k,String(v)); } }; };
for (const m of ['auto','folded','book','standard']) { const s = mem(); assert.equal(core.writeMode(s,m), true); assert.equal(core.readMode(s), m); }
assert.equal(core.KEY, 'pf:duo-mode');
assert.equal(core.readMode(mem()), 'auto');
const junk = mem(); junk.setItem('pf:duo-mode','sideways'); assert.equal(core.readMode(junk), 'auto');
const broken = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
assert.equal(core.readMode(broken), 'auto'); assert.equal(core.writeMode(broken,'book'), false);
assert.equal(core.readMode(null), 'auto');

// Which routes split: exactly the five landing routes.
assert.deepEqual(Object.keys(core.LANDING).sort(), ['accounts','analyze','apexpaper','markets','today']);
  // v248: Book (only) also splits the rest of the Apex / Agentic workspace for the command panel.
  assert.deepEqual(Object.keys(core.BOOK_ROUTES).sort(), ['flow','fundamentals','heatmap','holdings','income','performance','plan','risk','technicals']);
// Layout-only contract: the split code is keyed to the state attributes (static check on the shipped stylesheet).
const css = fs.readFileSync(path.join(__dirname, '../ui/duo.css'), 'utf8');
const block = css.slice(css.indexOf('9 · v247')).replace(/\/\*[\s\S]*?\*\//g, '');
for (const sel of block.match(/[^{}]+(?=\{)/g).map(x => x.trim()).filter(x => x && !x.startsWith('@')))
  assert.ok(/data-duo-|#pf-duo/.test(sel), 'unscoped v247 selector: ' + sel);
console.log('duo core OK');
