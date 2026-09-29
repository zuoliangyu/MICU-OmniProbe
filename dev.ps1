[CmdletBinding()]
param(
    [switch]$NoInstall,
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$TauriArgs
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Test-Command {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Name
    )

    return $null -ne (Get-Command -Name $Name -ErrorAction SilentlyContinue)
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

function Test-PortBindable {
    param(
        [Parameter(Mandatory = $true)]
        [int]$Port
    )

    $addresses = @([System.Net.IPAddress]::Loopback)
    if ([System.Net.Sockets.Socket]::OSSupportsIPv6) {
        $addresses = @([System.Net.IPAddress]::IPv6Loopback) + $addresses
    }

    foreach ($address in $addresses) {
        $listener = $null
        try {
            $listener = [System.Net.Sockets.TcpListener]::new($address, $Port)
            if ($address.AddressFamily -eq [System.Net.Sockets.AddressFamily]::InterNetworkV6) {
                $listener.Server.DualMode = $false
            }
            $listener.Start()
        }
        catch {
            return $false
        }
        finally {
            if ($null -ne $listener) {
                $listener.Stop()
            }
        }
    }

    return $true
}

function Find-DevPortPair {
    param(
        [int]$StartPort = 3210,
        [int]$MaxPort = 65000
    )

    if ($StartPort -lt 1024) {
        $StartPort = 1024
    }

    if ($StartPort % 2 -ne 0) {
        $StartPort++
    }

    for ($devPort = $StartPort; $devPort -lt $MaxPort; $devPort += 2) {
        $hmrPort = $devPort + 1

        if ((Test-PortBindable -Port $devPort) -and (Test-PortBindable -Port $hmrPort)) {
            return @{
                DevPort = $devPort
                HmrPort = $hmrPort
            }
        }
    }

    throw "Unable to find an available dev/HMR port pair between $StartPort and $MaxPort."
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$tauriConfigOverridePath = $null
Push-Location -LiteralPath $scriptDir

try {
    if (-not (Test-Command -Name "node")) {
        throw "Node.js 18+ was not found. Please install Node.js first."
    }

    $packageManager = Get-PackageManager

    Write-Host "Working directory: $scriptDir" -ForegroundColor Cyan
    Write-Host "Package manager: $packageManager" -ForegroundColor Cyan

    $nodeModulesPath = Join-Path -Path $scriptDir -ChildPath "node_modules"
    $needInstall = (-not $NoInstall) -and (-not (Test-Path -LiteralPath $nodeModulesPath))
    if ($needInstall) {
        Write-Host "node_modules not found. Installing frontend dependencies..." -ForegroundColor Yellow
        Invoke-PackageManager -PackageManager $packageManager -Arguments @("install")
    }

    Write-Host "Starting Tauri dev..." -ForegroundColor Green
    $cleanTauriArgs = Get-CleanArgs -Arguments $TauriArgs
    $preferredDevPort = if ($env:TAURI_DEV_PORT) { [int]$env:TAURI_DEV_PORT } else { 3210 }
    $portPair = Find-DevPortPair -StartPort $preferredDevPort
    $devPort = $portPair.DevPort
    $hmrPort = $portPair.HmrPort
    $devUrl = "http://localhost:$devPort"
    $tauriConfigOverridePath = Join-Path $env:TEMP ("micu-omniprobe-tauri-dev-{0}.json" -f [guid]::NewGuid().ToString("N"))
    Set-Content -LiteralPath $tauriConfigOverridePath -Value (@{
        build = @{
            devUrl = $devUrl
        }
    } | ConvertTo-Json -Compress) -Encoding UTF8

    $env:TAURI_DEV_PORT = [string]$devPort
    $env:TAURI_DEV_HMR_PORT = [string]$hmrPort

    Write-Host "Selected frontend dev port: $devPort (HMR: $hmrPort)" -ForegroundColor DarkCyan

    if ($packageManager -eq "pnpm") {
        Invoke-PackageManager -PackageManager $packageManager -Arguments (@("tauri", "dev", "--config", $tauriConfigOverridePath) + $cleanTauriArgs)
    }
    else {
        Invoke-PackageManager -PackageManager $packageManager -Arguments (@("run", "tauri", "--", "dev", "--config", $tauriConfigOverridePath) + $cleanTauriArgs)
    }
}
finally {
    if ($null -ne $tauriConfigOverridePath -and (Test-Path -LiteralPath $tauriConfigOverridePath)) {
        Remove-Item -LiteralPath $tauriConfigOverridePath -Force -ErrorAction SilentlyContinue
    }
    Pop-Location
}
