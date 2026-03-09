# Backend Exposure Script for Windows
# This script helps expose your local backend to the internet

param(
    [int]$Port = 8080,
    [switch]$UseNgrok,
    [switch]$UseLocalTunnel,
    [switch]$UseCloudflared
)

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  ProxyHubb Backend Exposure" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

function Install-Ngrok {
    Write-Host "📥 Downloading ngrok..." -ForegroundColor Yellow
    
    # Download ngrok for Windows
    $url = "https://bin.equinox.io/c/bNyj1mQVY4c/ngrok-v3-stable-windows-amd64.zip"
    $output = "$env:TEMP\ngrok.zip"
    $extractPath = "$env:USERPROFILE\ngrok"
    
    try {
        Invoke-WebRequest -Uri $url -OutFile $output -UseBasicParsing
        Write-Host "✅ Downloaded ngrok" -ForegroundColor Green
        
        # Extract
        Expand-Archive -Path $output -DestinationPath $extractPath -Force
        Write-Host "✅ Extracted ngrok to $extractPath" -ForegroundColor Green
        
        # Add to PATH
        $env:Path += ";$extractPath"
        [Environment]::SetEnvironmentVariable("Path", $env:Path, "User")
        Write-Host "✅ Added ngrok to PATH" -ForegroundColor Green
        
        # Clean up
        Remove-Item $output
        
        return "$extractPath\ngrok.exe"
    } catch {
        Write-Host "❌ Failed to download ngrok: $_" -ForegroundColor Red
        return $null
    }
}

function Start-Ngrok {
    param([int]$Port)
    
    $ngrokPath = "ngrok"
    
    # Check if ngrok is available
    try {
        $null = Get-Command ngrok -ErrorAction Stop
    } catch {
        Write-Host "⚠️  ngrok not found in PATH" -ForegroundColor Yellow
        $ngrokPath = Install-Ngrok
        
        if (-not $ngrokPath) {
            Write-Host "❌ Could not install ngrok automatically" -ForegroundColor Red
            Write-Host "   Please download manually from: https://ngrok.com/download" -ForegroundColor Gray
            return
        }
    }
    
    Write-Host "`n🚀 Starting ngrok tunnel on port $Port..." -ForegroundColor Green
    Write-Host "   This will expose your backend to the internet" -ForegroundColor Gray
    Write-Host "   URL will be displayed below...`n" -ForegroundColor Gray
    
    # Start ngrok
    & $ngrokPath http $Port --host-header="localhost:$Port"
}

function Start-LocalTunnel {
    param([int]$Port)
    
    Write-Host "📥 Checking for localtunnel..." -ForegroundColor Yellow
    
    # Check if Node.js is installed
    try {
        $nodeVersion = node --version 2>$null
        Write-Host "✅ Node.js found: $nodeVersion" -ForegroundColor Green
    } catch {
        Write-Host "❌ Node.js not found. Please install Node.js first:" -ForegroundColor Red
        Write-Host "   https://nodejs.org/" -ForegroundColor Gray
        return
    }
    
    # Install localtunnel globally
    Write-Host "📥 Installing localtunnel..." -ForegroundColor Yellow
    npm install -g localtunnel
    
    Write-Host "`n🚀 Starting localtunnel on port $Port..." -ForegroundColor Green
    Write-Host "   This will expose your backend to the internet" -ForegroundColor Gray
    Write-Host "   URL will be displayed below...`n" -ForegroundColor Gray
    
    # Start localtunnel
    lt --port $Port
}

function Start-Cloudflared {
    param([int]$Port)
    
    Write-Host "📥 Downloading cloudflared..." -ForegroundColor Yellow
    
    # Download cloudflared for Windows
    $url = "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe"
    $output = "$env:USERPROFILE\cloudflared.exe"
    
    try {
        Invoke-WebRequest -Uri $url -OutFile $output -UseBasicParsing
        Write-Host "✅ Downloaded cloudflared to $output" -ForegroundColor Green
        
        # Add to PATH
        $env:Path += ";$env:USERPROFILE"
        [Environment]::SetEnvironmentVariable("Path", $env:Path, "User")
    } catch {
        Write-Host "❌ Failed to download cloudflared: $_" -ForegroundColor Red
        return
    }
    
    Write-Host "`n🚀 Starting Cloudflare tunnel on port $Port..." -ForegroundColor Green
    Write-Host "   This will expose your backend to the internet" -ForegroundColor Gray
    Write-Host "   URL will be displayed below...`n" -ForegroundColor Gray
    
    # Start cloudflared
    & $output tunnel --url "http://localhost:$Port"
}

# Main menu if no option selected
if (-not ($UseNgrok -or $UseLocalTunnel -or $UseCloudflared)) {
    Write-Host "Select a tunneling service:" -ForegroundColor Yellow
    Write-Host "  1. Ngrok (Recommended - free tier available)" -ForegroundColor White
    Write-Host "  2. LocalTunnel (Free, no signup required)" -ForegroundColor White
    Write-Host "  3. Cloudflare Tunnel (Free, requires Cloudflare account)" -ForegroundColor White
    Write-Host ""
    
    $choice = Read-Host "Enter your choice (1-3)"
    
    switch ($choice) {
        "1" { $UseNgrok = $true }
        "2" { $UseLocalTunnel = $true }
        "3" { $UseCloudflared = $true }
        default { 
            Write-Host "❌ Invalid choice" -ForegroundColor Red
            exit 1
        }
    }
}

# Start selected tunnel
if ($UseNgrok) {
    Start-Ngrok -Port $Port
} elseif ($UseLocalTunnel) {
    Start-LocalTunnel -Port $Port
} elseif ($UseCloudflared) {
    Start-Cloudflared -Port $Port
}
