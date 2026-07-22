param(
    [string]$Path = 'research/pulse-historical/annotations/annotations.csv'
)

$ErrorActionPreference = 'Stop'

$repositoryRoot = Split-Path -Parent $PSScriptRoot
$resolvedPath = if ([IO.Path]::IsPathRooted($Path)) { $Path } else { Join-Path $repositoryRoot $Path }

if (-not (Test-Path -LiteralPath $resolvedPath)) {
    throw "Annotation file not found: $resolvedPath"
}

$requiredColumns = @(
    'sample_id',
    'chain',
    'token_address',
    'token_created_at',
    'ath_market_cap',
    'ath_cohort',
    'social_link_type',
    'one_sentence_story',
    'source_confidence',
    'uncertainties',
    'review_status'
)

$allowedCohorts = @('L0', 'L1', 'L2', 'L3', 'L4')
$allowedLinkTypes = @('origin_post', 'subject_account', 'post_launch_project', 'cto', 'unverified')
$allowedReviewStatuses = @('draft', 'needs_review', 'verified', 'disputed', 'excluded')
$zeroToFiveFields = @(
    'source_confidence',
    'visual_symbol_strength',
    'one_sentence_clarity',
    'remixability',
    'cross_language_readability',
    'pre_launch_velocity',
    'relative_creator_baseline',
    'comment_meme_creation'
)

$rows = @(Import-Csv -LiteralPath $resolvedPath)
if ($rows.Count -eq 0) {
    throw 'Annotation file contains no data rows.'
}

$columns = @($rows[0].PSObject.Properties.Name)
$missingColumns = @($requiredColumns | Where-Object { $_ -notin $columns })
if ($missingColumns.Count -gt 0) {
    throw "Missing required columns: $($missingColumns -join ', ')"
}

$errors = [System.Collections.Generic.List[string]]::new()
$seenSampleIds = @{}

for ($index = 0; $index -lt $rows.Count; $index++) {
    $rowNumber = $index + 2
    $row = $rows[$index]

    if ([string]::IsNullOrWhiteSpace($row.sample_id)) {
        $errors.Add("Row ${rowNumber}: sample_id is required.")
    }
    elseif ($seenSampleIds.ContainsKey($row.sample_id)) {
        $errors.Add("Row ${rowNumber}: duplicate sample_id '$($row.sample_id)'.")
    }
    else {
        $seenSampleIds[$row.sample_id] = $true
    }

    if ($row.ath_cohort -notin $allowedCohorts) {
        $errors.Add("Row ${rowNumber}: invalid ath_cohort '$($row.ath_cohort)'.")
    }

    if ($row.social_link_type -notin $allowedLinkTypes) {
        $errors.Add("Row ${rowNumber}: invalid social_link_type '$($row.social_link_type)'.")
    }

    if ($row.review_status -notin $allowedReviewStatuses) {
        $errors.Add("Row ${rowNumber}: invalid review_status '$($row.review_status)'.")
    }

    $athMarketCap = 0.0
    if (-not [double]::TryParse($row.ath_market_cap, [Globalization.NumberStyles]::Float, [Globalization.CultureInfo]::InvariantCulture, [ref]$athMarketCap) -or $athMarketCap -lt 0) {
        $errors.Add("Row ${rowNumber}: ath_market_cap must be a non-negative number.")
    }

    $tokenCreatedAt = [DateTimeOffset]::MinValue
    if (-not [DateTimeOffset]::TryParse($row.token_created_at, [ref]$tokenCreatedAt)) {
        $errors.Add("Row ${rowNumber}: token_created_at must be an ISO-8601 timestamp.")
    }

    if ($row.social_link_type -eq 'origin_post' -and [string]::IsNullOrWhiteSpace($row.origin_url)) {
        $errors.Add("Row ${rowNumber}: origin_post requires origin_url.")
    }

    if ($row.review_status -eq 'verified' -and [string]::IsNullOrWhiteSpace($row.one_sentence_story)) {
        $errors.Add("Row ${rowNumber}: verified samples require one_sentence_story.")
    }

    foreach ($field in $zeroToFiveFields) {
        $value = $row.$field
        if (-not [string]::IsNullOrWhiteSpace($value)) {
            $score = 0
            if (-not [int]::TryParse($value, [ref]$score) -or $score -lt 0 -or $score -gt 5) {
                $errors.Add("Row ${rowNumber}: $field must be an integer from 0 to 5.")
            }
        }
    }
}

if ($errors.Count -gt 0) {
    $errors | ForEach-Object { Write-Error $_ }
    exit 1
}

Write-Output "Validated $($rows.Count) annotation row(s): $resolvedPath"
