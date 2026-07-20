// Offline unit checks for the picks scoring engine + the pure social shaper — no network.
// Run: node producer/picks.test.mjs
import { scanRows, selectFinalists, buildPicks, trendGate, DOWNTREND_PENALTY, gradePickClose, recentStopCooldown, COOLDOWN_PENALTY } from './picks.mjs';
import { shapeSocial } from './social.mjs';

let pass = 0, fail = 0;
const eq = (label, got, want) => { const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.error(`✗ ${label}\n    got  ${g}\n    want ${w}`); } };

// --- scanRows / selectFinalists ---
const scanFix = { data: { result: { results: [
  { ticker: 'AAA', columns: { Name: 'Aaa Inc', Last: '50', RSI: '40', 'Market cap': '20000000000', '% Change': '-2' } },
  { ticker: 'BBB', columns: { Name: 'Bbb Inc', Last: '80', RSI: '30', 'Market cap': '50000000000', '% Change': '-4' } },
  { ticker: 'CCC', columns: { Name: 'Ccc Inc', Last: '20', RSI: '35', 'Market cap': '12000000000', '% Change': '-1' } },
  { ticker: 'BAD', columns: { Name: 'No price', Last: '0', RSI: '20' } },          // dropped: price 0
  { columns: { Name: 'No ticker', Last: '10', RSI: '22' } },                        // dropped: no ticker
] } } };
eq('scanRows keeps valid rows only', scanRows(scanFix).map((r) => r.ticker), ['AAA', 'BBB', 'CCC']);
eq('scanRows parses numbers', scanRows(scanFix)[0].price, 50);
eq('selectFinalists = lowest RSI first', selectFinalists(scanFix, 2), ['BBB', 'CCC']);

// --- buildPicks component + composite math (hand-computed expectations) ---
// tech: rsiPart=(52-30)/2.7=8.148; pos=(100-90)/(150-90)=0.167 → rangePart=8.333; blend→round(8.204)=8
// fund: 5 +2(pe<15) +1(pb<3) +0.5(div>1) = 8.5 → round 9
// levels: entryLo 97, stop min(91, 90.9)=90.9, headroom 50 → tp1 100+min(25,10)=110
//         rr=(110−97)/(97−90.9)=2.131 → rrScore round(5.33)=5
// social untracked → 5
// composite = 8*.33 + 9*.28 + 5*.19 + 5*.20 = 7.11
const finalist = { ticker: 'AAA', name: 'Aaa Inc', price: 100, rsi: 30, marketCap: 5e10 };
const fund = { pe_ratio: '12', pb_ratio: '2', dividend_yield: '1.5', high_52_weeks: '150', low_52_weeks: '90', sector: 'Technology' };
{
  const out = buildPicks([finalist], { AAA: fund }, {}, {});
  const c = out.candidates[0];
  eq('tech score', c.tech, 8);
  eq('fund score (value-only)', c.fund, 9);
  eq('rr score', c.rrScore, 5);
  eq('social neutral 5 when untracked', c.social, 5);
  eq('composite = .33/.28/.19/.20 blend', c.composite, 7.11);
  eq('coverage flags: no AV growth, no social, rr present', c.cov, { growth: false, social: false, rr: true });
  eq('buzz label when quiet', c.buzz, 'Quiet');
  const p = out.picks[0];
  eq('signal BUY at composite ≥ 7', p.signal, 'BUY');
  eq('pick stop from levels', p.sl.price, 90.9);
  eq('pick tp1 from levels', p.tp1.price, 110);
}

