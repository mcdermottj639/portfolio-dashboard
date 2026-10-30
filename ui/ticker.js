/* v169 — Market tape: a rolling strip fixed to the top of every screen (see ui/ticker.css).
   Read-only and display-only. It renders the DECRYPTED published snapshot (window.__DATA, plus the
   self-directed book in window.__SNAP once the dashboard has built it) through the same
   PFExperienceModel.dailyBrief the Today page uses, so the tape can never disagree with the brief.
   It makes no network or broker call, so it is exactly as live as the snapshot: the status pill says
   LIVE only while the market is open AND the snapshot is under 75 minutes old; otherwise it shows the
   snapshot time. Taps: a symbol opens Analyze, an option opens Options, an alert opens its page.
   Privacy: in 🙈 mode every dollar figure is replaced by bullets (percentages and prices stay). */
(function () {
  'use strict';
  var M = function () { return window.PFExperienceModel; };
  var LIVE_MAX_MIN = 75, SPEED = 42; // px per second
  var TAPE_BG = '#0a120f'; window.PF_TAPE_BG = TAPE_BG;
  var MARKETS = ['SPY', 'QQQ', 'DIA', 'IWM', 'IBIT', 'GLD', 'TLT'];
  var TIER = { ASSIGNMENT_WIN: ['g', 'Let assign'], LET_IT_RIDE: ['g', 'Let ride'], ASSIGNMENT_LIKELY: ['b', 'Likely assigned'],
    ROLL_WINDOW: ['a', 'Roll window'], STRIKE_UNDER_BASIS: ['r', 'Under basis'], EXTENDED_STOCK: ['r', "Don't roll up"],
    HOLD: ['', 'Hold'], INSUFFICIENT_DATA: ['', 'No data'] };

  function num(v) { var n = typeof v === 'string' && !v.trim() ? NaN : Number(v); return Number.isFinite(n) ? n : null; }
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function priv() { return document.body && document.body.classList.contains('pf-private'); }
  function money(n, signed) {
    if (n == null) return '—';
    if (priv()) return '•••';
    var a = Math.abs(n), s = a >= 1e6 ? (a / 1e6).toFixed(2) + 'M' : a >= 1e4 ? (a / 1e3).toFixed(1) + 'K' : a.toLocaleString('en-US', { maximumFractionDigits: 0 });
    return (n < 0 ? '−' : signed ? '+' : '') + '$' + s;
  }
  function px(n) { return n == null ? '—' : n >= 1000 ? n.toLocaleString('en-US', { maximumFractionDigits: 0 }) : n.toFixed(2); }
  function chg(p) {
    if (p == null) return '<span class="tk-chg flat">—</span>';
    var cls = Math.abs(p) < 0.005 ? 'flat' : p > 0 ? 'up' : 'dn';
    var tri = cls === 'up' ? '▲' : cls === 'dn' ? '▼' : '•';
    return '<span class="tk-chg ' + cls + '"><span class="tk-tri">' + tri + '</span>' + Math.abs(p).toFixed(2) + '%</span>';
  }
  function quoteMove(d, sym) {
    var q = d && d.quotes && d.quotes[sym]; if (!q) return null;
    var last = num(q.last_trade_price), prev = num(q.adjusted_previous_close != null ? q.adjusted_previous_close : q.previous_close);
    if (!(last > 0)) return null;
    return { px: last, pct: prev > 0 ? (last - prev) / prev * 100 : null };
  }
  function etParts(t) {
    var f = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: 'numeric', minute: 'numeric', hour12: false });
    var o = {}; f.formatToParts(t).forEach(function (p) { o[p.type] = p.value; });
    return { wd: o.weekday, min: (Number(o.hour) % 24) * 60 + Number(o.minute) };
  }
  function marketOpen(now) { var e = etParts(now); return !/Sat|Sun/.test(e.wd) && e.min >= 570 && e.min < 960; }
  function timeLabel(iso) {
    var t = Date.parse(iso); if (!Number.isFinite(t)) return '';
    var s = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' }).format(t);
    var sameDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(t) === new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(Date.now());
    return sameDay ? s : new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric' }).format(t) + ' ' + s;
  }

  function item(inner, attrs, label) { return '<span class="tk-it" role="button" tabindex="-1"' + (attrs || '') + (label ? ' aria-label="' + esc(label) + '"' : '') + '>' + inner + '</span>'; }
  function symItem(d, sym) {
    var m = quoteMove(d, sym); if (!m) return '';
    return item('<span class="tk-sym">' + esc(sym) + '</span><span class="tk-px">' + px(m.px) + '</span>' + chg(m.pct), ' data-tk-sym="' + esc(sym) + '"', sym + ' ' + px(m.px));
  }
  function sec(cls, text) { return '<span class="tk-sec ' + cls + '">' + esc(text) + '</span>'; }

  function content(d) {
    var model = M(); if (!model) return '';
    var cal = {}; try { if (typeof window._earnMap === 'function') cal = window._earnMap() || {}; } catch (e) {}
    var s; try { s = model.dailyBrief(d, window.__SNAP, { calendar: cal }); } catch (e) { return ''; }
    var out = [];

    // Your book — combined day move first, because it is the number the owner opens the app for.
    var book = [];
    if (s.day != null) {
      var basis = s.equity != null ? s.equity - s.day : null, pct = basis > 0 ? s.day / basis * 100 : null;
      book.push(item('<span class="tk-sym">Today</span><span class="tk-big">' + money(s.day, true) + '</span>' + chg(pct) + (s.partialDay ? '<span class="tk-muted">partial</span>' : ''), ' data-ex-route="today"', 'Combined day move'));
    }
    s.accounts.forEach(function (a) {
      if (a.day == null && a.equity == null) return;
      book.push(item('<span class="tk-sym">' + esc(a.label) + '</span><span class="tk-px">' + money(a.equity) + '</span>' + chg(a.dayPct), ' data-ex-route="accounts" data-ex-account="' + esc(a.account) + '"', a.label));
    });
    var b = s.breadth;
    if (b && (b.up || b.down)) book.push(item('<span class="tk-sym">Breadth</span><span class="tk-chg up"><span class="tk-tri">▲</span>' + b.up + '</span><span class="tk-chg dn"><span class="tk-tri">▼</span>' + b.down + '</span>' + (b.flat ? '<span class="tk-muted">' + b.flat + ' flat</span>' : ''), ' data-ex-route="today"', 'Holdings up and down'));
    if (book.length) out.push(sec('s-book', 'Your book') + book.join(''));

    // Markets
    var mk = MARKETS.map(function (x) { return symItem(d, x); }).filter(Boolean);
    var vix = num(d.vix && d.vix.v);
    if (vix != null) mk.splice(Math.min(4, mk.length), 0, item('<span class="tk-sym">VIX</span><span class="tk-px">' + vix.toFixed(2) + '</span><span class="tk-pill ' + (vix >= 25 ? 'r' : vix >= 18 ? 'a' : 'g') + '">' + (vix >= 25 ? 'Fear' : vix >= 18 ? 'Elevated' : 'Calm') + '</span>', ' data-ex-route="markets"', 'VIX ' + vix.toFixed(2)));
    if (mk.length) out.push(sec('', 'Markets') + mk.join(''));

    // Holdings — every quoted position across both accounts, biggest first (value itself not shown).
    var hold = s.positions.map(function (p) { return symItem(d, p.symbol); }).filter(Boolean);
    if (hold.length) out.push(sec('s-hold', 'Holdings') + hold.join(''));

    // Options — open contracts with their guardrail verdict and days left.
    var opts = (s.options.expirations || []).slice(0, 12).map(function (p) {
      var g = p.guardrail && TIER[p.guardrail.tier], t = String(p.type || '').charAt(0).toUpperCase();
      var dte = p.days < 0 ? 'expired' : p.days === 0 ? 'today' : p.days + 'd';
      return item('<span class="tk-sym">' + esc(p.underlying || p.symbol) + ' ' + esc(p.strike != null ? '$' + p.strike : '') + esc(t) + '</span><span class="tk-px">' + dte + '</span>' + (g ? '<span class="tk-pill ' + g[0] + '">' + esc(g[1]) + '</span>' : ''), ' data-tk-tab="options"', 'Option ' + (p.underlying || ''));
    });
    if (opts.length) out.push(sec('s-opt', 'Options') + opts.join(''));

    // Earnings in the next two weeks
    var earn = s.earnings.filter(function (e) { return e.days <= 14; }).map(function (e) {
      var w = e.days === 0 ? 'today' : e.days === 1 ? 'tomorrow' : 'in ' + e.days + 'd';
      return item('<span class="tk-sym">' + esc(e.symbol) + '</span><span class="tk-pill a">' + w + '</span>' + (e.when ? '<span class="tk-muted">' + esc(e.when) + '</span>' : ''), ' data-tk-sym="' + esc(e.symbol) + '"', e.symbol + ' earnings ' + w);
    });
    if (earn.length) out.push(sec('s-earn', 'Earnings') + earn.join(''));

    // Agentic account state
    var ag = [];
    var dd = s.drawdown;
    if (dd && !dd.insufficient && dd.level) ag.push(item('<span class="tk-sym">Breaker</span><span class="tk-pill ' + (dd.level === 'hard' ? 'r' : dd.level === 'soft' ? 'a' : 'g') + '">' + esc(dd.level === 'ok' ? 'Clear' : dd.level) + '</span>' + (num(dd.relDd) != null ? '<span class="tk-muted">vs SPY ' + (dd.relDd * 100).toFixed(1) + 'pp</span>' : ''), ' data-ex-route="plan" data-ex-account="agentic"', 'Drawdown breaker'));
    var pend = s.pending;
    if (pend && pend.status && ['done', 'aborted', 'cancelled'].indexOf(pend.status) < 0) ag.push(item('<span class="tk-sym">Ticket</span><span class="tk-pill b">' + esc(String(pend.status).replace(/-/g, ' ')) + '</span>', ' data-ex-route="plan" data-ex-account="agentic"', 'Agentic ticket'));
    if (ag.length) out.push(sec('s-agent', 'Agentic') + ag.join(''));

    // Needs a look — the Today radar's warnings, shortest form.
    var al = s.attention.filter(function (a) { return a.tone === 'warn'; }).slice(0, 4).map(function (a) {
      return item('<span class="tk-sym">' + esc(a.title) + '</span>', ' data-ex-route="' + esc(a.route || 'today') + '"' + (a.account ? ' data-ex-account="' + esc(a.account) + '"' : ''), a.title);
    });
    if (al.length) out.push(sec('s-alert', 'Heads up') + al.join(''));
    return out.join('');
  }

  var el, track, view, stat, lastSig = '';
  function mount() {
    if (el) return;
    el = document.createElement('div'); el.className = 'pf-tape'; el.id = 'pf-tape'; el.setAttribute('aria-label', 'Market tape');
    el.innerHTML = '<div class="tk-stat" role="button" tabindex="0" title="Tap to pause / play"><span class="tk-dot"></span><span class="tk-stat-txt">Tape</span></div><div class="tk-view"><div class="tk-track"></div></div>';
    document.body.insertBefore(el, document.body.firstChild);
    document.documentElement.classList.add('pf-has-tape');
    // v170: the status bar must take the tape's colour, not the page's ivory — otherwise iOS paints a
    // light haze (and its scroll-edge blur) over the top of the tape. themeColor() in index.html returns
    // TAPE_BG while the tape is mounted, so a theme toggle keeps it.
    try { var m = document.querySelector('meta[name="theme-color"]'); if (m) m.setAttribute('content', TAPE_BG); } catch (e) {}
    track = el.querySelector('.tk-track'); view = el.querySelector('.tk-view'); stat = el.querySelector('.tk-stat');
    var hold = function () { el.classList.add('tk-hold'); }, go = function () { if (!el.classList.contains('tk-paused')) el.classList.remove('tk-hold'); };
    view.addEventListener('pointerdown', hold); view.addEventListener('pointerup', go); view.addEventListener('pointercancel', go); view.addEventListener('pointerleave', go);
    view.addEventListener('mouseenter', hold); view.addEventListener('mouseleave', go);
    stat.addEventListener('click', function () { var p = el.classList.toggle('tk-paused'); el.classList.toggle('tk-hold', p); });
    track.addEventListener('click', function (e) {
      var it = e.target.closest('.tk-it'); if (!it) return;
      var sym = it.getAttribute('data-tk-sym'), tab = it.getAttribute('data-tk-tab');
      if (sym && typeof window.switchTab === 'function') { window.switchTab('analyze'); if (typeof window.runAnalysis === 'function') setTimeout(function () { window.runAnalysis(sym); window.scrollTo(0, 0); }, 30); }
      else if (tab && typeof window.switchTab === 'function') { window.switchTab(tab); window.scrollTo(0, 0); }
      // data-ex-route items are handled by experience.js's document-level click router.
    });
    if (window._syncStickyTop) try { window._syncStickyTop(); } catch (e) {}
  }
  function paintStat(d) {
    if (!stat) return;
    var t = stat.querySelector('.tk-stat-txt'), now = Date.now();
    stat.classList.remove('is-live', 'is-stale');
    if (!d || d.locked) { t.innerHTML = 'Locked'; return; }
    if (d.error) { stat.classList.add('is-stale'); t.innerHTML = 'Offline'; return; }
    var gen = Date.parse(d.generatedAt), ageMin = Number.isFinite(gen) ? (now - gen) / 60000 : null;
    if (marketOpen(now) && ageMin != null && ageMin <= LIVE_MAX_MIN) { stat.classList.add('is-live'); t.innerHTML = 'Live <b>' + esc(timeLabel(d.generatedAt)) + '</b>'; }
    else { if (marketOpen(now)) stat.classList.add('is-stale'); t.innerHTML = (marketOpen(now) ? 'As of' : 'Close') + ' <b>' + esc(timeLabel(d.generatedAt)) + '</b>'; }
  }
  function render() {
    var d = window.__DATA;
    mount(); paintStat(d);
    var html = !d || d.locked ? '<span class="tk-it"><span class="tk-sym">🔒 Unlock to start your tape</span></span>'
      : d.error ? '<span class="tk-it"><span class="tk-muted">Snapshot could not load</span></span>'
      : content(d);
    var sig = html + '|' + priv();
    if (sig === lastSig) return;
    lastSig = sig;
    if (!html) { track.innerHTML = ''; return; }
    var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    track.innerHTML = '<div class="tk-half">' + html + '</div>' + (reduce ? '' : '<div class="tk-half" aria-hidden="true">' + html + '</div>');
    var w = track.firstChild.getBoundingClientRect().width;
    var fits = w <= view.clientWidth;
    el.classList.toggle('tk-static', fits || !!reduce);
    if (fits && track.children[1]) track.removeChild(track.children[1]);
    track.style.setProperty('--tk-dur', Math.max(20, Math.round(w / SPEED)) + 's');
  }
  function schedule() {
    render();
    // The self-directed book (window.__SNAP) is assembled a beat after decryption; repaint until it lands.
    var tries = 0, t = setInterval(function () { tries++; render(); if (window.__SNAP || tries > 20) clearInterval(t); }, 500);
    setInterval(render, 60000);
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') render(); });
    if (window.MutationObserver) new MutationObserver(function () { render(); }).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  }
  function start() {
    if (!document.body) return;
    mount();
    if (window.__dataReady && typeof window.__dataReady.then === 'function') window.__dataReady.then(schedule, schedule);
    else schedule();
  }
  window.PFTape = { render: render, _content: content, _marketOpen: marketOpen };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
