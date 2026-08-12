export const meta = {
  name: 'agentic-research',
  description: 'Deep multi-factor research (momentum/quality/growth/catalyst) → adversarial verify → sector-diversified target for the agentic cash account. Drives producer/agentic-target.json.',
  whenToUse: 'Weekly (or on demand) to refresh the canonical target the Agentic Portfolio card + rebalance planner read. Pass a fresh universe via args.universe (falls back to a baked-in quality universe), plus args.held + args.priorTarget so the incumbency framing (churn governor) can treat the current book as the null hypothesis.',
  phases: [
    { title: 'Sleeves', detail: 'momentum, quality, growth, catalyst — scored in parallel over the universe' },
    { title: 'Verify', detail: 'adversarially refute each top-ranked name' },
    { title: 'Synthesize', detail: 'sector-diversified target allocation from survivors' },
  ],
}

// Universe: spans value (oversold large-caps), momentum/quality leaders, and an index core. Pass a
// FRESH universe via args.universe each weekly run (assemble it from the RH oversold scan + leaders +
// any new holdings — see producer/AGENTIC.md); this baked-in list is the fallback / starting point.
//
// BREADTH MATTERS (v102). On 2026-08-11 a 25-name, megacap-heavy universe produced a book where every
// single name was above its own entry zone — because when the whole universe is extended, "wait for a
// better price" is the only honest answer the process can give, and the cash never gets deployed. A
// screen can only buy what it is shown. When assembling `args.universe`, deliberately include ground
// where value can actually be found — mid-caps, out-of-favour sectors, international/EM, and the
// oversold-scan finalists — not just the mega-cap leaders bench. A wider universe does not weaken the
// discipline; it gives the discipline somewhere to say yes.
// INCUMBENCY (2026-08-12 churn governor). Pass args.held = the account's CURRENT holdings
// ([{t:'SPY',w:20},…] or plain tickers) and args.priorTarget = the committed agentic-target.json.
// Each weekly run used to build the target from scratch with no memory — a 51/49 conviction change
// flipped a position 100% out and (the next week) 100% back in, every leg short-term taxable. The
// live cost: 08-05 dropped GE/LLY/AMZN/MSFT → all exited 08-10; 08-11 re-included all four and
// dropped AAPL/UNH/V → full round trip inside 48h. Downstream code now retains a dropped-but-held
// name one extra cycle and blocks 14d re-entries regardless of what this workflow says — but the
// cheapest place to stop churn is here, by making displacement cost something in the prompts.
const HELD = (()=>{ const raw = (args && args.held) || []; const out = {};
  for (const h of (Array.isArray(raw)?raw:[])) { if(!h) continue;
    if (typeof h === 'string') out[h.toUpperCase()] = { w: null };
    else if (h.t || h.ticker) out[String(h.t||h.ticker).toUpperCase()] = { w: (typeof h.w === 'number' ? h.w : (typeof h.weightPct === 'number' ? h.weightPct : null)) }; }
  return out })()
