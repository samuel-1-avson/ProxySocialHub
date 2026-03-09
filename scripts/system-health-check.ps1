# System Health Check Script for ProxyHubb
# This script verifies all services are functioning correctly

param(
    [switch]$Verbose,
    [switch]$EnableSupabase
)

$ErrorActionPreference = "Continue"
$results = @{
    timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    overall = "UNKNOWN"
    services = @()
}

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "  ProxyHubb System Health Check" -ForegroundColor Cyan
Write-Host "========================================`n" -ForegroundColor Cyan

# Function to test HTTP endpoint
function Test-Endpoint {
    param($Url, $Name)
    try {
        $response = Invoke-RestMethod -Uri $Url -Method GET -TimeoutSec 5 -ErrorAction Stop
        Write-Host "✅ $Name" -ForegroundColor Green
        if ($Verbose) {
            Write-Host "   Response: $($response | ConvertTo-Json -Depth 2)" -ForegroundColor Gray
        }
        return @{ name = $Name; status = "HEALTHY"; url = $Url; response = $response }
    }
    catch {
        Write-Host "❌ $Name - $($_.Exception.Message)" -ForegroundColor Red
        return @{ name = $Name; status = "UNHEALTHY"; url = $Url; error = $_.Exception.Message }
    }
}

# Function to test Docker container
function Test-Container {
    param($Name, $Required = $true)
    try {
        $container = docker inspect $Name --format "{{.State.Status}}" 2>&1
        if ($LASTEXITCODE -eq 0) {
            $health = docker inspect $Name --format "{{.State.Health.Status}}" 2>&1
            if ($health -eq "healthy" -or $health -eq "<no value>") {
                Write-Host "✅ $Name (Status: $container)" -ForegroundColor Green
                return @{ name = $Name; status = "HEALTHY"; container_status = $container }
            } else {
                Write-Host "⚠️ $Name (Status: $container, Health: $health)" -ForegroundColor Yellow
                return @{ name = $Name; status = "DEGRADED"; container_status = $container; health = $health }
            }
        } else {
            if ($Required) {
                Write-Host "❌ $Name - Not running" -ForegroundColor Red
                return @{ name = $Name; status = "DOWN"; error = "Container not found" }
            } else {
                Write-Host "⚪ $Name - Not running (optional)" -ForegroundColor Gray
                return @{ name = $Name; status = "OPTIONAL"; error = "Container not found" }
            }
        }
    }
    catch {
        Write-Host "❌ $Name - Error: $_" -ForegroundColor Red
        return @{ name = $Name; status = "ERROR"; error = $_ }
    }
}

Write-Host "Checking Docker Containers..." -ForegroundColor Yellow
Write-Host "-----------------------------" -ForegroundColor Yellow

# Check Core Containers
$coreContainers = @(
    "proxyhubb-control-api-1",
    "proxyhubb-postgres-1",
    "proxyhubb-redis-1",
    "proxyhubb-edge-gateway-1"
)

foreach ($container in $coreContainers) {
    $result = Test-Container -Name $container -Required ($container -ne "proxyhubb-edge-gateway-1")
    $results.services += $result
}

Write-Host "`nChecking API Endpoints..." -ForegroundColor Yellow
Write-Host "-------------------------" -ForegroundColor Yellow

# Test API Endpoints
$endpoints = @(
    @{ Url = "http://localhost:8080/health"; Name = "Control API Health" },
    @{ Url = "http://localhost:8080/v1/system/config/public"; Name = "Public Config API" }
)

foreach ($endpoint in $endpoints) {
    $result = Test-Endpoint -Url $endpoint.Url -Name $endpoint.Name
    $results.services += $result
}

Write-Host "`nChecking Database Connectivity..." -ForegroundColor Yellow
Write-Host "---------------------------------" -ForegroundColor Yellow

# Check PostgreSQL
$dbResult = Test-Container -Name "proxyhubb-postgres-1"
$results.services += $dbResult

# Check Redis
$redisResult = Test-Container -Name "proxyhubb-redis-1"
$results.services += $redisResult

Write-Host "`nChecking Frontend..." -ForegroundColor Yellow
Write-Host "--------------------" -ForegroundColor Yellow

# Check if Node.js is running for frontend
$nodeProcesses = Get-Process -Name "node" -ErrorAction SilentlyContinue
if ($nodeProcesses) {
    Write-Host "✅ Node.js running ($($nodeProcesses.Count) processes)" -ForegroundColor Green
    $results.services += @{ name = "Node.js Frontend"; status = "HEALTHY"; processes = $nodeProcesses.Count }
} else {
    Write-Host "⚠️ Node.js not running (may be using Docker)" -ForegroundColor Yellow
    $results.services += @{ name = "Node.js Frontend"; status = "UNKNOWN"; note = "Check Docker for web container" }
}

Write-Host "`nChecking Supabase Configuration..." -ForegroundColor Yellow
Write-Host "----------------------------------" -ForegroundColor Yellow

$supabaseUrl = $env:NEXT_PUBLIC_SUPABASE_URL
$supabaseKey = $env:NEXT_PUBLIC_SUPABASE_ANON_KEY

if ($supabaseUrl -and $supabaseKey) {
    Write-Host "✅ Supabase configured" -ForegroundColor Green
    Write-Host "   URL: $supabaseUrl" -ForegroundColor Gray
    
    # Try to connect to Supabase
    try {
        $headers = @{ "apikey" = $supabaseKey }
        $supabaseHealth = Invoke-RestMethod -Uri "$supabaseUrl/rest/v1/" -Headers $headers -TimeoutSec 5
        Write-Host "✅ Supabase connection successful" -ForegroundColor Green
        $results.services += @{ name = "Supabase"; status = "HEALTHY"; url = $supabaseUrl }
    }
    catch {
        Write-Host "❌ Supabase connection failed: $_" -ForegroundColor Red
        $results.services += @{ name = "Supabase"; status = "UNHEALTHY"; error = $_ }
    }
} else {
    Write-Host "⚠️ Supabase NOT configured - using backend JWT only" -ForegroundColor Yellow
    $results.services += @{ name = "Supabase"; status = "DISABLED"; mode = "Backend JWT only" }
}

# Calculate overall status
$unhealthy = $results.services | Where-Object { $_.status -eq "UNHEALTHY" -or $_.status -eq "DOWN" -or $_.status -eq "ERROR" }
$degraded = $results.services | Where-Object { $_.status -eq "DEGRADED" }

if ($unhealthy.Count -gt 0) {
    $results.overall = "UNHEALTHY"
} elseif ($degraded.Count -gt 0) {
    $results.overall = "DEGRADED"
} else {
    $results.overall = "HEALTHY"
}

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "  Overall Status: $($results.overall)" -ForegroundColor $(
    if ($results.overall -eq "HEALTHY") { "Green" }
    elseif ($results.overall -eq "DEGRADED") { "Yellow" }
    else { "Red" }
)
Write-Host "========================================" -ForegroundColor Cyan

# Save results to file
$results | ConvertTo-Json -Depth 4 | Out-File -FilePath "system-health-report.json" -Encoding UTF8
Write-Host "`nReport saved to: system-health-report.json" -ForegroundColor Gray

if ($unhealthy.Count -gt 0) { exit 1 } else { exit 0 }
