#!/bin/bash
set -euo pipefail
echo "=== session DB ==="
sudo docker exec proxyhubb-postgres-1 psql -U proxyhubb -d proxyhubb -c "
SELECT s.id::text, s.status,
       CASE WHEN s.credentials_user LIKE 'ENC:%' THEN 'encrypted' ELSE 'plain' END AS cred_form,
       o.status AS order_status
FROM sessions s
JOIN orders o ON o.session_id = s.id
WHERE o.id='302dd5c9-9fc3-4b10-86a9-9156a3276d2a';
"
echo "=== redis session key exists? ==="
# Check if plaintext username key exists (do not print session payload)
sudo docker exec proxyhubb-redis-1 redis-cli EXISTS 'session:5d5ec3bb51919e7c'
echo "=== recent gateway auth failures (redacted) ==="
sudo docker logs --since=30m proxyhubb-edge-gateway-1 2>&1 | grep -iE '407|auth fail|unauthorized|invalid password|session not found|missing session' | tail -30
echo "=== edge /health ==="
curl -sS -m 5 -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8090/health || true
