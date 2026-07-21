# Pulse product contract

Pulse is the narrative discovery layer of NarraOps.

Its job is to reduce the cost for Meme Devs to discover, filter, and evaluate internet narratives before those narratives become launch opportunities.

## Product responsibility

Pulse should answer four questions:

1. What narrative is emerging?
2. Where did the evidence come from?
3. Why could this narrative become memeable?
4. What is missing, risky, or unverified?

Pulse is not a trading terminal, launchpad, or profitability oracle.

## Page structure

### 1. Market activity overview

The top section should show the current meme-market environment. It should help users understand where attention and launch activity are moving.

Possible fields:

- chain activity level
- launch count trend
- active launchpads
- recent meme clusters
- high-velocity themes
- source freshness
- data status

This layer gives context. It should not replace narrative-level review.

### 2. Narrative opportunity cards

Each card represents one narrative candidate, not one token by default.

Required card fields:

- narrative title
- short summary
- source platforms
- original evidence links
- first seen time
- latest seen time
- evidence count
- publisher or account list when available
- status: `reject`, `watch`, `review`, or `high_priority`
- risk flags
- missing evidence
- action: `Send to Go`

Avoid a single aggregate profitability score.

### 3. Narrative detail

The detail view should explain the story before showing raw metrics.

Recommended order:

1. What this narrative is.
2. Why it could become memeable.
3. Origin and source evidence.
4. Cross-platform spread.
5. Similar or already-issued tokens when available.
6. Risk and missing evidence.
7. Agent reasoning notes.
8. `Send to Go` action.

## Evidence rules

Pulse must preserve source honesty.

- Static public webpages may be fetched when SSRF, redirect, size, and content-type protections pass.
- X, TikTok, Instagram, and other dynamic platforms must not be marked as successfully fetched unless a reviewed official API or controlled browser adapter is implemented.
- A social link can be displayed as source evidence even when full content extraction is deferred.
- Current public evidence must not be used as pre-launch proof if the evidence clearly appeared after launch.
- Missing evidence should be shown explicitly.

## Narrative gates

Pulse should evaluate candidates through staged gates:

1. Evidence eligibility.
2. Narrative clarity.
3. Memeability.
4. Amplification or spread.
5. Risk and missing-evidence review.

The output state should remain explainable:

- `reject`: insufficient evidence or weak narrative.
- `watch`: early signal, needs more evidence.
- `review`: plausible narrative requiring user review.
- `high_priority`: strong evidence and clear narrative momentum, still not a success guarantee.

## Bitget Wallet reference

Bitget Wallet token detail pages are useful as an information-structure reference. They show how an existing meme token can be explained through:

- token identity
- narrative origin
- key person, event, or internet culture
- social-source links
- project context

NarraOps should extend this pattern upstream.

Bitget Wallet usually explains a token after it exists. Pulse should find and explain narratives before or around the time they become launch candidates.

Do not copy Bitget Wallet's trading UI, colors, or buy/sell flow. Use it only as a reference for narrative explanation and source-backed context.

## UI tone

Pulse should feel like a research terminal, not a hype feed.

Use language such as:

- public evidence
- narrative signal
- source coverage
- missing evidence
- review required
- market activity

Avoid language such as:

- guaranteed
- 100x
- buy now
- profit probability
- sure launch

## V1 implementation target

A useful V1 can start with:

- bounded RSS/Atom source ingestion
- source-preserving evidence cards
- conservative clustering
- `reject/watch/review/high_priority` states
- a Pulse UI that shows evidence before action
- `Send to Go` handoff

The first version should prefer trust, traceability, and rejection discipline over aggressive opportunity volume.
