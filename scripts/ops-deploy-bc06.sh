#!/usr/bin/env bash
# Remote (VM) installer for BC-06 control-api + migration + cosigner env.
set -euo pipefail
cd /opt/proxyhubb
COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml)

install() {
  local src="$1" dst="$2"
  [[ -f "$src" ]] || { echo "missing $src"; exit 1; }
  mkdir -p "$(dirname "$dst")"
  tr -d '\015' <"$src" >"$dst"
  echo "installed $dst"
}

install /tmp/bc06/multisig_oracle.go services/control-api/internal/solana/multisig_oracle.go
install /tmp/bc06/mode.go services/control-api/internal/decentralization/mode.go
install /tmp/bc06/main.go services/control-api/main.go
install /tmp/bc06/order.go services/control-api/internal/models/order.go
install /tmp/bc06/orders.go services/control-api/internal/api/orders.go
install /tmp/bc06/orders_confirm_escrow.go services/control-api/internal/api/orders_confirm_escrow.go
install /tmp/bc06/escrow.go services/control-api/internal/api/escrow.go
install /tmp/bc06/escrow_settle.go services/control-api/internal/api/escrow_settle.go
install /tmp/bc06/escrow_settle_test.go services/control-api/internal/api/escrow_settle_test.go
install /tmp/bc06/compensation_outbox.go services/control-api/internal/api/compensation_outbox.go
install /tmp/bc06/mode_multisig_settle_test.go services/control-api/internal/decentralization/mode_multisig_settle_test.go
install /tmp/bc06/000142_orders_escrow_multisig.up.sql migrations/000142_orders_escrow_multisig.up.sql
install /tmp/bc06/000142_orders_escrow_multisig.down.sql migrations/000142_orders_escrow_multisig.down.sql
install /tmp/bc06/docker-compose.yml docker-compose.yml
install /tmp/bc06/docker-compose.gcp-testnet.yml docker-compose.gcp-testnet.yml

mkdir -p secrets
if [[ -f /tmp/bc06/multisig-cosigner.json ]]; then
  install /tmp/bc06/multisig-cosigner.json secrets/multisig-cosigner.json
fi
[[ -f secrets/multisig-cosigner.json ]] || { echo "missing secrets/multisig-cosigner.json"; exit 1; }
# appuser in container must read cosigner (not oracle/hot)
chmod 644 secrets/multisig-cosigner.json

upsert_env() {
  local k="$1" v="$2"
  if grep -qE "^${k}=" .env 2>/dev/null; then
    sed -i "s|^${k}=.*|${k}=${v}|" .env
  else
    echo "${k}=${v}" >> .env
  fi
}
upsert_env PROXYHUB_MULTISIG_SETTLE_ENABLED true
upsert_env PROXYHUB_MULTISIG_SETTLE_AMOUNT_LAMPORTS 100000000
upsert_env PROXYHUB_MULTISIG_COSIGNER_KEYPAIR /opt/proxyhubb/secrets/multisig-cosigner.json
upsert_env PROXYHUB_MULTISIG_COSIGNER_HOST_PATH ./secrets/multisig-cosigner.json

grep -q 'SettleEscrowMultiSigLocal' services/control-api/internal/solana/multisig_oracle.go
grep -q 'SettleOrderEscrow' services/control-api/internal/api/escrow_settle.go
grep -q 'MultisigSettleEnabled' services/control-api/internal/api/orders.go
grep -q 'PROXYHUB_MULTISIG_SETTLE_ENABLED' docker-compose.gcp-testnet.yml
echo SOURCES_OK

"${COMPOSE[@]}" build --no-cache control-api
"${COMPOSE[@]}" up -d --no-deps --force-recreate control-api

for i in $(seq 1 60); do
  st=$("${COMPOSE[@]}" ps control-api --format '{{.Status}}' || true)
  echo "try=$i api=$st"
  echo "$st" | grep -qi healthy && break
  sleep 5
done
echo "$st" | grep -qi healthy

ENABLED=$("${COMPOSE[@]}" exec -T control-api printenv PROXYHUB_MULTISIG_SETTLE_ENABLED | tr -d '\r')
THRESH=$("${COMPOSE[@]}" exec -T control-api printenv PROXYHUB_MULTISIG_SETTLE_AMOUNT_LAMPORTS | tr -d '\r')
COSIGN=$("${COMPOSE[@]}" exec -T control-api printenv PROXYHUB_MULTISIG_COSIGNER_KEYPAIR | tr -d '\r')
echo "enabled=$ENABLED thresh=$THRESH cosigner=$COSIGN"
[[ "$ENABLED" == "true" ]]
[[ "$THRESH" == "100000000" ]]

# Apply migration if migrate container / tool available
if "${COMPOSE[@]}" run --rm --no-deps control-api true >/dev/null 2>&1; then
  :
fi
# Prefer psql via postgres service
if [[ -f migrations/000142_orders_escrow_multisig.up.sql ]]; then
  "${COMPOSE[@]}" exec -T postgres psql -U "${POSTGRES_USER:-proxyhubb}" -d "${POSTGRES_DB:-proxyhubb}" \
    -f - < migrations/000142_orders_escrow_multisig.up.sql || true
fi

sleep 3
"${COMPOSE[@]}" logs control-api --since 3m 2>/dev/null \
  | grep -E 'Multi-Sig Oracle initialized|multisig' | tail -15 || true

curl -fsS -o /dev/null -w "health=%{http_code}\n" http://127.0.0.1:8080/health
curl -fsS http://127.0.0.1:8080/v1/crypto/multisig-status 2>/dev/null | head -c 800 || \
  curl -fsS http://127.0.0.1:8080/crypto/multisig-status 2>/dev/null | head -c 800 || true
echo
echo BC06_DEPLOY_DONE
