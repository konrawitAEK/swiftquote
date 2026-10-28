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
	"strings"
	"testing"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/konrawitAEK/swiftquote/backend/go-service/internal/admin"
	"github.com/konrawitAEK/swiftquote/backend/go-service/internal/auth"
	"github.com/konrawitAEK/swiftquote/backend/go-service/internal/catalog"
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
	catSoftware  = "00000000-0000-4000-8000-000000000030"
	catServices  = "00000000-0000-4000-8000-000000000031"
	catHardware  = "00000000-0000-4000-8000-000000000032"
	prodCRM      = "00000000-0000-4000-8000-000000000040" // Software, untracked
	prodConsult  = "00000000-0000-4000-8000-000000000043" // Services, untracked
	prodLaptop   = "00000000-0000-4000-8000-000000000044" // Hardware, stock 25
	prodMouse    = "00000000-0000-4000-8000-000000000045" // Hardware, stock 200
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
		Catalog:     catalog.NewService(store),
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
			{"productId": prodConsult, "quantity": 2, "unitPrice": 100, "discountValue": 10},
			{"productId": prodCRM, "quantity": 1, "unitPrice": 1.5},
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
	body["items"] = []obj{{"productId": prodConsult, "quantity": 2, "unitPrice": 100, "discountType": "percent", "discountValue": 5}}
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

	// Each quote is Consulting (Services) 192.60 + Setup fee (Software) 1.61 = 194.21 incl. VAT.
	a, _ := e.sent("Q-A")
	e.expect(200, "", "POST", "/api/v1/quotes/"+a+"/accept", customer, sign)
	b, _ := e.sent("Q-B")
	e.expect(200, "", "POST", "/api/v1/quotes/"+b+"/reject", customer, nil)
	_, _ = e.sent("Q-C") // pending: with the customer
	d := e.create("rm1@swiftquote.dev", "Q-D")
	e.expect(200, "", "POST", "/api/v1/quotes/"+d+"/submit", e.as("rm1@swiftquote.dev"), nil) // in approval
	e.create("rm3@swiftquote.dev", "Q-E")                                                     // draft, Team Beta

	// Cost and profit are before VAT, from lines with a unit cost. Consulting: 2 x 900 = 1800 against 180 (-1620);
	// CRM: 1 x 1800 = 1800 against 1.50 (-1798.50); so a whole quote costs 3600 for -3418.50 profit.
	// Q-A's CRM line predates products (no cost), leaving it 1800 / -1620.
	if _, err := e.pool.Exec(context.Background(),
		`UPDATE quote_items SET product_id = NULL, unit_cost = NULL WHERE quote_id = $1 AND position = 1`, a); err != nil {
		t.Fatal(err)
	}

	woc := e.as("woc@swiftquote.dev")
	s := e.expect(200, "", "GET", "/api/v1/dashboard/summary", woc, nil)
	measure := func(v any) string { m := v.(obj); return fmt.Sprintf("%v/%v", m["count"], m["amount"]) }
	costs := func(v any) string { m := v.(obj); return fmt.Sprintf("%v/%v", m["cost"], m["profit"]) }
	assertEq(t, "won cost", costs(s["won"]), "1800/-1620")
	assertEq(t, "pending cost", costs(s["pending"]), "3600/-3418.5")
	assertEq(t, "inApproval cost", costs(s["inApproval"]), "3600/-3418.5")
	assertEq(t, "won", measure(s["won"]), "1/194.21")
	assertEq(t, "pending", measure(s["pending"]), "1/194.21")
	assertEq(t, "inApproval", measure(s["inApproval"]), "1/194.21")
	assertEq(t, "sentCount", s["sentCount"], 3)
	assertEq(t, "conversionRate", s["conversionRate"], 0.3333)
	assertEq(t, "byStatus length", len(s["byStatus"].([]any)), 8)
	assertEq(t, "draft count", s["byStatus"].([]any)[0].(obj)["count"], 1)

	// Won is grouped by signing month (this month), pending by expiry month (next month).
	months := s["byMonth"].([]any)
	assertEq(t, "months", len(months), 2)
	assertEq(t, "this month won", measure(months[0].(obj)["won"]), "1/194.21")
	assertEq(t, "next month pending", measure(months[1].(obj)["pending"]), "1/194.21")
	assertEq(t, "this month won cost", costs(months[0].(obj)["won"]), "1800/-1620")
	assertEq(t, "this month pending cost", costs(months[0].(obj)["pending"]), "0/0")
	assertEq(t, "next month pending cost", costs(months[1].(obj)["pending"]), "3600/-3418.5")

	rms := s["byRm"].([]any)
	assertEq(t, "rms", len(rms), 2)
	top := rms[0].(obj)
	assertEq(t, "top rm", top["user"].(obj)["name"], "Nok Rattana")
	assertEq(t, "top rm quotes", top["quoteCount"], 4)
	assertEq(t, "top rm sent", top["sentCount"], 3)
	assertEq(t, "top rm pending", measure(top["pending"]), "1/194.21")
	assertEq(t, "top rm won cost", costs(top["won"]), "1800/-1620")
	assertEq(t, "top rm pending cost", costs(top["pending"]), "3600/-3418.5")
	assertEq(t, "other rm cost", costs(rms[1].(obj)["won"]), "0/0")
	alpha := s["byTeam"].([]any)[0].(obj)
	assertEq(t, "top team", alpha["name"], "Team Alpha")
	assertEq(t, "top team won cost", costs(alpha["won"]), "1800/-1620")
	assertEq(t, "top team pending cost", costs(alpha["pending"]), "3600/-3418.5")

	cats := s["byCategory"].([]any)
	assertEq(t, "categories", len(cats), 2)
	assertEq(t, "top category", cats[0].(obj)["category"].(obj)["name"], "Services")
	assertEq(t, "services won", measure(cats[0].(obj)["won"]), "1/192.6")
	assertEq(t, "software pending", measure(cats[1].(obj)["pending"]), "1/1.61")
	assertEq(t, "services won cost", costs(cats[0].(obj)["won"]), "1800/-1620")
	assertEq(t, "services pending cost", costs(cats[0].(obj)["pending"]), "1800/-1620")
	assertEq(t, "software won cost (uncosted line)", costs(cats[1].(obj)["won"]), "0/0")
	assertEq(t, "software pending cost", costs(cats[1].(obj)["pending"]), "1800/-1798.5")

	future := time.Now().UTC().AddDate(1, 0, 0).Format(dateLayout)
	s = e.expect(200, "", "GET", "/api/v1/dashboard/summary?from="+future, woc, nil)
	assertEq(t, "future range", s["sentCount"], 0)
	assertEq(t, "future rate", s["conversionRate"], 0)
	assertEq(t, "future won cost", costs(s["won"]), "0/0")
	e.expect(400, "VALIDATION_ERROR", "GET", "/api/v1/dashboard/summary?from=2026-12-01&to=2026-01-01", woc, nil)
	e.expect(400, "VALIDATION_ERROR", "GET", "/api/v1/dashboard/summary?from=yesterday", woc, nil)
}

