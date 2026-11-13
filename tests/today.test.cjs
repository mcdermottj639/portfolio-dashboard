const {test}=require('node:test');
const assert=require('node:assert/strict');
const T=require('../ui/today-model.js');
const near=(actual,expected,message='')=>assert.ok(Math.abs(actual-expected)<1e-9,`${message}: ${actual} vs ${expected}`);

test('daily holding percent uses reconstructed prior market value across both accounts',()=>{
  const row={symbol:'TEST',value:700,day:50,partialDay:false,shared:true,sources:[
    {qty:2,px:110,day:20,account:'main'},{qty:3,px:110,day:30,account:'agentic'}
  ]};
  const input={positions:[row]},before=JSON.stringify(input),result=T.holdings(input);
  near(result[0].changePct,10,'$50 move / $500 prior value');
  assert.equal(result[0].value,700,'reported holding value is preserved, not used to invent a return denominator');
  assert.equal(result[0].shared,true);assert.equal(result[0].sources,row.sources);
  assert.equal(JSON.stringify(input),before);
});
test('a loss uses the same prior-value basis and a genuine flat quote stays zero',()=>{
  const result=T.holdings({positions:[
    {sources:[{qty:4,px:90,day:-40}],partialDay:false},
    {sources:[{qty:4,px:100,day:0}],partialDay:false}
  ]});
  near(result[0].changePct,-10);assert.equal(result[1].changePct,0);
});
test('partial, missing, malformed and impossible quote bases remain unknown',()=>{
  const valid={qty:1,px:110,day:10};
  for(const sources of [[],[valid,{qty:1,px:100,day:null}],[{...valid,qty:0}],
    [{...valid,px:Infinity}],[{...valid,day:undefined}],[{...valid,day:110}],[{...valid,qty:1e308,px:1e308}]]){
    assert.equal(T.holdings({positions:[{sources,partialDay:false}]})[0].changePct,null);
  }
  assert.equal(T.holdings({positions:[{sources:[valid],partialDay:true}]})[0].changePct,null);
  assert.equal(T.holdings({positions:[null]})[0].changePct,null);
  assert.deepEqual(T.holdings(null),[]);
});
test('treemap areas are proportional, bounded, nonoverlapping and cover the map',()=>{
  const rows=[{symbol:'A',value:60},{symbol:'B',value:25},{symbol:'C',value:10},{symbol:'D',value:5}];
  const before=JSON.stringify(rows),tiles=T.treemap(rows,640,260);
  assert.equal(tiles.length,4);
  near(tiles.reduce((sum,r)=>sum+r.w*r.h,0),10000,'total percent-area');
  for(const tile of tiles){
    near(tile.share,tile.value);near(tile.w*tile.h/100,tile.share,'area share');
    assert.ok(tile.x>=0&&tile.y>=0&&tile.w>0&&tile.h>0);
    assert.ok(tile.x+tile.w<=100+1e-9&&tile.y+tile.h<=100+1e-9);
  }
  for(let i=0;i<tiles.length;i++)for(let j=i+1;j<tiles.length;j++){
    const a=tiles[i],b=tiles[j];
    const overlapW=Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x);
    const overlapH=Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y);
    assert.ok(overlapW<=1e-9||overlapH<=1e-9,`${a.symbol}/${b.symbol} overlap`);
  }
  assert.equal(JSON.stringify(rows),before);assert.deepEqual(T.treemap(rows,640,260),tiles);
});
test('treemap preserves every positive holding, including small tiles and stable equal values',()=>{
  const rows=Array.from({length:48},(_,i)=>({symbol:'P'+i,value:i===47?0.001:1,custom:i}));
  const tiles=T.treemap(rows,260,640);
  assert.equal(tiles.length,48);assert.equal(tiles[47].symbol,'P47');
  assert.deepEqual(tiles.slice(0,47).map(r=>r.custom),rows.slice(0,47).map(r=>r.custom));
  assert.ok(tiles[47].share>0);
});
test('treemap ignores invalid/nonpositive values and fails closed on invalid dimensions',()=>{
  const tiles=T.treemap([{symbol:'A',value:10},{value:null},{value:0},{value:-1},{value:NaN},{value:Infinity},null]);
  assert.equal(tiles.length,1);assert.deepEqual([tiles[0].x,tiles[0].y,tiles[0].w,tiles[0].h,tiles[0].share],[0,0,100,100,100]);
  for(const width of [0,-1,null,Infinity,NaN])assert.deepEqual(T.treemap([{value:1}],width,260),[]);
  assert.deepEqual(T.treemap(null),[]);
  const big=T.treemap([{value:1e308},{value:1e308}]);near(big[0].share,50);near(big[1].share,50);
});
test('a proposed ticket never manufactures broker execution',()=>{
  const waiting=T.ticket({status:'proposed',autoEligible:false});
  assert.equal(waiting.group,'waiting');assert.equal(waiting.label,'Awaiting your confirmation');
  assert.equal(T.ticket({status:'proposed'}).group,'waiting','missing eligibility never becomes permission');
  for(const ticket of [{status:'proposed',autoEligible:true},{status:'confirmed'}]){
    const result=T.ticket(ticket);assert.equal(result.group,'monitor');assert.equal(result.label,'Queued for executor');
    assert.match(result.detail,/submission has not been confirmed/);
  }
});
test('submitted, partial and completed ticket states distinguish reports from broker fills',()=>{
  for(const status of ['sells-placed','buys-placed']){
    const result=T.ticket({status});assert.equal(result.group,'monitor');assert.equal(result.label,'Submission reported');
    assert.match(result.detail,/Fill status is not confirmed/);
  }
  for(const status of ['partial-fill','partially-filled'])assert.equal(T.ticket({status}).label,'Partial fill reported');
  const done=T.ticket({status:'done'});assert.equal(done.group,'complete');assert.equal(done.label,'Recorded ticket complete');
  assert.match(done.detail,/does not independently confirm broker fills/);
});
test('failed and unknown tickets require review while absent and cancelled tickets are separate',()=>{
  for(const status of ['aborted','rejected','new-unrecognized-state'])assert.equal(T.ticket({status}).group,'waiting');
  assert.equal(T.ticket({status:'new-unrecognized-state'}).label,'Status needs review');
  assert.equal(T.ticket({id:'record-without-status'}).group,'waiting');
  assert.equal(T.ticket({status:'cancelled'}).group,'complete');
  for(const value of [null,undefined,[],{},'done'])assert.equal(T.ticket(value).group,'none');
});
test('entry rail has a numeric price scale and uses only actual stop/limit/tp1 fields',()=>{
  const levels=T.levels({stop:985,limit:1045,tp1:1180});
  assert.deepEqual({stop:levels.stop,entry:levels.entry,target:levels.target},{stop:985,entry:1045,target:1180});
  near(levels.entryPct,60/195*100);
  for(const value of [null,{}, {stop:985,limit:1045}, {stop:985,limit:1045,target:1180},
    {stop:0,limit:1,tp1:2},{stop:10,limit:10,tp1:20},{stop:10,limit:20,tp1:15},
    {stop:10,limit:20,tp1:Infinity},{stop:10,limit:'',tp1:30}])assert.equal(T.levels(value),null);
});
test('biggest drag excludes partial and unknown dollar moves and never picks a gain',()=>{
  const known={symbol:'KNOWN',day:-20,partialDay:false};
  const rows=[{symbol:'PARTIAL',day:-1000,partialDay:true},{symbol:'UNKNOWN',day:null,partialDay:false},
    {symbol:'UP',day:500,partialDay:false},known,{symbol:'LESS',day:-5,partialDay:false}];
  assert.equal(T.biggestDrag(rows),known);
  assert.equal(T.biggestDrag([{day:0,partialDay:false},{day:2,partialDay:false},{day:-1}]),null);
  assert.equal(T.biggestDrag(null),null);
});
