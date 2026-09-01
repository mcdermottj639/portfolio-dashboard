/* ONE-OFF REPAIR — the phantom cumFlow left by the 2026-08-31 19:44Z account-swap run.
 *
 * Run:  node producer/repair-cumflow-2026-08-31.mjs           # dry run, prints the diff
 *       node producer/repair-cumflow-2026-08-31.mjs --write    # rewrites + re-encrypts data.json
 * Then: node producer/validate.mjs   and commit data.json.
 *
 * WHAT HAPPENED. The 19:44Z run published ••••0741's positions into `data.agentic` and ••••3900's
 * into `data.main` — the two get_equity_positions calls were made with the account numbers the wrong
 * way round. Each account's cash and totals were still correct, which is why nothing downstream
 * noticed. The deposit inference saw each book replaced wholesale and booked equal-and-opposite
 * phantom transfers of ±$20k. The 20:42Z run fetched both correctly, and because the positions
 * swapped BACK it booked the mirror image, which very nearly cancelled:
 *
 *     agentic cumFlow  7,950.75 -> 28,218.50 -> 7,961.68     (+10.93 survives)
 *     main    cumFlow      0.00 -> -20,247.65 ->   136.70    (+136.70 survives)
 *
 * What survives is the difference between the two runs' price moves. The owner confirmed no
 * transfers touched either account in that window.
 *
 * WHY IT MATTERS. The consumer's return is deposit-IMMUNE by construction, so a phantom deposit
 * silently DELETES real return — it does not merely mislabel it. Measured on the committed series:
 * ••••0741's headline reads -2.86% against a true -2.16% (0.71pp of loss that never happened), and
 * ••••3900 loses ~0.09pp at the step, ~0.34pp on the headline once it compounds.
 *
 * WHY IT HAD TO BE REPAIRED BY HAND. `appendEquityPoint` reads `priorCum` from the point it is
 * REPLACING (equityseries.mjs), so a same-day rebuild inherits the bad total rather than recomputing
 * it — the error becomes the baseline for every future point and no producer run will ever shed it.
 * cumFlow is a RUNNING total, so the phantom must come off the offending point AND every point after
 * it, not just the last one.
 *
 * ORDERING. Apply this on top of the newest published snapshot, not before one. The producer
 * rebuilds today's point from the committed snapshot, so a repair written while a run is in flight is
 * clobbered by it; a repair written after one propagates forward.
 *
 * The root cause is fixed separately: snapshotsanity.mjs (`accountsLookSwapped`) has aborted the
 * publish on a transposed pair since 2026-08-31 20:47Z, so this cannot recur. This script is kept
 * as the record of the correction, and refuses to run against anything but the exact state it was
 * written for.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { encryptEnvelope, decryptEnvelope } from './emit.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FILE = join(__dirname, '..', 'data.json');
const WRITE = process.argv.includes('--write');

const FROM = '2026-08-31';                              // first point carrying the phantom
const PHANTOM   = { agentic: 10.93, main: 136.70 };     // what to subtract
const EXPECT_AT = { agentic: 7961.68, main: 136.70 };   // what FROM must currently hold
const EXPECT_TO = { agentic: 7950.75, main: 0 };        // what FROM must hold afterwards

const pass = process.env.PF_PASSPHRASE;
if (!pass) { console.error('PF_PASSPHRASE not set.'); process.exit(1); }

const raw = JSON.parse(readFileSync(FILE, 'utf8'));
if (!(raw.ct || raw.enc)) {
  console.error('REFUSING: data.json on disk is plaintext (a dry-run build?). Restore it first:');
  console.error('  git checkout origin/main -- data.json');
  process.exit(1);
}
const d = await decryptEnvelope(raw, pass);

let changed = 0;
for (const acct of ['agentic', 'main']) {
  const eh = d?.[acct]?.equityHistory;
  if (!Array.isArray(eh) || !eh.length) { console.error(`${acct}: no equityHistory — aborting.`); process.exit(1); }
  const at = eh.find((p) => p.t === FROM);
  if (!at) { console.error(`${acct}: no point dated ${FROM} — aborting.`); process.exit(1); }
  if (Math.abs((at.cumFlow ?? 0) - EXPECT_AT[acct]) > 0.005) {
    console.error(`${acct}: ${FROM} cumFlow is ${at.cumFlow}, expected ${EXPECT_AT[acct]}.`);
    console.error('  Already repaired, or the series moved on. Aborting rather than guessing.');
    process.exit(1);
  }
  for (const p of eh) {
    if (p.t < FROM || typeof p.cumFlow !== 'number') continue;
    const before = p.cumFlow;
    p.cumFlow = +(p.cumFlow - PHANTOM[acct]).toFixed(2);
    console.log(`  ${acct} ${p.t}: cumFlow ${before} -> ${p.cumFlow}`);
    changed++;
  }
  const after = eh.find((p) => p.t === FROM).cumFlow;
  if (Math.abs(after - EXPECT_TO[acct]) > 0.005) {
    console.error(`${acct}: post-repair ${FROM} cumFlow is ${after}, expected ${EXPECT_TO[acct]} — aborting.`);
    process.exit(1);
  }
}
console.log(`\n${changed} point(s) corrected.`);

if (!WRITE) { console.log('DRY RUN — nothing written. Re-run with --write.'); process.exit(0); }

const env = await encryptEnvelope(JSON.stringify(d), pass);
if (!(env && (env.ct || env.enc))) { console.error('REFUSING: encryptEnvelope returned no envelope.'); process.exit(1); }
const out = JSON.stringify(env);
// Belt and braces: run.mjs refuses to push plaintext, and so does this.
if (/"equityHistory"|"positions"|"generatedAt"/.test(out)) { console.error('REFUSING: output looks like plaintext.'); process.exit(1); }
writeFileSync(FILE, out);
console.log('data.json rewritten (encrypted). Now run: node producer/validate.mjs');
