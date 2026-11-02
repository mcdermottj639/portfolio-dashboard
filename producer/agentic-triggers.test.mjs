// Offline unit checks for agentic-triggers.mjs — no network, no I/O. Run: node producer/agentic-triggers.test.mjs
import { computeAgenticTriggers, stopBreaks, CASH_DEPLOY_PCT, DEPOSIT_FLOOR, GAP_REFRESH_PCT } from './agentic-triggers.mjs';

let pass = 0, fail = 0;
const ok = (label, cond) => { if (cond) pass++; else { fail++; console.error(`✗ ${label}`); } };
const q = (last) => ({ last_trade_price: String(last) });
const kinds = (r) => r.triggers.map((t) => t.kind);

// Prior: fully deployed, ~2% cash. Fresh: a $1500 deposit lands → cash jumps, book grows.
const priorPos = [{ symbol: 'NVDA', qty: 5, px: 200 }, { symbol: 'SPY', qty: 1, px: 740 }]; // equity ~1740+cash
const prior = { quotes: { NVDA: q(200), SPY: q(740) }, agentic: { cash: 30, equity: 1770, positions: priorPos } };
const freshPos = [{ symbol: 'NVDA', qty: 5, px: 200 }, { symbol: 'SPY', qty: 1, px: 740 }];
const fresh = { quotes: { NVDA: q(200), SPY: q(740) }, agentic: { cash: 1530, equity: 3270, positions: freshPos, target: { names: [{ ticker: 'NVDA' }, { ticker: 'SPY' }] } } };

const dep = computeAgenticTriggers(prior, fresh);
ok('deposit inferred (~+1500 flow)', Math.abs(dep.depositFlow - 1500) < 5);
ok('deploy-cash trigger fires on the deposit', kinds(dep).includes('deploy-cash'));
ok('deposit flags a research refresh', dep.refreshResearch && dep.refreshReasons.some((r) => r.includes('deposit')));
ok('deploy-cash msg quotes the cash + deposit', dep.triggers[0].msg.includes('idle cash') && dep.triggers[0].deposit > 0);

// Sitting on cash already above the band with NO new deposit → no re-nag (transition-based).
const sat = { quotes: { NVDA: q(200) }, agentic: { cash: 1500, equity: 3000, positions: [{ symbol: 'NVDA', qty: 7.5, px: 200 }] } };
const noNag = computeAgenticTriggers(sat, sat);
ok('no deploy-cash re-fire when cash merely sits (no deposit, no crossing)', !kinds(noNag).includes('deploy-cash'));

// Cash crossing the band UP (e.g. a sale settled) fires once even without a classic deposit.
const lowCash = { quotes: { NVDA: q(200) }, agentic: { cash: 20, equity: 2020, positions: [{ symbol: 'NVDA', qty: 10, px: 200 }] } };
const crossed = { quotes: { NVDA: q(200) }, agentic: { cash: 300, equity: 2020, positions: [{ symbol: 'NVDA', qty: 8.6, px: 200 }] } };
ok('cash crossing the band up fires deploy-cash', computeAgenticTriggers(lowCash, crossed).triggers.some((t) => t.kind === 'deploy-cash'));

// A big overnight gap on a held target name → refresh research early.
const gPrior = { quotes: { GOOGL: q(342) }, agentic: { cash: 50, equity: 1000, positions: [{ symbol: 'GOOGL', qty: 2, px: 342 }], target: { names: [{ ticker: 'GOOGL' }] } } };
const gFresh = { quotes: { GOOGL: q(324) }, agentic: { cash: 50, equity: 964, positions: [{ symbol: 'GOOGL', qty: 2, px: 324 }], target: { names: [{ ticker: 'GOOGL' }] } } };
const gap = computeAgenticTriggers(gPrior, gFresh);
ok('earnings gap (~-5% < 6%?) — set threshold sanity', GAP_REFRESH_PCT === 6);
const gPrior2 = { quotes: { GOOGL: q(342) }, agentic: { cash: 50, equity: 1000, positions: [{ symbol: 'GOOGL', qty: 2, px: 342 }], target: { names: [{ ticker: 'GOOGL' }] } } };
const gFresh2 = { quotes: { GOOGL: q(315) }, agentic: { cash: 50, equity: 946, positions: [{ symbol: 'GOOGL', qty: 2, px: 315 }], target: { names: [{ ticker: 'GOOGL' }] } } }; // -7.9%
const gap2 = computeAgenticTriggers(gPrior2, gFresh2);
ok('a >6% held-name gap flags a research refresh', gap2.refreshResearch && gap2.refreshReasons.some((r) => r.includes('GOOGL')));

