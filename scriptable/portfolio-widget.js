// Portfolio Pulse — a Scriptable home/lock-screen widget for the Portfolio Dashboard PWA.
//
// What it shows (medium): total value · day P&L $/% · total P&L $/% on cost · a YTD
// portfolio-value sparkline · top gainer/laggard · snapshot age (amber when ≥3h old).
// Small: value + day %. Accessory (lock screen): day %.
//
// HOW IT WORKS — it reuses the dashboard's own encryption, byte-for-byte.
// data.json on GitHub Pages is AES-GCM encrypted (PBKDF2-SHA256, 150k iters → AES-256-GCM;
// see producer/emit.mjs). Scriptable's JS engine has no crypto.subtle, so we load the live
// GitHub Pages origin in an offscreen WebView (a real, secure browser context where WebCrypto
// exists) and, inside it, same-origin fetch data.json + decrypt with the identical scheme.
// The decrypted JSON comes back to Scriptable; nothing is re-implemented or able to drift.
//
// SETUP (one time): see scriptable/README.md. In short — paste this into a new Scriptable
// script, run it once in-app to store your passphrase in the Keychain, then add a Scriptable
// widget to your home screen and pick this script.

// ---- config -----------------------------------------------------------------
const SITE = 'https://mcdermottj639.github.io/portfolio-dashboard/';
const PASS_KEY = 'pf_passphrase';          // Keychain entry holding the unlock passphrase
const STALE_HOURS = 3;                      // matches the app's freshness-bar amber threshold
const SPARK_POINTS = 90;                    // trailing portfolio-value points to plot

// ---- theme (a "tasteful HUD" dark, echoing the app's Neon theme) ------------
const C = {
  bg0: new Color('#0b0f17'), bg1: new Color('#10161f'),
  ink: new Color('#e6edf3'), dim: new Color('#8b98a8'),
  up: new Color('#3ddc97'), down: new Color('#ff6b6b'),
  accent: new Color('#36d6e7'), amber: new Color('#f5a623'),
  line: new Color('#1c2733'),
};

// ---- helpers ----------------------------------------------------------------
const qpx = (q) => parseFloat(q.last_trade_price || q.last_price || q.last_extended_hours_trade_price || 0);
const qprev = (q) => parseFloat(q.adjusted_previous_close || q.previous_close || 0);
const barDate = (b) => String(b.begins_at || b.t || '').slice(0, 10);
const barClose = (b) => parseFloat(b.close_price != null ? b.close_price : (b.c != null ? b.c : 0));

const money = (v) => {
  const a = Math.abs(v);
  const s = a >= 1000 ? a.toLocaleString('en-US', { maximumFractionDigits: 0 })
                      : a.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (v < 0 ? '-$' : '$') + s;
};
const signed = (v, d = 2) => (v >= 0 ? '+' : '') + v.toFixed(d);
const pct = (v) => signed(v, 2) + '%';

// Find a replay-recorded MCP response by a substring of its key (avoids reconstructing the
// exact makeKey() with the account number — robust to whatever account the producer used).
function findRecorded(data, needle) {
  const rec = data.recorded || {};
  for (const k of Object.keys(rec)) if (k.indexOf(needle) !== -1) return rec[k];
  return null;
}

// ---- fetch + decrypt via the live origin's WebCrypto ------------------------
async function loadSnapshot(pass) {
  const wv = new WebView();
  await wv.loadURL(SITE);                    // secure https origin → crypto.subtle is available
  const js = `
    (function(){
      var pass = ${JSON.stringify(pass)};
      fetch('data.json?ts=' + Date.now(), { cache: 'no-store' })
        .then(function(r){ return r.json(); })
        .then(function(env){
          if (!env || !env.enc) return JSON.stringify(env); // plaintext dev/sample snapshot
          var b64d = function(s){ return Uint8Array.from(atob(s), function(c){ return c.charCodeAt(0); }); };
          return crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey'])
            .then(function(km){
              return crypto.subtle.deriveKey(
                { name:'PBKDF2', salt:b64d(env.salt), iterations: env.iter || 150000, hash:'SHA-256' },
                km, { name:'AES-GCM', length:256 }, false, ['decrypt']);
            })
            .then(function(key){
              return crypto.subtle.decrypt({ name:'AES-GCM', iv:b64d(env.iv) }, key, b64d(env.ct));
            })
            .then(function(pt){ return new TextDecoder().decode(pt); });
        })
        .then(function(t){ completion(t); })
        .catch(function(e){ completion('__ERR__' + (e && e.message ? e.message : String(e))); });
    })();
  `;
  const out = await wv.evaluateJavaScript(js, true); // true → wait for completion()
  if (typeof out === 'string' && out.indexOf('__ERR__') === 0) {
    throw new Error(out.slice(7));
  }
  return JSON.parse(out);
}

