# SwiftQuote

Multi-tenant Quotation & Pipeline Management SaaS — an interchangeable polyglot monorepo.

- Backends (swap on :8080): Go (Fiber) / Java 21 Spring Boot 4 / Node.js 22 (Fastify)
- Frontends: React+MUI (:3000) / Next.js (:3001) / Angular (:3002)
- Contract: `contracts/openapi.yaml` (single source of truth)
- DB: PostgreSQL 16, migrations in `db/migrations`

```bash
make help
make run-go-react        # any pairing: make run-<go|spring|node>-<react|next|angular>
```

| | React + MUI | Next.js (App Router) | Angular (Signals) |
|---|---|---|---|
| URL | http://localhost:3000 | http://localhost:3001 | http://localhost:3002 |
| Go | `make run-go-react` | `make run-go-next` | `make run-go-angular` |
| Spring | `make run-spring-react` | `make run-spring-next` | `make run-spring-angular` |
| Node | `make run-node-react` | `make run-node-next` | `make run-node-angular` |

The API is always on http://localhost:8080; every frontend works with every backend unchanged.

Full design: [docs/MASTER_BLUEPRINT.md](docs/MASTER_BLUEPRINT.md)

## Run the Go backend

Requires Docker Desktop running.

```bash
make run-go        # Postgres + Go API on http://localhost:8080 (Ctrl+C to stop)
make smoke         # in another terminal: login -> create -> list -> public view -> accept
make test-go       # unit + HTTP tests; also runs against Postgres when it is up
make reset-db      # wipe the DB volume so migrations and seed re-run
```

Dev logins (password `password` for all), seeded by `db/migrations/V6__seed_dev_roles.sql`:

| Role | Email | Can |
|---|---|---|
| Admin | `demo@swiftquote.dev` | Manage users and teams only |
| WOC | `woc@swiftquote.dev` | See every quote and the sales dashboard |
| WO | `wo@swiftquote.dev` (Team Alpha), `wo2@swiftquote.dev` (Team Beta) | Approve or return their team's quotes |
| RM | `rm1@`, `rm2@` (Alpha), `rm3@swiftquote.dev` (Beta) | Create, edit, submit and send their own quotes |
| Customer | `buyer@acme.example`, `buyer@globex.example` | See and sign their company's sent quotes |

Workflow: draft → pending approval → approved → sent → viewed → accepted / rejected.
Health check: `curl localhost:8080/healthz`.

## Run the Spring Boot backend

Same API, same port, same database. Any frontend works against it unchanged.

```bash
make run-spring      # Postgres + Spring API on http://localhost:8080
make run-spring-react
make test-spring     # unit + integration tests (Testcontainers, needs Docker)
make parity          # Go on :8080 and Spring on :8081, diffs every response
```

## Run the Node.js backend

Fastify + TypeScript on the same contract, database and port.

```bash
make run-node        # Postgres + Node API on http://localhost:8080
make run-node-react
make test-node       # unit tests, plus Postgres tests when the compose DB is up
```

`make parity` checks all three backends: Go vs Spring and Go vs Node.

`make bench` starts the same three and measures each one in turn with ApacheBench (`ab`):
requests per second and p50/p99 latency for `/healthz`, `GET /quotes`, `GET /dashboard/summary` and
login, plus memory. Tune with `make bench N=10000 C=50`. Everything shares one laptop's CPU, so treat
the numbers as a comparison, not capacity planning.
