# Build Provider CLI for all platforms
# Usage: .\build-cli.ps1 [version]
# Example: .\build-cli.ps1 1.0.0
# Must be run from project root (f:\project\proxyhubb)

param(
    [string]$Version = "1.0.0",
    [string]$OutputDir = "cli-dist"
)

$CLI_DIR = "services\control-api\cmd\provider-cli"

Write-Host "🔨 Building Provider CLI v${Version}..." -ForegroundColor Green
Write-Host ""

# Check if we're in the right directory
if (-not (Test-Path "services\control-api\go.mod")) {
    Write-Host "❌ Error: Must run from project root directory (where services/ folder exists)" -ForegroundColor Red
    Write-Host "Current directory: $(Get-Location)"
    exit 1
}

# Create output directory
New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null

# Build for Windows (AMD64)
Write-Host "📦 Building for Windows (AMD64)..." -ForegroundColor Cyan
$env:GOOS = "windows"
$env:GOARCH = "amd64"
go build -C services\control-api -ldflags "-s -w -X main.version=${Version}" `
    -o "..\..\${OutputDir}\provider-cli-${Version}-windows-amd64.exe" `
    "./cmd/provider-cli"
if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ Windows AMD64 build complete" -ForegroundColor Green
} else {
    Write-Host "❌ Windows AMD64 build failed" -ForegroundColor Red
}

# Build for macOS (AMD64 - Intel)
Write-Host "📦 Building for macOS (AMD64 - Intel)..." -ForegroundColor Cyan
$env:GOOS = "darwin"
$env:GOARCH = "amd64"
go build -C services\control-api -ldflags "-s -w -X main.version=${Version}" `
    -o "..\..\${OutputDir}\provider-cli-${Version}-macos-amd64" `
    "./cmd/provider-cli"
if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ macOS AMD64 build complete" -ForegroundColor Green
} else {
    Write-Host "❌ macOS AMD64 build failed" -ForegroundColor Red
}

# Build for macOS (ARM64 - Apple Silicon)
Write-Host "📦 Building for macOS (ARM64 - Apple Silicon)..." -ForegroundColor Cyan
$env:GOOS = "darwin"
$env:GOARCH = "arm64"
go build -C services\control-api -ldflags "-s -w -X main.version=${Version}" `
    -o "..\..\${OutputDir}\provider-cli-${Version}-macos-arm64" `
    "./cmd/provider-cli"
if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ macOS ARM64 build complete" -ForegroundColor Green
} else {
    Write-Host "❌ macOS ARM64 build failed" -ForegroundColor Red
}

# Build for Linux (AMD64)
Write-Host "📦 Building for Linux (AMD64)..." -ForegroundColor Cyan
$env:GOOS = "linux"
$env:GOARCH = "amd64"
go build -C services\control-api -ldflags "-s -w -X main.version=${Version}" `
    -o "..\..\${OutputDir}\provider-cli-${Version}-linux-amd64" `
    "./cmd/provider-cli"
if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ Linux AMD64 build complete" -ForegroundColor Green
} else {
    Write-Host "❌ Linux AMD64 build failed" -ForegroundColor Red
}

# Build for Linux (ARM64)
Write-Host "📦 Building for Linux (ARM64)..." -ForegroundColor Cyan
$env:GOOS = "linux"
$env:GOARCH = "arm64"
go build -C services\control-api -ldflags "-s -w -X main.version=${Version}" `
    -o "..\..\${OutputDir}\provider-cli-${Version}-linux-arm64" `
    "./cmd/provider-cli"
if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ Linux ARM64 build complete" -ForegroundColor Green
} else {
    Write-Host "❌ Linux ARM64 build failed" -ForegroundColor Red
}

# Reset environment
$env:GOOS = ""
$env:GOARCH = ""

Write-Host ""
Write-Host "🎉 Build process complete!" -ForegroundColor Green
Write-Host ""
Write-Host "Output directory: ${OutputDir}"
Write-Host ""

# Check what was actually built
$builtFiles = Get-ChildItem "${OutputDir}\provider-cli-${Version}-*" -ErrorAction SilentlyContinue
if ($builtFiles) {
    Write-Host "Built files:"
    $builtFiles | Select-Object Name, @{N="Size(MB)";E={[math]::Round($_.Length/1MB,2)}}, LastWriteTime | Format-Table
    
    Write-Host ""
    Write-Host "Next steps:" -ForegroundColor Yellow
    Write-Host "1. Create version directory: New-Item -ItemType Directory -Force -Path ${OutputDir}\${Version}"
    Write-Host "2. Move binaries: Move-Item ${OutputDir}\provider-cli-${Version}-* ${OutputDir}\${Version}\"
    Write-Host "3. Upload to server:"
    Write-Host "   docker cp ${OutputDir}\${Version}\ proxyhubb-control-api-1:/app/cli-dist/"
} else {
    Write-Host "❌ No binaries were created. Check error messages above." -ForegroundColor Red
}
