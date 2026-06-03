# P6 ingress conformance smoke — one authenticated CONNECT per surface (HTTP/1.1, SOCKS5, optional HTTP/3).
# Prereq: main stack + provider; SOCKS5 requires ENABLE_SOCKS5=1 and port published.
param(
    [int]$GatewayPort = $(if ($env:EDGE_GATEWAY_PORT) { [int]$env:EDGE_GATEWAY_PORT } elseif ($env:EDGE_GATEWAY_HOST_PORT) { [int]$env:EDGE_GATEWAY_HOST_PORT } else { 8090 }),
    [int]$SocksPort = $(if ($env:EDGE_GATEWAY_SOCKS5_PORT) { [int]$env:EDGE_GATEWAY_SOCKS5_PORT } else { 1080 }),
    [int]$Http3Port = $(if ($env:EDGE_GATEWAY_HTTP3_PORT) { [int]$env:EDGE_GATEWAY_HTTP3_PORT } else { 8443 }),
    [string]$ApiBaseUrl = "",
    [string]$ConnectHost = "example.com",
    [int]$ConnectPort = 443,
    [string]$OutFile = "docs/P6_INGRESS_SMOKE.md",
    [switch]$SkipPrereqCheck
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$RepoRoot = Split-Path -Parent (Split-Path -Parent $Root)
Set-Location $Root

function Import-DotEnv([string]$Path) {
    if (-not (Test-Path $Path)) { return }
    Get-Content $Path | ForEach-Object {
        $line = $_.Trim()
        if ($line -eq "" -or $line.StartsWith("#")) { return }
        if ($line -match '^\s*([^#=]+)=(.*)$') {
            $name = $matches[1].Trim()
            $value = $matches[2].Trim().Trim('"').Trim("'")
            [Environment]::SetEnvironmentVariable($name, $value, "Process")
        }
    }
}

function Read-TcpHttpHeaders {
    param([System.Net.Sockets.TcpClient]$Client, [int]$TimeoutMs = 15000)
    $stream = $Client.GetStream()
    $stream.ReadTimeout = $TimeoutMs
    $buf = New-Object byte[] 8192
    $sb = New-Object System.Text.StringBuilder
    $deadline = [DateTime]::UtcNow.AddMilliseconds($TimeoutMs)
    while ([DateTime]::UtcNow -lt $deadline) {
        try {
            if (-not $stream.DataAvailable) { Start-Sleep -Milliseconds 25; continue }
            $n = $stream.Read($buf, 0, $buf.Length)
            if ($n -le 0) { break }
            [void]$sb.Append([Text.Encoding]::ASCII.GetString($buf, 0, $n))
            if ($sb.ToString() -match "\r\n\r\n") { break }
        } catch [System.IO.IOException] { break }
    }
    return $sb.ToString()
}

function Get-SoakRedisUrl {
    if (-not $env:REDIS_PASSWORD) { throw "REDIS_PASSWORD missing from .env" }
    $port = if ($env:REDIS_HOST_PORT) { $env:REDIS_HOST_PORT } else { "6379" }
    $pass = [Uri]::EscapeDataString($env:REDIS_PASSWORD)
    return "redis://:${pass}@127.0.0.1:${port}"
}

function Set-SoakRedisValue {
    param([string]$Key, [string]$Value, [int]$TtlSec = 3600)
    $path = Join-Path $env:TEMP "p6-smoke-redis-$([guid]::NewGuid().ToString('N')).json"
    [System.IO.File]::WriteAllText($path, $Value, (New-Object System.Text.UTF8Encoding $false))
    $seedDir = Join-Path $RepoRoot "services\control-api"
    Push-Location $seedDir
    try {
        $out = go run ./cmd/p3_seed_redis -redis (Get-SoakRedisUrl) -key $Key -file $path -ttl $TtlSec 2>&1 | Out-String
        if ($LASTEXITCODE -ne 0) { throw "p3_seed_redis failed: $out" }
    } finally {
        Pop-Location
        Remove-Item $path -Force -ErrorAction SilentlyContinue
    }
}

function Test-HttpConnect {
    param([string]$User, [string]$Pass, [int]$Port)
    $authB64 = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes("${User}:${Pass}"))
    $target = "${ConnectHost}:${ConnectPort}"
    $req = @(
        "CONNECT $target HTTP/1.1",
        "Host: $target",
        "Proxy-Authorization: Basic $authB64",
        "", ""
    ) -join "`r`n"
    $tcp = New-Object System.Net.Sockets.TcpClient
    $tcp.Connect("127.0.0.1", $Port)
    $stream = $tcp.GetStream()
    $bytes = [Text.Encoding]::ASCII.GetBytes($req)
    $stream.Write($bytes, 0, $bytes.Length)
    $stream.Flush()
    $resp = Read-TcpHttpHeaders -Client $tcp
    $tcp.Close()
    if ($resp -match "HTTP/1\.[01] (200|502|504)") {
        return @{ ok = $true; detail = ($resp -split "`r`n" | Select-Object -First 1) }
    }
    return @{ ok = $false; detail = if ($resp) { ($resp -split "`r`n" | Select-Object -First 3) -join " | " } else { "empty response" } }
}

