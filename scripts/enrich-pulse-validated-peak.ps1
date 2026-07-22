param(
    [ValidateSet('sol', 'bsc', 'base', 'eth')]
    [string]$Chain = 'sol',

    [string[]]$Cohorts = @('L4'),

    [string[]]$TokenAddresses = @(),

    [ValidateSet('1h', '4h', '1d')]
    [string]$Resolution = '1h',

    [ValidateRange(1, 500)]
    [int]$MaxTokens = 100,

    [ValidateRange(1, 200)]
    [int]$MaxPagesPerToken = 100,

    [ValidateRange(0, 1000000000)]
    [decimal]$MinimumWindowVolumeUsd = 10000,

    [bool]$Resume = $true,

    [string]$InputCsv = 'research/pulse-historical/sample-index.csv',

    [string]$OutputCsv = 'research/pulse-historical/validated-peaks.csv',

    [string]$KlineDirectory = 'research/pulse-historical/kline'
)

$ErrorActionPreference = 'Stop'

if (-not (Get-Command gmgn-cli -ErrorAction SilentlyContinue)) {
    throw 'gmgn-cli is not installed or is not available on PATH.'
}

function Enable-GmgnProxy {
    if (-not $env:HTTPS_PROXY) {
        $settings = Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings' -ErrorAction SilentlyContinue
        if ($settings.ProxyEnable -eq 1 -and $settings.ProxyServer) {
            $proxyUri = if ($settings.ProxyServer -match '^https?://') {
                $settings.ProxyServer
            }
            else {
                "http://$($settings.ProxyServer)"
            }

            $env:HTTP_PROXY = $proxyUri
            $env:HTTPS_PROXY = $proxyUri
            $env:ALL_PROXY = $proxyUri
        }
    }

    $env:NODE_USE_ENV_PROXY = '1'
}

function Invoke-GmgnJson {
    param(
        [Parameter(Mandatory = $true)]
        [string[]]$Arguments,

        [ValidateRange(1, 12)]
        [int]$Attempts = 8
    )

    $lastFailure = $null
    for ($attempt = 1; $attempt -le $Attempts; $attempt++) {
        $raw = & gmgn-cli @Arguments 2>&1
        if ($LASTEXITCODE -eq 0) {
            return (($raw -join [Environment]::NewLine) | ConvertFrom-Json)
        }

        $lastFailure = $raw -join [Environment]::NewLine
        if ($lastFailure -match 'RATE_LIMIT_(EXCEEDED|BANNED)') {
            throw $lastFailure
        }

        if ($attempt -lt $Attempts) {
            Start-Sleep -Seconds ([Math]::Min($attempt * 3, 20))
        }
    }

    throw $lastFailure
}

function Convert-ToDecimal {
    param($Value)

    if ($null -eq $Value -or [string]::IsNullOrWhiteSpace([string]$Value)) {
        return [decimal]0
    }

    return [decimal]::Parse([string]$Value, [Globalization.CultureInfo]::InvariantCulture)
}

function Get-Cohort {
    param([decimal]$MarketCap)

    if ($MarketCap -lt 100000) { return 'L0' }
    if ($MarketCap -lt 1000000) { return 'L1' }
    if ($MarketCap -lt 10000000) { return 'L2' }
    if ($MarketCap -lt 100000000) { return 'L3' }
    return 'L4'
}

function Get-SustainedPeak {
    param(
        [object[]]$Candles,
        [decimal]$Supply,
        [decimal]$MinimumVolume
    )

    $best = $null
    for ($i = 1; $i -lt ($Candles.Count - 1); $i++) {
        $window = @($Candles[$i - 1], $Candles[$i], $Candles[$i + 1])
        $closes = @($window | ForEach-Object { Convert-ToDecimal $_.close } | Sort-Object)
        $volume = ($window | ForEach-Object { Convert-ToDecimal $_.volume } | Measure-Object -Sum).Sum
        if ($volume -lt $MinimumVolume) {
            continue
        }

        $marketCap = $closes[1] * $Supply
        if ($null -eq $best -or $marketCap -gt $best.MarketCap) {
            $best = [pscustomobject]@{
                MarketCap = $marketCap
                Timestamp = [int64]([decimal]$Candles[$i].time / 1000)
                Volume = [decimal]$volume
                Method = 'three_candle_median_with_volume'
            }
        }
    }

    if ($null -ne $best) {
        return $best
    }

    $fallback = $Candles |
        ForEach-Object {
            [pscustomobject]@{
                MarketCap = (Convert-ToDecimal $_.close) * $Supply
                Timestamp = [int64]([decimal]$_.time / 1000)
                Volume = Convert-ToDecimal $_.volume
                Method = 'single_close_fallback_low_confidence'
            }
        } |
        Sort-Object MarketCap -Descending |
        Select-Object -First 1

    return $fallback
}

