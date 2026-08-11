// producer/alerts.mjs — deterministic level-crossing detection between the prior snapshot and the
// one being built. PURE (no I/O, unit-testable): build-data.mjs calls computeAlerts(prior, data,
// heldSyms) right before emit — the only moment both snapshots exist — and writes the result to
// producer/raw/alerts.json. Delivery is the AGENT's job (post-publish, best-effort, like the
// watchlist syncs): it reads the sidecar and `PushNotification`s each message. The Railway path
// has no push channel — its entrypoint just logs them (see RAILWAY.md) — so phone alerts fire only
// on Claude-agent runs.
//
// Every alert is a TRANSITION (prior on one side of a level, fresh on/through the other), so a
// crossing fires exactly once — on the run where it happens — with no separate sent-state to
// persist. A price whipsawing across a level between runs can re-alert; that's a real signal.
//
// Alert kinds:
//   agentic-stop / agentic-target — an agentic-account holding crossed the stop/target from the
//     committed research target (producer/agentic-target.json). Those brackets are MONITOR-ONLY
//     (fractional cash-account positions carry no resting stops), so the push IS the stop.
//   pick-stop / pick-tp1 / pick-tp2 — one of the day's top picks crossed its published bracket.
//   day-move — a held name (margin or agentic) crossed ±DAY_MOVE_PCT on the day.

export const DAY_MOVE_PCT = 7;

const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };
const px = (q) => num(q && q.last_trade_price);
const dayPct = (q) => {
  const last = px(q), prev = num(q && (q.adjusted_previous_close ?? q.previous_close));
  return last > 0 && prev > 0 ? ((last / prev) - 1) * 100 : null;
};
const money = (v) => '$' + (+v).toFixed(2);

export function computeAlerts(prior, fresh, heldSyms = []) {
  const alerts = [];
  if (!prior || !fresh) return alerts; // first-ever run: nothing to compare against
  const pq = prior.quotes || {}, fq = fresh.quotes || {};
  const P = (s) => px(pq[s]), F = (s) => px(fq[s]);

  // 1. Agentic-account bracket crossings (stop/target from the committed research target).
  const tgt = {};
  for (const n of (fresh.agentic && fresh.agentic.target && fresh.agentic.target.names) || []) {
    if (n && n.ticker) tgt[String(n.ticker).toUpperCase()] = n;
  }
  for (const pos of (fresh.agentic && fresh.agentic.positions) || []) {
    const sym = String(pos.symbol || '').toUpperCase();
    const t = tgt[sym]; if (!t) continue;
    const prev = P(sym), cur = F(sym) ?? num(pos.px);
    if (!(prev > 0) || !(cur > 0)) continue;
    const stop = num(t.stop), target = num(t.target);
    if (stop != null && prev > stop && cur <= stop) alerts.push({
      kind: 'agentic-stop', symbol: sym,
      msg: `🛑 Agentic: ${sym} ${money(cur)} crossed its stop ${money(stop)} — review/exit. (Monitor-only bracket: fractional positions hold no resting stop, this push IS the stop.)`,
    });
    if (target != null && prev < target && cur >= target) alerts.push({
      kind: 'agentic-target', symbol: sym,
      msg: `🎯 Agentic: ${sym} ${money(cur)} reached its research target ${money(target)} — consider trimming or rotating per the weekly target.`,
    });
  }

  // 2. Top-pick bracket crossings (the published tp1/tp2/stop of the day's picks). Most-significant
  //    level wins when several cross in one gap (stop > tp2 > tp1).
  for (const p of (fresh.picks && fresh.picks.picks) || []) {
    const sym = String(p.ticker || '').toUpperCase();
    const prev = P(sym), cur = F(sym);
    if (!(prev > 0) || !(cur > 0)) continue;
    const sl = num(p.sl && p.sl.price), tp1 = num(p.tp1 && p.tp1.price), tp2 = num(p.tp2 && p.tp2.price);
    if (sl != null && prev > sl && cur <= sl) alerts.push({
      kind: 'pick-stop', symbol: sym,
      msg: `🛑 Pick ${sym} ${money(cur)} hit its stop ${money(sl)} — setup invalidated.`,
    });
    else if (tp2 != null && prev < tp2 && cur >= tp2) alerts.push({
      kind: 'pick-tp2', symbol: sym,
      msg: `🎯 Pick ${sym} ${money(cur)} reached its stretch target TP2 ${money(tp2)}.`,
    });
    else if (tp1 != null && prev < tp1 && cur >= tp1) alerts.push({
      kind: 'pick-tp1', symbol: sym,
      msg: `🎯 Pick ${sym} ${money(cur)} reached TP1 ${money(tp1)} — consider taking partial profits per the setup.`,
    });
  }

  // 3. Big intraday movers among HELD names (margin + agentic) — crossing ±DAY_MOVE_PCT.
  for (const symRaw of heldSyms) {
    const sym = String(symRaw || '').toUpperCase(); if (!sym) continue;
    const pc = dayPct(pq[sym]), fc = dayPct(fq[sym]);
    if (pc == null || fc == null) continue;
    if (Math.abs(pc) < DAY_MOVE_PCT && Math.abs(fc) >= DAY_MOVE_PCT) alerts.push({
      kind: 'day-move', symbol: sym,
      msg: `⚡ ${sym} is ${fc > 0 ? 'up' : 'down'} ${Math.abs(fc).toFixed(1)}% today — held name moving hard; check the Do-now feed.`,
    });
  }

  return alerts;
}
