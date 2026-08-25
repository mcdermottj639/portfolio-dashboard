// producer/agentic-pending.mjs — PURE lifecycle helpers for the agentic rebalance ticket (v96).
//
// The planner (agentic-deploy.mjs) produces a ticket; THIS module formalizes the
// small state machine that carries it across producer/executor runs. The ticket itself lives in the
// COMMITTED producer/agentic-pending.json (raw/ is wiped on every scheduled run — the same reason the
// target/ledger live in git), so any session can pick up an in-flight rebalance where the last left off.
//
//   proposed ──(owner confirm / autoEligible)──▶ confirmed ──(sells placed)──▶ sells-placed
//     sells-placed ──(sells filled, proceeds spendable: buys placed)──▶ buys-placed ──▶ done
//   Any state ──(owner veto / re-plan)──▶ aborted
//
// v98 (limited margin, 2026-08-11): ••••3900 settles instantly, so `sells-placed → buys-placed` is now
// a SAME-SESSION hop gated on the sells FILLING rather than on the calendar. The planner no longer emits
// a `buysT1` leg at all; the leg-2 handling below survives only to carry tickets written under the old
// two-leg model through to `done` — dropping it would strand any ticket in flight at the upgrade.
//
// Execution policy (owner-approved 2026-08): TIERED AUTO — a ticket with turnover ≤ AUTO_TURNOVER_CAP
// ($500) is auto-executable with no confirm step; anything larger waits in `proposed` for a one-tap
// confirm (push notification → owner replies / taps the card hand-off). PF_AGENTIC_AUTO=off is the
// kill switch (read by the gate script, not here — this module stays pure).
//
// PURE + unit-tested (agentic-pending.test.mjs). No I/O — the gate script / executor do the reads/writes.

export const TICKET_STALE_DAYS = 5; // a proposed/confirmed ticket older than this re-plans (prices moved)
export const MIN_TURNOVER = 25;     // ignore dust plans — don't spin up a ticket to move lunch money

const round2 = (n) => Math.round((n || 0) * 100) / 100;

// Deterministic fingerprint of WHAT the plan trades (syms + rounded dollars per leg) — used to avoid
// re-proposing the identical ticket every producer run, while letting a materially-changed plan replace it.
export function planHash(plan) {
  const leg = (arr) => (arr || []).map((x) => `${x.sym}:${Math.round(x.dollars)}`).sort().join(',');
  return `s[${leg(plan.sells)}]b[${leg(plan.buys)}]t[${leg(plan.buysT1)}]`;
}

// Build a ticket from a planner result. `asOf` = ET date (YYYY-MM-DD) of creation.
export function makeTicket(plan, { asOf } = {}) {
  return {
    id: `${asOf || 'undated'}-${Math.abs(hashCode(planHash(plan))).toString(36)}`,
    created: asOf || null,
    status: 'proposed',
    autoEligible: !!plan.autoEligible,
    turnover: round2(plan.turnover),
    book: round2(plan.book),
    planHash: planHash(plan),
    legs: {
      sells: (plan.sells || []).map(slim),
      buysNow: (plan.buys || []).map(slim),
      buysT1: (plan.buysT1 || []).map(slim),
    },
    taxSummary: plan.taxSummary || null,
    deferred: (plan.deferred || []).map((d) => ({ sym: d.sym, reason: d.reason, until: d.until || null })),
    // BLOCKED SELLS (2026-08-25) — the other half of "why did the plan do that". `deferred` is BUY-side
    // only, so a ticket whose entire sell leg was suppressed by the PDT guard or the 14d min-hold
    // rendered as a pure buy list with no explanation anywhere. That happened for real: the 08-25
    // ticket's JPM + GE exits (and five overweight trims) were all held at day 13 of the min-hold —
    // every one of them bought on 08-12 — and the owner reasonably read a deposit followed by buys-only
    // as the sells having silently failed. The planner already computed this; the ticket just dropped
    // it on the floor, and raw/agentic-plan.json is wiped every run, so the ticket is the ONLY place
    // it can survive to reach the phone.
    blockedSells: (plan.blockedSells || []).map(slimBlock),
    // Same reasoning for the run-level warnings: they carry the idle-cash deadline, stale-zone and
    // parking notes that explain the shape of a ticket. Capped so a pathological run can't bloat the
    // committed file — the executor commits this on every pass.
    warnings: (plan.warnings || []).slice(0, 12),
    history: [{ at: asOf || null, to: 'proposed' }],
  };
}
const slim = (x) => ({ sym: x.sym, kind: x.kind || 'buy', dollars: round2(x.dollars), shares: x.shares ?? null, price: x.price ?? null, pl: x.pl ?? null, note: x.note || null });
// `kind` = what the sell WOULD have been (exit/trim/harvest/drawdown-raise); `blocked` = which guard
// stopped it; `until` = the date it clears. Keeping all three is what lets the card say "the JPM exit
// is held by the min-hold until 08-26" instead of just "nothing was sold".
const slimBlock = (x) => ({ sym: x.sym, kind: x.kind || 'sell', blocked: x.blocked || null,
  dollars: round2(x.dollars), pl: x.pl ?? null, plPct: x.plPct ?? null,
  until: x.until || null, heldDays: x.heldDays ?? null, note: x.note || null });
