// Offline unit checks for alerts.mjs level-crossing detection — no network, no I/O.
// Run: node producer/alerts.test.mjs
import { computeAlerts, DAY_MOVE_PCT } from './alerts.mjs';

let pass = 0, fail = 0;
const eq = (label, got, want) => { const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.error(`✗ ${label}\n    got  ${g}\n    want ${w}`); } };

const q = (last, prev) => ({ last_trade_price: String(last), adjusted_previous_close: String(prev) });
const snap = (quotes, extra = {}) => ({ quotes, ...extra });
const agentic = (positions, names) => ({ agentic: { positions, target: { names } } });
const kinds = (a) => a.map((x) => x.kind + ':' + x.symbol);

// --- agentic stop/target crossings ---
const tgtNames = [{ ticker: 'NVDA', stop: 178, target: 230 }];
const nvdaPos = [{ symbol: 'NVDA', qty: 1, avgCost: 190, px: 0 }];
eq('agentic stop fires on the crossing run',
  kinds(computeAlerts(snap({ NVDA: q(180, 181) }), snap({ NVDA: q(177, 181) }, agentic(nvdaPos, tgtNames)))),
  ['agentic-stop:NVDA']);
eq('no re-fire once already below the stop',
  kinds(computeAlerts(snap({ NVDA: q(177, 181) }), snap({ NVDA: q(175, 181) }, agentic(nvdaPos, tgtNames)))),
  []);
eq('agentic target fires crossing up',
  kinds(computeAlerts(snap({ NVDA: q(228, 220) }), snap({ NVDA: q(231, 220) }, agentic(nvdaPos, tgtNames)))),
  ['agentic-target:NVDA']);
eq('no alert for a holding with no target entry',
  kinds(computeAlerts(snap({ XYZ: q(50, 60) }), snap({ XYZ: q(40, 60) }, agentic([{ symbol: 'XYZ' }], tgtNames)))),
  []);
eq('no alert without a prior price (first appearance)',
  kinds(computeAlerts(snap({}), snap({ NVDA: q(150, 181) }, agentic(nvdaPos, tgtNames)))),
  []);

// --- pick bracket crossings (stop wins over tp when a gap crosses several levels) ---
const picks = { picks: [{ ticker: 'AAA', sl: { price: 90.9 }, tp1: { price: 110 }, tp2: { price: 118 } }] };
eq('pick tp1 crossing',
  kinds(computeAlerts(snap({ AAA: q(108, 100) }), snap({ AAA: q(111, 100) }, { picks }))),
  ['pick-tp1:AAA']);
eq('pick tp2 outranks tp1 when both cross in one gap',
  kinds(computeAlerts(snap({ AAA: q(108, 100) }), snap({ AAA: q(120, 100) }, { picks }))),
  ['pick-tp2:AAA']);
eq('pick stop crossing',
  kinds(computeAlerts(snap({ AAA: q(95, 100) }), snap({ AAA: q(90, 100) }, { picks }))),
  ['pick-stop:AAA']);
eq('pick inside its bracket → quiet',
  kinds(computeAlerts(snap({ AAA: q(100, 100) }), snap({ AAA: q(105, 100) }, { picks }))),
  []);

// --- held-name day-move crossing ±DAY_MOVE_PCT ---
eq('DAY_MOVE_PCT is 7', DAY_MOVE_PCT, 7);
eq('day-move fires when crossing +7%',
  kinds(computeAlerts(snap({ TSM: q(104, 100) }), snap({ TSM: q(109, 100) }), ['TSM'])),
  ['day-move:TSM']);
eq('day-move fires crossing −7%',
  kinds(computeAlerts(snap({ TSM: q(98, 100) }), snap({ TSM: q(92, 100) }), ['TSM'])),
  ['day-move:TSM']);
eq('no re-fire while it stays beyond 7%',
  kinds(computeAlerts(snap({ TSM: q(109, 100) }), snap({ TSM: q(112, 100) }), ['TSM'])),
  []);
eq('non-held symbols ignored',
  kinds(computeAlerts(snap({ TSM: q(104, 100) }), snap({ TSM: q(112, 100) }), [])),
  []);

// --- degenerate inputs ---
eq('no prior snapshot → no alerts', computeAlerts(null, snap({ AAA: q(1, 1) })), []);
eq('no fresh snapshot → no alerts', computeAlerts(snap({}), null), []);
eq('messages are human-readable strings',
  computeAlerts(snap({ TSM: q(104, 100) }), snap({ TSM: q(109, 100) }), ['TSM'])[0].msg.includes('TSM'), true);

console.log(fail ? `\n${fail} FAILED (${pass} passed)` : `all ${pass} checks passed ✅`);
process.exit(fail ? 1 : 0);
