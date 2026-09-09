/* Daily-Picks track record — grading, frozen outcomes, and the fetch universe that keeps it honest.
   ────────────────────────────────────────────────────────────────────────────────────────────────
   WHY THIS EXISTS (2026-09-09). The consumer graded every archived pick client-side by walking
   `data.hist.day[sym]`, and that series goes STALE PER SYMBOL: the producer only bar-fetches the
   names in its CURRENT rotation, so a pick's series freezes within days of the scan that named it.
   Measured on the live 2026-09-08 snapshot: 44 episodes, of which **12 were graded over ZERO bars**
   and most over fewer than ten — so a target hit weeks later could never be recorded while an early
   dip through the stop could. The card read **0% hit rate · 0W·2L · 42 open · +2.1% avg return**.
   That 0% is not a statement about the picks; it is a statement about the price history.

   THREE RULES CARRY THE FIX, each one a lesson this repo has already paid for elsewhere:

   (a) **A series that does not reach the measurement date is UNMEASURED, never OPEN.** "Open" claims
       we watched the name and it touched neither level. That claim is false when the series stopped
       three days after the scan. Same abstention as `agentic-ledger`'s `markFromBars`, which refuses
       to price a horizon off a series that merely stops — and for the same reason: a stale series
       stops at whatever price it stopped at, which is not evidence of anything.

   (b) **A resolved outcome is stamped ONCE and never recomputed** (the v129 frozen-marks rule). This
       is what decouples the record from the data: once an episode is graded TP2 or STOPPED, it stays
       that way even after its bars go stale, so the producer only needs fresh prices for episodes
       still running. That makes `gradingUniverse` self-draining instead of growing without bound.

   (c) **A resolved trade's return is measured to its EXIT, not to today.** The shipped card marked
       every episode to the latest price, so ORCL rendered "⛔ STOPPED · +18.3%" — stopped out, then
       rallied without us. Averaging that into "Avg return" measures a position nobody held. Resolved
       episodes return at their exit; running ones mark to the last close we actually have.

   Pure + unit-tested (`pickgrade.test.mjs`). No I/O, no network. Bar shape is coalesced per the
   documented Railway-vs-Claude contract (`b.begins_at||b.t`, `b.close_price ?? b.c`). */

export const EPISODE_GAP_DAYS = 14;   // re-picks of a name inside ~2 weeks are ONE thesis (mirrors picks.mjs's cooldown)
export const GRADE_HORIZON_DAYS = 60; // a swing pick's life ("4-8 weeks"); past this an unresolved episode EXPIRES
export const BAR_REACH_DAYS = 5;      // the series must reach within this many days of the measure-through date
export const UNIVERSE_CAP = 30;       // most symbols to ask the producer to refresh in one run

const DAY = 864e5;
const dnum = (iso) => { const t = Date.parse(String(iso).slice(0, 10) + 'T00:00:00Z'); return Number.isFinite(t) ? t / DAY : null; };
const iso = (n) => new Date(Math.round(n) * DAY).toISOString().slice(0, 10);
const barT = (b) => String((b && (b.begins_at || b.t)) || '').slice(0, 10);
const barC = (b) => { const c = +(b && (b.close_price ?? b.c)); return Number.isFinite(c) && c > 0 ? c : null; };

/* Usable closing bars, ascending, deduped by date (latest wins). Drops interpolated placeholders and
   the consumer's spliced `live:true` bar — this is a CLOSING basis, and an intraday print must not
   trip a stop nothing closed through. */
export function closeSeries(bars) {
  const by = new Map();
  for (const b of Array.isArray(bars) ? bars : []) {
    if (!b || b.interpolated || b.live) continue;
    const t = barT(b), c = barC(b);
    if (!t || c == null) continue;
    by.set(t, c);
  }
  return [...by.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)).map(([t, c]) => ({ t, c }));
}

/* Collapse `data.picks.history` into EPISODES: one continuous thesis per ticker, a new episode only
   after a gap > EPISODE_GAP_DAYS. Graded from the EARLIEST entry of the episode. Most-recent first. */
export function pickEpisodes(history) {
  const scans = (Array.isArray(history) ? history : []).filter((h) => h && h.ts && Array.isArray(h.picks) && h.picks.length);
  const bySym = new Map();
  for (const h of scans) {
    for (const pk of h.picks) {
      if (!pk || !pk.ticker) continue;
      if (!bySym.has(pk.ticker)) bySym.set(pk.ticker, []);
      bySym.get(pk.ticker).push({ pk, ts: String(h.ts).slice(0, 10) });
    }
  }
  const eps = [];
  for (const [sym, arr] of bySym) {
    arr.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
    let cur = null;
    for (const x of arr) {
      const gap = cur ? (dnum(x.ts) - dnum(cur.lastTs)) : Infinity;
      if (cur && gap <= EPISODE_GAP_DAYS) { cur.lastTs = x.ts; cur.count++; }
      else { if (cur) eps.push(cur); cur = { sym, key: sym + '|' + x.ts, firstTs: x.ts, lastTs: x.ts, count: 1, pk: x.pk }; }
    }
    if (cur) eps.push(cur);
  }
  return eps.sort((a, b) => (a.lastTs < b.lastTs ? 1 : a.lastTs > b.lastTs ? -1 : 0));
}

