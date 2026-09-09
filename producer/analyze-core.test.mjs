/* Offline unit checks for the Analyze page's PURE core — no network, no browser, no I/O beyond
   reading index.html. Run: node producer/analyze-core.test.mjs

   The functions under test live inside index.html's one big inline script, so they are EXTRACTED from
   that file by name and `new Function`-ed here rather than copied (the producer/finalists.test.mjs
   mirror pattern). A copy drifts silently, and this particular code decides what the app tells the
   owner to buy — the whole point of the 2026-09-09 rework was that nothing had ever measured it. */
import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
const ok = (label, cond) => { if (cond) pass++; else { fail++; console.error(`✗ ${label}`); } };

const SRC = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

// --- extraction -----------------------------------------------------------------------------------
// Balanced-brace grab from a `function NAME(` header. Every function pulled below is brace-balanced
// and carries no `{`/`}` inside a string literal; if one ever does, this test fails loudly rather
// than quietly testing a truncated body.
function grabFn(name) {
  const marker = `function ${name}(`;
  const i = SRC.indexOf(marker);
  if (i < 0) throw new Error(`index.html no longer defines ${name}()`);
  let depth = 0, j = SRC.indexOf('{', i);
  const open = j;
  for (; j < SRC.length; j++) {
    if (SRC[j] === '{') depth++;
    else if (SRC[j] === '}') { depth--; if (depth === 0) { j++; break; } }
  }
  if (depth !== 0) throw new Error(`unbalanced braces extracting ${name}()`);
  return SRC.slice(i, j) + (open < 0 ? '' : '');
}
function grabLine(re, what) {
  const m = SRC.match(re);
  if (!m) throw new Error(`index.html no longer contains ${what}`);
  return m[0];
}

const NAMES = ['calcRSI', '_smaN', '_stdevN', '_betaSeries', '_azNum', '_azStateScore', 'azCore', '_azScanLabels'];
const blob = [
  grabLine(/const _cl=\(v,lo,hi\)=>[^\n]*;/, 'the _cl clamp helper'),
  ...NAMES.map(grabFn),
].join('\n');
ok('every function under test was found in index.html', NAMES.every((n) => blob.includes(`function ${n}(`)));

const API = new Function(blob + '\nreturn {' + NAMES.join(',') + ',_cl};')();
const { azCore, _azScanLabels, _azStateScore, _azNum } = API;

// --- deterministic fixtures -----------------------------------------------------------------------
// Seeded LCG: the label distribution below has to be reproducible, or a red run means nothing.
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
function walk(seed, n, drift, vol, start) {
  const r = rng(seed), c = [start || 100];
  for (let i = 1; i < n; i++) {
    // Box-Muller-free: sum of two uniforms is close enough to a bell for a fixture.
    const z = (r() + r() - 1) * 2;
    c.push(Math.max(1, c[i - 1] * (1 + drift + vol * z)));
  }
  return c;
}
const ohlc = (c) => ({ h: c.map((v) => v * 1.01), l: c.map((v) => v * 0.99) });
const runCore = (c, opts) => { const { h, l } = ohlc(c); return azCore(c, h, l, c[c.length - 1], null, opts || {}); };

// --- 1. `_azNum` — the display-string guard (the "Rev growth: NaN%" bug) --------------------------
{
  ok('_azNum rejects the picks engine em-dash', _azNum('—') === null);
  ok('…and its other empty forms', _azNum('') === null && _azNum(null) === null && _azNum(undefined) === null && _azNum('None') === null);
  ok('…parses a formatted percent', _azNum('+16.2%') === 16.2 && _azNum('-4.5%') === -4.5);
  ok('…parses the trailing-P/E fallback string', _azNum('18.2 (ttm)') === 18.2);
  ok('…passes real numbers through and rejects NaN/Infinity',
    _azNum(3.5) === 3.5 && _azNum(NaN) === null && _azNum(Infinity) === null);
  // The bug was that parseFloat('—') is NaN and `NaN != null` is TRUE, so the UI rendered "NaN%".
  ok('…so an unscored revGrowth can never reach a .toFixed() call', !Number.isNaN(_azNum('—')));
}

