export const meta = {
  name: 'agentic-research',
  description: 'Deep multi-factor research (momentum/quality/growth/catalyst) → adversarial verify → sector-diversified target for the agentic cash account. Drives producer/agentic-target.json.',
  whenToUse: 'Weekly (or on demand) to refresh the canonical target the Agentic Portfolio card + rebalance planner read. Pass a fresh universe via args.universe; falls back to a baked-in quality universe.',
  phases: [
    { title: 'Sleeves', detail: 'momentum, quality, growth, catalyst — scored in parallel over the universe' },
    { title: 'Verify', detail: 'adversarially refute each top-ranked name' },
    { title: 'Synthesize', detail: 'sector-diversified target allocation from survivors' },
  ],
}

// Universe: spans value (oversold large-caps), momentum/quality leaders, and an index core. Pass a
// FRESH universe via args.universe each weekly run (assemble it from the RH oversold scan + leaders +
// any new holdings — see producer/AGENTIC.md); this baked-in list is the fallback / starting point.
const U = (args && Array.isArray(args.universe) && args.universe.length) ? args.universe : [
  {t:'ICE', sec:'Finance',              px:123.84, pe:18.0,  hi:189.35, lo:123.74},
  {t:'CME', sec:'Finance',              px:221.30, pe:18.9,  hi:329.16, lo:220.73},
  {t:'JPM', sec:'Finance',              px:336.00, pe:15.8,  hi:343.45, lo:279.10},
  {t:'V',   sec:'Finance',              px:332.00, pe:29.6,  hi:359.66, lo:293.89},
  {t:'ACN', sec:'Technology Services',  px:128.98, pe:10.3,  hi:307.77, lo:118.15},
  {t:'CTSH',sec:'Technology Services',  px:40.45,  pe:8.7,   hi:87.03,  lo:38.97},
  {t:'MSFT',sec:'Technology Services',  px:372.97, pe:22.2,  hi:555.45, lo:349.20},
  {t:'ORCL',sec:'Technology Services',  px:148.61, pe:25.5,  hi:345.72, lo:134.57},
  {t:'GOOGL',sec:'Technology Services', px:337.39, pe:25.7,  hi:408.61, lo:171.73},
  {t:'META',sec:'Technology Services',  px:543.00, pe:20.0,  hi:796.25, lo:520.26},
  {t:'CRM', sec:'Technology Services',  px:157.00, pe:18.3,  hi:276.80, lo:146.32},
  {t:'NFLX',sec:'Technology Services',  px:73.63,  pe:23.9,  hi:134.12, lo:70.86},
  {t:'NVDA',sec:'Electronic Technology',px:192.53, pe:29.5,  hi:236.54, lo:151.49},
  {t:'AAPL',sec:'Electronic Technology',px:283.78, pe:34.3,  hi:317.40, lo:199.26},
  {t:'AVGO',sec:'Electronic Technology',px:370.00, pe:60.8,  hi:495.00, lo:262.66},
  {t:'AMD', sec:'Electronic Technology',px:519.00, pe:171.2, hi:562.99, lo:133.50},
  {t:'GE',  sec:'Electronic Technology',px:369.00, pe:45.5,  hi:379.67, lo:243.34},
  {t:'AMZN',sec:'Retail Trade',         px:232.69, pe:27.8,  hi:278.56, lo:196.00},
  {t:'COST',sec:'Retail Trade',         px:953.00, pe:47.9,  hi:1096.5, lo:844.06},
  {t:'WMT', sec:'Retail Trade',         px:117.00, pe:40.8,  hi:135.16, lo:94.23},
  {t:'HD',  sec:'Retail Trade',         px:348.00, pe:24.8,  hi:426.75, lo:289.10},
  {t:'SHEL',sec:'Energy Minerals',      px:77.16,  pe:11.8,  hi:94.90,  lo:68.63},
  {t:'CNQ', sec:'Energy Minerals',      px:39.50,  pe:11.8,  hi:51.34,  lo:29.30},
  {t:'XOM', sec:'Energy Minerals',      px:137.00, pe:23.0,  hi:176.41, lo:105.53},
  {t:'LLY', sec:'Health Technology',    px:1200.0, pe:43.5,  hi:1215.8, lo:623.78},
  {t:'UNH', sec:'Health Services',      px:416.00, pe:32.3,  hi:427.93, lo:234.60},
  {t:'ROL', sec:'Commercial Services',  px:43.26,  pe:39.5,  hi:66.14,  lo:42.61},
]
const baseline = JSON.stringify(U)