/* Grade ONE episode on a closing basis from its first scan date.
   status: TP2 | TP1 | STOPPED (resolved) · OPEN (running, and we can prove it) · EXPIRED (ran the
   full horizon without touching a level) · UNMEASURED (the price history does not reach — rule (a)). */
export function gradeEpisode(pk, bars, { from, asOf, horizonDays = GRADE_HORIZON_DAYS } = {}) {
  const entry = Number.isFinite(+(pk && (pk.entryRef ?? pk.basePrice))) ? +(pk.entryRef ?? pk.basePrice) : null;
  const tp1 = Number.isFinite(+(pk && pk.tp1)) ? +pk.tp1 : null;
  const tp2 = Number.isFinite(+(pk && pk.tp2)) ? +pk.tp2 : null;
  const sl = Number.isFinite(+(pk && pk.sl)) ? +pk.sl : null;
  const f = dnum(from), a = dnum(asOf);
  const all = closeSeries(bars);
  const lastBar = all.length ? all[all.length - 1].t : null;
  // Measure only to the end of the pick's life: min(today, scan + horizon).
  const throughN = (f != null && a != null) ? Math.min(a, f + horizonDays) : a;
  const through = throughN != null ? iso(throughN) : null;
  const expired = (f != null && a != null) && a > f + horizonDays;

  const win = all.filter((b) => (f == null || dnum(b.t) >= f) && (through == null || b.t <= through));
  let status = null, statusDate = null, exitPx = null, banked = false;
  for (const b of win) {
    if (sl != null && b.c <= sl) { status = banked ? 'TP1' : 'STOPPED'; statusDate = b.t; exitPx = banked ? tp1 : sl; break; }
    if (tp2 != null && b.c >= tp2) { status = 'TP2'; statusDate = b.t; exitPx = tp2; break; }
    if (tp1 != null && b.c >= tp1 && !banked) { banked = true; status = 'TP1'; statusDate = b.t; exitPx = tp1; }
  }
  if (status) {
    return {
      status, statusDate, resolved: true, entry, exitPx,
      ret: entry && exitPx ? (exitPx - entry) / entry * 100 : null,
      retAsOf: statusDate, retBasis: 'exit', measuredThrough: statusDate, lastBar,
    };
  }
  // Not resolved. Did we actually WATCH it to `through`, or did the series just stop? (rule (a))
  const reached = lastBar != null && throughN != null && dnum(lastBar) >= throughN - BAR_REACH_DAYS;
  if (!win.length || !reached) {
    return {
      status: 'UNMEASURED', resolved: false, entry, exitPx: null,
      ret: null, retAsOf: null, retBasis: null, measuredThrough: win.length ? win[win.length - 1].t : null, lastBar,
    };
  }
  const last = win[win.length - 1];
  return {
    status: expired ? 'EXPIRED' : 'OPEN', resolved: false, entry, exitPx: null,
    ret: entry ? (last.c - entry) / entry * 100 : null,
    retAsOf: last.t, retBasis: 'mark', measuredThrough: last.t, lastBar,
  };
}

/* Grade every episode, FREEZING resolved outcomes carried from the prior snapshot (rule (b)) so the
   record survives its own price history going stale. `prior` = a previous gradeAll() result (or its
   `episodes` array). A resolved record is copied verbatim and never re-derived. */
export function gradeAll(history, barsBySym = {}, { asOf, prior, horizonDays = GRADE_HORIZON_DAYS } = {}) {
  const priorEps = Array.isArray(prior) ? prior : (prior && Array.isArray(prior.episodes) ? prior.episodes : []);
  const frozen = new Map(), bySym = new Map();
  for (const e of priorEps) {
    if (!e || !e.resolved) continue;
    if (e.key) frozen.set(e.key, e);
    if (e.sym) { if (!bySym.has(e.sym)) bySym.set(e.sym, []); bySym.get(e.sym).push(e); }
  }
  /* The key is `sym|firstTs`, and `picks.history` is capped at 40 scans — so when an episode's own
     EARLIEST scan ages out of that window, its first date shifts forward and the key changes. Without
     this fallback the frozen outcome would not be found and a recorded WIN would silently revert to
     "can't be graded", which is the exact class of bug this module exists to stop. A prior resolved
     record is therefore also matched when it plainly describes the SAME continuous episode: same
     symbol, it started no later than this one, and it ran up to within the gap window of it — the
     same contiguity test that defines an episode in the first place, so a genuinely separate later
     episode (which by definition sits more than a gap away) can never inherit an older outcome. The
     ORIGINAL key and start date are then kept, or the identity would shift again on the next run. */
  const carried = (ep) => {
    const cands = (bySym.get(ep.sym) || []).filter((e) => {
      const ef = dnum(e.firstTs), el = dnum(e.lastTs != null ? e.lastTs : e.firstTs), pf = dnum(ep.firstTs);
      return ef != null && pf != null && ef <= pf && (pf - (el ?? ef)) <= EPISODE_GAP_DAYS;
    });
    return cands.sort((a, b) => (a.firstTs < b.firstTs ? 1 : -1))[0] || null;
  };

  const episodes = pickEpisodes(history).map((ep) => {
    const keep = frozen.get(ep.key) || carried(ep);
    if (keep) return { ...keep, count: ep.count, lastTs: (keep.lastTs && keep.lastTs > ep.lastTs) ? keep.lastTs : ep.lastTs, frozen: true };
    const g = gradeEpisode(ep.pk, barsBySym[ep.sym] || [], { from: ep.firstTs, asOf, horizonDays });
    return {
      key: ep.key, sym: ep.sym, firstTs: ep.firstTs, lastTs: ep.lastTs, count: ep.count,
      signal: ep.pk && ep.pk.signal, tp1: ep.pk && ep.pk.tp1, tp2: ep.pk && ep.pk.tp2, sl: ep.pk && ep.pk.sl,
      ...g,
    };
  });
  return { asOf, horizonDays, episodes, stats: gradeStats(episodes) };
}

