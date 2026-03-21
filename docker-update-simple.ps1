# Simple Docker Update Script for Node Map Enhancement
# Compatible with React 19

$ErrorActionPreference = "Continue"

Write-Host "Node Map Enhancement - Docker Update (React 19 Compatible)" -ForegroundColor Cyan
Write-Host "===========================================================" -ForegroundColor Cyan

# Step 1: Fix package.json
Write-Host "`n[1/6] Fixing package.json for React 19..." -ForegroundColor Yellow
$packageJsonPath = "apps/web/package.json"
$packageJson = Get-Content $packageJsonPath -Raw | ConvertFrom-Json

# Remove React 18-only dependencies
$removed = $false
foreach ($dep in @("three", "@react-three/fiber", "@react-three/drei")) {
    if ($packageJson.dependencies.$dep) {
        $packageJson.dependencies.PSObject.Properties.Remove($dep)
        Write-Host "  Removed: $dep" -ForegroundColor Green
        $removed = $true
    }
}

# Add react-globe.gl if missing
if (-not $packageJson.dependencies."react-globe.gl") {
    $packageJson.dependencies | Add-Member -NotePropertyName "react-globe.gl" -NotePropertyValue "^2.37.0"
    Write-Host "  Added: react-globe.gl" -ForegroundColor Green
    $removed = $true
}

if ($removed) {
    $packageJson | ConvertTo-Json -Depth 10 | Set-Content $packageJsonPath
    Write-Host "  Updated package.json" -ForegroundColor Green
} else {
    Write-Host "  package.json already compatible" -ForegroundColor Green
}

# Step 2: Remove package-lock
Write-Host "`n[2/6] Removing package-lock.json..." -ForegroundColor Yellow
Remove-Item "apps/web/package-lock.json" -ErrorAction SilentlyContinue
Write-Host "  Done" -ForegroundColor Green

# Step 3: Stop containers
Write-Host "`n[3/6] Stopping web container..." -ForegroundColor Yellow
try {
    docker compose -f docker-compose.dev.yml stop web 2>$null
} catch {}
Write-Host "  Done" -ForegroundColor Green

# Step 4: Remove container
Write-Host "`n[4/6] Removing old container..." -ForegroundColor Yellow
try {
    docker compose -f docker-compose.dev.yml rm -f web 2>$null
} catch {}
try {
    docker rmi proxyhubb-web 2>$null
} catch {}
Write-Host "  Done" -ForegroundColor Green

# Step 5: Build
Write-Host "`n[5/6] Building web container (this may take a few minutes)..." -ForegroundColor Yellow
$env:DOCKER_BUILDKIT = "1"
docker compose -f docker-compose.dev.yml build --no-cache web
if ($LASTEXITCODE -ne 0) {
    Write-Host "`nBUILD FAILED!" -ForegroundColor Red
    exit 1
}
Write-Host "  Build successful" -ForegroundColor Green

# Step 6: Start
Write-Host "`n[6/6] Starting web container..." -ForegroundColor Yellow
docker compose -f docker-compose.dev.yml up -d web
if ($LASTEXITCODE -ne 0) {
    Write-Host "`nSTART FAILED!" -ForegroundColor Red
    exit 1
}
Write-Host "  Container started" -ForegroundColor Green

# Show status
Write-Host "`nContainer Status:" -ForegroundColor Cyan
docker compose -f docker-compose.dev.yml ps web

Write-Host "`n===========================================================" -ForegroundColor Cyan
Write-Host "UPDATE COMPLETE!" -ForegroundColor Green
Write-Host "===========================================================" -ForegroundColor Cyan
Write-Host "`nAccess the enhanced map at:" -ForegroundColor Yellow
Write-Host "  http://localhost:3000/explorer/map" -ForegroundColor Cyan
Write-Host "`nDemo pages:" -ForegroundColor Yellow
Write-Host "  /explorer/map/examples/EffectsDemo" -ForegroundColor Cyan
Write-Host "  /explorer/map/examples/ThemeDemo" -ForegroundColor Cyan
Write-Host "  /explorer/map/examples/PanelDemo" -ForegroundColor Cyan
Write-Host "  /explorer/map/examples/FilterDemo" -ForegroundColor Cyan
Write-Host "  /explorer/map/examples/FinalDemo" -ForegroundColor Cyan
