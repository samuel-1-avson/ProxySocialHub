# P3b split stack helpers. Dot-source from p3-split-*.ps1 scripts.
$env:P3_COMPOSE_PROJECT = if ($env:P3_COMPOSE_PROJECT) { $env:P3_COMPOSE_PROJECT } else { "edge-p3-split" }
$SplitRoot = Split-Path -Parent $PSScriptRoot
$env:P3_COMPOSE_FILE = if ($env:P3_COMPOSE_FILE) {
    $env:P3_COMPOSE_FILE
} else {
    Join-Path $SplitRoot "docker-compose.p3-split.yml"
}
. "$PSScriptRoot\p3-compose.ps1"
