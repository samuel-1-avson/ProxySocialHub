param([switch]$Volumes)

$ErrorActionPreference = "Stop"
. "$PSScriptRoot\p3-split-compose.ps1"

$downArgs = @("down", "--remove-orphans")
if ($Volumes) { $downArgs += "-v" }

Invoke-P3Compose @downArgs
Write-Host "P3b split stack stopped (project $script:P3ComposeProject)."
