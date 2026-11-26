# Portfolio LAB — practice copy (owner decision, 2026-11-25)

`lab/` is a practice copy of the dashboard served at
`https://mcdermottj639.github.io/portfolio-dashboard/lab/`. It is where the Thanksgiving re-envision is
built. **Nothing in `lab/` is the real app.** The real app (`index.html`, `ui/`, `sw.js`) does not change
until Jack approves one batch (target: Sunday 2026-11-29).

## Hard rules for anyone working in lab/
- Change only files under `lab/`. Never `index.html`, `ui/`, `sw.js`, `producer/`, `data/`, `data.json`,
  `AGENTIC.md`, tests or workflows as part of lab work.
- The lab reads the SAME data as the real app (`../data.json`, `../data/*.json`). It never writes data,
  never changes a number, a calculation, a rule constant or a threshold. Layout, structure, navigation,
  wording and visuals only. A number that looks wrong is reported in `lab/AUDIT.md`, not fixed.
- The lab never registers a service worker. The real app's worker still caches lab assets cache-first, so
  EVERY change bumps the lab build: replace `?v=labN` with `?v=labN+1` everywhere in `lab/index.html`
  and the ribbon text (`PRACTICE COPY · labN+1`).
- Same origin as the real app: it shares `localStorage` (saved passphrase, routes). Read existing keys
  freely; any NEW key must start with `lab_`.
- All of CLAUDE.md §2–§4 still apply (accounts, authorization, strategy rules, privacy; IREN is
  owner-managed; no IRA anywhere). Synthetic data only when testing (`node tests/preview.mjs`, then
  `http://127.0.0.1:8767/lab/index.html`).
- Lab-only styles live in the `<style id="lab-css">` block at the end of `lab/index.html`; before/after pictures
  in `lab/shots/`, shown by `lab/changes.html` (linked beside the ribbon; keep the 4 newest runs).
- Screens that must be right (Jack, 2026-11-25): normal iPhone (390×844), iPhone Duo open / Book
  (960×676), Windows PC full view (1440×900). No sideways scroll, no blank background showing.

## The vision (Jack's words and choices, 2026-11-25)
- "I want this to be in support in addition to Robinhood, so I don't need duplicating tons of Robinhood
  information that I can already get in the app... This has to be even further and deeper things
  personalized to me... helping me see and understand the markets in our models."
- The app must answer four things Robinhood can't: (1) how my models are doing (Apex, v2.9 paper,
  Agentic vs SPY), (2) what to do today (orders still needed, with entry, target, stop), (3) why a pick
  made it (score, setup, news, what was rejected), (4) what the market is doing as it bears on the models.
- Pain today: wasted space and misaligned cards; too much scrolling; can't see performance fast.
- Scope: "I want the whole app reenvisioned" — pages and navigation may be rethought inside the lab.
- Analyze: "really could be bolstered and the more we improve that, I think that improves everything,
  cause that's just the research and information explaining it all."
- Cuts: prediction markets "can all be removed"; What-if is already gone (v255). Smart $ — CONFIRMED by Jack
  2026-11-25 5:07 PM ET: drop the Smart $ page, keep one insiders/Congress line per stock inside Analyze.
- "reduce waste and make this as impactful as possible without losing the good information."
- Done by Sunday 2026-11-29. One batch for his approval; nothing ships before that.

## Order of work (Claude's pick; update as it moves)
1. Analyze — the research core (why a pick made it, levels, news, model verdicts in one place).
   DONE for this pass (lab2 layout, lab3 model verdicts + why-it-made-it strip, lab4 one-row chips).
   The Congress line lands with item 4.
2. Today — models vs SPY at a glance + what to do today; first screen answers both. NEXT.
3. Apex and Agentic — decision view, no Robinhood duplication; Book and PC use the width.
4. Cut Predict and the Smart $ page; fold what is worth keeping into Analyze.
5. Navigation pass, then a full three-screen sweep and the Sunday batch summary.

## Changelog (newest first; one line per run)
- lab5 · 2026-11-26 · In-Claude chat changes brought into the repo so both copies match (Analyze, unlock). Jack, Nov 26 6 PM ET: "put today's in-Claude LAB changes into the repo lab/ folder". Ported as published: Expand/Collapse control inside the ticker search bar (replaces lab4's one-row CSS, removed), ticker count under the search box, support/resistance block with mini chart (same tested-zone method as the real app v268 — a calculation change Jack approved in chat), passphrase kept in IndexedDB + Face ID fill + "Remember on this device". RULE: change the lab in the repo first, then republish; never edit the in-Claude copy alone.
- lab4 · 2026-11-26 · Section chips and Collapse all share one row; verdict sits about 54px higher (Analyze). Nothing cut: same chips, same button, CSS only. Analyze pass is done; next run starts Today.
- lab3 · 2026-11-25 · "My models" strip: Apex, Agentic and paper verdict for the stock, with reason (Analyze). Nothing cut. Reads files the app already loads (apex-targets, agentic target, paper file); shows status + the research reason, no prices. Insiders already show in the Flow read line; the Congress half of that line waits for the Smart $ cut (item 4). Left for Analyze: jump-chips and Collapse-all still take two rows.
- lab2 · 2026-11-25 · Verdict, setup score and price on first screen; PC two columns; less chrome (Analyze). Nothing cut: the big Setup gauge moved into the header, stale-data text folded behind one line, phone hides the "Top holdings" label (chips stay). Left for Analyze: model verdicts (Apex / Agentic / paper) and the insiders/Congress line per stock; jump-chips and Collapse-all still take two rows.
- lab1 · 2026-11-25 · Practice copy created from v267; identical to the real app plus the ribbon.
