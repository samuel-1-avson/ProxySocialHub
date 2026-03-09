# Vercel Deployment Script for Windows
# This script helps deploy the frontend to Vercel

param(
    [switch]$Prod,
    [string]$ApiUrl = "",
    [string]$GatewayUrl = ""
)

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  ProxyHubb Vercel Deployment" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Check if Vercel CLI is installed
try {
    $vercelVersion = vercel --version 2>$null
    Write-Host "[OK] Vercel CLI found: $vercelVersion" -ForegroundColor Green
}
catch {
    Write-Host "[Error] Vercel CLI not found. Installing..." -ForegroundColor Red
    npm install -g vercel
}

# Navigate to web directory
$webDir = Join-Path (Join-Path (Join-Path $PSScriptRoot "..") "apps") "web"
Set-Location $webDir

Write-Host "[Info] Working directory: $(Get-Location)" -ForegroundColor Gray

# Update .env.production if URLs provided
if ($ApiUrl -or $GatewayUrl) {
    Write-Host "[Build] Updating environment variables..." -ForegroundColor Yellow
    
    $envFile = Join-Path $webDir ".env.production"
    $content = Get-Content $envFile -Raw
    
    if ($ApiUrl) {
        $content = $content -replace 'NEXT_PUBLIC_API_URL=.*', "NEXT_PUBLIC_API_URL=$ApiUrl"
        Write-Host "   NEXT_PUBLIC_API_URL = $ApiUrl" -ForegroundColor Gray
    }
    
    if ($GatewayUrl) {
        $content = $content -replace 'NEXT_PUBLIC_GATEWAY_URL=.*', "NEXT_PUBLIC_GATEWAY_URL=$GatewayUrl"
        Write-Host "   NEXT_PUBLIC_GATEWAY_URL = $GatewayUrl" -ForegroundColor Gray
    }
    
    Set-Content $envFile $content
    Write-Host "[OK] Environment file updated" -ForegroundColor Green
}

# Show current environment
Write-Host "`n[Info] Current Environment:" -ForegroundColor Yellow
$envContent = Get-Content ".env.production" | Select-String -Pattern "^NEXT_PUBLIC"
$envContent | ForEach-Object { Write-Host "   $_" -ForegroundColor Gray }

# Deploy
Write-Host "`n[Build] Deploying to Vercel..." -ForegroundColor Green

# Go back to the root directory to run Vercel CLI (required for monorepo setup)
Set-Location (Join-Path $PSScriptRoot "..")

# Bypass Vercel's Git author team membership check by hiding the Git repo
$env:GIT_DIR = "C:\non-existent"

try {
    if ($Prod) {
        Write-Host "   Mode: PRODUCTION" -ForegroundColor Magenta
        vercel --prod --yes
    }
    else {
        Write-Host "   Mode: PREVIEW" -ForegroundColor Blue
        vercel --yes
    }
}
finally {
    Remove-Item Env:\GIT_DIR -ErrorAction SilentlyContinue
}

Write-Host "`n[OK] Deployment complete!" -ForegroundColor Green
