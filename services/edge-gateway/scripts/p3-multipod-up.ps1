# Start P3 multipod stack (project edge-p3, no fixed container_name conflicts).
param(
    [switch]$Build,
    [switch]$RemoveLegacy
)

$ErrorActionPreference = "Stop"
. "$PSScriptRoot\p3-compose.ps1"

if ($RemoveLegacy) {
    Write-Host "Removing legacy fixed-name P3 containers (if any)..."
    Remove-LegacyP3Containers
}

$upArgs = @("up", "-d")
if ($Build) { $upArgs += "--build" }

Write-Host "== docker compose -p $script:P3ComposeProject up =="
Invoke-P3Compose @upArgs

Write-Host ""
Write-Host "P3 stack up. Buyer: :28090 (edge-a), :28091 (edge-b). Redis host: :26379"
Write-Host "Verify: .\scripts\p3-multipod-smoke.ps1"
