#!/usr/bin/env bash
# GW-08 / EV-05 lite live probe on gcp-testnet.
set -euo pipefail
cd /opt/proxyhubb
COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml)

echo '=== edge image ==='
docker inspect proxyhubb-edge-gateway-1 --format 'image={{.Config.Image}} created={{.Created}}' 2>/dev/null || echo 'edge missing'

echo '=== spill worker boot ==='
docker logs proxyhubb-control-api-1 2>&1 | grep -i 'Metering Spill' | tail -5 || true

echo '=== metering_wal_spill table ==='
"${COMPOSE[@]}" exec -T postgres psql -U proxyhubb -d proxyhubb -c '\dt metering_wal_spill' || true
"${COMPOSE[@]}" exec -T postgres psql -U proxyhubb -d proxyhubb -c 'SELECT count(*) AS spill_rows FROM metering_wal_spill;' || true

echo '=== redis metering key sample ==='
RPW=$(grep -E '^REDIS_PASSWORD=' .env | head -1 | cut -d= -f2- | tr -d '\r')
"${COMPOSE[@]}" exec -T redis redis-cli -a "$RPW" --no-auth-warning KEYS 'metering:*' 2>/dev/null | head -30 || true

echo '=== edge binary markers (strings) ==='
docker exec proxyhubb-edge-gateway-1 sh -c 'strings /app/edge-gateway 2>/dev/null | grep -E "metering:pending|spill_to_control|exactly-once|metering/spill" | head -20' || \
  docker exec proxyhubb-edge-gateway-1 sh -c 'grep -aob "metering:pending\|metering/spill\|spilling to control-api" /usr/local/bin/* 2>/dev/null | head -10' || \
  echo 'could not string-scan edge binary'

echo GW08_PROBE_DONE
