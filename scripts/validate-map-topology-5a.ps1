# Validates Phase 5a: seeds an active session intent, triggers aggregation, checks GET /v1/map/links.
# Usage: .\scripts\validate-map-topology-5a.ps1 [-ApiBase http://localhost:18080] [-ComposeFile docker-compose.yml]

param(
    [string]$ApiBase = 'http://localhost:18080',
    [string]$ComposeFile = 'docker-compose.yml'
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

function Invoke-ComposeExec {
    param([string]$Sql)
    docker compose -f $ComposeFile exec -T postgres psql -U proxyhubb -d proxyhubb -v ON_ERROR_STOP=1 -c $Sql
}

Write-Host "==> Phase 5a validation (API: $ApiBase)" -ForegroundColor Cyan

$health = Invoke-RestMethod -Uri "$ApiBase/health" -Method Get -TimeoutSec 10
if (-not $health) { throw 'control-api health check failed' }

Write-Host "==> Resolving provider node + listing for seed session..." -ForegroundColor Cyan
$seedQuery = @"
SELECT pn.id AS provider_id,
       pl.id AS listing_id,
       COALESCE(p.id, pl.seller_id) AS user_id
FROM provider_nodes pn
JOIN proxy_listings pl ON pl.seller_id = pn.user_id
LEFT JOIN profiles p ON p.id = pl.seller_id
WHERE pn.country IS NOT NULL AND pn.country <> ''
ORDER BY pn.updated_at DESC NULLS LAST
LIMIT 1;
"@

$seedRow = docker compose -f $ComposeFile exec -T postgres psql -U proxyhubb -d proxyhubb -At -F '|' -c $seedQuery
if (-not $seedRow) { throw 'No provider node + listing found — bootstrap provider dev data first' }
$parts = $seedRow.Trim().Split('|')
$providerId = $parts[0]
$listingId = $parts[1]
$userId = $parts[2]
Write-Host "    provider=$providerId listing=$listingId user=$userId"

$sessionId = [guid]::NewGuid().ToString()
$expires = (Get-Date).ToUniversalTime().AddHours(2).ToString('yyyy-MM-dd HH:mm:ss+00')

Write-Host "==> Inserting active session_intent $sessionId (target US)..." -ForegroundColor Cyan
$insertSql = @"
INSERT INTO session_intents (
  id, user_id, listing_id, session_type, lifecycle_state,
  target_geo, provider_node_id, expires_at, activated_at, last_seen_at
) VALUES (
  '$sessionId', '$userId', '$listingId', 'proxy', 'active',
  'US', '$providerId', '$expires', NOW(), NOW()
)
ON CONFLICT (id) DO UPDATE SET
  lifecycle_state = EXCLUDED.lifecycle_state,
  target_geo = EXCLUDED.target_geo,
  provider_node_id = EXCLUDED.provider_node_id,
  expires_at = EXCLUDED.expires_at,
  updated_at = NOW();
"@
Invoke-ComposeExec -Sql $insertSql | Out-Null

Write-Host "==> Triggering aggregation (POST /v1/system/map/links/aggregate)..." -ForegroundColor Cyan
try {
    Invoke-RestMethod -Uri "$ApiBase/v1/system/map/links/aggregate" -Method Post -TimeoutSec 15 | Out-Null
} catch {
    Write-Warning "Aggregate endpoint unavailable ($($_.Exception.Message)); waiting 65s for worker tick..."
    Start-Sleep -Seconds 65
}

Start-Sleep -Seconds 2

Write-Host "==> Fetching GET /v1/map/links..." -ForegroundColor Cyan
$links = Invoke-RestMethod -Uri "$ApiBase/v1/map/links" -Method Get -TimeoutSec 15
$count = $links.meta.count
$available = $links.meta.topology_available
Write-Host "    topology_available=$available count=$count"

if (-not $available) {
    throw 'Expected topology_available=true after seeding active session'
}
if ($count -lt 1) {
    throw "Expected at least 1 link, got $count"
}

Write-Host "==> Phase 5a validation passed." -ForegroundColor Green
$links.links | Select-Object -First 3 | ConvertTo-Json -Depth 6
