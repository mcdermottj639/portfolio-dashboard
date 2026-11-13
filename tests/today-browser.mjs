// Invoked by brief-browser.mjs so the established synthetic CI browser gate covers Today.
// Intercepts the Claude handoff locally; never opens it, submits an order, or reads
// authenticated broker data.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ready = page => page.waitForFunction(() => window.__SNAP && window.PFTheme && document.querySelector('#page-ex-today .td-shell'));
const refresh = async page => {
  await page.evaluate(() => window.__experienceRefresh());
  await page.waitForTimeout(220);
};
const currentTheme = page => page.evaluate(() => document.documentElement.getAttribute('data-theme'));
const openToday = async page => {
  await page.evaluate(() => window.PFExperience.navigate('today'));
  await ready(page);
};

export async function runTodayChecks(page) {
  const writes = [];
  const recordWrite = request => { if (!['GET', 'HEAD'].includes(request.method())) writes.push(request.url()); };
  page.on('request', recordWrite);
  await openToday(page);
  await page.evaluate(() => setPrivacy(false));
  const initialEquity = await page.locator('#ex-combined-equity').innerText();
  const initialTheme = await page.evaluate(() => PFTheme.preference());
  try {
    assert.deepEqual(await page.locator('.ex-main [data-ex-area]').evaluateAll(nodes => nodes.map(n => n.dataset.exArea)),
      ['today', 'portfolio', 'research', 'signals', 'activity'], 'all five established destinations remain');
    assert.equal(await page.locator('#ex-account').isVisible(), false, 'Today stays a combined overview');
    assert.equal(await page.locator('#page-ex-today').getByRole('button', { name: 'All accounts', exact: true }).count(), 0);
    assert.match(await page.locator('.td-waiting').innerText(), /Waiting on you/i);
    assert.match(await page.locator('.td-monitor').innerText(), /Out of your hands/i);

    // Theme selection persists independently of the account / route state and follows the
    // operating system only when System has been selected explicitly.
    await page.locator('#td-theme').selectOption('dark');
    await page.waitForFunction(() => document.documentElement.getAttribute('data-theme') === 'gold');
    assert.equal(await page.evaluate(() => PFTheme.preference()), 'dark');
    await page.reload(); await ready(page);
    assert.equal(await currentTheme(page), 'gold', 'manual Dark survives reload');
    assert.equal(await page.locator('#td-theme').inputValue(), 'dark');
    assert.equal(await page.locator('#ex-combined-equity').innerText(), initialEquity);
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.locator('#td-theme').selectOption('system');
    await page.waitForFunction(() => PFTheme.preference() === 'system' && document.documentElement.getAttribute('data-theme') === 'gold');
    await page.emulateMedia({ colorScheme: 'light' });
    await page.waitForFunction(() => document.documentElement.getAttribute('data-theme') === 'light');
    await page.reload(); await ready(page);
    assert.equal(await page.evaluate(() => PFTheme.preference()), 'system', 'System survives reload');
    assert.equal(await currentTheme(page), 'light');
    await page.locator('#td-theme').selectOption('dark');
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.emulateMedia({ colorScheme: 'light' });
    assert.equal(await currentTheme(page), 'gold', 'OS changes do not override a manual choice');

    // Daily observations remain behind the Value over time disclosure. The headline has
    // no fabricated intraday series, and the read-only history has a text equivalent.
    const history = page.locator('[data-td-details="history"]');
    assert.equal(await history.evaluate(el => el.tagName), 'DETAILS');
    assert.equal(await history.getAttribute('open'), null, 'daily value history starts collapsed');
    assert.match(await history.locator('summary').innerText(), /Value over time/i);
    assert.equal(await page.locator('#page-ex-today').getByRole('button', { name: '1D', exact: true }).count(), 0);
    assert.equal(await page.locator('.td-map svg,.td-map canvas').count(), 0, 'holding tiles have no invented sparklines');
    await history.locator('summary').click();
    assert.ok(await history.locator('.ex-private-chart').isVisible());
    assert.match(await history.innerText(), /recorded|daily/i);
    await refresh(page);
    assert.equal(await history.getAttribute('open'), '', 'history disclosure survives refresh');

    // A list alternate preserves the same holding universe. A shared symbol exposes an
    // explicit account destination rather than silently selecting a default account.
    await page.locator('[data-td-view="map"]').click();
    const mapSymbols = await page.locator('.td-map [data-td-holding]').evaluateAll(nodes => nodes.map(n => n.dataset.tdHolding));
    assert.ok(mapSymbols.length > 0, 'synthetic holdings render');
    await checkMapProportions(page);
    await page.locator('[data-td-view="list"]').click();
    assert.equal(await page.locator('[data-td-view="list"]').getAttribute('aria-pressed'), 'true');
    for (const symbol of mapSymbols) assert.ok(await page.locator('#page-ex-today [data-td-holding="' + symbol + '"]:visible').count(), symbol + ' remains in the list view');
    await page.locator('[data-td-view="map"]').click();
    const selected = await page.evaluate(() => PFExperienceModel.dailyBrief(__DATA, __SNAP).positions.find(p => p.shared && p.value > 0)?.symbol);
    assert.ok(selected && mapSymbols.includes(selected), 'fixture must exercise a holding owned in both accounts');
    await page.locator('.td-map [data-td-holding="' + selected + '"]').click();
    const sheet = page.locator('#td-holding-sheet');
    assert.equal(await sheet.isVisible(), true);
    assert.match(await sheet.innerText(), new RegExp(selected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    const accounts = await page.evaluate(symbol => PFExperienceModel.dailyBrief(__DATA, __SNAP).positions.find(p => p.symbol === symbol).sources.map(s => s.account), selected);
    for (const account of accounts) assert.equal(await sheet.locator('[data-td-research="' + account + '"]').count(), 1);
    for (const chosenAccount of accounts) {
      await sheet.locator('[data-td-research="' + chosenAccount + '"]').click();
      await page.waitForFunction(({ symbol, account }) => PFJourney.state.route === 'analyze' && PFJourney.state.symbol === symbol && PFJourney.state.account === account, { symbol: selected, account: chosenAccount });
      assert.ok(!page.url().includes(selected) && !page.url().includes('account='), 'URLs remain route-only');
      await page.goBack(); await ready(page);
      await page.waitForFunction(() => PFExperience.route === 'today');
      assert.equal(await page.locator('#ex-combined-equity').innerText(), initialEquity, 'Back returns to the combined Today view');
      await page.locator('[data-td-view="map"]').click();
      await page.locator('.td-map [data-td-holding="' + selected + '"]').click();
    }
    await page.keyboard.press('Escape');
    assert.equal(await sheet.isVisible(), false, 'Escape dismisses the holding sheet');

    // Privacy protects both the main view and the dynamic holding dialog, including
    // assistive text. The dialog is a private position surface, not a market quote.
    await page.evaluate(() => setPrivacy(true));
    assert.match(await page.locator('#ex-combined-equity').innerText(), /•••/);
    await page.locator('.td-map [data-td-holding="' + selected + '"]').click();
    assert.doesNotMatch(await sheet.innerText(), /\$[\d,]+/);
    const exposed = await sheet.evaluate(el => [...el.querySelectorAll('[aria-label],[title]')].map(n => [n.getAttribute('aria-label'), n.getAttribute('title')].join(' ')).join(' '));
    assert.doesNotMatch(exposed, /\$[\d,]+/);
    assert.doesNotMatch(await sheet.innerText(), /\d[\d,.]*\s+(?:shares?|sh|contracts?)\b/);
    assert.equal(await sheet.locator('[data-priv="val"]').evaluateAll(nodes => nodes.some(n => /\d/.test(n.innerText))), false, 'bare position quantities are masked');
    await page.keyboard.press('Escape');
    await refresh(page);
    assert.match(await page.locator('#ex-combined-equity').innerText(), /•••/);
    await page.evaluate(() => setPrivacy(false));
    assert.equal(await page.locator('#ex-combined-equity').innerText(), initialEquity);
    await checkCoverageAndTicketStates(page, selected);
    await checkTinyHoldingMap(page);

    // Exercise the visible trade + whole-book confirmation against the authoritative
    // Apex adapter, with a deliberately synthetic, fresh one-line entry proposal.
    await checkApexParity(page);
    await openToday(page);
    for (const theme of ['light', 'dark']) {
      await page.locator('#td-theme').selectOption(theme);
      for (const [width, height] of [[320,844],[390,844],[430,932],[466,677],[678,453],[960,676],[1440,1000]]) {
        await page.setViewportSize({ width, height });
        await page.waitForTimeout(80);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'Today has no horizontal overflow in ' + theme + ' at ' + width + '×' + height);
        assert.equal(await page.locator('.ex-main [data-ex-area="signals"]').isVisible(), true, 'Signals stays reachable');
      }
    }

    if (process.env.PF_SCREENSHOT_DIR) {
      const dir = path.resolve(process.env.PF_SCREENSHOT_DIR); fs.mkdirSync(dir, { recursive: true });
      await page.locator('#td-theme').selectOption('light');
      await page.setViewportSize({ width:390, height:844 });
      await page.evaluate(() => window.scrollTo(0,0));
      await page.screenshot({ path:path.join(dir,'today-light-390.png'), fullPage:true });
      await page.locator('#td-theme').selectOption('dark');
      await page.screenshot({ path:path.join(dir,'today-dark-390.png'), fullPage:true });
      await page.setViewportSize({ width:960, height:676 });
      await page.screenshot({ path:path.join(dir,'today-duo-960.png'), fullPage:true });
      await page.setViewportSize({ width:678, height:453 });
      await page.screenshot({ path:path.join(dir,'today-landscape-678.png'), fullPage:true });
    }
    assert.deepEqual(writes, [], 'Today makes no account or trade writes');
    console.log('today-browser PASS: five tabs, combined scope, Light/Dark/System persistence, daily history, proportionate map/list, both-account holding journeys, privacy, missing quotes, ticket ownership/states, whole-book prompt parity, 7 viewport sizes; synthetic data only');
  } finally {
    await page.evaluate(mode => { setPrivacy(false); PFTheme.set(mode); }, initialTheme);
    await page.emulateMedia({ colorScheme: null });
    await page.setViewportSize({ width:1440, height:1000 });
    await openToday(page);
    page.off('request', recordWrite);
  }
}

async function checkCoverageAndTicketStates(page, symbol) {
  await page.evaluate(symbol => {
    window.__todayCoverageBackup = {
      pending: __DATA.agentic.pending,
      quote: __DATA.quotes[symbol],
      rows: __SNAP.enriched.filter(row => row.symbol === symbol).map(row => ({row, dayP: row.dayP, dayD: row.dayD}))
    };
    delete __DATA.quotes[symbol];
    __todayCoverageBackup.rows.forEach(({row}) => { row.dayP = null; row.dayD = null; });
    __experienceRefresh();
  }, symbol);
  try {
    await page.waitForFunction(symbol => {
      const row = PFExperienceModel.dailyBrief(__DATA, __SNAP).positions.find(row => row.symbol === symbol);
      return row && row.partialDay && row.day === null;
    }, symbol);
    await refresh(page);
    const tile = page.locator('.td-map [data-td-holding="' + symbol + '"]');
    assert.match(await tile.getAttribute('class'), /td-neutral/);
    assert.match(await tile.innerText(), /—|unknown|unavailable|no quote/i, 'missing day quotes remain visibly unknown');
    assert.doesNotMatch(await tile.innerText(), /(?:^|\s)[+−-]?0(?:\.0+)?%/, 'missing quotes never become a flat move');
    assert.match(await page.locator('#page-ex-today').innerText(), /partial|lack day quotes|incomplete|missing (?:day )?quotes/i, 'coverage limitation is visible');

    const setTicket = async (status, autoEligible = false) => {
      await page.evaluate(({status, autoEligible}) => {
        __DATA.agentic.pending = {id:'synthetic-today-ticket', created: new Date().toISOString().slice(0, 10), status, autoEligible};
        __experienceRefresh();
      }, {status, autoEligible});
      await refresh(page);
    };
    await setTicket('proposed');
    assert.match(await page.locator('.td-waiting').innerText(), /Awaiting your confirmation/i);
    assert.equal(await page.locator('.td-monitor [data-td-monitor-state="proposed"]').count(), 0, 'owner approval never appears as broker work');
    for (const [status, autoEligible] of [['proposed', true], ['confirmed', false]]) {
      await setTicket(status, autoEligible);
      const row = page.locator('.td-monitor [data-td-monitor-state="' + status + '"]');
      assert.match(await row.innerText(), /Queued for executor/i);
      assert.match(await row.innerText(), /submission has not been confirmed/i);
    }
    await setTicket('sells-placed');
    const submitted = page.locator('.td-monitor [data-td-monitor-state="sells-placed"]');
    assert.match(await submitted.innerText(), /Submission reported/i);
    assert.match(await submitted.innerText(), /Fill status is not confirmed/i);
    await setTicket('unrecognized-test-state');
    assert.match(await page.locator('.td-waiting').innerText(), /Status needs review/i);
    assert.equal(await page.locator('.td-monitor [data-td-monitor-state="unrecognized-test-state"]').count(), 0);
  } finally {
    await page.evaluate(symbol => {
      const backup = window.__todayCoverageBackup;
      __DATA.agentic.pending = backup.pending;
      if (backup.quote === undefined) delete __DATA.quotes[symbol];
      else __DATA.quotes[symbol] = backup.quote;
      backup.rows.forEach(({row, dayP, dayD}) => { row.dayP = dayP; row.dayD = dayD; });
      delete window.__todayCoverageBackup;
      __experienceRefresh();
    }, symbol);
    await refresh(page);
  }
}

async function checkMapProportions(page) {
  const {width, height, tiles: map} = await page.evaluate(() => {
    const positions = PFExperienceModel.dailyBrief(__DATA, __SNAP).positions.filter(p => p.value > 0);
    const total = positions.reduce((sum, p) => sum + p.value, 0);
    const weights = Object.fromEntries(positions.map(p => [p.symbol, p.value / total]));
    const bounds = document.querySelector('.td-map').getBoundingClientRect();
    return {width: bounds.width, height: bounds.height, tiles: [...document.querySelectorAll('.td-map [data-td-holding]')].map(el => {
      const rect = el.getBoundingClientRect();
      return {
        symbol: el.dataset.tdHolding,
        weight: weights[el.dataset.tdHolding],
        x: parseFloat(el.style.left), y: parseFloat(el.style.top),
        width: parseFloat(el.style.width), height: parseFloat(el.style.height),
        units: ['left', 'top', 'width', 'height'].every(key => el.style[key].endsWith('%')),
        rect: {x: rect.left - bounds.left, y: rect.top - bounds.top, width: rect.width, height: rect.height}
      };
    })};
  });
  assert.ok(map.length);
  assert.ok(width > 0 && height > 0, 'the measured map is visible');
  // Browser layout quantizes fractions of a CSS pixel. This tolerance allows that
  // rounding, but cannot hide a border/padding minimum inflating a small holding.
  const pixelTolerance = 0.15;
  for (const tile of map) {
    assert.ok(tile.units, tile.symbol + ' uses a responsive percentage rectangle');
    assert.ok(tile.x >= 0 && tile.y >= 0 && tile.width > 0 && tile.height > 0);
    assert.ok(tile.x + tile.width <= 100.01 && tile.y + tile.height <= 100.01, tile.symbol + ' fits inside the map');
    assert.ok(Math.abs(tile.width * tile.height / 10000 - tile.weight) < 0.0001, tile.symbol + ' area represents its recorded position value');
    const expected = {x: width * tile.x / 100, y: height * tile.y / 100, width: width * tile.width / 100, height: height * tile.height / 100};
    for (const dimension of ['x', 'y', 'width', 'height']) {
      assert.ok(Math.abs(tile.rect[dimension] - expected[dimension]) <= pixelTolerance,
        tile.symbol + ' actual ' + dimension + ' matches its proportional rectangle');
    }
    assert.ok(tile.rect.x >= -pixelTolerance && tile.rect.y >= -pixelTolerance);
    assert.ok(tile.rect.x + tile.rect.width <= width + pixelTolerance && tile.rect.y + tile.rect.height <= height + pixelTolerance,
      tile.symbol + ' actual border box stays within the map');
    const areaTolerance = (expected.width + expected.height) * pixelTolerance + pixelTolerance ** 2;
    assert.ok(Math.abs(tile.rect.width * tile.rect.height - tile.weight * width * height) <= areaTolerance,
      tile.symbol + ' rendered area represents its recorded position value');
  }
  for (let i = 0; i < map.length; i++) for (let j = i + 1; j < map.length; j++) {
    const a = map[i], b = map[j];
    const overlapX = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
    const overlapY = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
    assert.ok(overlapX < 0.01 || overlapY < 0.01, a.symbol + ' and ' + b.symbol + ' do not overlap');
    const actualOverlapX = Math.min(a.rect.x + a.rect.width, b.rect.x + b.rect.width) - Math.max(a.rect.x, b.rect.x);
    const actualOverlapY = Math.min(a.rect.y + a.rect.height, b.rect.y + b.rect.height) - Math.max(a.rect.y, b.rect.y);
    assert.ok(actualOverlapX <= pixelTolerance || actualOverlapY <= pixelTolerance,
      a.symbol + ' and ' + b.symbol + ' rendered border boxes do not overlap');
  }
  assert.ok(Math.abs(map.reduce((sum, tile) => sum + tile.width * tile.height / 10000, 0) - 1) < 0.0001, 'map uses the complete priced stock allocation');
  const totalAreaTolerance = map.reduce((sum, tile) => sum + (width * tile.width / 100 + height * tile.height / 100) * pixelTolerance + pixelTolerance ** 2, 0);
  assert.ok(Math.abs(map.reduce((sum, tile) => sum + tile.rect.width * tile.rect.height, 0) - width * height) <= totalAreaTolerance,
    'actual tile areas cover the map without inflating the allocation');
}

async function checkTinyHoldingMap(page) {
  const viewport = page.viewportSize();
  await page.evaluate(() => {
    window.__todayTinyMapBackup = {data: __DATA, snap: __SNAP};
    const now = new Date().toISOString();
    __DATA = {...__DATA, generatedAt: now,
      main: {equity: 100000, cash: 0, asOf: now},
      agentic: {equity: 0, cash: 0, positions: [], asOf: now}};
    __SNAP = {stats: {totalVal: 100000, cashVal: 0}, enriched: [
      {symbol:'LARGE', qty:990, px:100, avg:100, val:99000, dayP:0, dayD:0},
      {symbol:'SMALL', qty:10, px:100, avg:100, val:1000, dayP:0, dayD:0}
    ], smaMap:{}, earn:{}};
    __experienceRefresh();
  });
  try {
    await page.setViewportSize({width:320, height:844});
    await refresh(page);
    await page.locator('[data-td-view="map"]').click();
    assert.equal(await page.locator('.td-map [data-td-holding]').count(), 2, 'tiny-map fixture has exactly two holdings');
    await checkMapProportions(page);
    const small = await page.locator('.td-map [data-td-holding="SMALL"]').boundingBox();
    assert.ok(small && small.width > 0 && small.width < 10, 'the 1% holding remains a genuinely small rendered tile');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'the tiny holding does not overflow the viewport');
    await page.locator('[data-td-view="list"]').click();
    assert.equal(await page.locator('.td-holdings-list [data-td-holding="SMALL"]').isVisible(), true, 'a tiny tile remains reachable through List');
    await page.locator('[data-td-view="map"]').click();
  } finally {
    await page.evaluate(() => {
      const backup = window.__todayTinyMapBackup;
      __DATA = backup.data; __SNAP = backup.snap;
      delete window.__todayTinyMapBackup;
      __experienceRefresh();
    });
    if (viewport) await page.setViewportSize(viewport);
    await refresh(page);
  }
}

