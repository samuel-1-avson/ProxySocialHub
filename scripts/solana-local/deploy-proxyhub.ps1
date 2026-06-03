# Deploy proxyhub.so to the local Docker test-validator (ports 8899/8900).
# Uses solana 1.18 inside proxyhubb-solana-local to avoid host CLI / validator version skew.

$ErrorActionPreference = "Stop"
$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$container = "proxyhubb-solana-local"
$programDir = Join-Path $repoRoot "services\solana-programs\proxyhub\target\deploy"
$oracleKey = Join-Path $repoRoot "infra\oracle-keypair.json"

if (-not (Test-Path (Join-Path $programDir "proxyhub.so"))) {
    throw "Missing proxyhub.so — run: cd services/solana-programs/proxyhub && anchor build"
}
if (-not (Test-Path $oracleKey)) {
    throw "Missing $oracleKey (see infra/README.md)"
}

$running = docker ps --filter "name=$container" --format "{{.Names}}" 2>$null
if (-not $running) {
    Write-Host "Starting $container..." -ForegroundColor Cyan
    Push-Location $repoRoot
    docker compose -f docker-compose.dev.yml -f docker-compose.local-solana.yml up -d solana-local | Out-Host
    Pop-Location
    Start-Sleep -Seconds 10
}

Write-Host "Copying artifacts into $container..." -ForegroundColor Cyan
docker cp (Join-Path $programDir "proxyhub.so") "${container}:/tmp/proxyhub.so"
docker cp (Join-Path $programDir "proxyhub-keypair.json") "${container}:/tmp/proxyhub-keypair.json"
docker cp $oracleKey "${container}:/tmp/oracle-keypair.json"

Write-Host "Funding oracle inside validator..." -ForegroundColor Cyan
docker exec $container solana airdrop 50 /tmp/oracle-keypair.json --url http://127.0.0.1:8899 | Out-Host

Write-Host "Deploying program..." -ForegroundColor Cyan
docker exec $container solana program deploy /tmp/proxyhub.so `
    --program-id /tmp/proxyhub-keypair.json `
    --url http://127.0.0.1:8899 `
    --keypair /tmp/oracle-keypair.json | Out-Host

$programId = docker exec $container solana-keygen pubkey /tmp/proxyhub-keypair.json
Write-Host "Program deployed: $programId on http://127.0.0.1:8899" -ForegroundColor Green
Write-Host "Set SOLANA_PROGRAM_ID=$programId and point control-api at local RPC (docker-compose.local-solana.yml)."
