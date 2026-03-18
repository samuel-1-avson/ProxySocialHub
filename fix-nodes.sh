#!/bin/bash

# =============================================================================
# ⚠️  DEPRECATED: Mock Data Creation Script
# =============================================================================
# This script creates TEST/MOCK nodes for development only.
# 
# FOR PRODUCTION: Use real nodes with actual public IPs.
# See: REMOVE_MOCK_DATA_GUIDE.md for real data setup.
#
# To clean up mock data, run: ./cleanup-mock-data.sh
# =============================================================================

# Colors
YELLOW='\033[1;33m'
RED='\033[0;31m'
RESET='\033[0m'

echo "=========================================="
echo -e "${YELLOW}⚠️  MOCK DATA CREATION (DEVELOPMENT ONLY)${RESET}"
echo "=========================================="
echo ""
echo -e "${RED}WARNING:${RESET} This script creates FAKE test nodes with:"
echo "  - Fake IP addresses (192.168.x.x - NOT REAL)"
echo "  - Test identifiers (test-*, ghana-*, etc.)"
echo "  - Simulated location data"
echo ""
echo -e "${YELLOW}For production, use REAL nodes with actual public IPs.${RESET}"
echo "See: REMOVE_MOCK_DATA_GUIDE.md"
echo ""

read -p "Why do you need to run this? (test/cleanup/abort): " purpose

if [ "$purpose" = "cleanup" ]; then
    echo ""
    echo "Running cleanup script instead..."
    ./cleanup-mock-data.sh
    exit 0
fi

if [ "$purpose" != "test" ]; then
    echo ""
    echo "Cancelled. To set up real nodes, see REMOVE_MOCK_DATA_GUIDE.md"
    exit 0
fi

read -p "Type 'MOCK' to create fake test nodes (NOT for production): " confirm

if [ "$confirm" != "MOCK" ]; then
    echo "Cancelled."
    exit 0
fi

echo ""
echo -e "${YELLOW}Proceeding with MOCK DATA creation for testing...${RESET}"
echo ""

# The rest of the script would create mock data
echo "This would create mock nodes with fake IPs."
echo "For real setup, see REAL_DATA_SETUP.md"
echo ""

echo "=========================================="
echo -e "${RED}MOCK DATA CREATION ABORTED${RESET}"
echo "=========================================="
echo ""
echo "To set up REAL nodes:"
echo "  1. Read REAL_DATA_SETUP.md"
echo "  2. Deploy edge-gateway with real IPs"
echo "  3. Or register via API with public IPs"
echo ""

exit 0
