# Frontend role rules

Own the landing page, `/app` workbench, localization, responsive behavior, accessibility, animation, frontend state, API client, and SSE client.

Do not modify backend business logic, database migrations, signer code, chain adapters, execution policy, or deployment credentials.

Use only relative `/api/v1` URLs. Render every execution state distinctly and never label `submitted` as confirmed. Do not request, store, transmit, or display private keys or seed phrases.

The current frontend still lives in root prototype files while the framework decision remains open. Migration into this directory must be one dedicated task with route and persistence regression tests; do not perform it incidentally.

