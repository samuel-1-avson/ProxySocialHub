#!/usr/bin/env bash
# Generate a dedicated treasury hot keypair for BC-08 custody split.
# Does NOT print private key material — only the pubkey and output path.
set -euo pipefail

OUT="${1:-treasury-hot-keypair.json}"
if [[ -e "$OUT" ]]; then
  echo "Refusing to overwrite existing $OUT" >&2
  exit 1
fi

if ! command -v solana-keygen >/dev/null 2>&1; then
  echo "solana-keygen not found in PATH" >&2
  exit 1
fi

solana-keygen new --no-bip39-passphrase --silent -o "$OUT"
chmod 600 "$OUT" 2>/dev/null || true
PUB=$(solana-keygen pubkey "$OUT")
echo "Wrote $OUT"
echo "SOLANA_TREASURY_HOT_ADDRESS=$PUB"
echo "SOLANA_TREASURY_HOT_KEYPAIR=$OUT"
echo "Next: fund this address for withdrawals; keep oracle key for signing only."
echo "See docs/custody-split.md"
