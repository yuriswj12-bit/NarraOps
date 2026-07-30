# Pulse narrative discovery V1

## Product boundary

The second Pulse layer is a real-time source-card feed, not an AI explanation,
scoring, risk, or token-analysis surface.

V1 must remain useful without a paid social-data subscription. Its source
priority is:

1. OpenNews's anonymous `free_hot` endpoint for broad event and partial X
   discovery;
2. public RSS/Atom feeds as an independent fallback;
3. optional X access for monitored accounts when a reviewed credential and
   budget are configured.

TikTok is not a V1 source.

Every accepted source item is displayed. The UI does not cap the feed at 12
cards. Desktop uses four independently scrolling category columns and the
client may virtualize off-screen cards.

## Card contract

A card displays source material only:

- original post text;
- original URL;
- original image URLs or video thumbnail when available;
- source platform;
- author display name;
- published time.

It must not contain an AI explanation, score, risk assessment, confidence,
similar-token count, or synthetic media.

Supported categories:

- `politics_satire`
- `events`
- `animals_characters`
- `internet_culture`
- `ai_tech`
- `crypto_native`

## Lifecycle

Only sources published within the previous hour are eligible.

```text
expires_at = min(
  published_at + 60 minutes,
  first_displayed_at + 30 minutes
)
```

The UI offers a 3, 5, or 15 minute refresh interval, defaulting to 5 minutes.
This controls when the client asks for the next processed feed. It must not
cause one external collection run per user.

Each card has a separate replace action. Replacement marks the card dismissed
for that user and returns the next unseen card from the same category. It does
not call an external platform directly.

User states are:

- `unseen`
- `seen`
- `dismissed`
- `used`

`Use` creates a private `narrative_snapshot`, marks the source as used for that
user, replaces the card, and hands the snapshot to Go. Other users may continue
to see the public source.

## Processing boundary

```text
OpenNews free hot / RSS / optional X
  -> collectors
  -> common normalization
  -> exact source deduplication
  -> semantic same-story clustering
  -> eligibility filter
  -> category routing
  -> short-lived candidate pool
  -> per-user filtering
  -> Pulse cards
```

External collection, expiry, refresh, user state, and snapshot creation are
deterministic services. A model may later assist semantic clustering,
eligibility, and category routing, but it may not rewrite source text or invent
source material.

## Official source capability findings

### OpenNews free hot

The public client code exposes:

```text
GET https://ai.6551.io/open/free_hot
```

The endpoint works without a token and returns news plus some original X links,
source names, text, and publication timestamps. NarraOps treats it as an
external provider, filters every result to the one-hour product window, and
does not consume its scores or trading signals.

Provider references:

- https://github.com/6551Team/opennews-mcp
- https://github.com/6551Team/opennews-mcp/blob/main/src/opennews_mcp/api_client.py

Status: implemented as a credential-free V1 source. Availability is monitored;
RSS remains the independent fallback because a third party can change or
withdraw a free endpoint.

### RSS and Atom

Public feeds supply original text, links, publisher identity, publication time,
and attached media when the feed exposes it. Items without a real parseable
publication timestamp are rejected rather than guessed.

Status: implemented as a credential-free V1 fallback.

### Optional X

X Recent Search can retrieve recent public posts and request `created_at`,
author data, and media expansions. It requires a developer project and bearer
token and is billed under X's current pay-per-use API model.

Official references:

- https://docs.x.com/x-api/posts/search-recent-posts
- https://docs.x.com/x-api/posts/search/integrate/overview

OpenTwitter MCP is also an optional 6551-backed client for search and monitored
account events. Its free quota is not required for the credential-free feed and
must be measured before production use.

Provider reference:

- https://github.com/6551Team/opentwitter-mcp

Status: optional enhancement only; V1 remains operational without it.

## Phase 2 implementation

The backend now persists the current honest card pool in:

```text
pulse_narrative_candidates
pulse_narrative_collection_runs
```

The five-minute worker collects the credential-free OpenNews and RSS sources,
applies the existing one-hour source window, routes each item into one of the
six product categories, and removes expired rows. Provider failures are
recorded per run and do not create replacement content.

The frontend contract is:

```text
GET /api/v1/pulse/narratives
```

It returns category columns containing only:

- original text;
- original source URL;
- original media or video thumbnail when available;
- platform and source type;
- author or publisher;
- publication and expiry timestamps.

It does not return AI explanations, opportunity scores, risk scores, token
recommendations, provider trading signals, or fabricated empty-state cards.

Hosted activation requires migration `018_pulse_narrative_pool.sql` and the
existing Supabase server credentials in GitHub Actions. Until the migration is
available, the API returns `data_status = persistence_not_ready` with empty
columns rather than substituting data.

## Phase 2 acceptance

- short-lived candidates and collection runs are persisted privately;
- the collector is scheduled every five minutes and supports manual runs;
- exact source rows are upserted idempotently and expired rows are removed;
- deterministic category routing covers all six V1 columns;
- the read API filters expired rows again at request time;
- empty and not-ready states remain honest;
- no synthetic cards or synthetic history are created.

## Phase 1 acceptance

- deterministic source and card contracts exist;
- one-hour and thirty-minute lifecycle rules are tested;
- exact deduplication is tested;
- monitored-source registry validation exists;
- OpenNews free-hot normalization is tested;
- RSS/Atom normalization and honest timestamp rejection are tested;
- X probe fails safely when no credential is configured;
- TikTok is absent from the V1 source contract;
- no production API, database, or frontend behavior changes in this phase.
