"""Read-only served asset verification; never downloads/decrypts account data."""
from pathlib import Path
import hashlib
import time
import urllib.request
ROOT=Path(__file__).resolve().parents[1]
BASE='https://mcdermottj639.github.io/portfolio-dashboard/'
ASSETS=['index.html','sw.js','ui/experience.js','ui/journey.js','ui/journey.css',
        'ui/theme.js','ui/today-model.js','ui/today.js','ui/today.css']
expected={p:hashlib.sha256((ROOT/p).read_bytes()).hexdigest() for p in ASSETS}
last={}
for attempt in range(30):
    for p in ASSETS:
        try:
            req=urllib.request.Request(BASE+p+'?verify='+str(time.time_ns()),headers={'Cache-Control':'no-cache'})
            with urllib.request.urlopen(req,timeout=15) as res:
                last[p]=hashlib.sha256(res.read()).hexdigest()
        except Exception as e:
            last[p]=type(e).__name__
    if all(last.get(p)==expected[p] for p in ASSETS):
        print('Served shell matches this release:',', '.join(ASSETS))
        break
    time.sleep(4)
else:
    raise SystemExit('Published shell did not match this commit: '+', '.join(p for p in ASSETS if last.get(p)!=expected[p]))
