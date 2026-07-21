# Go Agent product contract

Go is the Agent workspace of NarraOps.

Its job is to turn selected narratives, links, text, or images into structured plans that a user can review and edit.

Go should feel like a command center, not a generic chatbot.

## Product responsibility

Go should handle:

- user input through text, link, image, or slash command
- narrative interpretation for a specific user-provided item
- launch-ready plan generation
- field-level edits
- plan status display
- handoff to review-only or disabled execution adapters

Go should not perform broad internet discovery. That belongs to Pulse.

## Primary flow

```text
User sends a link, image, or text
-> Go extracts or requests required information
-> Go creates a structured launch-ready plan
-> user edits fields
-> user confirms
-> backend adapter receives intent and policy context
-> execution remains disabled/review-only until safety gates are satisfied
```

## Launch-ready plan fields

The plan card should be structured and deterministic. Do not let the model invent arbitrary top-level fields.

Core fields:

- token name
- symbol / ticker
- Twitter / X link
- third-party link
- logo image
- chain
- launch platform
- cooking wallet
- bundle wallets / T1-T5 when enabled by the product configuration
- risk warnings
- missing fields
- evidence summary
- execution status

Optional fields may be added only through an explicit product/schema update.

## Editing behavior

A user edit should update the existing plan, not restart the whole Agent flow.

Preferred behavior:

```text
User edits ticker
-> backend updates plan field
-> Go returns the same plan card with updated state
```

The latest backend plan state is the source of truth.

## Tool and adapter boundary

Go may call backend tools. It must not directly query production databases, sign transactions, hold keys, or broadcast transactions.

Allowed pattern:

```text
Go Agent -> backend API/tool -> repository/adapter -> result card
```

Forbidden pattern:

```text
Go Agent -> raw database
Go Agent -> private key
Go Agent -> signer
Go Agent -> direct chain broadcast
```

Launch adapters should remain behind backend contracts.

## Launch page relationship

Launch is not a primary navigation item after the product pivot.

Launch capabilities can remain as:

- backend adapters
- launch draft APIs
- Go plan cards
- review-only execution simulation
- future controlled execution boundary

Do not build a new hand-filled Launch Console as the main product experience unless a later product decision reverses this pivot.

## Safety vocabulary

Use clear execution states:

- `planned`
- `validating`
- `simulated`
- `requires_user_confirmation`
- `signing_disabled`
- `broadcasting_disabled`
- `submitted`
- `confirmed`
- `failed`

`submitted` is not success. `confirmed` requires chain reconciliation and finality rules.

## Prompt and model role

The model should be treated as a reasoning and generation layer.

It may:

- parse intent
- summarize source context
- propose fields
- explain risks
- generate structured card content

It must not:

- bypass user confirmation
- output hidden execution instructions
- fabricate source evidence
- claim profitability
- create or expose private-key material

## V1 target

A useful V1 Go implementation should support:

- link/text/image input
- structured launch-ready plan card
- field edits
- `Send from Pulse to Go`
- adapter handoff with disabled execution state
- event progress through SSE or an equivalent task stream

The card experience is more important than open-ended chat freedom.