// ---- derive the numbers the widget shows ------------------------------------
function computeStats(data) {
  const posRec = findRecorded(data, 'get_equity_positions');
  const positions = (posRec && posRec.structuredContent && posRec.structuredContent.data
    && posRec.structuredContent.data.positions) || [];
  const pfRec = findRecorded(data, 'get_portfolio');
  const pf = (pfRec && pfRec.structuredContent && pfRec.structuredContent.data) || {};
  const quotes = data.quotes || {};

  let equity = 0, cost = 0, dayPL = 0;
  const movers = [];
  for (const p of positions) {
    const sym = p.symbol, qty = parseFloat(p.quantity || 0), avg = parseFloat(p.average_buy_price || 0);
    const q = quotes[sym];
    if (!q || !(qty > 0)) continue;
    const px = qpx(q), prev = qprev(q);
    if (px > 0) { equity += px * qty; cost += avg * qty; }
    if (px > 0 && prev > 0) { dayPL += (px - prev) * qty; movers.push({ sym, pct: (px / prev - 1) * 100 }); }
  }
  movers.sort((a, b) => b.pct - a.pct);

  // Headline = full account value (incl. cash) when the producer recorded it; else equity sum.
  const totalValue = parseFloat(pf.total_value) > 0 ? parseFloat(pf.total_value) : equity;
  const prevEquity = equity - dayPL;
  const dayPct = prevEquity > 0 ? (dayPL / prevEquity) * 100 : 0;
  const totalPL = equity - cost;
  const totalPct = cost > 0 ? (totalPL / cost) * 100 : 0;

  return {
    totalValue, dayPL, dayPct, totalPL, totalPct,
    top: movers[0] || null, bottom: movers.length ? movers[movers.length - 1] : null,
    series: portfolioSeries(positions, quotes, data.hist && data.hist.day),
    label: data.generatedAtLabel || '', generatedAt: data.generatedAt || null,
    sample: !!data.sample,
  };
}

// Forward-filled portfolio-value time series from per-holding daily bars (dates rarely align
// across holdings, so carry each holding's last known close forward and sum qty×close per date).
function portfolioSeries(positions, quotes, day) {
  if (!day) return [];
  const held = positions.filter((p) => day[p.symbol] && parseFloat(p.quantity) > 0);
  if (!held.length) return [];
  const dateSet = new Set();
  const maps = {};
  for (const p of held) {
    const m = {};
    for (const b of day[p.symbol]) { const d = barDate(b); m[d] = barClose(b); dateSet.add(d); }
    maps[p.symbol] = m;
  }
  const dates = [...dateSet].sort();
  const last = {};
  const series = [];
  for (const d of dates) {
    let v = 0, any = false;
    for (const p of held) {
      const c = maps[p.symbol][d];
      if (c != null) last[p.symbol] = c;
      if (last[p.symbol] != null) { v += last[p.symbol] * parseFloat(p.quantity); any = true; }
    }
    if (any) series.push(v);
  }
  return series.slice(-SPARK_POINTS);
}

function ageHours(generatedAt) {
  if (!generatedAt) return null;
  const t = Date.parse(generatedAt);
  if (isNaN(t)) return null;
  return (Date.now() - t) / 3600000;
}
function ageLabel(h) {
  if (h == null) return '';
  if (h < 1) return Math.max(1, Math.round(h * 60)) + 'm ago';
  if (h < 24) return Math.round(h) + 'h ago';
  return Math.round(h / 24) + 'd ago';
}

