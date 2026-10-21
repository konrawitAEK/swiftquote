package http

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	"github.com/shopspring/decimal"

	"github.com/konrawitAEK/swiftquote/backend/go-service/internal/auth"
	"github.com/konrawitAEK/swiftquote/backend/go-service/internal/domain"
	"github.com/konrawitAEK/swiftquote/backend/go-service/internal/quote"
)

const principalKey = "principal"

var defaultTaxPercent = decimal.NewFromInt(7)

type handlers struct {
	auth   *auth.Service
	quotes *quote.Service
}

// requireAuth validates the bearer token and stores the auth.Principal in locals.
func (h *handlers) requireAuth(c *fiber.Ctx) error {
	token, ok := strings.CutPrefix(c.Get(fiber.HeaderAuthorization), "Bearer ")
	if !ok || token == "" {
		return fmt.Errorf("%w: missing bearer token", domain.ErrUnauthorized)
	}
	p, err := h.auth.Verify(token)
	if err != nil {
		return fmt.Errorf("%w: invalid or expired token", err)
	}
	c.Locals(principalKey, p)
	return c.Next()
}

func principal(c *fiber.Ctx) auth.Principal {
	return c.Locals(principalKey).(auth.Principal)
}

func decode(c *fiber.Ctx, v any) error {
	if err := json.Unmarshal(c.Body(), v); err != nil {
		return &domain.ValidationError{Details: []string{"malformed JSON body: " + err.Error()}}
	}
	return nil
}

func (h *handlers) login(c *fiber.Ctx) error {
	var req loginRequest
	if err := decode(c, &req); err != nil {
		return err
	}
	res, err := h.auth.Login(c.UserContext(), req.Email, req.Password)
	if errors.Is(err, domain.ErrUnauthorized) {
		return fmt.Errorf("%w: invalid email or password", err)
	}
	if err != nil {
		return err
	}
	return c.JSON(authResponse{
		AccessToken: res.AccessToken,
		TenantID:    res.Membership.OrganizationID,
		User:        authUser{ID: res.User.ID, Name: res.User.FullName, Role: res.Membership.Role},
	})
}

func (h *handlers) listQuotes(c *fiber.Ctx) error {
	var status *domain.QuoteStatus
	if raw := c.Query("status"); raw != "" {
		s := domain.QuoteStatus(raw)
		if !s.Valid() {
			return &domain.ValidationError{Details: []string{fmt.Sprintf("status %q is not a valid QuoteStatus", raw)}}
		}
		status = &s
	}
	rows, err := h.quotes.List(c.UserContext(), principal(c).TenantID, status)
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

	verr := &domain.ValidationError{}
	if req.ClientID == nil {
		verr.Add("clientId is required")
	}
	if req.ExpiryDate == nil {
		verr.Add("expiryDate is required")
	}
	items := make([]domain.QuoteItem, len(req.Items))
	for i, in := range req.Items {
		if in.Quantity == nil {
			verr.Add(fmt.Sprintf("items[%d].quantity is required", i))
		}
		if in.UnitPrice == nil {
			verr.Add(fmt.Sprintf("items[%d].unitPrice is required", i))
		}
		items[i] = domain.QuoteItem{
			Title:           in.Title,
			Description:     in.Description,
			Quantity:        deref(in.Quantity, decimal.Zero),
			UnitPrice:       deref(in.UnitPrice, decimal.Zero),
			DiscountPercent: deref(in.DiscountPercent, decimal.Zero),
			TaxPercent:      deref(in.TaxPercent, defaultTaxPercent),
		}
	}
	if err := verr.OrNil(); err != nil {
		return err
	}

	q, err := h.quotes.Create(c.UserContext(), quote.CreateInput{
		OrganizationID: principal(c).TenantID,
		ClientID:       *req.ClientID,
		DealID:         req.DealID,
		QuoteNumber:    req.QuoteNumber,
		ExpiryDate:     time.Time(*req.ExpiryDate),
		Items:          items,
	})
	if err != nil {
		return err
	}
	return c.Status(fiber.StatusCreated).JSON(toQuoteDetail(q))
}

func (h *handlers) getPublicQuote(c *fiber.Ctx) error {
	token, err := accessToken(c)
	if err != nil {
		return err
	}
	v, err := h.quotes.GetPublic(c.UserContext(), token)
	if err != nil {
		return err
	}
	return c.JSON(toPublicView(v))
}

func (h *handlers) acceptPublicQuote(c *fiber.Ctx) error {
	token, err := accessToken(c)
	if err != nil {
		return err
	}
	var req acceptQuoteRequest
	if err := decode(c, &req); err != nil {
		return err
	}
	q, err := h.quotes.Accept(c.UserContext(), token, req.SignerName, req.SignatureDataURL)
	if err != nil {
		return err
	}
	return c.JSON(toQuoteDetail(q))
}

// accessToken parses the path token; a malformed token is reported like an unknown one.
func accessToken(c *fiber.Ctx) (uuid.UUID, error) {
	token, err := uuid.Parse(c.Params("accessToken"))
	if err != nil {
		return uuid.Nil, fmt.Errorf("%w: quote expired or not found", domain.ErrNotFound)
	}
	return token, nil
}

func deref(d *decimal.Decimal, fallback decimal.Decimal) decimal.Decimal {
	if d == nil {
		return fallback
	}
	return *d
}
