// producer/agentic-exec-gate.mjs — deterministic gate for the AGENTIC EXECUTOR (v96).
//
// The executor is a scheduled Claude session (hourly during market hours — see AGENTIC.md §executor)
// whose job is to keep ••••3900 on target WITHOUT the owner having to notice drift himself. Like
// preflight.mjs, this gate makes the unattended run cheap and deterministic: it decides everything
// that can be decided from committed state, prints one MODE line, and exits — the agent only spends
// tokens (and Robinhood MCP calls) when there is genuinely something to do.
//
//   exit 0  → actionable, mode on stdout:
//     EXEC_TRADE   — an active ticket says place its sells + buys today (confirmed, or auto tier)
//     EXEC_BUYS    — an active ticket's carried buy leg is due (sells placed) — place those buys
//     EXEC_AUTO    — fresh plan within the auto tier (turnover ≤ $500) — create ticket + execute now
//     EXEC_PROPOSE — fresh plan above the auto tier — write ticket (proposed) + push for one-tap confirm
//   exit 30 → EXEC_IDLE (nothing actionable / market closed / kill switch / stale or missing snapshot)
//
// Trading fails SAFE (the opposite of fetchgate's fail-open): no snapshot, no passphrase, decrypt
// failure, stale snapshot → IDLE. One skipped fetch is cheaper than a starved snapshot; one skipped
// TRADE is cheaper than a wrong one.
//
// Writes producer/raw/agentic-plan.json = { mode, today, plan, ticket } for the executor agent.
// NOTE: the gate's plan has NO earnings map (parsing the recorded AV calendar here isn't worth the
// fragility) — the EXECUTOR must check get_earnings_calendar live before placing buys and drop any
// name reporting ≤7d (AGENTIC.md executor step 3), and get_equity_orders on the MARGIN account before
// any loss-sale (cross-account wash). The plan is the map; live checks are the territory.
//
// Same split for the v98 PDT guard: ••••3900 is a LIMITED MARGIN account since 2026-08-11, so a
// same-day round trip books a day trade and 4 in 5 business days restricts a sub-$25k account. The
// planner takes `accountActivity` ({SYM:{lastBuyDate}}) and refuses to sell anything bought today —
// but the gate can't see today's fills either (the snapshot is up to an hour stale and carries no
// order history), so it passes NONE and the EXECUTOR supplies it live from get_equity_orders on
// ••••3900 before placing any sell (AGENTIC.md executor step 3c).
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { isMarketOpen, etDate } from './market.mjs';
import { decryptEnvelope } from './emit.mjs';
import { planDeployment } from './agentic-deploy.mjs';

// The committed index-parking ledger (see producer/agentic-parked.json). Read here rather than off the
// snapshot so a park/release the executor wrote THIS session is visible on the very next pass, instead
// of waiting for the producer to rebuild data.json. Missing/garbage file → null → parking simply idle.
function readParked() {
  try {
    const f = join(dirname(fileURLToPath(import.meta.url)), 'agentic-parked.json');
    if (!existsSync(f)) return null;
    const p = JSON.parse(readFileSync(f, 'utf8'));
    return (p && +p.dollars > 0) ? { vehicle: p.vehicle || 'VTI', dollars: +p.dollars, forNames: p.forNames || [], since: p.since || null } : null;
  } catch { return null; }
}
import { planHash, nextAction, MIN_TURNOVER, TICKET_STALE_DAYS } from './agentic-pending.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const idle = (why) => { console.log(`EXEC_IDLE (${why})`); process.exit(30); };
const act = (mode, payload) => {
  mkdirSync(join(__dirname, 'raw'), { recursive: true });
  writeFileSync(join(__dirname, 'raw', 'agentic-plan.json'), JSON.stringify({ mode, today, ...payload }, null, 2));
  console.log(`${mode} (${payload.reason || ''})`);
  process.exit(0);
};

const today = etDate();
if (String(process.env.PF_AGENTIC_AUTO || '').toLowerCase() === 'off') idle('kill switch: PF_AGENTIC_AUTO=off');

