# Docker Update Script for Node Map Enhancement
# This script rebuilds the web container with the new map components

param(
    [Parameter()]
    [ValidateSet("dev", "prod", "full")]
    [string]$Environment = "dev",
    
    [Parameter()]
    [switch]$SkipBuild,
    
    [Parameter()]
    [switch]$KeepCache,
    
    [Parameter()]
    [switch]$InstallDeps
)

$ErrorActionPreference = "Stop"

# Colors for output
$colors = @{
    Green = "`e[32m"
    Yellow = "`e[33m"
    Red = "`e[31m"
    Cyan = "`e[36m"
    Reset = "`e[0m"
}

function Write-Status($message, $color = "Cyan") {
    Write-Host "$($colors[$color])$message$($colors.Reset)"
}

function Write-Success($message) {
    Write-Status $message "Green"
}

function Write-Warning($message) {
    Write-Status $message "Yellow"
}

function Write-Error($message) {
    Write-Status $message "Red"
}

# Get the script directory
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $scriptDir

Write-Status @"
╔══════════════════════════════════════════════════════════════╗
║     Node Map Enhancement - Docker Update Script             ║
║                                                              ║
║  Phases: 1️⃣  2️⃣  3️⃣  4️⃣  5️⃣  6️⃣                              ║
╚══════════════════════════════════════════════════════════════╝
"@ "Cyan"

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
Write-Status "`n📋 Step 1: Checking Docker..."
try {
    $dockerInfo = docker info 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "Docker is not running"
    }
    Write-Success "✓ Docker is running"
} catch {
    Write-Error "✗ Docker is not running. Please start Docker Desktop first."
    exit 1
}

# Step 2: Install dependencies if requested
if ($InstallDeps) {
    Write-Status "`n📦 Step 2: Installing dependencies..."
    Set-Location apps/web
    
    Write-Status "Installing framer-motion, three, @react-three/fiber, @react-three/drei, recharts..."
    npm install framer-motion three @react-three/fiber @react-three/drei recharts
    
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Failed to install dependencies"
        Set-Location $scriptDir
        exit 1
    }
    
    Write-Success "✓ Dependencies installed"
    Set-Location $scriptDir
} else {
    Write-Status "`n📦 Step 2: Skipping dependency installation (use -InstallDeps to install)"
}

# Step 3: Stop the web container
Write-Status "`n🛑 Step 3: Stopping web container..."
docker compose -f $composeFile stop web
if ($LASTEXITCODE -ne 0) {
    Write-Warning "Could not stop web container (may not be running)"
} else {
    Write-Success "✓ Web container stopped"
}

# Step 4: Remove the web container
Write-Status "`n🗑️  Step 4: Removing old web container..."
docker compose -f $composeFile rm -f web
if ($LASTEXITCODE -ne 0) {
    Write-Warning "Could not remove web container"
} else {
    Write-Success "✓ Old web container removed"
}

# Step 5: Rebuild the web container
if (-not $SkipBuild) {
    Write-Status "`n🔨 Step 5: Rebuilding web container with new map components..."
    
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
        Write-Error "✗ Failed to build web container"
        exit 1
    }
    Write-Success "✓ Web container rebuilt successfully"
} else {
    Write-Status "`n🔨 Step 5: Skipping build (use -SkipBuild to skip)"
}

# Step 6: Start the web container
Write-Status "`n🚀 Step 6: Starting web container..."
docker compose -f $composeFile up -d web
if ($LASTEXITCODE -ne 0) {
    Write-Error "✗ Failed to start web container"
    exit 1
}
Write-Success "✓ Web container started"

# Step 7: Show status
Write-Status "`n📊 Step 7: Checking container status..."
Start-Sleep -Seconds 3
$containerStatus = docker compose -f $composeFile ps web --format "table {{.Name}}\t{{.Status}}\t{{.Ports}}"
Write-Status $containerStatus

# Step 8: Show logs (optional)
Write-Status "`n📜 Recent logs:"
docker compose -f $composeFile logs --tail=20 web

Write-Status @"

╔══════════════════════════════════════════════════════════════╗
║                     ✅ UPDATE COMPLETE!                      ║
╚══════════════════════════════════════════════════════════════╝

🌐 Access the enhanced map at: http://localhost:3000/explorer/map

📁 New components are in: apps/web/src/app/explorer/map/

🎨 Features now available:
   • Cyberpunk-themed node markers with particle effects
   • 5 visual themes (dark, light, satellite, cyberpunk, minimal)
   • 3D Globe view
   • Animated connection lines between nodes
   • Detailed node panels with charts
   • Real-time activity feed
   • Advanced filters and search
   • Smooth transitions and loading states

📚 Documentation:
   • README.md - Component reference
   • INTEGRATION_GUIDE.md - Integration instructions
   • examples/*.tsx - Demo pages

💡 To see the demo pages, navigate to:
   /explorer/map/examples/EffectsDemo
   /explorer/map/examples/ThemeDemo
   /explorer/map/examples/PanelDemo
   /explorer/map/examples/FilterDemo
   /explorer/map/examples/FinalDemo

"@ "Green"

Write-Status "`nUseful commands:"
Write-Status "  View logs: docker compose -f $composeFile logs -f web"
Write-Status "  Restart:   docker compose -f $composeFile restart web"
Write-Status "  Stop:      docker compose -f $composeFile stop web"
