#!/usr/bin/env bash
set -euo pipefail
cd /opt/proxyhubb
COMPOSE=(sudo docker compose -f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml)
ORACLE_KP=/opt/proxyhubb/infra/oracle-keypair.json
VAULT=8LZji2G9nn7ywoLwopgcREpm5xQHpvRJY1az1R9hHRzm
RPC=https://api.devnet.solana.com
USER_ID=b77e84c9-0e85-4f23-afc0-581cd561c216

echo '== recent vault credits =='
"${COMPOSE[@]}" exec -T postgres psql -U proxyhubb -d proxyhubb -c \
  "SELECT status, destination_kind, amount, LEFT(reference,40), created_at FROM pending_transactions WHERE destination_kind='vault' OR created_at > NOW() - interval '2 hours' AND type='crypto_deposit' ORDER BY created_at DESC LIMIT 10;"

echo '== fresh 0.01 deposit =='
BAL_BEFORE=$("${COMPOSE[@]}" exec -T postgres psql -U proxyhubb -d proxyhubb -At -c "SELECT COALESCE(balance_sol,0) FROM wallets WHERE user_id='$USER_ID';")
echo "bal_before=$BAL_BEFORE vault_before=$(sudo docker run --rm --network host --entrypoint solana solanalabs/solana:v1.18.26 balance $VAULT --url $RPC)"
SIG=$(sudo docker run --rm --network host -v "$ORACLE_KP:/oracle.json:ro" --entrypoint solana solanalabs/solana:v1.18.26 \
  transfer --from /oracle.json --keypair /oracle.json "$VAULT" 0.01 \
  --url "$RPC" --allow-unfunded-recipient --fee-payer /oracle.json | awk '/Signature:/{print $2; exit}')
echo "sig=$SIG"
for i in $(seq 1 20); do
  ROW=$("${COMPOSE[@]}" exec -T postgres psql -U proxyhubb -d proxyhubb -At -c \
    "SELECT status||'|'||destination_kind||'|'||amount::text FROM pending_transactions WHERE reference='$SIG' LIMIT 1;" || true)
  if [[ -n "$ROW" ]]; then echo "FOUND $ROW"; break; fi
  echo "wait $i"; sleep 5
done
BAL_AFTER=$("${COMPOSE[@]}" exec -T postgres psql -U proxyhubb -d proxyhubb -At -c "SELECT COALESCE(balance_sol,0) FROM wallets WHERE user_id='$USER_ID';")
echo "bal_after=$BAL_AFTER"
sudo docker logs proxyhubb-control-api-1 --since 3m 2>&1 | grep -iE 'native_deposit|Auto-Deposit|GetTransaction failed' | tail -20 || true
if [[ -n "${ROW:-}" ]]; then echo FRESH_SMOKE_OK; else echo FRESH_SMOKE_MISS; exit 2; fi
