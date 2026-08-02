#!/usr/bin/env bash
# Resume BC-08 wiring after keygen + Secret Manager (compose without gcp-images).
set -euo pipefail
cd /opt/proxyhubb

COMPOSE=(sudo docker compose -f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml)
HOT_PUB=FeunrDoACmUi4fFQtiw3fPHAqB3N9UrAsj8ZzqSsGPa3
ORACLE_PUB=8P4uuapgGfW8L7VvdQJ9W7RpJqpfyifhPx9UQaHnKii2

echo "=== secrets file ==="
sudo ls -la secrets/treasury-hot-keypair.json
# Container runs as appuser; match oracle keypair readability on the VM.
sudo chmod 644 secrets/treasury-hot-keypair.json
sudo chown root:root secrets/treasury-hot-keypair.json

echo "=== DB + redis ==="
"${COMPOSE[@]}" exec -T postgres psql -U proxyhubb -d proxyhubb <<SQL
UPDATE system_configurations
SET value = '${HOT_PUB}',
    description = 'Treasury hot wallet for deposits/payouts (BC-08 split from oracle)',
    updated_at = NOW()
WHERE key = 'treasury_wallet_solana';

INSERT INTO system_configurations (id, key, value, description, updated_at)
SELECT gen_random_uuid(), 'treasury_wallet_solana', '${HOT_PUB}',
       'Treasury hot wallet for deposits/payouts (BC-08 split from oracle)', NOW()
WHERE NOT EXISTS (SELECT 1 FROM system_configurations WHERE key = 'treasury_wallet_solana');

SELECT key, left(value, 12) AS value_prefix FROM system_configurations WHERE key = 'treasury_wallet_solana';
SQL

REDIS_PW="$(grep -E '^REDIS_PASSWORD=' .env | head -1 | cut -d= -f2- | tr -d '"' | tr -d "'")"
if [[ -n "${REDIS_PW}" ]]; then
  "${COMPOSE[@]}" exec -T redis redis-cli -a "${REDIS_PW}" HDEL sys:config:hash treasury_wallet_solana || true
  "${COMPOSE[@]}" exec -T redis redis-cli -a "${REDIS_PW}" HSET sys:config:hash treasury_wallet_solana "${HOT_PUB}" || true
  "${COMPOSE[@]}" exec -T redis redis-cli -a "${REDIS_PW}" HGET sys:config:hash treasury_wallet_solana || true
else
  echo "WARN: REDIS_PASSWORD missing; skipping redis hash update"
fi

echo "=== rebuild control-api ==="
"${COMPOSE[@]}" build control-api
"${COMPOSE[@]}" up -d --no-deps --force-recreate control-api

echo "=== wait healthy ==="
for i in $(seq 1 48); do
  if curl -sf http://127.0.0.1:18080/health >/dev/null 2>&1 || curl -sf http://127.0.0.1:8080/health >/dev/null 2>&1; then
    echo healthy
    break
  fi
  sleep 5
done

echo "=== env verify ==="
"${COMPOSE[@]}" exec -T control-api sh -c 'echo APP_ENV=$APP_ENV; echo HOT_ADDR=$SOLANA_TREASURY_HOT_ADDRESS; echo TREASURY_ADDR=$SOLANA_TREASURY_ADDRESS; echo HOT_KP=$SOLANA_TREASURY_HOT_KEYPAIR; ls -la /run/secrets/treasury-hot-keypair.json /run/secrets/oracle-keypair.json'

echo "=== custody logs ==="
"${COMPOSE[@]}" logs --tail=120 control-api 2>&1 | grep -E 'BC-08|custody|payout=|WARNING: BC-08|Treasury custody|FATAL|Oracle velocity|Skipping Liquidity' || true

echo "=== fund hot 0.5 SOL from oracle ==="
if [[ -f infra/oracle-keypair.json ]]; then
  sudo docker run --rm --network host --entrypoint solana \
    -v /opt/proxyhubb/infra/oracle-keypair.json:/kp.json:ro \
    solanalabs/solana:v1.18.26 \
    transfer --from /kp.json "${HOT_PUB}" 0.5 \
      --url https://api.devnet.solana.com --allow-unfunded-recipient --keypair /kp.json \
    && echo FUNDED_HOT_0.5_SOL || echo FUND_FAILED
else
  echo NO_ORACLE_KEY_ON_VM
fi

echo "oracle=${ORACLE_PUB}"
echo "hot=${HOT_PUB}"
echo DONE
