#!/usr/bin/env bash
# P4 transport smoke — unit tests + build (no live provider required)
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
repo="$(cd "$root/../.." && pwd)"

echo "edge-gateway P4 verify..."
cd "$root"
./scripts/p4-transport-exit-verify.sh

echo "provider-node build + tests..."
cd "$repo/provider-node"
cargo test --quiet
cargo build --quiet

echo "P4 transport smoke: OK (set YAMUX_CONNS_PER_NODE=2 on gateway + provider for live mux test)"
