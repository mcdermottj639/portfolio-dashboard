#!/usr/bin/env node
/**
 * privacy-audit.mjs — does 🙈 private mode actually hide the account?
 *
 * WHY THIS EXISTS. Privacy mode shipped as a text walk over #page-portfolio that
 * matched "$<digit>" and blurred it. Every other tab renders account figures too —
 * the Plan tab's Action Center (loan, buying power, ticket dollars), the whole
 * agentic plan, the Options tab's own contracts, the Analyze page's "Your Position" —
 * and none of them were touched. Audited on the sample snapshot the toggle read as
 * ON while leaking 100+ values across four tabs. A leak is INVISIBLE to the owner
 * (the numbers look normal; only the audience sees more than intended), so it needs
 * a machine to notice, not an eyeball.
 *
 * WHAT IT ASSERTS — the same three-region contract index.html implements
 * (`data-priv`, nearest ancestor wins):
 *   on      no money, quantity, leverage multiple or account last-4 may be readable
 *   market  $ is a PRICE and stays readable; quantities/multiples/last-4 must not
 *   off     nothing is checked (Markets tab, standing rulebook, help text)
 * A value counts as leaked when it is on screen, not inside a .priv-m token and not
 * behind a .priv-blur chart. Percentages are never checked — they are the point of
 * showing the app and reveal no balance.
 *
 * RUN IT (needs a browser; NOT part of the offline `producer/*.test.mjs` suite):
 *   env -u PF_PASSPHRASE PF_SAMPLE_MARGIN=1 PF_SAMPLE_DRAWDOWN=soft \
 *     node producer/make-sample-data.mjs      # plaintext fixture, exercises margin + the breaker
 *   node producer/privacy-audit.mjs           # PF_CHROME=/path/to/chrome if not bundled
 *   git checkout origin/main -- data.json     # ALWAYS — never commit a plaintext snapshot
 * Exits non-zero listing every leak. Chart.js is stubbed: the CDN is unreachable
 * offline and without it renderAgenticPlan throws, which silently audits nothing.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PF_AUDIT_PORT || 8791);

/* playwright is deliberately NOT a dependency of this repo (the offline test suite must
   stay dependency-free). Resolve it from wherever it happens to live: PF_PLAYWRIGHT can
   point at an install in a scratch dir. */
let chromium;
for (const spec of [process.env.PF_PLAYWRIGHT, 'playwright'].filter(Boolean)) {
  try { ({ chromium } = await import(spec)); break; } catch {}
}
if (!chromium) { console.error('playwright not found. `npm i playwright` somewhere, then PF_PLAYWRIGHT=/that/path/node_modules/playwright/index.mjs node producer/privacy-audit.mjs'); process.exit(2); }

const MIME = { '.html':'text/html', '.js':'text/javascript', '.json':'application/json', '.css':'text/css', '.webmanifest':'application/manifest+json', '.png':'image/png', '.svg':'image/svg+xml' };
const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
  const file = path.join(ROOT, rel);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('nope'); }
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise(r => server.listen(PORT, r));

/* Chart.js comes from a CDN with an SRI hash, so it can neither be fetched offline nor
   route-substituted (the stub would fail the integrity check). Defining window.Chart in
   an init script wins instead: the blocked CDN script never overwrites it. */
const CHART_STUB = `(function(){function C(c,cfg){this.canvas=c;this.config=cfg||{};this.data=(cfg&&cfg.data)||{};this.options=(cfg&&cfg.options)||{};}
C.prototype.destroy=function(){};C.prototype.update=function(){};C.prototype.resize=function(){};C.prototype.getDatasetMeta=function(){return{data:[]};};
C.defaults={font:{family:'sans-serif'},color:'#000',plugins:{legend:{labels:{}},tooltip:{}},scale:{grid:{},ticks:{}},scales:{},elements:{point:{},line:{}},datasets:{}};
C.register=function(){};C.registry={};C.helpers={};window.Chart=C;})();`;

