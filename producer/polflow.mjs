// producer/polflow.mjs — congressional disclosure (STOCK Act periodic transaction reports) → cluster
// signals. PURE (no I/O), unit-tested. This is the layer the @Trump_portfolio-style trackers repackage.
//
// READ PROPOSAL-flow-signals.md BEFORE GIVING THIS ANY WEIGHT. Measured on live data, this feed is the
// weakest member of the flow family, and the owner's signed-off decision is that it contributes **ZERO**
// to any score — it is evidence handed to the adversarial verify stage and context rendered on a card,
// nothing more. Three reasons, all from live probes:
//   1. LAG. Median transaction→disclosure gap: Senate 116 days, House 40. Whatever the edge was, it has
//      been public for a month or four by the time we can see it.
//   2. THE ETF EVIDENCE IS A FACTOR TILT. NANC ~27%/yr vs KRUZ ~13%, but neither shows significant
//      RISK-ADJUSTED outperformance vs SPY; NANC's return tracks its megacap-tech concentration.
//   3. IT POINTS WHERE WE ALREADY CAP. The most-traded House names in our own pull were AMAT, SPGI, MNST,
//      META, MSFT, TSM, NVDA — four inside the `megacap-tech` cluster riskweights.mjs caps at 48%. Acting
//      on it would spend risk budget re-buying the exact co-moving complex that cap exists to contain.
// Hence `EXCLUDED_CLUSTERS`: a megacap-tech name never receives a political nudge, ever.
//
// Tier note (FMP): `senate-latest`/`house-latest` are capped at page=0, limit=25 on our plan, and the
// by-symbol endpoints are restricted. So we see a rolling ~50-row window per poll and must build our own
// index by ACCUMULATING forward — which is why build-data.mjs keeps `data.flow.polEvents` as a capped,
// carried-forward ledger rather than anything re-derivable from a single fetch.
import { clusterOf } from './riskweights.mjs';

export const MIN_FILERS = 3;              // distinct people, same direction, before it's a "cluster"
export const CLUSTER_WINDOW_DAYS = 45;    // how close together those trades must sit
export const RETENTION_DAYS = 120;        // how long an event stays in the accumulated ledger
export const EXCLUDED_CLUSTERS = ['megacap-tech'];

const daysBetween = (a, b) => (Date.parse(a) - Date.parse(b)) / 86400000;
const upper = (v) => String(v == null ? '' : v).toUpperCase();

// Normalize one FMP senate-latest / house-latest row into a compact ledger event. Returns null for
// anything unusable: no symbol (bonds, funds, private holdings, "unknown asset"), or a non-stock asset
// type — both dominate the raw feed and neither maps to a tradeable name.
export function normalizeDisclosure(row, chamber) {
  if (!row || !row.symbol) return null;
  if (!/stock/i.test(String(row.assetType || ''))) return null;
  const type = upper(row.type);
  const side = /PURCHASE/.test(type) ? 'buy' : (/SALE/.test(type) ? 'sell' : null);
  if (!side) return null;                                   // 'Exchange' and friends carry no direction
  const txn = String(row.transactionDate || '').slice(0, 10);
  const disc = String(row.disclosureDate || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(txn)) return null;
  const filer = [row.firstName, row.lastName].filter(Boolean).join(' ').trim() || String(row.office || '').trim();
  if (!filer) return null;
  return {
    sym: upper(row.symbol), side, txn, disc: disc || null,
    filer: filer.toUpperCase(),
    chamber: chamber || (row.district ? 'house' : 'senate'),
    amount: row.amount || null,                             // a BUCKET ("$1,001 - $15,000") — never size on it
    lag: disc ? Math.round(daysBetween(disc, txn)) : null,
  };
}

