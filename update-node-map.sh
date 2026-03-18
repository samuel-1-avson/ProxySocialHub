#!/bin/bash

# =============================================================================
# ProxyHubb Node Map Update Script
# =============================================================================
# This script rebuilds the web container with all the Node Map fixes
# Run this from the project root directory
# =============================================================================

set -e  # Exit on error

echo "=========================================="
echo "ProxyHubb Node Map Update"
echo "=========================================="
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${GREEN}[✓]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[!]${NC} $1"
}

print_error() {
    echo -e "${RED}[✗]${NC} $1"
}

# Check if docker-compose is available
if ! command -v docker-compose &> /dev/null; then
    print_error "docker-compose not found. Please install Docker Compose."
    exit 1
fi

# Check if we're in the right directory
if [ ! -f "docker-compose.yml" ]; then
    print_error "docker-compose.yml not found. Please run this script from the project root."
    exit 1
fi

echo "Step 1/5: Stopping current web container..."
docker-compose stop web || true
docker-compose rm -f web || true
print_status "Web container stopped"

echo ""
echo "Step 2/5: Rebuilding web container with new code..."
docker-compose build --no-cache web
print_status "Web container rebuilt successfully"

echo ""
echo "Step 3/5: Starting all services..."
docker-compose up -d
print_status "All services started"

echo ""
echo "Step 4/5: Waiting for services to be healthy..."
sleep 10

# Check if containers are running
if docker-compose ps | grep -q "Up"; then
    print_status "Containers are running"
else
    print_error "Some containers failed to start"
    docker-compose ps
    exit 1
fi

echo ""
echo "Step 5/5: Verifying API connectivity..."

# Test API
API_RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:8081/health || echo "000")
if [ "$API_RESPONSE" = "200" ]; then
    print_status "API is responding (HTTP 200)"
else
    print_warning "API returned HTTP $API_RESPONSE (may still be starting up)"
fi

echo ""
echo "=========================================="
echo "Update Complete!"
echo "=========================================="
echo ""
echo "Access the Node Map at:"
echo "  http://localhost:3000/explorer/map"
echo ""
echo "Useful commands:"
echo "  View logs:        docker-compose logs -f web"
echo "  Check status:     docker-compose ps"
echo "  View API logs:    docker-compose logs -f control-api"
echo ""
echo "Troubleshooting:"
echo "  - If no nodes appear, wait 30 seconds for NodeSync to run"
echo "  - Check API: curl http://localhost:8081/v1/explorer/nodes"
echo "  - Check logs: docker-compose logs control-api | grep -i nodesync"
echo ""
