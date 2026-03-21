# PowerShell Script: Rebuild Provider CLI with Auto-IP Detection
# Run this from project root after modifying CLI code

$ErrorActionPreference = "Stop"

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "  Rebuilding ProxyHub Provider CLI" -ForegroundColor Cyan
Write-Host "  (With Auto IP Detection)" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""

# Check if we're in the right directory
if (-not (Test-Path "services\control-api\cmd\provider-cli")) {
    Write-Error "Error: Please run this script from the project root directory."
    exit 1
}

$cliDir = "services\control-api\cmd\provider-cli"
$distDir = "cli-dist\1.0.0"
$version = "1.0.0"

# Create dist directory if it doesn't exist
if (-not (Test-Path $distDir)) {
    New-Item -ItemType Directory -Path $distDir -Force | Out-Null
}

Write-Host "Step 1: Building Windows AMD64 binary..." -ForegroundColor Yellow
cd $cliDir
$env:GOOS = "windows"
$env:GOARCH = "amd64"
go build -o "..\..\..\..\$distDir\provider-cli-$version-windows-amd64.exe" .
if ($LASTEXITCODE -ne 0) {
    Write-Error "Failed to build Windows binary"
    exit 1
}
Write-Host "✓ Windows binary built" -ForegroundColor Green

Write-Host ""
Write-Host "Step 2: Building Linux AMD64 binary..." -ForegroundColor Yellow
$env:GOOS = "linux"
$env:GOARCH = "amd64"
go build -o "..\..\..\..\$distDir\provider-cli-$version-linux-amd64" .
if ($LASTEXITCODE -ne 0) {
    Write-Error "Failed to build Linux binary"
    exit 1
}
Write-Host "✓ Linux binary built" -ForegroundColor Green

cd "..\..\..\.."

Write-Host ""
Write-Host "Step 3: Updating local proxy-hub.exe..." -ForegroundColor Yellow
# Copy to a convenient location
$localBin = "$env:USERPROFILE\.proxyhubb\proxy-hub.exe"
if (-not (Test-Path "$env:USERPROFILE\.proxyhubb")) {
    New-Item -ItemType Directory -Path "$env:USERPROFILE\.proxyhubb" -Force | Out-Null
}
Copy-Item "$distDir\provider-cli-$version-windows-amd64.exe" $localBin -Force
Write-Host "✓ Copied to $localBin" -ForegroundColor Green

Write-Host ""
Write-Host "Step 4: Testing new binary..." -ForegroundColor Yellow
& $localBin version 2>&1 | Out-Null
if ($LASTEXITCODE -eq 0) {
    Write-Host "✓ Binary runs successfully" -ForegroundColor Green
} else {
    Write-Warning "Binary test failed, but build completed"
}

Write-Host ""
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "  CLI Rebuild Complete!" -ForegroundColor Green
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "New binaries available in: $distDir" -ForegroundColor White
Write-Host ""
Write-Host "To test the auto-IP feature:" -ForegroundColor Yellow
Write-Host "  proxy-hub node register" -ForegroundColor White
Write-Host ""
Write-Host "The CLI will now:" -ForegroundColor Yellow
Write-Host "  1. Auto-detect your public IP from multiple services" -ForegroundColor White
Write-Host "  2. Show it as [default] - just press Enter to accept" -ForegroundColor White
Write-Host "  3. Fall back to manual entry if detection fails" -ForegroundColor White
Write-Host ""
