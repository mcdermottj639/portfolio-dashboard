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
    window.__APEX_TGT = mode === 'missing' ? null : { asOf: mode === 'stale' ? '2020-01-01T00:00:00Z' : current, targets: { Y: 20 }, themeMap: { X: 'industrial', Y: 'health' }, top5, heldLevels: [{ sym: 'X', stop: 80, tp1: 150, stopBasis: 'held support' }] };
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
  // v258 morning ticket: the same Y buy with entry and target, at the top of the card
  { const tk = await page.evaluate(() => { const t = document.querySelector('#apex-ticket'); const rows = [...t.querySelectorAll('[data-apex-ticket-row]')];
      return { state: t.dataset.apexTicket, rows: rows.map(e => ({ sym: e.dataset.apexTicketRow, side: e.dataset.side, text: e.querySelector('summary').innerText })), first: document.querySelector('#apex-content').firstElementChild.contains(t) }; });
    assert.equal(tk.state, 'ready'); assert.ok(tk.first, 'ticket leads the Apex card');
    const y = tk.rows.find(x => x.sym === 'Y' && x.side === 'buy'); assert.ok(y, 'Y buy row'); assert.match(y.text, /100\.00/); assert.match(y.text, /120\.00/); assert.match(y.text, /90\.00/);
    assert.ok(tk.rows.some(x => x.sym === 'X' && x.side === 'stop'), 'held X shows its research stop'); assert.ok(!tk.rows.some(x => x.sym === 'IREN'), 'no IREN row'); }
  r = await render('stale');
  assert.equal(await page.evaluate(() => document.querySelector('#apex-ticket').dataset.apexTicket), 'stale');
  assert.match(r.text, /No ticket for today — research last updated/);
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
  // v258: at the folded Duo / phone width the ticket fits, rows tap open, and a screenshot is kept as evidence
  await page.setViewportSize({ width: 390, height: 844 });
  await render('stop');
  { const row = page.locator('#apex-ticket [data-apex-ticket-row]').first(); await row.locator('summary').click();
    assert.equal(await row.evaluate(e => e.open), true, 'a ticket row opens on tap');
    assert.equal(await page.evaluate(() => { const t = document.querySelector('#apex-ticket'); return t.scrollWidth <= t.clientWidth + 1 && document.documentElement.scrollWidth <= innerWidth; }), true, 'ticket fits 390px');
    assert.ok((await row.locator('summary').boundingBox()).height >= 44, '44px touch target');
    fs.mkdirSync('tmp/journey-evidence', { recursive: true });
    await page.locator('#apex-ticket').screenshot({ path: 'tmp/journey-evidence/apex-ticket-390.png' }); }
  // v266 placed rows fold into ONE summary row per section: none / some / all placed, expand and collapse, at phone and Duo widths
  { const renderFold = placedSyms => page.evaluate(placedSyms => {
      window.__DATA.generatedAt = new Date().toISOString();
      const p = (symbol, qty, px) => ({ symbol, qty, px, avg: px, val: qty * px });
      const pos = [p('IREN', 50, 100), p('AA', 10, 100), p('BB', 10, 100), p('CC', 10, 100)];
      const top5 = [{ sym: 'Y', trigger: 100, limit: 100, tp1: 120, stop: 90, orderType: 'limit', maxPx: 105, tradable: true, composite: 8, why: 'Synthetic research' }];
      window.__APEX_TGT = { asOf: new Date().toISOString(), targets: { Y: 20 }, themeMap: { AA: 'industrial', BB: 'industrial', CC: 'industrial', Y: 'health' }, top5,
        heldLevels: ['AA', 'BB', 'CC'].map(sym => ({ sym, stop: 80, tp1: 150, stopBasis: 'held support' })) };
      window.__APEX_CFG = {};
      window.__DATA.main = Object.assign({}, window.__DATA.main, { openOrders: placedSyms.length ? { asOf: new Date().toISOString(), bySym: Object.fromEntries(placedSyms.map(s => [s, { stop: 80, stopQty: 10, limit: 150, limitQty: 10, market: false, placedAt: null }])) } : null });
      window.__SNAP = { enriched: pos, stats: { totalVal: 10000, cashVal: 0 }, smaMap: {}, earn: {} };
      renderApexCard(window.__SNAP);
    }, placedSyms);
    const sells = () => page.locator('#apex-ticket [data-side="stop"]:not([data-placed]), #apex-ticket [data-side="sell"]:not([data-placed])');
    const fold = page.locator('#apex-ticket [data-apex-placed-fold="sell"]');
    const noOverflow = async label => assert.equal(await page.evaluate(() => { const t = document.querySelector('#apex-ticket'); return t.scrollWidth <= t.clientWidth + 1 && document.documentElement.scrollWidth <= innerWidth; }), true, label);
    for (const [w, h] of [[390, 844], [466, 677], [960, 676]]) {
      await page.setViewportSize({ width: w, height: h });
      // none placed: no fold row, all three held-name rows fully visible
      await renderFold([]);
      assert.equal(await fold.count(), 0, `${w}: none placed, no fold row`); assert.equal(await sells().count(), 3, `${w}: none placed, three to-do rows`);
      assert.doesNotMatch(await page.locator('#apex-ticket').innerText(), /placed/i, `${w}: no placed text`);
      // some placed: AA placed -> two to-do rows + ONE summary row, closed by default
      await renderFold(['AA']);
      assert.equal(await sells().count(), 2, `${w}: some placed, two rows still need him`); assert.equal(await fold.count(), 1);
      assert.equal(await fold.evaluate(e => e.open), false, `${w}: fold starts closed`);
      assert.equal(await page.locator('#apex-ticket [data-placed]:visible').count(), 0, `${w}: placed rows hidden while closed`);
      assert.match(await fold.locator(':scope > summary').innerText(), /✓ 1 placed\s*· tap to see/);
      assert.ok((await fold.locator(':scope > summary').boundingBox()).height >= 44, `${w}: 44px touch target`);
      // all placed: header + just the summary row, no to-do rows
      await renderFold(['AA', 'BB', 'CC']);
      assert.equal(await sells().count(), 0, `${w}: all placed, no to-do rows`); assert.equal(await fold.count(), 1);
      assert.match(await page.locator('#apex-ticket').innerText(), /Sells & sell stops\s*\(0\)\s*· 3 placed/);
      assert.match(await fold.locator(':scope > summary').innerText(), /✓ 3 placed/);
      await noOverflow(`${w}: all placed, closed, fits`);
      // expand in place, then collapse again
      await fold.locator(':scope > summary').click();
      assert.equal(await fold.evaluate(e => e.open), true, `${w}: tap opens`);
      assert.equal(await page.locator('#apex-ticket [data-placed]:visible').count(), 3, `${w}: all three placed rows shown when open`);
      assert.match(await fold.locator(':scope > summary').innerText(), /tap to hide/);
      await noOverflow(`${w}: all placed, open, fits`);
      await fold.locator(':scope > summary').click();
      assert.equal(await fold.evaluate(e => e.open), false, `${w}: tap closes`);
      assert.equal(await page.locator('#apex-ticket [data-placed]:visible').count(), 0);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    }
    await page.setViewportSize({ width: 390, height: 844 }); }
  // v258 deep link: #apex-ticket opens the Apex Plan page and the Apex card with the ticket on screen
  { const p2 = await browser.newPage({ viewport: { width: 390, height: 844 }, timezoneId: 'America/New_York' });
    const e2 = []; p2.on('pageerror', e => e2.push(e.message));
    await p2.addInitScript(stub);
    await p2.addInitScript(() => { localStorage.setItem('pf_acct', 'agentic'); localStorage.setItem('pf_experience_route', 'today'); });
    await p2.route('https://**/*', r => r.abort());
    await p2.goto((process.env.PF_PREVIEW_URL || 'http://127.0.0.1:8767') + '#apex-ticket');
    await p2.waitForFunction(() => window.PFExperience?.route === 'plan' && window.PFExperience?.account === 'main' && document.querySelector('#apex-ticket')?.offsetParent, null, { timeout: 30000 });
    await p2.waitForTimeout(1200);
    assert.equal(await p2.evaluate(() => { const r = document.querySelector('#apex-ticket').getBoundingClientRect(); return r.top < innerHeight && r.bottom > 0; }), true, 'ticket on screen after the deep link');
    assert.deepEqual(e2, []); await p2.close(); }
  assert.deepEqual(errors, []);
  console.log('apex-browser: adapter, action/prompt parity, review-only states, held exits and 320–1440px layouts PASS');
} finally { await browser.close(); }