func TestCategories(t *testing.T) {
	e := newTestEnv(t)
	adm, rm := e.as("demo@swiftquote.dev"), e.as("rm1@swiftquote.dev")

	c := e.expect(201, "", "POST", "/api/v1/admin/categories", adm, obj{"name": " Training "})
	assertEq(t, "trimmed", c["name"], "Training")
	e.expect(409, "CONFLICT", "POST", "/api/v1/admin/categories", adm, obj{"name": "Software"})
	e.expect(400, "VALIDATION_ERROR", "POST", "/api/v1/admin/categories", adm, obj{"name": ""})
	e.expect(403, "FORBIDDEN", "POST", "/api/v1/admin/categories", rm, obj{"name": "X"})
	e.expect(400, "VALIDATION_ERROR", "PUT", "/api/v1/admin/categories/"+catSoftware, adm, obj{"name": "Software"})
	e.expect(404, "NOT_FOUND", "PUT", "/api/v1/admin/categories/00000000-0000-4000-8000-0000000000ff", adm,
		obj{"name": "X", "active": true})

	// Retiring a category keeps it listed but stops RMs from using it.
	c = e.expect(200, "", "PUT", "/api/v1/admin/categories/"+catSoftware, adm, obj{"name": "Software", "active": false})
	assertEq(t, "retired", c["active"], false)
	var list []obj
	e.do("GET", "/api/v1/categories", rm, nil, &list)
	assertEq(t, "rm sees all categories", len(list), 4)
	e.expect(403, "FORBIDDEN", "GET", "/api/v1/categories", e.as("wo@swiftquote.dev"), nil)

	// Products of a retired category stay usable; the line takes the product's category.
	q := e.expect(201, "", "POST", "/api/v1/quotes", rm, quoteBody("Q-CAT"))
	assertEq(t, "line category", q["items"].([]any)[1].(obj)["category"].(obj)["name"], "Software")
	// A new product cannot be put in a retired category.
	res := e.expect(400, "VALIDATION_ERROR", "POST", "/api/v1/admin/products", adm,
		obj{"name": "X", "categoryId": catSoftware, "unitPrice": 1, "unitCost": 1})
	assertEq(t, "retired category", res["details"], []any{"categoryId is not an active category"})
}

