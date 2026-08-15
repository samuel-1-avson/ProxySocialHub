#!/usr/bin/env bash
# Smoke vault auto-credit: temporarily link oracle wallet to a known user,
# send 0.02 SOL oracle->vault, wait for credit, restore prior link if any.
set -euo pipefail
cd /opt/proxyhubb

ORACLE_KP=/opt/proxyhubb/infra/oracle-keypair.json
VAULT=8LZji2G9nn7ywoLwopgcREpm5xQHpvRJY1az1R9hHRzm
RPC=https://api.devnet.solana.com
USER_ID=b77e84c9-0e85-4f23-afc0-581cd561c216
SMOKE_AMOUNT=0.02

sol() {
  sudo docker run --rm --network host \
    -v "$ORACLE_KP:/oracle.json:ro" \
    -v /tmp:/tmp \
    --entrypoint solana solanalabs/solana:v1.18.26 "$@"
}
psql() {
  sudo docker compose -f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml \
    exec -T postgres psql -U proxyhubb -d proxyhubb "$@"
}

ORACLE_PUB=$(sudo docker run --rm -v "$ORACLE_KP:/o.json:ro" --entrypoint solana-keygen solanalabs/solana:v1.18.26 pubkey /o.json)
echo "oracle=$ORACLE_PUB vault=$VAULT user=$USER_ID"

echo "== pre balances =="
echo "vault=$(sol balance "$VAULT" --url "$RPC")"
echo "oracle=$(sol balance "$ORACLE_PUB" --url "$RPC")"
psql -c "SELECT balance_sol FROM wallets WHERE user_id = '${USER_ID}';"
psql -c "SELECT address, user_id FROM linked_wallets WHERE address = '${ORACLE_PUB}' OR user_id = '${USER_ID}';"

echo "== ensure oracle linked to smoke user =="
EXISTING=$(psql -At -c "SELECT user_id::text FROM linked_wallets WHERE address = '${ORACLE_PUB}' LIMIT 1;" || true)
psql -v ON_ERROR_STOP=1 <<SQL
INSERT INTO linked_wallets (id, user_id, address, chain, created_at, updated_at)
VALUES (gen_random_uuid(), '${USER_ID}', '${ORACLE_PUB}', 'solana', NOW(), NOW())
ON CONFLICT (chain, address) DO UPDATE SET user_id = EXCLUDED.user_id, updated_at = NOW();
SQL
echo "prior_link_user=${EXISTING:-none}"

BAL_BEFORE=$(psql -At -c "SELECT COALESCE(balance_sol,0) FROM wallets WHERE user_id = '${USER_ID}';")
echo "wallet_bal_before=${BAL_BEFORE}"

echo "== transfer ${SMOKE_AMOUNT} SOL oracle -> vault =="
SIG=$(sol transfer --from /oracle.json --keypair /oracle.json "$VAULT" "$SMOKE_AMOUNT" \
  --url "$RPC" --allow-unfunded-recipient --fee-payer /oracle.json | awk '/Signature:/{print $2; exit}')
echo "sig=${SIG}"
test -n "${SIG}"

echo "== wait for auto-credit (up to 90s) =="
ROW=""
for i in $(seq 1 18); do
  ROW=$(psql -At -c "SELECT status || '|' || destination_kind || '|' || amount::text FROM pending_transactions WHERE reference = '${SIG}' LIMIT 1;" || true)
  if [[ -n "${ROW}" ]]; then
    echo "FOUND pending_tx=${ROW}"
    break
  fi
  echo "wait ${i} ..."
  sleep 5
done

BAL_AFTER=$(psql -At -c "SELECT COALESCE(balance_sol,0) FROM wallets WHERE user_id = '${USER_ID}';")
echo "wallet_bal_after=${BAL_AFTER}"
echo "vault=$(sol balance "$VAULT" --url "$RPC")"

psql -c "SELECT type, status, destination_kind, amount, LEFT(reference,20) AS ref FROM pending_transactions WHERE reference = '${SIG}';"

if [[ -n "${EXISTING:-}" && "${EXISTING}" != "${USER_ID}" ]]; then
  echo "restoring prior link to ${EXISTING}"
  psql -c "UPDATE linked_wallets SET user_id = '${EXISTING}', updated_at = NOW() WHERE address = '${ORACLE_PUB}';"
fi

sudo docker logs proxyhubb-control-api-1 --since 3m 2>&1 | grep -iE "Auto-Deposit|native_deposit|vault|credited" | tail -30 || true

if [[ -n "${ROW}" ]]; then
  echo SMOKE_VAULT_OK
else
  echo SMOKE_VAULT_PENDING_OR_FAIL
  exit 2
fi
