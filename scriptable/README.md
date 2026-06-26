# Scriptable widget — Portfolio Pulse

A home-screen / lock-screen widget for iPhone that shows your portfolio at a glance without
opening the PWA. Built with [Scriptable](https://scriptable.app) (free, App Store).

| Size | Shows |
|---|---|
| **Large** | Everything in Medium **+ a top-holdings table** (weight · day % · total P&L %) **+ a footer** with VIX and the top daily pick |
| **Medium** (recommended) | Total value · day P&L $/% · total P&L $/% on cost · YTD portfolio-value sparkline · top gainer/laggard · snapshot age |
| **Small** | Total value + day % + age |
| **Lock screen** (rectangular) | Day change + biggest winner + biggest loser (inline/circular: day % only) |

## How it works

`data.json` on GitHub Pages is **encrypted** (AES-256-GCM, PBKDF2-SHA256 / 150k iters — see
`producer/emit.mjs`). Scriptable's JS engine has no `crypto.subtle`, so the widget loads the live
GitHub Pages origin in an **offscreen WebView** (a real, secure browser context where WebCrypto
exists) and, inside it, same-origin-fetches `data.json` and decrypts it with the *identical* scheme
the PWA uses. The decrypted snapshot returns to Scriptable, which draws the widget natively. Nothing
re-implements the crypto, so it can't drift from the app. The passphrase lives only in the device
**Keychain** — never in the repo, never synced anywhere by this script.

## Setup (one time)

1. Install **Scriptable** from the App Store.
2. Open Scriptable → **＋** (new script) → name it `Portfolio Pulse`.
3. Paste the entire contents of [`portfolio-widget.js`](./portfolio-widget.js).
4. **Run it once inside the app** (▶). It will prompt for your dashboard passphrase and store it in
   the Keychain. On success you'll see a medium preview of the widget.
5. Long-press the home screen → **＋** → add a **Scriptable** widget (Medium) → tap it →
   **Script: Portfolio Pulse**. (For the lock screen: edit the lock screen → add a Scriptable
   accessory widget the same way.)

## Notes

- **Refresh:** the widget asks iOS to reload ~every 15 min; iOS ultimately decides actual cadence.
  The snapshot itself only changes when the producer publishes (a few times per market day), so the
  **age** label tints amber with a `↻` once the data is ≥3h old — same threshold as the app's
  freshness bar.
- **Changed your passphrase?** Re-run the script in-app once after deleting the Keychain entry, or
  add a line `Keychain.remove('pf_passphrase')`, run once, then remove it again — easiest is just to
  re-run and re-enter when it shows "Wrong passphrase?".
- **Numbers:** value uses the recorded account `total_value` when present (incl. cash), else the sum
  of `qty × last_trade_price`. Day P&L/% is on equity (`last` vs `adjusted_previous_close`); total
  P&L/% is on cost (`average_buy_price`). The sparkline is a forward-filled portfolio-value series
  built from `data.hist.day`.
- It reads the same public, encrypted snapshot as the PWA — it places no orders and needs no MCP
  access.
