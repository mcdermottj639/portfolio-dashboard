// Filled single-leg cash flows, matched by exact contract (never underlying chain).
// Keep source orders inside the encrypted snapshot so rolling fetches don't erase history.
// No expiry/assignment inference: disappearance is not evidence of a zero-cost close.
const number = v => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v)) ? Number(v) : null;
const cents = v => Math.round(v * 100) / 100;
export function optionHistory(orders = [], prior = null, asOf = new Date().toISOString()) {
  const saved = new Map((prior?.orders || []).map(o => [o.id, o]));
  for (const o of orders) {
    if (!o.id) continue;
    const legs = (o.legs || []).map(l => ({option_id:l.option_id, option_type:l.option_type,
      strike_price:l.strike_price, expiration_date:l.expiration_date, side:l.side,
      position_effect:l.position_effect}));
    saved.set(o.id, {id:o.id, state:o.state, symbol:o.chain_symbol, quantity:o.quantity,
      premium:o.processed_premium, direction:o.direction, opening:o.opening_strategy,
      closing:o.closing_strategy, date:o.last_transaction_at || o.updated_at || o.created_at, legs});
  }
  const source = [...saved.values()].sort((a,b) => String(a.date).localeCompare(String(b.date)) || a.id.localeCompare(b.id));
  const lots = new Map(), trades = [], unresolved = [], blocked = new Set();
  let premiumYTD = 0, openingCount = 0;
  for (const o of source) {
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
      arr.push({qty, unit, direction, date:o.date}); lots.set(key, arr);
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
  return {version:1, asOf, orders:source, trades:trades.reverse(), unresolved:unresolved.length,
    pendingResolution, premiumYTD:openingCount ? cents(premiumYTD) : null,
    coverage:'Recorded filled single-leg orders; before fees. Expirations, assignments, multi-leg and partial fills require broker reconciliation.'};
}
