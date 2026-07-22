# Vercel + Supabase public beta deployment

This is the preferred lightweight beta path for NarraOps.

Use Vercel for:

- `narraops.xyz`
- `www.narraops.xyz`
- later `app.narraops.xyz`
- static landing and frontend app hosting

Use Supabase for:

- Auth
- Postgres
- Storage
- Row Level Security
- future app persistence

Do not use Alibaba Cloud ECS, Docker, SSH, or Caddy for the first Vercel beta. Keep the Alibaba Cloud deployment path as a later self-hosted option.

## Current beta boundary

The Vercel deployment publishes the static frontend bundle from `dist/vercel`.

The existing Node `/api/v1` backend is not automatically deployed as a Vercel function. Until the backend is migrated to Supabase-backed functions or a separate hosted API, live Go, Pulse, Assets, and wallet workflows must be treated as frontend beta surfaces only.

Keep these statements true:

- no real execution
- no private keys
- no custody
- no profitability promises
- no hidden server state in Vercel static hosting

## Vercel project settings

After importing `yuriswj12-bit/NarraOps` into Vercel, use the repository root.

The repository includes `vercel.json`, so Vercel should read:

```text
Build Command: npm run build:vercel
Output Directory: dist/vercel
Install Command: npm ci
```

If the dashboard asks for a framework preset, choose `Other`.

## Domains

First-stage domain mapping:

```text
narraops.xyz      -> Vercel production deployment
www.narraops.xyz  -> Vercel production deployment or redirect to narraops.xyz
```

Second-stage domain mapping:

```text
app.narraops.xyz  -> Vercel app deployment or app route
api.narraops.xyz  -> future backend API or Supabase custom domain
```

## Alibaba Cloud DNS

In Alibaba Cloud DNS, add the records Vercel shows under Project Settings > Domains.

Typical records:

```text
Type: A
Host: @
Value: 76.76.21.21

Type: CNAME
Host: www
Value: cname.vercel-dns.com
```

For `app.narraops.xyz`, add it later:

```text
Type: CNAME
Host: app
Value: cname.vercel-dns.com
```

Use the exact values shown by Vercel if they differ from the examples above.

## Supabase environment variables

For static frontend beta, only publishable browser-safe variables may be exposed to Vercel:

```text
SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLISHABLE_KEY
```

Do not add these to Vercel frontend environment variables:

```text
SUPABASE_SECRET_KEY
SUPABASE_SERVICE_ROLE_KEY
private keys
seed phrases
wallet vault passwords
RPC credentials for execution
```

Supabase custom domains are not required for day-one beta. They are a paid add-on and can be considered later for `api.narraops.xyz`.

## Deploy

Vercel deploys automatically after pushes to the connected GitHub branch.

Manual local build check:

```powershell
npm run build:vercel
```

Expected output:

```text
dist/vercel/index.html
dist/vercel/app.html
dist/vercel/app.js
dist/vercel/styles.css
dist/vercel/assets/
```

## Verify

After deployment:

```powershell
curl.exe -I https://narraops.xyz/
curl.exe -I https://www.narraops.xyz/
curl.exe -I https://narraops.xyz/app
```

In the browser, verify:

- landing page loads
- `/app` loads the beta workspace
- Go / Pulse / Assets navigation is visible
- no Launch first-level navigation is visible
- API-dependent actions either use available backend endpoints or fail with visible review/beta state

## Next backend step

Choose one backend path after the static beta is live:

```text
Option A: migrate selected /api/v1 routes to Vercel Functions backed by Supabase
Option B: host the Node API separately and point api.narraops.xyz to it
Option C: keep Alibaba Cloud ECS/Docker as the self-hosted backend path
```

For the current beta, prefer Option A only for small read/write flows that do not require SSE or long-running workers.
