#!/usr/bin/env python3
"""Print the snapshot label shown in the phone's freshness bar, e.g. 'Jun 24 2026, 3:45 PM ET'."""
from datetime import datetime
try:
    from zoneinfo import ZoneInfo
    now = datetime.now(ZoneInfo("America/New_York"))
except Exception:
    now = datetime.now()
# %-d / %-I are Linux-only (no leading zero) — fine for the Railway container.
print(now.strftime("%b %-d %Y, %-I:%M %p ET"))
