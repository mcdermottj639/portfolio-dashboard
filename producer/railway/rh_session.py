#!/usr/bin/env python3
"""
rh_session.py — run this ONCE on YOUR OWN computer to create a Robinhood session for the Railway
producer, for accounts that don't offer authenticator-app (TOTP) 2FA.

It logs you in (answer the SMS code / approve the app prompt when asked — that's the one interactive
step), saves the session, and prints a single line `RH_SESSION_B64=…` to paste into Railway as a
service variable. The robot then reuses that session with no further prompts until it expires
(typically a week or two) — at which point you just re-run this and update the variable.

Setup (one time):
    1. Install Python 3 from https://www.python.org/downloads/ (tick "Add to PATH" on Windows).
    2. In a terminal:  pip install robin_stocks
    3. Run:           python rh_session.py
    4. Copy the printed RH_SESSION_B64=… line into Railway → Variables (Raw Editor).
       You can then remove RH_PASSWORD / RH_MFA_SECRET from Railway if you like — the session is
       enough. (Keep RH_USERNAME.)

Nothing here is uploaded anywhere; the session string only goes where you paste it.
"""
import base64
import getpass
import os

try:
    import robin_stocks.robinhood as rh
except ImportError:
    raise SystemExit("Install robin_stocks first:  pip install robin_stocks")


def main():
    user = input("Robinhood email: ").strip()
    pw = getpass.getpass("Robinhood password (hidden): ")
    print("\nLogging in… approve the prompt in your Robinhood app or enter the texted code if asked.\n")
    rh.login(username=user, password=pw, store_session=True)

    path = os.path.join(os.path.expanduser("~"), ".tokens", "robinhood.pickle")
    if not os.path.exists(path):
        raise SystemExit(f"Login did not create a session file at {path} — check the steps and retry.")
    with open(path, "rb") as f:
        b64 = base64.b64encode(f.read()).decode()

    print("\n" + "=" * 70)
    print("Paste this whole line into Railway → Variables (Raw Editor):\n")
    print("RH_SESSION_B64=" + b64)
    print("=" * 70)
    print("\nDone. Re-run this script and update the variable if the producer ever logs a login failure.")


if __name__ == "__main__":
    main()