const PRIOR_TARGET = (args && args.priorTarget && Array.isArray(args.priorTarget.names))
  ? args.priorTarget.names.map(n=>({t:String(n.ticker).toUpperCase(), w:n.weightPct, phaseOut:!!n.phaseOut}))
  : null

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
// SPLIT VERDICT (v102). `supports` used to collapse two independent judgements into one boolean, and
// the failure mode showed up live on 2026-08-11: 5 of 6 names came back unsupported and EVERY rejection
// said the same thing — "the business is sound, the price is wrong". One yes/no can't express that, so a
// great company 2% above its ideal entry was discarded exactly like a broken one, and the whole book went
// to cash. Now the two are scored apart: `businessOk` decides INCLUSION, `entryQuality` decides SIZE.
// A sound business at a mediocre price gets sized DOWN (and its entry zone set where it's worth owning),
// which is a position, not an abstention.
const VERDICT_SCHEMA = { type:'object', additionalProperties:false,
  properties:{ ticker:{type:'string'}, recommendation:{type:'string', enum:['buy','hold','avoid']},
    confidence:{type:'number'}, biggestRisk:{type:'string'}, supports:{type:'boolean'},
    businessOk:{type:'boolean'},                 // is this a business worth owning at SOME price?
    entryQuality:{type:'number'},                // 0-10: how good is TODAY's price for entering?
    entryRisk:{type:'string'} },                 // the price-specific objection, kept apart from the thesis
  required:['ticker','recommendation','confidence','biggestRisk','supports','businessOk','entryQuality','entryRisk'] }
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
// ---- Sleeve 5: FLOW & POSITIONING (v95) -------------------------------------------------------------
// Not an agent. The producer already computed this deterministically (producer/flow.mjs → data.flow):
// analyst revision momentum, insider Form 4 clusters, earnings-surprise drift, federal contract awards.
// Reading it here rather than re-deriving it in a prompt means the producer's card and this sleeve can
// never disagree about what a payload means, and it costs zero tokens. Pass it in as args.flow (the
// data.flow.symbols map); names with no read simply ABSTAIN.
//
// BURN-IN: the owner signed off on this sleeve taking 10% of the composite AFTER a 4-week display-only
// period, so the signal can be judged on real accumulated data first. FLOW_WEIGHT is that switch and is
// the ONLY line to change — set it to 0.10 once the burn-in is complete (see PROPOSAL-flow-signals.md
// §8 and the burn-in note in producer/AGENTIC.md). The remaining five sleeves scale proportionally, so
// their relative standing is identical either way.
// FLOW_WEIGHT gates EVERY path from flow data into the allocation — the composite, the sleeve line and
// notes in the verify prompt, and the sleeve scores handed to synthesis. At 0 the layer is genuinely
// inert: the target is byte-identical to what it would have been without this sleeve. That is what makes
// the burn-in a real control — if flow leaked into the model's judgment while nominally "off", there
// would be no clean before/after to evaluate at the decision point.
// (The congressional block below is separate: zero score weight PERMANENTLY, verify-stage context only.)
const FLOW_WEIGHT = 0     // ← 0 during burn-in; 0.10 after. Nothing else needs to change.
const FLOWMAP = (args && args.flow) || {}
const flowOf = (t)=>{ const f=FLOWMAP[t]; return f && f.flow && typeof f.flow.score==='number' ? f.flow.score : null }
const BASE = { m:0.22, q:0.24, g:0.22, c:0.14, v:0.18 }   // sums to 1.00
const scale = 1 - FLOW_WEIGHT
const W = { m:BASE.m*scale, q:BASE.q*scale, g:BASE.g*scale, c:BASE.c*scale, v:BASE.v*scale }
log(FLOW_WEIGHT>0
  ? `Flow sleeve ACTIVE at ${(FLOW_WEIGHT*100).toFixed(0)}% — ${Object.keys(FLOWMAP).length} symbols supplied`
  : `Flow sleeve in BURN-IN (weight 0, display-only) — ${Object.keys(FLOWMAP).length} symbols supplied`)

const ranked = U.map(u=>{ const t=u.t, m=sc(M,t), q=sc(Q,t), g=sc(G,t), c=sc(C,t), v=valOf(u);
  const f=flowOf(t)
  // A name with no flow read must not be penalised for the silence: renormalize the five base sleeves
  // over themselves so it competes on exactly the terms it did before this sleeve existed.
  const composite = (FLOW_WEIGHT>0 && f!=null)
    ? W.m*m + W.q*q + W.g*g + W.c*c + W.v*v + FLOW_WEIGHT*f
    : BASE.m*m + BASE.q*q + BASE.g*g + BASE.c*c + BASE.v*v;
  return {...u,m,q,g,c,v:+v.toFixed(2),f,composite:+composite.toFixed(3),
    notes:{momentum:note(M,t),quality:note(Q,t),growth:note(G,t),catalyst:note(C,t),
      flow:(FLOW_WEIGHT>0&&f!=null)?`flow ${f}/10 (${(FLOWMAP[t].flow.coverage||[]).join('+')})`:''}} }).sort((a,b)=>b.composite-a.composite)
log('Composite top 14: '+ranked.slice(0,14).map(r=>`${r.t} ${r.composite}`).join(' · '))
const secCount={}, finalists=[]
for(const r of ranked){ if(finalists.length>=10)break; const n=secCount[r.sec]||0; if(n>=2)continue; secCount[r.sec]=n+1; finalists.push(r) }
log('Finalists: '+finalists.map(r=>r.t).join(', '))

