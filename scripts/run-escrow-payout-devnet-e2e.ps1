param(
    [string]$RpcUrl = "https://api.devnet.solana.com",
    [string]$Wallet = "$PSScriptRoot\..\infra\oracle-keypair.json",
    [string]$ProgramDir = "$PSScriptRoot\..\services\solana-programs\proxyhub"
)

# Live-devnet escrow payout-binding e2e (R-01 closure).
# Runs tests/escrow_payout_binding.ts against the deployed program
# AZGhGfvsiGJQ5S91nkdhGi9qvSNKv3sBZyVJ63KQLfvu on Solana devnet.
#
# Prereqs: node/npx, funded wallet (>= ~2 SOL for airdrops + fees),
#          Anchor workspace built (target/types + IDL present).

$ErrorActionPreference = "Stop"
$ProgramDir = (Resolve-Path $ProgramDir).ProviderPath
$Wallet = (Resolve-Path $Wallet).ProviderPath

Write-Host "== Preflight =="
Write-Host "RPC    : $RpcUrl"
Write-Host "Wallet : $Wallet"
Write-Host "Program: $ProgramDir"
$bal = & solana balance --url $RpcUrl --keypair $Wallet
Write-Host "Balance: $bal"
& solana program show AZGhGfvsiGJQ5S91nkdhGi9qvSNKv3sBZyVJ63KQLfvu --url $RpcUrl | Select-Object -First 8

$env:ANCHOR_PROVIDER_URL = $RpcUrl
$env:ANCHOR_WALLET = $Wallet
# Prefer cluster override used by some Anchor setups
$env:CLUSTER = "devnet"

Push-Location $ProgramDir
try {
    Write-Host "== Run escrow_payout_binding.ts on live devnet =="
    npx --yes ts-mocha -p ./tsconfig.json -t 180000 tests/escrow_payout_binding.ts
    if ($LASTEXITCODE -ne 0) { throw "escrow_payout_binding failed (exit $LASTEXITCODE)" }
} finally {
    Pop-Location
}

Write-Host "DONE — live-devnet payout binding e2e passed."
