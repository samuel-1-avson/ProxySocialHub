# Verify Phase 1 provider work: migration 085, CLI seed, registry link, mainnet KYC unit path.
# Usage (repo root): .\scripts\verify-provider-phase1.ps1
# Requires: docker dev stack (postgres + control-api on :18080)

param(
    [string]$PostgresContainer = "",
    [switch]$SkipDownload  # Step 3: only check DB metadata, do not pull the full binary
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path $PSScriptRoot -Parent
Set-Location $repoRoot

function Load-DotEnv([string]$path) {
    if (-not (Test-Path $path)) { return }
    Get-Content $path | ForEach-Object {
        if ($_ -match '^\s*([^#=]+)=(.*)$') {
            $k = $matches[1].Trim()
            $v = $matches[2].Trim().Trim('"').Trim("'")
            Set-Item -Path "env:$k" -Value $v
        }
    }
}

Load-DotEnv (Join-Path $repoRoot ".env")

$apiBase = if ($env:API_BASE_URL) { $env:API_BASE_URL } else { "http://localhost:18080" }
$pgUser = if ($env:POSTGRES_USER) { $env:POSTGRES_USER } else { "proxyhubb" }
$pgDb = if ($env:POSTGRES_DB) { $env:POSTGRES_DB } else { "proxyhubb" }
$pgPass = $env:POSTGRES_PASSWORD

if ([string]::IsNullOrWhiteSpace($PostgresContainer)) {
    $PostgresContainer = docker ps --format "{{.Names}}" |
        Where-Object { $_ -match '^proxyhubb-postgres' } |
        Select-Object -First 1
}
if ([string]::IsNullOrWhiteSpace($PostgresContainer)) {
    Write-Error "No running proxyhubb-postgres container found. Start stack: docker compose -f docker-compose.yml up -d postgres"
}
Write-Host "Using postgres container: $PostgresContainer" -ForegroundColor DarkGray

function Invoke-PostgresQuery([string]$Sql) {
    docker exec -e PGPASSWORD=$pgPass $PostgresContainer psql -U $pgUser -d $pgDb -tAc $Sql 2>&1
}

Write-Host "`n=== 1. API health ===" -ForegroundColor Cyan
$health = Invoke-RestMethod "$apiBase/health"
Write-Host "health: $($health.status)"

Write-Host "`n=== 2. Schema 000085 (postgres) ===" -ForegroundColor Cyan
$sql = "SELECT column_name FROM information_schema.columns WHERE table_name = 'provider_nodes' AND column_name = 'gateway_node_id' UNION ALL SELECT column_name FROM information_schema.columns WHERE table_name = 'nodes' AND column_name = 'provider_node_id';"
$cols = (Invoke-PostgresQuery $sql | Out-String)
if ($cols -notlike "*gateway_node_id*" -or $cols -notlike "*provider_node_id*") {
    Write-Error "Migration 085 columns missing on $PostgresContainer. Run: docker compose -f docker-compose.yml run --rm db-migrate"
}
Write-Host "columns OK: gateway_node_id, provider_node_id"

Write-Host "`n=== 3. CLI downloads (public) ===" -ForegroundColor Cyan
$metaSql = "SELECT filename, file_size FROM cli_downloads WHERE platform='windows' AND arch='amd64' AND is_latest=true AND is_active=true LIMIT 1;"
$meta = (Invoke-PostgresQuery $metaSql | Out-String).Trim()
if ($meta) {
    Write-Host "DB latest windows/amd64: $meta"
}

if ($SkipDownload) {
    Write-Host "Skipped full download (-SkipDownload). Use dashboard or curl manually if needed."
} else {
    # Full binary pull: ~6-14 MB. curl -s prints nothing until done, which looks hung on Docker Desktop.
    $expectedMb = if ($meta -match '\|(\d+)') { [math]::Round([int]$matches[1] / 1MB, 1) } else { 6 }
    Write-Host "Downloading ~${expectedMb} MB from $apiBase (typically 15-60s on Windows+Docker; not frozen)..." -ForegroundColor DarkGray
    $outFile = Join-Path $env:TEMP "provider-node-smoke.exe"
    if (Test-Path $outFile) { Remove-Item $outFile -Force }
    curl.exe --progress-bar --fail -o $outFile "$apiBase/v1/cli/download?platform=windows&arch=amd64" --max-time 180
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path $outFile) -or (Get-Item $outFile).Length -lt 1000) {
        Write-Error "CLI download failed. Tip: API_BASE_URL in .env should be http://localhost:18080 for docker-compose.dev (not :8080)."
    }
    $size = (Get-Item $outFile).Length
    Write-Host "downloaded ($size bytes) -> $outFile"
}

