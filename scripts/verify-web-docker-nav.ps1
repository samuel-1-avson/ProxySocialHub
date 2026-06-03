# Smoke-check navigation redirects on the Docker-hosted Next.js web container.
# Usage:
#   .\scripts\verify-web-docker-nav.ps1
#   .\scripts\verify-web-docker-nav.ps1 -BaseUrl http://localhost:3009

param(
    [string]$BaseUrl = "http://localhost:3000"
)

$ErrorActionPreference = "Stop"

$checks = @(
    @{ Path = "/settings"; ExpectLocation = "/dashboard/settings/identity" },
    @{ Path = "/settings/notifications"; ExpectLocation = "/dashboard/settings/notifications" },
    @{ Path = "/notifications"; ExpectLocation = "/dashboard/settings/notifications" },
    @{ Path = "/leaderboards"; ExpectLocation = "/explorer/leaderboard" },
    @{ Path = "/dashboard/feed"; ExpectLocation = "/community/feed" },
    @{ Path = "/dashboard/messages"; ExpectLocation = "/community/messages" },
    @{ Path = "/dashboard/security"; ExpectLocation = "/dashboard/settings/security" }
)

Write-Host "Verifying web redirects at $BaseUrl" -ForegroundColor Cyan

$failed = 0
foreach ($check in $checks) {
    $uri = "$BaseUrl$($check.Path)"
    try {
        $response = Invoke-WebRequest -Uri $uri -MaximumRedirection 0 -SkipHttpErrorCheck
    } catch {
        if ($_.Exception.Response) {
            $response = $_.Exception.Response
        } else {
            Write-Host "  FAIL $($check.Path) — $($_.Exception.Message)" -ForegroundColor Red
            $failed++
            continue
        }
    }

    $status = [int]$response.StatusCode
    $location = $response.Headers.Location
    if ($location -is [string] -and $location.StartsWith("/")) {
        $location = "$BaseUrl$location"
    }

    $ok = ($status -ge 301 -and $status -le 308) -and ($location -like "*$($check.ExpectLocation)*")
    if ($ok) {
        Write-Host "  OK   $($check.Path) -> $location ($status)" -ForegroundColor Green
    } else {
        Write-Host "  FAIL $($check.Path) — status=$status location=$location (expected *$($check.ExpectLocation)*)" -ForegroundColor Red
        $failed++
    }
}

$pages = @(
    "/dashboard/settings/identity",
    "/dashboard/settings/api-keys",
    "/dashboard/settings/devices",
    "/explorer/map",
    "/marketplace/map"
)

Write-Host ""
Write-Host "Checking settings pages return 200..." -ForegroundColor Cyan
foreach ($page in $pages) {
    $uri = "$BaseUrl$page"
    try {
        $response = Invoke-WebRequest -Uri $uri -MaximumRedirection 5 -SkipHttpErrorCheck
        $status = [int]$response.StatusCode
        if ($status -ge 200 -and $status -lt 400) {
            Write-Host "  OK   $page ($status)" -ForegroundColor Green
        } else {
            Write-Host "  FAIL $page — HTTP $status" -ForegroundColor Red
            $failed++
        }
    } catch {
        Write-Host "  FAIL $page — $($_.Exception.Message)" -ForegroundColor Red
        $failed++
    }
}

if ($failed -gt 0) {
    Write-Host ""
    Write-Host "$failed check(s) failed. Rebuild web: .\scripts\docker-refresh-stack.ps1 -Services web" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "All navigation checks passed." -ForegroundColor Green
