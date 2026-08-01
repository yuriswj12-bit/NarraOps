# Go Agent Runtime

## Goal

One channel-agnostic Agent Runtime powers:

- Web Go page
- Telegram bot
- future channels (Discord, API partners)

The model/provider is swappable. Business writes always go through controlled tools/handlers.

## Architecture

```text
Channel Adapter (web | telegram)
        ↓
POST /api/v1/agent/conversations
POST /api/v1/agent/conversations/:id/messages
POST /api/v1/telegram/webhook
        ↓
Agent Runtime
  - conversation store
  - intent parser (/commands + natural language)
  - TaskManager + tool handlers
  - structured cards
        ↓
SSE / sync response / Telegram reply
```

## Current V1 behavior

- Runtime is live for planning/review cards.
- Execution remains disabled.
- Web path waits for task completion and returns cards immediately for serverless UX.
- Telegram webhook:
  - parses Bot API updates
  - runs the same runtime
  - formats a text reply
  - sends via Bot API only when `TELEGRAM_BOT_TOKEN` is set

## Environment

```text
TELEGRAM_BOT_TOKEN=
TELEGRAM_WEBHOOK_SECRET=
```

Webhook verification uses header:

```text
x-telegram-bot-api-secret-token
```

## Card types

- narrative_snapshot
- meme_package
- launch_draft
- dev_market
- narrative_trends
- meme_analysis
- recent_summary

## Next

1. Durable conversation/task storage in Supabase
2. Optional LLM provider behind the same tool gateway
3. Telegram deep-links that open the same launch draft in web Go
