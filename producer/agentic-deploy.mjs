// producer/agentic-deploy.mjs — PURE deployment / rebalance planner for the agentic account (••••3900).
//
// Turns (research target + current holdings + idle cash + live prices) into a READY-TO-CONFIRM ticket,
// enforcing the execution discipline the old flow only described in prose:
//   • EARNINGS BLACKOUT — never put NEW money into a name inside `earningsBlackoutDays` (7) of its report.
//     A pre-print gap of 5-10% overnight can erase the edge; wait for the number, then buy with full info.
//   • POLICY BLACKOUT — the same rule for a SCHEDULED policy decision (tariff ruling, PDUFA date,
//     antitrust judgment) inside `policyBlackoutDays` (7), read from producer/policy.json via policy.mjs.
//     Only high-impact events block, and it no-ops entirely while that calendar is empty (the default).
//   • GAP-THROUGH-ENTRY RE-VERIFY — if a name has fallen BELOW its target stop (setup broken) or below its
//     planned entry zone (thesis in question), do NOT auto-buy the "bargain". Defer it for a fresh look —
//     a stock crashing through the level we planned to buy at is exactly when the thesis needs re-checking
//     (this is the GOOGL-gaps-after-earnings case that prompted the feature).
//   • WASH-SALE — never rebuy a name a TAXABLE account booked a loss on inside the 30-day window (reads
//     data.agentic.recentLosses via washMap — since v105 the ledger spans BOTH taxable accounts, so a
//     loss the owner realized in the self-directed margin book blocks an agentic buy too; the IRS
//     window is per taxpayer, which is exactly how a real Jul-29 NVDA loss got partially disallowed by
//     an Aug-11 agentic rebuy the single-account ledger couldn't see).
//   • CASH-FLOW-FIRST / SETTLEMENT — deploying NEW cash needs no sells; when a trim is required (a name
//     drifted over target), it's sequenced first so its proceeds fund the buys.
//   • NO INTRADAY ROUND TRIPS — never sell a name this account bought TODAY (see PDT note below).
//
// v98 — LIMITED MARGIN (2026-08-11). The owner upgraded ••••3900 from a cash account to **limited
// margin**: proceeds from a closing order are spendable IMMEDIATELY, with no borrowing and no leverage
// (`unleveraged_buying_power == buying_power`). Two consequences, both encoded here:
//   1. THE T+1 LEG IS GONE. The planner used to split buys into `buys` (settled cash, today) and
//      `buysT1` (sale proceeds, next session) purely because a cash account can't spend unsettled
//      proceeds without freeriding. Now sale proceeds fund buys in the SAME session, so there is one
//      allocation pass over (cash + proceeds). This is also strictly better sizing: the old leg-1
//      pro-rated over settled cash alone and topped names up a day later, which could underfill a name
//      overnight. `buysT1` is retained in the RESULT as an always-empty array only so in-flight tickets
//      written under the old model (and the consumer that reads `legs.buysT1`) keep working — new plans
//      never populate it. Sells are still sequenced FIRST: instant settlement means "spendable once the
//      sell FILLS", not "spendable before it fills", so the executor still places sells, confirms the
//      fills, then places buys.
//   2. PDT NOW APPLIES. A limited-margin account is a margin account for FINRA purposes, so the
//      pattern-day-trader rule bites: 4+ day trades in 5 rolling business days with equity under
//      $25,000 gets the account restricted. This book is ~$5k, and the executor runs hourly — exactly
//      the shape that could stumble into it (buy a name at 10am, have the research drop it, sell it at
//      2pm = one day trade). A cash account had no such rule, so nothing guarded against it before.
//      Rather than count day trades and creep toward the limit, `accountActivity` blocks the whole
//      class: a name this account BOUGHT TODAY is not sold today. Zero round trips ⇒ PDT can never
//      accrue, and the only cost is that a same-day reversal waits one session — which the drift band
//      and the 5-day ticket staleness window already tolerate.
//
// v96 — the planner became FULL-BOOK (it used to see only target names, which left off-target
// holdings invisible — 40% of the book once sat in names the research had dropped, with no ticket):
//   • OFF-TARGET EXITS — a held name absent from the target is an explicit SELL-to-exit, sequenced
//     with the other sells. The research dropping a name IS the sell signal; before v96 it was a
//     prose footnote in the card hand-off and the deploy planner never saw it.
//   • TAX-AWARE SALE ORDERING + ESTIMATES — every sell (exit/trim/harvest) carries an estimated
//     realized P&L vs avg cost (all lots in this account are short-term); the combined `sells` list
//     is ordered losses-first (harvest what we're selling anyway), then smallest gain first.
//     `taxSummary` nets the ticket's ST gains against its losses.
//   • OPPORTUNISTIC TLH — a held TARGET name underwater ≥ max(TLH_MIN_LOSS, TLH_MIN_LOSS_PCT% of
//     cost) is harvested (full position — Robinhood MCP can't pick lots), then wash-blocked from
//     this ticket's buys; its target weight sits underweight until the 30-day window clears.
//   • CROSS-ACCOUNT WASH GUARD — IRS wash-sale spans accounts and the margin book trades the same
//     names. Pass `crossActivity` ({SYM:{lastBuyDate}}, from the margin account's recent orders —
//     the executor fetches this live at execution time); a loss-sale on a name the OTHER account
//     bought within 30d gets its harvest skipped (no tax benefit) or its exit flagged washRisk.
//   • AUTO TIER — `autoEligible` = turnover ≤ AUTO_TURNOVER_CAP (owner-approved $10,000): the executor
//     may place an auto-eligible ticket unattended; anything larger goes out as push + one-tap. History:
//     $500 → $1,000 (2026-08-11, drift top-ups kept stalling on a confirm) → $10,000 (2026-08-25, owner:
//     "i dont like that i have to approve everything — make it all auto up to $10k"). On a ~$10k book
//     that means full-book rebalances execute unattended; the confirm tier survives only for tickets
//     bigger than the book is today (a large deposit). The cap only decides WHO presses go — every
//     deferral rule above (earnings/wash/policy/gap/PDT) applies either way.
//
// Buys move each underweight name only toward its (already cluster/vol-capped) target weight, so honoring
// the target inherently respects the risk caps riskweights.mjs enforced when the target was built.
//
// PURE + unit-tested (agentic-deploy.test.mjs). The producer/agent turns `.sells` then `.buys` into
// review_equity_order → confirm → place (auto ≤ cap, owner-confirmed above; see AGENTIC.md).

import { policyBlackout, POLICY_BLACKOUT_DAYS } from './policy.mjs';
import { AG_DD_CASH_FLOOR, AG_DRAWDOWN_RESUME } from './drawdown.mjs';

export const EARNINGS_BLACKOUT_DAYS = 7;
export { POLICY_BLACKOUT_DAYS };
export const AUTO_TURNOVER_CAP = 10000; // $/ticket the executor may place unattended (owner-approved tier, 2026-08-25)
export const TLH_MIN_LOSS = 75;       // opportunistic harvest floor, dollars…
export const TLH_MIN_LOSS_PCT = 5;    // …and as % of cost basis — must clear max() of both
export const MIN_EXIT = 5;            // ignore off-target dust below this value
export const WASH_WINDOW_DAYS = 30;   // IRS wash-sale window (either side of a loss sale)

