# Full marketplace path on Windows: order -> dev escrow activate -> CONNECT via edge.
# Requires docker stack: control-api, redis, edge-gateway, provider-node.
#
# Usage (repo root):
#   .\scripts\marketplace-buy-connect-e2e.ps1
#   .\scripts\marketplace-buy-connect-e2e.ps1 -SkipStack

param(
    [switch]$SkipStack
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path $PSScriptRoot -Parent
Set-Location $repoRoot

. (Join-Path $PSScriptRoot "_env.ps1")
Import-RepoDotEnv -RepoRoot $repoRoot

$apiBase = if ($env:CONTROL_API_PUBLIC_URL) { $env:CONTROL_API_PUBLIC_URL } else { "http://127.0.0.1:18080" }
$buyerPort = if ($env:EDGE_GATEWAY_BUYER_PORT) { $env:EDGE_GATEWAY_BUYER_PORT }
    elseif ($env:EDGE_GATEWAY_PORT) { $env:EDGE_GATEWAY_PORT }
    else { "8090" }
$pgPass = if ($env:POSTGRES_PASSWORD) { $env:POSTGRES_PASSWORD } else { "admin" }
$pgHostPort = if ($env:POSTGRES_HOST_PORT) { $env:POSTGRES_HOST_PORT } else { "55432" }

if (-not $SkipStack) {
    Write-Host "Bootstrapping provider + edge stack..."
    & (Join-Path $PSScriptRoot "bootstrap-provider-docker.ps1") -StartProvider
}

Write-Host "=== Resolving active listing ==="
$listingId = (docker exec -e PGPASSWORD=$pgPass proxyhubb-postgres-1 `
    psql -U proxyhubb -d proxyhubb -tAc `
    "SELECT id::text FROM proxy_listings WHERE status = 'active' ORDER BY created_at DESC LIMIT 1;").Trim()
if (-not $listingId) {
    Write-Host "No active listing - run post-signed-listing-docker.ps1 first." -ForegroundColor Red
    exit 1
}
Write-Host "Listing: $listingId"

$buyerJsonPath = Join-Path $repoRoot ".tmp-buyer-e2e.json"
& (Join-Path $PSScriptRoot "mint-e2e-buyer-jwt.ps1") `
    -Wallet "8g7WUuPosAg82Uu7iGYCx6HBnoTBFb4QuyiJCEGzktU4" `
    -EnsureBuyer -OutFile $buyerJsonPath | Out-Null
$buyer = Get-Content $buyerJsonPath | ConvertFrom-Json
$token = $buyer.token
$buyerId = $buyer.user_id

$walletSql = "UPDATE wallets SET balance_sol = 100 WHERE user_id = '$buyerId'" + '::uuid;'
docker exec -e PGPASSWORD=$pgPass proxyhubb-postgres-1 `
    psql -U proxyhubb -d proxyhubb -c $walletSql | Out-Null

Write-Host "=== Creating marketplace order ==="
$orderBody = @{ listing_id = $listingId; bandwidth_gb = 1 } | ConvertTo-Json
$orderResp = Invoke-RestMethod -Uri "$apiBase/v1/orders" -Method POST `
    -Headers @{ Authorization = "Bearer $token" } -ContentType "application/json" -Body $orderBody
$orderId = $orderResp.order.id
Write-Host "Order: $orderId"

function Invoke-DevActivate {
    param([string]$Id, [string]$Jwt)
    return Invoke-RestMethod -Uri "$apiBase/v1/orders/$Id/activate-dev" -Method POST `
        -Headers @{ Authorization = "Bearer $Jwt" }
}

Write-Host "=== Dev escrow activate ==="
$activateResp = Invoke-DevActivate -Id $orderId -Jwt $token
$credUser = $activateResp.proxy_credentials.username
$credPass = $activateResp.proxy_credentials.password
Write-Host "Credentials user: $credUser"

Write-Host "=== Buyer CONNECT through edge :$buyerPort ==="
$proxyUrl = "http://${credUser}:${credPass}@127.0.0.1:${buyerPort}"
$maxAttempts = 3
for ($attempt = 1; $attempt -le $maxAttempts; $attempt++) {
    if ($attempt -gt 1) {
        Write-Host "Retry ${attempt}: re-sync session to Redis and retry CONNECT..."
        Start-Sleep -Seconds 3
        $activateResp = Invoke-DevActivate -Id $orderId -Jwt $token
        $credUser = $activateResp.proxy_credentials.username
        $credPass = $activateResp.proxy_credentials.password
        $proxyUrl = "http://${credUser}:${credPass}@127.0.0.1:${buyerPort}"
    }
    curl.exe -sf --max-time 60 -x $proxyUrl https://example.com -o NUL
    if ($LASTEXITCODE -eq 0) {
        Write-Host "Marketplace buy -> activate -> CONNECT E2E passed." -ForegroundColor Green
        exit 0
    }
}

Write-Host "CONNECT failed after $maxAttempts attempts (last exit $LASTEXITCODE). Check provider tunnel: docker logs proxyhubb-provider-node --tail 20" -ForegroundColor Red
exit 1
