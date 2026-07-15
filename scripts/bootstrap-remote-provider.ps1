# Bootstrap provider-node against a remote (testnet/VPS) control-api and gateway.
#
# Usage:
#   .\scripts\bootstrap-remote-provider.ps1 `
#     -ControlApiUrl https://api.testnet.example.com `
#     -GatewayAddr proxy.testnet.example.com:3128 `
#     -StartProvider
#
# Writes config/docker/provider.toml with public URLs and runs bootstrap-provider-docker.ps1
# logic for tokens (against the remote API if reachable, or local DB if API is same stack).

param(
    [Parameter(Mandatory = $true)]
    [string]$ControlApiUrl,

    [Parameter(Mandatory = $true)]
    [string]$GatewayAddr,

    [switch]$StartProvider,
    [switch]$ForceNewToken,
    [switch]$Build
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

& (Join-Path $PSScriptRoot "bootstrap-provider-docker.ps1") `
    -ApiBaseUrl $ControlApiUrl `
    -StartProvider:$StartProvider `
    -ForceNewToken:$ForceNewToken `
    -Build:$Build

$tomlPath = Join-Path $repoRoot "config\docker\provider.toml"
if (-not (Test-Path $tomlPath)) {
    Write-Error "Expected $tomlPath after bootstrap"
}

$content = Get-Content $tomlPath -Raw
$content = $content -replace '(?m)^control_api_url\s*=\s*".*"', "control_api_url = `"$($ControlApiUrl.TrimEnd('/'))`""
$content = $content -replace '(?m)^gateway_addr\s*=\s*".*"', "gateway_addr = `"$GatewayAddr`""
Set-Content -Path $tomlPath -Value $content.TrimEnd() -Encoding utf8

Write-Host "Updated provider.toml for remote platform:" -ForegroundColor Green
Write-Host "  control_api_url = $ControlApiUrl"
Write-Host "  gateway_addr    = $GatewayAddr"
Write-Host ""
Write-Host "If provider runs on this machine against a remote VPS, use Docker only when the"
Write-Host "stack is local. For a bare provider-node on your PC, copy provider.toml to"
Write-Host "%APPDATA%\proxyhubb\provider.toml and run: provider-node start --config <path>"
