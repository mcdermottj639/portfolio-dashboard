/* v186 — Apex: the self-directed margin book's leverage loop (pure + render).
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
    LEV_NORMAL: 1.35,      // where the book cruises; reload adds only up to here
    LEV_CAP: 1.50,         // hard cap — above it: no new buys, ladder active
    LEV_RELOAD: 1.20,      // below it (and the book trending) new borrow is allowed
    MAINT: 0.30,           // Robinhood house maintenance seen on IREN (2026-11-05); PLTR assumed
    GUARD_PCT: 0.35,       // equity ÷ exposure under this ⇒ risk guard (5 pts over maintenance)
    GUARD_TARGET: 0.40,    // …and it sells until equity is back here
    TRIM_GAIN: 0.25,       // = SD_TRIM_GAIN
    TRIM_GAIN_2: 0.50,
    TRIM_FRAC: 0.25,
    STOP: 0.25,            // = sdBroken's hard stop
    SINGLE_MAX_EQ: 0.20,   // = SD_SINGLE_MAX_EQ
    DRIFT_PTS: 5,
    EARN_DAYS: 3,
    TRANCHE: 50,
  };

  /* Default book config. Overridable from window.__APEX_CFG (set by the producer
     later) or a test. Targets are % of EQUITY, must respect SINGLE_MAX_EQ. */
  const DEFAULT_CFG = {
    core: 'IREN',
    coreMax: 500,                                    // v188 (Jack, 2026-11-05): keep an IREN core of up to 500 sh — exempt from the stop and drift trims; trims only into strength
    donor: 'PLTR',                                   // risk-guard tranche source (Jack, 2026-11-05)
    ladder: [{ sym: 'IREN', px: 30, qty: 200, note: 'newest lots first' }],
    targets: { IREN: 20, NVDA: 20, PLTR: 15, RKLB: 15, CRWD: 10 },
    kicker: 15,                                      // LEAPS sleeve cap, funded from trims only
    jarvis: 'https://claude.ai/artifact/1rWeHSBKA2BJ1kiesa81sQ',
  };

  const num = (v) => (v == null || isNaN(+v) ? 0 : +v);

  /* ── state ─────────────────────────────────────────────────────────────── */
  function state(input) {
    const pos = (input.positions || []).filter((p) => num(p.qty) > 0 && num(p.px) > 0)
      .map((p) => ({ symbol: String(p.symbol).toUpperCase(), qty: num(p.qty), px: num(p.px), avg: num(p.avg), val: num(p.qty) * num(p.px) }));
    const exposure = pos.reduce((s, p) => s + p.val, 0);
    const debt = Math.max(0, -num(input.cash));
    const equity = input.equity != null ? num(input.equity) : exposure - debt;
    const maint = input.maint != null ? num(input.maint) : C.MAINT;
    const lev = equity > 0 ? exposure / equity : (exposure > 0 ? Infinity : 0);
    const eqPct = exposure > 0 ? equity / exposure : 1;
    const cushion = equity - maint * exposure;             // dollars of market value you can lose before a call
    const callDrop = exposure > 0 ? Math.max(0, cushion / ((1 - maint) * exposure)) : null;
    const band = lev > C.LEV_CAP ? 'over' : lev > C.LEV_NORMAL ? 'high' : lev < C.LEV_RELOAD ? 'room' : 'normal';
    const top = pos.slice().sort((a, b) => b.val - a.val);
    const w = {};
    pos.forEach((p) => { w[p.symbol] = equity > 0 ? p.val / equity : 0; });
    return { positions: pos, exposure, debt, equity, maint, lev, eqPct, cushion, callDrop, band, top, weights: w };
  }

  /* Price of `sym` at which equity ÷ exposure == pct, every other name held flat. */
  function tripwire(st, sym, pct) {
    const p = st.positions.find((x) => x.symbol === sym);
    if (!p || p.qty <= 0) return null;
    const others = st.exposure - p.val;
    const k = 1 - (pct == null ? C.GUARD_PCT : pct);
    // (q·x + others)·k = debt  ⇒  x = (debt/k − others)/q
    const x = (st.debt / k - others) / p.qty;
    return x > 0 ? x : null;
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
    const friday = opt.friday === true;
    const out = [];
    const byName = (s) => st.positions.find((p) => p.symbol === s);
    const nearEarn = (s) => earn[s] && earn[s].daysAway != null && earn[s].daysAway >= 0 && earn[s].daysAway <= C.EARN_DAYS;

    // A1 Risk guard — first, always.
    if (st.exposure > 0 && st.eqPct < C.GUARD_PCT) {
      const d = byName(cfg.donor) || st.top[0];
      if (d) {
        const needSell = Math.max(0, (C.GUARD_TARGET * st.exposure - st.equity) / C.GUARD_TARGET);
        const qty = Math.min(d.qty, Math.max(C.TRANCHE, Math.ceil(needSell / d.px / C.TRANCHE) * C.TRANCHE));
        out.push(t('risk', 'Risk guard', `Equity is ${pct(st.eqPct)} of stock — ${pct(C.GUARD_PCT)} is the guard line (maintenance ${pct(st.maint)} + 5).`,
          { side: 'sell', sym: d.symbol, qty, px: round(d.px * 0.995), tranche: true }, st, d.symbol, qty, d.px));
      }
    }

    // A2 Leverage band / de-lever ladder.
    if (st.lev > C.LEV_CAP) {
      const need = sellToLev(st, C.LEV_CAP);
      out.push(t('lev', 'Over the 1.5x cap', `${st.lev.toFixed(2)}x. No new buys. Sell $${k(need)} into strength to reach the cap; proceeds pay debt.`, null, st));
      for (const L of cfg.ladder) {
        const p = byName(L.sym); if (!p) continue;
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

    // A5 Per-name cap (= SD_SINGLE_MAX_EQ) — advisory, weekly.
    if (friday) {
      for (const p of st.positions) {
        const w = st.weights[p.symbol] || 0, tgt = (cfg.targets[p.symbol] || 0) / 100;
        if (p.symbol === cfg.core && w > tgt && p.qty <= cfg.coreMax) continue;   // v188: a core ≤ coreMax is never drift-trimmed
        if (tgt > 0 && Math.abs(w - tgt) * 100 >= C.DRIFT_PTS)
          out.push(t('drift', `${p.symbol} ${pct(w)} vs ${pct(tgt)} target`, w > tgt ? 'Trim back to target at Friday review.' : 'Add back to target — only with leverage room.', null, st));
      }
    }

    // A6 Reload — only when winning and under 1.2x.
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
          const qty = px > 0 ? Math.floor(alloc / px) : 0;
          out.push(t('build', `Armed: buy ${qty > 0 ? qty + ' ' : ''}${s} · $${k(alloc)}`, `${st.lev.toFixed(2)}x with $${k(room)} of room to ${C.LEV_NORMAL}x, but the trend filter is shut — buy-stop-limit fills only on a bounce through the prior high / 10-day EMA.`,
            qty > 0 ? { side: 'buy', sym: s, qty, px: round(px), armed: true } : null, st));
        }
      }
    }

    // A7 Earnings guard — informational for any add.
    for (const p of st.positions) if (nearEarn(p.symbol) && !out.some((r) => r.kind === 'guard' && r.title.startsWith(p.symbol)))
      out.push(t('guard', `${p.symbol} reports in ${earn[p.symbol].daysAway}d`, 'No adds inside 3 trading days of a print.', null, st));

    const order = { risk: 0, lev: 1, ladder: 2, lose: 3, win: 4, core: 5, guard: 6, drift: 7, reload: 8, build: 9 };
    return out.sort((a, b) => order[a.kind] - order[b.kind]);
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
    const kindTag = { risk: ['#fee2e2', '#991b1b', 'risk guard'], lev: ['#fef3c7', '#92400e', 'leverage'], ladder: ['#fef3c7', '#92400e', 'ladder'], win: ['#d1fae5', '#065f46', 'winner'], lose: ['#fee2e2', '#991b1b', 'stop'], drift: ['#e0e7ff', '#3730a3', 'drift'], reload: ['#d1fae5', '#065f46', 'reload'], guard: ['#f3f4f6', '#374151', 'earnings'], core: ['#e0f2fe', '#075985', 'core'], build: ['#d1fae5', '#065f46', 'build · armed'] };
    const rows = out.length ? out.map((r) => {
      const tg = kindTag[r.kind] || kindTag.guard;
      const tk = r.ticket && !r.after && r.ticket.side === 'buy' ? `<div style="font-size:11.5px;margin-top:4px;color:var(--text);opacity:.8">Buy ${r.ticket.qty} ${esc(r.ticket.sym)} · ~${money(r.ticket.px)} now · <b>armed</b> — trigger in Jarvis</div>` : r.ticket && r.after ? `<div style="font-size:11.5px;margin-top:4px;color:var(--text);opacity:.8">${r.ticket.side === 'sell' ? 'Sell' : 'Buy'} ${r.ticket.qty} ${esc(r.ticket.sym)} · limit ${money(r.ticket.px)}${r.ticket.gtc ? ' GTC' : ''} → ${r.after.lev.toFixed(2)}x · debt $${k(r.after.debt)}${r.ticket.armed ? ' · <b>armed</b>' : ''}</div>` : '';
      return `<div class="flag-card" style="border-left-color:${tg[1]};background:${tg[0]}22"><div style="display:flex;justify-content:space-between;gap:8px;align-items:center"><b style="font-size:12.5px">${esc(r.title)}</b><span class="act-tag" style="background:${tg[0]};color:${tg[1]};margin:0">${tg[2]}</span></div><div class="flag-body">${esc(r.why)}</div>${tk}</div>`;
    }).join('') : '<div class="tech-empty">No rule fires. Hold.</div>';
    const mix = Object.keys(cfg.targets).map((s) => { const w = (st.weights[s] || 0) * 100, tg = cfg.targets[s]; return `<div class="stress-row" style="margin-bottom:4px"><span style="width:52px;font-size:12px;font-weight:600">${esc(s)}</span><div class="gauge" style="flex:1;margin:0;position:relative"><div style="width:${Math.min(100, w)}%;height:100%;background:${w > tg + C.DRIFT_PTS ? '#f97316' : '#3b82f6'}"></div><div style="position:absolute;left:${Math.min(100, tg)}%;top:-2px;width:2px;height:10px;background:#10b981"></div></div><span style="width:74px;text-align:right;font-size:11px;color:#6b7280">${w.toFixed(0)}% / ${tg}%</span></div>`; }).join('');
    el.innerHTML = `
      <div style="font-size:11.5px;color:var(--text);opacity:.75;margin:-2px 0 10px;line-height:1.5">Leverage loop for the margin book — band ${C.LEV_NORMAL}x cruise / ${C.LEV_CAP}x cap, call line at ${pct(st.maint)} maintenance. Rules fire here; <b>approvals live in Jarvis</b>; you place the order in Robinhood.</div>
      <div class="snap-grid">${tile('Leverage', st.lev === Infinity ? 'call' : st.lev.toFixed(2) + 'x', levCol)}${tile('Margin debt', '$' + k(st.debt), st.debt > 0 ? '#ef4444' : 'var(--text)')}${tile('Cushion to call', '$' + k(Math.max(0, st.cushion)), cushCol)}${tile('Band', bandTxt, levCol)}</div>
      <div style="margin:12px 0 2px;font-size:11px;color:#6b7280;display:flex;justify-content:space-between"><span>Equity ${pct(st.eqPct)} of stock</span><span>call ${pct(st.maint)} · guard ${pct(C.GUARD_PCT)} · 1.5x = ${pct(1 / C.LEV_CAP)}</span></div>
      <div class="gauge" style="position:relative;height:10px;overflow:visible"><div style="width:${eqPct}%;height:100%;background:${levCol};border-radius:3px"></div><div style="position:absolute;left:${st.maint * 100}%;top:-3px;width:2px;height:16px;background:#ef4444"></div><div style="position:absolute;left:${C.GUARD_PCT * 100}%;top:-3px;width:2px;height:16px;background:#f97316"></div><div style="position:absolute;left:${100 / C.LEV_CAP}%;top:-3px;width:2px;height:16px;background:#10b981"></div></div>
      ${tw ? `<div style="font-size:11.5px;color:#6b7280;margin-top:8px">Tripwire: ${esc(cfg.core)} at <b style="color:var(--text)">${money(tw)}</b> puts equity on the guard line (others flat) — the ${esc(cfg.donor)} tranche ticket is pre-built for that print.</div>` : ''}
      <div class="ac-tier">⚙️ Rules firing now</div>${rows}
      <div class="ac-tier">🎯 Weights vs target <span class="card-hint">(% of equity · cap ${pct(C.SINGLE_MAX_EQ)} · LEAPS kicker ≤ ${cfg.kicker}%)</span></div>${mix}
      ${researchBlock(research, esc)}
      <div class="ac-tier">🧪 What if</div>
      <div id="apex-whatif"></div>
      <div style="font-size:11px;color:#9ca3af;margin-top:10px">Tickets are proposals from these rules. Approve or decline them in <a href="${esc(cfg.jarvis)}" target="_blank" rel="noopener" style="color:#2563eb">Jarvis</a>; the morning scan (7:12 AM ET, weekdays) writes them there and logs fills the next day.</div>`;
    renderWhatIf(el.querySelector('#apex-whatif'), st, cfg);
  }

  /* v188 — weekly research, top 5. `research` = {asOf, source, rows:[{sym, score, px, rs3, fromHi, s50, why}]}
     from the dashboard's SD momentum lens (sdMomentum over SD_BENCH, freshness-gated). A name only
     becomes a ticket via the Friday swap rule in the scan (beats the weakest holding by ≥ 1.5). */
  function researchBlock(R, esc) {
    if (!R || !R.rows || !R.rows.length) return `<div class="ac-tier">🔬 Research — top 5</div><div class="tech-empty">${esc((R && R.empty) || 'No scored names yet (needs fresh daily bars).')}</div>`;
    const tiles = R.rows.slice(0, 5).map((r, i) => {
      const col = r.score >= 7 ? '#10b981' : r.score >= 5.5 ? '#f59e0b' : '#9ca3af';
      const up = r.s50 && r.px ? (r.px / r.s50 - 1) * 100 : null;
      return `<div class="snap-tile" style="min-width:0"><div class="snap-lbl">#${i + 1} ${esc(r.sym)}${r.held ? ' · held' : ''}</div><div class="snap-val" style="color:${col}">${r.score.toFixed(1)}</div><div style="font-size:10.5px;color:#6b7280;line-height:1.35">${r.rs3 != null ? (r.rs3 >= 0 ? '+' : '') + r.rs3.toFixed(0) + 'pp vs SPY 3m' : '—'}<br>${up != null ? (up >= 0 ? '+' : '') + up.toFixed(0) + '% vs 50-day' : ''}${r.fromHi != null ? ' · ' + r.fromHi.toFixed(0) + '% off high' : ''}</div></div>`;
    }).join('');
    return `<div class="ac-tier">🔬 Research — top 5 <span class="card-hint">(${esc(R.source || 'momentum lens')} · ${esc(R.asOf || '')})</span></div><div class="snap-grid">${tiles}</div><div style="font-size:11px;color:#9ca3af;margin-top:6px">${esc(R.note || 'Scores 0–10. A name becomes a ticket only when it beats your weakest holding (Friday swap rule).')}</div>`;
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
      const s2 = state({ positions: pos, cash: -st.debt, maint: st.maint });
      const eqEl = box.querySelector('[data-apex-eq]'), lvEl = box.querySelector('[data-apex-lev]');
      eqEl.textContent = (s2.equity < 0 ? '-' : '') + '$' + k(Math.abs(s2.equity)); eqEl.style.color = s2.eqPct < st.maint ? '#ef4444' : 'var(--text)';
      lvEl.textContent = s2.lev === Infinity || s2.eqPct < s2.maint ? 'call' : s2.lev.toFixed(2) + 'x'; lvEl.style.color = s2.lev > C.LEV_CAP ? '#ef4444' : s2.lev > C.LEV_NORMAL ? '#f97316' : '#10b981';
      const fired = rules(s2, { cfg }).filter((r) => r.kind !== 'guard');
      box.querySelector('[data-apex-fire]').innerHTML = fired.length ? fired.map((r) => `<div style="font-size:11.5px;padding:4px 8px;border-left:3px solid ${r.kind === 'risk' || r.kind === 'lose' ? '#ef4444' : r.kind === 'win' || r.kind === 'reload' ? '#10b981' : '#f97316'};margin-bottom:4px">${esc(r.title)}</div>`).join('') : '<div style="font-size:11.5px;color:#9ca3af">No rule fires. Hold.</div>';
    };
    box.querySelectorAll('input[type=range]').forEach((r) => r.addEventListener('input', upd));
    upd();
  }

  return { C, DEFAULT_CFG, state, rules, tripwire, sellToLev, render };
});
