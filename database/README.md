# NarraOps data layer

`migrations/001_agent_tasks.sql` defines the future PostgreSQL persistence model for Agent tasks, SSE event history, narrative artifacts, and non-executable launch packages.

The current API deliberately uses an in-memory repository so the skeleton can run without credentials or infrastructure. The repository boundary is `backend/api/src/repositories/`. A PostgreSQL implementation can replace it without changing routes or Agent handlers.

No database port should be exposed to browsers or the public internet. Production access must be restricted to the backend service identity.

Additional drafts:

- `002_go_agent_metadata.sql` adds Go parsing and execution-policy metadata to Agent tasks.
- `003_execution_simulations.sql` defines the six simulation types and guarantees that signing and broadcasting stay disabled at the persistence boundary.
- `004_go_conversations_market_launch.sql` adds Go conversations/messages, GMGN-derived Dev-wallet history, launch drafts, and provider wallet references. It stores no raw private keys or seed phrases.
- `005_account_wallet_groups_transfers.sql` drafts authenticated portfolio snapshots, wallet groups/public provider references, protected two-step deletion, export-request audit metadata, durable transfer idempotency, and immutable status events. Capability tokens are stored only as hashes; raw key material is explicitly excluded.