// --- 2. "Oversold Bounce" is REACHABLE ------------------------------------------------------------
// It fired 0 times in 13,613 backtested reads: `sma50 = smaN(closes, min(50,len))` was never null, so
// `trendUp` was never null, and the downtrend branch claimed every rsi<30 bar first.
{
  // A long, steady climb (so the 50-day sits well below price) then a sharp week-long flush.
  const c = [];
  for (let i = 0; i < 90; i++) c.push(100 * Math.pow(1.004, i));
  for (let i = 0; i < 7; i++) c.push(c[c.length - 1] * 0.965);
  const a = runCore(c);
  ok('oversold flush inside an intact uptrend is RSI < 30', a.rsi != null && a.rsi < 30);
  ok('…and is labelled Oversold Bounce, not Caution — Downtrend', a.label === 'Oversold Bounce');
  ok('…with a positive tone and a capped confidence', a.tone === 'pos' && a.conf <= 70);
}

// --- 3. the other states are reachable too ---------------------------------------------------------
{
  const climb = []; for (let i = 0; i < 120; i++) climb.push(100 * Math.pow(1.006, i));
  const ext = runCore(climb);
  ok('a relentless melt-up reads as Extended — Wait for Pullback, not a buy',
    ext.label === 'Extended — Wait for Pullback' && ext.tone === 'neu');
  ok('…and "extended" is a state, not just an RSI reading', ext.extended === true);

  const fall = []; for (let i = 0; i < 120; i++) fall.push(200 * Math.pow(0.995, i));
  const dn = runCore(fall);
  ok('a sustained decline reads as Caution — Downtrend', dn.label === 'Caution — Downtrend' && dn.tone === 'neg');
  ok('…and trend is three-way, so trendUp is false here', dn.trend === 'down' && dn.trendUp === false);

  // "Hold / Watch" was unreachable before the re-gate (trendUp was always boolean, so the neutral
  // branch could never be entered). It needs price parked in the dead band under the 50-day with the
  // 20-day still above it, which is a real but narrow condition — so look for it across the walks
  // rather than hand-building a series that happens to land there.
  let hw = null;
  for (let s = 1; s <= 40 && !hw; s++) {
    const c = walk(s * 2654435761, 200, ((s % 5) - 2) * 0.001, 0.006 + (s % 4) * 0.003, 60);
    const states = _azScanLabels(c);
    for (let i = 60; i < states.length; i++) if (states[i] && states[i].label === 'Hold / Watch') { hw = states[i]; break; }
  }
  ok('a directionless tape reaches Hold / Watch (unreachable before the re-gate)', hw != null);
  ok('…and it is the genuinely neutral trend state', hw != null && hw.trend === 'neutral' && hw.tone === 'neu');
}

// --- 4. the distribution is not degenerate ---------------------------------------------------------
// 66% of the old sample landed on one label. A state machine that answers the same thing two times in
// three is not a read, it is a constant with a colour.
{
  const counts = {}; let total = 0;
  for (let s = 1; s <= 80; s++) {
    const drift = ((s % 7) - 3) * 0.0012, vol = 0.006 + (s % 5) * 0.004;
    const states = _azScanLabels(walk(s * 7919, 260, drift, vol, 50 + (s % 40)));
    for (let i = 60; i < states.length; i++) { const st = states[i]; if (!st) continue; counts[st.label] = (counts[st.label] || 0) + 1; total++; }
  }
  const share = Object.fromEntries(Object.entries(counts).map(([k, v]) => [k, v / total]));
  const top = Math.max(...Object.values(share));
  ok(`no single label takes more than 60% of reads (top ${(top * 100).toFixed(1)}%)`, top <= 0.6);
  ok('at least four of the six states actually occur', Object.keys(counts).length >= 4);
  ok('the sample is big enough to mean something', total > 10000);
}

