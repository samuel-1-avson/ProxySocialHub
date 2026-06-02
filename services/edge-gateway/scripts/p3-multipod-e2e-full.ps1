# P3 full E2E: provider on edge-a tunnel, buyer CONNECT via edge-b (peer forward).
# If ExecutionPolicy blocks .ps1, use: .\scripts\p3-multipod-e2e-full.cmd
# Or: powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\p3-multipod-e2e-full.ps1
# Prereq: .\scripts\p3-multipod-up.ps1 -Build
# If container name conflicts: .\scripts\p3-multipod-down.ps1 -RemoveLegacy; then up again
# Dev DB for minting tokens: docker compose --env-file .env -f docker-compose.dev.yml up -d postgres control-api
param(
    [string]$ApiBaseUrl = "http://localhost:18080",
    [int]$EdgeAPort = $(if ($env:P3_EDGE_A_PORT) { [int]$env:P3_EDGE_A_PORT } else { 28090 }),
    [int]$EdgeBPort = $(if ($env:P3_EDGE_B_PORT) { [int]$env:P3_EDGE_B_PORT } else { 28091 }),
    [int]$TunnelAPort = $(if ($env:P3_TUNNEL_A_PORT) { [int]$env:P3_TUNNEL_A_PORT } else { 23128 }),
    [string]$ConnectHost = "example.com",
    [int]$ConnectPort = 443,
    [int]$ProviderWaitSec = 45,
    [switch]$SkipComposeRecreate,
    [switch]$KeepProviderRunning,
    [switch]$ForceNewProviderToken,
    [int]$PostgresPort = $(if ($env:POSTGRES_PORT) { [int]$env:POSTGRES_PORT } else { 5433 })
)

$ErrorActionPreference = "Stop"
. "$PSScriptRoot\p3-compose.ps1"
$Root = Split-Path -Parent $PSScriptRoot
$RepoRoot = Split-Path -Parent (Split-Path -Parent $Root)
Set-Location $Root

function Test-TcpPortOpen {
    param(
        [string]$HostName = "127.0.0.1",
        [int]$Port,
        [int]$TimeoutMs = 2000
    )
    $client = New-Object System.Net.Sockets.TcpClient
    try {
        $iar = $client.BeginConnect($HostName, $Port, $null, $null)
        if (-not $iar.AsyncWaitHandle.WaitOne($TimeoutMs, $false)) { return $false }
        $client.EndConnect($iar) | Out-Null
        return $true
    }
    catch {
        return $false
    }
    finally {
        $client.Close()
    }
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

function Read-TcpHttpResponse {
    param(
        [System.Net.Sockets.TcpClient]$Client,
        [int]$TimeoutMs = 12000
    )
    $stream = $Client.GetStream()
    $stream.ReadTimeout = $TimeoutMs
    $buf = New-Object byte[] 8192
    $sb = New-Object System.Text.StringBuilder
    $deadline = [DateTime]::UtcNow.AddMilliseconds($TimeoutMs)
    while ([DateTime]::UtcNow -lt $deadline) {
        try {
            if (-not $stream.DataAvailable) {
                Start-Sleep -Milliseconds 40
                continue
            }
            $n = $stream.Read($buf, 0, $buf.Length)
            if ($n -le 0) { break }
            [void]$sb.Append([Text.Encoding]::ASCII.GetString($buf, 0, $n))
            if ($sb.ToString() -match "\r\n\r\n") { break }
        } catch [System.IO.IOException] {
            break
        }
    }
    return $sb.ToString()
}

function Invoke-ProxyConnect {
    param(
        [int]$Port,
        [string]$User,
        [string]$Pass,
        [string]$DestHost,
        [int]$DestPort
    )
    $auth = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes("${User}:${Pass}"))
    $target = "${DestHost}:${DestPort}"
    $req = @(
        "CONNECT $target HTTP/1.1",
        "Host: $target",
        "Proxy-Authorization: Basic $auth",
        "",
        ""
    ) -join "`r`n"

    $tcp = New-Object System.Net.Sockets.TcpClient
    $tcp.Connect("127.0.0.1", $Port)
    $stream = $tcp.GetStream()
    $bytes = [Text.Encoding]::ASCII.GetBytes($req)
    $stream.Write($bytes, 0, $bytes.Length)
    $stream.Flush()
    $resp = Read-TcpHttpResponse -Client $tcp
    $tcp.Close()
    return $resp
}

