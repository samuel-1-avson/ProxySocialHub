#!/usr/bin/env bash
# Finish traffic-first deploy after 000128 already applied.
set -euo pipefail
cd /opt/proxyhubb
COMPOSE=(sudo docker compose -f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml)

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Recreating control-api + web"
"${COMPOSE[@]}" up -d --no-deps --force-recreate control-api web

for svc in control-api web; do
  ok=0
  for i in $(seq 1 90); do
    st=$("${COMPOSE[@]}" ps "$svc" --format '{{.Status}}' 2>/dev/null || true)
    echo "try=$i $svc $st"
    if echo "$st" | grep -qi healthy; then
      echo "$svc HEALTHY"
      ok=1
      break
    fi
    sleep 5
  done
  if [[ "$ok" != "1" ]]; then
    echo "$svc failed healthy" >&2
    "${COMPOSE[@]}" logs --tail=80 "$svc" || true
    exit 1
  fi
done

curl -sS -o /dev/null -w "api_health=%{http_code}\n" http://127.0.0.1:8080/health || true
curl -sS -o /dev/null -w "web_home=%{http_code}\n" http://127.0.0.1:3000/ || true
echo "=== suggest-price ==="
curl -sS "http://127.0.0.1:8080/v1/suggest-price?country=US&proxy_type=residential" || true
echo
echo "=== oracle binary marker ==="
sudo docker exec proxyhubb-control-api-1 sh -c 'strings /app/control-api 2>/dev/null | grep -c "traffic-first soft cap" || true'
echo "TRAFFIC_FIRST_FINISH_DONE"
