# Portfolio Dashboard — PWA

A self-updating portfolio dashboard you install on your iPhone/iPad home screen.
Live Robinhood + Alpha Vantage data, refreshed every ~15 minutes during market hours.

## How it works

The original dashboard fetches live data through Claude's in-app MCP bridge
(`window.cowork`). That bridge only exists **inside the Claude app**, so the file can't go
live on a phone as-is. This project splits it in two:

```
PRODUCER  — a scheduled Claude agent (runs inside Claude, where the connectors work)
            pulls live data → writes data.json → git push          (see producer/PRODUCER.md)
                                   │
                                   ▼
CONSUMER  — index.html on GitHub Pages (this PWA)
            a tiny shim replaces window.cowork and replays data.json
            → every compute/chart/table runs unchanged, fully offline-capable
```

"Live" here means **as of the last producer run** (≤~15 min old) — not real-time ticking.
A phone app can't pull from the connectors itself; only the scheduled agent can.

### Privacy

The repo is **public** (free GitHub Pages requires it), so `data.json` is **encrypted**:
the producer AES-GCM-encrypts it with a key derived (PBKDF2) from a passphrase. The PWA
asks for that passphrase once, caches it on the device, and decrypts in the browser —
anyone else hitting the URL sees only ciphertext. The committed sample is fake plaintext.

- Producer must run with `PF_PASSPHRASE` set (see `producer/PRODUCER.md`).
- First launch on a device: enter the passphrase at the prompt, or bootstrap by opening
  `…/#key=<passphrase>` once (it's saved and stripped from the URL). Clear it with the
  **🔓 Unlock** button after a failed unlock.

## Files

| Path | What |
|---|---|
| `index.html` | The PWA. Original dashboard + replay shim + PWA tags. **Edit the data layer here only.** |
| `data.json` | The current snapshot. Overwritten by the producer each run. Committed sample is clearly labeled. |
| `manifest.webmanifest`, `sw.js`, `icons/` | PWA shell — installability + offline. |
| `producer/PRODUCER.md` | Runbook the scheduled agent follows. |
| `producer/build-data.mjs` | Assembles `data.json` from raw MCP outputs. |
| `producer/key.mjs` | Response-keying shared by producer + shim (keep in sync with the shim). |
| `producer/make-sample-data.mjs` | Generates the labeled sample `data.json`. |
| `producer/validate.mjs` | Replays `data.json` through the dashboard's compute path as a sanity check. |
| `producer/serve.mjs` | Local static server for preview. |
| `producer/gen-icons.mjs` | Regenerates the app icons. |

## Local preview

```
node producer/serve.mjs        # → http://localhost:8765
```

Regenerate the sample and re-check anytime:
```
node producer/make-sample-data.mjs && node producer/validate.mjs
```

## Deploy to GitHub Pages (one-time)

1. Create a repo (e.g. `portfolio-dashboard`) on GitHub.
2. From this folder:
   ```
   git add -A && git commit -m "Initial PWA"
   git branch -M main
   git remote add origin https://github.com/<you>/portfolio-dashboard.git
   git push -u origin main
   ```
3. GitHub → repo → **Settings → Pages** → Source: **Deploy from a branch**, branch `main` / root.
4. Your URL: `https://<you>.github.io/portfolio-dashboard/`.

## Install on iPhone / iPad

Open the URL in **Safari** → Share → **Add to Home Screen**. It launches full-screen with
its own icon and works offline (shows the last snapshot).

## Scope (v1)

The **Portfolio** tab is fully live from Robinhood alone (value, P&L, performance vs SPY/QQQ,
beta, risk/concentration, positions, RSI). Sections needing Alpha Vantage (fundamentals,
sector allocation, macro) show "unavailable" until AV is wired into the producer. The
**Markets** and **Picks** tabs render from whatever data the producer includes and degrade
gracefully otherwise.
