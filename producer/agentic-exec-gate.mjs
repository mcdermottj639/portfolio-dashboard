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
//     EXEC_AUTO    — fresh plan within the auto tier (turnover ≤ AUTO_TURNOVER_CAP) — create ticket + execute now
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
// planner takes `accountActivity` ({SYM:{lastBuyDate,lastSellDate}}) — since the 2026-08-12 churn
// governor the gate DOES pass it, derived from the committed agentic-decisions.json (that ledger
// records every placed rebalance, so it covers the 14d min-hold / re-entry lookback), but it still
// can't see TODAY's fills, so the EXECUTOR overlays get_equity_orders on ••••3900 live before
// placing any sell (AGENTIC.md executor step 3c).
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { isMarketOpen, etDate } from './market.mjs';
import { decryptEnvelope } from './emit.mjs';
import { planDeployment } from './agentic-deploy.mjs';
import { bookDrawdown } from './drawdown.mjs';

// The committed index-parking ledger (see producer/agentic-parked.json). Read here rather than off the
// snapshot so a park/release the executor wrote THIS session is visible on the very next pass, instead
// of waiting for the producer to rebuild data.json. Missing/garbage file → null → parking simply idle.
function readParked() {
  try {
    const f = join(dirname(fileURLToPath(import.meta.url)), 'agentic-parked.json');
    if (!existsSync(f)) return null;
    const p = JSON.parse(readFileSync(f, 'utf8'));
    // A readable ledger is AUTHORITATIVE, including zero: dollars 0 means "nothing parked" (e.g. the
    // waiting ground was reclassified into the target) and must beat the snapshot's stale copy — the
    // old `>0` test made a deliberate zero read as "no data", fall through to the snapshot, and
    // resurrect the stale parked block every pass. Fall back only when the file is missing/corrupt.
    if (!p || !Number.isFinite(+p.dollars)) return null;
    return { vehicle: p.vehicle || 'VTI', dollars: Math.max(0, +p.dollars), forNames: p.forNames || [], since: p.since || null };
  } catch { return null; }
}
import { planHash, nextAction, MIN_TURNOVER, TICKET_STALE_DAYS } from './agentic-pending.mjs';

// The canonical committed target (CLAUDE.md) — used by act() for the v121 drivers stamp and by step 2
// to override the snapshot's cached copy. Missing/unreadable → null.
function readTargetFile() {
  try {
    const f = join(dirname(fileURLToPath(import.meta.url)), 'agentic-target.json');
    if (!existsSync(f)) return null;
    const t = JSON.parse(readFileSync(f, 'utf8'));
    return (t && Array.isArray(t.names) && t.names.length) ? t : null;
  } catch { return null; }
}
import { activityFromDecisions } from './agentic-ledger.mjs';

// Churn governor (2026-08-12): the committed decisions ledger tells the planner what this account
// bought/sold recently, powering the 14d min-hold + re-entry cooldown. Missing/garbage file → {} →
// the guards simply don't bind (fail open on churn; trading itself still fails safe elsewhere).
function readActivity(asOf) {
  try {
    const f = join(dirname(fileURLToPath(import.meta.url)), 'agentic-decisions.json');
    if (!existsSync(f)) return {};
    const d = JSON.parse(readFileSync(f, 'utf8'));
    return activityFromDecisions((d && d.decisions) || [], { asOf, sinceDays: 30 });
  } catch { return {}; }
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const idle = (why) => { console.log(`EXEC_IDLE (${why})`); process.exit(30); };
const act = (mode, payload) => {
  mkdirSync(join(__dirname, 'raw'), { recursive: true });
  // `target` is written into the plan ON PURPOSE (v121): makeDecision needs it to stamp each BUY leg's
  // `drivers[]` for sleeve attribution, and that stamp cannot be backfilled. Carrying it here means the
  // executor never has to go find the committed target — and, more importantly, it does not depend on
  // the executor Routine's prompt wording, which is bound to a persistent session and cannot be edited.
  // Read from the COMMITTED file, not the snapshot's `A`: act() also fires from the in-flight-ticket
  // branch, which runs BEFORE `const A` initializes — referencing A here threw a TDZ ReferenceError on
  // the first pass with an active ticket after v121 (caught live 2026-08-25; the file is canonical anyway).
  writeFileSync(join(__dirname, 'raw', 'agentic-plan.json'), JSON.stringify({ mode, today, target: readTargetFile(), ...payload }, null, 2));
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
{ const t = readTargetFile(); if (t) A.target = t; }
if (!A.target || !Array.isArray(A.target.names) || !A.target.names.length) idle('no research target');
const ageH = data.generatedAt ? (Date.now() - Date.parse(data.generatedAt)) / 3.6e6 : Infinity;
if (ageH > 24) idle(`snapshot ${ageH.toFixed(0)}h old — too stale to trade on`);

// recentLosses spans BOTH taxable accounts since v105 (each entry tagged `account`) — a loss realized
// in the self-directed margin book blocks an agentic rebuy just the same (per-taxpayer IRS window).
const washMap = {};
for (const e of A.recentLosses || []) {
  if (!e || !e.sym || !e.date) continue;
  const until = new Date(Date.parse(e.date + 'T00:00:00Z') + 30 * 86400000).toISOString().slice(0, 10);
  if (until > today && (!washMap[e.sym] || until > washMap[e.sym].until)) washMap[e.sym] = { until, date: e.date, account: e.account || 'agentic' };
}
// BOOK-LEVEL DRAWDOWN BREAKER (v121). Computed here, from the committed snapshot's recorded equity
// series, and handed to the planner. Deposit-adjusted and memoryless by construction (drawdown.mjs), so
// the gate needs no state of its own — which matters because the executor may only ever commit
// agentic-pending / agentic-decisions / agentic-parked. Fails OPEN on a thin series.
const drawdown = bookDrawdown(A.equityHistory || []);
if (drawdown.level !== 'ok') console.error(`[exec-gate] drawdown ${drawdown.level.toUpperCase()}: ${drawdown.note}`);

const plan = planDeployment({
  target: A.target, positions: A.positions, cash: A.cash || 0, quotes: data.quotes || {},
  washMap, parked: readParked() || A.parked || null, drawdown, vix: data.vix || null,
  // Churn governor: recent buys/sells from the committed decisions ledger drive the min-hold and
  // re-entry cooldown. The executor OVERLAYS today's live fills (get_equity_orders) on top — the
  // ledger can't see an order placed since its last append (AGENTIC.md executor step 3c).
  accountActivity: readActivity(today),
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
