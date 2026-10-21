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

// Measures, reported side by side so the client can switch views without refetching:
//   - won: accepted
//   - pending: sent or viewed and not yet expired (waiting on the customer)
//   - inApproval: pending_approval or approved (not yet with the customer)
// Amounts are grand totals incl. VAT; category amounts are line total plus that line's VAT.

// Range filters quotes by UTC creation date; nil bounds are open and both are inclusive.
type Range struct {
	From *time.Time
	To   *time.Time
}

type Measure struct {
	Count  int
	Amount decimal.Decimal
}

func zero() Measure { return Measure{Amount: decimal.Zero} }

type StatusRow struct {
	Status domain.QuoteStatus
	Count  int
	Amount decimal.Decimal
}

// MonthRow groups won quotes by the month they were signed and pending ones by the month they expire.
type MonthRow struct {
	Month   string // YYYY-MM
	Won     Measure
	Pending Measure
}

type RMRow struct {
	User       domain.Ref
	Team       *string
	QuoteCount int
	SentCount  int
	Won        Measure
	Pending    Measure
}

type TeamRow struct {
	ID      uuid.UUID
	Name    string
	Won     Measure
	Pending Measure
}

// CategoryRow counts quote lines; Category is nil for lines created before categories existed.
type CategoryRow struct {
	Category *domain.Ref
	Won      Measure
	Pending  Measure
}

type Summary struct {
	Range          Range
	Won            Measure
	Pending        Measure
	InApproval     Measure
	SentCount      int
	ConversionRate decimal.Decimal
	ByStatus       []StatusRow
	ByMonth        []MonthRow
	ByRM           []RMRow
	ByTeam         []TeamRow
	ByCategory     []CategoryRow
}

// Repository returns the aggregates; row ordering is the repository's job.
type Repository interface {
	CountByStatus(ctx context.Context, orgID uuid.UUID, r Range) ([]StatusRow, error)
	PendingTotal(ctx context.Context, orgID uuid.UUID, r Range) (Measure, error)
	ByMonth(ctx context.Context, orgID uuid.UUID, r Range) ([]MonthRow, error)
	ByRM(ctx context.Context, orgID uuid.UUID, r Range) ([]RMRow, error)
	ByTeam(ctx context.Context, orgID uuid.UUID, r Range) ([]TeamRow, error)
	ByCategory(ctx context.Context, orgID uuid.UUID, r Range) ([]CategoryRow, error)
}

type Service struct {
	repo Repository
}

func NewService(repo Repository) *Service {
	return &Service{repo: repo}
}

var (
	sentStatuses       = []domain.QuoteStatus{domain.StatusSent, domain.StatusViewed, domain.StatusAccepted, domain.StatusRejected}
	inApprovalStatuses = []domain.QuoteStatus{domain.StatusPendingApproval, domain.StatusApproved}
)

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
	out := Summary{Range: r, Won: zero(), InApproval: zero(), ConversionRate: decimal.Zero}
	for _, st := range domain.AllStatuses {
		row := StatusRow{Status: st, Amount: decimal.Zero}
		if i := slices.IndexFunc(counts, func(c StatusRow) bool { return c.Status == st }); i >= 0 {
			row = counts[i]
		}
		out.ByStatus = append(out.ByStatus, row)
		if st == domain.StatusAccepted {
			out.Won = Measure{Count: row.Count, Amount: row.Amount}
		}
		if slices.Contains(inApprovalStatuses, st) {
			out.InApproval.Count += row.Count
			out.InApproval.Amount = out.InApproval.Amount.Add(row.Amount)
		}
		if slices.Contains(sentStatuses, st) {
			out.SentCount += row.Count
		}
	}
	if out.SentCount > 0 {
		out.ConversionRate = decimal.NewFromInt(int64(out.Won.Count)).
			DivRound(decimal.NewFromInt(int64(out.SentCount)), 4)
	}
	if out.Pending, err = s.repo.PendingTotal(ctx, a.TenantID, r); err != nil {
		return Summary{}, err
	}
	if out.ByMonth, err = s.repo.ByMonth(ctx, a.TenantID, r); err != nil {
		return Summary{}, err
	}
	if out.ByRM, err = s.repo.ByRM(ctx, a.TenantID, r); err != nil {
		return Summary{}, err
	}
	if out.ByTeam, err = s.repo.ByTeam(ctx, a.TenantID, r); err != nil {
		return Summary{}, err
	}
	if out.ByCategory, err = s.repo.ByCategory(ctx, a.TenantID, r); err != nil {
		return Summary{}, err
	}
	return out, nil
}
