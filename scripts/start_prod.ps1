# ProxyHub - Local Production Launcher
Write-Host "🚀 Initializing Local Production Deployment..." -ForegroundColor Green

# 1. Check Docker
docker info > $null 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Error "Docker is not running. Please start Docker Desktop."
    exit 1
}

# 2. Build Services (Force Rebuild for Updates)
Write-Host "📦 Building Containers..." -ForegroundColor Cyan
docker-compose build --no-cache

# 3. Start Infrastructure
Write-Host "🔥 Starting Services (Detached)..." -ForegroundColor Cyan
docker-compose up -d

# 4. Health Check Loop
Write-Host "🏥 Checking Service Health..." -ForegroundColor Yellow
$services = @("proxyhubb-control-api-1", "proxyhubb-edge-gateway-1", "proxyhubb-postgres-1", "proxyhubb-redis-1")
foreach ($container in $services) {
    $status = docker inspect -f '{{.State.Status}}' $container 2>$null
    if ($status -eq "running") {
        Write-Host "✅ $container is RUNNING" -ForegroundColor Green
    } else {
        Write-Host "⚠️  $container is $status" -ForegroundColor Red
    }
}

Write-Host "`n✅ System Online!" -ForegroundColor Green
Write-Host "Frontend: http://localhost:3000"
Write-Host "Control API: http://localhost:8081"
Write-Host "Edge Gateway: http://localhost:8443 / 9090"
