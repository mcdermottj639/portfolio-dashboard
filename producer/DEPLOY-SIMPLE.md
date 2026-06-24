# Deploy the Railway producer — the dead-simple version

This sets up a little robot on Railway that refreshes your dashboard automatically a few times a
day, so you don't need the Claude agent to do it. Full technical detail is in `RAILWAY.md`; this is
the click-by-click version.

**Golden rule:** secrets (Robinhood password, the session string, your dashboard passphrase, the
GitHub token) go **only into Railway**. Don't paste them into a chat.

There are **three things only you can do** (no one can do them for you): make the Robinhood session,
make a GitHub token, and set up the Railway service. Here's all three.

---

## PART 1 — Make a Robinhood "session" (on your computer)

Robinhood doesn't offer an authenticator-app option on this account, so instead of a password+code
the robot uses a *session* you create once by logging in yourself.

1. Open a terminal (Mac: **Terminal**; Windows: **Command Prompt**). You already have Python.
2. Install the helper:
   ```
   pip install robin_stocks
   ```
3. Download + run the login script:
   - **Mac:**
     ```
     curl -O https://raw.githubusercontent.com/mcdermottj639/portfolio-dashboard/main/producer/railway/rh_session.py
     python3 rh_session.py
     ```
   - **Windows:**
     ```
     curl -O https://raw.githubusercontent.com/mcdermottj639/portfolio-dashboard/main/producer/railway/rh_session.py
     python rh_session.py
     ```
4. Type your Robinhood email + password (the password stays hidden as you type — normal), then
   **approve the login in your Robinhood app** (or type the texted code). One manual moment.
5. It prints a long line starting with `RH_SESSION_B64=`. **Copy that whole line** — you'll paste it
   into Railway in Part 3.

> When the producer ever logs a "login failed" weeks later, just re-run step 3 and update that one
> variable in Railway. Everything keeps showing the last snapshot until you do.

---

## PART 2 — Make a GitHub token (lets the robot save updates)

1. **github.com** → your photo (top-right) → **Settings** → **Developer settings** →
   **Personal access tokens** → **Fine-grained tokens** → **Generate new token**.
2. **Repository access** → **Only select repositories** → pick **portfolio-dashboard**.
3. **Permissions** → **Repository permissions** → **Contents** → **Read and write**.
4. **Generate token**, copy the `github_pat_...` string. That's your `GITHUB_TOKEN`.

---

## PART 3 — Set up Railway

1. **railway.com** → sign in with GitHub.
2. **New Project** → **Deploy from GitHub repo** → choose **portfolio-dashboard**. Let the first
   build finish (it reads `producer/railway/railway.json` automatically).
3. Open the service → **Variables** tab → **Raw Editor** → paste this, replacing each `PASTE_...`:
   ```
   GITHUB_TOKEN=PASTE_your_github_pat
   GITHUB_REPO=mcdermottj639/portfolio-dashboard
   RH_USERNAME=PASTE_your_robinhood_email
   RH_PASSWORD=PASTE_your_robinhood_password
   RH_SESSION_B64=PASTE_the_long_line_from_part_1
   PF_PASSPHRASE=PASTE_your_dashboard_passphrase
   PF_ACCOUNT=PASTE_your_robinhood_account_number
   ```
   (Have an Alpha Vantage key? Add `ALPHAVANTAGE_KEY=...` on its own line. Otherwise skip it.)
4. **Settings** tab:
   - **Cron Schedule:** `0,30 13-21 * * 1-5`
   - **Restart Policy:** `Never`
   - **Watch Paths:** `producer/railway/**`

---

## PART 4 — Safe test before trusting it

1. **Variables** → add two lines:
   ```
   DRY_RUN=1
   FETCH_MODE=FETCH_ALL
   ```
2. **Deployments** → **Redeploy** to run it once now.
3. Open **Deploy Logs** and look for `[fetch_rh]` lines with real numbers, e.g.
   `portfolio: total=… · 23 positions`, `quotes: 44/44`, `options: 5 orders · 1 open`,
   `picks: 9 finalists`.
4. If those look right, **delete the `DRY_RUN` and `FETCH_MODE` variables** — done, it's live. You'll
   see a new "Snapshot: …" time at the top of the phone app within a minute of the next run.
5. If a number is `0` or looks wrong, copy those `[fetch_rh]` log lines (no secrets in them) and send
   them to Claude to fix.

---

## If something breaks
- A failed run is usually harmless — the build is fine and the next run republishes; the dashboard
  just keeps showing the last good snapshot.
- Login failures = the session expired → redo Part 1 step 3 and update `RH_SESSION_B64`.
- Don't hand-edit git or retry pushes manually; just let the next cron run go.
