// Private Predict SETTLED ledger, built from Robinhood "Your $X payout is available" emails.
//
// Evidence contract (dot's 2026-11-02 handoff, Jack chose "email-only" on 2026-11-03):
// - A payout email proves the payout it states: gross amount, contract text, quantity, side and
//   (from the "View payout" link) the broker contract ID. It does NOT prove cost, fees, net, a
//   complete history, or that each leg of a combo "won" separately.
// - Gross payout is never profit. Cost basis and fees stay null unless another verified source
//   supplies them; net stays null until both are known. No ROI or win rate from a payout subset.
// - No loss is ever inferred from a missing email, a closed market or a vanished position.
// - A multi-selection combo is ONE settlement with nested legs.
// - The Gmail message ID is the idempotency key, never a broker transaction ID.
// - Append-only: a stored record is never rewritten. A conflicting second email for the same
//   contract keeps both, marks them for review and keeps them out of the totals.
// Lives only inside the encrypted account snapshot (data.predictionSettlements); the public
// predictions collector never reads it.

export const SENDER = 'noreply@robinhood.com';
export const LEDGER_CAP = 2000;            // runaway backstop only; history is kept by design
export const FIRST_LOOKBACK_DAYS = 120;    // first mailbox read with an empty ledger
export const OVERLAP_DAYS = 3;             // re-read window behind the newest stored email

const num = v => { const n = Number(String(v ?? '').replace(/[$,\s]/g, '')); return String(v ?? '').trim() !== '' && Number.isFinite(n) ? n : null; };
const stamp = v => (typeof v === 'string' && Number.isFinite(Date.parse(v))) ? new Date(v).toISOString() : null;
const r2 = n => Math.round(n * 100) / 100;

// Strip the email's HTML to text lines. Robinhood's template puts each field on its own <br> line.
export function emailText(body) {
  return String(body || '')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<br\s*\/?>/gi, '\n').replace(/<\/(div|p|tr|td)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .split('\n').map(s => s.replace(/[ \t]+/g, ' ').replace(/ :/g, ':').trim()).filter(Boolean).join('\n');
}

// "Yes Los Angeles R, Yes New England, Yes Washington" -> three legs. A single question
// ("Will Baltimore win by more than 6.5 points …?") is one leg whose side is the quantity's side.
export function splitLegs(contract, side) {
  const text = String(contract || '').trim();
  const parts = text.split(/,\s*(?=(?:Yes|No)\s)/);
  if (parts.length > 1 && parts.every(p => /^(Yes|No)\s+\S/.test(p))) {
    return parts.map(p => ({ side: p.startsWith('Yes') ? 'yes' : 'no', label: p.replace(/^(Yes|No)\s+/, '').trim() }));
  }
  const m = text.match(/^(Yes|No)\s+(.+)$/);
  if (m && !/\?$/.test(text)) return [{ side: m[1].toLowerCase(), label: m[2].trim() }];
  return [{ side, label: text }];
}

