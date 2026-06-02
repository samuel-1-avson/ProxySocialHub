# P2 admission soak: hold buyer permits + parallel /health flood until 503, then recovery.
# Prereq: resilience stack with low MAX_CONCURRENT_CONNECTIONS (default 6 in docker-compose.resilience.yml).
param(
    [string]$GatewayHost = $(if ($env:GATEWAY_HOST) { $env:GATEWAY_HOST } else { "127.0.0.1" }),
    [int]$GatewayPort = $(if ($env:GATEWAY_PORT) { [int]$env:GATEWAY_PORT } else { 18090 }),
    [int]$AdmissionLimit = $(if ($env:MAX_CONCURRENT_CONNECTIONS) { [int]$env:MAX_CONCURRENT_CONNECTIONS } else { 6 }),
    [int]$Workers = 40,
    [int]$RequestsPerWorker = 30
)

$ErrorActionPreference = "Stop"
$Base = "http://${GatewayHost}:${GatewayPort}"

Write-Host "== P2 admission soak on $Base (hold=$AdmissionLimit, workers=$Workers) =="

# Hold permits with raw TCP (same technique as p2-resilience-smoke.ps1).
$holders = New-Object System.Collections.Generic.List[System.Net.Sockets.TcpClient]
try {
    for ($i = 0; $i -lt $AdmissionLimit; $i++) {
        $c = [System.Net.Sockets.TcpClient]::new()
        $c.Connect($GatewayHost, $GatewayPort)
        $holders.Add($c) | Out-Null
    }
    Start-Sleep -Milliseconds 200

    $scriptBlock = {
        param($Base, $N)
        $codes = @{}
        1..$N | ForEach-Object {
            try {
                $r = Invoke-WebRequest -Uri "$Base/health" -UseBasicParsing -TimeoutSec 5
                $c = $r.StatusCode
            } catch {
                $c = $_.Exception.Response.StatusCode.value__
                if (-not $c) { $c = 0 }
            }
            if (-not $codes.ContainsKey($c)) { $codes[$c] = 0 }
            $codes[$c]++
        }
        $codes
    }

    $jobs = 1..$Workers | ForEach-Object {
        Start-Job -ScriptBlock $scriptBlock -ArgumentList $Base, $RequestsPerWorker
    }
    $all = $jobs | Wait-Job | Receive-Job
    $jobs | Remove-Job -Force

    $total = @{}
    foreach ($h in $all) {
        foreach ($k in $h.Keys) {
            if (-not $total.ContainsKey($k)) { $total[$k] = 0 }
            $total[$k] += $h[$k]
        }
    }

    Write-Host "Status counts: $(($total.GetEnumerator() | Sort-Object Name | ForEach-Object { "$($_.Key)=$($_.Value)" }) -join ', ')"

    if (($total[503] -or 0) -lt 1) {
        throw "No HTTP 503 under saturated admission (held $AdmissionLimit TCP connections)."
    }
    Write-Host "OK saw HTTP 503 under load (admission control engaged)."
} finally {
    foreach ($c in $holders) { $c.Close() }
}

Start-Sleep -Seconds 2
$r = Invoke-WebRequest -Uri "$Base/health" -UseBasicParsing -TimeoutSec 10
if ($r.StatusCode -ne 200) { throw "Recovery health check failed: $($r.StatusCode)" }
Write-Host "OK health recovered after soak."
