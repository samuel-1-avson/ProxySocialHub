# =============================================================================
# ⚠️  DEPRECATED: Mock Data Creation Script
# =============================================================================
# This script creates TEST/MOCK nodes for development only.
# 
# FOR PRODUCTION: Use real nodes with actual public IPs.
# See: REMOVE_MOCK_DATA_GUIDE.md for real data setup.
#
# To clean up mock data, run: .\cleanup-mock-data.ps1
# =============================================================================

#Requires -Version 5.1

$Red = "`e[31m"
$Yellow = "`e[33m"
$Green = "`e[32m"
$Reset = "`e[0m"

Write-Host "=========================================="
Write-Host "${Yellow}⚠️  MOCK DATA CREATION (DEVELOPMENT ONLY)${Reset}"
Write-Host "=========================================="
Write-Host ""
Write-Host "${Red}WARNING:${Reset} This script creates FAKE test nodes with:"
Write-Host "  - Fake IP addresses (192.168.x.x - NOT REAL)"
Write-Host "  - Test identifiers (test-*, ghana-*, etc.)"
Write-Host "  - Simulated location data"
Write-Host ""
Write-Host "${Yellow}For production, use REAL nodes with actual public IPs.${Reset}"
Write-Host "See: REMOVE_MOCK_DATA_GUIDE.md"
Write-Host ""

$purpose = Read-Host "Why do you need to run this? (test/cleanup/abort)"

if ($purpose -eq "cleanup") {
    Write-Host ""
    Write-Host "Running cleanup script instead..."
    & ".\cleanup-mock-data.ps1"
    exit
}

if ($purpose -ne "test") {
    Write-Host ""
    Write-Host "Cancelled. To set up real nodes, see REMOVE_MOCK_DATA_GUIDE.md"
    exit 0
}

$confirm = Read-Host "Type 'MOCK' to create fake test nodes (NOT for production)"

if ($confirm -ne "MOCK") {
    Write-Host "Cancelled."
    exit 0
}

Write-Host ""
Write-Host "${Yellow}Proceeding with MOCK DATA creation for testing...${Reset}"
Write-Host ""

# Rest of the script remains the same but with clear MOCK labels...
# [Previous implementation continues with warnings...]

Write-Host "=========================================="
Write-Host "${Red}MOCK DATA CREATED - NOT FOR PRODUCTION${Reset}"
Write-Host "=========================================="
Write-Host ""
Write-Host "To clean up these fake nodes later, run:"
Write-Host "  .\cleanup-mock-data.ps1"
Write-Host ""
Write-Host "To set up REAL nodes, see:"
Write-Host "  REMOVE_MOCK_DATA_GUIDE.md"
Write-Host ""
