# Starts solana-test-validator on localhost:8899 (RPC) and :8900 (WS).
# Run in a dedicated terminal and leave it open:
#   pwsh -File scripts/solana-local/start-validator.ps1

$ErrorActionPreference = "Stop"
. "$PSScriptRoot\_solana-path.ps1"
Use-SolanaPath
Ensure-SolanaConfig

$ledgerDir = Join-Path $PSScriptRoot ".ledger-local"
$pidFile = Join-Path $PSScriptRoot ".validator.pid"

$validator = Get-SolanaExe "solana-test-validator"
$solana = Get-SolanaExe "solana"

if (Test-Path $pidFile) {
    $oldPid = Get-Content $pidFile -Raw
    $proc = Get-Process -Id $oldPid.Trim() -ErrorAction SilentlyContinue
    if ($proc) {
        Write-Host "Validator already running (PID $($proc.Id)). Stop with stop-validator.ps1 first."
        exit 0
    }
}

Write-Host "Starting local validator (ledger: $ledgerDir)..."
Write-Host "RPC: http://127.0.0.1:8899  WS: ws://127.0.0.1:8900"
Write-Host "Press Ctrl+C in this window to stop."
Write-Host ""

& $solana config set --url http://127.0.0.1:8899 | Out-Null

# --reset clears ledger on each start for a clean chain (unlimited airdrops).
& $validator --ledger $ledgerDir --reset --quiet
