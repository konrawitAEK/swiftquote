# SwiftQuote

Multi-tenant Quotation & Pipeline Management SaaS — an interchangeable polyglot monorepo.

- Backends (swap on :8080): Go (Fiber) / Java 21 Spring Boot 3
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

Without Docker: `cd backend/go-service && JWT_SECRET=dev go run ./cmd/server` uses in-memory storage
(`STORAGE=memory`, the default), seeded with the same demo data and lost on restart.
