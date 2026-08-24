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
// Insider sell-intensity calibration (v121). See insiderScore for why the old direction-only read
// saturated at a constant ~3.2 for nearly every large cap.
export const INSIDER_BASELINE_MIN_DAYS = 120;      // shorter history than this can't calibrate a pace
export const INSIDER_MIN_BASELINE_DOLLARS = 50000; // a baseline thinner than this is noise to divide by
export const INSIDER_STALE_DAYS = 150;             // newest open-market filing older than this ⇒ abstain
export const INSIDER_SELL_SLOPE = 1.0;             // score points per doubling of the normal sell pace
// ASYMMETRIC CAPS, for the same reason insiderScore treats buys and sells asymmetrically. Heavy selling
// can cost 3 points; a COLLAPSE in selling earns at most 1, because "nobody sold" is far weaker evidence
// than "somebody bought" — and a single 10%-owner can dominate a baseline all by itself (LLY's is the
// Lilly Endowment, a foundation whose selling is portfolio management, not an opinion about the company).
export const INSIDER_HEAVY_CAP = 3;                // ≥8× the normal pace is as bearish as it gets
export const INSIDER_QUIET_CAP = 1;                // ≤half the normal pace is as bullish as it gets
export const INSIDER_UNCALIBRATED_NUDGE = 0.5;     // uncalibrated selling: a nudge, never the old floor
export const INSIDER_PRICE_SANITY_FACTOR = 10;     // reject rows priced >10× off the feed's own median
export const INSIDER_PRICE_SANITY_MIN_ROWS = 5;    // below this a median is too unstable to police with

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
    note: `consensus ${delta > 0 ? 'improving' : delta < 0 ? 'deteriorating' : 'flat'} (${delta > 0 ? '+' : ''}${r2(delta)} over ${Math.min(lookbackMonths, rs.length - 1)}mo, ${latest.total} analysts)`,
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
  // Open-market P/S only, non-derivative, real size, not future-dated. Mechanical codes ('A' grants,
  // 'M'/'X' exercises, 'G' gifts, 'F' withholding) carry no opinion and dominate the raw feed.
  const all = rows(transactions).filter((t) => {
    if (!t || t.isDerivative) return false;
    const code = String(t.transactionCode || '').toUpperCase();
    if (code !== 'P' && code !== 'S') return false;
    if (!t.transactionDate) return false;
    if (!(daysBetween(today, t.transactionDate) >= 0)) return false;   // drop future-dated provider junk
    return num(t.change) != null && num(t.change) !== 0;
  });
  if (!all.length) return null;

  // PROVIDER PRICE SANITY (v121). Every row here is dollarized as |change| × transactionPrice, so ONE
  // corrupt price silently dominates a sum. Live case: two LLY rows carried transactionPrice ≈ 1,031,415
  // on a stock trading ~$1,185 — a 1000× scaling error — which alone accounted for $75.8B of an
  // $79.4B "baseline" and made every subsequent window look 2000× quieter than normal, i.e. spuriously
  // BULLISH. That is the original saturation bug's mirror image and is more dangerous, so it is policed
  // here rather than absorbed downstream. The test is the row's price against the FEED'S OWN median
  // price, which is scale-free and survives a year of genuine price movement; it deliberately does NOT
  // reject rows for being large in DOLLARS, because a genuinely enormous sale is real signal (Bezos sold
  // 1.2M AMZN shares at a perfectly normal $286 on 2026-08-03 — that must survive).
  const priced = all.filter((t) => (num(t.transactionPrice) || 0) > 0);
  let clean = priced;
  if (priced.length >= INSIDER_PRICE_SANITY_MIN_ROWS) {
    const px = priced.map((t) => num(t.transactionPrice)).sort((a, b) => a - b);
    const medPx = px[Math.floor(px.length / 2)];
    const hi = medPx * INSIDER_PRICE_SANITY_FACTOR, lo = medPx / INSIDER_PRICE_SANITY_FACTOR;
    clean = priced.filter((t) => { const q = num(t.transactionPrice); return q >= lo && q <= hi; });
  }
  const dropped = all.length - clean.length;
  if (!clean.length) return null;

  // ANCHOR THE WINDOW TO THE NEWEST FILING, NOT TO TODAY. Form 4s land days-to-weeks after the trade,
  // so a today-anchored window is systematically under-filled relative to an older, fully-filed
  // baseline — which would bias EVERY name toward "insiders have gone quiet". Anchoring both spans to
  // the same filed frontier removes that bias. A feed whose newest open-market filing is older than
  // INSIDER_STALE_DAYS has no current opinion in it at all, so it abstains.
  const dates = clean.map((t) => String(t.transactionDate)).sort();
  const anchor = dates[dates.length - 1];
  const anchorAge = Math.round(daysBetween(today, anchor));
  if (anchorAge > INSIDER_STALE_DAYS) return null;

  const inWindow = (t) => { const a = daysBetween(anchor, t.transactionDate); return a >= 0 && a <= windowDays; };
  const tx = clean.filter(inWindow);
  if (!tx.length) return null;
  const priorTx = clean.filter((t) => daysBetween(anchor, t.transactionDate) > windowDays);

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

  // ---- SELL INTENSITY vs the name's OWN baseline (the v121 fix) -------------------------------
  // The old scorer read the DIRECTION of the dollar tilt. For a large cap that is a constant: insiders
  // sell continuously and essentially never buy on the open market, so tilt pinned at −1 and the score
  // saturated in a 3.0–3.5 band for 12 of 13 covered names — a uniform offset that cancels out of any
  // ranking, i.e. 30% of the composite's weight measuring nothing. (Live probe: NVDA had 405 open-market
  // sells and ZERO buys across 11 months.) The information is not THAT insiders sold, it is whether they
  // sold unusually HARD for this company — the same probe showed NVDA's monthly open-market sales ranging
  // $133K to $507M, a 3000× spread the old score collapsed to one number.
  // So: compare the window's sell RATE to the trailing rate from the same feed. Normal run-rate ⇒ ~5
  // (no information), a multiple of it ⇒ bearish, a collapse in selling ⇒ mildly bullish.
  const spanDays = (list) => {
    if (!list.length) return 0;
    const ds = list.map((t) => String(t.transactionDate)).sort();
    return Math.max(1, Math.round(daysBetween(anchor, ds[0])) - windowDays);
  };
  const priorSellD = priorTx.reduce((a, t) => { const c = num(t.change); return c < 0 ? a + Math.abs(c) * (num(t.transactionPrice) || 0) : a; }, 0);
  const baselineDays = spanDays(priorTx);
  const calibrated = baselineDays >= INSIDER_BASELINE_MIN_DAYS && priorSellD >= INSIDER_MIN_BASELINE_DOLLARS;

  let score = 5, sellIntensity = null;
  if (calibrated) {
    const windowRate = sellD / windowDays;
    const baseRate = priorSellD / baselineDays;
    sellIntensity = r2(windowRate / baseRate);
    // log2 so each DOUBLING of the normal rate costs a fixed number of points. Capped both ways (see
    // INSIDER_HEAVY_CAP / INSIDER_QUIET_CAP) so one outlier filing can't drive the score to zero and a
    // quiet quarter can't manufacture a strong bullish read out of an absence.
    const lr = sellIntensity > 0 ? clamp(Math.log2(sellIntensity), -INSIDER_QUIET_CAP, INSIDER_HEAVY_CAP) : -INSIDER_QUIET_CAP;
    score = 5 - lr * INSIDER_SELL_SLOPE;
  } else if (sellD > 0) {
    // Not enough history to say whether this selling is unusual. A small nudge, NOT the old saturated
    // floor — an uncalibrated read must not masquerade as a strong bearish signal.
    score = 5 - INSIDER_UNCALIBRATED_NUDGE;
  }

  // Buys stay asymmetrically strong: insiders buy for one reason and sell for a dozen (diversification,
  // taxes, 10b5-1 plans). Don't "simplify" this back to symmetry.
  if (buyD > 0) score += 4.0 * (buyD / (buyD + sellD));

  const cluster = buyers >= MIN_CLUSTER ? 'buy' : (sellers >= MIN_CLUSTER ? 'sell' : null);
  if (cluster === 'buy') score += 1.0;
  else if (cluster === 'sell') score -= 0.5;

  // MSPR (Finnhub's monthly net-buy score, −100…+100) as a light confirmation of the same window. Kept
  // small: it is derived from the SAME transactions, so a large weight here would double-count them.
  const msprRows = rows(sentiment).filter((s) => s && num(s.mspr) != null)
    .sort((a, b) => ((b.year || 0) * 12 + (b.month || 0)) - ((a.year || 0) * 12 + (a.month || 0)));
  const mspr = msprRows.length ? num(msprRows[0].mspr) : null;
  if (mspr != null) score += 0.5 * clamp(mspr / 100, -1, 1);

  // The window closed over a quarter ago: real, but no longer a statement about the present.
  const stale = anchorAge > windowDays;
  if (stale) score = 5 + (score - 5) * 0.5;

  const intensityNote = sellIntensity == null ? 'sell pace uncalibrated (too little history)'
    : sellIntensity >= 2 ? `selling ${r2(sellIntensity)}× its own normal pace`
    : sellIntensity <= 0.5 ? `selling has slowed to ${r2(sellIntensity)}× normal`
    : 'selling near its own normal pace';
  return {
    score: r2(clamp(score, 0, 10)),
    buyers, sellers, cluster, filings: tx.length,
    buyDollars: Math.round(buyD), sellDollars: Math.round(sellD),
    sellIntensity, baselineDays: calibrated ? baselineDays : null, calibrated,
    anchor, anchorAge, stale, droppedRows: dropped,
    mspr: mspr == null ? null : r2(mspr),
    note: cluster
      ? `${cluster === 'buy' ? 'CLUSTER BUY' : 'cluster sell'} — ${cluster === 'buy' ? buyers : sellers} insiders in ${windowDays}d; ${intensityNote}`
      : `${buyers} buyer(s) / ${sellers} seller(s) in ${windowDays}d; ${intensityNote}`,
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

// ---- 4. Federal contract awards -------------------------------------------
// Finnhub /stock/usa-spending → { data:[{ actionDate, obligatedAmount, totalValue, potentialAmount,
//   awardingAgencyName, recipientParentName, … }] }.
//
// This is the signal the political-disclosure feeds are a rear-view mirror OF: money the federal
// government has actually committed to the company, visible before it reaches the income statement.
// Scored as GROWTH (trailing 12 months vs the 12 before it) rather than level, because the level just
// measures how big a defence contractor is — LMT will always out-award NVDA, which says nothing about
// either as an investment. Weighted lowest of the four components (10%): it is meaningful for
// government-exposed names and silent for everyone else, which is exactly what abstention is for.
//
// CAVEAT (seen on the first live run): award flow is LUMPY. A single multi-year contract lands entirely
// in one year's window, so YoY growth can swing violently on no real change in the business — LMT scored
// −95% purely because the prior 12 months contained one very large award. This is the main reason the
// component carries the smallest weight of the four, and why it is a growth signal rather than anything
// that pretends to be precise. Treat a large negative as "no fresh awards this year", not as decline.
export function awardScore(usaSpending, { asOf } = {}) {
  const today = asOf || new Date().toISOString().slice(0, 10);
  const rs = rows(usaSpending).filter((a) => a && a.actionDate);
  if (!rs.length) return null;

  let recent = 0, prior = 0, nRecent = 0;
  const agencies = new Map();
  for (const a of rs) {
    const age = daysBetween(today, a.actionDate);
    if (!(age >= 0)) continue;                    // ignore future-dated rows
    const amt = num(a.obligatedAmount) ?? num(a.totalValue) ?? 0;
    if (!(amt > 0)) continue;
    if (age <= 365) {
      recent += amt; nRecent++;
      const ag = String(a.awardingAgencyName || 'unknown');
      agencies.set(ag, (agencies.get(ag) || 0) + amt);
    } else if (age <= 730) prior += amt;
  }
  if (recent === 0 && prior === 0) return null;

  // Bounded growth: −1 (awards dried up) … +1 (new or sharply expanding award flow).
  const growth = (recent - prior) / Math.max(recent, prior, 1);
  const topAgency = [...agencies.entries()].sort((a, b) => b[1] - a[1])[0];
  return {
    score: r2(clamp(5 + 4 * growth, 0, 10)),
    recent12mo: Math.round(recent), prior12mo: Math.round(prior),
    growth: r2(growth), awards: nRecent,
    topAgency: topAgency ? topAgency[0] : null,
    note: `$${(recent / 1e6).toFixed(1)}M obligated in 12mo (${growth >= 0 ? '+' : ''}${Math.round(growth * 100)}% vs prior year)${topAgency ? ` · ${topAgency[0]}` : ''}`,
  };
}

// ---- Lobbying intensity (a RISK FLAG, not a score) -------------------------
// Finnhub /stock/lobbying → { data:[{ year, period:'Q4', income, expenses, … }] }.
//
// Deliberately NOT scored into the composite. Heavy lobbying is not bullish or bearish — it marks a name
// with live regulatory exposure, i.e. higher policy beta. A company ramping its spend is usually fighting
// something. Surfaced as context beside the policy calendar so a reader can connect "this name lobbies
// hard on X" with "X has a scheduled decision next month", which is where the actual risk lives.
export function lobbyingFlag(lobbying, { asOf } = {}) {
  const today = asOf || new Date().toISOString().slice(0, 10);
  const yr = +today.slice(0, 4), qtr = Math.floor((+today.slice(5, 7) - 1) / 3) + 1;
  const absQ = (y, q) => y * 4 + q;
  const nowQ = absQ(yr, qtr);
  const rs = rows(lobbying).filter((l) => l && l.year);
  if (!rs.length) return null;

  let ttm = 0, prior = 0, filings = 0;
  for (const l of rs) {
    const q = /Q(\d)/i.exec(String(l.period || '')) ? +/Q(\d)/i.exec(String(l.period))[1] : 4;
    const age = nowQ - absQ(+l.year, q);
    const amt = num(l.income) ?? num(l.expenses) ?? 0;
    if (!(amt > 0) || age < 0) continue;
    if (age < 4) { ttm += amt; filings++; } else if (age < 8) prior += amt;
  }
  if (ttm === 0 && prior === 0) return null;
  const trend = prior > 0 ? (ttm - prior) / prior : (ttm > 0 ? 1 : 0);
  return {
    ttm: Math.round(ttm), prior: Math.round(prior), trend: r2(trend), filings,
    note: `$${(ttm / 1e3).toFixed(0)}k lobbying TTM${prior > 0 ? ` (${trend >= 0 ? '+' : ''}${Math.round(trend * 100)}% YoY)` : ''}`,
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
export function scoreSymbol({ recommendation, insiderTx, insiderSentiment, earnings, usaSpending, lobbying } = {}, opts = {}) {
  const revision = revisionScore(recommendation, opts);
  const insider = insiderScore(insiderTx, insiderSentiment, opts);
  const surprise = surpriseScore(earnings, opts);
  const award = awardScore(usaSpending, opts);
  const lobby = lobbyingFlag(lobbying, opts);   // context only — never enters the composite
  const flow = flowScore({ revision, insider, surprise, award });
  return { flow, revision, insider, surprise, award, lobby };
}
