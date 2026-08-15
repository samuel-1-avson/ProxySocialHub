#!/usr/bin/env bash
# Deploy Sprint H spill + recreate control-api/edge on gcp-testnet.
set -euo pipefail
cd /opt/proxyhubb

DC=(sudo docker compose -f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml)

echo "== apply migration 000140 =="
# Prefer migrate service if present; else psql via postgres container.
if [ -f migrations/000140_metering_wal_spill.up.sql ]; then
  sudo docker exec -i proxyhubb-postgres-1 psql -U proxyhubb -d proxyhubb < migrations/000140_metering_wal_spill.up.sql
fi

echo "== rebuild control-api + edge-gateway =="
"${DC[@]}" up -d --build --force-recreate control-api edge-gateway

echo "== wait healthy =="
for i in $(seq 1 60); do
  st=$(sudo docker inspect proxyhubb-control-api-1 --format '{{.State.Health.Status}}' 2>/dev/null || echo starting)
  echo "control-api health=$st"
  if [ "$st" = "healthy" ]; then
    break
  fi
  sleep 5
done

sudo docker logs proxyhubb-control-api-1 2>&1 | grep -E "Metering Spill|Initialized GCP Cloud KMS|custody split" | tail -20
echo "SPRINT_H_DEPLOY_READY"
