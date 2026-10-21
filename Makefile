.PHONY: help gen-types dev-db run-go-react run-spring-react run-go-next run-spring-angular stop

help:
	@echo "SwiftQuote Polyglot Commands:"
	@echo "  make gen-types           - Generate TypeScript interfaces from openapi.yaml"
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