// ---- sparkline image --------------------------------------------------------
function sparkline(series, w, h, color) {
  const ctx = new DrawContext();
  ctx.size = new Size(w, h);
  ctx.opaque = false;
  ctx.respectScreenScale = true;
  if (!series || series.length < 2) return ctx.getImage();
  const lo = Math.min(...series), hi = Math.max(...series);
  const span = hi - lo || 1;
  const pad = 2;
  const x = (i) => pad + (i / (series.length - 1)) * (w - 2 * pad);
  const y = (v) => pad + (1 - (v - lo) / span) * (h - 2 * pad);

  // soft fill under the curve
  const fill = new Path();
  fill.move(new Point(x(0), h));
  for (let i = 0; i < series.length; i++) fill.addLine(new Point(x(i), y(series[i])));
  fill.addLine(new Point(x(series.length - 1), h));
  fill.closeSubpath();
  ctx.setFillColor(new Color(color.hex, 0.12));
  ctx.addPath(fill);
  ctx.fillPath();

  const line = new Path();
  line.move(new Point(x(0), y(series[0])));
  for (let i = 1; i < series.length; i++) line.addLine(new Point(x(i), y(series[i])));
  ctx.setStrokeColor(color, 1);
  ctx.setLineWidth(2.4);
  ctx.addPath(line);
  ctx.strokePath();
  return ctx.getImage();
}

// ---- widget rendering -------------------------------------------------------
function gradientBg(w) {
  const g = new LinearGradient();
  g.colors = [C.bg0, C.bg1];
  g.locations = [0, 1];
  w.backgroundGradient = g;
}

function buildMedium(s) {
  const w = new ListWidget();
  w.setPadding(14, 16, 14, 16);
  gradientBg(w);
  const dayColor = s.dayPL >= 0 ? C.up : C.down;

  // header
  const head = w.addStack();
  const title = head.addText(s.sample ? 'PORTFOLIO · SAMPLE' : 'PORTFOLIO');
  title.font = Font.semiboldSystemFont(10);
  title.textColor = C.accent;
  head.addSpacer();
  const h = ageHours(s.generatedAt);
  const stale = h != null && h >= STALE_HOURS;
  const age = head.addText((stale ? '↻ ' : '') + ageLabel(h));
  age.font = Font.systemFont(10);
  age.textColor = stale ? C.amber : C.dim;
  w.addSpacer(6);

  // headline value
  const val = w.addText(money(s.totalValue));
  val.font = Font.boldSystemFont(30);
  val.textColor = C.ink;
  w.addSpacer(2);

  // day P&L line
  const dayRow = w.addStack();
  dayRow.centerAlignContent();
  const arrow = dayRow.addText(s.dayPL >= 0 ? '▲' : '▼');
  arrow.font = Font.systemFont(12);
  arrow.textColor = dayColor;
  dayRow.addSpacer(4);
  const dayTxt = dayRow.addText(money(s.dayPL) + '  ' + pct(s.dayPct) + ' today');
  dayTxt.font = Font.mediumSystemFont(13);
  dayTxt.textColor = dayColor;

  // total P&L line
  const tpl = w.addText('P&L ' + money(s.totalPL) + '  ' + pct(s.totalPct) + ' on cost');
  tpl.font = Font.systemFont(11);
  tpl.textColor = C.dim;
  w.addSpacer(8);

  // sparkline
  if (s.series.length >= 2) {
    const sparkColor = s.series[s.series.length - 1] >= s.series[0] ? C.up : C.down;
    const img = w.addImage(sparkline(s.series, 600, 120, sparkColor));
    img.imageSize = new Size(300, 42);
  } else {
    w.addSpacer(42);
  }
  w.addSpacer(6);

  // movers
  const mv = w.addStack();
  mv.centerAlignContent();
  if (s.top) addMover(mv, '▲', s.top, C.up);
  mv.addSpacer();
  if (s.bottom && s.bottom !== s.top) addMover(mv, '▼', s.bottom, C.down);
  return w;
}

