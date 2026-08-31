// Offline unit checks for snapshotsanity.mjs — no network, no I/O.
// Run: node producer/snapshotsanity.test.mjs
import { accountsLookSwapped, SWAP_MIN_NAMES } from './snapshotsanity.mjs';

let pass = 0, fail = 0;
const ok = (label, cond) => { if (cond) pass++; else { fail++; console.error(`✗ ${label}`); } };
const P = (...syms) => syms.map((symbol) => ({ symbol, quantity: '1' }));

// The real books, verbatim from the 2026-08-31 snapshots either side of the incident.
const AGENTIC = P('SPY', 'LLY', 'NVDA', 'GOOGL', 'AMZN', 'MSFT', 'SHEL', 'VTI', 'JNJ', 'KO', 'GLDM', 'BKNG');
const MAIN = P('NVDA', 'TSM', 'CIFR', 'IREN', 'PLTR');

// (a) THE INCIDENT: the two get_equity_positions results transposed.
const swapped = accountsLookSwapped({
  agentic: { fresh: MAIN, prior: AGENTIC },
  main: { fresh: AGENTIC, prior: MAIN },
});
ok('the transposed 2026-08-31 payload is caught', !!swapped);
ok('…and is named as a transposition, not a one-sided miss', /TRANSPOSED/.test(swapped || ''));

// (b) the healthy hour before it — each book unchanged.
ok('an unchanged pair of books passes', accountsLookSwapped({
  agentic: { fresh: AGENTIC, prior: AGENTIC }, main: { fresh: MAIN, prior: MAIN } }) === null);

// (c) ordinary trading must never trip it: a rebalance that exits two names and opens two others.
const rebalanced = P('SPY', 'LLY', 'NVDA', 'GOOGL', 'AMZN', 'MSFT', 'SHEL', 'VTI', 'JNJ', 'KO', 'MA', 'V');
ok('an ordinary rebalance (2 out, 2 in) passes', accountsLookSwapped({
  agentic: { fresh: rebalanced, prior: AGENTIC }, main: { fresh: MAIN, prior: MAIN } }) === null);

// (d) ONE-SIDED: only the agentic fetch went to the wrong account. Still fatal — that is the book that
//     drives trading — but reported as a wrong-account fetch rather than a transposition.
const oneSided = accountsLookSwapped({
  agentic: { fresh: MAIN, prior: AGENTIC }, main: { fresh: MAIN, prior: MAIN } });
ok('a one-sided wrong-account agentic fetch is caught', !!oneSided);
ok('…and is NOT mislabelled a transposition', !/TRANSPOSED/.test(oneSided || ''));

// (e) the mirror — only MAIN went wrong — is deliberately NOT fatal here: the agentic book, which is the
//     one that trades, is intact, and build-data aborting the whole publish over the display-only side
//     would trade a real outage for a cosmetic error. It is left to the self-directed surfaces.
ok('a wrong-account MAIN fetch alone does not abort the publish', accountsLookSwapped({
  agentic: { fresh: AGENTIC, prior: AGENTIC }, main: { fresh: AGENTIC, prior: MAIN } }) === null);

// (f) fails OPEN on thin books — two 2-name accounts can overlap by coincidence.
ok(`fails open below SWAP_MIN_NAMES (${SWAP_MIN_NAMES})`, accountsLookSwapped({
  agentic: { fresh: P('A', 'B'), prior: P('C', 'D') }, main: { fresh: P('C', 'D'), prior: P('A', 'B') } }) === null);
ok('fails open when a side is missing entirely', accountsLookSwapped({
  agentic: { fresh: AGENTIC, prior: null }, main: { fresh: MAIN, prior: MAIN } }) === null);

// (g) shape tolerance — the raw payloads use `symbol`, the snapshot uses `symbol`, older code used `sym`.
ok('reads the {sym} shape too', !!accountsLookSwapped({
  agentic: { fresh: MAIN.map((p) => ({ sym: p.symbol })), prior: AGENTIC },
  main: { fresh: AGENTIC, prior: MAIN } }));

// (h) a first-ever agentic book (no prior) must not be judged.
ok('a brand-new agentic book with no prior passes', accountsLookSwapped({
  agentic: { fresh: AGENTIC, prior: [] }, main: { fresh: MAIN, prior: MAIN } }) === null);

console.log(`\nsnapshotsanity.test: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
