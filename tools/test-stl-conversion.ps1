<#
  STL -> GLB conversion test (backend must be running: cd backend ; npm run dev)

  Usage:
    powershell -ExecutionPolicy Bypass -File tools\test-stl-conversion.ps1
    powershell -ExecutionPolicy Bypass -File tools\test-stl-conversion.ps1 -File "thing_746258/files/StepperDriverHolder_V1.STL"
    powershell -ExecutionPolicy Bypass -File tools\test-stl-conversion.ps1 -Open    # also opens the preview in the connected headset

  The STL must be in backend\assets\source-models\ (a Thingiverse download folder with
  LICENSE.txt / README.txt next to it gives the attribution automatically).
  ASCII only on purpose (Windows PowerShell 5.1 reads UTF-8 files without BOM as ANSI).
#>
param(
  [string]$File = "thing_746258/files/StepperHolder_V2.STL",
  [string]$Unit = "mm",
  [string]$Color = "#0088FF",
  [switch]$Open,
  [int]$Port = 3000
)
$ErrorActionPreference = "Stop"
$base = "http://localhost:$Port"
$root = Split-Path -Parent $PSScriptRoot
$local = Join-Path $root ("backend\assets\source-models\" + $File.Replace("/", "\"))

Write-Host "STL -> GLB conversion test" -ForegroundColor Cyan
if (-not (Test-Path $local)) { Write-Host "[X] STL not found: $local" -ForegroundColor Red; exit 1 }
Write-Host ("    Input : {0} ({1:N1} KB)" -f $File, ((Get-Item $local).Length / 1KB))

$body = @{ file = $File; unit = $Unit; color = $Color } | ConvertTo-Json
try {
  $r = Invoke-RestMethod -Uri "$base/api/convert/source" -Method Post -ContentType "application/json" -Body $body -TimeoutSec 60
} catch {
  Write-Host "[X] API call failed: $($_.Exception.Message)" -ForegroundColor Red
  Write-Host "    Is the backend running? cd backend ; npm run dev" -ForegroundColor Yellow
  exit 1
}
$m = $r.model
Write-Host "[OK] Converted" -ForegroundColor Green
Write-Host ("    GLB       : {0} ({1:N1} KB)" -f $m.url, ($m.bytes / 1KB))
Write-Host ("    Triangles : {0}" -f $m.triangles)
Write-Host ("    Real size : {0:N1} x {1:N1} x {2:N1} mm" -f ($m.dimensions_m.x * 1000), ($m.dimensions_m.y * 1000), ($m.dimensions_m.z * 1000))
if ($m.attribution) { Write-Host ("    Credits   : {0} by {1} - {2}" -f $m.attribution.title, $m.attribution.author, $m.attribution.license) }
else { Write-Host "    Credits   : none found (add LICENSE.txt/README.txt next to the STL)" -ForegroundColor Yellow }

# The GLB must be downloadable by the viewer.
$head = Invoke-WebRequest -Uri "$base$($m.url)" -UseBasicParsing -Method Head
Write-Host ("[OK] Served at {0}{1} ({2})" -f $base, $m.url, $head.Headers["Content-Type"]) -ForegroundColor Green
Write-Host ("    Try it in the workshop: {0}{1}" -f $base, $m.preview_url) -ForegroundColor Cyan

if ($Open) {
  $adb = (Get-Command adb -ErrorAction SilentlyContinue).Source
  if (-not $adb) { $adb = "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" }
  $pkgs = & $adb shell pm list packages
  $browser = @("com.oculus.browser", "com.pico.browser.overseas", "com.pico.browser") | Where-Object { $pkgs -match "package:$([regex]::Escape($_))$" } | Select-Object -First 1
  if ($browser) {
    & $adb reverse "tcp:$Port" "tcp:$Port" | Out-Null
    & $adb shell "am start -a android.intent.action.VIEW -d '$base$($m.preview_url)' $browser" | Out-Null
    Write-Host "[OK] Opened in the headset ($browser)" -ForegroundColor Green
  } else {
    Write-Host "[!] No headset browser found (headset connected?)" -ForegroundColor Yellow
  }
}
