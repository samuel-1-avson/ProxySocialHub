# P4 provider transport — unit tests + transport bench smoke
$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")

Write-Host "P4: cargo test (provider_transport, yamux_mux)..."
cargo test yamux_mux 2>&1
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
cargo test provider_transport 2>&1
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "P4: transport_bench --test..."
cargo bench --bench transport_bench -- --test 2>&1
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "P4 transport exit verify: OK"
