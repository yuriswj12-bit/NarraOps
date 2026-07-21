# Backend and Agent role rules

Own `backend/api`, `backend/agents`, `backend/integrations`, authentication, persistence, task queues, rate limits, and SSE.

Do not modify frontend layout or animation. Do not implement raw-key custody inside the API service. The backend sends validated intent and policy context to the isolated execution boundary.

Update `shared/openapi.yaml` and matching schemas before changing public request or response fields. Preserve unified error envelopes, request IDs, timeouts, bounded retries, and recursive secret redaction.

