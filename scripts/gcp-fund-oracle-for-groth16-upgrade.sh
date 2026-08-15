#!/usr/bin/env bash
# Fund oracle + cold upgrade authority from treasury hot (devnet only).
# Run ON proxyhubb-testnet. Does not perform the program upgrade.
set -euo pipefail
RPC="${RPC:-https://api.devnet.solana.com}"
ORACLE_PUB="${ORACLE_PUB:-8P4uuapgGfW8L7VvdQJ9W7RpJqpfyifhPx9UQaHnKii2}"
UPGRADE_PUB="${UPGRADE_PUB:-6thzwmrfijDA5eukKzMAbQnL86RqdxiLx2maM94bRJcR}"
HOT_KP="${HOT_KP:-/opt/proxyhubb/secrets/treasury-hot-keypair.json}"
NEED_ORACLE="${NEED_ORACLE:-8.5}"
NEED_UPGRADE="${NEED_UPGRADE:-0.5}"

sol() {
  sudo docker run --rm --network host \
    -v "$HOT_KP:/hot.json:ro" \
    --entrypoint solana \
    solanalabs/solana:v1.18.26 \
    "$@"
}

bal() { sol balance "$1" --url "$RPC" | awk '{print $1}'; }

echo "oracle=$(bal "$ORACLE_PUB") upgrade=$(bal "$UPGRADE_PUB") hot=$(bal "$(sol --keypair /hot.json address | awk '{print $1}')")"

oracle_bal=$(bal "$ORACLE_PUB")
xfer_o=$(python3 -c "print(max(0.0, float('$NEED_ORACLE')-float('$oracle_bal')))")
if python3 -c "import sys; sys.exit(0 if float(sys.argv[1])>0.01 else 1)" "$xfer_o"; then
  echo "transfer $xfer_o SOL hot -> oracle"
  sol transfer --from /hot.json --keypair /hot.json "$ORACLE_PUB" "$xfer_o" \
    --url "$RPC" --allow-unfunded-recipient --fee-payer /hot.json
fi

upgrade_bal=$(bal "$UPGRADE_PUB")
xfer_u=$(python3 -c "print(max(0.0, float('$NEED_UPGRADE')-float('$upgrade_bal')))")
if python3 -c "import sys; sys.exit(0 if float(sys.argv[1])>0.01 else 1)" "$xfer_u"; then
  echo "transfer $xfer_u SOL hot -> upgrade"
  sol transfer --from /hot.json --keypair /hot.json "$UPGRADE_PUB" "$xfer_u" \
    --url "$RPC" --allow-unfunded-recipient --fee-payer /hot.json
fi

echo "AFTER oracle=$(bal "$ORACLE_PUB") upgrade=$(bal "$UPGRADE_PUB")"
echo FUND_DONE
