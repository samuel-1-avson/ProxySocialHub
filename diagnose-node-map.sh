#!/bin/bash

# =============================================================================
# Node Map Diagnostic Script
# =============================================================================
# This script checks all components of the Node Map system and identifies issues
# Run: ./diagnose-node-map.sh
# =============================================================================

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo "=========================================="
echo "Node Map Diagnostic Tool"
echo "=========================================="
echo ""

# Track issues
ISSUES_FOUND=0

# Function to print section headers
print_section() {
    echo ""
    echo -e "${BLUE}▶ $1${NC}"
    echo "------------------------------------------"
}

# Function to print success
print_ok() {
    echo -e "${GREEN}✓${NC} $1"
}

# Function to print warning
print_warn() {
    echo -e "${YELLOW}⚠${NC} $1"
    ISSUES_FOUND=$((ISSUES_FOUND + 1))
}

# Function to print error
print_error() {
    echo -e "${RED}✗${NC} $1"
    ISSUES_FOUND=$((ISSUES_FOUND + 1))
}

# =============================================================================
# 1. Check Docker Containers
# =============================================================================
print_section "1. Checking Docker Containers"

if ! docker-compose ps | grep -q "web.*Up"; then
    print_error "Web container is not running"
    echo "   Fix: docker-compose up -d web"
else
    print_ok "Web container is running"
fi

if ! docker-compose ps | grep -q "control-api.*Up"; then
    print_error "Control-API container is not running"
    echo "   Fix: docker-compose up -d control-api"
else
    print_ok "Control-API container is running"
fi

if ! docker-compose ps | grep -q "postgres.*Up"; then
    print_error "PostgreSQL container is not running"
    echo "   Fix: docker-compose up -d postgres"
else
    print_ok "PostgreSQL container is running"
fi

# =============================================================================
# 2. Check API Endpoints
# =============================================================================
print_section "2. Checking API Endpoints"

# Check health endpoint
HEALTH_STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:8081/health 2>/dev/null || echo "000")
if [ "$HEALTH_STATUS" = "200" ]; then
    print_ok "API Health endpoint is responding (HTTP 200)"
else
    print_error "API Health endpoint returned HTTP $HEALTH_STATUS"
    echo "   Fix: docker-compose restart control-api"
fi

# Check nodes endpoint
NODES_RESPONSE=$(curl -s "http://localhost:8081/v1/explorer/nodes?page=1&page_size=10" 2>/dev/null || echo "{}")
if echo "$NODES_RESPONSE" | grep -q '"nodes"'; then
    NODE_COUNT=$(echo "$NODES_RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin).get('total',0))" 2>/dev/null || echo "0")
    if [ "$NODE_COUNT" -gt "0" ]; then
        print_ok "API returning nodes: $NODE_COUNT total"
    else
        print_warn "API returning empty nodes list (0 nodes)"
        echo "   Fix: See section 4 - Add test nodes"
    fi
else
    print_error "API not returning valid nodes response"
    echo "   Response: $(echo $NODES_RESPONSE | head -c 100)"
fi

# =============================================================================
# 3. Check Database
# =============================================================================
print_section "3. Checking Database"

# Check nodes table
NODES_DB_COUNT=$(docker-compose exec -T postgres psql -U proxyhubb -d proxyhubb -t -c "SELECT COUNT(*) FROM nodes;" 2>/dev/null | xargs || echo "0")
if [ "$NODES_DB_COUNT" -gt "0" ]; then
    print_ok "Main nodes table has $NODES_DB_COUNT nodes"
else
    print_warn "Main nodes table is empty"
fi

# Check healthy nodes
HEALTHY_COUNT=$(docker-compose exec -T postgres psql -U proxyhubb -d proxyhubb -t -c "SELECT COUNT(*) FROM nodes WHERE is_healthy = true;" 2>/dev/null | xargs || echo "0")
if [ "$HEALTHY_COUNT" -gt "0" ]; then
    print_ok "$HEALTHY_COUNT healthy nodes found"
else
    if [ "$NODES_DB_COUNT" -gt "0" ]; then
        print_warn "Nodes exist but none are marked as healthy"
        echo "   Fix: docker-compose exec postgres psql -U proxyhubb -d proxyhubb -c \"UPDATE nodes SET is_healthy = true;\""
    fi
fi

# Check explorer_nodes table
EXPLORER_COUNT=$(docker-compose exec -T postgres psql -U proxyhubb -d proxyhubb -t -c "SELECT COUNT(*) FROM explorer_nodes;" 2>/dev/null | xargs || echo "0")
if [ "$EXPLORER_COUNT" -gt "0" ]; then
    print_ok "Explorer nodes table has $EXPLORER_COUNT nodes"
