# Test provider API key against POST /v1/provider/auth (same check provider-node uses).
# Usage:
#   .\scripts\test-provider-auth.ps1 -ApiKey "ph_...."
#   .\scripts\test-provider-auth.ps1   # reads api_key from ~/.proxyhubb/provider.toml

param(
    [string]$ApiBaseUrl = "http://localhost:18080",
    [string]$ApiKey = ""
)

$ErrorActionPreference = "Stop"
$tomlPath = Join-Path $env:USERPROFILE ".proxyhubb\provider.toml"

if (-not $ApiKey -and $env:PROXYHUB_API_KEY) {
    $ApiKey = $env:PROXYHUB_API_KEY
}

if (-not $ApiKey -and (Test-Path $tomlPath)) {
    $content = Get-Content $tomlPath -Raw
    if ($content -match 'api_key\s*=\s*"([^"]+)"') {
        $ApiKey = $matches[1]
    }
}

if (-not $ApiKey -or $ApiKey -match '<' -or $ApiKey -match 'Dashboard' -or $ApiKey -match 'paste') {
    Write-Host "No valid api_key found." -ForegroundColor Red
    Write-Host ""
    Write-Host "Mint a dev token (no dashboard):" -ForegroundColor Yellow
    Write-Host "  .\scripts\bootstrap-provider-dev.ps1"
    Write-Host ""
    Write-Host "Or create a token in the dashboard (shown once):"
    Write-Host "  http://localhost:3000/dashboard/provider/tokens"
    Write-Host ""
    Write-Host "Then:"
    Write-Host "  .\scripts\test-provider-auth.ps1"
    Write-Host "  or set PROXYHUB_API_KEY / edit $tomlPath"
    exit 1
}

$body = @{ token = $ApiKey } | ConvertTo-Json
$uri = ($ApiBaseUrl.TrimEnd('/')) + "/v1/provider/auth"

try {
    $resp = Invoke-RestMethod -Uri $uri -Method Post -Body $body -ContentType "application/json" -TimeoutSec 15
    if ($resp.valid) {
        Write-Host "[OK] Provider auth valid" -ForegroundColor Green
        Write-Host "  user_id: $($resp.user_id)"
        Write-Host "  jwt length: $($resp.jwt_token.Length)"
        Write-Host ""
        Write-Host "You can now run:"
        Write-Host "  provider-node start --config `"$tomlPath`""
        exit 0
    }
    Write-Host "[FAIL] $($resp.message)" -ForegroundColor Red
    exit 1
}
catch {
    $msg = $_.Exception.Message
    if ($_.ErrorDetails.Message) {
        try {
            $err = $_.ErrorDetails.Message | ConvertFrom-Json
            if ($err.message) { $msg = $err.message }
            if ($err.error) { $msg = $err.error }
        } catch { $msg = $_.ErrorDetails.Message }
    }
    Write-Host "[FAIL] $msg" -ForegroundColor Red
    exit 1
}
