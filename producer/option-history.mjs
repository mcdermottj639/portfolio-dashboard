// Filled single-leg cash flows, matched by exact contract (never underlying chain).
// Keep source orders inside the encrypted snapshot so rolling fetches don't erase history.
// No expiry/assignment inference: disappearance is not evidence of a zero-cost close.
const number = v => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v)) ? Number(v) : null;
const cents = v => Math.round(v * 100) / 100;
// Broker P&L rows (get_pnl_trade_history) report an option expiring worthless as a closed trade with a
// ticker, NO side and price 0 at the expiration-day close. That row is the only settlement evidence the
// Robinhood connector exposes, so it is accepted ONLY when it reconciles exactly: one contract of that
// underlying expiring that ET day, open quantity equal to the row's, realized gain equal to the retained
// opening cash to the cent, and no same-day equity trade at the strike (assignment/exercise evidence).
// A matched row is stored as a normal confirmed zero-cash expiration event, so it survives after the
// rolling trade-history window stops returning it.
const etDay = ts => { const d = new Date(ts); return Number.isFinite(d.getTime())
  ? new Intl.DateTimeFormat('en-CA', {timeZone:'America/New_York'}).format(d) : null; };
export function pnlExpiryCandidates(trades = []) {
  return (Array.isArray(trades) ? trades : []).filter(t => t && t.symbol && !t.side && number(t.price) === 0 &&
      number(t.quantity) > 0 && number(t.realized_gain) !== null && etDay(t.timestamp))
    .map(t => ({id:`pnl:${t.symbol}:${etDay(t.timestamp)}:${number(t.quantity)}:${number(t.realized_gain).toFixed(2)}`,
      pnl:true, symbol:t.symbol, quantity:number(t.quantity), date:t.timestamp, day:etDay(t.timestamp),
      realized_gain:number(t.realized_gain)}));
}
export function optionHistory(orders = [], prior = null, asOf = new Date().toISOString(), events = [], opts = {}) {
  const saved = new Map((prior?.orders || []).map(o => [o.id, o]));
  for (const o of orders) {
    if (!o.id) continue;
    const legs = (o.legs || []).map(l => ({option_id:l.option_id, option_type:l.option_type,
      strike_price:l.strike_price, expiration_date:l.expiration_date, side:l.side,
      position_effect:l.position_effect}));
    saved.set(o.id, {id:o.id, state:o.state, symbol:o.chain_symbol, quantity:o.quantity,
      premium:o.processed_premium, direction:o.direction, created:o.created_at || saved.get(o.id)?.created, opening:o.opening_strategy,
      closing:o.closing_strategy, date:o.last_transaction_at || o.updated_at || o.created_at, legs});
  }
  const settlements = new Map((prior?.events || []).map(e => [e.id, e]));
  for (const e of events) if (e?.id) settlements.set(e.id, {
    id:e.id, option_id:e.option_id || e.option?.replace(/\/$/, '').split('/').pop(),
    type:e.type, state:e.state, quantity:e.quantity, date:e.event_date || e.date,
    total_cash_amount:e.total_cash_amount, equity_components:e.equity_components,
  });
  const equitySells = (Array.isArray(opts.pnlTrades) ? opts.pnlTrades : []).filter(t => t?.symbol && t.side)
    .map(t => ({symbol:t.symbol, day:etDay(t.timestamp), price:number(t.price)}));
  const pnlRows = pnlExpiryCandidates(opts.pnlTrades).filter(r => !settlements.has(r.id));
  const source = [...saved.values()].sort((a,b) => String(a.date).localeCompare(String(b.date)) || a.id.localeCompare(b.id));
  const lots = new Map(), trades = [], unresolved = [], blocked = new Set();
  let premiumYTD = 0, openingCount = 0;
  const timeline = [...source, ...[...settlements.values()].map(e => ({...e, settlement:true})), ...pnlRows.map(r => ({...r, settlement:true}))]
    .sort((a,b) => String(a.date).slice(0,10).localeCompare(String(b.date).slice(0,10)) ||
      Number(!!a.settlement)-Number(!!b.settlement) || String(a.date).localeCompare(String(b.date)) || a.id.localeCompare(b.id));
  for (const o of timeline) {
    if (o.pnl) {
      const open = [...lots.entries()].filter(([k]) => !blocked.has(k))
        .map(([k, arr]) => ({k, live:arr.filter(l => l.qty > 0 && l.symbol === o.symbol && l.leg?.expiration_date === o.day)}))
        .filter(x => x.live.length);
      if (!open.length) continue;              // not an option of ours (or basis not retained) — no evidence either way
      const fits = open.filter(x => {
        const first = x.live[0], same = x.live.filter(l => l.direction === first.direction);
        const qty = same.reduce((s, l) => s + l.qty, 0), cash = same.reduce((s, l) => s + l.qty * l.unit * l.direction, 0);
        const strike = number(first.leg.strike_price);
        const assigned = equitySells.some(e => e.symbol === o.symbol && e.day === o.day && strike !== null && e.price !== null && Math.abs(e.price - strike) < 0.01);
        return same.length === x.live.length && qty === o.quantity && cents(cash) === cents(o.realized_gain) && !assigned;
      });
      if (fits.length !== 1) { unresolved.push(o.id); continue; }
      const ev = {id:o.id, option_id:fits[0].k, type:'expiration', state:'confirmed', quantity:o.quantity, date:o.date,
        total_cash_amount:0, equity_components:[], source:'robinhood_pnl_trade_history', realized_gain:o.realized_gain};
      settlements.set(ev.id, ev);
      Object.assign(o, ev);
    }
    if (o.settlement) {
      // Only an explicit completed, zero-cash expiration proves a worthless close.
      // Assignment/exercise cash is the stock transaction, never option profit.
      const qty=number(o.quantity), key=o.option_id;
      if (!key || !(qty>0) || !Number.isFinite(Date.parse(o.date)) || o.date.slice(0,10)>asOf.slice(0,10) ||
          !['confirmed','completed','settled','processed'].includes(o.state)) { unresolved.push('event:'+o.id); continue; }
      if (!['expiration','expired','assignment','exercise'].includes(o.type)) { unresolved.push('event:'+o.id); blocked.add(key); continue; }
      const arr=lots.get(key)||[], first=arr.find(l=>l.qty>0);
      const expired=['expiration','expired'].includes(o.type);
      const safe=expired && number(o.total_cash_amount)===0 && Array.isArray(o.equity_components) && !o.equity_components.length && !blocked.has(key);
      let remaining=qty, opening=0;
      for (const lot of arr) {
        if (!lot.qty || (first && lot.direction!==first.direction)) continue;
        const take=Math.min(remaining,lot.qty); opening+=take*lot.unit*lot.direction;
        lot.qty-=take; remaining-=take; if (!remaining) break;
      }
      const complete=safe && !remaining;
      trades.push({id:'event:'+o.id, symbol:first?.symbol, type:first?.leg.option_type,
        strike:number(first?.leg.strike_price), expiration:first?.leg.expiration_date,
        quantity:qty, opened:first?.date.slice(0,10)||null, date:o.date.slice(0,10),
        opening:remaining?null:cents(opening), closing:complete?0:null, net:complete?cents(opening):null,
        status:complete?'Expired':expired?'Expiration needs reconciliation':`${o.type || 'Settlement'} · broker reconciliation required`});
      if (!complete) unresolved.push('event:'+o.id);
      continue;
    }
    if (o.state !== 'filled') {
      if (o.state === 'partially_filled' || number(o.premium) > 0) { unresolved.push(o.id); for (const l of o.legs || []) blocked.add(l.option_id); }
      continue;
    }
    const l = o.legs?.[0], qty = number(o.quantity), cash = number(o.premium);
    const effect = l?.position_effect || (o.opening && !o.closing ? 'open' : o.closing && !o.opening ? 'close' : null);
    if (o.legs?.length !== 1 || !l?.option_id || !['buy','sell'].includes(l.side) ||
        !['open','close'].includes(effect) || !(qty > 0) || cash === null || cash < 0 || !Number.isFinite(Date.parse(o.date))) {
      unresolved.push(o.id); for (const l of o.legs || []) blocked.add(l.option_id); continue;
    }
    const unit = cash / qty, direction = l.side === 'sell' ? 1 : -1;
    const key = l.option_id;
    if (effect === 'open') {
      const arr = lots.get(key) || [];
      arr.push({qty, unit, direction, date:o.date, symbol:o.symbol, leg:l, id:o.id}); lots.set(key, arr);
      if (direction === 1 && o.date.slice(0,4) === asOf.slice(0,4)) { premiumYTD += cash; openingCount++; }
      continue;
    }
    const arr = blocked.has(key) ? [] : (lots.get(key) || []);
    let remaining = qty, opening = 0, matched = 0, opened = null;
    for (const lot of arr) {
      if (!lot.qty || lot.direction === direction) continue;
      const take = Math.min(remaining, lot.qty);
      opening += take * lot.unit * lot.direction; matched += take;
      opened ||= lot.date; lot.qty -= take; remaining -= take;
      if (!remaining) break;
    }
    trades.push({id:o.id, symbol:o.symbol, type:l.option_type, strike:number(l.strike_price), expiration:l.expiration_date,
      quantity:qty, opened:opened?.slice(0,10) || null, date:o.date.slice(0,10),
      opening:remaining ? null : cents(opening), closing:cents(cash * direction),
      net:remaining ? null : cents(opening + cash * direction), status:remaining ? 'Missing opening fills' : 'Closed', matched});
  }
  const pendingResolution = [...lots.values()].flat().filter(l => l.qty > 0).length;
  // Show the historical contracts we DO have even if their settlement feed is missing.
  const awaitingSettlement=[...lots.values()].flat().filter(l=>l.qty>0 && l.leg?.expiration_date && l.leg.expiration_date<asOf.slice(0,10))
    .map(l=>({id:'pending:'+l.id,symbol:l.symbol,type:l.leg.option_type,strike:number(l.leg.strike_price),
      expiration:l.leg.expiration_date,quantity:l.qty,opened:l.date.slice(0,10),date:l.leg.expiration_date,
      opening:cents(l.qty*l.unit*l.direction),closing:null,net:null,status:'Settlement record missing'}));
  const fullHistoryAt = opts.fullHistory ? asOf : prior?.fullHistoryAt || null;
  return {version:2, asOf, fullHistoryAt, orders:source, events:[...settlements.values()], awaitingSettlement,
    trades:trades.sort((a,b)=>b.date.localeCompare(a.date)), unresolved:unresolved.length,
    pendingResolution, premiumYTD:openingCount ? cents(premiumYTD) : null,
    coverage:'Exact-contract filled orders and confirmed zero-cash expirations (broker events, or reconciled broker P&L expiry rows); before fees. Assignments/exercises, missing settlements, multi-leg and partial fills require broker reconciliation.'};
}
