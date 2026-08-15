#!/usr/bin/env bash
set -euo pipefail
cd /opt/proxyhubb
COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml)

echo "SRC_MS=$(grep -c SettleEscrowMultiSigLocal services/control-api/internal/solana/multisig_oracle.go || true)"
echo "SRC_KIND=$(grep -c escrow_seed_kind services/control-api/internal/models/order.go || true)"
echo "SRC_SETTLE=$(test -f services/control-api/internal/api/escrow_settle.go && echo 1 || echo 0)"
ls -la secrets/multisig-cosigner.json
"${COMPOSE[@]}" ps control-api --format '{{.Status}}' || true

# Force rebuild if binary lacks BC-06 strings
if ! "${COMPOSE[@]}" exec -T control-api sh -c 'strings /server 2>/dev/null | grep -q SettleEscrowMultiSigLocal'; then
  echo "BINARY_STALE — rebuilding --no-cache"
  "${COMPOSE[@]}" build --no-cache control-api
  "${COMPOSE[@]}" up -d --no-deps --force-recreate control-api
  for i in $(seq 1 60); do
    st=$("${COMPOSE[@]}" ps control-api --format '{{.Status}}' || true)
    echo "try=$i api=$st"
    echo "$st" | grep -qi healthy && break
    sleep 5
  done
fi

"${COMPOSE[@]}" exec -T control-api sh -c 'strings /server | grep -E "SettleEscrowMultiSigLocal|PROXYHUB_MULTISIG_COSIGNER" | head -5' || true
"${COMPOSE[@]}" exec -T control-api printenv PROXYHUB_MULTISIG_SETTLE_ENABLED PROXYHUB_MULTISIG_SETTLE_AMOUNT_LAMPORTS PROXYHUB_MULTISIG_COSIGNER_KEYPAIR
"${COMPOSE[@]}" logs control-api --since 15m 2>/dev/null | grep -E 'Multi-Sig Oracle initialized|authorized_local' | tail -10 || true

# migration
"${COMPOSE[@]}" exec -T postgres psql -U "${POSTGRES_USER:-proxyhubb}" -d "${POSTGRES_DB:-proxyhubb}" -c \
  "ALTER TABLE orders ADD COLUMN IF NOT EXISTS escrow_seed_kind VARCHAR(16) NOT NULL DEFAULT ''; ALTER TABLE orders ADD COLUMN IF NOT EXISTS escrow_expires_at BIGINT NOT NULL DEFAULT 0;"
"${COMPOSE[@]}" exec -T postgres psql -U "${POSTGRES_USER:-proxyhubb}" -d "${POSTGRES_DB:-proxyhubb}" -c \
  "SELECT column_name FROM information_schema.columns WHERE table_name='orders' AND column_name IN ('escrow_seed_kind','escrow_expires_at');"

curl -fsS -o /dev/null -w "health=%{http_code}\n" http://127.0.0.1:8080/health
echo BC06_VERIFY_DONE
