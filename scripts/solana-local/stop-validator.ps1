$pidFile = Join-Path $PSScriptRoot ".validator.pid"
if (-not (Test-Path $pidFile)) {
    Write-Host "No PID file; validator may not be running."
    exit 0
}
$pid = (Get-Content $pidFile -Raw).Trim()
Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue
Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
Write-Host "Stopped validator PID $pid"
