<#Requires -Version 5.1>
<#
.SYNOPSIS
  Install the ProxyHubb provider CLI (Windows) without manual downloads.

.DESCRIPTION
  Resolves the latest Windows bundle from the ProxyHubb Control API,
  downloads it over HTTPS, verifies its SHA256 checksum against the API's
  signed metadata, and extracts provider-node + provider-cli into a
  user-local directory (no admin rights). Optionally adds that directory
  to the user's PATH.

  No secrets are handled: run `provider-node pair` afterwards to approve
  this machine on the dashboard instead of copying config files by hand.

.EXAMPLE
  # One-line install (paste into PowerShell):
  powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://api.proxyhubb.com/v1/cli/install.ps1 | iex"

.EXAMPLE
  .\install-provider-cli.ps1 -Version 1.0.9 -InstallDir "$env:LOCALAPPDATA\ProxyHubb\bin"
#>
[CmdletBinding()]
param(
    # Pinned Control API base. Override only for local stacks.
    [string]$ApiBase = 'https://api.proxyhubb.com',
    # Bundle version (e.g. 1.0.9). Empty = latest advertised by the API.
    [string]$Version = '',
    # User-local install directory (no admin required).
    [string]$InstallDir = (Join-Path $env:LOCALAPPDATA 'ProxyHubb\bin'),
    # Skip adding InstallDir to the user PATH.
    [switch]$NoPathUpdate,
    # Seconds per network request.
    [int]$TimeoutSec = 60
)

$ErrorActionPreference = 'Stop'
# TLS 1.2+ on Windows PowerShell 5.1 (1.3 where the OS offers it).
try {
    $tls = [Net.SecurityProtocolType]::Tls12
    foreach ($v in 'Tls13', 'Tls12') {
        try { $tls = $tls -bor [Net.SecurityProtocolType]::$v } catch { }
    }
    [Net.ServicePointManager]::SecurityProtocol = $tls
} catch { }

# Identifies installer traffic in server logs (distinct from interactive use).
$script:UserAgent = 'ProxyHubb-CLI-Installer'

function Get-LatestBundle {
    $uri = "$ApiBase/v1/cli/downloads/latest?platform=windows&arch=amd64&package_type=bundle"
    if ($Version.Trim()) { $uri += "&version=$([uri]::EscapeDataString($Version.Trim()))" }
    Write-Host "Resolving bundle: $uri"
    $resp = Invoke-RestMethod -Uri $uri -Method Get -TimeoutSec $TimeoutSec -UserAgent $script:UserAgent
    if (-not $resp.download_url) { throw 'API did not return a download_url' }
    $sum = "$($resp.checksum)".Trim() -replace '^sha256:', ''
    if ($sum -notmatch '^[0-9a-fA-F]{64}$') { throw 'API did not return a valid sha256 checksum' }
    return [pscustomobject]@{
        Url      = "$($resp.download_url)"
        Checksum = $sum.ToLower()
        Version  = "$($resp.version)"
        Filename = "$($resp.filename)"
    }
}

# Fail closed: only our own API host (or an explicit local override) is fetched.
$apiHost = ([uri]$ApiBase).Host.ToLowerInvariant()
if ($apiHost -ne 'api.proxyhubb.com' -and $apiHost -notmatch '^(localhost|127\.0\.0\.1)$') {
    throw "Refusing to install from unrecognized API host: $apiHost"
}

$bundle = Get-LatestBundle
Write-Host "Installing provider bundle v$($bundle.Version)"

$zipUrl = $bundle.Url
if ($zipUrl -notmatch '^https://') { throw 'Refusing non-HTTPS download URL' }
$zipHost = ([uri]$zipUrl).Host.ToLowerInvariant()
if ($zipHost -ne $apiHost) { throw "Download host $zipHost does not match API host $apiHost" }

$tmpZip = Join-Path ([IO.Path]::GetTempPath()) ("proxyhubb-bundle-$($bundle.Version).zip")
try {
    Write-Host 'Downloading bundle...'
    Invoke-WebRequest -Uri $zipUrl -OutFile $tmpZip -TimeoutSec ($TimeoutSec * 4) -UseBasicParsing -UserAgent $script:UserAgent

    Write-Host 'Verifying SHA256...'
    $actual = (Get-FileHash -Path $tmpZip -Algorithm SHA256).Hash.ToLower()
    if ($actual -ne $bundle.Checksum) {
        throw "Checksum mismatch! got $actual want $($bundle.Checksum). Aborting (file deleted)."
    }
    Write-Host 'Checksum OK.'

    New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
    # Extract only the expected console files (never execute from the archive).
    $want = @('provider-node-*-windows-amd64.exe', 'provider-cli-*-windows-amd64.exe', 'Launch-Provider-Console.cmd')
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zip = [IO.Compression.ZipFile]::OpenRead($tmpZip)
    try {
        foreach ($entry in $zip.Entries) {
            $name = $entry.Name
            if (-not $name) { continue }
            $match = $false
            foreach ($pat in $want) { if ($name -like $pat) { $match = $true; break } }
            if (-not $match) { continue }
            if ($name -match '[\\/]|\.\.') { throw "Unsafe archive entry: $name" }
            [IO.Compression.ZipFileExtensions]::ExtractToFile($entry, (Join-Path $InstallDir $name), $true)
        }
    } finally { $zip.Dispose() }

    $nodeExe = Get-ChildItem $InstallDir -Filter 'provider-node-*-windows-amd64.exe' | Select-Object -First 1
    if (-not $nodeExe) { throw 'Archive did not contain provider-node' }
    # Stable names so `provider-node ...` works and `provider-node update`
    # replaces the running file in place (it resolves current_exe()).
    Copy-Item $nodeExe.FullName (Join-Path $InstallDir 'provider-node.exe') -Force
    $cliExe = Get-ChildItem $InstallDir -Filter 'provider-cli-*-windows-amd64.exe' | Select-Object -First 1
    if ($cliExe) { Copy-Item $cliExe.FullName (Join-Path $InstallDir 'provider-cli.exe') -Force }
    $reported = (& (Join-Path $InstallDir 'provider-node.exe') --version 2>&1 | Out-String).Trim()
    Write-Host "Installed: $reported -> $InstallDir"
}
finally {
    Remove-Item -Force -ErrorAction SilentlyContinue $tmpZip
}

if (-not $NoPathUpdate) {
    $userPath = [Environment]::GetEnvironmentVariable('Path', 'User') + ''
    if ($userPath -split ';' -notcontains $InstallDir) {
        [Environment]::SetEnvironmentVariable('Path', ($userPath.TrimEnd(';') + ';' + $InstallDir), 'User')
        Write-Host 'Added to your user PATH (new terminals pick it up).'
    }
    if (($env:Path -split ';') -notcontains $InstallDir) { $env:Path += ";$InstallDir" }
}

Write-Host ''
Write-Host 'Next steps (no config files to download by hand):' -ForegroundColor Green
Write-Host '  1. provider-node pair      # approve the code on the dashboard'
Write-Host '  2. provider-node doctor    # pre-flight checks'
Write-Host '  3. provider-node start     # run (foreground; keep the window open)'
Write-Host ''
Write-Host "Install dir: $InstallDir"
