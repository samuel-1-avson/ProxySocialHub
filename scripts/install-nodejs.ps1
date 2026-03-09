# install-nodejs.ps1
# Downloads and installs Node.js LTS on Windows

$ErrorActionPreference = "Stop"

Write-Host "🚀 Node.js Installer for ProxySocialHub" -ForegroundColor Cyan
Write-Host "=======================================" -ForegroundColor Cyan
Write-Host ""

# Check if Node is already installed
try {
    $currentVersion = node --version 2>$null
    if ($currentVersion) {
        Write-Host "✅ Node.js is already installed: $currentVersion" -ForegroundColor Green
        Write-Host ""
        Write-Host "You can now run:" -ForegroundColor Yellow
        Write-Host "  cd apps/web" -ForegroundColor White
        Write-Host "  npm install" -ForegroundColor White
        Write-Host "  npm run dev" -ForegroundColor White
        exit 0
    }
} catch {
    # Node not found, continue with installation
}

Write-Host "📥 Downloading Node.js LTS..." -ForegroundColor Yellow

# Node.js LTS download URL
$nodeVersion = "20.11.1"
$downloadUrl = "https://nodejs.org/dist/v$nodeVersion/node-v$nodeVersion-x64.msi"
$installerPath = "$env:TEMP\nodejs-installer.msi"

try {
    # Download installer
    Invoke-WebRequest -Uri $downloadUrl -OutFile $installerPath -UseBasicParsing
    Write-Host "✅ Download complete" -ForegroundColor Green
    
    # Install silently
    Write-Host "🔧 Installing Node.js (this may take a minute)..." -ForegroundColor Yellow
    $process = Start-Process -FilePath "msiexec.exe" -ArgumentList "/i", "$installerPath", "/quiet", "/norestart" -Wait -PassThru
    
    if ($process.ExitCode -eq 0) {
        Write-Host "✅ Node.js installed successfully!" -ForegroundColor Green
        
        # Refresh environment variables
        $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")
        
        # Verify installation
        try {
            $newVersion = node --version 2>$null
            Write-Host "✅ Node.js version: $newVersion" -ForegroundColor Green
            Write-Host "✅ npm version: $(npm --version)" -ForegroundColor Green
            
            Write-Host ""
            Write-Host "🎉 Installation complete!" -ForegroundColor Green
            Write-Host ""
            Write-Host "Next steps:" -ForegroundColor Yellow
            Write-Host "  cd apps/web" -ForegroundColor White
            Write-Host "  npm install" -ForegroundColor White
            Write-Host "  npm run dev" -ForegroundColor White
            Write-Host ""
            Write-Host "Then open: http://localhost:4001" -ForegroundColor Cyan
        } catch {
            Write-Host "⚠️  Installation completed but PATH not updated yet." -ForegroundColor Yellow
            Write-Host "   Please restart your terminal and try: node --version" -ForegroundColor White
        }
    } else {
        Write-Host "❌ Installation failed with exit code: $($process.ExitCode)" -ForegroundColor Red
    }
    
    # Cleanup
    Remove-Item $installerPath -ErrorAction SilentlyContinue
    
} catch {
    Write-Host "❌ Error: $_" -ForegroundColor Red
    Write-Host ""
    Write-Host "Alternative: Please download Node.js manually from:" -ForegroundColor Yellow
    Write-Host "https://nodejs.org/en/download/" -ForegroundColor Cyan
}