const SLEEVE_SCHEMA = { type:'object', additionalProperties:false,
  properties:{ scores:{ type:'array', items:{ type:'object', additionalProperties:false,
    properties:{ ticker:{type:'string'}, score:{type:'number'}, note:{type:'string'} },
    required:['ticker','score','note'] } } }, required:['scores'] }
const VERDICT_SCHEMA = { type:'object', additionalProperties:false,
  properties:{ ticker:{type:'string'}, recommendation:{type:'string', enum:['buy','hold','avoid']},
    confidence:{type:'number'}, biggestRisk:{type:'string'}, supports:{type:'boolean'} },
  required:['ticker','recommendation','confidence','biggestRisk','supports'] }
const ALLOC_SCHEMA = { type:'object', additionalProperties:false,
  properties:{ summary:{type:'string'}, picks:{ type:'array', items:{ type:'object', additionalProperties:false,
    properties:{ ticker:{type:'string'}, sector:{type:'string'}, weightPct:{type:'number'}, dollars:{type:'number'},
      thesis:{type:'string'}, entryZone:{type:'string'}, stop:{type:'number'}, target:{type:'number'}, rr:{type:'string'} },
    required:['ticker','sector','weightPct','dollars','thesis','entryZone','stop','target','rr'] } } },
  required:['summary','picks'] }

const toolHint = 'Discover MCP tools with ToolSearch (e.g. "select:mcp__Robinhood__get_equity_historicals,mcp__Robinhood__get_equity_quotes" or keyword "alpha vantage company overview"). Batch Robinhood calls (fundamentals/quotes take many symbols; historicals up to 3). Alpha Vantage is per-symbol + rate-limited — prioritize the highest-signal field; on failure fall back to the baseline and note reduced coverage. Score EVERY ticker; if you truly cannot get data, score 5.0 and say "no data".'

phase('Sleeves')
const [mom, qual, growth, cat] = await parallel([
  ()=>agent(`Score this universe on MOMENTUM / relative strength (0-10) for a swing-to-position portfolio. Assess price vs 50/200-DMA, 3- and 6-month RS vs SPY, recent trend. Use RH historicals + quotes; optionally AV SMA/MACD. ${toolHint}\n10 = strong sustained uptrend above rising 50/200-DMA + positive RS; 5 = basing; 0 = broken downtrend. A name deep below its MAs scores LOW.\nUniverse: ${baseline}`, {schema:SLEEVE_SCHEMA, phase:'Sleeves', label:'momentum', effort:'medium'}),
  ()=>agent(`Score this universe on QUALITY (0-10). Use AV COMPANY_OVERVIEW (ROE, margins) + BALANCE_SHEET/CASH_FLOW (leverage, FCF) + RH fundamentals (PE/PB). ${toolHint}\n10 = high ROE, fat stable margins, strong FCF, low leverage; 0 = unprofitable / over-levered / value trap. Penalize negative earnings hard.\nUniverse: ${baseline}`, {schema:SLEEVE_SCHEMA, phase:'Sleeves', label:'quality', effort:'medium'}),
  ()=>agent(`Score this universe on GROWTH & ESTIMATE REVISIONS (0-10). Use AV COMPANY_OVERVIEW growth fields, EARNINGS_ESTIMATES (forward EPS revision direction), EARNINGS (surprise history). ${toolHint}\n10 = strong/accelerating rev+EPS growth WITH upward revisions + positive surprises; 0 = shrinking with downward revisions.\nUniverse: ${baseline}`, {schema:SLEEVE_SCHEMA, phase:'Sleeves', label:'growth', effort:'medium'}),
  ()=>agent(`Score this universe on CATALYSTS & SENTIMENT (0-10). Use RH earnings calendar/results, AV NEWS_SENTIMENT, AV INSIDER_TRANSACTIONS (insider buying bullish). ${toolHint}\n10 = positive news + insider buying + favorable setup; 0 = negative sentiment / insider selling / overhang. An earnings report within ~2 weeks is a RISK for a fresh entry — nudge DOWN and flag it.\nUniverse: ${baseline}`, {schema:SLEEVE_SCHEMA, phase:'Sleeves', label:'catalyst', effort:'medium'}),
])

const mapOf=(r)=>{ const m={}; if(r&&Array.isArray(r.scores)) for(const s of r.scores){ if(s&&s.ticker) m[String(s.ticker).toUpperCase()]=s; } return m }
const M=mapOf(mom), Q=mapOf(qual), G=mapOf(growth), C=mapOf(cat)
const sc=(m,t)=>{ const x=m[t]; const v=x&&typeof x.score==='number'?x.score:5; return Math.max(0,Math.min(10,v)) }
const note=(m,t)=>{ const x=m[t]; return x&&x.note?x.note:'' }
const valOf=(u)=>{ let peS; const pe=u.pe; if(!(pe>0))peS=2.5; else if(pe<=12)peS=9; else if(pe<=18)peS=8; else if(pe<=25)peS=6.5; else if(pe<=35)peS=5; else if(pe<=50)peS=3.5; else peS=2;
  let rgS=5; if(u.hi>u.lo){ const rp=(u.px-u.lo)/(u.hi-u.lo); rgS=rp<0.15?9:rp<0.30?7.5:rp<0.50?6:rp<0.70?4.5:3; } return 0.6*peS+0.4*rgS }
