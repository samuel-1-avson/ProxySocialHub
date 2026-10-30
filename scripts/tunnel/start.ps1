# Put this laptop's ProxyHubb stack on public ngrok addresses so a buyer on
# another machine can use it like the hosted site. Undo with stop.ps1.
#
#   .\scripts\tunnel\start.ps1 -Build                  first time (rebuilds web)
#   .\scripts\tunnel\start.ps1                         later runs
#   .\scripts\tunnel\start.ps1 -Domain you.ngrok-free.app   fixed address
param(
    [string]$Domain = "",
    [switch]$Build
)
$ErrorActionPreference = "Stop"

$repo = (Resolve-Path "$PSScriptRoot\..\..").Path
$compose = @("compose", "-p", "proxyhubb", "-f", "$repo\docker-compose.yml", "-f", "$PSScriptRoot\compose.tunnel.yml")

if ($Build) {
    docker @compose up -d --build web
    if ($LASTEXITCODE -ne 0) { throw "Web build failed." }
}
$out = Join-Path $PSScriptRoot "out"
New-Item -ItemType Directory -Force $out | Out-Null
docker @compose up -d --no-deps tunnel-edge
if ($LASTEXITCODE -ne 0) { throw "Could not start the router (tunnel-edge)." }
# Caddy reads the Caddyfile at start; restart so edits to it apply.
docker @compose restart tunnel-edge | Out-Null

# ngrok: one https address for the site, one TCP address for the buyer proxy port.
Get-Process ngrok -ErrorAction SilentlyContinue | Stop-Process -Force
$tunnelCfg = Join-Path $env:TEMP "proxyhubb-ngrok.yml"
$domainLine = if ($Domain) { "`n    domain: $Domain" } else { "" }
@"
version: "3"
tunnels:
  web:
    proto: http
    addr: 127.0.0.1:8088$domainLine
  proxy:
    proto: tcp
    addr: 127.0.0.1:8090
"@ | Set-Content -Encoding ascii $tunnelCfg

$accountCfg = Join-Path $env:LOCALAPPDATA "ngrok\ngrok.yml"
$log = Join-Path $env:TEMP "proxyhubb-ngrok.log"
Remove-Item $log -ErrorAction SilentlyContinue
Start-Process ngrok -WindowStyle Minimized -ArgumentList @(
    "start", "--all", "--config", "`"$accountCfg,$tunnelCfg`"", "--log", "`"$log`""
)

$web = $null; $tcp = $null
for ($i = 0; $i -lt 30 -and -not ($web -and $tcp); $i++) {
    Start-Sleep -Seconds 1
    try {
        $tunnels = (Invoke-RestMethod http://127.0.0.1:4040/api/tunnels).tunnels
        $web = ($tunnels | Where-Object { $_.proto -eq "https" } | Select-Object -First 1).public_url
        $tcp = ($tunnels | Where-Object { $_.proto -eq "tcp" } | Select-Object -First 1).public_url
    } catch {}
}
if (-not ($web -and $tcp)) { throw "ngrok did not start. Look at $log" }
$proxy = [uri]$tcp

# control-api must know the public addresses: allowed origins, and the proxy
# host:port it hands to buyers. Shell variables beat .env for these only.
$env:FRONTEND_URL = $web
$env:APP_URL = $web
$env:CORS_ORIGINS = "$web,http://localhost:8088,http://localhost:3009,http://127.0.0.1:3009"
$env:EDGE_GATEWAY_BUYER_HOST = $proxy.Host
$env:EDGE_GATEWAY_BUYER_PORT = "$($proxy.Port)"
docker @compose up -d --no-deps control-api
if ($LASTEXITCODE -ne 0) { throw "Could not restart control-api." }

$api = docker @compose ps -q control-api
for ($i = 0; $i -lt 60; $i++) {
    if ((docker inspect -f "{{.State.Health.Status}}" $api) -eq "healthy") { break }
    Start-Sleep -Seconds 2
}

# Chrome and Firefox test builds that trust this address, served at
# /proxyhubb-extension-chrome.zip and /proxyhubb-extension-firefox.zip.
$ext = Join-Path $repo "apps\extension"
Remove-Item (Join-Path $out "proxyhubb-extension*.zip") -ErrorAction SilentlyContinue
$env:PROXYHUBB_SITE = $web
Push-Location $ext
try {
    foreach ($browser in "chrome", "firefox") {
        $flag = if ($browser -eq "firefox") { @("--", "--firefox") } else { @() }
        npm run build --silent @flag
        if ($LASTEXITCODE -ne 0) { throw "Extension build ($browser) failed." }
        $dist = Join-Path $ext $(if ($browser -eq "firefox") { "dist-firefox" } else { "dist" })
        # tar writes forward-slash paths, so unzip on Linux and macOS extracts cleanly.
        $entries = Get-ChildItem $dist | ForEach-Object { $_.Name }
        tar.exe -a -cf (Join-Path $out "proxyhubb-extension-$browser.zip") -C $dist @entries
        if ($LASTEXITCODE -ne 0) { throw "Could not zip the $browser extension." }
    }
} finally {
    Pop-Location
    Remove-Item Env:PROXYHUBB_SITE
}

Write-Host ""
Write-Host "ProxyHubb is live for other machines:" -ForegroundColor Green
Write-Host "  Website (buyer and provider): $web"
Write-Host "  Proxy address for buyers:     $($proxy.Host):$($proxy.Port)"
Write-Host "  Extension (Chrome, Brave, Edge): $web/proxyhubb-extension-chrome.zip"
Write-Host "  Extension (Firefox):             $web/proxyhubb-extension-firefox.zip"
Write-Host "  On this laptop you can also use http://localhost:8088"
Write-Host ""
Write-Host "Keep the minimized ngrok window open. Run stop.ps1 when done."
