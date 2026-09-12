<#
.SYNOPSIS
  ReadAny - Android development environment checker (Windows).

.DESCRIPTION
  Verifies the toolchain needed to build and run the Expo dev client on
  Android: Node.js/pnpm, JDK 17-21, the Android SDK (platform-tools,
  platforms, build-tools, accepted licenses), and an emulator AVD or
  connected device. Prints PASS/WARN/FAIL per check with concrete fix steps
  and exits non-zero when any check fails.

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts/check-android-env.ps1
#>
[CmdletBinding()]
param()

$ErrorActionPreference = "SilentlyContinue"

$script:Pass = 0
$script:Fail = 0
$script:Warn = 0

# -Warn marks a condition that alone should not fail the doctor (the paired
# check being satisfied is enough), so it counts separately from failures.
function Write-Result {
  param([string]$Name, [bool]$Ok, [string]$Hint, [switch]$Warn)
  if ($Ok) { $script:Pass++ } elseif ($Warn) { $script:Warn++ } else { $script:Fail++ }
  $mark = if ($Ok) { "[ OK ]" } elseif ($Warn) { "[WARN]" } else { "[FAIL]" }
  $color = if ($Ok) { "Green" } elseif ($Warn) { "Yellow" } else { "Red" }
  Write-Host ("{0} {1}" -f $mark, $Name) -ForegroundColor $color
  if (-not $Ok -and $Hint) {
    Write-Host ("       > {0}" -f $Hint) -ForegroundColor Yellow
  }
}

Write-Host "ReadAny - Android dev environment check" -ForegroundColor Cyan
Write-Host ""

# --- Node.js / pnpm --------------------------------------------------
# The doctor exists to catch version problems, so verify the documented
# minimum (Node 18+), not just that the command resolves.
$node = Get-Command node -ErrorAction SilentlyContinue
$nodeVer = $null
$nodeOk = $false
if ($node) {
  $nodeVer = (& node -v 2>$null | Select-Object -First 1)
  # Explicit if keeps the version comparison self-contained and independent
  # of $Matches state. (PowerShell's -and short-circuits, so the previous
  # chained form was correct too — this is for clarity, not a fix.)
  if ($nodeVer -match '^v(\d+)') { $nodeOk = [int]$Matches[1] -ge 18 }
}
Write-Result "Node.js" $nodeOk (
  "Node.js 18+ is required (found: $(if ($nodeVer) { $nodeVer.Trim() } else { 'not installed' })). Install from https://nodejs.org"
)

$pnpm = Get-Command pnpm -ErrorAction SilentlyContinue
Write-Result "pnpm" ($null -ne $pnpm) "Install pnpm: npm install -g pnpm"

