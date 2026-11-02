// producer/agentic-triggers.mjs — PURE event detection for the agentic account. The scheduled flow
// was purely CALENDAR-driven: research refreshed every 7 days and nothing ever noticed a deposit or an
// earnings gap between refreshes. This adds EVENT triggers so the producer reacts to what actually happens.
//
// build-data.mjs calls computeAgenticTriggers(prior, fresh) at build time (both snapshots in memory, like
// computeAlerts) and writes the result to producer/raw/agentic-triggers.json. The AGENT reads it post-publish:
//   • triggers[] with kind 'deploy-cash'  → PushNotification the owner: idle/new cash is ready to deploy
//     (they open a session; the deploy planner builds the ticket).
//   • refreshResearch:true                → run the agentic-research workflow THIS run even if agentic-due
//     says NOT_DUE (a fresh deposit or a big held-name gap means the week-old target may be stale).
//
// Transition-based (like alerts): 'deploy-cash' fires on the run where cash CROSSES the band up or a fresh
// deposit lands — not every hourly run while cash merely sits there — so it nudges once, not endlessly.

export const CASH_DEPLOY_PCT = 5;    // idle cash ≥ this % of book is "worth deploying"
export const CASH_DEPLOY_FLOOR = 200; // …and at least this many dollars (don't nag over lunch money)
export const DEPOSIT_FLOOR = 200;    // a run-to-run cash rise this large (net of position changes) = a deposit
export const GAP_REFRESH_PCT = 6;    // a held target name moving this much in one run ≈ earnings/news → re-research

const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };
const px = (q) => (q && typeof q === 'object') ? num(q.last_trade_price ?? q.px ?? q.adjusted_previous_close) : num(q);
const money = (n) => '$' + (Math.round(n * 100) / 100).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

export function computeAgenticTriggers(prior, fresh) {
  const out = { triggers: [], refreshResearch: false, refreshReasons: [], depositFlow: 0 };
  const A = fresh && fresh.agentic;
  if (!A) return out;
  const cash = num(A.cash) || 0;
  const equity = num(A.equity) || 0;
  const book = equity > 0 ? equity : cash;
  if (book <= 0) return out;
  const ratio = 100 * cash / book;

  // 1. Deposit inference (same signal build-data uses for cumFlow): a cash rise not explained by price moves
  //    on the prior holdings ≈ an external deposit. Positive flow past the floor = new money in.
  let flow = null;
  const pa = prior && prior.agentic;
  if (pa && typeof pa.equity === 'number' && Array.isArray(pa.positions)) {
    const nowPx = Object.fromEntries((A.positions || []).map((p) => [p.symbol, p.px]));
    let priceMove = 0;
    for (const pp of pa.positions) {
      if (!pp || !pp.symbol || !(pp.qty > 0) || typeof pp.px !== 'number') continue;
      const np = nowPx[pp.symbol]; const p1 = (typeof np === 'number' && np > 0) ? np : pp.px;
      priceMove += pp.qty * (p1 - pp.px);
    }
    flow = +((equity - pa.equity) - priceMove).toFixed(2);
    out.depositFlow = flow;
  }
  const depositDetected = flow != null && flow >= DEPOSIT_FLOOR;

  // 2. deploy-cash — transition-based so it nudges once, not every run.
  const priorBook = pa ? (num(pa.equity) > 0 ? num(pa.equity) : num(pa.cash) || 0) : 0;
  const priorRatio = priorBook > 0 ? 100 * (num(pa && pa.cash) || 0) / priorBook : 0;
  const crossedUp = ratio >= CASH_DEPLOY_PCT && priorRatio < CASH_DEPLOY_PCT;
  if (cash >= CASH_DEPLOY_FLOOR && ratio >= CASH_DEPLOY_PCT && (crossedUp || depositDetected)) {
    out.triggers.push({
      kind: 'deploy-cash', symbol: null,
      msg: `💵 Agentic: ${money(cash)} idle cash (${ratio.toFixed(0)}% of book${depositDetected ? `, +${money(flow)} new deposit` : ''}) — ready to deploy toward the research target. Open a session to review the buy ticket.`,
      cash, ratio: +ratio.toFixed(1), deposit: depositDetected ? flow : 0,
    });
  }
  if (depositDetected) { out.refreshResearch = true; out.refreshReasons.push(`deposit +${money(flow)} — re-check the target before deploying new cash`); }

  // 3. earnings/news gap on a HELD target name → refresh research early (don't wait out the week on a
  //    target whose thesis a big move may have changed). Uses the run-to-run price move (catches overnight
  //    earnings gaps between the prior run and this one).
  const tgt = new Set(((A.target && A.target.names) || []).map((n) => String(n.ticker || '').toUpperCase()));
  const heldSyms = new Set((A.positions || []).map((p) => String(p.symbol || '').toUpperCase()));
  const pq = (prior && prior.quotes) || {}, fq = (fresh && fresh.quotes) || {};
  for (const symRaw of new Set([...tgt, ...heldSyms])) {
    const sym = String(symRaw).toUpperCase();
    if (!heldSyms.has(sym) && !tgt.has(sym)) continue;
    const p = px(pq[sym]), f = px(fq[sym]);
    if (!(p > 0) || !(f > 0)) continue;
    const move = (f / p - 1) * 100;
    if (Math.abs(move) >= GAP_REFRESH_PCT) {
      out.refreshResearch = true;
      out.refreshReasons.push(`${sym} ${move > 0 ? '+' : ''}${move.toFixed(1)}% in one run (earnings/news) — its target thesis may be stale`);
    }
  }

  // 4. STOP BREAK on a held ACTIVE target name → refresh research early (2026-11-02, owner "A + B").
  //    The research stop is a thesis-review level; until now nothing re-checked the thesis when price
  //    reached it. The executor does NOT sell an active name on a stop break (Mandate A forbids price-
  //    timing exits) — it asks the research instead, and the research keeps or drops the name.
  //    Phase-out names are excluded: the executor exits those itself (agentic-deploy 1b-2).
  const today = String((fresh && fresh.generatedAt) || '').slice(0, 10) || null;
  const breaks = stopBreaks({ target: A.target, positions: A.positions, quotes: fq, hist: fresh && fresh.hist && fresh.hist.day, today });
  if (breaks.length) {
    out.refreshResearch = true;
    out.stopBreaks = breaks;
    for (const b of breaks) out.refreshReasons.push(`${b.sym} ${money(b.px)} at/below its research stop ${money(b.stop)} — re-check the thesis (keep or drop)`);
  }

  return out;
}

