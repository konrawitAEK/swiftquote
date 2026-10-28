# SwiftQuote

Multi-tenant Quotation & Pipeline Management SaaS — an interchangeable polyglot monorepo.

- Backends (swap on :8080): Go (Fiber) / Java 21 Spring Boot 4 / Node.js 22 (Fastify)
- Frontends: React + MUI (:3000) / Next.js App Router (:3001) / Angular Signals (:3002)
- Contract: `contracts/openapi.yaml` (single source of truth)
- DB: PostgreSQL 16, migrations in `db/migrations`

Full design: [docs/MASTER_BLUEPRINT.md](docs/MASTER_BLUEPRINT.md)

## Quick start

Requires Docker Desktop running. Pick one backend and one frontend:

```bash
make run-go-react      # Postgres + Go API + React, then open http://localhost:3000
make stop              # in another terminal (or Ctrl+C), shuts every container down
```

| | React + MUI | Next.js | Angular |
|---|---|---|---|
| Open | http://localhost:3000 | http://localhost:3001 | http://localhost:3002 |
| Go | `make run-go-react` | `make run-go-next` | `make run-go-angular` |
| Spring | `make run-spring-react` | `make run-spring-next` | `make run-spring-angular` |
| Node | `make run-node-react` | `make run-node-next` | `make run-node-angular` |

The API is always on http://localhost:8080 (`curl localhost:8080/healthz`). Every frontend works with
every backend unchanged, and all of them share one Postgres, so data created in one combination shows
up in the others. `make help` lists every command.

### Dev logins

Password `password` for all, seeded by `db/migrations/V6__seed_dev_roles.sql`. After login each role
lands on its own home page.

| Role | Email | Home | Can |
|---|---|---|---|
| Back Office (role code `admin`) | `demo@swiftquote.dev` | `/settings` | Manage users, teams, product categories and products (price, cost, stock) |
| WOC | `woc@swiftquote.dev` | `/dashboard` | See every quote and the sales dashboard |
| WO | `wo@swiftquote.dev` (Team Alpha), `wo2@swiftquote.dev` (Team Beta) | `/quotes` | Approve or return their team's quotes |
| RM | `rm1@`, `rm2@` (Alpha), `rm3@swiftquote.dev` (Beta) | `/quotes` | Create, edit, submit and send their own quotes from active products |
| Customer | `buyer@acme.example`, `buyer@globex.example` | `/quotes` | See and sign their company's sent quotes |

Workflow: draft → pending approval → approved → sent → viewed → accepted / rejected.

- **Products:** quote lines are picked from Back Office's active products. The RM may change the unit price, and
  each line's discount is either a percent or a baht amount.
- **Cost and profit:** every role except the customer sees cost and profit; customers and the share link never
  receive them.
- **Stock:** stock is optional per product. It is checked on submit and send, and deducted when the customer
  accepts.
- **PDF:** staff can download the quote as a PDF from approved onwards, and the customer from the share link.
  Fonts are Noto Sans and Noto Sans Thai (OFL).

## Backends

```bash
make run-go          # Postgres + Go API only, on :8080
make run-spring      # Postgres + Spring API only, on :8080
make run-node        # Postgres + Node API only, on :8080

make test-go         # vet + unit + HTTP tests; also against Postgres when it is up
make test-spring     # unit + integration tests (Testcontainers, needs Docker)
make test-node       # typecheck + unit tests, plus Postgres tests when the compose DB is up
```

Postgres-backed tests (Go, Node) use a throwaway `swiftquote_test` database rebuilt from
`db/migrations`, so the dev data is never touched.

## Frontends

Each frontend has one folder per page, shared components in `components/`, and every API call in a
service under one shared `services/` folder (one service per page, e.g. `quoteDetailService`):

| App | HTTP client | Services |
|---|---|---|
| React | axios (`src/api/http.ts`: base URL, Bearer token, 401 → logout) | `src/services/*Service.ts` |
| Next.js | axios in the browser (`src/lib/api/http.ts`) and on the server (`src/lib/api/server.ts`, session cookie) | `src/services/*Service.ts` |
| Angular | `HttpClient` returning Observables (auth interceptor in `core/`) | `src/app/services/*.service.ts` |

```bash
make test-react      # lint + tests + production build (same as CI)
make test-next
make test-angular
```

To work on a frontend with hot reload, run a backend in Docker (e.g. `make run-go`) and the frontend's
dev server on the host:

| App | Folder | Dev server | Notes |
|---|---|---|---|
| React | `frontend/react-mui-app` | `npm run dev` → :3000 | Vite SPA |
| Next.js | `frontend/nextjs-app` | `npm run dev` → :3001 | Dashboard is a Server Component (fetches with the session cookie) |
| Angular | `frontend/angular-app` | `npm start` → :3002 | Standalone + Signals; the Angular CLI needs Node ≥ 22.22.3 (or 24.15+) |

Run `npm ci` in the folder first.

Data shapes live in a `models/` folder (`src/models`, Angular `src/app/models`): one file per area
(`common`, `auth`, `catalog`, `quote`, `dashboard`, `admin`) with interfaces such as
`interface QuoteDetail extends Generated<'QuoteDetail'> {}`. Each one extends the type generated from
the contract, so it can't drift from the API. After changing `contracts/openapi.yaml`, run
`make gen-types` (rewrites `schema.d.ts` in all three apps; CI fails if they are stale), and add any new
schema to the matching model file.

## Cross-backend checks

```bash
make smoke           # end-to-end workflow against :8080: create -> submit -> approve -> send -> sign
make parity          # starts Go (:8080), Spring (:8081), Node (:8082); Go vs each must match exactly
make bench           # same three, one at a time: requests/s, p50/p99 latency, memory (ApacheBench)
make bench N=10000 C=50
```

`make bench` warms each backend up before measuring. Client, database and backends share one laptop's
CPU, so treat the numbers as a comparison, not capacity planning.

## Database

```bash
make reset-db        # drop the DB volume; migrations and seed data re-run on next start
```

Smoke, parity and bench leave their own rows in the dev database (quote numbers `SMOKE-…`, names
starting `PA…`/`PB…`); `make reset-db` clears them.
