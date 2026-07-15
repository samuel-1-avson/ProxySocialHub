# Sign a listing with the Docker provider key and POST it to control-api.
# Uses PROXYHUB_API_KEY from config/docker/provider.compose.env (Bearer auth).
#
# Usage:
#   .\scripts\post-signed-listing-docker.ps1
#   .\scripts\post-signed-listing-docker.ps1 -ProviderNodeId ca374e02-b2d8-4697-8aea-227a332cb0ba

param(
    [string]$ApiBaseUrl = "http://localhost:18080",
    [string]$ProviderNodeId = "",
    [string]$Title = "Docker signed listing (Phase 2 verify)"
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

function Load-DotEnv([string]$path) {
    if (-not (Test-Path $path)) { return }
    Get-Content $path | ForEach-Object {
        if ($_ -match "^\s*([^#=]+)=(.*)$") {
            $k = $matches[1].Trim()
            $v = $matches[2].Trim().Trim('"').Trim("'")
            Set-Item -Path "env:$k" -Value $v
        }
    }
}

function Read-ComposeEnv([string]$path) {
    $result = @{ ApiKey = "" }
    if (-not (Test-Path $path)) { return $result }
    $content = Get-Content $path -Raw
    if ($content -match 'PROXYHUB_API_KEY=(\S+)') { $result.ApiKey = $matches[1].Trim() }
    return $result
}

Load-DotEnv (Join-Path $repoRoot ".env")
$composeEnv = Join-Path $repoRoot "config\docker\provider.compose.env"
$envData = Read-ComposeEnv $composeEnv
$apiKey = $envData.ApiKey
if (-not $apiKey) { throw "Missing PROXYHUB_API_KEY in $composeEnv. Run bootstrap-provider-docker.ps1 first." }

$pgUser = if ($env:POSTGRES_USER) { $env:POSTGRES_USER } else { "proxyhubb" }
$pgDb = if ($env:POSTGRES_DB) { $env:POSTGRES_DB } else { "proxyhubb" }
$pgPass = $env:POSTGRES_PASSWORD
if (-not $pgPass) { throw "POSTGRES_PASSWORD not set in .env" }

if (-not $ProviderNodeId) {
    $ProviderNodeId = (docker exec -e PGPASSWORD=$pgPass proxyhubb-postgres-1 `
        psql -U $pgUser -d $pgDb -tAc `
        "SELECT id::text FROM provider_nodes ORDER BY last_seen_at DESC NULLS LAST, created_at DESC LIMIT 1;" 2>$null | Out-String).Trim()
}
if (-not $ProviderNodeId) { throw "No provider_nodes row found in Postgres." }

$country = (docker exec -e PGPASSWORD=$pgPass proxyhubb-postgres-1 `
    psql -U $pgUser -d $pgDb -tAc `
    "SELECT COALESCE(country, 'GH') FROM provider_nodes WHERE id = '$ProviderNodeId' LIMIT 1;" 2>$null | Out-String).Trim()

Write-Host "[post-signed-listing] node_id: $ProviderNodeId, country: $country" -ForegroundColor Cyan

$draftPath = Join-Path $env:TEMP "proxyhubb-listing-draft.json"
$signedPath = Join-Path $env:TEMP "proxyhubb-listing-signed.json"

$draftJson = (@{
    title = $Title
    description = "Signed listing created by post-signed-listing-docker.ps1 for enforce-mode verification."
    provider_node_id = $ProviderNodeId
    proxy_type = "residential"
    protocol = "http"
    price_per_gb = 0.55
    min_purchase_gb = 1
    available_bandwidth_gb = 25
    max_concurrency = 5
    listing_offer_expires_at = 0
    country = $country
    isp = ""
} | ConvertTo-Json -Depth 5)
[System.IO.File]::WriteAllText($draftPath, $draftJson, [System.Text.UTF8Encoding]::new($false))

& (Join-Path $repoRoot "scripts\sign-provider-listing.ps1") -InputPath $draftPath -Output $signedPath -ProviderNodeId $ProviderNodeId
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$auth = Invoke-RestMethod -Uri ($ApiBaseUrl.TrimEnd('/') + "/v1/provider/auth") -Method Post `
    -Body (@{ token = $apiKey } | ConvertTo-Json) -ContentType "application/json" -TimeoutSec 15
if (-not $auth.valid) { throw "Provider token rejected by /v1/provider/auth" }
$sessionToken = if ($auth.jwt_token) { $auth.jwt_token } else { $apiKey }
Write-Host "[post-signed-listing] user_id: $($auth.user_id)" -ForegroundColor DarkGray

$body = Get-Content -Path $signedPath -Raw
$headers = @{
    Authorization = "Bearer $sessionToken"
    "Content-Type" = "application/json"
}

Write-Host "[post-signed-listing] POST $ApiBaseUrl/v1/listings" -ForegroundColor DarkGray
try {
    $resp = Invoke-RestMethod -Uri ($ApiBaseUrl.TrimEnd('/') + "/v1/listings") -Method Post -Headers $headers -Body $body -TimeoutSec 30
}
catch {
    if ($_.Exception.Response) {
        $reader = [System.IO.StreamReader]::new($_.Exception.Response.GetResponseStream())
        $errBody = $reader.ReadToEnd()
        $reader.Close()
        Write-Host $errBody -ForegroundColor Red
    }
    throw
}

$listingId = $resp.id
if (-not $listingId) { $listingId = $resp.ID }
Write-Host "[OK] Created listing $listingId" -ForegroundColor Green

$proofRow = docker exec -e PGPASSWORD=$pgPass proxyhubb-postgres-1 `
    psql -U $pgUser -d $pgDb -tAc `
    "SELECT listing_offer_verified, COALESCE(listing_offer_signer,''), COALESCE(listing_offer_verification_error,'') FROM proxy_listings WHERE id = '$listingId' LIMIT 1;" 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Host "[WARN] Could not query listing proof columns" -ForegroundColor Yellow
    exit 0
}

$parts = ($proofRow | Out-String).Trim() -split '\|'
$verified = $parts[0].Trim()
$signer = if ($parts.Length -gt 1) { $parts[1].Trim() } else { "" }
$verr = if ($parts.Length -gt 2) { $parts[2].Trim() } else { "" }

Write-Host "listing_offer_verified = $verified" -ForegroundColor $(if ($verified -eq 't') { 'Green' } else { 'Yellow' })
if ($signer) { Write-Host "listing_offer_signer   = $signer" -ForegroundColor DarkGray }
if ($verr) { Write-Host "verification_error     = $verr" -ForegroundColor DarkGray }

$mode = docker exec proxyhubb-control-api-1 printenv PROVIDER_SIGNATURE_MODE 2>$null
if ($mode) { Write-Host "PROVIDER_SIGNATURE_MODE  = $($mode.Trim())" -ForegroundColor DarkGray }

if ($verified -ne 't') {
    Write-Host "[FAIL] Expected listing_offer_verified=true (is enforce mode on and proof valid?)" -ForegroundColor Red
    exit 1
}

Write-Host "[OK] Signed listing verified in database" -ForegroundColor Green