# --- JDK -------------------------------------------------------------
$javaHome = $env:JAVA_HOME
$jdkOk = $false
$jdkHint = "Install JDK 17 or 21 from https://adoptium.net, then set the JAVA_HOME user environment variable to its folder."
if ($javaHome) {
  $javaBin = Join-Path $javaHome "bin\java.exe"
  if (Test-Path $javaBin) {
    # `cmd /c ... 2>&1` merges java's stderr at the OS level; under
    # $ErrorActionPreference=SilentlyContinue PowerShell would otherwise swallow
    # the NativeCommandError records produced by `2>&1`.
    $verLine = (& cmd /c "`"$javaBin`" -version 2>&1" 2>$null | Select-Object -First 1)
    if ($verLine -match 'version "(\d+)') {
      $major = [int]$Matches[1]
      # Legacy layouts report `java version "1.8.0_401"` — the leading 1 is
      # not the major, the minor after "1." is (that's JDK 8).
      if ($major -eq 1 -and $verLine -match 'version "1\.(\d+)') { $major = [int]$Matches[1] }
      # Enforce the range Gradle 8.13 actually supports; without the upper
      # bound a too-new JDK (22+) silently passes and the build fails later.
      $jdkOk = $major -ge 17 -and $major -le 21
      if (-not $jdkOk) {
        if ($major -lt 17) {
          $jdkHint = "Found JDK $major - Gradle 8.13 needs JDK 17 or 21."
        } else {
          $jdkHint = "Found JDK $major - Gradle 8.13 needs JDK 17 or 21 (JDK 22+ is too new)."
        }
      }
      # A JRE passes the java -version check but Gradle needs the compiler:
      # JRE installs ship bin\java.exe without bin\javac.exe.
      if ($jdkOk -and -not (Test-Path (Join-Path $javaHome "bin\javac.exe"))) {
        $jdkOk = $false
        $jdkHint = "JAVA_HOME points to a JRE (no bin\javac.exe) - Gradle needs a full JDK. Install JDK 17 or 21 from https://adoptium.net (choose JDK, not JRE)."
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
# Gradle resolves the SDK from ANDROID_HOME/ANDROID_SDK_ROOT, then from
# android/local.properties (sdk.dir — written by Android Studio / Gradle
# on first sync). Everything else must NOT pass: a bare default-folder
# fallback used to print a green PASS while the build failed with
# "SDK location not found" — exactly the trap this doctor exists to catch.
$sdk = $env:ANDROID_HOME
if (-not $sdk) { $sdk = $env:ANDROID_SDK_ROOT }
$sdkFromEnv = [bool]$sdk
$sdkDefault = Join-Path $env:LOCALAPPDATA "Android\Sdk"
if (-not $sdk) { $sdk = $sdkDefault }
$sdkOk = Test-Path $sdk

# Honor a pinned sdk.dir as the alternative source the env vars would be.
$localProps = Join-Path (Split-Path $PSScriptRoot -Parent) "android\local.properties"
$sdkDirPinned = $false
$sdkPinnedPath = $null
if (Test-Path $localProps) {
  $pinnedLine = Get-Content $localProps | Where-Object { $_ -match '^sdk\.dir=(.+)$' } | Select-Object -First 1
  if ($pinnedLine) {
    # properties-file escapes: backslashes doubled, colon written as \:
    $sdkPinnedPath = $pinnedLine.Substring(8).Replace('\\', '\').Replace('\:', ':')
    $sdkDirPinned = Test-Path $sdkPinnedPath
  }
}

$sdkPass = ($sdkOk -and $sdkFromEnv) -or $sdkDirPinned
$sdkDisplay = if (-not $sdkFromEnv -and $sdkDirPinned) { $sdkPinnedPath } else { $sdk }
$sdkHint =
  if ($sdkOk -and -not $sdkFromEnv -and -not $sdkDirPinned) {
    "Found the SDK only at the default location, but Gradle does not look there. Set the ANDROID_HOME user environment variable to $sdkDefault (or let Android Studio write android/local.properties)."
  } elseif ($sdkFromEnv -and -not $sdkOk) {
    "ANDROID_HOME/ANDROID_SDK_ROOT is set to `"$sdk`" but that folder does not exist. Update the variable (e.g. to $sdkDefault) or reinstall the SDK there."
  } else {
    "Install Android Studio or the command-line tools, then set the ANDROID_HOME user environment variable to the SDK folder (e.g. $sdkDefault)."
  }
Write-Result "Android SDK ($sdkDisplay)" $sdkPass $sdkHint

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

  $emu = Join-Path $sdk "emulator\emulator.exe"
  $avdCount = 0
  if (Test-Path $emu) {
    $avdOut = @(& $emu -list-avds 2>&1)
    $avdCount = @($avdOut | Where-Object { $_ -match '\S' -and $_ -notmatch '^INFO|^WARNING|^ERROR' }).Count
  }

  # DESCRIPTION promises "an emulator AVD or connected device" — either one
  # satisfies the toolchain. A missing half degrades to WARN when its twin
  # is present, so a clean setup (AVD created, emulator simply not running
  # yet — `expo run:android` starts it) does not fail the whole doctor.
  Write-Result "Android device connected" ($deviceCount -gt 0) (
    "Start an emulator (Device Manager) or connect a device with USB debugging enabled."
  ) -Warn:($avdCount -gt 0)
  Write-Result "Emulator AVD configured" ($avdCount -gt 0) (
    "Android Studio -> Device Manager -> Create device (x86_64 system image, API 35)."
  ) -Warn:($deviceCount -gt 0)
}

# --- Summary ---------------------------------------------------------
Write-Host ""
$color = if ($script:Fail -gt 0) { "Red" } elseif ($script:Warn -gt 0) { "Yellow" } else { "Green" }
Write-Host ("{0} passed, {1} warned, {2} failed" -f $script:Pass, $script:Warn, $script:Fail) -ForegroundColor $color
if ($script:Fail -gt 0) {
  exit 1
}
