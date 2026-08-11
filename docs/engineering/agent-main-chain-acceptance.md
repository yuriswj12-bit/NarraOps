# Agent Main-Chain Acceptance Test

Status: consolidated acceptance pass. Some checks are automated (canary),
some require a real browser session.

## Automated canary

`scripts/canary/production-agent-acceptance.mjs` uses a fresh random EVM wallet
(no funds, no secrets), authenticates, and runs:

1. `/recent-summary` — structured recent-summary result
2. `/my-launches` — `user_launch_summary` card (empty data is acceptable; the
   route and handler must work)
3. `/my-projects` — `user_project_performance` card
4. `/my-pnl` — `user_pnl_summary` card
5. `/launch <public link>` — `launch_draft` card with `skill=meme-launch-plan`
6. `/analyze-meme <public address>` — meme analysis card
7. durable event replay (non-empty, cursor idempotent)

The canary deletes all created rows (task, conversation, user, challenge) via
the linked Supabase database. Run:

```powershell
node scripts/canary/production-agent-acceptance.mjs
```

## Real-browser checks (require login)

- Go → `/my-launches` renders the launch-history card with counts and recent
  list.
- Go → `/my-projects` renders per-project rows with bundled-buy outcomes.
- Go → `/my-pnl` renders execution history and PnL overview.
- Go → `/launch <public link>` renders the editable launch-draft card with a
  "Meme Launch Plan" skill tag, Cooking/bundled wallet groups, and the bundled
  total-buy input.
- Memory prefill: confirm a preference like "cooking 金额 2 SOL，bundled 总额
  5 SOL" in Go Memory, then run `/launch <link>` and confirm the card prefills
  `initial_buy=2` and `bundle_buy_total=5` while remaining editable.
- Go → `/analyze-meme <contract>` renders a meme analysis card (live or
  data-gap, never a bare error).

## Acceptance criteria

- No route returns `API route was not found` for these commands.
- Every command returns a structured card or an explicit data-gap with a code.
- `submitted` is never labelled `confirmed`.
- No real funds, broadcast, or wallet signature is required for the canary
  path; browser checks only inspect read-only analytics and launch-plan
  generation (no broadcast).
