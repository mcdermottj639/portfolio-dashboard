import { GRADING_VERSION, provenance } from './agentic-model.mjs';
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

  // Each basket needs complete coverage. Missing prices never improve a score by omission.
  const basket = (legs) => {
    const dollars = legs.reduce((sum, t) => sum + (t.dollars > 0 ? t.dollars : 0), 0);
    const complete = legs.length > 0 && legs.every(t => t.dollars > 0 && t.retPct != null);
    return { dollars, returnPct: complete ? +(legs.reduce((sum, t) => sum + t.retPct * t.dollars, 0) / dollars).toFixed(2) : null };
  };
  const buys = basket(byTrade.filter(t => t.side === 'BUY'));
  const sells = basket(byTrade.filter(t => ['SELL', 'TRIM', 'EXIT'].includes(t.side)));
  const spyAt = num(dec.spyAt), spyNow = pxNow('SPY');
  const spyRet = spyAt > 0 && spyNow > 0 ? +(100 * (spyNow - spyAt) / spyAt).toFixed(2) : null;
  const alpha = buys.returnPct != null && spyRet != null ? +(buys.returnPct - spyRet).toFixed(2) : null;
  const rotationPct = buys.returnPct != null && sells.returnPct != null ? +(buys.returnPct - sells.returnPct).toFixed(2) : null;
  const matchedDollars = Math.min(buys.dollars, sells.dollars);
  const daysSince = daysBetween(dec.date, asOf);
  const verdict = daysSince == null || daysSince < MIN_GRADE_DAYS ? 'open' : alpha == null ? 'unknown' : alpha >= 0 ? 'ahead' : 'behind';
  return { ...dec, grade: { metricVersion: GRADING_VERSION, byTrade,
    // Compatibility fields now mean BUY basket return and BUY excess return, never a signed blend.
    avgContrib: buys.returnPct, spyRet, alpha, daysSince, verdict,
    buyReturnPct: buys.returnPct, soldReturnPct: sells.returnPct,
    sellAvoidedPct: sells.returnPct == null ? null : -sells.returnPct,
    rotationPct, matchedDollars,
    rotationBenefit: rotationPct == null ? null : +(matchedDollars * rotationPct / 100).toFixed(2),
    basis: 'price-return', buys, sells } };

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
// A leg with k drivers splits its dollars 1/k across them. This is descriptive and cannot identify
// causal effects. Overlapping buys and correlated sleeves are not independent samples. Anything cleverer (regression on sleeve scores) needs far more decisions than this account
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

// ── FROZEN OUTCOME MARKS ───────────────────────────────────────────────────────────────────────
// gradeDecision marks every decision to TODAY's price. That is right for "how am I doing" and
// useless for learning: a June call's contribution and verdict keep moving for as long as the
// position exists, so the log can never answer "what is our 30-day hit rate?" — the number it would
// answer with changes every hour. Accumulating more history does not compound into anything while
// every row is still being re-graded against a moving target.
//
// A mark freezes the outcome at a fixed horizon. It is stamped ONCE, on the first run at or past
// that horizon, and NEVER recomputed — the same rule that makes `drivers` a decision-time stamp
// rather than something reconstructed later from whatever target happens to be current.
export const MARK_HORIZONS = [5, 30, 90];
// How late a run may stamp a horizon and still call it that horizon. Covers weekends, holidays and
// a producer outage; beyond it the measurement is simply not the one we claim to be taking.
export const MARK_GRACE_DAYS = 5;

// ── MEASURING A HORIZON FROM RECORDED CLOSES ──────────────────────────────────────────────────
// A mark stamped live can only ever measure a horizon reached WHILE the producer was watching, so a
// log that starts with backfilled history yields no statistics for months. It does not have to: the
// snapshot already carries `data.hist.day` — real recorded daily closes — so the outcome of a June
// decision at +30 days is ARITHMETIC ON PRICES WE ALREADY HAVE, not a guess. This computes it, and
// it is preferred over the live basis wherever it can, because close-to-close is the consistent
// measurement (a live stamp reads whatever the price happened to be at run time).
//
// THE ONE THING THAT MUST NOT HAPPEN is pricing off a STALE series. `data.hist.day` goes stale PER
// SYMBOL — the producer only refreshes bars for names in its current fetch rotation, so a name that
// rotated out keeps whatever series it had when it left, sometimes for months. A series that stops
// mid-run stops at its own high; CLAUDE.md records the day that scored MU/WULF/NBIS a perfect 10.00
// off exactly that. So the lookup requires a bar dated AT OR AFTER the target within a small window
// and NEVER falls back to the last available bar: a name whose series does not reach the horizon is
// simply not measurable, which is the correct answer.
const MARK_BAR_WINDOW_DAYS = 5;   // the horizon can land on a weekend/holiday; a longer gap is a coverage hole

