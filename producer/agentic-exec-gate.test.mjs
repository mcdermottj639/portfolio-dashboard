// producer/agentic-exec-gate.test.mjs
//
// Pins the EXEC_IDLE classification (2026-09-08). The gate's fatal branches cannot be reached from a
// test at an arbitrary time of day — the market-hours check is hoisted above all of them on purpose
// — and stubbing the clock would mean adding a test-only override to a gate that places real trades,
// which is a worse trade than testing the policy directly.
//
// So this asserts the POLICY, over the gate's own source: every idle reason that CANNOT clear itself
// is marked `idleDegraded` (which prints the `[DEGRADED]` marker the Routine turns into a push), and
// every reason that resolves on its own stays a plain `idle`. That is exactly the property that can
// silently regress — someone adds a new fatal early-exit, reaches for the nearby `idle(...)`, and the
// account stops trading with no signal anywhere. A grep-shaped test catches a grep-shaped mistake.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const SRC = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'agentic-exec-gate.mjs'), 'utf8');

let pass = 0, fail = 0;
const eq = (label, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) { pass++; console.log(`  ok  ${label}`); }
  else { fail++; console.log(`  FAIL ${label}\n       got  ${JSON.stringify(got)}\n       want ${JSON.stringify(want)}`); }
};

console.log('agentic-exec-gate — idle classification');

// The call line for a given reason substring (excluding the doc comments at the top of the file).
const lineFor = (needle) => SRC.split('\n').find(
  (l) => l.includes(needle) && /\bidle(Degraded)?\(/.test(l) && !l.trim().startsWith('//'));

// Reasons that will STILL BE TRUE on the next fire, and the one after that: the loop is broken and
// waiting cannot fix it. Each must reach the owner's phone.
const FATAL = [
  'no PF_PASSPHRASE',                    // can never read the snapshot ⇒ can never trade
  'snapshot unreadable',                 // same, by a different route
  'no agentic block in the snapshot',    // the producer's ••••3900 fetch is broken
  'no research target',                  // the weekly research Routine has stopped landing
  'too stale to trade on',               // the producer has stopped publishing
  'fails the agentic identity check',    // the wrong-account payload — the $61,962-ticket bug
];

// Reasons that clear themselves within hours. These must stay SILENT or the owner is trained to
// ignore the notification, which costs more than it buys.
const SELF_CLEARING = [
  'market closed',
  'proposal outstanding',
  'predates ticket',
  'nothing worth a ticket',
  'kill switch',                         // deliberate: the owner set it
];

for (const r of FATAL) {
  const l = lineFor(r);
  eq(`FATAL is degraded: ${r}`, !!(l && l.includes('idleDegraded(')), true);
}
for (const r of SELF_CLEARING) {
  const l = lineFor(r);
  eq(`self-clearing stays silent: ${r}`, !!(l && /[^a-zA-Z]idle\(/.test(l) && !l.includes('idleDegraded(')), true);
}

// The marker itself, and the exit code contract both helpers share.
eq('the DEGRADED marker is exactly what the prompt greps for', /EXEC_IDLE \[DEGRADED\] \(/.test(SRC), true);
eq('a plain idle carries no marker',
  /const idle = \(why\) => \{ console\.log\(`EXEC_IDLE \(\$\{why\}\)`\)/.test(SRC), true);
eq('both idle helpers exit 30', (SRC.match(/EXEC_IDLE[^\n]*process\.exit\(30\)/g) || []).length, 2);

// One plain idle() carries a DYNAMIC reason and so has no literal to grep: `idle(na.reason)`, the
// in-flight-ticket passthrough. It is correctly NOT degraded — its enclosing block only runs for a
// live ticket (done/aborted are excluded by the guard above it), so the reachable reasons are
// "no carried buy leg" and an unexpected ticket.status. Both are statements about ONE ticket, not
// about the system's ability to trade, and the next producer snapshot or ticket advance clears them.
eq('the dynamic ticket-state idle exists and is not degraded',
  /if \(na\.action === 'none'\) idle\(na\.reason\);/.test(SRC), true);

// Nothing may quietly bypass the classification: if someone adds a new early-exit, this count moves
// and they have to come here and classify it. That is the entire point of the test.
const rawIdleCalls = SRC.split('\n').filter(
  (l) => /(?:^|[^a-zA-Z])idle\(/.test(l) && !l.trim().startsWith('//') && !l.includes('const idle ='));
eq('every plain idle() call is accounted for above', rawIdleCalls.length, SELF_CLEARING.length + 1);

console.log(`\nagentic-exec-gate: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
