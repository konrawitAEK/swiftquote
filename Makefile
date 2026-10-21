.PHONY: help gen-types test-go run-go smoke reset-db dev-db run-go-react run-spring-react run-go-next run-spring-angular stop

help:
	@echo "SwiftQuote Polyglot Commands:"
	@echo "  make gen-types           - Generate TypeScript interfaces from openapi.yaml"
	@echo "  make run-go              - Go Backend + Postgres only (API on :8080)"
	@echo "  make smoke               - End-to-end API smoke test against :8080"
	@echo "  make test-go             - Vet and test the Go backend (+ Postgres if running)"
	@echo "  make reset-db            - Drop the DB volume so migrations re-run"
	@echo "  make run-go-react        - Go Backend + React MUI Frontend"
	@echo "  make run-spring-react    - Spring Boot Backend + React MUI Frontend"
	@echo "  make run-go-next         - Go Backend + Next.js App"
	@echo "  make run-spring-angular  - Spring Boot Backend + Angular App"
	@echo "  make stop                - Shut down all running containers"

gen-types:
	npx --yes @openapitools/openapi-generator-cli generate \
		-i contracts/openapi.yaml \
		-g typescript-axios \
		-o frontend/shared-contract-client

TEST_DB := swiftquote_test
TEST_DATABASE_URL ?= postgres://postgres:password@localhost:5432/$(TEST_DB)?sslmode=disable

# Postgres-backed tests run against a throwaway $(TEST_DB) database, recreated from
# db/migrations each run, so the dev database is never touched. Skipped if Postgres is down.
test-go:
	cd backend/go-service && go vet ./...
	@if docker compose exec -T postgres pg_isready -q 2>/dev/null; then \
		docker compose exec -T postgres psql -q -U postgres -c 'DROP DATABASE IF EXISTS $(TEST_DB)' -c 'CREATE DATABASE $(TEST_DB)' && \
		for f in $$(ls db/migrations/V*.sql | sort -V); do \
			docker compose exec -T postgres psql -q -v ON_ERROR_STOP=1 -U postgres -d $(TEST_DB) < $$f || exit 1; \
		done && \
		cd backend/go-service && TEST_DATABASE_URL='$(TEST_DATABASE_URL)' go test -race -count=1 ./...; \
	else \
		echo "Postgres not running: skipping DB tests (start with: docker compose up -d postgres)"; \
		cd backend/go-service && go test -race ./...; \
	fi

run-go:
	docker compose --profile go up --build

smoke:
	scripts/smoke.sh

reset-db:
	docker compose --profile all --profile go --profile spring --profile react --profile next --profile angular down -v

run-go-react:
	docker compose --profile go --profile react up --build

run-spring-react:
	docker compose --profile spring --profile react up --build

run-go-next:
	docker compose --profile go --profile next up --build

run-spring-angular:
	docker compose --profile spring --profile angular up --build

stop:
	docker compose --profile all --profile go --profile spring --profile react --profile next --profile angular down
