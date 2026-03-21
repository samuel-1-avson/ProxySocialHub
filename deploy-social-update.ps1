#!/usr/bin/env pwsh
#
# Deploy Script for PAYG Social System Update
# This script automates the deployment of Phases 1-4 social features
# Run with: .\deploy-social-update.ps1
#

#Requires -Version 5.1

param(
    [switch]$SkipBackup,
    [switch]$SkipBuild,
    [switch]$Force
)

$ErrorActionPreference = "Stop"

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "ProxyHubb PAYG Social System Deployment" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""

# Function to print colored output
function Write-Status {
    param([string]$Message)
    Write-Host "[INFO] $Message" -ForegroundColor Green
}

function Write-Warning {
    param([string]$Message)
    Write-Host "[WARN] $Message" -ForegroundColor Yellow
}

function Write-Error {
    param([string]$Message)
    Write-Host "[ERROR] $Message" -ForegroundColor Red
}

function Write-Success {
    param([string]$Message)
    Write-Host "[SUCCESS] $Message" -ForegroundColor Green
}

# Check if docker-compose is available
try {
    $null = Get-Command docker-compose -ErrorAction Stop
    Write-Status "docker-compose found"
}
catch {
    Write-Error "docker-compose not found. Please install Docker Compose."
    exit 1
}

# Check if .env file exists
if (-not (Test-Path .env)) {
    Write-Error ".env file not found! Please create one from .env.example"
    exit 1
}

# Create backup directory
$BackupDir = "./backups/$(Get-Date -Format 'yyyyMMdd_HHmmss')"
New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null
Write-Status "Backup directory created: $BackupDir"

# Step 1: Backup database
if (-not $SkipBackup) {
    Write-Status "Step 1: Creating database backup..."
    $PostgresRunning = docker-compose ps | Select-String "postgres.*Up"
    
    if ($PostgresRunning) {
        try {
            docker-compose exec -T postgres pg_dump -U proxyhubb proxyhubb > "$BackupDir/db_backup.sql"
            Write-Status "Database backup saved to $BackupDir/db_backup.sql"
        }
        catch {
            Write-Warning "Database backup failed: $_"
        }
    }
    else {
        Write-Warning "PostgreSQL not running, skipping backup"
    }
}
else {
    Write-Warning "Skipping backup (SkipBackup flag set)"
}

# Step 2: Check for new environment variables
Write-Status "Step 2: Checking environment variables..."

$NewVars = @(
    "MILESTONE_CHECK_INTERVAL_MINUTES",
    "MILESTONE_REWARDS_ENABLED",
    "REVIEW_MIN_USAGE_GB",
    "REVIEW_MIN_DURATION_DAYS",
    "CIRCLE_POOL_ENABLED",
    "CIRCLE_MINIMUM_POOL_GB",
    "CIRCLE_ENTERPRISE_THRESHOLD_GB",
    "PRESENCE_HEARTBEAT_SECONDS",
    "PRESENCE_TIMEOUT_MINUTES",
    "NEXT_PUBLIC_MILESTONES_ENABLED",
    "NEXT_PUBLIC_CIRCLE_POOLING_ENABLED",
    "NEXT_PUBLIC_USAGE_REVIEWS_ENABLED",
    "NEXT_PUBLIC_SOCIAL_PRESENCE_ENABLED"
)

$MissingVars = @()
$EnvContent = Get-Content .env -Raw

foreach ($var in $NewVars) {
    $Pattern = "^$var="
    if ($EnvContent -notmatch $Pattern) {
        $MissingVars += $var
    }
}