// ── Churn governor (2026-08-12) ─────────────────────────────────────────────────────────────────
// On 2026-08-10 the planner exited GE/LLY/AMZN/MSFT (dropped by the 08-05 target) and bought
// AAPL/UNH/V; on 2026-08-12 the next target re-included the four and dropped the three, and the
// planner executed the full round trip — a near-100% book flip in 48 hours, four positions held
// under two days each, all short-term taxable. Nothing priced the cost of changing our mind: the
// research is memoryless week to week, and this planner executed the full delta immediately. These
// three rules make conviction changes pay a toll before they become trades. They pair with the
// target-level guard in finalize-target.mjs (a dropped-but-held name is RETAINED one cycle unless
// the research says the business is broken — see `target.dropped` below).
//   • MIN-HOLD: a name this account bought within MIN_HOLD_DAYS is not exited/trimmed, UNLESS the
//     research explicitly marked it business-broken (`target.dropped` reason), the position is down
//     ≤ MIN_HOLD_EXEMPT_LOSS_PCT (risk control outranks churn control), or it's a TLH harvest /
//     park-release (each has its own floor and purpose). Day 0 stays the harder PDT 'day-trade' block.
//   • RE-ENTRY COOLDOWN: a name this account sold within REENTRY_COOLDOWN_DAYS is not rebought —
//     the deferred weight parks in the VTI waiting ground like any other deferral. (The wash-sale
//     ledger already blocks loss-sale rebuys for 30d; this covers GAIN-sells, which is exactly what
//     the 08-10 exits were.) The park vehicle itself is exempt or park/release would jam.
//   • MIN_BUY: no dust orders (the 08-05 ticket placed a $1.80 UNH buy) — below this the gap just
//     waits for the next pass.
// `accountActivity` carries {SYM:{lastBuyDate,lastSellDate}} — the gate derives it from the committed
// agentic-decisions.json (activityFromDecisions) and the executor overlays today's live fills.
export const MIN_HOLD_DAYS = 14;
export const REENTRY_COOLDOWN_DAYS = 14;
export const MIN_HOLD_EXEMPT_LOSS_PCT = -10; // a position down this much may exit regardless (risk first)
export const MIN_BUY = 25;                   // smallest buy order worth placing

// ── Entry-zone discipline (v102) ────────────────────────────────────────────────────────────────
// The zone check used to be a BRIGHT LINE on one side only: defer iff `px < entryLow`, no tolerance,
// nothing above. Three failure modes, all observed live on 2026-08-11:
//   (a) NO TOLERANCE — V at $363.22 against a $364.00 floor is 0.2% under, indistinguishable from
//       noise, and it parked $437. A rounding-error miss is not a broken thesis.
//   (b) NO AGEING — zones are written against the prices of the day the research ran. Six days later
//       the market had drifted and THREE of seven target names were "below entry" at once. That is a
//       stale-zone artifact, not three broken companies; the guard was measuring its own staleness.
//   (c) NO UPPER BOUND — nothing deferred a name trading ABOVE its zone. The 2026-08-11 re-verification
//       set every zone below spot on purpose (5 of 6 names failed adversarial verify on entry price)
//       and the planner would have bought all seven anyway, because "too expensive" had no code path.
// So: a symmetric band with tolerance on both sides, and zones expire.
export const ENTRY_TOLERANCE_PCT = 2.5; // how far UNDER the floor before below-entry defers
export const ENTRY_PREMIUM_PCT = 2.0;   // how far OVER the ceiling before above-entry defers
export const ENTRY_ZONE_STALE_DAYS = 7; // zones older than this go ADVISORY (band checks skipped)
// `below-stop` is deliberately NOT banded and NOT aged — at/below the stop is the real thesis-broken
// signal, and it stays absolute.

// ── Idle-cash deadline (v102) ───────────────────────────────────────────────────────────────────
// Nothing in the system ever forced cash IN. "Wait for a pullback" had no expiry, so a rising market
// could leave a deposit uninvested indefinitely — a loss that never shows up as a loss. Past the
// deadline the entry bands are waived (stop/earnings/wash/policy still bind) and the idle cash is
// deployed a TRANCHE at a time, so it averages in instead of picking a single day.
// ── Regime-aware deployment PACING (v121) ──────────────────────────────────────────────────────
// The idle-cash deadline forced money in after N days regardless of tape: it fired identically at VIX 12
// and VIX 35. Funds pace deployment by regime; so does this now. Deliberately narrow — regime NEVER
// picks names or sizes positions (that is the research workflow's job), it only stretches or shrinks the
// pacing dials. Bands: matches the consumer's azVix labels so the app and the planner say the same thing.
export const REGIME_ELEVATED_VIX = 22;
export const REGIME_STRESSED_VIX = 30;
export const REGIME_STRETCH = { calm: 1, elevated: 1.5, stressed: 2 };      // × the idle-cash deadline
export const REGIME_TRANCHE_SCALE = { calm: 1, elevated: 1, stressed: 0.5 }; // × the forced tranche size
// `vix` = data.vix from the snapshot. Missing/unparseable ⇒ 'calm' ⇒ today's behaviour exactly (fails
// open, the fetchgate posture: one un-paced deployment is cheaper than a planner frozen on a bad parse).
export function marketRegime(vix) {
  const v = vix && typeof vix === 'object' ? parseFloat(vix.v) : parseFloat(vix);
  if (!Number.isFinite(v) || v <= 0) return 'calm';
  if (v >= REGIME_STRESSED_VIX) return 'stressed';
  if (v >= REGIME_ELEVATED_VIX) return 'elevated';
  return 'calm';
}

export const CASH_IDLE_DEPLOY_DAYS = 10;  // calendar-tracked idle days before deployment is forced
export const CASH_IDLE_TRANCHE_PCT = 34;  // % of idle cash per forced pass (~thirds)
export const CASH_IDLE_SWEEP_FLOOR = 250; // …below this, stop tranching and deploy the remainder

