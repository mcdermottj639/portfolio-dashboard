/* v186 (guard v195) — Apex: the self-directed margin book's leverage loop (pure + render).
   Layered ON the v156 SD rules, never beside them: trims reuse SD_TRIM_GAIN, the
   per-name cap reuses SD_SINGLE_MAX_EQ, broken-thesis exits stay with sdBroken.
   What Apex adds is the thing the plan never said out loud: a LEVERAGE BAND
   (exposure ÷ equity), the distance to a maintenance call, a pre-built drop
   tripwire, a de-lever ladder that sells into strength, and the reload rule that
   only borrows when the book is winning. Tickets are proposals; approvals live in
   Jarvis (decisions queue) and the order is placed by Jack in Robinhood.

   Loaded by index.html before the main inline script; require()-able from Node
   tests. Keep this file free of DOM access outside render(). */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Apex = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const C = {
    LEV_NORMAL: 1.65,      // where the book cruises; adds go only up to here (Jack, 2026-11-10: "keep adding" — was 1.35)
    LEV_CAP: 1.75,         // hard cap — above it: no new buys (Jack, 2026-11-10: 1.75x; was 1.5x)
    LEV_RELOAD: 1.50,      // below it new borrow is allowed (was 1.20; trails cruise by the same 0.15)
    MAINT: 0.30,           // Robinhood house maintenance seen on IREN (2026-11-05); PLTR assumed
    /* v195 (LAB-004-P1): the guard follows the maintenance REQUIREMENT, not a fixed line. Buffers are points
       of exposure over the (blended, per-name) requirement; at the default 30% they give the old 35% / 40%. */
    GUARD_BUFFER: 0.05,    // equity ÷ exposure under requirement + 5 pts ⇒ risk guard
    GUARD_RECOVER: 0.10,   // …and it sells until equity is back at requirement + 10 pts (capped at 100% = no debt)
    GUARD_PCT: 0.35,       // = MAINT + GUARD_BUFFER — the default-book line only; rules read st.guardPct
    GUARD_TARGET: 0.40,    // = MAINT + GUARD_RECOVER — the default-book target only; rules read st.guardTarget
    TRIM_GAIN: 0.25,       // = SD_TRIM_GAIN
    TRIM_GAIN_2: 0.50,
    TRIM_FRAC: 0.25,
    STOP: 0.25,            // = sdBroken's hard stop
    SINGLE_MAX_EQ: 0.20,   // = SD_SINGLE_MAX_EQ
    DRIFT_PTS: 5,
    EARN_DAYS: 3,
    TRANCHE: 50,
    RR_MIN: 1.5,           // v194: Jack's reward/risk floor, measured at the ACTUAL entry (the limit), not yesterday's close
    LIMIT_PAD: 0.01,       // v194: the scan's buy-stop-limit sits 1% over the trigger (274.60 → 277.35)
  };

  /* Default book config. Overridable from window.__APEX_CFG (set by the producer
     later) or a test. Targets are % of EQUITY, must respect SINGLE_MAX_EQ. */
  const DEFAULT_CFG = {
    core: 'IREN',
    coreMax: 500,                                    // v188 (Jack, 2026-11-05): keep an IREN core of up to 500 sh — exempt from the stop and drift trims; trims only into strength
    donor: 'PLTR',                                   // risk-guard tranche source (Jack, 2026-11-05)
    ladder: [],                                      // v201 (Jack, Nov 8 22:38: "stop telling me to sell the iren … I'll handle the iren"): no IREN rung
    coreOwner: true,                                 // v201: the core is OWNER-MANAGED — no rule ever proposes selling, trimming or adding it; Apex builds around it
    targets: { IREN: 20, NVDA: 20, PLTR: 15, RKLB: 15, CRWD: 10 },
    kicker: 15,                                      // LEAPS sleeve cap, funded from trims only
    jarvis: 'https://claude.ai/artifact/1rWeHSBKA2BJ1kiesa81sQ',
    /* v196: Robinhood's per-stock maintenance (Margin buffer screen, Jack, 2026-11-08). Names not listed use
       the 30% account default, which is the same or stricter than Robinhood's figure for them. */
    maintBy: { IREN: 0.30, AMZN: 0.25, PLTR: 0.25 },
  };

  const num = (v) => (v == null || isNaN(+v) ? 0 : +v);

  /* ── state ─────────────────────────────────────────────────────────────── */
  /* Maintenance inputs (v195): input.maint = the account default (else C.MAINT); a position's own `maint`
     (0–1, e.g. Robinhood's higher house figure on a volatile or concentrated name) overrides it for that name;
     input.maintReq = the broker's total requirement in dollars (covers options / anything not modeled) and is
     used when it is higher than the per-name sum. The requirement is blended: req = Σ maint_i · value_i. */
  const clampM = (m) => Math.min(1, Math.max(0, m));
  function state(input) {
    const base = clampM(input.maint != null && !isNaN(+input.maint) ? +input.maint : C.MAINT);
    const pos = (input.positions || []).filter((p) => num(p.qty) > 0 && num(p.px) > 0)
      .map((p) => ({ symbol: String(p.symbol).toUpperCase(), qty: num(p.qty), px: num(p.px), avg: num(p.avg), val: num(p.qty) * num(p.px),
        maint: p.maint != null && p.maint !== '' && !isNaN(+p.maint) ? clampM(+p.maint) : base }));
    const exposure = pos.reduce((s, p) => s + p.val, 0);
    const debt = Math.max(0, -num(input.cash));
    const equity = input.equity != null ? num(input.equity) : exposure - debt;
    const reqNames = pos.reduce((s, p) => s + p.maint * p.val, 0);
    const req = Math.max(reqNames, num(input.maintReq));
    const maint = exposure > 0 ? Math.min(1, req / exposure) : base;   // effective (blended) requirement
    const guardPct = Math.min(1, maint + C.GUARD_BUFFER);
    const guardTarget = Math.max(guardPct, Math.min(1, maint + C.GUARD_RECOVER));
    const lev = equity > 0 ? exposure / equity : (exposure > 0 ? Infinity : 0);
    const eqPct = exposure > 0 ? equity / exposure : 1;
    const cushion = equity - req;                          // dollars of market value you can lose before a call
    const callDrop = exposure > 0 && maint < 1 ? Math.max(0, cushion / ((1 - maint) * exposure)) : (exposure > 0 ? 0 : null);
    const band = lev > C.LEV_CAP ? 'over' : lev > C.LEV_NORMAL ? 'high' : lev < C.LEV_RELOAD ? 'room' : 'normal';
    const top = pos.slice().sort((a, b) => b.val - a.val);
    const w = {};
    pos.forEach((p) => { w[p.symbol] = equity > 0 ? p.val / equity : 0; });
    return { positions: pos, exposure, debt, equity, maint, maintBase: base, req, guardPct, guardTarget, lev, eqPct, cushion, callDrop, band, top, weights: w };
  }

  /* Price of `sym` at which equity ÷ exposure == pct, every other name held flat. With no pct it is the
     price that puts the book on ITS guard line (requirement + GUARD_BUFFER, per-name requirements kept). */
  function tripwire(st, sym, pct) {
    const p = st.positions.find((x) => x.symbol === sym);
    if (!p || p.qty <= 0) return null;
    const others = st.exposure - p.val;
    if (pct != null) {
      const k = 1 - pct;
      // (q·x + others)·k = debt  ⇒  x = (debt/k − others)/q
      const x = (st.debt / k - others) / p.qty;
      return x > 0 ? x : null;
    }
    // q·x + O − D = m·q·x + R_o + b·(q·x + O)  ⇒  x = (D + R_o − (1 − b)·O) / (q·(1 − m − b))
    const b = C.GUARD_BUFFER, Ro = Math.max(0, st.req - p.maint * p.val), den = p.qty * (1 - p.maint - b);
    if (!(den > 0)) return null;
    const x = (st.debt + Ro - (1 - b) * others) / den;
    return x > 0 ? x : null;
  }

  /* v195 — risk-guard sale plan. Sells donors in order until equity ÷ exposure is back at the book's recovery
     line (requirement + GUARD_RECOVER, capped at no debt), re-blending the requirement after every sale: a
     donor carrying a LOW requirement lifts the blend as it goes, so it needs more selling than a flat line
     says. Order: cfg.donor → other names (largest first) → core shares above coreMax → the core itself
     (flagged; a call would force it anyway). Equity is unchanged by a sale; proceeds pay debt 1:1.
     Returns {legs:[{p, qty, s}], after:{exposure, debt, req, eqPct, guardPct, guardTarget}, short$}. */
  function guardPlan(st, cfg) {
    const R = C.GUARD_RECOVER;
    let E = st.exposure, D = st.debt, Q = st.req;
    const eq = st.equity;
    const done = () => D <= 1e-9 || eq >= Math.min(E, Q + R * E) - 1e-9;
    const core = st.positions.find((x) => x.symbol === cfg.core);
    const coreKeep = core && cfg.coreMax > 0 ? Math.min(core.qty, cfg.coreMax) : 0;
    const order = [];
    const donor = st.positions.find((x) => x.symbol === cfg.donor && x.symbol !== cfg.core);
    if (donor) order.push({ p: donor, max: donor.qty });
    st.top.filter((x) => x !== donor && x.symbol !== cfg.core).forEach((x) => order.push({ p: x, max: x.qty }));
    if (core && !cfg.coreOwner && core.qty - coreKeep > 0) order.push({ p: core, max: core.qty - coreKeep });
    if (core && !cfg.coreOwner && coreKeep > 0) order.push({ p: core, max: coreKeep, core: true });
    const legs = [];
    for (const o of order) {
      if (done()) break;
      const m = o.p.maint;
      // smallest s with eq ≥ min(E − s, (Q − m·s) + R·(E − s))
      const need = Math.max(0, Math.min(E - eq, (Q + R * E - eq) / (m + R)));
      let qty = Math.ceil(need / o.p.px - 1e-9);
      if (!legs.length && o.p === donor) qty = Math.max(C.TRANCHE, Math.ceil(qty / C.TRANCHE) * C.TRANCHE);   // first leg keeps the 50-share tranche
      qty = Math.min(o.max, qty);
      if (qty <= 0) continue;
      const s = qty * o.p.px;
      legs.push({ p: o.p, qty, s, core: !!o.core });
      E -= s; Q = Math.max(0, Q - m * s); D = Math.max(0, D - s);
    }
    const mEff = E > 0 ? Math.min(1, Q / E) : st.maint;
    const after = { exposure: E, debt: D, req: Q, eqPct: E > 0 ? eq / E : 1, guardPct: Math.min(1, mEff + C.GUARD_BUFFER), guardTarget: Math.max(Math.min(1, mEff + C.GUARD_BUFFER), Math.min(1, mEff + R)) };
    const short = done() ? 0 : Math.max(0, Math.min(E, Q + R * E) - eq);   // cash to deposit (pays debt) if selling everything allowed is not enough
    return { legs, after, short };
  }

  /* Dollars to sell so that exposure/equity == lev target (debt falls 1:1 with proceeds). */
  function sellToLev(st, levT) {
    // (E − s)/(eq) == levT  with eq fixed ⇒ s = E − levT·eq
    return Math.max(0, st.exposure - levT * st.equity);
  }

  /* ── rules ─────────────────────────────────────────────────────────────── */
  function rules(st, opt) {
    opt = opt || {};
    const cfg = Object.assign({}, DEFAULT_CFG, opt.cfg || {});
    const sma = opt.smaMap || {};        // sym → {s50}
    const earn = opt.earningsMap || {};  // sym → {daysAway}
    const review = opt.review === true || opt.friday === true;   // v194: weekly review day (Monday since Nov 6); `friday` kept for old callers
    const out = [];
    const byName = (s) => st.positions.find((p) => p.symbol === s);
    const nearEarn = (s) => earn[s] && earn[s].daysAway != null && earn[s].daysAway >= 0 && earn[s].daysAway <= C.EARN_DAYS;

    // A1 Risk guard — first, always. v195: the line and the target follow the maintenance requirement.
    if (st.exposure > 0 && st.eqPct < st.guardPct) {
      const plan = guardPlan(st, cfg);
      const line = `Equity is ${pct(st.eqPct)} of stock — ${pct(st.guardPct)} is the guard line (maintenance ${pct(st.maint)} + 5); sells to ${pct(st.guardTarget)}.`;
      let E = st.exposure, D = st.debt;
      plan.legs.forEach((L, i) => {
        const before = { lev: st.equity > 0 ? E / st.equity : Infinity, debt: D };
        E -= L.s; D = Math.max(0, D - L.s);
        const last = i === plan.legs.length - 1;
        const title = L.core ? `Risk guard — core ${L.p.symbol} needed` : (i ? `Risk guard — ${L.p.symbol} too` : 'Risk guard');
        const why = i === 0 ? line : L.core ? `The other names are not enough to reach ${pct(st.guardTarget)}. The core is your call — a margin call would sell it anyway.` : `${plan.legs[0].p.symbol} alone is not enough to reach ${pct(st.guardTarget)}.`;
        const r = { kind: 'risk', title, why: last && plan.short > 0 ? why + ` Still $${k(plan.short)} short after every sale${cfg.coreOwner ? ' (' + cfg.core + ' excluded — your call)' : ''} — deposit cash.` : why,
          ticket: { side: 'sell', sym: L.p.symbol, qty: L.qty, px: round(L.p.px * 0.995), tranche: i === 0 && !L.core, core: L.core || undefined } };
        r.before = before;
        r.after = { lev: st.equity > 0 ? E / st.equity : 0, debt: D, proceeds: L.s };
        if (last) r.after.check = { eqPct: plan.after.eqPct, guardPct: plan.after.guardPct, guardTarget: plan.after.guardTarget, maint: plan.after.exposure > 0 ? plan.after.req / plan.after.exposure : 0, ok: plan.short === 0, short: plan.short };
        out.push(r);
      });
      if (!plan.legs.length) out.push(t('risk', 'Risk guard — nothing to sell', `${line} No holding can be sold for it — deposit $${k(plan.short)} to pay debt.`, null, st));
    }

    // A2 Leverage band / de-lever ladder.
    if (st.lev > C.LEV_CAP) {
      const need = sellToLev(st, C.LEV_CAP);
      out.push(t('lev', `Over the ${C.LEV_CAP}x cap`, `${st.lev.toFixed(2)}x. No new buys. Sell $${k(need)} into strength to reach the cap; proceeds pay debt.`, null, st));
      for (const L of cfg.ladder) {
        const p = byName(L.sym); if (!p || (cfg.coreOwner && L.sym === cfg.core)) continue;
        const live = p.px >= L.px;
        out.push(t('ladder', `${live ? 'Sell' : 'Armed: sell'} ${L.qty} ${L.sym} at $${L.px}`,
          live ? `Price ${money(p.px)} is through the rung — ${L.note || ''}` : `Fires when ${L.sym} prints $${L.px} (now ${money(p.px)}). ${L.note || ''}`,
          { side: 'sell', sym: L.sym, qty: Math.min(L.qty, p.qty), px: L.px, gtc: true, armed: !live }, st, L.sym, Math.min(L.qty, p.qty), L.px));
      }
    } else if (st.lev > C.LEV_NORMAL) {
      out.push(t('lev', 'Inside the band, above cruise', `${st.lev.toFixed(2)}x — hold. Trims pay debt down toward ${C.LEV_NORMAL}x before anything new.`, null, st));
    }

    // A3 Winner / A4 Loser — per name, reuse the SD dials.
    for (const p of st.positions) {
      if (!(p.avg > 0)) continue;
      const g = p.px / p.avg - 1;
      if (cfg.coreOwner && p.symbol === cfg.core) { out.push(t('core', `${p.symbol} — your call`, `Owner-managed: Apex never proposes selling, trimming or adding ${p.symbol}. The book is built around it.`, null, st)); continue; }
      if (g >= C.TRIM_GAIN_2 || g >= C.TRIM_GAIN) {
        if (nearEarn(p.symbol)) { out.push(t('guard', `${p.symbol} trim waits for earnings`, `+${pct(g)} from cost but reports in ${earn[p.symbol].daysAway}d — trims after the print.`, null, st)); continue; }
        const qty = Math.floor(p.qty * C.TRIM_FRAC);
        if (qty > 0) out.push(t('win', `${p.symbol} +${pct(g)} — trim ${Math.round(C.TRIM_FRAC * 100)}%`, `Bank it against debt; set a trailing stop 15% under the high in the app.`,
          { side: 'sell', sym: p.symbol, qty, px: round(p.px * 0.995) }, st, p.symbol, qty, p.px));
      } else if (g <= -C.STOP && p.symbol === cfg.core && cfg.coreMax > 0) {
        const extra = Math.max(0, Math.floor(p.qty - cfg.coreMax));
        if (extra > 0) out.push(t('lose', `${p.symbol} ${pct(g)} — ${extra} sh above the core through the stop`, `Core of ${cfg.coreMax} is kept (your call); the shares above it follow the 25% stop. No averaging down.`,
          { side: 'sell', sym: p.symbol, qty: extra, px: round(p.px * 0.995) }, st, p.symbol, extra, p.px));
        else out.push(t('core', `${p.symbol} core held at ${pct(g)}`, `${Math.floor(p.qty)} sh ≤ the ${cfg.coreMax}-share core: exempt from the stop by your Nov 5 call. Never add to it on margin; trims only into strength (ladder).`, null, st));
      } else if (g <= -C.STOP) {
        out.push(t('lose', `${p.symbol} ${pct(g)} — through the 25% stop`, `Thesis rule (same as the plan's exit): sell, no averaging down on margin.`,
          { side: 'sell', sym: p.symbol, qty: p.qty, px: round(p.px * 0.995) }, st, p.symbol, p.qty, p.px));
      }
    }

    /* A4b Research exits (v211 — Jack, Nov 11 2026: "u tell me tp or sl spots … when a price hits the correct tp or sl
       the app is telling me"). A held name with research levels is flagged the moment its price is at or through the
       RESEARCH target or the RESEARCH stop. The prices of Jack's own resting orders are never read. Core excluded
       (owner-managed). One sell line per name: a 25%-stop or winner ticket already on the name keeps the ticket. */
    for (const p of st.positions) {
      if (p.symbol === cfg.core) continue;
      const L = levelsFor(cfg, p.symbol); if (!L) continue;
      const has = out.some((r) => r.ticket && r.ticket.side === 'sell' && r.ticket.sym === p.symbol);
      const tk = has ? null : { side: 'sell', sym: p.symbol, qty: p.qty, px: round(p.px * 0.995) };
      if (L.tp1 > 0 && p.px >= L.tp1)
        out.push(t('tp', `${p.symbol} is at its research target ${money(L.tp1)}`, `Now ${money(p.px)}. Take profit${has ? ' — the sell line is above' : `: sell ${p.qty}`}, or confirm with Claude for a new target.`, tk, st, p.symbol, p.qty, p.px));
      else if (L.stop > 0 && p.px <= L.stop)
        out.push(t('sl', `${p.symbol} is through its research stop ${money(L.stop)}`, `Now ${money(p.px)}${L.stopBasis ? ' · stop basis ' + L.stopBasis : ''}. Exit${has ? ' — the sell line is above' : `: sell ${p.qty}`}. No averaging down on margin.`, tk, st, p.symbol, p.qty, p.px));
    }

    // A5 Per-name cap (= SD_SINGLE_MAX_EQ) — advisory, weekly.
    if (review) {
      for (const p of st.positions) {
        const w = st.weights[p.symbol] || 0, tgt = (cfg.targets[p.symbol] || 0) / 100;
        if (p.symbol === cfg.core && (cfg.coreOwner || (w > tgt && p.qty <= cfg.coreMax))) continue;   // v201: owner-managed core never drifts   // v188: a core ≤ coreMax is never drift-trimmed
        if (tgt > 0 && Math.abs(w - tgt) * 100 >= C.DRIFT_PTS)
          out.push(t('drift', `${p.symbol} ${pct(w)} vs ${pct(tgt)} target`, w > tgt ? 'Trim back to target at the Monday review.' : 'Add back to target — only with leverage room.', null, st));
      }
    }

    // A6 Reload — only when winning and under the reload line (C.LEV_RELOAD).
    const above50 = st.positions.filter((p) => sma[p.symbol] && sma[p.symbol].s50 && p.px > sma[p.symbol].s50).length;
    if (st.lev < C.LEV_RELOAD && st.positions.length >= 3 && above50 * 3 >= st.positions.length * 2) {
      const room = Math.max(0, C.LEV_NORMAL * st.equity - st.exposure);
      out.push(t('reload', 'Leverage reload open', `${above50}/${st.positions.length} names above their 50-day and ${st.lev.toFixed(2)}x < ${C.LEV_RELOAD}x: up to $${k(room)} may be added to the top-2 momentum names.`, null, st));
    } else if (st.lev < C.LEV_RELOAD && st.lev <= C.LEV_CAP) {
      /* v188 BUILD ON CONFIRMATION (Jack, 2026-11-05: "I expect a new portfolio"). Room exists but the
         trend filter is shut, so the book is built with ARMED buy-stop-limits only — they fill only if
         a name takes out max(prior high, 10-day EMA) × 1.005. The scan writes exact triggers in Jarvis;
         this card shows the split. Core is never added to. */
      const room = Math.max(0, C.LEV_NORMAL * st.equity - st.exposure);
      const names = Object.keys(cfg.targets).filter((s) => s !== cfg.core && !nearEarn(s));
      const W = names.reduce((a, s) => a + cfg.targets[s], 0);
      if (room >= 100 && W > 0) {
        for (const s of names) {
          const held = (byName(s) || { val: 0 }).val;
          const cap = Math.max(0, C.SINGLE_MAX_EQ * st.equity - held);
          const alloc = Math.min(cap, room * cfg.targets[s] / W);
          const px = (sma[s] && sma[s].px) || (byName(s) || {}).px || 0;
          const L = levelsFor(cfg, s);
          /* v202: a target inside the 30-day wash-sale window (a loss sale in either account — cfg.wash, built from
             the dashboard's cross-account ledger) is a TAX HOLD: a dated row, never a buy rung, until the window clears. */
          const hold = cfg.wash && cfg.wash[s];
          if (hold && hold.clear) {
            out.push(t('wash', `${s} — tax hold to ${hold.clear}`, `Sold at a loss inside the last 30 days, so buying before ${hold.clear} is a wash sale (the loss is deferred into the new shares). No buy until then.`, null, st));
            continue;
          }
          /* v194 (Jack, 2026-11-06 11:35: "make sure all can be bought on Robinhood always"): a name the
             scan marked untradable on ••0741 never becomes a buy rung. */
          if (L && L.tradable === false) {
            out.push(t('skip', `${s} skipped — not buyable on Robinhood`, `Robinhood reports ${L.name || s} as not tradable in this account${L.tradableAt ? ' (' + L.tradableAt + ')' : ''}. The scan drops it next run.`, null, st));
            continue;
          }
          /* v194 (Jack, 11:34: "always put the entry target prices"): with the scan's levels the rung shows
             trigger → limit, target, stop and reward/risk AT THAT ENTRY, and sizes at the limit exactly like
             the Jarvis ticket (floor(budget ÷ limit)). Without levels it falls back to the v188 live-price sizing. */
          const sizePx = L && L.limit > 0 ? L.limit : px;
          const qty = sizePx > 0 ? Math.floor(alloc / sizePx) : 0;
          if (L && L.trigger > 0) {
            const away = px > 0 ? L.trigger / px - 1 : null;
            const tk = { side: 'buy', sym: s, qty, px: round(px), armed: true, trigger: L.trigger, limit: L.limit, tp1: L.tp1, stop: L.stop, rr: L.rr, away, name: L.name || null, tradable: L.tradable };
            const r = t('build', `Armed: buy ${qty > 0 ? qty + ' ' : ''}${s} at ${money(L.trigger)} · $${k(qty > 0 ? qty * L.limit : alloc)}`,
              `Fills only if ${s} bounces through ${money(L.trigger)}${away != null ? ` (now ${money(px)}, ${away >= 0 ? '+' : ''}${(away * 100).toFixed(1)}% away)` : ''}. Room $${k(room)} to ${C.LEV_NORMAL}x.`,
              qty > 0 ? tk : null, st);
            r.levels = tk;
            if (L.rr != null && L.rr < C.RR_MIN) r.lowRR = true;
            out.push(r);
          } else {
            out.push(t('build', `Armed: buy ${qty > 0 ? qty + ' ' : ''}${s} · $${k(alloc)}`, `${st.lev.toFixed(2)}x with $${k(room)} of room to ${C.LEV_NORMAL}x, but the trend filter is shut — buy-stop-limit fills only on a bounce through the prior high / 10-day EMA.`,
              qty > 0 ? { side: 'buy', sym: s, qty, px: round(px), armed: true } : null, st));
          }
        }
      }
    }

    // A7 Earnings guard — informational for any add.
    for (const p of st.positions) if (nearEarn(p.symbol) && !out.some((r) => r.kind === 'guard' && r.title.startsWith(p.symbol)))
      out.push(t('guard', `${p.symbol} reports in ${earn[p.symbol].daysAway}d`, 'No adds inside 3 trading days of a print.', null, st));

    const order = { risk: 0, lev: 1, ladder: 2, lose: 3, sl: 3, win: 4, tp: 4, core: 5, guard: 6, drift: 7, reload: 8, build: 9, wash: 10, skip: 10 };
    return out.sort((a, b) => order[a.kind] - order[b.kind]);
  }

  /* v194 — the scan's levels for one name: cfg.levels[sym] = {trigger, limit?, tp1, stop, name?, tradable?}.
     limit defaults to trigger × 1.01 (the scan's convention); rr is reward ÷ risk at the LIMIT — the worst
     fill a buy-stop-limit can get — so it is never flattered by yesterday's lower close. */
  /* v211 (Jack, Nov 11 2026: "My manual inputs should never be accounted for" · "the recs are from deep research"):
     a stop the scan copied from one of Jack's own resting Robinhood orders (stopBasis "Jack's open stop") is NOT a
     research level. It is dropped and replaced by the scan's own default basis, 2 × ATR14 under the limit, when the
     row carries an ATR; otherwise the name has no stop (and no R/R) until the next research run. */
  const OWNER_STOP = /jack|owner|\bhis\b|\bmy\b|open (robinhood )?(stop|order)/i;
  function levelsFor(cfg, sym) {
    const L = cfg && cfg.levels && cfg.levels[sym];
    if (!L) return null;
    const n = (v) => (v == null || v === '' || isNaN(+v) ? null : +v);
    const trigger = n(L.trigger), tp1 = n(L.tp1), atr = n(L.atr);
    const limit = n(L.limit) || (trigger ? round(trigger * (1 + C.LIMIT_PAD)) : null);
    let stop = n(L.stop), stopBasis = L.stopBasis ? String(L.stopBasis) : null, ownerStop = false;
    if (stopBasis && OWNER_STOP.test(stopBasis)) {
      ownerStop = true;
      stop = limit && atr > 0 && limit - 2 * atr > 0 ? round(limit - 2 * atr) : null;
      stopBasis = stop ? '2×ATR' : null;
    }
    const rr = limit && tp1 && stop && limit > stop ? (tp1 - limit) / (limit - stop) : null;
    return { trigger, limit, tp1, stop, stopBasis, ownerStop, rr, name: L.name || null, tradable: L.tradable === false ? false : (L.tradable === true ? true : null), tradableAt: L.tradableAt || null };
  }

  function t(kind, title, why, ticket, st, sym, qty, px) {
    const r = { kind, title, why, ticket: ticket || null };
    if (ticket && sym && qty > 0 && px > 0) {
      const proceeds = qty * px;
      const debt2 = Math.max(0, st.debt - proceeds), exp2 = st.exposure - proceeds;
      const lev2 = st.equity > 0 ? exp2 / st.equity : 0;
      r.before = { lev: st.lev, debt: st.debt };
      r.after = { lev: lev2, debt: debt2, proceeds };
    }
    return r;
  }

  /* ── format helpers (no DOM) ───────────────────────────────────────────── */
  function pct(x) { return (x * 100).toFixed(0) + '%'; }
  function k(x) { return x >= 1000 ? (x / 1000).toFixed(1) + 'K' : Math.round(x).toString(); }
  function money(x) { return '$' + (+x).toFixed(2); }
  function round(x) { return Math.round(x * 100) / 100; }

  /* ── render ─────────────────────────────────────────────────────────────── */
  function render(el, st, out, cfg, research) {
    if (!el) return;
    cfg = Object.assign({}, DEFAULT_CFG, cfg || {});
    const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const levCol = st.lev > C.LEV_CAP ? '#ef4444' : st.lev > C.LEV_NORMAL ? '#f97316' : '#10b981';
    const cushCol = st.cushion < 0.05 * st.exposure ? '#ef4444' : st.cushion < 0.12 * st.exposure ? '#f97316' : '#10b981';
    const eqPct = Math.max(0, Math.min(100, st.eqPct * 100));
    const bandTxt = { over: 'over the cap — de-lever', high: 'above cruise — hold', normal: 'in band — build', room: 'room to reload' }[st.band];
    const tile = (l, v, c) => `<div class="snap-tile"><div class="snap-lbl">${l}</div><div class="snap-val" style="color:${c || 'var(--text)'}">${v}</div></div>`;
    const tw = tripwire(st, cfg.core);
    const kindTag = { risk: ['#fee2e2', '#991b1b', 'risk guard'], lev: ['#fef3c7', '#92400e', 'leverage'], ladder: ['#fef3c7', '#92400e', 'ladder'], win: ['#d1fae5', '#065f46', 'winner'], tp: ['#d1fae5', '#065f46', 'target hit'], lose: ['#fee2e2', '#991b1b', 'stop'], sl: ['#fee2e2', '#991b1b', 'research stop'], drift: ['#e0e7ff', '#3730a3', 'drift'], reload: ['#d1fae5', '#065f46', 'reload'], guard: ['#f3f4f6', '#374151', 'earnings'], core: ['#e0f2fe', '#075985', 'core'], build: ['#d1fae5', '#065f46', 'build · armed'], skip: ['#f3f4f6', '#374151', 'not buyable'], wash: ['#fef3c7', '#92400e', 'tax hold'] };
    const rows = out.length ? out.map((r) => {
      const tg = r.lowRR ? ['#fee2e2', '#991b1b', 'below R/R floor'] : (kindTag[r.kind] || kindTag.guard);
      const tk = r.levels ? levelsHtml(r.levels, esc) : r.ticket && !r.after && r.ticket.side === 'buy' ? `<div style="font-size:11.5px;margin-top:4px;color:var(--text);opacity:.8">Buy ${r.ticket.qty} ${esc(r.ticket.sym)} · ~${money(r.ticket.px)} now · <b>armed</b> — trigger in Jarvis</div>` : r.ticket && r.after ? `<div style="font-size:11.5px;margin-top:4px;color:var(--text);opacity:.8">${r.ticket.side === 'sell' ? 'Sell' : 'Buy'} ${r.ticket.qty} ${esc(r.ticket.sym)} · limit ${money(r.ticket.px)}${r.ticket.gtc ? ' GTC' : ''} → ${r.after.lev.toFixed(2)}x · debt $${k(r.after.debt)}${r.ticket.armed ? ' · <b>armed</b>' : ''}</div>` : '';
      return `<div class="flag-card" style="border-left-color:${tg[1]};background:${tg[0]}22"><div style="display:flex;justify-content:space-between;gap:8px;align-items:center"><b style="font-size:12.5px">${esc(r.title)}</b><span class="act-tag" style="background:${tg[0]};color:${tg[1]};margin:0;white-space:nowrap">${tg[2]}</span></div><div class="flag-body">${esc(r.why)}</div>${tk}</div>`;
    }).join('') : '<div class="tech-empty">No rule fires. Hold.</div>';
    /* v203 (Jack, Nov 9 01:38 ET: "make sure apex is showing the recommended shares and dollar amounts in each
       ticker"): every weights row carries a second line — what you HOLD (shares · $), the full TARGET (shares at
       the current price · $), and THIS WEEK's armed buy (shares · $) from the build rung when one exists. The
       core only shows what is held. Share counts come straight from the rung (sized at the limit), so the line
       can never disagree with the ticket. */
    const posBy = {}; st.positions.forEach((p) => { posBy[p.symbol] = p; });
    const rungBy = {}; out.forEach((r) => { if (r.kind === 'build' && r.ticket) rungBy[r.ticket.sym] = r.ticket; });
    const sizeLine = (s, tg) => {
      const p = posBy[s], held = p ? `hold ${p.qty % 1 ? p.qty.toFixed(2) : p.qty} sh · $${k(p.val)}` : 'hold 0 sh';
      if (cfg.coreOwner && s === cfg.core) return `<div style="font-size:10.5px;color:#6b7280;margin:-2px 0 6px 52px">${held} · yours</div>`;
      const L = levelsFor(cfg, s) || {}, tgtD = tg / 100 * st.equity, px = p ? p.px : (rungBy[s] ? rungBy[s].px : (L.limit || L.trigger || 0)), tgtSh = px > 0 ? Math.floor(tgtD / px) : null;
      const tk = rungBy[s], wk = tk ? ` · <b style="color:#065f46">this week: buy ${tk.qty} sh ≈ $${k(tk.qty * (tk.limit || tk.px))}</b>` : (cfg.wash && cfg.wash[s] && cfg.wash[s].clear ? ` · tax hold to ${esc(cfg.wash[s].clear)}` : '');
      /* v211: the research exit levels sit under every held target name — these, not Jack's own order prices, are what the card alerts on. */
      const ex = p && (L.stop > 0 || L.tp1 > 0) ? `<br><span data-apex-exit="${esc(s)}">research exit: stop <b>${L.stop > 0 ? money(L.stop) : 'next scan'}</b> · target <b>${L.tp1 > 0 ? money(L.tp1) : 'next scan'}</b></span>` : '';
      return `<div style="font-size:10.5px;color:#6b7280;margin:-2px 0 6px 52px">${held} · target $${k(tgtD)}${tgtSh != null ? ` (${tgtSh} sh${p ? '' : ' at the scan limit'})` : ''}${wk}${ex}</div>`;
    };
    const mix = Object.keys(cfg.targets).map((s) => { const w = (st.weights[s] || 0) * 100, tg = cfg.targets[s];
      /* v202: the owner-managed core has no target to be over — a neutral bar, no tick, no orange (Jack, Nov 8: stop telling me to sell IREN). */
      if (cfg.coreOwner && s === cfg.core) return `<div class="stress-row" style="margin-bottom:4px"><span style="width:52px;font-size:12px;font-weight:600">${esc(s)}</span><div class="gauge" style="flex:1;margin:0;position:relative"><div style="width:${Math.min(100, w)}%;height:100%;background:#9ca3af"></div></div><span style="width:74px;text-align:right;font-size:11px;color:#6b7280">${w.toFixed(0)}% · yours</span></div>` + sizeLine(s, tg);
      const hold = cfg.wash && cfg.wash[s] && cfg.wash[s].clear ? ` <span title="tax hold to ${esc(cfg.wash[s].clear)}">🚫</span>` : '';
      return `<div class="stress-row" style="margin-bottom:4px"><span style="width:52px;font-size:12px;font-weight:600;white-space:nowrap">${esc(s)}${hold}</span><div class="gauge" style="flex:1;margin:0;position:relative"><div style="width:${Math.min(100, w)}%;height:100%;background:${w > tg + C.DRIFT_PTS ? '#f97316' : '#3b82f6'}"></div><div style="position:absolute;left:${Math.min(100, tg)}%;top:-2px;width:2px;height:10px;background:#10b981"></div></div><span style="width:74px;text-align:right;font-size:11px;color:#6b7280">${w.toFixed(0)}% / ${tg}%</span></div>` + sizeLine(s, tg); }).join('');
    el.innerHTML = `
      <div style="font-size:11.5px;color:var(--text);opacity:.75;margin:-2px 0 10px;line-height:1.5">Leverage loop for the margin book — band ${C.LEV_NORMAL}x cruise / ${C.LEV_CAP}x cap, call line at ${pct(st.maint)} maintenance. Rules fire here; <b>approvals live in Jarvis</b>; you place the order in Robinhood.</div>
      <div class="snap-grid">${tile('Leverage', st.lev === Infinity ? 'call' : st.lev.toFixed(2) + 'x', levCol)}${tile('Margin debt', '$' + k(st.debt), st.debt > 0 ? '#ef4444' : 'var(--text)')}${tile('Cushion to call', '$' + k(Math.max(0, st.cushion)), cushCol)}${tile('Band', bandTxt, levCol)}</div>
      <div style="margin:12px 0 2px;font-size:11px;color:#6b7280;display:flex;justify-content:space-between"><span>Equity ${pct(st.eqPct)} of stock</span><span>call ${pct(st.maint)} · guard ${pct(st.guardPct)} · ${C.LEV_CAP}x = ${pct(1 / C.LEV_CAP)}</span></div>
      <div class="gauge" style="position:relative;height:10px;overflow:visible"><div style="width:${eqPct}%;height:100%;background:${levCol};border-radius:3px"></div><div style="position:absolute;left:${st.maint * 100}%;top:-3px;width:2px;height:16px;background:#ef4444"></div><div style="position:absolute;left:${Math.min(99.5, st.guardPct * 100)}%;top:-3px;width:2px;height:16px;background:#f97316"></div><div style="position:absolute;left:${100 / C.LEV_CAP}%;top:-3px;width:2px;height:16px;background:#10b981"></div></div>
      ${tw ? `<div style="font-size:11.5px;color:#6b7280;margin-top:8px">Tripwire: ${esc(cfg.core)} at <b style="color:var(--text)">${money(tw)}</b> puts equity on the guard line (others flat) — the ${esc(cfg.donor)} tranche ticket is pre-built for that print.</div>` : ''}
      <div class="ac-tier">⚙️ Rules firing now</div>${rows}
      ${portfolioButton(st, out, cfg, research)}
      <div data-apex-business></div>
      <div class="ac-tier">🎯 Weights vs target <span class="card-hint">(% of equity · held → target in shares and $ · cap ${pct(C.SINGLE_MAX_EQ)})</span></div>${mix}
      ${researchBlock(research, esc)}
      <div class="ac-tier">🧪 What if</div>
      <div id="apex-whatif"></div>
      <div style="font-size:11px;color:#9ca3af;margin-top:10px">Tickets are proposals from these rules. Approve or decline them in <a href="${esc(cfg.jarvis)}" target="_blank" rel="noopener" style="color:#2563eb">Jarvis</a>; the morning scan (7:12 AM ET, weekdays) writes them there and logs fills the next day.</div>`;
    renderWhatIf(el.querySelector('#apex-whatif'), st, cfg);
  }

  /* v205 (Nov 9 2026, first Monday v2.2 book): the week's book is NOT only armed build rungs. Builds fire only under
     1.2x, so a book already at 1.25x with half-filled names and a new target name produced ZERO countable orders and
     the Confirm button vanished on the very morning it was meant for. bookGaps() reads the gap between what is held
     and the research target: ADD for a target name ≥ 2 pts under its weight (not already a build rung), EXIT for a
     held non-core name the research dropped. Proposals only — Claude still checks each one live. */
  function bookGaps(st, out, cfg) {
    const eq = st.equity > 0 ? st.equity : 0; if (!eq) return { adds: [], exits: [] };
    const built = new Set((out || []).filter((r) => r.kind === 'build' && r.levels).map((r) => r.levels.sym));
    const held = {}; (st.positions || []).forEach((p) => { held[p.symbol] = p; });
    const adds = [], exits = [];
    Object.keys(cfg.targets || {}).forEach((sym) => {
      if (sym === cfg.core || built.has(sym) || (cfg.wash && cfg.wash[sym] && cfg.wash[sym].clear)) return;
      const tgt = +cfg.targets[sym] || 0, p = held[sym], have = p ? (p.qty * p.px) / eq * 100 : 0;
      if (tgt - have >= 2) adds.push({ sym, have, tgt, dollars: (tgt - have) / 100 * eq, lv: levelsFor(cfg, sym) });
    });
    (st.positions || []).forEach((p) => { if (p.symbol !== cfg.core && !(cfg.targets || {})[p.symbol] && p.qty > 0) exits.push({ sym: p.symbol, qty: p.qty, px: p.px }); });
    return { adds, exits };
  }

  /* v199 (Jack, Nov 8 22:33 ET: "full recommended portfolios … the research feeds me the new portfolio each week and
     I one click to confirm"): ONE button on the Apex card opens a Claude chat that checks the WHOLE proposed book
     against live Robinhood data and returns the complete order set — YES / WAIT / NO per name, sized, with prices.
     ••••0741 is read-only to every agent, so the prompt forbids review/place_equity_order; Jack enters the YES lines.
     Pure string builder over the rows render() already has. */
  function portfolioPrompt(st, out, cfg, research) {
    const f = (x) => (x > 0 && isFinite(x) ? '$' + (+x).toFixed(2) : '—');
    const builds = (out || []).filter((r) => r.kind === 'build' && r.levels);
    const sells = (out || []).filter((r) => r.ticket && r.ticket.side === 'sell');
    const held = (st.positions || []).map((p) => `${p.symbol} ${p.qty} sh @ ${f(p.px)}${p.symbol === cfg.core ? (cfg.coreOwner ? ' (OWNER-MANAGED — Jack handles it; never propose selling, trimming or adding it)' : ' (core — keep ≤ ' + cfg.coreMax + ' sh, never add)') : ''}`).join('; ') || 'none';
    const L = ['Apex weekly book check — this is the FULL recommended portfolio for my SELF-DIRECTED margin account (••••0741). Check every line against LIVE Robinhood data and give me the complete set of orders to place: YES / WAIT / NO per name, sized, with exact prices. The account is read-only to you: Robinhood READ tools only (quotes, technical indicators, fundamentals, earnings calendar, news) — never review_equity_order or place_equity_order. I enter every YES myself in the Robinhood app.', '',
      `Book now: equity $${k(st.equity)} · margin debt $${k(st.debt)} · leverage ${isFinite(st.lev) ? st.lev.toFixed(2) + 'x' : 'n/a'} (cruise ${C.LEV_NORMAL}x, cap ${C.LEV_CAP}x) · maintenance ${pct(st.maint)}. Held: ${held}.`,
      'Target weights (% of equity): ' + Object.keys(cfg.targets).filter((s) => !(cfg.coreOwner && s === cfg.core)).map((s) => s + ' ' + cfg.targets[s] + '%').join(' · ') + (cfg.coreOwner ? ' — plus ' + cfg.core + ', owner-managed (no target)' : '') + '.',
      ...(cfg.wash && Object.keys(cfg.wash).some((s) => cfg.targets[s] && cfg.wash[s] && cfg.wash[s].clear) ? ['TAX HOLD (wash sale — sold at a loss inside 30 days): ' + Object.keys(cfg.wash).filter((s) => cfg.targets[s] && cfg.wash[s] && cfg.wash[s].clear).map((s) => s + ' until ' + cfg.wash[s].clear).join(' · ') + ' — WAIT; no buy before that date.'] : [])];
    /* v211: held names carry their RESEARCH stop and target into the check, so Claude never has to fall back on the prices of Jack's own resting orders. */
    const lvHeld = (st.positions || []).filter((p) => p.symbol !== cfg.core).map((p) => ({ p, lv: levelsFor(cfg, p.symbol) })).filter((x) => x.lv && (x.lv.stop > 0 || x.lv.tp1 > 0));
    if (lvHeld.length) L.push('Research exit levels for held names (the only stop and target that count): ' + lvHeld.map((x) => `${x.p.symbol} stop ${f(x.lv.stop)} · target ${f(x.lv.tp1)}`).join('; ') + '.');
    L.push('', 'Proposed buys (armed buy-stop-limits from this week\u2019s research; levels from a static snapshot — re-check live):');
    builds.forEach((r) => { const t = r.levels; L.push(`• BUY ${t.qty > 0 ? t.qty + ' sh ' : ''}${t.sym}${t.name ? ' (' + t.name + ')' : ''} — trigger ${f(t.trigger)} · limit ${f(t.limit)} · target ${f(t.tp1)} · stop ${f(t.stop)}${t.rr != null ? ' · scan R/R ' + (+t.rr).toFixed(2) : ''}${r.lowRR ? ' · BELOW 1.5 R/R floor at this entry' : ''}`); });
    const gaps = bookGaps(st, out, cfg);
    gaps.adds.forEach((g) => { const t = g.lv; L.push(`• ADD ${g.sym}${t && t.name ? ' (' + t.name + ')' : ''} — held ${g.have.toFixed(1)}% → target ${g.tgt.toFixed(1)}% of equity (≈ $${k(g.dollars)})${t ? ` · research entry ${f(t.trigger)} · limit ${f(t.limit)} · target ${f(t.tp1)} · stop ${f(t.stop)}${t.rr != null ? ' · R/R at limit ' + t.rr.toFixed(2) + (t.rr < C.RR_MIN ? ' (BELOW 1.5 floor)' : '') : ''}` : ''}`); });
    if (!builds.length && !gaps.adds.length) L.push('• (none this pass)');
    if (gaps.exits.length) { L.push('', 'Held names the research DROPPED this week (exit unless you tell me otherwise — check the wash-sale window and earnings first):'); gaps.exits.forEach((g) => L.push(`• SELL ${g.qty} ${g.sym} — last ${f(g.px)} · proposed limit ${f(round(g.px * 0.995))} Day`)); }
    if (sells.length) { L.push('', 'Proposed sells / trims from the rules:'); sells.forEach((r) => L.push(`• SELL ${r.ticket.qty} ${r.ticket.sym} — ${r.ticket.px ? 'limit ' + f(r.ticket.px) : 'market'}${r.ticket.gtc ? ' GTC' : ''} — ${r.title}`)); }
    const extra = research && research.rows ? research.rows.filter((r) => r.trigger && !cfg.targets[r.sym]).slice(0, 3) : [];
    if (extra.length) { L.push('', 'Research names NOT in the target (for context only, do not add unless one clearly beats a target name): ' + extra.map((r) => `${r.sym} entry ${f(r.trigger)} → ${f(r.tp1)} · stop ${f((levelsFor({ levels: { [r.sym]: r } }, r.sym) || {}).stop)}`).join('; ')); }
    L.push('', 'Rules to apply per name: live last + today\u2019s range; within 3% of the 20-day high ⇒ WAIT for a pullback unless momentum is strong; earnings inside 3 trading days ⇒ WAIT; guidance cut / dilution / investigation / exec exit inside 10 days ⇒ NO; reward/risk at the limit vs stop and target under 1.5 ⇒ NO; a TAX HOLD name ⇒ WAIT until its date; per-name cap 20% of equity; the book must stay under ' + C.LEV_CAP + 'x after fills; several AI/compute names count as one bet. My own resting Robinhood orders (stops, limits, OCO legs) are NEVER an input: do not use their prices as the stop or target for reward/risk, a score or a verdict. Use the research stop and target; where one is missing, derive it from live data (stop = 2 × ATR14 under the entry, never closer than 1 × ATR14; target = the 60-day high), label it derived, and give me the research stop and target for every name I hold.' + (cfg.coreOwner ? ' ' + cfg.core + ' is owner-managed: build the rest of the book around it as held — never tell me to sell or trim ' + cfg.core + ' to make room, fix leverage or fit a cap; if room is short, size the new buys down instead.' : ''),
      /* v211 (Jack, Nov 11 2026, screenshot of an 8-column table cut off on his iPhone: "I want the orders easy to read in one view on iOS no scrolling"). */
      'FORMAT — it must fit ONE iPhone screen with no sideways or vertical scrolling. No table wider than 3 columns, no cell longer than about 14 characters. In this order: (1) one verdict line: how many orders to place today. (2) ORDERS, numbered, one short line each, in the order I should enter them: "SELL 4 SNPS · limit $464.00 · Day" (for a breakout: "BUY 3 ZS · stop $x → limit $y · GTC"); a step like cancelling a resting order is its own numbered line. (3) one line: leverage after fills. (4) one 3-column table for the names I hold — Ticker | Stop | Target (research levels). (5) one line "No action:" listing every other name with a 2–3 word reason each. Nothing else: no long table, no why column, no paragraphs; I ask "more" if I want the reasoning. Education only — not financial advice.');
    return L.join('\n');
  }
  /* v212 (Jack, Nov 11 2026, screenshot of the button reading only "1 order": "somewhere here it's gotta tell me what
     trades it's recommended that I click to confirm"). bookLines() is the SAME set the button counts and the prompt
     sends — build rungs, under-target adds, research-dropped exits, rule sells — as one short line each. Prices are
     the snapshot's; the confirm step re-prices live. Pure. */
  function bookLines(st, out, cfg) {
    const q = (x) => (Math.abs(x - Math.round(x)) < 1e-9 ? String(Math.round(x)) : (+x).toFixed(2));
    const lines = [];
    (out || []).filter((r) => r.kind === 'build' && r.levels).forEach((r) => { const t = r.levels;
      lines.push({ side: 'buy', sym: t.sym, text: `Buy ${t.qty > 0 ? q(t.qty) + ' ' : ''}${t.sym}`, px: t.limit > 0 ? 'limit ' + money(t.limit) + ' · GTC' : '', sub: `${t.tp1 > 0 ? 'target ' + money(t.tp1) : ''}${t.stop > 0 ? ' · stop ' + money(t.stop) : ''}`.replace(/^ · /, '') }); });
    const g = bookGaps(st, out, cfg);
    g.adds.forEach((a) => { const t = a.lv || {}, sh = t.limit > 0 ? Math.floor(a.dollars / t.limit) : 0;
      lines.push({ side: 'buy', sym: a.sym, text: `Add ${sh > 0 ? sh + ' ' : ''}${a.sym}`, px: t.limit > 0 ? 'limit ' + money(t.limit) + ' · GTC' : '≈ $' + k(a.dollars) + ' · price at confirm', sub: `to ${a.tgt.toFixed(0)}% of equity (now ${a.have.toFixed(0)}%)${t.tp1 > 0 ? ' · target ' + money(t.tp1) : ''}${t.stop > 0 ? ' · stop ' + money(t.stop) : ''}` }); });
    /* v213 (Jack, Nov 11 2026: "Sell or buy at what price"): every line carries the price to ENTER — a research-dropped
       exit uses the scan's swap rule, limit = last × 0.995, Day (same as the rule sells) — never just "last". */
    g.exits.forEach((e) => lines.push({ side: 'sell', sym: e.sym, text: `Sell ${q(e.qty)} ${e.sym}`, px: e.px > 0 ? 'limit ' + money(round(e.px * 0.995)) + ' · Day' : '', sub: `dropped by this week\u2019s research${e.px > 0 ? ' · last ' + money(e.px) : ''}` }));
    (out || []).filter((r) => r.ticket && r.ticket.side === 'sell').forEach((r) => lines.push({ side: 'sell', sym: r.ticket.sym, text: `Sell ${q(r.ticket.qty)} ${r.ticket.sym}`, px: r.ticket.px > 0 ? 'limit ' + money(r.ticket.px) + (r.ticket.gtc ? ' · GTC' : ' · Day') : '', sub: r.title }));
    return lines;
  }
  function portfolioButton(st, out, cfg, research) {
    const lines = bookLines(st, out, cfg);
    const n = lines.length;
    if (!n) return '';
    const escH = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const rows = lines.map((l) => `<div data-apex-trade="${escH(l.sym)}" style="display:flex;align-items:baseline;gap:8px;padding:7px 10px;border-top:1px solid rgba(0,0,0,.06);min-width:0"><span style="flex:0 0 auto;font-size:10px;font-weight:700;letter-spacing:.04em;padding:2px 6px;border-radius:6px;background:${l.side === 'sell' ? '#fee2e2' : '#d1fae5'};color:${l.side === 'sell' ? '#991b1b' : '#065f46'}">${l.side === 'sell' ? 'SELL' : 'BUY'}</span><span style="flex:1 1 auto;min-width:0"><b style="font-size:13px">${escH(l.text)}</b>${l.px ? ` <span style="font-size:12px;white-space:nowrap">· ${escH(l.px)}</span>` : ''}${l.sub ? `<br><span style="font-size:10.5px;color:#6b7280;overflow-wrap:anywhere">${escH(l.sub)}</span>` : ''}</span></div>`).join('');
    const list = `<div class="ac-tier">🧾 Recommended trades <span class="card-hint">(${n} · the price to enter, from the last snapshot — the confirm re-prices it live)</span></div><div data-apex-trades style="border:1px solid rgba(0,0,0,.08);border-radius:12px;overflow:hidden;margin-bottom:8px">${rows.replace('border-top:1px solid rgba(0,0,0,.06);', '')}</div>`;
    return list + `<a href="https://claude.ai/new?q=${encodeURIComponent(portfolioPrompt(st, out, cfg, research))}" target="_blank" rel="noopener" style="display:block;text-align:center;margin:10px 0 2px;padding:11px 12px;border-radius:12px;background:#059669;color:#fff;font-weight:700;font-size:14px;text-decoration:none">✅ Confirm this week\u2019s Apex book with Claude <span style="font-weight:500;opacity:.85">· ${n} order${n === 1 ? '' : 's'}</span></a><div style="font-size:10.5px;color:#9ca3af;text-align:center;margin-bottom:6px">Claude re-checks every line live and returns YES / WAIT / NO with prices. You enter the YES lines in Robinhood.</div>`;
  }

  /* v194 — entry · target · stop · R/R as a 2×2 grid (fits 320px), then company name + a Robinhood link. */
  function levelsHtml(L, esc) {
    const sg = (a, b) => (a > 0 && b > 0 ? ((a / b - 1) * 100) : null);
    const pc = (x) => (x == null ? '' : `${x >= 0 ? '+' : ''}${x.toFixed(1)}% from entry`);
    const cell = (l, v, sub, col) => `<div style="background:var(--card,#fff);border:1px solid rgba(0,0,0,.08);border-radius:8px;padding:6px 8px;min-width:0"><div style="font-size:10px;color:#6b7280;text-transform:uppercase;letter-spacing:.04em">${l}</div><div style="font-size:13.5px;font-weight:700;color:${col || 'var(--text)'};white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${v}</div>${sub ? `<div style="font-size:10.5px;color:#6b7280;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${sub}</div>` : ''}</div>`;
    const low = L.rr != null && L.rr < C.RR_MIN;
    const grid = `<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:8px">${
      cell('Entry', L.trigger ? money(L.trigger) : '—', L.limit ? 'limit ' + money(L.limit) : '')}${
      cell('Target', L.tp1 ? money(L.tp1) : '—', pc(sg(L.tp1, L.limit)))}${
      cell('Stop', L.stop ? money(L.stop) : '—', pc(sg(L.stop, L.limit)))}${
      cell('R/R at entry', L.rr != null ? L.rr.toFixed(2) : '—', `floor ${C.RR_MIN}`, low ? '#dc2626' : '#059669')}</div>`;
    const qty = L.qty > 0 ? `Buy ${L.qty} ${esc(L.sym)} · ` : '';
    const name = L.name ? `<b>${esc(L.name)}</b> · ` : '';
    const link = `<a href="https://robinhood.com/stocks/${encodeURIComponent(L.sym)}" target="_blank" rel="noopener" style="color:#2563eb;white-space:nowrap">Open in Robinhood ↗</a>`;
    const warn = low ? `<div style="font-size:11.5px;margin-top:6px;color:#b91c1c;font-weight:600">Under your ${C.RR_MIN} R/R floor at this entry.</div>` : '';
    return `${grid}${warn}<div style="font-size:11.5px;margin-top:6px;color:var(--text);opacity:.85;line-height:1.45">${name}${qty}<b>armed</b> in Jarvis · ${link}</div>`;
  }

  /* v210 — Jack (Nov 11 2026, phone screenshot of a 50-name "News veto" paragraph): "Clean this up and merge".
     Same rows, re-shaped: one folded line with a count per reason; inside, names that share a reason are ticker
     chips, R/R misses are chips carrying the figure (levels on the chip's title and in the list under them), and
     one-off reasons stay as "SYM — why" rows. Labelled "screened out": most rows are trend / R/R gates, not news. */
  function vetoBlock(list, esc) {
    const rows = (Array.isArray(list) ? list : []).filter((v) => v && v.sym);
    if (!rows.length) return '';
    const label = (why) => /^price below SMA200\b/i.test(why) ? 'Below 200-day' : why;
    const groups = new Map(), rr = [], solo = [];
    rows.forEach((v) => {
      const why = String(v.why || '').trim();
      const m = /^R\/R at entry\s+(-?[\d.]+)\s*<\s*([\d.]+)\s*(?:\((.*)\))?$/.exec(why);
      if (m) { rr.push({ sym: v.sym, rr: m[1], floor: m[2], lv: m[3] || '' }); return; }
      if (!why) { solo.push({ sym: v.sym, why: '' }); return; }
      if (!groups.has(why)) groups.set(why, []);
      groups.get(why).push(v.sym);
    });
    const shared = [];
    groups.forEach((syms, why) => { if (syms.length > 1) shared.push({ why, syms }); else solo.push({ sym: syms[0], why }); });
    shared.sort((a, b) => b.syms.length - a.syms.length);
    const chip = (t, title) => `<span${title ? ' title="' + esc(title) + '"' : ''}>${t}</span>`;
    const head = (t, n) => `<div style="font-size:10.5px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:#b45309;margin:8px 0 4px">${esc(t)} · ${n}</div>`;
    const sum = shared.map((g) => chip(g.syms.length + ' ' + esc(label(g.why).toLowerCase())))
      .concat(rr.length ? [chip(rr.length + ' R/R under ' + esc(rr[0].floor))] : [])
      .concat(solo.length ? [chip(solo.length + ' other')] : []).join('');
    const body = shared.map((g) => head(label(g.why), g.syms.length) + `<div class="sd-chips">${g.syms.map((s) => chip(esc(s))).join('')}</div>`).join('') +
      (rr.length ? head('R/R under ' + rr[0].floor + ' at entry', rr.length) + `<div class="sd-chips">${rr.map((x) => chip(esc(x.sym) + ' <b>' + esc(x.rr) + '</b>', x.lv)).join('')}</div>` +
        (rr.some((x) => x.lv) ? `<details class="sd-more" style="margin-top:4px"><summary style="font-size:10.5px;color:#6b7280">Entry → target · stop</summary>${rr.filter((x) => x.lv).map((x) => `<div style="font-size:10.5px;color:#6b7280;line-height:1.5;overflow-wrap:anywhere"><b>${esc(x.sym)}</b> ${esc(x.lv)}</div>`).join('')}</details>` : '') : '') +
      (solo.length ? head('Other', solo.length) + solo.map((x) => `<div style="font-size:11px;line-height:1.5;color:var(--text);overflow-wrap:anywhere"><b>${esc(x.sym)}</b>${x.why ? ' — ' + esc(x.why) : ''}</div>`).join('') : '');
    return `<details class="sd-more apex-veto" data-apex-veto style="margin-top:8px"><summary style="display:flex;flex-wrap:wrap;align-items:center;gap:6px;color:#b45309;opacity:1"><span style="white-space:nowrap">⛔ ${rows.length} screened out ▾</span><span class="sd-chips">${sum}</span></summary>${body}</details>`;
  }

  /* v188 — weekly research, top 5. `research` = {asOf, source, rows:[{sym, score, px, rs3, fromHi, s50, why}]}
     from the dashboard's SD momentum lens (sdMomentum over SD_BENCH, freshness-gated). A name only
     becomes a ticket via the Friday swap rule in the scan (beats the weakest holding by ≥ 1.5). */
  function researchBlock(R, esc) {
    if (!R || !R.rows || !R.rows.length) return `<div class="ac-tier">🔬 Research — top 5</div><div class="tech-empty">${esc((R && R.empty) || 'No scored names yet (needs fresh daily bars).')}</div>`;
    const tiles = R.rows.slice(0, 5).map((r, i) => {
      const col = r.score >= 7 ? '#10b981' : r.score >= 5.5 ? '#f59e0b' : '#9ca3af';
      const up = r.s50 && r.px ? (r.px / r.s50 - 1) * 100 : null;
      if (r.why != null && r.rs3 == null) {
        /* v197 — R/R is measured at the entry this tile shows (limit, else trigger × 1.01), the same way as the
           build rungs; the scan's figure from the prior close moves into the fold. Raw source URLs become a short
           "source ↗" link so they can't run off a 390px screen. */
        /* v202: the scan writes vol as an annualized FRACTION (AMZN 0.313 = 31%); the tile printed it as "vol 0%". */
        const lv = levelsFor({ levels: { [r.sym]: r } }, r.sym);
        const rrE = lv && lv.rr != null && isFinite(lv.rr) ? lv.rr : null;
        const lowE = rrE != null && rrE < C.RR_MIN;
        const rrClose = r.rr != null && isFinite(+r.rr) ? +r.rr : null;
        const urls = [];
        const whyTxt = esc(String(r.why || '').replace(/https?:\/\/\S+/g, (u) => { urls.push(u.replace(/[)\].,;]+$/, '')); return ''; }).replace(/\s{2,}/g, ' ').trim());
        const src = urls.filter((u) => /^https:\/\//.test(u)).map((u) => ` <a href="${esc(u)}" target="_blank" rel="noopener" style="color:#2563eb;white-space:nowrap">source ↗</a>`).join('');
        const rrLine = rrE != null ? `<span style="color:${lowE ? '#dc2626' : '#059669'};font-weight:600">R/R <span style="white-space:nowrap">${rrE.toFixed(2)}</span> at entry${lowE ? ' · under ' + C.RR_MIN : ''}</span><br>` : (rrClose != null ? 'R/R ' + rrClose.toFixed(1) + ' (from close) · ' : '');
        const cut = whyTxt.indexOf('News:');
        const whyMain = cut > 0 ? whyTxt.slice(0, cut).replace(/[\s.;·—-]+$/, '') : whyTxt;
        const news = cut >= 0 ? whyTxt.slice(cut) : '';
        const closeNote = rrE != null && rrClose != null ? `<div>Scan R/R ${rrClose.toFixed(1)} was measured from the prior close, not this entry.</div>` : '';
        const fold = news || src || closeNote ? `<details class="sd-more" style="margin-top:3px"><summary style="font-size:10.5px;color:#6b7280">${news ? '📰 News' : 'ⓘ Notes'}${src ? ' · source' : ''}</summary><div style="font-size:10.5px;color:#6b7280;line-height:1.35;overflow-wrap:anywhere">${news ? news + src : src.trim()}${closeNote}</div></details>` : '';
        return `<div class="snap-tile" style="min-width:0;overflow-wrap:anywhere"><div class="snap-lbl">#${i + 1} ${esc(r.sym)}${r.target ? ' 🎯 ' + r.target + '%' : ''}${r.wash ? ' · 🚫' : ''}${r.extended ? ' · ⏳ extended' : ''}${r.held ? ' · held' : ''}</div><div class="snap-val" style="color:${col}">${r.score.toFixed(1)}</div><div style="font-size:10.5px;color:#6b7280;line-height:1.35;overflow-wrap:anywhere">${r.name ? '<b>' + esc(r.name) + '</b><br>' : ''}${r.trigger ? 'Entry ' + money(r.trigger) + (lv && lv.limit && Math.abs(lv.limit - r.trigger) > 0.004 ? ' (limit ' + money(lv.limit) + ')' : '') + (r.tp1 ? ' → ' + money(r.tp1) : '') + (lv && lv.stop ? ' · stop ' + money(lv.stop) : '') + '<br>' : ''}${r.wash ? `<span style="color:#b45309;font-weight:600">🚫 Tax hold to ${esc(r.wash)}</span><br>` : ''}${rrLine}${r.vol != null && isFinite(+r.vol) ? 'vol ' + Math.round(Math.abs(+r.vol) <= 3 ? +r.vol * 100 : +r.vol) + '% · ' : ''}${whyMain}</div>${fold}</div>`;
      }
      return `<div class="snap-tile" style="min-width:0"><div class="snap-lbl">#${i + 1} ${esc(r.sym)}${r.held ? ' · held' : ''}</div><div class="snap-val" style="color:${col}">${r.score.toFixed(1)}</div><div style="font-size:10.5px;color:#6b7280;line-height:1.35">${r.rs3 != null ? (r.rs3 >= 0 ? '+' : '') + r.rs3.toFixed(0) + 'pp vs SPY 3m' : '—'}<br>${up != null ? (up >= 0 ? '+' : '') + up.toFixed(0) + '% vs 50-day' : ''}${r.fromHi != null ? ' · ' + r.fromHi.toFixed(0) + '% off high' : ''}</div></div>`;
    }).join('');
    const rec = R.record || null;
    const recLine = rec && (rec.n30 > 0 || rec.n5 > 0 || rec.n90 > 0)
      ? `<div style="font-size:11.5px;margin-top:8px;color:var(--text)"><b>Record vs SPY:</b> ${[['5d', rec.n5, rec.hit5, rec.avgAlpha5], ['30d', rec.n30, rec.hit30, rec.avgAlpha30], ['90d', rec.n90, rec.hit90, rec.avgAlpha90]].filter((x) => x[1] > 0).map((x) => `${x[0]} ${Math.round(x[2] * 100)}% beat · ${x[3] >= 0 ? '+' : ''}${(+x[3]).toFixed(1)}pp (n=${x[1]})`).join(' · ')}</div>`
      : (rec ? '<div style="font-size:11px;color:#9ca3af;margin-top:8px">Record vs SPY: no graded picks yet — first marks at 5 trading days.</div>' : '');
    const vet = vetoBlock(R.vetoed, esc);
    return `<div class="ac-tier">🔬 Research — top 5 <span class="card-hint">(${esc(R.source || 'momentum lens')} · ${esc(R.asOf || '')})</span></div><div class="snap-grid">${tiles}</div>${recLine}${vet}<div style="font-size:11px;color:#9ca3af;margin-top:6px">${esc(R.note || 'Scores 0–10. A name becomes a ticket only when it beats your weakest holding (Friday swap rule).')}</div>`;
  }

  /* Two sliders: the core name and the donor. Debt held fixed; shows band + which rules fire. */
  function renderWhatIf(box, st, cfg) {
    if (!box) return;
    const names = [cfg.core, cfg.donor].map((s) => st.positions.find((p) => p.symbol === s)).filter(Boolean);
    if (!names.length) { box.innerHTML = '<div class="tech-empty">Needs priced holdings.</div>'; return; }
    const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    box.innerHTML = names.map((p, i) => `<div style="display:flex;align-items:center;gap:10px;margin:6px 0;font-size:12px"><span style="width:52px;font-weight:600">${esc(p.symbol)}</span><input type="range" data-apex-i="${i}" min="${(p.px * 0.5).toFixed(2)}" max="${(p.px * 2).toFixed(2)}" step="0.01" value="${p.px.toFixed(2)}" style="flex:1"><span data-apex-v="${i}" style="width:64px;text-align:right">${money(p.px)}</span></div>`).join('') +
      '<div class="snap-grid" style="margin-top:8px"><div class="snap-tile"><div class="snap-lbl">Equity</div><div class="snap-val" data-apex-eq></div></div><div class="snap-tile"><div class="snap-lbl">Leverage</div><div class="snap-val" data-apex-lev></div></div></div><div data-apex-fire style="margin-top:8px"></div>';
    const upd = () => {
      const pos = st.positions.map((p) => ({ ...p }));
      names.forEach((n, i) => { const v = +box.querySelector(`[data-apex-i="${i}"]`).value; const q = pos.find((x) => x.symbol === n.symbol); q.px = v; box.querySelector(`[data-apex-v="${i}"]`).textContent = money(v); });
      const s2 = state({ positions: pos, cash: -st.debt, maint: st.maintBase });   // each position keeps its own maint
      const eqEl = box.querySelector('[data-apex-eq]'), lvEl = box.querySelector('[data-apex-lev]');
      eqEl.textContent = (s2.equity < 0 ? '-' : '') + '$' + k(Math.abs(s2.equity)); eqEl.style.color = s2.eqPct < st.maint ? '#ef4444' : 'var(--text)';
      lvEl.textContent = s2.lev === Infinity || s2.eqPct < s2.maint ? 'call' : s2.lev.toFixed(2) + 'x'; lvEl.style.color = s2.lev > C.LEV_CAP ? '#ef4444' : s2.lev > C.LEV_NORMAL ? '#f97316' : '#10b981';
      const fired = rules(s2, { cfg }).filter((r) => r.kind !== 'guard');
      box.querySelector('[data-apex-fire]').innerHTML = fired.length ? fired.map((r) => `<div style="font-size:11.5px;padding:4px 8px;border-left:3px solid ${r.kind === 'risk' || r.kind === 'lose' ? '#ef4444' : r.kind === 'win' || r.kind === 'reload' ? '#10b981' : '#f97316'};margin-bottom:4px">${esc(r.title)}</div>`).join('') : '<div style="font-size:11.5px;color:#9ca3af">No rule fires. Hold.</div>';
    };
    box.querySelectorAll('input[type=range]').forEach((r) => r.addEventListener('input', upd));
    upd();
  }

  return { C, DEFAULT_CFG, state, rules, tripwire, guardPlan, sellToLev, render, levelsFor, portfolioPrompt, bookGaps, bookLines };
});
