<#
.SYNOPSIS
  A guided, isolated check of the ProxyHubb Provider tray app. You do the tray clicks; this
  script sets everything up, watches the processes to confirm each click did what it should,
  and proves afterwards that your real node, settings and startup entry were not touched.

.DESCRIPTION
  The tray menu cannot be driven from the DevTools-based e2e (e2e/run.mjs), so these were
  the things left unverified: Pause / Resume, closing the window to the tray, Open, Quit
  stopping the node, and the next launch resuming (or staying paused). This covers them.

  Isolation (the same recipe as e2e/run.mjs):
    * the app and node get PROXYHUB_CONFIG, PROXYHUB_STATE_DIR and PROXYHUB_APP_DIR pointing
      into a scratch folder, plus their own WebView2 profile. APPDATA/USERPROFILE are NOT
      redirected (that breaks WebView2);
    * the seeded provider.toml points only at 127.0.0.1:9, where nothing listens, so the node
      stays in "connecting" and can never reach a real API or gateway;
    * it refuses to start if an app or node is already running (single-instance would hand
      the launch to the real one), or if port 9090 is taken;
    * it records a fingerprint of your real provider.toml, ~/.proxyhubb, the app's settings
      folder and the startup entries before and after, and fails if anything differs. It reads
      file metadata only, never the contents of provider.toml.

  The Start-at-sign-in checkbox writes the REAL startup key, so it is off by default. With
  -TestAutostartToggle you opt in: the script snapshots the key, watches the entry appear and
  disappear as you tick and untick, and restores the snapshot in a finally block.

.PARAMETER AppExe
  The app to test. Default: the release build, then the debug build, under ..\src-tauri\target.
  Build with:  npm run build:app   (or  npm run build:app:debug).  provider-node.exe must sit
  next to it, which a Tauri build does for you.

.PARAMETER Auto
  No tray clicks. Checks only what a script can: a hidden launch starts the node, the window
  stays hidden, a second launch brings the first window up, and teardown leaves nothing
  behind. Use it to confirm the harness itself works on this machine.

.PARAMETER TestAutostartToggle
  Also check the Start-at-sign-in checkbox (see above). Not combinable with -Auto.

.PARAMETER SelfTestRegistry
  Test the startup-key snapshot/restore helpers against a scratch key under
  HKCU:\Software\ProxyHubbTrayPassSelfTest, then exit. Does not launch the app and does not
  touch the real startup key.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\e2e\tray-pass.ps1
  powershell -ExecutionPolicy Bypass -File .\e2e\tray-pass.ps1 -Auto
