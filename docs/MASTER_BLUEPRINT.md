# SwiftQuote: Polyglot Monorepo Master Architecture & Execution Plan

---

## 1. System Overview & The Interchangeable Paradigm

**SwiftQuote** is a multi-tenant Quotation & Pipeline Management SaaS built as an **Interchangeable Polyglot Monorepo**. 

The defining architectural requirement is **Zero-Coupling Contract Parity**:
- **Backend Tier (Interchangeable):** Go (Fiber/Gin) and Java (Spring Boot 3 / Java 21) must expose the **exact same HTTP REST interfaces, payload schemas, and error structures** defined in `openapi.yaml`.
- **Frontend Tier (Interchangeable):** React (Vite + MUI), Next.js (App Router), and Angular (Signals + Standalone) consume the shared API transparently over a single unified port (`http://localhost:8080/api/v1`).
- **Persistence Tier (Shared):** A single PostgreSQL instance hosting identical schema migrations run via Flyway-compatible SQL.

```
                    ┌───────────────────────────┐
                    │  openapi.yaml (Contract)  │
                    └─────────────┬─────────────┘
                                  │
         ┌────────────────────────┼────────────────────────┐
         ▼                        ▼                        ▼
┌──────────────────┐    ┌──────────────────┐    ┌──────────────────┐
│  React (MUI SPA) │    │ Next.js (App)    │    │ Angular (Signals)│
│  Port: 3000      │    │ Port: 3001       │    │ Port: 3002       │
└────────┬─────────┘    └────────┬─────────┘    └────────┬─────────┘
         │                       │                       │
         └───────────────────────┼───────────────────────┘
                                 │ HTTP requests to :8080
                                 ▼
                     ┌───────────────────────┐
                     │ Active Backend Choice │
                     │   (Profile-selected)  │
                     └───────────┬───────────┘
                                 │
                 ┌───────────────┴───────────────┐
                 ▼                               ▼
       ┌───────────────────┐           ┌───────────────────┐
       │   Go Service      │           │ Java Spring Boot  │
       │ (Port 8080 / DB)  │    XOR    │ (Port 8080 / DB)  │
       └─────────┬─────────┘           └─────────┬─────────┘
                 │                               │
                 └───────────────┬───────────────┘
                                 ▼
                    ┌─────────────────────────┐
                    │ PostgreSQL Database     │
                    │ (Port 5432: multi-tenant│
                    └─────────────────────────┘
```

---

## 2. Monorepo Directory Layout

```text
swiftquote/
├── .github/
│   └── workflows/
│       ├── test-contracts.yml       # Spectral OpenAPI linting
│       ├── ci-backend-go.yml        # Go tests & build
│       ├── ci-backend-spring.yml    # Maven verify & tests
│       ├── ci-frontend-react.yml    # Vitest & lint
│       ├── ci-frontend-next.yml     # Next.js build
│       └── ci-frontend-angular.yml  # Angular tests
├── contracts/
│   ├── openapi.yaml                 # SINGLE SOURCE OF TRUTH
│   └── spectral.yml                 # Contract lint rules
├── db/
│   └── migrations/                  # Standard SQL migrations (Flyway format)
│       ├── V1__init_schema.sql
│       └── V2__seed_dev_data.sql
├── backend/
│   ├── go-service/                  # Go 1.23+ Clean Architecture
│   │   ├── cmd/server/main.go
│   │   ├── internal/
│   │   │   ├── domain/              # Entities & Value Objects
│   │   │   ├── quote/               # Use cases & Calculation logic
│   │   │   └── delivery/http/       # HTTP handlers (Contract aligned)
│   │   ├── go.mod
│   │   └── Dockerfile
│   └── spring-boot-service/         # Spring Boot 3.3+, Java 21
│       ├── src/main/java/com/swiftquote/
│       │   ├── domain/
│       │   ├── service/
│       │   └── web/rest/            # Exact same path/payload signatures
│       ├── pom.xml
│       └── Dockerfile
├── frontend/
│   ├── react-mui-app/               # Vite + React 18+ + MUI v6
│   │   ├── src/
│   │   ├── package.json
│   │   └── Dockerfile
│   ├── nextjs-app/                  # Next.js 15+ App Router
│   │   ├── src/app/
│   │   ├── package.json
│   │   └── Dockerfile
│   └── angular-app/                 # Angular 18+ (Signals, Standalone)
│       ├── src/app/
│       ├── package.json
│       └── Dockerfile
├── scripts/
│   ├── codegen.sh                   # Runs openapi-generator for TS types
│   └── migrate.sh                   # Runs DB migrations
├── docker-compose.yml               # Profiles for any backend/frontend pair
├── Makefile                         # Unified dev orchestrator
└── README.md
```

