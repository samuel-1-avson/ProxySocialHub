# Quick soak check for PROVIDER_SIGNATURE_MODE=enforce in Docker dev.
# Run daily during a 1–3 day soak; logs failures and proof health.

param(
    [string]$ApiBaseUrl = ""
)

$ErrorActionPreference = "Continue"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

function Load-DotEnv([string]$path) {
    if (-not (Test-Path $path)) { return }
    Get-Content $path | ForEach-Object {
        if ($_ -match "^\s*([^#=]+)=(.*)$") {
            $k = $matches[1].Trim()
            $v = $matches[2].Trim().Trim('"').Trim("'")
            if ($v -match '^([^#]+)') { $v = $matches[1].Trim() }
            Set-Item -Path "env:$k" -Value $v
        }
    }
}

function Resolve-ApiBaseUrl {
    param([string]$Override)
    if ($Override) { return $Override.TrimEnd('/') }
    Load-DotEnv (Join-Path $root ".env")
    if ($env:API_BASE_URL) { return $env:API_BASE_URL.TrimEnd('/') }
    $port = if ($env:CONTROL_API_PORT) { $env:CONTROL_API_PORT } else { "18080" }
    return "http://localhost:$port"
}

function Get-ComposeBaseArgs {
    return @("-f", "docker-compose.yml")
}

function Get-ComposeProviderArgs {
    $args = Get-ComposeBaseArgs
    if (Test-Path (Join-Path $root "docker-compose.provider.yml")) {
        $args += @("-f", "docker-compose.provider.yml", "--profile", "provider")
    }
    return $args
}

function Get-ServiceStatus {
    param(
        [string[]]$ComposeArgs,
        [string]$ServiceName,
        [string]$ContainerName = ""
    )
    $status = docker compose @ComposeArgs ps $ServiceName --format "{{.Status}}" 2>$null
    if ($status) { return ($status | Select-Object -First 1).Trim() }
    if ($ContainerName) {
        $running = docker ps --filter "name=$ContainerName" --format "{{.Status}}" 2>$null
        if ($running) { return ($running | Select-Object -First 1).Trim() }
        $stopped = docker ps -a --filter "name=$ContainerName" --format "{{.Status}}" 2>$null
        if ($stopped) { return "(not running) $($stopped | Select-Object -First 1)" }
    }
    return "(not running — start with .\scripts\bootstrap-provider-docker.ps1 -StartProvider)"
}

$apiBase = Resolve-ApiBaseUrl -Override $ApiBaseUrl
$baseCompose = Get-ComposeBaseArgs
$providerCompose = Get-ComposeProviderArgs

Write-Host "=== Enforce soak monitor $(Get-Date -Format o) ===" -ForegroundColor Cyan
Write-Host "API base: $apiBase" -ForegroundColor DarkGray

$mode = docker compose @baseCompose exec -T control-api printenv PROVIDER_SIGNATURE_MODE 2>$null
$signedHb = docker compose @baseCompose exec -T edge-gateway printenv PROXYHUB_REQUIRE_SIGNED_HEARTBEATS 2>$null
if ($mode) { Write-Host "PROVIDER_SIGNATURE_MODE            = $($mode.Trim())" }
else { Write-Host "PROVIDER_SIGNATURE_MODE            = (control-api unreachable)" -ForegroundColor Yellow }
if ($signedHb) { Write-Host "PROXYHUB_REQUIRE_SIGNED_HEARTBEATS = $($signedHb.Trim())" }
else { Write-Host "PROXYHUB_REQUIRE_SIGNED_HEARTBEATS = (edge-gateway unreachable)" -ForegroundColor Yellow }

if ($mode -and $mode.Trim() -ne "enforce") {
    Write-Host "WARN: control-api not in enforce mode" -ForegroundColor Yellow
}

Write-Host "control-api:   $(Get-ServiceStatus -ComposeArgs $baseCompose -ServiceName 'control-api')"
Write-Host "edge-gateway:  $(Get-ServiceStatus -ComposeArgs $baseCompose -ServiceName 'edge-gateway')"
Write-Host "provider-node: $(Get-ServiceStatus -ComposeArgs $providerCompose -ServiceName 'provider-node' -ContainerName 'proxyhubb-provider-node')"

Write-Host "`n--- Recent proof-related log lines (last 30m) ---" -ForegroundColor DarkGray
$since = "30m"
foreach ($entry in @(
        @{ Label = "control-api"; Args = $baseCompose; Svc = "control-api" },
        @{ Label = "edge-gateway"; Args = $baseCompose; Svc = "edge-gateway" },
        @{ Label = "provider-node"; Args = $providerCompose; Svc = "provider-node" }
    )) {
    Write-Host "`n[$($entry.Label)]" -ForegroundColor DarkCyan
    docker compose @($entry.Args) logs --since $since $entry.Svc 2>$null |
        Select-String -Pattern "proof required|invalid provider|autoPublishListing: skipped|autoPublishListing: failed|listing proof" |
        Select-Object -Last 15
}

Write-Host "`n--- Verify script ---" -ForegroundColor DarkGray
& "$PSScriptRoot\verify-provider-proofs-docker.ps1" -ApiBaseUrl $apiBase

Write-Host "`n--- Proof policy API ---" -ForegroundColor DarkGray
$policyPaths = @(
    "/v1/system/provider-proof-policy",
    "/v1/marketplace/proof-policy",
    "/v1/listings/proof-policy"
)
$policyOk = $false
foreach ($path in $policyPaths) {
    try {
        $policy = Invoke-RestMethod -Uri "$apiBase$path" -Method Get
        if ($policy.error) { continue }
        Write-Host ("{0} -> mode={1} required={2}" -f $path, $policy.mode, $policy.required)
        $policyOk = $true
        if ($mode -and $mode.Trim() -eq "enforce" -and -not $policy.required) {
            Write-Host "WARN: container enforce but API reports observe (rebuild control-api)" -ForegroundColor Yellow
        }
        break
    } catch {
        Write-Host "$path failed: $($_.Exception.Message)" -ForegroundColor DarkGray
    }
}
if (-not $policyOk) {
    Write-Host "proof-policy unavailable on all paths — rebuild control-api:" -ForegroundColor Yellow
    Write-Host "  docker compose build control-api" -ForegroundColor DarkGray
    Write-Host "  docker compose up -d --force-recreate control-api" -ForegroundColor DarkGray
}

Write-Host "`nDone. Re-run daily during soak; investigate any new 'autoPublishListing: failed' or heartbeat 403s." -ForegroundColor Green