async function checkApexParity(page) {
  await page.evaluate(() => {
    window.__todayTestBackup = { data:structuredClone(__DATA), snap:structuredClone(__SNAP), target:window.__APEX_TGT, cfg:window.__APEX_CFG };
    __DATA.generatedAt = new Date().toISOString();
    __APEX_CFG = {};
    __APEX_TGT = { asOf:new Date().toISOString(), targets:{Y:20}, top5:[{sym:'Y',trigger:100,limit:100,tp1:120,stop:90,orderType:'limit',maxPx:105,tradable:true,composite:8,why:'Synthetic Today test'}], heldLevels:[{sym:'X',stop:80,tp1:150}] };
    __SNAP = { enriched:[{symbol:'IREN',qty:50,px:100,avg:100,val:5000},{symbol:'X',qty:10,px:100,avg:100,val:1000}], stats:{totalVal:10000,cashVal:0}, smaMap:{}, earn:{} };
    renderApexCard(__SNAP); __experienceRefresh();
  });
  try {
    await page.waitForFunction(() => document.querySelector('#page-ex-today [data-td-confirm]'));
    const parity = await page.evaluate(() => {
      const a=window.__PF_APEX_REVIEW;
      const rows=Apex.bookLines(a.st,a.out,a.cfg);
      return {
        rows:rows.map(r=>({text:r.text,px:r.px})),
        expected:Apex.portfolioPrompt(a.st,a.out,a.cfg,a.research),
        visible:[...document.querySelectorAll('#page-ex-today .td-trade-row')].map(r=>r.innerText),
        precedes:[...document.querySelectorAll('#page-ex-today .td-trade-row')].every(r=>Boolean(r.compareDocumentPosition(document.querySelector('[data-td-confirm]'))&Node.DOCUMENT_POSITION_FOLLOWING))
      };
    });
    assert.ok(parity.rows.length, 'fixture must offer an eligible trade');
    assert.equal(parity.visible.length, parity.rows.length, 'all confirmed trades are visible, not only a teaser');
    parity.rows.forEach((r,i)=>{assert.ok(parity.visible[i].includes(r.text));assert.ok(parity.visible[i].includes(r.px));});
    assert.equal(parity.precedes, true, 'trade and price precede Confirm');
    const backgroundImage=await page.locator('[data-td-confirm]').evaluate(el=>getComputedStyle(el).backgroundImage);
    assert.equal(backgroundImage,'none','the confirmation button has no gradient');
    assert.equal(await page.locator('[data-td-confirm]').getAttribute('href'), null, 'private confirmation payload is not stored in a DOM link');
    assert.equal(await page.locator('[data-td-confirm]').evaluate(el => [...el.attributes].some(a => /claude\.ai|portfolioPrompt|[?&]q=/.test(a.value))), false);
    await page.evaluate(() => {
      window.__todayOriginalOpen = window.open;
      window.__todayOpened = [];
      window.open = (...args) => { window.__todayOpened.push(args); return null; };
    });
    try {
      await page.locator('[data-td-confirm]').click();
      const opened = await page.evaluate(() => window.__todayOpened);
      assert.equal(opened.length, 1, 'confirmation creates one handoff');
      const url = new URL(opened[0][0]);
      assert.equal(url.origin, 'https://claude.ai');
      assert.equal(url.searchParams.get('q'), parity.expected, 'Today reuses the complete authoritative Apex confirmation prompt');
      // A producer update between seeing the card and pressing Confirm must not
      // hand off a new order set the owner has not seen yet.
      await page.evaluate(() => { __APEX_TGT.targets.Y = 10; window.__todayOpened = []; });
      await page.locator('[data-td-confirm]').click();
      assert.equal(await page.evaluate(() => window.__todayOpened.length), 0, 'a changed book requires a visible review before handoff');
      await page.waitForFunction(() => document.querySelector('[data-td-confirm-status]')?.textContent.includes('plan changed'));
    } finally {
      await page.evaluate(() => { window.open = window.__todayOriginalOpen; delete window.__todayOriginalOpen; delete window.__todayOpened; });
    }
    await page.evaluate(() => { __DATA.generatedAt='2020-01-01T00:00:00Z'; renderApexCard(__SNAP); __experienceRefresh(); });
    await page.waitForFunction(() => [...document.querySelectorAll('.td-trade-row')].some(el=>el.textContent.includes('≈')));
    assert.match(await page.locator('.td-waiting').innerText(), /estimate|not order prices|re.price|stale/i, 'stale order amounts retain their source meaning');
    assert.match(await page.locator('[data-td-freshness]').innerText(), /\d+ days old/, 'source freshness remains visible when the snapshot is old');
  } finally {
    await page.evaluate(() => {
      const b=window.__todayTestBackup;
      __DATA=b.data; __SNAP=b.snap; __APEX_TGT=b.target; __APEX_CFG=b.cfg;
      delete window.__todayTestBackup;
      renderApexCard(__SNAP); __experienceRefresh();
    });
    await refresh(page);
  }
}