// ── 1. an in-flight ticket owns the run ─────────────────────────────────────────────────────────────
let ticket = null;
try { const f = join(__dirname, 'agentic-pending.json'); if (existsSync(f)) ticket = JSON.parse(readFileSync(f, 'utf8')); } catch { ticket = null; }
if (ticket && !['done', 'aborted'].includes(ticket.status)) {
  const na = nextAction(ticket, today);
  if (na.action === 'place-trades') { if (!isMarketOpen()) idle(`ticket ready but market closed — place at the open`); act('EXEC_TRADE', { reason: na.reason, ticket }); }
  if (na.action === 'place-buys') { if (!isMarketOpen()) idle(`carried buys due but market closed`); act('EXEC_BUYS', { reason: na.reason, ticket }); }
  if (na.action === 'await-confirm') idle(`proposal outstanding (${ticket.id}) — waiting for owner confirm`);
  if (na.action === 'none') idle(na.reason);
  // 'stale' falls through: re-plan below; the agent aborts the stale ticket when it writes the new one.
}

// ── 2. no active ticket — plan fresh from the committed snapshot ────────────────────────────────────
const pass = process.env.PF_PASSPHRASE;
if (!pass) idle('no PF_PASSPHRASE — cannot read the snapshot (trading fails safe)');
let data;
try { data = await decryptEnvelope(JSON.parse(readFileSync(join(__dirname, '..', 'data.json'), 'utf8')), pass); }
catch { idle('snapshot unreadable — fail safe'); }
const A = data && data.agentic;
if (!A || !Array.isArray(A.positions)) idle('no agentic block in the snapshot');
// The COMMITTED producer/agentic-target.json is the canonical target (CLAUDE.md); the snapshot's copy
// is a cache stamped in by the last producer run. Prefer the file so a target promoted between producer
// runs (e.g. an evening research refresh) reaches the very next executor pass instead of trading a
// stale cache — and so a failed producer run can't leave the executor deploying against last week's book.
try {
  const tf = join(__dirname, 'agentic-target.json');
  if (existsSync(tf)) {
    const t = JSON.parse(readFileSync(tf, 'utf8'));
    if (t && Array.isArray(t.names) && t.names.length) A.target = t;
  }
} catch { /* unreadable file → fall back to the snapshot's cached copy */ }
if (!A.target || !Array.isArray(A.target.names) || !A.target.names.length) idle('no research target');
const ageH = data.generatedAt ? (Date.now() - Date.parse(data.generatedAt)) / 3.6e6 : Infinity;
if (ageH > 24) idle(`snapshot ${ageH.toFixed(0)}h old — too stale to trade on`);

const washMap = {};
for (const e of A.recentLosses || []) {
  if (!e || !e.sym || !e.date) continue;
  const until = new Date(Date.parse(e.date + 'T00:00:00Z') + 30 * 86400000).toISOString().slice(0, 10);
  if (until > today && (!washMap[e.sym] || until > washMap[e.sym].until)) washMap[e.sym] = { until, date: e.date };
}
const plan = planDeployment({
  target: A.target, positions: A.positions, cash: A.cash || 0, quotes: data.quotes || {},
  washMap, parked: readParked() || A.parked || null,
  // v102: the idle clock rides in the snapshot; the parking ledger is read from the COMMITTED file so
  // the gate sees a park/release the executor wrote this session, before the next producer run.
  opts: { asOf: today, cashIdleDays: A.cashIdleDays ?? null },
});

if (!(plan.turnover >= MIN_TURNOVER)) idle(`plan turnover $${plan.turnover} < $${MIN_TURNOVER} — nothing worth a ticket`);
if (ticket && ticket.status === 'proposed' && ticket.planHash === planHash(plan) && nextAction(ticket, today).action === 'await-confirm')
  idle('identical proposal already outstanding — not re-nagging');

if (plan.autoEligible) {
  if (!isMarketOpen()) idle('auto-tier plan ready but market closed — act at the open');
  act('EXEC_AUTO', { reason: `turnover $${plan.turnover} ≤ auto cap — execute unattended`, plan, staleTicket: ticket && !['done', 'aborted'].includes(ticket.status) ? ticket.id : null });
}
act('EXEC_PROPOSE', { reason: `turnover $${plan.turnover} above auto cap — owner one-tap required`, plan, staleTicket: ticket && !['done', 'aborted'].includes(ticket.status) ? ticket.id : null });