function hashCode(s) { let h = 0; for (let i = 0; i < s.length; i++) { h = (h * 31 + s.charCodeAt(i)) | 0; } return h; }

const TRANSITIONS = {
  proposed: ['confirmed', 'aborted'],
  confirmed: ['sells-placed', 'buys-placed', 'aborted'], // no-sell tickets jump straight to buys-placed
  'sells-placed': ['buys-placed', 'aborted'],
  'buys-placed': ['done', 'aborted'],
  done: [], aborted: [],
};

// Advance the ticket; throws on an illegal transition so the executor can't corrupt state.
export function advanceTicket(ticket, to, { date } = {}) {
  const from = ticket.status;
  if (!(TRANSITIONS[from] || []).includes(to)) throw new Error(`illegal ticket transition ${from} → ${to}`);
  return { ...ticket, status: to, [`${to}At`]: date || null, history: [...(ticket.history || []), { at: date || null, to }] };
}

// What should the executor do RIGHT NOW with this ticket? (todayET = 'YYYY-MM-DD')
//   'await-confirm' — proposed above the auto cap; push/nag handled elsewhere, place nothing
//   'place-trades'  — place sells + leg-1 buys (ticket confirmed, or proposed within the auto tier)
//   'place-buys'    — a carried buy leg is due: the sells are placed, their proceeds are spendable
//   'stale'         — proposed/confirmed ticket too old — re-plan before acting (prices moved)
//   'none'          — nothing to do (done/aborted/absent, or no carried leg)
export function nextAction(ticket, todayET) {
  if (!ticket || !ticket.status) return { action: 'none', reason: 'no ticket' };
  const ageDays = (from) => (from && todayET) ? Math.round((Date.parse(todayET) - Date.parse(from)) / 86400000) : 0;
  switch (ticket.status) {
    case 'proposed':
      if (ageDays(ticket.created) > TICKET_STALE_DAYS) return { action: 'stale', reason: `proposed ${ageDays(ticket.created)}d ago — re-plan` };
      return ticket.autoEligible ? { action: 'place-trades', reason: `auto tier (turnover $${ticket.turnover} ≤ cap)` }
        : { action: 'await-confirm', reason: `turnover $${ticket.turnover} above auto cap — owner confirm required` };
    case 'confirmed':
      if (ageDays(ticket.confirmedAt || ticket.created) > TICKET_STALE_DAYS) return { action: 'stale', reason: 'confirmed but stale — re-plan' };
      return { action: 'place-trades', reason: 'owner-confirmed' };
    case 'sells-placed': {
      // Legacy two-leg tickets only (see the v98 note above): new plans put every buy in `buysNow`,
      // so a fresh ticket leaves this state via buys-placed in the same pass. The day-gate that used
      // to hold this leg until T+1 is gone — under limited margin the proceeds are spendable as soon
      // as the sells fill, so a carried leg is placeable immediately (same session or any later one).
      if (!(ticket.legs && ticket.legs.buysT1 && ticket.legs.buysT1.length)) return { action: 'none', reason: 'no carried buy leg' };
      return { action: 'place-buys', reason: 'sells placed — proceeds available (instant settlement), place the carried buys' };
    }
    default:
      return { action: 'none', reason: ticket.status };
  }
}