func TestAdminDeletes(t *testing.T) {
	e := newTestEnv(t)
	adm := e.as("demo@swiftquote.dev")
	del := func(status int, code, path string) obj {
		t.Helper()
		if status == 204 {
			if s := e.do("POST", path, adm, nil, nil); s != 204 {
				t.Fatalf("POST %s: status %d, want 204", path, s)
			}
			return nil
		}
		return e.expect(status, code, "POST", path, adm, nil)
	}

	// Users: only accounts nothing refers to; the rest are deactivated instead.
	u := e.expect(201, "", "POST", "/api/v1/admin/users", adm,
		obj{"email": "temp@swiftquote.dev", "name": "Temp", "password": "password", "role": "rm", "teamId": teamAlpha})
	e.expect(403, "FORBIDDEN", "POST", "/api/v1/admin/users/"+u["id"].(string)+"/delete", e.as("woc@swiftquote.dev"), nil)
	del(204, "", "/api/v1/admin/users/"+u["id"].(string)+"/delete")
	del(404, "NOT_FOUND", "/api/v1/admin/users/"+u["id"].(string)+"/delete")
	del(404, "NOT_FOUND", "/api/v1/admin/users/nope/delete")
	e.expect(401, "UNAUTHORIZED", "POST", "/api/v1/auth/login", "", obj{"email": "temp@swiftquote.dev", "password": "password"})
	res := del(400, "VALIDATION_ERROR", "/api/v1/admin/users/"+adminUser+"/delete")
	assertEq(t, "self", res["details"], []any{"you cannot delete yourself"})
	res = del(409, "CONFLICT", "/api/v1/admin/users/"+woUser+"/delete")
	assertEq(t, "leads team", res["message"], "conflict: user leads a team; assign another WO first")
	e.create("rm2@swiftquote.dev", "Q-DEL")
	res = del(409, "CONFLICT", "/api/v1/admin/users/00000000-0000-4000-8000-000000000013/delete")
	assertEq(t, "history", res["message"], "conflict: user has quote history; deactivate instead")

	// Teams: only empty ones.
	res = del(409, "CONFLICT", "/api/v1/admin/teams/"+teamAlpha+"/delete")
	assertEq(t, "members", res["message"], "conflict: team has members; move them to another team first")
	team := e.expect(201, "", "POST", "/api/v1/admin/teams", adm, obj{"name": "Empty", "woUserId": woUser})
	del(204, "", "/api/v1/admin/teams/"+team["id"].(string)+"/delete")
	del(404, "NOT_FOUND", "/api/v1/admin/teams/"+team["id"].(string)+"/delete")

	// Categories: only unused ones; the body is ignored, even when it is not JSON.
	res = del(409, "CONFLICT", "/api/v1/admin/categories/"+catServices+"/delete")
	assertEq(t, "used", res["message"], "conflict: category is used on quotes; retire it instead")
	c := e.expect(201, "", "POST", "/api/v1/admin/categories", adm, obj{"name": "Unused"})
	req := httptest.NewRequest("POST", "/api/v1/admin/categories/"+c["id"].(string)+"/delete", strings.NewReader("{nope"))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+adm)
	resp, err := e.app.Test(req, -1)
	if err != nil || resp.StatusCode != 204 {
		t.Fatalf("delete with malformed body: %v %v", resp.StatusCode, err)
	}
	del(404, "NOT_FOUND", "/api/v1/admin/categories/"+c["id"].(string)+"/delete")

	// A category no quote uses but a product does cannot be deleted either.
	c = e.expect(201, "", "POST", "/api/v1/admin/categories", adm, obj{"name": "Stocked"})
	p := e.expect(201, "", "POST", "/api/v1/admin/products", adm,
		obj{"name": "Cable", "categoryId": c["id"], "unitPrice": 10, "unitCost": 4})
	res = del(409, "CONFLICT", "/api/v1/admin/categories/"+c["id"].(string)+"/delete")
	assertEq(t, "used by products", res["message"], "conflict: category is used by products; move them to another category first")
	del(204, "", "/api/v1/admin/products/"+p["id"].(string)+"/delete")
	del(204, "", "/api/v1/admin/categories/"+c["id"].(string)+"/delete")
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

