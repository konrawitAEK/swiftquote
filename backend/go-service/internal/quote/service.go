package quote

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/shopspring/decimal"

	"github.com/konrawitAEK/swiftquote/backend/go-service/internal/domain"
)

// Summary is a list row; ClientName is resolved by the repository.
type Summary struct {
	ID          uuid.UUID
	QuoteNumber string
	ClientName  string
	Status      domain.QuoteStatus
	GrandTotal  decimal.Decimal
	ExpiryDate  time.Time
}

// PublicView is what a client sees through the access token.
type PublicView struct {
	Quote      domain.Quote
	VendorName string
	VendorLogo *string
}

type Repository interface {
	// ClientBelongsTo reports whether clientID exists within orgID.
	ClientBelongsTo(ctx context.Context, orgID, clientID uuid.UUID) (bool, error)
	// Create persists q and its items; duplicate (organization, quoteNumber) returns domain.ErrConflict.
	Create(ctx context.Context, q *domain.Quote) error
	List(ctx context.Context, orgID uuid.UUID, status *domain.QuoteStatus) ([]Summary, error)
	// Get returns a quote of orgID with its items, or domain.ErrNotFound.
	Get(ctx context.Context, orgID, id uuid.UUID) (domain.Quote, error)
	// GetPublic looks up by access token, or returns domain.ErrNotFound.
	GetPublic(ctx context.Context, accessToken uuid.UUID) (PublicView, error)
	// UpdateStatus sets status only if the current status is one of from; otherwise domain.ErrConflict.
	UpdateStatus(ctx context.Context, id uuid.UUID, to domain.QuoteStatus, from ...domain.QuoteStatus) error
	// Accept records the signature only if the quote is still acceptable; otherwise domain.ErrConflict.
	Accept(ctx context.Context, id uuid.UUID, signedBy, signatureData string, at time.Time) (domain.Quote, error)
}

type CreateInput struct {
	OrganizationID uuid.UUID
	ClientID       uuid.UUID
	DealID         *uuid.UUID
	QuoteNumber    string
	ExpiryDate     time.Time
	Items          []domain.QuoteItem
}

type Service struct {
	repo Repository
	now  func() time.Time
}

func NewService(repo Repository) *Service {
	return &Service{repo: repo, now: time.Now}
}

// acceptableStatuses are the states from which a client may still sign.
var acceptableStatuses = []domain.QuoteStatus{domain.StatusDraft, domain.StatusSent, domain.StatusViewed}

func (s *Service) Create(ctx context.Context, in CreateInput) (domain.Quote, error) {
	verr := &domain.ValidationError{}
	in.QuoteNumber = strings.TrimSpace(in.QuoteNumber)
	if in.QuoteNumber == "" {
		verr.Add("quoteNumber is required")
	}
	if in.ExpiryDate.Before(s.today()) {
		verr.Add("expiryDate must not be in the past")
	}
	for i, it := range in.Items {
		if strings.TrimSpace(it.Title) == "" {
			verr.Add(fmt.Sprintf("items[%d].title is required", i))
		}
	}
	totals, err := Calculate(in.Items)
	if err != nil {
		verr.Add(err.Error())
	}
	if err := verr.OrNil(); err != nil {
		return domain.Quote{}, err
	}

	ok, err := s.repo.ClientBelongsTo(ctx, in.OrganizationID, in.ClientID)
	if err != nil {
		return domain.Quote{}, err
	}
	if !ok {
		return domain.Quote{}, &domain.ValidationError{Details: []string{"clientId does not exist"}}
	}

	for i := range in.Items {
		in.Items[i].ID = uuid.New()
	}
	q := domain.Quote{
		ID:             uuid.New(),
		OrganizationID: in.OrganizationID,
		ClientID:       in.ClientID,
		DealID:         in.DealID,
		QuoteNumber:    in.QuoteNumber,
		Status:         domain.StatusDraft,
		ExpiryDate:     in.ExpiryDate,
		Subtotal:       totals.Subtotal,
		DiscountAmount: totals.DiscountAmount,
		TaxAmount:      totals.TaxAmount,
		GrandTotal:     totals.GrandTotal,
		AccessToken:    uuid.New(),
		Items:          in.Items,
		CreatedAt:      s.now().UTC(),
	}
	if err := s.repo.Create(ctx, &q); err != nil {
		if errors.Is(err, domain.ErrConflict) {
			return domain.Quote{}, fmt.Errorf("%w: quoteNumber %q already exists", err, q.QuoteNumber)
		}
		return domain.Quote{}, err
	}
	return q, nil
}

