// producer/flow.mjs — the "Flow & Positioning" signal layer: pure scorers that turn provider payloads
// into 0-10 sub-scores plus a weighted composite, for the agentic-research workflow's 5th sleeve.
//
// WHY: the four existing sleeves (momentum / quality / growth / catalyst) all read the company's own
// fundamentals and price. None of them read WHO IS ACTING on the name. This layer adds that, from three
// sources that are live and free on the keys we already hold (see PROPOSAL-flow-signals.md for the full
// survey, including everything that was probed and rejected):
//   • ANALYST REVISION MOMENTUM — Finnhub /stock/recommendation. The best-evidenced signal in the survey:
//     post-revision drift. We score the DIRECTION of change far above the level, because consensus levels
//     are structurally bullish (hold ≈ sell) and carry almost no information on their own.
//   • INSIDER CLUSTERS — Finnhub /stock/insider-transactions + /stock/insider-sentiment. Officers acting
//     with their own money, 2-5 day filing lag. Gated to OPEN-MARKET codes and to genuine clusters.
//   • EARNINGS SURPRISE / PEAD — Finnhub /stock/earnings. Post-announcement drift off the surprise history.
//
// CONVENTIONS (match the rest of the producer):
//   • Every scorer returns { score: 0-10, ... detail } or NULL when it has no usable data. Neutral is 5.
//     Null propagates as "no opinion" rather than a fake 5, so a sparse name can't be nudged by silence.
//   • flowScore() needs at least MIN_COMPONENTS present, mirroring the consumer's _fundScore rule; below
//     that it returns null and the sleeve simply abstains for that name.
//   • Weights renormalize over whatever IS present, so a component can be added later (federal contract
//     awards, Phase 2) without changing any existing arithmetic.
//   • Asymmetry is deliberate in insiderScore: insiders buy for one reason and sell for a dozen
//     (diversification, taxes, scheduled plans), so sells move the score materially less than buys.
// Pure functions only (no I/O) so they're unit-testable offline — see flow.test.mjs.

const num = (v) => { if (v == null || v === '') return null; const n = parseFloat(v); return Number.isFinite(n) ? n : null; };
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const r2 = (v) => Math.round(v * 100) / 100;
const rows = (d) => (Array.isArray(d) ? d : (d && Array.isArray(d.data) ? d.data : []));
const daysBetween = (a, b) => (Date.parse(a) - Date.parse(b)) / 86400000;

// Component weights. Federal contract awards ('award') lands in Phase 2 — its weight is declared here so
// the split is documented in one place; renormalization means its absence changes nothing today.
export const FLOW_WEIGHTS = { revision: 0.40, insider: 0.30, surprise: 0.20, award: 0.10 };
export const MIN_COMPONENTS = 2;      // below this the sleeve abstains rather than guessing
export const INSIDER_WINDOW_DAYS = 90;
export const MIN_CLUSTER = 3;         // distinct insiders acting the same way to count as a cluster

