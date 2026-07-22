param(
    [ValidateSet('sol', 'bsc', 'base', 'eth')]
    [string]$Chain = 'sol',

    [ValidateSet('1m', '5m', '1h', '6h', '24h')]
    [string]$Interval = '24h',

    [ValidateRange(1, 100)]
    [int]$LimitPerCohort = 100,

    [string]$OutputDirectory = 'research/pulse-historical/raw'
)

$ErrorActionPreference = 'Stop'

if (-not (Get-Command gmgn-cli -ErrorAction SilentlyContinue)) {
    throw 'gmgn-cli is not installed or is not available on PATH.'
}

if (-not $env:HTTPS_PROXY) {
    $internetSettings = Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings' -ErrorAction SilentlyContinue
    if ($internetSettings.ProxyEnable -eq 1 -and $internetSettings.ProxyServer) {
        $proxyUri = if ($internetSettings.ProxyServer -match '^https?://') {
            $internetSettings.ProxyServer
        }
        else {
            "http://$($internetSettings.ProxyServer)"
        }

        $env:HTTP_PROXY = $proxyUri
        $env:HTTPS_PROXY = $proxyUri
        $env:ALL_PROXY = $proxyUri
    }
}

$env:NODE_USE_ENV_PROXY = '1'

$repositoryRoot = Split-Path -Parent $PSScriptRoot
$resolvedOutputDirectory = Join-Path $repositoryRoot $OutputDirectory
New-Item -ItemType Directory -Force -Path $resolvedOutputDirectory | Out-Null

$cohorts = @(
    @{ Name = 'L0_under_100k'; Min = $null; Max = 100000 },
    @{ Name = 'L1_100k_to_1m'; Min = 100000; Max = 1000000 },
    @{ Name = 'L2_1m_to_10m'; Min = 1000000; Max = 10000000 },
    @{ Name = 'L3_10m_to_100m'; Min = 10000000; Max = 100000000 },
    @{ Name = 'L4_over_100m'; Min = 100000000; Max = $null }
)

$manifest = @()

foreach ($cohort in $cohorts) {
    $arguments = @(
        'market', 'trending',
        '--chain', $Chain,
        '--interval', $Interval,
        '--order-by', 'history_highest_market_cap',
        '--direction', 'desc',
        '--filter', 'has_social',
        '--limit', $LimitPerCohort,
        '--raw'
    )

    if ($null -ne $cohort.Min) {
        $arguments += @('--min-history-highest-marketcap', $cohort.Min)
    }

    if ($null -ne $cohort.Max) {
        $arguments += @('--max-history-highest-marketcap', $cohort.Max)
    }

    $collectedAt = [DateTimeOffset]::UtcNow
    $outputPath = Join-Path $resolvedOutputDirectory ("{0}_{1}_{2}.json" -f $Chain, $Interval, $cohort.Name)
    $temporaryPath = "$outputPath.tmp"

    try {
        $raw = $null
        $lastFailure = $null

        for ($attempt = 1; $attempt -le 5; $attempt++) {
            $raw = & gmgn-cli @arguments 2>&1
            if ($LASTEXITCODE -eq 0) {
                $lastFailure = $null
                break
            }

            $lastFailure = $raw -join [Environment]::NewLine
            if ($attempt -lt 5) {
                Start-Sleep -Seconds ([Math]::Min($attempt * 2, 8))
            }
        }

        if ($lastFailure) {
            throw $lastFailure
        }

        $jsonText = $raw -join [Environment]::NewLine
        $null = $jsonText | ConvertFrom-Json
        Set-Content -LiteralPath $temporaryPath -Value $jsonText -Encoding UTF8
        Move-Item -LiteralPath $temporaryPath -Destination $outputPath -Force

        $manifest += [pscustomobject]@{
            cohort = $cohort.Name
            min_ath_market_cap = $cohort.Min
            max_ath_market_cap = $cohort.Max
            collected_at = $collectedAt.ToString('o')
            status = 'completed'
            file = (Join-Path $OutputDirectory (Split-Path -Leaf $outputPath))
            error = $null
        }
    }
    catch {
        if (Test-Path -LiteralPath $temporaryPath) {
            Remove-Item -LiteralPath $temporaryPath -Force
        }

        $manifest += [pscustomobject]@{
            cohort = $cohort.Name
            min_ath_market_cap = $cohort.Min
            max_ath_market_cap = $cohort.Max
            collected_at = $collectedAt.ToString('o')
            status = 'failed'
            file = $null
            error = $_.Exception.Message
        }
    }
}

$manifestPath = Join-Path $resolvedOutputDirectory ("{0}_{1}_manifest.json" -f $Chain, $Interval)
$manifest | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $manifestPath -Encoding UTF8

$failed = @($manifest | Where-Object status -eq 'failed')
$manifest | Format-Table cohort, status, file -AutoSize

if ($failed.Count -gt 0) {
    Write-Error ("{0} cohort(s) failed. See {1}." -f $failed.Count, $manifestPath)
}