// No prior (first run) → no crash, no false deposit.
const first = computeAgenticTriggers(null, fresh);
ok('first run (no prior) does not crash', Array.isArray(first.triggers));
ok('first run infers no deposit', first.depositFlow === 0);

// STOP BREAK → re-research (2026-11-02, owner "A + B"). Active held target name at/below its stop, broken
// AFTER the research that set the stop. Phase-out names are excluded (the executor exits those itself).
{
  const tgt = { asOf: '2026-10-28', names: [
    { ticker: 'NVDA', stop: 190 }, { ticker: 'GOOGL', stop: 322, phaseOut: true }, { ticker: 'MSFT', stop: 400 }, { ticker: 'META', stop: 600 }] };
  const pos = [{ symbol: 'NVDA', qty: 5 }, { symbol: 'GOOGL', qty: 1.65 }, { symbol: 'MSFT', qty: 2 }];
  const qs = { NVDA: q(185), GOOGL: q(281.87), MSFT: q(450), META: q(500) };
  const hist = { NVDA: [{ t: '2026-10-28', c: 205 }, { t: '2026-10-30', c: 195 }, { t: '2026-10-31', c: 188 }] };
  const b = stopBreaks({ target: tgt, positions: pos, quotes: qs, hist, today: '2026-11-02' });
  ok('active held name broken after the research → listed', b.length === 1 && b[0].sym === 'NVDA' && b[0].stop === 190);
  ok('phase-out name is excluded (executor exits it)', !b.some((x) => x.sym === 'GOOGL'));
  ok('name above its stop is not listed', !b.some((x) => x.sym === 'MSFT'));
  ok('a target name NOT held is not listed', !b.some((x) => x.sym === 'META'));
  // Research already saw it: every close since asOf was at/below the stop ⇒ no re-fire (no loop).
  const seen = stopBreaks({ target: { ...tgt, asOf: '2026-10-31' }, positions: pos, quotes: qs,
    hist: { NVDA: [{ t: '2026-10-31', c: 188 }] }, today: '2026-11-02' });
  ok('research dated after the break does not re-fire', !seen.some((x) => x.sym === 'NVDA'));
  ok('research dated today never re-fires the same day', stopBreaks({ target: { ...tgt, asOf: '2026-11-02' }, positions: pos, quotes: qs, hist, today: '2026-11-02' }).length === 0);
  ok('no bars since the research ⇒ assume a new break (err toward re-checking)',
    stopBreaks({ target: tgt, positions: pos, quotes: qs, hist: {}, today: '2026-11-02' }).some((x) => x.sym === 'NVDA'));
  const fr = { generatedAt: '2026-11-02T15:41:00Z', quotes: qs, hist: { day: hist }, agentic: { cash: 10, equity: 2000, positions: pos.map((p) => ({ ...p, px: 1 })), target: tgt } };
  const tr = computeAgenticTriggers(fr, fr);
  ok('computeAgenticTriggers sets refreshResearch on a stop break', tr.refreshResearch && tr.refreshReasons.some((r) => r.includes('NVDA') && r.includes('stop')));
  ok('…and carries the break list', Array.isArray(tr.stopBreaks) && tr.stopBreaks[0].sym === 'NVDA');
}

console.log(`\nagentic-triggers.test: ${pass} passed, ${fail} failed  (band=${CASH_DEPLOY_PCT}% deposit≥$${DEPOSIT_FLOOR})`);
process.exit(fail ? 1 : 0);
