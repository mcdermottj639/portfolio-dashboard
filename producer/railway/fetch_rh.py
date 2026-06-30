#!/usr/bin/env python3
"""
fetch_rh.py — the Robinhood fetch layer for the Railway producer.

This replaces the ONE thing the scheduled Claude agent uniquely did: making the
Robinhood MCP calls. Everything else (encrypt, carry-forward, validate, publish)
is still the existing Node pipeline — this script only writes the raw/*.json files
that `producer/build-data.mjs` already knows how to parse, then the entrypoint runs
`node producer/run.mjs`.

It writes files in the SAME normalized shapes the MCP connector produced, so the
replay contract is unchanged:

  producer/raw/portfolio.json      { total_value, equity_value, cash, buying_power:{buying_power} }
  producer/raw/positions.json      { positions: [ {symbol, quantity, average_buy_price}, ... ] }
  producer/raw/quotes.json         { results: [ <raw RH quote dict>, ... ] }
  producer/raw/hist-day-N.json     { results: [ {symbol, bars:[{t,c}, ...]}, ... ] }   (FETCH_ALL)
  producer/raw/hist-month-N.json   { results: [ {symbol, bars:[{t,c}, ...]}, ... ] }   (FETCH_ALL)
  producer/raw/holdings-fund.json  { results: [ {symbol, sector, pe_ratio, market_cap, ...}, ... ] } (FETCH_ALL)
  producer/raw/index-quotes.json   { quotes: [ {symbol:"VIX", value:"<n>"} ] }          (best-effort)

Gaps carried forward from the prior snapshot (build-data overlays them): Daily Picks
(RH saved-scan), the Options tab, AV macro/overviews (those refresh via av-fetch.mjs
over HTTP when ALPHAVANTAGE_KEY is set), news, realized P&L.

Env:
  RH_USERNAME, RH_PASSWORD   Robinhood login
  RH_MFA_SECRET              base32 TOTP secret (authenticator). REQUIRED for unattended login.
  PF_ACCOUNT                 (optional) account number to read; default = robin_stocks default.
  FETCH_MODE                 FETCH_ALL | FETCH_LIGHT (set by entrypoint from preflight.mjs).
  DRY_RUN=1                  log shapes / counts but do not write any files.

Run from the repo root (entrypoint cd's into the cloned repo).
"""
import json
import os
import sys
import time
from datetime import datetime, timezone

RAW = os.path.join("producer", "raw")
MODE = os.environ.get("FETCH_MODE", "FETCH_ALL").upper()
DRY = os.environ.get("DRY_RUN") == "1"
THIS_YEAR = datetime.now(timezone.utc).year


def log(*a):
    print("[fetch_rh]", *a, flush=True)


def write_raw(name, obj):
    path = os.path.join(RAW, name)
    if DRY:
        log(f"DRY would write {path} ({_shape(obj)})")
        return
    os.makedirs(RAW, exist_ok=True)
    with open(path, "w") as f:
        json.dump(obj, f)
    log(f"wrote {path} ({_shape(obj)})")


def _shape(obj):
    if isinstance(obj, dict):
        if "results" in obj and isinstance(obj["results"], list):
            return f"{len(obj['results'])} results"
        if "positions" in obj:
            return f"{len(obj['positions'])} positions"
        if "quotes" in obj:
            return f"{len(obj['quotes'])} quotes"
        return ", ".join(obj.keys())
    if isinstance(obj, list):
        return f"list[{len(obj)}]"
    return type(obj).__name__


