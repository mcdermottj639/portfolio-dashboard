#!/usr/bin/env bash
# Railway producer entrypoint. Clones the repo fresh (so it reads the latest main +
# prior data.json and can push), runs the preflight gate, fetches Robinhood data with
# Python, then hands off to the existing deterministic Node tail (run.mjs).
#
# Required env (set in the Railway service):
#   GITHUB_TOKEN   a fine-grained PAT / deploy token with `contents:write` on the repo
#   GITHUB_REPO    e.g. mcdermottj639/portfolio-dashboard
#   RH_USERNAME RH_PASSWORD RH_MFA_SECRET   Robinhood login (TOTP secret = authenticator)
#   PF_PASSPHRASE  dashboard encryption passphrase (build-data refuses to push plaintext)
#   PF_ACCOUNT     (optional) Robinhood account number to read
#   ALPHAVANTAGE_KEY (optional) enables macro + fundamentals refresh over HTTP in run.mjs
set -euo pipefail

: "${GITHUB_TOKEN:?set GITHUB_TOKEN}"
: "${GITHUB_REPO:?set GITHUB_REPO (owner/name)}"

WORK="${WORK_DIR:-/tmp/pf-work}"
rm -rf "$WORK"
git clone --depth 1 "https://x-access-token:${GITHUB_TOKEN}@github.com/${GITHUB_REPO}.git" "$WORK"
cd "$WORK"
git config user.email "pf-railway-bot@users.noreply.github.com"
git config user.name "pf-railway-bot"

# Preflight gate — reads the committed data.json (raw/ markers don't persist across runs).
# You can force a mode (e.g. for a DRY_RUN test) by presetting FETCH_MODE; otherwise preflight decides.
if [ -n "${FETCH_MODE:-}" ]; then
  echo "[entrypoint] FETCH_MODE override = $FETCH_MODE (skipping preflight)"
else
  set +e
  node producer/preflight.mjs
  code=$?
  set -e
  case "$code" in
    10) echo "[entrypoint] preflight SKIP — weekend / close already captured. Nothing to do."; exit 0 ;;
    0)  export FETCH_MODE=FETCH_ALL ;;
    11) export FETCH_MODE=FETCH_LIGHT ;;
    *)  echo "[entrypoint] preflight returned unexpected code $code — aborting."; exit 1 ;;
  esac
  echo "[entrypoint] FETCH_MODE=$FETCH_MODE"
fi

mkdir -p producer/raw
# Persist the robin_stocks session across runs: point HOME (where robin_stocks keeps its token
# pickle, ~/.tokens) at TOKEN_HOME — mount a Railway Volume there so the device-approved login is
# remembered and Robinhood only challenges on the first run / after expiry. Without a volume it still
# works, but re-challenges every run (fine for testing, not for the unattended cron).
export TOKEN_HOME="${TOKEN_HOME:-/data}"
mkdir -p "$TOKEN_HOME/.tokens" 2>/dev/null || true
HOME="$TOKEN_HOME" python3 /app/fetch_rh.py

# DRY_RUN test mode: the fetch logged what it WOULD write (no files written) — stop here cleanly,
# don't build or push anything.
if [ "${DRY_RUN:-}" = "1" ]; then
  echo "[entrypoint] DRY_RUN=1 — fetch logged above; not building/publishing. Done."
  exit 0
fi

LABEL="$(python3 /app/label.py)"
echo "[entrypoint] building + publishing snapshot: $LABEL"
node producer/run.mjs "$LABEL"