Enable-GmgnProxy

$repositoryRoot = Split-Path -Parent $PSScriptRoot
$inputPath = Join-Path $repositoryRoot $InputCsv
$outputPath = Join-Path $repositoryRoot $OutputCsv
$klinePath = Join-Path $repositoryRoot $KlineDirectory
New-Item -ItemType Directory -Force -Path $klinePath | Out-Null
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $outputPath) | Out-Null

$allRows = @(Import-Csv -LiteralPath $inputPath |
    Where-Object {
        ($Cohorts -contains $_.ath_cohort) -and
        ($TokenAddresses.Count -eq 0 -or $TokenAddresses -contains $_.token_address)
    } |
    Select-Object -First $MaxTokens)

$existingCompleted = @()
if ($Resume -and (Test-Path -LiteralPath $outputPath)) {
    $existingCompleted = @(Import-Csv -LiteralPath $outputPath | Where-Object status -eq 'completed')
    foreach ($completed in $existingCompleted) {
        if (-not $completed.PSObject.Properties['resolution']) {
            $completed | Add-Member -NotePropertyName resolution -NotePropertyValue $Resolution
        }
    }
}

$completedIds = @{}
foreach ($completed in $existingCompleted) {
    $completedIds[$completed.sample_id] = $true
}

$rows = @($allRows | Where-Object { -not $completedIds.ContainsKey($_.sample_id) })
$results = @($existingCompleted)
$tokenNumber = 0

