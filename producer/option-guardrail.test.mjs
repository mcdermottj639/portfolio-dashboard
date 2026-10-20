// Options Guardrail — unit tests. The first block is the REGRESSION this module exists for: the live
// 2026-10-12 PLTR roll, reconstructed from the broker's own fills, must grade RED under every gate.
//   node producer/option-guardrail.test.mjs
import assert from 'node:assert/strict';
import { guardrail, gradeRoll, detectRolls, settleRolls, rollStats, stockExtension, isExtended,
  EXTRINSIC_MIN_PCT } from './option-guardrail.mjs';

let n = 0; const t = (name, fn) => { fn(); n++; console.log(`  ✓ ${name}`); };

// ── Live fixture: PLTR closes Oct 6–12 2026 (Robinhood get_equity_historicals, day bars) ────────────
const PLTR_BARS = [
  ['2026-09-22', 184.99], ['2026-09-23', 191.79], ['2026-09-24', 192.59], ['2026-09-25', 189.67], ['2026-09-28', 187.48],
  ['2026-09-29', 186.97], ['2026-09-30', 187.05], ['2026-10-01', 190.04], ['2026-10-02', 188.75], ['2026-10-05', 189.40],
  ['2026-10-06', 192.07], ['2026-10-07', 194.12], ['2026-10-08', 198.78], ['2026-10-09', 209.05],
].map(([t, c]) => ({ t, c }));
// The roll order, verbatim shape from get_option_orders (ids shortened).
const ROLL_ORDER = { id: '6acce411', chain_symbol: 'PLTR', state: 'filled', direction: 'debit', quantity: '1.00000',
  price: '0.50000000', opening_strategy: 'short_call', closing_strategy: 'short_call', created_at: '2026-10-12T13:43:45Z',
  legs: [
    { option_id: 'new-210', side: 'sell', position_effect: 'open', expiration_date: '2026-11-20', strike_price: '210.0000', option_type: 'call', executions: [{ price: '16.14000000' }] },
    { option_id: 'old-195', side: 'buy', position_effect: 'close', expiration_date: '2026-10-16', strike_price: '195.0000', option_type: 'call', executions: [{ price: '16.64000000' }] },
  ] };

console.log('REGRESSION — the 2026-10-12 PLTR roll must grade red');
const ext = stockExtension(PLTR_BARS, 210.00, { asOf: '2026-10-12' });
t('PLTR was extended at the roll: +9.3% at $210 in 3 sessions off the Oct 6 close', () => {
  assert.ok(ext.ret3d > 0.07 && ext.ret3d < 0.10, `ret3d ${ext.ret3d}`);
  assert.equal(isExtended(ext), true);
});
t('gradeRoll: debit + ~10% extrinsic + 4 DTE + extended → RED with all three rules named', () => {
  const g = gradeRoll({ closeMark: 16.64, closeIntrinsic: 15.00, openCredit: 16.14, dte: 4, extension: ext, strikeUp: 15 });
  assert.equal(g.verdict, 'red');
  assert.equal(g.netCredit, -0.5);
  assert.ok(g.reasons.some((r) => /rule 1/.test(r)), 'rule 1');
  assert.ok(g.reasons.some((r) => /rule 2/.test(r)), 'rule 2');
  assert.ok(g.reasons.some((r) => /rule 3/.test(r)), 'rule 3');
  assert.ok(g.reasons.some((r) => /4 DTE/.test(r)), 'late DTE');
});
t('the position on Oct 12 (ITM, 4 DTE, extended) is EXTENDED_STOCK, never "roll up/out"', () => {
  const a = { side: 'short', type: 'call', strike: 195, dte: 4, expiration: '2026-10-16', underlyingPx: 210, perShare: 3.97,
    mark: 16.64, costBasis: 175, contracts: 1, covered: true, underlying: 'PLTR' };
  const g = guardrail(a, { extension: ext });
  assert.equal(g.tier, 'EXTENDED_STOCK');
  assert.equal(g.intrinsic, 15);
  assert.equal(g.extrinsic, 1.64);
  assert.equal(g.ifAssignedPerSh, 23.97); // 195 − 175 + 3.97: assignment was a WIN
  assert.ok(/Do NOT roll up/.test(g.text));
  assert.ok(g.flags.includes('EXTENDED_STOCK') && g.flags.includes('NO_EXTRINSIC'));
});
t('same position without the extension read is ASSIGNMENT_WIN (not a roll prompt)', () => {
  const a = { side: 'short', type: 'call', strike: 195, dte: 4, expiration: '2026-10-16', underlyingPx: 210, perShare: 3.97,
    mark: 16.64, costBasis: 175, contracts: 1, covered: true };
  const g = guardrail(a, {});
  assert.equal(g.tier, 'ASSIGNMENT_WIN');
  assert.ok(/Let it be assigned/.test(g.text));
});
t('detectRolls finds the roll in the order list with the right legs and net debit', () => {
  const rolls = detectRolls([ROLL_ORDER, { id: 'x', state: 'filled', chain_symbol: 'HIMS', legs: [{ side: 'sell', position_effect: 'open', option_type: 'call' }] }]);
  assert.equal(rolls.length, 1);
  const r = rolls[0];
  assert.equal(r.symbol, 'PLTR'); assert.equal(r.old.strike, 195); assert.equal(r.new.strike, 210);
  assert.equal(r.netCredit, -0.5); assert.equal(r.date, '2026-10-12'); assert.equal(r.status, 'pending');
});
t('settleRolls: PLTR closed $186.03 on Oct 16 → old leg expired worthless; do-nothing kept $3.97, roll sits −$0.50', () => {
  const rolls = detectRolls([ROLL_ORDER]);
  const hist = { PLTR: [...PLTR_BARS, { t: '2026-10-16', c: 186.03 }] };
  const out = settleRolls([], rolls, hist, { 'old-195': 3.97 }, () => ext);
  assert.equal(out[0].status, 'settled');
  assert.equal(out[0].settle.oldExpiredWorthless, true);
  assert.equal(out[0].settle.doNothingPerSh, 3.97);
  assert.equal(out[0].settle.rollPerSh, 3.47);       // 3.97 − 0.50, new leg OTM at the old expiry
  assert.equal(out[0].settle.rollVsDoNothingPerSh, -0.5);
  assert.equal(out[0].grade.verdict, 'red');
  const s = rollStats(out);
  assert.equal(s.forDebit, 1); assert.equal(s.settled, 1); assert.equal(s.vsDoNothing, -50);
});
t('settleRolls is idempotent and retains prior records (raw/ is wiped every run)', () => {
  const first = settleRolls([], detectRolls([ROLL_ORDER]), { PLTR: [{ t: '2026-10-16', c: 186.03 }] }, { 'old-195': 3.97 });
  const again = settleRolls(first, detectRolls([ROLL_ORDER]), {}, {});
  assert.equal(again.length, 1); assert.equal(again[0].status, 'settled');
  assert.equal(again[0].settle.rollVsDoNothingPerSh, -0.5);
});

