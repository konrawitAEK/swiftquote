package http

// End-to-end tests over Fiber and Postgres. The Spring and Node suites mirror these cases so all backends
// are held to the same behaviour. They need TEST_DATABASE_URL pointing at a database migrated with
// db/migrations (make test-go creates one); each test restores the seed with db/test/reset_to_seed.sql.

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/konrawitAEK/swiftquote/backend/go-service/internal/admin"
	"github.com/konrawitAEK/swiftquote/backend/go-service/internal/auth"
	"github.com/konrawitAEK/swiftquote/backend/go-service/internal/client"
	"github.com/konrawitAEK/swiftquote/backend/go-service/internal/dashboard"
	"github.com/konrawitAEK/swiftquote/backend/go-service/internal/quote"
	"github.com/konrawitAEK/swiftquote/backend/go-service/internal/storage/postgres"
)

const (
	acmeClient   = "00000000-0000-4000-8000-000000000003"
	globexClient = "00000000-0000-4000-8000-000000000004"
	teamAlpha    = "00000000-0000-4000-8000-000000000020"
	woUser       = "00000000-0000-4000-8000-000000000011"
	rm1User      = "00000000-0000-4000-8000-000000000012"
	adminUser    = "00000000-0000-4000-8000-000000000002"
)

type obj = map[string]any

type testEnv struct {
	t      *testing.T
	app    *fiber.App
	pool   *pgxpool.Pool
	tokens map[string]string
}

