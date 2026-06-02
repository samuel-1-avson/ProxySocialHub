# Shared .env loader and Go test env helpers for scripts/*.ps1

function Import-RepoDotEnv {
    param([string]$RepoRoot)
    $path = Join-Path $RepoRoot ".env"
    if (-not (Test-Path $path)) { return }
    Get-Content $path | ForEach-Object {
        $line = $_.Trim()
        if ($line -eq '' -or $line.StartsWith('#')) { return }
        if ($line -match '^\s*([^#=]+)=(.*)$') {
            $k = $matches[1].Trim()
            $v = $matches[2].Trim()
            if ($v -match '^([^#]+)') { $v = $matches[1].Trim() }
            $v = $v.Trim('"').Trim("'")
            if ($k) { Set-Item -Path "env:$k" -Value $v }
        }
    }
}

function Use-GoTestEnv {
    $script:SavedGinMode = $env:GIN_MODE
    $env:GIN_MODE = 'test'
}

function Restore-GoTestEnv {
    if ($null -ne $script:SavedGinMode -and $script:SavedGinMode -ne '') {
        $env:GIN_MODE = $script:SavedGinMode
    }
    else {
        Remove-Item env:GIN_MODE -ErrorAction SilentlyContinue
    }
}