// --- 5. the scanner is a TRUE mirror of azCore -----------------------------------------------------
// The "📏 Measured in this snapshot" figures come from _azScanLabels while the badge above them comes
// from azCore. If the two ever disagree the card is describing a rule the reader is not being shown —
// worse than showing no measurement at all.
{
  let checked = 0, mismatch = 0, setupOff = 0;
  for (let s = 1; s <= 12; s++) {
    const c = walk(s * 104729, 220, ((s % 5) - 2) * 0.001, 0.008 + (s % 4) * 0.003, 80);
    const states = _azScanLabels(c);
    for (const i of [25, 40, 55, 70, 95, 120, 150, 180, 210]) {
      if (i >= c.length || !states[i]) continue;
      const live = azCore(c.slice(0, i + 1), null, null, c[i], null, { dayChg: (c[i] / c[i - 1] - 1) * 100 });
      checked++;
      if (live.label !== states[i].label) mismatch++;
      if (Math.abs(live.setupTech - states[i].setupTech) > 1) setupOff++;
    }
  }
  ok(`the incremental scan reproduces azCore's label at every probe (${checked} probes)`, checked > 80 && mismatch === 0);
  ok('…and its technical setup score to within rounding', setupOff === 0);
}

// --- 6. stops sit inside [3%, 10%] and targets are decoupled from them ------------------------------
// Measured on the old rule: median stop 12.3% below price, 52% past 12%, and because tp1 was
// `price + k×(price−stop)` a looser stop inflated the target — tp1 hits paid +0.23R, expectancy ≈ 0R.
{
  let n = 0, outside = 0, noRR = 0, coupled = 0;
  for (let s = 1; s <= 60; s++) {
    // Deliberately includes very high-vol series — those are exactly what blew the old stop out.
    const c = walk(s * 15485863, 200, ((s % 5) - 2) * 0.0015, 0.004 + (s % 9) * 0.008, 30 + s);
    const a = runCore(c); n++;
    const dist = (a.price - a.stop) / a.price;
    if (dist < 0.0299 || dist > 0.1001) outside++;
    if (a.rr == null || !isFinite(a.rr)) noRR++;
    // A structural tp1 must not be a fixed multiple of the stop distance for every single name.
    const mult = (a.tp1 - a.price) / (a.price - a.stop);
    if (Math.abs(mult - 1.6) < 1e-6 || Math.abs(mult - 1.8) < 1e-6) coupled++;
  }
  ok(`every stop lands inside [3%,10%] below price (${n} series)`, outside === 0);
  ok('every read carries a computed reward:risk', noRR === 0);
  ok('tp1 is structural, not a fixed multiple of the stop distance', coupled === 0);
  const sharp = runCore([...Array(80)].map((_, i) => 100 * Math.pow(1.005, i)));
  ok('the invalidation price sits just under the stop', sharp.invalid < sharp.stop && sharp.invalid > sharp.stop * 0.99);
  ok('rrOk is the 1.5 bar the Recommendation downgrades on',
    sharp.rr != null && sharp.rrOk === (sharp.rr >= 1.5));
}

// --- 7. sparse / absent history degrades honestly ---------------------------------------------------
{
  const tiny = azCore([10, 11, 12], null, null, 12, null, {});
  ok('under 20 bars there is no technical read', tiny.hasTA === false && tiny.label === 'Limited Data');
  ok('…but the card still gets levels to render an invalidation line',
    tiny.stop > 0 && tiny.tp1 > tiny.price && tiny.price === 12 && tiny.invalid > 0);
  const none = azCore([], null, null, 0, null, {});
  ok('a priceless symbol yields nothing rather than NaN levels', none.hasTA === false && none.stop === null);
  const short = walk(42, 40, 0.003, 0.01, 100);
  const sc = runCore(short);
  ok('20–49 bars scores off the 20-day slope and SAYS so',
    sc.hasTA === true && sc.sma50 === null && /20-day slope/.test(sc.trendBasis));
  ok('…and 50+ bars switches the basis to the 50-day average',
    /50-day average/.test(runCore(walk(42, 120, 0.003, 0.01, 100)).trendBasis));
}

// --- 8. the fundamentals blend only applies when there IS a fundamentals score ----------------------
{
  const c = walk(777, 150, 0.002, 0.009, 120);
  const bare = runCore(c), rich = runCore(c, { fund: 90 }), poor = runCore(c, { fund: 10 });
  ok('a fundamentals score moves the displayed setup', rich.setup > bare.setup && poor.setup < bare.setup);
  ok('…but never the technical state the label and the measurement share',
    rich.setupTech === bare.setupTech && poor.setupTech === bare.setupTech && rich.label === bare.label);
}