// --- social sub-score: tracked buzz lifts the composite by exactly its 20% weight ---
// att=(200−10)/200=0.95; volOK=1; vel=clamp(150/300)=0.5 → social=5+2.85+0.75=8.6 → composite 7.83
{
  const socT = { tracked: true, rank: 10, mentions: 100, mentionChg: 150 };
  const out = buildPicks([finalist], { AAA: fund }, {}, { AAA: socT });
  eq('social score from rank+velocity', out.candidates[0].social, 8.6);
  eq('composite lifts by 0.2×(social−5)', out.candidates[0].composite, 7.83);
  eq('buzz label high', out.candidates[0].buzz, 'High buzz');
  eq('cov.social true when tracked', out.candidates[0].cov.social, true);
}
// crowding cap: top-5 rank capped at 7
{
  const out = buildPicks([finalist], { AAA: fund }, {}, { AAA: { tracked: true, rank: 3, mentions: 500, mentionChg: 400 } });
  eq('top-5 crowding cap at 7', out.candidates[0].social, 7);
  eq('buzz label crowded', out.candidates[0].buzz, 'Crowded');
}

// --- AV growth enrichment flips cov.growth and feeds fundScore ---
{
  const ov = { Symbol: 'AAA', Sector: 'Technology', QuarterlyRevenueGrowthYOY: '0.25', ForwardPE: '18' };
  const out = buildPicks([finalist], { AAA: fund }, { AAA: ov }, {});
  // fund: 8.5 +2(revGrowth 25%>20) +1(fwdPE<20) = 11.5 → clamp 10
  eq('fund score with AV growth', out.candidates[0].fund, 10);
  eq('cov.growth true with AV', out.candidates[0].cov.growth, true);
  eq('revGrowth formatted', out.candidates[0].revGrowth, '+25.0%');
}

// --- sector diversification: top picks cap at 2 per sector, backfilled from the ranking ---
{
  const mk = (t, rsi, sector) => [{ ...finalist, ticker: t, name: t, rsi }, { ...fund, sector }];
  const rows = [mk('T1', 28, 'Technology'), mk('T2', 29, 'Technology'), mk('T3', 30, 'Technology'), mk('E1', 44, 'Energy')];
  const finals = rows.map((r) => r[0]);
  const funds = Object.fromEntries(rows.map((r) => [r[0].ticker, r[1]]));
  const out = buildPicks(finals, funds, {}, {});
  const pickSyms = out.picks.map((p) => p.ticker).sort();
  eq('picks: max 2 per sector + backfill from other sectors', pickSyms, ['E1', 'T1', 'T2']);
  eq('candidates table stays composite-ranked (uncapped)', out.candidates.map((c) => c.ticker), ['T1', 'T2', 'T3', 'E1']);
}

// --- momentum / trend gate ---
{
  // MA structure: price below 200-DMA AND 50 < 200 → confirmed downtrend
  eq('MA death-cross below 200 → downtrend', trendGate({ price: 100, sma50: 110, sma200: 130 }).downtrend, true);
  // below 200 but 50 above 200 (recovering) → not a confirmed downtrend
  eq('below 200 but 50>200 → not downtrend', trendGate({ price: 100, sma50: 135, sma200: 130 }).downtrend, false);
  // above the 200-DMA → uptrend, never gated regardless of how far off a spike high
  eq('above 200-DMA → not downtrend', trendGate({ price: 140, sma50: 120, sma200: 130, pctOffHigh: -60 }).downtrend, false);
  // no MA data → fall back to distance off the 52wk high
  eq('fallback: 63% off high → downtrend', trendGate({ pctOffHigh: -63 }).downtrend, true);
  eq('fallback: 33% off high → not downtrend (normal pullback)', trendGate({ pctOffHigh: -33 }).downtrend, false);
}
// A confirmed downtrend is docked in the composite AND excluded from the highlighted top picks.
{
  // price 100, 52wk high 260 → -61.5% off high (no MA) → downtrend; base composite would be BUY-grade.
  const dt = { ticker: 'FALL', name: 'Falling Knife', price: 100, rsi: 22, marketCap: 5e10 };
  const dtFund = { pe_ratio: '12', pb_ratio: '2', dividend_yield: '1.5', high_52_weeks: '260', low_52_weeks: '95', sector: 'Energy' };
  const clean = { ticker: 'DIP', name: 'Healthy Dip', price: 100, rsi: 30, marketCap: 5e10 };
  const out = buildPicks([dt, clean], { FALL: dtFund, DIP: fund }, {}, {});
  const fall = out.candidates.find((c) => c.ticker === 'FALL');
  eq('downtrend flagged on the candidate', fall.downtrend, true);
  eq('downtrend flag label', fall.flag, 'Downtrend');
  eq('downtrend name excluded from top picks', out.picks.map((p) => p.ticker).includes('FALL'), false);
  eq('healthy dip still a top pick', out.picks.map((p) => p.ticker).includes('DIP'), true);
  // composite = base(tech.7*.33+... ) minus the penalty; confirm the dock is applied (FALL < DIP despite lower RSI).
  eq('downtrend docks composite below the clean name', fall.composite < out.candidates.find((c) => c.ticker === 'DIP').composite, true);
}
// AV moving averages, when present, take precedence over the 52wk-high fallback.
{
  const dt = { ticker: 'MAD', name: 'MA Downtrend', price: 100, rsi: 28, marketCap: 5e10 };
  const ov = { Symbol: 'MAD', Sector: 'Technology', '50DayMovingAverage': '115', '200DayMovingAverage': '140' };
  const out = buildPicks([dt], { MAD: fund }, { MAD: ov }, {});
  eq('MA-based downtrend flagged', out.candidates[0].downtrend, true);
  eq('MA-based downtrend excluded from picks', out.picks.length, 0);
}

