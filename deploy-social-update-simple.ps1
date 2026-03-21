#!/usr/bin/env pwsh
#
# Simple Deploy Script for PAYG Social System Update
# Run with: .\deploy-social-update-simple.ps1
#

$ErrorActionPreference = "Stop"

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "ProxyHubb PAYG Social System Deployment" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan

# Step 1: Check prerequisites
if (-not (Test-Path .env)) {
    Write-Host "[ERROR] .env file not found!" -ForegroundColor Red
    exit 1
}

# Step 2: Add environment variables if missing
$EnvVars = @(
    "MILESTONE_CHECK_INTERVAL_MINUTES=5",
    "MILESTONE_REWARDS_ENABLED=true",
    "REVIEW_MIN_USAGE_GB=1",
    "REVIEW_MIN_DURATION_DAYS=7",
    "CIRCLE_POOL_ENABLED=true",
    "CIRCLE_MINIMUM_POOL_GB=100",
    "CIRCLE_ENTERPRISE_THRESHOLD_GB=1000",
    "PRESENCE_HEARTBEAT_SECONDS=60",
    "PRESENCE_TIMEOUT_MINUTES=5",
    "NEXT_PUBLIC_MILESTONES_ENABLED=true",
    "NEXT_PUBLIC_CIRCLE_POOLING_ENABLED=true",
    "NEXT_PUBLIC_USAGE_REVIEWS_ENABLED=true",
    "NEXT_PUBLIC_SOCIAL_PRESENCE_ENABLED=true"
)

$EnvContent = Get-Content .env -Raw
$Missing = $false

foreach ($var in $EnvVars) {
    $varName = $var.Split('=')[0]
    if ($EnvContent -notmatch "^$varName=") {
        if (-not $Missing) {
            Add-Content .env -Value "`n# PAYG Social System (auto-added)"
            $Missing = $true
        }
        Add-Content .env -Value $var
        Write-Host "[INFO] Added $varName to .env" -ForegroundColor Green
    }
}

if (-not $Missing) {
    Write-Host "[INFO] All environment variables present" -ForegroundColor Green
}

# Step 3: Create backup
$BackupDir = "backups\$(Get-Date -Format 'yyyyMMdd_HHmmss')"
New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null
Write-Host "[INFO] Backup directory: $BackupDir" -ForegroundColor Green

# Step 4: Stop and rebuild
docker-compose down
Write-Host "[INFO] Building images..." -ForegroundColor Green
docker-compose build --no-cache control-api web

# Step 5: Run migrations
docker-compose up -d postgres redis
Write-Host "[INFO] Waiting for PostgreSQL..." -ForegroundColor Green
Start-Sleep -Seconds 5
docker-compose up db-migrate

# Step 6: Start services
docker-compose up -d

# Step 7: Health check
Write-Host "[INFO] Waiting for services to start..." -ForegroundColor Green
Start-Sleep -Seconds 10

try {
    $Api = Invoke-WebRequest "http://localhost:8081/health" -UseBasicParsing -TimeoutSec 5
    if ($Api.StatusCode -eq 200) {
        Write-Host "[SUCCESS] API is healthy" -ForegroundColor Green
    }
}
catch {
    Write-Host "[WARN] API health check failed" -ForegroundColor Yellow
}

try {
    $Web = Invoke-WebRequest "http://localhost:3000" -UseBasicParsing -TimeoutSec 5
    if ($Web.StatusCode -eq 200) {
        Write-Host "[SUCCESS] Web is healthy" -ForegroundColor Green
    }
}
catch {
    Write-Host "[WARN] Web health check failed" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "==========================================" -ForegroundColor Green
Write-Host "Deployment Complete!" -ForegroundColor Green
Write-Host "==========================================" -ForegroundColor Green
Write-Host "Web:     http://localhost:3000" -ForegroundColor Cyan
Write-Host "API:     http://localhost:8081" -ForegroundColor Cyan
Write-Host "Gateway: http://localhost:3128" -ForegroundColor Cyan
