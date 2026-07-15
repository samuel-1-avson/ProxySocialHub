# Fund the Playwright governance E2E wallet on devnet (airdrop, then oracle transfer).
param(
    [double]$MinBalanceSOL = 0.05,
    [double]$TransferSOL = 0.15,
    [string]$RpcUrl = "https://api.devnet.solana.com"
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path $PSScriptRoot -Parent
$walletFile = Join-Path $repoRoot ".e2e-playwright-wallet.json"
$oracleKey = Join-Path $repoRoot "infra\oracle-keypair.json"

if (-not (Test-Path $walletFile)) {
    throw "Missing $walletFile - run scripts/run-governance-devnet-e2e.ps1 first to generate it."
}

$w = Get-Content $walletFile | ConvertFrom-Json
$target = $w.pubkey
Write-Host "E2E wallet: $target" -ForegroundColor Cyan

function Get-BalanceSOL {
    param([string]$Address)
    $raw = (& solana balance $Address --url $RpcUrl 2>&1 | Out-String).Trim()
    if ($raw -match '^([\d.]+)\s+SOL') { return [double]$matches[1] }
    return 0.0
}

$bal = Get-BalanceSOL $target
Write-Host "Current balance: $bal SOL"
if ($bal -ge $MinBalanceSOL) {
    Write-Host "Already funded." -ForegroundColor Green
    exit 0
}

Write-Host "Trying devnet airdrop (1 SOL)..." -ForegroundColor Cyan
try {
    & solana airdrop 1 $target --url $RpcUrl 2>&1 | Out-Host
    Start-Sleep -Seconds 3
    $bal = Get-BalanceSOL $target
    if ($bal -ge $MinBalanceSOL) {
        Write-Host "Airdrop ok. Balance: $bal SOL" -ForegroundColor Green
        exit 0
    }
} catch {
    Write-Host "Airdrop failed: $_" -ForegroundColor Yellow
}

if (-not (Test-Path $oracleKey)) {
    throw "Airdrop failed and $oracleKey not found - fund $target manually on devnet."
}

$oraclePub = (& solana-keygen pubkey $oracleKey 2>&1 | Out-String).Trim()
$oracleBal = Get-BalanceSOL $oraclePub
Write-Host "Oracle $oraclePub balance: $oracleBal SOL" -ForegroundColor Cyan
if ($oracleBal -lt ($TransferSOL + 0.01)) {
    throw "Oracle has insufficient SOL for transfer (need ~$TransferSOL SOL)."
}

Write-Host "Transferring $TransferSOL SOL from oracle -> E2E wallet..." -ForegroundColor Cyan
& solana transfer $target $TransferSOL --keypair $oracleKey --url $RpcUrl --allow-unfunded-recipient 2>&1 | Out-Host
Start-Sleep -Seconds 4
$bal = Get-BalanceSOL $target
Write-Host "New balance: $bal SOL" -ForegroundColor Green
if ($bal -lt $MinBalanceSOL) {
    throw "Transfer completed but balance still below $MinBalanceSOL SOL"
}
