// Offline unit checks for finalists.mjs + research-universe.mjs — no network, no I/O.
// Run: node producer/finalists.test.mjs
import { selectFinalists, FINALIST_CAP, PER_SECTOR, CHALLENGER_SLOTS } from './finalists.mjs';
import { RESEARCH_UNIVERSE, universeSlice, DEFAULT_SLICE } from './research-universe.mjs';
import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
const ok = (label, cond) => { if (cond) pass++; else { fail++; console.error(`✗ ${label}`); } };

// A ranked list shaped like the workflow's `ranked`: best composite first.
const mk = (rows) => rows.map(([t, sec, composite]) => ({ t, sec, composite }));
// The real shape of the problem: incumbents dominate the top of the ranking, exactly as the six
// committed research cycles showed (SPY/GOOGL/NVDA/JPM in 6 of 6 targets).
const RANKED = mk([
  ['NVDA', 'Electronic Technology', 8.18], ['GOOGL', 'Technology Services', 7.73],
  ['AMZN', 'Retail Trade', 7.57], ['JPM', 'Finance', 7.57],
  ['MSFT', 'Technology Services', 7.54], ['LLY', 'Health Technology', 7.45],
  ['AVGO', 'Electronic Technology', 7.41], ['MA', 'Finance', 7.30],
  ['META', 'Technology Services', 7.21], ['SPY', 'Miscellaneous', 6.99],
  ['V', 'Finance', 6.91], ['AAPL', 'Electronic Technology', 6.73],
  ['GE', 'Producer Manufacturing', 6.70], ['CAT', 'Producer Manufacturing', 6.60],
  ['ABBV', 'Health Technology', 6.55], ['SHEL', 'Energy Minerals', 6.50],
  ['KO', 'Consumer Non-Durables', 6.30], ['NEE', 'Utilities', 6.20],
  ['TMUS', 'Communications', 6.10], ['O', 'Real Estate', 6.00],
  ['UNP', 'Transportation', 5.95], ['MCD', 'Consumer Services', 5.90],
]);
// The real book + prior target as of 2026-08-18.
const INCUMBENTS = ['SPY', 'AMZN', 'MSFT', 'MA', 'LLY', 'V', 'GOOGL', 'VTI', 'NVDA', 'JPM', 'SHEL', 'GE'];

// --- the old behaviour, reproduced by setting the quota to zero -----------------------------------
{
  const r = selectFinalists(RANKED, { cap: 10, challengerSlots: 0, incumbents: INCUMBENTS });
  ok('cap:10 / no quota reproduces the old cut size', r.finalists.length === 10);
  ok('…and surfaces no challengers', r.challengers.length === 0);
  const nonInc = r.finalists.filter((f) => !INCUMBENTS.includes(f.t));
  ok('…which on this ranking is almost entirely the incumbent book', nonInc.length <= 2);
}

// --- the quota actually reserves slots -------------------------------------------------------------
{
  const r = selectFinalists(RANKED, { incumbents: INCUMBENTS });
  ok('default cap is honoured', r.finalists.length === FINALIST_CAP);
  ok('the reserved slots are filled with non-incumbents', r.challengers.length === CHALLENGER_SLOTS);
  ok('…and every challenger really is outside the book/prior target',
    r.challengers.every((t) => !INCUMBENTS.includes(t)));
  ok('…merit pass still got the lion\'s share', r.meritCount === FINALIST_CAP - CHALLENGER_SLOTS);
  ok('…and the top-ranked name is never displaced by the quota', r.finalists[0].t === 'NVDA');
  ok('no duplicates', new Set(r.finalists.map((f) => f.t)).size === r.finalists.length);
}

// --- the sector cap is shared, so challengers cannot trade one concentration for another -----------
{
  const r = selectFinalists(RANKED, { incumbents: INCUMBENTS });
  const bySec = {};
  for (const f of r.finalists) bySec[f.sec] = (bySec[f.sec] || 0) + 1;
  ok('no sector exceeds the per-sector cap, challengers included',
    Object.values(bySec).every((n) => n <= PER_SECTOR));
}

// --- backfill: a reserved slot that cannot be filled must not be wasted ----------------------------
{
  // Every name is an incumbent ⇒ zero challengers available.
  const allInc = RANKED.map((r) => r.t);
  const r = selectFinalists(RANKED, { incumbents: allInc });
  ok('with no non-incumbents available the cut is still filled to cap',
    r.finalists.length === FINALIST_CAP);
  ok('…no challengers are invented', r.challengers.length === 0);
  ok('…and the shortfall is reported, not hidden', /challenger slots could be filled/.test(r.note));
}
{
  // A narrow universe: only 8 names exist at all.
  const r = selectFinalists(RANKED.slice(0, 8), { incumbents: INCUMBENTS });
  ok('a universe smaller than the cap returns what exists, without error', r.finalists.length === 8);
}

