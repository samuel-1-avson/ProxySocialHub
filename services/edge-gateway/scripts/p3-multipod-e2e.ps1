# P3 full E2E checklist helper (provider on edge-a, buyer via edge-b).
# Does NOT create control-api sessions — run those steps manually or extend with your session API.
param(
    [int]$EdgeAPort = $(if ($env:P3_EDGE_A_PORT) { [int]$env:P3_EDGE_A_PORT } else { 28090 }),
    [int]$EdgeBPort = $(if ($env:P3_EDGE_B_PORT) { [int]$env:P3_EDGE_B_PORT } else { 28091 }),
    [int]$TunnelAPort = $(if ($env:P3_TUNNEL_A_PORT) { [int]$env:P3_TUNNEL_A_PORT } else { 23128 }),
    [string]$ProviderNodeId = "p3-e2e-provider"
)

$ErrorActionPreference = "Stop"

function Test-Health($port) {
    $r = Invoke-WebRequest -Uri "http://127.0.0.1:$port/health" -UseBasicParsing -TimeoutSec 10
    if ($r.StatusCode -ne 200) { throw "health :$port => $($r.StatusCode)" }
}

Write-Host "== P3 multipod E2E helper =="
Write-Host "edge-a buyer :$EdgeAPort  tunnel :$TunnelAPort"
Write-Host "edge-b buyer :$EdgeBPort"
Write-Host ""

Test-Health $EdgeAPort
Test-Health $EdgeBPort
Write-Host "OK both pods healthy"

# After provider-node connects, directory should show edge-a owner
Write-Host ""
Write-Host "Next steps (manual):"
Write-Host "  1. Start provider-node pointed at 127.0.0.1:$TunnelAPort (yamux tunnel)."
Write-Host "     Note the node_id from provider logs (or set to $ProviderNodeId)."
Write-Host "  2. Verify Redis: .\scripts\p3-compose.ps1 helpers or: docker compose -p edge-p3 exec redis redis-cli GET eg:provider:owner:<node_id>"
Write-Host "     Expect pod_id edge-a."
Write-Host "  3. Obtain a valid buyer session (control-api) with proxy user/password."
Write-Host "  4. CONNECT via edge-b only:"
Write-Host "       curl -x http://USER:PASS@127.0.0.1:$EdgeBPort https://example.com -v"
Write-Host "  5. Success = 200 tunnel; edge-b logs show peer forward; edge-a bridges to provider."
Write-Host "  6. Metrics on edge-b: curl http://127.0.0.1:$EdgeBPort/metrics | findstr provider_route_selection"
Write-Host "     Expect route=remote on peer-forwarded CONNECTs; route=local on edge-a direct."
Write-Host ""
Write-Host "Optional: EDGE_POD_ID and EDGE_PEER_URLS must be set in compose (see docker-compose.p3-multipod.yml)."
