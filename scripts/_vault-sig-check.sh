#!/usr/bin/env bash
set -euo pipefail
VAULT=8LZji2G9nn7ywoLwopgcREpm5xQHpvRJY1az1R9hHRzm
RPC=https://api.devnet.solana.com
USER_ID=b77e84c9-0e85-4f23-afc0-581cd561c216

echo "== vault signatures =="
sudo docker run --rm --network host --entrypoint solana solanalabs/solana:v1.18.26 \
  transaction-history "$VAULT" --url "$RPC" --limit 10

echo "== wallet balance =="
cd /opt/proxyhubb
sudo docker compose -f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml \
  exec -T postgres psql -U proxyhubb -d proxyhubb -c \
  "SELECT balance_sol FROM wallets WHERE user_id = '${USER_ID}';"

echo "== pending vault/oracle txs =="
sudo docker compose -f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml \
  exec -T postgres psql -U proxyhubb -d proxyhubb -c \
  "SELECT type, status, destination_kind, amount, LEFT(reference,24) AS ref, created_at FROM pending_transactions WHERE destination_kind = 'vault' OR reference LIKE '49Vgc%' OR reference LIKE '3LjH%' ORDER BY created_at DESC LIMIT 10;"

echo "== explorer txs to vault =="
sudo docker compose -f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml \
  exec -T postgres psql -U proxyhubb -d proxyhubb -c \
  "SELECT tx_type, amount, LEFT(tx_hash,24) AS h, from_address, to_address FROM explorer_transactions WHERE to_address = '${VAULT}' ORDER BY timestamp DESC LIMIT 10;" 2>/dev/null || echo 'no explorer table'