// One Gmail get_message result (any MCP wrapper already unwrapped) -> {record} or {reason}.
export function parsePayoutEmail(msg) {
  if (!msg || typeof msg !== 'object') return { reason: 'not a message object' };
  const id = typeof msg.id === 'string' && /^[A-Za-z0-9_-]{6,}$/.test(msg.id) ? msg.id : null;
  if (!id) return { reason: 'missing Gmail message id' };
  const sender = String(msg.sender || '').toLowerCase().trim();
  if (sender !== SENDER) return { id, reason: 'sender is not ' + SENDER };
  if (!/payout/i.test(String(msg.subject || ''))) return { id, reason: 'subject is not a payout notice' };
  const receivedAt = stamp(msg.date) || (num(msg.internalDate) ? new Date(num(msg.internalDate)).toISOString() : null);
  if (!receivedAt) return { id, reason: 'missing received time' };
  const raw = msg.plaintextBody || msg.htmlBody || '';
  const text = emailText(raw);
  const amount = num((text.match(/Amount\s*:\s*\$?\s*([\d,]+(?:\.\d{1,2})?)/i) || [])[1]);
  const contract = ((text.match(/Contract\s*:\s*(.+)/i) || [])[1] || '').trim();
  const q = text.match(/Quantity\s*:\s*([\d,]+(?:\.\d+)?)\s+(Yes|No)\b/i);
  const quantity = q ? num(q[1]) : null, side = q ? q[2].toLowerCase() : null;
  const contractId = ((String(raw).match(/contract_id=([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i) || [])[1] || null);
  if (amount === null || amount < 0) return { id, reason: 'payout amount not found' };
  if (!contract) return { id, reason: 'contract text not found' };
  if (quantity === null || quantity <= 0 || !side) return { id, reason: 'quantity/side not found' };
  const legs = splitLegs(contract, side);
  const perContract = r2(amount / quantity);
  return { record: {
    key: 'gmail:' + id, sourceType: 'robinhood-payout-email', sourceId: id,
    link: typeof msg.viewUrl === 'string' && msg.viewUrl.startsWith('https://mail.google.com/') ? msg.viewUrl : null,
    receivedAt, settledAt: null,            // the email states no settlement time; never copy receivedAt here
    contractId, title: contract, side, quantity, legs, combo: legs.length > 1,
    lifecycle: 'paid',                      // a payout notice; partial/early-exit/void need other evidence
    grossPayout: r2(amount), payoutPerContract: perContract,
    costBasis: null, fees: null, net: null, netBasis: 'unknown',
    flags: perContract > 1.0001 ? ['payout-above-1-per-contract'] : perContract < 0.9999 ? ['partial-payout-per-contract'] : [],
  } };
}

// Match one email record against the broker account feed, when a verified one exists.
function reconcile(rec, account) {
  if (!rec.contractId) return { status: 'review', note: 'No contract ID in the email; title-only matches are not trusted.' };
  if (!account) return { status: 'no-entry-source', note: 'No verified entry record to match yet; cost and fees unknown.' };
  // A broker settlement is linked only when contract, side AND quantity all agree, and exactly one
  // row does. Contract ID alone is not enough (dot, 2026-11-03): an opposite-side or different-size
  // settlement on the same contract is a different fill, and missing side/quantity is missing
  // evidence, never a match. Any disagreement keeps the email's payout evidence but moves it to review.
  const settles = (account.transactions || []).filter(t => t.contractId === rec.contractId && t.type === 'settlement');
  if (settles.length) {
    const exact = settles.filter(t => t.side === rec.side && t.quantity !== null && t.quantity !== undefined && Number(t.quantity) === rec.quantity);
    if (exact.length === 1) return { status: 'matched-broker', brokerTxId: exact[0].id, note: 'Same settlement (contract, side and quantity) appears in the broker account feed; counted once.' };
    if (exact.length > 1) return { status: 'review', note: 'More than one broker settlement matches this payout; not linked until reviewed.' };
    return { status: 'review', note: 'A broker settlement on this contract differs in side or quantity (or lacks them); payout evidence kept, not linked until reviewed.' };
  }
  const pos = (account.positions || []).find(p => p.contractId === rec.contractId && p.side === rec.side);
  if (!pos) return { status: 'unmatched', note: 'Contract not found in the account feed.' };
  if (pos.quantity !== null && pos.quantity < rec.quantity) return { status: 'review', note: 'Email quantity exceeds the recorded position.' };
  return { status: 'entry-found', note: 'Matching position found; cost basis shown only if the broker supplied it.' };
}

const eventKey = r => r.contractId ? [r.contractId, r.side, r.quantity].join('|') : null;

// prior: previous data.predictionSettlements (or null). messages: unwrapped get_message results.
// search: the saved search_threads result (proof the mailbox was read this run) or null.
export function buildSettlementLedger({ prior = null, messages = [], search = null, account = null, now = new Date().toISOString() } = {}) {
  const base = prior && prior.schemaVersion === 1 && Array.isArray(prior.records) ? prior : null;
  const records = base ? base.records.map(r => ({ ...r })) : [];
  const issues = base && Array.isArray(base.issues) ? base.issues.slice(-50) : [];
  const byKey = new Map(records.map(r => [r.key, r]));
  let added = 0, rejected = 0;
  for (const m of messages) {
    const { record, reason, id } = parsePayoutEmail(m);
    if (!record) {
      rejected++;
      if (id && !issues.some(i => i.sourceId === id)) issues.push({ sourceId: id, at: now, issue: 'Not imported: ' + reason });
      continue;
    }
    if (byKey.has(record.key)) continue;                    // identical retry adds nothing
    const ek = eventKey(record);
    const same = ek && records.find(r => eventKey(r) === ek && r.grossPayout === record.grossPayout && r.status !== 'duplicate');
    const clash = record.contractId && records.find(r => r.contractId === record.contractId && r.side === record.side && r.status !== 'duplicate' && (r.quantity !== record.quantity || r.grossPayout !== record.grossPayout));
    if (same) { record.status = 'duplicate'; record.duplicateOf = same.key; }
    else if (clash) {
      record.status = 'conflict'; record.conflictsWith = clash.key;
      clash.status = 'conflict'; clash.conflictsWith = clash.conflictsWith || record.key;
    } else record.status = 'counted';
    records.push(record); byKey.set(record.key, record); added++;
  }
  for (const r of records) {
    if (r.status === 'duplicate') continue;
    const rc = reconcile(r, account);                       // re-run each build: an entry feed may arrive later
    r.reconciliation = rc.status; r.reconcileNote = rc.note;
    if (rc.brokerTxId) r.brokerTxId = rc.brokerTxId; else delete r.brokerTxId;
    if (r.status !== 'conflict') r.status = rc.status === 'review' ? 'review' : 'counted';
  }
  records.sort((a, b) => Date.parse(b.receivedAt) - Date.parse(a.receivedAt));
  const kept = records.slice(0, LEDGER_CAP);
  const counted = kept.filter(r => r.status === 'counted');
  const times = counted.map(r => r.receivedAt).sort();
  const searchCount = Array.isArray(search?.threads) ? search.threads.length : null;
  const mailbox = search ? { status: 'read', checkedAt: now, emailsInWindow: searchCount, added, rejected }
    : (base?.mailbox || { status: 'never-read', checkedAt: null });
  return {
    schemaVersion: 1, source: 'robinhood-payout-email', asOf: search || added ? now : (base?.asOf || now),
    mailbox,
    summary: {
      grossReceived: r2(counted.reduce((s, r) => s + r.grossPayout, 0)),
      payouts: counted.length, combos: counted.filter(r => r.combo).length,
      netKnown: counted.filter(r => r.net !== null).length,
      verifiedNet: null,                                   // never from a payout-only mailbox subset
      needsReview: kept.filter(r => r.status === 'review' || r.status === 'conflict').length,
      duplicatesIgnored: kept.filter(r => r.status === 'duplicate').length,
      from: times[0] || null, to: times[times.length - 1] || null,
    },
    records: kept, issues: issues.slice(-50),
  };
}

// The mailbox query the producer should run, from the stored ledger (idempotent if it overlaps).
export function mailPlan(ledger, now = new Date()) {
  const newest = (ledger?.records || []).map(r => Date.parse(r.receivedAt)).filter(Number.isFinite).sort((a, b) => b - a)[0];
  const since = new Date((newest ?? now.getTime() - FIRST_LOOKBACK_DAYS * 864e5) - (newest ? OVERLAP_DAYS * 864e5 : 0));
  const d = since.toISOString().slice(0, 10).replace(/-/g, '/');
  return { query: 'from:' + SENDER + ' subject:payout after:' + d, known: (ledger?.records || []).map(r => r.sourceId).filter(Boolean) };
}
