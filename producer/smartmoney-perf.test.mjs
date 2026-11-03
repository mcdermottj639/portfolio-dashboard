// Offline unit checks for smartmoney-perf.mjs — no network. Run: node producer/smartmoney-perf.test.mjs
import { trackedEvents, symbolsToQuote, updatePerf, tradeResult, scoreboard, MIN_SCORED } from './smartmoney-perf.mjs';

let pass = 0, fail = 0;
const eq = (label, got, want) => { const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) pass++; else { fail++; console.error(`✗ ${label}\n    got  ${g}\n    want ${w}`); } };
const ok = (label, c) => { if (c) pass++; else { fail++; console.error(`✗ ${label}`); } };

const flow = {
  polEvents: [
    { sym: 'PLTR', side: 'buy', txn: '2026-10-09', disc: '2026-10-30', filer: 'JANE MEMBER', chamber: 'house' },
    { sym: 'XOM', side: 'sell', txn: '2026-10-01', disc: '2026-10-28', filer: 'JANE MEMBER', chamber: 'house' },
    { sym: '', side: 'buy', txn: '2026-10-01', filer: 'NOBODY' },
    { sym: 'AAPL', side: 'exchange', txn: '2026-10-01', filer: 'NOBODY' },
  ],
  symbols: { NVDA: { sym: 'NVDA', insiderTrades: [{ name: 'Sam Exec', side: 'buy', price: 100, txn: '2026-10-20', filed: '2026-10-22' }] } },
};

// ---- events + symbols ------------------------------------------------------
const ev = trackedEvents(flow);
eq('tracked events: unusable rows dropped, ids match the UI model', ev.map((e) => e.id),
  ['pol|JANE MEMBER|PLTR|buy|2026-10-09', 'pol|JANE MEMBER|XOM|sell|2026-10-01', 'ins|NVDA|SAM EXEC|buy|2026-10-20']);
eq('insider row keeps its trade price and person key', [ev[2].tradePx, ev[2].who], [100, 'ins|SAM EXEC|NVDA']);
const syms = symbolsToQuote({ flow, priorPerf: { trades: [{ sym: 'OLD', seen: '2026-09-01' }] } });
eq('SPY first, then tracked names, prior ledger names included', syms[0], 'SPY');
ok('every tracked name is quoted', ['PLTR', 'XOM', 'NVDA', 'OLD'].every((s) => syms.includes(s)));
eq('cap respected', symbolsToQuote({ flow, cap: 2 }).length, 2);
ok('junk symbols never quoted', !symbolsToQuote({ flow: { polEvents: [{ sym: 'bad sym!', side: 'buy', txn: '2026-10-01', filer: 'X' }] } }).includes('BAD SYM!'));

// ---- day 1: entries set only when stock AND SPY quoted ---------------------
let perf = updatePerf(null, flow, { SPY: 500, PLTR: 160, NVDA: 120 }, { asOf: '2026-11-03' });
const by = (p, id) => p.trades.find((t) => t.id === id);
eq('new trade seen today, entry from today\'s quote', [by(perf, 'pol|JANE MEMBER|PLTR|buy|2026-10-09').seen, by(perf, 'pol|JANE MEMBER|PLTR|buy|2026-10-09').entry], ['2026-11-03', 160]);
eq('no quote → no entry yet, no invented price', by(perf, 'pol|JANE MEMBER|XOM|sell|2026-10-01').entry, null);
const noSpy = updatePerf(null, flow, { PLTR: 160 }, { asOf: '2026-11-03' });
eq('without SPY no entry is set (excess would compare two windows)', by(noSpy, 'pol|JANE MEMBER|PLTR|buy|2026-10-09').entry, null);

// ---- day 15: marks move, first-seen day and entry stay ---------------------
perf = updatePerf(perf, flow, { SPY: 510, PLTR: 176, NVDA: 114, XOM: 100 }, { asOf: '2026-11-18' });
const p = by(perf, 'pol|JANE MEMBER|PLTR|buy|2026-10-09');
eq('entry and seen day are sticky', [p.entry, p.seen, p.entryDay, p.last, p.lastDay], [160, '2026-11-03', '2026-11-03', 176, '2026-11-18']);
const r = tradeResult(p);
eq('buy: stock +10%, SPY +2%, excess +8%', [r.ret, r.spy, r.excess, r.heldDays], [0.1, 0.02, 0.08, 15]);
const x = by(perf, 'pol|JANE MEMBER|XOM|sell|2026-10-01');
eq('late quote: entry starts the first day both prices exist', [x.entry, x.entryDay], [100, '2026-11-18']);
const n = tradeResult(by(perf, 'ins|NVDA|SAM EXEC|buy|2026-10-20'));
eq('insider: since report -5% vs SPY +2% → -7%; since trade price +14%', [n.excess, n.sinceTrade], [-0.07, 0.14]);
const sellT = tradeResult({ side: 'sell', entry: 100, last: 90, spyEntry: 500, spyLast: 510, entryDay: '2026-11-01', lastDay: '2026-11-11', tradePx: 120 });
eq('sell scores the other way: stock -10% vs SPY +2% → +12%; since trade +25%', [sellT.excess, sellT.sinceTrade], [0.12, 0.25]);
eq('unmarked trade → nulls', tradeResult({ side: 'buy' }).excess, null);

// ---- retention + idempotence -------------------------------------------------
const aged = updatePerf(perf, { polEvents: [] }, { SPY: 500 }, { asOf: '2027-12-31' });
eq('trades age out after the retention window', aged.trades.length, 0);
const again = updatePerf(perf, flow, { SPY: 510, PLTR: 176 }, { asOf: '2026-11-18' });
eq('re-running a day adds nothing', again.trades.length, perf.trades.length);

// ---- scoreboard ---------------------------------------------------------------
const mk = (who, k, ex) => ({ id: who + k, who, kind: 'politician', sym: 'S' + k, side: 'buy', txn: '2026-10-01',
  entry: 100, last: 100 * (1 + ex), spyEntry: 100, spyLast: 100, entryDay: '2026-11-01', lastDay: '2026-11-20' });
const good = [0.05, 0.1, -0.02, 0.08, 0.03].map((e, k) => mk('pol|GOOD', k, e));
const bad = [-0.05, -0.1, 0.01, -0.08, -0.03].map((e, k) => mk('pol|BAD', k, e));
const few = [0.5].map((e, k) => mk('pol|FEW', k, e));
const young = { ...mk('pol|YOUNG', 0, 0.3), entryDay: '2026-11-18' };
const board = scoreboard({ trades: [...bad, ...few, ...good, young] });
eq('ranked: enough-sample people by average excess, small samples after', board.map((b) => b.who), ['pol|GOOD', 'pol|BAD', 'pol|FEW', 'pol|YOUNG']);
eq('good: 4 of 5 beat SPY, avg +4.8%, median +5%', [board[0].hitRate, board[0].avgExcess, board[0].medianExcess, board[0].enough], [0.8, 0.048, 0.05, true]);
eq('best/worst trade recorded', [board[0].best.excess, board[0].worst.excess], [0.1, -0.02]);
eq(`fewer than ${MIN_SCORED} scored → not enough, even with a huge return`, board[2].enough, false);
eq('a mark under the minimum age is tracked but not scored', [board[3].tracked, board[3].scored, board[3].avgExcess], [1, 0, null]);
eq('empty → empty board', scoreboard(null), []);

console.log(`\nsmartmoney-perf.test: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
