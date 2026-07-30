# Pulse narrative discovery V1

## Product boundary

The second Pulse layer is a real-time source-card feed, not an AI explanation,
scoring, risk, or token-analysis surface.

Sources are limited to X and TikTok. Discovery has two source modes:

1. monitored accounts that repeatedly publish usable stories; and
2. broad trend discovery on the same platforms.

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
cause one external X or TikTok collection run per user.

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
X / TikTok
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

### X

X Recent Search can retrieve recent public posts and request `created_at`,
author data, and media expansions. It requires a developer project and bearer
token and is billed under X's current pay-per-use API model.

Official references:

- https://docs.x.com/x-api/posts/search-recent-posts
- https://docs.x.com/x-api/posts/search/integrate/overview

Status: technically suitable; production access and budget are not configured.

### TikTok

TikTok Display API lists public videos for a user who authorized the app. It
does not provide broad trend discovery.

TikTok Research API can query public videos, but access is restricted to
approved research projects and TikTok states that new videos can take up to 48
hours to enter its search engine.

Official references:

- https://developers.tiktok.com/doc/display-api-overview/
- https://developers.tiktok.com/doc/research-api-faq

Status: official APIs do not currently satisfy NarraOps's one-hour discovery
requirement. A compliant near-real-time provider or reviewed controlled-browser
adapter is a product and compliance decision, not an implemented capability.

## Phase 1 acceptance

- deterministic source and card contracts exist;
- one-hour and thirty-minute lifecycle rules are tested;
- exact deduplication is tested;
- monitored-source registry validation exists;
- X probe fails safely when no credential is configured;
- TikTok is explicitly reported as blocked rather than represented as live;
- no production API, database, or frontend behavior changes in this phase.
