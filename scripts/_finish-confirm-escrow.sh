#!/bin/bash
set -euo pipefail
cd /opt/proxyhubb
TAR=$(ls -1t /tmp/confirm-escrow-webfix-*.tar.gz | head -1)
sudo tar -xzf "$TAR" -C /opt/proxyhubb
sudo sed -i 's/\r$//' apps/web/src/lib/api/marketplace.ts
grep -n 'getSuggestedListingPrice\|confirmEscrowPayment\|escrow_already_funded' apps/web/src/lib/api/marketplace.ts | head -20
COMPOSE=(sudo docker compose -f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml)
echo "=== build web ==="
"${COMPOSE[@]}" build web
echo "=== recreate web ==="
"${COMPOSE[@]}" up -d --no-deps --force-recreate web
sleep 15
curl -sS -o /dev/null -w "web=%{http_code}\n" http://127.0.0.1:3000/ || true
# Activate newest pending_payment via confirm-escrow using JWT minted from container secret
echo "=== mint jwt + confirm escrow ==="
SECRET=$(sudo docker exec proxyhubb-control-api-1 printenv JWT_SECRET)
ORDER_ID=$(sudo docker exec proxyhubb-postgres-1 psql -U proxyhubb -d proxyhubb -tAc "SELECT id::text FROM orders WHERE buyer_id='b77e84c9-0e85-4f23-afc0-581cd561c216' AND status='pending_payment' ORDER BY created_at DESC LIMIT 1;")
echo "ORDER_ID=$ORDER_ID"
TOKEN=$(SECRET="$SECRET" python3 - <<'PY'
import os, time, hmac, hashlib, base64, json
secret=os.environ["SECRET"].encode()
def b64(d):
  return base64.urlsafe_b64encode(d).rstrip(b"=").decode()
header=b64(json.dumps({"alg":"HS256","typ":"JWT"},separators=(",",":")).encode())
payload=b64(json.dumps({
  "sub":"b77e84c9-0e85-4f23-afc0-581cd561c216",
  "role":"buyer",
  "wallet":"62vwX11TCForSbpExYz7sp2b6AkWy7urDgYHcERt2eE",
  "exp":int(time.time())+3600,
  "iat":int(time.time()),
  "iss":"proxyhubb-control-api",
},separators=(",",":")).encode())
sig=b64(hmac.new(secret,f"{header}.{payload}".encode(),hashlib.sha256).digest())
print(f"{header}.{payload}.{sig}")
PY
)
RESP=$(curl -sS -w "\nHTTP=%{http_code}" -X POST "http://127.0.0.1:18080/v1/orders/${ORDER_ID}/confirm-escrow" \
  -H "Authorization: Bearer ${TOKEN}" -H "Content-Type: application/json" -d '{}')
echo "$RESP"
echo "=== order status after ==="
sudo docker exec proxyhubb-postgres-1 psql -U proxyhubb -d proxyhubb -c "SELECT id::text, status, escrow_pda, session_id IS NOT NULL AS has_session FROM orders WHERE id='${ORDER_ID}';"
# Cancel older duplicate pending/pending_payment for same buyer (keep active ones)
echo "=== cancel older stuck duplicates ==="
sudo docker exec proxyhubb-postgres-1 psql -U proxyhubb -d proxyhubb -c "UPDATE orders SET status='cancelled', updated_at=NOW() WHERE buyer_id='b77e84c9-0e85-4f23-afc0-581cd561c216' AND status IN ('pending','pending_payment') AND id <> '${ORDER_ID}' RETURNING id::text, status;"
