// producer/preflight.mjs — the agent's FIRST step, before ANY MCP call. It decides how much work
// this run needs and prints ONE directive so the scheduled agent branches deterministically (no
// LLM judgment). The decision derives from the committed, encrypted data.json (the only state that
// survives a fresh-clone run) — not from raw/ markers, which are gitignored and empty each run.
//
// Output: first stdout line is `PREFLIGHT <MODE>`; exit code mirrors it:
//   FETCH_ALL  (exit 0)  — first run of the trading day (or no/unreadable prior): full fetch,
//                          including the heavy day/month historicals + once/day AV + picks + fundamentals.
//   FETCH_LIGHT(exit 11) — intraday/close: fetch ONLY portfolio + positions + quotes + VIX + options.
//                          History, AV macro, picks all carry forward in build-data.mjs.
//   SKIP       (exit 10) — nothing useful to do (weekend, market holiday, or today's closing
//                          snapshot already taken): the agent stops immediately, ~zero cost.
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { needsResearchRefresh } from './refresh-check.mjs';
import { decryptEnvelope } from './emit.mjs';
import { isMarketOpen, isWeekday, isHoliday, closeMinutes, etDate, etMinutes } from './market.mjs';

const DATA = join(dirname(fileURLToPath(import.meta.url)), '..', 'data.json');
// Step 2e (Predict payout emails) is EVERY-RUN, but the producer Routine's prompt (http_api — not
// editable from a session) lists only the Robinhood fetches for FETCH_LIGHT, and Gmail's tools can be
// DEFERRED in a scheduled session, so "only if Gmail is available" read as "skip". The first
// Gmail-attached run (2026-11-03 07:35 ET) skipped it. The prompt says to obey this directive, so the
// instruction lives here, in code.
export const MAIL_DIRECTIVE = 'PREFLIGHT ALSO: run PRODUCER.md step 2e (Predict payout emails) on THIS run — FETCH_LIGHT included. ' +
  'Gmail tools may be deferred: run ToolSearch "gmail search_threads get_message" first, and skip step 2e only if no Gmail tool is found. ' +
  'Best-effort: a Gmail failure never stops the run.';
function decide(mode, code, msg) {
  console.log(`PREFLIGHT ${mode}`); console.log(`[preflight] ${msg}`);
  if (mode !== 'SKIP') console.log(MAIL_DIRECTIVE);
  process.exit(code);
}

// Decrypt the prior snapshot (null on first-ever run, missing passphrase, or any decrypt failure).
let prior = null;
try {
  if (existsSync(DATA) && process.env.PF_PASSPHRASE) {
    const env = JSON.parse(readFileSync(DATA, 'utf8'));
    prior = env && env.enc ? await decryptEnvelope(env, process.env.PF_PASSPHRASE) : env;
  }
} catch { prior = null; }

const now = new Date();

// Weekend / full-closure market holiday → no trading, nothing to refresh.
if (!isWeekday(now)) decide('SKIP', 10, 'weekend — no trading session, nothing to refresh.');
if (isHoliday(now)) decide('SKIP', 10, `market holiday (${etDate(now)}) — no trading session, nothing to refresh.`);

// No usable prior snapshot → safe full fetch (never SKIP off a bad decrypt or a first run).
if (!prior || !prior.generatedAt) decide('FETCH_ALL', 0, 'no readable prior snapshot — full fetch.');

const todayET = etDate(now);
const priorET = etDate(new Date(prior.generatedAt));

// First run of a new trading day → fetch the heavy data once.
if (priorET !== todayET) decide('FETCH_ALL', 0, `first run of ${todayET} (prior snapshot ${priorET}) — full fetch incl. history.`);

// New fetch schema gets one full repair run; incomplete research gets at most one retry/day.
if (needsResearchRefresh(prior, now)) decide('FETCH_ALL', 0, 'refresh recovery: initial migration or incomplete research retry (bounded).');

// Prior snapshot is from today already, so history/AV/picks can carry forward.
if (isMarketOpen(now)) decide('FETCH_LIGHT', 11, 'intraday, market open — light fetch; history/AV/picks carry forward.');

// Market closed and today already has a snapshot: capture the closing snapshot once, then skip.
// closeMinutes() is half-day-aware (13:00 close), so a 1 PM-close snapshot counts as the close.
if (etMinutes(new Date(prior.generatedAt)) >= closeMinutes(now)) decide('SKIP', 10, 'today’s closing snapshot already captured — skip.');
decide('FETCH_LIGHT', 11, 'after close — capturing the day’s closing snapshot (light fetch).');
