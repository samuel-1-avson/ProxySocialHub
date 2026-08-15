#!/usr/bin/env bash
set -euo pipefail
cd /opt/proxyhubb
COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml)
"${COMPOSE[@]}" logs control-api --tail 120 2>/dev/null | grep -E 'GCP Cloud KMS|Initialized|BC-08|USE_GCP|fallback|oracle' | tail -30 || true
echo "---"
"${COMPOSE[@]}" exec -T control-api printenv USE_GCP_KMS GCP_KMS_KEY_NAME | tr -d '\r'
echo LOGS_DONE
