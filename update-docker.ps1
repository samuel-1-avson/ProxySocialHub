# PowerShell Script: Update Docker Container with Real-Time Node Sync Changes
# Run this script from the project root directory

$ErrorActionPreference = "Stop"

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "  ProxyHubb Docker Update Script" -ForegroundColor Cyan
Write-Host "  (Real-Time Node Sync Feature)" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""

# Check if we're in the right directory
if (-not (Test-Path "docker-compose.yml")) {
    Write-Error "Error: docker-compose.yml not found. Please run this script from the project root directory."
    exit 1
}

Write-Host "Step 1: Stopping current control-api container..." -ForegroundColor Yellow
docker-compose stop control-api
if ($LASTEXITCODE -ne 0) {
    Write-Error "Failed to stop control-api container"
    exit 1
}
Write-Host "✓ Container stopped" -ForegroundColor Green
Write-Host ""

Write-Host "Step 2: Rebuilding control-api image with new code..." -ForegroundColor Yellow
Write-Host "(This may take 1-3 minutes...)" -ForegroundColor Gray
docker-compose build --no-cache control-api
if ($LASTEXITCODE -ne 0) {
    Write-Error "Failed to build control-api image"
    exit 1
}
Write-Host "✓ Image rebuilt successfully" -ForegroundColor Green
Write-Host ""

Write-Host "Step 3: Starting control-api container..." -ForegroundColor Yellow
docker-compose up -d control-api
if ($LASTEXITCODE -ne 0) {
    Write-Error "Failed to start control-api container"
    exit 1
}
Write-Host "✓ Container started" -ForegroundColor Green
Write-Host ""

Write-Host "Step 4: Waiting for container to be healthy..." -ForegroundColor Yellow
Start-Sleep -Seconds 5

# Check if container is running
$containerStatus = docker-compose ps control-api --format "{{.State}}"
if ($containerStatus -ne "running") {
    Write-Error "Container is not running. Check logs with: docker-compose logs control-api"
    exit 1
}
Write-Host "✓ Container is running" -ForegroundColor Green
Write-Host ""

Write-Host "Step 5: Recent logs from control-api..." -ForegroundColor Yellow
docker-compose logs --tail=20 control-api
Write-Host ""

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "  Update Complete!" -ForegroundColor Green
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "The real-time node sync feature is now active." -ForegroundColor White
Write-Host ""
Write-Host "To verify it's working:" -ForegroundColor Yellow
Write-Host "  1. Register a node: proxy-hub node activate" -ForegroundColor White
Write-Host "  2. Watch logs: docker-compose logs -f control-api" -ForegroundColor White
Write-Host "  3. You should see 'Node synced to explorer immediately' message" -ForegroundColor White
Write-Host ""
Write-Host "To test the explorer:" -ForegroundColor Yellow
Write-Host "  curl http://localhost:8081/v1/explorer/nodes/geo" -ForegroundColor White
Write-Host ""
