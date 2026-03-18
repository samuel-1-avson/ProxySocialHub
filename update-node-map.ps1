# =============================================================================
# ProxyHubb Node Map Update Script (PowerShell)
# =============================================================================
# This script rebuilds the web container with all the Node Map fixes
# Run this from the project root directory
# =============================================================================

#Requires -Version 5.1

$Green = "`e[32m"
$Yellow = "`e[33m"
$Red = "`e[31m"
$Reset = "`e[0m"

function Write-Status {
    param([string]$Message)
    Write-Host "$Green[✓]$Reset $Message"
}

function Write-Warning {
    param([string]$Message)
    Write-Host "$Yellow[!]$Reset $Message"
}

function Write-Error {
    param([string]$Message)
    Write-Host "$Red[✗]$Reset $Message"
}

Write-Host "=========================================="
Write-Host "ProxyHubb Node Map Update (PowerShell)"
Write-Host "=========================================="
Write-Host ""

# Check if docker-compose is available
try {
    $dcVersion = docker-compose --version 2>$null
    if (-not $dcVersion) {
        Write-Error "docker-compose not found. Please install Docker Compose."
        exit 1
    }
} catch {
    Write-Error "docker-compose not found. Please install Docker Compose."
    exit 1
}

# Check if we're in the right directory
if (-not (Test-Path "docker-compose.yml")) {
    Write-Error "docker-compose.yml not found. Please run this script from the project root."
    exit 1
}

Write-Host "Step 1/5: Stopping current web container..."
try {
    docker-compose stop web 2>$null | Out-Null
    docker-compose rm -f web 2>$null | Out-Null
    Write-Status "Web container stopped"
} catch {
    Write-Warning "Could not stop web container (may not be running)"
}

Write-Host ""
Write-Host "Step 2/5: Rebuilding web container with new code..."
try {
    docker-compose build --no-cache web 2>&1 | ForEach-Object { Write-Host $_ }
    Write-Status "Web container rebuilt successfully"
} catch {
    Write-Error "Build failed: $_"
    exit 1
}

Write-Host ""
Write-Host "Step 3/5: Starting all services..."
try {
    docker-compose up -d 2>$null | Out-Null
    Write-Status "All services started"
} catch {
    Write-Error "Failed to start services: $_"
    exit 1
}

Write-Host ""
Write-Host "Step 4/5: Waiting for services to be healthy..."
Start-Sleep -Seconds 10

# Check if containers are running
try {
    $containers = docker-compose ps 2>$null
    if ($containers -match "Up") {
        Write-Status "Containers are running"
    } else {
        Write-Error "Some containers failed to start"
        docker-compose ps
        exit 1
    }
} catch {
    Write-Error "Could not check containers: $_"
}

Write-Host ""
Write-Host "Step 5/5: Verifying API connectivity..."

try {
    $apiResponse = Invoke-WebRequest -Uri "http://localhost:8081/health" -Method GET -TimeoutSec 5 -ErrorAction SilentlyContinue
    if ($apiResponse.StatusCode -eq 200) {
        Write-Status "API is responding (HTTP 200)"
    } else {
        Write-Warning "API returned HTTP $($apiResponse.StatusCode) (may still be starting up)"
    }
} catch {
    Write-Warning "API not responding yet (may still be starting up)"
}

Write-Host ""
Write-Host "=========================================="
Write-Host "Update Complete!"
Write-Host "=========================================="
Write-Host ""
Write-Host "Access the Node Map at:"
Write-Host "  http://localhost:3000/explorer/map"
Write-Host ""
Write-Host "Useful commands:"
Write-Host "  View logs:        docker-compose logs -f web"
Write-Host "  Check status:     docker-compose ps"
Write-Host "  View API logs:    docker-compose logs -f control-api"
Write-Host ""
Write-Host "Troubleshooting:"
Write-Host "  - If no nodes appear, run: .\fix-nodes.ps1"
Write-Host "  - If map won't load, check: docker-compose logs web"
Write-Host "  - Check API: curl http://localhost:8081/v1/explorer/nodes"
Write-Host ""

# Pause if not in ISE
if ($Host.Name -eq "ConsoleHost") {
    Write-Host "Press any key to continue..."
    $null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
}
