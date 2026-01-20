# ProxyHub - Named Cloudflare Tunnel Setup
# Creates a persistent tunnel with a stable URL

$TunnelName = "proxyhubb-api"

Write-Host "🔐 Cloudflare Named Tunnel Setup" -ForegroundColor Cyan
Write-Host "=================================" -ForegroundColor Cyan

# 1. Check if cloudflared is installed
$cloudflared = Get-Command cloudflared -ErrorAction SilentlyContinue
if (-not $cloudflared) {
    Write-Error "cloudflared is not installed. Run: winget install Cloudflare.cloudflared"
    exit 1
}
Write-Host "✅ cloudflared found at $($cloudflared.Source)" -ForegroundColor Green

# 2. Login to Cloudflare (one-time, creates certificate)
$certPath = "$env:USERPROFILE\.cloudflared\cert.pem"
if (-not (Test-Path $certPath)) {
    Write-Host "`n📝 Step 1: Logging in to Cloudflare..." -ForegroundColor Yellow
    Write-Host "   A browser window will open. Please authenticate." -ForegroundColor DarkGray
    cloudflared tunnel login
    if (-not (Test-Path $certPath)) {
        Write-Error "Login failed. Please try again."
        exit 1
    }
}
Write-Host "✅ Authenticated with Cloudflare" -ForegroundColor Green

# 3. Create the tunnel (or list existing)
Write-Host "`n🔧 Step 2: Creating tunnel '$TunnelName'..." -ForegroundColor Yellow
$existingTunnel = cloudflared tunnel list | Select-String $TunnelName
if ($existingTunnel) {
    Write-Host "✅ Tunnel '$TunnelName' already exists" -ForegroundColor Green
} else {
    cloudflared tunnel create $TunnelName
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Failed to create tunnel"
        exit 1
    }
    Write-Host "✅ Tunnel '$TunnelName' created!" -ForegroundColor Green
}

# 4. Get Tunnel UUID
$tunnelInfo = cloudflared tunnel list | Select-String $TunnelName
$tunnelUUID = ($tunnelInfo -split '\s+')[0]
Write-Host "   Tunnel UUID: $tunnelUUID" -ForegroundColor DarkGray

# 5. Create config file
$configPath = "$env:USERPROFILE\.cloudflared\config.yml"
$credPath = "$env:USERPROFILE\.cloudflared\${tunnelUUID}.json"

$configContent = @"
tunnel: $TunnelName
credentials-file: $credPath

ingress:
  - service: http://localhost:8081
"@

Write-Host "`n📄 Step 3: Creating config file at $configPath..." -ForegroundColor Yellow
$configContent | Out-File -FilePath $configPath -Encoding UTF8
Write-Host "✅ Config created" -ForegroundColor Green

# 6. Display info
Write-Host "`n" -NoNewline
Write-Host "================================================================" -ForegroundColor Green
Write-Host " SETUP COMPLETE!" -ForegroundColor Green
Write-Host "================================================================" -ForegroundColor Green
Write-Host ""
Write-Host " Your stable tunnel URL will be:" -ForegroundColor Cyan
Write-Host "   https://${TunnelName}.cfargotunnel.com" -ForegroundColor White
Write-Host ""
Write-Host " To START the tunnel, run:" -ForegroundColor Yellow
Write-Host "   cloudflared tunnel run $TunnelName" -ForegroundColor White
Write-Host ""
Write-Host " To use with a CUSTOM DOMAIN (requires domain on Cloudflare):" -ForegroundColor Yellow
Write-Host "   cloudflared tunnel route dns $TunnelName api.yourdomain.com" -ForegroundColor White
Write-Host ""
Write-Host " Update Vercel with:" -ForegroundColor Yellow
Write-Host "   NEXT_PUBLIC_API_URL = https://${TunnelName}.cfargotunnel.com" -ForegroundColor White
Write-Host "================================================================" -ForegroundColor Green

# 7. Prompt to start
$startNow = Read-Host "`nStart tunnel now? (y/n)"
if ($startNow -eq 'y') {
    Write-Host "`n🚇 Starting tunnel..." -ForegroundColor Green
    cloudflared tunnel run $TunnelName
}
