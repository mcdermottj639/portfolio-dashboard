// Recorded account-equity history — the ONE place that knows how a self-funded account's real,
// deposit-immune return is recorded. Pure + unit-tested.
//
// WHY THIS EXISTS. Robinhood publishes no account-equity-history endpoint, so an account's actual
// return cannot be backfilled — it can only be RECORDED FORWARD, one point per day, from the day the
// producer starts looking. And it exposes no transfers feed either, so a deposit is indistinguishable
// from profit unless we infer it: a $1,000 → $3,500 funding jump otherwise reads as a bogus +250%
// (the bug that prompted the agentic version of this in v92).
//
// THE INFERENCE. A deposit lands in cash without a matching position change; price moves and internal
// buys/sells do not. So
//     flow ≈ ΔEquity − Σ(priorQty × price move)
// Internal buys and sells net to ~0 (cash out, shares in), and a gap where quantities didn't change
// is exact. Only moves past a noise floor count as a flow, so ordinary P&L and rounding don't
// register. The running total is stored as `cumFlow` on each point; the consumer chains per-step
// returns with those deltas neutralized, giving a time-weighted return.
//
// THE PRICE-MOVE SUM WAS THE WEAK LINK, AND IT IS NO LONGER THE PRIMARY (2026-08-30). `equity` comes
// from the broker's `total_value` but the position prices come from `data.quotes`, and the two are
// sampled on DIFFERENT CLOCKS — quotes carry forward per-symbol (v88), so a pre-market run reuses last
// night's prices while `total_value` already reflects the broker's live marks. The difference has
// nowhere to go but `flow`. Traced in git on the real book: on 2026-08-28 at 05:07 ET the quotes were
// byte-identical to the prior evening while total_value had fallen $1,070 → a phantom WITHDRAWAL of
// $1,070.39; at 14:39 the quotes caught up and re-booked a move total_value had already absorbed → a
// phantom DEPOSIT of $920.69. Cash never moved once all day. The owner confirmed no transfers.
//
// So the primary inference is now `inferCashFlow`:
//     flow = Δcash + Σ(Δqty × px) − extraPnl
// External money must land in CASH, and an internal trade moves cash and position value in opposite
// directions by the same amount — so those two terms cancel a trade exactly and leave a transfer
// standing. Prices enter ONLY through the Δqty term, which is zero on the overwhelming majority of
// runs, making the whole thing immune to stale quotes. It is also EXACT when nothing traded, where the
// old formula was merely approximate. `inferFlow` is kept as the documented fallback for a snapshot
// with no recorded cash (pre-v119) — falling back cannot be a regression, it is the old behaviour.
//
// Two correction terms sit alongside it, both P&L the price-move sum structurally cannot see:
// the options book's mark change, and `derivativesRealized` — prediction-market / futures
// settlements, which pay into cash from sleeves OUTSIDE total_value and so are shaped exactly like
// a transfer. Anything the inference cannot attribute becomes a phantom deposit or withdrawal, and
// the consumer's return is deposit-IMMUNE, so a phantom silently deletes (or invents) real return.
//
// USED BY BOTH ACCOUNTS. The agentic book (••••3900) and the self-directed book (••••0741) record
// the same shape through the same code, so the two YTD figures cannot drift apart in their math —
// only in their inputs. On a MARGIN account, `equity` must be the account's own equity
// (`total_value`), never gross long market value: `equity_value` omits the loan, and dividing by it
// understates every return by exactly the leverage factor (see CLAUDE.md v116).

import { unwrapPnl, isDerivativeTrade } from './realizedpnl.mjs';

const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };

export const HISTORY_CAP = 260;          // ~1 trading year
export const FLOW_FLOOR_ABS = 40;        // $ — below this it's rounding, not a transfer
export const FLOW_FLOOR_PCT = 0.08;      // …or 8% of the prior equity, whichever is larger

/* The noise floor scales with the book so a small account isn't spammed by ordinary P&L, but it is
   also CAPPED in absolute terms: at 8% a $60k book would need a $4,800 move before a transfer
   registered, which is larger than most real deposits. Past FLOW_FLOOR_CAP the percentage term
   stops growing. */
