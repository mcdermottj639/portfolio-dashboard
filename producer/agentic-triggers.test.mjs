// Offline unit checks for agentic-triggers.mjs — no network, no I/O. Run: node producer/agentic-triggers.test.mjs
import { computeAgenticTriggers, CASH_DEPLOY_PCT, DEPOSIT_FLOOR, GAP_REFRESH_PCT } from './agentic-triggers.mjs';

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

console.log(`\nagentic-triggers.test: ${pass} passed, ${fail} failed  (band=${CASH_DEPLOY_PCT}% deposit≥$${DEPOSIT_FLOOR})`);
process.exit(fail ? 1 : 0);
