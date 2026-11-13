/* Today is a presentation of published records. Apex and the existing account
   routes remain authoritative; this module never submits an order. */
(function () {
  'use strict';
  const M = window.PFExperienceModel, T = window.PFTodayModel;
  if (!M || !T) return;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money = value => M.number(value) === null ? 'Unavailable' : new Intl.NumberFormat('en-US', {style:'currency',currency:'USD',minimumFractionDigits:2,maximumFractionDigits:2}).format(Number(value));
  const move = value => (M.number(value) > 0 ? '+' : '') + money(value);
  const pct = value => M.number(value) === null ? 'No quote' : (value > 0 ? '+' : '') + value.toFixed(1) + '%';
  const tone = value => M.number(value) === null || Math.abs(value) < .005 ? 'neutral' : value > 0 ? 'up' : 'down';
  const date = value => {
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
    const stamp = value ? Date.parse(value) : NaN;
    return Number.isFinite(stamp) ? new Date(stamp).toLocaleString('en-US', {month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZone:'America/New_York'}) + ' ET' : 'Not recorded';
  };
  const age = value => {
    const minutes = M.age(value);
    return minutes === null ? 'Age unavailable' : minutes < 60 ? Math.floor(minutes) + ' min old' : minutes < 1440 ? (minutes / 60).toFixed(1) + ' hours old' : Math.floor(minutes / 1440) + ' days old';
  };
  const jump = (route, label, account, cls='td-link') => '<button type="button" class="' + cls + '" data-ex-route="' + route + '"' + (account ? ' data-ex-account="' + account + '"' : '') + '>' + esc(label) + ' <span aria-hidden="true">↗</span></button>';
  const fact = (label, value) => '<div class="td-status-row"><span class="td-muted">' + esc(label) + '</span><strong>' + esc(value) + '</strong></div>';
  const when = days => days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : 'In ' + days + ' days';
  const state = {host:null, options:null, rows:[], selected:null, view:'map', book:null, notice:''};
  try { if (localStorage.getItem('pf_today_view') === 'list') state.view = 'list'; } catch (_) {}

  function apex(snapshot, data) {
    try {
      if (!snapshot?.stats || !Array.isArray(snapshot.enriched) || !window.Apex || typeof window.renderApexCard !== 'function') return null;
      window.renderApexCard(snapshot, {fromToday:true});
      const context = window.__PF_APEX_REVIEW;
      if (!context || context.sourceData !== data || context.sourceSnap !== snapshot || context.generatedAt !== data?.generatedAt) return null;
      const lines = window.Apex.bookLines(context.st, context.out, context.cfg);
      const reviews = window.Apex.bookReviews(context.st, context.out, context.cfg);
      const fresh = window.Apex.priceIsFresh(context.cfg);
      const signature = JSON.stringify([data?.generatedAt, context.cfg.researchAsOf, fresh, lines, reviews, context.st, context.cfg.targets, context.cfg.levels, context.cfg.exitLevels, context.cfg.themeMap, context.cfg.themeCap]);
      return {context, lines, reviews, fresh, signature};
    } catch (_) { return null; }
  }

  function rail(line, book) {
    if (line.side !== 'buy') return '';
    const levels = T.levels(window.Apex.levelsFor(book.context.cfg, line.sym));
    if (!levels) return '';
    return '<div class="td-levels"><span>Stop <strong>' + esc(money(levels.stop)) + '</strong></span><span>Entry limit <strong>' + esc(money(levels.entry)) + '</strong></span><span>Target <strong>' + esc(money(levels.target)) + '</strong></span></div>' +
      '<div class="td-level-track" aria-hidden="true" style="--entry:' + levels.entryPct + '%"><i class="td-level-entry"></i></div>';
  }

  function tradeCard(book) {
    if (!book) return '<div class="td-trade-card"><span class="td-eyebrow">Apex · Self-directed</span><p class="td-empty">The account plan is not available yet. Unlock or refresh the published snapshot to load its proposed trades.</p>' + jump('plan','Open self-directed plan','main') + '</div>';
    const {lines, reviews} = book;
    const label = line => {
      const parts = /^(Buy|Add|Sell) (\d[\d,.]*)( .+)$/.exec(line.text);
      return parts ? esc(parts[1]) + ' <span data-priv="val">' + esc(parts[2]) + '</span>' + esc(parts[3]) : '<span data-priv="val">' + esc(line.text) + '</span>';
    };
    const rows = lines.map(line => '<div class="td-trade-row" data-td-trade="' + esc(line.sym) + '"><strong>' + label(line) + '</strong><span class="td-price">' + esc(line.px || 'Price unavailable') + '</span><p class="td-muted">' + esc(line.sub || '') + '</p></div>' + rail(line, book)).join('');
    const priceNote = book.fresh
      ? 'Quotes ' + age(state.options.data?.generatedAt) + '. Claude re-checks every line live.'
      : 'Reprice required · these are estimates from ' + age(state.options.data?.generatedAt) + ' quotes, not current order prices.';
    return '<div class="td-trade-card"><span class="td-eyebrow">Apex · Self-directed</span>' +
      (lines.length ? '<p class="td-muted" data-td-price-note>' + esc(priceNote) + '</p><div class="td-trade-list">' + rows + '</div><button type="button" class="td-primary" data-td-confirm>Confirm with Claude <span aria-hidden="true">↗</span></button><p class="td-muted" style="margin-top:8px">Full Apex book · ' + lines.length + ' proposed order' + (lines.length === 1 ? '' : 's') + '. You enter approved orders in Robinhood.</p>' : '<p class="td-empty">No proposed Apex trades in the current plan.</p>') +
      (reviews.length ? '<details data-td-details="reviews"><summary class="td-link">' + reviews.length + ' review-only item' + (reviews.length === 1 ? '' : 's') + ' · no orders</summary>' + reviews.map(r => '<p class="td-muted"><strong>' + esc(r.sym) + '</strong> · ' + esc(r.why) + '</p>').join('') + '</details>' : '') +
      '<p class="td-muted" role="status" data-td-confirm-status>' + esc(state.notice) + '</p>' + jump('plan','Open self-directed plan','main') + '</div>';
  }

  function attentionRow(item) {
    return '<div class="td-attention-row"><div><strong>' + esc(item.title) + '</strong><p class="td-muted">' + esc(item.detail) + '</p></div>' + jump(item.route,'Review',item.account) + '</div>';
  }

  function waiting(brief, ticket) {
    const alerts = brief.attention.filter(a => !a.title.startsWith('Agentic ticket:') && a.title !== 'Earnings in the week ahead');
    const earnings = brief.earnings.filter(e => e.days <= 7);
    const count = (state.book && (state.book.lines.length || state.book.reviews.length) ? 1 : 0) + (ticket.group === 'waiting' ? 1 : 0) + alerts.length + earnings.length;
    let html = '<section class="td-waiting td-panel"><div class="td-section-head"><h2>Waiting on you</h2><span class="td-count" aria-label="' + count + ' items to review">' + count + '</span></div>' + tradeCard(state.book);
    if (ticket.group === 'waiting') html += attentionRow({title:'Agentic · ' + ticket.label,detail:ticket.detail,route:'plan',account:'agentic'});
    html += earnings.map(e => '<div class="td-attention-row"><div><strong>' + esc(e.symbol) + ' earnings · ' + esc(when(e.days)) + '</strong><p class="td-muted">' + esc(e.date) + ' · Check the research before acting.</p></div><button type="button" class="td-link" data-td-holding="' + esc(e.symbol) + '">Review <span aria-hidden="true">↗</span></button></div>').join('');
    html += alerts.slice(0,2).map(attentionRow).join('');
    if (alerts.length > 2) html += '<details data-td-details="attention"><summary class="td-link">' + (alerts.length - 2) + ' more items</summary>' + alerts.slice(2).map(attentionRow).join('') + '</details>';
    return html + '</section>';
  }

  function monitor(brief, ticket) {
    let html = '<section class="td-monitor td-panel"><div class="td-section-head"><h2>Out of your hands</h2></div><p class="td-muted">Recorded status · not a live broker feed.</p>';
    if (ticket.group === 'monitor' || ticket.group === 'complete') {
      html += '<div class="td-status-row" data-td-monitor-state="' + esc(brief.pending?.status || '') + '"><div><strong>Agentic ticket</strong><p class="td-muted">' + esc(ticket.detail) + '</p><p class="td-muted">' + esc(date(brief.pending?.updatedAt || brief.pending?.completedAt || brief.pending?.createdAt || brief.pending?.created)) + '</p></div><span class="td-status">' + esc(ticket.label) + '</span></div>';
    } else html += '<p class="td-empty">' + (brief.accounts[1].available ? 'No in-flight agentic ticket is recorded here.' : 'Agentic execution records are unavailable.') + '</p>';
    const expiring = brief.options.expirations.filter(p => p.days >= 0 && p.days <= 7);
    html += expiring.slice(0,2).map(p => '<div class="td-status-row"><div><strong>' + esc(p.underlying) + ' ' + esc(money(M.number(p.strike))) + ' ' + esc(p.type) + '</strong><p class="td-muted">Expires ' + esc(p.expiration) + ' · Self-directed</p></div><span class="td-status">Open contract</span></div>').join('');
    if (expiring.length) html += '<p class="td-muted">Expiration is a calendar event, not an order fill.</p>';
    return html + jump('plan','Open agentic plan','agentic') + '</section>';
  }

  function holdings(brief) {
    const map = T.treemap(state.rows);
    const tiles = map.map(p => '<button type="button" class="td-tile td-' + tone(p.changePct) + (p.share < 9 ? ' td-tile-small' : '') + '" data-td-holding="' + esc(p.symbol) + '" aria-label="Open ' + esc(p.symbol) + ' holding details" style="left:' + p.x + '%;top:' + p.y + '%;width:' + p.w + '%;height:' + p.h + '%"><span class="td-tile-content"><span class="td-ticker">' + esc(p.symbol) + '</span><span class="td-tile-change">' + esc(pct(p.changePct)) + '</span><span class="td-tile-pnl">' + esc(p.partialDay ? 'Partial quotes' : move(p.day)) + '</span></span></button>').join('');
    const rows = state.rows.map(p => '<button type="button" class="td-holding-row" data-td-holding="' + esc(p.symbol) + '"><span><strong>' + esc(p.symbol) + '</strong><span class="td-muted"> · ' + esc(p.shared ? 'Both accounts' : p.sources[0]?.label || 'Account unavailable') + '</span></span><span class="td-' + tone(p.changePct) + '">' + esc(pct(p.changePct)) + '</span><span>' + esc(money(p.value)) + '</span></button>').join('');
    const drag = T.biggestDrag(state.rows);
    const insight = drag ? '<strong>' + esc(drag.symbol) + (brief.partialDay ? ' is the biggest drag among fully quoted holdings.' : ' is today’s biggest drag.') + '</strong> ' + esc(move(drag.day)) + ' on current stock holdings.' : 'No negative stock move is recorded among holdings with complete quotes.';
    return '<section class="td-holdings td-panel"><div class="td-section-head"><div><h2>Your holdings today</h2><span class="td-muted">Both accounts · ' + state.rows.length + ' names</span></div><div class="td-view-switch" aria-label="Holdings view"><button type="button" data-td-view="map" aria-pressed="' + (state.view === 'map') + '">Map</button><button type="button" data-td-view="list" aria-pressed="' + (state.view === 'list') + '">List</button></div></div>' +
      '<div class="td-map"' + (state.view === 'map' ? '' : ' hidden') + '>' + (tiles || '<p class="td-empty">No priced long holdings in this snapshot.</p>') + '</div><div class="td-holdings-list"' + (state.view === 'list' ? '' : ' hidden') + '>' + (rows || '<p class="td-empty">Holdings are unavailable.</p>') + '</div>' +
      '<div class="td-legend"><span>Area = value held</span><span>Color = quoted move</span><span>Grey = flat / no quote</span></div><p class="td-insight">' + insight + '</p><p class="td-muted">' + brief.dayCoverage + ' / ' + brief.positionCount + ' account positions have day quotes. ' + (brief.partialDay ? 'Incomplete day coverage. ' : '') + (map.length !== state.rows.length ? 'Unvalued holdings appear in List. ' : '') + 'Excludes cash and options.</p></section>';
  }

  function disclosures(brief, historyHTML) {
    const options = brief.options;
    const events = options.expirations.filter(p => p.days >= 0 && p.days <= 30).map(p => ({title:p.underlying + ' ' + p.type + ' expiration',date:p.expiration,days:p.days,route:'options',account:'main'}))
      .concat(brief.earnings.map(e => ({title:e.symbol + ' earnings',date:e.date,days:e.days,route:'markets'}))).sort((a,b) => a.days - b.days || a.title.localeCompare(b.title));
    return '<div class="td-links"><details class="td-disclosure" data-td-details="history"><summary>Value over time <span class="td-muted">Daily records</span></summary><div class="td-disclosure-body"><p class="td-muted">Daily observations only. Combined equity uses dates recorded for both accounts.</p>' + historyHTML() + '</div></details>' +
      '<details class="td-disclosure" data-td-details="options"><summary>Options income &amp; exposure</summary><div class="td-disclosure-body"><p class="td-eyebrow">Self-directed · ' + esc(options.year || 'Year not recorded') + '</p>' + fact('Realized options P&L',money(options.broker)) + '<p class="td-muted">Broker reported · ' + esc(date(options.asOf)) + '</p>' + fact('Open contracts',options.positionsKnown ? options.open.reduce((n,p) => n + Number(p.contracts),0) + ' contracts' : 'Unavailable') + (options.open.length ? fact('Open unrealized P&L',money(options.openPnl)) : '') + fact('Shares capped by calls',options.sharesCapped === null ? 'Unavailable' : options.sharesCapped + ' shares') + fact('Put collateral',money(options.cspCash)) + '<p class="td-muted">' + (options.reconciled ? 'Matched contract results reconcile to the broker total.' : 'Contract history is not fully reconciled.') + '</p>' + jump('options','Open options & history','main') + '</div></details>' +
      '<details class="td-disclosure" data-td-details="calendar"><summary>Coming up <span class="td-muted">Next 30 days</span></summary><div class="td-disclosure-body">' + (events.length ? events.map(e => attentionRow({title:e.title,detail:when(e.days) + ' · ' + e.date,route:e.route,account:e.account})).join('') : '<p class="td-empty">No dated events were supplied for the next 30 days.</p>') + '</div></details>' +
      '<details class="td-disclosure ex-brief-method" data-td-details="sources"><summary>Sources, coverage &amp; calculation notes</summary><div class="td-disclosure-body"><p class="td-muted">Published ' + esc(date(brief.generatedAt)) + ' · ' + esc(age(brief.generatedAt)) + '. Saved observations, not live quotes.</p>' +
      brief.accounts.map(a => fact(a.label + ' captured',date(a.accountAsOf))).join('') + fact('Positive cash',money(brief.positiveCash)) + fact('Margin debt',money(brief.marginDebt)) +
      '<p class="td-muted">Combined equity uses published account values, including account cash and option valuations, net of debt. ' + (brief.brokerageBasis ? 'The brokerage basis excludes external prediction-market, futures and crypto sleeves. ' : 'External sleeve coverage follows the recorded account basis. ') + 'Cash stays in its own account and does not offset another account’s margin loan here.</p><p class="td-muted">Stock move compares current quantities and captured prices with the previous close. It excludes intraday trading, option changes, fees and cash flows, so it is not full account P&amp;L. Tile percentages use the reconstructed prior value of the same current shares; missing quotes remain unknown.</p><p class="td-muted">History joins only matching daily records and includes deposits and withdrawals; it is not investment return. Calendar and order coverage is limited to published records.</p>' +
      fact('Options captured',date(options.positionsAsOf)) + fact('Agentic research dated',date(brief.target?.asOf)) + (brief.drawdown ? fact('Agentic deployment guard',brief.drawdown.insufficient ? 'Insufficient history' : brief.drawdown.level || 'Not recorded') : '') + jump('activity','Inspect data & routine status') + jump('decisions','Agentic research & sources','agentic') + '</div></details></div>';
  }

  function closeSheet() {
    const selected = state.selected;
    state.selected = null;
    const dialog = state.host?.querySelector('#td-holding-sheet');
    if (dialog?.open) dialog.close();
    const buttons = state.host?.querySelectorAll('[data-td-holding]') || [];
    [...buttons].find(b => b.dataset.tdHolding === selected && b.getClientRects().length)?.focus({preventScroll:true});
  }

  function openSheet(symbol) {
    const row = state.rows.find(p => p.symbol === symbol), dialog = state.host?.querySelector('#td-holding-sheet');
    if (!row || !dialog) return;
    state.selected = symbol;
    dialog.innerHTML = '<div class="td-sheet-head"><div><span class="td-eyebrow">Holding detail</span><h2 id="td-sheet-title">' + esc(symbol) + '</h2></div><button type="button" data-td-close aria-label="Close holding details">×</button></div><div class="td-sheet-values"><div><span class="td-muted">Combined position</span><strong>' + esc(money(row.value)) + '</strong></div><div><span class="td-muted">Stock move' + (row.partialDay ? ' · partial' : '') + '</span><strong class="td-' + tone(row.day) + '">' + esc(move(row.day)) + '</strong></div></div><p class="td-muted" style="margin-top:12px">' + esc(pct(row.changePct)) + ' vs. previous close · ' + esc(age(state.options.brief.generatedAt)) + ' snapshot.</p><p class="td-muted">' + (row.shared ? 'Held in both accounts. Choose the account to continue.' : 'Continue with this holding’s account.') + '</p>' +
      row.sources.map(source => '<section class="td-source-choice"><strong>' + esc(source.label) + '</strong><p class="td-muted"><span data-priv="val">' + esc(source.qty) + '</span> shares · ' + esc(money(source.value)) + '</p><div class="td-sheet-actions"><button type="button" class="td-secondary" data-td-research="' + source.account + '">Research · ' + esc(source.label) + '</button><button type="button" class="td-secondary" data-td-plan="' + source.account + '">Account plan</button></div></section>').join('') + '<p class="td-muted" style="margin-top:12px">Research opens the existing Analyze screen. Eligibility and confirmation stay in the account plan.</p>';
    window.__privScan?.();
    if (!dialog.open) dialog.showModal();
  }

  function confirm() {
    const previous = state.book;
    const current = apex(window.__SNAP, window.__DATA);
    if (!current || !current.lines.length || current.signature !== previous?.signature) {
      state.notice = 'The plan changed. Review the updated trades, then confirm.';
      window.__experienceRefresh?.();
      return;
    }
    const {st,out,cfg,research} = current.context;
    const prompt = window.Apex.portfolioPrompt(st,out,cfg,research);
    window.open('https://claude.ai/new?q=' + encodeURIComponent(prompt), '_blank', 'noopener,noreferrer');
  }

  function bind(host) {
    if (host._tdBound) return;
    host._tdBound = true;
    host.addEventListener('change', e => { if (e.target.id === 'td-theme') window.PFTheme?.set(e.target.value); });
    host.addEventListener('click', e => {
      const button = e.target.closest('button');
      if (!button) return;
      if (button.dataset.tdView) {
        state.view = button.dataset.tdView === 'list' ? 'list' : 'map';
        try { localStorage.setItem('pf_today_view',state.view); } catch (_) {}
        host.querySelector('.td-map').hidden = state.view !== 'map';
        host.querySelector('.td-holdings-list').hidden = state.view !== 'list';
        host.querySelectorAll('[data-td-view]').forEach(b => b.setAttribute('aria-pressed',String(b.dataset.tdView === state.view)));
      } else if (button.dataset.tdHolding) openSheet(button.dataset.tdHolding);
      else if (button.hasAttribute('data-td-close')) closeSheet();
      else if (button.hasAttribute('data-td-confirm')) confirm();
      else if (button.dataset.tdResearch || button.dataset.tdPlan) {
        const symbol = state.selected, account = button.dataset.tdResearch || button.dataset.tdPlan;
        closeSheet();
        window.PFExperience.navigate(button.dataset.tdResearch ? 'analyze' : 'plan',{account});
        window.PFJourney?.select(symbol);
        if (button.dataset.tdResearch) window.runAnalysis?.(symbol);
      }
    });
    host.addEventListener('cancel', e => { if (e.target.id === 'td-holding-sheet') { e.preventDefault(); closeSheet(); } }, true);
  }

  function render(host, options) {
    if (!host) return;
    state.host = host; state.options = options;
    const {data, snapshot, brief, historyHTML} = options;
    const opened = [...host.querySelectorAll('details[open][data-td-details]')].map(d => d.dataset.tdDetails);
    const selected = state.selected;
    const focused = document.activeElement;
    const focusKey = focused && host.contains(focused) ? ['id','data-td-view','data-td-research','data-td-plan','data-td-close','data-td-confirm'].map(a => focused.hasAttribute(a) ? [a,focused.getAttribute(a)] : null).find(Boolean) : null;
    const preference = window.PFTheme?.preference() || 'light';
    let html = '<div class="td-shell"><header class="td-heading ex-brief-heading"><h1>Today</h1><div class="td-heading-tools"><span data-td-freshness>' + esc(data ? age(brief.generatedAt) : 'Snapshot not loaded') + '</span><label><span class="td-label">Theme</span><select id="td-theme" aria-label="Appearance">' + ['light','dark','system'].map(value => '<option value="' + value + '"' + (preference === value ? ' selected' : '') + '>' + value[0].toUpperCase() + value.slice(1) + '</option>').join('') + '</select></label></div></header>';
    if (!data || !brief.available) {
      state.rows = []; state.book = null; state.selected = null;
      host.innerHTML = html + '<section class="td-panel"><p class="td-empty">Unlock your published snapshot to see both accounts together.</p></section></div>';
      bind(host); return;
    }
    state.rows = T.holdings(brief);
    state.book = apex(snapshot,data);
    const ticket = T.ticket(brief.pending), leverage = M.number(state.book?.context.st.lev);
    html += '<div class="td-layout"><section class="td-hero td-panel ex-brief-hero"><span class="td-eyebrow">Combined ' + (brief.brokerageBasis ? 'brokerage' : 'account') + ' equity</span><div class="td-hero-line"><strong id="ex-combined-equity">' + esc(money(brief.equity)) + '</strong><div class="td-hero-change"><strong class="td-' + tone(brief.day) + '" id="ex-combined-move">' + esc(move(brief.day)) + '</strong><span>Stock move today' + (brief.partialDay ? ' · partial quotes' : '') + '</span></div></div><p class="td-muted">Self-directed + Agentic · net of account debt.</p><div class="td-account-grid">' + brief.accounts.map(a => '<section class="td-account" data-brief-account="' + a.account + '"><div class="td-account-head"><span>' + esc(a.label) + '</span>' + jump('accounts','Portfolio',a.account) + '</div><strong class="td-account-value">' + esc(money(a.equity)) + '</strong><div class="td-account-meta"><span class="td-' + tone(a.day) + '">' + esc(move(a.day)) + '</span><span>stock move</span></div>' + (a.account === 'main' && leverage !== null ? '<div class="td-account-meta">Leverage <span data-priv="val">' + leverage.toFixed(2) + '×</span></div>' : '') + '</section>').join('') + '</div></section>';
    html += waiting(brief,ticket) + monitor(brief,ticket) + holdings(brief) + disclosures(brief,historyHTML);
    const names = {SPY:'S&P 500',QQQ:'Nasdaq 100',IWM:'Small caps'};
    html += '<section class="td-market td-panel" data-priv="off"><div class="td-section-head"><h2>Market backdrop</h2>' + jump('markets','Explore') + '</div><div class="ex-market-grid">' + brief.markets.map(m => '<div><span>' + esc(names[m.symbol]) + ' <small>' + m.symbol + '</small></span><strong class="td-' + tone(m.change) + '">' + esc(pct(m.change)) + '</strong></div>').join('') + '</div><p class="td-muted" style="margin-top:12px">VIX ' + esc(brief.vix.value === null ? 'Unavailable' : brief.vix.value.toFixed(1)) + ' · captured quotes vs. previous close. Published ' + esc(date(brief.generatedAt)) + '.</p></section></div><dialog id="td-holding-sheet" class="td-sheet" aria-labelledby="td-sheet-title" data-priv="on"></dialog></div>';
    host.innerHTML = html;
    bind(host);
    host.querySelectorAll('details[data-td-details]').forEach(d => { d.open = opened.includes(d.dataset.tdDetails); });
    window.__privScan?.();
    if (selected && state.rows.some(p => p.symbol === selected)) openSheet(selected);
    else state.selected = null;
    if (focusKey) [...host.querySelectorAll('[' + focusKey[0] + ']')].find(el => el.getAttribute(focusKey[0]) === focusKey[1])?.focus({preventScroll:true});
  }

  document.addEventListener('pf:route', e => {
    document.documentElement.classList.toggle('pf-today-premium',e.detail.route === 'today');
    if (e.detail.route !== 'today') { state.selected = null; state.host?.querySelector('#td-holding-sheet')?.close(); }
  });
  document.addEventListener('pf:theme', e => {
    const select = document.getElementById('td-theme');
    if (select) select.value = e.detail.preference;
  });
  window.PFToday = Object.freeze({render});
})();
