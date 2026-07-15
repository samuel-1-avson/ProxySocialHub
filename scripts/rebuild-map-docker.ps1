# Rebuild and restart Docker services after explorer/map/network changes.
# Uses docker-compose.yml (default stack: web on :3009, control-api on :18080).
#
# Optional in .env:
#   NEXT_PUBLIC_UNIFIED_NETWORK=true        # enable /network shell
#   EXPLORER_MAP_BUY_ENABLED=true           # in-map buy on /explorer/map
#   NEXT_PUBLIC_GLOBE_TOPOLOGY=true         # 3D globe session arcs (rebuild web after change)
#   MAP_TOPOLOGY_ENABLED=true               # control-api worker → GET /v1/map/links
#
# Usage (from repo root):
#   .\scripts\rebuild-map-docker.ps1
#   .\scripts\rebuild-map-docker.ps1 -SkipMigrate

param(
    [switch]$SkipMigrate
)

$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")

Write-Host "==> Applying database migrations (db-migrate)..." -ForegroundColor Cyan
if (-not $SkipMigrate) {
    docker compose run --rm db-migrate
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

Write-Host "==> Building control-api and web images..." -ForegroundColor Cyan
docker compose build control-api web
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "==> Recreating control-api and web containers..." -ForegroundColor Cyan
docker compose up -d control-api web
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host ""
$apiPort = if ($env:CONTROL_API_PORT) { $env:CONTROL_API_PORT } else { '18080' }

Write-Host "Done. Verify:" -ForegroundColor Green
Write-Host "  Web UI:        http://localhost:3009/explorer/map"
Write-Host "  Network shell: http://localhost:3009/network  (if NEXT_PUBLIC_UNIFIED_NETWORK=true in .env)"
Write-Host "  Map pins API:  http://localhost:${apiPort}/v1/marketplace/map?include_nodes=true"
Write-Host "  Map links API: http://localhost:${apiPort}/v1/map/links  (topology_available when sessions exist)"
Write-Host "  Globe arcs:    set NEXT_PUBLIC_GLOBE_TOPOLOGY=true in .env, then re-run this script (build-time flag)"
Write-Host ""
docker compose ps web control-api
