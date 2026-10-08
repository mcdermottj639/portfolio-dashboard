import { readSnapshot } from './fetchgate.mjs';
import { shiftDay } from './maindecisions.mjs';
import { etDate } from './market.mjs';

export function mainOrderPlan(prior, now = new Date()) {
  const today = etDate(now);
  const last = prior?.main?.orderHistoryRefresh;
  const lastGood = last?.lastIncrementalAt || (last?.status === 'fetched' ? last.attemptedAt : null);
  const overlap = lastGood && Number.isFinite(Date.parse(lastGood)) ? shiftDay(etDate(new Date(lastGood)), -2) : shiftDay(today, -14);
  return { mode: 'incremental', createdAtGte: overlap < shiftDay(today, -14) ? overlap : shiftDay(today, -14) };
}
if (import.meta.url === `file://${process.argv[1]}`) {
  const plan = mainOrderPlan(await readSnapshot());
  console.log(JSON.stringify({ ...plan, output: 'producer/raw/main-orders-incremental.json' }, null, 2));
}
