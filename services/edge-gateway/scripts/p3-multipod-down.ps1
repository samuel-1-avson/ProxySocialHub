# Stop P3 multipod stack and optionally remove legacy fixed-name containers.
param([switch]$RemoveLegacy)

$ErrorActionPreference = "Stop"
. "$PSScriptRoot\p3-compose.ps1"

Write-Host "== docker compose -p $script:P3ComposeProject down =="
Invoke-P3Compose @("down", "--remove-orphans")

if ($RemoveLegacy) {
    Write-Host "Removing legacy fixed-name P3 containers..."
    Remove-LegacyP3Containers
}

Write-Host "P3 stack stopped."
