// producer/agentic-ledger.mjs — PURE rebalance-decision ledger + grader for the agentic account.
//
// The picks screen has a Track Record (every pick graded win/loss); the agentic ACCOUNT's rebalance
// decisions had no equivalent — we never learned whether "trim V, add NVDA" actually helped. This logs
// each deploy/rebalance and grades it later against what actually happened (and vs SPY), so the strategy
// gets SMARTER over time, not just busier.
//
// State lives in committed producer/agentic-decisions.json ({ decisions:[…] }) — the agent APPENDS a record
// when the owner confirms a rebalance (see AGENTIC.md). build-data.mjs reads it, grades each decision with
// this run's live quotes, and attaches the graded list as data.agentic.decisions (carry-forward like target)
// for the consumer's "Rebalance Log" card. PURE + unit-tested (agentic-ledger.test.mjs).
//
// Decision shape: { id, date:'YYYY-MM-DD', kind:'deploy'|'rebalance', targetAsOf, book, equityAtDecision,
//   spyAt?:number, rationale, trades:[{ sym, side:'BUY'|'SELL'|'TRIM', dollars, shares?, priceAt,
//   weightBefore?, weightAfter? }] }

export const MIN_GRADE_DAYS = 5; // younger than this = still "open" (too soon to judge)

const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };

// Grade one decision against current prices. quotesNow: { sym: price|quoteObj }. asOf: 'YYYY-MM-DD'.
export function gradeDecision(dec, quotesNow = {}, asOf) {
  const pxNow = (sym) => {
    const q = quotesNow[String(sym).toUpperCase()];
    if (q == null) return null;
    if (typeof q === 'number') return q;
    return num(q.last_trade_price ?? q.px ?? q.price ?? q.adjusted_previous_close ?? q.previous_close);
  };
  const byTrade = (dec.trades || []).map((t) => {
    const sym = String(t.sym || '').toUpperCase();
    const priceAt = num(t.priceAt);
    const priceNow = pxNow(sym);
    let retPct = null;      // price move since the decision
    let contribPct = null;  // decision-positive contribution (a trim that then fell is GOOD)
    if (priceAt > 0 && priceNow > 0) {
      retPct = +(100 * (priceNow - priceAt) / priceAt).toFixed(2);
      const side = String(t.side || 'BUY').toUpperCase();
      contribPct = (side === 'SELL' || side === 'TRIM') ? -retPct : retPct;
    }
    return { sym, side: String(t.side || 'BUY').toUpperCase(), dollars: num(t.dollars), priceAt, priceNow, retPct, contribPct };
  });

  // dollar-weighted average decision contribution across trades that priced
  const priced = byTrade.filter((b) => b.contribPct != null && b.dollars > 0);
  const wsum = priced.reduce((s, b) => s + b.dollars, 0);
  const avgContrib = wsum > 0 ? +(priced.reduce((s, b) => s + b.contribPct * b.dollars, 0) / wsum).toFixed(2) : null;

  // benchmark: SPY over the same window (alpha), when spyAt was recorded at decision time
  const spyAt = num(dec.spyAt), spyNow = pxNow('SPY');
  const spyRet = (spyAt > 0 && spyNow > 0) ? +(100 * (spyNow - spyAt) / spyAt).toFixed(2) : null;
  const alpha = (avgContrib != null && spyRet != null) ? +(avgContrib - spyRet).toFixed(2) : null;

  const daysSince = daysBetween(dec.date, asOf);
  let verdict = 'open';
  if (daysSince != null && daysSince >= MIN_GRADE_DAYS && avgContrib != null) {
    verdict = (alpha != null ? alpha : avgContrib) >= 0 ? 'ahead' : 'behind';
  }
  return { ...dec, grade: { byTrade, avgContrib, spyRet, alpha, daysSince, verdict } };
}

export function gradeDecisions(decisions = [], quotesNow = {}, asOf) {
  const graded = decisions.map((d) => gradeDecision(d, quotesNow, asOf))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)); // newest first
  const resolved = graded.filter((d) => d.grade.verdict !== 'open');
  const ahead = resolved.filter((d) => d.grade.verdict === 'ahead').length;
  const withAlpha = resolved.filter((d) => d.grade.alpha != null);
  const avgAlpha = withAlpha.length ? +(withAlpha.reduce((s, d) => s + d.grade.alpha, 0) / withAlpha.length).toFixed(2) : null;
  return { decisions: graded, stats: { total: graded.length, resolved: resolved.length, ahead, behind: resolved.length - ahead, avgAlpha } };
}

// Build a new decision record from a deployment/rebalance plan (agent calls this on confirm, then appends).
export function makeDecision({ date, kind = 'deploy', targetAsOf, book, equity, spyAt, rationale, buys = [], trims = [] }) {
  const trades = [
    ...buys.map((b) => ({ sym: String(b.sym).toUpperCase(), side: 'BUY', dollars: num(b.dollars), shares: num(b.shares), priceAt: num(b.price ?? b.priceAt), weightBefore: num(b.weightNow), weightAfter: num(b.weightTarget) })),
    ...trims.map((t) => ({ sym: String(t.sym).toUpperCase(), side: 'TRIM', dollars: num(t.dollars), shares: num(t.shares), priceAt: num(t.price ?? t.priceAt), weightBefore: num(t.weightNow), weightAfter: num(t.weightTarget) })),
  ];
  return { id: `${date}-${kind}`, date, kind, targetAsOf: targetAsOf || null, book: num(book), equityAtDecision: num(equity), spyAt: num(spyAt), rationale: rationale || '', trades };
}

// Churn-governor input (2026-08-12): fold the committed decisions ledger into the deploy planner's
// `accountActivity` shape — {SYM:{lastBuyDate,lastSellDate}} over the trailing window. This is what
// lets the exec gate see "we bought AAPL two days ago / sold MSFT yesterday" BETWEEN producer runs
// (raw/ is wiped; the ledger is the committed record of every placed rebalance). The executor still
// overlays today's live fills from get_equity_orders — this covers everything before today.
export function activityFromDecisions(decisions = [], { asOf, sinceDays = 30 } = {}) {
  const map = {};
  for (const d of decisions) {
    if (!d || !d.date) continue;
    const age = daysBetween(d.date, asOf);
    if (age == null || age < 0 || age > sinceDays) continue;
    for (const t of d.trades || []) {
      const sym = String(t.sym || '').toUpperCase();
      if (!sym) continue;
      const side = String(t.side || 'BUY').toUpperCase();
      const m = map[sym] || (map[sym] = {});
      const key = side === 'BUY' ? 'lastBuyDate' : 'lastSellDate'; // SELL/TRIM/EXIT all count as sells
      if (!m[key] || d.date > m[key]) m[key] = d.date;
    }
  }
  return map;
}

function daysBetween(a, b) {
  if (!a) return null;
  const t0 = Date.parse(String(a).slice(0, 10) + 'T00:00:00Z');
  const t1 = b ? Date.parse(String(b).slice(0, 10) + 'T00:00:00Z') : Date.now();
  if (!Number.isFinite(t0) || !Number.isFinite(t1)) return null;
  return Math.round((t1 - t0) / 86400000);
}
