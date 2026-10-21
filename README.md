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
