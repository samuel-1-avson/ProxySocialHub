#!/bin/bash
set -euo pipefail
echo "=== provider nodes ==="
sudo docker exec proxyhubb-postgres-1 psql -U proxyhubb -d proxyhubb -c "
SELECT id::text, name, status, is_healthy, coalesce(gateway_node_id,'') AS gw,
       host(ip_address) AS ip, deleted_at IS NOT NULL AS deleted, last_seen_at
FROM provider_nodes
WHERE user_id='b77e84c9-0e85-4f23-afc0-581cd561c216'
ORDER BY deleted_at NULLS FIRST, last_seen_at DESC NULLS LAST;
"
echo "=== ghana listing ==="
sudo docker exec proxyhubb-postgres-1 psql -U proxyhubb -d proxyhubb -c "
SELECT id::text, title, provider_node_id::text, status::text
FROM proxy_listings WHERE seller_id='b77e84c9-0e85-4f23-afc0-581cd561c216';
"
echo "=== order session ==="
sudo docker exec proxyhubb-postgres-1 psql -U proxyhubb -d proxyhubb -c "
SELECT o.status AS order_status, s.status AS session_status
FROM orders o LEFT JOIN sessions s ON s.id=o.session_id
WHERE o.id='302dd5c9-9fc3-4b10-86a9-9156a3276d2a';
"
echo "=== heartbeat / reaper logs ==="
sudo docker logs --since=45m proxyhubb-control-api-1 2>&1 | grep -iE 'SessionReaper|nodeHeartbeat|/heartbeat|Node not found|suggested' | tail -40