foreach ($row in $rows) {
    $tokenNumber++
    Write-Host ("[{0}/{1}] {2} ({3})" -f $tokenNumber, $rows.Count, $row.symbol, $row.token_address)

    try {
        $info = Invoke-GmgnJson -Arguments @(
            'token', 'info', '--chain', $Chain, '--address', $row.token_address, '--raw'
        )

        $supply = Convert-ToDecimal $info.circulating_supply
        if ($supply -le 0) {
            throw 'Token info did not return a positive circulating_supply.'
        }

        $creationTimestamp = [int64]$info.creation_timestamp
        if ($creationTimestamp -le 0) {
            $creationTimestamp = [DateTimeOffset]::Parse($row.token_created_at).ToUnixTimeSeconds()
        }

        $klineFile = Join-Path $klinePath ("{0}_{1}.json" -f $Chain, $row.token_address)
        $allCandles = @()
        $pageCount = 0
        $cached = $null
        if ($Resume -and (Test-Path -LiteralPath $klineFile)) {
            $cached = Get-Content -LiteralPath $klineFile -Raw | ConvertFrom-Json
        }

        if ($null -ne $cached -and $cached.resolution -eq $Resolution -and @($cached.candles).Count -gt 0) {
            $allCandles = @($cached.candles)
        }
        else {
            $cursorTo = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
            while ($pageCount -lt $MaxPagesPerToken -and $cursorTo -gt $creationTimestamp) {
                $pageCount++
                $page = Invoke-GmgnJson -Arguments @(
                    'market', 'kline',
                    '--chain', $Chain,
                    '--address', $row.token_address,
                    '--resolution', $Resolution,
                    '--from', $creationTimestamp,
                    '--to', $cursorTo,
                    '--raw'
                )

                $candles = @($page.list)
                if ($candles.Count -eq 0) {
                    break
                }

                $allCandles += $candles
                $earliestSeconds = [int64](($candles | Measure-Object -Property time -Minimum).Minimum / 1000)
                if ($earliestSeconds -le $creationTimestamp -or $earliestSeconds -ge $cursorTo) {
                    break
                }

                $cursorTo = $earliestSeconds - 1
                Start-Sleep -Seconds 1
            }
        }

        $dedupedCandles = @($allCandles |
            Group-Object time |
            ForEach-Object { $_.Group[0] } |
            Sort-Object { [int64]$_.time })

        if ($dedupedCandles.Count -eq 0) {
            throw 'No K-line candles returned.'
        }

        [pscustomobject]@{
            chain = $Chain
            token_address = $row.token_address
            resolution = $Resolution
            collected_at = [DateTimeOffset]::UtcNow.ToString('o')
            candles = $dedupedCandles
        } | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $klineFile -Encoding UTF8

        $peakClose = $dedupedCandles |
            ForEach-Object {
                [pscustomobject]@{
                    MarketCap = (Convert-ToDecimal $_.close) * $supply
                    Timestamp = [int64]([decimal]$_.time / 1000)
                }
            } |
            Sort-Object MarketCap -Descending |
            Select-Object -First 1

        $sustained = Get-SustainedPeak -Candles $dedupedCandles -Supply $supply -MinimumVolume $MinimumWindowVolumeUsd
        $rawAth = Convert-ToDecimal $row.ath_market_cap
        $ratio = if ($sustained.MarketCap -gt 0) { $rawAth / $sustained.MarketCap } else { [decimal]0 }
        $quality = if ($sustained.Method -like '*fallback*') {
            'low_confidence_no_qualified_window'
        }
        elseif ($ratio -le 2) {
            'consistent'
        }
        elseif ($ratio -le 10) {
            'suspicious'
        }
        else {
            'invalid_spike_likely'
        }

        $results += [pscustomobject]@{
            sample_id = $row.sample_id
            chain = $Chain
            token_address = $row.token_address
            name = $row.name
            symbol = $row.symbol
            raw_ath_market_cap = [string]$rawAth
            raw_ath_cohort = $row.ath_cohort
            circulating_supply = [string]$supply
            candle_count = $dedupedCandles.Count
            page_count = $pageCount
            peak_close_market_cap = [string][decimal]$peakClose.MarketCap
            peak_close_at = [DateTimeOffset]::FromUnixTimeSeconds($peakClose.Timestamp).ToString('o')
            validated_peak_market_cap = [string][decimal]$sustained.MarketCap
            validated_peak_at = [DateTimeOffset]::FromUnixTimeSeconds($sustained.Timestamp).ToString('o')
            validated_peak_cohort = Get-Cohort $sustained.MarketCap
            validation_method = $sustained.Method
            resolution = $Resolution
            validation_window_volume_usd = [string][decimal]$sustained.Volume
            raw_to_validated_ratio = [string][decimal]$ratio
            ath_quality = $quality
            status = 'completed'
            error = ''
        }
    }
    catch {
        $results += [pscustomobject]@{
            sample_id = $row.sample_id
            chain = $Chain
            token_address = $row.token_address
            name = $row.name
            symbol = $row.symbol
            raw_ath_market_cap = $row.ath_market_cap
            raw_ath_cohort = $row.ath_cohort
            circulating_supply = ''
            candle_count = 0
            page_count = 0
            peak_close_market_cap = ''
            peak_close_at = ''
            validated_peak_market_cap = ''
            validated_peak_at = ''
            validated_peak_cohort = ''
            validation_method = ''
            resolution = $Resolution
            validation_window_volume_usd = ''
            raw_to_validated_ratio = ''
            ath_quality = 'failed'
            status = 'failed'
            error = $_.Exception.Message
        }
    }

    $results | Export-Csv -LiteralPath $outputPath -NoTypeInformation -Encoding UTF8
}

$results | Format-Table symbol, raw_ath_cohort, validated_peak_cohort, ath_quality, status -AutoSize

$failed = @($results | Where-Object status -eq 'failed')
if ($failed.Count -gt 0) {
    Write-Error ("{0} token(s) failed. See {1}." -f $failed.Count, $outputPath)
}
