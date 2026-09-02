// producer/agentic-confirm.mjs — the OWNER's confirm, as one command (2026-09-02).
//
// The dashboard, the push notifications and AGENTIC.md all promised a "one-tap confirm" for an
// above-auto-cap rebalance. There was no tap: the only way to move a ticket out of `proposed` was to
// open a Claude session and type at it, which is a round trip, needs the connectors, and is exactly
// the "constant back and forth" the owner was complaining about. The state machine itself is one
// field — `agentic-pending.json`'s `status` — so the confirm is a 200-line CLI, not a product.
//
//   node producer/agentic-confirm.mjs <ticket-id|latest> [--abort] [--note "…"] [--commit]
//
// It moves `proposed → confirmed` (or `→ aborted` with --abort) through `advanceTicket`, so an illegal
// transition throws here exactly as it would in the executor — this is a second front door onto the
// same machine, never a second machine. It places NOTHING and touches no broker: the next executor
// pass reads the confirmed ticket and places it (AGENTIC.md §executor step 3). The ticket must be
// pushed to `main` to be seen, since the executor runs from a fresh clone of origin/main — hence
// --commit, and hence the printed git commands when it is omitted.
//
// The other confirm path is unchanged and still fine: tell any Claude session "confirm the pending
// rebalance". This one just doesn't need one.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { advanceTicket } from './agentic-pending.mjs';
import { etDate } from './market.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── the pure half (unit-tested in agentic-confirm.test.mjs) ─────────────────────────────────────────
// Throws with a plain-English reason rather than returning a flag: every caller here is a human at a
// terminal, and a ticket in the wrong state is a stop, not a branch.
export function confirmTicket(ticket, { abort = false, note = null, today = null } = {}) {
  if (!ticket || !ticket.status) throw new Error('no ticket to confirm (agentic-pending.json is missing or malformed)');
  const to = abort ? 'aborted' : 'confirmed';
  if (ticket.status !== 'proposed') {
    // Deliberately specific about the two common cases, because they mean opposite things: an already
    // -confirmed ticket is waiting on the executor (do nothing), a done/aborted one is history (the
    // gate will plan a fresh one).
    const why = ticket.status === to ? `already ${to}`
      : ['done', 'aborted'].includes(ticket.status) ? `already ${ticket.status} — this ticket is finished`
      : `status is \`${ticket.status}\`, not \`proposed\` — it is already in flight with the executor`;
    throw new Error(`ticket ${ticket.id || '(no id)'} cannot be ${to}: ${why}`);
  }
  const next = advanceTicket(ticket, to, { date: today || etDate() });
  // The note is owner editorial, so it rides on the ticket rather than replacing anything the planner
  // wrote; the executor copies the ticket's rationale into the decisions ledger on execution.
  return note ? { ...next, ownerNote: String(note) } : next;
}

// ── CLI ─────────────────────────────────────────────────────────────────────────────────────────────
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const die = (msg) => { console.error(`✗ ${msg}`); process.exit(1); };
  // One left-to-right pass: `--note`/`--file` consume the next token, everything else that isn't a flag
  // is the ticket id. (An indexOf-based parser mis-reads `--note latest`.)
  const argv = process.argv.slice(2);
  const opts = { note: null, file: null }; let abort = false, commit = false, want = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--abort') abort = true;
    else if (a === '--commit') commit = true;
    else if (a === '--note') opts.note = argv[++i] ?? null;
    else if (a === '--file') opts.file = argv[++i] ?? null;
    else if (a.startsWith('--')) die(`unknown flag ${a}`);
    else if (want == null) want = a;
    else die(`unexpected argument \`${a}\` (one ticket id only)`);
  }
  if (!want) die('usage: node producer/agentic-confirm.mjs <ticket-id|latest> [--abort] [--note "…"] [--commit]');

  // --file / PF_PENDING_FILE exist so the tests (and a dry run) can drive the CLI without ever
  // touching the real committed ticket.
  const file = opts.file || process.env.PF_PENDING_FILE || join(__dirname, 'agentic-pending.json');
  if (!existsSync(file)) die(`no pending ticket at ${file} — nothing to confirm (the gate writes one on EXEC_PROPOSE)`);

  let ticket;
  try { ticket = JSON.parse(readFileSync(file, 'utf8')); } catch (e) { die(`could not read ${file}: ${e.message}`); }

  if (want !== 'latest' && ticket.id !== want) {
    die(`ticket id mismatch: the pending ticket is \`${ticket.id}\`, you asked for \`${want}\`. `
      + 'Re-read the push notification, or pass `latest` to confirm whatever is outstanding.');
  }

  let next;
  try { next = confirmTicket(ticket, { abort, note: opts.note }); } catch (e) { die(e.message); }

  writeFileSync(file, JSON.stringify(next, null, 2) + '\n');

  const side = (arr, s) => (arr || []).map((l) => `${s} ${l.sym} $${l.dollars}`);
  const summary = [...side(next.legs?.sells, 'SELL'), ...side(next.legs?.buysNow, 'BUY'), ...side(next.legs?.buysT1, 'BUY')].join(' · ');
  console.log(`${abort ? '🛑' : '✅'} ticket ${next.id}: proposed → ${next.status}`);
  console.log(`   turnover $${next.turnover} on a $${next.book} book${summary ? `\n   ${summary}` : ''}`);
  if (next.ownerNote) console.log(`   note: ${next.ownerNote}`);
  if ((next.blockedSells || []).length) {
    console.log(`   ⏸ ${next.blockedSells.length} sell(s) held back by a guard: `
      + next.blockedSells.map((b) => `${b.sym} (${b.blocked}${b.until ? ` to ${b.until}` : ''})`).join(', '));
  }

  const msg = `agentic: owner ${abort ? 'aborted' : 'confirmed'} ${next.id}`;
  const gitArgs = [['add', file], ['commit', '-m', msg], ['push', 'origin', 'HEAD:main']];
  if (commit) {
    // spawnSync with an ARGUMENT ARRAY, never a shell string — `--note` is owner text and the ticket id
    // comes off disk; neither is ever handed to a shell to re-parse.
    for (const args of gitArgs) {
      const r = spawnSync('git', args, { cwd: join(__dirname, '..'), stdio: 'inherit' });
      if (r.status !== 0) die(`git ${args[0]} failed (exit ${r.status}) — the ticket file is already updated; finish the push by hand.`);
    }
    console.log(abort ? '\nPushed. The next executor pass will plan afresh.'
      : '\nPushed. The next executor pass (hourly, market hours) places it.');
  } else {
    console.log('\nNext step — the executor runs from a fresh clone of origin/main, so this must be pushed:');
    console.log(`  git add ${file.replace(join(__dirname, '..') + '/', '')} && git commit -m "${msg}" && git push origin HEAD:main`);
    console.log('  (or re-run this command with --commit)');
    if (!abort) console.log('The next executor pass then places it — nothing else to do.');
  }
}