// ---- 1. Analyst revision momentum -----------------------------------------
// Finnhub /stock/recommendation → [{ period:'2026-08-01', strongBuy, buy, hold, sell, strongSell }, …]
// (newest first, one row per month). We build a consensus index per month and score its CHANGE.
//
//   idx = (2·strongBuy + 1·buy + 0·hold − 1·sell − 2·strongSell) / totalAnalysts   ∈ [−2, +2]
//
// Direction is weighted 60/40 over level: a stock at idx 1.5 that has been drifting DOWN for three months
// is a worse prospect than one at idx 0.8 being upgraded, and the raw level mostly measures how loved a
// megacap already is. lookbackMonths is how far back we reach for the comparison point.
export function revisionScore(recommendation, { lookbackMonths = 3 } = {}) {
  const rs = rows(recommendation)
    .filter((r) => r && r.period)
    .map((r) => {
      const sb = num(r.strongBuy) || 0, b = num(r.buy) || 0, h = num(r.hold) || 0;
      const s = num(r.sell) || 0, ss = num(r.strongSell) || 0;
      const total = sb + b + h + s + ss;
      return total > 0 ? { period: String(r.period), idx: (2 * sb + b - s - 2 * ss) / total, total } : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.period.localeCompare(a.period));   // newest first
  if (!rs.length) return null;

  const latest = rs[0];
  const level = clamp((latest.idx + 2) * 2.5, 0, 10);    // [−2,2] → [0,10]

  // Comparison point: the row nearest `lookbackMonths` back that we actually have.
  const prior = rs[Math.min(lookbackMonths, rs.length - 1)];
  if (!prior || prior === latest) {
    // Single snapshot: no direction available. Dampen the level toward neutral rather than pretending
    // a bullish consensus level is itself a signal.
    return { score: r2(5 + (level - 5) * 0.6), level: r2(level), delta: null, analysts: latest.total, months: rs.length };
  }
  const delta = latest.idx - prior.idx;
  // Consensus indexes move slowly — a ±0.40 swing over a quarter is a decisive re-rating.
  const direction = clamp(5 + delta * 12, 0, 10);
  return {
    score: r2(clamp(0.6 * direction + 0.4 * level, 0, 10)),
    level: r2(level), delta: r2(delta), analysts: latest.total, months: rs.length,
    note: `consensus ${delta >= 0 ? 'improving' : 'deteriorating'} (${delta >= 0 ? '+' : ''}${r2(delta)} over ${Math.min(lookbackMonths, rs.length - 1)}mo, ${latest.total} analysts)`,
  };
}

// ---- 2. Insider clusters (Form 4) -----------------------------------------
// Finnhub /stock/insider-transactions → { data:[{ name, change, transactionCode, transactionDate,
//   transactionPrice, isDerivative }] }, /stock/insider-sentiment → { data:[{ year, month, mspr }] }.
//
// Only OPEN-MARKET codes carry information: 'P' (purchase) and 'S' (sale). Everything else is mechanical
// and dominates the raw feed — 'A' grants, 'M'/'X' option exercises, 'G' gifts, 'F' tax withholding —
// so including them would make almost every large-cap look like a wall of insider selling.
//
// CALIBRATION (learned from live data, don't "simplify" this back to symmetry): even after filtering to
// open-market codes, large caps sell almost continuously — the first live run scored BOTH NVDA and JPM at
// 0.9/10 on an all-sell window with zero buyers. Symmetric scoring turns this component into a constant
// negative offset applied to nearly every megacap, which discriminates between nothing and just drags the
// composite down uniformly. That matches the evidence: insider BUYING is the informative side, while
// selling is dominated by compensation, diversification and pre-scheduled plans that this endpoint gives
// us no way to distinguish. So a sell tilt moves the score ~4× less than an equivalent buy tilt: an
// all-sell window lands mildly bearish (~3.5-4), an all-buy cluster still reaches the top of the scale.
export function insiderScore(transactions, sentiment, { asOf, windowDays = INSIDER_WINDOW_DAYS } = {}) {
  const today = asOf || new Date().toISOString().slice(0, 10);
  const tx = rows(transactions).filter((t) => {
    if (!t || t.isDerivative) return false;
    const code = String(t.transactionCode || '').toUpperCase();
    if (code !== 'P' && code !== 'S') return false;
    if (!t.transactionDate) return false;
    const age = daysBetween(today, t.transactionDate);
    if (!(age >= 0 && age <= windowDays)) return false;
    return num(t.change) != null && num(t.change) !== 0;
  });
  if (!tx.length) return null;

  // Net each insider across the window, then count PEOPLE (not filings) on each side — five filings by
  // one officer is one opinion, not five.
  const byPerson = new Map();
  let buyD = 0, sellD = 0;
  for (const t of tx) {
    const who = String(t.name || 'unknown').trim().toUpperCase();
    const chg = num(t.change);
    const px = num(t.transactionPrice) || 0;
    byPerson.set(who, (byPerson.get(who) || 0) + chg);
    const dollars = Math.abs(chg) * px;
    if (chg > 0) buyD += dollars; else sellD += dollars;
  }
  let buyers = 0, sellers = 0;
  for (const net of byPerson.values()) { if (net > 0) buyers++; else if (net < 0) sellers++; }

  // Dollar tilt, with the buy/sell asymmetry applied on the way to a score.
  const totalD = buyD + sellD;
  const tilt = totalD > 0 ? (buyD - sellD) / totalD : (buyers - sellers) / Math.max(1, buyers + sellers);
  let score = 5 + (tilt > 0 ? 4.0 * tilt : 1.0 * tilt);

  const cluster = buyers >= MIN_CLUSTER ? 'buy' : (sellers >= MIN_CLUSTER ? 'sell' : null);
  if (cluster === 'buy') score += 1.0;
  else if (cluster === 'sell') score -= 0.5;

  // MSPR (Finnhub's monthly net-buy score, −100…+100) as a light confirmation of the same window. Kept
  // small: it is derived from the SAME transactions, so a large weight here would double-count them.
  const msprRows = rows(sentiment).filter((s) => s && num(s.mspr) != null)
    .sort((a, b) => ((b.year || 0) * 12 + (b.month || 0)) - ((a.year || 0) * 12 + (a.month || 0)));
  const mspr = msprRows.length ? num(msprRows[0].mspr) : null;
  if (mspr != null) score += 0.5 * clamp(mspr / 100, -1, 1);

  return {
    score: r2(clamp(score, 0, 10)),
    buyers, sellers, cluster, filings: tx.length,
    buyDollars: Math.round(buyD), sellDollars: Math.round(sellD),
    mspr: mspr == null ? null : r2(mspr),
    note: cluster
      ? `${cluster === 'buy' ? 'CLUSTER BUY' : 'cluster sell'} — ${cluster === 'buy' ? buyers : sellers} insiders in ${windowDays}d`
      : `${buyers} buyer(s) / ${sellers} seller(s) in ${windowDays}d`,
  };
}

// ---- 3. Earnings surprise / PEAD ------------------------------------------
// Finnhub /stock/earnings → [{ period, actual, estimate, surprise, surprisePercent, year, quarter }, …].
// Recency-weighted mean surprise, plus a small consistency bonus for beating repeatedly. Each quarter is
// clamped to ±25% first: a 400% "beat" off a near-zero estimate is an artefact, not four times the signal.
export function surpriseScore(earnings, { quarters = 4 } = {}) {
  const es = rows(earnings)
    .filter((e) => e && e.period && num(e.surprisePercent) != null)
    .sort((a, b) => String(b.period).localeCompare(String(a.period)))
    .slice(0, quarters);
  if (!es.length) return null;

  let wsum = 0, wtot = 0, positives = 0;
  es.forEach((e, i) => {
    const w = es.length - i;                       // most recent quarter weighted heaviest
    const sp = clamp(num(e.surprisePercent), -25, 25);
    wsum += sp * w; wtot += w;
    if (sp > 0) positives++;
  });
  const avg = wtot > 0 ? wsum / wtot : 0;
  const consistency = 0.4 * ((positives - es.length / 2) / Math.max(1, es.length / 2));
  return {
    score: r2(clamp(5 + avg * 0.35 + consistency, 0, 10)),
    avgSurprisePct: r2(avg), positives, quarters: es.length,
    note: `${positives}/${es.length} beats, avg ${avg >= 0 ? '+' : ''}${r2(avg)}%`,
  };
}

// ---- Composite -------------------------------------------------------------
// Weighted blend over whatever components are present, renormalized. Returns null below MIN_COMPONENTS so
// a name with only one live signal abstains instead of letting that signal masquerade as a whole sleeve.
export function flowScore(parts = {}, weights = FLOW_WEIGHTS) {
  const present = Object.entries(parts)
    .filter(([k, v]) => v && Number.isFinite(v.score) && Number.isFinite(weights[k]))
    .map(([k, v]) => ({ key: k, score: v.score, w: weights[k] }));
  if (present.length < MIN_COMPONENTS) return null;
  const wtot = present.reduce((a, p) => a + p.w, 0);
  const score = present.reduce((a, p) => a + p.score * p.w, 0) / wtot;
  return {
    score: r2(clamp(score, 0, 10)),
    coverage: present.map((p) => p.key),
    components: Object.fromEntries(present.map((p) => [p.key, p.score])),
  };
}

// Convenience: raw provider payloads for one symbol → the full flow read. Used by build-data.mjs and by
// the research workflow's sleeve agent so both compute the score identically.
export function scoreSymbol({ recommendation, insiderTx, insiderSentiment, earnings } = {}, opts = {}) {
  const revision = revisionScore(recommendation, opts);
  const insider = insiderScore(insiderTx, insiderSentiment, opts);
  const surprise = surpriseScore(earnings, opts);
  const flow = flowScore({ revision, insider, surprise });
  return { flow, revision, insider, surprise };
}
