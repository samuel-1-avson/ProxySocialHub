#!/usr/bin/env bash
set -euo pipefail
RPC=https://api.devnet.solana.com
SIG=49Vgc9uMqhecm4ZyMB3Tcy2HGnTDPJwVKCXkWUHREbbJpJCSownuVZSieRqMTEm9Ch7ByCsdWbEssn1kwVYDdwav
curl -sS "$RPC" -H 'content-type: application/json' -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"getTransaction\",\"params\":[\"$SIG\",{\"encoding\":\"json\",\"maxSupportedTransactionVersion\":0}]}" | head -c 4000
echo
echo '---'
# wait one more poll cycle and recheck
sleep 35
cd /opt/proxyhubb
sudo docker compose -f docker-compose.yml -f docker-compose.testnet.yml -f docker-compose.gcp-testnet.yml \
  exec -T postgres psql -U proxyhubb -d proxyhubb -At -c \
  "SELECT status||'|'||destination_kind||'|'||amount::text FROM pending_transactions WHERE reference = '$SIG';" || true
sudo docker logs proxyhubb-control-api-1 --since 5m 2>&1 | grep -F '49Vgc9u' | tail -10 || echo 'still no sig in logs'
sudo docker logs proxyhubb-control-api-1 --since 5m 2>&1 | grep -F 'native_deposit' | tail -10 || true