const SCAN = `(() => {
  const MONEY=/(-?\\$\\s?\\d[\\d,]*(?:\\.\\d+)?(?:\\s?[kKmMbBtT](?![A-Za-z]))?)/;
  const QTY=/(\\d[\\d,]*(?:\\.\\d+)?\\s?(?:shares|share|sh|contracts|contract)\\b)|(\\b\\d+(?:\\.\\d+)?×|×\\d+(?:\\.\\d+)?\\b)|(••••\\d{4})/;
  function mode(el){ for(let n=el;n;n=n.parentElement){ const v=n.getAttribute&&n.getAttribute('data-priv');
    if(v==='on'||v==='market'||v==='off')return v; } return 'off'; }
  const out=[];
  /* A BARE figure carries no $ and no unit, so no pattern can find it — a Shares column
     reads "350.00". Check the two places bare figures legitimately live instead: a cell
     under a quantity header, and anything explicitly tagged data-priv="val". */
  for(const t of document.querySelectorAll('table')){
    const root0=t.closest('#page-portfolio,#page-picks,#page-options,#page-analyze,#page-markets');
    if(!root0||getComputedStyle(root0).display==='none')continue;
    const heads=[...t.querySelectorAll('thead th')].map(h=>h.textContent.trim());
    const cols=heads.map(h=>/^(shares?|qty|quantity|contracts?|size|units?)$/i.test(h));
    if(!cols.some(Boolean))continue;
    for(const tr of t.querySelectorAll('tbody tr')){
      const tds=[...tr.children];
      cols.forEach((isQty,i)=>{ if(!isQty||!tds[i])return;
        if(tds[i].querySelector('span.priv-m'))return;
        const v=tds[i].textContent.trim();
        if(!/\d/.test(v))return;
        if(mode(tds[i])==='off')return;
        out.push({page:root0.id,mode:'bare-qty',text:v.slice(0,60),hit:v.slice(0,24),where:heads[i]+' column'});
      });
    }
  }
  for(const e of document.querySelectorAll('[data-priv="val"]')){
    if(e.querySelector('span.priv-m'))continue;
    if(!/\d/.test(e.textContent||''))continue;
    const root0=e.closest('#page-portfolio,#page-picks,#page-options,#page-analyze,#page-markets');
    if(!root0||getComputedStyle(root0).display==='none')continue;
    out.push({page:root0.id,mode:'val',text:(e.textContent||'').trim().slice(0,60),hit:(e.textContent||'').trim().slice(0,24),where:'data-priv=val'});
  }
  for(const root of document.querySelectorAll('#page-portfolio,#page-picks,#page-options,#page-analyze,#page-markets')){
    if(getComputedStyle(root).display==='none') continue;
    const w=document.createTreeWalker(root,NodeFilter.SHOW_TEXT); let n;
    while((n=w.nextNode())){
      const v=(n.nodeValue||'').trim(); if(!v) continue;
      const p=n.parentElement; if(!p) continue;
      if(p.classList&&p.classList.contains('priv-m')) continue;
      let hidden=false;
      for(let e=p;e;e=e.parentElement){ const cs=getComputedStyle(e);
        if(cs.display==='none'||cs.visibility==='hidden'){hidden=true;break;}
        if(e.classList&&e.classList.contains('priv-blur')){hidden=true;break;} }
      if(hidden) continue;
      const md=mode(p); if(md==='off') continue;
      let m=v.match(QTY); if(!m && md==='on') m=v.match(MONEY);
      if(!m) continue;
      out.push({page:root.id, mode:md, text:v.slice(0,110), hit:m[0], where:(p.className||'')+''});
    }
  }
  return out;
})()`;

/* Every surface that renders account figures, including BOTH sides of the two
   account-split tabs — a view you never navigate to is a view you never audit. */
const VIEWS = [
  ['Accounts · self-directed', p => p.evaluate(() => { switchTab('portfolio'); setAccount('main'); })],
  ['Accounts · agentic',       p => p.evaluate(() => { switchTab('portfolio'); setAccount('agentic'); })],
  ['Plan · self-directed',     p => p.evaluate(() => { switchTab('picks'); setPlanAccount('main'); })],
  ['Plan · agentic',           p => p.evaluate(() => { switchTab('picks'); setPlanAccount('agentic'); })],
  ['Options',                  p => p.evaluate(() => switchTab('options'))],
  ['Analyze',                  p => p.evaluate(() => { switchTab('analyze'); const i=document.getElementById('az-ticker'); if(i){ i.value='IREN'; azGo(); } })],
  ['Markets',                  p => p.evaluate(() => switchTab('markets'))],
];

const launch = { args: ['--no-sandbox'] };
if (process.env.PF_CHROME) launch.executablePath = process.env.PF_CHROME;
const browser = await chromium.launch(launch);
const page = await browser.newPage({ viewport: { width: 430, height: 900 } });
const crashes = [];
page.on('pageerror', e => crashes.push(String(e.message)));
await page.addInitScript(`window.__CS=${JSON.stringify(CHART_STUB)};`);
await page.addInitScript(() => { try { localStorage.setItem('pf_private', '1'); } catch {} ; eval(window.__CS); });
await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'networkidle' });
await page.waitForTimeout(3500);

