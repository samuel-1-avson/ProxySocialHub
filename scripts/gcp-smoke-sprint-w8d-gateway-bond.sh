#!/usr/bin/env bash
# Wave 8.D — localnet soak for programs/gateway-bond.
# Does not deploy programs/session. Does not claim GCP live slash.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CLUSTER="${SOLANA_CLUSTER:-localnet}"

echo "=== W8.D gateway-bond localnet soak ==="

case "$CLUSTER" in
  mainnet|mainnet-beta)
    echo "REFUSE: never deploy gateway-bond to mainnet"
    exit 2
    ;;
esac

if [[ "${CONFIRM_W8_DEPLOY:-}" == "1" && "$CLUSTER" != "localnet" ]]; then
  echo "REFUSE: this script is the localnet soak. Cluster deploy is a separate ops step and must not target session program 8TP21…"
  exit 2
fi

cargo test --manifest-path "$ROOT/programs/gateway-bond/Cargo.toml" --test w8d_soak -- --nocapture
echo "W8D_BOND_SLASH_OK"
echo "live_economic_slash remains false on GCP; programs/session stays undeployed"
