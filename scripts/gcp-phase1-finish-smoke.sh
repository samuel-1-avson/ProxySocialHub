#!/usr/bin/env bash
# Deploy watcher fix, replay deposits from slot 0, enable UI, restore cold SOL.
set -euo pipefail
cd /opt/proxyhubb

SIG=49Vgc9uMqhecm4ZyMB3Tcy2HGnTDPJwVKCXkWUHREbbJpJCSownuVZSieRqMTEm9Ch7ByCsdWbEssn1kwVYDdwav
USER_ID=b77e84c9-0e85-4f23-afc0-581cd561c216
ORACLE_KP=/opt/proxyhubb/infra/oracle-keypair.json
COLD_KP=/opt/proxyhubb/secrets/treasury-cold-keypair.json
RPC=https://api.devnet.solana.com
COMPOSE=(sudo docker compose -f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml)

psql() { "${COMPOSE[@]}" exec -T postgres psql -U proxyhubb -d proxyhubb "$@"; }
sol() {
  sudo docker run --rm --network host \
    -v "$ORACLE_KP:/oracle.json:ro" \
    -v "$COLD_KP:/cold.json:ro" \
    --entrypoint solana solanalabs/solana:v1.18.26 "$@"
}

set_env() {
  local k="$1" v="$2"
  if grep -q "^${k}=" .env; then
    sudo sed -i "s|^${k}=.*|${k}=${v}|" .env
  else
    echo "${k}=${v}" | sudo tee -a .env >/dev/null
  fi
}

echo "== patch watcher source already copied; rebuild control-api =="
"${COMPOSE[@]}" build control-api

echo "== recreate with watcher replay =="
set_env PROXYHUB_WATCHER_START_SLOT 0
set_env PROXYHUB_DEPOSIT_VAULT_UI true
grep -E '^(PROXYHUB_WATCHER_START_SLOT|PROXYHUB_DEPOSIT_VAULT)' .env
"${COMPOSE[@]}" up -d --force-recreate --no-deps control-api
sleep 15
sudo docker logs proxyhubb-control-api-1 --since 1m 2>&1 | grep -iE 'Watcher|START_SLOT|deposit' | head -20 || true

echo "== wait for smoke sig credit (up to 3 min) =="
for i in $(seq 1 36); do
  ROW=$(psql -At -c "SELECT status||'|'||destination_kind||'|'||amount::text FROM pending_transactions WHERE reference='$SIG' LIMIT 1;" || true)
  if [[ -n "$ROW" ]]; then
    echo "FOUND $ROW"
    break
  fi
  echo "wait $i ..."
  sleep 5
done

psql -c "SELECT status, destination_kind, amount, LEFT(reference,24) FROM pending_transactions WHERE destination_kind='vault' ORDER BY created_at DESC LIMIT 5;"
BAL=$(psql -At -c "SELECT COALESCE(balance_sol,0) FROM wallets WHERE user_id='$USER_ID';")
echo "wallet_bal=$BAL"

echo "== clear replay flag =="
set_env PROXYHUB_WATCHER_START_SLOT ""
# empty value may leave START_SLOT= ; set to unset by removing line
sudo sed -i '/^PROXYHUB_WATCHER_START_SLOT=/d' .env
"${COMPOSE[@]}" up -d --force-recreate --no-deps control-api
sleep 10

echo "== restore 5 SOL to cold =="
ORACLE_PUB=$(sudo docker run --rm -v "$ORACLE_KP:/o.json:ro" --entrypoint solana-keygen solanalabs/solana:v1.18.26 pubkey /o.json)
COLD_PUB=$(sudo docker run --rm -v "$COLD_KP:/c.json:ro" --entrypoint solana-keygen solanalabs/solana:v1.18.26 pubkey /c.json)
echo "before oracle=$(sol balance $ORACLE_PUB --url $RPC) cold=$(sol balance $COLD_PUB --url $RPC)"
sol transfer --from /oracle.json --keypair /oracle.json "$COLD_PUB" 5 \
  --url "$RPC" --allow-unfunded-recipient --fee-payer /oracle.json
echo "after oracle=$(sol balance $ORACLE_PUB --url $RPC) cold=$(sol balance $COLD_PUB --url $RPC)"

curl -fsS http://127.0.0.1:8080/v1/system/config/public
echo
if [[ -n "${ROW:-}" ]]; then
  echo PHASE1_CONTINUE_OK
else
  echo PHASE1_CONTINUE_PARTIAL
  exit 2
fi
