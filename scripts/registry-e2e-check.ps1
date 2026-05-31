# After dashboard + provider-node setup, confirm Phase 1 registry linking in Postgres.
# Usage:
#   .\scripts\registry-e2e-check.ps1
#   .\scripts\registry-e2e-check.ps1 -ProfileId '<your-profile-uuid>'
#   .\scripts\registry-e2e-check.ps1 -NodeId '<provider_nodes.id>'

param(
    [string]$ProfileId = "",
    [string]$NodeId = ""
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path $PSScriptRoot -Parent
Set-Location $repoRoot

function Load-DotEnv([string]$path) {
    if (-not (Test-Path $path)) { return }
    Get-Content $path | ForEach-Object {
        if ($_ -match '^\s*([^#=]+)=(.*)$') {
            $k = $matches[1].Trim()
            $v = $matches[2].Trim().Trim('"').Trim("'")
            Set-Item -Path "env:$k" -Value $v
        }
    }
}

Load-DotEnv (Join-Path $repoRoot ".env")
$pgUser = if ($env:POSTGRES_USER) { $env:POSTGRES_USER } else { "proxyhubb" }
$pgDb = if ($env:POSTGRES_DB) { $env:POSTGRES_DB } else { "proxyhubb" }
$pgPass = $env:POSTGRES_PASSWORD

if (-not $pgPass) { Write-Error "POSTGRES_PASSWORD not set in .env" }

function Invoke-Psql([string]$sql) {
    (docker exec -e PGPASSWORD=$pgPass proxyhubb-postgres psql -U $pgUser -d $pgDb -tAc $sql 2>$null | Out-String).Trim()
}

Write-Host "=== Registry E2E DB check ===" -ForegroundColor Cyan

if (-not $ProfileId) {
    $ProfileId = Invoke-Psql "SELECT id FROM profiles WHERE role = 'provider' ORDER BY created_at DESC LIMIT 1;"
}
if (-not $ProfileId) {
    $ProfileId = Invoke-Psql "SELECT id FROM profiles ORDER BY created_at DESC LIMIT 1;"
}
if (-not $ProfileId) { Write-Error "No profiles row found. Log in and complete provider setup first." }

Write-Host "Profile ID: $ProfileId"
$expectedGateway = "node_$ProfileId"

if (-not $NodeId) {
    $NodeId = Invoke-Psql "SELECT id FROM provider_nodes WHERE user_id = '$ProfileId' ORDER BY created_at DESC LIMIT 1;"
}
if (-not $NodeId) {
    Write-Error "No provider_nodes row for this user. Register a node at http://localhost:3000/dashboard/provider/setup"
}
Write-Host "Provider node ID: $NodeId"

$row = Invoke-Psql "SELECT pn.gateway_node_id, pn.status, pn.last_seen_at::text, n.id::text, n.provider_node_id::text, n.is_healthy FROM provider_nodes pn LEFT JOIN nodes n ON n.provider_node_id = pn.id WHERE pn.id = '$NodeId';"
Write-Host "Row: $row"

$ok = $true
if ($row -notlike "*$expectedGateway*") {
    Write-Host "FAIL: provider_nodes.gateway_node_id should be $expectedGateway" -ForegroundColor Red
    $ok = $false
} else {
    Write-Host "OK: gateway_node_id matches $expectedGateway" -ForegroundColor Green
}

if ($row -notlike "*$NodeId*") {
    Write-Host "FAIL: nodes.provider_node_id should point to $NodeId" -ForegroundColor Red
    $ok = $false
} else {
    Write-Host "OK: nodes.provider_node_id linked" -ForegroundColor Green
}

if ($row -match 'online') {
    Write-Host "OK: provider_nodes status is online" -ForegroundColor Green
} else {
    Write-Host "WARN: node not online yet - run provider-node and wait ~2m for heartbeats" -ForegroundColor Yellow
}

if (-not $ok) { exit 1 }
Write-Host ""
Write-Host "Registry E2E link verified in database." -ForegroundColor Green