if ($MissingVars.Count -gt 0) {
    Write-Warning "Missing environment variables. Adding defaults to .env..."
    
    $NewLines = @("", "# PAYG Social System (auto-added by deploy script)")
    
    foreach ($var in $MissingVars) {
        switch ($var) {
            "MILESTONE_CHECK_INTERVAL_MINUTES" { $NewLines += "MILESTONE_CHECK_INTERVAL_MINUTES=5" }
            "MILESTONE_REWARDS_ENABLED" { $NewLines += "MILESTONE_REWARDS_ENABLED=true" }
            "REVIEW_MIN_USAGE_GB" { $NewLines += "REVIEW_MIN_USAGE_GB=1" }
            "REVIEW_MIN_DURATION_DAYS" { $NewLines += "REVIEW_MIN_DURATION_DAYS=7" }
            "CIRCLE_POOL_ENABLED" { $NewLines += "CIRCLE_POOL_ENABLED=true" }
            "CIRCLE_MINIMUM_POOL_GB" { $NewLines += "CIRCLE_MINIMUM_POOL_GB=100" }
            "CIRCLE_ENTERPRISE_THRESHOLD_GB" { $NewLines += "CIRCLE_ENTERPRISE_THRESHOLD_GB=1000" }
            "PRESENCE_HEARTBEAT_SECONDS" { $NewLines += "PRESENCE_HEARTBEAT_SECONDS=60" }
            "PRESENCE_TIMEOUT_MINUTES" { $NewLines += "PRESENCE_TIMEOUT_MINUTES=5" }
            "NEXT_PUBLIC_MILESTONES_ENABLED" { $NewLines += "NEXT_PUBLIC_MILESTONES_ENABLED=true" }
            "NEXT_PUBLIC_CIRCLE_POOLING_ENABLED" { $NewLines += "NEXT_PUBLIC_CIRCLE_POOLING_ENABLED=true" }
            "NEXT_PUBLIC_USAGE_REVIEWS_ENABLED" { $NewLines += "NEXT_PUBLIC_USAGE_REVIEWS_ENABLED=true" }
            "NEXT_PUBLIC_SOCIAL_PRESENCE_ENABLED" { $NewLines += "NEXT_PUBLIC_SOCIAL_PRESENCE_ENABLED=true" }
        }
        Write-Status "Added $var to .env"
    }
    
    Add-Content .env -Value ($NewLines -join "`n")
}
else {
    Write-Status "All environment variables present"
}

# Step 3: Stop running containers
Write-Status "Step 3: Stopping running containers..."
docker-compose down

if ($LASTEXITCODE -ne 0) {
    Write-Warning "docker-compose down returned non-zero exit code, continuing anyway..."
}

# Step 4: Rebuild images
if (-not $SkipBuild) {
    Write-Status "Step 4: Rebuilding Docker images..."
    
    Write-Status "Building control-api..."
    docker-compose build --no-cache control-api
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Failed to build control-api"
        exit 1
    }
    
    Write-Status "Building web frontend..."
    docker-compose build --no-cache web
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Failed to build web"
        exit 1
    }
}
else {
    Write-Warning "Skipping build (SkipBuild flag set)"
}

# Step 5: Run migrations
Write-Status "Step 5: Running database migrations..."
docker-compose up -d postgres redis

# Wait for services to be ready
Write-Status "Waiting for PostgreSQL and Redis to be ready..."
Start-Sleep -Seconds 5

# Test PostgreSQL connection
$MaxRetries = 10
$RetryCount = 0
while ($RetryCount -lt $MaxRetries) {
    try {
        $Result = docker-compose exec -T postgres pg_isready -U proxyhubb 2>&1
        if ($Result -match "accepting connections") {
            Write-Status "PostgreSQL is ready"
            break
        }
    }
    catch {
        # Ignore errors and retry
    }
    
    $RetryCount++
    if ($RetryCount -eq $MaxRetries) {
        Write-Error "PostgreSQL failed to become ready"
        exit 1
    }
    Write-Warning "PostgreSQL not ready yet, retrying... ($RetryCount/$MaxRetries)"
    Start-Sleep -Seconds 2
}

docker-compose up db-migrate
$MigrateExitCode = $LASTEXITCODE

if ($MigrateExitCode -ne 0) {
    Write-Error "Migration failed! Check logs with: docker-compose logs db-migrate"
    exit 1
}

Write-Status "Migrations completed successfully"

# Step 6: Start all services
Write-Status "Step 6: Starting all services..."
docker-compose up -d

if ($LASTEXITCODE -ne 0) {
    Write-Error "Failed to start services"
    exit 1
}

# Step 7: Health checks
Write-Status "Step 7: Running health checks..."
Write-Status "Waiting for services to start (10 seconds)..."
Start-Sleep -Seconds 10

