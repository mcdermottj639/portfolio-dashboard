# Agentic correctness — v148

> **v149 follow-up:** Account estimates now consume existing recorded equity history automatically
> (producer and browser share the same calculation), with matching-date coverage checks and explicit
> inferred-flow / valuation-time limitations. The panel shows the existing account record even before
> a v148+ producer refresh, then adds an estimate on each shadow vintage's dates. No estimate is called
> verified and no execution gap is derived from it. The optional verified comparison still requires
> feeds not available in this session; it is labeled "Not connected" rather than implying waiting fixes
> it. Tracking status distinguishes pre-upgrade snapshots, pending closes, invalid targets and stale
> bars. Historical evidence is labeled as historical, not a current mandate/configuration failure.
> App/cache: v149 / pf-v149. Production Claude Routine access remains unavailable here; its next
> successful publish is required for new forward observations. Browser reload only reloads published data.


Implemented September 16, 2026. This changes validation and measurement, not Mandate A's factor weights, flow weight, defensive/gold floors, or existing execution safeguards.

## Allocation and execution

`riskweights.mjs` rejects invalid, duplicated, unallocatable, or over-cap weights. Redistributed weight consumes shared cluster capacity sequentially; rounding cannot cross a cap. An infeasible candidate raises `INVALID_TARGET`; never normalize it back above the limits. Re-run research with enough qualified survivors. `finalize-target.mjs --write` validates before an atomic replacement; failure leaves the previous canonical target intact.

New evidence-v1 targets also enforce the existing Mandate A 10% index residual limit at admission. Generic risk-weight helpers remain usable for older mandate fixtures. Index look-through is still reported, not enforced. Per-name volatility proxy caps are stamped on finalized rows so the executor can enforce them after the price/range inputs have been stripped.

The executor validates the canonical target before any active-ticket resume or fresh plan. New plans/tickets bind to a content-derived `targetId`. Unfilled legacy or changed-target tickets are replanned; a partially executed ticket with a changed/missing binding produces DEGRADED and requires fill reconciliation before continuation. Do not discard fills or blindly resume an old ticket. The gate does not place orders.

`modelVersion`, `mandateVersion`, `riskVersion`, `factorWeights`, `universeVersion`, and `targetId` are decision-time stamps. Existing decisions remain `legacy-unversioned`. Do not backfill them using the current target. `makeDecision` must receive the exact target used by its plan. The existing target's description was corrected without changing its date, holdings, weights, levels, or phase-out state.

## Research evidence

The workflow requires a supplied universe. Its new source-inputs stage fetches missing price/range provenance, including when called with the old Routine argument shape. Thus source collection does not rely exclusively on a server-side prompt edit. No baked-in stale price fallback can become an eligible target.

Each sleeve returns `{ticker,score,status,note,evidence:[{source,asOf,claim}]}`. Source is a real HTTPS URL or `mcp:tool-name/record-id`; `asOf` is the underlying data date, not the time the agent retrieved it. Missing scores are null. A single missing sleeve retains an explicit neutral arithmetic imputation in the composite; it is not recorded as an observed fact. Two missing sleeves or absent quality exclude the name. Factor weights remain 22/24/22/14/18%, flow 0.

`agentic-evidence.mjs` requires selected non-index names to have quality plus at least three of four supported qualitative sleeves, source-backed price/range data within five calendar days, and an explicitly business-sound adversarial verdict with evidence. Momentum/catalyst evidence is at most 14 days old, quality/growth at most 120 days, verification at most 30 days. Future dates and invented placeholder source formats fail. These checks establish traceability/coverage, **not independent factual verification**. A provider outage may correctly defer a target update.

Pass the WHOLE workflow return to finalization. Bare allocation JSON remains inspectable without `--write`; it cannot be promoted. The final target stores coverage by name, the underlying evidence, and a hash of universe membership. `researchSummary` preserves the allocator's original, pre-adjustment rationale; `method` describes final actual weights. Never re-finalize an old target just to rewrite its text: that advances the phase-out lifecycle.

## Corrected grading (metric version 2)

