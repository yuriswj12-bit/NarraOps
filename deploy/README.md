# NarraOps deployment skeleton

The public topology is one origin: `/` landing page, `/app` workspace, `/api/v1/*` backend, and `/api/v1/events` SSE. Nginx is the only public ingress; the backend and database remain private.

The Compose file is an example, not a production release. Replace the backend image placeholder, provide secrets through the deployment platform, terminate TLS, add health checks, rate limits, observability, backups, and a durable database before deployment.

Never bake `.env`, wallet material, API keys, mnemonic phrases, or signer credentials into an image. Production signing must use an isolated signer backed by KMS/HSM with policy checks, per-operation limits, approval records, and auditable key access.