// ── Index parking — the "waiting ground" (v102, owner's design) ─────────────────────────────────
// Better answer to cash drag than the deadline above: instead of a deferred name's dollars sitting in
// cash earning nothing while we wait for its entry, park them in a broad index and rotate into the name
// when it finally clears. The deadline stays as a BACKSTOP for when parking isn't available.
//
// VEHICLE CHOICE — VTI (total US market), owner's call, and it is deliberately NOT SPY:
//   • SPY is already the target's ballast. Parking there buries the placeholder inside a position that
//     has its own target weight, so "is this 30% SPY our ballast or someone else's waiting money?" has
//     to be answered by bookkeeping. A separate ticker makes it structural — you can see it.
//   • NOT QQQ: ~half megacap tech, and the deferred names are usually megacap tech, so parking there
//     piles into the very cluster riskweights.mjs caps at 48% — "waiting to buy NVDA" while holding a
//     leveraged proxy for it. VTI is ~3,600 names; it is the diversifier, not a bet.
//   • WASH-SALE: VTI (CRSP US Total Market) and SPY (S&P 500) track different indexes, so they are not
//     substantially identical — harvesting the SPY ballast while the placeholder sits in VTI is clean.
//     A second S&P fund would have entangled the two. (There is no liquid Wilshire 5000 ETF; VTI is the
//     standard total-market proxy. ITOT/SCHB are equivalent substitutes if VTI is ever unavailable.)
//
// TWO INVARIANTS, both load-bearing:
//   1. THE PLACEHOLDER IS NOT AN ORPHAN. The vehicle is (by design) absent from the research target, and
//      the v96 full-book rule says a held name absent from the target is an off-target EXIT. Left alone,
//      the exit rule would liquidate the waiting ground every single pass while the parking rule rebuilt
//      it — an infinite churn loop. `parkVehicle` is therefore exempt from off-target exits. (When the
//      vehicle IS configured to a target name, the drift allowance below covers the same collision.)
//   2. UNPARKING IS TAXABLE. Releasing a slice is a real short-term sale in a taxable account. So we
//      park only past PARK_MIN (never dust), release only what a cleared name actually needs, and the
//      released sale flows through the SAME tax-aware ordering and PDT guard as any other sell.
export const PARK_VEHICLE = 'VTI';
export const PARK_MIN = 100;   // don't park (or release) less than this — the tax/spread isn't worth it

const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };
const money = (n) => '$' + (Math.round(n * 100) / 100).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
// entry zones are "745-755" | "745–755" | "745" | "$1,130-$1,180 (some prose)" → numeric bounds.
// Commas are stripped first so "$1,130" reads as 1130, not 1; only the leading numeric pair counts,
// so trailing prose ("toward the $345 50-DMA") can't be mistaken for a bound.
function entryBounds(entry) {
  if (entry == null) return { lo: null, hi: null };
  const m = String(entry).replace(/,/g, '').match(/\d+(\.\d+)?/g);
  if (!m || !m.length) return { lo: null, hi: null };
  const lo = num(m[0]);
  const hi = m.length > 1 ? num(m[1]) : lo;
  if (lo == null) return { lo: null, hi: null };
  return (hi != null && hi >= lo) ? { lo, hi } : { lo, hi: lo };
}
function entryLow(entry) { return entryBounds(entry).lo; }

