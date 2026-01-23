# ProxyHub - Automated Cloudflare Tunnel & Environment Updater
# This script starts a quick tunnel, extracts the URL, and updates all client apps.

$cloudflared = "$PSScriptRoot\cloudflared.exe"
$tunnelLog = "$PSScriptRoot\tunnel_auto.log"

Write-Host "🔐 ProxyHub Tunnel Automator" -ForegroundColor Cyan
Write-Host "============================" -ForegroundColor Cyan

# 1. Ensure cloudflared exists
if (-not (Test-Path $cloudflared)) {
    Write-Host "⬇️ Downloading Cloudflared..." -ForegroundColor Cyan
    $url = "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe"
    Invoke-WebRequest -Uri $url -OutFile $cloudflared -UseBasicParsing
}

# 2. Check Backend Health
Write-Host "🏥 Checking Backend (localhost:8081)..." -ForegroundColor Cyan
try {
    $resp = Invoke-WebRequest -Uri "http://localhost:8081/health" -Method Get -UseBasicParsing -TimeoutSec 2
    Write-Host "✅ Backend is UP!" -ForegroundColor Green
}
catch {
    Write-Warning "⚠️ Backend unreachable. Ensure Control API is running on port 8081."
}

# 3. Start Tunnel in Background
Write-Host "🚇 Starting Tunnel..." -ForegroundColor Yellow
# Clear old log
if (Test-Path $tunnelLog) { Remove-Item $tunnelLog }

# Start process and redirect output
$proc = Start-Process -FilePath $cloudflared -ArgumentList "tunnel --url http://localhost:8081" -RedirectStandardError $tunnelLog -NoNewWindow -PassThru

Write-Host "⏳ Waiting for Tunnel URL..." -ForegroundColor DarkGray
$tunnelUrl = ""
$startTime = Get-Date

while ($null -eq $tunnelUrl -or $tunnelUrl -eq "") {
    if ((Get-Date) -gt $startTime.AddSeconds(30)) {
        Write-Error "Timeout waiting for Tunnel URL. Please check $tunnelLog"
        Stop-Process -Id $proc.Id
        exit 1
    }
    
    if (Test-Path $tunnelLog) {
        $content = Get-Content $tunnelLog
        $line = $content | Select-String -Pattern "https://.*\.trycloudflare\.com" | Select-Object -First 1
        if ($line) {
            if ($line.ToString() -match "(https://[a-zA-Z0-9-]+\.trycloudflare\.com)") {
                $tunnelUrl = $Matches[1]
            }
        }
    }
    Start-Sleep -Seconds 1
}

Write-Host "`n🚀 TUNNEL ACTIVE!" -ForegroundColor Green
Write-Host "🔗 URL: $tunnelUrl" -ForegroundColor White

# 4. Update Environment Files
$apiSuffix = "/v1"
$fullUrl = "$tunnelUrl$apiSuffix"

$envFiles = @(
    "$PSScriptRoot\..\apps\web\.env.local",
    "$PSScriptRoot\..\apps\mobile\.env",
    "$PSScriptRoot\..\apps\provider-desktop\.env"
)

$varNames = @(
    "NEXT_PUBLIC_API_URL",
    "EXPO_PUBLIC_API_URL",
    "VITE_API_URL"
)

Write-Host "`n📝 Updating Environment Files..." -ForegroundColor Yellow

for ($i = 0; $i -lt $envFiles.Count; $i++) {
    $file = $envFiles[$i]
    $var = $varNames[$i]
    
    if (Test-Path $file) {
        $content = Get-Content $file
        $updated = $content -replace "^$var=.*", "$var=$fullUrl"
        $updated | Out-File -FilePath $file -Encoding UTF8
        Write-Host "✅ Updated $file" -ForegroundColor Green
    }
    else {
        Write-Warning "❌ File not found: $file"
    }
}

Write-Host "`n✨ All systems are now 'well connected'!" -ForegroundColor Green
Write-Host "Keep this window open to maintain the tunnel." -ForegroundColor DarkGray
Write-Host ""

# Tail the log to keep the process alive and show activity
Get-Content $tunnelLog -Wait
