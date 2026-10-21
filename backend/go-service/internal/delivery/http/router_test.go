package http

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/shopspring/decimal"

	"github.com/konrawitAEK/swiftquote/backend/go-service/internal/auth"
	"github.com/konrawitAEK/swiftquote/backend/go-service/internal/client"
	"github.com/konrawitAEK/swiftquote/backend/go-service/internal/domain"
	"github.com/konrawitAEK/swiftquote/backend/go-service/internal/quote"
	"github.com/konrawitAEK/swiftquote/backend/go-service/internal/storage/memory"
	"github.com/konrawitAEK/swiftquote/backend/go-service/internal/storage/postgres"
)

type testStore interface {
	auth.Repository
	client.Repository
	quote.Repository
	PutOrganization(context.Context, domain.Organization) error
	PutUser(context.Context, domain.User, domain.Membership) error
	PutClient(context.Context, domain.Client) error
}

type testEnv struct {
	t     *testing.T
	app   *fiber.App
	store testStore
}

// eachStore runs fn against the memory store, and against Postgres when TEST_DATABASE_URL
// points at a database migrated with db/migrations (including the V3 demo seed).
func eachStore(t *testing.T, fn func(t *testing.T, e *testEnv)) {
	t.Run("memory", func(t *testing.T) {
		mem := memory.NewStore()
		mem.Seed()
		fn(t, newTestEnv(t, mem))
	})
	t.Run("postgres", func(t *testing.T) {
		url := os.Getenv("TEST_DATABASE_URL")
		if url == "" {
			t.Skip("TEST_DATABASE_URL not set")
		}
		pool, err := postgres.Connect(context.Background(), url)
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(pool.Close)
		resetDB(t, pool)
		fn(t, newTestEnv(t, postgres.New(pool)))
	})
}

// resetDB removes everything except the demo seed.
func resetDB(t *testing.T, pool *pgxpool.Pool) {
	t.Helper()
	stmts := []struct {
		sql string
		arg any
	}{
		{"DELETE FROM quotes", nil},
		{"DELETE FROM clients WHERE id <> $1", memory.DemoClientID},
		{"DELETE FROM users WHERE id <> $1", memory.DemoUserID},
		{"DELETE FROM organizations WHERE id <> $1", memory.DemoOrgID},
	}
	for _, st := range stmts {
		args := []any{}
		if st.arg != nil {
			args = append(args, st.arg)
		}
		if _, err := pool.Exec(context.Background(), st.sql, args...); err != nil {
			t.Fatalf("reset db: %s: %v", st.sql, err)
		}
	}
}

func newTestEnv(t *testing.T, store testStore) *testEnv {
	t.Helper()
	app := NewRouter(Deps{
		Auth:        auth.NewService(store, "test-secret-at-least-32-bytes-long"),
		Clients:     client.NewService(store),
		Quotes:      quote.NewService(store),
		CORSOrigins: "*",
		Storage:     "memory",
		Ping:        func(context.Context) error { return nil },
	})
	return &testEnv{t: t, app: app, store: store}
}

