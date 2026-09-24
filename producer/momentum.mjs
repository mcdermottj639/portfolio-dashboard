// producer/momentum.mjs — MOMENTUM AS CODE, not as an agent (2026-09-24).
//
// WHY THIS FILE EXISTS. The weekly research ran momentum as one of four sleeve AGENTS, each of which
// re-read the whole universe and fetched its own historicals. Per-agent fixed context on this harness
// measures ~177k tokens — a one-word, zero-tool subagent costs that before it reasons — so a sleeve is
// expensive before it does any work, and momentum was the one doing the HEAVIEST fetching (Robinhood
// historicals, 3 symbols per call, across the whole bench).
//
// None of that fetching was necessary. Momentum here is arithmetic over daily closes, and since v141
// `hist-plan.mjs` keeps the ~230-name Analyze bench fresh in `data.hist.day` for ~16KB/day. The producer
// already HOLDS the bars the sleeve was paying an agent to go and re-fetch. This is the same move the
// flow sleeve already made ("not an agent; the producer already computed it") and the same one
// `research-universe.mjs` recommends in its own header.
//
// THE RUBRIC IS sdMomentum's, DELIBERATELY. `index.html` has scored exactly this — 6m/3m RS vs SPY,
// price vs 50/100-DMA with slope, proximity to the trailing high — since v113, with weights the owner
// set. Re-deriving a second, subtly different momentum definition for the agentic book is how this repo
// produces drift; `momentum.test.mjs` pins the weights so the two cannot wander apart silently.
//
// 50/100, NOT 50/200. A YTD daily series cannot reach 200 bars, so a 200-DMA would be null for most of
// the bench for most of the year and the trend term would silently abstain. The consumer made this
// choice first and for the same reason; the agent prompt said "50/200-DMA" and was quietly scoring
// against whatever it could actually compute.
//
// THE STALENESS GATE IS THE LOAD-BEARING PART. `data.hist.day` goes stale PER SYMBOL, and a series that
// stops STOPS AT ITS OWN HIGH — on 2026-08-14 that scored MU, WULF and NBIS a perfect 10.00 at "0.0%
// off the high". Any ranker over these bars needs the gate or it will rank phantoms first. Past
// AGING_DAYS a name ABSTAINS (score null, status 'missing') rather than scoring; 11-35 days scores but
// carries AGING_CONF, so a stale name can never outrank a fresh one at equal merit.

export const FRESH_DAYS = 10;     // within this, full confidence
export const AGING_DAYS = 35;     // past this, abstain entirely
export const AGING_CONF = 0.75;   // 11-35 days: scored, but haircut
export const MIN_BARS   = 100;    // need enough history for a 100-DMA to mean anything

const lin = (v, lo, hi) => v == null || !isFinite(v) ? null
  : Math.max(0, Math.min(10, ((v - lo) / (hi - lo)) * 10));

export function sma(c, n) {
  if (!Array.isArray(c) || c.length < n || n <= 0) return null;
  let s = 0; for (let i = c.length - n; i < c.length; i++) s += c[i];
  return s / n;
}

export function ret(c, n) {
  if (!Array.isArray(c) || c.length <= n || n <= 0) return null;
  const a = c[c.length - 1 - n], b = c[c.length - 1];
  return (a > 0 && b > 0) ? (b / a - 1) * 100 : null;
}

// Coalesces BOTH producer bar shapes (the documented Railway-vs-Claude split) and drops the rows that
// are not real closes: an `interpolated` placeholder is a calendar slot with no price, and a `live`
// bar is an intraday print, not a close. Counting either would let a padded or half-spliced series
// masquerade as current — the exact failure the freshness gate exists to catch.
export function closes(bars) {
  if (!Array.isArray(bars)) return [];
  const out = [];
  for (const b of bars) {
    if (!b || b.interpolated === true || b.live === true) continue;
    const t = b.t || b.begins_at, c = Number(b.close_price ?? b.c);
    if (!t || !isFinite(c) || c <= 0) continue;
    out.push({ t: String(t).slice(0, 10), c });
  }
  return out;
}

const ageDays = (asOf, last) => (asOf && last)
  ? Math.round((Date.parse(asOf + 'T00:00:00Z') - Date.parse(last + 'T00:00:00Z')) / 86400000)
  : null;