#>
[CmdletBinding()]
param(
    [string]$AppExe,
    [string]$Work = (Join-Path $env:TEMP 'proxyhubb-tray-pass'),
    [switch]$Auto,
    [switch]$TestAutostartToggle,
    [switch]$SelfTestRegistry,
    [switch]$KeepWork,
    [switch]$NoPause,
    [int]$StepTimeoutSec = 180
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2

$AppProcName = 'proxyhubb-provider-app'
$NodeProcName = 'provider-node'
$MetricsPort = 9090
$RunKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$ApprovedKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run'

$script:Results = New-Object System.Collections.ArrayList
$script:AppPids = @()
$script:NodePids = @()
$script:ExitCode = 0

# ---- output helpers ---------------------------------------------------------------------

function Add-Result([string]$Name, [bool]$Ok, [string]$Detail = '') {
    [void]$script:Results.Add([pscustomobject]@{ Name = $Name; Ok = $Ok; Detail = $Detail })
    $tag = 'FAIL'
    $color = 'Red'
    if ($Ok) { $tag = 'PASS'; $color = 'Green' }
    $line = "  $tag  $Name"
    if ($Detail) { $line = "$line  ($Detail)" }
    Write-Host $line -ForegroundColor $color
}

# A check that depends on an earlier step actually having happened (you cannot "resume" what
# was never paused). Without this it would pass vacuously when a click was skipped.
function Add-NotChecked([string]$Name, [string]$Why) {
    Add-Result $Name $false "not checked: $Why"
}

function Show-Step([string]$Title, [string[]]$Lines) {
    Write-Host ''
    Write-Host "STEP  $Title" -ForegroundColor Cyan
    foreach ($l in $Lines) { Write-Host "      $l" }
}

function Wait-Until([scriptblock]$Condition, [int]$TimeoutSec, [string]$Waiting) {
    $end = (Get-Date).AddSeconds($TimeoutSec)
    Write-Host "      waiting for $Waiting " -NoNewline -ForegroundColor DarkGray
    while ((Get-Date) -lt $end) {
        if (& $Condition) {
            Write-Host ' ok' -ForegroundColor DarkGray
            return $true
        }
        Write-Host '.' -NoNewline -ForegroundColor DarkGray
        Start-Sleep -Milliseconds 1000
    }
    Write-Host ' timed out' -ForegroundColor DarkGray
    return $false
}

# ---- processes --------------------------------------------------------------------------

function Get-NodePids {
    $ids = @(Get-Process -Name $NodeProcName -ErrorAction SilentlyContinue | ForEach-Object { $_.Id })
    foreach ($i in $ids) { if ($script:NodePids -notcontains $i) { $script:NodePids += $i } }
    return $ids
}
function Get-AppPids {
    $ids = @(Get-Process -Name $AppProcName -ErrorAction SilentlyContinue | ForEach-Object { $_.Id })
    foreach ($i in $ids) { if ($script:AppPids -notcontains $i) { $script:AppPids += $i } }
    return $ids
}
function Test-NodeRunning { return (@(Get-NodePids).Count -gt 0) }
function Test-AppRunning { return (@(Get-AppPids).Count -gt 0) }

function Test-PortInUse([int]$Port) {
    $client = New-Object System.Net.Sockets.TcpClient
    try {
        $iar = $client.BeginConnect('127.0.0.1', $Port, $null, $null)
        if ($iar.AsyncWaitHandle.WaitOne(500) -and $client.Connected) { return $true }
        return $false
    } catch {
        return $false
    } finally {
        $client.Close()
    }
}

# 'visible', 'hidden' (the window exists but is not shown) or 'none'. Reuses window-state.ps1,
# because Process.MainWindowHandle cannot tell a hidden window from a missing one.
function Get-WindowState([int]$ProcessId) {
    $out = & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'window-state.ps1') -ProcessId $ProcessId
    $last = $out | Select-Object -Last 1
    if ($last) { return ([string]$last).Trim() }
    return 'none'
}

function Get-SharingWanted([string]$SettingsPath) {
    if (-not (Test-Path -LiteralPath $SettingsPath)) { return $null }
    try {
        $json = Get-Content -Raw -LiteralPath $SettingsPath | ConvertFrom-Json
        return [bool]$json.sharing_wanted
    } catch {
        return $null
    }
}

# ---- the startup key --------------------------------------------------------------------

function Get-KeyValues([string]$Key) {
    $map = @{}
    if (Test-Path -LiteralPath $Key) {
        $item = Get-Item -LiteralPath $Key
        foreach ($n in $item.GetValueNames()) {
            $v = $item.GetValue($n)
            if ($v -is [byte[]]) { $v = [System.BitConverter]::ToString($v) }
            $map[$n] = [string]$v
        }
    }
    return $map
}

function Get-StartupSnapshot([string]$Run, [string]$Approved) {
    return @{ Run = (Get-KeyValues $Run); Approved = (Get-KeyValues $Approved) }
}

# Undo what the app's checkbox did, and nothing else: only values whose data mentions
# $MatchText (the app's exe name) are touched. Returns what it did, for the report.
function Restore-StartupSnapshot($Snapshot, [string]$Run, [string]$Approved, [string]$MatchText) {
    $actions = New-Object System.Collections.ArrayList
    $nowRun = Get-KeyValues $Run
    foreach ($name in @($nowRun.Keys)) {
        if (-not $Snapshot.Run.ContainsKey($name) -and $nowRun[$name] -like "*$MatchText*") {
            Remove-ItemProperty -LiteralPath $Run -Name $name -ErrorAction SilentlyContinue
            [void]$actions.Add("removed Run value '$name'")
            if ((Test-Path -LiteralPath $Approved) -and -not $Snapshot.Approved.ContainsKey($name)) {
                Remove-ItemProperty -LiteralPath $Approved -Name $name -ErrorAction SilentlyContinue
                [void]$actions.Add("removed StartupApproved value '$name'")
            }
        }
    }
    foreach ($name in @($Snapshot.Run.Keys)) {
        if (-not $nowRun.ContainsKey($name) -and $Snapshot.Run[$name] -like "*$MatchText*") {
            New-ItemProperty -LiteralPath $Run -Name $name -Value $Snapshot.Run[$name] -PropertyType String -Force | Out-Null
            [void]$actions.Add("put back Run value '$name'")
        }
    }
    return $actions
}

