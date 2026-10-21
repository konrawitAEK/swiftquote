# SwiftQuote

Multi-tenant Quotation & Pipeline Management SaaS — an interchangeable polyglot monorepo.

- Backends (swap on :8080): Go (Fiber) / Java 21 Spring Boot 4 / Node.js 22 (Fastify)
- Frontends: React+MUI (:3000) / Next.js (:3001) / Angular (:3002)
- Contract: `contracts/openapi.yaml` (single source of truth)
- DB: PostgreSQL 16, migrations in `db/migrations`

```bash
make help
make run-go-react
```

Full design: [docs/MASTER_BLUEPRINT.md](docs/MASTER_BLUEPRINT.md)

## Run the Go backend

Requires Docker Desktop running.

```bash
make run-go        # Postgres + Go API on http://localhost:8080 (Ctrl+C to stop)
make smoke         # in another terminal: login -> create -> list -> public view -> accept
make test-go       # unit + HTTP tests; also runs against Postgres when it is up
make reset-db      # wipe the DB volume so migrations and seed re-run
```

Dev login: `demo@swiftquote.dev` / `password`, demo client id `00000000-0000-4000-8000-000000000003`.
Health check: `curl localhost:8080/healthz`.

Without Docker: `cd backend/go-service && JWT_SECRET=swiftquote-dev-only-jwt-secret-change-me go run ./cmd/server` uses in-memory storage
(`STORAGE=memory`, the default), seeded with the same demo data and lost on restart.

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