def market_symbols():
    """Read MARKET_SYMBOLS from producer/markets.mjs so the list never drifts."""
    import subprocess
    try:
        out = subprocess.run(
            ["node", "-e",
             "import('./producer/markets.mjs').then(m=>process.stdout.write(JSON.stringify(m.MARKET_SYMBOLS)))"],
            capture_output=True, text=True, timeout=30, check=True,
        ).stdout
        syms = json.loads(out)
        if isinstance(syms, list) and syms:
            return [str(s) for s in syms]
    except Exception as e:
        log("⚠️  could not read MARKET_SYMBOLS from markets.mjs:", e)
    # Fallback mirror of markets.mjs (keep in sync if the dynamic read ever fails).
    return ["SPY", "QQQ", "DIA", "IWM", "GLD", "TLT", "HYG", "IBIT",
            "XLK", "XLC", "XLY", "XLF", "XLV", "XLI", "XLP", "XLE", "XLU", "XLB", "XLRE",
            "EFA", "EEM"]


def _session_pickle_path():
    return os.path.join(os.path.expanduser("~"), ".tokens", "robinhood.pickle")


def rh_login():
    import robin_stocks.robinhood as rh

    # Session persistence. The robust path is a Railway VOLUME mounted at the tokens dir (HOME set by
    # entrypoint.sh): the pickle robin_stocks writes after a device-approved login survives between
    # runs, so Robinhood only challenges on the first run / after expiry — not every cron tick.
    # RH_SESSION_B64 (from rh_session.py) is an optional BOOTSTRAP used only when no pickle exists yet;
    # we never clobber a persisted pickle with it (a stale/garbled bootstrap must not overwrite a good
    # live session).
    path = _session_pickle_path()
    if os.path.exists(path):
        log("using persisted Robinhood session (volume)")
    else:
        sess = os.environ.get("RH_SESSION_B64")
        if sess:
            import base64
            os.makedirs(os.path.dirname(path), exist_ok=True)
            try:
                with open(path, "wb") as f:
                    f.write(base64.b64decode(sess))
                log("restored Robinhood session from RH_SESSION_B64 (bootstrap)")
            except Exception as e:
                log(f"⚠️  could not restore RH_SESSION_B64: {e}")

    user = os.environ.get("RH_USERNAME")
    pw = os.environ.get("RH_PASSWORD")
    if not user or not pw:
        log("FATAL — RH_USERNAME / RH_PASSWORD not set"); sys.exit(1)
    mfa = None
    secret = os.environ.get("RH_MFA_SECRET")
    if secret:
        import pyotp
        mfa = pyotp.TOTP(secret.replace(" ", "")).now()
    # store_session=True so a restored RH_SESSION_B64 is loaded; with a valid session robin_stocks
    # refreshes the token and skips the MFA challenge entirely.
    try:
        rh.login(username=user, password=pw, mfa_code=mfa, store_session=True, expiresIn=86400)
    except Exception as e:
        log(f"FATAL — Robinhood login raised: {e}")
        sys.exit(1)
    # robin_stocks can print "Login failed" WITHOUT raising (e.g. a device-approval that timed out),
    # after which downstream calls blow up with "can only be called when logged in". Probe with a
    # cheap authenticated call and fail CLEAN (no push, carry-forward) with a clear message instead.
    try:
        authed = bool(rh.load_account_profile())
    except Exception:
        authed = False
    if not authed:
        log("FATAL — login did not authenticate. If a Robinhood device-approval prompt appeared, it "
            "wasn't tapped in time. Re-run and APPROVE the prompt on your phone within ~30s. Once a "
            "good session is saved to the /data volume, later runs won't prompt.")
        sys.exit(1)
    log("logged in to Robinhood")
    return rh


