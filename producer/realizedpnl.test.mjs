// Offline unit checks for realizedpnl.mjs — no network, no I/O. Run: node producer/realizedpnl.test.mjs
import { sumRealized, accountRealized, buildRealized, lossesFromTrades, unwrapPnl } from './realizedpnl.mjs';

let pass = 0, fail = 0;
const ok = (label, cond) => { if (cond) pass++; else { fail++; console.error(`✗ ${label}`); } };

// Shape mirrors a real get_realized_pnl response: weekly buckets, transfer-only buckets nulled out.
const pnl = (points, total) => ({ data: { account_number: '…0741', window: '2026-01-01..2026-08-11', data_points: points, total_returns: total } });
const bkt = (gain, n) => ({ start_time: '2026-01-07T05:00:00Z', end_time: '2026-01-14T04:59:59Z', realized_gain: gain, number_of_trades: n });

// ── sumRealized ───────────────────────────────────────────────────────────────────────────────────
const basic = sumRealized(pnl([bkt('20.64', 6), bkt('-16.54', 2), bkt(null, 0)], '4.10'));
ok('sums the endpoint total_returns', basic.total === 4.10);
ok('counts trades across priced buckets', basic.trades === 8);
ok('null (transfer-only) buckets are skipped, not zeroed', basic.buckets === 2);
ok('carries the window label', basic.window === '2026-01-01..2026-08-11');

// Without total_returns it must fall back to the bucket sum rather than reporting 0.
const noTotal = sumRealized({ data: { data_points: [bkt('100.50', 1), bkt('-0.50', 1)] } });
ok('falls back to the bucket sum when total_returns is absent', noTotal.total === 100);

// A window with no closing trades is a valid result, not an error.
const empty = sumRealized(pnl([bkt(null, 0)], '0'));
ok('an all-null window totals 0 with 0 trades', empty.total === 0 && empty.trades === 0);

// ── envelope tolerance ────────────────────────────────────────────────────────────────────────────
ok('unwraps {data:…}', unwrapPnl({ data: { data_points: [] } }).data_points.length === 0);
ok('unwraps a nested {result:"<json>"} write', Array.isArray(unwrapPnl({ result: JSON.stringify({ data: { trades: [] } }) }).trades));
ok('unwraps an already-bare payload', unwrapPnl({ trades: [{ symbol: 'X' }] }).trades.length === 1);
ok('a junk payload degrades to {} instead of throwing', JSON.stringify(unwrapPnl(null)) === '{}');

// ── accountRealized ───────────────────────────────────────────────────────────────────────────────
const main = accountRealized({
  equity: pnl([bkt('3963.72', 420)], '3963.72'),
  options: pnl([bkt('550', 2)], '550'),
  label: 'Individual margin', mask: '••••0741',
});
ok('splits equity vs options realized', main.equity === 3963.72 && main.options === 550);
ok('totals the asset classes', main.total === 4513.72);
ok('sums trade counts across asset classes', main.trades === 422);
ok('carries the account label + mask', main.label === 'Individual margin' && main.mask === '••••0741');

// An account with no options level supplies no options payload — that is null (unknown), not 0.
const cash = accountRealized({ equity: pnl([bkt('233.18', 5)], '233.18'), label: 'Agentic cash', mask: '••••3900' });
ok('a missing asset class stays null rather than 0', cash.options === null);
ok('total ignores the missing class', cash.total === 233.18);

// ── buildRealized ─────────────────────────────────────────────────────────────────────────────────
const built = buildRealized({ accounts: { main, agentic: cash }, year: '2026 YTD', asOf: '2026-08-11T13:00:00Z' });
ok('top-level equity is the ALL-ACCOUNT sum', built.equity === 4196.90);
ok('top-level options sums only the accounts that trade them', built.options === 550);
ok('top-level total covers both accounts', built.total === 4746.90);
ok('keeps the per-account split for the card', built.accounts.main.total === 4513.72 && built.accounts.agentic.total === 233.18);
ok('broker-sourced realized is NOT flagged approx', built.approx === false && built.source === 'robinhood');

// One account only (e.g. the agentic fetch failed) still produces a coherent block.
const solo = buildRealized({ accounts: { main }, year: '2026 YTD' });
ok('a single-account build totals just that account', solo.total === 4513.72 && Object.keys(solo.accounts).length === 1);

// ── lossesFromTrades (the wash-sale ledger) ───────────────────────────────────────────────────────
const hist = { data: { trades: [
  { timestamp: '2026-08-10T17:37:07Z', symbol: 'MSFT', side: 'sell', quantity: '0.9', price: '508.26', realized_gain: '112.07' },
  { timestamp: '2026-08-10T17:36:53Z', symbol: 'GE', side: 'sell', quantity: '1.1', price: '366.68', realized_gain: '-29.46' },
  { timestamp: '2026-08-10T17:30:00Z', symbol: 'GE', side: 'sell', quantity: '0.2', price: '366.10', realized_gain: '-4.10' },
  { timestamp: '2026-07-01T14:00:00Z', symbol: 'TSM', side: 'sell', quantity: '1', price: '402.72', realized_gain: '-41.22' },
] } };
const losses = lossesFromTrades(hist, { asOf: '2026-08-11T12:00:00Z', days: 31 });
ok('gains are excluded from the wash-sale ledger', !losses.some((l) => l.sym === 'MSFT'));
ok('losses inside the window are kept', losses.some((l) => l.sym === 'GE'));
ok('losses older than the window are dropped', !losses.some((l) => l.sym === 'TSM'));
ok('same symbol+day collapses to the largest loss', losses.filter((l) => l.sym === 'GE').length === 1 && losses.find((l) => l.sym === 'GE').realized === -29.46);
ok('carries the exit price for the card badge', losses[0].exitPx === 366.68);
ok('sorted most-recent-first', losses.every((l, i, a) => i === 0 || a[i - 1].date >= l.date));

// The whole point of this path: a REAL feed can only report trades that actually happened, so an
// account with no closing trades produces an EMPTY ledger — no phantom 30-day buy blocks.
ok('no closing trades → no wash-sale entries', lossesFromTrades({ data: { trades: [] } }, { asOf: '2026-08-11' }).length === 0);
ok('a missing payload degrades to an empty ledger', lossesFromTrades(null, { asOf: '2026-08-11' }).length === 0);

console.log(`\nrealizedpnl.test: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
