# =============================================================================
# Node Map Diagnostic Script (PowerShell)
# =============================================================================
# This script checks all components of the Node Map system and identifies issues
# Run: .\diagnose-node-map.ps1
# =============================================================================

#Requires -Version 5.1

# Color setup
$Red = "`e[31m"
$Green = "`e[32m"
$Yellow = "`e[33m"
$Blue = "`e[34m"
$Reset = "`e[0m"

# Track issues
$IssuesFound = 0

# Function to print section headers
function Print-Section {
    param([string]$Title)
    Write-Host ""
    Write-Host "$Blue▶ $Title$Reset"
    Write-Host "------------------------------------------"
}

# Function to print success
function Print-Ok {
    param([string]$Message)
    Write-Host "$Green✓$Reset $Message"
}

# Function to print warning
function Print-Warn {
    param([string]$Message)
    Write-Host "$Yellow⚠$Reset $Message"
    $script:IssuesFound++
}

# Function to print error
function Print-Error {
    param([string]$Message)
    Write-Host "$Red✗$Reset $Message"
    $script:IssuesFound++
}

Write-Host "=========================================="
Write-Host "Node Map Diagnostic Tool (PowerShell)"
Write-Host "=========================================="
Write-Host ""

# =============================================================================
# 1. Check Docker Containers
# =============================================================================
Print-Section "1. Checking Docker Containers"

try {
    $containers = docker-compose ps 2>$null
    
    if ($containers -match "web.*Up") {
        Print-Ok "Web container is running"
    } else {
        Print-Error "Web container is not running"
        Write-Host "   Fix: docker-compose up -d web"
    }
    
    if ($containers -match "control-api.*Up") {
        Print-Ok "Control-API container is running"
    } else {
        Print-Error "Control-API container is not running"
        Write-Host "   Fix: docker-compose up -d control-api"
    }
    
    if ($containers -match "postgres.*Up") {
        Print-Ok "PostgreSQL container is running"
    } else {
        Print-Error "PostgreSQL container is not running"
        Write-Host "   Fix: docker-compose up -d postgres"
    }
} catch {
    Print-Error "Could not check Docker containers. Is Docker running?"
    Write-Host "   Error: $_"
}

# =============================================================================
# 2. Check API Endpoints
# =============================================================================
Print-Section "2. Checking API Endpoints"

try {
    # Check health endpoint
    $healthResponse = Invoke-WebRequest -Uri "http://localhost:8081/health" -Method GET -TimeoutSec 5 -ErrorAction SilentlyContinue
    if ($healthResponse.StatusCode -eq 200) {
        Print-Ok "API Health endpoint is responding (HTTP 200)"
    } else {
        Print-Error "API Health endpoint returned HTTP $($healthResponse.StatusCode)"
        Write-Host "   Fix: docker-compose restart control-api"
    }
} catch {
    Print-Error "API Health endpoint not reachable"
    Write-Host "   Fix: docker-compose restart control-api"
    Write-Host "   Error: $_"
}

try {
    # Check nodes endpoint
    $nodesResponse = Invoke-WebRequest -Uri "http://localhost:8081/v1/explorer/nodes?page=1&page_size=10" -Method GET -TimeoutSec 5 -ErrorAction SilentlyContinue
    if ($nodesResponse.StatusCode -eq 200) {
        $data = $nodesResponse.Content | ConvertFrom-Json
        if ($data.nodes.Count -gt 0) {
            Print-Ok "API returning nodes: $($data.total) total"
        } else {
            Print-Warn "API returning empty nodes list (0 nodes)"
            Write-Host "   Fix: See section 4 - Add test nodes"
        }
    }
} catch {
    Print-Error "API not returning valid nodes response"
    Write-Host "   Error: $_"
}

# =============================================================================
# 3. Check Database
# =============================================================================
Print-Section "3. Checking Database"

