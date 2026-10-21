# SwiftQuote — React + MUI frontend

Vite + React + TypeScript + MUI. Talks to whichever backend is on `:8080` (Go or Spring).

```bash
npm install
npm run dev        # http://localhost:3000 (needs a backend on :8080, e.g. `make run-go`)
npm test           # pricing parity tests against contracts/fixtures
npm run build
```

- API types in `src/api/schema.d.ts` are generated from `contracts/openapi.yaml` with `make gen-types`
  (repo root). Do not edit them by hand; CI fails if they drift from the contract.
- `VITE_API_URL` overrides the API base URL (default `http://localhost:8080/api/v1`). It is baked in at build time.
- Routes: `/login`, `/quotes`, `/quotes/new`, and the public client portal `/p/:accessToken`.
