#!/usr/bin/env bash
# Cache a foreign operator bond PDA on Host-A. No control-api restart.
#   bash /tmp/gcp-w7d-cache-bond-pda.sh <bond_pda> [slug]
set -euo pipefail
PDA="${1:-}"
SLUG="${2:-edge-ext}"
[[ "$PDA" =~ ^[1-9A-HJ-NP-Za-km-z]{32,44}$ ]] || { echo "FAIL: bond pda looks invalid"; exit 2; }
[[ "$SLUG" =~ ^[a-z0-9-]+$ ]] || { echo "FAIL: slug looks invalid"; exit 2; }
[[ "$SLUG" != "edge-a" && "$SLUG" != "edge-b" ]] || { echo "FAIL: refuse platform slug"; exit 2; }
before=$(sudo docker inspect -f '{{.State.StartedAt}}' proxyhubb-control-api-1)
sudo docker exec -i proxyhubb-postgres-1 psql -U proxyhubb -d proxyhubb -v ON_ERROR_STOP=1 <<SQL
UPDATE gateway_operators
SET stake_account = '${PDA}', updated_at = NOW()
WHERE slug = '${SLUG}'
  AND org_id <> ''
  AND org_id <> 'gen-lang-client-0022105784';
SELECT slug, org_id, left(pubkey,12) AS pub12, stake_account
FROM gateway_operators
WHERE slug = '${SLUG}';
SQL
after=$(sudo docker inspect -f '{{.State.StartedAt}}' proxyhubb-control-api-1)
echo "BEFORE_STARTED=$before"
echo "AFTER_STARTED=$after"
[[ "$before" == "$after" ]] || { echo "FAIL: control-api restarted"; exit 2; }
echo "W7D_BOND_PDA_CACHED"
