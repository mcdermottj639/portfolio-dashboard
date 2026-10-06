// Strict adapter for a future authenticated Robinhood Predict feed. Never infer positions or
// verified P&L from blank-symbol legacy derivatives. Input stays inside encrypted data.json.
const n=v=>!['number','string'].includes(typeof v)||String(v).trim()===''?null:Number.isFinite(Number(v))?Number(v):null;
const nonnegative=v=>n(v)!==null&&n(v)>=0;
const unit=v=>n(v)!==null&&n(v)>=0&&n(v)<=1;
const date=v=>typeof v==='string'&&Number.isFinite(Date.parse(v))?v:null;
export function normalizePredictionAccount(raw){
  if(raw?.source!=='robinhood'||!date(raw.asOf)||raw.schemaVersion!==1)return null;
  const issues=[],positions=[],transactions=[],seen=new Map();
  for(const p of Array.isArray(raw.positions)?raw.positions:[]){
    if(p.assetClass!=='event_contract'||!p.contractId||!p.name||!['yes','no'].includes(p.side)||!nonnegative(p.quantity)){
      issues.push('A position lacked an explicit event-contract identity.');continue;
    }
    if(p.averagePrice!=null&&!unit(p.averagePrice)||['marketValue','costBasis','feesPaid'].some(k=>p[k]!=null&&!nonnegative(p[k]))){issues.push('Invalid position values.');continue;}
    const key=p.contractId+'|'+p.side;if(seen.has(key)){issues.push('Duplicate position identity.');continue;}seen.set(key,true);
    positions.push({contractId:String(p.contractId),name:String(p.name),side:p.side,quantity:n(p.quantity),averagePrice:n(p.averagePrice),marketValue:n(p.marketValue),costBasis:n(p.costBasis),feesPaid:n(p.feesPaid)});
  }
  seen.clear();
  for(const t of Array.isArray(raw.transactions)?raw.transactions:[]){
    if(t.assetClass!=='event_contract'||!t.id||!t.contractId||!date(t.at)||!['buy','sell','settlement','void'].includes(t.type)){
      issues.push('A transaction lacked a broker ID or explicit event-contract identity.');continue;
    }
    if(!nonnegative(t.quantity)||t.price!=null&&!unit(t.price)||t.fees!=null&&!nonnegative(t.fees)){issues.push('Invalid transaction values.');continue;}
    const row={id:String(t.id),contractId:String(t.contractId),name:String(t.name||t.contractId),at:t.at,type:t.type,quantity:n(t.quantity),price:n(t.price),fees:n(t.fees),realizedNet:n(t.realizedNet)};
    if(seen.has(row.id)){
      if(JSON.stringify(seen.get(row.id))!==JSON.stringify(row))issues.push('Conflicting rows for one broker transaction ID.');
      continue;
    }
    seen.set(row.id,row);transactions.push(row);
  }
  const c=raw.coverage||{};
  const complete=issues.length===0&&c.transactions===true&&c.fees===true&&raw.historyComplete===true&&date(raw.historyStart)&&Array.isArray(raw.transactions);
  const closed=transactions.filter(t=>t.type!=='buy');
  const net=complete&&closed.every(t=>t.realizedNet!==null&&t.fees!==null)?closed.reduce((s,t)=>s+t.realizedNet,0):null;
  return {schemaVersion:1,source:'robinhood',asOf:raw.asOf,
    balance:c.balance===true?{value:n(raw.balance?.value),availableCash:n(raw.balance?.availableCash)}:null,
    positions,transactions,coverage:{balance:c.balance===true,positions:c.positions===true&&Array.isArray(raw.positions)&&!issues.length,transactions:!!complete&&net!==null},
    realizedNet:net===null?null:Math.round(net*100)/100,issues:[...new Set(issues)],historyStart:date(raw.historyStart)};
}