func newTestEnv(t *testing.T) *testEnv {
	t.Helper()
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("TEST_DATABASE_URL not set (run make test-go)")
	}
	pool, err := postgres.Connect(context.Background(), url)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	reset, err := os.ReadFile(filepath.Join("..", "..", "..", "..", "..", "db", "test", "reset_to_seed.sql"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(context.Background(), string(reset)); err != nil {
		t.Fatalf("reset db: %v", err)
	}
	store := postgres.New(pool)
	app := NewRouter(Deps{
		Auth:        auth.NewService(store, "test-secret-at-least-32-bytes-long"),
		Clients:     client.NewService(store),
		Quotes:      quote.NewService(store),
		Admin:       admin.NewService(store),
		Dashboard:   dashboard.NewService(store),
		CORSOrigins: "*",
		Ping:        pool.Ping,
	})
	return &testEnv{t: t, app: app, pool: pool, tokens: map[string]string{}}
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

// as logs in once per email (password "password") and returns the token.
func (e *testEnv) as(email string) string {
	e.t.Helper()
	if tok, ok := e.tokens[email]; ok {
		return tok
	}
	var res obj
	if s := e.do("POST", "/api/v1/auth/login", "", obj{"email": email, "password": "password"}, &res); s != 200 {
		e.t.Fatalf("login %s: status %d %v", email, s, res)
	}
	e.tokens[email] = res["accessToken"].(string)
	return e.tokens[email]
}

// expect asserts a status and, for errors, the ErrorResponse code; it returns the decoded body.
func (e *testEnv) expect(status int, code, method, path, token string, body any) obj {
	e.t.Helper()
	var res obj
	if s := e.do(method, path, token, body, &res); s != status {
		e.t.Fatalf("%s %s: status %d, want %d (%v)", method, path, s, status, res)
	}
	if code != "" && res["code"] != code {
		e.t.Fatalf("%s %s: code %v, want %s (%v)", method, path, res["code"], code, res)
	}
	return res
}

func inAMonth() string { return time.Now().UTC().AddDate(0, 1, 0).Format(dateLayout) }

func quoteBody(number string) obj {
	return obj{
		"clientId":    acmeClient,
		"quoteNumber": number,
		"expiryDate":  inAMonth(),
		"items": []obj{
			{"title": "Consulting", "quantity": 2, "unitPrice": 100, "discountPercent": 10},
			{"title": "Setup fee", "quantity": 1, "unitPrice": 1.5},
		},
	}
}

func (e *testEnv) create(rm, number string) string {
	e.t.Helper()
	return e.expect(201, "", "POST", "/api/v1/quotes", e.as(rm), quoteBody(number))["id"].(string)
}

// sent takes a new quote by rm1 through approval by wo and sends it; returns id and access token.
func (e *testEnv) sent(number string) (string, string) {
	e.t.Helper()
	id := e.create("rm1@swiftquote.dev", number)
	e.expect(200, "", "POST", "/api/v1/quotes/"+id+"/submit", e.as("rm1@swiftquote.dev"), nil)
	e.expect(200, "", "POST", "/api/v1/quotes/"+id+"/approve", e.as("wo@swiftquote.dev"), nil)
	q := e.expect(200, "", "POST", "/api/v1/quotes/"+id+"/send", e.as("rm1@swiftquote.dev"), nil)
	return id, q["accessToken"].(string)
}

func actions(q obj) []string {
	var out []string
	for _, ev := range q["history"].([]any) {
		out = append(out, ev.(obj)["action"].(string))
	}
	return out
}

func assertEq(t *testing.T, field string, got, want any) {
	t.Helper()
	if fmt.Sprint(got) != fmt.Sprint(want) {
		t.Errorf("%s: got %v, want %v", field, got, want)
	}
}

func TestWorkflowFromDraftToAccepted(t *testing.T) {
	e := newTestEnv(t)
	rm, wo := e.as("rm1@swiftquote.dev"), e.as("wo@swiftquote.dev")

	q := e.expect(201, "", "POST", "/api/v1/quotes", rm, quoteBody("Q-001"))
	id, link := q["id"].(string), q["accessToken"].(string)
	assertEq(t, "status", q["status"], "draft")
	assertEq(t, "createdBy", q["createdBy"].(obj)["name"], "Nok Rattana")
	assertEq(t, "clientName", q["clientName"], "Acme Corporation")
	assertEq(t, "grandTotal", q["grandTotal"], 194.21)
	assertEq(t, "history", actions(q), []string{"created"})

	// Drafts are not reachable through the share link.
	e.expect(404, "NOT_FOUND", "GET", "/api/v1/public/quotes/"+link, "", nil)

	e.expect(200, "", "POST", "/api/v1/quotes/"+id+"/submit", rm, nil)
	e.expect(409, "CONFLICT", "PUT", "/api/v1/quotes/"+id, rm, quoteBody("Q-001"))
	e.expect(404, "NOT_FOUND", "POST", "/api/v1/quotes/"+id+"/approve", e.as("wo2@swiftquote.dev"), nil)
	e.expect(400, "VALIDATION_ERROR", "POST", "/api/v1/quotes/"+id+"/return", wo, obj{"comment": "  "})
	q = e.expect(200, "", "POST", "/api/v1/quotes/"+id+"/return", wo, obj{"comment": "Discount too high"})
	assertEq(t, "status after return", q["status"], "draft")
	last := q["history"].([]any)[2].(obj)
	assertEq(t, "return comment", last["comment"], "Discount too high")
	assertEq(t, "return actor", last["actor"].(obj)["name"], "Somchai Wong")

	body := quoteBody("Q-001")
	body["items"] = []obj{{"title": "Consulting", "quantity": 2, "unitPrice": 100, "discountPercent": 5}}
	q = e.expect(200, "", "PUT", "/api/v1/quotes/"+id, rm, body)
	assertEq(t, "grandTotal after edit", q["grandTotal"], 203.30)

	e.expect(409, "CONFLICT", "POST", "/api/v1/quotes/"+id+"/send", rm, nil)
	e.expect(200, "", "POST", "/api/v1/quotes/"+id+"/submit", rm, obj{"comment": "Reduced discount"})
	e.expect(200, "", "POST", "/api/v1/quotes/"+id+"/approve", wo, nil)
	q = e.expect(200, "", "POST", "/api/v1/quotes/"+id+"/send", rm, nil)
	assertEq(t, "history", actions(q), []string{"created", "submitted", "returned", "updated", "submitted", "approved", "sent"})

	// The customer of another client cannot see it; Acme's customer can, and opening it marks it viewed.
	e.expect(404, "NOT_FOUND", "GET", "/api/v1/quotes/"+id, e.as("buyer@globex.example"), nil)
	customer := e.as("buyer@acme.example")
	var list []obj
	e.do("GET", "/api/v1/quotes", customer, nil, &list)
	assertEq(t, "customer list", len(list), 1)
	q = e.expect(200, "", "GET", "/api/v1/quotes/"+id, customer, nil)
	assertEq(t, "status after customer opens", q["status"], "viewed")
	assertEq(t, "customer history", actions(q), []string{"sent", "viewed"})

	sign := obj{"signerName": "Alice Acme", "signatureDataUrl": "data:image/png;base64,AAAA"}
	e.expect(403, "FORBIDDEN", "POST", "/api/v1/quotes/"+id+"/accept", rm, sign)
	q = e.expect(200, "", "POST", "/api/v1/quotes/"+id+"/accept", customer, sign)
	assertEq(t, "status", q["status"], "accepted")
	assertEq(t, "signedBy", q["signedBy"], "Alice Acme")
	e.expect(409, "CONFLICT", "POST", "/api/v1/quotes/"+id+"/accept", customer, sign)

	q = e.expect(200, "", "GET", "/api/v1/quotes/"+id, rm, nil)
	assertEq(t, "rm sees full history", actions(q),
		[]string{"created", "submitted", "returned", "updated", "submitted", "approved", "sent", "viewed", "accepted"})
}

func TestVisibilityByRole(t *testing.T) {
	e := newTestEnv(t)
	e.create("rm1@swiftquote.dev", "Q-RM1")
	e.create("rm3@swiftquote.dev", "Q-RM3")

	for email, want := range map[string][]string{
		"rm1@swiftquote.dev":   {"Q-RM1"},
		"rm2@swiftquote.dev":   {},
		"rm3@swiftquote.dev":   {"Q-RM3"},
		"wo@swiftquote.dev":    {"Q-RM1"},
		"wo2@swiftquote.dev":   {"Q-RM3"},
		"woc@swiftquote.dev":   {"Q-RM3", "Q-RM1"},
		"buyer@acme.example":   {},
		"buyer@globex.example": {},
	} {
		var list []obj
		if s := e.do("GET", "/api/v1/quotes", e.as(email), nil, &list); s != 200 {
			t.Fatalf("%s: status %d", email, s)
		}
		got := []string{}
		for _, q := range list {
			got = append(got, q["quoteNumber"].(string))
		}
		assertEq(t, email, got, want)
	}
	e.expect(403, "FORBIDDEN", "GET", "/api/v1/quotes", e.as("demo@swiftquote.dev"), nil)
}

func TestRolePermissions(t *testing.T) {
	e := newTestEnv(t)
	id := e.create("rm1@swiftquote.dev", "Q-PERM")
	cases := []struct {
		name, method, path, email string
		body                      any
	}{
		{"wo cannot create", "POST", "/api/v1/quotes", "wo@swiftquote.dev", quoteBody("X")},
		{"woc cannot create", "POST", "/api/v1/quotes", "woc@swiftquote.dev", quoteBody("X")},
		{"admin cannot create", "POST", "/api/v1/quotes", "demo@swiftquote.dev", quoteBody("X")},
		{"customer cannot create", "POST", "/api/v1/quotes", "buyer@acme.example", quoteBody("X")},
		{"admin cannot read quotes", "GET", "/api/v1/quotes/" + id, "demo@swiftquote.dev", nil},
		{"woc cannot approve", "POST", "/api/v1/quotes/" + id + "/approve", "woc@swiftquote.dev", nil},
		{"rm cannot approve", "POST", "/api/v1/quotes/" + id + "/approve", "rm1@swiftquote.dev", nil},
		{"wo cannot submit", "POST", "/api/v1/quotes/" + id + "/submit", "wo@swiftquote.dev", nil},
		{"wo cannot list clients", "GET", "/api/v1/clients", "wo@swiftquote.dev", nil},
		{"rm cannot see dashboard", "GET", "/api/v1/dashboard/summary", "rm1@swiftquote.dev", nil},
		{"admin cannot see dashboard", "GET", "/api/v1/dashboard/summary", "demo@swiftquote.dev", nil},
		{"woc cannot manage users", "GET", "/api/v1/admin/users", "woc@swiftquote.dev", nil},
		{"rm cannot manage teams", "POST", "/api/v1/admin/teams", "rm1@swiftquote.dev", obj{"name": "X", "woUserId": woUser}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			e.expect(403, "FORBIDDEN", tc.method, tc.path, e.as(tc.email), tc.body)
		})
	}
}

func TestSubmitRequiresTeamWithWO(t *testing.T) {
	e := newTestEnv(t)
	e.expect(201, "", "POST", "/api/v1/admin/users", e.as("demo@swiftquote.dev"),
		obj{"email": "Solo@SwiftQuote.dev", "name": "Solo RM", "password": "password", "role": "rm"})
	id := e.create("solo@swiftquote.dev", "Q-SOLO")
	res := e.expect(409, "CONFLICT", "POST", "/api/v1/quotes/"+id+"/submit", e.as("solo@swiftquote.dev"), nil)
	assertEq(t, "message", res["message"], "conflict: you must be in a team led by a WO to submit")
}

func TestPublicLink(t *testing.T) {
	e := newTestEnv(t)
	_, link := e.sent("Q-LINK")

	v := e.expect(200, "", "GET", "/api/v1/public/quotes/"+link, "", nil)
	assertEq(t, "status", v["status"], "viewed")
	q := e.expect(200, "", "POST", "/api/v1/public/quotes/"+link+"/reject", "", obj{"comment": "Too expensive"})
	assertEq(t, "status", q["status"], "rejected")
	last := q["history"].([]any)[len(q["history"].([]any))-1].(obj)
	assertEq(t, "reject comment", last["comment"], "Too expensive")
	if last["actor"] != nil {
		t.Errorf("link actor: got %v, want null", last["actor"])
	}
	e.expect(409, "CONFLICT", "POST", "/api/v1/public/quotes/"+link+"/accept", "",
		obj{"signerName": "A", "signatureDataUrl": "data:x"})
	e.expect(404, "NOT_FOUND", "GET", "/api/v1/public/quotes/not-a-uuid", "", nil)
}

func TestSendRejectsExpiredQuote(t *testing.T) {
	e := newTestEnv(t)
	id := e.create("rm1@swiftquote.dev", "Q-OLD")
	if _, err := e.pool.Exec(context.Background(),
		`UPDATE quotes SET status = 'approved', expiry_date = current_date - 1 WHERE id = $1`, id); err != nil {
		t.Fatal(err)
	}
	res := e.expect(409, "CONFLICT", "POST", "/api/v1/quotes/"+id+"/send", e.as("rm1@swiftquote.dev"), nil)
	assertEq(t, "message", res["message"], "conflict: quote has expired")
}

func TestAdminManagesUsersAndTeams(t *testing.T) {
	e := newTestEnv(t)
	adm := e.as("demo@swiftquote.dev")

	var users []obj
	e.do("GET", "/api/v1/admin/users", adm, nil, &users)
	assertEq(t, "seeded users", len(users), 9)

	u := e.expect(201, "", "POST", "/api/v1/admin/users", adm,
		obj{"email": "new.rm@swiftquote.dev", "name": "New RM", "password": "password1", "role": "rm", "teamId": teamAlpha})
	assertEq(t, "team", u["team"].(obj)["name"], "Team Alpha")
	e.expect(409, "CONFLICT", "POST", "/api/v1/admin/users", adm,
		obj{"email": "NEW.RM@swiftquote.dev", "name": "Dup", "password": "password1", "role": "rm"})

	for name, body := range map[string]obj{
		"short password":        {"email": "a@b.c", "name": "A", "password": "short", "role": "rm"},
		"invalid role":          {"email": "a@b.c", "name": "A", "password": "password", "role": "boss"},
		"customer needs client": {"email": "a@b.c", "name": "A", "password": "password", "role": "customer"},
		"team only for rm":      {"email": "a@b.c", "name": "A", "password": "password", "role": "wo", "teamId": teamAlpha},
		"client only customer":  {"email": "a@b.c", "name": "A", "password": "password", "role": "rm", "clientId": globexClient},
	} {
		t.Run(name, func(t *testing.T) {
			e.expect(400, "VALIDATION_ERROR", "POST", "/api/v1/admin/users", adm, body)
		})
	}

	e.expect(400, "VALIDATION_ERROR", "PUT", "/api/v1/admin/users/"+adminUser, adm,
		obj{"name": "Demo Admin", "role": "admin", "active": false})
	e.expect(409, "CONFLICT", "PUT", "/api/v1/admin/users/"+woUser, adm,
		obj{"name": "Somchai Wong", "role": "rm", "active": true})
	e.expect(404, "NOT_FOUND", "PUT", "/api/v1/admin/users/00000000-0000-4000-8000-0000000000ff", adm,
		obj{"name": "X", "role": "rm", "active": true})

	// Deactivating someone ends their existing session and blocks login.
	rmToken := e.as("rm1@swiftquote.dev")
	u = e.expect(200, "", "PUT", "/api/v1/admin/users/"+rm1User, adm,
		obj{"name": "Nok Rattana", "role": "rm", "active": false, "teamId": teamAlpha})
	assertEq(t, "active", u["active"], false)
	e.expect(401, "UNAUTHORIZED", "GET", "/api/v1/quotes", rmToken, nil)
	e.expect(401, "UNAUTHORIZED", "POST", "/api/v1/auth/login", "", obj{"email": "rm1@swiftquote.dev", "password": "password"})

	e.expect(400, "VALIDATION_ERROR", "POST", "/api/v1/admin/teams", adm, obj{"name": "Gamma", "woUserId": rm1User})
	team := e.expect(201, "", "POST", "/api/v1/admin/teams", adm,
		obj{"name": "Gamma", "woUserId": "00000000-0000-4000-8000-000000000014"})
	assertEq(t, "team wo", team["wo"].(obj)["name"], "Anan Boon")
	e.expect(409, "CONFLICT", "POST", "/api/v1/admin/teams", adm, obj{"name": "Team Alpha", "woUserId": woUser})
	team = e.expect(200, "", "PUT", "/api/v1/admin/teams/"+team["id"].(string), adm, obj{"name": "Gamma Team", "woUserId": woUser})
	assertEq(t, "renamed", team["name"], "Gamma Team")

	var teams []obj
	e.do("GET", "/api/v1/admin/teams", adm, nil, &teams)
	assertEq(t, "teams", len(teams), 3)
	assertEq(t, "alpha members", len(teams[1]["members"].([]any)), 2) // New RM + Ploy; Nok is inactive
}

func TestDashboard(t *testing.T) {
	e := newTestEnv(t)
	customer := e.as("buyer@acme.example")
	sign := obj{"signerName": "Alice", "signatureDataUrl": "data:x"}

	a, _ := e.sent("Q-A")
	e.expect(200, "", "POST", "/api/v1/quotes/"+a+"/accept", customer, sign)
	b, _ := e.sent("Q-B")
	e.expect(200, "", "POST", "/api/v1/quotes/"+b+"/reject", customer, nil)
	_, _ = e.sent("Q-C")
	e.create("rm1@swiftquote.dev", "Q-D") // draft
	e.create("rm3@swiftquote.dev", "Q-E") // draft, Team Beta

	woc := e.as("woc@swiftquote.dev")
	s := e.expect(200, "", "GET", "/api/v1/dashboard/summary", woc, nil)
	assertEq(t, "acceptedCount", s["acceptedCount"], 1)
	assertEq(t, "acceptedAmount", s["acceptedAmount"], 194.21)
	assertEq(t, "sentCount", s["sentCount"], 3)
	assertEq(t, "conversionRate", s["conversionRate"], 0.3333)
	assertEq(t, "byStatus length", len(s["byStatus"].([]any)), 8)
	assertEq(t, "draft count", s["byStatus"].([]any)[0].(obj)["count"], 2)
	assertEq(t, "byMonth", len(s["byMonth"].([]any)), 1)
	rms := s["byRm"].([]any)
	assertEq(t, "top rm", rms[0].(obj)["user"].(obj)["name"], "Nok Rattana")
	assertEq(t, "top rm quotes", rms[0].(obj)["quoteCount"], 4)
	assertEq(t, "top rm sent", rms[0].(obj)["sentCount"], 3)
	assertEq(t, "rms", len(rms), 2)
	teams := s["byTeam"].([]any)
	assertEq(t, "top team", teams[0].(obj)["name"], "Team Alpha")
	assertEq(t, "top team amount", teams[0].(obj)["acceptedAmount"], 194.21)

	future := time.Now().UTC().AddDate(1, 0, 0).Format(dateLayout)
	s = e.expect(200, "", "GET", "/api/v1/dashboard/summary?from="+future, woc, nil)
	assertEq(t, "future range", s["sentCount"], 0)
	assertEq(t, "future rate", s["conversionRate"], 0)
	e.expect(400, "VALIDATION_ERROR", "GET", "/api/v1/dashboard/summary?from=2026-12-01&to=2026-01-01", woc, nil)
	e.expect(400, "VALIDATION_ERROR", "GET", "/api/v1/dashboard/summary?from=yesterday", woc, nil)
}

func TestErrorResponses(t *testing.T) {
	e := newTestEnv(t)
	rm := e.as("rm1@swiftquote.dev")
	e.create("rm1@swiftquote.dev", "Q-DUP")
	cases := []struct {
		name, method, path, token string
		body                      any
		status                    int
		code                      string
	}{
		{"wrong password", "POST", "/api/v1/auth/login", "", obj{"email": "rm1@swiftquote.dev", "password": "nope"}, 401, "UNAUTHORIZED"},
		{"no token", "GET", "/api/v1/quotes", "", nil, 401, "UNAUTHORIZED"},
		{"bad token", "GET", "/api/v1/quotes", "garbage", nil, 401, "UNAUTHORIZED"},
		{"unknown route", "GET", "/api/v1/nope", "", nil, 404, "NOT_FOUND"},
		{"invalid status filter", "GET", "/api/v1/quotes?status=bogus", rm, nil, 400, "VALIDATION_ERROR"},
		{"duplicate number", "POST", "/api/v1/quotes", rm, quoteBody("Q-DUP"), 409, "CONFLICT"},
		{"missing fields", "POST", "/api/v1/quotes", rm, obj{"quoteNumber": " ", "items": []obj{{"title": ""}}}, 400, "VALIDATION_ERROR"},
		{"other tenant client", "POST", "/api/v1/quotes", rm, func() obj {
			b := quoteBody("Q-X")
			b["clientId"] = "00000000-0000-4000-8000-0000000000ff"
			return b
		}(), 400, "VALIDATION_ERROR"},
		{"unknown quote", "GET", "/api/v1/quotes/00000000-0000-4000-8000-0000000000ff", rm, nil, 404, "NOT_FOUND"},
		{"malformed quote id", "GET", "/api/v1/quotes/nope", rm, nil, 404, "NOT_FOUND"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			res := e.expect(tc.status, tc.code, tc.method, tc.path, tc.token, tc.body)
			if msg, _ := res["message"].(string); msg == "" {
				t.Error("message must be non-empty")
			}
		})
	}

	req := httptest.NewRequest("POST", "/api/v1/quotes", bytes.NewReader([]byte("{not json")))
	req.Header.Set("Authorization", "Bearer "+rm)
	resp, _ := e.app.Test(req, -1)
	assertEq(t, "malformed JSON", resp.StatusCode, 400)
}