func (s *Service) List(ctx context.Context, orgID uuid.UUID, status *domain.QuoteStatus) ([]Summary, error) {
	return s.repo.List(ctx, orgID, status)
}

func (s *Service) Get(ctx context.Context, orgID, id uuid.UUID) (domain.Quote, error) {
	q, err := s.repo.Get(ctx, orgID, id)
	if errors.Is(err, domain.ErrNotFound) {
		return domain.Quote{}, fmt.Errorf("%w: quote not found", err)
	}
	return q, err
}

// GetPublic returns the client-facing view. Expired quotes are reported as not found,
// and a sent quote is marked viewed on first open.
func (s *Service) GetPublic(ctx context.Context, accessToken uuid.UUID) (PublicView, error) {
	v, err := s.repo.GetPublic(ctx, accessToken)
	if err != nil {
		return PublicView{}, notFoundMessage(err)
	}
	if s.isExpired(v.Quote) {
		return PublicView{}, notFoundMessage(domain.ErrNotFound)
	}
	if v.Quote.Status == domain.StatusSent {
		err := s.repo.UpdateStatus(ctx, v.Quote.ID, domain.StatusViewed, domain.StatusSent)
		if err != nil && !errors.Is(err, domain.ErrConflict) {
			return PublicView{}, err
		}
	}
	return v, nil
}

func (s *Service) Accept(ctx context.Context, accessToken uuid.UUID, signerName, signatureData string) (domain.Quote, error) {
	verr := &domain.ValidationError{}
	signerName = strings.TrimSpace(signerName)
	if signerName == "" {
		verr.Add("signerName is required")
	}
	if strings.TrimSpace(signatureData) == "" {
		verr.Add("signatureDataUrl is required")
	}
	if err := verr.OrNil(); err != nil {
		return domain.Quote{}, err
	}

	v, err := s.repo.GetPublic(ctx, accessToken)
	if err != nil {
		return domain.Quote{}, notFoundMessage(err)
	}
	if s.isExpired(v.Quote) {
		return domain.Quote{}, notFoundMessage(domain.ErrNotFound)
	}
	q, err := s.repo.Accept(ctx, v.Quote.ID, signerName, signatureData, s.now().UTC())
	if errors.Is(err, domain.ErrConflict) {
		return domain.Quote{}, fmt.Errorf("%w: quote is %s and can no longer be accepted", err, v.Quote.Status)
	}
	return q, err
}

func notFoundMessage(err error) error {
	if errors.Is(err, domain.ErrNotFound) {
		return fmt.Errorf("%w: quote expired or not found", err)
	}
	return err
}

func (s *Service) today() time.Time {
	y, m, d := s.now().Date()
	return time.Date(y, m, d, 0, 0, 0, 0, time.UTC)
}

// isExpired treats expiryDate as the last valid day.
func (s *Service) isExpired(q domain.Quote) bool {
	return q.Status == domain.StatusExpired || q.ExpiryDate.Before(s.today())
}

// AcceptableStatuses is exported for repositories enforcing Accept's precondition.
func AcceptableStatuses() []domain.QuoteStatus {
	return append([]domain.QuoteStatus(nil), acceptableStatuses...)
}