export function planDeployment(input = {}) {
  const {
    target = {}, positions = [], cash = 0, quotes = {},
    earnings = {}, washMap = {}, policy = null, crossActivity = {}, accountActivity = {},
    parked = null, drawdown = null, vix = null, opts = {},
  } = input;
  // Regime pacing (v121). Never touches WHICH names are bought — only how fast idle cash is forced in.
  const regime = opts.regime || marketRegime(vix);
  const regimeStretch = REGIME_STRETCH[regime] ?? 1;
  // BOOK-LEVEL DRAWDOWN BREAKER (v121). `drawdown` = bookDrawdown(data.agentic.equityHistory) from
  // drawdown.mjs, supplied by the exec gate. Absent/insufficient ⇒ 'ok' ⇒ today's behaviour exactly.
  const ddLevel = (drawdown && drawdown.level) || 'ok';
  const ddSoft = ddLevel === 'soft' || ddLevel === 'hard';
  const ddHard = ddLevel === 'hard';
  const ddPct = drawdown && drawdown.dd != null ? (drawdown.dd * 100).toFixed(1) + '%' : null;
  // `parked` = {vehicle, dollars, forNames:[]} carried in the snapshot (data.agentic.parked). Dollars
  // already sitting in the vehicle ON BEHALF of deferred names — excluded from drift, released on clear.
  const parkVehicle = String(opts.parkVehicle || (parked && parked.vehicle) || PARK_VEHICLE).toUpperCase();
  const parkingOn = opts.park !== false;
  // SUSPEND NEW PARKS while the breaker is tripped — but ONLY new parks. `parkingOn` itself must stay
  // true, because it also gates the off-target-exit exemption for the vehicle: flipping it would make
  // the planner liquidate the existing waiting ground as an "orphan" the moment a drawdown started,
  // which is the infinite park→liquidate churn the exemption exists to prevent. Releases stay allowed
  // (moving money OUT of the placeholder is de-risking). The park vehicle is 100% equity beta, so
  // routing "the market is falling" money into it is precisely backwards — deferred cash stays CASH.
  const parkNewOn = parkingOn && !ddSoft;
  const parkMin = opts.parkMin ?? PARK_MIN;
  const parkedNow = Math.max(0, num(parked && parked.dollars) || 0);
  const blackout = opts.earningsBlackoutDays ?? EARNINGS_BLACKOUT_DAYS;
  const polBlackout = opts.policyBlackoutDays ?? POLICY_BLACKOUT_DAYS;
  const gapReverify = opts.gapReverify !== false;
  const tolPct = opts.entryTolerancePct ?? ENTRY_TOLERANCE_PCT;
  const premPct = opts.entryPremiumPct ?? ENTRY_PREMIUM_PCT;
  // Zones go advisory once the target they came from is stale. `target.asOf` is the research date.
  const zoneAgeDays = daysSince(target.asOf, opts.asOf);
  const zonesStale = zoneAgeDays != null && zoneAgeDays > (opts.entryZoneStaleDays ?? ENTRY_ZONE_STALE_DAYS);
  // Idle-cash deadline. `cashIdleDays` comes from data.agentic.cashIdleSince (build-data tracks the
  // first date deployable cash crossed the floor and stayed there); absent → no deadline, old behavior.
  const idleDays = num(opts.cashIdleDays);
  // The deadline's clock keeps running, but it cannot FORCE cash in while the breaker is tripped —
  // "deploy the backlog because 10 days passed" and "the book is in a drawdown" resolve in favour of
  // the drawdown. It resumes forcing the moment the breaker clears, with the elapsed days intact.
  const idleDeadline = +(((opts.cashIdleDeployDays ?? CASH_IDLE_DEPLOY_DAYS) * regimeStretch).toFixed(2));
  const idleOverdue = idleDays != null && idleDays >= idleDeadline && !ddSoft;
  // Past the deadline the BANDS are waived — but never the hard guards (stop/earnings/wash/policy).
  const bandsActive = gapReverify && !zonesStale && !idleOverdue;
  const names = (target.names || []).filter((n) => n && n.ticker).map((n) => ({ ...n, ticker: String(n.ticker).toUpperCase() }));
  const driftPp = num(target.driftTriggerPp) ?? 5;

  const pxOf = (sym) => {
    const q = quotes[sym];
    if (q == null) return null;
    if (typeof q === 'number') return q;
    return num(q.last_trade_price ?? q.px ?? q.price ?? q.last_extended_hours_trade_price ?? q.adjusted_previous_close);
  };
  const held = {};
  for (const p of positions) {
    const s = String(p.symbol || p.ticker || '').toUpperCase(); if (!s) continue;
    const qty = num(p.qty ?? p.quantity) || 0;
    const px = pxOf(s) ?? num(p.px) ?? num(p.avgCost) ?? 0;
    held[s] = { qty, px, value: qty * px, avgCost: num(p.avgCost ?? p.average_buy_price) };
  }
  const investedVal = Object.values(held).reduce((s, h) => s + h.value, 0);
  const book = opts.book != null ? opts.book : +(investedVal + (num(cash) || 0)).toFixed(2);

  const buys = [], trims = [], deferred = [], warnings = [], blockedSells = [];
  // PDT guard (v98, limited margin): a name BOUGHT TODAY in this account can't be sold today without
  // booking a day trade. `accountActivity` = {SYM:{lastBuyDate,lastSellDate}} from ••••3900's own
  // recent fills (committed decisions ledger + the executor's live overlay).
  const boughtToday = (sym) => {
    const a = accountActivity && accountActivity[sym];
    return !!(a && a.lastBuyDate && opts.asOf && String(a.lastBuyDate).slice(0, 10) === opts.asOf);
  };
  const dayTradeBlock = (row) => {
    if (opts.dayTradeGuard === false || !boughtToday(row.sym)) return false;
    blockedSells.push({ ...row, blocked: 'day-trade',
      note: `bought earlier today — selling now would be a day trade (PDT: this account is under $25k), deferred to the next session` });
    return true;
  };
  // Churn governor (2026-08-12): min-hold on sells, re-entry cooldown on buys, dust floor on orders.
  const minHoldDays = opts.minHoldDays ?? MIN_HOLD_DAYS;
  const reentryDays = opts.reentryCooldownDays ?? REENTRY_COOLDOWN_DAYS;
  const minBuy = Math.max(1, opts.minBuy ?? MIN_BUY);
  // finalize-target records why a prior name left the target; 'business-broken' (an explicit adverse
  // verdict) is the one drop reason that overrides the min-hold — a broken thesis exits regardless of age.
  const brokenDrops = new Set((target.dropped || [])
    .filter((d) => d && d.reason === 'business-broken' && d.ticker)
    .map((d) => String(d.ticker).toUpperCase()));
  const daysSinceActivity = (sym, key) => {
    const a = accountActivity && accountActivity[sym];
    return (a && a[key]) ? daysSince(String(a[key]).slice(0, 10), opts.asOf) : null;
  };
  const minHoldBlock = (row) => {
    if (!(minHoldDays > 0) || row.kind === 'harvest' || row.kind === 'park-release') return false;
    if (brokenDrops.has(row.sym)) return false;                       // research says the thesis broke
    const exemptLoss = opts.minHoldExemptLossPct ?? MIN_HOLD_EXEMPT_LOSS_PCT;
    if (row.plPct != null && row.plPct <= exemptLoss) return false;   // deep loss: risk control wins
    const d = daysSinceActivity(row.sym, 'lastBuyDate');
    if (d == null || d < 0 || d >= minHoldDays) return false;         // day 0 already caught by PDT block
    blockedSells.push({ ...row, blocked: 'min-hold',
      note: `bought ${d}d ago (min-hold ${minHoldDays}d) — churn guard: a just-opened position isn't flipped by the next target refresh; unlocks ${addDays(accountActivity[row.sym].lastBuyDate, minHoldDays)} (a business-broken drop or a ≤${exemptLoss}% loss would override)` });
    return true;
  };
  const sellBlocked = (row) => dayTradeBlock(row) || minHoldBlock(row);
  const currentWeights = {}, targetWeights = {};

  // 1. classify each target name: underweight → buy candidate; over-drift → trim; then apply guardrails.
  const candidates = [];
  for (const n of names) {
    const sym = n.ticker;
    const tw = num(n.weightPct) || 0;
    targetWeights[sym] = tw;
    const h = held[sym] || { qty: 0, px: pxOf(sym) || 0, value: 0 };
    const cw = book > 0 ? +(100 * h.value / book).toFixed(2) : 0;
    currentWeights[sym] = cw;
    const targetDollars = book * tw / 100;
    // INVARIANT 1: the parked slice rides inside the vehicle's position but is NOT the vehicle's target
    // weight — it's other names' money waiting. Add it as an allowance so the vehicle doesn't read as
    // overweight and get trimmed by the very next pass (parking rule vs drift rule, churning forever).
    const parkAllowance = (sym === parkVehicle) ? parkedNow : 0;
    const gap = +(targetDollars + parkAllowance - h.value).toFixed(2); // >0 underweight (buy), <0 overweight
    const px = pxOf(sym) ?? h.px;
    const stop = num(n.stop);
    const { lo: eLow, hi: eHigh } = entryBounds(n.entry);
    const ern = earnings[sym];
    const daysAway = ern ? (num(ern.daysAway) ?? daysUntil(ern.date, opts.asOf)) : null;
    // Scheduled policy decision inside the blackout window — same logic as earnings: a dated binary
    // event we KNOW is coming is a reason to wait for the outcome, not to deploy into it. No-ops
    // entirely when policy.json is empty (the shipped default).
    const polEvent = policy ? policyBlackout(sym, policy, { asOf: opts.asOf, sector: n.sector, blackoutDays: polBlackout }) : null;

    if (gap > 0.5) {
      // A phase-out name (retained by finalize-target's churn guard after the research dropped it) is a
      // lame duck: HOLD what we have, but never put NEW money into a name on its way out. Not a
      // deferral — its weight shouldn't attract parked dollars either.
      if (n.phaseOut) continue;
      // guardrails (order = most-blocking first)
      // BOOK-LEVEL DRAWDOWN outranks every name-level guard: it is a statement about the whole book, so
      // no per-name verdict can argue past it. Deferred dollars stay in CASH (see parkNewOn above).
      if (ddSoft) {
        deferred.push({ sym, reason: 'drawdown', dollars: gap,
          detail: `book is ${ddPct} from its peak (${drawdown && drawdown.peakT || 'n/a'}) — new deployment paused until it recovers above ${(AG_DRAWDOWN_RESUME * 100).toFixed(0)}%; deferred cash is NOT parked (the placeholder is equity beta)` });
        continue;
      }
      // STRESSED TAPE + ADVISORY BANDS. Zones go advisory once the target is stale (>7d), which means
      // the entry discipline is switched off exactly when price is moving fastest. In a calm tape that
      // is an acceptable trade (stale zones would otherwise defer the whole book — the v102 lesson); in
      // a stressed one, buying with no band at all is the worst version of both. Wait for fresh zones.
      if (regime === 'stressed' && zonesStale && gapReverify) {
        deferred.push({ sym, reason: 'regime', dollars: gap,
          detail: `VIX ${vix && vix.v ? vix.v : '≥' + REGIME_STRESSED_VIX} (stressed) and this target's entry zones are ${zoneAgeDays}d old, so the band check is advisory — waiting for a fresh target rather than buying unbanded into a stressed tape` });
        continue;
      }
      if (washMap[sym]) {
        const where = washMap[sym].account === 'main' ? 'in the self-directed account (cross-account wash)' : 'in this account';
        deferred.push({ sym, reason: 'wash-sale', detail: `loss booked recently ${where}; rebuy blocked to ${washMap[sym].until || '?'}`, until: washMap[sym].until, dollars: gap });
        continue;
      }
      // RE-ENTRY COOLDOWN (churn governor): we sold this name within the window — buying it back now
      // is the 48-hour flip this guard exists to stop. The weight parks in the waiting ground like any
      // other deferral. The park vehicle is exempt (releases stamp a lastSellDate on it, and blocking
      // its re-park would jam the parking mechanism against itself).
      const soldAgo = daysSinceActivity(sym, 'lastSellDate');
      if (reentryDays > 0 && sym !== parkVehicle && soldAgo != null && soldAgo >= 0 && soldAgo < reentryDays) {
        const until = addDays(accountActivity[sym].lastSellDate, reentryDays);
        deferred.push({ sym, reason: 'reentry', until, dollars: gap,
          detail: `sold ${soldAgo}d ago — re-entry cooldown ${reentryDays}d (churn guard): a name we just exited isn't rebought on the next refresh; weight waits (parked) until ${until || 'the window clears'}` });
        continue;
      }
      if (daysAway != null && daysAway >= 0 && daysAway <= blackout) {
        deferred.push({ sym, reason: 'earnings', detail: `reports ${ern.date || `in ${daysAway}d`} (≤${blackout}d) — wait for the print, then buy`, until: ern.date, dollars: gap });
        continue;
      }
      if (polEvent) {
        deferred.push({ sym, reason: 'policy', detail: `${polEvent.title} on ${polEvent.date} (≤${polBlackout}d) — scheduled policy decision, wait for the outcome`, until: polEvent.date, dollars: gap });
        continue;
      }
      // NO QUOTE — a research refresh can introduce a name the account has never held; until the
      // producer's next run folds it into the quote batch it prices as 0 here, which used to read as a
      // phantom "below-stop". Defer honestly instead: fail safe, name the real cause, self-heals on the
      // next snapshot. (PRODUCER.md now quotes agentic-target tickers + the park vehicle every run.)
      if (!(px > 0)) {
        deferred.push({ sym, reason: 'no-quote', dollars: gap,
          detail: `no live quote for ${sym} in the snapshot — a new target name isn't priced until the next producer run; deferring (fail safe)` });
        continue;
      }
      if (gapReverify && px != null && stop != null && px <= stop) {
        deferred.push({ sym, reason: 'below-stop', detail: `${money(px)} is at/below target stop ${money(stop)} — setup broken, re-verify before buying`, dollars: gap });
        continue;
      }
      // Symmetric entry band. Both sides carry a tolerance so noise doesn't park a position, and both
      // are skipped when the zones are stale or the idle-cash deadline has passed (see `bandsActive`).
      if (bandsActive && px != null && eLow != null && px < eLow * (1 - tolPct / 100)) {
        deferred.push({ sym, reason: 'below-entry', dollars: gap,
          detail: `${money(px)} is ${((1 - px / eLow) * 100).toFixed(1)}% below planned entry ${n.entry} (tolerance ${tolPct}%) — re-verify the thesis (esp. post-earnings) before deploying` });
        continue;
      }
      if (bandsActive && px != null && eHigh != null && px > eHigh * (1 + premPct / 100)) {
        deferred.push({ sym, reason: 'above-entry', dollars: gap,
          detail: `${money(px)} is ${((px / eHigh - 1) * 100).toFixed(1)}% above planned entry ${n.entry} (tolerance ${premPct}%) — the research priced this entry deliberately; wait for the pullback rather than chase` });
        continue;
      }
      candidates.push({ sym, gap, px, cw, tw, sector: n.sector, entry: n.entry, stop, tgt: num(n.target) });
    } else if (gap < 0 && (cw - tw) >= driftPp && h.qty > 0) {
      // over target beyond the drift band → trim (taxable — flag it, sequence before the buys it funds)
      const shares = px > 0 ? +(Math.abs(gap) / px).toFixed(4) : null;
      const pl = (h.avgCost != null && px != null && shares != null) ? +((px - h.avgCost) * shares).toFixed(2) : null;
      const trim = { sym, kind: 'trim', dollars: +Math.abs(gap).toFixed(2), shares, price: px, weightNow: cw, weightTarget: tw,
        pl, plPct: (h.avgCost > 0 && px != null) ? +((px / h.avgCost - 1) * 100).toFixed(2) : null, term: 'short',
        note: `over target by ${(cw - tw).toFixed(1)}pp — taxable trim, sequenced before the buys it funds` };
      if (!sellBlocked(trim)) trims.push(trim);
    }
  }

  // 1b. OFF-TARGET EXITS — held names the research target dropped. The drop IS the sell signal; the
  //     exit is what funds the underweight target names (before v96 these were invisible to the planner).
  //     A loss-exit on a name the MARGIN account bought within the wash window is flagged (loss may be
  //     disallowed) but still exits — the allocation reason dominates; only the tax benefit is at risk.
  const crossRecent = (sym) => {
    const c = crossActivity && crossActivity[sym];
    if (!c || !c.lastBuyDate) return false;
    const d = daysUntil(c.lastBuyDate, opts.asOf);
    return d != null && d <= 0 && d >= -WASH_WINDOW_DAYS;
  };
  const exits = [];
  for (const [sym, h] of Object.entries(held)) {
    if (targetWeights[sym] != null) continue;
    // INVARIANT 1: the waiting ground is absent from the target BY DESIGN. Without this exemption the
    // off-target rule would sell the placeholder every pass while the parking rule rebuilt it — an
    // infinite churn loop, and a taxable one. It leaves only via a release (a cleared name draws on it)
    // or by being switched off, never as an "orphan".
    if (parkingOn && sym === parkVehicle) continue;
    if (!(h.qty > 0) || h.value < (opts.minExit ?? MIN_EXIT)) continue;
    const pl = h.avgCost != null ? +((h.px - h.avgCost) * h.qty).toFixed(2) : null;
    const washRisk = pl != null && pl < 0 && crossRecent(sym);
    const exit = { sym, kind: 'exit', dollars: +h.value.toFixed(2), shares: +h.qty.toFixed(6), price: h.px,
      pl, plPct: h.avgCost > 0 ? +((h.px / h.avgCost - 1) * 100).toFixed(2) : null, term: 'short',
      ...(washRisk ? { washRisk: true } : {}),
      note: `not in the current target — exit funds the underweight names${washRisk ? ' (⚠️ loss may be wash-disallowed: margin account bought this within 30d)' : ''}` };
    if (!sellBlocked(exit)) exits.push(exit);
  }

  // 1c. OPPORTUNISTIC TLH — a held TARGET name underwater ≥ max($, % of cost) is harvested whole
  //     (position-level; the MCP can't select lots), then wash-blocked from the buy legs — its target
  //     weight sits underweight until the window clears. Skipped when the margin book bought the name
  //     within the window (no tax benefit) or the name is already inside a wash window (keep it simple).
  const harvests = [];
  if (opts.tlh !== false) {
    const minLoss = opts.tlhMinLoss ?? TLH_MIN_LOSS, minPct = opts.tlhMinLossPct ?? TLH_MIN_LOSS_PCT;
    for (const n of names) {
      const sym = n.ticker, h = held[sym];
      if (!h || !(h.qty > 0) || h.avgCost == null || !(h.px > 0)) continue;
      const cost = h.avgCost * h.qty, pl = (h.px - h.avgCost) * h.qty;
      if (!(cost > 0) || pl >= 0) continue;
      if (-pl < Math.max(minLoss, cost * minPct / 100)) continue;
      if (washMap[sym]) continue;
      if (crossRecent(sym)) { warnings.push(`TLH skipped on ${sym}: margin account bought it within ${WASH_WINDOW_DAYS}d — the loss would be wash-disallowed`); continue; }
      const hv = { sym, kind: 'harvest', dollars: +h.value.toFixed(2), shares: +h.qty.toFixed(6), price: h.px,
        pl: +pl.toFixed(2), plPct: +((h.px / h.avgCost - 1) * 100).toFixed(2), term: 'short',
        note: `tax-loss harvest — realize ${money(pl)} ST loss; rebuy blocked ${WASH_WINDOW_DAYS}d, target weight sits underweight until then` };
      if (!dayTradeBlock(hv)) harvests.push(hv);
    }
    for (const hv of harvests) {
      const i = candidates.findIndex((c) => c.sym === hv.sym);
      if (i >= 0) candidates.splice(i, 1);
      // wash outranks any earlier deferral (below-entry/earnings/…) — replace, don't stack, so the
      // deferred list stays one-entry-per-name and deferredCash isn't double-counted.
      const j = deferred.findIndex((d) => d.sym === hv.sym);
      if (j >= 0) deferred.splice(j, 1);
      deferred.push({ sym: hv.sym, reason: 'wash-sale', detail: `harvested this ticket — rebuy blocked ${WASH_WINDOW_DAYS}d`, dollars: +(book * (targetWeights[hv.sym] || 0) / 100).toFixed(2) });
    }
  }

  // 1d. HARD-TIER DEFENSIVE CASH (v121). Below AG_DRAWDOWN_HARD the breaker stops being passive: it
  //     raises cash to a floor. Ordering is LOSSES FIRST, exactly like every other sell path here — the
  //     tax benefit is real and it is also the least-conviction end of the book. Everything routes
  //     through sellBlocked(), so the PDT day-trade guard and the 14d min-hold still bind; min-hold's
  //     existing ≤-10% deep-loss exemption means the positions this most wants to sell are usually the
  //     ones it CAN sell. It deliberately does NOT force past min-hold on a small loser: churn control
  //     and risk control are both real, and a 14-day-old position is not what put the book in a
  //     drawdown. Names already exiting/harvesting this ticket are skipped so nothing is sold twice.
  const ddRaises = [];
  if (ddHard && opts.drawdownRaise !== false) {
    const floorPct = opts.ddCashFloorPct ?? AG_DD_CASH_FLOOR;
    const already = new Set([...exits, ...harvests, ...trims].map((x) => x.sym));
    const cashNow = Math.max(0, num(cash) || 0);
    const wanted = +(book * floorPct / 100).toFixed(2);
    let need = +(wanted - cashNow - [...exits, ...harvests, ...trims].reduce((a, x) => a + x.dollars, 0)).toFixed(2);
    if (need > 0) {
      const rows = Object.entries(held)
        .filter(([sym, h]) => !already.has(sym) && sym !== parkVehicle && h.qty > 0 && h.px > 0 && h.value >= (opts.minExit ?? MIN_EXIT))
        .map(([sym, h]) => {
          const plPct = h.avgCost > 0 ? +((h.px / h.avgCost - 1) * 100).toFixed(2) : null;
          return { sym, h, plPct: plPct == null ? 0 : plPct };
        })
        .sort((a, b) => a.plPct - b.plPct);   // most-underwater first
      for (const { sym, h, plPct } of rows) {
        if (need <= 0) break;
        const dollars = +Math.min(h.value, need).toFixed(2);
        if (dollars < (opts.minExit ?? MIN_EXIT)) continue;
        const shares = +(dollars / h.px).toFixed(6);
        const pl = h.avgCost != null ? +((h.px - h.avgCost) * shares).toFixed(2) : null;
        const row = { sym, kind: 'drawdown-raise', dollars, shares, price: h.px, pl, plPct, term: 'short',
          note: `book ${ddPct} from its peak — raising defensive cash to ${floorPct}% of book (losses first)` };
        if (sellBlocked(row)) continue;
        ddRaises.push(row);
        need = +(need - dollars).toFixed(2);
      }
      if (need > 0) warnings.push(`drawdown hard tier: could not reach the ${floorPct}% cash floor — ${money(need)} short after the PDT and min-hold guards (they are not overridden by the breaker)`);
    }
  }

  // 2. distribute the deployable pool across eligible buys, proportional to each name's gap and capped
  //    at the gap (never overshoot target → never breach the target's risk caps).
  //
  //    LIMITED MARGIN (v98): the pool is settled cash PLUS this ticket's sale proceeds, in ONE pass —
  //    proceeds are spendable the moment the sell fills, so there is no second-session leg any more.
  //    Harvested names were already pulled from `candidates`, so a harvest still can't fund its own
  //    wash-triggering rebuy. `buysT1` stays in the result as an empty array for wire-compatibility
  //    with tickets written under the old two-leg model (see the header note).
  const proceeds = +([...exits, ...harvests, ...trims, ...ddRaises].reduce((s, x) => s + x.dollars, 0)).toFixed(2);
  const settledNow = Math.max(0, num(cash) || 0);
  //    FORCED TRANCHE (v102): when the idle-cash deadline has passed we deliberately deploy only a slice
  //    of the settled cash per pass, so the backlog averages in over several sessions instead of landing
  //    on one arbitrary day. Sale proceeds are NOT tranched — those are a rebalance already in motion.
  //    Below the sweep floor tranching would never finish (thirds of a shrinking balance), so we sweep.
  const tranchePct = +(((opts.cashIdleTranchePct ?? CASH_IDLE_TRANCHE_PCT) * (REGIME_TRANCHE_SCALE[regime] ?? 1)).toFixed(2));
  const sweepFloor = opts.cashIdleSweepFloor ?? CASH_IDLE_SWEEP_FLOOR;
  const tranching = idleOverdue && settledNow > sweepFloor;
  const cashThisPass = tranching ? +(settledNow * tranchePct / 100).toFixed(2) : settledNow;
  //    Parked dollars are a funding source too — that is the whole point of the waiting ground. They go
  //    into the pool here so a cleared name can actually draw on them; how much was drawn (and therefore
  //    must be SOLD out of the vehicle) falls out of `spent` below as the release leg.
  //    The pool only counts money we can actually GET AT this pass: if the vehicle was bought today,
  //    releasing it would be a day trade, so the parked dollars are locked until tomorrow and must not
  //    be treated as funding — otherwise buys get sized against cash that cannot legally move (the
  //    executor's buying-power check would bounce them, but the plan itself would be wrong).
  const parkReleasable = parkingOn && parkedNow > 0 && !(opts.dayTradeGuard !== false && accountActivity[parkVehicle] && String(accountActivity[parkVehicle].lastBuyDate).slice(0, 10) === opts.asOf);
  const parkPool = parkReleasable ? parkedNow : 0;
  const deployable = +(cashThisPass + proceeds + parkPool).toFixed(2);
  const buysT1 = [];
  const totalGap = candidates.reduce((s, c) => s + c.gap, 0);
  let spent = 0;
  if (candidates.length && deployable > 0 && totalGap > 0) {
    const scale = Math.min(1, deployable / totalGap); // pro-rate if the pool < total need
    for (const c of candidates) {
      const dollars = +(Math.min(c.gap, c.gap * scale)).toFixed(2);
      if (dollars < minBuy) continue; // dust floor (churn governor) — a sub-$25 gap waits for the next pass
      const shares = c.px > 0 ? +(dollars / c.px).toFixed(4) : null;
      spent += dollars;
      buys.push({ sym: c.sym, dollars, shares, price: c.px, weightNow: c.cw, weightTarget: c.tw, sector: c.sector,
        entry: c.entry, stop: c.stop, target: c.tgt,
        note: `${c.cw.toFixed(1)}% → ${c.tw}% target` });
    }
  }
  // 2b. INDEX PARKING — the waiting ground.
  //     RELEASE first: a name that just cleared its guard needs funding, and its money is sitting in the
  //     vehicle. Release only the shortfall (cash couldn't cover), never the whole parked block, so a
  //     single cleared name doesn't liquidate everyone else's placeholder. Taxable sale → it joins the
  //     normal sell list, inheriting the losses-first ordering and the PDT day-trade guard.
  //     PARK second: whatever is still deferred gets its dollars put to work in the vehicle instead of
  //     idling in cash. Parking is skipped when the vehicle ITSELF is what's deferred.
  const parkLegs = { release: null, park: null };
  let parkedAfter = parkedNow;
  if (parkingOn && parkedNow >= parkMin) {
    const shortfall = +(spent - cashThisPass - proceeds).toFixed(2);
    const release = Math.min(parkedNow, Math.max(0, shortfall));
    if (release >= parkMin) {
      const h = held[parkVehicle];
      const px = pxOf(parkVehicle) ?? (h && h.px) ?? null;
      const shares = px > 0 ? +(release / px).toFixed(6) : null;
      const pl = (h && h.avgCost != null && px != null && shares != null) ? +((px - h.avgCost) * shares).toFixed(2) : null;
      const leg = { sym: parkVehicle, kind: 'park-release', dollars: +release.toFixed(2), shares, price: px, pl,
        plPct: (h && h.avgCost > 0 && px != null) ? +((px / h.avgCost - 1) * 100).toFixed(2) : null, term: 'short',
        note: `release parked placeholder — funds ${buys.map((b) => b.sym).join('/') || 'the cleared name(s)'}` };
      if (!dayTradeBlock(leg)) { parkLegs.release = leg; parkedAfter = +(parkedNow - release).toFixed(2); }
    }
  }
  //     Only CASH can be parked — never the already-parked remainder (re-parking is a no-op round trip)
  //     and never the pool itself, so this is what's left of cash+proceeds after the buys drew on them.
  //     (Park only fires when there was no release, so spent here is cash-funded by construction.)
  const parkableCash = +(cashThisPass + proceeds - spent).toFixed(2);
  const parkableNeed = deferred.filter((d) => d.sym !== parkVehicle).reduce((s, d) => s + Math.max(0, d.dollars || 0), 0);
  if (parkNewOn && !parkLegs.release && parkableCash >= parkMin && parkableNeed >= parkMin) {
    const dollars = +Math.min(parkableCash, parkableNeed).toFixed(2);
    const px = pxOf(parkVehicle);
    if (!(px > 0)) warnings.push(`index parking unavailable: no live quote for ${parkVehicle} in the snapshot — deferred cash stays in cash this pass (producer must quote the park vehicle every run)`);
    if (px > 0 && dollars >= parkMin) {
      parkLegs.park = { sym: parkVehicle, kind: 'park', dollars, shares: +(dollars / px).toFixed(4), price: px,
        forNames: deferred.filter((d) => d.sym !== parkVehicle).map((d) => d.sym),
        note: `waiting ground — holds ${money(dollars)} of deferred weight (${deferred.filter((d) => d.sym !== parkVehicle).map((d) => d.sym).join(', ')}) in ${parkVehicle} instead of cash; released when they clear` };
      buys.push({ ...parkLegs.park, weightNow: currentWeights[parkVehicle] ?? null, weightTarget: targetWeights[parkVehicle] ?? null,
        sector: 'Index / Broad Market', entry: null, stop: null, target: null, parked: true });
      spent += dollars;
      parkedAfter = +(parkedNow + dollars).toFixed(2);
    }
  }
  if (parkLegs.release) { exits.push(parkLegs.release); }

  // Sells still lead: instant settlement means spendable once a sell FILLS, not before it does. When the
  // buys lean on proceeds, the executor must confirm the sell fills before placing them.
  const releaseD = parkLegs.release ? parkLegs.release.dollars : 0;
  const buysNeedProceeds = (proceeds + releaseD) > 0 && spent > cashThisPass + 1;

  // 3. tax-aware combined sell order (losses first — harvest what we're selling anyway — then smallest
  //    gain first) + the ticket's ST tax picture and the executor's autonomy tier.
  const sells = [...exits, ...harvests, ...trims, ...ddRaises].sort((a, b) => (a.pl ?? 0) - (b.pl ?? 0));
  const realizedGain = +sells.reduce((s, x) => s + Math.max(0, x.pl || 0), 0).toFixed(2);
  const realizedLoss = +sells.reduce((s, x) => s + Math.min(0, x.pl || 0), 0).toFixed(2);
  const taxSummary = { realizedGain, realizedLoss, net: +(realizedGain + realizedLoss).toFixed(2), term: 'short',
    note: sells.some((x) => x.washRisk) ? 'a flagged loss may be wash-disallowed (cross-account buy within 30d)'
      : (realizedLoss < 0 && realizedGain > 0 ? 'harvested losses offset the gains — net is ST, taxed as ordinary income' : null) };
  const turnover = +(sells.reduce((s, x) => s + x.dollars, 0) + spent).toFixed(2);
  const autoCap = opts.autoCap ?? AUTO_TURNOVER_CAP;
  const autoEligible = turnover > 0 && turnover <= autoCap;

  const deferredCash = deferred.reduce((s, d) => s + Math.max(0, d.dollars || 0), 0);
  // cashLeft = actual CASH left, not "pool left": released dollars funded buys (so they don't drain
  //   cash), and still-parked dollars live in the vehicle, reported via `parking`, not here.
  const cashLeft = +Math.max(0, cashThisPass + proceeds - (spent - releaseD)).toFixed(2);

  if (!names.length) warnings.push('no research target loaded — cannot plan a deployment');
  if (deferred.length) warnings.push(`${deferred.length} name(s) deferred (${deferred.map((d) => d.sym).join(', ')}) — ~${money(deferredCash)} of intended weight held pending earnings/re-verify/wash-sale`);
  const pdtBlocked = blockedSells.filter((b) => b.blocked === 'day-trade');
  const holdBlocked = blockedSells.filter((b) => b.blocked === 'min-hold');
  if (pdtBlocked.length) warnings.push(`${pdtBlocked.length} sell(s) held to the next session (${pdtBlocked.map((b) => b.sym).join(', ')}) — bought today, selling now would be a day trade (PDT guard)`);
  if (holdBlocked.length) warnings.push(`${holdBlocked.length} sell(s) held by the ${minHoldDays}d min-hold (${holdBlocked.map((b) => b.sym).join(', ')}) — churn guard: positions opened within the window aren't flipped by the next research refresh`);
  if (candidates.length && deployable > 0 && spent < deployable - 1) warnings.push(`${money(cashLeft)} left uninvested (eligible buys fully funded to target; rest waits for deferred names to clear)`);
  if (zonesStale) warnings.push(`entry zones are ${zoneAgeDays}d old (target asOf ${target.asOf || '?'}) — treated as ADVISORY, band checks skipped; a stale zone drifts out of range on its own`);
  if (idleOverdue) warnings.push(`cash idle ${idleDays}d (≥${opts.cashIdleDeployDays ?? CASH_IDLE_DEPLOY_DAYS}d deadline) — entry bands waived and ${tranching ? `a ${tranchePct}% tranche (${money(cashThisPass)}) deployed this pass` : `the ${money(settledNow)} remainder swept in`}; waiting indefinitely is a decision too`);

  if (parkLegs.park) warnings.push(`${money(parkLegs.park.dollars)} of deferred weight parked in ${parkVehicle} rather than left in cash (${parkLegs.park.forNames.join(', ')}) — released when those names clear; unparking is a taxable ST sale`);
  if (parkLegs.release) warnings.push(`released ${money(parkLegs.release.dollars)} from the ${parkVehicle} waiting ground to fund cleared names — realizes ${parkLegs.release.pl == null ? 'an ST gain/loss' : money(parkLegs.release.pl)} ST`);

  const entryPolicy = { tolerancePct: tolPct, premiumPct: premPct, zoneAgeDays, zonesStale, bandsActive,
    idleDays: idleDays ?? null, idleOverdue, tranching, tranchePct: tranching ? tranchePct : null, cashThisPass };
  const parking = { vehicle: parkVehicle, enabled: parkingOn, before: +parkedNow.toFixed(2), after: +parkedAfter.toFixed(2),
    parked: parkLegs.park, released: parkLegs.release,
    forNames: deferred.filter((d) => d.sym !== parkVehicle).map((d) => d.sym) };
  const summary = buildSummary({ buys, buysT1, trims, exits, harvests, ddRaises, deferred, spent, cashLeft, book, taxSummary, turnover, buysNeedProceeds, parking, drawdown });
  return { book, cash: +settledNow.toFixed(2), deployable, currentWeights, targetWeights, buys, buysT1, trims, exits, harvests, ddRaises, sells,
    proceeds, buysNeedProceeds, blockedSells, taxSummary, turnover, autoCap, autoEligible, entryPolicy, parking,
    drawdown: drawdown ? { dd: drawdown.dd, level: drawdown.level, peakT: drawdown.peakT, note: drawdown.note } : null,
    regime: { regime, vix: vix && vix.v != null ? vix.v : null, idleDeadlineDays: idleDeadline, tranchePct },
    deferred, deferredCash: +deferredCash.toFixed(2), spent: +spent.toFixed(2), cashLeft, warnings, summary };
}

