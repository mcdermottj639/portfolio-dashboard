# Today · v228 implementation handoff

## Accepted design

Today remains a combined Self-directed + Agentic overview. The premium treatment has
two appearances: ivory/light and obsidian/evergreen/dark, with a remembered **Light /
Dark / System** choice. Gold is reserved for restrained borders, details, and a flat
confirmation button with dark text. Financial headline figures remain dark or white.

The owner's November 13 corrections supersede earlier concept images: **no intraday
account chart, gold glow, gradient buttons, four-tab navigation, Today account switch,
or ticker logos.** Keep all five tabs: Today, Portfolio, Research, Signals, Activity.

## Layout and interaction contract

| Surface | Behavior and source |
| --- | --- |
| Combined equity | `PFExperienceModel.dailyBrief`; both account values are required. Account summaries link to their explicit Portfolio context. |
| Stock move today | Current shares against captured previous close. Explicitly not full account P&L. Partial coverage is labeled. |
| Waiting on you | Full visible Apex trade set with prices directly above **Confirm with Claude**; owner-held Agentic proposals, review flags and dated earnings remain separate items. |
| Stop → entry → target | A proportional price rail from validated `Apex.levelsFor`, requiring stop < entry limit < target. Buy-stop trigger and limit stay distinct in the trade text. No invented research levels. |
| Confirm with Claude | Uses the unchanged `Apex.portfolioPrompt` for the whole book. A changed book between display and click requires another review; the first click opens nothing. Self-directed broker tools remain read-only and the owner enters approved orders. |
| Out of your hands | Recorded Agentic ticket state, with executor queue, reported submission and recorded completion distinguished from broker fills. Open option expirations are labeled calendar events. |
| Holdings | Area is proportional to recorded positive stock value. Sign and numeric labels show the quoted move; missing quotes stay unknown. List provides all names, including unvalued positions and small map tiles. |
| Holding detail | Native dialog; Escape and close restore focus. Shared tickers offer explicit Self-directed and Agentic Research/Plan destinations. Back returns to combined Today. |
| Biggest drag | Dynamic only when a negative complete stock contribution exists. Never hardcode IREN or treat partial quotes as complete. |
| Value over time | Collapsed tap row; only matching daily account observations. Includes flows, so it is value history rather than investment return. |
| Options / calendar / sources | Collapsed details preserve all existing information, including cash versus debt, timestamps, coverage and reconciliation limitations. |

## Files and ownership

- `theme.js`: first-paint preference resolver. `pf_theme` remains compatible with the
  existing `gold` dark CSS namespace; public API accepts `light`, `dark`, `system`.
  System follows OS changes only when selected; legacy dark preferences survive.
- `today-model.js`: pure percentage, treemap, rail, drag and ticket presentation helpers.
- `today.js`: rendering and read-only interactions. It does not recalculate the strategy.
- `today.css`: scoped Today styling; loaded after the existing Duo stylesheet.
- `index.html` / `renderApexCard`: exposes the same computed Plan state to Today through
  `__PF_APEX_REVIEW`, including snapshot/source identity. A `fromToday` option prevents
  refresh recursion. The strategy engine and broker producer files are unchanged.
- `experience.js`: calls the new renderer, retaining the previous renderer as the
  fallback if a new asset does not load. Navigation and the five-tab shell stay intact.
- `sw.js`: precaches the new assets. App, cache and shell asset query versions move together.

## Responsive and privacy requirements

Phone reading order is overview → waiting → out of your hands → holdings → details.
Duo/open and desktop use two columns. Preserve the v222 folded-landscape rail and
safe-area handling, including ~678×453 with a left status strip and ~960×676 with
a right status strip. Never claim physical-device testing from a desktop emulation.

Today and its holding dialog use the existing private region. Trade share quantities
have explicit bare-value markers; monetary values and leverage use existing masking.
The full private Claude prompt is created on click, not stored in a Today link's DOM
attributes. Only appearance and map/list UI preferences are saved; no financial
records are newly persisted.

## Verification

Run `node --test tests/*.test.cjs` and every `producer/*.test.mjs`. The existing
`tests/brief-browser.mjs` entry point runs `today-browser.mjs` against the synthetic
preview. It checks both themes, System persistence, map proportions, source gaps,
ticket ownership, privacy, both account routes/Back, full-book prompt parity, a
changed-plan click and seven viewport sizes. The Claude window is stubbed; no trade
or authenticated broker write is exercised. Existing Plan, Apex and Journey browser
suites remain release gates. CI saves synthetic screenshots under its Journey evidence
artifact. Production credentials or decrypted account data must not be used for previews.
