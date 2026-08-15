#!/bin/bash
set -euo pipefail
cd /opt/proxyhubb
TAR=$(ls -1t /tmp/confirm-escrow-*.tar.gz | head -1)
echo "Using $TAR"
sudo tar -xzf "$TAR" -C /opt/proxyhubb
for f in \
  services/control-api/internal/api/orders.go \
  services/control-api/internal/api/orders_confirm_escrow.go \
  services/control-api/internal/models/audit.go \
  apps/web/src/components/BuyListingModal.tsx \
  apps/web/src/lib/api/marketplace.ts \
  apps/web/src/lib/solana.ts
do
  sudo sed -i 's/\r$//' "$f"
done
test -f services/control-api/internal/api/orders_confirm_escrow.go
grep -n 'confirm-escrow\|escrow_already_funded' services/control-api/internal/api/orders.go | head -10
COMPOSE=(sudo docker compose -f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml)
echo "=== build control-api ==="
"${COMPOSE[@]}" build control-api
echo "=== build web ==="
"${COMPOSE[@]}" build web
echo "=== recreate ==="
"${COMPOSE[@]}" up -d --no-deps --force-recreate control-api web
sleep 25
curl -sS -o /dev/null -w "control-api=%{http_code}\n" http://127.0.0.1:18080/health || true
curl -sS -o /dev/null -w "web=%{http_code}\n" http://127.0.0.1:3000/ || true
echo "=== stuck orders ==="
sudo docker exec proxyhubb-postgres-1 psql -U proxyhubb -d proxyhubb -c "SELECT id::text, status, COALESCE(escrow_pda,'') AS pda, created_at FROM orders WHERE buyer_id='b77e84c9-0e85-4f23-afc0-581cd561c216' AND status IN ('pending','pending_payment') ORDER BY created_at DESC LIMIT 8;"