- Buy return: dollar-weighted return of the buy basket; buy excess: buy return minus SPY. Every buy must have a usable price for a record-level score.
- Sold return: subsequent dollar-weighted return of the sold basket. Avoided return is its negative, with no extra subtraction of SPY.
- Rotation: buy return minus sold return; estimated dollar benefit uses the smaller basket's dollars. This is a proportional matched-basket counterfactual, not proof of which sale funded which purchase.
- Missing benchmark means unknown, never a loss or an absolute-return win. Sell-only decisions do not enter buy-vs-SPY win counts. Live buy-leg summaries can show observed legs with explicit comparable/unknown counts.
- Frozen 5/30/90-calendar-day marks require a common terminal closing date across all legs, no later than asOf and no more than five calendar days after the horizon. Benchmark comparison requires SPY on that date. Within the grace window a live mark can still be recorded and is labeled `src: live`.
- Old mixed-score marks are excluded from current statistics, preserved under `legacyMarks`, and recomputed only where recorded historical data supports it. No fabricated historical model version.
- UI hides pre-v2 scores while awaiting the next snapshot. Results are grouped by recorded model version. Sleeve associations and overlapping buy legs are exploratory, not independent causal experiments or a basis to automatically change factor weights.

## Forward shadow and risk diagnostics

`build-data.mjs` stores `data.agentic.correctness` in the encrypted snapshot. `agentic-observatory.mjs` observes each target content identity when first seen. Each vintage starts at the first common completed close **strictly after** that observation day, excludes today's forming daily bar, and holds the initial basket without rebalancing. A new target starts a new vintage; the old vintage is never rewritten with new weights. Observed outcomes are immutable. This is a set of target-selection experiments, not a simulated continuous trading strategy. No fees or slippage are modeled. `hist-plan.mjs` keeps archived vintage symbols in its fetch universe for up to 400 days.

Default bars are price returns, with dividends excluded and corporate-action limitations disclosed. These must never be called SPY total return. Optional raw inputs support a stricter actual/model/SPY comparison:

- `raw/agentic-total-return.json`: `{SYM:{basis:"total-return",source:"provider/feed",normalizationId:"stable-series-id",rows:[["YYYY-MM-DD",value],...]}}` for every target symbol and SPY. Values must be dividend-reinvested, split-adjusted wealth indices on a stable normalization. **Do not supply raw close or retrospectively rebased adjusted close as a stable wealth index.** A changed normalization cannot be spliced into an existing vintage. A vintage's measurement basis is fixed when first observed.
- `raw/agentic-performance-closes.json`: verified account closing rows `{day,equity,cumFlow,previousDay,verified:true,flowTiming:"end-of-day",source}`. `previousDay` attests a fully covered interval. External flows must truly occur at interval end; intraday flows require correctly unitized valuations before using this contract. The existing equityHistory's inferred flows are insufficient. Verified rows persist in the encrypted shadow state.

The existing scheduled data feeds do not yet provide those optional verified inputs. Until a provider adapter supplies them, price-only shadow returns work and the strict actual-account comparison reads **Unavailable**. The existing account performance chart remains available with its inferred-flow methodology. Do not claim a measured execution gap from differently timed or differently adjusted series.

Diagnostics use up to 63 recorded daily log returns, at least 20 observations, annualization by sqrt(252), and correlations on identical date-pair intervals. Stale series and thin pairs show unavailable. These are display-only and do not replace the 52-week range sizing proxy or change portfolio weights.

## Verification and operational limits

Run all `producer/*.test.mjs` sequentially; integration tests back up and temporarily replace fixtures. `agentic-correctness.test.mjs` exercises cap rejection, aligned marks, legacy migration, absent benchmarks, forward-only vintages, cash flows, source coverage, and the full sandbox workflow → CLI promotion → invalid resumed-ticket rejection in an isolated temporary repository. It makes no broker calls.

The v148 implementation was self-audited; an independent Fable review was unavailable. Live Claude Routine editing/triggering and broker access are not available in this development session. Paste-ready Routine instructions are updated in this repository; server-side configuration has not been independently verified. The source-enrichment workflow stage and deterministic admission/execution checks are code-side safeguards for the next run. No live orders were placed for validation.

Browser screenshot verification was unavailable in this environment (no Chromium binary; download timed out). Inline JavaScript compilation and real formatter/panel rendering checks cover the new consumer code, including absent-data states and evidence escaping.