function Find-AppStartupEntry([string]$Run, [string]$MatchText) {
    $values = Get-KeyValues $Run
    foreach ($name in $values.Keys) {
        if ($values[$name] -like "*$MatchText*") { return $values[$name] }
    }
    return $null
}

function Invoke-RegistrySelfTest {
    $root = 'HKCU:\Software\ProxyHubbTrayPassSelfTest'
    $run = "$root\Run"
    $approved = "$root\Approved"
    Write-Host "Self-test of the startup-key helpers on the scratch key $root" -ForegroundColor Cyan
    try {
        Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue
        New-Item -Path $run -Force | Out-Null
        New-Item -Path $approved -Force | Out-Null
        New-ItemProperty -LiteralPath $run -Name 'Other App' -Value '"C:\other\other.exe" --x' -PropertyType String | Out-Null
        $snap = Get-StartupSnapshot $run $approved

        # What the checkbox does: a Run value for the app, an approval flag for it, and (to prove
        # we only touch our own) a new value from an unrelated program.
        New-ItemProperty -LiteralPath $run -Name 'ProxyHubb Provider' -Value '"C:\x\proxyhubb-provider-app.exe" --hidden' -PropertyType String | Out-Null
        New-ItemProperty -LiteralPath $approved -Name 'ProxyHubb Provider' -Value ([byte[]](2,0,0,0,0,0,0,0,0,0,0,0)) -PropertyType Binary | Out-Null
        New-ItemProperty -LiteralPath $run -Name 'Unrelated New App' -Value '"C:\unrelated\thing.exe"' -PropertyType String | Out-Null

        $found = Find-AppStartupEntry $run 'proxyhubb-provider-app.exe'
        Add-Result 'finds the app entry by its exe name' ($null -ne $found -and $found -like '*--hidden*') "$found"

        $actions = @(Restore-StartupSnapshot $snap $run $approved 'proxyhubb-provider-app.exe')
        $after = Get-KeyValues $run
        $afterApproved = Get-KeyValues $approved
        Add-Result 'removes the app Run value' (-not $after.ContainsKey('ProxyHubb Provider'))
        Add-Result 'removes the app StartupApproved value' (-not $afterApproved.ContainsKey('ProxyHubb Provider'))
        Add-Result 'keeps the value that was there before' ($after.ContainsKey('Other App'))
        Add-Result 'does not touch an unrelated new value' ($after.ContainsKey('Unrelated New App'))
        Add-Result 'reports what it did' ($actions.Count -eq 2) ($actions -join '; ')

        # Putting back an entry that existed before and was removed.
        New-ItemProperty -LiteralPath $run -Name 'ProxyHubb Provider' -Value '"C:\x\proxyhubb-provider-app.exe" --hidden' -PropertyType String | Out-Null
        $snap3 = Get-StartupSnapshot $run $approved
        Remove-ItemProperty -LiteralPath $run -Name 'ProxyHubb Provider'
        [void](Restore-StartupSnapshot $snap3 $run $approved 'proxyhubb-provider-app.exe')
        Add-Result 'puts back an app entry that existed before and was removed' ((Get-KeyValues $run).ContainsKey('ProxyHubb Provider'))
    } finally {
        Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue
    }
    Add-Result 'scratch key removed' (-not (Test-Path -LiteralPath $root))
}

# ---- what must stay untouched -----------------------------------------------------------