$count = Invoke-PostgresQuery "SELECT COUNT(*) FROM cli_downloads WHERE is_latest = true AND is_active = true;"
Write-Host "cli_downloads latest rows: $($count.Trim())"

Write-Host "`n=== 4. Registry link (gateway register smoke) ===" -ForegroundColor Cyan
if (-not $env:GATEWAY_SHARED_SECRET) {
    Write-Warning "GATEWAY_SHARED_SECRET not set - skipping gateway register smoke"
} else {
    $userId = Invoke-PostgresQuery "SELECT id FROM profiles WHERE role = 'provider' ORDER BY created_at DESC LIMIT 1;" | Out-String
    $userId = $userId.Trim()
    if (-not $userId) {
        $userId = Invoke-PostgresQuery "SELECT id FROM profiles ORDER BY created_at DESC LIMIT 1;" | Out-String
        $userId = $userId.Trim()
    }
    if (-not $userId) {
        Write-Warning "No users in DB - create a provider via dashboard first"
    } else {
        $gatewayNodeId = "node_$userId"
        $body = @{
            provider_user_id = $userId
            node_id          = $gatewayNodeId
            ip_address       = "203.0.113.10"
            port             = 1080
            region           = "verify-smoke"
            country_code     = "UG"
            city             = "Kampala"
            isp              = "SmokeTest"
            connection_type  = "residential"
        } | ConvertTo-Json
        $headers = @{ "X-Gateway-Auth" = $env:GATEWAY_SHARED_SECRET; "Content-Type" = "application/json" }
        $reg = Invoke-RestMethod -Uri "$apiBase/v1/gateway/nodes/register" -Method POST -Headers $headers -Body $body
        Write-Host "gateway register status: $($reg.status) gateway_row=$($reg.id)"

        $linkSql = "SELECT pn.id::text, pn.gateway_node_id, n.id::text, n.provider_node_id::text FROM provider_nodes pn LEFT JOIN nodes n ON n.provider_node_id = pn.id WHERE pn.user_id = '$userId' ORDER BY pn.created_at DESC LIMIT 1;"
        $link = (Invoke-PostgresQuery $linkSql | Out-String).Trim()
        if ($link) {
            Write-Host "latest provider_nodes row: $link"
        } else {
            Write-Host "no provider_nodes row yet for user (gateway nodes row created; create dashboard node to link)"
        }
        $nodesLink = (Invoke-PostgresQuery "SELECT gateway_node_id, provider_node_id::text FROM nodes WHERE provider_user_id = '$userId' ORDER BY last_seen_at DESC LIMIT 1;" | Out-String).Trim()
        Write-Host "latest nodes row: $nodesLink"
        $expectedGw = "node_$userId"
        if ($link -match [regex]::Escape($expectedGw) -and $nodesLink -match "provider_node_id") {
            Write-Host "registry link: OK" -ForegroundColor Green
        } elseif ($nodesLink -match [regex]::Escape($expectedGw)) {
            Write-Host "gateway row OK; create provider_nodes in dashboard to complete bidirectional link" -ForegroundColor Yellow
        }
    }
}

Write-Host "`n=== 5. Mainnet KYC (go test) ===" -ForegroundColor Cyan
Push-Location (Join-Path $repoRoot "services\control-api")
$prevGin = $env:GIN_MODE
$env:GIN_MODE = "test"
go test ./internal/api/... ./internal/solana/... -run "Mainnet|IsMainnet" -count=1
if ($prevGin) { $env:GIN_MODE = $prevGin } else { Remove-Item env:GIN_MODE -ErrorAction SilentlyContinue }
Pop-Location

Write-Host "`nAll automated checks finished." -ForegroundColor Green
