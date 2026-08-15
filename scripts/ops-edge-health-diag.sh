#!/usr/bin/env bash
set -euo pipefail
cd /opt/proxyhubb
COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml)

echo "=== edge status ==="
"${COMPOSE[@]}" ps edge-gateway --format 'table {{.Name}}\t{{.Status}}\t{{.Ports}}'

echo "=== inspect Health ==="
CID=$("${COMPOSE[@]}" ps -q edge-gateway)
docker inspect "$CID" --format '{{json .State.Health}}' | python3 -m json.tool 2>/dev/null || docker inspect "$CID" --format '{{json .State.Health}}'
echo
echo "=== Healthcheck Config ==="
docker inspect "$CID" --format '{{json .Config.Healthcheck}}' | python3 -m json.tool 2>/dev/null || docker inspect "$CID" --format '{{json .Config.Healthcheck}}'
echo

echo "=== probe from host ==="
curl -sS -w "\nhealth=%{http_code}\n" http://127.0.0.1:8090/health || true
curl -sS -w "\nready=%{http_code}\n" http://127.0.0.1:8090/ready || true

echo "=== probe from inside container (same as healthcheck if possible) ==="
docker exec "$CID" sh -c 'command -v curl; command -v wget; ls /usr/bin/curl /usr/bin/wget 2>/dev/null; cat /etc/os-release | head -3' || true
docker exec "$CID" sh -c 'curl -fsS -o /dev/null -w "in_curl_health=%{http_code}\n" http://127.0.0.1:8090/health' 2>&1 || true
docker exec "$CID" sh -c 'wget -q -O /dev/null http://127.0.0.1:8090/health && echo in_wget_health=OK' 2>&1 || true

echo EDGE_HEALTH_DIAG_DONE
