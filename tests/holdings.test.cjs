const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const M=require('../ui/experience-model.js');
const data={quotes:{SAME:{previous_close:90},TINY:{previous_close:10}},main:{positions:[{symbol:'SAME',qty:999,avgCost:1}]},agentic:{cash:49.5,positions:[{symbol:'SAME',qty:2.5,avgCost:80,px:100,value:250},{symbol:'TINY',qty:0.05,avgCost:10,px:10,value:0.5}]}};
test('Agentic details use its own fractional lots and book including cash',()=>{
 const copy=JSON.stringify(data),rows=M.agenticPositionRows(data),r=rows[0];
 assert.equal(r.qty,2.5);assert.equal(r.avg,80);assert.equal(r.cost,200);assert.equal(r.val,250);assert.equal(r.pnlD,50);assert.equal(r.pnlP,25);assert.equal(r.pct,250/300*100);assert.equal(r.dayP,10/90*100);
 assert.equal(rows[1].qty,.05);assert.equal(rows[1].pnlD,0);assert.equal(rows[1].dayP,0);assert.equal(JSON.stringify(data),copy);
});
test('Unknown cost, quote and book never become zero profit or risk',()=>{
 const [r]=M.agenticPositionRows({agentic:{positions:[{symbol:'MISS',qty:1,value:0,px:0,avgCost:null}]}});
 for(const key of ['px','val','avg','cost','pnlD','pnlP','pct','dayP'])assert.equal(r[key],null,key);
 const rows=M.agenticPositionRows({agentic:{cash:10,positions:[...data.agentic.positions,{symbol:'MISS',qty:2,value:0}]}});
 assert.ok(rows.every(r=>r.pct===null));assert.equal(rows.at(-1).val,null);
});
test('Zero basis is retained but does not claim an infinite percentage return',()=>{
 const [r]=M.agenticPositionRows({agentic:{cash:0,positions:[{symbol:'GIFT',qty:2,avgCost:0,px:10,value:20}]}});
 assert.equal(r.cost,0);assert.equal(r.pnlD,20);assert.equal(r.pnlP,null);assert.equal(r.pct,100);
});
test('Adjusted close is preferred and an invalid adjusted close falls back to the recorded previous close',()=>{
 const [r]=M.agenticPositionRows({...data,quotes:{SAME:{adjusted_previous_close:0,previous_close:100}}});assert.equal(r.dayP,0);
 const [adjusted]=M.agenticPositionRows({...data,quotes:{SAME:{adjusted_previous_close:100,previous_close:50}}});assert.equal(adjusted.dayP,0);
 assert.deepEqual(M.agenticPositionRows({}),[]);
});
function renderer(){
 const html=fs.readFileSync('index.html','utf8'),nodes={};
 const context={window:{PFExperienceModel:M,__DATA:data},document:{getElementById:id=>nodes[id]||(nodes[id]={innerHTML:''})},Intl,SMALL_THR:250};
 vm.createContext(context);
 vm.runInContext(html.slice(html.indexOf('function risk('),html.indexOf('/* ─── Parsers')),context);
 vm.runInContext(html.slice(html.indexOf('let _enriched=[];'),html.indexOf('/* ═══ Technical Signals (kept)')),context);
 return {context,nodes};
}
test('Shared table keeps every Agentic lot, detail column and account-local sort state',()=>{
 const {context,nodes}=renderer();
 vm.runInContext("_renderPos([{symbol:'MAIN',val:500,qty:10,avg:40,px:50,cost:400,pnlD:100,pnlP:25,dayP:0,pct:100,r:risk(100)}]);renderAgenticPositions();",context);
 const main=nodes['pos-table'].innerHTML;
 for(const label of ['Symbol','% Port','Risk','Shares','Cost','Price','Value','P&L $','P&L %','Day %'])assert.ok(nodes['pos-table-ag'].innerHTML.includes(label));
 assert.ok(nodes['pos-table-ag'].innerHTML.includes('TINY'));assert.ok(!nodes['pos-table-ag'].innerHTML.includes('MAIN'));
 vm.runInContext("sortBy('val','agentic');",context);
 assert.ok(nodes['pos-table-ag'].innerHTML.indexOf('>TINY<')<nodes['pos-table-ag'].innerHTML.indexOf('>SAME<'));
 assert.equal(nodes['pos-table'].innerHTML,main);
 vm.runInContext("window.__DATA={agentic:{cash:0,positions:[{symbol:'MISS',qty:2,px:0,avgCost:null,value:0}]}};renderAgenticPositions();",context);
 assert.ok(nodes['pos-table-ag'].innerHTML.includes('MISS'));assert.ok(!nodes['pos-table-ag'].innerHTML.includes('GOOD'));assert.ok(!nodes['pos-table-ag'].innerHTML.includes('$0.00'));
});
