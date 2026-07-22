param(
    [string]$InputPath = 'research/pulse-historical/annotations/annotations.csv',
    [string]$OutputPath = 'research/pulse-historical/reports/cohort-comparison.md'
)

$ErrorActionPreference = 'Stop'

$repositoryRoot = Split-Path -Parent $PSScriptRoot
$resolvedInputPath = if ([IO.Path]::IsPathRooted($InputPath)) { $InputPath } else { Join-Path $repositoryRoot $InputPath }
$resolvedOutputPath = if ([IO.Path]::IsPathRooted($OutputPath)) { $OutputPath } else { Join-Path $repositoryRoot $OutputPath }

& (Join-Path $PSScriptRoot 'validate-pulse-annotations.ps1') -Path $resolvedInputPath
if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}

$rows = @(Import-Csv -LiteralPath $resolvedInputPath | Where-Object review_status -eq 'verified')
if ($rows.Count -eq 0) {
    throw 'No verified annotation rows are available for reporting.'
}

$scoreFields = @(
    'source_confidence',
    'visual_symbol_strength',
    'one_sentence_clarity',
    'remixability',
    'cross_language_readability',
    'pre_launch_velocity',
    'relative_creator_baseline',
    'comment_meme_creation'
)

function Get-AverageScore {
    param([object[]]$Items, [string]$Field)

    $values = @($Items | ForEach-Object {
        $value = $_.$Field
        if (-not [string]::IsNullOrWhiteSpace($value)) { [double]$value }
    })

    if ($values.Count -eq 0) { return '-' }
    return ('{0:N2}' -f (($values | Measure-Object -Average).Average))
}

function Get-TopValues {
    param([object[]]$Items, [string]$Field, [int]$Limit = 3)

    $values = @($Items | ForEach-Object {
        $_.$Field -split '[|;]' | ForEach-Object { $_.Trim() } | Where-Object { $_ }
    } | Group-Object | Sort-Object @{ Expression = 'Count'; Descending = $true }, @{ Expression = 'Name'; Ascending = $true } | Select-Object -First $Limit)

    if ($values.Count -eq 0) { return '-' }
    return (($values | ForEach-Object { "$($_.Name) ($($_.Count))" }) -join ', ')
}

$lines = [System.Collections.Generic.List[string]]::new()
$lines.Add('# Pulse ATH Cohort Narrative Comparison')
$lines.Add('')
$lines.Add("Generated: $([DateTimeOffset]::UtcNow.ToString('o'))")
$lines.Add('')
$lines.Add('This is a descriptive comparison of verified historical samples. It does not establish causality or predict a guaranteed market-cap outcome.')
$lines.Add('')
$lines.Add('## Coverage')
$lines.Add('')
$lines.Add('| Cohort | Verified samples | Origin posts | Unverified links |')
$lines.Add('|---|---:|---:|---:|')

foreach ($cohort in @('L0', 'L1', 'L2', 'L3', 'L4')) {
    $cohortRows = @($rows | Where-Object ath_cohort -eq $cohort)
    $originPosts = @($cohortRows | Where-Object social_link_type -eq 'origin_post').Count
    $unverified = @($cohortRows | Where-Object social_link_type -eq 'unverified').Count
    $lines.Add("| $cohort | $($cohortRows.Count) | $originPosts | $unverified |")
}

$lines.Add('')
$lines.Add('## Average pre-launch narrative features')
$lines.Add('')
$lines.Add('| Cohort | Source confidence | Visual symbol | One-sentence clarity | Remixability | Cross-language | Velocity | Relative baseline | Comment creation |')
$lines.Add('|---|---:|---:|---:|---:|---:|---:|---:|---:|')

foreach ($cohort in @('L0', 'L1', 'L2', 'L3', 'L4')) {
    $cohortRows = @($rows | Where-Object ath_cohort -eq $cohort)
    $averages = @($scoreFields | ForEach-Object { Get-AverageScore -Items $cohortRows -Field $_ })
    $lines.Add("| $cohort | $($averages -join ' | ') |")
}

$lines.Add('')
$lines.Add('## Frequent narrative categories')
$lines.Add('')

foreach ($cohort in @('L0', 'L1', 'L2', 'L3', 'L4')) {
    $cohortRows = @($rows | Where-Object ath_cohort -eq $cohort)
    $lines.Add("### $cohort")
    $lines.Add('')
    $lines.Add("- Subject types: $(Get-TopValues -Items $cohortRows -Field 'subject_type')")
    $lines.Add("- Emotion types: $(Get-TopValues -Items $cohortRows -Field 'emotion_type')")
    $lines.Add("- Risk tags: $(Get-TopValues -Items $cohortRows -Field 'risk_tags')")
    $lines.Add('')
}

$outputDirectory = Split-Path -Parent $resolvedOutputPath
New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null
$lines | Set-Content -LiteralPath $resolvedOutputPath -Encoding UTF8
Write-Output "Report written: $resolvedOutputPath"
