<#
.SYNOPSIS
  Runs `tauri android <args>` with a working Windows toolchain environment.

.EXAMPLE
  ./scripts/android.ps1 dev
  ./scripts/android.ps1 build --apk --debug --target aarch64

.NOTES
  - CC_/AR_/CXX_ are required by crates that compile C in build.rs (rusqlite bundled, ring):
    Tauri only configures the final linker.
  - GRADLE_USER_HOME outside the user profile avoids Gradle 8.6+ "Could not move temporary
    workspace to immutable location" failures seen on this machine.
  - TMP/TEMP point to a folder private to this copy of the project while Tauri runs, then
    are restored. See Get-TempPrive below. With `dev --open`, close Android Studio first: a window
    already open keeps the old TEMP and would not find the address file.
#>
# Plain $args on purpose: a param() block with [Parameter()] turns the script into an advanced
# script, and PowerShell then swallows `--debug` as its own -Debug common parameter.
$TauriArgs = $args

$ErrorActionPreference = 'Stop'

if (-not $env:ANDROID_HOME) { $env:ANDROID_HOME = Join-Path $env:LOCALAPPDATA 'Android\Sdk' }
$env:ANDROID_SDK_ROOT = $env:ANDROID_HOME

if (-not $env:NDK_HOME) {
    $ndkRoot = Join-Path $env:ANDROID_HOME 'ndk'
    $latest = Get-ChildItem $ndkRoot -Directory -ErrorAction SilentlyContinue |
        Sort-Object { [version]$_.Name } -Descending | Select-Object -First 1
    if (-not $latest) { throw "No NDK found in $ndkRoot. Install one with sdkmanager `"ndk;<version>`"." }
    $env:NDK_HOME = $latest.FullName
}

if (-not $env:JAVA_HOME) { $env:JAVA_HOME = Join-Path $env:ProgramFiles 'Android\Android Studio\jbr' }
if (-not $env:GRADLE_USER_HOME) { $env:GRADLE_USER_HOME = 'C:\gradle-home' }

$toolchain = Join-Path $env:NDK_HOME 'toolchains\llvm\prebuilt\windows-x86_64\bin'
$minSdk = 24
$targets = @{
    'aarch64_linux_android'   = 'aarch64-linux-android'
    'armv7_linux_androideabi' = 'armv7a-linux-androideabi'
    'i686_linux_android'      = 'i686-linux-android'
    'x86_64_linux_android'    = 'x86_64-linux-android'
}
foreach ($rustTarget in $targets.Keys) {
    $clangPrefix = $targets[$rustTarget]
    Set-Item "env:CC_$rustTarget" (Join-Path $toolchain "$clangPrefix$minSdk-clang.cmd")
    Set-Item "env:CXX_$rustTarget" (Join-Path $toolchain "$clangPrefix$minSdk-clang++.cmd")
    Set-Item "env:AR_$rustTarget" (Join-Path $toolchain 'llvm-ar.exe')
}

$env:Path = "$env:JAVA_HOME\bin;$env:ANDROID_HOME\platform-tools;$env:Path"

Write-Host "[android.ps1] NDK=$env:NDK_HOME" -ForegroundColor DarkGray
Write-Host "[android.ps1] GRADLE_USER_HOME=$env:GRADLE_USER_HOME" -ForegroundColor DarkGray

$projectRoot = Split-Path $PSScriptRoot -Parent

# Temp folder private to this copy of the project. `tauri android build` serves its
# options on a local port and writes that address to %TEMP%\<identifier>-server-addr; the
# `android-studio-script` that Gradle runs for each Rust target reads it back (tauri-cli 2.10,
# src/mobile/mod.rs, write_options/read_options). The identifier comes from tauri.conf.json, so it is
# com.nyxplayer.app for every build (Nyx Banc and Nyx Mesure only change Gradle's applicationId):
# two builds started from two copies (CI in nyx-ci, bench in nyx-banc) overwrote each other's file,
# and the CI's armv7 step reached the bench build's server and hung (PC). TMP/TEMP are
# inherited by Gradle and its daemon, then by the script. One stable folder per copy (name + hash of
# its path): Gradle daemons stay reusable from one build to the next of the same copy. On the system
# drive, outside the user profile: no spaces in the path.
function Get-TempPrive([string]$Racine) {
    $chemin = [System.IO.Path]::GetFullPath($Racine).TrimEnd('\', '/')
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try { $octets = $sha.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($chemin.ToLowerInvariant())) } finally { $sha.Dispose() }
    $empreinte = -join ($octets[0..3] | ForEach-Object { $_.ToString('x2') })
    $nom = (Split-Path $chemin -Leaf) -replace '[^A-Za-z0-9._-]', '_'
    $base = if ($env:SystemDrive) { "$env:SystemDrive\nyx-temp" } else { Join-Path ([System.IO.Path]::GetTempPath()) 'nyx-temp' }
    Join-Path $base "$nom-$empreinte"
}
$tempPrive = Get-TempPrive $projectRoot
New-Item -ItemType Directory -Force $tempPrive | Out-Null
# Nothing else empties this folder: files left by Gradle and Kotlin over a week old are removed
Get-ChildItem $tempPrive -Recurse -File -ErrorAction SilentlyContinue |
    Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-7) } |
    Remove-Item -Force -ErrorAction SilentlyContinue
$tmpAvant = $env:TMP
$tempAvant = $env:TEMP
Write-Host "[android.ps1] TMP/TEMP=$tempPrive" -ForegroundColor DarkGray

Push-Location $projectRoot
try {
    $env:TMP = $tempPrive
    $env:TEMP = $tempPrive
    & npx tauri android @TauriArgs
    exit $LASTEXITCODE
} finally {
    # Restored for the rest of the terminal session (the full-CI script signs the APKs in $env:TEMP after)
    if ($null -eq $tmpAvant) { Remove-Item Env:TMP -ErrorAction SilentlyContinue } else { $env:TMP = $tmpAvant }
    if ($null -eq $tempAvant) { Remove-Item Env:TEMP -ErrorAction SilentlyContinue } else { $env:TEMP = $tempAvant }
    Pop-Location
}