// --- 9. the staleness gate, extracted from index.html itself ---------------------------------------
// azHist/analyzeStock touch window.__DATA and cannot be run here, so the RULE is pulled out of the
// source and exercised directly. This is the check that stops the gate being quietly removed.
{
  const consts = grabLine(/const AZ_SPLICE_MAX_DAYS=\d+, AZ_FRESH_DAYS=\d+, AZ_AGING_DAYS=\d+;/, 'the AZ_* staleness constants');
  const qline = grabLine(/const quality=!bars\.length\?'none':[^\n]*?;/, "azHist's quality ladder");
  const qual = new Function('bars', 'age', consts + '\n' + qline + '\nreturn quality;');
  ok('a same-day series is fresh', qual([1], 0) === 'fresh');
  ok('three days old is still fresh', qual([1], 3) === 'fresh');
  ok('a week old is aging, not stale', qual([1], 7) === 'aging');
  ok('past ten days it is STALE', qual([1], 11) === 'stale' && qual([1], 60) === 'stale');
  ok('an undated series fails safe to stale', qual([1], null) === 'stale');
  ok('no bars at all is its own case', qual([], 0) === 'none');

  const splice = grabLine(/if\(bars\.length&&asOf&&age!=null&&age>0&&age<=AZ_SPLICE_MAX_DAYS&&price>0\)/, "azHist's splice condition");
  ok('the live quote is spliced only onto a series fresh enough to carry it', /age<=AZ_SPLICE_MAX_DAYS/.test(splice));
  ok('…and the spliced bar is tagged live:true so closing-basis readers drop it',
    /\{c:price,h:price,l:price,v:0,t:asOf,live:true\}/.test(SRC));
  // v140 moved the Track Record's close walk into `_pkCloses` (gradePick reads through it); the
  // invariant is the same — the spliced intraday print must never grade a pick.
  ok('the Track Record grader still excludes the spliced bar',
    /function _pkCloses\(bars\)\{[\s\S]{0,200}if\(!b\|\|b\.interpolated\|\|b\.live\)continue;/.test(SRC));
  ok('the measured-edge walk-forward excludes it too', /azHist\(sym\)\.bars\.filter\(b=>!b\.live\)/.test(SRC));

  ok('analyzeStock withholds technicals on a stale series',
    /const hasTA=closes\.length>=20&&!stale;/.test(SRC));
  ok('…and stale is exactly the quality ladder\'s two abstaining states',
    /const quality=HS\.quality, dataAge=HS\.age, stale=\(quality==='stale'\|\|quality==='none'\);/.test(SRC));
  ok('an aging series is haircut rather than withheld',
    /if\(hasTA&&quality==='aging'\)conf=_cl\(conf\*AZ_AGING_CONF,20,92\);/.test(SRC));
}

// --- 10. the measured-edge fold is bounded and abstains when thin ------------------------------------
{
  ok('the measurement has a minimum sample before it may move confidence', /const AZ_EDGE_MIN_N=30/.test(SRC));
  ok('…and a thin state adjusts nothing', /if\(!e\.thin&&e\.alpha20!=null\)/.test(SRC));
  ok('…while a losing state costs 10 points and a winning one gains 5',
    /if\(e\.alpha20<=-1\)conf=_cl\(conf-10,20,92\); else if\(e\.alpha20>=1\)conf=_cl\(conf\+5,20,92\);/.test(SRC));
  // The overlap caveat is the honesty of the whole feature — n is signal-days, not trials.
  ok('the card discloses that the forward windows overlap', /signal-days, not independent trials/.test(SRC));
}

// --- 11. the ±1σ band and the options play quote the same horizon ------------------------------------
{
  ok('scenarios take a DTE rather than hardcoding 30', /function azScenarios\(a,ivInfo,dteIn\)/.test(SRC));
  ok('…and runAnalysis hands them the options play\'s own DTE', /azScenarios\(a,ivInfo,oplay\?oplay\.dte:null\)/.test(SRC));
  ok('a trailing multiple is never labelled "Fwd P/E"', /a\.fwdPEBasis==='ttm'\?'P\/E \(ttm\)':'Fwd P\/E'/.test(SRC));
}

console.log(`\nanalyze-core.test: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
