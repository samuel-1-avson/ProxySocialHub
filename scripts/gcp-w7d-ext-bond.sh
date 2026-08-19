#!/usr/bin/env bash
# Distinct gateway-bond for the W7.D operator. Run on the foreign VPS.
# Never programs/session. Never mainnet. Leave PROXYHUB_GATEWAY_SLASH_* unset.
# SOLANA_ORACLE_KEYPAIR here is THIS operator's Solana key, not ProxyHubb's.
set -euo pipefail
BIN="${W8_BOND_BIN:-/tmp/w8-gateway-bond}"
if [[ "$(id -u)" -eq 0 ]]; then
  DIR="${W7D_DIR:-/opt/proxyhubb-w7d}"
else
  DIR="${W7D_DIR:-$HOME/proxyhubb-w7d}"
fi
# Windows PowerShell $HOME leak
if [[ "$DIR" == *":"* ]]; then
  DIR="$HOME/proxyhubb-w7d"
fi
PLATFORM_ORG="${PROXYHUB_PLATFORM_ORG_ID:-gen-lang-client-0022105784}"
unset PROXYHUB_GATEWAY_SLASH_AUTO PROXYHUB_GATEWAY_SLASH_CONFIRM || true
export PROXYHUB_GATEWAY_BOND_PROGRAM_ID="${PROXYHUB_GATEWAY_BOND_PROGRAM_ID:-7nvrNVaNWcG4DzcPygEyXoVC3k19ePUAncGE25dUEyi5}"
export SOLANA_RPC_URL="${SOLANA_RPC_URL:-https://api.devnet.solana.com}"
export SOLANA_CLUSTER=devnet

chmod +x "$BIN"
mkdir -p "$DIR"
chmod 700 "$DIR"
cd "$DIR"
umask 077

PROJECT=$(curl -fsS -H "Metadata-Flavor: Google" \
  http://metadata.google.internal/computeMetadata/v1/project/project-id)
[[ "$PROJECT" != "$PLATFORM_ORG" ]] || {
  echo "FAIL: this VM is the platform project"
  exit 2
}

KP="$DIR/operator-solana.json"
export SOLANA_ORACLE_KEYPAIR="$KP"
if [[ ! -f "$KP" ]]; then
  "$BIN" keygen > "$KP"
  chmod 600 "$KP"
  echo "solana_keygen=created"
else
  echo "solana_keygen=reused"
fi
chmod 600 "$KP"
PUB=$("$BIN" pubkey)
echo "operator_solana=$PUB"

echo "$PUB" > "$DIR/operator-solana.pubkey"
chmod 644 "$DIR/operator-solana.pubkey"

if [[ "${W7D_BOND_FUND_ONLY:-}" == "1" ]]; then
  echo "W7D_BOND_WAIT_FUND operator_solana=$PUB"
  exit 0
fi

CONFIRM_W12B_BOND=1 "$BIN" bond
"$BIN" pda "$PUB"
"$BIN" fetch "$PUB"
echo "W7D_EXT_BOND_OK operator_solana=$PUB"