// --- recent stop-out cooldown (gradePickClose + recentStopCooldown) ---
{
  // closing-basis grade: a close ≤ stop is a stop-out; ≥ tp1 banks; ≥ tp2 wins.
  const pk = { ticker: 'X', tp1: 110, tp2: 120, sl: 95 };
  eq('grade STOPPED when a close breaches the stop', gradePickClose(pk, [{ t: '2026-07-01', c: 100 }, { t: '2026-07-02', c: 94 }], '2026-07-01'), 'STOPPED');
  eq('grade TP1 when a close reaches the first target', gradePickClose(pk, [{ t: '2026-07-01', c: 100 }, { t: '2026-07-02', c: 112 }], '2026-07-01'), 'TP1');
  eq('grade TP2 wins outright', gradePickClose(pk, [{ t: '2026-07-01', c: 121 }], '2026-07-01'), 'TP2');
  eq('grade OPEN while between levels', gradePickClose(pk, [{ t: '2026-07-01', c: 103 }], '2026-07-01'), 'OPEN');
  eq('grade ignores bars before the scan date', gradePickClose(pk, [{ t: '2026-06-01', c: 90 }, { t: '2026-07-02', c: 103 }], '2026-07-01'), 'OPEN');
  eq('grade accepts raw RH bar shape', gradePickClose(pk, [{ begins_at: '2026-07-02', close_price: 94 }], '2026-07-01'), 'STOPPED');

  // cooldown: a name stopped out inside the window is benched with a future `until`.
  const hist = [
    { ts: '2026-07-13', date: 'July 13, 2026', picks: [{ ticker: 'ORCL', tp1: 150, tp2: 160, sl: 128 }] },
    { ts: '2026-07-10', date: 'July 10, 2026', picks: [{ ticker: 'ORCL', tp1: 150, tp2: 160, sl: 127 }] },
    { ts: '2026-06-01', date: 'June 1, 2026', picks: [{ ticker: 'OLD', tp1: 150, tp2: 160, sl: 128 }] },   // outside window
  ];
  const bars = { ORCL: [{ t: '2026-07-14', c: 120 }], OLD: [{ t: '2026-06-02', c: 100 }] };
  const cd = recentStopCooldown(hist, bars, { asOf: '2026-07-19' });
  eq('recent stop-out benched', !!cd.ORCL, true);
  eq('cooldown until = scan date + 14 calendar days', cd.ORCL.until, '2026-07-27');
  eq('cooldown keeps the most-recent stop-out (Jul 13, not Jul 10)', cd.ORCL.date, '2026-07-13');
  eq('a stop-out outside the window is NOT benched', cd.OLD, undefined);
  eq('an elapsed cooldown drops off once asOf passes `until`', recentStopCooldown(hist, bars, { asOf: '2026-08-01' }).ORCL, undefined);
  eq('empty history → empty cooldown', recentStopCooldown([], {}, { asOf: '2026-07-19' }), {});

  // averaging-down backstop: NO bars to confirm the stop-out, but today's scan price is at/below the recent
  // pick's published stop → still benched (chasing a knife down), even without a graded close.
  const cd2 = recentStopCooldown(hist, {}, { asOf: '2026-07-19', priceBySym: { ORCL: 124 } });   // 124 < Jul-13 stop 128
  eq('below-prior-stop scan price benches even with no bars', !!cd2.ORCL, true);
  eq('averaging-down reason names the chase', /chasing down/.test(cd2.ORCL.reason), true);
  eq('a scan price ABOVE the prior stop (no bars) is NOT benched', recentStopCooldown(hist, {}, { asOf: '2026-07-19', priceBySym: { ORCL: 140 } }).ORCL, undefined);
}
// --- cooldown gate in buildPicks: benched from picks[], docked in candidates, flagged ---
{
  const clean = { ticker: 'DIP', name: 'Healthy Dip', price: 100, rsi: 30, marketCap: 5e10 };
  const hot = { ticker: 'BURN', name: 'Just Stopped', price: 100, rsi: 28, marketCap: 5e10 };
  const cd = { BURN: { until: '2026-12-31', date: '2026-07-13', reason: 'stopped out Jul 13 · cooling 10d' } };
  const out = buildPicks([hot, clean], { BURN: fund, DIP: fund }, {}, {}, cd);
  const burn = out.candidates.find((c) => c.ticker === 'BURN');
  eq('cooldown flagged on the candidate', burn.cooldown, true);
  eq('cooldown flag label', burn.flag, 'Recent stop-out');
  eq('cooldown carries a note', burn.cooldownNote, 'stopped out Jul 13 · cooling 10d');
  eq('recently-stopped name excluded from top picks', out.picks.map((p) => p.ticker).includes('BURN'), false);
  eq('clean name still a top pick', out.picks.map((p) => p.ticker).includes('DIP'), true);
  eq('cooldown docks composite below the clean name', burn.composite < out.candidates.find((c) => c.ticker === 'DIP').composite, true);
  // no cooldown map → unchanged behavior (both eligible)
  const out2 = buildPicks([hot, clean], { BURN: fund, DIP: fund }, {}, {});
  eq('without a cooldown map both names are pickable', out2.picks.map((p) => p.ticker).sort(), ['BURN', 'DIP']);
}

