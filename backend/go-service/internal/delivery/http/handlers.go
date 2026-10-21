package http

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"

	"github.com/konrawitAEK/swiftquote/backend/go-service/internal/admin"
	"github.com/konrawitAEK/swiftquote/backend/go-service/internal/auth"
	"github.com/konrawitAEK/swiftquote/backend/go-service/internal/catalog"
	"github.com/konrawitAEK/swiftquote/backend/go-service/internal/client"
	"github.com/konrawitAEK/swiftquote/backend/go-service/internal/dashboard"
	"github.com/konrawitAEK/swiftquote/backend/go-service/internal/domain"
	"github.com/konrawitAEK/swiftquote/backend/go-service/internal/quote"
)

// Error precedence, shared with the Spring and Node services:
// 401 session, 400 malformed JSON, then the service's 403 role, 404 visibility, 400 content, 409 state.

const actorKey = "actor"

type handlers struct {
	auth      *auth.Service
	catalog   *catalog.Service
	clients   *client.Service
	quotes    *quote.Service
	admin     *admin.Service
	dashboard *dashboard.Service
}

// requireAuth validates the bearer token, loads the current actor and stores it in locals.
func (h *handlers) requireAuth(c *fiber.Ctx) error {
	token, ok := strings.CutPrefix(c.Get(fiber.HeaderAuthorization), "Bearer ")
	if !ok || token == "" {
		return domain.Unauthorized("missing bearer token")
	}
	a, err := h.auth.Authenticate(c.UserContext(), token)
	if err != nil {
		return err
	}
	c.Locals(actorKey, a)
	return c.Next()
}

func actor(c *fiber.Ctx) domain.Actor {
	return c.Locals(actorKey).(domain.Actor)
}

func decode(c *fiber.Ctx, v any) error {
	if err := json.Unmarshal(c.Body(), v); err != nil {
		return &domain.ValidationError{Details: []string{"malformed JSON body: " + err.Error()}}
	}
	return nil
}

// optionalComment decodes an optional {"comment": ...} body; an empty body means no comment.
func optionalComment(c *fiber.Ctx) (*string, error) {
	if len(c.Body()) == 0 {
		return nil, nil
	}
	var req commentRequest
	if err := decode(c, &req); err != nil {
		return nil, err
	}
	return req.Comment, nil
}

// pathID parses an id path parameter. A malformed id becomes uuid.Nil, which no row has,
// so it is reported exactly like an unknown id, after the role check.
func pathID(c *fiber.Ctx) uuid.UUID {
	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return uuid.Nil
	}
	return id
}

func (h *handlers) login(c *fiber.Ctx) error {
	var req loginRequest
	if err := decode(c, &req); err != nil {
		return err
	}
	res, err := h.auth.Login(c.UserContext(), req.Email, req.Password)
	if err != nil {
		return err
	}
	return c.JSON(authResponse{
		AccessToken: res.AccessToken,
		TenantID:    res.Membership.OrganizationID,
		User:        authUser{ID: res.User.ID, Name: res.User.FullName, Role: res.Membership.Role},
	})
}

func (h *handlers) listClients(c *fiber.Ctx) error {
	cs, err := h.clients.List(c.UserContext(), actor(c))
	if err != nil {
		return err
	}
	return c.JSON(toClientViews(cs))
}

func (h *handlers) listCategories(c *fiber.Ctx) error {
	cs, err := h.catalog.List(c.UserContext(), actor(c))
	if err != nil {
		return err
	}
	out := make([]categoryView, len(cs))
	for i, cat := range cs {
		out[i] = toCategoryView(cat)
	}
	return c.JSON(out)
}

func (h *handlers) createCategory(c *fiber.Ctx) error {
	var req createCategoryRequest
	if err := decode(c, &req); err != nil {
		return err
	}
	cat, err := h.catalog.Create(c.UserContext(), actor(c), req.Name)
	if err != nil {
		return err
	}
	return c.Status(fiber.StatusCreated).JSON(toCategoryView(cat))
}

func (h *handlers) updateCategory(c *fiber.Ctx) error {
	var req updateCategoryRequest
	if err := decode(c, &req); err != nil {
		return err
	}
	cat, err := h.catalog.Update(c.UserContext(), actor(c), pathID(c), req.Name, req.Active)
	if err != nil {
		return err
	}
	return c.JSON(toCategoryView(cat))
}