def fetch_portfolio_positions(rh):
    """Required. Writes portfolio.json + positions.json; returns held symbols."""
    acct = os.environ.get("PF_ACCOUNT") or None
    port = rh.load_portfolio_profile(account_number=acct) if acct else rh.load_portfolio_profile()
    profile = rh.load_account_profile(account_number=acct) if acct else rh.load_account_profile()

    def num(d, *keys):
        for k in keys:
            v = (d or {}).get(k)
            if v not in (None, ""):
                try:
                    return float(v)
                except (TypeError, ValueError):
                    pass
        return 0.0

    market_value = num(port, "market_value", "extended_hours_market_value")
    cash = num(profile, "portfolio_cash", "cash")
    buying_power = num(profile, "buying_power")
    equity_value = market_value  # gross long equity positions (the dashboard's "Equity" line)
    # Total account value = RH's own equity figure — it matches the Robinhood app headline and
    # correctly includes options/crypto/margin that a positions+cash sum misses. Prefer the
    # extended-hours value pre/post market; fall back to positions+cash only if RH omitted equity.
    rh_equity = num(port, "extended_hours_equity", "equity")
    total_value = rh_equity if rh_equity > 0 else (equity_value + cash)
    write_raw("portfolio.json", {
        "total_value": total_value,
        "equity_value": equity_value,
        "cash": cash,
        "buying_power": {"buying_power": buying_power},
    })

    holdings = rh.build_holdings()  # { SYMBOL: { quantity, average_buy_price, ... } }
    positions = []
    for sym, h in (holdings or {}).items():
        positions.append({
            "symbol": sym,
            "quantity": h.get("quantity", "0"),
            "average_buy_price": h.get("average_buy_price", "0"),
        })
    write_raw("positions.json", {"positions": positions})
    log(f"portfolio: total={total_value:.2f} equity={equity_value:.2f} cash={cash:.2f} · {len(positions)} positions")
    return [p["symbol"] for p in positions]


def fetch_quotes(rh, symbols):
    """Required (EVERY-RUN). Batched single call; raw RH quote dicts pass straight through."""
    quotes = rh.get_quotes(symbols)
    results = [q for q in (quotes or []) if q and q.get("symbol")]
    write_raw("quotes.json", {"results": results})
    log(f"quotes: {len(results)}/{len(symbols)} symbols")


def _num(v):
    try:
        f = float(v)
        return f if f == f and f not in (float("inf"), float("-inf")) else None
    except (TypeError, ValueError):
        return None


def rsi_from_closes(closes, period=14):
    """14-day Wilder RSI — matches calcRSI() in index.html so screen results line up."""
    if not closes or len(closes) < period + 2:
        return None
    deltas = [closes[i] - closes[i - 1] for i in range(1, len(closes))]
    ag = sum(d for d in deltas[:period] if d > 0) / period
    al = sum(-d for d in deltas[:period] if d < 0) / period
    for d in deltas[period:]:
        ag = (ag * (period - 1) + (d if d > 0 else 0)) / period
        al = (al * (period - 1) + (-d if d < 0 else 0)) / period
    if al == 0:
        return 100.0
    return 100 - 100 / (1 + ag / al)


def _bars_from_historicals(raw, year_filter=None):
    bars = []
    for b in (raw or []):
        ts = b.get("begins_at")
        close = b.get("close_price")
        if ts is None or close in (None, ""):
            continue
        if year_filter is not None and not str(ts).startswith(str(year_filter)):
            continue
        try:
            bar = {"t": ts, "c": float(close)}
        except (TypeError, ValueError):
            continue
        # Carry volume when present so the consumer's Analyze price chart can draw volume bars
        # (the Claude-agent path keeps raw RH bars incl. volume; keep parity here). Optional/best-effort.
        vol = b.get("volume")
        if vol not in (None, ""):
            try:
                bar["v"] = float(vol)
            except (TypeError, ValueError):
                pass
        bars.append(bar)
    return bars