function addMover(stack, glyph, m, color) {
  const t = stack.addText(glyph + ' ' + m.sym + ' ' + pct(m.pct));
  t.font = Font.mediumSystemFont(11);
  t.textColor = color;
}

function buildSmall(s) {
  const w = new ListWidget();
  w.setPadding(14, 14, 14, 14);
  gradientBg(w);
  const dayColor = s.dayPL >= 0 ? C.up : C.down;
  const title = w.addText('PORTFOLIO');
  title.font = Font.semiboldSystemFont(10);
  title.textColor = C.accent;
  w.addSpacer(6);
  const val = w.addText(money(s.totalValue));
  val.font = Font.boldSystemFont(22);
  val.textColor = C.ink;
  w.addSpacer(2);
  const day = w.addText((s.dayPL >= 0 ? '▲ ' : '▼ ') + pct(s.dayPct));
  day.font = Font.mediumSystemFont(14);
  day.textColor = dayColor;
  w.addSpacer();
  const h = ageHours(s.generatedAt);
  const stale = h != null && h >= STALE_HOURS;
  const age = w.addText((stale ? '↻ ' : '') + ageLabel(h));
  age.font = Font.systemFont(9);
  age.textColor = stale ? C.amber : C.dim;
  return w;
}

function buildAccessory(s) {
  const w = new ListWidget();
  const dayColor = s.dayPL >= 0 ? C.up : C.down;
  const v = w.addText(money(s.totalValue));
  v.font = Font.boldSystemFont(15);
  const d = w.addText((s.dayPL >= 0 ? '▲ ' : '▼ ') + pct(s.dayPct) + ' today');
  d.font = Font.systemFont(12);
  d.textColor = dayColor;
  return w;
}

function buildError(msg) {
  const w = new ListWidget();
  w.setPadding(14, 16, 14, 16);
  gradientBg(w);
  const t = w.addText('Portfolio');
  t.font = Font.semiboldSystemFont(11);
  t.textColor = C.accent;
  w.addSpacer(6);
  const e = w.addText('⚠️ ' + msg);
  e.font = Font.systemFont(12);
  e.textColor = C.amber;
  w.addSpacer(4);
  const hint = w.addText('Open Scriptable and run once to set your passphrase.');
  hint.font = Font.systemFont(10);
  hint.textColor = C.dim;
  return w;
}

// ---- passphrase (Keychain), with a one-time in-app prompt -------------------
async function getPassphrase() {
  if (Keychain.contains(PASS_KEY)) return Keychain.get(PASS_KEY);
  if (config.runsInWidget) return null;     // can't prompt inside a widget
  const a = new Alert();
  a.title = 'Portfolio passphrase';
  a.message = 'Enter the dashboard unlock passphrase. It is stored only in this device\'s Keychain.';
  a.addSecureTextField('passphrase', '');
  a.addAction('Save');
  a.addCancelAction('Cancel');
  const idx = await a.present();
  if (idx === -1) return null;
  const pass = a.textFieldValue(0);
  if (pass) Keychain.set(PASS_KEY, pass);
  return pass || null;
}

// ---- main -------------------------------------------------------------------
async function main() {
  let widget;
  try {
    const pass = await getPassphrase();
    if (!pass) { widget = buildError('No passphrase set'); }
    else {
      const data = await loadSnapshot(pass);
      const s = computeStats(data);
      const fam = config.widgetFamily;
      if (fam === 'small') widget = buildSmall(s);
      else if (fam === 'accessoryRectangular' || fam === 'accessoryInline') widget = buildAccessory(s);
      else widget = buildMedium(s);
    }
  } catch (e) {
    const m = /operation/i.test(String(e)) || /decrypt/i.test(String(e))
      ? 'Wrong passphrase?' : String(e.message || e).slice(0, 60);
    widget = buildError(m);
  }
  // refresh roughly every 15 min (the producer publishes a few times per market day)
  widget.refreshAfterDate = new Date(Date.now() + 15 * 60 * 1000);

  if (config.runsInWidget) Script.setWidget(widget);
  else await widget.presentMedium();
  Script.complete();
}

await main();