// { SYM: [[day, close], …] } ascending. Skips `interpolated` placeholders and the consumer's spliced
// `live` bar (neither is a close), and accepts BOTH bar shapes — raw Robinhood {begins_at,close_price}
// and Railway's compact {t,c}. A hard `.begins_at` read throws on Railway data and gets swallowed.
export function closeIndex(histDay = {}) {
  const out = {};
  for (const [sym, bars] of Object.entries(histDay || {})) {
    if (!Array.isArray(bars)) continue;
    const rows = [];
    for (const b of bars) {
      if (!b || b.interpolated === true || b.live === true) continue;
      const day = String(b.begins_at || b.t || '').slice(0, 10);
      const close = parseFloat(b.close_price ?? b.c);
      if (/^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isFinite(close) && close > 0) rows.push([day, close]);
    }
    if (rows.length) out[sym] = [...new Map(rows).entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
  }
  return out;
}

// One decision measured at date + h days, entirely from recorded closes. Returns null if it cannot be
// measured cleanly. EVERY leg must price: a partial mark is not that day's outcome, and quietly
// dropping the leg that happened to move the number is exactly how a statistic becomes a lie.
export function markFromBars(dec, idx, h, asOf) {
  const target = shiftDayL(dec.date, h);
  if (asOf && target > asOf) return null;                 // the horizon is still in the future
  const legs = Array.isArray(dec.trades) ? dec.trades : [];
  if (!legs.length) return null;
  if (legs.some(t => !(Number(t.priceAt) > 0) || !(Number(t.dollars) > 0))) return null;
  const symbols = [...new Set(legs.map(t => String(t.sym).toUpperCase()))];
  // Every leg uses the SAME terminal close; no future bars beyond the producer's asOf.
  const dates = (idx[symbols[0]] || []).map(b => b[0]).filter(day => day >= target && day <= shiftDayL(target, MARK_BAR_WINDOW_DAYS) && (!asOf || day <= asOf));
  for (const day of dates) {
    const quotes = {};
    for (const sym of [...symbols, 'SPY']) {
      const row = (idx[sym] || []).find(b => b[0] === day);
      if (row) quotes[sym] = row[1];
    }
    if (!symbols.every(sym => quotes[sym] > 0)) continue;
    const g = gradeDecision(dec, quotes, day).grade;
    return { at: day, days: daysBetween(dec.date, day), horizon: h, metricVersion: GRADING_VERSION,
      contribPct: g.buyReturnPct, soldReturnPct: g.soldReturnPct, rotationPct: g.rotationPct,
      src: 'bars', spyRet: g.spyRet, alphaPct: g.alpha };
  }
  return null;
}

// Local so this module stays standalone (maindecisions.mjs exports the same helper for its own use).
function shiftDayL(day, delta) {
  const d = new Date(String(day).slice(0, 10) + 'T00:00:00Z');
  if (isNaN(d)) return day;
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

// Carry prior marks forward and stamp any horizon newly reached. `priorDecisions` is the previous
// snapshot's graded list (marks live in the snapshot, so they survive without a second store).
//
// A decision FIRST SEEN past a horizon records that horizon as `missed`, never as a value. This
// matters for a backfilled log: the 21 days derived from ••••0741's existing order history are all
// already older than 90 days, and stamping them at first sight would file a 78-day-old outcome as
// a "5-day" result and quietly poison the very statistics this exists to produce. They are honestly
// recorded as unmeasurable, and the forward record starts clean. (Recomputing them from `data.hist`
// daily bars is possible and is the natural follow-up; it is NOT the same thing as guessing.)
export function applyMarks(graded, priorDecisions = [], asOf, { histDay = null } = {}) {
  const priorById = new Map();
  const legacyById = new Map((priorDecisions || []).filter(Boolean).map(d => [d.id, d.legacyMarks]));
  for (const d of priorDecisions || []) if (d && d.id && d.marks) priorById.set(d.id, d.marks);
  const idx = histDay ? closeIndex(histDay) : null;
  const decisions = (graded.decisions || []).map((d) => {
    const oldMarks = priorById.get(d.id) || {};
    const marks = Object.fromEntries(Object.entries(oldMarks).filter(([, m]) => m.metricVersion === GRADING_VERSION));
    const g = d.grade || {};
    for (const h of MARK_HORIZONS) {
      if (marks[h]) continue;                              // stamped once — never restamped
      if (g.daysSince == null || g.daysSince < h) continue; // not yet due
      // Recorded closes first: they measure exactly the window, and they can reach BACK, so a
      // backfilled log gets real statistics now instead of in three months.
      const fromBars = idx ? markFromBars(d, idx, h, asOf) : null;
      if (fromBars) { marks[h] = fromBars; continue; }
      if (g.daysSince > h + MARK_GRACE_DAYS) { marks[h] = { missed: true, firstSeenDays: g.daysSince, metricVersion: GRADING_VERSION }; continue; }
      if (g.avgContrib == null) continue;                  // unpriced: wait, don't record a false miss
      marks[h] = { at: asOf, days: g.daysSince, metricVersion: GRADING_VERSION, contribPct: g.avgContrib, soldReturnPct: g.soldReturnPct, rotationPct: g.rotationPct, src: 'live',
        ...(g.spyRet != null ? { spyRet: g.spyRet } : {}), ...(g.alpha != null ? { alphaPct: g.alpha } : {}) };
    }
    return { ...d, marks, ...(Object.values(oldMarks).some(m => m.metricVersion !== GRADING_VERSION) ? { legacyMarks: d.legacyMarks || legacyById.get(d.id) || oldMarks } : legacyById.get(d.id) ? {legacyMarks:legacyById.get(d.id)} : {}) };
  });
  return { ...graded, decisions, markStats: markStats(decisions) };
}

// The roll-up that makes the marks worth keeping: per horizon, how many decisions have a REAL
// frozen outcome, how often it beat SPY, and the average alpha. `missed` marks are counted
// separately and never folded into the result — a backfilled row is not evidence.
export function markStats(decisions = []) {
  const out = {};
  for (const h of MARK_HORIZONS) {
    const all = decisions.map((d) => d.marks && d.marks[h]).filter(Boolean);
    const real = all.filter((m) => !m.missed && m.metricVersion === GRADING_VERSION);
    const withAlpha = real.filter((m) => m.alphaPct != null);
    out[h] = {
      n: real.length, comparableN: withAlpha.length, unknown: real.length - withAlpha.length,
      fromBars: real.filter((m) => m.src === 'bars').length,
      missed: all.length - real.length,
      ahead: withAlpha.filter((m) => m.alphaPct >= 0).length,
      avgAlpha: withAlpha.length ? +(withAlpha.reduce((s, m) => s + m.alphaPct, 0) / withAlpha.length).toFixed(2) : null,
      avgContrib: real.some(m=>m.contribPct!=null) ? +(real.filter(m=>m.contribPct!=null).reduce((s,m)=>s+m.contribPct,0)/real.filter(m=>m.contribPct!=null).length).toFixed(2) : null,
    };
  }
  return out;
}

// BUY-SIDE ALPHA — the honest read on whether the RESEARCH is working (2026-09-08).
//
// Before metric v2 the record-level stat blended BUY legs and SELL legs into one average, and those answer two
// different questions. A trim scores well when the name it sold kept falling — which is the churn
// governor and the risk caps doing their job, not the screen picking a winner. Measured on the live
// ledger the difference was not cosmetic: record-level read 5 ahead / 5 behind at −0.30% average alpha,
// while the same ledger's BUY legs alone were −1.89% dollar-weighted across 33 legs. The headline was
// being read as "the picks are working" when what it partly showed was "the exits were well timed".
//
// So: buys only, DOLLAR-weighted (a $500 leg and a $25 leg are not one vote each), alpha vs SPY over
// each leg's own window. Metric v2 also makes record-level stats buy-only and tracks missing
// benchmarks explicitly; consumers must check gradingVersion before showing these results.
export function buyStats(graded = []) {
  let dollars = 0, wContrib = 0, wAlpha = 0, alphaDollars = 0, n = 0, ahead = 0, comparableN = 0;
  for (const d of graded) {
    for (const t of ((d.grade && d.grade.byTrade) || [])) {
      if (String(t.side || '').toUpperCase() !== 'BUY') continue;
      const $ = Math.abs(+t.dollars || 0);
      if (!($ > 0) || t.retPct == null) continue;
      n++; dollars += $; wContrib += $ * t.retPct;
      // The leg's alpha is its return less SPY's over the SAME window — the decision's own spyRet.
      const spy = d.grade && d.grade.spyRet;
      if (spy != null) { comparableN++; const a = t.retPct - spy; wAlpha += $ * a; alphaDollars += $; if (a >= 0) ahead++; }
    }
  }
  return {
    n, dollars: +dollars.toFixed(2),
    avgRetPct: dollars > 0 ? +(wContrib / dollars).toFixed(2) : null,
    avgAlphaPct: alphaDollars > 0 ? +(wAlpha / alphaDollars).toFixed(2) : null,
    ahead, behind: comparableN - ahead, comparableN, unknown: n - comparableN,
    // Below this the number is a curiosity, not a finding — same posture as the sleeve `thin` flag.
    thin: comparableN < BUY_MIN_N,
  };
}
export const BUY_MIN_N = 8;

export function gradeDecisions(decisions = [], quotesNow = {}, asOf) {
  const graded = decisions.map((d) => gradeDecision(d, quotesNow, asOf))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)); // newest first
  const resolved = graded.filter((d) => ['ahead', 'behind'].includes(d.grade.verdict));
  const ahead = resolved.filter((d) => d.grade.verdict === 'ahead').length;
  const withAlpha = resolved.filter((d) => d.grade.alpha != null);
  const avgAlpha = withAlpha.length ? +(withAlpha.reduce((s, d) => s + d.grade.alpha, 0) / withAlpha.length).toFixed(2) : null;
  const sleeves = sleeveStats(graded);
  const versions = {};
  for (const d of graded) { const key = d.modelVersion || 'legacy-unversioned'; (versions[key] ||= []).push(d); }
  const byModelVersion = Object.fromEntries(Object.entries(versions).map(([key, rows]) => [key, { decisions: rows.length, buys: buyStats(rows), sleeves: sleeveStats(rows) }]));
  return { gradingVersion: GRADING_VERSION, byModelVersion, decisions: graded, stats: { total: graded.length, resolved: resolved.length, ahead, behind: resolved.length - ahead, avgAlpha }, sleeves, buys: buyStats(graded) };
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
  // Same shape of loss, same volume (2026-09-02). `spyAt` is the SPY close stamped at decision time, and
  // both downstream measurements gate on it being > 0: gradeDecisions' alpha, and the frozen 5/30/90d
  // marks. It cannot be backfilled either — the record is dated, and reading "whatever SPY is now" would
  // benchmark the decision against the wrong day. Today's 2026-09-02 record was appended with
  // `spyAt: null`, so it is permanently unmeasurable against the benchmark.
  if (!(+spyAt > 0) && (buys.length || trims.length)) {
    console.warn(`[agentic-ledger] makeDecision(${date}) called WITHOUT a positive \`spyAt\` — this rebalance can never be graded against SPY (no alpha, no frozen marks) and the omission cannot be backfilled. Stamp the SPY price at decision time (the executor reads it from the live quote before placing).`);
  }
  const trades = [
    ...buys.map((b) => { const d = driversOf(b.sym); return ({ sym: String(b.sym).toUpperCase(), side: 'BUY', dollars: num(b.dollars), shares: num(b.shares), priceAt: num(b.price ?? b.priceAt), weightBefore: num(b.weightNow), weightAfter: num(b.weightTarget), ...(d ? { drivers: d } : {}) }); }),
    ...trims.map((t) => ({ sym: String(t.sym).toUpperCase(), side: 'TRIM', dollars: num(t.dollars), shares: num(t.shares), priceAt: num(t.price ?? t.priceAt), weightBefore: num(t.weightNow), weightAfter: num(t.weightTarget) })),
  ];
  return { ...provenance(target), id: `${date}-${kind}`, date, kind, targetAsOf: targetAsOf || null, book: num(book), equityAtDecision: num(equity), spyAt: num(spyAt), rationale: rationale || '', trades };
}

