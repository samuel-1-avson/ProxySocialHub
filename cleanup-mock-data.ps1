# =============================================================================
# Cleanup Mock Data Script (PowerShell)
# =============================================================================
# This script removes all mock/test data from the database
# Run: .\cleanup-mock-data.ps1
# =============================================================================

#Requires -Version 5.1

$Red = "`e[31m"
$Green = "`e[32m"
$Yellow = "`e[33m"
$Reset = "`e[0m"

Write-Host "=========================================="
Write-Host "MOCK DATA CLEANUP UTILITY"
Write-Host "=========================================="
Write-Host ""
Write-Host "${Red}WARNING: This will delete all test/mock nodes!${Reset}"
Write-Host ""

$confirm = Read-Host "Type 'DELETE' to confirm you want to remove all mock data"

if ($confirm -ne "DELETE") {
    Write-Host "${Yellow}Cancelled. No data was deleted.${Reset}"
    exit 0
}

Write-Host ""
Write-Host "Checking for mock data..."
Write-Host ""

# Check for private IPs
Write-Host "1. Checking for private IP addresses (192.168.x.x, 10.x.x.x, etc.)..."
try {
    $privateIPs = docker-compose exec -T postgres psql -U proxyhubb -d proxyhubb -t -c @"
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
"@ 2>$null
    $privateIPs = $privateIPs.Trim()
    
    if ([int]$privateIPs -gt 0) {
        Write-Host "   ${Red}Found $privateIPs nodes with private IPs${Reset}"
        
        $deletePrivate = Read-Host "   Delete these nodes? (y/n)"
        if ($deletePrivate -eq "y") {
            docker-compose exec -T postgres psql -U proxyhubb -d proxyhubb -c @"
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
"@ 2>$null | Out-Null
            Write-Host "   ${Green}✓ Deleted${Reset}"
        }
    } else {
        Write-Host "   ${Green}✓ No private IPs found${Reset}"
    }
} catch {
    Write-Host "   ${Red}Error checking: $_${Reset}"
}

# Check for test identifiers
Write-Host ""
Write-Host "2. Checking for test identifiers (test-*, fake-*, dummy-*, mock-*)..."
try {
    $testNodes = docker-compose exec -T postgres psql -U proxyhubb -d proxyhubb -t -c @"
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
"@ 2>$null
    $testNodes = $testNodes.Trim()
    
    if ([int]$testNodes -gt 0) {
        Write-Host "   ${Red}Found $testNodes nodes with test identifiers${Reset}"
        
        $deleteTest = Read-Host "   Delete these nodes? (y/n)"
        if ($deleteTest -eq "y") {
            docker-compose exec -T postgres psql -U proxyhubb -d proxyhubb -c @"
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
"@ 2>$null | Out-Null
            Write-Host "   ${Green}✓ Deleted${Reset}"
        }
    } else {
        Write-Host "   ${Green}✓ No test identifiers found${Reset}"
    }
} catch {
    Write-Host "   ${Red}Error checking: $_${Reset}"
}

# Clear explorer_nodes to force resync
Write-Host ""
Write-Host "3. Clearing explorer_nodes cache..."
try {
    docker-compose exec -T postgres psql -U proxyhubb -d proxyhubb -c "TRUNCATE TABLE explorer_nodes;" 2>$null | Out-Null
    Write-Host "   ${Green}✓ Explorer nodes cache cleared${Reset}"
} catch {
    Write-Host "   ${Red}Error clearing cache: $_${Reset}"
}

# Restart control-api
Write-Host ""
Write-Host "4. Restarting control-api to sync real nodes..."
try {
    docker-compose restart control-api 2>$null | Out-Null
    Write-Host "   ${Green}✓ Control-api restarted${Reset}"
} catch {
    Write-Host "   ${Red}Error restarting: $_${Reset}"
}

# Final status
Write-Host ""
Write-Host "=========================================="
Write-Host "CLEANUP COMPLETE"
Write-Host "=========================================="
Write-Host ""

try {
    $remaining = docker-compose exec -T postgres psql -U proxyhubb -d proxyhubb -t -c "SELECT COUNT(*) FROM nodes;" 2>$null
    $remaining = $remaining.Trim()
    Write-Host "Remaining nodes in database: $remaining"
    
    if ([int]$remaining -eq 0) {
        Write-Host ""
        Write-Host "${Yellow}NOTE: No nodes remaining. You need to add real nodes:${Reset}"
        Write-Host "  1. Deploy edge-gateway with real IPs"
        Write-Host "  2. Or register nodes via API"
        Write-Host "  3. See: REMOVE_MOCK_DATA_GUIDE.md"
    } else {
        Write-Host ""
        Write-Host "${Green}Real nodes preserved. NodeSync will update shortly.${Reset}"
    }
} catch {
    Write-Host "Could not check remaining nodes"
}

Write-Host ""
Write-Host "Refresh http://localhost:3000/explorer/map in 30 seconds"
Write-Host ""

# Pause
if ($Host.Name -eq "ConsoleHost") {
    Write-Host "Press any key to continue..."
    $null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
}
