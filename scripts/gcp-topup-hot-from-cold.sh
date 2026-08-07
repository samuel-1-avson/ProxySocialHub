#!/usr/bin/env bash
# Top up hot treasury from cold so withdrawals can clear.
set -euo pipefail
HOT=FeunrDoACmUi4fFQtiw3fPHAqB3N9UrAsj8ZzqSsGPa3
COLD_KP=/opt/proxyhubb/secrets/treasury-cold-keypair.json
RPC=https://api.devnet.solana.com
AMOUNT="${1:-6}"

sol() {
  sudo docker run --rm --network host \
    -v "$COLD_KP:/cold.json:ro" \
    --entrypoint solana solanalabs/solana:v1.18.26 "$@"
}

COLD_PUB=$(sudo docker run --rm -v "$COLD_KP:/c.json:ro" --entrypoint solana-keygen solanalabs/solana:v1.18.26 pubkey /c.json)
echo "before hot=$(sol balance $HOT --url $RPC) cold=$(sol balance $COLD_PUB --url $RPC)"
sol transfer --from /cold.json --keypair /cold.json "$HOT" "$AMOUNT" \
  --url "$RPC" --allow-unfunded-recipient --fee-payer /cold.json
echo "after hot=$(sol balance $HOT --url $RPC) cold=$(sol balance $COLD_PUB --url $RPC)"
curl -fsS http://127.0.0.1:8080/v1/treasury/public | head -c 800; echo
echo HOT_TOPUP_OK
