/* v156 — self-directed plan rules (pure).
   Momentum still RANKS leadership. These helpers decide whether NEW MONEY may
   chase it, how large a fill may be, and when the book may borrow.
   They never generate a sell from size alone (the 2026-08-25 lesson still holds).

   Loaded by index.html before the main inline script; also require()-able from
   Node tests. Keep this file free of DOM / window.__DATA. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else {
    root.SDRules = api;
    // Flatten only the NEW constants. Existing SD_* stay as index.html `const`s
    // so a stale cache of this file cannot silently retune cruise/ceiling/min-score.
    const share = [
      'SD_FLOOR', 'SD_ENTRY_EXTEND', 'SD_ENTRY_CHASE', 'SD_CLUSTER_CAP_NEW',
      'SD_SINGLE_MAX_EQ', 'SD_HV_HALVE', 'SD_LEV_CUT', 'SD_LEV_CUT_MUL',
      'SD_HEAT_HV', 'SD_EXTEND_BORROW', 'SD_EXTEND_HALF', 'SD_STOP_CORE_CAP',
      'SD_STOP_SAT_CAP', 'SD_TRIM_EQ', 'SD_TRIM_GAIN', 'SD_ASYM_OFF_LO',
      'SD_ASYM_OFF_HI', 'SD_SPEC_RATIO', 'SD_MIN_RR', 'SD_CHASE_ATR', 'SD_THEMES',
    ];
    share.forEach((k) => { root[k] = api.C[k]; });
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const C = {
    SD_FLOOR: { core: 7.0, sat: 7.5, asym: 5.0 },
    SD_ENTRY_EXTEND: 3.0,     // % off 20-day high — inside this is "at the high"
    SD_ENTRY_CHASE: 9.0,      // exception: momentum ≥ 9 may still buy, at half size
    SD_CLUSTER_CAP_NEW: 0.30, // max 30% of ending book into one theme (new money)
    SD_SINGLE_MAX_EQ: 0.20,   // 20% of EQUITY, not of the levered line
    SD_SINGLE_MAX_X: 0.60,    // backstop vs exposure (rarely binds once equity cap is on)
    SD_HV_HALVE: 80,          // 30d HV > 80% → cut size in half again
    SD_LEV_CUT: 1.30,         // book already >1.3× → size ×0.65
    SD_LEV_CUT_MUL: 0.65,
    SD_HEAT_HV: 40,           // avg HV above this AND leverage past 1.3× ⇒ no incremental borrow
    SD_EXTEND_BORROW: 5.0,    // no incremental borrow if median fill is <5% off 20d high
    SD_EXTEND_HALF: 3.0,      // if >half of proposed fills are <3% off high → cash-only
    SD_STOP_CORE_CAP: 0.12,
    SD_STOP_SAT_CAP: 0.20,
    SD_TRIM_EQ: 0.25,         // advisory peel if a name is ≥25% of equity
    SD_TRIM_GAIN: 0.25,       // or +25% from cost with thesis intact
    SD_ASYM_OFF_LO: 8,
    SD_ASYM_OFF_HI: 15,
    SD_SPEC_RATIO: 1.4,       // app target > 1.4× street ⇒ speculative, size ×0.5
    SD_MIN_RR: 2.0,
    SD_CHASE_ATR: 0.5,        // cancel if last > limit + 0.5×ATR (order-time note)
    SD_THEMES: {
      'crypto-beta': ['IBIT', 'CLSK', 'CIFR', 'WULF', 'IREN'],
      'ai-infra': ['SMCI', 'NBIS', 'NVDA', 'AVGO', 'TSM', 'MU', 'CRDO', 'VRT', 'AMAT', 'KLAC', 'MRVL', 'GFS', 'AMKR', 'APP'],
      'cyber': ['CRWD', 'PANW'],
      'megacap-software': ['MSFT', 'GOOGL', 'AMZN', 'META', 'AAPL', 'ORCL', 'PLTR', 'CRM', 'ADBE', 'NFLX', 'NOW'],
      'semis': ['AMD', 'QCOM', 'NXPI'],
    },
  };

  function themeOf(sym) {
    const s = String(sym || '').toUpperCase();
    for (const k of Object.keys(C.SD_THEMES)) {
      if (C.SD_THEMES[k].indexOf(s) >= 0) return k;
    }
    return 'other';
  }

  function floorOf(tier) {
    const t = C.SD_FLOOR[tier];
    return t != null ? t : 5.0;
  }

  // fromHi20 is (px/hi20 - 1)*100: 0 at the high, negative below. off20 is the
  // positive "% below the 20-day high" the gates actually read.
  function off20(m) {
    if (!m) return null;
    const v = m.fromHi20 != null ? m.fromHi20 : m.fromHi;
    if (v == null || !isFinite(v)) return null;
    return -v;
  }

  function entryGate(m) {
    const off = off20(m);
    if (off == null) return { ok: true, extended: false, sizeMul: 1, reason: null, off: null };
    const extended = off < C.SD_ENTRY_EXTEND;
    if (!extended) return { ok: true, extended: false, sizeMul: 1, reason: null, off };
    // At the high: never a marketable buy. ≥9 momentum is still a pullback
    // candidate (delayed, half-size if something ever forces a fill) — it is
    // not permission to chase the print with the cruise-band loan.
    if ((m.score || 0) >= C.SD_ENTRY_CHASE) {
      return { ok: false, extended: true, sizeMul: 0.5, reason: 'extended-strong', off };
    }
    return { ok: false, extended: true, sizeMul: 0, reason: 'extended', off };
  }

  // Close-to-close ATR proxy. The YTD daily series has no high/low, so |Δclose|
  // is the honest range. Returns dollars, not percent.
  function atrFromCloses(c, n) {
    n = n || 14;
    if (!c || c.length < n + 1) return null;
    let s = 0;
    for (let i = c.length - n; i < c.length; i++) s += Math.abs(c[i] - c[i - 1]);
    return s / n;
  }

  function stopPct(m) {
    const core = (m && m.tier) === 'core';
    const cap = core ? C.SD_STOP_CORE_CAP : C.SD_STOP_SAT_CAP;
    const vol = (m && m.vol) || 40;
    const volPct = Math.max(0.12, Math.min(0.35, vol / 300));
    const atr = m && m.atr, px = m && m.px;
    const atrPct = (atr > 0 && px > 0) ? (atr / px) : null;
    const mult = core ? 1.75 : 2.25;
    const struct = atrPct != null ? atrPct * mult : volPct;
    const raw = Math.max(core ? 0.06 : 0.08, struct);
    const pct = Math.min(cap, raw);
    return { pct, raw, cap, tight: raw > cap + 1e-12 };
  }

  function stopPrice(m) {
    if (!(m && m.px > 0)) return null;
    return m.px * (1 - stopPct(m).pct);
  }

  function sizeMul(m, ctx) {
    ctx = ctx || {};
    let mul = 1;
    const why = [];
    const e = entryGate(m);
    if (e.sizeMul < 1) { mul *= e.sizeMul; if (e.reason) why.push(e.reason); }
    if ((m && m.vol || 0) > C.SD_HV_HALVE) { mul *= 0.5; why.push('hv>' + C.SD_HV_HALVE); }
    if (ctx.lev != null && ctx.lev > C.SD_LEV_CUT) { mul *= C.SD_LEV_CUT_MUL; why.push('lev-cut'); }
    const sp = ctx.stopInfo || (m ? stopPct(m) : null);
    if (sp && sp.tight && sp.raw > 0) { mul *= sp.pct / sp.raw; why.push('stop-cap'); }
    if (ctx.speculative) { mul *= 0.5; why.push('spec-target'); }
    return { mul, why };
  }

  // Target = min(app 3R, 12-month consensus, 1.5× measured move). Speculative
  // if the app number is >1.4× street. Reward/risk uses the TIGHTER target.
  function targetOf(m, stop, street) {
    const px = m && m.px;
    if (!(px > 0) || !(stop > 0) || !(px > stop)) {
      return { tgt: null, app: null, street: street > 0 ? street : null, measured: null, spec: false, rr: null };
    }
    const risk = px - stop;
    const app = px + 3 * risk;
    const measured = px + 1.5 * risk;
    const st = street > 0 ? street : null;
    const cands = [app, measured];
    if (st != null) cands.push(st);
    const tgt = Math.min.apply(null, cands);
    const spec = st != null && app > st * C.SD_SPEC_RATIO;
    const rr = risk > 0 ? (tgt - px) / risk : null;
    return { tgt, app, street: st, measured, spec, rr };
  }

  function median(arr) {
    if (!arr.length) return null;
    const a = arr.slice().sort((x, y) => x - y);
    const mid = Math.floor(a.length / 2);
    return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
  }

  // fills: [{off20, vol}] — the names the allocator would actually try to buy.
  // allowBorrow false ⇒ cruise-band borrow and press room both stay shut.
  function heatOf(fills, ctx) {
    ctx = ctx || {};
    const offs = (fills || []).map((f) => f.off20).filter((x) => x != null && isFinite(x));
    const vols = (fills || []).map((f) => f.vol).filter((x) => x != null && isFinite(x));
    const med = median(offs);
    const fracHot = offs.length ? offs.filter((o) => o < C.SD_EXTEND_HALF).length / offs.length : 0;
    const avgHV = vols.length ? vols.reduce((s, x) => s + x, 0) / vols.length : 0;
    const reasons = [];
    if (med != null && med < C.SD_EXTEND_BORROW) reasons.push('median-extended');
    if (fracHot > 0.5 && offs.length >= 2) reasons.push('half-chasing');
    if (avgHV > C.SD_HEAT_HV && ctx.lev != null && ctx.lev > C.SD_LEV_CUT) reasons.push('hot-book-leverage');
    return {
      allowBorrow: reasons.length === 0,
      median: med,
      fracHot,
      avgHV,
      reasons,
    };
  }

  function nameCapDollars(equity, expTarget) {
    const eq = Math.max(0, (equity || 0) * C.SD_SINGLE_MAX_EQ);
    const x = Math.max(0, (expTarget || 0) * C.SD_SINGLE_MAX_X);
    if (eq > 0 && x > 0) return Math.min(eq, x);
    return eq || x || 0;
  }

  function clusterCapDollars(expTarget) {
    return Math.max(0, (expTarget || 0) * C.SD_CLUSTER_CAP_NEW);
  }

  // Intact 50-DMA (or unknown) + either failed the entry gate or sits 8–15% off
  // the 20-day high. Limit-order sleeve; no leverage.
  function isPullback(m) {
    if (!m) return false;
    const intact = m.s50 == null || !(m.px > 0) || m.px >= m.s50;
    if (!intact) return false;
    const e = entryGate(m);
    if (e.reason === 'extended' || e.reason === 'extended-strong') return true;
    return e.off != null && e.off >= C.SD_ASYM_OFF_LO && e.off <= C.SD_ASYM_OFF_HI;
  }

  function classifyName(m) {
    const e = entryGate(m);
    const floor = floorOf(m && m.tier);
    const score = (m && m.score) || 0;
    if (score < floor) {
      return { bin: isPullback(m) ? 'pullback' : 'below-floor', entry: e, floor };
    }
    if (!e.ok) {
      return { bin: isPullback(m) ? 'pullback' : 'extended', entry: e, floor };
    }
    return { bin: 'buy', entry: e, floor };
  }

  // Inverse-vol split across cands, then clamp by name cap (equity), cluster
  // cap (theme), sizeMul, and (for asym) remaining cash. Skips a name rather
  // than selling anything. Returns {picks, skipped, deployed, after, clusterAfter}.
  function allocate({ cands, bucket, after, clusterAfter, equity, expTarget, lev, cashLeft, streetOf }) {
    after = Object.assign({}, after || {});
    clusterAfter = Object.assign({}, clusterAfter || {});
    const picks = [];
    const skipped = [];
    const capName = nameCapDollars(equity, expTarget);
    const capCl = clusterCapDollars(expTarget);
    const list = (cands || []).slice();
    if (!list.length || !(bucket > 0)) return { picks, skipped, deployed: 0, after, clusterAfter };

    const inv = list.map((m) => 1 / Math.max(15, m.vol || 40));
    const sInv = inv.reduce((a, b) => a + b, 0) || 1;
    list.forEach((m, i) => {
      const theme = m.theme || themeOf(m.sym);
      const held = after[m.sym] || 0;
      const clHeld = clusterAfter[theme] || 0;
      const roomName = Math.max(0, capName - held);
      const roomCl = Math.max(0, capCl - clHeld);
      if (roomCl <= 0) {
        skipped.push({ m, why: 'cluster-full' });
        picks.push({ m, sh: 0, d: 0, noRoom: true, atMax: false, skip: 'cluster-full' });
        return;
      }
      if (roomName <= 0) {
        skipped.push({ m, why: 'name-cap' });
        picks.push({ m, sh: 0, d: 0, noRoom: true, atMax: true, skip: 'name-cap' });
        return;
      }
      const sp = stopPct(m);
      const stop = stopPrice(m);
      const street = streetOf ? streetOf(m.sym) : (m.street || null);
      const tgt = targetOf(m, stop, street);
      if (tgt.rr != null && tgt.rr < C.SD_MIN_RR) {
        skipped.push({ m, why: 'rr<' + C.SD_MIN_RR });
        picks.push({ m, sh: 0, d: 0, noRoom: true, atMax: false, skip: 'rr', tgt, stop });
        return;
      }
      const sm = sizeMul(m, { lev, stopInfo: sp, speculative: tgt.spec });
      let d = bucket * (inv[i] / sInv) * sm.mul;
      d = Math.min(d, roomName, roomCl);
      if (cashLeft != null) d = Math.min(d, Math.max(0, cashLeft));
      const sh = (m.px > 0) ? Math.floor(d / m.px) : 0;
      if (sh <= 0) {
        picks.push({ m, sh: 0, d: 0, noRoom: true, atMax: roomName < 1 || sm.mul === 0, skip: 'round-out', tgt, stop, sm, sp });
        return;
      }
      const dollars = sh * m.px;
      after[m.sym] = held + dollars;
      clusterAfter[theme] = clHeld + dollars;
      if (cashLeft != null) cashLeft -= dollars;
      picks.push({
        m, sh, d: dollars, stop, tgt, sm, sp,
        cappedBy: (dollars + 1e-6 < bucket * (inv[i] / sInv)) ? (sm.why[0] || 'sizing clamp') : null,
        noRoom: false,
      });
    });
    const deployed = picks.reduce((s, p) => s + (p.d || 0), 0);
    return { picks, skipped, deployed, after, clusterAfter, cashLeft };
  }

  function clusterAfterFrom(baseAfter) {
    const out = {};
    Object.keys(baseAfter || {}).forEach((sym) => {
      const th = themeOf(sym);
      out[th] = (out[th] || 0) + (baseAfter[sym] || 0);
    });
    return out;
  }

  function trimAdvice(pos, equity) {
    if (!pos || !(equity > 0) || !(pos.val > 0)) return null;
    const pctEq = pos.val / equity;
    const gain = (pos.avg > 0 && pos.px > 0) ? (pos.px / pos.avg - 1) : 0;
    const hitEq = pctEq >= C.SD_TRIM_EQ;
    const hitGain = gain >= C.SD_TRIM_GAIN;
    if (!hitEq && !hitGain) return null;
    const targetVal = C.SD_SINGLE_MAX_EQ * equity;
    const peel = Math.max(0, pos.val - targetVal);
    return {
      hitEq, hitGain, pctEq, gain, peel,
      targetVal,
      why: hitEq
        ? (hitGain ? '25% of equity and +25% from cost' : '25% of equity')
        : '+25% from cost',
    };
  }

  return {
    C,
    themeOf, floorOf, off20, entryGate, atrFromCloses, stopPct, stopPrice,
    sizeMul, targetOf, heatOf, nameCapDollars, clusterCapDollars,
    isPullback, classifyName, allocate, clusterAfterFrom, trimAdvice, median,
  };
});