const ranked = U.map(u=>{ const t=u.t, m=sc(M,t), q=sc(Q,t), g=sc(G,t), c=sc(C,t), v=valOf(u);
  const composite=0.22*m+0.24*q+0.22*g+0.14*c+0.18*v;
  return {...u,m,q,g,c,v:+v.toFixed(2),composite:+composite.toFixed(3),notes:{momentum:note(M,t),quality:note(Q,t),growth:note(G,t),catalyst:note(C,t)}} }).sort((a,b)=>b.composite-a.composite)
log('Composite top 14: '+ranked.slice(0,14).map(r=>`${r.t} ${r.composite}`).join(' · '))
const secCount={}, finalists=[]
for(const r of ranked){ if(finalists.length>=10)break; const n=secCount[r.sec]||0; if(n>=2)continue; secCount[r.sec]=n+1; finalists.push(r) }
log('Finalists: '+finalists.map(r=>r.t).join(', '))

phase('Verify')
const verdicts = await parallel(finalists.map((r,i)=>()=>
  agent(`Adversarially STRESS-TEST the buy case for ${r.t} (${r.sec}, ~$${r.px}). Screen rank #${i+1}; sleeves momentum=${r.m} quality=${r.q} growth=${r.g} catalyst=${r.c} valuation=${r.v}. Notes: ${JSON.stringify(r.notes)}.\nREFUTE, don't confirm: value trap? deteriorating fundamentals/margins? negative near-term catalyst (earnings-miss risk, guidance cut, secular decline, legal/regulatory)? crowded/over-owned downside skew? technically broken with no support? Pull live data via ToolSearch. Default skeptical. supports=true ONLY if it survives as a genuine buy for a long-only swing-to-position holding.`,
    {schema:VERDICT_SCHEMA, phase:'Verify', label:'verify:'+r.t, effort:'high'}).then(v=> v?{...r,verdict:v}:null)))
const survivors = verdicts.filter(Boolean).filter(x=>x.verdict&&x.verdict.supports&&x.verdict.recommendation!=='avoid')
log(`Survivors ${survivors.length}/${finalists.length}: `+survivors.map(s=>s.t).join(', '))
const forSynth=(survivors.length>=6?survivors:verdicts.filter(Boolean).filter(x=>x.verdict&&x.verdict.recommendation!=='avoid'))
  .map(s=>({ticker:s.t,sector:s.sec,px:s.px,hi52:s.hi,lo52:s.lo,composite:s.composite,sleeves:{momentum:s.m,quality:s.q,growth:s.g,catalyst:s.c,valuation:s.v},verdict:s.verdict}))

phase('Synthesize')
const alloc = await agent(`Build the long-only target allocation for the agentic cash account ($${(args&&args.book)||1000} book, fractional OK) from these VERIFIED survivors. Each carries sleeve scores (0-10), composite, sector, price, 52wk range, adversarial verdict.\nRules: 7-9 names, SECTOR-DIVERSIFIED (max 2/sector); include SPY as ~15-20% index ballast (add it, not a survivor); conviction-weighted toward MULTI-sleeve strength; floor ~5%, cap 25%; weights sum ~100%. Per name: sector, weightPct, dollars, one-line thesis naming the driving sleeves, entryZone near live price, protective stop (~8-12% below or under 50-DMA), take-profit target, reward:risk. SPY = wide stop / "core hold". Sanity-check live quotes before sizing. Summary: 2-3 sentences on factor/sector balance + risk posture.\nSurvivors: ${JSON.stringify(forSynth)}`,
  {schema:ALLOC_SCHEMA, phase:'Synthesize', label:'synthesize', effort:'high'})

return { ranking: ranked.map(r=>({t:r.t,composite:r.composite,m:r.m,q:r.q,g:r.g,c:r.c,v:r.v})),
  finalists: finalists.map(f=>f.t),
  verdicts: verdicts.filter(Boolean).map(x=>({t:x.t,rec:x.verdict.recommendation,conf:x.verdict.confidence,supports:x.verdict.supports,risk:x.verdict.biggestRisk})),
  allocation: alloc }