// Merge freshly-fetched rows into the accumulated ledger: de-duplicated, trimmed to RETENTION_DAYS.
// Identity is (filer, symbol, side, transaction date) — the same trade re-appearing in a later poll must
// not inflate a cluster, which is the failure mode that would make this feed look far more active than
// it is. Newest first.
export function mergeEvents(priorEvents = [], freshEvents = [], { asOf, retentionDays = RETENTION_DAYS } = {}) {
  const today = asOf || new Date().toISOString().slice(0, 10);
  const seen = new Set();
  const out = [];
  for (const e of [...(freshEvents || []), ...(priorEvents || [])]) {
    if (!e || !e.sym || !e.txn) continue;
    const age = daysBetween(today, e.txn);
    if (!(age >= 0 && age <= retentionDays)) continue;
    const key = `${e.filer}|${e.sym}|${e.side}|${e.txn}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return out.sort((a, b) => (b.txn || '').localeCompare(a.txn || ''));
}

// Find genuine clusters in the ledger: ≥MIN_FILERS DISTINCT people trading the same symbol the same way,
// with their transactions falling inside a CLUSTER_WINDOW_DAYS span. Megacap-tech names are dropped
// outright (see the header). Returns a map keyed by symbol.
export function detectClusters(events = [], { asOf, minFilers = MIN_FILERS, windowDays = CLUSTER_WINDOW_DAYS } = {}) {
  const today = asOf || new Date().toISOString().slice(0, 10);
  const bySymSide = new Map();
  for (const e of events) {
    if (!e || !e.sym || !e.side || !e.txn) continue;
    if (EXCLUDED_CLUSTERS.includes(clusterOf(e.sym))) continue;
    const k = `${e.sym}|${e.side}`;
    if (!bySymSide.has(k)) bySymSide.set(k, []);
    bySymSide.get(k).push(e);
  }
  const out = {};
  for (const [k, group] of bySymSide) {
    const [sym, side] = k.split('|');
    // Sort by transaction date, then slide a window and take the densest distinct-filer count.
    const sorted = group.slice().sort((a, b) => a.txn.localeCompare(b.txn));
    let best = null;
    for (let i = 0; i < sorted.length; i++) {
      const filers = new Set(), members = [];
      for (let j = i; j < sorted.length; j++) {
        if (daysBetween(sorted[j].txn, sorted[i].txn) > windowDays) break;
        filers.add(sorted[j].filer);
        members.push(sorted[j]);
      }
      if (!best || filers.size > best.filers) best = { filers: filers.size, members };
    }
    if (!best || best.filers < minFilers) continue;
    const last = best.members.reduce((a, b) => (a.txn > b.txn ? a : b));
    const lags = best.members.map((m) => m.lag).filter((n) => Number.isFinite(n));
    const prevBest = out[sym];
    const cand = {
      sym, side, filers: best.filers, trades: best.members.length,
      chambers: [...new Set(best.members.map((m) => m.chamber))].sort(),
      lastTxn: last.txn,
      staleDays: Math.round(daysBetween(today, last.txn)),
      medianLagDays: lags.length ? lags.slice().sort((a, b) => a - b)[Math.floor(lags.length / 2)] : null,
      note: `${best.filers} filers ${side === 'buy' ? 'bought' : 'sold'} within ${windowDays}d (last ${last.txn})`,
    };
    // If both sides cluster on the same name, the larger one wins — a split legislature is no signal.
    if (!prevBest || cand.filers > prevBest.filers) out[sym] = cand;
    else if (prevBest && cand.filers === prevBest.filers) delete out[sym];
  }
  return out;
}

// One-line evidence strings for the adversarial verify prompt. NOT a score — deliberately phrased so a
// verifier weighs it as the stale, low-conviction datapoint it is.
export function clusterEvidence(clusters = {}) {
  return Object.values(clusters).map((c) =>
    `${c.sym}: ${c.filers} members of Congress ${c.side === 'buy' ? 'bought' : 'sold'} it (last transaction ${c.lastTxn}, ~${c.staleDays}d ago${c.medianLagDays != null ? `, disclosed after ~${c.medianLagDays}d` : ''}) — disclosure feed, heavily lagged, treat as weak context only`);
}