// raw sends a request and returns the status, headers and body without decoding.
func (e *testEnv) raw(method, path, token string) (int, map[string]string, []byte) {
	e.t.Helper()
	req := httptest.NewRequest(method, path, nil)
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	resp, err := e.app.Test(req, -1)
	if err != nil {
		e.t.Fatalf("%s %s: %v", method, path, err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	return resp.StatusCode, map[string]string{
		"Content-Type":        resp.Header.Get("Content-Type"),
		"Content-Disposition": resp.Header.Get("Content-Disposition"),
	}, body
}

func (e *testEnv) stock(productID string) string {
	e.t.Helper()
	var stock *string
	if err := e.pool.QueryRow(context.Background(), `SELECT stock::text FROM products WHERE id = $1`, productID).Scan(&stock); err != nil {
		e.t.Fatal(err)
	}
	if stock == nil {
		return "null"
	}
	return *stock
}

func (e *testEnv) setStock(productID, stock string) {
	e.t.Helper()
	if _, err := e.pool.Exec(context.Background(), `UPDATE products SET stock = $2::numeric WHERE id = $1`, productID, stock); err != nil {
		e.t.Fatal(err)
	}
}

func item(q obj, i int) obj { return q["items"].([]any)[i].(obj) }

func TestProducts(t *testing.T) {
	e := newTestEnv(t)
	adm := e.as("demo@swiftquote.dev")

	for _, email := range []string{"demo@swiftquote.dev", "woc@swiftquote.dev", "wo@swiftquote.dev", "rm1@swiftquote.dev"} {
		var list []obj
		if s := e.do("GET", "/api/v1/products", e.as(email), nil, &list); s != 200 {
			t.Fatalf("%s: status %d", email, s)
		}
		assertEq(t, email+" products", len(list), 6)
	}
	e.expect(403, "FORBIDDEN", "GET", "/api/v1/products", e.as("buyer@acme.example"), nil)

	var list []obj
	e.do("GET", "/api/v1/products", adm, nil, &list)
	assertEq(t, "ordered by name", list[0]["name"], "CRM licence (per user / year)")
	laptop := list[3]
	assertEq(t, "laptop", laptop["name"], "Laptop 14-inch")
	assertEq(t, "laptop category", laptop["category"].(obj)["name"], "Hardware")
	assertEq(t, "laptop price", laptop["unitPrice"], 32900)
	assertEq(t, "laptop cost", laptop["unitCost"], 26500)
	assertEq(t, "laptop stock", laptop["stock"], 25)
	if v, ok := list[0]["stock"]; !ok || v != nil {
		t.Errorf("untracked stock: got %v (present %v), want null", v, ok)
	}

	// Money and stock are rendered with 2 decimals.
	_, _, body := e.raw("GET", "/api/v1/products", adm)
	if !strings.Contains(string(body), `"stock":25.00`) || !strings.Contains(string(body), `"unitCost":26500.00`) {
		t.Errorf("product money format: %s", body)
	}

	p := e.expect(201, "", "POST", "/api/v1/admin/products", adm,
		obj{"name": "  USB hub ", "categoryId": catHardware, "unitPrice": 450, "unitCost": 210.5, "stock": 12})
	id := p["id"].(string)
	assertEq(t, "trimmed", p["name"], "USB hub")
	assertEq(t, "active", p["active"], true)
	assertEq(t, "stock", p["stock"], 12)
	res := e.expect(409, "CONFLICT", "POST", "/api/v1/admin/products", adm,
		obj{"name": "Wireless mouse", "categoryId": catHardware, "unitPrice": 1, "unitCost": 1})
	assertEq(t, "duplicate", res["message"], `conflict: product "Wireless mouse" already exists`)
	e.expect(403, "FORBIDDEN", "POST", "/api/v1/admin/products", e.as("rm1@swiftquote.dev"),
		obj{"name": "X", "categoryId": catHardware, "unitPrice": 1, "unitCost": 1})

	res = e.expect(400, "VALIDATION_ERROR", "POST", "/api/v1/admin/products", adm, obj{"name": " "})
	assertEq(t, "required", res["details"],
		[]any{"name is required", "categoryId is required", "unitPrice is required", "unitCost is required"})
	res = e.expect(400, "VALIDATION_ERROR", "POST", "/api/v1/admin/products", adm,
		obj{"name": "X", "categoryId": "00000000-0000-4000-8000-0000000000ff", "unitPrice": -1, "unitCost": -1, "stock": -1})
	assertEq(t, "negative", res["details"],
		[]any{"unitPrice must not be negative", "unitCost must not be negative", "stock must not be negative"})
	res = e.expect(400, "VALIDATION_ERROR", "POST", "/api/v1/admin/products", adm,
		obj{"name": "X", "categoryId": "00000000-0000-4000-8000-0000000000ff", "unitPrice": 1, "unitCost": 1})
	assertEq(t, "category", res["details"], []any{"categoryId is not an active category"})

	missing := "/api/v1/admin/products/00000000-0000-4000-8000-0000000000ff"
	res = e.expect(404, "NOT_FOUND", "PUT", missing, adm, obj{})
	assertEq(t, "not found", res["message"], "not found: product not found")
	e.expect(403, "FORBIDDEN", "PUT", missing, e.as("woc@swiftquote.dev"), obj{})
	res = e.expect(400, "VALIDATION_ERROR", "PUT", "/api/v1/admin/products/"+id, adm,
		obj{"name": "USB hub", "categoryId": catHardware, "unitPrice": 450, "unitCost": 210})
	assertEq(t, "active required", res["details"], []any{"active is required"})
	e.expect(409, "CONFLICT", "PUT", "/api/v1/admin/products/"+id, adm,
		obj{"name": "Wireless mouse", "categoryId": catHardware, "unitPrice": 1, "unitCost": 1, "active": true})

	// Untracking stock and retiring: RMs can no longer put it on a quote.
	p = e.expect(200, "", "PUT", "/api/v1/admin/products/"+id, adm,
		obj{"name": "USB hub", "categoryId": catServices, "unitPrice": 450, "unitCost": 210, "stock": nil, "active": false})
	assertEq(t, "retired", p["active"], false)
	assertEq(t, "moved", p["category"].(obj)["name"], "Services")
	if p["stock"] != nil {
		t.Errorf("stock: got %v, want null", p["stock"])
	}
	body2 := quoteBody("Q-RETIRED")
	body2["items"] = []obj{{"productId": prodCRM, "quantity": 1}, {"productId": id, "quantity": 1}}
	res = e.expect(400, "VALIDATION_ERROR", "POST", "/api/v1/quotes", e.as("rm1@swiftquote.dev"), body2)
	assertEq(t, "retired product", res["details"], []any{"items[1].productId is not an active product"})

	// Delete: only products no quote line uses.
	e.expect(403, "FORBIDDEN", "POST", "/api/v1/admin/products/"+id+"/delete", e.as("rm1@swiftquote.dev"), nil)
	e.create("rm1@swiftquote.dev", "Q-USED")
	res = e.expect(409, "CONFLICT", "POST", "/api/v1/admin/products/"+prodConsult+"/delete", adm, nil)
	assertEq(t, "used", res["message"], "conflict: product is used on quotes; retire it instead")
	if s := e.do("POST", "/api/v1/admin/products/"+id+"/delete", adm, nil, nil); s != 204 {
		t.Fatalf("delete: status %d", s)
	}
	e.expect(404, "NOT_FOUND", "POST", "/api/v1/admin/products/"+id+"/delete", adm, nil)
}

func TestQuoteLines(t *testing.T) {
	e := newTestEnv(t)
	rm := e.as("rm1@swiftquote.dev")

	body := quoteBody("Q-LINES")
	body["items"] = []obj{
		{"productId": prodLaptop, "quantity": 2, "discountType": "percent", "discountValue": 5, "description": "14-inch, 16 GB"},
		{"productId": prodMouse, "quantity": 10, "discountType": "amount", "discountValue": 400},
		{"productId": "00000000-0000-4000-8000-000000000041", "quantity": 12, "taxPercent": 0},
	}
	q := e.expect(201, "", "POST", "/api/v1/quotes", rm, body)
	l0 := item(q, 0)
	assertEq(t, "product", l0["product"].(obj)["name"], "Laptop 14-inch")
	assertEq(t, "title from product", l0["title"], "Laptop 14-inch")
	assertEq(t, "category from product", l0["category"].(obj)["name"], "Hardware")
	assertEq(t, "default price", l0["unitPrice"], 32900)
	assertEq(t, "discount type", l0["discountType"], "percent")
	assertEq(t, "discount amount", l0["discountAmount"], 3290)
	assertEq(t, "unit cost", l0["unitCost"], 26500)
	assertEq(t, "cost total", l0["costTotal"], 53000)
	assertEq(t, "profit", l0["profit"], 9510)
	l1 := item(q, 1)
	assertEq(t, "amount type", l1["discountType"], "amount")
	assertEq(t, "amount value", l1["discountValue"], 400)
	assertEq(t, "amount discount", l1["discountAmount"], 400)
	assertEq(t, "amount line", l1["lineTotal"], 5500)
	assertEq(t, "default type", item(q, 2)["discountType"], "percent")
	assertEq(t, "subtotal", q["subtotal"], 75900)
	assertEq(t, "discount", q["discountAmount"], 3690)
	assertEq(t, "grand", q["grandTotal"], 76970.7)
	assertEq(t, "quote cost", q["costTotal"], 57540)
	assertEq(t, "quote profit", q["profit"], 14670)

	// Changing the product's cost later does not change saved lines.
	e.expect(200, "", "PUT", "/api/v1/admin/products/"+prodLaptop, e.as("demo@swiftquote.dev"),
		obj{"name": "Laptop 14-inch", "categoryId": catHardware, "unitPrice": 32900, "unitCost": 30000, "stock": 25, "active": true})
	q = e.expect(200, "", "GET", "/api/v1/quotes/"+q["id"].(string), e.as("woc@swiftquote.dev"), nil)
	assertEq(t, "snapshot cost", item(q, 0)["unitCost"], 26500)

	// Lines saved before products existed have no product or cost; then the quote has none either.
	if _, err := e.pool.Exec(context.Background(),
		`UPDATE quote_items SET product_id = NULL, unit_cost = NULL WHERE quote_id = $1 AND position = 2`, q["id"]); err != nil {
		t.Fatal(err)
	}
	q = e.expect(200, "", "GET", "/api/v1/quotes/"+q["id"].(string), rm, nil)
	for _, k := range []string{"product", "unitCost", "costTotal", "profit"} {
		if v, ok := item(q, 2)[k]; !ok || v != nil {
			t.Errorf("legacy %s: got %v (present %v), want null", k, v, ok)
		}
	}
	for _, k := range []string{"costTotal", "profit"} {
		if v, ok := q[k]; !ok || v != nil {
			t.Errorf("quote %s: got %v (present %v), want null", k, v, ok)
		}
	}

	line := func(it obj) obj {
		b := quoteBody("Q-BAD")
		b["items"] = []obj{it}
		return b
	}
	for name, tc := range map[string]struct {
		item obj
		want []any
	}{
		"required":          {obj{"discountType": "fixed"}, []any{"items[0].productId is required", "items[0].quantity is required", `items[0].discountType "fixed" is not a valid DiscountType`}},
		"unknown product":   {obj{"productId": "00000000-0000-4000-8000-0000000000ff", "quantity": 1}, []any{"items[0].productId is not an active product"}},
		"quantity":          {obj{"productId": prodCRM, "quantity": 0.5}, []any{"items[0]: quantity must be at least 1"}},
		"negative price":    {obj{"productId": prodCRM, "quantity": 1, "unitPrice": -1}, []any{"items[0]: unitPrice must not be negative"}},
		"negative discount": {obj{"productId": prodCRM, "quantity": 1, "discountType": "amount", "discountValue": -1}, []any{"items[0]: discountValue must not be negative"}},
		"percent above 100": {obj{"productId": prodCRM, "quantity": 1, "discountValue": 101}, []any{"items[0]: discountValue must be between 0 and 100"}},
		"amount above line": {obj{"productId": prodCRM, "quantity": 1, "unitPrice": 10, "discountType": "amount", "discountValue": 10.005}, []any{"items[0]: discountValue must not exceed the line amount"}},
		"tax above 100":     {obj{"productId": prodCRM, "quantity": 1, "taxPercent": 101}, []any{"items[0]: taxPercent must be between 0 and 100"}},
	} {
		t.Run(name, func(t *testing.T) {
			res := e.expect(400, "VALIDATION_ERROR", "POST", "/api/v1/quotes", rm, line(tc.item))
			assertEq(t, "details", res["details"], tc.want)
		})
	}
	q = e.expect(201, "", "POST", "/api/v1/quotes", rm,
		line(obj{"productId": prodCRM, "quantity": 1, "unitPrice": 10, "discountType": "amount", "discountValue": 10.004}))
	assertEq(t, "amount rounds to the line", item(q, 0)["lineTotal"], 0)
}

func TestCostHiddenFromCustomers(t *testing.T) {
	e := newTestEnv(t)
	id, link := e.sent("Q-COST")
	costKeys := func(t *testing.T, label string, q obj) {
		t.Helper()
		for _, k := range []string{"costTotal", "profit"} {
			if _, ok := q[k]; ok {
				t.Errorf("%s: %s must be omitted", label, k)
			}
		}
		for _, it := range q["items"].([]any) {
			for _, k := range []string{"unitCost", "costTotal", "profit"} {
				if _, ok := it.(obj)[k]; ok {
					t.Errorf("%s: items[].%s must be omitted", label, k)
				}
			}
			if it.(obj)["product"] == nil || it.(obj)["discountAmount"] == nil {
				t.Errorf("%s: product and discountAmount must be present", label)
			}
		}
	}

	q := e.expect(200, "", "GET", "/api/v1/quotes/"+id, e.as("wo@swiftquote.dev"), nil)
	assertEq(t, "wo sees cost", item(q, 0)["unitCost"], 900)
	assertEq(t, "wo sees profit", q["profit"], -3418.5)

	costKeys(t, "public view", e.expect(200, "", "GET", "/api/v1/public/quotes/"+link, "", nil))
	customer := e.as("buyer@acme.example")
	costKeys(t, "customer view", e.expect(200, "", "GET", "/api/v1/quotes/"+id, customer, nil))
	costKeys(t, "customer accept", e.expect(200, "", "POST", "/api/v1/quotes/"+id+"/accept", customer,
		obj{"signerName": "Alice", "signatureDataUrl": "data:x"}))

	_, link2 := e.sent("Q-COST2")
	costKeys(t, "public reject", e.expect(200, "", "POST", "/api/v1/public/quotes/"+link2+"/reject", "", nil))
}

func TestStock(t *testing.T) {
	e := newTestEnv(t)
	rm, wo := e.as("rm1@swiftquote.dev"), e.as("wo@swiftquote.dev")
	laptops := func(number string, qty ...float64) string {
		b := quoteBody(number)
		items := []obj{{"productId": prodConsult, "quantity": 1}}
		for _, n := range qty {
			items = append(items, obj{"productId": prodLaptop, "quantity": n}, obj{"productId": prodMouse, "quantity": 1})
		}
		b["items"] = items
		return e.expect(201, "", "POST", "/api/v1/quotes", rm, b)["id"].(string)
	}

	// Submit totals each product over all its lines.
	id := laptops("Q-S1", 20, 6)
	res := e.expect(409, "CONFLICT", "POST", "/api/v1/quotes/"+id+"/submit", rm, nil)
	assertEq(t, "submit", res["message"], "conflict: not enough stock for Laptop 14-inch (available 25)")

	// Send checks again; available is shown without trailing zeros.
	id = laptops("Q-S2", 5)
	e.expect(200, "", "POST", "/api/v1/quotes/"+id+"/submit", rm, nil)
	e.expect(200, "", "POST", "/api/v1/quotes/"+id+"/approve", wo, nil)
	e.setStock(prodLaptop, "2.5")
	res = e.expect(409, "CONFLICT", "POST", "/api/v1/quotes/"+id+"/send", rm, nil)
	assertEq(t, "send", res["message"], "conflict: not enough stock for Laptop 14-inch (available 2.5)")
	e.setStock(prodLaptop, "0")
	res = e.expect(409, "CONFLICT", "POST", "/api/v1/quotes/"+id+"/send", rm, nil)
	assertEq(t, "send zero", res["message"], "conflict: not enough stock for Laptop 14-inch (available 0)")

	// Accept deducts in one transaction, or nothing at all.
	e.setStock(prodLaptop, "25")
	e.expect(200, "", "POST", "/api/v1/quotes/"+id+"/send", rm, nil)
	e.setStock(prodLaptop, "4")
	customer := e.as("buyer@acme.example")
	sign := obj{"signerName": "Alice", "signatureDataUrl": "data:x"}
	res = e.expect(409, "CONFLICT", "POST", "/api/v1/quotes/"+id+"/accept", customer, sign)
	assertEq(t, "accept", res["message"], "conflict: not enough stock for Laptop 14-inch (available 4)")
	assertEq(t, "mouse untouched", e.stock(prodMouse), "200.00")
	q := e.expect(200, "", "GET", "/api/v1/quotes/"+id, customer, nil)
	assertEq(t, "still open", q["status"], "viewed")
	e.setStock(prodLaptop, "5")
	e.expect(200, "", "POST", "/api/v1/quotes/"+id+"/accept", customer, sign)
	assertEq(t, "laptop deducted", e.stock(prodLaptop), "0.00")
	assertEq(t, "mouse deducted", e.stock(prodMouse), "199.00")
	assertEq(t, "untracked", e.stock(prodConsult), "null")

	// The share link deducts too; rejecting never does.
	e.setStock(prodLaptop, "25")
	_, link := e.sent("Q-S3")
	b := quoteBody("Q-S4")
	b["items"] = []obj{{"productId": prodMouse, "quantity": 3}}
	id = e.expect(201, "", "POST", "/api/v1/quotes", rm, b)["id"].(string)
	e.expect(200, "", "POST", "/api/v1/quotes/"+id+"/submit", rm, nil)
	e.expect(200, "", "POST", "/api/v1/quotes/"+id+"/approve", wo, nil)
	link4 := e.expect(200, "", "POST", "/api/v1/quotes/"+id+"/send", rm, nil)["accessToken"].(string)
	e.expect(200, "", "POST", "/api/v1/public/quotes/"+link+"/reject", "", nil)
	e.expect(200, "", "POST", "/api/v1/public/quotes/"+link4+"/accept", "", sign)
	assertEq(t, "link deducted", e.stock(prodMouse), "196.00")
}

func TestQuotePdf(t *testing.T) {
	e := newTestEnv(t)
	rm, wo := e.as("rm1@swiftquote.dev"), e.as("wo@swiftquote.dev")
	id := e.create("rm1@swiftquote.dev", "Q/PDF 1")
	path := "/api/v1/quotes/" + id + "/pdf"

	status, _, body := e.raw("GET", path, rm)
	assertEq(t, "draft status", status, 409)
	var res obj
	_ = json.Unmarshal(body, &res)
	assertEq(t, "draft", res["message"], "conflict: cannot export a quote that is draft")
	e.expect(200, "", "POST", "/api/v1/quotes/"+id+"/submit", rm, nil)
	status, _, _ = e.raw("GET", path, wo)
	assertEq(t, "pending", status, 409)
	e.expect(200, "", "POST", "/api/v1/quotes/"+id+"/approve", wo, nil)

	status, headers, body := e.raw("GET", path, rm)
	assertEq(t, "approved", status, 200)
	assertEq(t, "content type", headers["Content-Type"], "application/pdf")
	assertEq(t, "disposition", headers["Content-Disposition"], `attachment; filename="Q_PDF_1.pdf"`)
	if !bytes.HasPrefix(body, []byte("%PDF")) {
		t.Errorf("body is not a PDF: %q", body[:min(len(body), 16)])
	}
	status, _, _ = e.raw("GET", path, e.as("demo@swiftquote.dev"))
	assertEq(t, "admin", status, 403)
	status, _, _ = e.raw("GET", path, e.as("wo2@swiftquote.dev"))
	assertEq(t, "other wo", status, 404)
	status, _, _ = e.raw("GET", path, e.as("buyer@acme.example"))
	assertEq(t, "customer before send", status, 404)

	q := e.expect(200, "", "POST", "/api/v1/quotes/"+id+"/send", rm, nil)
	link := q["accessToken"].(string)
	status, _, _ = e.raw("GET", path, e.as("buyer@acme.example"))
	assertEq(t, "customer", status, 200)
	status, headers, body = e.raw("GET", "/api/v1/public/quotes/"+link+"/pdf", "")
	assertEq(t, "public", status, 200)
	assertEq(t, "public disposition", headers["Content-Disposition"], `attachment; filename="Q_PDF_1.pdf"`)
	if !bytes.HasPrefix(body, []byte("%PDF")) {
		t.Error("public body is not a PDF")
	}
	q = e.expect(200, "", "GET", "/api/v1/quotes/"+id, rm, nil)
	assertEq(t, "downloads do not mark viewed", q["status"], "sent")

	draft := e.expect(201, "", "POST", "/api/v1/quotes", rm, quoteBody("Q-PDF-2"))
	status, _, _ = e.raw("GET", "/api/v1/public/quotes/"+draft["accessToken"].(string)+"/pdf", "")
	assertEq(t, "public draft", status, 404)
	status, _, _ = e.raw("GET", "/api/v1/public/quotes/not-a-uuid/pdf", "")
	assertEq(t, "public unknown", status, 404)
}