// --- the quota is what makes fresh names reachable at all -----------------------------------------
{
  const withQuota = selectFinalists(RANKED, { incumbents: INCUMBENTS });
  const noQuota = selectFinalists(RANKED, { challengerSlots: 0, incumbents: INCUMBENTS });
  const freshWith = withQuota.finalists.filter((f) => !INCUMBENTS.includes(f.t)).length;
  const freshWithout = noQuota.finalists.filter((f) => !INCUMBENTS.includes(f.t)).length;
  ok('the quota strictly increases how many fresh names reach adversarial verify',
    freshWith > freshWithout);
}

// --- research-universe -----------------------------------------------------------------------------
ok('the bench is materially wider than the 19-name leaders bench it replaces',
  RESEARCH_UNIVERSE.length >= 100);
ok('every row is well-formed', RESEARCH_UNIVERSE.every((r) => r.sym && r.sector && (r.tier === 'core' || r.tier === 'wide')));
ok('no duplicate tickers', new Set(RESEARCH_UNIVERSE.map((r) => r.sym)).size === RESEARCH_UNIVERSE.length);
{
  const sectors = new Set(RESEARCH_UNIVERSE.map((r) => r.sector));
  ok('it spans enough sectors to fill a 16-name cut at 2/sector', sectors.size >= 8);
  // The defensive ground the old bench had none of.
  ok('utilities, REITs and telecom are actually present',
    ['Utilities', 'Real Estate', 'Communications'].every((s) => sectors.has(s)));
}
{
  const s = universeSlice(DEFAULT_SLICE);
  ok('the default slice is the requested size', s.length === DEFAULT_SLICE);
  const bySec = {};
  for (const r of s) bySec[r.sector] = (bySec[r.sector] || 0) + 1;
  const counts = Object.values(bySec);
  // Round-robin, so the slice must be near-uniform across sectors — taking the array's first n
  // would hand back whatever sectors sit at the top, reintroducing the bias this file removes.
  ok('…and is sector-BALANCED, not just the first n rows',
    Math.max(...counts) - Math.min(...counts) <= 1);
  ok('…covering every sector the bench has', Object.keys(bySec).length === new Set(RESEARCH_UNIVERSE.map((r) => r.sector)).size);
  ok('…preferring core names within a sector',
    s.filter((r) => r.sector === 'Utilities').every((r, i, a) => i === 0 || a[i - 1].tier === 'core' || r.tier === 'wide'));
}
{
  const big = universeSlice(1000);
  ok('asking for more than exists returns everything, not an error', big.length === RESEARCH_UNIVERSE.length);
}

// --- MIRROR CHECK: the workflow's inlined copy must agree with this module ---------------------------
// .claude/workflows/agentic-research.js cannot import repo modules, so it hand-duplicates
// selectFinalists. A hand-kept mirror silently drifts, and this one decides which names ever reach
// adversarial verify — so rather than trusting a comment, extract the real block out of the workflow
// source and run it against the same fixture.
{
  const src = readFileSync(new URL('../.claude/workflows/agentic-research.js', import.meta.url), 'utf8');
  const start = src.indexOf('const FINALIST_CAP=');
  const end = src.indexOf('log(`Finalists', start);
  ok('the workflow still contains an inlined finalist block', start > 0 && end > start);
  if (start > 0 && end > start) {
    const block = src.slice(start, end);
    const run = new Function('ranked', 'HELD', 'PRIOR_TARGET',
      block + '\nreturn { finalists, challengers, meritCount };');
    const HELD = Object.fromEntries(INCUMBENTS.map((t) => [t, { w: null }]));
    const mirrored = run(RANKED, HELD, null);
    const canonical = selectFinalists(RANKED, { incumbents: INCUMBENTS });
    ok('mirror picks the same finalists, in the same order',
      mirrored.finalists.map((f) => f.t).join(',') === canonical.finalists.map((f) => f.t).join(','));
    ok('mirror reserves the same challengers',
      mirrored.challengers.join(',') === canonical.challengers.join(','));
    ok('mirror splits merit/challenger identically', mirrored.meritCount === canonical.meritCount);
    // And the constants themselves must match, since they are typed twice.
    ok('mirror uses the same cap / quota / sector rule',
      /FINALIST_CAP=16/.test(block) && /CHALLENGER_SLOTS=5/.test(block) && /PER_SECTOR=2/.test(block));
    ok('…which are the values this module exports',
      FINALIST_CAP === 16 && CHALLENGER_SLOTS === 5 && PER_SECTOR === 2);
  }
}

console.log(`\nfinalists.test: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
