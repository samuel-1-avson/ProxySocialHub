#!/bin/bash
set -euo pipefail

ORACLE=8P4uuapgGfW8L7VvdQJ9W7RpJqpfyifhPx9UQaHnKii2
TREASURY=8g7WUuPosAg82Uu7iGYCx6HBnoTBFb4QuyiJCEGzktU4
RPC=https://api.devnet.solana.com

balance() {
  local addr="$1"
  curl -sS "$RPC" -H 'Content-Type: application/json' \
    -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"getBalance\",\"params\":[\"$addr\"]}" \
    | python3 -c 'import sys,json; v=json.load(sys.stdin)["result"]["value"]; print(f"{v} lamports ({v/1e9:.6f} SOL)")'
}

echo "BEFORE oracle:   $(balance "$ORACLE")"
echo "BEFORE treasury: $(balance "$TREASURY")"

# Request 2 SOL airdrop to oracle (devnet faucet)
SIG=$(curl -sS "$RPC" -H 'Content-Type: application/json' \
  -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"requestAirdrop\",\"params\":[\"$ORACLE\",2000000000]}" \
  | python3 -c 'import sys,json; r=json.load(sys.stdin); print(r.get("result") or ""); print(r.get("error") or "", file=sys.stderr)')
echo "airdrop sig: $SIG"
sleep 8
echo "AFTER oracle:   $(balance "$ORACLE")"
echo "AFTER treasury: $(balance "$TREASURY")"
