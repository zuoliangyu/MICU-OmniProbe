# build.ps1 / check.ps1 / dev.ps1 共用的辅助函数，由各脚本 dot-source 引入。

function Test-Command {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Name
    )

    return $null -ne (Get-Command -Name $Name -ErrorAction SilentlyContinue)
}

function Assert-NodeInstalled {
    # scripts/check-*.mts 直接 import .ts 源码，依赖 Node 22.6+ 的原生类型擦除
    if (-not (Test-Command -Name "node")) {
        throw "Node.js 22+ was not found. Please install Node.js first."
    }
}

function Get-PackageManager {
    if (Test-Command -Name "pnpm") {
        return "pnpm"
    }

    if (Test-Command -Name "npm") {
        return "npm"
    }

    throw "Neither pnpm nor npm was found. Please install one of them first."
}

function Invoke-PackageManager {
    param(
        [Parameter(Mandatory = $true)]
        [string]$PackageManager,
        [Parameter(Mandatory = $true)]
        [string[]]$Arguments
    )

    & $PackageManager @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "Command failed: $PackageManager $($Arguments -join ' ')"
    }
}

function Install-NodeModulesIfMissing {
    param(
        [Parameter(Mandatory = $true)]
        [string]$ProjectDir,
        [Parameter(Mandatory = $true)]
        [string]$PackageManager,
        [switch]$NoInstall
    )

    $nodeModulesPath = Join-Path -Path $ProjectDir -ChildPath "node_modules"
    if ((-not $NoInstall) -and (-not (Test-Path -LiteralPath $nodeModulesPath))) {
        Write-Host "node_modules not found. Installing frontend dependencies..." -ForegroundColor Yellow
        Invoke-PackageManager -PackageManager $PackageManager -Arguments @("install")
    }
}

function Get-CleanArgs {
    param(
        [string[]]$Arguments
    )

    if ($null -eq $Arguments) {
        return @()
    }

    return @(
        $Arguments | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
    )
}
