# setup-full-stack.ps1
# Complete setup and run script for ProxySocialHub full stack
# Includes: Control API, Edge Gateway, Web App, and Infrastructure

param(
    [switch]$Build,
    [switch]$SkipWeb,
    [switch]$ProductionMode
)

$ErrorActionPreference = "Stop"

$GREEN = "`e[32m"
$RED = "`e[31m"
$YELLOW = "`e[33m"
$CYAN = "`e[36m"
$NC = "`e[0m"

function Write-Banner {
    Clear-Host
    Write-Host "${CYAN}╔════════════════════════════════════════════════════════════════╗${NC}"
    Write-Host "${CYAN}║                                                                ║${NC}"
    Write-Host "${CYAN}║           PROXYSOCIALHUB - FULL STACK SETUP                    ║${NC}"
    Write-Host "${CYAN}║                                                                ║${NC}"
    Write-Host "${CYAN}╚════════════════════════════════════════════════════════════════╝${NC}"
    Write-Host ""
}

function Write-Step {
    param($Number, $Message)
    Write-Host ""
    Write-Host "${CYAN}Step $Number: $Message${NC}"
    Write-Host "${CYAN}$('=' * 60)${NC}"
}

Write-Banner

# Step 0: Prerequisites Check
Write-Step -Number "0" -Message "Checking Prerequisites"

$checks = @(
    @{ Name = "Docker"; Command = "docker" },
    @{ Name = "Docker Compose"; Command = "docker-compose" },
    @{ Name = "Git"; Command = "git" }
)

$allPassed = $true
foreach ($check in $checks) {
    if (Get-Command $check.Command -ErrorAction SilentlyContinue) {
        Write-Host "  ${GREEN}✓${NC} $($check.Name) found"
    } else {
        Write-Host "  ${RED}✗${NC} $($check.Name) NOT found"
        $allPassed = $false
    }
}

if (-not $allPassed) {
    Write-Host ""
    Write-Host "${RED}Please install missing prerequisites${NC}"
    exit 1
}

# Check Docker is running
try {
    $null = docker info 2>&1
    Write-Host "  ${GREEN}✓${NC} Docker is running"
} catch {
    Write-Host "  ${RED}✗${NC} Docker is not running. Please start Docker Desktop."
    exit 1
}

# Step 1: Environment Setup
Write-Step -Number "1" -Message "Environment Setup"

if (-not (Test-Path ".env")) {
    Write-Host "  ${YELLOW}!${NC} Creating .env file..."
    
    # Generate URL-safe secrets
    $jwtSecret = -join ((1..64) | ForEach-Object { '{0:x}' -f (Get-Random -Maximum 16) })
    $sessionSecret = -join ((1..32) | ForEach-Object { '{0:x}' -f (Get-Random -Maximum 16) })
    $encryptionKey = [Convert]::ToBase64String((1..32 | ForEach-Object { Get-Random -Maximum 256 } | ForEach-Object { [byte]$_ }))
    $redisPassword = -join ((1..32) | ForEach-Object { '{0:x}' -f (Get-Random -Maximum 16) })
    $grafanaPassword = -join ((1..16) | ForEach-Object { '{0:x}' -f (Get-Random -Maximum 16) })
    
    $envContent = @"
# ProxySocialHub Full Stack Environment
# Generated: $(Get-Date -Format "yyyy-MM-dd HH:mm:ss")

# ============================================
# SECURITY SECRETS (DO NOT SHARE)
# ============================================
JWT_SECRET=$jwtSecret
SESSION_SECRET=$sessionSecret
ENCRYPTION_KEY=$encryptionKey
REDIS_PASSWORD=$redisPassword
GRAFANA_PASSWORD=$grafanaPassword

# ============================================
# DATABASE
# ============================================
DATABASE_URL=postgresql://proxyhubb:proxyhubb@localhost:5432/proxyhubb?sslmode=disable
POSTGRES_USER=proxyhubb
POSTGRES_PASSWORD=proxyhubb
POSTGRES_DB=proxyhubb

# ============================================
# REDIS
# ============================================
REDIS_URL=redis://:$redisPassword@localhost:6379

# ============================================
# APPLICATION
# ============================================
APP_ENV=development
PORT=8080
API_BASE_URL=http://localhost:8080
FRONTEND_URL=http://localhost:3000
CORS_ORIGINS=http://localhost:3000,http://127.0.0.1:3000

# ============================================
# BLOCKCHAIN
# ============================================
SOLANA_RPC_ENDPOINT=https://api.devnet.solana.com
SOLANA_NETWORK=devnet
PROVIDER_PRIVATE_KEY=
"@
    
    $envContent | Out-File -FilePath ".env" -Encoding UTF8
    Write-Host "  ${GREEN}✓${NC} .env created with secure secrets"
} else {
    Write-Host "  ${GREEN}✓${NC} .env exists"
}

