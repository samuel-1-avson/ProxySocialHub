#!/bin/bash
# Test Docker setup for new financial engine features

set -e

echo "=========================================="
echo "ProxyHubb Docker Test Script"
echo "=========================================="
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if oracle keypair exists
if [ ! -f "oracle-keypair.json" ]; then
    echo -e "${YELLOW}WARNING: oracle-keypair.json not found${NC}"
    echo "Creating dummy keypair for testing..."
    # Generate a dummy keypair (64 zeros - not valid for mainnet but works for dev/testing)
    python3 -c "import json; json.dump([0]*64, open('oracle-keypair.json', 'w'))"
    echo -e "${YELLOW}Note: This is a test keypair. Replace with real keypair for production.${NC}"
fi

# Function to check if a port is in use
check_port() {
    local port=$1
    if lsof -Pi :$port -sTCP:LISTEN -t >/dev/null 2>&1; then
        echo -e "${RED}ERROR: Port $port is already in use${NC}"
        return 1
    fi
    return 0
}

# Check required ports
echo "Checking ports..."
check_port 8080 || exit 1
check_port 5433 || exit 1
check_port 6380 || exit 1

echo -e "${GREEN}All ports available${NC}"
echo ""

# Build images
echo "Building Docker images..."
docker-compose -f docker-compose.test.yml build

echo ""
echo "Starting test environment..."
docker-compose -f docker-compose.test.yml up -d postgres redis

echo ""
echo "Waiting for database to be ready..."
sleep 5

# Check database health
until docker-compose -f docker-compose.test.yml exec -T postgres pg_isready -U proxyhubb -d proxyhubb_test; do
    echo "Waiting for postgres..."
    sleep 2
done

echo -e "${GREEN}Database ready!${NC}"

# Start control API
echo ""
echo "Starting Control API..."
docker-compose -f docker-compose.test.yml up -d control-api

echo ""
echo "Waiting for API to be healthy..."
sleep 10

# Check API health
if curl -s http://localhost:8080/health > /dev/null 2>&1; then
    echo -e "${GREEN}API is healthy!${NC}"
else
    echo -e "${YELLOW}API health check pending, checking logs...${NC}"
    docker-compose -f docker-compose.test.yml logs --tail=20 control-api
fi

echo ""
echo "=========================================="
echo -e "${GREEN}Test environment is ready!${NC}"
echo "=========================================="
echo ""
echo "Services:"
echo "  - Control API: http://localhost:8080"
echo "  - PostgreSQL:  localhost:5433"
echo "  - Redis:       localhost:6380"
echo ""
echo "Test endpoints:"
echo "  - Health:     curl http://localhost:8080/health"
echo "  - SOL Price:  curl http://localhost:8080/v1/pricing/sol"
echo "  - Sources:    curl http://localhost:8080/v1/admin/pricing/sources"
echo ""
echo "To run tests:"
echo "  docker-compose -f docker-compose.test.yml --profile test up test-runner"
echo ""
echo "To view logs:"
echo "  docker-compose -f docker-compose.test.yml logs -f control-api"
echo ""
echo "To stop:"
echo "  docker-compose -f docker-compose.test.yml down -v"
echo ""
