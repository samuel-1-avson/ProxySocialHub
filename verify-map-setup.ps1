# Verification Script for Node Map Enhancement
# Checks that all components and dependencies are in place

$ErrorActionPreference = "Stop"

Write-Host "╔══════════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║     Node Map Enhancement - Setup Verification               ║" -ForegroundColor Cyan
Write-Host "╚══════════════════════════════════════════════════════════════╝" -ForegroundColor Cyan

$allPassed = $true

# Check 1: Verify component files exist
Write-Host "`nChecking component files..." -ForegroundColor Yellow
$components = @(
    "apps/web/src/app/explorer/map/components/NodeMarker/index.tsx",
    "apps/web/src/app/explorer/map/components/GlassPanel.tsx",
    "apps/web/src/app/explorer/map/effects/ParticleSystem.tsx",
    "apps/web/src/app/explorer/map/effects/ConnectionLines.tsx",
    "apps/web/src/app/explorer/map/globe/GlobeView.tsx",
    "apps/web/src/app/explorer/map/panel/NodeDetailsPanel.tsx",
    "apps/web/src/app/explorer/map/filters/SearchBar.tsx",
    "apps/web/src/app/explorer/map/filters/FilterPanel.tsx",
    "apps/web/src/app/explorer/map/transitions/PageTransition.tsx",
    "apps/web/src/app/explorer/map/loading/SkeletonLoaders.tsx",
    "apps/web/src/app/explorer/map/error/ErrorBoundary.tsx",
    "apps/web/src/app/explorer/map/accessibility/ARIA.tsx"
)

foreach ($file in $components) {
    $fullPath = Join-Path $PSScriptRoot $file
    if (Test-Path $fullPath) {
        Write-Host "  [OK] $file" -ForegroundColor Green
    } else {
        Write-Host "  [MISSING] $file" -ForegroundColor Red
        $allPassed = $false
    }
}

# Check 2: Verify demo files
Write-Host "`nChecking demo files..." -ForegroundColor Yellow
$demos = @(
    "apps/web/src/app/explorer/map/examples/EffectsDemo.tsx",
    "apps/web/src/app/explorer/map/examples/ThemeDemo.tsx",
    "apps/web/src/app/explorer/map/examples/PanelDemo.tsx",
    "apps/web/src/app/explorer/map/examples/FilterDemo.tsx",
    "apps/web/src/app/explorer/map/examples/FinalDemo.tsx"
)

foreach ($file in $demos) {
    $fullPath = Join-Path $PSScriptRoot $file
    if (Test-Path $fullPath) {
        Write-Host "  [OK] $file" -ForegroundColor Green
    } else {
        Write-Host "  [MISSING] $file" -ForegroundColor Red
        $allPassed = $false
    }
}

# Check 3: Verify package.json dependencies
Write-Host "`nChecking package.json dependencies..." -ForegroundColor Yellow
$packageJsonPath = Join-Path $PSScriptRoot "apps/web/package.json"
$packageJson = Get-Content $packageJsonPath -Raw | ConvertFrom-Json

$requiredDeps = @("framer-motion", "three", "@react-three/fiber", "@react-three/drei", "recharts")
$missingDeps = @()

foreach ($dep in $requiredDeps) {
    if ($packageJson.dependencies.$dep) {
        $version = $packageJson.dependencies.$dep
        Write-Host "  [OK] $dep $version" -ForegroundColor Green
    } else {
        Write-Host "  [MISSING] $dep" -ForegroundColor Red
        $missingDeps += $dep
        $allPassed = $false
    }
}

# Check 4: Verify Docker files
Write-Host "`nChecking Docker files..." -ForegroundColor Yellow
$dockerFiles = @(
    "docker-compose.yml",
    "docker-compose.dev.yml",
    "apps/web/Dockerfile"
)

foreach ($file in $dockerFiles) {
    $fullPath = Join-Path $PSScriptRoot $file
    if (Test-Path $fullPath) {
        Write-Host "  [OK] $file" -ForegroundColor Green
    } else {
        Write-Host "  [MISSING] $file" -ForegroundColor Red
        $allPassed = $false
    }
}

# Check 5: Verify update scripts
Write-Host "`nChecking update scripts..." -ForegroundColor Yellow
$scripts = @(
    "update-map-docker.ps1",
    "update-map-docker.bat",
    "DOCKER_MAP_UPDATE.md"
)

foreach ($file in $scripts) {
    $fullPath = Join-Path $PSScriptRoot $file
    if (Test-Path $fullPath) {
        Write-Host "  [OK] $file" -ForegroundColor Green
    } else {
        Write-Host "  [MISSING] $file" -ForegroundColor Red
        $allPassed = $false
    }
}

# Check 6: Check if node_modules exists
Write-Host "`nChecking node_modules..." -ForegroundColor Yellow
if (Test-Path (Join-Path $PSScriptRoot "apps/web/node_modules")) {
    Write-Host "  [OK] node_modules exists" -ForegroundColor Green
} else {
    Write-Host "  [WARNING] node_modules not found (run npm install)" -ForegroundColor Yellow
}

# Summary
Write-Host "`n═══════════════════════════════════════════════════════════════" -ForegroundColor Cyan

if ($allPassed) {
    Write-Host "ALL CHECKS PASSED!" -ForegroundColor Green
    Write-Host "`nThe Node Map Enhancement is ready for Docker deployment." -ForegroundColor Green
    Write-Host "`nNext step: .\update-map-docker.ps1 -Environment dev -InstallDeps" -ForegroundColor Cyan
    Write-Host "`nOr manually:"
    Write-Host "  cd apps/web"
    Write-Host "  npm install"
    Write-Host "  cd ../.."
    Write-Host "  docker compose -f docker-compose.dev.yml build --no-cache web"
    Write-Host "  docker compose -f docker-compose.dev.yml up -d web"
    Write-Host "`nAccess: http://localhost:3000/explorer/map" -ForegroundColor Cyan
} else {
    Write-Host "SOME CHECKS FAILED!" -ForegroundColor Red
    Write-Host "`nMissing items detected. Please:" -ForegroundColor Yellow
    Write-Host "1. If dependencies are missing:"
    Write-Host "   cd apps/web"
    Write-Host "   npm install framer-motion three @react-three/fiber @react-three/drei recharts"
    Write-Host "`n2. If component files are missing, re-run the enhancement setup."
    Write-Host "`n3. If Docker files are missing, check your project structure."
    
    if ($missingDeps.Count -gt 0) {
        Write-Host "`nMissing dependencies: $($missingDeps -join ', ')" -ForegroundColor Yellow
    }
}

Write-Host "═══════════════════════════════════════════════════════════════" -ForegroundColor Cyan
