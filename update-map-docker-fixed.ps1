# Docker Update Script for Node Map Enhancement (Fixed for React 19)
# This script rebuilds the web container with the new map components

param(
    [Parameter()]
    [ValidateSet("dev", "prod", "full")]
    [string]$Environment = "dev",
    
    [Parameter()]
    [switch]$SkipBuild,
    
    [Parameter()]
    [switch]$KeepCache
)

$ErrorActionPreference = "Stop"

# Colors for output
function Write-Status($message, $color = "Cyan") {
    Write-Host $message -ForegroundColor $color
}

function Write-Success($message) {
    Write-Host $message -ForegroundColor Green
}

function Write-Warning($message) {
    Write-Host $message -ForegroundColor Yellow
}

function Write-Error($message) {
    Write-Host $message -ForegroundColor Red
}

# Get the script directory
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $scriptDir

Write-Status @"
╔══════════════════════════════════════════════════════════════╗
║     Node Map Enhancement - Docker Update Script             ║
║     (Compatible with React 19)                              ║
╚══════════════════════════════════════════════════════════════╝
"@

Write-Status "Environment: $Environment"
Write-Status "Working Directory: $(Get-Location)"

# Determine compose file
$composeFile = switch ($Environment) {
    "dev" { "docker-compose.dev.yml" }
    "prod" { "docker-compose.prod.yml" }
    "full" { "docker-compose.full.yml" }
    default { "docker-compose.yml" }
}

if (-not (Test-Path $composeFile)) {
    $composeFile = "docker-compose.yml"
}

Write-Status "Using compose file: $composeFile"

# Step 1: Check Docker is running
Write-Status "`n[Step 1] Checking Docker..."
try {
    $dockerInfo = docker info 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "Docker is not running"
    }
    Write-Success "Docker is running"
} catch {
    Write-Error "Docker is not running. Please start Docker Desktop first."
    exit 1
}

# Step 2: Update package.json (remove conflicting dependencies)
Write-Status "`n[Step 2] Checking package.json..."
$packageJsonPath = "apps/web/package.json"
$packageJson = Get-Content $packageJsonPath -Raw | ConvertFrom-Json

# Remove React 18-only dependencies if present
$depsToRemove = @("three", "@react-three/fiber", "@react-three/drei")
$removed = $false
foreach ($dep in $depsToRemove) {
    if ($packageJson.dependencies.$dep) {
        $packageJson.dependencies.PSObject.Properties.Remove($dep)
        Write-Success "Removed conflicting dependency: $dep"
        $removed = $true
    }
}

# Ensure react-globe.gl is present (works with React 19)
if (-not $packageJson.dependencies."react-globe.gl") {
    $packageJson.dependencies | Add-Member -NotePropertyName "react-globe.gl" -NotePropertyValue "^2.37.0" -Force
    Write-Success "Added react-globe.gl"
    $removed = $true
}

if ($removed) {
    $packageJson | ConvertTo-Json -Depth 10 | Set-Content $packageJsonPath
    Write-Success "Updated package.json"
} else {
    Write-Status "package.json already compatible"
}

# Step 3: Regenerate package-lock.json
Write-Status "`n[Step 3] Regenerating package-lock.json..."
Remove-Item "apps/web/package-lock.json" -ErrorAction SilentlyContinue
Write-Success "Removed old package-lock.json"

# Step 4: Stop the web container
Write-Status "`n[Step 4] Stopping web container..."
docker compose -f $composeFile stop web 2>$null
Write-Success "Web container stopped"

# Step 5: Remove the web container
Write-Status "`n[Step 5] Removing old web container..."
docker compose -f $composeFile rm -f web 2>$null
Write-Success "Old web container removed"

# Step 6: Remove old image to force rebuild
Write-Status "`n[Step 6] Removing old web image..."
docker rmi proxyhubb-web 2>$null
Write-Success "Old image removed (if existed)"

# Step 7: Rebuild the web container
if (-not $SkipBuild) {
    Write-Status "`n[Step 7] Rebuilding web container..."
    
    $buildArgs = @(
        "compose",
        "-f", $composeFile,
        "build"
    )
    
    if (-not $KeepCache) {
        Write-Status "Using --no-cache for clean build..."
        $buildArgs += "--no-cache"
    }
    
    $buildArgs += "web"
    
    & docker @buildArgs
    
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Failed to build web container"
        exit 1
    }
    Write-Success "Web container rebuilt successfully"
} else {
    Write-Status "`n[Step 7] Skipping build"
}

# Step 8: Start the web container
Write-Status "`n[Step 8] Starting web container..."
docker compose -f $composeFile up -d web
if ($LASTEXITCODE -ne 0) {
    Write-Error "Failed to start web container"
    exit 1
}
Write-Success "Web container started"

# Step 9: Show status
Write-Status "`n[Step 9] Checking container status..."
Start-Sleep -Seconds 3
$containerStatus = docker compose -f $composeFile ps web --format "table {{.Name}}\t{{.Status}}\t{{.Ports}}"
Write-Status $containerStatus

# Step 10: Show logs
Write-Status "`n[Step 10] Recent logs:"
docker compose -f $composeFile logs --tail=10 web

Write-Status @"

╔══════════════════════════════════════════════════════════════╗
║                     UPDATE COMPLETE!                         ║
╚══════════════════════════════════════════════════════════════╝

Access the enhanced map at: http://localhost:3000/explorer/map

Features now available:
   • Animated node markers with particle effects
   • 5 visual themes (dark, light, satellite, cyberpunk, minimal)
   • 3D Globe view (using react-globe.gl)
   • Animated connection lines between nodes
   • Detailed node panels with charts
   • Real-time activity feed
   • Advanced filters and search
   • Smooth transitions and loading states

Note: Using react-globe.gl for 3D (React 19 compatible)
      Full Three.js version available for React 18 projects

"@ "Green"

Write-Status "`nUseful commands:"
Write-Status "  View logs: docker compose -f $composeFile logs -f web"
Write-Status "  Restart:   docker compose -f $composeFile restart web"
Write-Status "  Stop:      docker compose -f $composeFile stop web"
