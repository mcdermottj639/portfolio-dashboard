# Next real-app update — preplan notes

Ideas queued for the next update of the REAL app (after the Sunday 2026-11-29 lab batch). Not lab work:
items here may touch `producer/`, `data/` and workflows, which the lab rules forbid.

**These are starting ideas, not locked specs (Jack, 2026-11-26).** The builder does it the way they judge
best. The goal and the "must not" lines are fixed; the method is the builder's call. If a better route
gets the same result with fewer calls or less risk, take it and say why in the release log.

---

## PD-ANALYZE-WIDEN — more tickers Analyze can open (owner request 2026-11-26 1:44 AM ET)

**Goal:** Research > Analyze can open far more stocks. Jack sees 10 openable today ("Gotta up those numbers").

**Owner's idea (starting point, not locked):**
- Add the **Nasdaq-100** (current list, verified from a source at build time, never typed from memory)
  plus **every ticker on Jack's Robinhood watchlists**, duplicates removed.
- For each, save the same data Analyze uses today: quote, daily history, monthly history, company overview.
- Stay inside API limits: batch calls; refresh company overviews **daily, not every run**.

**Must not:**
- Change the Apex or Agentic tickets, models, thresholds or rules.
- Turn the paused "Portfolio dashboard refresh" scheduled task back on (only Jack does that).
- Break the Nov 20 rule: a FETCH_ALL run still finishes the Daily Picks rebuild.

**Done when:**
- Analyze's "tickers analyzable" count is **≥ 100**, and **NVDA, COST and one watchlist name** all open.
- Tests pass → Claude merges (Jack never merges).
- Then run **one manual refresh** and report the new count to Jack.

**Builder notes (check first, not instructions):**
- `producer/analyze-universe.mjs` already holds an ordered "Analyze bench" (holdings → agentic target →
  market → leaders → SD_BENCH → research → vehicles) and `hist-plan.mjs` keeps it fresh under a daily cap.
  The bench looks wider than 10, so first find why only 10 open (likely the cap / what reaches the
  snapshot), then decide whether to extend the bench, raise the cap, or add a new tier.
- Watchlist names come from the Robinhood watchlists (`sync-watchlist.mjs` may already read them);
  read-only — never edit a watchlist.
- Order matters: new tiers go **after** holdings and target names so real money is always fetched first.
