param(
    [string]$RawDirectory = 'research/pulse-historical/raw',
    [string]$OutputPath = 'research/pulse-historical/sample-index.csv'
)

$ErrorActionPreference = 'Stop'

$repositoryRoot = Split-Path -Parent $PSScriptRoot
$resolvedRawDirectory = if ([IO.Path]::IsPathRooted($RawDirectory)) { $RawDirectory } else { Join-Path $repositoryRoot $RawDirectory }
$resolvedOutputPath = if ([IO.Path]::IsPathRooted($OutputPath)) { $OutputPath } else { Join-Path $repositoryRoot $OutputPath }

function Get-AthCohort {
    param([double]$AthMarketCap)

    if ($AthMarketCap -lt 100000) { return 'L0' }
    if ($AthMarketCap -lt 1000000) { return 'L1' }
    if ($AthMarketCap -lt 10000000) { return 'L2' }
    if ($AthMarketCap -lt 100000000) { return 'L3' }
    return 'L4'
}

$files = @(Get-ChildItem -LiteralPath $resolvedRawDirectory -File | Where-Object {
    $_.Name -match '^sol_(1m|5m|1h|6h|24h)_L.+\.json$'
})

if ($files.Count -eq 0) {
    throw "No interval-specific cohort files found in $resolvedRawDirectory"
}

$observations = [System.Collections.Generic.List[object]]::new()

foreach ($file in $files) {
    $match = [regex]::Match($file.Name, '^sol_(1m|5m|1h|6h|24h)_')
    $interval = $match.Groups[1].Value
    $response = Get-Content -Raw -LiteralPath $file.FullName | ConvertFrom-Json

    foreach ($token in @($response.data.rank)) {
        $observations.Add([pscustomobject]@{
            interval = $interval
            token = $token
        })
    }
}

$rows = foreach ($group in ($observations | Group-Object { $_.token.address })) {
    $preferred = @($group.Group | Sort-Object {
        switch ($_.interval) {
            '24h' { 5 }
            '6h' { 4 }
            '1h' { 3 }
            '5m' { 2 }
            '1m' { 1 }
            default { 0 }
        }
    } -Descending)[0]

    $token = $preferred.token
    $ath = [double]$token.history_highest_market_cap
    $intervals = @($group.Group.interval | Sort-Object -Unique)

    [pscustomobject]@{
        sample_id = "sol:$($token.address)"
        chain = 'sol'
        token_address = $token.address
        name = $token.name
        symbol = $token.symbol
        launchpad = $token.launchpad_platform
        token_created_at = if ($token.creation_timestamp) { [DateTimeOffset]::FromUnixTimeSeconds([long]$token.creation_timestamp).ToString('o') } else { '' }
        ath_market_cap = $ath
        ath_cohort = Get-AthCohort $ath
        current_market_cap = $token.market_cap
        liquidity = $token.liquidity
        holder_count = $token.holder_count
        twitter_url = $token.twitter_username
        website = $token.website
        telegram = $token.telegram
        cto_flag = $token.cto_flag
        smart_degen_count = $token.smart_degen_count
        renowned_count = $token.renowned_count
        rug_ratio = $token.rug_ratio
        bundler_rate = $token.bundler_rate
        observation_count = $group.Count
        observed_intervals = $intervals -join '|'
        social_link_type = ''
        narrative_id = ''
        review_status = 'draft'
    }
}

$outputDirectory = Split-Path -Parent $resolvedOutputPath
New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null
$rows | Sort-Object ath_market_cap -Descending | Export-Csv -LiteralPath $resolvedOutputPath -NoTypeInformation -Encoding UTF8

$cohortSummary = $rows | Group-Object ath_cohort | Sort-Object Name | ForEach-Object {
    [pscustomobject]@{ Cohort = $_.Name; Samples = $_.Count }
}

$cohortSummary | Format-Table -AutoSize
Write-Output "Sample index written: $resolvedOutputPath ($($rows.Count) unique tokens)"
