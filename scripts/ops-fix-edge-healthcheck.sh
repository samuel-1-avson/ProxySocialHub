#!/usr/bin/env bash
# Fix edge compose unhealthy: wget --spider (HEAD) got 501; switch probe to GET
# and accept HEAD on /health+/ready in the binary.
set -euo pipefail
cd /opt/proxyhubb
COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml)

# Compose healthcheck (GET)
python3 - <<'PY'
from pathlib import Path
p = Path("docker-compose.yml")
text = p.read_text()
old = 'test: ["CMD", "wget", "--no-verbose", "--tries=1", "--spider", "http://127.0.0.1:8090/health"]'
new = 'test: ["CMD", "wget", "--no-verbose", "--tries=1", "-O", "/dev/null", "http://127.0.0.1:8090/health"]'
if old in text:
    p.write_text(text.replace(old, new, 1))
    print("compose_healthcheck=patched")
elif new in text or '-O", "/dev/null", "http://127.0.0.1:8090/health"' in text:
    print("compose_healthcheck=already_ok")
else:
    raise SystemExit("compose healthcheck pattern not found")
PY

# Edge source HEAD support (if uploaded)
if [[ -f /tmp/edge-main.rs ]]; then
  tr -d '\015' </tmp/edge-main.rs > services/edge-gateway/src/main.rs
  grep -q 'Method::HEAD' services/edge-gateway/src/main.rs
  echo edge_main=patched
  echo "=== rebuild edge-gateway ==="
  "${COMPOSE[@]}" build edge-gateway
  "${COMPOSE[@]}" up -d --no-deps --force-recreate edge-gateway
else
  echo edge_main=skipped
  "${COMPOSE[@]}" up -d --no-deps --force-recreate edge-gateway
fi

for i in $(seq 1 36); do
  st=$("${COMPOSE[@]}" ps edge-gateway --format '{{.Status}}' || true)
  echo "try=$i eg=$st"
  echo "$st" | grep -qi healthy && break
  sleep 5
done

CID=$("${COMPOSE[@]}" ps -q edge-gateway)
echo "=== final status ==="
"${COMPOSE[@]}" ps edge-gateway --format 'table {{.Name}}\t{{.Status}}'
docker inspect "$CID" --format 'Health={{.State.Health.Status}} FailingStreak={{.State.Health.FailingStreak}}'
curl -sS -o /dev/null -w "GET=%{http_code}\n" http://127.0.0.1:8090/health
curl -sS -o /dev/null -w "HEAD=%{http_code}\n" -I http://127.0.0.1:8090/health || true
docker exec "$CID" sh -c 'wget --no-verbose --tries=1 --spider http://127.0.0.1:8090/health; echo spider_exit=$?'
docker exec "$CID" sh -c 'wget --no-verbose --tries=1 -O /dev/null http://127.0.0.1:8090/health; echo get_exit=$?'

echo "$st" | grep -qi healthy
echo EDGE_HEALTHCHECK_FIXED
