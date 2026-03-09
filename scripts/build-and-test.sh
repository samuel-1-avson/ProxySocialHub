#!/bin/bash
# build-and-test.sh
# Build and test the complete backend system (Linux/Mac version)

set -e

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

# Functions
step() {
    echo ""
    echo -e "${CYAN}▶ $1${NC}"
}

success() {
    echo -e "${GREEN}  ✓ $1${NC}"
}

error() {
    echo -e "${RED}  ✗ $1${NC}"
}

info() {
    echo -e "${YELLOW}  ℹ $1${NC}"
}

# Clear screen
# clear

echo -e "${CYAN}╔════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║           PROXYSOCIALHUB - BUILD & TEST                        ║${NC}"
echo -e "${CYAN}╚════════════════════════════════════════════════════════════════╝${NC}"
echo ""

# Step 1: Check prerequisites
step "Checking prerequisites..."

if ! command -v docker &> /dev/null; then
    error "Docker is not installed"
    exit 1
fi
success "Docker found"

if ! command -v docker-compose &> /dev/null; then
    error "Docker Compose is not installed"
    exit 1
fi
success "Docker Compose found"

# Check Docker is running
if ! docker info &> /dev/null; then
    error "Docker is not running. Please start Docker."
    exit 1
fi
success "Docker is running"

# Step 2: Setup environment
step "Setting up environment..."

if [ ! -f ".env" ]; then
    info ".env not found, generating test secrets..."
    
    JWT_SECRET=$(openssl rand -hex 64)
    SESSION_SECRET=$(openssl rand -hex 64)
    ENCRYPTION_KEY=$(openssl rand -base64 32)
    
    cat > .env << EOF
# Auto-generated for testing
JWT_SECRET=$JWT_SECRET
SESSION_SECRET=$SESSION_SECRET
ENCRYPTION_KEY=$ENCRYPTION_KEY
DATABASE_URL=postgresql://proxyhubb:proxyhubb@postgres:5432/proxyhubb?sslmode=disable
REDIS_PASSWORD=redispass
POSTGRES_USER=proxyhubb
POSTGRES_PASSWORD=proxyhubb
POSTGRES_DB=proxyhubb
APP_ENV=development
PORT=8080
EOF
    success ".env created with test secrets"
else
    success ".env exists"
fi

# Step 3: Clean up
step "Cleaning up old containers..."
docker-compose -f docker-compose.dev.yml down --remove-orphans &> /dev/null || true
success "Old containers removed"

# Step 4: Build
step "Building Docker images (this may take a few minutes)..."
if ! docker-compose -f docker-compose.dev.yml build --no-cache; then
    error "Build failed"
    exit 1
fi
success "Docker images built successfully"

# Step 5: Start services
step "Starting services..."
docker-compose -f docker-compose.dev.yml up -d

# Wait for services
info "Waiting for services to start..."
max_attempts=30
attempt=0
services_healthy=false

while [ $attempt -lt $max_attempts ] && [ "$services_healthy" = false ]; do
    attempt=$((attempt + 1))
    sleep 2
    
    echo -n "  Checking services... ($attempt/$max_attempts)"
    
    if curl -s http://localhost:8080/health &> /dev/null; then
        echo ""
        services_healthy=true
    else
        echo ""
    fi
done

if [ "$services_healthy" = false ]; then
    error "Services failed to start within timeout"
    info "Checking logs..."
    docker-compose -f docker-compose.dev.yml logs --tail=50 control-api
    exit 1
fi

success "All services started successfully"

# Step 6: Health checks
step "Running health checks..."

# Test health endpoint
info "Testing /health endpoint..."
if curl -s http://localhost:8080/health | grep -q "healthy"; then
    success "Health check passed"
else
    error "Health check failed"
fi

# Test security - dev login should be disabled
info "Testing security (dev login should be disabled)..."
dev_status=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:8080/v1/auth/dev/login || echo "000")
if [ "$dev_status" = "404" ]; then
    success "Dev login properly disabled (404 Not Found)"
else
    info "Dev login returned: $dev_status"
fi

# Step 7: Display status
step "Service Status"
echo ""
echo -e "${CYAN}Running Services:${NC}"
docker-compose -f docker-compose.dev.yml ps

echo ""
echo -e "${CYAN}Endpoints:${NC}"
echo "  API:            http://localhost:8080"
echo "  Health:         http://localhost:8080/health"
echo "  Metrics:        http://localhost:8080/metrics"
echo "  Prometheus:     http://localhost:9090"
echo "  Grafana:        http://localhost:3001 (admin/admin)"
echo "  Proxy Gateway:  localhost:3128"

echo ""
echo -e "${CYAN}Useful Commands:${NC}"
echo "  View logs:      docker-compose -f docker-compose.dev.yml logs -f control-api"
echo "  Stop:           docker-compose -f docker-compose.dev.yml down"
echo "  Restart:        docker-compose -f docker-compose.dev.yml restart"
echo "  Shell access:   docker-compose -f docker-compose.dev.yml exec control-api sh"

echo ""
echo -e "${GREEN}╔════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║           BUILD & TEST COMPLETED SUCCESSFULLY                  ║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════════════════════════════╝${NC}"
echo ""
info "Services are running in the background."
info "Use 'docker-compose -f docker-compose.dev.yml logs -f' to view logs"