def fetch_historicals(rh, symbols, interval, span, name_prefix, year_filter=None):
    """FETCH_ALL only. Per-symbol so each carries its own symbol; batched into files of 3."""
    batch, idx = [], 0
    for sym in symbols:
        try:
            raw = rh.get_stock_historicals(sym, interval=interval, span=span)
        except Exception as e:
            log(f"⚠️  historicals {sym} ({interval}/{span}) failed: {e}")
            continue
        bars = _bars_from_historicals(raw, year_filter=year_filter)
        if bars:
            batch.append({"symbol": sym, "bars": bars})
        if len(batch) >= 3:
            idx += 1
            write_raw(f"{name_prefix}-{idx}.json", {"results": batch})
            batch = []
        time.sleep(0.15)
    if batch:
        idx += 1
        write_raw(f"{name_prefix}-{idx}.json", {"results": batch})
    log(f"historicals {interval}/{span}: {idx} file(s) written")


def fetch_fundamentals(rh, symbols):
    """FETCH_ALL only. RH fundamentals → sector / P/E / market cap / 52wk / yield."""
    try:
        funds = rh.get_fundamentals(symbols)
    except Exception as e:
        log(f"⚠️  fundamentals fetch failed (will carry forward): {e}")
        return
    results = []
    for sym, fnd in zip(symbols, funds or []):
        if not fnd:
            continue
        s = fnd.get("symbol") or sym
        results.append({
            "symbol": s,
            "sector": fnd.get("sector"),
            "industry": fnd.get("industry"),
            "pe_ratio": fnd.get("pe_ratio"),
            "market_cap": fnd.get("market_cap"),
            "high_52_weeks": fnd.get("high_52_weeks"),
            "low_52_weeks": fnd.get("low_52_weeks"),
            "dividend_yield": fnd.get("dividend_yield"),
        })
    if results:
        write_raw("holdings-fund.json", {"results": results})


def _opt_id(url):
    """Option instrument id is the last path segment of its URL — free, no request."""
    if not url:
        return None
    return url.rstrip("/").split("/")[-1] or None


