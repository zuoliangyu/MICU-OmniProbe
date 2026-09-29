[CmdletBinding()]
param(
    [switch]$NoInstall,
    [switch]$ReleaseLike,
    [string]$ExpectedVersion = "",
    [string]$Target = "x86_64-pc-windows-msvc"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

. (Join-Path -Path $PSScriptRoot -ChildPath "scripts\common.ps1")

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Push-Location -LiteralPath $scriptDir

try {
    Assert-NodeInstalled

    if (-not (Test-Command -Name "cargo")) {
        throw "Cargo was not found. Please install Rust first."
    }

    $packageManager = Get-PackageManager

    Write-Host "Working directory: $scriptDir" -ForegroundColor Cyan
    Write-Host "Package manager: $packageManager" -ForegroundColor Cyan

    Install-NodeModulesIfMissing -ProjectDir $scriptDir -PackageManager $packageManager -NoInstall:$NoInstall

    if ($packageManager -eq "pnpm") {
        Write-Host "Checking pnpm frozen lockfile consistency..." -ForegroundColor Green
        Invoke-PackageManager -PackageManager $packageManager -Arguments @("install", "--frozen-lockfile", "--ignore-scripts")
    }

    Write-Host "Checking TypeScript..." -ForegroundColor Green
    Invoke-PackageManager -PackageManager $packageManager -Arguments @("exec", "tsc", "--noEmit")

    Write-Host "Running ESLint..." -ForegroundColor Green
    Invoke-PackageManager -PackageManager $packageManager -Arguments @("exec", "eslint", ".", "--max-warnings", "0")

    Write-Host "Checking Prettier formatting..." -ForegroundColor Green
    Invoke-PackageManager -PackageManager $packageManager -Arguments @("exec", "prettier", "--check", "src/**/*.{ts,tsx,css}")

    Write-Host "Checking Cargo manifest..." -ForegroundColor Green
    cargo metadata --manifest-path "src-tauri/Cargo.toml" --no-deps | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "Cargo metadata check failed."
    }

    # 版本一致性统一交给 scripts/check-versions.mjs（pnpm test 也会跑它），
    # 这里仅在传入 -ExpectedVersion 时额外校验基准版本是否符合预期。
    if (-not [string]::IsNullOrWhiteSpace($ExpectedVersion)) {
        Write-Host "Checking version consistency: $($ExpectedVersion.Trim())" -ForegroundColor Green
        node scripts/check-versions.mjs --expect $ExpectedVersion.Trim()
        if ($LASTEXITCODE -ne 0) {
            throw "Version consistency check failed."
        }
    }

    Write-Host "Running frontend production build..." -ForegroundColor Green
    Invoke-PackageManager -PackageManager $packageManager -Arguments @("build")

    Write-Host "Running integration checks (scripts/check-*)..." -ForegroundColor Green
    Invoke-PackageManager -PackageManager $packageManager -Arguments @("test")

    # 注意：clippy 只检查当前平台。udev.rs 等 #[cfg(target_os = "...")] 门控的代码
    # 在别的平台上不会被编译，本机全绿不代表 CI 全绿。跨平台由 CI 的双平台矩阵兜底。
    Write-Host "Running clippy (current platform only)..." -ForegroundColor Green
    cargo clippy --manifest-path "src-tauri/Cargo.toml" --all-targets -- -D warnings
    if ($LASTEXITCODE -ne 0) {
        throw "cargo clippy failed."
    }

    Write-Host "Running cargo test..." -ForegroundColor Green
    cargo test --manifest-path "src-tauri/Cargo.toml"
    if ($LASTEXITCODE -ne 0) {
        throw "cargo test failed."
    }

    if ($ReleaseLike) {
        Write-Host "Running release-like Tauri build..." -ForegroundColor Yellow
        if ($packageManager -eq "pnpm") {
            Invoke-PackageManager -PackageManager $packageManager -Arguments @("tauri", "build", "--target", $Target, "--bundles", "nsis")
        }
        else {
            Invoke-PackageManager -PackageManager $packageManager -Arguments @("run", "tauri", "--", "build", "--target", $Target, "--bundles", "nsis")
        }
    }

    Write-Host ""
    Write-Host "Local CI checks passed." -ForegroundColor Green
    if ($ReleaseLike) {
        Write-Host "Release-like build target: $Target" -ForegroundColor Green
    }
}
finally {
    Pop-Location
}
