# Smoke test for CosmicShore.scr on a real Windows desktop (CI runs it on windows-latest).
#   pwsh host/windows/smoke.ps1 -Scr dist-windows/CosmicShore.scr
# Checks: the settings dialog opens; a corrupt settings file falls back to defaults; /s draws the scene
# on every screen and exits on a mouse move, a key and a click; /p draws inside a parent window and exits
# when that window closes; no WebView2 process is left behind. Screenshots go to smoke-windows/.
param(
  [Parameter(Mandatory)][string]$Scr,
  [string]$Out = "smoke-windows",
  [int]$ReadyTimeoutSec = 90
)
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing, System.Windows.Forms
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class Inject {
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, int dx, int dy, uint data, UIntPtr extra);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  public static void Key() { keybd_event(0x41, 0, 0, UIntPtr.Zero); keybd_event(0x41, 0, 2, UIntPtr.Zero); }
  public static void Click() { mouse_event(0x0002, 0, 0, 0, UIntPtr.Zero); mouse_event(0x0004, 0, 0, 0, UIntPtr.Zero); }
}
"@

$Scr = (Resolve-Path $Scr).Path
New-Item -ItemType Directory -Force $Out | Out-Null
$Out = (Resolve-Path $Out).Path
$failures = [System.Collections.Generic.List[string]]::new()
function Fail([string]$m) { Write-Host "FAIL: $m"; $failures.Add($m) }
function Shot([string]$name) {
  $vs = [System.Windows.Forms.SystemInformation]::VirtualScreen
  $bmp = New-Object System.Drawing.Bitmap $vs.Width, $vs.Height
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.CopyFromScreen($vs.Left, $vs.Top, 0, 0, $bmp.Size)
  $bmp.Save((Join-Path $Out "$name.png"), [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose()
}
function Start-Scr([string[]]$argv, [string]$log) {
  Remove-Item $log -ErrorAction SilentlyContinue
  $env:COSMICSHORE_SCR_LOG = $log
  $psi = New-Object System.Diagnostics.ProcessStartInfo $Scr
  foreach ($a in $argv) { $psi.ArgumentList.Add($a) }
  $psi.UseShellExecute = $false
  return [System.Diagnostics.Process]::Start($psi)
}
function LogText([string]$log) { if (Test-Path $log) { Get-Content $log -Raw } else { "" } }
function Wait-Log([string]$log, [string]$pattern, [int]$count, [int]$sec) {
  $deadline = (Get-Date).AddSeconds($sec)
  while ((Get-Date) -lt $deadline) {
    if (([regex]::Matches((LogText $log), $pattern)).Count -ge $count) { return $true }
    Start-Sleep -Milliseconds 250
  }
  return $false
}
function WebViewProcs { @(Get-CimInstance Win32_Process -Filter "Name='msedgewebview2.exe'" | Where-Object { $_.CommandLine -like "*CosmicShoreScreensaver*" }) }

$screens = [System.Windows.Forms.Screen]::AllScreens.Count
Write-Host "screens: $screens"

# ── settings: a corrupt file falls back to the defaults, /c opens the dialog ─────────────────
$settingsDir = Join-Path $env:APPDATA "Froglet\CosmicShoreScreensaver"
New-Item -ItemType Directory -Force $settingsDir | Out-Null
Set-Content (Join-Path $settingsDir "settings.json") "{ this is not json" -Encoding ascii

$log = Join-Path $Out "settings.log"
$p = Start-Scr @("/c") $log
Start-Sleep -Seconds 3
if ($p.HasExited) { Fail "/c exited at once (code $($p.ExitCode))" }
else {
  $p.Refresh()
  if ($p.MainWindowTitle -ne "Cosmic Shore Screensaver") { Fail "/c window title is '$($p.MainWindowTitle)'" }
  Shot "settings-dialog"
  $p.Kill(); $p.WaitForExit()
}

# ── /s: draws on every screen, exits on each kind of input ───────────────────────────────────
$inputs = [ordered]@{
  "mouse-move" = { $c = [System.Windows.Forms.Cursor]::Position; [Inject]::SetCursorPos($c.X + 60, $c.Y + 40) | Out-Null }
  "key"        = { [Inject]::Key() }
  "click"      = { [Inject]::Click() }
}
$first = $true
foreach ($kind in $inputs.Keys) {
  $log = Join-Path $Out "run-$kind.log"
  [Inject]::SetCursorPos(400, 300) | Out-Null
  $p = Start-Scr @("/s") $log
  if (-not (Wait-Log $log "scene ready" $screens $ReadyTimeoutSec)) { Fail "/s ($kind): the scene was not ready on $screens screen(s) in $ReadyTimeoutSec s" }
  if ($first) { Start-Sleep -Seconds 4; Shot "fullscreen" }
  if ($p.HasExited) { Fail "/s ($kind) exited before any input (code $($p.ExitCode))"; continue }
  $text = LogText $log
  if ($text -match "page error") { Fail "/s ($kind): page error in the log" }
  if ($first) {
    # fps=30 from the corrupt file's defaults
    if ($text -notmatch "fps=30") { Fail "corrupt settings did not fall back to fps=30" }
    $first = $false
  }
  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  & $inputs[$kind]
  if (-not $p.WaitForExit(5000)) { Fail "/s did not exit within 5 s of a $kind"; $p.Kill(); $p.WaitForExit(); continue }
  $ms = $sw.ElapsedMilliseconds
  Write-Host ("/s exited {0} ms after a {1}, code {2}" -f $ms, $kind, $p.ExitCode)
  if ($p.ExitCode -ne 0) { Fail "/s exit code $($p.ExitCode) after a $kind" }
  if ((LogText $log) -notmatch "quit: ") { Fail "/s ($kind): no quit line in the log" }
}

# ── settings round trip: 60 fps written by hand is read back ─────────────────────────────────
Set-Content (Join-Path $settingsDir "settings.json") '{ "fps": 60, "screens": "all", "view": "vessel" }' -Encoding ascii
$log = Join-Path $Out "run-settings.log"
$p = Start-Scr @("/S") $log   # upper case, as Windows may send it
if (-not (Wait-Log $log "navigate .*fps=60&view=vessel" 1 30)) { Fail "settings.json was not applied (fps=60, view=vessel)" }
Start-Sleep -Seconds 1
[Inject]::Key()
if (-not $p.WaitForExit(5000)) { Fail "/S did not exit on a key"; $p.Kill() }
Remove-Item (Join-Path $settingsDir "settings.json")

# ── /p: a preview inside a parent window; exits when the parent closes ───────────────────────
$form = New-Object System.Windows.Forms.Form
$form.Text = "preview parent"; $form.StartPosition = "Manual"; $form.Location = New-Object System.Drawing.Point(100, 100)
$form.ClientSize = New-Object System.Drawing.Size(320, 200)
$panel = New-Object System.Windows.Forms.Panel
$panel.Dock = "Fill"; $form.Controls.Add($panel)
$form.Show(); [System.Windows.Forms.Application]::DoEvents()
$log = Join-Path $Out "preview.log"
$p = Start-Scr @("/p", "$($panel.Handle.ToInt64())") $log
$deadline = (Get-Date).AddSeconds($ReadyTimeoutSec)
while ((Get-Date) -lt $deadline -and (LogText $log) -notmatch "scene ready") { [System.Windows.Forms.Application]::DoEvents(); Start-Sleep -Milliseconds 100 }
if ((LogText $log) -notmatch "scene ready") { Fail "/p: the scene was not ready" }
if ((LogText $log) -notmatch "fps=15") { Fail "/p: not the low-cost preview profile" }
for ($i = 0; $i -lt 30; $i++) { [System.Windows.Forms.Application]::DoEvents(); Start-Sleep -Milliseconds 100 }
# Input over a preview must NOT end it.
[Inject]::Key()
for ($i = 0; $i -lt 10; $i++) { [System.Windows.Forms.Application]::DoEvents(); Start-Sleep -Milliseconds 100 }
if ($p.HasExited) { Fail "/p exited on input" }
Shot "preview"
$form.Close(); $form.Dispose()
if (-not $p.WaitForExit(5000)) { Fail "/p did not exit within 5 s of its parent closing"; $p.Kill() }
else { Write-Host "/p exited with its parent, code $($p.ExitCode)" }

# ── nothing left behind ──────────────────────────────────────────────────────────────────────
Start-Sleep -Seconds 5
$left = WebViewProcs
if ($left.Count) { Fail "$($left.Count) WebView2 process(es) still running after every run ended" }

Write-Host ""
if ($failures.Count) { Write-Host "$($failures.Count) failure(s)"; exit 1 }
Write-Host "windows smoke OK"