phase('Verify')
// Congressional disclosure clusters (args.polClusters, from data.flow.polClusters) enter HERE and ONLY
// here — as evidence for a verifier that has already formed a view, never as a score. The feed lags
// 40-116 days, its apparent edge is a megacap-tech beta tilt, and megacap names are excluded from it
// upstream. See producer/polflow.mjs and PROPOSAL-flow-signals.md for why it gets no weight.
const POLC = (args && args.polClusters) || {}
// Incumbency context for the verifier: a held name's exit is a real taxable event with a deterministic
// governor behind it, so "less attractive than the alternatives" must not masquerade as "broken".
const heldNote = (t)=>{ const h=HELD[t]; return h
  ? `\nTHE ACCOUNT CURRENTLY HOLDS THIS${h.w!=null?` (~${h.w}% of book)`:''}. Exiting is a taxable short-term sale, and a deterministic churn governor (14-day min-hold, re-entry cooldown, one-cycle phase-out) makes a flip-flopped verdict pure cost. Be precise about WHICH claim you are making: businessOk=false means the thesis is actually BROKEN (a genuine sell signal that overrides the min-hold); a name that is merely less attractive than it was is businessOk=true with a lower entryQuality/confidence — the allocator will down-weight it without a round trip.`
  : '' }
const polNote = (t)=>{ const c=POLC[t]; return c
  ? `\nCONGRESSIONAL DISCLOSURE (weak, heavily lagged context — NOT a recommendation, do not treat as informed trading): ${c.filers} members ${c.side==='buy'?'bought':'sold'} this, last transaction ${c.lastTxn} (~${c.staleDays}d ago${c.medianLagDays!=null?`, disclosed ~${c.medianLagDays}d after the trade`:''}). Median disclosure lag makes this public information by the time we see it. Weigh accordingly — if your verdict rests on this, your verdict is wrong.`
  : '' }
const verdicts = await parallel(finalists.map((r,i)=>()=>
  agent(`Adversarially STRESS-TEST the buy case for ${r.t} (${r.sec}, ~$${r.px}). Screen rank #${i+1}; sleeves momentum=${r.m} quality=${r.q} growth=${r.g} catalyst=${r.c} valuation=${r.v}${(FLOW_WEIGHT>0&&r.f!=null)?` flow=${r.f}`:''}. Notes: ${JSON.stringify(r.notes)}.${polNote(r.t)}${heldNote(r.t)}\nREFUTE, don't confirm. Pull live data via ToolSearch. Default skeptical.\nSCORE TWO SEPARATE THINGS — do not let one contaminate the other:\n  1. businessOk — is this a business worth owning at SOME price? Value trap? deteriorating fundamentals/margins? secular decline? legal/regulatory impairment? accounting or earnings-quality problem? false ⇒ we don't want it at any price.\n  2. entryQuality 0-10 — how good is TODAY'S price specifically? Extended vs its moving averages, RSI, distance to 52wk high, multiple vs history, imminent binary catalyst, reward:risk to the consensus target. 10 = a gift, 5 = fair, 0 = badly chased. Put the price-specific objection in entryRisk, NOT in biggestRisk.\nThis split matters: 'great company, wrong price' must come back businessOk=true with a LOW entryQuality, never businessOk=false — the allocator sizes down on a poor entry, it does not need you to veto the name. Reserve businessOk=false for a thesis that is actually broken.\nsupports = businessOk && entryQuality >= 4 (kept for back-compat; the allocator reads the two fields).`,
    {schema:VERDICT_SCHEMA, phase:'Verify', label:'verify:'+r.t, effort:'high'}).then(v=> v?{...r,verdict:v}:null)))
// INCLUSION is now the business test alone. A weak entry no longer removes a name — it shrinks it
// (entryHaircut below), so a market where everything is a bit extended produces a smaller, more
// defensive book rather than an empty one.
const ok = (x)=> x && x.verdict && x.verdict.businessOk !== false && x.verdict.recommendation !== 'avoid'
const survivors = verdicts.filter(Boolean).filter(ok)
const eq = (x)=> (typeof x.verdict.entryQuality === 'number' ? x.verdict.entryQuality : (x.verdict.supports ? 6 : 3))
log(`Survivors ${survivors.length}/${finalists.length} (business test): `+survivors.map(s=>`${s.t}${eq(s)<4?` [thin entry ${eq(s)}/10]`:''}`).join(', '))
const forSynth=(survivors.length?survivors:verdicts.filter(Boolean).filter(x=>x.verdict&&x.verdict.recommendation!=='avoid'))
  .map(s=>({ticker:s.t,sector:s.sec,px:s.px,hi52:s.hi,lo52:s.lo,composite:s.composite,
    entryQuality:eq(s), entryHaircut:+(0.55+0.045*Math.min(10,Math.max(0,eq(s)))).toFixed(2),
    sleeves:{momentum:s.m,quality:s.q,growth:s.g,catalyst:s.c,valuation:s.v,...((FLOW_WEIGHT>0&&s.f!=null)?{flow:s.f}:{})},verdict:s.verdict}))

