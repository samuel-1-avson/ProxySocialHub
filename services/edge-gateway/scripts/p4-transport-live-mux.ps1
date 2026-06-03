# Live P4 smoke: 2 yamux lanes on main docker-compose stack.
# Requires: .env, docker compose stack (control-api + edge-gateway healthy).
param(
    [int]$Lanes = 2,
    [switch]$SkipBuild,
    [switch]$SkipBootstrap
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location $repoRoot

if ($Lanes -lt 1 -or $Lanes -gt 16) {
    throw "Lanes must be 1..16"
}

$env:YAMUX_CONNS_PER_NODE = "$Lanes"
Write-Host "== P4 live mux: YAMUX_CONNS_PER_NODE=$Lanes ==" -ForegroundColor Cyan

$apiPort = if ($env:CONTROL_API_HOST_PORT) { $env:CONTROL_API_HOST_PORT } else { "18080" }
$composeEnv = Join-Path $repoRoot "config\docker\provider.compose.env"

if (-not $SkipBootstrap -and -not (Test-Path $composeEnv)) {
    Write-Host "Bootstrapping provider credentials..."
    & (Join-Path $repoRoot "scripts\bootstrap-provider-docker.ps1") -ApiBaseUrl "http://localhost:$apiPort"
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

    $upGw = @("compose", "-f", "docker-compose.yml", "-f", "docker-compose.provider.yml", "up", "-d", "--force-recreate", "edge-gateway")
    if (-not $SkipBuild) {
        $upGw = @("compose", "-f", "docker-compose.yml", "-f", "docker-compose.provider.yml", "up", "-d", "--build", "--force-recreate", "edge-gateway")
    }
Write-Host "Recreating edge-gateway..."
& docker @upGw
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "Waiting for edge-gateway healthy..."
$deadline = (Get-Date).AddMinutes(3)
do {
    Start-Sleep -Seconds 3
    $status = docker inspect -f "{{.State.Health.Status}}" proxyhubb-edge-gateway-1 2>$null
    if ($status -eq "healthy") { break }
    if ((Get-Date) -gt $deadline) {
        throw "edge-gateway not healthy within 3 minutes (last status: $status)"
    }
} while ($true)

if (-not (Test-Path $composeEnv)) {
    throw "Missing $composeEnv — run bootstrap-provider-docker.ps1 first (or omit -SkipBootstrap)."
}
if (-not (Test-Path (Join-Path $repoRoot "config\docker\provider.toml"))) {
    throw "Missing config/docker/provider.toml — bootstrap writes it via provider_dev_token."
}

$provArgs = @(
    "compose", "-f", "docker-compose.yml", "-f", "docker-compose.provider.yml",
    "--profile", "provider", "up", "-d", "--force-recreate", "provider-node"
)
if (-not $SkipBuild) {
    $provArgs = @(
        "compose", "-f", "docker-compose.yml", "-f", "docker-compose.provider.yml",
        "--profile", "provider", "up", "-d", "--build", "--force-recreate", "provider-node"
    )
}
Write-Host "Starting provider-node ($Lanes lanes)..."
& docker @provArgs
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "Tailing logs for mux attach (90s max)..."
$deadline = (Get-Date).AddSeconds(90)
$seenConnect = $false
$seenMux = $false
while ((Get-Date) -lt $deadline) {
    $gwLog = docker logs proxyhubb-edge-gateway-1 2>&1 | Out-String
    if ($gwLog -match "Provider connected") { $seenConnect = $true }
    if ($gwLog -match "mux lane attached.*lanes=$Lanes") { $seenMux = $true }
    if ($seenConnect -and $seenMux) { break }
    Start-Sleep -Seconds 5
}

$provLog = docker logs proxyhubb-provider-node 2>&1 | Out-String
if ($provLog -match "multi-yamux|Secondary yamux lane connected") {
    Write-Host "[OK] provider-node multi-yamux logs present" -ForegroundColor Green
} else {
    Write-Host "[WARN] provider-node mux logs not found yet — check: docker logs proxyhubb-provider-node" -ForegroundColor Yellow
}

if (-not $seenConnect) {
    Write-Host "[FAIL] gateway: no 'Provider connected' in logs" -ForegroundColor Red
    exit 1
}
if (-not $seenMux) {
    Write-Host "[FAIL] gateway: no 'mux lane attached' with lanes=$Lanes" -ForegroundColor Red
    Write-Host "Hint: rebuild images if binaries predate P4 mux support." -ForegroundColor DarkGray
    exit 1
}

Write-Host "[OK] P4 live mux: primary + attach lane ($Lanes total)" -ForegroundColor Green
