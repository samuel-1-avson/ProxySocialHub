#!/bin/bash
set -euo pipefail
echo "=== order+session ==="
sudo docker exec proxyhubb-postgres-1 psql -U proxyhubb -d proxyhubb -c "
SELECT o.id::text, o.status AS order_status, o.session_id::text,
       s.status AS session_status, s.node_id::text, s.credentials_user
FROM orders o
LEFT JOIN sessions s ON s.id = o.session_id
WHERE o.id = '302dd5c9-9fc3-4b10-86a9-9156a3276d2a';
"
echo "=== listing ==="
sudo docker exec proxyhubb-postgres-1 psql -U proxyhubb -d proxyhubb -c "
SELECT id::text, title, provider_node_id::text FROM proxy_listings WHERE id='c1472dbc-dee3-407e-8fea-ec3ed42489ac';
"
echo "=== provider nodes ==="
sudo docker exec proxyhubb-postgres-1 psql -U proxyhubb -d proxyhubb -c "
SELECT id::text, name, status, is_healthy, coalesce(gateway_node_id,'') AS gw
FROM provider_nodes WHERE user_id='b77e84c9-0e85-4f23-afc0-581cd561c216' AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT 5;
"
echo "=== activation events ==="
sudo docker exec proxyhubb-postgres-1 psql -U proxyhubb -d proxyhubb -c "
SELECT status, reason, left(coalesce(last_error,''),160) AS err, created_at
FROM escrow_reconciliation_events
WHERE order_id='302dd5c9-9fc3-4b10-86a9-9156a3276d2a'
ORDER BY created_at DESC LIMIT 8;
" 2>&1 | head -40
echo "=== logs ==="
sudo docker logs --since=3h proxyhubb-control-api-1 2>&1 | grep -iE '302dd5c9|session sync|ActivateOrder|confirm-escrow|provider node|redis session' | tail -50
