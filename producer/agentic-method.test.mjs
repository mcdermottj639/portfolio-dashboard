/* Construction-note formatter (index.html, v144) — the Plan tab's "How this target was built".
 *
 * The formatter turns `agentic-target.json`'s `method` — the synthesis's prose plus the
 * deterministic tail finalize-target.mjs appends — into something scannable. It is allowed to
 * CHUNK and EMPHASIZE and nothing else, so the test that carries the weight here is the
 * losslessness one: strip whitespace, tags and the '|' delimiters out of the rendered HTML and it
 * must equal the source byte for byte. A formatter that may paraphrase is a card that asserts
 * something the research did not say.
 *
 * Like analyze-core.test.mjs and finalists.test.mjs, this extracts the REAL functions out of
 * index.html rather than re-stating them — a consumer file cannot import a repo module, and a
 * hand-copied mirror is how the two silently drift.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

let pass = 0; const fails = [];
const ok = (name, cond, got, want) => {
  if (cond) { pass++; return; }
  fails.push({ name, got, want });
};
const eq = (name, got, want) => ok(name, Object.is(got, want) || JSON.stringify(got) === JSON.stringify(want), got, want);

// ── extract the formatter verbatim ────────────────────────────────────────────────────────────
function grab(re, what) {
  const m = SRC.match(re);
  if (!m) throw new Error(`could not extract ${what} from index.html — did it get renamed?`);
  return m[0];
}
const src = [
  grab(/function agEsc\(s\)\{[\s\S]*?\n\}/, 'agEsc'),
  grab(/var AG_METHOD_KINDS=\[[\s\S]*?\n\];/, 'AG_METHOD_KINDS'),
  grab(/function agMethodParts\(method\)\{[\s\S]*?\n\}/, 'agMethodParts'),
  grab(/function agProseLines\(text\)\{[\s\S]*?\n\}/, 'agProseLines'),
  grab(/function agEmph\(escaped,vocab\)\{[\s\S]*?\n\}/, 'agEmph'),
  grab(/function agMethodHtml\(T\)\{[\s\S]*?\n\}/, 'agMethodHtml'),
].join('\n');
// `fmt` is the app's shared number formatter; the header pills are its only use here.
const fmt = (n, d = 2) => (+n).toFixed(d);
const { agMethodParts, agProseLines, agEmph, agMethodHtml, agEsc } =
  new Function('fmt', src + '\nreturn {agMethodParts,agProseLines,agEmph,agMethodHtml,agEsc};')(fmt);

// ── the live committed target, so the test tracks what actually ships ─────────────────────────
const TARGET = JSON.parse(fs.readFileSync(path.join(ROOT, 'producer', 'agentic-target.json'), 'utf8'));

// Text as the reader sees it: tags removed, entities restored, whitespace and '|' collapsed away.
const readable = (html) => html
  .replace(/<[^>]*>/g, ' ')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/[\s|]/g, '');
const bare = (s) => String(s).replace(/[\s|]/g, '');

/* ── THE INVARIANT ─────────────────────────────────────────────────────────────────────────────
   Everything in `method` reaches the reader. The header pills and section labels ADD text, so the
   rendered output is a superset — the check is that the source survives as a subsequence of it,
   which is what "chunk and emphasize, never rewrite" actually means. */
{
  const html = agMethodHtml(TARGET);
  const out = readable(html), want = bare(TARGET.method);
  // every character of the source, in order, present in the output
  let i = 0; for (const ch of want) { i = out.indexOf(ch, i); if (i < 0) break; i++; }
  ok('live target: every character of method survives rendering, in order', i >= 0, i, '>=0');
  ok('live target: no method text is dropped wholesale',
    out.length >= want.length, out.length, `>= ${want.length}`);
  // the prose itself is verbatim, not merely subsequenced
  const P = agMethodParts(TARGET.method);
  ok('live target: prose reassembles verbatim from its lines',
    bare(agProseLines(P.summary).join(' ')) === bare(P.summary));
  ok('live target: every tail segment is rendered',
    P.blocks.every((b) => out.includes(bare(b.lead + b.rest))));
}

// ── segmentation ──────────────────────────────────────────────────────────────────────────────
{
  const P = agMethodParts(TARGET.method);
  eq('live target: prose + 4 deterministic tail segments', P.blocks.length, 4);
  eq('live target: caps segment classified', P.blocks[0].icon, '⚖️');
  eq('live target: phase-out segment classified', P.blocks[1].icon, '🔁');
  eq('live target: gold segment classified', P.blocks[2].icon, '🥇');
  eq('live target: entry-bar segment classified', P.blocks[3].icon, '🎯');
  eq('lead-in is the matched prefix, so no words are duplicated into a heading',
    P.blocks[1].lead, 'phase-out retained');
}
{
  // An unfamiliar future segment must render plainly, never vanish. This is the failure mode that
  // matters: finalize-target gains a segment, and a formatter keyed on a fixed count eats it.
  const P = agMethodParts('prose here. | brand new segment nobody has seen');
  eq('unknown segment survives', P.blocks.length, 1);
  eq('unknown segment carries a neutral marker', P.blocks[0].icon, '·');
  eq('unknown segment text is untouched', P.blocks[0].rest, 'brand new segment nobody has seen');
  eq('unknown segment invents no lead-in', P.blocks[0].lead, '');
}
{
  eq('a method with no tail still yields its prose', agMethodParts('just prose').summary, 'just prose');
  eq('an empty method yields nothing rather than an empty shell', agMethodParts(''), null);
  eq('a null method yields nothing', agMethodParts(null), null);
}