// --- shapeSocial (pure — the half of social.mjs both producers reuse) ---
{
  const pages = { asOf: '2026-07-02T14:00:00.000Z', source: 'apewisdom', rows: [
    { ticker: 'nvda', name: 'NVIDIA', rank: '1', mentions: '900', mentions_24h_ago: '450', upvotes: '100', sentiment: null },
    { ticker: 'AAA', name: 'Aaa Inc', rank: '40', mentions: '60', mentions_24h_ago: '80' },
  ] };
  const s = shapeSocial(pages, ['AAA', 'ZZZ']);
  eq('shapeSocial universe', s.universe, 2);
  eq('shapeSocial preserves fetch asOf', s.asOf, '2026-07-02T14:00:00.000Z');
  eq('wanted+tracked', s.tickers.AAA.tracked, true);
  eq('mention velocity %', s.tickers.AAA.mentionChg, -25);
  eq('wanted+untracked → tracked:false', s.tickers.ZZZ, { tracked: false });
  eq('trending head is rank 1 (case-normalized)', s.trending[0].t, 'NVDA');
  eq('shapeSocial(null) → null', shapeSocial(null, ['AAA']), null);
  eq('shapeSocial(empty rows) → null', shapeSocial({ rows: [] }, ['AAA']), null);
}

console.log(fail ? `\n${fail} FAILED (${pass} passed)` : `all ${pass} checks passed ✅`);
process.exit(fail ? 1 : 0);
