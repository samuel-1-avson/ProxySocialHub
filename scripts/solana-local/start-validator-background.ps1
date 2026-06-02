# Starts validator detached (background). Logs to scripts/solana-local/validator.log
$ErrorActionPreference = "Stop"
. "$PSScriptRoot\_solana-path.ps1"
Use-SolanaPath
Ensure-SolanaConfig

$ledgerDir = Join-Path $PSScriptRoot ".ledger-local"
$pidFile = Join-Path $PSScriptRoot ".validator.pid"
$logFile = Join-Path $PSScriptRoot "validator.log"

$validator = Get-SolanaExe "solana-test-validator"
$solana = Get-SolanaExe "solana"

if (Test-Path $pidFile) {
    $oldPid = (Get-Content $pidFile -Raw).Trim()
    if (Get-Process -Id $oldPid -ErrorAction SilentlyContinue) {
        Write-Host "Validator already running (PID $oldPid). Log: $logFile"
        exit 0
    }
}

& $solana config set --url http://127.0.0.1:8899 | Out-Null

$proc = Start-Process -FilePath $validator -ArgumentList @(
    "--ledger", $ledgerDir,
    "--reset",
    "--quiet"
) -PassThru -RedirectStandardOutput $logFile -RedirectStandardError "${logFile}.err" -WindowStyle Hidden

if (-not $proc.HasExited) {
    $proc.Id | Set-Content $pidFile
    Start-Sleep -Seconds 3
    if ($proc.HasExited -and (Test-Path "${logFile}.err")) {
        $err = Get-Content "${logFile}.err" -Raw
        if ($err -match "1314") {
            Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
            Write-Host ""
            Write-Host "Native validator failed (Windows error 1314 — needs Administrator)."
            Write-Host "Use Docker instead:"
            Write-Host "  pwsh -File scripts/solana-local/start-validator-docker.ps1"
            exit 1
        }
    }
    Write-Host "Local validator started PID $($proc.Id)"
    Write-Host "RPC http://127.0.0.1:8899 — log: $logFile"
    Write-Host "Wait ~5s then run: pwsh -File scripts/solana-local/fund-oracle.ps1"
}
else {
    if (Test-Path "${logFile}.err") { Get-Content "${logFile}.err" }
    Write-Host "Validator exited immediately. On Windows use: start-validator-docker.ps1"
    exit 1
}