console.log('tiers');
const base = { side: 'short', type: 'call', strike: 32, dte: 32, expiration: '2026-11-20', underlyingPx: 28.37, perShare: 2.25, mark: 1.71, costBasis: 29.42, contracts: 2, covered: true };
t('healthy OTM call with 32 DTE and 24% captured → HOLD', () => {
  const g = guardrail(base, {});
  assert.equal(g.tier, 'HOLD'); assert.equal(g.profitCaptured, 0.24); assert.equal(g.ifAssignedPerSh, 4.83);
});
t('IREN: strike $12 under a $40.99 basis → STRIKE_UNDER_BASIS, loss stated per share', () => {
  const g = guardrail({ ...base, strike: 29, dte: 60, underlyingPx: 27.72, perShare: 4.10, mark: 4.00, costBasis: 40.99 }, {});
  assert.equal(g.tier, 'STRIKE_UNDER_BASIS'); assert.equal(g.ifAssignedPerSh, -7.89);
  assert.ok(/realizes a loss/.test(g.text));
});
t('STRIKE_UNDER_BASIS outranks every other tier (a loss on assignment is the thing to decide)', () => {
  const g = guardrail({ ...base, strike: 29, dte: 3, underlyingPx: 31, costBasis: 40.99 }, {});
  assert.equal(g.tier, 'STRIKE_UNDER_BASIS');
});
t('OTM inside the final week → LET_IT_RIDE', () => {
  assert.equal(guardrail({ ...base, dte: 5 }, {}).tier, 'LET_IT_RIDE');
});
t('14–21 DTE with ≥50% captured → ROLL_WINDOW, credit-only wording', () => {
  const g = guardrail({ ...base, dte: 18, mark: 1.00 }, {});
  assert.equal(g.tier, 'ROLL_WINDOW'); assert.ok(/NET CREDIT only/.test(g.text));
});
t('14–21 DTE near the strike → ROLL_WINDOW even with little captured', () => {
  assert.equal(guardrail({ ...base, dte: 16, underlyingPx: 31.5, mark: 2.40 }, {}).tier, 'ROLL_WINDOW');
});
t('≥50% captured but 40 DTE → HOLD until the window opens', () => {
  const g = guardrail({ ...base, dte: 40, mark: 0.9 }, {});
  assert.equal(g.tier, 'HOLD'); assert.ok(/window opens/.test(g.text));
});
t('earnings before expiry is flagged and named in the roll-window text', () => {
  const g = guardrail({ ...base, dte: 18, mark: 1.00 }, { earningsDate: '2026-11-03' });
  assert.equal(g.earningsInside, true); assert.ok(g.flags.includes('EARNINGS_INSIDE')); assert.ok(/earnings/.test(g.text));
});
t('no mark → null extrinsic/captured, HOLD, never a confident verdict (absent ≠ zero)', () => {
  const g = guardrail({ ...base, mark: null }, {});
  assert.equal(g.extrinsic, null); assert.equal(g.profitCaptured, null); assert.equal(g.tier, 'HOLD');
});
t('REGRESSION (ChatGPT 2026-10-19 #1): late ITM with no mark never claims "little extrinsic"', () => {
  const g = guardrail({ side: 'short', type: 'call', strike: 100, underlyingPx: 105, dte: 4, mark: null, costBasis: null, perShare: null, covered: true }, {});
  assert.equal(g.tier, 'ASSIGNMENT_LIKELY'); assert.ok(g.flags.includes('NO_MARK')); assert.ok(g.flags.includes('NO_BASIS'));
  assert.ok(!/little extrinsic|debit for nothing/.test(g.text)); assert.ok(/UNKNOWN/.test(g.text));
});
t('REGRESSION (ChatGPT 2026-10-19 19:39): missing basis/mark/premium on a late ITM call is never ASSIGNMENT_WIN', () => {
  const g = guardrail({ side: 'short', type: 'call', strike: 100, underlyingPx: 105, dte: 4, mark: null, costBasis: null, perShare: null, covered: true }, {});
  assert.notEqual(g.tier, 'ASSIGNMENT_WIN');
  assert.equal(g.tier, 'ASSIGNMENT_LIKELY');
  assert.equal(g.strikeVsBasis, null); assert.equal(g.ifAssignedPerSh, null);
  assert.ok(!/plan working/.test(g.text), 'no win claim'); assert.ok(/cost basis/i.test(g.text) && /can't be stated/.test(g.text));
});
t('missing basis WITH a live mark is still neutral, and keeps the extrinsic read', () => {
  const g = guardrail({ side: 'short', type: 'call', strike: 100, underlyingPx: 105, dte: 4, mark: 5.2, costBasis: null, perShare: 2, covered: true }, {});
  assert.equal(g.tier, 'ASSIGNMENT_LIKELY'); assert.ok(/debit for nothing/.test(g.text)); assert.ok(!/plan working/.test(g.text));
});
t('known basis ≥ strike-cost but NOT covered (naked) is never ASSIGNMENT_WIN', () => {
  const g = guardrail({ side: 'short', type: 'call', strike: 100, underlyingPx: 105, dte: 4, mark: 5.2, costBasis: 80, perShare: 2, covered: false }, {});
  assert.equal(g.tier, 'ASSIGNMENT_LIKELY'); assert.ok(/^NAKED/.test(g.text)); assert.ok(/no shares cover this call/i.test(g.text)); assert.ok(!/cost basis/.test(g.text));
});
t('known basis, strike ≥ basis, covered, no mark → ASSIGNMENT_WIN with extrinsic UNKNOWN (premium not needed)', () => {
  const g = guardrail({ side: 'short', type: 'call', strike: 100, underlyingPx: 105, dte: 4, mark: null, costBasis: 90, perShare: null, covered: true }, {});
  assert.equal(g.tier, 'ASSIGNMENT_WIN'); assert.ok(/UNKNOWN/.test(g.text)); assert.ok(/plan working/.test(g.text));
});
t('strike under a KNOWN basis still outranks everything (red, not neutral)', () => {
  const g = guardrail({ side: 'short', type: 'call', strike: 100, underlyingPx: 105, dte: 4, mark: 5.2, costBasis: 110, perShare: 2, covered: true }, {});
  assert.equal(g.tier, 'STRIKE_UNDER_BASIS');
});
t('no stock price / strike / DTE → INSUFFICIENT_DATA, never a confident HOLD', () => {
  assert.equal(guardrail({ ...base, underlyingPx: null }, {}).tier, 'INSUFFICIENT_DATA');
  assert.equal(guardrail({ ...base, dte: null }, {}).tier, 'INSUFFICIENT_DATA');
  assert.ok(/missing expiry/.test(guardrail({ ...base, dte: null }, {}).text));
});
t('naked short call is prefixed as NAKED', () => {
  assert.ok(/^NAKED/.test(guardrail({ ...base, covered: false }, {}).text));
});
t('long legs and puts return null (covered calls only)', () => {
  assert.equal(guardrail({ ...base, side: 'long' }, {}), null);
  assert.equal(guardrail({ ...base, type: 'put' }, {}), null);
});

console.log('gradeRoll');
t('a textbook credit roll with time value left at 18 DTE is GREEN', () => {
  const g = gradeRoll({ closeMark: 1.20, closeIntrinsic: 0, openCredit: 2.10, dte: 18, extension: { ret3d: 0.01, vsSma20: 0.03, stale: false }, strikeUp: 2 });
  assert.equal(g.verdict, 'green'); assert.equal(g.netCredit, 0.9);
});
t('credit but no extrinsic left is still RED (rule 2 alone)', () => {
  const g = gradeRoll({ closeMark: 10, closeIntrinsic: 9.5, openCredit: 11, dte: 18 });
  assert.equal(g.verdict, 'red'); assert.ok(g.reasons.some((r) => /rule 2/.test(r)));
});
t('a stale extension is UNKNOWN, not green — rule 3 cannot be checked (never red either)', () => {
  const g = gradeRoll({ closeMark: 1, closeIntrinsic: 0, openCredit: 2, dte: 18, extension: { ret3d: null, vsSma20: null, stale: true } });
  assert.equal(g.verdict, 'unknown'); assert.equal(g.warnings.length, 1); assert.ok(/not a green light/.test(g.reasons.join(' ')));
});
t('REGRESSION (ChatGPT 2026-10-19 #1): missing intrinsic, DTE and extension can never grade GREEN', () => {
  const g = gradeRoll({ closeMark: 1, openCredit: 2 });
  assert.equal(g.verdict, 'unknown'); assert.equal(g.extrinsicPct, null);
  assert.equal(g.warnings.length, 3); assert.ok(g.warnings.every((w) => /unchecked/.test(w)));
});
t('a real rule breach still grades RED even when other gates are unknown', () => {
  const g = gradeRoll({ closeMark: 10, closeIntrinsic: 9.5, openCredit: 11 });
  assert.equal(g.verdict, 'red');
});
t('rolling DOWN into an extended stock is not penalized by rule 3', () => {
  const g = gradeRoll({ closeMark: 1, closeIntrinsic: 0, openCredit: 2, dte: 18, extension: ext, strikeUp: -5 });
  assert.ok(!g.reasons.some((r) => /rule 3/.test(r)));
});

console.log('stockExtension');
t('stale bars (older than 10 days) report stale and no figures', () => {
  const e = stockExtension(PLTR_BARS, 209, { asOf: '2026-11-01' });
  assert.equal(e.stale, true); assert.equal(e.ret3d, null); assert.equal(isExtended(e), false);
});
t('interpolated and live bars are ignored; both bar shapes read', () => {
  const e = stockExtension([{ begins_at: '2026-10-07', close_price: '100' }, { t: '2026-10-08', c: 101, interpolated: true }, { t: '2026-10-09', c: 102 }, { t: '2026-10-12', c: 103 }, { t: '2026-10-13', c: 120, live: true }], null, { asOf: '2026-10-13' });
  assert.equal(e.barsAsOf, '2026-10-12'); assert.equal(e.ret3d, null); // only 3 real bars → no 3-session base
});
t('REGRESSION (ChatGPT 2026-10-19 #2): duplicated bars (snapshot + overlapping tail) do not change the signal', () => {
  const bars = [['2026-10-05', 100], ['2026-10-06', 103], ['2026-10-07', 106], ['2026-10-08', 109]].map(([t, c]) => ({ t, c }));
  const once = stockExtension(bars, 109, { asOf: '2026-10-08' });
  const twice = stockExtension(bars.concat(bars), 109, { asOf: '2026-10-08' });
  assert.equal(once.ret3d, 0.09); assert.equal(twice.ret3d, 0.09);
  // a corrected bar for the same date (fresher source appended LAST) wins
  const corrected = stockExtension(bars.concat([{ begins_at: '2026-10-08', close_price: '118' }]), null, { asOf: '2026-10-08' });
  assert.equal(corrected.ret3d, 0.18);
});
t('REGRESSION (ChatGPT 2026-10-19 #3): a settled roll is labeled an intrinsic-proxy ESTIMATE', () => {
  const out = settleRolls([], detectRolls([ROLL_ORDER]), { PLTR: [{ t: '2026-10-16', c: 186.03 }] }, { 'old-195': 3.97 });
  assert.equal(out[0].settle.basis, 'intrinsic-proxy'); assert.equal(out[0].settle.estimated, true);
  const st = rollStats(out); assert.equal(st.estimated, true); assert.equal(st.vsDoNothingBasis, 'intrinsic-proxy');
});
t('too few bars → nulls, not zero', () => {
  const e = stockExtension([{ t: '2026-10-09', c: 1 }], 1);
  assert.equal(e.ret3d, null); assert.equal(e.vsSma20, null);
});

console.log(`\n${n} tests passed — option-guardrail`);