---

## 3. OpenAPI 3.0 Contract (`contracts/openapi.yaml`)

This specification dictates all payloads, statuses, and validation logic for both backends and all three frontends.

```yaml
openapi: 3.0.3
info:
  title: SwiftQuote Interchangeable API
  version: 1.0.0
  description: Canonical API specification for the SwiftQuote multi-tenant engine.
servers:
  - url: http://localhost:8080/api/v1
    description: Local Gateway (either Go or Spring Boot backend)

paths:
  /auth/login:
    post:
      summary: User login
      tags: [Auth]
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/LoginRequest'
      responses:
        '200':
          description: Login successful
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/AuthResponse'
        '401':
          $ref: '#/components/responses/Unauthorized'

  /quotes:
    get:
      summary: List quotations for current tenant
      tags: [Quotes]
      security:
        - BearerAuth: []
      parameters:
        - name: status
          in: query
          schema:
            $ref: '#/components/schemas/QuoteStatus'
      responses:
        '200':
          content:
            application/json:
              schema:
                type: array
                items:
                  $ref: '#/components/schemas/QuoteSummary'
    post:
      summary: Create quotation with real-time recalculation
      tags: [Quotes]
      security:
        - BearerAuth: []
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/CreateQuoteRequest'
      responses:
        '201':
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/QuoteDetail'
        '400':
          $ref: '#/components/responses/BadRequest'

  /public/quotes/{accessToken}:
    get:
      summary: Fetch quote details for client portal without auth
      tags: [ClientPortal]
      parameters:
        - name: accessToken
          in: path
          required: true
          schema:
            type: string
            format: uuid
      responses:
        '200':
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/PublicQuoteView'
        '404':
          description: Quote expired or not found

  /public/quotes/{accessToken}/accept:
    post:
      summary: Client submits e-signature to accept proposal
      tags: [ClientPortal]
      parameters:
        - name: accessToken
          in: path
          required: true
          schema:
            type: string
            format: uuid
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/AcceptQuoteRequest'
      responses:
        '200':
          description: Accepted successfully
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/QuoteDetail'

components:
  securitySchemes:
    BearerAuth:
      type: http
      scheme: bearer
      bearerFormat: JWT

  responses:
    Unauthorized:
      description: Authentication failed
      content:
        application/json:
          schema:
            $ref: '#/components/schemas/ErrorResponse'
    BadRequest:
      description: Invalid payload or math validation failure
      content:
        application/json:
          schema:
            $ref: '#/components/schemas/ErrorResponse'

  schemas:
    QuoteStatus:
      type: string
      enum: [draft, sent, viewed, accepted, rejected, expired]

    LoginRequest:
      type: object
      required: [email, password]
      properties:
        email:
          type: string
          format: email
        password:
          type: string

    AuthResponse:
      type: object
      required: [accessToken, tenantId, user]
      properties:
        accessToken:
          type: string
        tenantId:
          type: string
          format: uuid
        user:
          type: object
          properties:
            id: { type: string, format: uuid }
            name: { type: string }
            role: { type: string, enum: [owner, manager, member] }

    QuoteItemInput:
      type: object
      required: [title, quantity, unitPrice]
      properties:
        title: { type: string }
        description: { type: string }
        quantity: { type: number, minimum: 1 }
        unitPrice: { type: number, minimum: 0 }
        discountPercent: { type: number, default: 0, minimum: 0, maximum: 100 }
        taxPercent: { type: number, default: 7, minimum: 0, maximum: 100 }

    CreateQuoteRequest:
      type: object
      required: [clientId, quoteNumber, expiryDate, items]
      properties:
        clientId: { type: string, format: uuid }
        dealId: { type: string, format: uuid, nullable: true }
        quoteNumber: { type: string }
        expiryDate: { type: string, format: date }
        items:
          type: array
          items:
            $ref: '#/components/schemas/QuoteItemInput'

    QuoteSummary:
      type: object
      required: [id, quoteNumber, clientName, status, grandTotal, expiryDate]
      properties:
        id: { type: string, format: uuid }
        quoteNumber: { type: string }
        clientName: { type: string }
        status: { $ref: '#/components/schemas/QuoteStatus' }
        grandTotal: { type: number }
        expiryDate: { type: string, format: date }

    QuoteDetail:
      type: object
      required: [id, quoteNumber, status, subtotal, discountAmount, taxAmount, grandTotal, items]
      properties:
        id: { type: string, format: uuid }
        quoteNumber: { type: string }
        status: { $ref: '#/components/schemas/QuoteStatus' }
        subtotal: { type: number }
        discountAmount: { type: number }
        taxAmount: { type: number }
        grandTotal: { type: number }
        accessToken: { type: string, format: uuid }
        signedAt: { type: string, format: date-time, nullable: true }
        items:
          type: array
          items:
            type: object
            properties:
              title: { type: string }
              quantity: { type: number }
              unitPrice: { type: number }
              lineTotal: { type: number }

    PublicQuoteView:
      type: object
      required: [quoteNumber, vendorName, grandTotal, items]
      properties:
        quoteNumber: { type: string }
        vendorName: { type: string }
        vendorLogo: { type: string, nullable: true }
        grandTotal: { type: number }
        items:
          type: array
          items:
            type: object
            properties:
              title: { type: string }
              quantity: { type: number }
              unitPrice: { type: number }
              lineTotal: { type: number }

    AcceptQuoteRequest:
      type: object
      required: [signerName, signatureDataUrl]
      properties:
        signerName: { type: string }
        signatureDataUrl: { type: string, description: "Base64 canvas image" }

    ErrorResponse:
      type: object
      required: [code, message]
      properties:
        code: { type: string }
        message: { type: string }
        details: { type: array, items: { type: string }, nullable: true }
```

