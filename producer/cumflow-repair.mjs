// ONE-TIME DATA MIGRATION — the phantom cumFlow left by the 2026-08-31 19:44Z account-swap run.
// Pure + unit-tested. Applied by build-data.mjs to the PRIOR snapshot, before anything reads it.
//
// WHAT HAPPENED. That run published ••••0741's positions into `data.agentic` and ••••3900's into
// `data.main` — the two get_equity_positions calls were made with the account numbers the wrong way
// round. Each account's cash and totals were still correct, which is why nothing downstream noticed.
// The deposit inference saw each book replaced wholesale and booked equal-and-opposite phantom
// transfers of ±$20k. The 20:42Z run fetched both correctly, and because the positions swapped BACK
// it booked the mirror image, which very nearly cancelled:
//
//     agentic cumFlow  7,950.75 → 28,218.50 → 7,961.68     (+10.93 survives)
//     main    cumFlow      0.00 → −20,247.65 →   136.70    (+136.70 survives)
//
// What survives is the difference between the two runs' price moves. The owner confirmed no transfers
// touched either account in that window.
//
// WHY IT MUST BE REPAIRED RATHER THAN WAITED OUT. The consumer's return is deposit-IMMUNE by
// construction, so a phantom deposit silently DELETES real return — it does not merely mislabel it.
// Measured on the committed series: ••••0741 reads −2.86% against a true −2.16% (0.71pp of loss that
// never happened); ••••3900 loses ~0.09pp at the step and ~0.34pp on the headline once it compounds.
// And no ordinary run can shed it: `appendEquityPoint` reads `priorCum` from the point it is
// REPLACING, so every same-day rebuild inherits the bad total and it is the permanent baseline for
// every future point.
//
// WHY IT LIVES HERE RATHER THAN IN A HAND EDIT. `data.json` is the producer's file, written once an
// hour through build-data → emit → validate → publish. A running total that the pipeline itself
// corrupted is the pipeline's to correct, on the same path, under the same validation — a hand-edited
// encrypted blob is reviewable by nobody and reproducible by no one.
//
// cumFlow is a RUNNING total, so the phantom comes off the offending point AND every point after it.
//
// SELF-DISABLING. Each account's correction fires only when its anchor point still holds the exact
// bad value, so the first run that applies it makes every later run a no-op. It is therefore safe to
// leave in place, and safe to DELETE once `applied` has been logged for both accounts — which is the
// intent. It is a migration, not a guard: the root cause is fixed separately in snapshotsanity.mjs
// (`accountsLookSwapped` has aborted the publish on a transposed pair since 2026-08-31 20:47Z).

/* Each entry: the point that first carried the phantom, the value it must still hold, the amount to
   remove, and the value it must hold afterwards. Exact equality (to the cent) is the whole safety
   story — it is what makes this idempotent and what stops it firing against a series that has since
   been corrected by other means. */
export const PHANTOM_FLOW_FIX = {
  agentic: { from: '2026-08-31', expect: 7961.68, amount: 10.93, result: 7950.75 },
  main:    { from: '2026-08-31', expect: 136.70,  amount: 136.70, result: 0 },
};

const CENT = 0.005;

/* Repair one account's equityHistory. Returns a NEW array when it fires, the SAME array reference
   when it does not, so callers can cheaply tell whether anything changed. Never throws: a malformed
   or absent history is returned untouched, because a migration that breaks the build is worse than
   the drift it corrects. */
export function repairEquityHistory(history, spec) {
  if (!Array.isArray(history) || !history.length || !spec) return history;
  const anchor = history.find((p) => p && p.t === spec.from);
  if (!anchor || typeof anchor.cumFlow !== 'number') return history;
  if (Math.abs(anchor.cumFlow - spec.expect) > CENT) return history;   // already applied, or moved on
  const out = history.map((p) => (
    p && p.t >= spec.from && typeof p.cumFlow === 'number'
      ? { ...p, cumFlow: +(p.cumFlow - spec.amount).toFixed(2) }
      : p
  ));
  // Belt and braces: if the arithmetic did not land where it was supposed to, change nothing.
  const after = out.find((p) => p && p.t === spec.from);
  if (!after || Math.abs(after.cumFlow - spec.result) > CENT) return history;
  return out;
}

/* Apply every pending correction to a decrypted prior snapshot, IN PLACE.
   Returns [{acct, points, from, to}] describing what fired — empty once the migration is spent. */
export function repairPriorCumFlow(prior, fixes = PHANTOM_FLOW_FIX) {
  const applied = [];
  if (!prior || typeof prior !== 'object') return applied;
  for (const [acct, spec] of Object.entries(fixes)) {
    const block = prior[acct];
    if (!block || !Array.isArray(block.equityHistory)) continue;
    const fixed = repairEquityHistory(block.equityHistory, spec);
    if (fixed === block.equityHistory) continue;
    const points = fixed.filter((p) => p && p.t >= spec.from && typeof p.cumFlow === 'number').length;
    block.equityHistory = fixed;
    applied.push({ acct, points, from: spec.expect, to: spec.result });
  }
  return applied;
}