let total = 0;
const thin = [];
for (const [name, go] of VIEWS) {
  try { await go(page); } catch (e) { console.log(`  ! could not open ${name}: ${e.message}`); }
  await page.waitForTimeout(2200);
  const hits = await page.evaluate(SCAN);
  /* A view that rendered nothing leaks nothing, so "0 leaked" is only meaningful next to
     evidence the view exists AND that masking actually fired on it. */
  const stat = await page.evaluate(() => {
    const vis = [...document.querySelectorAll('#page-portfolio,#page-picks,#page-options,#page-analyze,#page-markets')]
      .filter(r => getComputedStyle(r).display !== 'none');
    return { chars: vis.reduce((n, r) => n + r.innerText.length, 0),
             masked: vis.reduce((n, r) => n + r.querySelectorAll('span.priv-m').length, 0),
             blurred: vis.reduce((n, r) => n + r.querySelectorAll('.priv-blur').length, 0) };
  });
  if (stat.chars < 400) { thin.push(`${name} rendered only ${stat.chars} chars`); }
  total += hits.length;
  console.log(`\n=== ${name} — ${hits.length} leaked · ${stat.masked} masked · ${stat.blurred} chart(s) hidden · ${stat.chars} chars ===`);
  const seen = new Set();
  for (const h of hits) {
    const k = h.hit + '|' + h.where; if (seen.has(k)) continue; seen.add(k);
    console.log(`  [${h.mode}] ${JSON.stringify(h.hit)}  in ${JSON.stringify(h.text)}  @${h.where}`);
  }
}
/* Toggling back must return the DOM to exactly what it was — the mask REPLACES text, so a
   broken restore would leave the app permanently showing bullets with no way back. */
await page.evaluate(() => { switchTab('portfolio'); setAccount('main'); });
await page.waitForTimeout(600);
const before = await page.evaluate(() => document.getElementById('page-portfolio').innerText);
await page.evaluate(() => setPrivacy(false));
await page.waitForTimeout(400);
const shown = await page.evaluate(() => ({
  left: document.querySelectorAll('span.priv-m,.priv-blur,[data-pv-title],[data-pv-aria-label]').length,
  text: document.getElementById('page-portfolio').innerText,
}));
await page.evaluate(() => setPrivacy(true));
await page.waitForTimeout(400);
const reMasked = await page.evaluate(() => document.querySelectorAll('#page-portfolio span.priv-m').length);
const restoreBad = [];
if (shown.left) restoreBad.push(`${shown.left} masked node(s) survived turning privacy OFF`);
/* Match OUR tokens only — "••••0741" is a Robinhood account mask the app renders normally
   and happens to contain bullets, so a bare bullet test false-positives on a clean restore. */
if (/\$•••|••• sh|••• share|••• contract|•×/.test(shown.text)) restoreBad.push('mask tokens still on screen with privacy OFF');
if (shown.text.length <= before.length) restoreBad.push('unmasked text is not longer than masked text — restore looks lossy');
if (!reMasked) restoreBad.push('re-enabling privacy masked nothing');
console.log(`\n=== round-trip: ${restoreBad.length ? restoreBad.join('; ') : `off restores real values (${before.length} → ${shown.text.length} chars), on re-masks ${reMasked}`} ===`);

await browser.close();
server.close();

/* A page that threw rendered nothing, and nothing is trivially leak-free — so a crash
   has to fail the audit rather than pass it. This is how the dLbl ReferenceError that
   blanked the whole agentic Plan tab first surfaced. */
const realCrashes = crashes.filter(c => !/Chart is not defined/.test(c));
if (realCrashes.length) { console.log('\n⚠️ page errors (a view that throws audits nothing):'); realCrashes.forEach(c => console.log('  ' + c)); }
if (thin.length) { console.log('\n⚠️ suspiciously empty views:'); thin.forEach(c => console.log('  ' + c)); }
if (restoreBad.length) { console.log('\n⚠️ round-trip:'); restoreBad.forEach(c => console.log('  ' + c)); }
const ok = total === 0 && !realCrashes.length && !thin.length && !restoreBad.length;
console.log(`\n${ok ? '✅ private mode holds — no account figures readable, and it toggles back cleanly' : '❌ ' + total + ' leaked value(s)' + (thin.length||realCrashes.length||restoreBad.length ? ' + the warnings above' : '')}`);
process.exit(ok ? 0 : 1);
