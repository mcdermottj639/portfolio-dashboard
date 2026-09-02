// Offline unit checks for agentic-confirm.mjs — no network, no broker, and NEVER the real committed
// producer/agentic-pending.json (the CLI path runs against a temp file via --file).
// Run: node producer/agentic-confirm.test.mjs
import { confirmTicket } from './agentic-confirm.mjs';
import { makeTicket, advanceTicket } from './agentic-pending.mjs';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
let pass = 0, fail = 0;
const ok = (label, cond) => { if (cond) pass++; else { fail++; console.error(`✗ ${label}`); } };
const throws = (fn) => { try { fn(); return null; } catch (e) { return e.message; } };

const plan = {
  book: 11474, turnover: 908, autoEligible: false,
  sells: [{ sym: 'VTI', kind: 'park-release', dollars: 453.8, shares: 1.2, price: 375.15, pl: -3.28, note: 'release parked placeholder' }],
  buys: [{ sym: 'MA', dollars: 237.34, shares: 0.4, price: 581.23 }, { sym: 'V', dollars: 217.36, shares: 0.58, price: 372.74 }],
  buysT1: [],
  taxSummary: { realizedGain: 0, realizedLoss: -3.28, net: -3.28, term: 'short' },
  deferred: [{ sym: 'NVDA', reason: 'wash-sale', until: '2026-09-10' }],
  blockedSells: [{ sym: 'GE', kind: 'exit', blocked: 'min-hold', dollars: 300, until: '2026-09-05', heldDays: 13 }],
  warnings: ['entry zones are advisory (target 8d old)'],
};
const proposed = makeTicket(plan, { asOf: '2026-09-02' });

// ── the pure half ──
const conf = confirmTicket(proposed, { today: '2026-09-02' });
ok('proposed → confirmed', conf.status === 'confirmed');
ok('the transition is dated + recorded in history', conf.confirmedAt === '2026-09-02'
  && conf.history.map((h) => h.to).join('>') === 'proposed>confirmed');
ok('the ticket is otherwise untouched (legs/blockedSells/warnings survive the hop)',
  conf.legs.buysNow.length === 2 && conf.blockedSells[0].sym === 'GE' && conf.warnings.length === 1
  && conf.id === proposed.id && conf.planHash === proposed.planHash);
ok('the input ticket is not mutated', proposed.status === 'proposed');

const aborted = confirmTicket(proposed, { abort: true, today: '2026-09-02' });
ok('--abort → aborted', aborted.status === 'aborted' && aborted.abortedAt === '2026-09-02');

const noted = confirmTicket(proposed, { note: 'skipping V, already own enough payments', today: '2026-09-02' });
ok('an owner note rides on the ticket', noted.ownerNote === 'skipping V, already own enough payments');
ok('no note ⇒ no empty field', !('ownerNote' in conf));

// ── refusals: anything not `proposed` is a stop, with a reason that says which case it is ──
ok('no ticket at all is refused', /no ticket to confirm/.test(throws(() => confirmTicket(null, {}))));
ok('an already-confirmed ticket is refused as already confirmed',
  /already confirmed/.test(throws(() => confirmTicket(conf, { today: '2026-09-02' }))));
const done = advanceTicket(advanceTicket(advanceTicket(conf, 'sells-placed'), 'buys-placed'), 'done');
ok('a finished ticket is refused as history', /already done — this ticket is finished/.test(
  throws(() => confirmTicket(done, { today: '2026-09-02' }))));
ok('an in-flight ticket names the executor, not a state code', /already in flight with the executor/.test(
  throws(() => confirmTicket(advanceTicket(conf, 'sells-placed'), { today: '2026-09-02' }))));
ok('aborting a finished ticket is refused too', throws(() => confirmTicket(done, { abort: true })) !== null);

// ── the CLI, driven against a TEMP file (never the committed ticket) ──
const dir = mkdtempSync(join(tmpdir(), 'pf-confirm-'));
const tmp = join(dir, 'agentic-pending.json');
const cli = (args) => spawnSync(process.execPath, [join(__dirname, 'agentic-confirm.mjs'), ...args],
  { encoding: 'utf8', cwd: __dirname });
const reset = () => writeFileSync(tmp, JSON.stringify(proposed, null, 2) + '\n');

reset();
let r = cli([proposed.id, '--file', tmp]);
ok('CLI confirms by id and exits 0', r.status === 0 && /proposed → confirmed/.test(r.stdout));
ok('CLI wrote the new status back to the file', JSON.parse(readFileSync(tmp, 'utf8')).status === 'confirmed');
ok('CLI prints the exact git commands (the executor reads origin/main, so it must be pushed)',
  /git add /.test(r.stdout) && /git push origin HEAD:main/.test(r.stdout));
ok('CLI does not commit without --commit', !/\[.* .*\]/.test(r.stderr || ''));

r = cli([proposed.id, '--file', tmp]);
ok('re-confirming the same ticket is refused, non-zero', r.status !== 0 && /already confirmed/.test(r.stderr));

reset();
r = cli(['latest', '--file', tmp, '--abort', '--note', 'not today']);
ok('`latest` matches whatever is outstanding, and --abort/--note work', r.status === 0
  && /proposed → aborted/.test(r.stdout) && /not today/.test(r.stdout));
ok('the note reached the file', JSON.parse(readFileSync(tmp, 'utf8')).ownerNote === 'not today');

reset();
r = cli(['2026-01-01-nope', '--file', tmp]);
ok('a mismatched id is refused before anything is written', r.status !== 0 && /id mismatch/.test(r.stderr)
  && JSON.parse(readFileSync(tmp, 'utf8')).status === 'proposed');

r = cli(['--file', tmp]);
ok('no ticket id → usage, non-zero', r.status !== 0 && /usage:/.test(r.stderr));

r = cli(['latest', '--file', join(dir, 'absent.json')]);
ok('a missing pending file is a clear message, not a stack trace', r.status !== 0 && /no pending ticket/.test(r.stderr));

// `--note latest` must not be mistaken for the ticket id (the indexOf-parser bug this guards).
reset();
r = cli(['latest', '--file', tmp, '--note', 'latest']);
ok('a flag value is never read as the ticket id', r.status === 0
  && JSON.parse(readFileSync(tmp, 'utf8')).ownerNote === 'latest');

rmSync(dir, { recursive: true, force: true });

console.log(`\nagentic-confirm.test: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