function Test-Socks5Connect {
    param([string]$User, [string]$Pass, [int]$Port, [string]$TargetHost, [int]$TargetPortNum)
    $tcp = New-Object System.Net.Sockets.TcpClient
    $tcp.Connect("127.0.0.1", $Port)
    $s = $tcp.GetStream()
    $s.Write([byte[]](0x05, 0x01, 0x02), 0, 3)
    $methodResp = New-Object byte[] 2
    if ($s.Read($methodResp, 0, 2) -ne 2 -or $methodResp[1] -ne 0x02) {
        $tcp.Close()
        return @{ ok = $false; detail = "SOCKS5 method negotiation failed (is ENABLE_SOCKS5=1?)" }
    }
    $u = [Text.Encoding]::ASCII.GetBytes($User)
    $p = [Text.Encoding]::ASCII.GetBytes($Pass)
    $auth = New-Object System.Collections.Generic.List[byte]
    $auth.Add(0x01); $auth.Add([byte]$u.Length)
    $auth.AddRange([byte[]]$u)
    $auth.Add([byte]$p.Length)
    $auth.AddRange([byte[]]$p)
    $s.Write($auth.ToArray(), 0, $auth.Count)
    $authResp = New-Object byte[] 2
    if ($s.Read($authResp, 0, 2) -ne 2 -or $authResp[1] -ne 0x00) {
        $tcp.Close()
        return @{ ok = $false; detail = "SOCKS5 auth rejected" }
    }
    $hostBytes = [Text.Encoding]::ASCII.GetBytes($TargetHost)
    $req = New-Object System.Collections.Generic.List[byte]
    $req.AddRange([byte[]](0x05, 0x01, 0x00, 0x03, [byte]$hostBytes.Length))
    $req.AddRange([byte[]]$hostBytes)
    $req.Add([byte](($TargetPortNum -shr 8) -band 0xff))
    $req.Add([byte]($TargetPortNum -band 0xff))
    $s.Write($req.ToArray(), 0, $req.Count)
    $connResp = New-Object byte[] 10
    $n = $s.Read($connResp, 0, 10)
    $tcp.Close()
    if ($n -ge 2 -and $connResp[1] -eq 0x00) {
        return @{ ok = $true; detail = "SOCKS5 REP=0x00" }
    }
    $rep = if ($n -ge 2) { "0x$($connResp[1].ToString('X2'))" } else { "short read" }
    return @{ ok = $false; detail = "SOCKS5 CONNECT failed REP=$rep" }
}

function Test-PortOpen([int]$Port) {
    try {
        $c = New-Object System.Net.Sockets.TcpClient
        $iar = $c.BeginConnect("127.0.0.1", $Port, $null, $null)
        $ok = $iar.AsyncWaitHandle.WaitOne(2000, $false)
        if ($ok -and $c.Connected) { $c.Close(); return $true }
        $c.Close()
    } catch {}
    return $false
}

function Test-Http3Connect {
    param([string]$User, [string]$Pass, [int]$Port)
    $curl = Get-Command curl.exe -ErrorAction SilentlyContinue
    if (-not $curl) {
        return @{ ok = $false; skipped = $true; detail = "curl.exe not found" }
    }
    $ver = & curl.exe --version 2>&1 | Select-Object -First 1
    if ($ver -notmatch "HTTP3|ngtcp2|quiche") {
        return @{ ok = $false; skipped = $true; detail = "curl without HTTP/3 (need curl 8+ with ngtcp2)" }
    }
    $proxyUrl = "https://127.0.0.1:${Port}"
    $target = "https://${ConnectHost}:${ConnectPort}/"
    $auth = "${User}:${Pass}"
    $out = & curl.exe --http3-only --proxy-insecure -x $proxyUrl -U $auth -m 20 -sS -o NUL -w "%{http_code}" $target 2>&1
    $code = ($out | Select-Object -Last 1) -as [string]
    if ($code -match "^(200|502|504)$") {
        return @{ ok = $true; detail = "HTTP/3 proxy CONNECT http_code=$code" }
    }
    return @{ ok = $false; detail = ($out | Select-Object -Last 5) -join " " }
}

Import-DotEnv (Join-Path $RepoRoot ".env")
if (-not $ApiBaseUrl) {
    $apiPort = if ($env:CONTROL_API_HOST_PORT) { $env:CONTROL_API_HOST_PORT } else { "18080" }
    $ApiBaseUrl = "http://localhost:$apiPort"
}

Write-Host "== P6 ingress smoke ==" -ForegroundColor Cyan
Write-Host "HTTP buyer :$GatewayPort | SOCKS5 :$SocksPort | HTTP/3 UDP/TCP :$Http3Port"