// ── prose fragmentation ───────────────────────────────────────────────────────────────────────
{
  // The drop list is one semicolon-joined sentence; splitting on full stops alone leaves it whole,
  // which is the single densest part of the note and the part most often scanned.
  const drops = 'Drops and why: SPY exits because A; GLDM exits because B; KO exits because C.';
  const lines = agProseLines(drops);
  eq('a semicolon-joined drop list becomes one line per drop', lines.length, 3);
  ok('punctuation stays on the fragment it ends', lines[0].endsWith(';'), lines[0], 'ends with ;');
  ok('fragmentation is lossless', bare(lines.join(' ')) === bare(drops));
}
{
  // A decimal is not a sentence boundary — "13.0%" and "0.25 and" must not split.
  const l = agProseLines('NVDA 13.0% and a 0.25 range/price carry size. Then V 11.5% follows.');
  eq('a decimal does not split a sentence', l.length, 2);
  ok('the decimal survives intact', l[0].includes('13.0%') && l[0].includes('0.25'));
}
{
  eq('empty prose yields no lines', agProseLines('').length, 0);
}

// ── emphasis ──────────────────────────────────────────────────────────────────────────────────
{
  const vocab = ['NVDA', 'SPY', 'V'];
  const out = agEmph(agEsc('NVDA 13.0% and SPY 6.0%, RSI 28.8 AFTER the COHORT median'), vocab);
  // Two weights, deliberately: the ticker is the scan anchor, the figure only confirms it. Bolding
  // both equally lit up half the paragraph and left the eye nowhere to land.
  ok('a target ticker is the bold anchor', out.includes('<b>NVDA</b>'), out);
  ok('a percentage takes the lighter figure weight, not bold',
    out.includes('<span class="ag-mn">13.0%</span>') && !out.includes('<b>13.0%</b>'), out);
  // The whole reason the vocabulary comes from the target instead of a [A-Z]{2,5} guess.
  ok('RSI is not mistaken for a ticker', !out.includes('<b>RSI</b>'), out);
  ok('AFTER is not mistaken for a ticker', !out.includes('<b>AFTER</b>'), out);
  ok('COHORT is not mistaken for a ticker', !out.includes('<b>COHORT</b>'), out);
  // A one-letter ticker must not bold the 'V' inside another word.
  const v = agEmph(agEsc('V and VTI and EVENT and V.'), ['V', 'VTI']);
  ok('a single-letter ticker does not match inside a word', !/EV<b>/.test(v) && !v.includes('<b>V</b>TI'), v);
  ok('the longer ticker still matches', v.includes('<b>VTI</b>'), v);
  ok('emphasis is lossless', bare(readable(out)) === bare('NVDA 13.0% and SPY 6.0%, RSI 28.8 AFTER the COHORT median'));
  // The ticker pass runs over output that already carries figure spans; an uppercase-only
  // vocabulary is what keeps it out of the lowercase class attribute it would otherwise corrupt.
  ok('emphasis never matches inside its own markup', !/class="ag-<b>/.test(out) && /class="ag-mn"/.test(out), out);
}
{
  // Escaping runs first, so markup in the note can never reach innerHTML as markup. The old render
  // interpolated `method` raw.
  const out = agEmph(agEsc('a <script>alert(1)</script> 5% note'), []);
  ok('markup in the note is escaped, not executed', !/<script/i.test(out), out);
  ok('the escaped text is still readable', readable(out).includes('alert(1)'), readable(out));
}
{
  eq('no vocabulary still marks percentages', agEmph('5.0%', []), '<span class="ag-mn">5.0%</span>');
  eq('a pp figure is marked too', agEmph('2.5pp', []), '<span class="ag-mn">2.5pp</span>');
  // 'pp' carries a word boundary so a unit that merely starts with it is left alone.
  eq('ppm is not read as percentage points', agEmph('5.0ppm', []), '5.0ppm');
}

// ── the authoritative header ──────────────────────────────────────────────────────────────────
{
  const html = agMethodHtml(TARGET);
  const act = TARGET.names.filter((n) => !n.phaseOut).length;
  const ph = TARGET.names.length - act;
  ok('header states the active/phase-out split the prose does not',
    html.includes(`${act} active`) && html.includes(`${ph} phase-out`), readable(html).slice(0, 200));
  // The prose's own figures can predate the final pass; these fields cannot.
  ok('header reports the authoritative defensive total',
    html.includes(`${TARGET.defensive.total.toFixed(1)}%`), TARGET.defensive.total);
  ok('header reports the authoritative diversifier',
    html.includes(`${TARGET.diversifier.direct.toFixed(1)}%`), TARGET.diversifier.direct);
}
{
  // A target with no structured blocks must still render its note rather than throwing.
  const bareT = { method: 'prose only. | entry bands measured against X', names: [] };
  const html = agMethodHtml(bareT);
  ok('a target with no names/defensive/diversifier still renders', html.length > 0);
  ok('…and still shows its tail segment', readable(html).includes(bare('entry bands measured against X')));
  eq('no method yields no block', agMethodHtml({ names: [] }), '');
  eq('no target yields no block', agMethodHtml(null), '');
}

// ── report ────────────────────────────────────────────────────────────────────────────────────
for (const f of fails) {
  console.log(`✗ ${f.name}`);
  if (f.got !== undefined) console.log(`    got  ${JSON.stringify(f.got)}`);
  if (f.want !== undefined) console.log(`    want ${JSON.stringify(f.want)}`);
}
console.log(`\n${fails.length ? `${fails.length} FAILED (${pass} passed)` : `${pass} passed`}`);
process.exit(fails.length ? 1 : 0);