# Metadata only (names, sizes, timestamps) and never the contents of provider.toml, so no secret
# is read. Directories are walked so a new file inside one shows up too.
function Get-RealFingerprint {
    $lines = New-Object System.Collections.ArrayList
    $paths = @(
        (Join-Path $env:APPDATA 'proxyhubb\provider.toml'),
        (Join-Path $env:USERPROFILE '.proxyhubb'),
        (Join-Path $env:APPDATA 'com.proxyhubb.provider')
    )
    foreach ($p in $paths) {
        if (-not (Test-Path -LiteralPath $p)) { [void]$lines.Add("absent  $p"); continue }
        $item = Get-Item -LiteralPath $p -Force
        if ($item.PSIsContainer) {
            [void]$lines.Add("dir     $p  $($item.LastWriteTimeUtc.Ticks)")
            foreach ($c in (Get-ChildItem -LiteralPath $p -Recurse -Force -ErrorAction SilentlyContinue)) {
                $len = 0
                if (-not $c.PSIsContainer) { $len = $c.Length }
                [void]$lines.Add("        $($c.FullName)  $($c.LastWriteTimeUtc.Ticks)  $len")
            }
        } else {
            [void]$lines.Add("file    $p  $($item.LastWriteTimeUtc.Ticks)  $($item.Length)")
        }
    }
    foreach ($key in @($RunKey, $ApprovedKey)) {
        $values = Get-KeyValues $key
        foreach ($n in ($values.Keys | Sort-Object)) { [void]$lines.Add("reg     $key  $n = $($values[$n])") }
    }
    return @($lines | Sort-Object)
}

# ---- the app under test -----------------------------------------------------------------

function Resolve-AppExe([string]$Given) {
    if ($Given) { return (Resolve-Path -LiteralPath $Given).Path }
    $root = Split-Path -Parent $PSScriptRoot
    foreach ($profileName in @('release', 'debug')) {
        $candidate = Join-Path $root "src-tauri\target\$profileName\$AppProcName.exe"
        if (Test-Path -LiteralPath $candidate) { return $candidate }
    }
    throw "No app build found under $root\src-tauri\target. Build one with 'npm run build:app' (or pass -AppExe)."
}

function Start-App([string[]]$AppArgs) {
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $script:AppExePath
    $psi.Arguments = ($AppArgs -join ' ')
    $psi.WorkingDirectory = Split-Path -Parent $script:AppExePath
    $psi.UseShellExecute = $false
    foreach ($kv in $script:AppEnv.GetEnumerator()) { $psi.EnvironmentVariables[$kv.Key] = $kv.Value }
    $proc = [System.Diagnostics.Process]::Start($psi)
    if ($script:AppPids -notcontains $proc.Id) { $script:AppPids += $proc.Id }
    return $proc
}

# By name, not by remembered PID: Windows reuses PIDs, and preflight already refused to start if
# any app or node was running, so everything with these names now is ours.
function Stop-Ours {
    Get-Process -Name $AppProcName, $NodeProcName -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
}

# ---- main -------------------------------------------------------------------------------

if ($SelfTestRegistry) {
    Invoke-RegistrySelfTest
    $failed = @($script:Results | Where-Object { -not $_.Ok }).Count
    Write-Host ''
    if ($failed -eq 0) { Write-Host 'Self-test passed.' -ForegroundColor Green; exit 0 }
    Write-Host "$failed self-test check(s) failed." -ForegroundColor Red
    exit 1
}

if ($Auto -and $TestAutostartToggle) {
    Write-Host '-Auto and -TestAutostartToggle cannot be combined: the checkbox needs a person.' -ForegroundColor Red
    exit 2
}

$script:AppExePath = Resolve-AppExe $AppExe
$sidecar = Join-Path (Split-Path -Parent $script:AppExePath) "$NodeProcName.exe"

Write-Host 'ProxyHubb Provider: isolated tray pass' -ForegroundColor White
Write-Host "  app:    $($script:AppExePath)  (built $((Get-Item -LiteralPath $script:AppExePath).LastWriteTime))"
Write-Host "  work:   $Work"
$modeText = 'guided (you click the tray menu)'
if ($Auto) { $modeText = 'automatic (no tray clicks)' }
Write-Host "  mode:   $modeText"

