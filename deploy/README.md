# NarraOps public Beta deployment

The public topology is one origin: `/` landing page, `/app` workspace, `/api/v1/*` backend, and `/api/v1/events` SSE. Nginx is the only public ingress; the backend and database remain private.

The Compose file builds both frontend and backend images and keeps real execution disabled. It is suitable for a public review-only Beta after the host, TLS, environment variables, logging, and backups are configured. It is not approval for custody or autonomous fund execution.

Never bake `.env`, wallet material, API keys, mnemonic phrases, or signer credentials into an image. Production signing must use an isolated signer backed by KMS/HSM with policy checks, per-operation limits, approval records, and auditable key access.

For Alibaba Cloud deployment, use `deploy/alicloud/README.md`. The Alibaba Cloud path runs the NarraOps Docker stack on `127.0.0.1:8080` and uses Caddy on the host for HTTPS.

## Public Beta scope

Expose only:

- `/` landing page;
- `/app` with Go, Pulse, and Assets;
- `/api/v1/health`;
- the review-only Agent, Pulse, and asset endpoints required by the UI;
- `/api/v1/events` for SSE.

Keep `REAL_EXECUTION_ENABLED=false`. Do not configure production wallet vault material for the public Beta.

## Start with Docker Compose

1. Copy `.env.example` to `.env` outside version control.
2. Set `APP_ORIGIN` to the final HTTPS origin.
3. Keep `SECURE_COOKIES=true` behind HTTPS.
4. Keep `REAL_EXECUTION_ENABLED=false`.
5. Start the stack:

```powershell
docker compose -f deploy/docker/docker-compose.example.yml up --build -d
```

Verify:

```text
GET /healthz
GET /api/v1/health
GET /
GET /app
```

## Host requirements

- HTTPS termination and automatic certificate renewal;
- firewall allowing only 80/443 publicly;
- persistent backup for the `narraops-data` volume;
- container log collection and error alerts;
- deployment revision recorded for rollback;
- rate limiting at the public ingress;
- no secrets in image layers or Git.

## Rollback

Retain the previous image tags or Git revision. If health checks, login, Pulse, Go, or Assets fail after deployment, restore the previous revision and keep execution disabled. Database changes must use forward migrations with a separately tested recovery plan.

