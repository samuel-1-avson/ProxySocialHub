#!/usr/bin/env bash
# Titles only for foreign operators. No CONNECT change. No fake live listings.
set -euo pipefail
before=$(sudo docker inspect -f '{{.State.StartedAt}}' proxyhubb-control-api-1)
sudo docker exec -i proxyhubb-postgres-1 psql -U proxyhubb -d proxyhubb -v ON_ERROR_STOP=1 <<'SQL'
UPDATE gateway_operators
SET display_name = 'Fiffi join host (not live CONNECT)', updated_at = NOW()
WHERE slug = 'edge-ext' AND org_id = 'fiffi-500411';
UPDATE gateway_operators
SET display_name = 'Org-3 join host (not live CONNECT)', updated_at = NOW()
WHERE slug = 'edge-org3' AND org_id = 'gen-lang-client-0098858574';
SELECT slug, org_id, display_name, left(pubkey,8) AS pub8
FROM gateway_operators
WHERE slug IN ('edge-ext','edge-org3')
ORDER BY slug;
SQL
after=$(sudo docker inspect -f '{{.State.StartedAt}}' proxyhubb-control-api-1)
echo "BEFORE_STARTED=$before"
echo "AFTER_STARTED=$after"
[[ "$before" == "$after" ]] || { echo "FAIL: control-api restarted"; exit 2; }
echo "W12B_MERCHANDISE_TITLES_OK"