# ---- preflight: refuse rather than risk anything real ----
$refusals = New-Object System.Collections.ArrayList
if (-not (Test-Path -LiteralPath $sidecar)) { [void]$refusals.Add("provider-node.exe is not next to the app ($sidecar)") }
if (Test-AppRunning) { [void]$refusals.Add("$AppProcName is already running; a new launch would be handed to it (single instance). Quit it first.") }
if (Test-NodeRunning) { [void]$refusals.Add("a provider-node process is already running; this script could not tell it from its own.") }
if (Test-PortInUse $MetricsPort) { [void]$refusals.Add("port $MetricsPort is in use (the node's metrics port).") }
if ((Split-Path -Leaf $Work) -notlike 'proxyhubb-tray-pass*') { [void]$refusals.Add("-Work must end in a folder named proxyhubb-tray-pass*, because it is deleted.") }
if ($refusals.Count -gt 0) {
    Write-Host ''
    Write-Host 'Refusing to start:' -ForegroundColor Red
    foreach ($r in $refusals) { Write-Host "  - $r" -ForegroundColor Red }
    exit 2
}

if ($TestAutostartToggle) {
    Write-Host ''
    Write-Host 'The Start-at-sign-in checkbox writes the real startup key (HKCU ...\Run).' -ForegroundColor Yellow
    Write-Host 'This script snapshots that key first and restores it at the end, even if you press Ctrl+C.' -ForegroundColor Yellow
    $answer = Read-Host 'Type YES to include that check'
    if ($answer -ne 'YES') { Write-Host 'Not confirmed; run again without -TestAutostartToggle.'; exit 2 }
}

$fingerprintBefore = Get-RealFingerprint
$startupBefore = Get-StartupSnapshot $RunKey $ApprovedKey

