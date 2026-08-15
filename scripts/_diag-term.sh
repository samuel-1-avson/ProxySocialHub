#!/bin/bash
set -euo pipefail
echo "=== session row ==="
sudo docker exec proxyhubb-postgres-1 psql -U proxyhubb -d proxyhubb -c "
SELECT id::text, status, node_id::text, type, bandwidth_limit, bytes_used, created_at, updated_at, expires_at
FROM sessions WHERE id='765cc39d-9b13-4036-9d41-7c4f6c6df5a4';
"
echo "=== audit around session ==="
sudo docker exec proxyhubb-postgres-1 psql -U proxyhubb -d proxyhubb -c "
SELECT event_type, description, created_at, left(coalesce(metadata::text,''),120)
FROM audit_logs
WHERE target_id IN ('302dd5c9-9fc3-4b10-86a9-9156a3276d2a','765cc39d-9b13-4036-9d41-7c4f6c6df5a4')
   OR description ILIKE '%765cc39d%' OR description ILIKE '%terminat%'
ORDER BY created_at DESC LIMIT 20;
" 2>&1 | head -50
echo "=== termination logs ==="
sudo docker logs --since=3h proxyhubb-control-api-1 2>&1 | grep -iE '765cc39d|terminat|session.*disabl|ExpireSession|cleanup' | tail -60
