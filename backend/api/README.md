# NarraOps API v1

This is a dependency-free Node.js 20 API skeleton. All Agent results and third-party integrations are simulated. It cannot issue tokens, sign transactions, transfer funds, or execute trades.

## Run

```powershell
cd backend/api
npm start
```

The API listens on `http://127.0.0.1:5190` by default. Frontend code should always call relative `/api/v1/...` paths; the local reverse proxy or production gateway owns port routing.

## Test

```powershell
cd backend/api
npm test
npm run check
```

The normative contract is `../../shared/openapi.yaml`, supported by JSON Schemas under `../../shared/schemas/`.