export const FLOW_FLOOR_CAP = 750;

export function flowThreshold(priorEquity) {
  const pct = FLOW_FLOOR_PCT * Math.max(0, priorEquity || 0);
  return Math.max(FLOW_FLOOR_ABS, Math.min(pct, FLOW_FLOOR_CAP));
}

/* Realized P&L on the DERIVATIVES sleeves — prediction markets (event contracts) and futures.

   WHY THIS TERM EXISTS. `total_value` is the BROKERAGE account: it reconciles exactly as
   `equity_value + options_value + cash`, and Robinhood reports `event_contracts_value`,
   `futures_value` and `crypto_value` as separate top-level buckets OUTSIDE it — those sleeves are
   different legal entities (Robinhood Derivatives, LLC is a registered FCM; Robinhood Crypto, LLC).
   So money moving between the brokerage account and a derivatives sleeve is an INTERNAL transfer
   that the flow inference cannot see: buying a contract looks like a withdrawal, and a winning
   settlement paying into cash looks EXACTLY like a deposit — cash appears with no matching change
   in any equity position, which is the literal definition the inference keys on.

   That is not academic. On 2026-08-30 a prediction-market position settled for $1,245 on a $236.55
   cost — $1,008.45 of real profit — into a book carrying $17,469.76 of equity. The noise floor at
   that size is the $750 cap, so the next run would have booked ~$995 of genuine trading profit as an
   inferred DEPOSIT, and the consumer's time-weighted return neutralizes deposits: ~5.7pp of real
   return erased, plus a phantom contribution the owner never made on the Account Performance card's
   💰 strip. A withdrawal-shaped loss fails the same way with the sign flipped, FLATTERING the return.

   THE DISCRIMINATOR IS A BLANK SYMBOL. `get_pnl_trade_history` covers prediction markets alongside
   equities, and the settlement row comes back with an EMPTY `symbol` and an EMPTY `side`:
     {"timestamp":"2026-08-30T22:31:15Z","symbol":"","side":"","quantity":"1245","price":"1",
      "realized_gain":"1008.45"}
   Every equity/option/crypto trade carries a ticker, so "no symbol" is the tell. (`lossesFromTrades`
   already skips these for the wash-sale ledger — it drops blank symbols AND gains — which is why the
   wash ledger was never affected by this.)

   THE WINDOW IS THE STEP, NOT THE SPAN. The producer fetches a 3-month history every run, but the
   inference differences ONE step, so only settlements between the prior snapshot and this one belong
   here. `since` is the prior snapshot's `asOf` (exclusive) and `until` is this one's (inclusive), so
   consecutive runs telescope and nothing is subtracted twice.

   WITHOUT A `since` IT ABSTAINS. Returning 0 leaves today's behaviour exactly; subtracting an
   unbounded three months in a single step would be far worse than the bug it is fixing.

   A buy in an EARLIER window leaves a residual equal to the cost basis (the cash left then, the
   payout arrives now), which is correct double-entry across the two steps: that earlier step saw the
   cost as its own small unexplained move. Only the P&L — the part that is genuinely the account's
   return — is removed from THIS step. */
export function derivativesRealized(raw, { since, until } = {}) {
  const t0 = since ? Date.parse(since) : NaN;
  if (!Number.isFinite(t0)) return 0;
  const t1 = until ? Date.parse(until) : NaN;
  const trades = (() => { const r = unwrapPnl(raw); return Array.isArray(r.trades) ? r.trades : []; })();
  let sum = 0;
  for (const t of trades) {
    if (!t) continue;
    if (!isDerivativeTrade(t)) continue;              // has a ticker ⇒ already modelled by the trade term
    const ts = Date.parse(String(t.timestamp || ''));
    if (!Number.isFinite(ts) || ts <= t0) continue;
    if (Number.isFinite(t1) && ts > t1) continue;
    const g = num(t.realized_gain);
    if (g == null) continue;
    sum += g;
  }
  return +sum.toFixed(2);
}

