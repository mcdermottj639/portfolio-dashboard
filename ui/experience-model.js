/* Read-only display models. No broker, producer, or execution dependencies. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PFExperienceModel = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  function number(value) {
    if (!['number','string'].includes(typeof value) || (typeof value === 'string' && !value.trim())) return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  function snapshot(data, main, account) {
    const agentic = account === 'agentic';
    const source = agentic ? data?.agentic : main?.stats;
    const raw = agentic ? data?.agentic?.positions : main?.enriched;
    const positions = (Array.isArray(raw) ? raw : []).filter(p => p && p.symbol).map(p => {
      const qty = number(p.qty ?? p.quantity), px = number(p.px);
      const reported = number(agentic ? p.value : p.val);
      const value = reported !== null && reported > 0 ? reported : qty > 0 && px > 0 ? qty * px : null;
      const q = data?.quotes?.[p.symbol];
      const previous = number(q?.adjusted_previous_close ?? q?.previous_close);
      const day = agentic
        ? (qty > 0 && px > 0 && previous > 0 ? qty * (px - previous) : null)
        : (number(p.dayP) !== null ? number(p.dayD) : null);
      return { symbol: String(p.symbol), qty, px, value, day };
    }).filter(p => p.qty > 0).sort((a, b) => (b.value ?? -1) - (a.value ?? -1));
    const priced = positions.filter(p => p.value !== null);
    const daily = positions.filter(p => p.day !== null);
    const equity = number(agentic ? source?.equity : source?.totalVal);
    const cash = number(agentic ? source?.cash : source?.cashVal);
    // Missing quotes are unknown, never a zero-move holding.
    const day = daily.length ? daily.reduce((s, p) => s + p.day, 0) : null;
    return {
      account, available: !!source, equity, cash, positions, pricedCount: priced.length,
      day, dayCoverage: daily.length, partialDay: daily.length !== positions.length,
      dayPct: day !== null && equity !== null && equity - day > 0 ? day / (equity - day) * 100 : null,
      generatedAt: data?.generatedAt || null,
      accountAsOf: agentic ? data?.agentic?.asOf || null : null,
      target: agentic ? data?.agentic?.target || null : null,
      pending: agentic ? data?.agentic?.pending || null : null,
      contributors: [...daily].sort((a, b) => Math.abs(b.day) - Math.abs(a.day)).slice(0, 5)
    };
  }
  function age(iso, now = Date.now()) {
    if (!iso) return null;
    const stamp = Date.parse(iso);
    if (!Number.isFinite(stamp) || stamp > now + 60000) return null;
    return Math.max(0, (now - stamp) / 60000);
  }
  // Value history is deliberately NOT a return series: external flows remain included.
  function valueHistory(data, account) {
    const raw = data?.[account === 'agentic' ? 'agentic' : 'main']?.equityHistory;
    const points = new Map();
    for (const p of Array.isArray(raw) ? raw : []) {
      const stamp = typeof p?.t === 'string' ? Date.parse(p.t) : NaN;
      const equity = number(p?.equity);
      if (Number.isFinite(stamp) && equity !== null) points.set(stamp, {t:p.t, stamp, equity});
    }
    return [...points.values()].sort((a,b)=>a.stamp-b.stamp).slice(-30);
  }
  function composition(positions) {
    const priced = positions.filter(p => number(p.value) !== null && p.value > 0).sort((a,b)=>b.value-a.value);
    const total = priced.reduce((sum,p)=>sum+p.value,0);
    const groups = priced.slice(0,3).map(p=>({label:p.symbol,value:p.value}));
    const other = priced.slice(3).reduce((sum,p)=>sum+p.value,0);
    if (other > 0) groups.push({label:'Other',value:other});
    return groups.map(p=>({...p,share:p.value/total*100}));
  }
  function breadth(positions) {
    const counts = {up:0,down:0,flat:0,missing:0};
    for (const p of positions) {
      const day=number(p.day);
      counts[day===null?'missing':day>0?'up':day<0?'down':'flat']++;
    }
    return counts;
  }
  const list = value => Array.isArray(value) ? value : [];
  const sumKnown = values => values.length && values.every(v => v !== null) ? values.reduce((a,b)=>a+b,0) : null;
  function calendarDay(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const stamp = Date.parse(value+'T00:00:00Z');
    return Number.isFinite(stamp) && new Date(stamp).toISOString().slice(0,10) === value ? value : null;
  }
  function easternDay(now = Date.now()) {
    const parts = new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(now));
    const part = type => parts.find(p=>p.type===type).value;
    return part('year')+'-'+part('month')+'-'+part('day');
  }
  // Join only identical recorded dates. Never carry one account forward to invent a total.
  function combinedHistory(data) {
    const byDay = account => {
      const map = new Map();
      for (const p of list(data?.[account]?.equityHistory)) {
        const t = calendarDay(p?.t), equity = number(p?.equity);
        if (t && equity !== null) map.set(t,equity);
      }
      return map;
    };
    const main = byDay('main'), agentic = byDay('agentic');
    return [...main].filter(([t])=>agentic.has(t)).sort(([a],[b])=>a.localeCompare(b)).slice(-30)
      .map(([t,equity])=>({t,stamp:Date.parse(t+'T00:00:00Z'),equity:equity+agentic.get(t)}));
  }
  function briefAccount(data, main, account) {
    const recorded = data?.[account];
    // The canonical self-directed history excludes external derivatives sleeves.
    // Use its brokerage equity for a consistent headline/history perimeter.
    const fallback = account === 'main' && !main?.stats && recorded ? {
      stats:{totalVal:recorded.equity,cashVal:recorded.cash},
      enriched:list(recorded.positions).map(p=>{
        const qty=number(p.qty), px=number(p.px), q=data?.quotes?.[p.symbol];
        const prev=number(q?.adjusted_previous_close ?? q?.previous_close);
        return {...p,val:p.value,dayP:prev>0&&px>0?(px-prev)/prev*100:null,dayD:qty>0&&px>0&&prev>0?qty*(px-prev):null};
      })
    } : main;
    const s = snapshot(data,fallback,account);
    if(account === 'main') {
      if(recorded && Object.hasOwn(recorded,'equity'))s.equity=number(recorded.equity);
      if(recorded && Object.hasOwn(recorded,'cash'))s.cash=number(recorded.cash);
    }
    s.accountAsOf=recorded?.asOf || null;
    s.positionsKnown=account==='main'?Array.isArray(fallback?.enriched):Array.isArray(recorded?.positions);
    s.label=account==='main'?'Self-directed':'Agentic';
    return s;
  }
  function dailyBrief(data, main, {now=Date.now(), calendar={}}={}) {
    const accounts=['main','agentic'].map(a=>briefAccount(data,main,a));
    const positionsBySymbol=new Map();
    for(const account of accounts) for(const p of account.positions) {
      const symbol=p.symbol.toUpperCase();
      if(!positionsBySymbol.has(symbol))positionsBySymbol.set(symbol,{symbol,sources:[]});
      positionsBySymbol.get(symbol).sources.push({...p,account:account.account,label:account.label});
    }
    const positions=[...positionsBySymbol.values()].map(p=>{
      const daily=p.sources.filter(s=>s.day!==null);
      return {...p,value:sumKnown(p.sources.map(s=>s.value)),day:daily.length?daily.reduce((n,s)=>n+s.day,0):null,
        partialDay:daily.length!==p.sources.length,shared:new Set(p.sources.map(s=>s.account)).size>1};
    }).sort((a,b)=>(b.value??-1)-(a.value??-1));
    const equity=sumKnown(accounts.map(a=>a.equity));
    const cashKnown=accounts.every(a=>a.available&&a.cash!==null);
    const dayCoverage=accounts.reduce((n,a)=>n+a.dayCoverage,0), positionCount=accounts.reduce((n,a)=>n+a.positions.length,0);
    const day=dayCoverage?accounts.reduce((n,a)=>n+(a.day??0),0):null;
    const partialDay=!accounts.every(a=>a.available&&a.positionsKnown)||dayCoverage!==positionCount;
    const options=data?.options;
    const today=easternDay(now), daysUntil=t=>calendarDay(t)?Math.round((Date.parse(t)-Date.parse(today))/86400000):null;
    const open=list(options?.positions).filter(p=>p&&number(p.contracts)>0);
    const expirations=open.map(p=>({...p,days:daysUntil(p.expiration)})).filter(p=>p.days!==null).sort((a,b)=>a.days-b.days);
    const earnings=positions.flatMap(p=>{
      const e=data?.earnings?.[p.symbol] || calendar[p.symbol] || main?.earn?.[p.symbol];
      const t=e?.date || e?.reportDate, days=daysUntil(t);
      return days!==null&&days>=0&&days<=30?[{symbol:p.symbol,date:t,days,accounts:p.sources.map(s=>s.label),when:e.when||null}]:[];
    }).sort((a,b)=>a.days-b.days||a.symbol.localeCompare(b.symbol));
    const realized=data?.realized;
    const ledger=options?.incomeHistory;
    const year=String(realized?.year||'').slice(0,4);
    const rows=list(ledger?.trades).filter(t=>String(t?.date).slice(0,4)===year);
    const matched=sumKnown(rows.map(t=>number(t.net)));
    const broker=realized?.source==='robinhood'?number(realized?.accounts?.main?.options):null;
    const optionSummary={available:!!options,positionsKnown:Array.isArray(options?.positions),open,expirations,
      year:/^\d{4}$/.test(year)?year:null,broker,asOf:realized?.asOf||null,positionsAsOf:options?.asOf||null,
      reconciled:broker!==null&&matched!==null&&Math.abs(broker-matched)<.005&&ledger?.version===2&&!ledger?.unresolved&&!list(ledger?.awaitingSettlement).length,
      openPnl:sumKnown(open.map(p=>number(p.pnl))),
      sharesCapped:number(options?.exposure?.sharesCapped),cspCash:number(options?.exposure?.cspCash)};
    const markets=['SPY','QQQ','IWM'].map(symbol=>{
      const q=data?.quotes?.[symbol],px=number(q?.last_trade_price),prev=number(q?.adjusted_previous_close ?? q?.previous_close);
      return {symbol,change:px>0&&prev>0?(px-prev)/prev*100:null,asOf:q?.updated_at||null};
    });
    const target=data?.agentic?.target, pending=data?.agentic?.pending, drawdown=data?.agentic?.drawdown;
    const attention=[];
    const add=(title,detail,route,account,tone='neutral')=>attention.push({title,detail,route,account,tone});
    const snapshotAge=age(data?.generatedAt,now);
    if(snapshotAge===null||snapshotAge>=180)add('Check the snapshot date','This brief uses the last published data. Refresh loads the latest available snapshot.','activity',null,'warn');
    if(accounts.some(a=>!a.available||a.equity===null))add('Account totals are incomplete','Both account values are needed for combined equity.','activity',null,'warn');
    if(number(data?.main?.basisResidual)!==null&&Math.abs(number(data.main.basisResidual))>.01)add('Account equity needs a source check','The published self-directed account has an unexplained valuation difference.','activity','main','warn');
    const olderAccounts=accounts.filter(a=>age(a.accountAsOf,now)!==null&&snapshotAge!==null&&age(a.accountAsOf,now)>snapshotAge+180);
    if(olderAccounts.length)add('An account capture is older',olderAccounts.map(a=>a.label).join(' + ')+' is older than the published snapshot. Check its capture date before acting.','activity',null,'warn');
    if(partialDay)add('Some holdings lack day quotes',dayCoverage+' of '+positionCount+' account positions have a quoted move.','activity',null,'warn');
    const overdue=expirations.filter(p=>p.days<0),soon=expirations.filter(p=>p.days>=0&&p.days<=7);
    if(overdue.length)add('Option outcomes need a refresh',overdue.length+' dated position'+(overdue.length===1?' is':'s are')+' still marked open after expiration.','options','main','warn');
    if(soon.length)add('Options expire within 7 days',[...new Set(soon.map(p=>p.underlying))].join(', ')+' · review open contracts and collateral.','options','main','warn');
    if(earnings.some(e=>e.days<=7))add('Earnings in the week ahead',earnings.filter(e=>e.days<=7).map(e=>e.symbol).join(', ')+' · dates from the published calendar.','markets',null);
    if(drawdown&&!drawdown.insufficient&&['soft','hard'].includes(drawdown.level))add('Agentic deployment guard is active','Recorded '+drawdown.level+' drawdown state · review the agentic plan.','plan','agentic','warn');
    if(pending?.status&&!['done','aborted','cancelled'].includes(pending.status))add('Agentic ticket: '+String(pending.status).replace(/-/g,' '),'Recorded ticket status · not a live execution confirmation.','plan','agentic');
    if(broker!==null&&!optionSummary.reconciled)add('Options history needs reconciliation','The broker total is available; matched contract history does not fully explain it.','options','main');
    return {accounts,equity,available:accounts.some(a=>a.available),positions,pricedCount:positions.filter(p=>p.value!==null).length,
      positiveCash:cashKnown?accounts.reduce((n,a)=>n+Math.max(0,a.cash),0):null,
      marginDebt:cashKnown?accounts.reduce((n,a)=>n+Math.max(0,-a.cash),0):null,
      day,dayCoverage,positionCount,partialDay,history:combinedHistory(data),earnings,options:optionSummary,markets,
      target,pending,drawdown,attention,generatedAt:data?.generatedAt||null,today,brokerageBasis:data?.main?.equityBasis==='brokerage',
      vix:{value:number(data?.vix?.v),asOf:data?.vix?.asOf||null},
      contributors:positions.filter(p=>p.day!==null).sort((a,b)=>Math.abs(b.day)-Math.abs(a.day)).slice(0,6),
      breadth:breadth(positions.map(p=>({...p,day:p.partialDay?null:p.day})))};
  }
  function scenario({ equity, positionValue, shockPct, shiftPct, costBps }) {
    const values = [equity, positionValue, shockPct, shiftPct, costBps].map(number);
    if (values.some(n => n === null)) return null;
    [equity, positionValue, shockPct, shiftPct, costBps] = values;
    if (equity <= 0 || positionValue < 0 || shockPct < -100 || shockPct > 100 || shiftPct < 0 || shiftPct > 100 || costBps < 0 || costBps > 1000) return null;
    const shifted = positionValue * shiftPct / 100;
    const cost = shifted * costBps / 10000;
    const before = positionValue * shockPct / 100;
    const after = (positionValue - shifted) * shockPct / 100 - cost;
    return { before, after, difference: after - before, cost, shifted, beforePct: before / equity * 100, afterPct: after / equity * 100 };
  }
  function evidence(target, ticker) {
    const sleeves = target?.research?.evidence?.[ticker] || {};
    return Object.entries(sleeves).flatMap(([sleeve, row]) =>
      (Array.isArray(row?.evidence) ? row.evidence : []).filter(e => e && typeof e.claim === 'string').map(e => ({
        sleeve, claim: e.claim, asOf: e.asOf || null,
        source: typeof e.source === 'string' ? e.source : '',
        href: typeof e.source === 'string' && /^https:\/\//i.test(e.source) ? e.source : null
      })));
  }
  return { number, snapshot, age, valueHistory, composition, breadth, dailyBrief, combinedHistory, easternDay, scenario, evidence };
});