def fetch_options(rh):
    """EVERY-RUN (cheap). Writes options-orders.json / options-positions.json /
    option-pos-quotes.json in the shapes options-build.mjs parses. On any hard failure
    it writes nothing and the prior Options snapshot carries forward.
    Returns the set of underlying chain symbols (added to the equity quote batch so
    options-build always has the underlying price)."""
    from robin_stocks.robinhood.helper import request_get
    PENDING = {"queued", "confirmed", "partially_filled", "unconfirmed"}
    chain_syms = set()
    try:
        orders_raw = rh.get_all_option_orders() or []
    except Exception as e:
        log(f"⚠️  option orders fetch failed — Options carries forward: {e}")
        return chain_syms

    # Open positions first, so we know which legs actually need strike/type/expiry enrichment.
    try:
        opos_raw = rh.get_open_option_positions() or []
    except Exception as e:
        log(f"⚠️  open option positions fetch failed (non-fatal): {e}")
        opos_raw = []
    open_ids = set()
    positions = []
    for p in opos_raw:
        oid = _opt_id(p.get("option"))
        if oid:
            open_ids.add(oid)
        if p.get("chain_symbol"):
            chain_syms.add(p["chain_symbol"])
        # robin_stocks reports option average_price PER CONTRACT (already ×100), but options-build.mjs
        # expects a per-share figure (it multiplies by 100). Convert so the credit isn't 100× too big.
        avg = _num(p.get("average_price"))
        positions.append({
            "option_id": oid,
            "chain_symbol": p.get("chain_symbol"),
            "quantity": p.get("quantity"),
            "average_price": (avg / 100.0) if avg is not None else p.get("average_price"),
        })

    inst_cache = {}

    def instrument(url):
        oid = _opt_id(url)
        if oid in inst_cache:
            return inst_cache[oid]
        meta = {}
        try:
            meta = request_get(url) or {}
        except Exception as e:
            log(f"⚠️  option instrument {oid} lookup failed: {e}")
        inst_cache[oid] = {
            "type": meta.get("type"),
            "strike_price": meta.get("strike_price"),
            "expiration_date": meta.get("expiration_date"),
        }
        return inst_cache[oid]

    norm_orders = []
    pending_ids = set()
    for o in orders_raw:
        if o.get("chain_symbol"):
            chain_syms.add(o["chain_symbol"])
        is_pending = o.get("state") in PENDING
        legs = []
        for l in (o.get("legs") or []):
            oid = _opt_id(l.get("option"))
            need_full = is_pending or (oid in open_ids)  # only these legs are analyzed downstream
            leg = {
                "option_id": oid,
                "side": l.get("side"),
                "option_type": l.get("option_type"),
                "strike_price": l.get("strike_price"),
                "expiration_date": l.get("expiration_date"),
            }
            if need_full and l.get("option"):
                m = instrument(l["option"])
                leg["option_type"] = leg["option_type"] or m["type"]
                leg["strike_price"] = leg["strike_price"] or m["strike_price"]
                leg["expiration_date"] = leg["expiration_date"] or m["expiration_date"]
                if is_pending and oid:
                    pending_ids.add(oid)
            legs.append(leg)
        norm_orders.append({
            "chain_symbol": o.get("chain_symbol"), "chain_id": o.get("chain_id"),
            "state": o.get("state"), "direction": o.get("direction"),
            "quantity": o.get("quantity"), "price": o.get("price"),
            "premium": o.get("premium"), "processed_premium": o.get("processed_premium"),
            "opening_strategy": o.get("opening_strategy"), "closing_strategy": o.get("closing_strategy"),
            "created_at": o.get("created_at"), "updated_at": o.get("updated_at"),
            "last_transaction_at": o.get("last_transaction_at"),
            "legs": legs,
        })

    write_raw("options-orders.json", {"data": {"orders": norm_orders}})
    write_raw("options-positions.json", {"data": {"positions": positions}})

    # Live marks/greeks for YOUR contracts (pending order legs + open positions).
    results = []
    for oid in (pending_ids | open_ids):
        try:
            md = rh.get_option_market_data_by_id(oid)
        except Exception as e:
            log(f"⚠️  option market data {oid} failed: {e}")
            continue
        d = md
        while isinstance(d, list) and d:  # robin_stocks returns [{...}] or [[{...}]]
            d = d[0]
        if not isinstance(d, dict):
            continue
        d = dict(d)
        d["instrument_id"] = oid
        results.append(d)
    if results:
        write_raw("option-pos-quotes.json", {"results": results})

    log(f"options: {len(norm_orders)} orders · {len(positions)} open · {len(results)} live-quoted")
    return chain_syms


# Curated large-cap universe for the Daily Picks screen (a stand-in for the Robinhood saved
# scanner, which is a connector abstraction not reachable from robin_stocks). All names are
# comfortably > $10B; the screen below applies the RSI(14) < 45 oversold filter live. Broad
# sector spread so picks aren't tech-only. Edit freely.
PICKS_UNIVERSE = [
    # Tech / semis / comm
    "AAPL", "MSFT", "GOOGL", "AMZN", "META", "NVDA", "TSLA", "NFLX", "AVGO", "ORCL",
    "CRM", "ADBE", "CSCO", "QCOM", "TXN", "INTC", "AMD", "IBM", "MU", "AMAT", "DIS",
    "CMCSA", "VZ", "T",
    # Consumer
    "COST", "WMT", "HD", "MCD", "NKE", "SBUX", "TGT", "LOW", "PG", "KO", "PEP", "PM", "MDLZ",
    # Health
    "UNH", "JNJ", "LLY", "PFE", "MRK", "ABBV", "AMGN", "TMO", "ABT", "BMY", "GILD",
    # Financials
    "JPM", "BAC", "WFC", "GS", "MS", "C", "AXP", "V", "MA", "BLK", "SCHW",
    # Industrials / energy / materials
    "BA", "CAT", "GE", "HON", "UNP", "XOM", "CVX", "COP", "LIN",
]


