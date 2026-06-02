# P3 exit verification (unit tests; Docker scripts optional).
$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")

Write-Host "== P3 unit tests =="
cargo test --bin edge-gateway ownership_key
cargo test --bin edge-gateway internal_forward::tests::parse_peer_url
cargo test --bin edge-gateway writes_http_503_and_closes

Write-Host ""
Write-Host "P3 unit verification complete."
Write-Host "Integration: docker compose -f docker-compose.p3-multipod.yml up -d --build"
Write-Host "  .\scripts\p3-multipod-smoke.ps1"
Write-Host "  .\scripts\p3-scale-benchmark.ps1"
Write-Host "  .\scripts\p3-pod-drain.ps1"