# Load environment variables
Get-Content .env | ForEach-Object {
    if ($_ -match '^([^#][^=]*)=(.*)$') {
        [Environment]::SetEnvironmentVariable($matches[1], $matches[2], "Process")
    }
}

# Step 2: Build Services
Write-Step -Number "2" -Message "Building Services"

$composeFile = "docker-compose.full.yml"

if ($Build) {
    Write-Host "  Building all services..."
    docker-compose -f $composeFile build --no-cache 2>&1 | ForEach-Object {
        if ($_ -match "Successfully built|done$") {
            Write-Host "  ${GREEN}✓${NC} $_" -NoNewline
        }
    }
} else {
    Write-Host "  Using cached builds (use -Build to force rebuild)"
}

# Step 3: Start Infrastructure
Write-Step -Number "3" -Message "Starting Infrastructure"

docker-compose -f $composeFile up -d redis postgres 2>&1 | Out-Null

Write-Host "  Waiting for infrastructure to be ready..."
$attempts = 0
$maxAttempts = 30
$ready = $false

while (-not $ready -and $attempts -lt $maxAttempts) {
    $attempts++
    Start-Sleep -Seconds 2
    
    $redisHealthy = docker-compose -f $composeFile ps redis | Select-String "healthy"
    $postgresHealthy = docker-compose -f $composeFile ps postgres | Select-String "healthy"
    
    if ($redisHealthy -and $postgresHealthy) {
        $ready = $true
    } else {
        Write-Host "  Checking... ($attempts/$maxAttempts)" -NoNewline
    }
}

Write-Host ""

if ($ready) {
    Write-Host "  ${GREEN}✓${NC} Infrastructure is healthy"
} else {
    Write-Host "  ${RED}✗${NC} Infrastructure failed to start"
    exit 1
}

# Step 4: Start Control API
Write-Step -Number "4" -Message "Starting Control API"

docker-compose -f $composeFile up -d control-api 2>&1 | Out-Null

Write-Host "  Waiting for Control API..."
$attempts = 0
$ready = $false

while (-not $ready -and $attempts -lt $maxAttempts) {
    $attempts++
    Start-Sleep -Seconds 2
    
    try {
        $response = Invoke-WebRequest -Uri "http://localhost:8080/health" -Method GET -TimeoutSec 2 -ErrorAction SilentlyContinue
        if ($response.StatusCode -eq 200) {
            $ready = $true
        }
    } catch {
        Write-Host "  Checking... ($attempts/$maxAttempts)" -NoNewline
    }
}

Write-Host ""

if ($ready) {
    Write-Host "  ${GREEN}✓${NC} Control API is healthy"
} else {
    Write-Host "  ${RED}✗${NC} Control API failed to start"
    docker-compose -f $composeFile logs control-api | Select-Object -Last 20
    exit 1
}

# Step 5: Start Edge Gateway
Write-Step -Number "5" -Message "Starting Edge Gateway"

docker-compose -f $composeFile up -d edge-gateway 2>&1 | Out-Null

Write-Host "  Waiting for Edge Gateway..."
$attempts = 0
$ready = $false

