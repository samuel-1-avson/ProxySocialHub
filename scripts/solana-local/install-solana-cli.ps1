# Installs Solana CLI (Agave) on Windows into %USERPROFILE%\.local\share\solana\install\
# Run once:  pwsh -File scripts/solana-local/install-solana-cli.ps1

$ErrorActionPreference = "Stop"
$installerUrl = "https://release.anza.xyz/stable/solana-install-init-x86_64-pc-windows-msvc.exe"
$installerPath = Join-Path $env:TEMP "solana-install-init.exe"

Write-Host "Downloading Solana installer..."
Invoke-WebRequest -Uri $installerUrl -OutFile $installerPath -UseBasicParsing

Write-Host "Installing stable release (this may take a few minutes)..."
& $installerPath stable

$bin = Join-Path $env:USERPROFILE ".local\share\solana\install\active_release\bin"
if (-not (Test-Path (Join-Path $bin "solana.exe"))) {
    throw "Install finished but solana.exe not found under $bin"
}

Write-Host ""
Write-Host "Installed. Add to your PATH for this session:"
Write-Host "  `$env:Path = `"$bin;`" + `$env:Path"
Write-Host ""
Write-Host "Or open a NEW terminal after the installer updates your user PATH."
& (Join-Path $bin "solana.exe") --version
