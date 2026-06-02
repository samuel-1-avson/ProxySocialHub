#!/usr/bin/env bash
# P4 provider transport — unit tests + transport bench smoke
set -euo pipefail
cd "$(dirname "$0")/.."

echo "P4: cargo test (provider_transport, yamux_mux)..."
cargo test yamux_mux
cargo test provider_transport

echo "P4: transport_bench --test..."
cargo bench --bench transport_bench -- --test

echo "P4 transport exit verify: OK"