---

## 4. Multi-Tenant Database Migration (`db/migrations/V1__init_schema.sql`)

```sql
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Tenants table
CREATE TABLE organizations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(100) UNIQUE NOT NULL,
    currency VARCHAR(3) DEFAULT 'THB',
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Users table
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(150) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Membership / RBAC
CREATE TABLE organization_members (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role VARCHAR(20) NOT NULL CHECK (role IN ('owner', 'manager', 'member')),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(organization_id, user_id)
);

-- Clients
CREATE TABLE clients (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Quotes
CREATE TABLE quotes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    client_id UUID NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
    quote_number VARCHAR(50) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'viewed', 'accepted', 'rejected', 'expired')),
    expiry_date DATE NOT NULL,
    subtotal NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    discount_amount NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    tax_amount NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    grand_total NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    access_token UUID DEFAULT uuid_generate_v4() UNIQUE,
    signed_by VARCHAR(150),
    signature_data TEXT,
    signed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(organization_id, quote_number)
);

-- Quote Items
CREATE TABLE quote_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    quote_id UUID NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    quantity NUMERIC(10, 2) NOT NULL DEFAULT 1.00,
    unit_price NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    discount_percent NUMERIC(5, 2) NOT NULL DEFAULT 0.00,
    tax_percent NUMERIC(5, 2) NOT NULL DEFAULT 7.00,
    line_total NUMERIC(12, 2) NOT NULL DEFAULT 0.00
);

-- Indexes for performance
CREATE INDEX idx_quote_org_status ON quotes(organization_id, status);
CREATE INDEX idx_quote_access_token ON quotes(access_token);
```

---

## 5. Docker Orchestration with Profiles (`docker-compose.yml`)

This configuration allows running **any combination of frontend and backend** using Docker Compose profiles.

```yaml
version: '3.9'

services:
  # Shared Database
  postgres:
    image: postgres:16-alpine
    container_name: swiftquote-db
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: password
      POSTGRES_DB: swiftquote
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data
      - ./db/migrations:/docker-entrypoint-initdb.d
    networks:
      - internal-net

  # ----------------- BACKENDS (Only ONE active on 8080) -----------------
  backend-go:
    build:
      context: ./backend/go-service
      dockerfile: Dockerfile
    container_name: swiftquote-backend-go
    profiles: ["go", "all"]
    ports:
      - "8080:8080"
    environment:
      DB_HOST: postgres
      DB_PORT: 5432
      DB_USER: postgres
      DB_PASSWORD: password
      DB_NAME: swiftquote
      JWT_SECRET: devsecretkey123
    depends_on:
      - postgres
    networks:
      - internal-net

  backend-spring:
    build:
      context: ./backend/spring-boot-service
      dockerfile: Dockerfile
    container_name: swiftquote-backend-spring
    profiles: ["spring"]
    ports:
      - "8080:8080"
    environment:
      SPRING_DATASOURCE_URL: jdbc:postgresql://postgres:5432/swiftquote
      SPRING_DATASOURCE_USERNAME: postgres
      SPRING_DATASOURCE_PASSWORD: password
      JWT_SECRET: devsecretkey123
    depends_on:
      - postgres
    networks:
      - internal-net

  # ----------------- FRONTENDS -----------------
  frontend-react:
    build:
      context: ./frontend/react-mui-app
      dockerfile: Dockerfile
    container_name: swiftquote-fe-react
    profiles: ["react", "all"]
    ports:
      - "3000:3000"
    environment:
      VITE_API_URL: http://localhost:8080/api/v1
    networks:
      - internal-net

  frontend-next:
    build:
      context: ./frontend/nextjs-app
      dockerfile: Dockerfile
    container_name: swiftquote-fe-next
    profiles: ["next"]
    ports:
      - "3001:3000"
    environment:
      NEXT_PUBLIC_API_URL: http://localhost:8080/api/v1
    networks:
      - internal-net

  frontend-angular:
    build:
      context: ./frontend/angular-app
      dockerfile: Dockerfile
    container_name: swiftquote-fe-angular
    profiles: ["angular"]
    ports:
      - "3002:80"
    environment:
      API_URL: http://localhost:8080/api/v1
    networks:
      - internal-net

networks:
  internal-net:
    driver: bridge

volumes:
  pgdata:
```

