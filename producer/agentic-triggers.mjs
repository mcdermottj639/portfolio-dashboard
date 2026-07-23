// producer/agentic-triggers.mjs — PURE event detection for the agentic cash account. The scheduled flow
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
// deposit lands — not every 30-min run while cash merely sits there — so it nudges once, not endlessly.

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

  return out;
}
