# ProxyHub - Quick Cloudflare Tunnel
# Use this to verify your local backend from the internet (Vercel)

$exe = "$PSScriptRoot\cloudflared.exe"
$url = "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe"

# 1. Download if missing
if (-not (Test-Path $exe)) {
    Write-Host "⬇️ Downloading Cloudflared..." -ForegroundColor Cyan
    try {
        Invoke-WebRequest -Uri $url -OutFile $exe -UseBasicParsing
    }
    catch {
        Write-Error "Failed to download cloudflared. Please download manually from: $url"
        exit 1
    }
}

# 2. Check Backend Health
Write-Host "🏥 Checking Backend Connectivity..." -ForegroundColor Cyan
try {
    $response = Invoke-WebRequest -Uri "http://localhost:8080/health" -Method Get -UseBasicParsing -ErrorAction Stop
    if ($response.StatusCode -eq 200) {
        Write-Host "✅ Backend is UP!" -ForegroundColor Green
    }
}
catch {
    Write-Warning "⚠️  Backend (localhost:8080) seems DOWN or Unreachable."
    Write-Warning "   Ensure you ran 'start_prod.ps1' first."
    Write-Host "   Proceeding anyway..." -ForegroundColor DarkGray
}

# 3. Start Tunnel
Write-Host "`n🚇 Starting Cloudflare Tunnel..." -ForegroundColor Green
Write-Host "================================================================" -ForegroundColor Yellow
Write-Host " COPY the URL below ending in .trycloudflare.com"
Write-Host " AND update your Vercel Environment Variable: NEXT_PUBLIC_API_URL"
Write-Host "================================================================" -ForegroundColor Yellow

# Use start-process to run it in this window or new one? Keeping it here is better for output.
& $exe tunnel --url http://localhost:8080