try {
    # Check nodes table
    $nodesCount = docker-compose exec -T postgres psql -U proxyhubb -d proxyhubb -t -c "SELECT COUNT(*) FROM nodes;" 2>$null
    $nodesCount = $nodesCount.Trim()
    
    if ([int]$nodesCount -gt 0) {
        Print-Ok "Main nodes table has $nodesCount nodes"
    } else {
        Print-Warn "Main nodes table is empty"
    }
    
    # Check healthy nodes
    $healthyCount = docker-compose exec -T postgres psql -U proxyhubb -d proxyhubb -t -c "SELECT COUNT(*) FROM nodes WHERE is_healthy = true;" 2>$null
    $healthyCount = $healthyCount.Trim()
    
    if ([int]$healthyCount -gt 0) {
        Print-Ok "$healthyCount healthy nodes found"
    } else {
        if ([int]$nodesCount -gt 0) {
            Print-Warn "Nodes exist but none are marked as healthy"
            Write-Host "   Fix: docker-compose exec postgres psql -U proxyhubb -d proxyhubb -c `"UPDATE nodes SET is_healthy = true;`""
        }
    }
    
    # Check explorer_nodes table
    $explorerCount = docker-compose exec -T postgres psql -U proxyhubb -d proxyhubb -t -c "SELECT COUNT(*) FROM explorer_nodes;" 2>$null
    $explorerCount = $explorerCount.Trim()
    
    if ([int]$explorerCount -gt 0) {
        Print-Ok "Explorer nodes table has $explorerCount nodes"
    } else {
        if ([int]$healthyCount -gt 0) {
            Print-Warn "Healthy nodes exist but explorer_nodes is empty"
            Write-Host "   Fix: Restart control-api to trigger NodeSync"
            Write-Host "   Command: docker-compose restart control-api"
        }
    }
    
    # Check location data
    $noLocationCount = docker-compose exec -T postgres psql -U proxyhubb -d proxyhubb -t -c "SELECT COUNT(*) FROM nodes WHERE country IS NULL OR region IS NULL;" 2>$null
    $noLocationCount = $noLocationCount.Trim()
    
    if ([int]$noLocationCount -gt 0) {
        Print-Warn "$noLocationCount nodes missing location data (country/region)"
        Write-Host "   Fix: Update nodes with location data"
    } else {
        if ([int]$nodesCount -gt 0) {
            Print-Ok "All nodes have location data"
        }
    }
} catch {
    Print-Error "Could not query database"
    Write-Host "   Error: $_"
}

# =============================================================================
# 4. Sample Data
# =============================================================================
Print-Section "4. Sample Explorer Nodes"

try {
    if ([int]$explorerCount -gt 0) {
        Write-Host "   Recent explorer nodes:"
        $sampleData = docker-compose exec -T postgres psql -U proxyhubb -d proxyhubb -c "
            SELECT 
                SUBSTRING(node_id, 1, 20) || '...' as node_id,
                country,
                region,
                CASE WHEN is_active THEN '✓' ELSE '✗' END as active,
                CASE WHEN is_validator THEN '✓' ELSE '✗' END as validator
            FROM explorer_nodes 
            LIMIT 5;
        " 2>$null
        Write-Host $sampleData
    } else {
        Write-Host "   No explorer nodes to display"
    }
} catch {
    Write-Host "   Could not retrieve sample data"
}

# =============================================================================
# 5. Check NodeSync
# =============================================================================
Print-Section "5. Checking NodeSync Service"

try {
    $logs = docker-compose logs --tail=50 control-api 2>$null
    $nodeSyncLogs = $logs | Select-String -Pattern "nodesync|synchronization" | Select-Object -Last 5
    
    if ($nodeSyncLogs) {
        Print-Ok "NodeSync logs found"
        Write-Host "   Recent NodeSync activity:"
        $nodeSyncLogs | ForEach-Object { Write-Host "   $_" }
    } else {
        Print-Warn "No NodeSync activity found in recent logs"
        Write-Host "   Fix: docker-compose restart control-api"
    }
} catch {
    Print-Warn "Could not check NodeSync logs"
}

# =============================================================================
# 6. Network Connectivity
# =============================================================================
Print-Section "6. Checking Network Connectivity"

try {
    $test = docker-compose exec -T web wget -q -O - http://control-api:8080/health 2>$null
    if ($test) {
        Print-Ok "Web container can reach API internally"
    } else {
        Print-Error "Web container cannot reach API"
        Write-Host "   Fix: Check Docker network configuration"
    }
} catch {
    Print-Error "Could not test internal connectivity"
}

# =============================================================================
# Summary
# =============================================================================
Write-Host ""
Write-Host "=========================================="
Write-Host "Diagnostic Summary"
Write-Host "=========================================="
Write-Host ""

if ($IssuesFound -eq 0) {
    Write-Host "$Green✓ All checks passed!$Reset"
    Write-Host ""
    Write-Host "The Node Map should be working correctly."
    Write-Host "If you're still not seeing nodes, try:"
    Write-Host "   1. Refresh the browser page (Ctrl+F5)"
    Write-Host "   2. Check browser console for JavaScript errors"
    Write-Host "   3. Ensure your browser can reach http://localhost:8081"
} else {
    Write-Host "$Yellow⚠ Found $IssuesFound issue(s)$Reset"
    Write-Host ""
    Write-Host "Quick fixes:"
    
    if ([int]$nodesCount -eq 0) {
        Write-Host ""
        Write-Host "1. ADD TEST NODES (no nodes exist):"
        Write-Host "   .\fix-nodes.ps1"
    }
    
    if ([int]$healthyCount -eq 0 -and [int]$nodesCount -gt 0) {
        Write-Host ""
        Write-Host "2. MARK NODES AS HEALTHY:"
        Write-Host "   docker-compose exec postgres psql -U proxyhubb -d proxyhubb -c `"UPDATE nodes SET is_healthy = true;`""
        Write-Host "   docker-compose restart control-api"
    }
    
    if ([int]$explorerCount -eq 0 -and [int]$healthyCount -gt 0) {
        Write-Host ""
        Write-Host "3. TRIGGER NODESYNC:"
        Write-Host "   docker-compose restart control-api"
        Write-Host "   Wait 30 seconds, then refresh the map"
    }
    
    Write-Host ""
    Write-Host "Or run the automated fix script:"
    Write-Host "   .\fix-nodes.ps1"
}

Write-Host ""
Write-Host "=========================================="

# Pause if not in ISE
if ($Host.Name -eq "ConsoleHost") {
    Write-Host "Press any key to continue..."
    $null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
}
