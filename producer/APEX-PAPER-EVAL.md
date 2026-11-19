# Apex v2.9 paper — evaluation spec `eval-1` (locked 2026-11-19)

PAPER ONLY. This spec measures; it changes no live rule, threshold, ticket or schedule.
Code: `EVAL` and `evaluate()` in `producer/apex-paper.mjs` (pinned by `producer/apex-paper.test.mjs`).
Any change to the numbers below is a new version (`eval-2`), never an edit of `eval-1`.

## Arms (every arm graded the same way)
| Arm | Ledger gate(s) | What it is |
|---|---|---|
| `live` | `live-pick` | Names the live v2.8 scan targeted that Monday (control arm, graded on paper) |
| `paper` | cohort picks | v2.9 paper selections |
| `rejectedLive` | `live-tech-cap`, `live-rr` | Names a live rule blocked |
| `rejectedPaper` | `paper-*` | Names one paper test short |

Owner-managed core (IREN) never enters any arm.

## Fixed rules
- Cohort: frozen on the Monday 7:52 AM ET run. Entry: first session OPEN after the cohort date.
- Late live names: if the live targets file for that Monday arrives after 7:52 (8:30 AM / 12:30 PM copy),
  the next run before that open adds them (`liveStatus: added-late`), entering at the same open.
  After that open they are never added (no look-ahead); the cohort shows `liveStatus: missing` instead.
- No fill within 10 trading days: the name is dropped, not graded.
- Horizons: 5 / 30 / 60 / 90 trading days. Primary: 30.
- Benchmark: SPY over the same dates. Alpha = return − SPY return (points).
- Costs: 0.20 pt round trip (`avgAlphaNet`). Margin interest not modelled.
- Weighting: equal weight per name; a name in two gates of one arm counts once.
- Statistics per arm and horizon: n, hit rate (alpha > 0), mean alpha, median alpha, mean net alpha.
- Results are descriptive until 12 Monday cohorts per arm. Skipped Mondays (partial coverage, failed run)
  are listed in `skipped` with the reason and are not back-filled.

## Raw vs simulated
`evaluation.arms` is RAW stock performance (each name, buy at open, mark at horizon).
`evaluation.simulated` (spec `sim-1`, `SIM` in code, added 2026-11-19) is a SIMULATED portfolio, `null`
until daily prices are stored:
- Prices: `paths` in the paper file, `[date, open, low, close]` per cohort and symbol (plus SPY), read-only,
  supplied by the scheduled task with `--paths`. A stored day is never overwritten; newest 26 cohorts kept.
- Arms: `paper` (frozen cohort weights, rest cash) and `live` (live v2.8 picks, equal weight).
- Hold: entry open to 30 trading days, or the frozen stop (paper picks freeze `stop` and `tp1` from 2026-11-23).
  Stop fill = the stop, or the open when the day opens below it. Live picks carry no stored stop.
- Per cohort: net return, SPY over the same dates, net alpha, max drawdown of the cohort curve, average
  exposure (% of capital invested per day), stop hits. Costs 0.20 pt per position; margin interest not modelled.
- Only completed cohorts are averaged; descriptive until 12 completed cohorts per arm.

## Not decided here
Promotion thresholds (what result would justify changing a live rule) are Jack's call with GPT,
written before 12 cohorts exist. Preliminary results never loosen a live rule.
