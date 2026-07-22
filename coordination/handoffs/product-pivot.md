# Product pivot handoff

Date: 2026-07-21

This handoff records the latest NarraOps product direction after the GMGN/Bitget Wallet comparison and the user discussion about reducing Meme Dev narrative-discovery cost.

## Core positioning

NarraOps helps Meme Devs lower the cost of discovering, filtering, and evaluating internet narratives, then turn selected stories into launch-ready plans.

The product focus is shifting from a launch-form frontend to a narrative discovery and Agent workspace. Launch capability remains useful, but it should appear as a Go Agent workflow and backend adapter capability rather than a first-level product destination.

## Why the pivot is needed

GMGN, Axiom, Bitget Wallet, and other Web3 tools already provide strong trading, charting, and launch-terminal experiences. Competing directly on manual launch forms, K-line views, sniping, bundling, and execution tools would make NarraOps look like a weaker launch terminal.

The stronger differentiated value is upstream:

1. Detect internet narratives that can become Meme launch opportunities.
2. Collect public evidence and explain the story behind each narrative.
3. Help users compare, filter, and prioritize candidate narratives.
4. Send selected narratives into Go for launch-plan generation and optional execution.

## Navigation decision

Remove `Launch` as a first-level navigation item.

Recommended V1 navigation:

```text
Go / Pulse / Assets / Invite
```

`Launch` routes, backend adapters, launch drafts, and execution contracts should be preserved where they support Go workflows. Do not delete the backend Launch Adapter layer as part of this pivot.

## Product responsibilities

### Pulse

Pulse is the product core after this pivot.

Pulse should become the Narrative Discovery Terminal with two major surfaces:

1. Market activity overview
   - chain-level activity
   - launch activity
   - narrative heat
   - source health
   - active opportunity count

2. Narrative opportunity cards
   - title
   - source platform
   - original URL
   - summary
   - evidence links
   - spread / amplification signals
   - similar-token detection
   - risk and missing evidence
   - status: `reject`, `watch`, `review`, or `high_priority`
   - action: `Send to Go`

Narrative details should prioritize explanation before scoring:

1. What the narrative is
2. Why it may be Meme-able
3. Original evidence
4. Cross-platform spread
5. Similar existing tokens
6. Risks and missing evidence
7. Agent rationale
8. Send to Go

Do not expose a profitability probability. Current Pulse rules already support a status-based model instead of a single success score.

### Go

Go is the Agent command center. It should accept user-provided links, text, and eventually images, then generate a fixed-structure launch plan.

Go should not become a public internet discovery feed. Discovery belongs in Pulse. Go consumes selected narratives and creates plans.

Fixed launch-plan fields:

- Token name
- Ticker / symbol
- Twitter link
- Third-party link, such as Reddit, YouTube, Instagram, or a source website
- Logo image
- Chain
- Launch platform
- Cooking wallet
- Bundle wallets / T1-T5
- Risk warnings
- Execution status

Go can call launch tools after explicit user confirmation. The model may fill and explain fields, but the field schema is owned by the product and backend contract.

### Assets

Assets remains a support workspace for wallet-group configuration, public wallet references, budget planning, and execution preparation. It is not the main product selling point.

### Invite

Invite remains useful for beta access, early contribution tracking, and community growth. It has lower priority than Pulse and Go.

## Bitget Wallet reference

The user shared Bitget Wallet token detail screenshots as a reference for AI narrative explanation. Bitget Wallet explains existing token stories by summarizing their origin, related people, social evidence, chain context, and community meaning.

NarraOps should learn from that information structure while extending it upstream:

- Bitget Wallet: explains why an existing token exists.
- NarraOps Pulse: detects and explains narratives before or while they become launch opportunities.

Codex should treat the screenshots as functional and information-architecture reference. Do not copy Bitget Wallet visual styling, trading buttons, or transaction UI.

## Commercial model

V1 should prioritize SaaS subscription.

Users pay for continuous narrative discovery, filtering, evidence organization, and opportunity review. Launch execution can exist as a workflow capability, but fee sharing and profit sharing are not the main V1 revenue model.

Avoid front-facing promises about user profit. Internal product strategy can stay aligned with user success, but UI and documentation should frame the value as reducing discovery and screening cost.

## Safety constraints

- Do not claim profitability prediction.
- Do not present a Pulse status as financial advice.
- Do not let the model access private keys, seed phrases, raw signer secrets, or unrestricted database queries.
- Any launch, transfer, buy, sell, or withdrawal action requires explicit user confirmation and controlled backend execution.
- `submitted` remains distinct from `confirmed`.
- Real-fund execution stays disabled until signer isolation, durable idempotency, policy enforcement, authentication, immutable audit, and confirmation reconciliation are complete.

## Immediate implementation priorities

1. Update product documentation and handoff files to reflect the pivot.
2. Remove `Launch` from first-level frontend navigation.
3. Keep Launch Adapter capabilities behind Go workflows.
4. Rework Pulse UI toward market activity overview plus narrative opportunity cards.
5. Add or align API contracts for Pulse cards and `Send to Go`.
6. Keep Supabase MVP work because SaaS accounts, usage stats, and subscription gating depend on authenticated users.

## Copy guidance

Preferred Chinese positioning:

```text
NarraOps 帮助 Meme Dev 更低成本地发现、筛选和判断可 Meme 化的互联网叙事，并把高潜力叙事转化为可执行的发射预案。
```

Preferred English positioning:

```text
NarraOps helps Meme Devs discover, filter and evaluate internet narratives with lower cost, then turn selected stories into launch-ready plans.
```
