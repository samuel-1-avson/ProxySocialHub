#!/bin/bash
# setup-and-run.sh
# Complete setup and run script for ProxySocialHub backend (Linux/Mac)

set -e

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

FIRST_TIME=false
RESET=false
TEST=false
PRODUCTION_MODE=false

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --first-time) FIRST_TIME=true ;;
        --reset) RESET=true ;;
        --test) TEST=true ;;
        --production) PRODUCTION_MODE=true ;;
    esac
    shift
done

print_banner() {
    clear
    echo -e "${CYAN}╔════════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${CYAN}║                                                                ║${NC}"
    echo -e "${CYAN}║           PROXYSOCIALHUB - BACKEND SETUP                       ║${NC}"
    echo -e "${CYAN}║                                                                ║${NC}"
    echo -e "${CYAN}╚════════════════════════════════════════════════════════════════╝${NC}"
    echo ""
}

print_step() {
    echo ""
    echo -e "${CYAN}Step $1: $2${NC}"
    echo -e "${CYAN}$(printf '=%.0s' {1..60})${NC}"
}

print_banner

# Step 0: Prerequisites Check
print_step "0" "Checking Prerequisites"

checks=("docker" "docker-compose" "git")
all_passed=true

for cmd in "${checks[@]}"; do
    if command -v "$cmd" &> /dev/null; then
        echo -e "  ${GREEN}✓${NC} $cmd found"
    else
        echo -e "  ${RED}✗${NC} $cmd NOT found"
        all_passed=false
    fi
done

if [ "$all_passed" = false ]; then
    echo ""
    echo -e "${RED}Please install missing prerequisites:${NC}"
    echo "  - Docker: https://docs.docker.com/get-docker/"
    echo "  - Git: https://git-scm.com/downloads"
    exit 1
fi

# Check Docker is running
if ! docker info &> /dev/null; then
    echo -e "  ${RED}✗${NC} Docker is not running. Please start Docker."
    exit 1
fi
echo -e "  ${GREEN}✓${NC} Docker is running"

# Step 1: Environment Setup
print_step "1" "Environment Setup"

if [ "$RESET" = true ] || [ "$FIRST_TIME" = true ]; then
    if [ -f ".env" ]; then
        backup_name=".env.backup.$(date +%Y%m%d_%H%M%S)"
        cp .env "$backup_name"
        echo -e "  ${YELLOW}!${NC} Backed up existing .env to $backup_name"
    fi
fi

if [ ! -f ".env" ] || [ "$RESET" = true ] || [ "$FIRST_TIME" = true ]; then
    echo -e "  ${YELLOW}!${NC} Creating secure environment configuration..."
    
    # Generate secrets
    jwt_secret=$(openssl rand -hex 32)
    session_secret=$(openssl rand -hex 32)
    encryption_key=$(openssl rand -base64 32)
    redis_password=$(openssl rand -base64 24 | tr -d '=+/')
    
    if [ "$PRODUCTION_MODE" = true ]; then
        env_mode="production"
        cors_origins="https://yourdomain.com"
    else
        env_mode="development"
        cors_origins="http://localhost:3000,http://127.0.0.1:3000"
    fi
    
    cat > .env << EOF
# ProxySocialHub Environment Configuration
# Generated: $(date +"%Y-%m-%d %H:%M:%S")

# ============================================
# SECURITY SECRETS (DO NOT SHARE)
# ============================================
JWT_SECRET=$jwt_secret
SESSION_SECRET=$session_secret
ENCRYPTION_KEY=$encryption_key
REDIS_PASSWORD=$redis_password

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
REDIS_URL=redis://:$redis_password@redis:6379

# ============================================
# APPLICATION
# ============================================
APP_ENV=$env_mode
PORT=8080
API_BASE_URL=http://localhost:8080
FRONTEND_URL=http://localhost:3000
CORS_ORIGINS=$cors_origins

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
EOF
    
    chmod 600 .env
    echo -e "  ${GREEN}✓${NC} .env created with secure secrets"
else
    echo -e "  ${GREEN}✓${NC} .env exists"
fi

# Step 2: Build Images
print_step "2" "Building Docker Images"

echo -e "  This may take a few minutes..."

if [ "$PRODUCTION_MODE" = true ]; then
    compose_file="docker-compose.secure.yml"
else
    compose_file="docker-compose.dev.yml"
fi

if docker-compose -f "$compose_file" build --no-cache 2>&1 | tee /tmp/build.log; then
    echo -e "  ${GREEN}✓${NC} Docker images built successfully"
else
    echo -e "  ${RED}✗${NC} Build failed"
    cat /tmp/build.log
    exit 1
fi

# Step 3: Start Services
print_step "3" "Starting Services"

docker-compose -f "$compose_file" down --remove-orphans 2>/dev/null || true

docker-compose -f "$compose_file" up -d

echo ""
echo "  Waiting for services to be ready..."

# Wait for health checks
services_ready=false
attempts=0
max_attempts=30

while [ "$services_ready" = false ] && [ $attempts -lt $max_attempts ]; do
    attempts=$((attempts + 1))
    sleep 2
    
    if curl -s http://localhost:8080/health > /dev/null 2>&1; then
        services_ready=true
    else
        printf "  Checking... (%d/%d)\r" "$attempts" "$max_attempts"
    fi
done

echo ""

if [ "$services_ready" = true ]; then
    echo -e "  ${GREEN}✓${NC} All services are healthy"
else
    echo -e "  ${RED}✗${NC} Services failed to start within timeout"
    echo "  Check logs: docker-compose -f $compose_file logs"
    exit 1
fi

# Step 4: Run Tests
if [ "$TEST" = true ]; then
    print_step "4" "Running Tests"
    
    if [ -f "scripts/test-api.sh" ]; then
        chmod +x scripts/test-api.sh
        ./scripts/test-api.sh
    else
        echo -e "  ${YELLOW}!${NC} Test script not found, skipping"
    fi
fi

# Display Summary
print_step "COMPLETE" "Setup Finished"

echo ""
echo -e "${GREEN}╔════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║           SYSTEM READY                                         ║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════════════════════════════╝${NC}"
echo ""

echo -e "${CYAN}Services:${NC}"
echo -e "  ${GREEN}●${NC} Control API:    http://localhost:8080"
echo -e "  ${GREEN}●${NC} Health Check:   http://localhost:8080/health"
echo -e "  ${GREEN}●${NC} Prometheus:     http://localhost:9090"
echo -e "  ${GREEN}●${NC} Grafana:        http://localhost:3001 (admin/admin)"
echo -e "  ${GREEN}●${NC} Proxy Gateway:  localhost:3128"

echo ""
echo -e "${CYAN}Quick Commands:${NC}"
echo -e "  View logs:      docker-compose -f $compose_file logs -f"
echo -e "  Stop:           docker-compose -f $compose_file down"
echo -e "  Restart:        docker-compose -f $compose_file restart"
echo -e "  Test API:       ./scripts/test-api.sh"

echo ""
echo -e "${CYAN}Security Notes:${NC}"
if [ "$PRODUCTION_MODE" = true ]; then
    echo -e "  • Dev login is DISABLED"
else
    echo -e "  • Dev login is enabled (dev mode)"
fi
echo -e "  • JWT secrets are configured"
echo -e "  • Redis password is configured"

echo ""
echo -e "${YELLOW}⚠️  IMPORTANT:${NC}"
echo -e "  • Keep your .env file secure and never commit it"
echo -e "  • Rotate credentials regularly"
echo -e "  • Monitor logs for suspicious activity"

echo ""
echo -e "${GREEN}Happy building! 🚀${NC}"
echo ""