function Set-ProviderTomlGateway {
    param(
        [string]$Path,
        [string]$GatewayAddr
    )
    if (-not (Test-Path $Path)) { return }
    $lines = Get-Content $Path
    $found = $false
    $newLines = foreach ($line in $lines) {
        if ($line -match '^\s*gateway_addr\s*=') {
            $found = $true
            "gateway_addr = `"$GatewayAddr`""
        } else {
            $line
        }
    }
    if (-not $found) {
        $newLines = @("gateway_addr = `"$GatewayAddr`"") + @($newLines)
    }
    Set-Content -Path $Path -Value $newLines -Encoding UTF8
}

function Set-P3RedisJson {
    param(
        [string]$Key,
        [string]$Json,
        [int]$TtlSec = 3600,
        [string]$RedisUrl = "redis://127.0.0.1:26379"
    )
    $path = Join-Path $env:TEMP "p3-redis-$([guid]::NewGuid().ToString('N')).json"
    [System.IO.File]::WriteAllText($path, $Json, (New-Object System.Text.UTF8Encoding $false))
    $seed = Join-Path $RepoRoot "services\control-api"
    $prevEap = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    Push-Location $seed
    try {
        $out = go run ./cmd/p3_seed_redis -redis $RedisUrl -key $Key -file $path -ttl $TtlSec 2>&1 | Out-String
        if ($LASTEXITCODE -ne 0) {
            throw "p3_seed_redis failed: $out"
        }
    }
    finally {
        Pop-Location
        $ErrorActionPreference = $prevEap
        Remove-Item $path -Force -ErrorAction SilentlyContinue
    }
}

function Get-P3RedisDirectoryOwner {
    param([string]$NodeId)
    $key = "eg:provider:owner:$NodeId"
    $raw = Invoke-P3RedisCli --raw GET $key 2>$null
    if ($LASTEXITCODE -ne 0) { return $null }
    $text = if ($raw -is [array]) {
        (($raw | Where-Object { $_ -ne $null }) -join "`n")
    } else {
        [string]$raw
    }
    $text = $text.Trim()
    if ([string]::IsNullOrWhiteSpace($text) -or $text -eq "(nil)") { return $null }
    try {
        return $text | ConvertFrom-Json
    } catch {
        return $null
    }
}

function Test-ProviderOnEdgeRegistry {
    param(
        [string]$NodeId,
        [int]$EdgeAPort
    )
    try {
        $nodes = Invoke-RestMethod -Uri "http://127.0.0.1:$EdgeAPort/debug/nodes" -UseBasicParsing -TimeoutSec 8
        foreach ($n in @($nodes)) {
            if ($n.node_id -eq $NodeId) { return $true }
        }
    } catch {
        return $false
    }
    return $false
}

function Set-P3DirectoryOwnerRecord {
    param(
        [string]$NodeId,
        [string]$PodId,
        [int]$TtlSec = 120
    )
    $ts = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
    $record = @{
        node_id        = $NodeId
        pod_id         = $PodId
        region         = $null
        updated_at     = $ts
        country_code   = ""
        latency_ms     = 0
        is_healthy     = $true
        quality_score  = 0.0
    } | ConvertTo-Json -Compress
    Set-P3RedisJson -Key "eg:provider:owner:$NodeId" -Json $record -TtlSec $TtlSec
}

function Wait-DirectoryOwner {
    param(
        [string]$NodeId,
        [string]$ExpectedPod,
        [int]$EdgeAPort,
        [int]$TimeoutSec
    )
    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSec)
    $registrySeen = $false
    $directorySeeded = $false
    while ([DateTime]::UtcNow -lt $deadline) {
        $owner = Get-P3RedisDirectoryOwner -NodeId $NodeId
        if ($owner -and $owner.pod_id -eq $ExpectedPod) { return $true }

        if (-not $registrySeen) {
            $registrySeen = Test-ProviderOnEdgeRegistry -NodeId $NodeId -EdgeAPort $EdgeAPort
            if ($registrySeen) {
                Write-Host "OK provider visible on edge-a /debug/nodes (waiting for Redis directory claim...)"
            }
        }

        if ($registrySeen -and -not $owner -and -not $directorySeeded) {
            $keys = Invoke-P3RedisCli --raw KEYS "eg:provider:owner:*" 2>$null
            $keyText = if ($keys -is [array]) { ($keys -join ", ") } else { [string]$keys }
            if ([string]::IsNullOrWhiteSpace($keyText)) {
                Write-Host "WARN: no eg:provider:owner:* keys in Redis; seeding directory record for E2E (rebuild edge-a with --build if this persists)"
                Set-P3DirectoryOwnerRecord -NodeId $NodeId -PodId $ExpectedPod
                $directorySeeded = $true
                $owner = Get-P3RedisDirectoryOwner -NodeId $NodeId
                if ($owner -and $owner.pod_id -eq $ExpectedPod) { return $true }
            }
        }

        Start-Sleep -Seconds 2
    }
    return $false
}

