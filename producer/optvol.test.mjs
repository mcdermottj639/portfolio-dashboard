/* optvol.mjs — the realized-vol IV proxy behind every ESTIMATE-path option premium.
   The defect these pin: on 2026-09-11 the RCL cash-secured put idea advertised ~$1,305 of income and
   a 58% annualized yield off a $13.05 estimated premium that implied ~68% IV, because the proxy read
   only raw hist-day batches with >=20 bars and v141 made almost every batch a 7-bar tail. */
import assert from 'node:assert';
import { realizedVol, volFromBars, buildIvBySym, VOL_WINDOW_BARS, VOL_MIN_BARS } from './optvol.mjs';
import { buildIdeas } from './options.mjs';

let n = 0;
const t = (name, fn) => { fn(); n++; console.log('  ok', name); };

/* Deterministic series: alternating log-returns of +/-step give a known annualized vol. */
const series = (len, start, step) => {
  const out = [start];
  for (let i = 1; i < len; i++) out.push(out[i - 1] * Math.exp(i % 2 ? step : -step));
  return out;
};
const bars = (closes, { shape = 'raw', from = '2026-01-05' } = {}) => {
  const d = new Date(from + 'T00:00:00Z');
  return closes.map((c, i) => {
    const day = new Date(d.getTime() + i * 86400000).toISOString().slice(0, 10);
    return shape === 'raw' ? { begins_at: day + 'T00:00:00Z', close_price: String(c) } : { t: day, c };
  });
};

console.log('optvol');

t('a known series returns its annualized vol', () => {
  const v = realizedVol(series(80, 100, 0.01), { window: 0 });
  // alternating +/-1% log moves => sd ~= 0.01, annualized ~= 0.01*sqrt(252) ~= 0.1587
  assert.ok(v > 0.15 && v < 0.17, `got ${v}`);
});

t('THE WINDOW IS HORIZON-MATCHED — a calm recent regime is not blended with an old wild one', () => {
  // 120 wild bars then 60 calm ones: the full-series read is high, the windowed read is the calm one.
  const wild = series(120, 100, 0.04);
  const calm = series(61, wild[wild.length - 1], 0.008).slice(1);
  const all = [...wild, ...calm];
  const windowed = realizedVol(all);
  const whole = realizedVol(all, { window: 0 });
  assert.ok(whole > windowed * 2, `whole ${whole} should dwarf windowed ${windowed}`);
  assert.ok(windowed < 0.2, `windowed ${windowed} should describe the calm regime`);
});

t('both bar shapes give byte-identical output', () => {
  const c = series(80, 250, 0.02);
  assert.strictEqual(volFromBars(bars(c, { shape: 'raw' })), volFromBars(bars(c, { shape: 'compact' })));
});

t('interpolated placeholders and the spliced live bar are dropped', () => {
  const c = series(80, 100, 0.01);
  const clean = volFromBars(bars(c));
  const dirty = bars(c).concat([
    { begins_at: '2026-07-01T00:00:00Z', close_price: '999', interpolated: true },
    { begins_at: '2026-07-02T00:00:00Z', close_price: '999', live: true },
  ]);
  assert.strictEqual(volFromBars(dirty), clean);
});

t('a series shorter than VOL_MIN_BARS abstains (null, never 0)', () => {
  assert.strictEqual(realizedVol(series(VOL_MIN_BARS - 1, 100, 0.01)), null);
  assert.strictEqual(realizedVol([]), null);
  assert.strictEqual(realizedVol(null), null);
});

t('a FLAT series abstains rather than scoring ~0 vol', () => {
  // a 0% read would price every contract at the $0.05 floor and make a worthless option look free
  assert.strictEqual(realizedVol(new Array(80).fill(100)), null);
});

t('junk out-of-band results abstain', () => {
  assert.strictEqual(realizedVol(series(80, 100, 2.5)), null);          // absurd vol
  assert.strictEqual(realizedVol(series(80, 100, 0.01).map(() => NaN)), null);
});

t('THE FIX: a 7-bar tail cannot price vol and FALLS THROUGH to the deeper snapshot series', () => {
  const deep = series(120, 260, 0.02);
  const tail = bars(deep.slice(-7), { from: '2026-08-20' });
  // raw-only (what shipped): nothing at all — this is the bug
  assert.deepStrictEqual(buildIvBySym([{ RCL: tail }]), {});
  // raw first, snapshot as the fill: the tail yields null and does NOT block the snapshot
  const merged = buildIvBySym([{ RCL: tail }, { RCL: bars(deep) }]);
  assert.ok(merged.RCL > 0.05, `expected a real vol, got ${merged.RCL}`);
});

t('an earlier source that DOES produce a figure wins', () => {
  const a = bars(series(80, 100, 0.03));
  const b = bars(series(80, 100, 0.005));
  const got = buildIvBySym([{ X: a }, { X: b }]);
  assert.strictEqual(got.X, volFromBars(a));
});

t('tail + full for one symbol concatenate and dedupe by date', () => {
  const full = series(90, 100, 0.015);
  const asBars = bars(full);
  const overlap = asBars.slice(-7);                      // same dates, same closes
  assert.strictEqual(volFromBars(asBars.concat(overlap)), volFromBars(asBars));
});

t('a malformed source is skipped without taking the map down', () => {
  const good = bars(series(80, 100, 0.01));
  assert.ok(buildIvBySym([{ BAD: null, ALSOBAD: 'nope', GOOD: good }]).GOOD > 0);
});

/* END-TO-END through the real idea builder: the same pick, with and without a realized vol. */
t('REGRESSION — the live RCL case: a real vol cuts the CSP premium to a third of the default', () => {
  const picks = [{ ticker: 'A', price: 100 }, { ticker: 'B', price: 100 }, { ticker: 'C', price: 100 },
                 { ticker: 'RCL', price: 260 }];
  const q = { RCL: 260 };
  const cspOf = (iv) => buildIdeas(picks, [], q, {}, iv).ideas.find((i) => i.underlying === 'RCL' && i.strategy === 'Cash-secured put');

  const dflt = cspOf({});                                  // what shipped: flat 0.60 default
  const fixed = cspOf({ RCL: 0.322 });                     // RCL's real 60-day realized vol

  assert.strictEqual(dflt.strike, 242, 'strike is round(260*0.93)');
  assert.ok(Math.abs(dflt.estPremium - 13.05) < 0.2, `default path should reproduce the shipped $13.05, got ${dflt.estPremium}`);
  assert.ok(fixed.estPremium < dflt.estPremium / 2, `fixed ${fixed.estPremium} should be far under default ${dflt.estPremium}`);
  // and every derived figure moves with it — income, breakeven and the headline annualized yield
  assert.strictEqual(fixed.income, +(fixed.estPremium * 100).toFixed(0));
  assert.strictEqual(fixed.breakeven, +(242 - fixed.estPremium).toFixed(2));
  assert.ok(fixed.annYield < dflt.annYield / 2, `yield ${fixed.annYield}% vs ${dflt.annYield}%`);
  assert.ok(fixed.annYield < 30, `a 32%-vol name should not advertise ${fixed.annYield}% annualized`);
});

t('VOL_WINDOW_BARS is at least two option horizons', () => {
  assert.ok(VOL_WINDOW_BARS >= 40 && VOL_WINDOW_BARS <= 90, `window ${VOL_WINDOW_BARS}`);
});

console.log(`optvol: ${n} tests passed`);