# Check control-api health
Write-Status "Checking control-api health..."
$ApiHealthy = $false
for ($i = 1; $i -le 10; $i++) {
    try {
        $Response = Invoke-WebRequest -Uri "http://localhost:8081/health" -UseBasicParsing -TimeoutSec 5 -ErrorAction Stop
        if ($Response.StatusCode -eq 200) {
            Write-Status "control-api is healthy"
            $ApiHealthy = $true
            break
        }
    }
    catch {
        if ($i -eq 10) {
            Write-Error "control-api health check failed"
            docker-compose logs control-api | Select-Object -Last 50
            exit 1
        }
        Write-Warning "control-api not ready yet, retrying... ($i/10)"
        Start-Sleep -Seconds 3
    }
}

# Check web health
Write-Status "Checking web frontend health..."
$WebHealthy = $false
for ($i = 1; $i -le 10; $i++) {
    try {
        $Response = Invoke-WebRequest -Uri "http://localhost:3000" -UseBasicParsing -TimeoutSec 5 -ErrorAction Stop
        if ($Response.StatusCode -eq 200) {
            Write-Status "web frontend is healthy"
            $WebHealthy = $true
            break
        }
    }
    catch {
        if ($i -eq 10) {
            Write-Error "web frontend health check failed"
            docker-compose logs web | Select-Object -Last 50
            exit 1
        }
        Write-Warning "web frontend not ready yet, retrying... ($i/10)"
        Start-Sleep -Seconds 3
    }
}

# Step 8: Verify migrations
Write-Status "Step 8: Verifying database migrations..."

$Tables = @("usage_milestones", "provider_buyer_relationships", "circle_quotes", "circle_sessions", "circle_revenues")
foreach ($table in $Tables) {
    try {
        $Result = docker-compose exec -T postgres psql -U proxyhubb -d proxyhubb -c "SELECT 1 FROM $table LIMIT 1" 2>&1
        if ($Result -match "1 row" -or $Result -match "0 rows") {
            Write-Status "Table '$table' exists"
        }
        else {
            Write-Warning "Table '$table' may not exist yet (will be created by GORM AutoMigrate)"
        }
    }
    catch {
        Write-Warning "Could not verify table '$table': $_"
    }
}

# Step 9: Test new endpoints
Write-Status "Step 9: Testing new API endpoints..."

# Test milestone endpoint
try {
    $Response = Invoke-WebRequest -Uri "http://localhost:8081/api/v1/milestones" -UseBasicParsing -TimeoutSec 5 -ErrorAction Stop
    Write-Status "Milestone endpoint accessible"
}
catch {
    Write-Warning "Milestone endpoint not accessible (may require auth)"
}

# Summary
Write-Host ""
Write-Host "==========================================" -ForegroundColor Green
Write-Host "Deployment completed successfully!" -ForegroundColor Green
Write-Host "==========================================" -ForegroundColor Green
Write-Host ""
Write-Host "New features deployed:" -ForegroundColor Cyan
Write-Host "  ✅ Phase 1: Quick messaging from explorer"
Write-Host "  ✅ Phase 2: Usage milestones & gamification"
Write-Host "  ✅ Phase 3: Usage-based reviews"
Write-Host "  ✅ Phase 4: Circle bandwidth pooling"
Write-Host ""
Write-Host "Access your application:" -ForegroundColor Cyan
Write-Host "  Web UI:     http://localhost:3000"
Write-Host "  API:        http://localhost:8081"
Write-Host "  Gateway:    http://localhost:3128"
Write-Host ""
Write-Host "Monitoring:" -ForegroundColor Cyan
Write-Host "  Logs:       docker-compose logs -f"
Write-Host "  Status:     docker-compose ps"
Write-Host ""
Write-Host "Backup saved to: $BackupDir" -ForegroundColor Cyan
Write-Host ""

# Optional: Open browser
$OpenBrowser = Read-Host "Open browser to http://localhost:3000? (y/N)"
if ($OpenBrowser -eq 'y' -or $OpenBrowser -eq 'Y') {
    Start-Process "http://localhost:3000"
}
