# Build provider-node (Rust) binaries for CLI distribution.

# Run from repository root:

#   .\rebuild-cli.ps1              # Windows amd64 only (fast, local)

#   .\rebuild-cli.ps1 -All         # windows + linux + macos (needs rustup targets)



param(

    [switch]$All

)



$ErrorActionPreference = "Stop"

$version = if ($env:CLI_DIST_VERSION) { $env:CLI_DIST_VERSION } else { "1.0.0" }

$repoRoot = $PSScriptRoot

$distDir = Join-Path $repoRoot "cli-dist\$version"

$nodeDir = Join-Path $repoRoot "services\provider-node"
$cliDir = Join-Path $repoRoot "cli"



Write-Host "==========================================" -ForegroundColor Cyan

Write-Host "  Building ProxyHub provider-node + proxyhubb-cli" -ForegroundColor Cyan

Write-Host "  version $version" -ForegroundColor Cyan

Write-Host "==========================================" -ForegroundColor Cyan



if (-not (Test-Path $nodeDir)) {

    Write-Error "Run from repo root; missing $nodeDir"

    exit 1

}



New-Item -ItemType Directory -Path $distDir -Force | Out-Null



function Get-CargoTarget($goos, $goarch) {

    if ($goos -eq "windows" -and $goarch -eq "amd64") { return "x86_64-pc-windows-msvc" }

    if ($goos -eq "linux" -and $goarch -eq "amd64") { return "x86_64-unknown-linux-gnu" }

    if ($goos -eq "linux" -and $goarch -eq "arm64") { return "aarch64-unknown-linux-gnu" }

    if ($goos -eq "macos" -and $goarch -eq "amd64") { return "x86_64-apple-darwin" }

    if ($goos -eq "macos" -and $goarch -eq "arm64") { return "aarch64-apple-darwin" }

    throw "Unsupported target $goos/$goarch"

}



function Build-Target($goos, $goarch, $outName) {

    Write-Host "Building $outName ($goos/$goarch)..." -ForegroundColor Yellow

    $target = Get-CargoTarget $goos $goarch

    Push-Location $nodeDir

    try {

        $prevEap = $ErrorActionPreference
        $ErrorActionPreference = "SilentlyContinue"
        rustup target add $target | Out-Null
        $ErrorActionPreference = $prevEap

        cargo build --release --target $target

        if ($LASTEXITCODE -ne 0) { throw "cargo build failed for $target" }

        $builtName = if ($goos -eq "windows") { "provider-node.exe" } else { "provider-node" }

        $built = Join-Path $nodeDir "target\$target\release\$builtName"

        if (-not (Test-Path $built)) { throw "Binary not found at $built" }

        $dest = Join-Path $distDir $outName

        Copy-Item $built $dest -Force

        Write-Host "  -> $outName" -ForegroundColor Green

    } finally {

        Pop-Location

    }

}



$targets = @(

    @{ goos = "windows"; goarch = "amd64"; out = "provider-node-$version-windows-amd64.exe" }

)

if ($All) {

    $targets += @(

        @{ goos = "linux"; goarch = "amd64"; out = "provider-node-$version-linux-amd64" },

        @{ goos = "linux"; goarch = "arm64"; out = "provider-node-$version-linux-arm64" },

        @{ goos = "macos"; goarch = "amd64"; out = "provider-node-$version-macos-amd64" },

        @{ goos = "macos"; goarch = "arm64"; out = "provider-node-$version-macos-arm64" }

    )

    Write-Host "Cross-compiling all platforms (install targets via rustup if builds fail)." -ForegroundColor DarkGray

}



foreach ($t in $targets) {

    Build-Target $t.goos $t.goarch $t.out

}

function Build-CliWrapper($goos, $goarch, $outName) {
    Write-Host "Building $outName ($goos/$goarch)..." -ForegroundColor Yellow
    $target = Get-CargoTarget $goos $goarch
    Push-Location $cliDir
    try {
        $prevEap = $ErrorActionPreference
        $ErrorActionPreference = "SilentlyContinue"
        rustup target add $target | Out-Null
        $ErrorActionPreference = $prevEap
        cargo build --release --target $target
        if ($LASTEXITCODE -ne 0) { throw "cargo build failed for proxyhubb-cli $target" }
        $builtName = if ($goos -eq "windows") { "proxyhubb-cli.exe" } else { "proxyhubb-cli" }
        $built = Join-Path $cliDir "target\$target\release\$builtName"
        if (-not (Test-Path $built)) { throw "Binary not found at $built" }
        $dest = Join-Path $distDir $outName
        Copy-Item $built $dest -Force
        Write-Host "  -> $outName" -ForegroundColor Green
    } finally {
        Pop-Location
    }
}

$cliTargets = @(
    @{ goos = "windows"; goarch = "amd64"; out = "provider-cli-$version-windows-amd64.exe" }
)
if ($All) {
    $cliTargets += @(
        @{ goos = "linux"; goarch = "amd64"; out = "provider-cli-$version-linux-amd64" },
        @{ goos = "linux"; goarch = "arm64"; out = "provider-cli-$version-linux-arm64" },
        @{ goos = "macos"; goarch = "amd64"; out = "provider-cli-$version-macos-amd64" },
        @{ goos = "macos"; goarch = "arm64"; out = "provider-cli-$version-macos-arm64" }
    )
}

foreach ($t in $cliTargets) {
    Build-CliWrapper $t.goos $t.goarch $t.out
}

# Place wrapper next to provider-node binaries for portable zip bundles
Get-ChildItem $distDir -Filter "provider-node-*" | ForEach-Object {
    $dir = $_.DirectoryName
    $wrapper = Join-Path $distDir "provider-cli-$version-windows-amd64.exe"
    if ($_.Name -match "windows-amd64" -and (Test-Path $wrapper)) {
        $sidecarName = ($_.BaseName -replace "provider-node", "provider-cli") + ".exe"
        $sidecar = Join-Path $dir $sidecarName
        Copy-Item $wrapper $sidecar -Force -ErrorAction SilentlyContinue
    }
}

# Windows double-click launcher: opens a console that stays open with the interactive menu.
$launcher = Join-Path $distDir "Launch-Provider-Console.cmd"
@"
@echo off
title ProxyHubb Provider Node
cd /d "%~dp0"
echo.
echo  ProxyHubb Provider Node — launching console...
echo  (Close this window to exit.)
echo.
if exist "provider-node.exe" (
  "provider-node.exe"
  goto :end
)
for %%F in (provider-node-*-windows-amd64.exe) do (
  "%%F"
  goto :end
)
echo ERROR: provider-node binary not found in this folder.
pause
:end
"@ | Set-Content -Path $launcher -Encoding ASCII
Write-Host "  -> Launch-Provider-Console.cmd" -ForegroundColor Green

Write-Host ""

Write-Host "Done. Binaries in $distDir" -ForegroundColor Green

Write-Host "Restart control-api (or wait for SeedCLIDownloads) to refresh cli_downloads." -ForegroundColor DarkGray

