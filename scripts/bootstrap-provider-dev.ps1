# One-shot local provider dev setup without dashboard copy/paste.
# Mints an API token (same HMAC as control-api), writes ~/.config/proxyhubb/provider.toml,
# validates auth, optionally downloads CLI and starts the node.
#
# Usage:
#   .\scripts\bootstrap-provider-dev.ps1 -StartNode
#   .\scripts\bootstrap-provider-dev.ps1 -StartNode -RegistryCheck
#   .\scripts\bootstrap-provider-dev.ps1 -ForceNewToken
#
# By default reuses existing provider.toml (canonical or legacy path) if auth still works.
#
# Requires: docker dev stack (postgres on localhost:5433), .env with POSTGRES_* and TOKEN_HMAC_SECRET

param(
    [string]$ProfileId = "",
    [string]$ApiBaseUrl = "http://localhost:18080",
    [string]$GatewayAddr = "127.0.0.1:3128",
    [switch]$StartNode,
    [switch]$TokenOnly,
    [switch]$SkipAuthTest,
    [switch]$RegistryCheck,
    [switch]$ForceNewToken,
    [switch]$SkipSigningKey
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot
. (Join-Path $PSScriptRoot "provider-paths.ps1")

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
        if ($_ -match "^\s*([^#=]+)=(.*)$") {
            $k = $matches[1].Trim()
            $v = $matches[2].Trim().Trim('"').Trim("'")
            Set-Item -Path "env:$k" -Value $v
        }
    }
}

function Test-ProviderAuthQuiet([string]$baseUrl, [string]$tomlPath) {
    if (-not (Test-ProviderTomlHasUsableKey $tomlPath)) { return $false }
    $key = Get-ProviderApiKeyFromToml $tomlPath
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
        $keyMatch = [regex]::Match($content, 'api_key\s*=\s*"([a-fA-F0-9]+)"')
        if ($keyMatch.Success) {
            $key = $keyMatch.Groups[1].Value
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
function Resolve-PostgresHostPort {
    if ($env:POSTGRES_PORT) { return $env:POSTGRES_PORT }
    if ($env:POSTGRES_HOST_PORT) { return $env:POSTGRES_HOST_PORT }
    foreach ($name in @("proxyhubb-postgres-1", "proxyhubb-postgres")) {
        try {
            $mapped = docker port $name 5432/tcp 2>$null | Select-Object -First 1
            if ($mapped -match ':(\d+)->') { return $matches[1] }
            if ($mapped -match ':(\d+)$') { return $matches[1] }
        }
        catch { }
    }
    return "5433"
}

$pgHost = if ($env:POSTGRES_HOST) { $env:POSTGRES_HOST } else { "localhost" }
$pgPort = Resolve-PostgresHostPort

if (-not $script:pgPass) { throw "POSTGRES_PASSWORD not set in .env" }
if (-not $env:TOKEN_HMAC_SECRET) { throw "TOKEN_HMAC_SECRET not set in .env (must match running control-api)" }

$env:DATABASE_URL = "postgresql://${script:pgUser}:${script:pgPass}@${pgHost}:${pgPort}/${script:pgDb}?sslmode=disable"

Migrate-ProviderConfigToCanonical
$script:tomlPath = Resolve-ProviderConfigPath

Write-Host "=== Bootstrap provider (local dev) ===" -ForegroundColor Cyan
Write-Host "Config: $script:tomlPath" -ForegroundColor DarkGray
Write-Host "API: $ApiBaseUrl  Gateway: $GatewayAddr  DB: ${pgHost}:${pgPort}" -ForegroundColor DarkGray
$gatewayTransport = Get-GatewayTransport
Write-Host "Gateway transport: $gatewayTransport (set PROVIDER_TRANSPORT to match for host provider-node)" -ForegroundColor DarkGray
if (Test-DockerProviderNodeRunning) {
    Write-Host '[WARN] Docker provider-node is running - stop it before starting a host node:' -ForegroundColor Yellow
    Write-Host '  docker stop proxyhubb-provider-node' -ForegroundColor DarkGray
}

$healthOk = $false
for ($i = 1; $i -le 3; $i++) {
    try {
        $h = Invoke-RestMethod "$ApiBaseUrl/health" -TimeoutSec 10
        if ($h.status -eq "ok") {
            $healthOk = $true
            break
        }
    }
    catch {
        if ($i -lt 3) { Start-Sleep -Seconds 2 }
    }
}
if (-not $healthOk) {
    throw "control-api not reachable at $ApiBaseUrl. Ensure proxyhubb-control-api is up (docker compose -f docker-compose.dev.yml up -d control-api)."
}
Write-Host "[OK] control-api reachable" -ForegroundColor Green

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
        "-gateway", $GatewayAddr,
        "-ensure-profile"
    )
    if ($ProfileId) {
        $mintArgs += @("-user", $ProfileId)
    }
    if (-not $SkipSigningKey) {
        $mintArgs += @("-generate-signing-key", "-sync-hotkey")
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
    else {
        Ensure-ProviderConfigDir
        $script:tomlPath = Get-ProviderConfigPath
    }
    Write-Host $mintOut
    Write-Host "[OK] Wrote $script:tomlPath" -ForegroundColor Green
}

if ($gatewayTransport -in @("quic", "http3")) {
    Write-Host ""
    Write-Host "Host provider-node must use QUIC (matches docker-compose.provider.yml):" -ForegroundColor Cyan
    Write-Host "  `$env:PROVIDER_TRANSPORT = 'quic'" -ForegroundColor DarkGray
    Write-Host "  .\scripts\proxyhubb-cli.ps1 doctor" -ForegroundColor DarkGray
    Write-Host "  .\scripts\proxyhubb-cli.ps1 start" -ForegroundColor DarkGray
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
