# Run edge-gateway on the host against docker-compose dependencies (Redis, control-api).
# Usage (from repo root):
#   .\scripts\start-edge-gateway-local.ps1
#   .\scripts\start-edge-gateway-local.ps1 -Features quic -Http3

param(
    [string]$Features = "quic",
    [switch]$Http3,
    [int]$BuyerPort = 8090,
    [int]$TunnelPort = 3128,
    [int]$MetricsPort = 9090,
    [switch]$MetricsOnBuyerPort
)

$ErrorActionPreference = "Stop"
$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")

function Import-DotEnv([string]$Path) {
    if (-not (Test-Path $Path)) {
        throw "Missing $Path - copy .env.example to .env and fill secrets."
    }
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

Import-DotEnv (Join-Path $RepoRoot ".env")

foreach ($required in @("JWT_SECRET", "GATEWAY_SHARED_SECRET", "SESSION_SECRET", "PROVIDER_PRIVATE_KEY", "REDIS_PASSWORD")) {
    $v = [Environment]::GetEnvironmentVariable($required, "Process")
    if ([string]::IsNullOrWhiteSpace($v)) {
        throw "$required is not set in .env"
    }
}

# Host-side URLs (docker-compose.yml publishes these ports)
$env:REDIS_URL = "redis://:$($env:REDIS_PASSWORD)@127.0.0.1:6379"
$env:CONTROL_API_URL = if ($env:CONTROL_API_URL -match '@|://redis:|://postgres:|://control-api:') {
    "http://127.0.0.1:18080"
} else {
    if ([string]::IsNullOrWhiteSpace($env:CONTROL_API_URL)) { "http://127.0.0.1:18080" } else { $env:CONTROL_API_URL }
}
$env:HOST = "0.0.0.0"
$env:PORT = "$BuyerPort"
$env:TUNNEL_PORT = "$TunnelPort"
if ($MetricsOnBuyerPort) {
    $env:METRICS_PORT = "0"
} else {
    $env:METRICS_PORT = "$MetricsPort"
}
$env:RUST_LOG = if ($env:RUST_LOG) { $env:RUST_LOG } else { "edge_gateway=info" }

if ($Http3) {
    $env:ENABLE_HTTP3_INGRESS = "1"
    if (-not $env:HTTP3_PORT) { $env:HTTP3_PORT = "8443" }
    if (-not $env:HTTP3_TLS_CERT_FILE -or -not $env:HTTP3_TLS_KEY_FILE) {
        Write-Warning "HTTP3 enabled but HTTP3_TLS_CERT_FILE / HTTP3_TLS_KEY_FILE not set; gateway may fail TLS init."
    }
}

Write-Host "edge-gateway local dev"
if ($MetricsOnBuyerPort) {
    Write-Host "  buyer:    http://127.0.0.1:$BuyerPort  (/health /ready /metrics)"
} else {
    Write-Host "  buyer:    http://127.0.0.1:$BuyerPort  (/health /ready)"
    Write-Host "  metrics:  http://127.0.0.1:$MetricsPort/metrics"
}
Write-Host "  tunnel:   $TunnelPort (conflicts with docker edge-gateway if both use 3128)"
$redisDisplay = $env:REDIS_URL -replace [regex]::Escape($env:REDIS_PASSWORD), "***"
Write-Host "  redis:    $redisDisplay"
Write-Host "  control:  $env:CONTROL_API_URL"
Write-Host ""

Set-Location (Join-Path $RepoRoot "services\edge-gateway")
$featureArg = if ([string]::IsNullOrWhiteSpace($Features)) { @() } else { @("--features", $Features) }
cargo run @featureArg
