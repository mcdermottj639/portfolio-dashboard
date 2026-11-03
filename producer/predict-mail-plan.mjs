#!/usr/bin/env node
// Mailbox planner for the private Predict Settled ledger (like hist-plan.mjs: it PRINTS what to
// fetch and calls nothing). The producer agent then runs, if a Gmail connector is present:
//   Gmail · search_threads { query: <QUERY>, pageSize: 50, view: "THREAD_VIEW_METADATA_ONLY" }
//     -> Write verbatim to producer/raw/predict-mail-search.json
//   Gmail · get_message { messageId: <id>, messageFormat: "PLAIN_TEXT" } for every message id in
//     that result that is NOT listed under KNOWN -> Write verbatim to raw/predict-mail-<id>.json
// Fails OPEN toward reading: no snapshot / no passphrase => the 120-day first-read window and no
// known ids. That only costs extra get_message calls; the ledger merge is idempotent by message id.
// Prints message ids (needed to skip) but never an amount, contract name or quantity.
import { readSnapshot } from './fetchgate.mjs';
import { mailPlan } from './prediction-settlements.mjs';

const snap = await readSnapshot();
const plan = mailPlan(snap?.predictionSettlements || null);
console.log('PREDICT_MAIL QUERY ' + plan.query);
console.log('PREDICT_MAIL KNOWN ' + (plan.known.length ? plan.known.join(' ') : '(none)'));
if (!snap) console.log('  note: no readable snapshot — using the first-read window; every match will be fetched.');
