# Resolves Solana CLI binaries (install via install-solana-cli.ps1).
$script:SolanaBin = Join-Path $env:USERPROFILE ".local\share\solana\install\active_release\bin"

function Get-SolanaExe {
    param([Parameter(Mandatory)][string]$Name)
    $path = Join-Path $SolanaBin "$Name.exe"
    if (-not (Test-Path $path)) {
        throw "$Name.exe not found at $path. Run: pwsh -File scripts/solana-local/install-solana-cli.ps1"
    }
    return $path
}

function Use-SolanaPath {
    if (Test-Path $SolanaBin) {
        $env:Path = "$SolanaBin;" + $env:Path
    }
}

function Ensure-SolanaConfig {
    $configDir = Join-Path $env:USERPROFILE ".config\solana\cli"
    $configFile = Join-Path $configDir "config.yml"
    if (-not (Test-Path $configFile)) {
        New-Item -ItemType Directory -Force -Path $configDir | Out-Null
        @"
json_rpc_url: "http://127.0.0.1:8899"
websocket_url: "ws://127.0.0.1:8900"
keypair_path: "$($configDir -replace '\\','/')/id.json"
commitment: "confirmed"
"@ | Set-Content -Path $configFile -Encoding utf8
        Write-Host "Created default CLI config -> localhost validator ($configFile)"
    }
}