// do sends a request and decodes the JSON response into out (if non-nil), returning the status.
func (e *testEnv) do(method, path, token string, body any, out any) int {
	e.t.Helper()
	var r io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			e.t.Fatalf("marshal: %v", err)
		}
		r = bytes.NewReader(b)
	}
	req := httptest.NewRequest(method, path, r)
	req.Header.Set("Content-Type", "application/json")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	resp, err := e.app.Test(req, -1)
	if err != nil {
		e.t.Fatalf("%s %s: %v", method, path, err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	if out != nil {
		if err := json.Unmarshal(raw, out); err != nil {
			e.t.Fatalf("%s %s: decode %q: %v", method, path, raw, err)
		}
	}
	return resp.StatusCode
}

func (e *testEnv) login() string {
	e.t.Helper()
	var res map[string]any
	status := e.do("POST", "/api/v1/auth/login", "", map[string]string{
		"email": memory.DemoEmail, "password": memory.DemoPassword,
	}, &res)
	if status != 200 {
		e.t.Fatalf("login status %d: %v", status, res)
	}
	return res["accessToken"].(string)
}

func validQuoteBody(number string) map[string]any {
	return map[string]any{
		"clientId":    memory.DemoClientID,
		"quoteNumber": number,
		"expiryDate":  time.Now().AddDate(0, 1, 0).Format(dateLayout),
		"items": []map[string]any{
			{"title": "Consulting", "quantity": 2, "unitPrice": 100, "discountPercent": 10},
			{"title": "Setup fee", "quantity": 1, "unitPrice": 1.5},
		},
	}
}

func TestQuoteLifecycle(t *testing.T) {
	eachStore(t, func(t *testing.T, e *testEnv) {
		token := e.login()

		var created map[string]any
		if s := e.do("POST", "/api/v1/quotes", token, validQuoteBody("Q-001"), &created); s != 201 {
			t.Fatalf("create status %d: %v", s, created)
		}
		// 200 - 20 + 1.50 = 181.50 net; tax 12.60 + 0.11 (taxPercent defaults to 7).
		assertJSON(t, created, "subtotal", 201.5)
		assertJSON(t, created, "discountAmount", 20.0)
		assertJSON(t, created, "taxAmount", 12.71)
		assertJSON(t, created, "grandTotal", 194.21)
		assertJSON(t, created, "status", "draft")
		if created["signedAt"] != nil {
			t.Errorf("signedAt: got %v, want null", created["signedAt"])
		}
		accessToken := created["accessToken"].(string)
		quoteID := created["id"].(string)

		var detail map[string]any
		if s := e.do("GET", "/api/v1/quotes/"+quoteID, token, nil, &detail); s != 200 {
			t.Fatalf("get status %d: %v", s, detail)
		}
		assertJSON(t, detail, "accessToken", accessToken)
		assertJSON(t, detail, "grandTotal", 194.21)
		assertJSON(t, detail, "expiryDate", validQuoteBody("x")["expiryDate"])
		if items, _ := detail["items"].([]any); len(items) != 2 || items[0].(map[string]any)["title"] != "Consulting" {
			t.Errorf("items not returned in submitted order: %v", detail["items"])
		}

		var clients []map[string]any
		if s := e.do("GET", "/api/v1/clients", token, nil, &clients); s != 200 || len(clients) != 1 {
			t.Fatalf("clients status %d, %d rows", s, len(clients))
		}
		assertJSON(t, clients[0], "name", "Acme Corporation")
		assertJSON(t, clients[0], "email", "buyer@acme.example")

		var list []map[string]any
		if s := e.do("GET", "/api/v1/quotes", token, nil, &list); s != 200 || len(list) != 1 {
			t.Fatalf("list status %d, %d rows", s, len(list))
		}
		assertJSON(t, list[0], "clientName", "Acme Corporation")

		var public map[string]any
		if s := e.do("GET", "/api/v1/public/quotes/"+accessToken, "", nil, &public); s != 200 {
			t.Fatalf("public status %d: %v", s, public)
		}
		assertJSON(t, public, "vendorName", "Demo Co., Ltd.")
		assertJSON(t, public, "status", "draft")
		if public["signedBy"] != nil {
			t.Errorf("signedBy before accept: got %v, want null", public["signedBy"])
		}
		assertJSON(t, public, "grandTotal", 194.21)

		accept := map[string]string{"signerName": "Jane Buyer", "signatureDataUrl": "data:image/png;base64,AAAA"}
		var accepted map[string]any
		if s := e.do("POST", "/api/v1/public/quotes/"+accessToken+"/accept", "", accept, &accepted); s != 200 {
			t.Fatalf("accept status %d: %v", s, accepted)
		}
		assertJSON(t, accepted, "status", "accepted")
		if accepted["signedAt"] == nil {
			t.Error("signedAt should be set after accept")
		}

		var errBody map[string]any
		if s := e.do("POST", "/api/v1/public/quotes/"+accessToken+"/accept", "", accept, &errBody); s != 409 {
			t.Fatalf("second accept: got %d, want 409", s)
		}
		assertJSON(t, errBody, "code", "CONFLICT")

		// The portal must be able to show that the quote is already signed.
		public = nil
		e.do("GET", "/api/v1/public/quotes/"+accessToken, "", nil, &public)
		assertJSON(t, public, "status", "accepted")
		assertJSON(t, public, "signedBy", "Jane Buyer")
		e.do("GET", "/api/v1/quotes/"+quoteID, token, nil, &detail)
		assertJSON(t, detail, "signedBy", "Jane Buyer")
	})
}

func TestErrorResponses(t *testing.T) {
	eachStore(t, func(t *testing.T, e *testEnv) {
		token := e.login()
		e.do("POST", "/api/v1/quotes", token, validQuoteBody("Q-DUP"), nil)

		ctx := context.Background()
		otherOrg, otherOrgClient := uuid.New(), uuid.New()
		mustPut(t, e.store.PutOrganization(ctx, domain.Organization{ID: otherOrg, Name: "Other tenant"}))
		mustPut(t, e.store.PutClient(ctx, domain.Client{ID: otherOrgClient, OrganizationID: otherOrg, Name: "Other client"}))

		expiredToken := uuid.New()
		err := e.store.Create(ctx, &domain.Quote{
			ID: uuid.New(), OrganizationID: memory.DemoOrgID, ClientID: memory.DemoClientID,
			QuoteNumber: "Q-OLD", Status: domain.StatusSent, AccessToken: expiredToken,
			ExpiryDate: time.Now().AddDate(0, 0, -1), GrandTotal: decimal.Zero,
		})
		if err != nil {
			t.Fatal(err)
		}

		withBody := func(mutate func(map[string]any)) map[string]any {
			b := validQuoteBody("Q-NEW")
			mutate(b)
			return b
		}

		tests := []struct {
			name, method, path, token string
			body                      any
			wantStatus                int
			wantCode                  string
		}{
			{"wrong password", "POST", "/api/v1/auth/login", "", map[string]string{"email": memory.DemoEmail, "password": "nope"}, 401, "UNAUTHORIZED"},
			{"unknown email", "POST", "/api/v1/auth/login", "", map[string]string{"email": "x@y.z", "password": "password"}, 401, "UNAUTHORIZED"},
			{"list without token", "GET", "/api/v1/quotes", "", nil, 401, "UNAUTHORIZED"},
			{"clients without token", "GET", "/api/v1/clients", "", nil, 401, "UNAUTHORIZED"},
			{"get quote without token", "GET", "/api/v1/quotes/" + uuid.NewString(), "", nil, 401, "UNAUTHORIZED"},
			{"unknown quote id", "GET", "/api/v1/quotes/" + uuid.NewString(), token, nil, 404, "NOT_FOUND"},
			{"malformed quote id", "GET", "/api/v1/quotes/not-a-uuid", token, nil, 404, "NOT_FOUND"},
			{"unknown route", "GET", "/api/v1/nope", "", nil, 404, "NOT_FOUND"},
			{"list with bad token", "GET", "/api/v1/quotes", "garbage", nil, 401, "UNAUTHORIZED"},
			{"invalid status filter", "GET", "/api/v1/quotes?status=bogus", token, nil, 400, "VALIDATION_ERROR"},
			{"create without token", "POST", "/api/v1/quotes", "", validQuoteBody("Q-X"), 401, "UNAUTHORIZED"},
			{"duplicate quote number", "POST", "/api/v1/quotes", token, validQuoteBody("Q-DUP"), 409, "CONFLICT"},
			{"no items", "POST", "/api/v1/quotes", token, withBody(func(b map[string]any) { b["items"] = []any{} }), 400, "VALIDATION_ERROR"},
			{"missing clientId", "POST", "/api/v1/quotes", token, withBody(func(b map[string]any) { delete(b, "clientId") }), 400, "VALIDATION_ERROR"},
			{"client of another tenant", "POST", "/api/v1/quotes", token, withBody(func(b map[string]any) { b["clientId"] = otherOrgClient }), 400, "VALIDATION_ERROR"},
			{"past expiry", "POST", "/api/v1/quotes", token, withBody(func(b map[string]any) { b["expiryDate"] = "2000-01-01" }), 400, "VALIDATION_ERROR"},
			{"bad date format", "POST", "/api/v1/quotes", token, withBody(func(b map[string]any) { b["expiryDate"] = "01/01/2099" }), 400, "VALIDATION_ERROR"},
			{"quantity below 1", "POST", "/api/v1/quotes", token, withBody(func(b map[string]any) {
				b["items"] = []map[string]any{{"title": "x", "quantity": 0, "unitPrice": 1}}
			}), 400, "VALIDATION_ERROR"},
			{"unknown access token", "GET", "/api/v1/public/quotes/" + uuid.NewString(), "", nil, 404, "NOT_FOUND"},
			{"malformed access token", "GET", "/api/v1/public/quotes/not-a-uuid", "", nil, 404, "NOT_FOUND"},
			{"expired quote", "GET", "/api/v1/public/quotes/" + expiredToken.String(), "", nil, 404, "NOT_FOUND"},
			{"accept expired quote", "POST", "/api/v1/public/quotes/" + expiredToken.String() + "/accept", "",
				map[string]string{"signerName": "A", "signatureDataUrl": "data:x"}, 404, "NOT_FOUND"},
			{"accept without signature", "POST", "/api/v1/public/quotes/" + uuid.NewString() + "/accept", "",
				map[string]string{"signerName": "A"}, 400, "VALIDATION_ERROR"},
		}
		for _, tc := range tests {
			t.Run(tc.name, func(t *testing.T) {
				var body map[string]any
				if s := e.do(tc.method, tc.path, tc.token, tc.body, &body); s != tc.wantStatus {
					t.Fatalf("status: got %d, want %d (%v)", s, tc.wantStatus, body)
				}
				assertJSON(t, body, "code", tc.wantCode)
				if msg, _ := body["message"].(string); msg == "" {
					t.Error("message must be non-empty")
				}
			})
		}
	})
}

func TestQuotesAreTenantScoped(t *testing.T) {
	eachStore(t, func(t *testing.T, e *testEnv) {
		var mine map[string]any
		e.do("POST", "/api/v1/quotes", e.login(), validQuoteBody("Q-001"), &mine)

		otherOrg, otherUser := uuid.New(), uuid.New()
		ctx := context.Background()
		mustPut(t, e.store.PutOrganization(ctx, domain.Organization{ID: otherOrg, Name: "Other"}))
		// Reuses the demo bcrypt hash so the password is also "password".
		demo, _, err := e.store.FindLogin(ctx, memory.DemoEmail)
		mustPut(t, err)
		mustPut(t, e.store.PutUser(ctx,
			domain.User{ID: otherUser, Email: "other@example.com", PasswordHash: demo.PasswordHash, FullName: "Other"},
			domain.Membership{OrganizationID: otherOrg, UserID: otherUser, Role: domain.RoleOwner},
		))

		var res map[string]any
		e.do("POST", "/api/v1/auth/login", "", map[string]string{"email": "other@example.com", "password": memory.DemoPassword}, &res)
		otherToken := res["accessToken"].(string)
		var errBody map[string]any
		if s := e.do("GET", "/api/v1/quotes/"+mine["id"].(string), otherToken, nil, &errBody); s != 404 {
			t.Fatalf("other tenant reading a quote by id: got %d, want 404", s)
		}
		var list []map[string]any
		if s := e.do("GET", "/api/v1/quotes", otherToken, nil, &list); s != 200 || len(list) != 0 {
			t.Fatalf("other tenant sees %d quotes (status %d), want 0", len(list), s)
		}
		var clients []map[string]any
		if s := e.do("GET", "/api/v1/clients", otherToken, nil, &clients); s != 200 || len(clients) != 0 {
			t.Fatalf("other tenant sees %d clients (status %d), want 0", len(clients), s)
		}
	})
}

func TestPublicViewMarksSentQuoteViewed(t *testing.T) {
	eachStore(t, func(t *testing.T, e *testEnv) {
		token := uuid.New()
		id := uuid.New()
		if err := e.store.Create(context.Background(), &domain.Quote{
			ID: id, OrganizationID: memory.DemoOrgID, ClientID: memory.DemoClientID, QuoteNumber: "Q-SENT",
			Status: domain.StatusSent, AccessToken: token, ExpiryDate: time.Now().AddDate(0, 1, 0),
		}); err != nil {
			t.Fatal(err)
		}

		e.do("GET", "/api/v1/public/quotes/"+token.String(), "", nil, nil)

		v, err := e.store.GetPublic(context.Background(), token)
		if err != nil {
			t.Fatal(err)
		}
		if v.Quote.Status != domain.StatusViewed {
			t.Fatalf("status: got %s, want viewed", v.Quote.Status)
		}
	})
}

func mustPut(t *testing.T, err error) {
	t.Helper()
	if err != nil {
		t.Fatal(err)
	}
}

func assertJSON(t *testing.T, m map[string]any, key string, want any) {
	t.Helper()
	if got := m[key]; got != want {
		t.Errorf("%s: got %v (%T), want %v (%T)", key, got, got, want, want)
	}
}
