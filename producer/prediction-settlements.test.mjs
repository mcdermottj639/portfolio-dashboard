// Synthetic fixtures only — shaped like Robinhood's payout template, no real account values.
import assert from 'node:assert/strict';
import { parsePayoutEmail, buildSettlementLedger, splitLegs, mailPlan, emailText } from './prediction-settlements.mjs';

const html = (amount, contract, qty, side, cid) =>
  '<html><head><style>p{margin:0}</style></head><body><div>Your payout has arrived</div>' +
  '<div>Hi Test. You received a payout. Here are the details:</div>' +
  '<div><b>Amount</b>: $' + amount + '<br><b>Contract</b>: ' + contract + '<br><b>Quantity</b>: ' + qty + ' ' + side + '</div>' +
  (cid ? '<a href="https://applink.robinhood.com/event_contract_payout?contract_id=' + cid + '">View payout</a>' : '') + '</body></html>';
const CID1 = '11111111-2222-4333-8444-555555555555', CID2 = '66666666-7777-4888-9999-aaaaaaaaaaaa', CID3 = 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff';
const msg = (id, date, body, extra = {}) => ({ id, date, sender: 'noreply@robinhood.com', subject: 'Your payout is available',
  plaintextBody: body, viewUrl: 'https://mail.google.com/mail/#all/' + id, ...extra });

const combo = msg('aaaaaa01', '2026-11-02T04:41:10Z', html('30.00', 'Yes Team A, Yes Team B, Yes Team C', '30', 'Yes', CID1));
const single = msg('aaaaaa02', '2026-10-25T20:12:54Z', html('12.00', 'Will Team D win by more than 6.5 points in the test game?', '12', 'No', CID2));

let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok', name); };

