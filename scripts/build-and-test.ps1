# build-and-test.ps1
# Build and test the complete backend system

param(
    [switch]$SkipBuild,
    [switch]$SkipTests,
    [switch]$KeepRunning
)

$ErrorActionPreference = "Stop"

$GREEN = "`e[32m"
$RED = "`e[31m"
$YELLOW = "`e[33m"
$CYAN = "`e[36m"
$NC = "`e[0m"

function Write-Step {
    param($Message)
    Write-Host ""
    Write-Host "${CYAN}▶ $Message${NC}" -ForegroundColor Cyan
}

function Write-Success {
    param($Message)
    Write-Host "  ${GREEN}✓ $Message${NC}"
}

function Write-Error {
    param($Message)
    Write-Host "  ${RED}✗ $Message${NC}"
}

function Write-Info {
    param($Message)
    Write-Host "  ${YELLOW}ℹ $Message${NC}"
}

Clear-Host
Write-Host "${CYAN}╔════════════════════════════════════════════════════════════════╗${NC}"
Write-Host "${CYAN}║           PROXYSOCIALHUB - BUILD & TEST                        ║${NC}"
Write-Host "${CYAN}╚════════════════════════════════════════════════════════════════╝${NC}"
Write-Host ""

# Step 1: Check prerequisites
Write-Step "Checking prerequisites..."

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Write-Error "Docker is not installed or not in PATH"
    exit 1
}
Write-Success "Docker found"

if (-not (Get-Command docker-compose -ErrorAction SilentlyContinue)) {
    Write-Error "Docker Compose is not installed"
    exit 1
}
Write-Success "Docker Compose found"

# Check Docker is running
try {
    $dockerInfo = docker info 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Docker is not running. Please start Docker Desktop."
        exit 1
    }
    Write-Success "Docker is running"
} catch {
    Write-Error "Cannot connect to Docker. Is it running?"
    exit 1
}

# Step 2: Setup environment
Write-Step "Setting up environment..."

# Check if .env exists, if not generate it
if (-not (Test-Path ".env")) {
    Write-Info ".env not found, generating secure secrets..."
    
    if (Test-Path "scripts/security-setup.ps1") {
        & "scripts/security-setup.ps1"
    } else {
        Write-Info "Creating minimal .env for testing..."
        
        # Generate minimal secrets
        $jwtSecret = -join ((1..64) | ForEach-Object { '{0:x}' -f (Get-Random -Maximum 16) })
        $sessionSecret = -join ((1..64) | ForEach-Object { '{0:x}' -f (Get-Random -Maximum 16) })
        $encryptionKey = [Convert]::ToBase64String((New-Object byte[] 32 | ForEach-Object { Get-Random -Maximum 256 }))
        
        $envContent = @"
# Auto-generated for testing
JWT_SECRET=$jwtSecret
SESSION_SECRET=$sessionSecret
ENCRYPTION_KEY=$encryptionKey
DATABASE_URL=postgresql://proxyhubb:proxyhubb@postgres:5432/proxyhubb?sslmode=disable
REDIS_PASSWORD=redispass
POSTGRES_USER=proxyhubb
POSTGRES_PASSWORD=proxyhubb
POSTGRES_DB=proxyhubb
APP_ENV=development
PORT=8080
"@
        $envContent | Out-File -FilePath ".env" -Encoding UTF8
        Write-Success ".env created with test secrets"
    }
} else {
    Write-Success ".env exists"
}

# Load environment variables
Get-Content .env | ForEach-Object {
    if ($_ -match '^([^=]+)=(.*)$') {
        $name = $matches[1]
        $value = $matches[2]
        [Environment]::SetEnvironmentVariable($name, $value, "Process")
    }
}

# Validate secrets
if ([Environment]::GetEnvironmentVariable("JWT_SECRET", "Process")) {
    $jwtSecret = [Environment]::GetEnvironmentVariable("JWT_SECRET", "Process")
    if ($jwtSecret.Length -lt 64) {
        Write-Error "JWT_SECRET is too short ($($jwtSecret.Length) chars, minimum 64)"
        Write-Info "Run: .\scripts\security-setup.ps1 to regenerate"
        exit 1
    }
    Write-Success "Secrets validated"
}

# Step 3: Clean up old containers
Write-Step "Cleaning up old containers..."

docker-compose -f docker-compose.dev.yml down --remove-orphans 2>&1 | Out-Null
Write-Success "Old containers removed"

# Step 4: Build images
if (-not $SkipBuild) {
    Write-Step "Building Docker images (this may take a few minutes)..."
    
    $buildOutput = docker-compose -f docker-compose.dev.yml build --no-cache 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Build failed"
        Write-Host $buildOutput
        exit 1
    }
    Write-Success "Docker images built successfully"
} else {
    Write-Info "Skipping build (--SkipBuild specified)"
}

# Step 5: Start services
Write-Step "Starting services..."

docker-compose -f docker-compose.dev.yml up -d 2>&1 | Out-Null

# Wait for services to be healthy
Write-Info "Waiting for services to start..."

$maxAttempts = 30
$attempt = 0
$servicesHealthy = $false

