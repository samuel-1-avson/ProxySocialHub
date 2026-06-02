# Start P3b split stack (ingress edge-a/b + tunnel-a/b).
param([switch]$Build)

$ErrorActionPreference = "Stop"
. "$PSScriptRoot\p3-split-compose.ps1"

$upArgs = @("up", "-d")
if ($Build) { $upArgs += "--build" }

Write-Host "== docker compose -p $script:P3ComposeProject (split) up =="
Invoke-P3Compose @upArgs

Write-Host ""
Write-Host "P3b split stack up."
Write-Host "  Ingress:  :28100 (edge-a), :28101 (edge-b)"
Write-Host "  Tunnel:   :28110/:23228 (tunnel-a), :28111/:23229 (tunnel-b)"
Write-Host "  Redis:    :26479"
Write-Host "Verify: .\scripts\p3-split-smoke.ps1"
