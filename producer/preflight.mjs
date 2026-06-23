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
//   SKIP       (exit 10) — nothing useful to do (weekend, or today's closing snapshot already taken):
//                          the agent stops immediately, so a stray off-hours fire costs ~nothing.
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { decryptEnvelope } from './emit.mjs';
import { isMarketOpen, isWeekday, etDate, etMinutes } from './market.mjs';

const DATA = join(dirname(fileURLToPath(import.meta.url)), '..', 'data.json');
function decide(mode, code, msg) { console.log(`PREFLIGHT ${mode}`); console.log(`[preflight] ${msg}`); process.exit(code); }

// Decrypt the prior snapshot (null on first-ever run, missing passphrase, or any decrypt failure).
let prior = null;
try {
  if (existsSync(DATA) && process.env.PF_PASSPHRASE) {
    const env = JSON.parse(readFileSync(DATA, 'utf8'));
    prior = env && env.enc ? await decryptEnvelope(env, process.env.PF_PASSPHRASE) : env;
  }
} catch { prior = null; }

const now = new Date();

// Weekend → no trading, nothing to refresh.
if (!isWeekday(now)) decide('SKIP', 10, 'weekend — no trading session, nothing to refresh.');

// No usable prior snapshot → safe full fetch (never SKIP off a bad decrypt or a first run).
if (!prior || !prior.generatedAt) decide('FETCH_ALL', 0, 'no readable prior snapshot — full fetch.');

const todayET = etDate(now);
const priorET = etDate(new Date(prior.generatedAt));

// First run of a new trading day → fetch the heavy data once.
if (priorET !== todayET) decide('FETCH_ALL', 0, `first run of ${todayET} (prior snapshot ${priorET}) — full fetch incl. history.`);

// Prior snapshot is from today already, so history/AV/picks can carry forward.
if (isMarketOpen(now)) decide('FETCH_LIGHT', 11, 'intraday, market open — light fetch; history/AV/picks carry forward.');

// Market closed and today already has a snapshot: capture the closing snapshot once, then skip.
if (etMinutes(new Date(prior.generatedAt)) >= 960) decide('SKIP', 10, 'today’s closing snapshot already captured — skip.');
decide('FETCH_LIGHT', 11, 'after close — capturing the day’s closing snapshot (light fetch).');
