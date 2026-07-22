# Pulse Historical Meme Research

This directory contains reproducible inputs and human annotations for the Pulse historical narrative study.

## Directory layout

```text
raw/                 GMGN cohort responses and collection manifests
annotations/         Human-verified narrative annotations
reports/             Generated cohort comparisons
```

Raw API responses may change over time. Every collection manifest records the collection time and failure reason. Do not manually edit successful raw response files.

## Collection

From the repository root:

```powershell
.\scripts\collect-pulse-historical-samples.ps1 -Chain sol -LimitPerCohort 100
```

The collector requests five ATH market-cap cohorts defined in `coordination/PULSE_HISTORICAL_RESEARCH_SPEC_CN.md`.

## Human verification rules

1. Open the Token's bound X/social link.
2. Classify the link as `origin_post`, `subject_account`, `post_launch_project`, `cto`, or `unverified`.
3. Do not infer the original story from Token name or current marketing copy alone.
4. Record an origin only when the source is supported by a direct link or independent evidence.
5. Keep unknown values empty and explain uncertainty in `uncertainties`.
6. Pre-launch features must use information observable before `token_created_at`.
7. Current engagement counts must not be copied into pre-launch fields without a timestamped historical source.
8. One reviewer completes the row; a second reviewer sets `review_status=verified` or records the disagreement.

The following fields use an integer `0-5` scale, where `0` means absent/unsupported and `5` means exceptionally strong: `source_confidence`, `visual_symbol_strength`, `one_sentence_clarity`, `remixability`, `cross_language_readability`, `pre_launch_velocity`, `relative_creator_baseline`, and `comment_meme_creation`.

## Minimum evidence for a verified narrative

- Token address and ATH cohort are known.
- Social link type is classified.
- The story can be described in one sentence without unsupported claims.
- Origin URL and publication time are known, or their absence is explicitly recorded.
- The reviewer separates organic source content from post-launch project promotion.

## Report generation

After validation:

```powershell
.\scripts\build-pulse-cohort-report.ps1
```

The generated report is descriptive. It does not claim that cohort differences are causal or promise a future market-cap outcome.
