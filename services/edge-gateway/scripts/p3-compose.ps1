# Shared docker compose helpers for P3 multipod scripts. Dot-source from other p3-*.ps1 files.
# Usage: . "$PSScriptRoot\p3-compose.ps1"

$script:P3ComposeProject = if ($env:P3_COMPOSE_PROJECT) { $env:P3_COMPOSE_PROJECT } else { "edge-p3" }
$script:P3ComposeFile = if ($env:P3_COMPOSE_FILE) {
    $env:P3_COMPOSE_FILE
} else {
    Join-Path (Split-Path -Parent $PSScriptRoot) "docker-compose.p3-multipod.yml"
}

function Invoke-P3Compose {
    param([Parameter(ValueFromRemainingArguments = $true)][string[]]$ComposeCommand)
    & docker compose -p $script:P3ComposeProject -f $script:P3ComposeFile @ComposeCommand
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

function Get-P3ServiceContainerId {
    param([Parameter(Mandatory = $true)][string]$Service)
    $id = docker compose -p $script:P3ComposeProject -f $script:P3ComposeFile ps -q $Service 2>$null
    $id = ($id | Select-Object -First 1).ToString().Trim()
    if (-not $id) {
        throw "P3 service '$Service' is not running. Start the stack: .\scripts\p3-multipod-up.ps1"
    }
    return $id
}

function Get-P3RedisContainerId {
    if ($env:P3_REDIS_CONTAINER) { return $env:P3_REDIS_CONTAINER.Trim() }
    return Get-P3ServiceContainerId "redis"
}

function Get-P3EdgeAContainerId {
    if ($env:P3_EDGE_A_CONTAINER) { return $env:P3_EDGE_A_CONTAINER.Trim() }
    return Get-P3ServiceContainerId "edge-a"
}

function Get-P3EdgeBContainerId {
    if ($env:P3_EDGE_B_CONTAINER) { return $env:P3_EDGE_B_CONTAINER.Trim() }
    return Get-P3ServiceContainerId "edge-b"
}

function Remove-LegacyP3Containers {
    foreach ($name in @("proxyhubb-p3-redis", "proxyhubb-p3-edge-a", "proxyhubb-p3-edge-b")) {
        $prev = $ErrorActionPreference
        $ErrorActionPreference = "SilentlyContinue"
        $null = docker rm -f $name 2>&1
        $ErrorActionPreference = $prev
    }
}

function Invoke-P3RedisCli {
    param([Parameter(ValueFromRemainingArguments = $true)][string[]]$RedisCommand)
    $cid = Get-P3RedisContainerId
    & docker exec $cid redis-cli @RedisCommand
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

# SET JSON values without Windows docker exec eating double quotes from the payload.
function Set-P3RedisJson {
    param(
        [Parameter(Mandatory = $true)][string]$Key,
        [Parameter(Mandatory = $true)][string]$Json,
        [int]$ExSeconds = 120
    )
    $cid = Get-P3RedisContainerId
    $Json | & docker exec -i $cid redis-cli -x SET $Key | Out-Null
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    if ($ExSeconds -gt 0) {
        Invoke-P3RedisCli EXPIRE $Key $ExSeconds | Out-Null
    }
}
