# Prints whether the "ProxyHubb Provider" window of a process is `visible`, `hidden` (it exists
# but is not shown) or `none`. Used by run.mjs: Process.MainWindowHandle is too coarse for this.
param([int]$ProcessId)

Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class W {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc p, IntPtr l);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
}
"@

$state = @{ found = 'none' }
$callback = [W+EnumProc] {
    param($h, $l)
    $owner = [uint32]0
    [void][W]::GetWindowThreadProcessId($h, [ref]$owner)
    if ($owner -eq $ProcessId) {
        $text = New-Object System.Text.StringBuilder 256
        [void][W]::GetWindowText($h, $text, 256)
        if ($text.ToString() -eq 'ProxyHubb Provider') {
            if ([W]::IsWindowVisible($h)) { $state.found = 'visible' }
            elseif ($state.found -eq 'none') { $state.found = 'hidden' }
        }
    }
    return $true
}
[void][W]::EnumWindows($callback, [IntPtr]::Zero)
$state.found