def fetch_picks(rh):
    """FETCH_ALL only. Reimplements the saved RH scan (oversold large-caps) client-side, then
    writes scan.json / picks-fund.json (+ quotes-picks / hist-day-picks so picks are analyzable)
    in the shapes picks-build.mjs parses. On any hard failure it writes nothing and Picks carries
    forward."""
    log("picks: screening oversold large-caps (RSI<45, mcap>$10B) …")
    try:
        quotes = rh.get_quotes(PICKS_UNIVERSE) or []
        funds = rh.get_fundamentals(PICKS_UNIVERSE) or []
    except Exception as e:
        log(f"⚠️  picks universe fetch failed — Picks carries forward: {e}")
        return
    q_by = {q["symbol"]: q for q in quotes if q and q.get("symbol")}

    info = []
    for sym, f in zip(PICKS_UNIVERSE, funds):
        if not f:
            continue
        s = f.get("symbol") or sym
        q = q_by.get(s) or {}
        last = _num(q.get("last_trade_price") or q.get("adjusted_previous_close"))
        prev = _num(q.get("adjusted_previous_close") or q.get("previous_close"))
        mcap = _num(f.get("market_cap"))
        hi, lo = _num(f.get("high_52_weeks")), _num(f.get("low_52_weeks"))
        if last is None or mcap is None or mcap < 10e9:
            continue
        range_pos = (last - lo) / (hi - lo) if (hi and lo and hi > lo) else 0.5
        info.append({"sym": s, "last": last, "prev": prev, "mcap": mcap, "f": f, "range_pos": range_pos})

    # Cost control: RSI needs historicals, so only compute it for the ~35 names nearest their
    # 52-week low (most likely to be oversold). A mid-range name with RSI<45 can be missed — an
    # accepted tradeoff vs. pulling historicals for the whole universe. Widen the slice to relax it.
    info.sort(key=lambda x: x["range_pos"])
    rsi_pool = info[:35]
    rows = []
    for it in rsi_pool:
        try:
            raw = rh.get_stock_historicals(it["sym"], interval="day", span="3month")
        except Exception as e:
            log(f"⚠️  picks historicals {it['sym']} failed: {e}")
            continue
        rsi = rsi_from_closes([b["c"] for b in _bars_from_historicals(raw)])
        if rsi is None or rsi >= 45:
            continue
        chg = ((it["last"] - it["prev"]) / it["prev"] * 100) if it["prev"] else None
        rows.append({"it": it, "rsi": rsi, "chg": chg})
        time.sleep(0.12)

    if not rows:
        log("picks: nothing below RSI 45 today — carrying forward prior Picks.")
        return
    rows.sort(key=lambda r: r["rsi"])
    finalists = rows[:12]
    fin_syms = [r["it"]["sym"] for r in finalists]

    names = {}
    for s in fin_syms:
        try:
            names[s] = rh.get_name_by_symbol(s) or s
        except Exception:
            names[s] = s

    # scan.json — exact shape scanRows() reads: data.result.results[].columns
    results = []
    for r in rows:
        s = r["it"]["sym"]
        results.append({"ticker": s, "columns": {
            "Symbol": s, "Name": names.get(s, s), "Last": r["it"]["last"],
            "RSI": round(r["rsi"], 1), "Market cap": r["it"]["mcap"],
            "% Change": round(r["chg"], 2) if r["chg"] is not None else None,
        }})
    write_raw("scan.json", {"data": {"result": {"results": results}}})

    # picks-fund.json — RH fundamentals for the finalists (buildPicks reads pe/pb/yield/52wk/sector)
    fund_results = []
    for r in finalists:
        f, s = r["it"]["f"], r["it"]["sym"]
        fund_results.append({
            "symbol": s, "pe_ratio": f.get("pe_ratio"), "pb_ratio": f.get("pb_ratio"),
            "dividend_yield": f.get("dividend_yield"), "high_52_weeks": f.get("high_52_weeks"),
            "low_52_weeks": f.get("low_52_weeks"), "sector": f.get("sector"), "industry": f.get("industry"),
        })
    write_raw("picks-fund.json", {"data": {"results": fund_results}})

    # Make picks analyzable in the Analyze tab: their quotes + YTD day bars (build-data merges these).
    fin_quotes = [q_by[s] for s in fin_syms if s in q_by]
    if fin_quotes:
        write_raw("quotes-picks.json", {"results": fin_quotes})
    fetch_historicals(rh, fin_syms, "day", "year", "hist-day-picks", year_filter=THIS_YEAR)

    log(f"picks: {len(results)} oversold (RSI<45) · {len(finalists)} finalists: {', '.join(fin_syms)}")


