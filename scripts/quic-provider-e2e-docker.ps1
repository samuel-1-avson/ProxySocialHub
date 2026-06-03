# Live E2E: edge-gateway PROVIDER_TRANSPORT=quic + provider-node QUIC dialer (Docker).
# Prereq: main stack healthy (postgres, redis, control-api). Run compose-heal-postgres-password.ps1 if migrate fails.
#
# Usage (from repo root):
#   .\scripts\quic-provider-e2e-docker.ps1
#   .\scripts\quic-provider-e2e-docker.ps1 -SkipHeal

param(
    [switch]$SkipHeal
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location $RepoRoot

function Import-DotEnv([string]$Path) {
    if (-not (Test-Path $Path)) { return }
    Get-Content $Path | ForEach-Object {
        $line = $_.Trim()
        if ($line -eq "" -or $line.StartsWith("#")) { return }
        if ($line -match '^\s*([^#=]+)=(.*)$') {
            $name = $matches[1].Trim()
            $value = $matches[2].Trim().Trim('"').Trim("'")
            [Environment]::SetEnvironmentVariable($name, $value, "Process")
        }
    }
}

Import-DotEnv (Join-Path $RepoRoot ".env")

if (-not $SkipHeal) {
    Write-Host "Ensuring Postgres password matches compose..."
    & (Join-Path $RepoRoot "scripts\compose-heal-postgres-password.ps1") -RunMigrate
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

Write-Host "Starting core stack (postgres, redis, nats, control-api)..."
docker compose up -d postgres redis nats control-api
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "Waiting for control-api healthy..."
$deadline = (Get-Date).AddMinutes(3)
do {
    Start-Sleep -Seconds 3
    $status = docker inspect -f "{{.State.Health.Status}}" proxyhubb-control-api-1 2>$null
    if ($status -eq "healthy") { break }
    if ((Get-Date) -gt $deadline) {
        throw "control-api not healthy after 3m (status=$status)"
    }
} while ($true)

$composeFiles = @(
    "-f", "docker-compose.yml",
    "-f", "docker-compose.provider.yml",
    "--profile", "provider"
)

Write-Host "Building and starting QUIC edge-gateway + provider-node..."
docker compose @composeFiles build edge-gateway provider-node
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

docker compose @composeFiles up -d edge-gateway provider-node
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "Waiting for provider QUIC handshake (up to 90s)..."
$ok = $false
for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Seconds 3
    $gwLog = docker logs proxyhubb-edge-gateway-1 2>&1 | Out-String
    $pnLog = docker logs proxyhubb-provider-node 2>&1 | Out-String
    if ($gwLog -match "Provider QUIC tunnel listening" -and $pnLog -match "Handshake complete, tunnel established") {
        $ok = $true
        break
    }
    if ($pnLog -match "Auth failed|provider QUIC|failed") {
        Write-Host "Provider log excerpt:" -ForegroundColor Yellow
        docker logs proxyhubb-provider-node 2>&1 | Select-Object -Last 15
    }
}

Write-Host ""
Write-Host "=== Gateway (QUIC) ===" -ForegroundColor Cyan
docker logs proxyhubb-edge-gateway-1 2>&1 | Select-String -Pattern "QUIC|Provider|transport" | Select-Object -Last 8

Write-Host ""
Write-Host "=== Provider-node ===" -ForegroundColor Cyan
docker logs proxyhubb-provider-node 2>&1 | Select-String -Pattern "QUIC|Handshake|yamux|transport|error" | Select-Object -Last 12

if (-not $ok) {
    Write-Error "QUIC E2E did not complete: missing gateway QUIC listen or provider handshake success in logs."
}

$metricsUrl = "http://127.0.0.1:${env:EDGE_GATEWAY_METRICS_PORT}/metrics"
if ([string]::IsNullOrWhiteSpace($env:EDGE_GATEWAY_METRICS_PORT)) {
    $metricsUrl = "http://127.0.0.1:9092/metrics"
}
try {
    $body = (Invoke-WebRequest -Uri $metricsUrl -UseBasicParsing -TimeoutSec 10).Content
    if ($body -match "edge_gateway_healthy_providers\s+(\d+)") {
        $hp = $Matches[1]
        Write-Host ""
        Write-Host "edge_gateway_healthy_providers = $hp (metrics: $metricsUrl)" -ForegroundColor Green
        if ([int]$hp -lt 1) {
            Write-Error "Expected at least 1 healthy provider after QUIC connect."
        }
    }
}
catch {
    Write-Warning "Could not scrape metrics at $metricsUrl : $($_.Exception.Message)"
}

Write-Host ""
Write-Host "QUIC provider E2E passed." -ForegroundColor Green