// SNAPSHOT IDENTITY GUARD (2026-08-31). Does the snapshot's agentic book agree with what THIS system's
// own committed records say ••••3900 owns? On 2026-08-31 a producer run published the SELF-DIRECTED
// account's holdings into `data.agentic` — book $31,800 instead of $11,551, positions IREN/PLTR/TSM/CIFR
// instead of the twelve names actually held — and the deploy planner, doing exactly its job on the data it
// was handed, produced a $61,962 ticket that would have liquidated the wrong account. 350 of those IREN
// shares back short calls in the margin book, so a one-tap approval would have written naked calls.
//
// The executor's live 5%-book-move abort WOULD have caught it (175% off), but that check runs only in the
// EXEC_AUTO/EXEC_TRADE placement path — EXEC_PROPOSE writes its ticket and pushes the owner a one-tap
// BEFORE any live account call. So the check has to happen here, before a mode is ever printed, and it has
// to be CODE: the executor Routine is bound to a persistent session, so its prompt cannot be edited and
// prompt wording cannot be load-bearing (CLAUDE.md).
//
// Both tests compare the snapshot against files THIS system writes and therefore knows to be true, rather
// than against a threshold that a real deposit or a real drawdown could trip:
//   (a) the parking ledger is the sole system of record for the waiting ground — it cannot hold dollars in
//       a vehicle the book does not contain;
//   (b) a name bought and not since sold, per our own decisions ledger, must still be there. Requiring
//       that ZERO of them survive keeps this quiet through ordinary rebalancing (a ticket moves a few
//       names, never all of them) while a wrong-account payload fails it outright.
// Returns a reason string (caller idles) or null. Fails OPEN on thin records: a young account with fewer
// than SANITY_MIN_EXPECTED tracked names is not judged, because there is nothing yet to contradict.
export const SANITY_MIN_EXPECTED = 3;
export function snapshotHoldingsSanity({ positions = [], activity = {}, parked = null } = {}) {
  const syms = new Set((positions || [])
    .map((p) => String((p && (p.symbol || p.sym)) || '').toUpperCase()).filter(Boolean));
  if (parked && +parked.dollars > 0 && parked.vehicle) {
    const v = String(parked.vehicle).toUpperCase();
    if (!syms.has(v)) return `the parking ledger holds $${(+parked.dollars).toFixed(2)} in ${v}, but the snapshot's agentic book has no ${v} position — the snapshot disagrees with this system's own record of what it owns`;
  }
  const expected = Object.keys(activity || {}).filter((sym) => {
    const a = activity[sym] || {};
    return a.lastBuyDate && (!a.lastSellDate || a.lastSellDate < a.lastBuyDate);
  }).sort();
  if (expected.length >= SANITY_MIN_EXPECTED && !expected.some((sym) => syms.has(sym)))
    return `none of the ${expected.length} name(s) this account bought and did not sell (${expected.join(', ')}) appear in the snapshot's agentic positions (${[...syms].sort().join(', ') || 'none'}) — this looks like the wrong account's book`;
  return null;
}

