# P2 exit verification (unit tests; no Docker required).
$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")

Write-Host "== P2 unit tests (admission, session limits, circuit config) =="
cargo test --bin edge-gateway session_within_time_limit
cargo test --bin edge-gateway writes_http_503_and_closes
cargo test --bin edge-gateway circuit_config_from_env

Write-Host ""
Write-Host "P2 unit verification complete."
Write-Host "Integration (Docker): .\scripts\p2-compose-verify.ps1"