---

## 6. Developer Makefile: Single Command Execution (`Makefile`)

```makefile
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
```

---

## 7. Step-by-Step Execution Plan (From Scratch to GitHub)

### Phase 1: Contract & Foundation (Day 1)
1. Initialize Git repository with the Monorepo structure defined above.
2. Commit `contracts/openapi.yaml` and `db/migrations/V1__init_schema.sql`.
3. Set up Spectral in CI to validate all future API changes against OpenAPI standards.

### Phase 2: Core Vertical Slice — Go + React MUI (Days 2–4)
1. **Go Service:** Implement clean architecture (`handler` -> `usecase` -> `repository`) with Fiber or Gin. Connect with PostgreSQL using `pgx` or `sqlc`.
2. Implement quote calculation unit test in Go (precision math for VAT and discounts).
3. **React MUI:** Initialize Vite React with TypeScript. Use `gen-types` to consume generated models. Build Quote Builder with live totals recalculation.
4. Verify complete flow: Auth -> Create Quote -> Generate Shareable URL -> Open Public Portal -> Accept.

### Phase 3: Secondary Backend Parity — Java Spring Boot (Days 5–7)
1. Scaffold Spring Boot 3.3 with Maven, Spring Data JPA, and Spring Security (JWT).
2. Implement identical endpoints for `/api/v1/auth/*`, `/api/v1/quotes/*`, and `/api/v1/public/*`.
3. Swap backend via `make run-spring-react`. Verify that React works **without changing a single line of frontend code**.

### Phase 4: Extended Frontends — Next.js & Angular (Days 8–10)
1. **Next.js:** Implement Server Components for the Dashboard, Client Components for dynamic line-item addition.
2. **Angular:** Build the application using Signals for state management and modern standalone components.
3. Test all matrix combinations:
   - `Go + Next.js`
   - `Spring Boot + Next.js`
   - `Go + Angular`
   - `Spring Boot + Angular`

---

## 8. Strategic Prompts for Claude

Copy and paste these exact prompts into Claude during development to generate production-quality code for each language.

### Claude Prompt 1: Go Fiber Clean Architecture Implementation
```text
Act as a Principal Go Engineer. I am building the Go backend service for the SwiftQuote project.
Based on the provided openapi.yaml, please implement:
1. Domain entity for Quote and QuoteItem with accurate JSON serialization.
2. A Domain Pricing Service that calculates line totals, subtotal, tax amount (7%), discount amount, and grand total using exact decimal rounding to avoid float inaccuracies.
3. Fiber v2 HTTP handlers for POST /api/v1/quotes and GET /api/v1/public/quotes/:accessToken.
4. Clean architecture structure: Handler, Service (Use Case), and Repository interface.
Keep the code idiomatic, robust, and fully aligned with the OpenAPI payload specifications.
```

### Claude Prompt 2: Java Spring Boot Parity Implementation
```text
Act as a Senior Spring Boot Architect. I have a working Go service implementing the attached openapi.yaml contract.
Please write the equivalent Java 21 & Spring Boot 3.3 implementation to achieve 100% parity:
1. JPA Entities for Quote and QuoteItem with BigDecimal for monetary fields.
2. A QuoteCalculationService enforcing identical arithmetic for subtotal, discount, 7% VAT, and grand totals.
3. Spring RestControllers matching the exact URI paths and JSON response structures.
4. ExceptionHandler advice returning the ErrorResponse schema defined in the contract.
Make sure the field names in JSON serialization match the snake_case or camelCase conventions required by the contract.
```

### Claude Prompt 3: Angular Signals Quote Builder Component
```text
Act as an Angular Enterprise Lead. Implement the Quote Builder component in Angular 18+ using:
1. Standalone Components and Angular Signals (signal, computed, effect).
2. A computed signal that dynamically recalculates subtotal, tax (7%), discount, and grand total in real-time as users modify line items.
3. A reactive form or signal-based form handling line items (item name, unit price, quantity, discount %).
4. Clear and modern UI styling compatible with Tailwind CSS or Angular Material.
Integrate this component with an injectable QuoteService that calls the shared backend API.
```