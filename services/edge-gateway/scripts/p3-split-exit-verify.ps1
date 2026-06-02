# P3b exit verify — unit tests for split config + routing helpers.
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

Write-Host "== cargo test (config + internal_forward) =="
cargo test owner_forward -- --nocapture
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host ""
Write-Host "P3b exit-verify (unit) passed. Run .\scripts\p3-split-smoke.ps1 with stack up for integration smoke."