// Churn-governor input (2026-08-12): fold the committed decisions ledger into the deploy planner's
// `accountActivity` shape — {SYM:{lastBuyDate,lastSellDate}} over the trailing window. This is what
// lets the exec gate see "we bought AAPL two days ago / sold MSFT yesterday" BETWEEN producer runs
// (raw/ is wiped; the ledger is the committed record of every placed rebalance). The executor still
// overlays today's live fills from get_equity_orders — this covers everything before today.
//
// PER-LOT DETAIL (2026-09-09): each symbol also carries `buys: [{date, dollars, shares}]` — every BUY
// leg inside the window, oldest first. `lastBuyDate` alone can only answer "was ANY of this name bought
// recently", which made the min-hold a per-NAME lock: a $200 SPY top-up on 09-08 froze the whole $2,265
// SPY position for two weeks and left the first Mandate A rebalance with nothing to sell. The lot list
// is what lets `agentic-deploy`'s minHoldBlock lock only the SHARES bought inside the window and trade
// the older ones. `shares` is dollars ÷ the leg's recorded `priceAt`; a leg with no usable price yields
// `shares: null`, which the planner reads as "size unknown" and fails SAFE by locking the whole
// position — an unknown lot must never be treated as a zero-share one. SELL/TRIM/EXIT legs never enter
// `buys` (they release shares; they don't lock any).
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
      if (side !== 'BUY') continue;
      const dollars = Number(t.dollars), px = Number(t.priceAt);
      (m.buys || (m.buys = [])).push({
        date: String(d.date).slice(0, 10),
        dollars: Number.isFinite(dollars) ? +dollars.toFixed(2) : null,
        shares: (Number.isFinite(dollars) && dollars >= 0 && Number.isFinite(px) && px > 0)
          ? +(dollars / px).toFixed(6) : null,
      });
    }
  }
  // Oldest first — the planner reads the LATEST in-window lot for the unlock date, and a ledger is not
  // guaranteed to be in date order (an owner overlay or a re-derived day can land out of sequence).
  for (const m of Object.values(map)) if (m.buys) m.buys.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return map;
}

function daysBetween(a, b) {
  if (!a) return null;
  const t0 = Date.parse(String(a).slice(0, 10) + 'T00:00:00Z');
  const t1 = b ? Date.parse(String(b).slice(0, 10) + 'T00:00:00Z') : Date.now();
  if (!Number.isFinite(t0) || !Number.isFinite(t1)) return null;
  return Math.round((t1 - t0) / 86400000);
}
