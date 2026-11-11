// Run against tests/preview.mjs; all account and research inputs are synthetic.
import assert from 'node:assert/strict';
import fs from 'node:fs';
const { chromium } = await import(process.env.PF_PLAYWRIGHT || 'playwright');
const stub = fs.readFileSync(new URL('../producer/privacy-audit.mjs', import.meta.url), 'utf8').match(/const CHART_STUB = `([\s\S]*?)`;/)[1];
const browser = await chromium.launch({ ...(process.env.PF_CHROME ? { executablePath: process.env.PF_CHROME } : {}), args: ['--no-sandbox', '--disable-dev-shm-usage'] });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, timezoneId: 'America/New_York' });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(stub);
  await page.addInitScript(() => { localStorage.setItem('pf_acct', 'main'); localStorage.setItem('pf_experience_route', 'today'); });
  await page.route('https://**/*', r => r.abort());
  await page.goto(process.env.PF_PREVIEW_URL || 'http://127.0.0.1:8767');
  await page.waitForFunction(() => window.__SNAP && document.querySelector('#ex-combined-equity')?.textContent.includes('$'));
  await page.locator('#page-ex-today [data-ex-route="plan"][data-ex-account="main"]').first().click();
  await page.waitForFunction(() => getComputedStyle(document.querySelector('#picks-app')).display !== 'none');
  const render = mode => page.evaluate(mode => {
    const current = new Date().toISOString();
    window.__DATA.generatedAt = current;
    const p = (symbol, qty, px, avg = px) => ({ symbol, qty, px, avg, val: qty * px });
    const pos = [p('IREN', 50, 100), p('X', 10, mode === 'stop' ? 79 : mode === 'winner' ? 130 : 100, 100)];
    const top5 = [{ sym: 'Y', trigger: 100, limit: 100, tp1: 120, stop: 90, orderType: 'limit', maxPx: 105, tradable: true, composite: 8, why: 'Synthetic research' }];
    window.__APEX_TGT = mode === 'missing' ? null : { asOf: mode === 'stale' ? '2020-01-01T00:00:00Z' : current, targets: { Y: 20 }, top5, heldLevels: [{ sym: 'X', stop: 80, tp1: 150, stopBasis: 'held support' }] };
    if (mode === 'owner') { top5[0].stopBasis = 'owner stop'; top5[0].atr = 5; }
    if (mode === 'invalid') top5[0].stop = null;
    if (mode === 'overlap') { top5.push({ sym: 'X', trigger: 110, limit: 110, tp1: 150, stop: 105, orderType: 'limit', tradable: true }); window.__APEX_TGT.targets.X = 20; }
    window.__APEX_CFG = {};
    window.__SNAP = { enriched: pos, stats: { totalVal: 10000, cashVal: 0 }, smaMap: {}, earn: mode === 'earnings' ? { Y: { daysAway: 1 } } : {} };
    renderApexCard(window.__SNAP);
    const el = document.querySelector('#apex-content');
    const href = el.querySelector('a[href^="https://claude.ai/new?q="]')?.href;
    return { text: el.innerText, trades: [...el.querySelectorAll('[data-apex-trade]')].map(e => ({ sym: e.dataset.apexTrade, text: e.innerText })), prompt: href ? new URL(href).searchParams.get('q') : '' };
  }, mode);
  let r = await render('normal');
  assert.deepEqual(r.trades.map(t => t.sym), ['Y']);
  assert.match(r.trades[0].text, /limit entry/);
  assert.match(r.prompt, /REVIEW X/); assert.doesNotMatch(r.prompt, /^• SELL/m);
  assert.match(r.text, /· 1 order/);
  for (const mode of ['missing', 'stale', 'invalid', 'owner', 'earnings']) {
    r = await render(mode); assert.equal(r.trades.length, 0, mode);
    assert.match(r.text, /Review · no order/, mode);
  }
  r = await render('overlap');
  assert.doesNotMatch(r.text, /X is through its research stop/, 'entry level did not replace held stop');
  r = await render('stop');
  assert.equal(r.trades.filter(t => t.sym === 'X').length, 1);
  assert.match(r.trades.find(t => t.sym === 'X').text, /Sell 10 X/);
  r = await render('winner');
  assert.ok(!r.trades.some(t => t.sym === 'X'));
  assert.match(r.text, /reconciled execution history/);
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `no overflow at ${width}`);
  }
  assert.deepEqual(errors, []);
  console.log('apex-browser: adapter, action/prompt parity, review-only states, held exits and 320–1440px layouts PASS');
} finally { await browser.close(); }
