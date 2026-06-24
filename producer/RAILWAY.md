# Railway producer (credentialed alternative to the scheduled Claude agent)

This is an **optional, opt-in** way to refresh `data.json` **without** the scheduled Claude Code
agent. It runs a small Python service on [Railway](https://railway.com) that logs into Robinhood
directly (via the unofficial `robin_stocks` library) and then hands off to the **existing** Node
producer (`producer/run.mjs`) for everything else — encrypt, carry-forward, validate, publish to
`main`. The phone PWA is unchanged.

> The default/blessed path is still the scheduled Claude agent (see `PRODUCER.md` / `SCHEDULING.md`).
> That path needs **no stored credentials** because it reaches Robinhood through the MCP connector
> inside a Claude session. This Railway path trades that safety for autonomy + lower per-run cost.

## ⚠️ Read before you deploy
- **Unofficial API / ToS.** `robin_stocks` talks to Robinhood's private endpoints. It can break
  when Robinhood changes them, and automated access may violate Robinhood's Terms of Service. Use at
  your own risk; this is a personal, read-only dashboard (it never places trades).
- **You are storing brokerage credentials.** Username, password, and a TOTP secret live as Railway
  service variables. Treat them like the keys to your account. Use Railway's encrypted variables,
  never commit them, and prefer a dedicated **authenticator (TOTP) MFA** so logins are unattended.
- **Read-only by design.** `fetch_rh.py` only calls read endpoints (portfolio/positions/quotes/
  historicals/fundamentals). It never trades.

## How it fits (no replay-contract drift)
```
Railway cron ─► entrypoint.sh
                 ├─ git clone (latest main + prior data.json, token remote for push)
                 ├─ node producer/preflight.mjs        # SKIP / FETCH_ALL / FETCH_LIGHT gate
                 ├─ python fetch_rh.py                 # ← the only new piece: writes producer/raw/*.json
                 └─ node producer/run.mjs "<label>"    # existing tail: AV(HTTP) → picks/options
                                                       #   → build-data (encrypt) → validate → push main
```
`fetch_rh.py` writes the raw files in the **same normalized shapes** the MCP connector produced, so
`build-data.mjs` parses them identically and the consumer's replay keys are unchanged.

## What it fetches vs. carries forward (v1)
| Data | Source in this path | Notes |
|---|---|---|
| Portfolio / positions / quotes | `robin_stocks` (every run) | required; run aborts if these fail |
| Day (YTD) + 5Y historicals | `robin_stocks` (FETCH_ALL only) | 5Y uses weekly bars (RH has no monthly interval) |
| Holdings fundamentals (sector/PE/mktcap/52wk/yield) | `robin_stocks` (FETCH_ALL) | dividends-per-share absent → approximated |
| Macro signals + AV company overviews | `av-fetch.mjs` over **HTTP** | already keyless of MCP; set `ALPHAVANTAGE_KEY` |
| **Options tab** | `robin_stocks` (every run) | orders + open positions + live marks/greeks for your contracts |
| VIX | best-effort RH index quote | carries forward / shows "—" on failure |
| Retail buzz (ApeWisdom) | `build-data.mjs` in-process | needs `apewisdom.io` egress |
| **Daily Picks** | `robin_stocks` (FETCH_ALL) | client-side oversold screen → `scan.json`/`picks-fund.json` |
| Realized P&L | carried forward / `realized.json` | owner-maintained; options realized/premium YTD refresh live |

So all tabs — Portfolio, Markets, Analyze, **Options**, **Picks** — refresh live. This path is at
parity with the scheduled Claude agent (modulo the Picks-universe note below + dividend approximation).

## One-time setup
1. **Authenticator MFA on Robinhood.** In the Robinhood app, enable two-factor with an
   **authenticator app**. When it shows the QR code, also reveal the **setup key** (base32) — that's
   your `RH_MFA_SECRET`. (App-prompt/SMS MFA can't be automated; TOTP can.)
2. **GitHub token for publishing.** Create a fine-grained PAT scoped to
   `mcdermottj639/portfolio-dashboard` with **Contents: Read and write**. That's `GITHUB_TOKEN`.
3. **New Railway project → Deploy from GitHub repo** → pick this repo.
   - Settings → Build: it should pick up `producer/railway/railway.json` (Dockerfile builder). If
     not, set **Dockerfile path** = `producer/railway/Dockerfile`.
   - Settings → **Cron Schedule**: e.g. `0,30 13-21 * * 1-5` (every 30 min, 13:00–21:00 UTC ≈ market
     hours, weekdays). `preflight.mjs` still gates SKIP/light/full, so extra fires are ~free.
   - Set **Restart Policy = Never** (it's a cron job, not a server).
4. **Service Variables** (Railway → Variables):
   ```
   GITHUB_TOKEN=<fine-grained PAT>
   GITHUB_REPO=mcdermottj639/portfolio-dashboard
   RH_USERNAME=<robinhood email>
   RH_PASSWORD=<robinhood password>
   RH_MFA_SECRET=<base32 TOTP setup key>
   PF_PASSPHRASE=<dashboard passphrase>          # same one your phone uses to unlock
   PF_ACCOUNT=<robinhood account number>         # optional; default account if omitted
   ALPHAVANTAGE_KEY=<key>                         # optional; enables macro + AV overviews
   ```
   Egress allowlist (if your Railway plan restricts it): `api.robinhood.com`, `apewisdom.io`,
   `www.alphavantage.co`, `github.com`.

## Verify it (do this before trusting the cron)
1. **Dry run the fetch** — Railway shell (or locally with the same env), `DRY_RUN=1`:
   ```
   DRY_RUN=1 FETCH_MODE=FETCH_ALL python3 producer/railway/fetch_rh.py
   ```
   It logs each file it *would* write and the shape (counts). Confirm portfolio/positions/quotes look
   sane. **This is the step that catches `robin_stocks` field-name drift** — if a count is 0 or a
   value is wrong, fix the mapping in `fetch_rh.py` before going live.
2. **Full local build, no push:**
   ```
   FETCH_MODE=FETCH_ALL python3 producer/railway/fetch_rh.py
   PF_PASSPHRASE=… node producer/run.mjs --no-push "Railway test"
   ```
   Expect `replay contract is valid ✅` and a `Markets coverage: ✅` (or a short list of "—" symbols).
   Then discard the test build: `git checkout origin/main -- data.json`.
3. **Let one real cron fire** and confirm the phone's freshness bar shows the new snapshot label.

## Cost
A cron that fires a handful of times during market hours costs cents/month on Railway — well inside
the ~$5 base / your $10 budget. `preflight.mjs` SKIPs weekends and already-captured closes, so most
fires exit in seconds. No always-on server.

## Picks universe note (live as of this version)
The Robinhood saved scanner (`run_scan`) is a **connector abstraction**, not a native RH endpoint,
so `robin_stocks` can't replay it. Instead `fetch_picks()` runs the same screen **client-side**
(once/day, FETCH_ALL): it quotes + pulls fundamentals for the curated `PICKS_UNIVERSE` (~70 large
caps), keeps `mcap > $10B`, computes RSI(14) from daily historicals for the ~35 names nearest their
52-week low (cost control — a mid-range name with RSI<45 can be missed; widen the slice in
`fetch_rh.py` to relax it), keeps RSI<45, and the 12 lowest-RSI become finalists. Then the existing
`picks-select`/`picks-build` scoring runs unchanged. **Edit `PICKS_UNIVERSE`** in `fetch_rh.py` to
change the candidate set.

## Follow-ups (not yet)
- **Dividends per share / ex-date:** RH `get_fundamentals` omits these; pull from the instrument /
  `get_events` if you want exact dividend income instead of the current approximation.
- **AV growth enrichment for picks:** optional `av-src/overview-<SYM>.json` per finalist adds revenue
  growth / forward P/E to the score; without it scoring is value-only (graceful, already handled).

> **Options note (live as of this version).** `fetch_rh.py` writes `options-orders.json`,
> `options-positions.json`, and `option-pos-quotes.json` every run. Leg strike/type/expiry come from
> the option-instrument URL, fetched only for the legs that are actually analyzed (pending orders +
> open positions) to keep calls cheap. Directional **idea** premiums still use estimates unless you
> later add `option-quotes.json` (see `options-plan.mjs`). Verify with the `DRY_RUN` step that your
> open contracts and pending orders show up before trusting it.

## If a run fails
Same rule as the Claude agent: a failed push (e.g. transient 403) is fine — the build is intact and
the next cron republishes. The freshness watchdog (`.github/workflows/freshness.yml`) still opens an
issue if `data.json` goes stale >3h during market hours. Don't hand-improvise git recovery.