try {
    # ---- seed an isolated "already paired and agreed" profile ----
    if (Test-Path -LiteralPath $Work) { Remove-Item -LiteralPath $Work -Recurse -Force }
    foreach ($d in @('app', 'state', 'webview2')) { New-Item -ItemType Directory -Path (Join-Path $Work $d) -Force | Out-Null }
    $configPath = Join-Path $Work 'provider.toml'
    $settingsPath = Join-Path $Work 'app\settings.json'
    @'
control_api_url = "http://127.0.0.1:9"
gateway_addr = "127.0.0.1:9"
api_key = "tray-pass-not-a-real-key"
node_id = "00000000-0000-4000-8000-000000000001"
connection_type = "residential"
'@ | Set-Content -LiteralPath $configPath -Encoding ASCII
    $now = [int][DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
    "{`"consent`":{`"version`":1,`"accepted_at_unix`":$now},`"sharing_wanted`":true}" | Set-Content -LiteralPath $settingsPath -Encoding ASCII

    $script:AppEnv = @{
        PROXYHUB_CONFIG           = $configPath
        PROXYHUB_STATE_DIR        = (Join-Path $Work 'state')
        PROXYHUB_APP_DIR          = (Join-Path $Work 'app')
        WEBVIEW2_USER_DATA_FOLDER = (Join-Path $Work 'webview2')
        PROXYHUB_API_URL          = 'http://127.0.0.1:9'
        PROXYHUB_GATEWAY_ADDR     = '127.0.0.1:9'
    }

    if ($Auto) {
        # ------------------------------------------------------------------ automatic
        Show-Step 'Hidden launch, as a sign-in would start it' @('The app starts with --hidden and sharing wanted; no clicks.')
        $first = Start-App @('--hidden')
        Add-Result 'a hidden launch starts the node by itself' (Wait-Until { Test-NodeRunning } 40 'the node to start')
        $script:ws = 'none'
        [void](Wait-Until { $script:ws = Get-WindowState $first.Id; $script:ws -ne 'none' } 30 'the app window to exist')
        $state = $script:ws
        Add-Result '--hidden keeps the window out of sight' ($state -eq 'hidden') "window is $state"
        Add-Result 'consent and the wish to share are untouched' ((Get-SharingWanted $settingsPath) -eq $true)

        Show-Step 'A second launch' @('Starting the app again must bring the first window up and exit, leaving one instance.')
        $second = Start-App @()
        $up = Wait-Until { (Get-WindowState $first.Id) -eq 'visible' } 30 'the first window to come up'
        Add-Result 'a second launch brings the first window up' $up
        Start-Sleep -Seconds 3
        $instances = @(Get-AppPids).Count
        Add-Result 'and leaves exactly one app instance' ($instances -eq 1) "$instances running"
    } else {
        # ------------------------------------------------------------------ guided
        Write-Host ''
        Write-Host 'You will right-click the tray icon several times. On Windows 11 it may be hidden: click the ^ arrow next to the clock.' -ForegroundColor White
        Write-Host 'The menu reads: a grey status line (for example "Sharing" or "Paused") / Open ProxyHubb Provider / Pause sharing / Resume sharing / Quit (stops sharing).' -ForegroundColor White
        Write-Host 'Only the action that can run now is enabled: Pause while sharing, Resume while paused.' -ForegroundColor White
        if (-not $NoPause) { [void](Read-Host 'Press Enter to launch the app') }

        Show-Step '1  Launch' @('The app opens with sharing already on (the profile is pre-agreed). Nothing to click.')
        $first = Start-App @()
        Add-Result 'launch with sharing on starts the node' (Wait-Until { Test-NodeRunning } 40 'the node to start')
        Add-Result 'the window is shown on a normal launch' ((Get-WindowState $first.Id) -eq 'visible')

        Show-Step '2  Pause' @('Right-click the tray icon, choose  Pause sharing.')
        $paused = Wait-Until { -not (Test-NodeRunning) } $StepTimeoutSec 'the node to stop'
        Add-Result 'Pause stops the node' $paused
        Add-Result 'and records that you want it paused' ($paused -and ((Get-SharingWanted $settingsPath) -eq $false))

        Show-Step '3  Resume' @('Right-click the tray icon, choose  Resume sharing.')
        if ($paused) {
            $ok = Wait-Until { Test-NodeRunning } $StepTimeoutSec 'the node to start again'
            Add-Result 'Resume starts the node again' $ok
            Add-Result 'and records that you want it on' ($ok -and ((Get-SharingWanted $settingsPath) -eq $true))
        } else {
            Add-NotChecked 'Resume starts the node again' 'Pause never stopped the node, so there was nothing to resume'
            Start-Sleep -Seconds 2
        }

        Show-Step '4  Close the window' @('Click the X on the app window (do NOT use Quit). The window should disappear but sharing should go on.')
        $hidden = Wait-Until { (Get-WindowState $first.Id) -eq 'hidden' } $StepTimeoutSec 'the window to hide'
        Add-Result 'closing the window hides it to the tray' $hidden
        if ($hidden) {
            Start-Sleep -Seconds 5
            Add-Result 'and the node keeps running' ((Test-NodeRunning) -and (Test-AppRunning))
        } else {
            Add-NotChecked 'and the node keeps running' 'the window was never closed'
        }

        Show-Step '5  Open' @('Right-click the tray icon, choose  Open ProxyHubb Provider.')
        if ($hidden) {
            $ok = Wait-Until { (Get-WindowState $first.Id) -eq 'visible' } $StepTimeoutSec 'the window to appear'
            Add-Result 'Open brings the window back' $ok
        } else {
            Add-NotChecked 'Open brings the window back' 'the window was never hidden'
        }

        if ($TestAutostartToggle) {
            $matchText = "$AppProcName.exe"
            Show-Step '5a  Start at sign-in: on' @('In the app window, tick  "Start when I sign in to Windows".')
            $ticked = Wait-Until { $null -ne (Find-AppStartupEntry $RunKey $matchText) } $StepTimeoutSec 'the startup entry to appear'
            $entry = Find-AppStartupEntry $RunKey $matchText
            Add-Result 'ticking the box adds a startup entry' $ticked
            Add-Result 'that launches this app hidden' (($null -ne $entry) -and ($entry -like '*--hidden*')) "$entry"

            Show-Step '5b  Start at sign-in: off' @('Untick the same box.')
            if ($ticked) {
                $ok = Wait-Until { $null -eq (Find-AppStartupEntry $RunKey $matchText) } $StepTimeoutSec 'the startup entry to go away'
                Add-Result 'unticking the box removes the entry' $ok
            } else {
                Add-NotChecked 'unticking the box removes the entry' 'the box was never ticked'
            }
        }

        Show-Step '6  Quit' @('Right-click the tray icon, choose  Quit (stops sharing).')
        $quit = Wait-Until { -not (Test-AppRunning) -and -not (Test-NodeRunning) } $StepTimeoutSec 'the app and the node to exit'
        Add-Result 'Quit closes the app and stops the node' $quit
        if ($quit) {
            Add-Result 'and keeps the wish to share, so the next launch resumes' ((Get-SharingWanted $settingsPath) -eq $true)
        } else {
            Add-NotChecked 'and keeps the wish to share, so the next launch resumes' 'Quit did not close the app'
        }

        Show-Step '7  Relaunch' @('The script starts the app hidden, the way a sign-in would. No clicks.')
        if ($quit) {
            [void](Start-App @('--hidden'))
            Add-Result 'after Quit, the next launch resumes sharing' (Wait-Until { Test-NodeRunning } 40 'the node to start')
        } else {
            Add-NotChecked 'after Quit, the next launch resumes sharing' 'the app was never quit, so a relaunch would only reach the running one'
        }

        Show-Step '8  Pause, then Quit' @('Right-click the tray icon, choose  Pause sharing,  then right-click again and choose  Quit (stops sharing).')
        $gone = Wait-Until { -not (Test-AppRunning) -and -not (Test-NodeRunning) } $StepTimeoutSec 'the app and the node to exit'
        Add-Result 'Pause then Quit leaves nothing running' $gone

        Show-Step '9  Relaunch while paused' @('The script starts the app hidden again and watches for 25 seconds. The node must NOT start.')
        if ($gone) {
            [void](Start-App @('--hidden'))
            $started = Wait-Until { Test-NodeRunning } 25 'the node (it should not start)'
            Add-Result 'a pause survives a restart' (-not $started)
        } else {
            Add-NotChecked 'a pause survives a restart' 'the app was never paused and quit'
        }
    }
}
catch {
    Add-Result 'the script itself ran to the end' $false $_.Exception.Message
}
finally {
    Write-Host ''
    Write-Host 'Cleaning up' -ForegroundColor Cyan
    Stop-Ours
    Start-Sleep -Seconds 3
    Add-Result 'no app or node of ours is left running' ((-not (Test-AppRunning)) -and (-not (Test-NodeRunning)))

    $restored = @()
    if ($TestAutostartToggle) {
        $restored = @(Restore-StartupSnapshot $startupBefore $RunKey $ApprovedKey "$AppProcName.exe")
        if ($restored.Count -gt 0) { Write-Host "      startup key restored: $($restored -join '; ')" -ForegroundColor Yellow }
    }

    $fingerprintAfter = Get-RealFingerprint
    $diff = @(Compare-Object -ReferenceObject $fingerprintBefore -DifferenceObject $fingerprintAfter)
    Add-Result 'your real node, settings and startup entries are exactly as they were' ($diff.Count -eq 0)
    foreach ($d in $diff) { Write-Host "      differs: $($d.SideIndicator) $($d.InputObject)" -ForegroundColor Red }

    if ($KeepWork) {
        Write-Host "      kept the scratch folder: $Work" -ForegroundColor DarkGray
    } else {
        # WebView2 helper processes can hold the profile folder for a moment after the app exits.
        for ($attempt = 1; $attempt -le 5 -and (Test-Path -LiteralPath $Work); $attempt++) {
            Remove-Item -LiteralPath $Work -Recurse -Force -ErrorAction SilentlyContinue
            if (Test-Path -LiteralPath $Work) { Start-Sleep -Seconds 2 }
        }
        Add-Result 'scratch folder removed' (-not (Test-Path -LiteralPath $Work)) $Work
    }
}

$failed = @($script:Results | Where-Object { -not $_.Ok })
Write-Host ''
if ($failed.Count -eq 0) {
    Write-Host "All $($script:Results.Count) checks passed." -ForegroundColor Green
    exit 0
}
Write-Host "$($failed.Count) of $($script:Results.Count) checks FAILED:" -ForegroundColor Red
foreach ($f in $failed) { Write-Host "  - $($f.Name) $($f.Detail)" -ForegroundColor Red }
exit 1
