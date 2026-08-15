#!/usr/bin/env bash
# Wave 12.B — permissionless join *runbook* proof (no Postgres seed).
# Does not send a bond tx (no operator SOL key). Does not claim multi_org.
# Host-B is still same_org. Not DePIN.
#
#   ./scripts/w12b-permissionless-join.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
API_DIR="$ROOT/services/control-api"
WORKDIR="${W12B_WORKDIR:-$(mktemp -d)}"
cleanup() { rm -rf "$WORKDIR"; }
trap cleanup EXIT

echo "=== W12.B permissionless join runbook (no Postgres) ==="

echo "--- keygen ---"
(cd "$API_DIR" && go run ./cmd/w7d-operator-join keygen) > "$WORKDIR/key.json"

echo "--- sign distinct org_id (not platform) ---"
(cd "$API_DIR" && go run ./cmd/w7d-operator-join sign-from-keygen) < "$WORKDIR/key.json" > "$WORKDIR/join.json"
(cd "$API_DIR" && go run ./cmd/w7d-operator-join extract-bundle) < "$WORKDIR/join.json" > "$WORKDIR/bundle.json"
echo "postgres_seed=false"

echo "--- verify bundle (no control-api, no Postgres) ---"
(cd "$API_DIR" && go run ./cmd/w7b-manifest-bundle verify "$WORKDIR/bundle.json")

echo "--- bond is a separate operator tx ---"
echo "CONFIRM_W12B_BOND=1 go run ./cmd/w8-gateway-bond bond"
echo "W12B_BOND_SKIPPED (no operator SOL keypair in this script)"

if [[ "${CONFIRM_W7D_EXTERNAL_VPS:-}" == "1" ]]; then
  echo "FAIL: this runbook script is not the live VPS claim"
  exit 2
fi

echo "W12B_JOIN_RUNBOOK_OK"
echo "not multi_org; not shop merchandising; not DePIN; programs/session undeployed"
