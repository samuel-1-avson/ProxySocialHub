#!/bin/bash
set -euo pipefail
ORACLE=8P4uuapgGfW8L7VvdQJ9W7RpJqpfyifhPx9UQaHnKii2
RPC=https://api.devnet.solana.com

balance() {
  curl -sS "$RPC" -H 'Content-Type: application/json' \
    -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"getBalance\",\"params\":[\"$1\"]}" \
    | python3 -c 'import sys,json; v=json.load(sys.stdin).get("result",{}).get("value",0); print(f"{v/1e9:.6f}")'
}

echo "oracle before: $(balance "$ORACLE") SOL"

for AMT in 1000000000 500000000 100000000; do
  echo "requestAirdrop $AMT"
  RESP=$(curl -sS "$RPC" -H 'Content-Type: application/json' \
    -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"requestAirdrop\",\"params\":[\"$ORACLE\",$AMT]}")
  echo "$RESP"
  echo "$RESP" | python3 -c 'import sys,json; r=json.load(sys.stdin); raise SystemExit(0 if r.get("result") else 1)' && break
  sleep 3
done

# also try solana CLI if present
if command -v solana >/dev/null 2>&1; then
  solana airdrop 1 "$ORACLE" --url devnet || true
fi

sleep 6
echo "oracle after: $(balance "$ORACLE") SOL"