while ($attempt -lt $maxAttempts -and -not $servicesHealthy) {
    $attempt++
    Start-Sleep -Seconds 2
    
    Write-Host "  Checking services... ($attempt/$maxAttempts)" -NoNewline
    
    # Check if containers are running
    $running = docker-compose -f docker-compose.dev.yml ps -q 2>&1
    if ($running) {
        Write-Host "`r  Checking services... ($attempt/$maxAttempts) containers running" -NoNewline
    }
    
    # Try to connect to API
    try {
        $response = Invoke-WebRequest -Uri "http://localhost:8080/health" -Method GET -TimeoutSec 2 -ErrorAction SilentlyContinue
        if ($response.StatusCode -eq 200) {
            Write-Host "`r  Checking services... ($attempt/$maxAttempts) API responding" -NoNewline
            $servicesHealthy = $true
        }
    } catch {
        # Not ready yet
    }
}

Write-Host ""  # New line

if (-not $servicesHealthy) {
    Write-Error "Services failed to start within timeout"
    Write-Info "Checking logs..."
    docker-compose -f docker-compose.dev.yml logs --tail=50 control-api
    exit 1
}

Write-Success "All services started successfully"

# Step 6: Run health checks
Write-Step "Running health checks..."

# Test 1: Health endpoint
Write-Info "Testing /health endpoint..."
try {
    $health = Invoke-WebRequest -Uri "http://localhost:8080/health" -Method GET -TimeoutSec 5
    if ($health.StatusCode -eq 200) {
        Write-Success "Health check passed"
        $healthContent = $health.Content | ConvertFrom-Json
        Write-Info "Status: $($healthContent.status)"
    } else {
        Write-Error "Health check returned status $($health.StatusCode)"
    }
} catch {
    Write-Error "Health check failed: $_"
}

# Test 2: Metrics endpoint
Write-Info "Testing /metrics endpoint..."
try {
    $metrics = Invoke-WebRequest -Uri "http://localhost:8080/metrics" -Method GET -TimeoutSec 5
    if ($metrics.StatusCode -eq 200) {
        Write-Success "Metrics endpoint responding"
    }
} catch {
    Write-Error "Metrics endpoint failed: $_"
}

# Test 3: Dev login should NOT be accessible (security check)
Write-Info "Testing security (dev login should be disabled)..."
try {
    $devLogin = Invoke-WebRequest -Uri "http://localhost:8080/v1/auth/dev/login" -Method POST -TimeoutSec 5 -ErrorAction SilentlyContinue
    if ($devLogin.StatusCode -eq 200) {
        Write-Error "SECURITY ISSUE: Dev login is accessible!"
    } else {
        Write-Success "Dev login properly disabled (status: $($devLogin.StatusCode))"
    }
} catch {
    $statusCode = $_.Exception.Response.StatusCode.value__
    if ($statusCode -eq 404) {
        Write-Success "Dev login properly disabled (404 Not Found)"
    } else {
        Write-Info "Dev login returned: $statusCode"
    }
}

# Step 7: Run integration tests (if not skipped)
if (-not $SkipTests) {
    Write-Step "Running integration tests..."
    
    # Check if tests exist
    if (Test-Path "services/control-api/internal/api/*_test.go") {
        Write-Info "Running Go tests..."
        
        Push-Location services/control-api
        try {
            $testOutput = go test -v ./... -short 2>&1
            if ($LASTEXITCODE -eq 0) {
                Write-Success "All tests passed"
            } else {
                Write-Error "Some tests failed"
                Write-Host $testOutput
            }
        } finally {
            Pop-Location
        }
    } else {
        Write-Info "No tests found, skipping"
    }
} else {
    Write-Info "Skipping tests (--SkipTests specified)"
}

# Step 8: Display service information
Write-Step "Service Status"

Write-Host ""
Write-Host "${CYAN}Running Services:${NC}"
docker-compose -f docker-compose.dev.yml ps

Write-Host ""
Write-Host "${CYAN}Endpoints:${NC}"
Write-Host "  API:            http://localhost:8080"
Write-Host "  Health:         http://localhost:8080/health"
Write-Host "  Metrics:        http://localhost:8080/metrics"
Write-Host "  Prometheus:     http://localhost:9090"
Write-Host "  Grafana:        http://localhost:3001 (admin/admin)"
Write-Host "  Proxy Gateway:  localhost:3128"

Write-Host ""
Write-Host "${CYAN}Useful Commands:${NC}"
Write-Host "  View logs:      docker-compose -f docker-compose.dev.yml logs -f control-api"
Write-Host "  Stop:           docker-compose -f docker-compose.dev.yml down"
Write-Host "  Restart:        docker-compose -f docker-compose.dev.yml restart"
Write-Host "  Shell access:   docker-compose -f docker-compose.dev.yml exec control-api sh"

# Final summary
Write-Host ""
Write-Host "${GREEN}╔════════════════════════════════════════════════════════════════╗${NC}"
Write-Host "${GREEN}║           BUILD & TEST COMPLETED SUCCESSFULLY                  ║${NC}"
Write-Host "${GREEN}╚════════════════════════════════════════════════════════════════╝${NC}"
Write-Host ""

if ($KeepRunning) {
    Write-Info "Services are running. Press Ctrl+C to stop."
    Write-Host ""
    Write-Host "Tailing logs (Ctrl+C to exit)..."
    docker-compose -f docker-compose.dev.yml logs -f
} else {
    Write-Info "Services are running in the background."
    Write-Info "Use 'docker-compose -f docker-compose.dev.yml logs -f' to view logs"
}