// One symbol -> the SLEEVE_SCHEMA row shape the workflow already consumes, so this drops in as
// args.momentum with no downstream change. `evidence` is real provenance: the snapshot, dated.
export function momentumFor(sym, bars, spyCloses, px, asOf) {
  const mk = (score, note, extra) => ({
    ticker: sym, score, note,
    status: (typeof score === 'number') ? 'observed' : 'missing',
    // PROVENANCE MUST NAME THE ORIGINAL SOURCE, NOT THE TRANSFORM (2026-09-24). agentic-evidence.mjs's
    // validEvidence requires source to match /^(https:\/\/|mcp:)/ — it is checking that a claim is
    // traceable to a real provider record. 'producer/momentum.mjs' named the CALCULATOR, matched
    // neither, and so every momentum row was silently dropped from the supported-sleeve count; the
    // first real target built on it was refused with "need quality and at least three supported
    // sleeves" and no indication that momentum was the missing one. The bars genuinely ARE recorded
    // Robinhood historicals — the producer fetched them through that tool and stored them in
    // data.hist.day — so the MCP record is the honest source and the module belongs in the claim.
    evidence: (typeof score === 'number')
      ? [{ source: 'mcp:Robinhood-get_equity_historicals/' + sym,
           asOf: (extra && extra.lastBar) || asOf,
           claim: 'producer/momentum.mjs scored ' + Number(score).toFixed(2) + '/10 over recorded daily closes through ' + ((extra && extra.lastBar) || asOf) + ' — ' + note }]
      : [],
  });
  if (!(px > 0)) return mk(null, 'no live quote — cannot price or rank', {});
  const b = closes(bars);
  if (b.length < MIN_BARS) return mk(null, `only ${b.length} usable daily bars (need ${MIN_BARS})`, {});
  const last = b[b.length - 1].t, age = ageDays(asOf, last);
  if (age == null || age > AGING_DAYS) {
    return mk(null, `price history is ${age == null ? 'undated' : age + ' days'} stale — abstaining (a stale series stops at its own high)`, {});
  }
  const stale = age > FRESH_DAYS, conf = stale ? AGING_CONF : 1;
  const c = b.map(x => x.c);
  const s50 = sma(c, 50), s100 = sma(c, 100), prev50 = sma(c.slice(0, -20), 50);
  const hi = Math.max(px, ...c.slice(-154)), fromHi = (px / hi - 1) * 100;
  const sp = Array.isArray(spyCloses) ? spyCloses : [];
  const r3 = ret(c, 63), r6 = ret(c, 126), sp3 = ret(sp, 63), sp6 = ret(sp, 126);
  const rs3 = (r3 != null && sp3 != null) ? r3 - sp3 : null;
  const rs6 = (r6 != null && sp6 != null) ? r6 - sp6 : null;

  const parts = [];
  const add = (w, v) => { if (v != null && isFinite(v)) parts.push([w, v]); };
  add(0.30, rs6 != null ? lin(rs6, -20, 30) : null);      // 6-month leadership vs SPY — the big one
  add(0.25, rs3 != null ? lin(rs3, -15, 20) : null);      // 3-month, so a fresh leader isn't penalized
  add(0.25, (s50 && s100) ? (lin((px / s50 - 1) * 100, -12, 12) * 0.45
                           + lin((s50 / s100 - 1) * 100, -8, 8) * 0.35
                           + (prev50 ? lin((s50 / prev50 - 1) * 100, -6, 6) : 5) * 0.20) : null);
  add(0.20, lin(fromHi, -45, 0));                         // near the high = leadership
  if (parts.length < 2) return mk(null, 'not enough history to score', {});

  const W = parts.reduce((s, [w]) => s + w, 0);
  const raw = parts.reduce((s, [w, v]) => s + w * v, 0) / W;
  const score = Math.max(0, Math.min(10, raw * conf));
  const f = (v, d = 1) => v == null ? 'n/a' : v.toFixed(d);
  const note = `${f(px, 2)} vs 50-DMA ${f(s50, 2)} / 100-DMA ${f(s100, 2)}; `
    + `3m RS ${rs3 != null ? (rs3 >= 0 ? '+' : '') + f(rs3) + 'pp' : 'n/a'}, `
    + `6m RS ${rs6 != null ? (rs6 >= 0 ? '+' : '') + f(rs6) + 'pp' : 'n/a'} vs SPY; `
    + `${f(Math.abs(fromHi))}% off trailing high; bars to ${last}`
    + (stale ? ` (${age}d stale — confidence x${AGING_CONF})` : '');
  return mk(score, note, { lastBar: last });
}

// Whole universe -> { scores: [...] }, i.e. exactly what a sleeve agent used to return.
export function momentumScores({ symbols, histDay, quotes, asOf, benchSymbol = 'SPY' }) {
  const spy = closes((histDay || {})[benchSymbol]).map(x => x.c);
  const pxOf = (s) => {
    const q = (quotes || {})[s];
    if (q == null) return 0;
    if (typeof q === 'number') return q;
    return Number(q.last_trade_price ?? q.px ?? q.close_price ?? q.c ?? 0);
  };
  return { scores: (symbols || []).map(s => momentumFor(s, (histDay || {})[s], spy, pxOf(s), asOf)) };
}

// CLI (2026-09-24) — what the weekly research Routine runs for its step 3b, so the prompt names a
// command instead of carrying hand-edited JS:
//   node producer/momentum.mjs --symbols AAPL,MSFT,... [--out producer/raw/momentum.json]
// Reads the COMMITTED data.json (PF_PASSPHRASE decrypts it; a plaintext sample works too) and prints
// or writes { scores:[...] } — the exact args.momentum shape. Symbols only reach the log, never money.
if (process.argv[1] && import.meta.url === (await import('node:url')).pathToFileURL(process.argv[1]).href) {
  const { readFileSync, writeFileSync, mkdirSync } = await import('node:fs');
  const { dirname, join } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const argv = process.argv.slice(2);
  const opt = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
  const symbols = String(opt('--symbols') || '').split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
  if (!symbols.length) { console.error('usage: node producer/momentum.mjs --symbols A,B,C [--out file]'); process.exit(2); }
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  let d = JSON.parse(readFileSync(join(root, 'data.json'), 'utf8'));
  if (d && d.enc) {
    if (!process.env.PF_PASSPHRASE) { console.error('momentum: data.json is encrypted and PF_PASSPHRASE is not set'); process.exit(3); }
    const { decryptEnvelope } = await import('./emit.mjs');
    d = await decryptEnvelope(d, process.env.PF_PASSPHRASE);
  }
  const res = momentumScores({ symbols, histDay: (d.hist || {}).day, quotes: d.quotes, asOf: String(d.generatedAt || '').slice(0, 10) });
  const scored = res.scores.filter(s => s && s.score != null).length;
  const out = opt('--out');
  if (out) {
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, JSON.stringify(res));
    console.log(`momentum: ${scored}/${symbols.length} scored -> ${out}`);
  } else {
    console.log(JSON.stringify(res));
    console.error(`momentum: ${scored}/${symbols.length} scored`);
  }
}
