# P4 transport smoke — unit tests + build (no live provider required)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$repo = Split-Path -Parent $root

Write-Host "edge-gateway P4 verify..."
Set-Location $root
& "$PSScriptRoot\p4-transport-exit-verify.ps1"

Write-Host "provider-node build + tests..."
Set-Location (Join-Path $repo "provider-node")
cargo test --quiet 2>&1
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
cargo build --quiet 2>&1
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "P4 transport smoke: OK (set YAMUX_CONNS_PER_NODE=2 on gateway + provider for live mux test)"
