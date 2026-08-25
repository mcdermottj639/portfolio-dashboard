// producer/finalists.mjs — which candidates reach the ADVERSARIAL VERIFY stage, and why.
//
// CANONICAL COPY. The research workflow (.claude/workflows/agentic-research.js) runs in a sandbox that
// cannot import repo modules, so it inlines a MIRROR of `selectFinalists`. This file is the source of
// truth and the only one with tests — keep the two in step, exactly as riskweights.mjs/clusterOf is
// mirrored into the synthesis prompt.
//
// ── WHY A CHALLENGER QUOTA (2026-08-25) ─────────────────────────────────────────────────────────────
// The cut used to be one line: take the top 10 by composite, max 2 per sector. It looked neutral and
// was not. Measured over the six committed research cycles (2026-06-29 → 08-18), the whole system
// selected **14 distinct names in seven weeks**, and seven of them appeared in five or more of six
// targets — SPY/GOOGL/NVDA/JPM in all six. The apparent variety at the bottom (MA, VTI, AAPL, UNH:
// one appearance each) was mostly the 08-05→08-12 churn incident, not discovery.
//
// The trap is that this is NOT evidence the process is broken, and it is NOT evidence it is working.
// It cannot be either, because a landslide tells you nothing when one name is on the ballot: "these
// are the best names available" and "these were the only names shown" produce identical output. Three
// narrowing steps all pulled the same way — a bench that was 16/19 megacap, a composite weighting
// momentum+growth 0.44 against valuation 0.18, and this cut. Widening any one alone got absorbed by
// the other two (a 2.4× wider universe moved 2 of 10 finalist slots).
//
// So the fix is not to force turnover — the churn governor exists because turnover was destroying real
// money in short-term tax, and a stable core of good names is a legitimate outcome for this mandate.
// The fix is to widen what gets EVALUATED while leaving what gets HELD entirely to the existing
// guards. `challengerSlots` reserves part of the cut for names in neither the prior target nor the
// current book, so fresh candidates face the adversarial verifier every week and either survive on
// merit or do not. Nothing here buys anything: the verify stage, the incumbency framing ("displace an
// incumbent only when MATERIALLY stronger"), the 14-day min-hold and the re-entry cooldown all still
// decide what actually trades. This makes the incumbents' win meaningful instead of unfalsifiable.

export const FINALIST_CAP = 16;      // was 10 — see the cut analysis above
export const PER_SECTOR = 2;         // unchanged: the only diversity rule the old cut had
export const CHALLENGER_SLOTS = 5;   // of FINALIST_CAP, reserved for non-incumbents

// ranked: [{t, sec, composite, …}] ALREADY sorted best-first (the workflow's `ranked`).
// incumbents: iterable of tickers currently held or in the prior target.
// Returns { finalists:[…], challengers:[tickers], meritCount, note }.
export function selectFinalists(ranked, opts = {}) {
  const cap = opts.cap ?? FINALIST_CAP;
  const perSector = opts.perSector ?? PER_SECTOR;
  const reserved = Math.max(0, Math.min(opts.challengerSlots ?? CHALLENGER_SLOTS, cap));
  const inc = new Set([...(opts.incumbents || [])].map((s) => String(s).toUpperCase()));

  const rows = (ranked || []).filter((r) => r && r.t);
  const secCount = {};
  const chosen = [];
  const taken = new Set();
  // One shared per-sector budget across both passes. A challenger does NOT get to breach the sector
  // cap: five challengers all from one sector would trade one concentration for another.
  const fits = (r) => (secCount[r.sec] || 0) < perSector;
  const take = (r) => { secCount[r.sec] = (secCount[r.sec] || 0) + 1; chosen.push(r); taken.add(r.t); };

  // Pass 1 — MERIT. Best names regardless of incumbency, up to cap minus the reserved slots.
  const meritTarget = cap - reserved;
  for (const r of rows) {
    if (chosen.length >= meritTarget) break;
    if (taken.has(r.t) || !fits(r)) continue;
    take(r);
  }
  const meritCount = chosen.length;

  // Pass 2 — CHALLENGERS. Best names NOT already in the book or the prior target.
  const challengers = [];
  for (const r of rows) {
    if (chosen.length >= cap) break;
    if (taken.has(r.t) || inc.has(String(r.t).toUpperCase()) || !fits(r)) continue;
    take(r); challengers.push(r.t);
  }

  // Pass 3 — BACKFILL. If there were not enough non-incumbents to fill the reserved slots (a narrow
  // universe, or a sector cap that blocked them), give the remainder back to merit rather than
  // shrinking the finalist set. A reserved slot that cannot be filled must not become a wasted one.
  for (const r of rows) {
    if (chosen.length >= cap) break;
    if (taken.has(r.t) || !fits(r)) continue;
    take(r);
  }

  const note = challengers.length < reserved
    ? `only ${challengers.length}/${reserved} challenger slots could be filled — the universe holds too few non-incumbent names that clear the sector caps; widen args.universe (producer/research-universe.mjs)`
    : '';
  return { finalists: chosen, challengers, meritCount, note };
}
