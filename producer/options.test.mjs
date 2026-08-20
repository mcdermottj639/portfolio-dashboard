// Unit tests for the options money-unit normalizers + the covered-call share reservation.
// Every fixture below is a VERBATIM shape from a live Robinhood payload (IREN, 3 × $50 call sold
// at $2.92/sh on 2026-08-14) — the units are the whole point, so inventing them would defeat it.
//   node producer/options.test.mjs
import assert from 'node:assert/strict';
import { analyzeLeg, ideaTargets, sharesLockedByShortCalls, positionPremium, orderPremium } from './options.mjs';

let n = 0; const t = (name, fn) => { fn(); n++; console.log(`  ✓ ${name}`); };

// ── Live fixtures ────────────────────────────────────────────────────────────────────────────────
const POS = { option_id: '56c4beea', chain_symbol: 'IREN', type: 'short', quantity: '3.0000',
  average_price: '-292.0000', expiration_date: '2026-09-11', trade_value_multiplier: '100.0000' };
const LEG = { option_id: '56c4beea', side: 'sell', position_effect: 'open', expiration_date: '2026-09-11',
  strike_price: '50.0000', option_type: 'call' };
const ORDER = { chain_symbol: 'IREN', state: 'filled', direction: 'credit', quantity: '3.00000',
  price: '2.92000000', premium: '292.00000000', processed_premium: '876', legs: [LEG] };

console.log('positionPremium — average_price is PER CONTRACT and signed');
t('3 contracts at -$292/contract = $876 total credit (not $87,600)', () => {
  assert.equal(positionPremium(POS), 876);
});
t('returns a magnitude, never the broker sign', () => {
  assert.ok(positionPremium(POS) > 0);
  assert.equal(positionPremium({ average_price: '292.0000', quantity: '3' }), 876);
});
t('missing average_price → null, not 0 (0 would read as a free trade)', () => {
  assert.equal(positionPremium({ quantity: '3' }), null);
});
t('quantity defaults to 1 contract', () => {
  assert.equal(positionPremium({ average_price: '-292' }), 292);
});

console.log('orderPremium — premium is PER CONTRACT, processed_premium is the whole order');
t('filled order prefers processed_premium (the real fills)', () => {
  assert.equal(orderPremium(ORDER), 876);
});
t('a partial fill uses processed_premium, not the requested total', () => {
  assert.equal(orderPremium({ ...ORDER, processed_premium: '292', processed_quantity: '1' }), 292);
});
t('pending order (no processed_premium) scales per-contract premium by quantity', () => {
  assert.equal(orderPremium({ ...ORDER, state: 'queued', processed_premium: '0' }), 876);
});
t('a fill worse than the limit is reported at the fill (AMC: asked $100, filled $62)', () => {
  assert.equal(orderPremium({ quantity: '1', premium: '100.00', processed_premium: '62' }), 62);
});

console.log('analyzeLeg — a signed premium must not invert the trade');
const a = analyzeLeg(LEG, 42.85, 350, { quantity: POS.quantity, premium: positionPremium(POS),
  direction: 'credit', chain_symbol: 'IREN', costBasis: 46.94 });
t('perShare is the $2.92 taken in', () => { assert.equal(+a.perShare.toFixed(2), 2.92); });
t('short call breaks even ABOVE the strike (50 + 2.92), never below', () => {
  assert.equal(a.breakeven, 52.92);
  assert.ok(a.breakeven > a.strike);
});
t('maxProfit is premium + the capped stock gain, and is positive', () => {
  // 876 credit + (50 - 46.94) × 300 shares = 876 + 918
  assert.equal(a.maxProfit, 1794);
});
t('covered against 350 shares held', () => { assert.equal(a.covered, true); });
t('a signed premium reaching analyzeLeg is still normalized (defence in depth)', () => {
  const b = analyzeLeg(LEG, 42.85, 350, { quantity: '3', premium: -876, direction: 'credit', costBasis: 46.94 });
  assert.equal(b.breakeven, 52.92);
  assert.equal(b.perShare, a.perShare);
});
t('summary quotes the real credit', () => { assert.ok(a.summary.includes('$876')); });

console.log('sharesLockedByShortCalls — collateral already pledged');
t('3 short calls lock 300 shares', () => {
  assert.deepEqual(sharesLockedByShortCalls([a]), { IREN: 300 });
});
t('reads a raw Robinhood position row too', () => {
  assert.deepEqual(sharesLockedByShortCalls([{ chain_symbol: 'IREN', type: 'short', quantity: '3',
    option_type: 'call' }]), { IREN: 300 });
});
t('long calls and short PUTS pledge no shares', () => {
  assert.deepEqual(sharesLockedByShortCalls([
    { underlying: 'X', side: 'long', type: 'call', contracts: 2 },
    { underlying: 'Y', side: 'short', type: 'put', contracts: 2 },
  ]), {});
});
t('multiple short calls on one name accumulate', () => {
  assert.deepEqual(sharesLockedByShortCalls([
    { underlying: 'IREN', side: 'short', type: 'call', contracts: 3 },
    { underlying: 'IREN', side: 'short', type: 'call', contracts: 1 },
  ]), { IREN: 400 });
});

console.log('ideaTargets — never write a call against pledged collateral');
t('350 shares with 300 pledged → NO covered-call idea (only 50 free)', () => {
  const got = ideaTargets([], [{ symbol: 'IREN', shares: 350, px: 42.85, freeShares: 50 }]);
  assert.equal(got.filter((x) => x.kind === 'covered_call').length, 0);
});
t('350 shares with 100 pledged → one idea, carrying the free count', () => {
  const got = ideaTargets([], [{ symbol: 'IREN', shares: 350, px: 42.85, freeShares: 250 }]);
  const cc = got.find((x) => x.kind === 'covered_call');
  assert.ok(cc); assert.equal(cc.freeShares, 250); assert.equal(cc.shares, 350);
});
t('no freeShares supplied → falls back to the raw count (old behavior)', () => {
  const got = ideaTargets([], [{ symbol: 'IREN', shares: 350, px: 42.85 }]);
  assert.equal(got.filter((x) => x.kind === 'covered_call').length, 1);
});

console.log(`\n✅ options: ${n} assertions passed`);