while (-not $ready -and $attempts -lt $maxAttempts) {
    $attempts++
    Start-Sleep -Seconds 2
    
    try {
        $response = Invoke-WebRequest -Uri "http://localhost:8090/health" -Method GET -TimeoutSec 2 -ErrorAction SilentlyContinue
        if ($response.StatusCode -eq 200) {
            $ready = $true
        }
    } catch {
        Write-Host "  Checking... ($attempts/$maxAttempts)" -NoNewline
    }
}

Write-Host ""

if ($ready) {
    Write-Host "  ${GREEN}✓${NC} Edge Gateway is healthy"
} else {
    Write-Host "  ${RED}✗${NC} Edge Gateway failed to start"
    docker-compose -f $composeFile logs edge-gateway | Select-Object -Last 20
    exit 1
}

# Step 6: Start Web App (optional)
if (-not $SkipWeb) {
    Write-Step -Number "6" -Message "Starting Web App"
    
    docker-compose -f $composeFile up -d web 2>&1 | Out-Null
    
    Write-Host "  Waiting for Web App..."
    $attempts = 0
    $ready = $false
    
    while (-not $ready -and $attempts -lt $maxAttempts) {
        $attempts++
        Start-Sleep -Seconds 2
        
        try {
            $response = Invoke-WebRequest -Uri "http://localhost:3000/api/health" -Method GET -TimeoutSec 2 -ErrorAction SilentlyContinue
            if ($response.StatusCode -eq 200) {
                $ready = $true
            }
        } catch {
            Write-Host "  Checking... ($attempts/$maxAttempts)" -NoNewline
        }
    }
    
    Write-Host ""
    
    if ($ready) {
        Write-Host "  ${GREEN}✓${NC} Web App is healthy"
    } else {
        Write-Host "  ${YELLOW}!${NC} Web App may still be starting (check logs)"
    }
} else {
    Write-Host "  ${YELLOW}!${NC} Skipping Web App (use -SkipWeb to skip)"
}

# Step 7: Start Monitoring
Write-Step -Number "7" -Message "Starting Monitoring (Prometheus + Grafana)"

docker-compose -f $composeFile up -d prometheus grafana 2>&1 | Out-Null
Write-Host "  ${GREEN}✓${NC} Monitoring started"

# Summary
Write-Host ""
Write-Host "${GREEN}╔════════════════════════════════════════════════════════════════╗${NC}"
Write-Host "${GREEN}║           FULL STACK READY! 🚀                                 ║${NC}"
Write-Host "${GREEN}╚════════════════════════════════════════════════════════════════╝${NC}"
Write-Host ""

Write-Host "${CYAN}Services:${NC}"
Write-Host "  ${GREEN}●${NC} Control API:    http://localhost:8080"
Write-Host "  ${GREEN}●${NC} Edge Gateway:   http://localhost:8090 (API)"
Write-Host "  ${GREEN}●${NC} Proxy Port:     localhost:3128 (SOCKS5/HTTP)"
if (-not $SkipWeb) {
    Write-Host "  ${GREEN}●${NC} Web App:        http://localhost:3000"
}
Write-Host "  ${GREEN}●${NC} Prometheus:     http://localhost:9090"
Write-Host "  ${GREEN}●${NC} Grafana:        http://localhost:3001 (admin/${env:GRAFANA_PASSWORD})"

Write-Host ""
Write-Host "${CYAN}Quick Commands:${NC}"
Write-Host "  View logs:      docker-compose -f $composeFile logs -f"
Write-Host "  Stop:           docker-compose -f $composeFile down"
Write-Host "  Restart:        docker-compose -f $composeFile restart"
Write-Host "  Scale API:      docker-compose -f $composeFile up -d --scale control-api=3"

Write-Host ""
Write-Host "${CYAN}Test Commands:${NC}"
Write-Host "  API Health:     curl http://localhost:8080/health"
Write-Host "  Gateway Health: curl http://localhost:8090/health"
Write-Host "  Proxy Test:     curl -x http://localhost:3128 http://httpbin.org/ip"

Write-Host ""
Write-Host "${GREEN}Happy building! 🎉${NC}"
Write-Host ""