func (h *handlers) listQuotes(c *fiber.Ctx) error {
	a := actor(c)
	if a.Role == domain.RoleAdmin {
		return domain.ErrRoleForbidden
	}
	var status *domain.QuoteStatus
	if raw := c.Query("status"); raw != "" {
		s := domain.QuoteStatus(raw)
		if !s.Valid() {
			return domain.Invalid(fmt.Sprintf("status %q is not a valid QuoteStatus", raw))
		}
		status = &s
	}
	rows, err := h.quotes.List(c.UserContext(), a, status)
	if err != nil {
		return err
	}
	return c.JSON(toQuoteSummaries(rows))
}

func (h *handlers) createQuote(c *fiber.Ctx) error {
	var req createQuoteRequest
	if err := decode(c, &req); err != nil {
		return err
	}
	q, err := h.quotes.Create(c.UserContext(), actor(c), req.toInput())
	if err != nil {
		return err
	}
	return c.Status(fiber.StatusCreated).JSON(toQuoteDetail(q))
}

func (h *handlers) updateQuote(c *fiber.Ctx) error {
	var req createQuoteRequest
	if err := decode(c, &req); err != nil {
		return err
	}
	q, err := h.quotes.Update(c.UserContext(), actor(c), pathID(c), req.toInput())
	if err != nil {
		return err
	}
	return c.JSON(toQuoteDetail(q))
}

func (h *handlers) getQuote(c *fiber.Ctx) error {
	q, err := h.quotes.Get(c.UserContext(), actor(c), pathID(c))
	if err != nil {
		return err
	}
	return c.JSON(toQuoteDetail(q))
}

type commentAction func(s *quote.Service, c *fiber.Ctx, a domain.Actor, id uuid.UUID, comment *string) (domain.Quote, error)

// quoteAction adapts a workflow step that takes an optional {"comment"} body.
func (h *handlers) quoteAction(action commentAction) fiber.Handler {
	return func(c *fiber.Ctx) error {
		comment, err := optionalComment(c)
		if err != nil {
			return err
		}
		q, err := action(h.quotes, c, actor(c), pathID(c), comment)
		if err != nil {
			return err
		}
		return c.JSON(toQuoteDetail(q))
	}
}

func submitQuote(s *quote.Service, c *fiber.Ctx, a domain.Actor, id uuid.UUID, comment *string) (domain.Quote, error) {
	return s.Submit(c.UserContext(), a, id, comment)
}

func approveQuote(s *quote.Service, c *fiber.Ctx, a domain.Actor, id uuid.UUID, comment *string) (domain.Quote, error) {
	return s.Approve(c.UserContext(), a, id, comment)
}

func returnQuote(s *quote.Service, c *fiber.Ctx, a domain.Actor, id uuid.UUID, comment *string) (domain.Quote, error) {
	return s.Return(c.UserContext(), a, id, comment)
}

func sendQuote(s *quote.Service, c *fiber.Ctx, a domain.Actor, id uuid.UUID, _ *string) (domain.Quote, error) {
	return s.Send(c.UserContext(), a, id)
}

func rejectQuote(s *quote.Service, c *fiber.Ctx, a domain.Actor, id uuid.UUID, comment *string) (domain.Quote, error) {
	return s.Reject(c.UserContext(), a, id, comment)
}

func (h *handlers) acceptQuote(c *fiber.Ctx) error {
	var req acceptQuoteRequest
	if err := decode(c, &req); err != nil {
		return err
	}
	q, err := h.quotes.Accept(c.UserContext(), actor(c), pathID(c), req.SignerName, req.SignatureDataURL)
	if err != nil {
		return err
	}
	return c.JSON(toQuoteDetail(q))
}

