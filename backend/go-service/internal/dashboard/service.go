// Package dashboard summarises sales for WOC.
package dashboard

import (
	"context"
	"slices"
	"time"

	"github.com/google/uuid"
	"github.com/shopspring/decimal"

	"github.com/konrawitAEK/swiftquote/backend/go-service/internal/domain"
)

// Range filters quotes by UTC creation date; nil bounds are open and both are inclusive.
type Range struct {
	From *time.Time
	To   *time.Time
}

type StatusRow struct {
	Status domain.QuoteStatus
	Count  int
	Amount decimal.Decimal
}

type MonthRow struct {
	Month          string // YYYY-MM
	AcceptedCount  int
	AcceptedAmount decimal.Decimal
}

type RMRow struct {
	User           domain.Ref
	Team           *string
	QuoteCount     int
	SentCount      int
	AcceptedCount  int
	AcceptedAmount decimal.Decimal
}

type TeamRow struct {
	ID             uuid.UUID
	Name           string
	AcceptedCount  int
	AcceptedAmount decimal.Decimal
}

type Summary struct {
	Range          Range
	AcceptedAmount decimal.Decimal
	AcceptedCount  int
	SentCount      int
	ConversionRate decimal.Decimal
	ByStatus       []StatusRow
	ByMonth        []MonthRow
	ByRM           []RMRow
	ByTeam         []TeamRow
}

// Repository returns the aggregates; ordering of ByMonth, ByRM and ByTeam is the repository's job.
type Repository interface {
	CountByStatus(ctx context.Context, orgID uuid.UUID, r Range) ([]StatusRow, error)
	AcceptedByMonth(ctx context.Context, orgID uuid.UUID, r Range) ([]MonthRow, error)
	ByRM(ctx context.Context, orgID uuid.UUID, r Range) ([]RMRow, error)
	ByTeam(ctx context.Context, orgID uuid.UUID, r Range) ([]TeamRow, error)
}

type Service struct {
	repo Repository
}

func NewService(repo Repository) *Service {
	return &Service{repo: repo}
}

// sentStatuses are the states a quote reaches once it has been sent to the customer.
var sentStatuses = []domain.QuoteStatus{domain.StatusSent, domain.StatusViewed, domain.StatusAccepted, domain.StatusRejected}

func (s *Service) Summary(ctx context.Context, a domain.Actor, r Range) (Summary, error) {
	if a.Role != domain.RoleWOC {
		return Summary{}, domain.ErrRoleForbidden
	}
	if r.From != nil && r.To != nil && r.From.After(*r.To) {
		return Summary{}, domain.Invalid("from must not be after to")
	}
	counts, err := s.repo.CountByStatus(ctx, a.TenantID, r)
	if err != nil {
		return Summary{}, err
	}
	out := Summary{Range: r, AcceptedAmount: decimal.Zero, ConversionRate: decimal.Zero}
	for _, st := range domain.AllStatuses {
		row := StatusRow{Status: st, Amount: decimal.Zero}
		if i := slices.IndexFunc(counts, func(c StatusRow) bool { return c.Status == st }); i >= 0 {
			row = counts[i]
		}
		out.ByStatus = append(out.ByStatus, row)
		if st == domain.StatusAccepted {
			out.AcceptedCount, out.AcceptedAmount = row.Count, row.Amount
		}
		if slices.Contains(sentStatuses, st) {
			out.SentCount += row.Count
		}
	}
	if out.SentCount > 0 {
		out.ConversionRate = decimal.NewFromInt(int64(out.AcceptedCount)).
			DivRound(decimal.NewFromInt(int64(out.SentCount)), 4)
	}
	if out.ByMonth, err = s.repo.AcceptedByMonth(ctx, a.TenantID, r); err != nil {
		return Summary{}, err
	}
	if out.ByRM, err = s.repo.ByRM(ctx, a.TenantID, r); err != nil {
		return Summary{}, err
	}
	if out.ByTeam, err = s.repo.ByTeam(ctx, a.TenantID, r); err != nil {
		return Summary{}, err
	}
	return out, nil
}
