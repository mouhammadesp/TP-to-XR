<#
  Headset test helper (PC side) for TP-to-xR - Meta Quest 3 and PICO 4 Ultra.

  Usage (from the project root, Windows PowerShell):
    powershell -ExecutionPolicy Bypass -File tools\quest.ps1               # setup: adb, port reverse, server check, opens the app in the headset
    powershell -ExecutionPolicy Bypass -File tools\quest.ps1 -Watch        # keep the port reverse alive (re-applied after every USB reconnect)
    powershell -ExecutionPolicy Bypass -File tools\quest.ps1 -Screenshots  # pull headset screenshots to docs\screenshots\quest
    powershell -ExecutionPolicy Bypass -File tools\quest.ps1 -Report       # metrics of tp_demo_mechanical sessions
    powershell -ExecutionPolicy Bypass -File tools\quest.ps1 -Report -Tp tp_demo_electrical

  ASCII only on purpose: Windows PowerShell 5.1 misreads UTF-8 files without BOM.
#>
param(
  [switch]$Watch,
  [switch]$Screenshots,
  [switch]$Report,
  [string]$Tp = "tp_demo_mechanical",
  [int]$Port = 3000
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$base = "http://localhost:$Port"

function Find-Adb {
  $cmd = Get-Command adb -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  foreach ($p in @("$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe", "C:\platform-tools\adb.exe", "$env:USERPROFILE\platform-tools\adb.exe")) {
    if (Test-Path $p) { return $p }
  }
  return $null
}

# Headset browsers, in order of preference.
$Browsers = @("com.oculus.browser", "com.pico.browser.overseas", "com.pico.browser")

function Get-Browser([string]$adb) {
  $pkgs = & $adb shell pm list packages
  foreach ($b in $Browsers) { if ($pkgs -match "package:$([regex]::Escape($b))$") { return $b } }
  return $null
}

function Get-Quest([string]$adb) {
  $lines = & $adb devices | Select-Object -Skip 1 | Where-Object { $_ -match "\S" }
  foreach ($l in $lines) {
    $parts = $l -split "\s+"
    if ($parts.Count -ge 2) { return [pscustomobject]@{ Serial = $parts[0]; State = $parts[1] } }
  }
  return $null
}

$adb = Find-Adb
if (-not $adb) {
  Write-Host "[X] adb not found. Install Android platform-tools: https://developer.android.com/tools/releases/platform-tools" -ForegroundColor Red
  exit 1
}

# ---------------------------------------------------------------- Report
if ($Report) {
  try { $a = Invoke-RestMethod "$base/api/analytics/$Tp" -TimeoutSec 5 } catch { Write-Host "[X] $base/api/analytics/$Tp : $($_.Exception.Message)" -ForegroundColor Red; exit 1 }
  Write-Host "=== Analytics $Tp ===" -ForegroundColor Cyan
  "{0,-28} {1}" -f "Sessions (finished)", "$($a.sessions) ($($a.finished))"
  "{0,-28} {1}" -f "Mean FPS / min FPS", "$($a.mean_fps) / $($a.min_fps)"
  "{0,-28} {1}" -f "Mean duration (s)", "$($a.mean_duration_sec)"
  "{0,-28} {1}" -f "Mean accuracy (%)", "$($a.mean_accuracy_percent)"
  "{0,-28} {1}" -f "Mean time per step (s)", (($a.mean_time_per_step_sec | ForEach-Object { "$_" }) -join " | ")
  Write-Host "--- Gestures (gesture:hand = count) ---" -ForegroundColor Cyan
  $a.gestures.PSObject.Properties | Sort-Object Name | ForEach-Object { "{0,-28} {1}" -f $_.Name, $_.Value }
  Write-Host "--- Sessions ---" -ForegroundColor Cyan
  $a.data | Sort-Object started_at | ForEach-Object {
    $fps = if ($_.fps) { "$($_.fps.avg) avg / $($_.fps.min) min" } else { "-" }
    "{0}  student={1}  {2}s  steps {3}/{4}  xr={5} hands={6}  fps {7}  events={8}" -f $_.session_id, $_.student_id, $_.duration_sec, $_.steps_completed, $_.steps_total, $_.device.xr, $_.device.hand_tracking, $fps, $_.events
  }
  Write-Host ""
  Write-Host "Gesture recognition rate = detected / performed. Example: 10 thumb+middle pinches with the right hand"
  Write-Host "-> rate = pinch_middle:right / 10 (count also the steps that changed without a pinch = false positives)."
  exit 0
}

# ---------------------------------------------------------------- Watch
if ($Watch) {
  Write-Host "Watching the headset: the port reverse is re-applied after every reconnection (Ctrl+C to stop)." -ForegroundColor Cyan
  $wasUp = $false
  while ($true) {
    $q = Get-Quest $adb
    $up = $q -and $q.State -eq "device"
    if ($up) {
      $list = (& $adb -s $q.Serial reverse --list) -join " "
      if ($list -notmatch "tcp:$Port") {
        & $adb -s $q.Serial reverse "tcp:$Port" "tcp:$Port" | Out-Null
        Write-Host "$(Get-Date -Format HH:mm:ss) [OK] $($q.Serial) connected -> reverse tcp:$Port restored" -ForegroundColor Green
      }
    } elseif ($wasUp) {
      Write-Host "$(Get-Date -Format HH:mm:ss) [!] Headset disconnected (USB cable / sleep). Waiting..." -ForegroundColor Yellow
    }
    $wasUp = [bool]$up
    Start-Sleep -Seconds 2
  }
}

# ---------------------------------------------------------------- Screenshots
if ($Screenshots) {
  $q = Get-Quest $adb
  if (-not $q -or $q.State -ne "device") { Write-Host "[X] No Quest connected (adb devices)." -ForegroundColor Red; exit 1 }
  $dest = Join-Path $root "docs\screenshots\quest"
  New-Item -ItemType Directory -Force $dest | Out-Null
  # Quest: /sdcard/Oculus/Screenshots ; PICO: /sdcard/Pictures/Screenshots (system capture)
  foreach ($dir in @("/sdcard/Oculus/Screenshots", "/sdcard/Pictures/Screenshots", "/sdcard/DCIM/Screenshots")) {
    $exists = (& $adb shell "ls -d $dir 2>/dev/null")
    if ($exists) { & $adb pull "$dir/." "$dest" | Out-Host }
  }
  Write-Host "[OK] Screenshots copied to $dest (rename them 08_quest_menu.png, ... as listed in the report)." -ForegroundColor Green
  exit 0
}

# ---------------------------------------------------------------- Setup
Write-Host "adb: $adb"
$q = Get-Quest $adb
if (-not $q) {
  Write-Host "[X] No device. Checklist:" -ForegroundColor Red
  Write-Host "    1. Developer mode ON (Meta Horizon app on the phone > device > Developer mode)"
  Write-Host "    2. USB-C cable that carries DATA (not a charge-only cable)"
  Write-Host "    3. Put the headset on: accept 'Allow USB debugging' (tick 'Always allow')"
  Write-Host "    4. Run this script again"
  exit 1
}
if ($q.State -ne "device") {
  Write-Host "[X] Device $($q.Serial) is '$($q.State)': accept the USB debugging prompt inside the headset, then retry." -ForegroundColor Red
  exit 1
}
$model = (& $adb -s $q.Serial shell getprop ro.product.model).Trim()
$battery = (& $adb -s $q.Serial shell dumpsys battery | Select-String "level:").ToString().Trim()
Write-Host "[OK] $model ($($q.Serial)) - battery $battery" -ForegroundColor Green

& $adb -s $q.Serial reverse "tcp:$Port" "tcp:$Port" | Out-Null
Write-Host "[OK] adb reverse tcp:$Port -> PC:$Port" -ForegroundColor Green
& $adb -s $q.Serial reverse --list | Out-Host

try {
  $demos = (Invoke-RestMethod "$base/api/demo" -TimeoutSec 5).demos
  Write-Host "[OK] Server $base up, $($demos.Count) demo TP(s)" -ForegroundColor Green
} catch {
  Write-Host "[X] $base/api/demo does not answer ($($_.Exception.Message))." -ForegroundColor Red
  Write-Host "    Start (or restart) the server: cd backend ; npm run dev   (and build the app: cd frontend-vr ; npm run build)"
  exit 1
}

$browser = Get-Browser $adb
$url = "$base/vr/?student=headset_test"
if ($browser) {
  & $adb -s $q.Serial shell "am start -a android.intent.action.VIEW -d '$url' $browser" | Out-Null
  Write-Host "[OK] Opened $url in $browser (put the headset on)" -ForegroundColor Green
} else {
  Write-Host "[!] No known browser found; open $url manually in the headset." -ForegroundColor Yellow
}
Write-Host ""
Write-Host "=== Keep the connection alive ===" -ForegroundColor Cyan
Write-Host "  The port reverse is lost when the USB link drops (cable, sleep). In another terminal:"
Write-Host "  powershell -ExecutionPolicy Bypass -File tools\quest.ps1 -Watch"
Write-Host "  (localhost through the USB cable: WebXR is allowed without HTTPS)"
Write-Host ""
Write-Host "=== Console / debugging on the PC ===" -ForegroundColor Cyan
Write-Host "  Chrome on the PC -> chrome://inspect/#devices -> headset browser -> inspect"
Write-Host "  (shows console errors and the headset page; there is no F12 inside the headset)"
Write-Host ""
Write-Host "After the session: tools\quest.ps1 -Screenshots   then   tools\quest.ps1 -Report"
