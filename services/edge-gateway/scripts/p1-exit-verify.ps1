# P1 exit verification (Windows / PowerShell).
# Runs parity tests, compiles benches, and criterion smoke (--test).
$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")

Write-Host "== cargo test: port parity + lean features =="
cargo test --bin edge-gateway deploy_manifests_use_canonical_ports
cargo test --bin edge-gateway default_features_are_lean
cargo test --bin edge-gateway canonical_port_defaults_match_ecosystem

Write-Host "== cargo check: binary + benches =="
cargo check --bin edge-gateway
cargo check --benches

Write-Host "== criterion smoke (--test) =="
cargo bench --bench registry_bench -- --test
cargo bench --bench hotpath_bench -- --test

Write-Host ""
Write-Host "P1 verification complete."
Write-Host "Full benchmarks: ./scripts/p1-bench.sh (bash) or cargo bench --bench hotpath_bench"
Write-Host "Flamegraph (Linux): ./scripts/p1-flamegraph.sh"
Write-Host "Load smoke (gateway up): ./scripts/p1-load-smoke.sh"