def fetch_vix(rh):
    """VIX (the CBOE volatility index). Robinhood serves index quotes through an endpoint
    robin_stocks doesn't expose, so pull it from a free, keyless source — Yahoo first, stooq as a
    fallback. On total failure VIX carries forward / shows —. (If your Railway egress is restricted,
    allowlist query1.finance.yahoo.com and stooq.com.)"""
    import requests
    UA = {"User-Agent": "Mozilla/5.0"}

    def _yahoo():
        r = requests.get("https://query1.finance.yahoo.com/v8/finance/chart/%5EVIX",
                         params={"interval": "1d", "range": "1d"}, headers=UA, timeout=12)
        r.raise_for_status()
        return r.json()["chart"]["result"][0]["meta"]["regularMarketPrice"]

    def _stooq():
        r = requests.get("https://stooq.com/q/l/",
                         params={"s": "^vix", "f": "sd2t2ohlcv", "h": "", "e": "csv"}, headers=UA, timeout=12)
        r.raise_for_status()
        rows = [x for x in r.text.strip().splitlines() if x]
        return float(rows[-1].split(",")[6])  # Symbol,Date,Time,Open,High,Low,Close,Volume

    val = None
    for name, fn in (("yahoo", _yahoo), ("stooq", _stooq)):
        try:
            v = float(fn())
            if v > 0:
                val = v
                log(f"VIX: {val} (via {name})")
                break
        except Exception as e:
            log(f"⚠️  VIX via {name} failed: {e}")
    if val is not None:
        write_raw("index-quotes.json", {"quotes": [{"symbol": "VIX", "value": str(val)}]})
    else:
        log("VIX: not fetched this run (carry forward)")


def main():
    log(f"mode={MODE} dry_run={DRY} year={THIS_YEAR}")
    rh = rh_login()
    held = fetch_portfolio_positions(rh)
    markets = market_symbols()

    # Options every run (cheap); returns underlying chain symbols to fold into the quote batch
    # so options-build.mjs always has the underlying price (even for names you don't hold equity in).
    opt_syms = fetch_options(rh)

    # quotes: every held symbol + every market symbol + option underlyings (EVERY-RUN)
    all_syms = list(dict.fromkeys(held + markets + sorted(opt_syms)))
    fetch_quotes(rh, all_syms)

    # VIX: cheap, every run, best-effort
    fetch_vix(rh)

    if MODE == "FETCH_ALL":
        # top 15 holdings by value would need quote math; held order from build_holdings is
        # roughly value-sorted, but be explicit: cover the top 15 held + all market symbols.
        top_held = held[:15]
        hist_syms = list(dict.fromkeys(top_held + markets))
        fetch_historicals(rh, hist_syms, "day", "year", "hist-day", year_filter=THIS_YEAR)
        fetch_historicals(rh, hist_syms, "week", "5year", "hist-month")  # 5Y stats; label only
        fetch_fundamentals(rh, top_held)
        fetch_picks(rh)  # oversold large-cap screen → scan.json/picks-fund.json (once/day)
    else:
        log("FETCH_LIGHT — skipping historicals / fundamentals (build-data carries them forward)")

    log("done.")


if __name__ == "__main__":
    main()
