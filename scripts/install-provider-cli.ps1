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

# The versioned exe for $Prefix among the names just extracted from the bundle,
# preferring the bundle's own version if the archive ever holds more than one.
# Never searches the install folder: older installs leave their files there.
function Select-BundleFile([string[]]$Names, [string]$Prefix, [string]$BundleVersion) {
    $found = @($Names | Where-Object { $_ -like "$Prefix-*-windows-amd64.exe" })
    $exact = @($found | Where-Object { $_ -eq "$Prefix-$BundleVersion-windows-amd64.exe" })
    if ($exact.Count -gt 0) { return $exact[0] }
    if ($found.Count -gt 0) { return $found[0] }
    return $null
}

# Copy $Source over $Target. A running exe cannot be overwritten on Windows but
# can be renamed, so if the copy fails the old file is moved to <name>.old first
# (the node keeps running the old version until it is restarted).
function Set-StableCopy([string]$Source, [string]$Target) {
    try {
        Copy-Item $Source $Target -Force
    } catch {
        if (-not (Test-Path $Target)) { throw }
        $old = "$Target.old"
        Remove-Item -Force -ErrorAction SilentlyContinue $old
        Rename-Item $Target (Split-Path $old -Leaf)
        Copy-Item $Source $Target -Force
        Write-Warning "$(Split-Path $Target -Leaf) was in use; restart the node to run the new version."
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
    $extracted = @()
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
            $extracted += $name
        }
    } finally { $zip.Dispose() }

    # Use the files that came out of THIS bundle. Earlier installs leave their own
    # versioned files in the folder, and taking the first match there picked
    # provider-node-1.0.11 over 1.0.12 (names sort as text), so a reinstall kept
    # the old node.
    $nodeName = Select-BundleFile $extracted 'provider-node' $bundle.Version
    if (-not $nodeName) { throw 'Archive did not contain provider-node' }
    # Stable names so `provider-node ...` works and `provider-node update`
    # replaces the running file in place (it resolves current_exe()).
    Set-StableCopy (Join-Path $InstallDir $nodeName) (Join-Path $InstallDir 'provider-node.exe')
    $cliName = Select-BundleFile $extracted 'provider-cli' $bundle.Version
    if ($cliName) { Set-StableCopy (Join-Path $InstallDir $cliName) (Join-Path $InstallDir 'provider-cli.exe') }
    $reported = (& (Join-Path $InstallDir 'provider-node.exe') --version 2>&1 | Out-String).Trim()
    Write-Host "Installed: $reported -> $InstallDir"
    if ($bundle.Version -and $reported -notmatch [regex]::Escape($bundle.Version)) {
        Write-Warning "provider-node.exe reports '$reported' but the bundle is v$($bundle.Version)."
    }
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