t('combo parses as ONE settlement with three nested legs', () => {
  const { record } = parsePayoutEmail(combo);
  assert.equal(record.combo, true); assert.equal(record.legs.length, 3);
  assert.deepEqual(record.legs.map(l => l.label), ['Team A', 'Team B', 'Team C']);
  assert.equal(record.grossPayout, 30); assert.equal(record.quantity, 30); assert.equal(record.side, 'yes');
  assert.equal(record.contractId, CID1); assert.equal(record.key, 'gmail:aaaaaa01');
});
t('a No-side payout is a payout on the No side, not a loss', () => {
  const { record } = parsePayoutEmail(single);
  assert.equal(record.side, 'no'); assert.equal(record.combo, false); assert.equal(record.lifecycle, 'paid'); assert.equal(record.grossPayout, 12);
});
t('gross is never profit: cost, fees and net stay null, not zero', () => {
  const { record } = parsePayoutEmail(combo);
  assert.equal(record.costBasis, null); assert.equal(record.fees, null); assert.equal(record.net, null);
  const L = buildSettlementLedger({ messages: [combo, single], search: { threads: [{}, {}] }, now: '2026-11-03T06:00:00Z' });
  assert.equal(L.summary.grossReceived, 42); assert.equal(L.summary.verifiedNet, null); assert.equal(L.summary.netKnown, 0);
});
t('settlement time is not invented from the email received time', () => {
  assert.equal(parsePayoutEmail(combo).record.settledAt, null);
});
t('identical-email retry adds nothing', () => {
  const a = buildSettlementLedger({ messages: [combo], search: { threads: [] }, now: '2026-11-03T06:00:00Z' });
  const b = buildSettlementLedger({ prior: a, messages: [combo, combo], search: { threads: [] }, now: '2026-11-03T07:00:00Z' });
  assert.equal(b.records.length, 1); assert.equal(b.summary.grossReceived, 30); assert.equal(b.mailbox.added, 0);
});
t('a forwarded/reissued email for the same settlement is kept but not counted twice', () => {
  const fwd = msg('aaaaaa03', '2026-11-02T09:00:00Z', combo.plaintextBody);
  const L = buildSettlementLedger({ messages: [combo, fwd], search: { threads: [] } });
  assert.equal(L.records.length, 2); assert.equal(L.summary.grossReceived, 30); assert.equal(L.summary.duplicatesIgnored, 1);
  assert.equal(L.records.find(r => r.sourceId === 'aaaaaa03').duplicateOf, 'gmail:aaaaaa01');
});
t('a conflicting correction keeps both and blocks them from totals until reviewed', () => {
  const corr = msg('aaaaaa04', '2026-11-02T10:00:00Z', html('31.00', 'Yes Team A, Yes Team B, Yes Team C', '31', 'Yes', CID1));
  const L = buildSettlementLedger({ messages: [combo, corr, single], search: { threads: [] } });
  assert.equal(L.records.filter(r => r.status === 'conflict').length, 2);
  assert.equal(L.summary.grossReceived, 12); assert.equal(L.summary.needsReview, 2);
  assert.equal(L.records.find(r => r.sourceId === 'aaaaaa01').grossPayout, 30, 'prior evidence preserved');
});
t('no contract ID means review-required, never counted on a title match', () => {
  const noId = msg('aaaaaa05', '2026-10-01T00:00:00Z', html('5.00', 'Will X happen?', '5', 'Yes', null));
  const L = buildSettlementLedger({ messages: [noId], search: { threads: [] } });
  assert.equal(L.records[0].status, 'review'); assert.equal(L.summary.grossReceived, 0); assert.equal(L.summary.needsReview, 1);
});
t('excess quantity against a verified position is review-required', () => {
  const account = { positions: [{ contractId: CID2, side: 'no', quantity: 5 }], transactions: [] };
  const L = buildSettlementLedger({ messages: [single], search: { threads: [] }, account });
  assert.equal(L.records[0].status, 'review'); assert.equal(L.records[0].reconciliation, 'review');
});
t('a settlement already in the broker feed is linked, not double counted', () => {
  const account = { positions: [], transactions: [{ id: 'tx1', contractId: CID2, type: 'settlement' }] };
  const L = buildSettlementLedger({ messages: [single], search: { threads: [] }, account });
  assert.equal(L.records[0].reconciliation, 'matched-broker'); assert.equal(L.records[0].brokerTxId, 'tx1'); assert.equal(L.summary.payouts, 1);
});
t('wrong sender, non-payout subject and unparseable bodies are rejected and logged, never imported', () => {
  const spoof = msg('aaaaaa06', '2026-10-01T00:00:00Z', combo.plaintextBody, { sender: 'noreply@robinhood.com.evil.io' });
  const stmt = msg('aaaaaa07', '2026-10-01T00:00:00Z', 'Your monthly statement', { subject: 'Your statement is ready' });
  const junk = msg('aaaaaa08', '2026-10-01T00:00:00Z', '<p>Hello</p>');
  const L = buildSettlementLedger({ messages: [spoof, stmt, junk], search: { threads: [] } });
  assert.equal(L.records.length, 0); assert.equal(L.issues.length, 3); assert.equal(L.mailbox.rejected, 3);
});
t('no mailbox read this run: prior ledger and its last check time carry forward untouched', () => {
  const a = buildSettlementLedger({ messages: [combo], search: { threads: [{}] }, now: '2026-11-03T06:00:00Z' });
  const b = buildSettlementLedger({ prior: a, now: '2026-11-03T09:00:00Z' });
  assert.deepEqual(b.records, a.records); assert.equal(b.mailbox.checkedAt, '2026-11-03T06:00:00Z'); assert.equal(b.asOf, a.asOf);
  assert.equal(buildSettlementLedger({}).mailbox.status, 'never-read');
});
t('absence of an email never creates a loss row', () => {
  const L = buildSettlementLedger({ messages: [], search: { threads: [] } });
  assert.equal(L.records.length, 0); assert.equal(L.summary.payouts, 0); assert.equal(L.summary.grossReceived, 0);
});
t('partial payout per contract is flagged, not hidden', () => {
  const partial = msg('aaaaaa09', '2026-10-02T00:00:00Z', html('5.00', 'Will Y happen?', '10', 'Yes', CID3));
  assert.deepEqual(parsePayoutEmail(partial).record.flags, ['partial-payout-per-contract']);
});
t('leg splitting does not break a question that contains commas', () => {
  assert.equal(splitLegs('Will A, B or C win the test?', 'yes').length, 1);
  assert.equal(splitLegs('Yes Team A, No Team B', 'yes')[1].side, 'no');
});
t('mail plan: first read looks back 120 days; later reads overlap the newest email and list known ids', () => {
  const now = new Date('2026-11-03T06:00:00Z');
  assert.match(mailPlan(null, now).query, /after:2026\/07\/06$/);
  const L = buildSettlementLedger({ messages: [combo, single], search: { threads: [] } });
  const p = mailPlan(L, now); assert.match(p.query, /^from:noreply@robinhood\.com subject:payout after:2026\/10\/30$/);
  assert.deepEqual(p.known.sort(), ['aaaaaa01', 'aaaaaa02']);
});
t('emailText strips styles and keeps one field per line', () => {
  const s = emailText(combo.plaintextBody); assert.ok(!/margin/.test(s)); assert.match(s, /^Quantity: 30 Yes$/m);
});
console.log(n + ' prediction-settlements tests passed');