if (-not $SkipPrereqCheck) {
    Invoke-WebRequest -Uri "http://127.0.0.1:${GatewayPort}/health" -UseBasicParsing -TimeoutSec 10 | Out-Null
}

$composeEnv = Join-Path $RepoRoot "config\docker\provider.compose.env"
if (-not (Test-Path $composeEnv)) { throw "Missing $composeEnv" }
$apiKey = $null
Get-Content $composeEnv | ForEach-Object {
    if ($_ -match '^\s*PROXYHUB_API_KEY=(.+)$') { $apiKey = $matches[1].Trim().Trim('"') }
}
if (-not $apiKey) { throw "PROXYHUB_API_KEY not found" }

$authResp = Invoke-RestMethod -Uri ($ApiBaseUrl.TrimEnd('/') + "/v1/provider/auth") -Method Post `
    -Body (@{ token = $apiKey } | ConvertTo-Json) -ContentType "application/json" -TimeoutSec 20
$userId = $authResp.user_id
$runtimeNodeId = "node_$userId"
$sessionUser = "p6-$([guid]::NewGuid().ToString('N').Substring(0,8))"
$sessionPass = "p6-pass"
$sessionId = [guid]::NewGuid().ToString()
$now = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
$expires = (Get-Date).ToUniversalTime().AddHours(6).ToString("yyyy-MM-ddTHH:mm:ssZ")
$sessionObj = @{
    user_id = $userId; session_id = $sessionId; provider_id = ""; type = "sticky"
    status = "active"; bandwidth_limit = 10737418240; bandwidth_used = 0
    trust_tier = "verified"; target_geo = ""; created_at = $now; expires_at = $expires
}
Set-SoakRedisValue -Key "session:$sessionUser" -Value ($sessionObj | ConvertTo-Json -Compress)
Set-SoakRedisValue -Key "sticky:$sessionId" -Value $runtimeNodeId
Write-Host "OK seeded session:$sessionUser"

$results = @()
$http = Test-HttpConnect -User $sessionUser -Pass $sessionPass -Port $GatewayPort
$results += [pscustomobject]@{ surface = "HTTP/1.1 CONNECT (:$GatewayPort)"; status = $(if ($http.ok) { "PASS" } else { "FAIL" }); detail = $http.detail }

if (Test-PortOpen $SocksPort) {
    $socks = Test-Socks5Connect -User $sessionUser -Pass $sessionPass -Port $SocksPort -TargetHost $ConnectHost -TargetPortNum $ConnectPort
    $results += [pscustomobject]@{ surface = "SOCKS5 CONNECT (:$SocksPort)"; status = $(if ($socks.ok) { "PASS" } else { "FAIL" }); detail = $socks.detail }
} else {
    $results += [pscustomobject]@{ surface = "SOCKS5 CONNECT (:$SocksPort)"; status = "SKIP"; detail = "port closed - set ENABLE_SOCKS5=1 and publish :1080" }
}

if (Test-PortOpen $Http3Port) {
    $h3 = Test-Http3Connect -User $sessionUser -Pass $sessionPass -Port $Http3Port
    if ($h3.skipped) {
        $results += [pscustomobject]@{ surface = "HTTP/3 CONNECT (:$Http3Port)"; status = "SKIP"; detail = $h3.detail }
    } else {
        $results += [pscustomobject]@{ surface = "HTTP/3 CONNECT (:$Http3Port)"; status = $(if ($h3.ok) { "PASS" } else { "FAIL" }); detail = $h3.detail }
    }
} else {
    $results += [pscustomobject]@{ surface = "HTTP/3 CONNECT (:$Http3Port)"; status = "SKIP"; detail = "port closed - rebuild with ENABLE_QUIC=1, ENABLE_HTTP3_INGRESS=1, publish UDP/TCP :8443" }
}

$results | Format-Table -AutoSize
$fail = @($results | Where-Object { $_.status -eq "FAIL" }).Count
$pass = @($results | Where-Object { $_.status -eq "PASS" }).Count

$lines = @()
$lines += ""
$lines += "## Run $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss zzz')"
$lines += ""
$lines += "| Surface | Status | Detail |"
$lines += "|---------|--------|--------|"
foreach ($r in $results) {
    $d = ($r.detail -replace '\|', '/')
    $lines += "| $($r.surface) | $($r.status) | $d |"
}
$lines += ""
$lines += "Summary: pass=$pass fail=$fail"
$lines += ""

$header = @"
# P6 ingress conformance smoke

One authenticated CONNECT per ingress surface. Run: ``scripts/p6-ingress-smoke.ps1``.

"@
if (-not (Test-Path $OutFile)) { Set-Content -Path $OutFile -Value $header -Encoding utf8 }
Add-Content -Path $OutFile -Value ($lines -join "`n") -Encoding utf8
Write-Host "Appended to $OutFile"

if ($fail -gt 0) { exit 1 }
Write-Host "P6 ingress smoke: OK" -ForegroundColor Green
