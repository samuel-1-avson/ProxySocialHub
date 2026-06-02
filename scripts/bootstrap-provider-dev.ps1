# One-shot local provider dev setup without dashboard copy/paste.
# Mints an API token (same HMAC as control-api), writes ~/.proxyhubb/provider.toml,
# validates auth, optionally downloads CLI and starts the node.
#
# Usage:
#   .\scripts\bootstrap-provider-dev.ps1 -StartNode
#   .\scripts\bootstrap-provider-dev.ps1 -StartNode -RegistryCheck
#   .\scripts\bootstrap-provider-dev.ps1 -ForceNewToken
#
# By default reuses ~/.proxyhubb/provider.toml if auth still works (no new DB token).
#
# Requires: docker dev stack (postgres on localhost:5433), .env with POSTGRES_* and TOKEN_HMAC_SECRET

param(
    [string]$ProfileId = "",
    [string]$ApiBaseUrl = "http://localhost:18080",
    [string]$GatewayAddr = "localhost:3128",
    [switch]$StartNode,
    [switch]$TokenOnly,
    [switch]$SkipAuthTest,
    [switch]$RegistryCheck,
    [switch]$ForceNewToken
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

if ($ApiBaseUrl -match 'your-staging|example\.com|\.\.\.|^https?://\.\.\.$') {
    Write-Error @"
ApiBaseUrl looks like a documentation placeholder: $ApiBaseUrl

Local dev (default):
  .\scripts\bootstrap-provider-dev.ps1 -StartNode

Real staging needs your API URL and staging TOKEN_HMAC_SECRET / DB (not localhost:5433).
"@
}

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

function Test-ProviderAuthQuiet([string]$baseUrl, [string]$tomlPath) {
    $key = ""
    if (Test-Path $tomlPath) {
        $content = Get-Content $tomlPath -Raw
        if ($content -match 'api_key\s*=\s*"([^"]+)"') {
            $key = $matches[1]
        }
    }
    if (-not $key -or $key -match '<' -or $key.Length -lt 32) { return $false }
    try {
        $body = @{ token = $key } | ConvertTo-Json
        $resp = Invoke-RestMethod -Uri ($baseUrl.TrimEnd('/') + "/v1/provider/auth") -Method Post -Body $body -ContentType "application/json" -TimeoutSec 10
        return [bool]$resp.valid
    }
    catch {
        return $false
    }
}

function Invoke-RegistryE2E([string]$profileForCheck, [string]$nodeId) {
    if (-not $profileForCheck -or -not $nodeId) {
        Write-Host "[WARN] Registry check skipped (missing profile or provider_nodes row)" -ForegroundColor Yellow
        return
    }
    & (Join-Path $PSScriptRoot "registry-e2e-check.ps1") -ProfileId $profileForCheck -NodeId $nodeId
}

function Resolve-ProfileAndNodeId {
    param([string]$profileHint, [string]$mintOutput)
    $profile = $profileHint
    if (-not $profile -and ($mintOutput -match 'User:\s+([0-9a-f-]{36})')) {
        $profile = $matches[1]
    }
    if (-not $profile -and (Test-Path $script:tomlPath)) {
        $content = Get-Content $script:tomlPath -Raw
        if ($content -match 'api_key\s*=\s*"([^"]+)"') {
            $key = $matches[1]
            try {
                $body = @{ token = $key } | ConvertTo-Json
                $resp = Invoke-RestMethod -Uri ($ApiBaseUrl.TrimEnd('/') + "/v1/provider/auth") -Method Post -Body $body -ContentType "application/json" -TimeoutSec 10
                if ($resp.valid -and $resp.user_id) { $profile = $resp.user_id }
            }
            catch { }
        }
    }
    $node = ""
    if ($profile) {
        $node = (docker exec -e PGPASSWORD=$script:pgPass proxyhubb-postgres psql -U $script:pgUser -d $script:pgDb -tAc "SELECT id FROM provider_nodes WHERE user_id = '$profile' ORDER BY created_at DESC LIMIT 1;" 2>$null | Out-String).Trim()
    }
    return @{ ProfileId = $profile; NodeId = $node }
}

Load-DotEnv (Join-Path $repoRoot ".env")

$script:pgUser = if ($env:POSTGRES_USER) { $env:POSTGRES_USER } else { "proxyhubb" }
$script:pgDb = if ($env:POSTGRES_DB) { $env:POSTGRES_DB } else { "proxyhubb" }
$script:pgPass = $env:POSTGRES_PASSWORD
$pgHost = if ($env:POSTGRES_HOST) { $env:POSTGRES_HOST } else { "localhost" }
$pgPort = if ($env:POSTGRES_PORT) { $env:POSTGRES_PORT } else { "5433" }

if (-not $script:pgPass) { throw "POSTGRES_PASSWORD not set in .env" }
if (-not $env:TOKEN_HMAC_SECRET) { throw "TOKEN_HMAC_SECRET not set in .env (must match running control-api)" }

$env:DATABASE_URL = "postgresql://${script:pgUser}:${script:pgPass}@${pgHost}:${pgPort}/${script:pgDb}?sslmode=disable"

$script:tomlPath = Join-Path $env:USERPROFILE ".proxyhubb\provider.toml"

Write-Host "=== Bootstrap provider (local dev) ===" -ForegroundColor Cyan
Write-Host "API: $ApiBaseUrl  Gateway: $GatewayAddr  DB: ${pgHost}:${pgPort}" -ForegroundColor DarkGray

try {
    $h = Invoke-RestMethod "$ApiBaseUrl/health" -TimeoutSec 10
    if ($h.status -ne "ok") { throw "API health not ok" }
    Write-Host "[OK] control-api reachable" -ForegroundColor Green
}
catch {
    throw "control-api not reachable at $ApiBaseUrl. Run: docker compose -f docker-compose.dev.yml up -d"
}

$mintOut = ""
$reused = $false
if (-not $ForceNewToken -and (Test-Path $script:tomlPath) -and (Test-ProviderAuthQuiet $ApiBaseUrl $script:tomlPath)) {
    Write-Host "[OK] Reusing existing token in $script:tomlPath (-ForceNewToken to mint another)" -ForegroundColor Green
    $reused = $true
}
else {
    $mintArgs = @(
        "run", "./cmd/provider_dev_token",
        "-env-file", (Join-Path $repoRoot ".env"),
        "-api-url", $ApiBaseUrl.TrimEnd('/'),
        "-gateway", $GatewayAddr
    )
    if ($ProfileId) {
        $mintArgs += @("-user", $ProfileId)
    }

    Push-Location (Join-Path $repoRoot "services\control-api")
    try {
        $prevEap = $ErrorActionPreference
        $ErrorActionPreference = "Continue"
        $mintOut = & go @mintArgs 2>&1 | Out-String
        $mintExit = $LASTEXITCODE
        $ErrorActionPreference = $prevEap
        if ($mintExit -ne 0) {
            Write-Host $mintOut
            throw "provider_dev_token failed (exit $mintExit)"
        }
    }
    finally {
        Pop-Location
    }

    if ($mintOut -match 'Config:\s+(.+)') {
        $script:tomlPath = $matches[1].Trim()
    }
    Write-Host $mintOut
    Write-Host "[OK] Wrote $script:tomlPath" -ForegroundColor Green
}

if ($TokenOnly) { exit 0 }

if (-not $SkipAuthTest) {
    & (Join-Path $PSScriptRoot "test-provider-auth.ps1") -ApiBaseUrl $ApiBaseUrl
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

$ids = Resolve-ProfileAndNodeId -profileHint $ProfileId -mintOutput $mintOut

if ($RegistryCheck -and -not $StartNode) {
    Invoke-RegistryE2E -profileForCheck $ids.ProfileId -nodeId $ids.NodeId
}

if ($StartNode) {
    $bin = Join-Path $env:TEMP "provider-node.exe"
    if (-not (Test-Path $bin)) {
        Write-Host "Downloading provider-node CLI..." -ForegroundColor DarkGray
        $dlUrl = '{0}/v1/cli/download?platform=windows&arch=amd64' -f $ApiBaseUrl.TrimEnd('/')
        curl.exe --fail -sS -o $bin $dlUrl
    }
    Get-Process -Name provider-node -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 1

    if ($RegistryCheck) {
        Write-Host "Starting provider-node in background for registry check..." -ForegroundColor Cyan
        $proc = Start-Process -FilePath $bin -ArgumentList @('start', '--config', $script:tomlPath) -PassThru
        Write-Host "Waiting 35s for heartbeats (PID $($proc.Id))..." -ForegroundColor DarkGray
        Start-Sleep -Seconds 35
        Invoke-RegistryE2E -profileForCheck $ids.ProfileId -nodeId $ids.NodeId
        Write-Host ""
        Write-Host "Node still running in background (PID $($proc.Id))." -ForegroundColor Green
        Write-Host "  Stop: Stop-Process -Id $($proc.Id) -Force"
        Write-Host "  Stats: http://localhost:9090/stats"
        Write-Host "  Foreground logs: $bin start --config `"$script:tomlPath`""
    }
    else {
        Write-Host "Starting provider-node (foreground; Ctrl+C to stop)..." -ForegroundColor Cyan
        Write-Host "  $bin start --config `"$script:tomlPath`"" -ForegroundColor DarkGray
        & $bin start --config $script:tomlPath
    }
}
