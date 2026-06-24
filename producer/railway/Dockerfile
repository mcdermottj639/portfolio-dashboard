# Railway producer image: Python (robin_stocks) + Node (the existing producer tail) + git.
# Build context = repo root so the image bundles producer/railway/*. The repo itself is
# re-cloned at runtime by entrypoint.sh (to read latest main + prior data.json, and to push).
FROM python:3.12-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates curl \
 && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
 && apt-get install -y --no-install-recommends nodejs \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY producer/railway/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt
COPY producer/railway/fetch_rh.py producer/railway/label.py producer/railway/entrypoint.sh /app/
RUN chmod +x /app/entrypoint.sh

CMD ["/app/entrypoint.sh"]
