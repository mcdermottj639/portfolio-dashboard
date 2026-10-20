/* One-time repair of a running total the pipeline itself got wrong (2026-10-20). Same shape as the
   2026-09-01 migration: a cumFlow total can never be republished away, because every same-day
   rebuild inherits it from the point it replaces, so the producer corrects it on its own write path
   and the fix is tested and self-disabling.

   The defect: on 2026-10-09 the owner withdrew $375 from ••••3900 (cash 379.24 → 4.24 with every
   position unchanged, read from the committed snapshots e36618a → 6c9dde0). The 8%-of-equity noise
   floor zeroed it — fixed going forward by `cashFlowThreshold` — so the recorded return carried a
   phantom −4.2% day and the drawdown breaker read the book 5.4pp behind SPY.

   Keyed on the exact bad values (both boundary points at 3788.17), so it fires on the first run and
   is a no-op from then on; a later genuine transfer moves the anchor and correctly stops it.
   Delete this module (and its build-data call) once a published snapshot carries the repair. */
export const REPAIRS = [
  { account: 'agentic', from: '2026-10-09', anchorPrev: '2026-10-08', anchorCum: 3788.17, flow: -375 },
];

export function repairCumFlow(history, { from, anchorPrev, anchorCum, flow }) {
  if (!Array.isArray(history)) return { history, applied: false };
  const prev = history.find((p) => p && p.t === anchorPrev);
  const first = history.find((p) => p && p.t === from);
  if (!prev || !first || prev.cumFlow !== anchorCum || first.cumFlow !== anchorCum) return { history, applied: false };
  const out = history.map((p) => (p && p.t >= from && typeof p.cumFlow === 'number')
    ? { ...p, cumFlow: +(p.cumFlow + flow).toFixed(2) } : p);
  return { history: out, applied: true };
}

export function applyRepairs(prior) {
  const done = [];
  for (const r of REPAIRS) {
    const blk = prior && prior[r.account];
    if (!blk || !Array.isArray(blk.equityHistory)) continue;
    const { history, applied } = repairCumFlow(blk.equityHistory, r);
    if (applied) { blk.equityHistory = history; done.push(r); }
  }
  return done;
}
