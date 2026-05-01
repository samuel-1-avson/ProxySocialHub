[CmdletBinding()]
param(
    [string]$CsvPath = (Join-Path $PSScriptRoot 'github-issues.csv'),
    [string]$Repo,
    [switch]$DryRun,
    [switch]$SkipExistingCheck
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-RepoRoot {
    $root = Resolve-Path (Join-Path $PSScriptRoot '..\..\..')
    return $root.Path
}

function Get-Labels {
    param([string]$Value)

    if ([string]::IsNullOrWhiteSpace($Value)) {
        return @()
    }

    return $Value.Split(',') |
        ForEach-Object { $_.Trim() } |
        Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
}

function Assert-GhAvailable {
    if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
        throw "GitHub CLI 'gh' was not found on PATH. Install it from https://cli.github.com/ first."
    }
}

function Find-ExistingIssue {
    param(
        [string]$Title,
        [string]$RepoName
    )

    $args = @('issue', 'list', '--state', 'all', '--limit', '200', '--search', $Title, '--json', 'title,url,number')
    if (-not [string]::IsNullOrWhiteSpace($RepoName)) {
        $args += @('--repo', $RepoName)
    }

    $json = & gh @args
    if ([string]::IsNullOrWhiteSpace($json)) {
        return $null
    }

    $issues = $json | ConvertFrom-Json
    return $issues | Where-Object { $_.title -eq $Title } | Select-Object -First 1
}

$repoRoot = Get-RepoRoot
$resolvedCsvPath = (Resolve-Path $CsvPath).Path
$rows = Import-Csv -Path $resolvedCsvPath

if (-not $DryRun) {
    Assert-GhAvailable
}

foreach ($row in $rows) {
    $bodyPath = Join-Path $repoRoot $row.body_file
    if (-not (Test-Path $bodyPath)) {
        throw "Body file not found for $($row.ticket): $bodyPath"
    }

    $args = @('issue', 'create', '--title', $row.title, '--body-file', $bodyPath)
    if (-not [string]::IsNullOrWhiteSpace($Repo)) {
        $args += @('--repo', $Repo)
    }
    if (-not [string]::IsNullOrWhiteSpace($row.assignee)) {
        $args += @('--assignee', $row.assignee)
    }
    foreach ($label in (Get-Labels $row.labels)) {
        $args += @('--label', $label)
    }

    if ($DryRun) {
        Write-Host "[DRY RUN] $($row.ticket) -> gh $($args -join ' ')"
        continue
    }

    if (-not $SkipExistingCheck) {
        $existing = Find-ExistingIssue -Title $row.title -RepoName $Repo
        if ($null -ne $existing) {
            Write-Host "[SKIP] $($row.ticket) already exists as #$($existing.number): $($existing.url)"
            continue
        }
    }

    $created = & gh @args
    Write-Host "[CREATED] $($row.ticket) ($($row.initial_status)) -> $created"
}
