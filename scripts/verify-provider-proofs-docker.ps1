# Smoke-test provider-signed heartbeats on the Docker stack.
#
# Prerequisites:
#   docker compose up -d
#   .\scripts\bootstrap-provider-docker.ps1 -StartProvider
#   Wait ~2 minutes for heartbeats (provider-node default ~120s interval; first may be sooner)

param(
    [string]$ApiBaseUrl = "http://localhost:18080",
    [int]$WaitSeconds = 0,
    [string]$PostgresContainer = "proxyhubb-postgres-1"
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

function Load-DotEnv([string]$path) {
    if (-not (Test-Path $path)) { return }
    Get-Content $path | ForEach-Object {
        if ($_ -match "^\s*([^#=]+)=(.*)$") {
            $k = $matches[1].Trim()
            $v = $matches[2].Trim().Trim('"').Trim("'")
            Set-Item -Path "env:$k" -Value $v
        }
    }
}

Load-DotEnv (Join-Path $repoRoot ".env")
$pgUser = if ($env:POSTGRES_USER) { $env:POSTGRES_USER } else { "proxyhubb" }
$pgDb = if ($env:POSTGRES_DB) { $env:POSTGRES_DB } else { "proxyhubb" }

if ($WaitSeconds -gt 0) {
    Write-Host "Waiting ${WaitSeconds}s for heartbeats..." -ForegroundColor DarkGray
    Start-Sleep -Seconds $WaitSeconds
}

$running = docker ps --filter "name=proxyhubb-provider-node" --format "{{.Names}}" 2>$null
if (-not $running) {
    Write-Host "[WARN] proxyhubb-provider-node is not running." -ForegroundColor Yellow
    Write-Host "  .\scripts\bootstrap-provider-docker.ps1 -StartProvider"
}

Write-Host "=== Verify provider proofs (Docker) ===" -ForegroundColor Cyan

$row = docker exec -e PGPASSWORD=$env:POSTGRES_PASSWORD $PostgresContainer `
    psql -U $pgUser -d $pgDb -tAc `
    "SELECT id::text, COALESCE(latest_heartbeat_verified::text,''), COALESCE(latest_heartbeat_signer,''), COALESCE(latest_heartbeat_verification_error,''), COALESCE(hotkey,'') FROM provider_nodes ORDER BY last_seen_at DESC NULLS LAST LIMIT 1;" 2>&1

if ($LASTEXITCODE -ne 0) {
    throw "psql failed: $row"
}

$parts = ($row.Trim() -split '\|')
if ($parts.Count -lt 5 -or [string]::IsNullOrWhiteSpace($parts[0])) {
    throw "No provider_nodes rows found. Register a provider node first."
}

$nodeId = $parts[0].Trim()
$verified = $parts[1].Trim()
$signer = $parts[2].Trim()
$verr = $parts[3].Trim()
$hotkey = $parts[4].Trim()

Write-Host "Node:     $nodeId"
Write-Host "Verified: $verified"
Write-Host "Signer:   $(if ($signer) { $signer } else { '(empty)' })"
Write-Host "Error:    $(if ($verr) { $verr } else { '(none)' })"
Write-Host "Hotkey:   $(if ($hotkey) { $hotkey } else { '(empty)' })"

if ($verified -ne "t" -and $verified -ne "true") {
    Write-Host ""
    Write-Host "[FAIL] latest_heartbeat_verified is not true." -ForegroundColor Red
    Write-Host "Check: docker logs proxyhubb-provider-node"
    Write-Host "Ensure config/docker/provider.compose.env exists (bootstrap-provider-docker.ps1)."
    exit 1
}

if ($hotkey -and $signer -and $hotkey -ne $signer) {
    Write-Host "[WARN] hotkey does not match heartbeat signer (enforce mode may reject later)." -ForegroundColor Yellow
}

try {
    $geo = Invoke-RestMethod "$ApiBaseUrl/v1/marketplace/geo" -TimeoutSec 15
    $pin = $geo.pins | Where-Object { $_.node_id -eq $nodeId -or $_.provider_node_id -eq $nodeId } | Select-Object -First 1
    if ($pin) {
        Write-Host ""
        Write-Host "Geo pin heartbeat_verified: $($pin.heartbeat_verified)" -ForegroundColor DarkGray
    }
}
catch {
    Write-Host "[INFO] marketplace/geo check skipped: $($_.Exception.Message)" -ForegroundColor DarkGray
}

Write-Host ""
Write-Host "[OK] Provider heartbeat proofs are verified in Postgres." -ForegroundColor Green
exit 0