/* Held ACTIVE target names at/below their research stop whose break happened AFTER the research that set
   the stop (target.asOf). "After" = some close dated on/after asOf was still ABOVE the stop. That rule is
   what stops a loop: once the research re-runs (asOf = today) it has seen the break, so the same break
   does not force research again — only a fresh break against the NEW stop does. Research dated today
   (asOf ≥ today) never re-fires the same day. No closes since asOf ⇒ the break is assumed new (err
   toward re-checking). `today` is a UTC date (generatedAt); a few hours of ET/UTC skew only shifts a
   re-check by a run. Pure. */
export function stopBreaks({ target, positions, quotes, hist, today } = {}) {
  const names = (target && Array.isArray(target.names)) ? target.names : [];
  const asOf = String((target && target.asOf) || '').slice(0, 10);
  const heldSyms = new Set((positions || []).filter((p) => p && num(p.qty ?? p.quantity) > 0).map((p) => String(p.symbol || '').toUpperCase()));
  const out = [];
  if (asOf && today && asOf >= today) return out;     // the research already ran today
  for (const n of names) {
    if (!n || n.phaseOut) continue;
    const sym = String(n.ticker || '').toUpperCase();
    if (!heldSyms.has(sym)) continue;
    const stop = num(n.stop), p = px((quotes || {})[sym]);
    if (!(stop > 0) || !(p > 0) || p > stop) continue;
    const bars = (hist && hist[sym]) || [];
    const closes = [];
    for (const b of Array.isArray(bars) ? bars : []) {
      if (!b || b.interpolated || b.live) continue;
      const t = String(b.t || b.begins_at || '').slice(0, 10), c = num(b.c ?? b.close_price);
      if (t && c > 0) closes.push({ t, c });
    }
    const since = closes.filter((c) => !asOf || c.t >= asOf);
    if (since.length && !since.some((c) => c.c > stop)) continue;   // never closed above the stop since the research: it already saw this
    out.push({ sym, px: +p.toFixed(2), stop, asOf: asOf || null });
  }
  return out;
}
