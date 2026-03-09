# setup-and-run.ps1
# Complete setup and run script for ProxySocialHub backend

param(
    [switch]$FirstTime,
    [switch]$Reset,
    [switch]$Test,
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
    Write-Host "${CYAN}║           PROXYSOCIALHUB - BACKEND SETUP                       ║${NC}"
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

function Pause {
    Write-Host ""
    Read-Host "Press Enter to continue"
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
    Write-Host "${RED}Please install missing prerequisites:${NC}"
    Write-Host "  - Docker Desktop: https://www.docker.com/products/docker-desktop"
    Write-Host "  - Git: https://git-scm.com/downloads"
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

if ($Reset -or $FirstTime) {
    if (Test-Path ".env") {
        $backupName = ".env.backup.$(Get-Date -Format 'yyyyMMdd_HHmmss')"
        Copy-Item ".env" $backupName
        Write-Host "  ${YELLOW}!${NC} Backed up existing .env to $backupName"
    }
}

if (-not (Test-Path ".env") -or $Reset -or $FirstTime) {
    Write-Host "  ${YELLOW}!${NC} Creating secure environment configuration..."
    
    # Generate secrets
    $jwtSecret = -join ((1..64) | ForEach-Object { '{0:x}' -f (Get-Random -Maximum 16) })
    $sessionSecret = -join ((1..64) | ForEach-Object { '{0:x}' -f (Get-Random -Maximum 16) })
    $encryptionKey = [Convert]::ToBase64String((New-Object byte[] 32 | ForEach-Object { Get-Random -Maximum 256 }))
    $redisPassword = -join ((1..32) | ForEach-Object { [char](Get-Random -Minimum 33 -Maximum 126) })
    
    $envMode = if ($ProductionMode) { "production" } else { "development" }
    $corsOrigins = if ($ProductionMode) { "https://yourdomain.com" } else { "http://localhost:3000,http://127.0.0.1:3000" }
    
    $envContent = @"
# ProxySocialHub Environment Configuration
# Generated: $(Get-Date -Format "yyyy-MM-dd HH:mm:ss")

# ============================================
# SECURITY SECRETS (DO NOT SHARE)
# ============================================
JWT_SECRET=$jwtSecret
SESSION_SECRET=$sessionSecret
ENCRYPTION_KEY=$encryptionKey
REDIS_PASSWORD=$redisPassword

# ============================================
# DATABASE
# ============================================
DATABASE_URL=postgresql://proxyhubb:proxyhubb@postgres:5432/proxyhubb?sslmode=disable
POSTGRES_USER=proxyhubb
POSTGRES_PASSWORD=proxyhubb
POSTGRES_DB=proxyhubb

# ============================================
# REDIS
# ============================================
REDIS_URL=redis://:$redisPassword@redis:6379

# ============================================
# APPLICATION
# ============================================
APP_ENV=$envMode
PORT=8080
API_BASE_URL=http://localhost:8080
FRONTEND_URL=http://localhost:3000
CORS_ORIGINS=$corsOrigins

# ============================================
# EXTERNAL SERVICES (Fill in as needed)
# ============================================
# SUPABASE_URL=
# SUPABASE_ANON_KEY=
# SUPABASE_SERVICE_KEY=
# PAYSTACK_SECRET_KEY=
# PAYSTACK_PUBLIC_KEY=
# GOOGLE_CLIENT_ID=
# GOOGLE_CLIENT_SECRET=
# GITHUB_CLIENT_ID=
# GITHUB_CLIENT_SECRET=
# SMTP_HOST=
# SMTP_PORT=587
# SMTP_USER=
# SMTP_PASS=

# ============================================
# BLOCKCHAIN
# ============================================
SOLANA_RPC_ENDPOINT=https://api.devnet.solana.com
SOLANA_NETWORK=devnet
# SOLANA_PROGRAM_ID=
# SOLANA_TREASURY_ADDRESS=
# ORACLE_PRIVATE_KEY=
# PROVIDER_PRIVATE_KEY=
"@
    
    $envContent | Out-File -FilePath ".env" -Encoding UTF8
    
    # Set secure permissions
    $envFile = Get-Item ".env"
    $envFile.Attributes = $envFile.Attributes -bor [System.IO.FileAttributes]::Hidden
    
    Write-Host "  ${GREEN}✓${NC} .env created with secure secrets"
    Write-Host "  ${YELLOW}!${NC} Review .env and fill in external service credentials as needed"
} else {
    Write-Host "  ${GREEN}✓${NC} .env exists"
}

# Step 2: Git Hooks Setup
Write-Step -Number "2" -Message "Installing Git Hooks"

if (Test-Path "scripts/install-git-hooks.ps1") {
    & "scripts/install-git-hooks.ps1" -Force
    Write-Host "  ${GREEN}✓${NC} Git hooks installed"
} else {
    Write-Host "  ${YELLOW}!${NC} Git hooks script not found, skipping"
}

# Step 3: Build Images
Write-Step -Number "3" -Message "Building Docker Images"

Write-Host "  This may take a few minutes..."

$composeFile = if ($ProductionMode) { "docker-compose.secure.yml" } else { "docker-compose.dev.yml" }

try {
    docker-compose -f $composeFile build --no-cache 2>&1 | ForEach-Object {
        if ($_ -match "ERROR|error") {
            Write-Host "  ${RED}!${NC} $_" -NoNewline
        } elseif ($_ -match "Successfully built|digest") {
            Write-Host "  ${GREEN}✓${NC} Build step complete"
        }
    }
    
    Write-Host "  ${GREEN}✓${NC} Docker images built successfully"
} catch {
    Write-Host "  ${RED}✗${NC} Build failed: $_"
    exit 1
}

# Step 4: Start Services
Write-Step -Number "4" -Message "Starting Services"

docker-compose -f $composeFile down --remove-orphans 2>&1 | Out-Null

docker-compose -f $composeFile up -d 2>&1 | ForEach-Object {
    if ($_ -match "Creating|Starting") {
        Write-Host "  ${CYAN}→${NC} $_" -NoNewline
    }
}

Write-Host ""
Write-Host "  Waiting for services to be ready..."

# Wait for health checks
$servicesReady = $false
$attempts = 0
$maxAttempts = 30

while (-not $servicesReady -and $attempts -lt $maxAttempts) {
    $attempts++
    Start-Sleep -Seconds 2
    
    try {
        $response = Invoke-WebRequest -Uri "http://localhost:8080/health" -Method GET -TimeoutSec 2 -ErrorAction SilentlyContinue
        if ($response.StatusCode -eq 200) {
            $servicesReady = $true
        }
    } catch {
        Write-Host "  Checking... ($attempts/$maxAttempts)" -NoNewline
    }
}

Write-Host ""

if ($servicesReady) {
    Write-Host "  ${GREEN}✓${NC} All services are healthy"
} else {
    Write-Host "  ${RED}✗${NC} Services failed to start within timeout"
    Write-Host "  Check logs: docker-compose -f $composeFile logs"
    exit 1
}

# Step 5: Run Tests
if ($Test) {
    Write-Step -Number "5" -Message "Running Tests"
    
    if (Test-Path "scripts/test-api.ps1") {
        & "scripts/test-api.ps1"
    } else {
        Write-Host "  ${YELLOW}!${NC} Test script not found, skipping"
    }
}

# Step 6: Display Summary
Write-Step -Number "COMPLETE" -Message "Setup Finished"

Write-Host ""
Write-Host "${GREEN}╔════════════════════════════════════════════════════════════════╗${NC}"
Write-Host "${GREEN}║           SYSTEM READY                                         ║${NC}"
Write-Host "${GREEN}╚════════════════════════════════════════════════════════════════╝${NC}"
Write-Host ""

Write-Host "${CYAN}Services:${NC}"
Write-Host "  ${GREEN}●${NC} Control API:    http://localhost:8080"
Write-Host "  ${GREEN}●${NC} Health Check:   http://localhost:8080/health"
Write-Host "  ${GREEN}●${NC} Prometheus:     http://localhost:9090"
Write-Host "  ${GREEN}●${NC} Grafana:        http://localhost:3001 (admin/admin)"
Write-Host "  ${GREEN}●${NC} Proxy Gateway:  localhost:3128"

Write-Host ""
Write-Host "${CYAN}Quick Commands:${NC}"
Write-Host "  View logs:      docker-compose -f $composeFile logs -f"
Write-Host "  Stop:           docker-compose -f $composeFile down"
Write-Host "  Restart:        docker-compose -f $composeFile restart"
Write-Host "  Test API:       .\scripts\test-api.ps1"

Write-Host ""
Write-Host "${CYAN}Security Notes:${NC}"
Write-Host "  • Dev login is $(if($ProductionMode){'DISABLED'}else{'enabled (dev mode)'})"
Write-Host "  • JWT secrets are $(if((Get-Content .env | Select-String 'JWT_SECRET=').Length -gt 0){'configured'}else{'MISSING'})"
Write-Host "  • Redis password is $(if((Get-Content .env | Select-String 'REDIS_PASSWORD=').Length -gt 0){'configured'}else{'MISSING'})"

Write-Host ""
Write-Host "${YELLOW}⚠️  IMPORTANT:${NC}"
Write-Host "  • Keep your .env file secure and never commit it"
Write-Host "  • Rotate credentials regularly"
Write-Host "  • Monitor logs for suspicious activity"

Write-Host ""
Write-Host "${GREEN}Happy building! 🚀${NC}"
Write-Host ""
