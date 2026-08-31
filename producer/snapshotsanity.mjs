// producer/snapshotsanity.mjs — PURE cross-account integrity checks for the producer (2026-08-31).
//
// WHY THIS EXISTS. On 2026-08-31 a producer run published the two accounts' POSITION ARRAYS crossed:
// data.agentic.positions held ••••0741's book (IREN/PLTR/TSM/CIFR/NVDA) and data.main.positions held
// ••••3900's twelve names. Cash and account totals were each correct, so nothing downstream noticed —
// the agent had simply passed the account numbers the wrong way round on the two get_equity_positions
// calls, and build-data faithfully consumed what it was handed.
//
// The damage was not the display. `agentic-deploy` planned a $61,962 liquidation of an account holding
// none of those names (350 of the IREN shares back short calls in the margin book, so a one-tap approval
// would have written naked calls), and — worse, because it is PERMANENT — the deposit inference saw each
// book replaced wholesale, booked equal-and-opposite phantom transfers of ±$20k into BOTH accounts'
// recorded equity series, and `appendEquityPoint` carries a cumFlow forward as a running total, so the
// error becomes the baseline for every future point. A snapshot can be republished; a corrupted running
// total has to be repaired by hand.
//
// WHY A SET COMPARISON RATHER THAN A RECONCILIATION. Checking cash + Σ(positions × px) against the
// account's own total_value looks tighter but false-positives constantly: a position the producer could
// not quote prices at 0, which is routine (a brand-new target name has no quote until the next run). The
// position IDENTITY, compared against each account's OWN prior book, needs no tolerance at all — the
// books are stable across an hour, and a wholesale replacement of both, each matching the other's prior
// contents, is not something a market or a rebalance can produce.
//
// Fails OPEN below SWAP_MIN_NAMES on either side: two thin books can overlap by coincidence, and a
// producer that refuses to publish is its own kind of outage.

export const SWAP_MIN_NAMES = 3;
export const SWAP_CROSS_MIN = 0.6; // how strongly the fresh book must match the OTHER account's prior book

const symsOf = (arr) => new Set((Array.isArray(arr) ? arr : [])
  .map((p) => String((p && (p.symbol || p.sym || p.ticker)) || '').toUpperCase().trim())
  .filter(Boolean));

// Overlap as a fraction of the SMALLER set, so a 5-name book fully contained in a 12-name one scores 1.0.
const overlap = (a, b) => {
  if (!a.size || !b.size) return 0;
  let hit = 0; for (const s of a) if (b.has(s)) hit++;
  return hit / Math.min(a.size, b.size);
};

// Returns a reason string when the two accounts' fresh position arrays look crossed, else null.
// `agentic`/`main` take { fresh, prior } position arrays (any of the {symbol|sym|ticker, ...} shapes).
export function accountsLookSwapped({ agentic = {}, main = {} } = {}) {
  const fa = symsOf(agentic.fresh), pa = symsOf(agentic.prior);
  const fm = symsOf(main.fresh), pm = symsOf(main.prior);
  if ([fa, pa, fm, pm].some((s) => s.size < SWAP_MIN_NAMES)) return null; // too thin to judge — fail open
  const aOwn = overlap(fa, pa), aCross = overlap(fa, pm);
  const mOwn = overlap(fm, pm), mCross = overlap(fm, pa);
  const pct = (x) => `${Math.round(x * 100)}%`;
  // The agentic book is the one that drives trading, so its identity alone is disqualifying. A both-ways
  // cross is reported as such because it names the actual failure (two calls, arguments transposed).
  if (aCross >= SWAP_CROSS_MIN && aCross > aOwn) {
    const both = mCross >= SWAP_CROSS_MIN && mCross > mOwn;
    return `the agentic positions match the SELF-DIRECTED account's prior book ${pct(aCross)} but its own only ${pct(aOwn)}`
      + (both ? `, and the self-directed positions match the agentic prior book ${pct(mCross)} vs its own ${pct(mOwn)} — the two accounts' get_equity_positions results are TRANSPOSED`
              : ` — the agentic fetch returned the wrong account's positions`);
  }
  return null;
}
