<#
.SYNOPSIS
  ReadAny - Android development environment checker (Windows).

.DESCRIPTION
  Verifies the toolchain needed to build and run the Expo dev client on
  Android: Node.js/pnpm, JDK 17+, the Android SDK (platform-tools, platforms,
  build-tools, accepted licenses), and an emulator AVD or connected device.
  Prints PASS/FAIL per check with concrete fix steps and exits non-zero when
  any check fails.

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts/check-android-env.ps1
#>
[CmdletBinding()]
param()

$ErrorActionPreference = "SilentlyContinue"

$script:Pass = 0
$script:Fail = 0

function Write-Result {
  param([string]$Name, [bool]$Ok, [string]$Hint)
  if ($Ok) { $script:Pass++ } else { $script:Fail++ }
  $mark = if ($Ok) { "[ OK ]" } else { "[FAIL]" }
  $color = if ($Ok) { "Green" } else { "Red" }
  Write-Host ("{0} {1}" -f $mark, $Name) -ForegroundColor $color
  if (-not $Ok -and $Hint) {
    Write-Host ("       > {0}" -f $Hint) -ForegroundColor Yellow
  }
}

Write-Host "ReadAny - Android dev environment check" -ForegroundColor Cyan
Write-Host ""

# --- Node.js / pnpm --------------------------------------------------
$node = Get-Command node -ErrorAction SilentlyContinue
Write-Result "Node.js" ($null -ne $node) "Install Node.js 18+ from https://nodejs.org"

$pnpm = Get-Command pnpm -ErrorAction SilentlyContinue
Write-Result "pnpm" ($null -ne $pnpm) "Install pnpm: npm install -g pnpm"

# --- JDK -------------------------------------------------------------
$javaHome = $env:JAVA_HOME
$jdkOk = $false
$jdkHint = "Install JDK 17 or 21 from https://adoptium.net, then set the JAVA_HOME user environment variable to its folder."
if ($javaHome) {
  $javaBin = Join-Path $javaHome "bin\java.exe"
  if (Test-Path $javaBin) {
    $verLine = (& $javaBin -version 2>&1 | Select-Object -First 1)
    if ($verLine -match 'version "(\d+)') {
      $major = [int]$Matches[1]
      $jdkOk = $major -ge 17
      if (-not $jdkOk) {
        $jdkHint = "Found JDK $major - Gradle 8.13 needs JDK 17 or 21 (JDK 25 is too new)."
      }
    } else {
      $jdkHint = "Could not read the JDK version from $javaBin."
    }
  } else {
    $jdkHint = "JAVA_HOME is set to `"$javaHome`" but bin\java.exe was not found there."
  }
} else {
  $jdkHint = "JAVA_HOME is not set. Install JDK 17/21 and set JAVA_HOME (e.g. C:\Program Files\Eclipse Adoptium\jdk-21.x)."
}
Write-Result "JDK (JAVA_HOME=$javaHome)" $jdkOk $jdkHint

# --- Android SDK -----------------------------------------------------
$sdk = $env:ANDROID_HOME
if (-not $sdk) { $sdk = $env:ANDROID_SDK_ROOT }
$sdkDefault = Join-Path $env:LOCALAPPDATA "Android\Sdk"
if (-not $sdk) { $sdk = $sdkDefault }
$sdkOk = Test-Path $sdk
Write-Result "Android SDK ($sdk)" $sdkOk (
  "Install Android Studio or the command-line tools. If you used the default location, set the ANDROID_HOME user environment variable to: $sdkDefault"
)

if ($sdkOk) {
  $adb = Join-Path $sdk "platform-tools\adb.exe"
  $adbOk = Test-Path $adb
  Write-Result "platform-tools (adb)" $adbOk "SDK Manager -> SDK Tools -> check 'Android SDK Platform-Tools'."

  $platforms = @(Get-ChildItem (Join-Path $sdk "platforms") -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -match '^android-(3[5-9]|[4-9][0-9])$' })
  Write-Result "Android SDK Platform (API 35+)" ($platforms.Count -gt 0) (
    "SDK Manager -> SDK Platforms -> check 'Android 15/16 (API 35/36)'. Gradle auto-downloads the exact platform if licenses are accepted."
  )

  $buildTools = @(Get-ChildItem (Join-Path $sdk "build-tools") -Directory -ErrorAction SilentlyContinue)
  Write-Result "Android SDK Build-Tools" ($buildTools.Count -gt 0) "SDK Manager -> SDK Tools -> check 'Android SDK Build-Tools'."

  Write-Result "SDK licenses accepted" (Test-Path (Join-Path $sdk "licenses")) (
    "Accept them via SDK Manager, or run sdkmanager --licenses."
  )

  $deviceCount = 0
  if ($adbOk) {
    $devOut = @(& $adb devices 2>&1)
    $deviceCount = @($devOut | Where-Object { $_ -match "\tdevice$" }).Count
  }
  Write-Result "Android device/emulator connected" ($deviceCount -gt 0) (
    "Start an emulator (Device Manager) or connect a device with USB debugging enabled."
  )

  $emu = Join-Path $sdk "emulator\emulator.exe"
  $avdCount = 0
  if (Test-Path $emu) {
    $avdOut = @(& $emu -list-avds 2>&1)
    $avdCount = @($avdOut | Where-Object { $_ -match '\S' -and $_ -notmatch '^INFO|^WARNING|^ERROR' }).Count
  }
  Write-Result "Emulator AVD configured" ($avdCount -gt 0) (
    "Android Studio -> Device Manager -> Create device (x86_64 system image, API 35)."
  )
}

# --- Summary ---------------------------------------------------------
Write-Host ""
$color = if ($script:Fail -eq 0) { "Green" } else { "Red" }
Write-Host ("{0} passed, {1} failed" -f $script:Pass, $script:Fail) -ForegroundColor $color
if ($script:Fail -gt 0) {
  exit 1
}