func (h *handlers) dashboardSummary(c *fiber.Ctx) error {
	a := actor(c)
	if a.Role != domain.RoleWOC {
		return domain.ErrRoleForbidden
	}
	var r dashboard.Range
	for _, p := range []struct {
		name string
		dst  **time.Time
	}{{"from", &r.From}, {"to", &r.To}} {
		if raw := c.Query(p.name); raw != "" {
			t, err := time.Parse(dateLayout, raw)
			if err != nil {
				return domain.Invalid(p.name + " must be a date (YYYY-MM-DD)")
			}
			*p.dst = &t
		}
	}
	s, err := h.dashboard.Summary(c.UserContext(), a, r)
	if err != nil {
		return err
	}
	return c.JSON(toDashboardView(s))
}

func (h *handlers) listUsers(c *fiber.Ctx) error {
	users, err := h.admin.ListUsers(c.UserContext(), actor(c))
	if err != nil {
		return err
	}
	out := make([]adminUserView, len(users))
	for i, u := range users {
		out[i] = toAdminUser(u)
	}
	return c.JSON(out)
}

func (h *handlers) createUser(c *fiber.Ctx) error {
	var req createUserRequest
	if err := decode(c, &req); err != nil {
		return err
	}
	u, err := h.admin.CreateUser(c.UserContext(), actor(c), admin.UserInput{
		Email: req.Email, Name: req.Name, Password: req.Password, Role: req.Role, TeamID: req.TeamID, ClientID: req.ClientID,
	})
	if err != nil {
		return err
	}
	return c.Status(fiber.StatusCreated).JSON(toAdminUser(u))
}

func (h *handlers) updateUser(c *fiber.Ctx) error {
	var req updateUserRequest
	if err := decode(c, &req); err != nil {
		return err
	}
	u, err := h.admin.UpdateUser(c.UserContext(), actor(c), pathID(c), admin.UserInput{
		Name: req.Name, Password: req.Password, Role: req.Role, Active: req.Active, TeamID: req.TeamID, ClientID: req.ClientID,
	})
	if err != nil {
		return err
	}
	return c.JSON(toAdminUser(u))
}

func (h *handlers) listTeams(c *fiber.Ctx) error {
	teams, err := h.admin.ListTeams(c.UserContext(), actor(c))
	if err != nil {
		return err
	}
	out := make([]teamView, len(teams))
	for i, t := range teams {
		out[i] = toTeamView(t)
	}
	return c.JSON(out)
}

func (h *handlers) createTeam(c *fiber.Ctx) error {
	var req teamRequest
	if err := decode(c, &req); err != nil {
		return err
	}
	t, err := h.admin.CreateTeam(c.UserContext(), actor(c), req.Name, req.WOUserID)
	if err != nil {
		return err
	}
	return c.Status(fiber.StatusCreated).JSON(toTeamView(t))
}

func (h *handlers) updateTeam(c *fiber.Ctx) error {
	var req teamRequest
	if err := decode(c, &req); err != nil {
		return err
	}
	t, err := h.admin.UpdateTeam(c.UserContext(), actor(c), pathID(c), req.Name, req.WOUserID)
	if err != nil {
		return err
	}
	return c.JSON(toTeamView(t))
}

func (h *handlers) getPublicQuote(c *fiber.Ctx) error {
	v, err := h.quotes.GetPublic(c.UserContext(), accessToken(c))
	if err != nil {
		return err
	}
	return c.JSON(toPublicView(v))
}

func (h *handlers) acceptPublicQuote(c *fiber.Ctx) error {
	var req acceptQuoteRequest
	if err := decode(c, &req); err != nil {
		return err
	}
	q, err := h.quotes.AcceptPublic(c.UserContext(), accessToken(c), req.SignerName, req.SignatureDataURL)
	if err != nil {
		return err
	}
	return c.JSON(toQuoteDetail(q))
}

func (h *handlers) rejectPublicQuote(c *fiber.Ctx) error {
	comment, err := optionalComment(c)
	if err != nil {
		return err
	}
	q, err := h.quotes.RejectPublic(c.UserContext(), accessToken(c), comment)
	if err != nil {
		return err
	}
	return c.JSON(toQuoteDetail(q))
}

// accessToken parses the path token; a malformed token becomes uuid.Nil and is reported like an unknown one.
func accessToken(c *fiber.Ctx) uuid.UUID {
	token, err := uuid.Parse(c.Params("accessToken"))
	if err != nil {
		return uuid.Nil
	}
	return token
}
