// Offline unit checks for agentic-pending.mjs — no network, no I/O. Run: node producer/agentic-pending.test.mjs
import { makeTicket, advanceTicket, nextAction, planHash, TICKET_STALE_DAYS, MIN_TURNOVER } from './agentic-pending.mjs';

let pass = 0, fail = 0;
const ok = (label, cond) => { if (cond) pass++; else { fail++; console.error(`✗ ${label}`); } };

const plan = {
  book: 5300, turnover: 2100, autoEligible: false,
  sells: [{ sym: 'GE', kind: 'exit', dollars: 414, shares: 1.1, price: 376, pl: -40, note: 'exit' },
          { sym: 'MSFT', kind: 'exit', dollars: 451, shares: 0.9, price: 496, pl: 101, note: 'exit' }],
  buys: [{ sym: 'AAPL', dollars: 9, shares: 0.03, price: 310 }],
  buysT1: [{ sym: 'UNH', dollars: 580, shares: 1.4, price: 408 }],
  taxSummary: { realizedGain: 101, realizedLoss: -40, net: 61, term: 'short' },
  deferred: [{ sym: 'NVDA', reason: 'wash-sale', until: '2026-09-03' }],
};

// ── makeTicket ──
const t = makeTicket(plan, { asOf: '2026-08-07' });
ok('ticket starts proposed', t.status === 'proposed');
ok('ticket id embeds the date', t.id.startsWith('2026-08-07-'));
ok('ticket copies the auto flag + turnover', t.autoEligible === false && t.turnover === 2100);
ok('legs are slimmed but complete', t.legs.sells.length === 2 && t.legs.buysNow.length === 1 && t.legs.buysT1.length === 1);
ok('tax summary rides along', t.taxSummary.net === 61);
ok('deferred names ride along', t.deferred[0].sym === 'NVDA' && t.deferred[0].until === '2026-09-03');

// ── blocked sells (2026-08-25) ──
// The 08-25 regression: the planner suppressed BOTH exits (min-hold, day 13) and the ticket kept only
// `deferred`, which is buy-side — so a deposit-funded, buys-only ticket carried no trace of the sells it
// had wanted to make. raw/agentic-plan.json is wiped every run, so if the ticket drops these they are
// gone for good and the Plan tab has nothing to render.
const blk = makeTicket({ ...plan,
  blockedSells: [
    { sym: 'JPM', kind: 'exit', blocked: 'min-hold', dollars: 1211.374, pl: 1.5, plPct: 0.1, until: '2026-08-26', heldDays: 13, note: 'bought 13d ago' },
    { sym: 'SPY', kind: 'trim', blocked: 'day-trade', dollars: 40, until: '2026-08-26', note: 'bought today' },
  ],
  warnings: ['1 sell(s) held by the 14d min-hold (JPM)'],
}, { asOf: '2026-08-25' });
ok('blocked sells are persisted onto the ticket', blk.blockedSells.length === 2);
ok('each block keeps guard, unlock date and what it would have been',
  blk.blockedSells[0].blocked === 'min-hold' && blk.blockedSells[0].until === '2026-08-26'
  && blk.blockedSells[0].kind === 'exit' && blk.blockedSells[0].heldDays === 13);
ok('block dollars are rounded like every other leg', blk.blockedSells[0].dollars === 1211.37);
ok('run warnings ride along', blk.warnings.length === 1 && /min-hold/.test(blk.warnings[0]));
ok('a plan with no blocks still yields empty arrays, never undefined',
  Array.isArray(t.blockedSells) && t.blockedSells.length === 0 && Array.isArray(t.warnings));
ok('warnings are capped so the committed ticket cannot bloat',
  makeTicket({ ...plan, warnings: Array.from({ length: 40 }, (_, i) => 'w' + i) }, { asOf: '2026-08-25' }).warnings.length === 12);
// A block is NOT a trade: it must not move the fingerprint, or an unchanged plan would re-propose
// every pass simply because a guard's day-count ticked over.
ok('blocked sells do not change the plan hash', planHash(plan) === planHash({ ...plan, blockedSells: blk.blockedSells }));

// ── planHash: stable, order-insensitive, sensitive to material change ──
ok('hash is deterministic', planHash(plan) === planHash({ ...plan }));
ok('hash ignores sell order', planHash(plan) === planHash({ ...plan, sells: [...plan.sells].reverse() }));
ok('hash changes when a trade changes', planHash(plan) !== planHash({ ...plan, buysT1: [{ sym: 'UNH', dollars: 800 }] }));

// ── nextAction across the lifecycle ──
ok('above-cap proposal awaits confirm', nextAction(t, '2026-08-07').action === 'await-confirm');
const auto = makeTicket({ ...plan, turnover: 300, autoEligible: true }, { asOf: '2026-08-07' });
ok('auto-tier proposal places without confirm', nextAction(auto, '2026-08-07').action === 'place-trades');
ok('stale proposal re-plans', nextAction(t, '2026-08-20').action === 'stale');

const confirmed = advanceTicket(t, 'confirmed', { date: '2026-08-07' });
ok('confirmed → place-trades', nextAction(confirmed, '2026-08-07').action === 'place-trades');
const placed = advanceTicket(confirmed, 'sells-placed', { date: '2026-08-07' });
// v98 (limited margin): the carried leg is placeable as soon as the sells fill — the old day-gate that
// held it until the next session is gone. A ticket in flight at the upgrade must still reach `done`.
ok('same-day after sells → place the carried buys', nextAction(placed, '2026-08-07').action === 'place-buys');
ok('a later session still places them', nextAction(placed, '2026-08-08').action === 'place-buys');
const bought = advanceTicket(placed, 'buys-placed', { date: '2026-08-08' });
ok('buys-placed → none (finalize to done)', nextAction(bought, '2026-08-08').action === 'none');
const done = advanceTicket(bought, 'done', { date: '2026-08-08' });
ok('done is terminal', nextAction(done, '2026-08-09').action === 'none');

// no carried leg (every new v98 plan): confirmed may jump straight to buys-placed
const noT1 = advanceTicket(makeTicket({ ...plan, buysT1: [] }, { asOf: '2026-08-07' }), 'confirmed', { date: '2026-08-07' });
ok('no-sell/no-T1 ticket can jump to buys-placed', advanceTicket(noT1, 'buys-placed', { date: '2026-08-07' }).status === 'buys-placed');
const placedNoT1 = advanceTicket(noT1, 'sells-placed', { date: '2026-08-07' });
ok('sells-placed with no carried leg → none', nextAction(placedNoT1, '2026-08-08').action === 'none');

// ── illegal transitions throw (the executor can't corrupt state) ──
let threw = false; try { advanceTicket(t, 'buys-placed'); } catch { threw = true; }
ok('proposed → buys-placed is illegal', threw);
threw = false; try { advanceTicket(done, 'confirmed'); } catch { threw = true; }
ok('done is immutable', threw);

// ── history trail ──
ok('every transition is recorded', done.history.map((h) => h.to).join('>') === 'proposed>confirmed>sells-placed>buys-placed>done');

ok('constants exported for the gate', TICKET_STALE_DAYS === 5 && MIN_TURNOVER === 25);

console.log(`\nagentic-pending.test: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
