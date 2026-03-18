#!/bin/bash

# =============================================================================
# Cleanup Mock Data Script (Linux/Mac)
# =============================================================================
# This script removes all mock/test data from the database
# Run: ./cleanup-mock-data.sh
# =============================================================================

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RESET='\033[0m'

echo "=========================================="
echo "MOCK DATA CLEANUP UTILITY"
echo "=========================================="
echo ""
echo -e "${RED}WARNING: This will delete all test/mock nodes!${RESET}"
echo ""

read -p "Type 'DELETE' to confirm you want to remove all mock data: " confirm

if [ "$confirm" != "DELETE" ]; then
    echo -e "${YELLOW}Cancelled. No data was deleted.${RESET}"
    exit 0
fi

echo ""
echo "Checking for mock data..."
echo ""

# Check for private IPs
echo "1. Checking for private IP addresses (192.168.x.x, 10.x.x.x, etc.)..."
PRIVATE_IPS=$(docker-compose exec -T postgres psql -U proxyhubb -d proxyhubb -t -c "
    SELECT COUNT(*) FROM nodes 
    WHERE ip_address LIKE '192.168.%' 
       OR ip_address LIKE '10.%' 
       OR ip_address LIKE '172.16.%' OR ip_address LIKE '172.17.%' OR ip_address LIKE '172.18.%'
       OR ip_address LIKE '172.19.%' OR ip_address LIKE '172.20.%' OR ip_address LIKE '172.21.%'
       OR ip_address LIKE '172.22.%' OR ip_address LIKE '172.23.%' OR ip_address LIKE '172.24.%'
       OR ip_address LIKE '172.25.%' OR ip_address LIKE '172.26.%' OR ip_address LIKE '172.27.%'
       OR ip_address LIKE '172.28.%' OR ip_address LIKE '172.29.%' OR ip_address LIKE '172.30.%'
       OR ip_address LIKE '172.31.%'
       OR ip_address = '127.0.0.1' OR ip_address = 'localhost';
" 2>/dev/null | xargs)

if [ "$PRIVATE_IPS" -gt "0" ]; then
    echo -e "   ${RED}Found $PRIVATE_IPS nodes with private IPs${RESET}"
    
    read -p "   Delete these nodes? (y/n): " delete_private
    if [ "$delete_private" = "y" ]; then
        docker-compose exec -T postgres psql -U proxyhubb -d proxyhubb -c "
            DELETE FROM nodes 
            WHERE ip_address LIKE '192.168.%' 
               OR ip_address LIKE '10.%' 
               OR ip_address LIKE '172.16.%' OR ip_address LIKE '172.17.%' OR ip_address LIKE '172.18.%'
               OR ip_address LIKE '172.19.%' OR ip_address LIKE '172.20.%' OR ip_address LIKE '172.21.%'
               OR ip_address LIKE '172.22.%' OR ip_address LIKE '172.23.%' OR ip_address LIKE '172.24.%'
               OR ip_address LIKE '172.25.%' OR ip_address LIKE '172.26.%' OR ip_address LIKE '172.27.%'
               OR ip_address LIKE '172.28.%' OR ip_address LIKE '172.29.%' OR ip_address LIKE '172.30.%'
               OR ip_address LIKE '172.31.%'
               OR ip_address = '127.0.0.1' OR ip_address = 'localhost';
        " 2>/dev/null
        echo -e "   ${GREEN}✓ Deleted${RESET}"
    fi
else
    echo -e "   ${GREEN}✓ No private IPs found${RESET}"
fi

# Check for test identifiers
echo ""
echo "2. Checking for test identifiers (test-*, fake-*, dummy-*, mock-*)..."
TEST_NODES=$(docker-compose exec -T postgres psql -U proxyhubb -d proxyhubb -t -c "
    SELECT COUNT(*) FROM nodes 
    WHERE hotkey LIKE 'test-%' 
       OR hotkey LIKE 'fake-%' 
       OR hotkey LIKE 'dummy-%'
       OR hotkey LIKE 'mock-%'
       OR hotkey LIKE 'ghana-%'
       OR hotkey LIKE 'us-%'
       OR hotkey LIKE 'germany-%'
       OR hotkey LIKE 'uk-%'
       OR hotkey LIKE 'singapore-%'
       OR hotkey LIKE 'japan-%'
       OR hotkey LIKE 'brazil-%'
       OR hotkey LIKE 'india-%'
       OR hotkey LIKE 'south-africa-%'
       OR hotkey LIKE 'france-%';
" 2>/dev/null | xargs)

if [ "$TEST_NODES" -gt "0" ]; then
    echo -e "   ${RED}Found $TEST_NODES nodes with test identifiers${RESET}"
    
    read -p "   Delete these nodes? (y/n): " delete_test
    if [ "$delete_test" = "y" ]; then
        docker-compose exec -T postgres psql -U proxyhubb -d proxyhubb -c "
            DELETE FROM nodes 
            WHERE hotkey LIKE 'test-%' 
               OR hotkey LIKE 'fake-%' 
               OR hotkey LIKE 'dummy-%'
               OR hotkey LIKE 'mock-%'
               OR hotkey LIKE 'ghana-%'
               OR hotkey LIKE 'us-%'
               OR hotkey LIKE 'germany-%'
               OR hotkey LIKE 'uk-%'
               OR hotkey LIKE 'singapore-%'
               OR hotkey LIKE 'japan-%'
               OR hotkey LIKE 'brazil-%'
               OR hotkey LIKE 'india-%'
               OR hotkey LIKE 'south-africa-%'
               OR hotkey LIKE 'france-%';
        " 2>/dev/null
        echo -e "   ${GREEN}✓ Deleted${RESET}"
    fi
else
    echo -e "   ${GREEN}✓ No test identifiers found${RESET}"
fi

# Clear explorer_nodes to force resync
echo ""
echo "3. Clearing explorer_nodes cache..."
docker-compose exec -T postgres psql -U proxyhubb -d proxyhubb -c "TRUNCATE TABLE explorer_nodes;" 2>/dev/null
echo -e "   ${GREEN}✓ Explorer nodes cache cleared${RESET}"

# Restart control-api
echo ""
echo "4. Restarting control-api to sync real nodes..."
docker-compose restart control-api 2>/dev/null
echo -e "   ${GREEN}✓ Control-api restarted${RESET}"

# Final status
echo ""
echo "=========================================="
echo "CLEANUP COMPLETE"
echo "=========================================="
echo ""

REMAINING=$(docker-compose exec -T postgres psql -U proxyhubb -d proxyhubb -t -c "SELECT COUNT(*) FROM nodes;" 2>/dev/null | xargs)
echo "Remaining nodes in database: $REMAINING"

if [ "$REMAINING" -eq "0" ]; then
    echo ""
    echo -e "${YELLOW}NOTE: No nodes remaining. You need to add real nodes:${RESET}"
    echo "  1. Deploy edge-gateway with real IPs"
    echo "  2. Or register nodes via API"
    echo "  3. See: REMOVE_MOCK_DATA_GUIDE.md"
else
    echo ""
    echo -e "${GREEN}Real nodes preserved. NodeSync will update shortly.${RESET}"
fi

echo ""
echo "Refresh http://localhost:3000/explorer/map in 30 seconds"
echo ""