/* Roll up. hitRate counts RESOLVED episodes only; avgRet averages every episode we could MEASURE
   (resolved at its exit, running at its last real close) and silently excludes the unmeasured ones —
   never averaging a number we just said we cannot compute. */
export function gradeStats(episodes) {
  let wins = 0, losses = 0, open = 0, expired = 0, unmeasured = 0, retSum = 0, retN = 0;
  for (const e of Array.isArray(episodes) ? episodes : []) {
    const s = e && e.status;
    if (s === 'TP1' || s === 'TP2') wins++;
    else if (s === 'STOPPED') losses++;
    else if (s === 'EXPIRED') expired++;
    else if (s === 'UNMEASURED') unmeasured++;
    else open++;
    if (e && Number.isFinite(e.ret)) { retSum += e.ret; retN++; }
  }
  const resolved = wins + losses;
  return {
    n: (Array.isArray(episodes) ? episodes.length : 0),
    wins, losses, open, expired, unmeasured, resolved,
    hitRate: resolved ? Math.round(wins / resolved * 100) : null,
    avgRet: retN ? retSum / retN : null, avgRetN: retN,
  };
}

/* The symbols whose prices the producer must keep fresh for the record to mean anything: episodes
   still inside their horizon and not yet resolved. Ordered most-starved first (the biggest gap
   between what we have measured and where we need to measure to), capped. SELF-DRAINING — a
   resolved or expired episode never appears again, which is what rule (b) buys. */
export function gradingUniverse(history, { asOf, grades, horizonDays = GRADE_HORIZON_DAYS, cap = UNIVERSE_CAP } = {}) {
  const a = dnum(asOf);
  const byKey = new Map();
  const eps = Array.isArray(grades) ? grades : (grades && Array.isArray(grades.episodes) ? grades.episodes : []);
  for (const e of eps) if (e && e.key) byKey.set(e.key, e);
  const want = [];
  for (const ep of pickEpisodes(history)) {
    const f = dnum(ep.firstTs);
    if (f == null || a == null || a > f + horizonDays) continue;   // outside its life — never needed again
    const g = byKey.get(ep.key);
    if (g && g.resolved) continue;                                  // frozen — never needed again
    const have = g && g.measuredThrough ? dnum(g.measuredThrough) : f;
    want.push({ sym: ep.sym, lag: a - (have ?? f) });
  }
  want.sort((x, y) => y.lag - x.lag);
  const out = [];
  for (const w of want) if (!out.includes(w.sym)) out.push(w.sym);
  return out.slice(0, Math.max(0, cap));
}

/* CLI: print the grading universe for the producer's fetch step (see PRODUCER.md step 2).
   `node producer/pickgrade.mjs --symbols` → comma list · `--json` → the full graded ledger. */
if (import.meta.url === `file://${process.argv[1]}`) {
  const { readFileSync } = await import('node:fs');
  const { decryptEnvelope } = await import('./emit.mjs');
  const { etDate } = await import('./market.mjs');
  let data = null;
  try {
    const raw = JSON.parse(readFileSync(new URL('../data.json', import.meta.url), 'utf8'));
    data = raw && raw.ct ? await decryptEnvelope(raw, process.env.PF_PASSPHRASE) : raw;
  } catch { /* no snapshot / no passphrase → nothing to grade; print nothing and exit clean */ }
  const hist = (data && data.picks && data.picks.history) || [];
  const asOf = etDate(new Date());
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(gradeAll(hist, (data && data.hist && data.hist.day) || {}, { asOf, prior: data && data.picks && data.picks.grades }), null, 2));
  } else {
    console.log(gradingUniverse(hist, { asOf, grades: data && data.picks && data.picks.grades }).join(','));
  }
}
