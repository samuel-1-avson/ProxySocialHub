#!/bin/bash
# Run on proxyhubb-testnet: derive GATEWAY_USAGE_PUBLIC_KEY from local PROVIDER_PRIVATE_KEY
# and point SOLANA_PROGRAM_ID at the payout-binding program id.
set -euo pipefail
cd /opt/proxyhubb

SEED=$(grep -E "^PROVIDER_PRIVATE_KEY=[0-9a-fA-F]{64}$" .env | head -1 | cut -d= -f2 || true)
if [ -z "${SEED}" ]; then
  echo "NO_SERVER_SEED"
  exit 1
fi

PUB=$(SEED="$SEED" node <<'NODE'
const crypto = require("crypto");
const seed = Buffer.from(process.env.SEED, "hex");
if (seed.length !== 32) process.exit(2);
const pkcs8 = Buffer.concat([
  Buffer.from("302e020100300506032b657004220420", "hex"),
  seed,
]);
const priv = crypto.createPrivateKey({ key: pkcs8, format: "der", type: "pkcs8" });
const pub = crypto.createPublicKey(priv);
const spki = pub.export({ type: "spki", format: "der" });
process.stdout.write(spki.subarray(spki.length - 32).toString("hex"));
NODE
)

echo "derived_pub_prefix=${PUB:0:8} len=${#PUB}"

if grep -q "^GATEWAY_USAGE_PUBLIC_KEY=" .env; then
  sudo sed -i -E "s|^GATEWAY_USAGE_PUBLIC_KEY=.*|GATEWAY_USAGE_PUBLIC_KEY=${PUB}|" .env
  echo "UPDATED_EXISTING_PUBKEY_LINE"
else
  {
    echo ""
    echo "# Hotfix BE-01 $(date -u +%Y-%m-%d)"
    echo "GATEWAY_USAGE_PUBLIC_KEY=${PUB}"
  } | sudo tee -a .env >/dev/null
  echo "APPENDED_PUBKEY_LINE"
fi

sudo sed -i -E "s|^SOLANA_PROGRAM_ID=.*|SOLANA_PROGRAM_ID=AZGhGfvsiGJQ5S91nkdhGi9qvSNKv3sBZyVJ63KQLfvu|" .env || true
if ! grep -q "^SOLANA_PROGRAM_ID=" .env; then
  echo "SOLANA_PROGRAM_ID=AZGhGfvsiGJQ5S91nkdhGi9qvSNKv3sBZyVJ63KQLfvu" | sudo tee -a .env >/dev/null
fi
echo "SET_SOLANA_PROGRAM_ID=AZGhGfvsiGJQ5S91nkdhGi9qvSNKv3sBZyVJ63KQLfvu"

grep -E "^(GATEWAY_USAGE_PUBLIC_KEY|SOLANA_PROGRAM_ID|PROVIDER_PRIVATE_KEY)=" .env \
  | sed -E "s/=(.{0,8}).*/=\1…/"
