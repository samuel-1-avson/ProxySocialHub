# Undo start.ps1: close the public addresses and give control-api its .env values back.
#
#   .\scripts\tunnel\stop.ps1             keep the tunnel-mode web build
#   .\scripts\tunnel\stop.ps1 -Rebuild    also rebuild web the normal way
param([switch]$Rebuild)
$ErrorActionPreference = "Stop"

$repo = (Resolve-Path "$PSScriptRoot\..\..").Path
$overlay = @("compose", "-p", "proxyhubb", "-f", "$repo\docker-compose.yml", "-f", "$PSScriptRoot\compose.tunnel.yml")
$normal = @("compose", "-p", "proxyhubb", "-f", "$repo\docker-compose.yml")

Get-Process ngrok -ErrorAction SilentlyContinue | Stop-Process -Force
docker @overlay rm -sf tunnel-edge
docker @normal up -d --no-deps control-api
if ($Rebuild) { docker @normal up -d --build web }

Write-Host "Public addresses closed." -ForegroundColor Green