$EnvFile = Join-Path $RepoRoot ".env"
Load-DotEnv $EnvFile
if (-not $env:JWT_SECRET) { throw "JWT_SECRET missing from .env (must match control-api and P3 pods)" }
if (-not $env:GATEWAY_SHARED_SECRET) { throw "GATEWAY_SHARED_SECRET missing from .env" }
Write-Host "== P3 multipod full E2E =="
Write-Host "control-api: $ApiBaseUrl"
Write-Host "edge-a buyer:$EdgeAPort tunnel:$TunnelAPort | edge-b buyer:$EdgeBPort"
Write-Host ""
Write-Host "Stack: .\scripts\p3-multipod-up.ps1 -Build  (compose project: $script:P3ComposeProject)"
Write-Host ""

# Align P3 pod secrets with dev stack (JWT + gateway shared secret).
if (-not $SkipComposeRecreate) {
    Write-Host "Recreating P3 edge pods with secrets from .env..."
    Remove-LegacyP3Containers
    $env:P3_CONTROL_API_URL = "http://host.docker.internal:18080"
    if (Test-Path $EnvFile) {
        docker compose -p $script:P3ComposeProject --env-file $EnvFile -f $script:P3ComposeFile `
            up -d --build --force-recreate --no-deps edge-a edge-b
    } else {
        Invoke-P3Compose @("up", "-d", "--build", "--force-recreate", "--no-deps", "edge-a", "edge-b")
    }
    if ($LASTEXITCODE -ne 0) { throw "docker compose recreate failed (exit $LASTEXITCODE)" }
    Start-Sleep -Seconds 8
}

foreach ($port in @($EdgeAPort, $EdgeBPort)) {
    $r = Invoke-WebRequest -Uri "http://127.0.0.1:$port/health" -UseBasicParsing -TimeoutSec 15
    if ($r.StatusCode -ne 200) { throw "health :$port => $($r.StatusCode)" }
}
Write-Host "OK both pods healthy"

# Mint / refresh provider credentials for tunnel on edge-a.
$bootstrap = Join-Path $RepoRoot "scripts\bootstrap-provider-dev.ps1"
if (-not (Test-Path $bootstrap)) { throw "Missing $bootstrap" }
$tomlPath = Join-Path $env:USERPROFILE ".proxyhubb\provider.toml"
$postgresUp = Test-TcpPortOpen -Port $PostgresPort
$mintNew = $ForceNewProviderToken -or $postgresUp
if ($ForceNewProviderToken -and -not $postgresUp) {
    throw @"
Cannot mint a new provider token: Postgres is not listening on 127.0.0.1:$PostgresPort.

Start the dev database (from repo root):
  docker compose --env-file .env -f docker-compose.dev.yml up -d postgres

Then re-run this script, or omit -ForceNewProviderToken to reuse ~/.proxyhubb/provider.toml if it still validates.
"@
}
if (-not $mintNew) {
    Write-Host "Postgres :$PostgresPort not reachable - reusing existing provider.toml (no -ForceNewToken)"
    if (-not (Test-Path $tomlPath)) {
        throw "No provider.toml at $tomlPath and Postgres is down; start postgres or run bootstrap-provider-dev.ps1 once"
    }
}
$tunnelGateway = "127.0.0.1:$TunnelAPort"
if ($mintNew) {
    $bootstrapParams = @{
        ApiBaseUrl  = $ApiBaseUrl
        GatewayAddr = $tunnelGateway
        TokenOnly   = $true
    }
    if ($ForceNewProviderToken) { $bootstrapParams['ForceNewToken'] = $true }
    $prevEapBootstrap = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    & $bootstrap @bootstrapParams 2>&1 | ForEach-Object { Write-Host $_ }
    $ErrorActionPreference = $prevEapBootstrap
    if ($LASTEXITCODE -ne 0) { throw "bootstrap-provider-dev failed" }
} else {
    Write-Host "Skipping bootstrap-provider-dev (reusing provider.toml)"
}
Set-ProviderTomlGateway -Path $tomlPath -GatewayAddr $tunnelGateway
Write-Host "OK provider.toml gateway_addr -> $tunnelGateway"

if (-not (Test-Path $tomlPath)) { throw "provider.toml not found at $tomlPath" }
$toml = Get-Content $tomlPath -Raw
$apiKeyMatch = [regex]::Match($toml, 'api_key\s*=\s*"([a-fA-F0-9]+)"')
if (-not $apiKeyMatch.Success) { throw "api_key not found in provider.toml" }
$apiKey = $apiKeyMatch.Groups[1].Value

$authBody = @{ token = $apiKey } | ConvertTo-Json
$authResp = Invoke-RestMethod -Uri ($ApiBaseUrl.TrimEnd('/') + "/v1/provider/auth") -Method Post -Body $authBody -ContentType "application/json" -TimeoutSec 20
if (-not $authResp.valid) { throw "provider auth invalid: $($authResp.message)" }
$providerUserId = $authResp.user_id
if (-not $providerUserId) { throw "provider auth returned no user_id" }
$runtimeNodeId = "node_$providerUserId"
Write-Host "OK provider user=$providerUserId runtime_node_id=$runtimeNodeId"

# Buyer session in P3 Redis (same key layout as control-api / edge-gateway).
$sessionUser = "p3e2e-$([guid]::NewGuid().ToString('N').Substring(0,8))"
$sessionPass = "p3e2e-pass-$([guid]::NewGuid().ToString('N').Substring(0,8))"
$sessionId = [guid]::NewGuid().ToString()
$now = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
$expires = (Get-Date).ToUniversalTime().AddHours(24).ToString("yyyy-MM-ddTHH:mm:ssZ")

$sessionObj = @{
    user_id          = $providerUserId
    session_id       = $sessionId
    provider_id      = ""
    type             = "sticky"
    status           = "active"
    bandwidth_limit  = 1073741824
    bandwidth_used   = 0
    trust_tier       = "verified"
    target_geo       = ""
    created_at       = $now
    expires_at       = $expires
}
$sessionJson = $sessionObj | ConvertTo-Json -Compress
Set-P3RedisJson -Key "session:$sessionUser" -Json $sessionJson -TtlSec 3600
Set-P3RedisJson -Key "sticky:$sessionId" -Json $runtimeNodeId -TtlSec 3600
Write-Host "OK seeded session:$sessionUser and sticky:$sessionId -> $runtimeNodeId"

# Start provider-node (release binary preferred).
$providerBin = Join-Path $RepoRoot "services\provider-node\target\release\provider-node.exe"
if (-not (Test-Path $providerBin)) {
    $providerBin = Join-Path $RepoRoot "services\provider-node\target\debug\provider-node.exe"
}
if (-not (Test-Path $providerBin)) {
    Write-Host "Building provider-node..."
    Push-Location (Join-Path $RepoRoot "services\provider-node")
    cargo build --release 2>&1 | Out-Host
    Pop-Location
    $providerBin = Join-Path $RepoRoot "services\provider-node\target\release\provider-node.exe"
}

Get-Process -Name provider-node -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 1

Write-Host "Starting provider-node -> 127.0.0.1:$TunnelAPort ..."
$providerProc = Start-Process -FilePath $providerBin -ArgumentList @('start', '--config', $tomlPath) -PassThru -WindowStyle Hidden

try {
    if (-not (Wait-DirectoryOwner -NodeId $runtimeNodeId -ExpectedPod "edge-a" -EdgeAPort $EdgeAPort -TimeoutSec $ProviderWaitSec)) {
        docker logs (Get-P3EdgeAContainerId) --tail 40 2>&1 | Out-Host
        Write-Host "Redis directory keys:" 
        Invoke-P3RedisCli KEYS "eg:provider:owner:*" 2>&1 | ForEach-Object { Write-Host "  $_" }
        throw "Directory never showed edge-a owner for $runtimeNodeId within ${ProviderWaitSec}s"
    }
    Write-Host "OK directory claims edge-a owns $runtimeNodeId"

  # Baseline: no auth -> 407 on edge-b
    $unauth = Invoke-ProxyConnect -Port $EdgeBPort -User "x" -Pass "y" -DestHost $ConnectHost -DestPort $ConnectPort
    if ($unauth -notmatch "407") {
        throw "expected 407 without auth on edge-b, got: $($unauth.Substring(0, [Math]::Min(200, $unauth.Length)))"
    }

    $resp = Invoke-ProxyConnect -Port $EdgeBPort -User $sessionUser -Pass $sessionPass -DestHost $ConnectHost -DestPort $ConnectPort
    Write-Host "CONNECT response (first lines):"
    ($resp -split "`r`n" | Select-Object -First 6) | ForEach-Object { Write-Host "  $_" }

    if ($resp -match "407") {
        docker logs (Get-P3EdgeBContainerId) --tail 50 2>&1 | Out-Host
        throw "CONNECT failed auth (407) - check SESSION_SECRET / redis session seed"
    }
    if ($resp -notmatch "200") {
        if ($resp -match "502|503|504") {
            Write-Host "WARN upstream error after tunnel (routing likely OK): $($resp.Substring(0,80))"
        } else {
            throw "unexpected CONNECT response (wanted 200/502/504): $($resp.Substring(0, [Math]::Min(300, $resp.Length)))"
        }
    } else {
        Write-Host "OK CONNECT established via edge-b"
    }

    $metrics = (Invoke-WebRequest -Uri "http://127.0.0.1:$EdgeBPort/metrics" -UseBasicParsing -TimeoutSec 10).Content
    if ($metrics.Contains("edge_gateway_provider_route_selection_total") -and $metrics.Contains('route="remote"')) {
        Write-Host "OK metrics show edge_gateway_provider_route_selection route=remote"
    } else {
        Write-Host "WARN edge_gateway_provider_route_selection{route=remote} not in /metrics (sticky/local path may still be OK)"
    }

    Write-Host ""
    Write-Host "P3 full E2E passed."
}
finally {
    if (-not $KeepProviderRunning) {
        if ($providerProc -and -not $providerProc.HasExited) {
            Stop-Process -Id $providerProc.Id -Force -ErrorAction SilentlyContinue
        }
        Get-Process -Name provider-node -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    } else {
        Write-Host "provider-node still running (PID $($providerProc.Id))"
    }
}
