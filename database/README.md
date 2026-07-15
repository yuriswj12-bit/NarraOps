# NarraOps data layer

`migrations/001_agent_tasks.sql` defines the future PostgreSQL persistence model for Agent tasks, SSE event history, narrative artifacts, and non-executable launch packages.

The current API deliberately uses an in-memory repository so the skeleton can run without credentials or infrastructure. The repository boundary is `backend/api/src/repositories/`. A PostgreSQL implementation can replace it without changing routes or Agent handlers.

No database port should be exposed to browsers or the public internet. Production access must be restricted to the backend service identity.
