# Frontend handoff

- Call `POST /api/v1/executions` with both the `Idempotency-Key` header and matching body `idempotencyKey`.
- Treat `planned`, `signing`, `submitted`, and `confirmed` as distinct states. Never display `submitted` as success.
- Render `partially_failed`, `failed`, and `timed_out` with retry/recovery actions supplied by the backend.
- Amounts and priority fees are decimal strings. Do not convert them to JavaScript floating-point numbers before submission.
- Never request, store, or transmit a private key or mnemonic.
- Contract source: `shared/openapi.yaml`; schemas: `shared/schemas/`.