export const QTY_EPS = 1e-9;

/* PRIMARY flow inference (2026-08-30): `flow = Δcash + Σ(Δqty × px) − extraPnl`.

   Derivation. `total_value = equity_value + options_value + cash`, so
     flow = ΔTotal − stockPnL − optionPnL − extraPnl
   and `stockPnL = Δequity_value − netPurchases`, `optionPnL = Δoptions_value − netOptionPurchases`.
   Substituting, Δequity_value and Δoptions_value cancel out entirely and what survives is
   `Δcash + netPurchases − extraPnl`. Every mark-to-market term disappears — which is the whole point,
   because the marks were the part being sampled on the wrong clock.

   `netPurchases` is approximated as `Σ(Δqty × px)` at the current mark. That is the ONLY place a
   price enters, and it is multiplied by a quantity CHANGE, so it is exactly zero on any run where
   nothing traded — the overwhelming majority. On a run that did trade, the error is bounded by
   (execution − mark) × traded quantity, i.e. minutes of drift on the traded name. Compare the old
   formula, whose error was bounded by the price move of the ENTIRE BOOK whenever quotes went stale:
   ±$1,000/day on the live account, versus a real book value of $17.5k.

   Returns `null` — meaning "I cannot tell, use the fallback" — rather than guessing when cash is
   missing on either side, or when a traded symbol cannot be priced at all. Never returns a value it
   had to invent an input for.

   KNOWN RESIDUAL, deliberately not modelled: option premium is a cash flow this does not net out
   (selling a call for $300 credit reads as +$300). The OLD formula had exactly the same blind spot —
   `Δoptions_value` cancels the mark but not the trade — so this is unchanged, not a regression, and
   it sits far below the noise floor for this book. Dividends and margin interest are the same shape
   and the same size. Modelling them needs an option-order and cash-activity feed we do not fetch. */
export function inferCashFlow({ priorCash, cash, priorPositions, positions, extraPnl } = {}) {
  if (typeof priorCash !== 'number' || typeof cash !== 'number') return null;
  if (!Number.isFinite(priorCash) || !Number.isFinite(cash)) return null;
  if (!Array.isArray(priorPositions) || !Array.isArray(positions)) return null;
  const idx = (arr) => new Map(arr.filter((p) => p && p.symbol).map((p) => [p.symbol, p]));
  const before = idx(priorPositions), after = idx(positions);
  let traded = 0;
  for (const sym of new Set([...before.keys(), ...after.keys()])) {
    const a = before.get(sym), b = after.get(sym);
    const dq = (num(b && b.qty) || 0) - (num(a && a.qty) || 0);
    if (!Number.isFinite(dq) || Math.abs(dq) < QTY_EPS) continue;
    const px = (b && b.px > 0) ? b.px : ((a && a.px > 0) ? a.px : 0);
    if (!(px > 0)) return null;          // a trade we cannot price ⇒ abstain, don't guess
    traded += dq * px;
  }
  const extra = (typeof extraPnl === 'number' && Number.isFinite(extraPnl)) ? extraPnl : 0;
  // Rounded like inferFlow's return: these are dollar figures, and leaving raw float residue
  // (a settlement cancelling to 6.8e-13 rather than 0) makes an exactly-cancelled trade look
  // like a flow to any caller that tests for truthiness rather than against the noise floor.
  return +(((cash - priorCash) + traded - extra).toFixed(2));
}

