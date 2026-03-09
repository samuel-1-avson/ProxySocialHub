# setup-web-app.ps1
# Setup and run the ProxySocialHub Web App
# Supports: Local Node.js, Docker, or WSL

param(
    [switch]$Docker,
    [switch]$WSL,
    [switch]$InstallNode
)

$ErrorActionPreference = "Stop"

function Write-Color($Text, $Color) {
    Write-Host $Text -ForegroundColor $Color
}

Write-Color "🚀 ProxySocialHub Web App Setup" Cyan
Write-Color "================================" Cyan
Write-Host ""

# Check current environment
$hasNode = $null -ne (Get-Command node -ErrorAction SilentlyContinue)
$hasNpm = $null -ne (Get-Command npm -ErrorAction SilentlyContinue)
$hasDocker = $null -ne (Get-Command docker -ErrorAction SilentlyContinue)
$hasWSL = $null -ne (Get-Command wsl -ErrorAction SilentlyContinue)

Write-Color "Environment Check:" Yellow
Write-Host "  Node.js: $(if($hasNode){'✅ '+ (node --version)}else{'❌ Not installed'})"
Write-Host "  npm: $(if($hasNpm){'✅ '+ (npm --version)}else{'❌ Not installed'})"
Write-Host "  Docker: $(if($hasDocker){'✅ Available'}else{'❌ Not installed'})"
Write-Host "  WSL: $(if($hasWSL){'✅ Available'}else{'❌ Not installed'})"
Write-Host ""

# Option 1: Install Node.js locally
if ($InstallNode -or (-not $hasNode -and -not $Docker -and -not $WSL)) {
    if (-not $hasNode) {
        Write-Color "📥 Option 1: Install Node.js locally" Yellow
        $install = Read-Host "Do you want to install Node.js LTS? (y/n)"
        if ($install -eq 'y') {
            & "$PSScriptRoot\install-nodejs.ps1"
            return
        }
    }
}

# Option 2: Run in Docker
if ($Docker -or (-not $hasNode -and $hasDocker)) {
    Write-Color "🐳 Option 2: Running Web App in Docker" Yellow
    Write-Host "  This will build and run the web app in a container."
    Write-Host ""
    
    # Check if backend network exists
    $networkExists = docker network ls | Select-String "proxyhubb_backend"
    if (-not $networkExists) {
        Write-Color "Creating Docker network..." Yellow
        docker network create proxyhubb_backend 2>$null | Out-Null
    }
    
    Write-Color "Building Web App container..." Yellow
    docker-compose -f docker-compose.web-dev.yml build 2>&1 | ForEach-Object {
        if ($_ -match "Successfully built|done$") {
            Write-Host "  ✅ $_" -NoNewline
        }
    }
    
    Write-Color "Starting Web App..." Yellow
    docker-compose -f docker-compose.web-dev.yml up -d 2>&1 | Out-Null
    
    Start-Sleep -Seconds 5
    
    # Check if running
    $webRunning = docker ps | Select-String "web-dev"
    if ($webRunning) {
        Write-Color "" Green
        Write-Color "✅ Web App is running!" Green
        Write-Host ""
        Write-Color "Access URLs:" Cyan
        Write-Host "  🌐 Web App:    http://localhost:4001"
        Write-Host "  🔌 API:        http://localhost:8080"
        Write-Host "  🚀 Gateway:    localhost:3128"
        Write-Host ""
        Write-Color "Commands:" Cyan
        Write-Host "  View logs:    docker-compose -f docker-compose.web-dev.yml logs -f"
        Write-Host "  Stop:         docker-compose -f docker-compose.web-dev.yml down"
    } else {
        Write-Color "❌ Failed to start Web App" Red
        docker-compose -f docker-compose.web-dev.yml logs
    }
    return
}

# Option 3: Use existing Node.js
if ($hasNode -and $hasNpm) {
    Write-Color "💻 Option 3: Running with existing Node.js" Yellow
    
    Set-Location apps/web
    
    # Check if node_modules exists
    if (-not (Test-Path "node_modules")) {
        Write-Color "Installing dependencies..." Yellow
        npm install 2>&1 | ForEach-Object {
            if ($_ -match "added|packages") {
                Write-Host "  📦 $_" -NoNewline
            }
        }
    }
    
    Write-Color "Starting development server..." Green
    Write-Host ""
    Write-Color "The web app will be available at: http://localhost:4001" Cyan
    Write-Host ""
    Write-Host "Press Ctrl+C to stop the server"
    Write-Host ""
    
    npm run dev
    return
}

# Option 4: WSL
if ($WSL -and $hasWSL) {
    Write-Color "🐧 Option 4: Running in WSL" Yellow
    Write-Host "  Starting Web App in WSL..."
    
    $wslCommand = @"
cd /mnt/c/Users/$env:USERNAME/OneDrive/Desktop/project/proxyhubb/apps/web
if ! command -v node &> /dev/null; then
    echo "Installing Node.js in WSL..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt-get install -y nodejs
fi
npm install
npm run dev
"@
    
    wsl bash -c $wslCommand
    return
}

# If nothing works
Write-Color "❌ No suitable runtime found" Red
Write-Host ""
Write-Host "Please choose one of the following:"
Write-Host ""
Write-Host "1. Install Node.js:"
Write-Host "   https://nodejs.org/en/download/"
Write-Host ""
Write-Host "2. Install Docker Desktop:"
Write-Host "   https://www.docker.com/products/docker-desktop"
Write-Host ""
Write-Host "3. Enable WSL (Windows Subsystem for Linux):"
Write-Host "   wsl --install"
Write-Host ""
Write-Host "Then run this script again with the appropriate flag:"
Write-Host "   .\scripts\setup-web-app.ps1 -Docker"
Write-Host "   .\scripts\setup-web-app.ps1 -InstallNode"
