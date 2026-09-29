[CmdletBinding()]
param(
    [switch]$NoInstall,
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$TauriArgs
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

. (Join-Path -Path $PSScriptRoot -ChildPath "scripts\common.ps1")

function Initialize-TauriSigningEnv {
    param(
        [Parameter(Mandatory = $true)]
        [string]$ScriptDir
    )

    # 1) Already injected via env var (user / CI) - leave as is
    if ($env:TAURI_SIGNING_PRIVATE_KEY) {
        Write-Host "Using signing key from existing TAURI_SIGNING_PRIVATE_KEY env var." -ForegroundColor Cyan
        return
    }

    # 2) Local config file at project root (gitignored, holds the password)
    $localCfg = Join-Path -Path $ScriptDir -ChildPath ".tauri-signing.local.ps1"
    if (Test-Path -LiteralPath $localCfg) {
        Write-Host "Loading local signing config from .tauri-signing.local.ps1" -ForegroundColor Cyan
        . $localCfg
        if ($env:TAURI_SIGNING_PRIVATE_KEY) {
            return
        }
    }

    # 3) Auto-detect ~/.tauri/micu-omniprobe.key (legacy: ek-omniprobe.key, zuolandaplink.key)
    $candidates = @(
        (Join-Path -Path $env:USERPROFILE -ChildPath ".tauri\micu-omniprobe.key"),
        (Join-Path -Path $env:USERPROFILE -ChildPath ".tauri\ek-omniprobe.key"),
        (Join-Path -Path $env:USERPROFILE -ChildPath ".tauri\zuolandaplink.key")
    )
    foreach ($candidate in $candidates) {
        if (Test-Path -LiteralPath $candidate) {
            $env:TAURI_SIGNING_PRIVATE_KEY = $candidate
            Write-Host "Auto-detected signing key at $candidate" -ForegroundColor Cyan
            if (-not $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD) {
                Write-Host "Warning: TAURI_SIGNING_PRIVATE_KEY_PASSWORD is not set." -ForegroundColor Yellow
                Write-Host "         Updater bundle signing will fail, but msi/nsis installers will still be produced." -ForegroundColor Yellow
                Write-Host "         To enable updater signing, create .tauri-signing.local.ps1 with:" -ForegroundColor Yellow
                Write-Host '           $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = "<your_password>"' -ForegroundColor Yellow
            }
            return
        }
    }

    Write-Host "No signing key configured; updater bundle will not be signed (installers still build)." -ForegroundColor Yellow
}

function Test-InstallersProduced {
    param(
        [Parameter(Mandatory = $true)]
        [string]$ScriptDir,
        [Parameter(Mandatory = $true)]
        [datetime]$Since
    )

    $bundleDir = Join-Path -Path $ScriptDir -ChildPath "src-tauri\target\release\bundle"
    if (-not (Test-Path -LiteralPath $bundleDir)) {
        return $false
    }

    # Force to an array with @(): when Where-Object filters out every item, the
    # pipeline result is $null instead of an empty array. Under
    # Set-StrictMode -Version Latest, accessing $null.Count throws a
    # PropertyNotFoundException - which is exactly the error this function used to hit.
    $artifacts = @(
        Get-ChildItem -LiteralPath $bundleDir -Recurse -File -ErrorAction SilentlyContinue |
            Where-Object {
                ($_.Extension -in @(".exe", ".msi", ".dmg", ".deb", ".rpm", ".AppImage")) -and
                ($_.LastWriteTime -ge $Since)
            }
    )

    return ($artifacts.Count -gt 0)
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Push-Location -LiteralPath $scriptDir

try {
    Assert-NodeInstalled

    $packageManager = Get-PackageManager

    Write-Host "Working directory: $scriptDir" -ForegroundColor Cyan
    Write-Host "Package manager: $packageManager" -ForegroundColor Cyan

    Install-NodeModulesIfMissing -ProjectDir $scriptDir -PackageManager $packageManager -NoInstall:$NoInstall

    Initialize-TauriSigningEnv -ScriptDir $scriptDir

    Write-Host "Starting Tauri build..." -ForegroundColor Green
    $cleanTauriArgs = Get-CleanArgs -Arguments $TauriArgs
    $buildStart = Get-Date

    try {
        if ($packageManager -eq "pnpm") {
            Invoke-PackageManager -PackageManager $packageManager -Arguments (@("tauri", "build") + $cleanTauriArgs)
        }
        else {
            Invoke-PackageManager -PackageManager $packageManager -Arguments (@("run", "tauri", "--", "build") + $cleanTauriArgs)
        }
    }
    catch {
        # Installers already produced but only the updater signing step failed -> treat as success
        if (Test-InstallersProduced -ScriptDir $scriptDir -Since $buildStart) {
            $bundlePath = Join-Path -Path $scriptDir -ChildPath "src-tauri\target\release\bundle"
            Write-Host ""
            Write-Host "Build produced installers but the updater signing step failed." -ForegroundColor Yellow
            Write-Host "Reason: $($_.Exception.Message)" -ForegroundColor Yellow
            Write-Host "Installers location: $bundlePath" -ForegroundColor Cyan
            Write-Host "Tip: msi/nsis installers are for manual distribution; only the in-app updater requires signing." -ForegroundColor Cyan
        }
        else {
            throw
        }
    }
}
finally {
    Pop-Location
}
