# Any backend with any frontend: run-<go|spring|node>-<react|next|angular>.
# React on http://localhost:3000, Next.js on :3001, Angular on :3002; the API is always on :8080.
BACKENDS := go spring node
FRONTENDS := react next angular
RUN_MATRIX := $(foreach b,$(BACKENDS),$(foreach f,$(FRONTENDS),run-$(b)-$(f)))

.PHONY: help gen-types test-db test-go test-spring test-node test-react test-next test-angular run-go run-spring run-node smoke parity bench reset-db stop $(RUN_MATRIX)

help:
	@echo "SwiftQuote Polyglot Commands:"
	@echo "  make gen-types           - Generate TypeScript API types from openapi.yaml"
	@echo "  make run-go              - Go Backend + Postgres only (API on :8080)"
	@echo "  make run-spring          - Spring Boot Backend + Postgres only (API on :8080)"
	@echo "  make run-node            - Node.js (Fastify) Backend + Postgres only (API on :8080)"
	@echo "  make smoke               - End-to-end API smoke test against :8080"
	@echo "  make test-go             - Vet and test the Go backend (+ Postgres if running)"
	@echo "  make test-spring         - Spring unit + integration tests (needs Docker)"
	@echo "  make test-node           - Node unit tests (+ Postgres tests if running)"
	@echo "  make test-<fe>           - Lint, test and build a frontend: test-react, test-next, test-angular"
	@echo "  make parity              - Run Go (:8080), Spring (:8081), Node (:8082) and diff responses"
	@echo "  make bench               - Same three backends, compare throughput one at a time (ab)"
	@echo "  make reset-db            - Drop the DB volume so migrations re-run"
	@echo "  make run-<be>-<fe>       - be: go|spring|node, fe: react (:3000) | next (:3001) | angular (:3002)"
	@echo "                             e.g. make run-go-react, make run-spring-next, make run-node-angular"
	@echo "  make stop                - Shut down all running containers"

OPENAPI_TS := npx --yes openapi-typescript@7.13.0

# Generated types are committed; CI fails if they drift from the contract.
SCHEMA_TS := frontend/react-mui-app/src/api/schema.d.ts frontend/nextjs-app/src/api/schema.d.ts frontend/angular-app/src/app/api/schema.d.ts

gen-types:
	@for f in $(SCHEMA_TS); do $(OPENAPI_TS) contracts/openapi.yaml -o $$f || exit 1; done

TEST_DB := swiftquote_test
TEST_DATABASE_URL ?= postgres://postgres:password@localhost:5432/$(TEST_DB)?sslmode=disable

# Postgres-backed tests run against a throwaway $(TEST_DB) database, recreated from
# db/migrations each run, so the dev database is never touched. Pure unit tests run without it.
test-db:
	@docker compose exec -T postgres pg_isready -q 2>/dev/null || { echo "Start Postgres first: docker compose up -d postgres"; exit 1; }
	@docker compose exec -T postgres psql -q -U postgres -c 'DROP DATABASE IF EXISTS $(TEST_DB)' -c 'CREATE DATABASE $(TEST_DB)' 2>&1 | grep -v NOTICE || true
	@for f in $$(ls db/migrations/V*.sql | sort -V); do \
		docker compose exec -T postgres psql -q -v ON_ERROR_STOP=1 -U postgres -d $(TEST_DB) < $$f || exit 1; \
	done

test-go: test-db
	cd backend/go-service && go vet ./... && TEST_DATABASE_URL='$(TEST_DATABASE_URL)' go test -race -count=1 ./...

run-go:
	docker compose --profile go up --build

run-spring:
	docker compose --profile spring up --build

test-spring:
	cd backend/spring-boot-service && ./mvnw -B verify

run-node:
	docker compose --profile node up --build

# Frontends: lint, unit tests (shared pricing fixtures) and a production build, as in CI.
test-react:
	cd frontend/react-mui-app && npm ci --silent && npm run lint && npm test && npm run build

test-next:
	cd frontend/nextjs-app && npm ci --silent && npm run lint && npm run typecheck && npm test && npm run build

# The Angular CLI needs Node >= 22.22.3 (or 24.15+).
test-angular:
	cd frontend/angular-app && npm ci --silent && npm run lint && npm test && npm run build

# Like test-go: Postgres-backed tests use a throwaway $(TEST_DB) recreated from db/migrations.
test-node:
	cd backend/node-service && npm ci --silent && npm run typecheck
	@if docker compose exec -T postgres pg_isready -q 2>/dev/null; then \
		docker compose exec -T postgres psql -q -U postgres -c 'DROP DATABASE IF EXISTS $(TEST_DB)' -c 'CREATE DATABASE $(TEST_DB)' && \
		for f in $$(ls db/migrations/V*.sql | sort -V); do \
			docker compose exec -T postgres psql -q -v ON_ERROR_STOP=1 -U postgres -d $(TEST_DB) < $$f || exit 1; \
		done && \
		cd backend/node-service && TEST_DATABASE_URL='$(TEST_DATABASE_URL)' npm test; \
	else \
		echo "Postgres not running: skipping DB tests (start with: docker compose up -d postgres)"; \
		cd backend/node-service && npm test; \
	fi

parity:
	SPRING_PORT=8081 NODE_PORT=8082 docker compose --profile go --profile spring --profile node up -d --build --wait
	scripts/smoke.sh http://localhost:8081/api/v1 >/dev/null
	scripts/smoke.sh http://localhost:8082/api/v1 >/dev/null
	@echo "== Go vs Spring"; scripts/parity.py http://localhost:8080/api/v1 http://localhost:8081/api/v1
	@echo "== Go vs Node";   scripts/parity.py http://localhost:8080/api/v1 http://localhost:8082/api/v1

# Rough speed comparison; tune with e.g. make bench N=10000 C=50.
bench:
	SPRING_PORT=8081 NODE_PORT=8082 docker compose --profile go --profile spring --profile node up -d --build --wait
	N=$(or $(N),3000) C=$(or $(C),20) scripts/bench.sh go:8080 spring:8081 node:8082

smoke:
	scripts/smoke.sh

reset-db:
	docker compose --profile all --profile go --profile spring --profile node --profile react --profile next --profile angular down -v

# run-go-react -> profiles "go" and "react".
$(RUN_MATRIX): run-%:
	docker compose --profile $(word 1,$(subst -, ,$*)) --profile $(word 2,$(subst -, ,$*)) up --build

stop:
	docker compose --profile all --profile go --profile spring --profile node --profile react --profile next --profile angular down
