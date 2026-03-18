# Test Docker setup for new financial engine features
# Run with: .\scripts\test-docker.ps1

$ErrorActionPreference = "Stop"

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "ProxyHubb Docker Test Script" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""

# Check if oracle keypair exists
if (-not (Test-Path "oracle-keypair.json")) {
    Write-Host "WARNING: oracle-keypair.json not found" -ForegroundColor Yellow
    Write-Host "Creating dummy keypair for testing..." -ForegroundColor Yellow
    
    # Generate a dummy keypair (64 zeros)
    $keypair = @(0) * 64
    $keypair | ConvertTo-Json | Set-Content "oracle-keypair.json"
    
    Write-Host "Note: This is a test keypair. Replace with real keypair for production." -ForegroundColor Yellow
}

# Function to check if a port is in use
function Test-PortAvailable {
    param([int]$Port)
    
    $connection = Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue
    if ($connection) {
        Write-Host "ERROR: Port $Port is already in use" -ForegroundColor Red
        return $false
    }
    return $true
}

# Check required ports
Write-Host "Checking ports..."
$portsAvailable = $true
$portsAvailable = (Test-PortAvailable -Port 8080) -and $portsAvailable
$portsAvailable = (Test-PortAvailable -Port 5433) -and $portsAvailable
$portsAvailable = (Test-PortAvailable -Port 6380) -and $portsAvailable

if (-not $portsAvailable) {
    exit 1
}

Write-Host "All ports available" -ForegroundColor Green
Write-Host ""

# Build images
Write-Host "Building Docker images..."
docker-compose -f docker-compose.test.yml build

if ($LASTEXITCODE -ne 0) {
    Write-Host "Build failed!" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "Starting test environment..."
docker-compose -f docker-compose.test.yml up -d postgres redis

Write-Host ""
Write-Host "Waiting for database to be ready..."
Start-Sleep -Seconds 5

# Check database health
$retries = 0
$maxRetries = 10
$healthy = $false

while ($retries -lt $maxRetries -and -not $healthy) {
    $result = docker-compose -f docker-compose.test.yml exec -T postgres pg_isready -U proxyhubb -d proxyhubb_test 2>&1
    if ($LASTEXITCODE -eq 0) {
        $healthy = $true
    } else {
        Write-Host "Waiting for postgres... (attempt $($retries + 1)/$maxRetries)"
        Start-Sleep -Seconds 2
        $retries++
    }
}

if (-not $healthy) {
    Write-Host "Database failed to start!" -ForegroundColor Red
    docker-compose -f docker-compose.test.yml logs postgres
    exit 1
}

Write-Host "Database ready!" -ForegroundColor Green

# Start control API
Write-Host ""
Write-Host "Starting Control API..."
docker-compose -f docker-compose.test.yml up -d control-api

Write-Host ""
Write-Host "Waiting for API to be healthy..."
Start-Sleep -Seconds 10

# Check API health
try {
    $response = Invoke-WebRequest -Uri "http://localhost:8080/health" -UseBasicParsing -ErrorAction Stop
    Write-Host "API is healthy!" -ForegroundColor Green
} catch {
    Write-Host "API health check pending, checking logs..." -ForegroundColor Yellow
    docker-compose -f docker-compose.test.yml logs --tail=20 control-api
}

Write-Host ""
Write-Host "==========================================" -ForegroundColor Green
Write-Host "Test environment is ready!" -ForegroundColor Green
Write-Host "==========================================" -ForegroundColor Green
Write-Host ""
Write-Host "Services:"
Write-Host "  - Control API: http://localhost:8080"
Write-Host "  - PostgreSQL:  localhost:5433"
Write-Host "  - Redis:       localhost:6380"
Write-Host ""
Write-Host "Test endpoints:"
Write-Host "  - Health:     curl http://localhost:8080/health"
Write-Host "  - SOL Price:  curl http://localhost:8080/v1/pricing/sol"
Write-Host "  - Sources:    curl http://localhost:8080/v1/admin/pricing/sources"
Write-Host ""
Write-Host "To run tests:"
Write-Host "  docker-compose -f docker-compose.test.yml --profile test up test-runner"
Write-Host ""
Write-Host "To view logs:"
Write-Host "  docker-compose -f docker-compose.test.yml logs -f control-api"
Write-Host ""
Write-Host "To stop:"
Write-Host "  docker-compose -f docker-compose.test.yml down -v"
Write-Host ""
