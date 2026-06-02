# Starts solana-test-validator in Docker (recommended on Windows — avoids error 1314).
$ErrorActionPreference = "Stop"
$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")

Write-Host "Starting solana-local container (RPC :8899)..."
docker compose -f (Join-Path $repoRoot "docker-compose.dev.yml") `
    -f (Join-Path $repoRoot "docker-compose.local-solana.yml") `
    up -d solana-local

Write-Host "Waiting for RPC..."
$deadline = (Get-Date).AddSeconds(45)
$ready = $false
while ((Get-Date) -lt $deadline) {
    try {
        $r = Invoke-RestMethod -Uri "http://127.0.0.1:8899" -Method Post -ContentType "application/json" `
            -Body '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' -ErrorAction Stop
        if ($r.result -eq "ok") { $ready = $true; break }
    }
    catch { }
    Start-Sleep -Seconds 2
}
if (-not $ready) {
    Write-Warning "RPC not healthy yet; check: docker logs proxyhubb-solana-local"
}
else {
    Write-Host "Local validator ready at http://127.0.0.1:8899"
}
Write-Host ""
Write-Host "Next:"
Write-Host "  pwsh -File scripts/solana-local/fund-oracle.ps1"
Write-Host "  docker compose -f docker-compose.dev.yml -f docker-compose.local-solana.yml up -d control-api web"