phase('Synthesize')
const incumbency = (Object.keys(HELD).length || PRIOR_TARGET)
  ? `\nTURNOVER IS A COST — THE CURRENT BOOK IS THE NULL HYPOTHESIS.${Object.keys(HELD).length?` The account currently holds: ${JSON.stringify(Object.entries(HELD).map(([t,h])=>h.w!=null?`${t} ${h.w}%`:t))}.`:''}${PRIOR_TARGET?` The prior target was: ${JSON.stringify(PRIOR_TARGET)}.`:''} Every held name you leave out of this allocation triggers a real short-term-taxable exit — and a deterministic churn governor will retain it one extra cycle anyway, while a name the account sold within 14 days cannot be rebought (its weight sits in an index placeholder). So a name dropped this week and re-added next week produces pure cost and zero position change. Displace an incumbent only when the replacement is MATERIALLY stronger (a broken thesis, or a decisively higher composite) — never for a marginal score difference; prefer adjusting an incumbent's WEIGHT to swapping it out. If you do drop a held name, the summary must say in one clause why its thesis is broken rather than merely less exciting.`
  : ''
const alloc = await agent(`Build the long-only target allocation for the agentic cash account ($${(args&&args.book)||1000} book, fractional OK) from these VERIFIED survivors.${incumbency} Each carries sleeve scores (0-10), composite, sector, price, 52wk range, adversarial verdict.\nRules: 7-9 names, SECTOR-DIVERSIFIED (max 2/sector); include SPY as ~15-20% index ballast (add it, not a survivor); conviction-weighted toward MULTI-sleeve strength; floor ~5%, cap 25%; weights sum ~100%.\nENTRY QUALITY SIZES, IT DOES NOT VETO. Each survivor carries entryQuality (0-10, how good TODAY'S price is) and a precomputed entryHaircut multiplier. Size on conviction, then scale by the haircut: a sound business at a poor entry belongs in the book at a REDUCED weight with its entryZone set where it IS worth owning — it does not belong in cash. Never drop a name for entry alone; that is what the haircut and the entry zone are for.\nENTRY ZONES MUST BE REACHABLE. Set entryZone around a price the stock can plausibly trade at soon (near spot, or a specific nearby support you name). A zone far below spot reads as 'never buy' to the executor and strands the cash — if you genuinely want to wait for a deep pullback, say so by cutting the WEIGHT, not by setting an unreachable zone.\nRISK-AWARE WEIGHTING (a deterministic post-process — finalize-target.mjs — RE-ENFORCES these caps after you, so aim to satisfy them yourself to avoid being overridden):\n  • CORRELATION-CLUSTER cap: the megacap-tech/AI complex — NVDA, AVGO, AAPL, MSFT, GOOGL, META, AMZN, ORCL, NFLX (they co-move; "sector-diversified" labels hide this) — must sum to ≤48% of the book combined. Also payments (V+MA) ≤20%, staples (PG/WMT/COST) ≤25%. SPY/index ballast is UNCAPPED (it's the diversifier).\n  • VOL-SCALED sizing: give WILDER names a SMALLER slot for the same conviction. A name whose 52wk range (hi−lo)/price is much wider than ~0.42 (e.g. LLY, NFLX) should carry a materially lower weight than a tight compounder at equal conviction. Don't put a full 25% into a high-vol single name.\nPer name: sector, weightPct, dollars, one-line thesis naming the driving sleeves, entryZone near live price, protective stop (~8-12% below or under 50-DMA), take-profit target, reward:risk. SPY = wide stop / "core hold". Sanity-check live quotes before sizing. Summary: 2-3 sentences on factor/sector balance + risk posture, explicitly noting the megacap-tech cluster total.\nSurvivors: ${JSON.stringify(forSynth)}`,
  {schema:ALLOC_SCHEMA, phase:'Synthesize', label:'synthesize', effort:'high'})

return { ranking: ranked.map(r=>({t:r.t,composite:r.composite,m:r.m,q:r.q,g:r.g,c:r.c,v:r.v,f:r.f})),
  flowWeight: FLOW_WEIGHT,
  finalists: finalists.map(f=>f.t),
  verdicts: verdicts.filter(Boolean).map(x=>({t:x.t,rec:x.verdict.recommendation,conf:x.verdict.confidence,
    supports:x.verdict.supports,businessOk:x.verdict.businessOk,entryQuality:x.verdict.entryQuality,
    risk:x.verdict.biggestRisk,entryRisk:x.verdict.entryRisk})),
  allocation: alloc }
