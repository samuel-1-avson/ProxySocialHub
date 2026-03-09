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
    Write-Host "✅ Vercel CLI found: $vercelVersion" -ForegroundColor Green
} catch {
    Write-Host "❌ Vercel CLI not found. Installing..." -ForegroundColor Red
    npm install -g vercel
}

# Navigate to web directory
$webDir = Join-Path $PSScriptRoot ".." "apps" "web"
Set-Location $webDir

Write-Host "📁 Working directory: $(Get-Location)" -ForegroundColor Gray

# Update .env.production if URLs provided
if ($ApiUrl -or $GatewayUrl) {
    Write-Host "📝 Updating environment variables..." -ForegroundColor Yellow
    
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
    Write-Host "✅ Environment file updated" -ForegroundColor Green
}

# Show current environment
Write-Host "`n📋 Current Environment:" -ForegroundColor Yellow
$envContent = Get-Content ".env.production" | Select-String -Pattern "^NEXT_PUBLIC"
$envContent | ForEach-Object { Write-Host "   $_" -ForegroundColor Gray }

# Deploy
Write-Host "`n🚀 Deploying to Vercel..." -ForegroundColor Green

if ($Prod) {
    Write-Host "   Mode: PRODUCTION" -ForegroundColor Magenta
    vercel --prod
} else {
    Write-Host "   Mode: PREVIEW" -ForegroundColor Blue
    vercel
}

Write-Host "`n✅ Deployment complete!" -ForegroundColor Green
