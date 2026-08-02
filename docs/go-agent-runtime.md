# Go Agent Runtime

## Goal

One channel-agnostic Agent Runtime powers:

- Web Go page
- Telegram bot (adapter ready, rollout later)
- future channels (Discord, API partners)

The model/provider is swappable. Business writes always go through controlled tools/handlers.

## Architecture

```text
Channel Adapter (web | telegram)
        ↓
POST /api/v1/agent/conversations
POST /api/v1/agent/conversations/:id/messages
PATCH /api/v1/go/launch-drafts/:id
POST /api/v1/telegram/webhook
        ↓
Agent Runtime
  - durable conversation/task/draft stores (Supabase when configured)
  - intent parser (/commands + natural language)
  - TaskManager + tool handlers
  - conversational LLM response generation after controlled task execution
  - structured cards
        ↓
SSE / sync response / Telegram reply
```

## Current behavior

- Runtime is live for planning/review cards.
- Execution remains disabled.
- Web path waits for task completion and returns cards immediately for serverless UX.
- Conversations/messages/tasks/launch drafts persist to Supabase when server credentials exist; otherwise memory fallback.
- Launch drafts support incremental token field updates.
- Conversational LLM:
  - `OPENAI_API_KEY` or `LLM_API_KEY`
  - `OPENAI_BASE_URL` / `LLM_BASE_URL`
  - `OPENAI_MODEL` / `LLM_MODEL`
  - `agent.chat` handles general conversation and capability questions without creating a mock card
  - every task result is passed to the model as bounded context; the model cannot sign, broadcast, or move funds
  - if the provider is not configured or fails, the response explicitly reports safe fallback mode

## Environment

```text
SUPABASE_URL=
SUPABASE_SECRET_KEY=
OPENAI_API_KEY=
OPENAI_BASE_URL=
OPENAI_MODEL=
TELEGRAM_BOT_TOKEN=
TELEGRAM_WEBHOOK_SECRET=
```

Migration:

```text
database/migrations/021_go_agent_core.sql
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

1. Apply migration `021` on production Supabase
2. Configure optional LLM key if desired
3. Telegram bot rollout after Go web loop is stable