function buildSummary({ buys, buysT1 = [], trims, exits = [], harvests = [], ddRaises = [], deferred, spent, cashLeft, taxSummary, turnover, buysNeedProceeds, parking = null, drawdown = null }) {
  const parts = [];
  const sellBits = [
    ...exits.map((x) => x.kind === 'park-release'
      ? `${x.sym} ${moneyS(x.dollars)} released from the waiting ground`
      : `${x.sym} ${moneyS(x.dollars)} exit`),
    ...harvests.map((x) => `${x.sym} ${moneyS(x.dollars)} harvest`),
    ...trims.map((t) => `${t.sym} ${moneyS(t.dollars)} trim`),
    ...ddRaises.map((x) => `${x.sym} ${moneyS(x.dollars)} defensive raise`),
  ];
  // The breaker leads the summary when it is tripped — it is the reason the rest of the ticket looks
  // the way it does, so reading it last would be reading the ticket backwards.
  if (drawdown && drawdown.level && drawdown.level !== 'ok') {
    parts.push(`⚠️ DRAWDOWN ${drawdown.level.toUpperCase()}: ${drawdown.note || `book ${(drawdown.dd * 100).toFixed(1)}% from its peak`}.`);
  }
  if (sellBits.length) parts.push(`Sell first (losses first): ${sellBits.join(', ')}.`);
  if (buys.length) parts.push(`Then deploy ${moneyS(spent)}${buysNeedProceeds ? ' (cash + these proceeds, same session — limited margin)' : ' of settled cash'}: ${buys.map((b) => `${b.sym} ${moneyS(b.dollars)}`).join(', ')}.`);
  else if (!sellBits.length) parts.push('No eligible buys this pass.');
  if (buysT1.length) parts.push(`Carried leg: ${buysT1.map((b) => `${b.sym} ${moneyS(b.dollars)}`).join(', ')}.`);
  if (taxSummary && (taxSummary.realizedGain > 0 || taxSummary.realizedLoss < 0)) parts.push(`Est. ST tax: ${moneyS(taxSummary.realizedGain)} gains ${taxSummary.realizedLoss < 0 ? `− ${moneyS(-taxSummary.realizedLoss)} losses ` : ''}= net ${moneyS(taxSummary.net)}.`);
  if (deferred.length) parts.push(`Hold ${moneyS(deferred.reduce((s, d) => s + Math.max(0, d.dollars || 0), 0))} for ${deferred.map((d) => `${d.sym} (${d.reason})`).join(', ')}.`);
  if (parking && parking.parked) parts.push(`Deferred weight waits in ${parking.vehicle}, not cash (${moneyS(parking.after)} parked).`);
  if (cashLeft > 1) parts.push(`${moneyS(cashLeft)} stays in cash.`);
  if (turnover > 0) parts.push(`Turnover ${moneyS(turnover)}.`);
  return parts.join(' ');
}
function moneyS(n) { return '$' + (Math.round(n * 100) / 100).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 }); }
function daysUntil(dateStr, asOf) {
  if (!dateStr) return null;
  const a = asOf ? Date.parse(asOf + 'T00:00:00Z') : Date.now();
  const d = Date.parse(String(dateStr).slice(0, 10) + 'T00:00:00Z');
  if (!Number.isFinite(a) || !Number.isFinite(d)) return null;
  return Math.round((d - a) / 86400000);
}
// …and the other direction: how old is `dateStr` as of `asOf`? (negative = in the future)
function daysSince(dateStr, asOf) {
  const d = daysUntil(dateStr, asOf);
  return d == null ? null : -d;
}
function addDays(dateStr, n) {
  const t = Date.parse(String(dateStr).slice(0, 10) + 'T00:00:00Z');
  return Number.isFinite(t) ? new Date(t + n * 86400000).toISOString().slice(0, 10) : null;
}