/* LEGACY / FALLBACK inference — used only when a snapshot carries no recorded `cash` (pre-v119).
   `inferCashFlow` above is the primary; this one is quote-priced and therefore vulnerable to the
   stale-quote skew described in the module header. Kept because falling back to the previous
   behaviour cannot itself be a regression.

   Net external cash flow (deposits − withdrawals) between two snapshots of the same account.
   Returns 0 when it can't tell, or when the move is inside the noise floor.

   `optionsValue`/`priorOptionsValue` are optional and matter only on the self-directed book, which
   is the one that trades options: `total_value = equity_value + options_value + cash`, so a short
   call's mark moving is P&L that the SHARE price-move sum cannot see. Left unsubtracted, a $300
   swing on three contracts looks exactly like a $300 deposit. (Robinhood reports a short book's
   options_value as negative — it's a liability — which is handled for free by differencing.)

   `extraPnl` is P&L this account earned OUTSIDE every bucket the two terms above can see — today
   that is `derivativesRealized` (prediction markets / futures). It lands in `total_value` as cash
   with no position to explain it, so without this term it reads as a transfer. */
export function inferFlow(priorEquity, priorPositions, equity, positions, optionsValue, priorOptionsValue, extraPnl) {
  if (typeof priorEquity !== 'number' || typeof equity !== 'number') return 0;
  if (!Array.isArray(priorPositions)) return 0;
  const nowPx = Object.fromEntries((positions || []).map((p) => [p.symbol, p.px]));
  let priceMove = 0;
  for (const pp of priorPositions) {
    if (!pp || !pp.symbol || !(pp.qty > 0) || typeof pp.px !== 'number') continue;
    const np = nowPx[pp.symbol];
    const px1 = (typeof np === 'number' && np > 0) ? np : pp.px;
    priceMove += pp.qty * (px1 - pp.px);
  }
  const optMove = (typeof optionsValue === 'number' && typeof priorOptionsValue === 'number')
    ? (optionsValue - priorOptionsValue) : 0;
  const extra = (typeof extraPnl === 'number' && Number.isFinite(extraPnl)) ? extraPnl : 0;
  const flow = (equity - priorEquity) - priceMove - optMove - extra;
  return Math.abs(flow) >= flowThreshold(priorEquity) ? +flow.toFixed(2) : 0;
}

/* Append today's point. One point per UTC day, LATEST WINS (an intraday re-run overwrites rather
   than appending, so a 13-run day doesn't become 13 points). `cumFlow` carries forward from the last
   point that has one; points recorded before the field existed simply have none, and the consumer's
   implausible-jump fallback covers those.
   Returns { history, flow, cumFlow } — `flow` is this step's inferred transfer (0 = none detected),
   for logging. */
export function appendEquityPoint({ prev, day, equity, positions, priorEquity, priorPositions,
                                    optionsValue, priorOptionsValue, extraPnl, cash, priorCash }) {
  const eq = num(equity);
  const history = (Array.isArray(prev) ? prev : []).filter((e) => e && e.t);
  if (!(eq > 0) || !day) return { history: history.slice(-HISTORY_CAP), flow: 0, cumFlow: null };
  const last = history.length ? history[history.length - 1] : null;
  const priorCum = (last && typeof last.cumFlow === 'number') ? last.cumFlow : 0;
  // Primary: the cash-based inference (immune to stale quotes). Falls back to the legacy quote-priced
  // formula only when this snapshot pair has no recorded cash, and to 0 when there is no prior point
  // at all — a first point can never be a transfer.
  let flow;
  const byCash = (typeof priorEquity === 'number')
    ? inferCashFlow({ priorCash, cash, priorPositions, positions, extraPnl }) : null;
  if (byCash != null) {
    flow = Math.abs(byCash) >= flowThreshold(priorEquity) ? +byCash.toFixed(2) : 0;
  } else {
    flow = inferFlow(priorEquity, priorPositions, eq, positions, optionsValue, priorOptionsValue, extraPnl);
  }
  const cumFlow = flow ? +(priorCum + flow).toFixed(2) : priorCum;
  const out = history.filter((e) => e.t !== day);
  const point = { t: day, equity: +eq.toFixed(2), cumFlow };
  // Recorded so the NEXT run can difference it (raw/ is wiped every run — the snapshot is the only
  // place this can live). Omitted entirely on an account with no options book.
  if (typeof optionsValue === 'number') point.optionsValue = +optionsValue.toFixed(2);
  out.push(point);
  out.sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0));
  return { history: out.slice(-HISTORY_CAP), flow, cumFlow };
}
