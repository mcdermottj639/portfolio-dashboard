// v240: one wording for agentic ticket status. PFExperienceModel.ticketStatus is the only status -> words map;
// Today, Agentic Plan, the Agentic Accounts strip, the market tape and Activity all render through it.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const M=require('../ui/experience-model.js');
const T=require('../ui/today-model.js');
const OLD=/sells are in|buys are in|sells placed|buys placed|Ticket completed|waiting on your confirm|awaiting your confirm\b|^proposed$|^done$|^sells-placed$|^buys-placed$/i;

test('every known status has the canonical text, group and (for done) the record-not-fill caveat',()=>{
  const want=[
    [{status:'proposed',autoEligible:false},'proposed-confirm','waiting','Awaiting your confirmation'],
    [{status:'proposed'},'proposed-confirm','waiting','Awaiting your confirmation'],
    [{status:'proposed',autoEligible:true},'proposed-auto','monitor','Queued for executor'],
    [{status:'confirmed'},'confirmed','monitor','Queued for executor · confirmation recorded'],
    [{status:'sells-placed'},'sells-placed','monitor','Submission reported · sells'],
    [{status:'buys-placed'},'buys-placed','monitor','Submission reported · buys'],
    [{status:'partial-fill'},'partial-fill','monitor','Partial fill reported'],
    [{status:'partially-filled'},'partial-fill','monitor','Partial fill reported'],
    [{status:'done'},'done','complete','Recorded ticket complete'],
    [{status:'cancelled'},'cancelled','complete','Ticket cancelled'],
    [{status:'aborted'},'aborted','waiting','Ticket needs review'],
    [{status:'rejected'},'rejected','waiting','Ticket needs review'],
  ];
  for(const [pending,key,group,label] of want){
    const t=M.ticketStatus(pending);
    assert.equal(t.group,group,key);assert.equal(t.label,label,key);assert.equal(t.known,true);
    assert.ok(t.compact.startsWith(label),key+' compact starts with the canonical label');
    assert.ok(t.detail.length>20,key+' has Today detail text');
    assert.ok(!OLD.test(t.compact),key+' never prints an old or raw status word: '+t.compact);
  }
  assert.match(M.ticketStatus({status:'done'}).compact,/does not independently confirm broker fills/,'done carries the record-not-fill caveat on compact surfaces');
  for(const s of ['sells-placed','buys-placed'])assert.match(M.ticketStatus({status:s}).compact,/fill status is not confirmed/);
  assert.match(M.ticketStatus({status:'aborted'}).compact,/aborted/);assert.match(M.ticketStatus({status:'rejected'}).compact,/rejected/);
});
test('the two queued states stay distinct and Today uses the same strings',()=>{
  const auto=M.ticketStatus({status:'proposed',autoEligible:true}),own=M.ticketStatus({status:'confirmed'});
  assert.notEqual(auto.label,own.label);assert.ok(own.label.startsWith(auto.label));assert.match(own.label,/confirmation recorded/);
  assert.equal(T.ticket({status:'confirmed'}).label,own.label);assert.equal(T.ticket({status:'proposed',autoEligible:true}).label,auto.label);
  assert.notEqual(M.ticketStatus({status:'sells-placed'}).label,M.ticketStatus({status:'buys-placed'}).label);
  assert.notEqual(M.ticketStatus({status:'aborted'}).compact,M.ticketStatus({status:'rejected'}).compact);
});
test('terminal flags: done, aborted, cancelled and rejected are finished; everything else is in flight or unknown',()=>{
  for(const s of ['done','aborted','cancelled','rejected']){const t=M.ticketStatus({status:s});assert.equal(t.terminal,true,s);assert.equal(t.heading,'Last ticket',s);}
  for(const s of ['proposed','confirmed','sells-placed','buys-placed','partial-fill']){const t=M.ticketStatus({status:s});assert.equal(t.terminal,false,s);assert.equal(t.heading,'Rebalance in flight',s);}
});
test('an unknown or missing status is shown as needing review with the raw value, never hidden or treated as zero',()=>{
  const t=M.ticketStatus({status:'Weird-State'});
  assert.equal(t.known,false);assert.equal(t.label,'Status needs review');assert.equal(t.group,'waiting');assert.equal(t.terminal,false);
  assert.match(t.compact,/Status needs review: “Weird-State”/);assert.match(t.detail,/unrecognized/);assert.equal(t.heading,'Latest ticket');
  const blank=M.ticketStatus({id:'x'});assert.equal(blank.group,'waiting');assert.match(blank.compact,/no status recorded/);
  assert.equal(M.ticketStatus({status:'stale'}).known,false,'a producer action word is not a stored status');
  for(const v of [null,undefined,[],{},'done'])assert.equal(M.ticketStatus(v).group,'none');
});
test('timeline events map through the same words, using the ticket auto flag for "proposed"',()=>{
  assert.equal(M.ticketStatusFor('proposed',{autoEligible:true}).label,'Queued for executor');
  assert.equal(M.ticketStatusFor('proposed',{autoEligible:false}).label,'Awaiting your confirmation');
  assert.equal(M.ticketStatusFor('done',null).label,'Recorded ticket complete');
});
test('the attention row title uses the map',()=>{
  const data={generatedAt:new Date().toISOString(),agentic:{pending:{status:'sells-placed',id:'t'}}};
  const brief=M.dailyBrief(data,null);
  assert.ok(brief.attention.some(a=>a.title==='Agentic ticket: '+M.ticketStatus({status:'sells-placed'}).text),JSON.stringify(brief.attention.map(a=>a.title)));
});
