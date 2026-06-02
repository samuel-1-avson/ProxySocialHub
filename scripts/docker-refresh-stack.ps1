# Rebuild Docker images with latest code, apply DB migrations, and restart the dev stack.
# Use after merging explorer / API fixes so running containers match the repo.
#
# Usage:
#   .\scripts\docker-refresh-stack.ps1
#   .\scripts\docker-refresh-stack.ps1 -NoCache
#   .\scripts\docker-refresh-stack.ps1 -Services control-api,web

param(
    [switch]$NoCache,
    [string[]]$Services = @('control-api', 'web'),
    [string]$ComposeFile = 'docker-compose.dev.yml'
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

if (-not (Test-Path (Join-Path $repoRoot $ComposeFile))) {
    throw "Compose file not found: $ComposeFile"
}

. (Join-Path $PSScriptRoot '_env.ps1')
Import-RepoDotEnv $repoRoot

$buildArgs = @('compose', '-f', $ComposeFile, 'build')
if ($NoCache) { $buildArgs += '--no-cache' }
$buildArgs += $Services

Write-Host "Building: $($Services -join ', ')" -ForegroundColor Cyan
& docker @buildArgs
if ($LASTEXITCODE -ne 0) { throw "docker build failed ($LASTEXITCODE)" }

Write-Host "Applying migrations (db-migrate)..." -ForegroundColor Cyan
& docker compose -f $ComposeFile run --rm db-migrate
if ($LASTEXITCODE -ne 0) { throw "db-migrate failed ($LASTEXITCODE)" }

Write-Host "Starting dependencies..." -ForegroundColor Cyan
& docker compose -f $ComposeFile up -d postgres redis nats zk-prover
if ($LASTEXITCODE -ne 0) { throw "dependency up failed ($LASTEXITCODE)" }

Write-Host "Recreating API and web..." -ForegroundColor Cyan
& docker compose -f $ComposeFile up -d --force-recreate control-api web edge-gateway
if ($LASTEXITCODE -ne 0) { throw "docker compose up failed ($LASTEXITCODE)" }

$apiPort = if ($env:CONTROL_API_PORT) { $env:CONTROL_API_PORT } else { '18080' }
Write-Host ""
Write-Host "Stack refreshed." -ForegroundColor Green
Write-Host "  API:  http://localhost:$apiPort/health"
Write-Host "  Web:  http://localhost:3000/explorer"
Write-Host "  Verify explorer: .\scripts\explorer-verification.ps1 -ApiBaseUrl http://localhost:$apiPort"