else
    if [ "$HEALTHY_COUNT" -gt "0" ]; then
        print_warn "Healthy nodes exist but explorer_nodes is empty"
        echo "   Fix: Restart control-api to trigger NodeSync"
        echo "   Command: docker-compose restart control-api"
    fi
fi

# Check location data
NODES_WITHOUT_LOCATION=$(docker-compose exec -T postgres psql -U proxyhubb -d proxyhubb -t -c "SELECT COUNT(*) FROM nodes WHERE country IS NULL OR region IS NULL;" 2>/dev/null | xargs || echo "0")
if [ "$NODES_WITHOUT_LOCATION" -gt "0" ]; then
    print_warn "$NODES_WITHOUT_LOCATION nodes missing location data (country/region)"
    echo "   Fix: Update nodes with location data"
else
    if [ "$NODES_DB_COUNT" -gt "0" ]; then
        print_ok "All nodes have location data"
    fi
fi

# =============================================================================
# 4. Sample Data
# =============================================================================
print_section "4. Sample Explorer Nodes"

if [ "$EXPLORER_COUNT" -gt "0" ]; then
    echo "   Recent explorer nodes:"
    docker-compose exec -T postgres psql -U proxyhubb -d proxyhubb -c "
        SELECT 
            SUBSTRING(node_id, 1, 20) || '...' as node_id,
            country,
            region,
            CASE WHEN is_active THEN '✓' ELSE '✗' END as active,
            CASE WHEN is_validator THEN '✓' ELSE '✗' END as validator
        FROM explorer_nodes 
        LIMIT 5;
    " 2>/dev/null || echo "   Could not retrieve sample data"
else
    echo "   No explorer nodes to display"
fi

# =============================================================================
# 5. Check NodeSync
# =============================================================================
print_section "5. Checking NodeSync Service"

NODESYNC_LOGS=$(docker-compose logs --tail=50 control-api 2>/dev/null | grep -i "nodesync\|synchronization" | tail -5)
if [ -n "$NODESYNC_LOGS" ]; then
    print_ok "NodeSync logs found"
    echo "   Recent NodeSync activity:"
    echo "$NODESYNC_LOGS" | sed 's/^/   /'
else
    print_warn "No NodeSync activity found in recent logs"
    echo "   Fix: docker-compose restart control-api"
fi

# =============================================================================
# 6. Network Connectivity
# =============================================================================
print_section "6. Checking Network Connectivity"

# Test internal connectivity
if docker-compose exec -T web wget -q -O - http://control-api:8080/health > /dev/null 2>&1; then
    print_ok "Web container can reach API internally"
else
    print_error "Web container cannot reach API"
    echo "   Fix: Check Docker network configuration"
fi

# =============================================================================
# Summary
# =============================================================================
echo ""
echo "=========================================="
echo "Diagnostic Summary"
echo "=========================================="
echo ""

if [ "$ISSUES_FOUND" -eq "0" ]; then
    echo -e "${GREEN}✓ All checks passed!${NC}"
    echo ""
    echo "The Node Map should be working correctly."
    echo "If you're still not seeing nodes, try:"
    echo "   1. Refresh the browser page (Ctrl+F5)"
    echo "   2. Check browser console for JavaScript errors"
    echo "   3. Ensure your browser can reach http://localhost:8081"
else
    echo -e "${YELLOW}⚠ Found $ISSUES_FOUND issue(s)${NC}"
    echo ""
    echo "Quick fixes:"
    
    if [ "$NODES_DB_COUNT" -eq "0" ]; then
        echo ""
        echo "1. ADD TEST NODES (no nodes exist):"
        echo "   docker-compose exec -T postgres psql -U proxyhubb -d proxyhubb < add-test-nodes.sql"
        echo "   docker-compose restart control-api"
    fi
    
    if [ "$HEALTHY_COUNT" -eq "0" ] && [ "$NODES_DB_COUNT" -gt "0" ]; then
        echo ""
        echo "2. MARK NODES AS HEALTHY:"
        echo "   docker-compose exec postgres psql -U proxyhubb -d proxyhubb -c \"UPDATE nodes SET is_healthy = true;\""
        echo "   docker-compose restart control-api"
    fi
    
    if [ "$EXPLORER_COUNT" -eq "0" ] && [ "$HEALTHY_COUNT" -gt "0" ]; then
        echo ""
        echo "3. TRIGGER NODESYNC:"
        echo "   docker-compose restart control-api"
        echo "   Wait 30 seconds, then refresh the map"
    fi
    
    echo ""
    echo "Or run the automated fix script:"
    echo "   chmod +x fix-nodes.sh && ./fix-nodes.sh"
fi

echo ""
echo "=========================================="
