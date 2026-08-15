#!/bin/bash
set -euo pipefail
PDA=6XftL4uPuQ7MRxiLzQiDBsEywxEfhUjPiqqHTXFQgFpr
RPC=https://api.devnet.solana.com
echo "=== getAccountInfo $PDA ==="
# retry a few times on 429
for i in 1 2 3 4 5; do
  RESP=$(curl -sS -m 20 -X POST "$RPC" -H 'Content-Type: application/json' \
    --data-binary "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"getAccountInfo\",\"params\":[\"$PDA\",{\"encoding\":\"base64\"}]}" || true)
  echo "$RESP" | head -c 800
  echo
  echo "$RESP" | grep -q '429' || break
  sleep 2
done
echo "=== control-api recent pay/solana ==="
sudo docker logs --since=20m proxyhubb-control-api-1 2>&1 | grep -E 'pay/solana|Escrow initialized|SessionActivator|6Xft' | tail -20