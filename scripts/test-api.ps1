# test-api.ps1
# Comprehensive API testing suite
# Run this after docker-compose is up

param(
    [string]$BaseUrl = "http://localhost:8080",
    [switch]$Verbose
)

$ErrorActionPreference = "Continue"

$GREEN = "`e[32m"
$RED = "`e[31m"
$YELLOW = "`e[33m"
$CYAN = "`e[36m"
$NC = "`e[0m"

$passed = 0
$failed = 0

function Test-Endpoint {
    param(
        [string]$Name,
        [string]$Method = "GET",
        [string]$Path,
        [hashtable]$Headers = @{},
        [string]$Body = "",
        [int]$ExpectedStatus = 200,
        [string]$ExpectedContent = ""
    )
    
    $url = "$BaseUrl$Path"
    
    try {
        $params = @{
            Uri = $url
            Method = $Method
            TimeoutSec = 10
            ErrorAction = "Stop"
        }
        
        if ($Headers.Count -gt 0) {
            $params.Headers = $Headers
        }
        
        if ($Body -and $Method -ne "GET") {
            $params.Body = $Body
            $params.ContentType = "application/json"
        }
        
        $response = Invoke-WebRequest @params
        $status = $response.StatusCode
        $content = $response.Content
        
        $statusMatch = $status -eq $ExpectedStatus
        $contentMatch = if ($ExpectedContent) { $content -match $ExpectedContent } else { $true }
        
        if ($statusMatch -and $contentMatch) {
            Write-Host "  ${GREEN}✓${NC} $Name ($Method $Path) - $status"
            $script:passed++
            return $true
        } else {
            Write-Host "  ${RED}✗${NC} $Name ($Method $Path)"
            Write-Host "    Expected: $ExpectedStatus, Got: $status"
            if ($ExpectedContent -and -not $contentMatch) {
                Write-Host "    Expected content: $ExpectedContent"
            }
            $script:failed++
            return $false
        }
    } catch {
        $errorStatus = $_.Exception.Response.StatusCode.value__
        if ($errorStatus -eq $ExpectedStatus) {
            Write-Host "  ${GREEN}✓${NC} $Name ($Method $Path) - $errorStatus (expected)"
            $script:passed++
            return $true
        } else {
            Write-Host "  ${RED}✗${NC} $Name ($Method $Path)"
            Write-Host "    Expected: $ExpectedStatus, Got: $errorStatus"
            Write-Host "    Error: $_"
            $script:failed++
            return $false
        }
    }
}

function Test-Security {
    param([string]$Name, [string]$Path, [int]$ExpectedStatus = 401)
    
    Test-Endpoint -Name $Name -Path $Path -ExpectedStatus $ExpectedStatus
}

Clear-Host
Write-Host "${CYAN}╔════════════════════════════════════════════════════════════════╗${NC}"
Write-Host "${CYAN}║           API TEST SUITE                                       ║${NC}"
Write-Host "${CYAN}╚════════════════════════════════════════════════════════════════╝${NC}"
Write-Host ""
Write-Host "Testing: $BaseUrl"
Write-Host ""

# Test 1: Health & Basic Endpoints
Write-Host "${CYAN}Public Endpoints:${NC}"

Test-Endpoint -Name "Health Check" -Path "/health" -ExpectedContent "healthy"
Test-Endpoint -Name "Metrics" -Path "/metrics"

# Test 2: Security - Dev login should be disabled
Write-Host ""
Write-Host "${CYAN}Security Tests:${NC}"

Test-Endpoint -Name "Dev Login Disabled" -Method "POST" -Path "/v1/auth/dev/login" -ExpectedStatus 404
Test-Security -Name "Protected Profile (no auth)" -Path "/v1/profile"
Test-Security -Name "Protected Sessions (no auth)" -Path "/v1/sessions"
Test-Security -Name "Protected Orders (no auth)" -Path "/v1/orders"

# Test 3: Auth Flow
Write-Host ""
Write-Host "${CYAN}Authentication Flow:${NC}"

# Get auth challenge
$challengeTest = Test-Endpoint -Name "Get Auth Challenge" -Method "POST" -Path "/v1/auth/wallet/challenge" -Body '{"address": "5DDTestAddress123456789"}'

if ($challengeTest) {
    # Try to login (will fail without valid signature, but tests the endpoint)
    Test-Endpoint -Name "Wallet Login (invalid sig)" -Method "POST" -Path "/v1/auth/wallet/login" `
        -Body '{"address": "test", "signature": "invalid", "nonce": "test"}' -ExpectedStatus 400
}

# Test 4: CORS Headers
Write-Host ""
Write-Host "${CYAN}Security Headers:${NC}"

try {
    $response = Invoke-WebRequest -Uri "$BaseUrl/health" -Method GET -TimeoutSec 5
    
    $headers = @{
        "X-Content-Type-Options" = "nosniff"
        "X-Frame-Options" = "DENY"
        "X-XSS-Protection" = "1; mode=block"
    }
    
    foreach ($header in $headers.GetEnumerator()) {
        $actual = $response.Headers[$header.Key]
        if ($actual -eq $header.Value) {
            Write-Host "  ${GREEN}✓${NC} Header $($header.Key): $actual"
            $script:passed++
        } else {
            Write-Host "  ${YELLOW}!${NC} Header $($header.Key): Expected '$($header.Value)', Got '$actual'"
        }
    }
} catch {
    Write-Host "  ${RED}✗${NC} Failed to check headers: $_"
}

# Test 5: Rate Limiting (basic check)
Write-Host ""
Write-Host "${CYAN}Rate Limiting:${NC}"

$requests = 0
$rateLimited = $false

for ($i = 1; $i -le 15; $i++) {
    try {
        $resp = Invoke-WebRequest -Uri "$BaseUrl/health" -Method GET -TimeoutSec 2
        $requests++
    } catch {
        if ($_.Exception.Response.StatusCode.value__ -eq 429) {
            Write-Host "  ${GREEN}✓${NC} Rate limiting triggered after $i requests"
            $rateLimited = $true
            $script:passed++
            break
        }
    }
}

if (-not $rateLimited) {
    Write-Host "  ${YELLOW}!${NC} Rate limit not triggered (may need higher volume)"
}

# Test 6: Database connectivity (through API)
Write-Host ""
Write-Host "${CYAN}Database Tests:${NC}"

# This would require authenticated endpoints
# For now, just verify we can hit auth endpoints
Test-Endpoint -Name "Database-backed endpoint" -Path "/v1/auth/me" -ExpectedStatus 401

# Summary
Write-Host ""
Write-Host "${CYAN}═══════════════════════════════════════════════════════════════${NC}"
Write-Host ""

$total = $passed + $failed

if ($failed -eq 0) {
    Write-Host "${GREEN}✅ ALL TESTS PASSED ($passed/$total)${NC}"
} else {
    Write-Host "${YELLOW}⚠️  SOME TESTS FAILED ($passed passed, $failed failed)${NC}"
}

Write-Host ""
Write-Host "Total: $total tests"
Write-Host "Passed: $passed"
Write-Host "Failed: $failed"
Write-Host ""

if ($failed -eq 0) {
    exit 0
} else {
    exit 1
}
