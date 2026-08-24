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
    return { sym, side: String(t.side || 'BUY').toUpperCase(), dollars: num(t.dollars), priceAt, priceNow, retPct, contribPct,
      ...(Array.isArray(t.drivers) && t.drivers.length ? { drivers: t.drivers } : {}) };
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

// Minimum graded buys per sleeve before its attribution means anything. Attribution over two trades is
// noise, and a card that prints it as though it were signal is worse than one that says "not yet".
export const SLEEVE_MIN_N = 4;

// Which research sleeve is actually earning its keep? Every target name carries `drivers` (the sleeves
// that scored ≥7, derived deterministically in finalize-target.mjs), and makeDecision stamps them onto
// each BUY leg at decision time. Rolling those up answers the question that makes a sleeve REMOVABLE:
// did the names a sleeve backed actually outperform? Dollar-weighted, and measured as alpha vs SPY over
// the same window so a sleeve isn't credited for a rising tape.
//
// A leg with k drivers splits its dollars 1/k across them. That is crude — it cannot separate a name
// that momentum carried from one quality carried when both tagged it — but it is unbiased and needs no
// extra data. Anything cleverer (regression on sleeve scores) needs far more decisions than this account
// will generate in a year.
export function sleeveStats(gradedDecisions = []) {
  const acc = {};
  for (const d of gradedDecisions) {
    const spyRet = d.grade ? d.grade.spyRet : null;
    for (const t of (d.grade && d.grade.byTrade) || []) {
      if (t.side !== 'BUY' || !Array.isArray(t.drivers) || !t.drivers.length) continue;
      if (t.contribPct == null || !(t.dollars > 0)) continue;
      const share = t.dollars / t.drivers.length;
      const alpha = spyRet != null ? t.contribPct - spyRet : null;
      for (const dv of t.drivers) {
        const a = acc[dv] || (acc[dv] = { n: 0, dollars: 0, _cw: 0, _aw: 0, _an: 0 });
        a.n += 1; a.dollars += share;
        a._cw += t.contribPct * share;
        if (alpha != null) { a._aw += alpha * share; a._an += share; }
      }
    }
  }
  const out = {};
  for (const [k, a] of Object.entries(acc)) {
    out[k] = {
      n: a.n,
      dollars: +a.dollars.toFixed(2),
      contribPct: a.dollars > 0 ? +(a._cw / a.dollars).toFixed(2) : null,
      alphaPct: a._an > 0 ? +(a._aw / a._an).toFixed(2) : null,
      thin: a.n < SLEEVE_MIN_N,   // true ⇒ report it as "not yet measurable", never as a finding
    };
  }
  return out;
}

export function gradeDecisions(decisions = [], quotesNow = {}, asOf) {
  const graded = decisions.map((d) => gradeDecision(d, quotesNow, asOf))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)); // newest first
  const resolved = graded.filter((d) => d.grade.verdict !== 'open');
  const ahead = resolved.filter((d) => d.grade.verdict === 'ahead').length;
  const withAlpha = resolved.filter((d) => d.grade.alpha != null);
  const avgAlpha = withAlpha.length ? +(withAlpha.reduce((s, d) => s + d.grade.alpha, 0) / withAlpha.length).toFixed(2) : null;
  const sleeves = sleeveStats(graded);
  return { decisions: graded, stats: { total: graded.length, resolved: resolved.length, ahead, behind: resolved.length - ahead, avgAlpha }, sleeves };
}

// Build a new decision record from a deployment/rebalance plan (agent calls this on confirm, then appends).
// SLEEVE ATTRIBUTION (v121). `target` (the then-current agentic-target.json) is optional; when supplied,
// each BUY leg records the `drivers` of the target name it was bought for. It MUST be stamped here, at
// decision time, and never reconstructed later by looking the symbol up in whatever target happens to be
// current — that would attribute a trade to a thesis that did not pick it. Buys only: a trim/exit is not
// an expression of the sleeve that originally justified the name. Legs written before this existed simply
// carry no `drivers` and are excluded from attribution rather than guessed at.
export function makeDecision({ date, kind = 'deploy', targetAsOf, book, equity, spyAt, rationale, buys = [], trims = [], target = null }) {
  const driversOf = (sym) => {
    const n = ((target && target.names) || []).find((x) => x && String(x.ticker).toUpperCase() === String(sym).toUpperCase());
    return (n && Array.isArray(n.drivers) && n.drivers.length) ? n.drivers.slice() : null;
  };
  // LOUD, because the omission is invisible and permanent. A rebalance appended without `target` can
  // never be attributed to a sleeve — the stamp is decision-time only — and nothing downstream errors,
  // so without this warning the loss is silent. Shows up in the executor's run log.
  if (!target && buys.length) {
    console.warn(`[agentic-ledger] makeDecision(${date}) called WITHOUT \`target\` — ${buys.length} buy leg(s) will carry no drivers and this rebalance is permanently invisible to sleeve attribution. Pass the committed agentic-target.json (the exec gate writes it into raw/agentic-plan.json as \`target\`).`);
  }
  const trades = [
    ...buys.map((b) => { const d = driversOf(b.sym); return ({ sym: String(b.sym).toUpperCase(), side: 'BUY', dollars: num(b.dollars), shares: num(b.shares), priceAt: num(b.price ?? b.priceAt), weightBefore: num(b.weightNow), weightAfter: num(b.weightTarget), ...(d ? { drivers: d } : {}) }); }),
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
