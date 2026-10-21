package postgres

import (
	"context"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/shopspring/decimal"

	"github.com/konrawitAEK/swiftquote/backend/go-service/internal/dashboard"
	"github.com/konrawitAEK/swiftquote/backend/go-service/internal/domain"
)

// The methods in this file implement dashboard.Repository. $2/$3 are the optional inclusive UTC date bounds.

const inRange = `($2::date IS NULL OR (q.created_at AT TIME ZONE 'UTC')::date >= $2)
	AND ($3::date IS NULL OR (q.created_at AT TIME ZONE 'UTC')::date <= $3)`

const sentStatusesSQL = `('sent', 'viewed', 'accepted', 'rejected')`

func (s *Store) CountByStatus(ctx context.Context, orgID uuid.UUID, r dashboard.Range) ([]dashboard.StatusRow, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT q.status, count(*), COALESCE(sum(q.grand_total), 0)
		FROM quotes q
		WHERE q.organization_id = $1 AND `+inRange+`
		GROUP BY q.status`, orgID, r.From, r.To)
	if err != nil {
		return nil, fmt.Errorf("count by status: %w", err)
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (dashboard.StatusRow, error) {
		var out dashboard.StatusRow
		var st string
		var n int64
		err := row.Scan(&st, &n, &out.Amount)
		out.Status, out.Count = domain.QuoteStatus(st), int(n)
		return out, err
	})
}

func (s *Store) AcceptedByMonth(ctx context.Context, orgID uuid.UUID, r dashboard.Range) ([]dashboard.MonthRow, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT to_char(q.signed_at AT TIME ZONE 'UTC', 'YYYY-MM') AS month, count(*), sum(q.grand_total)
		FROM quotes q
		WHERE q.organization_id = $1 AND q.status = 'accepted' AND q.signed_at IS NOT NULL AND `+inRange+`
		GROUP BY month
		ORDER BY month`, orgID, r.From, r.To)
	if err != nil {
		return nil, fmt.Errorf("accepted by month: %w", err)
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (dashboard.MonthRow, error) {
		var out dashboard.MonthRow
		var n int64
		err := row.Scan(&out.Month, &n, &out.AcceptedAmount)
		out.AcceptedCount = int(n)
		return out, err
	})
}

func (s *Store) ByRM(ctx context.Context, orgID uuid.UUID, r dashboard.Range) ([]dashboard.RMRow, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT u.id, u.full_name, t.name,
			count(*),
			count(*) FILTER (WHERE q.status IN `+sentStatusesSQL+`),
			count(*) FILTER (WHERE q.status = 'accepted'),
			COALESCE(sum(q.grand_total) FILTER (WHERE q.status = 'accepted'), 0) AS accepted_amount
		FROM quotes q
		JOIN users u ON u.id = q.created_by
		LEFT JOIN organization_members m ON m.user_id = u.id AND m.organization_id = q.organization_id
		LEFT JOIN teams t ON t.id = m.team_id
		WHERE q.organization_id = $1 AND `+inRange+`
		GROUP BY u.id, u.full_name, t.name
		ORDER BY accepted_amount DESC, u.full_name, u.id`, orgID, r.From, r.To)
	if err != nil {
		return nil, fmt.Errorf("by rm: %w", err)
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (dashboard.RMRow, error) {
		var out dashboard.RMRow
		var quotes, sent, accepted int64
		err := row.Scan(&out.User.ID, &out.User.Name, &out.Team, &quotes, &sent, &accepted, &out.AcceptedAmount)
		out.QuoteCount, out.SentCount, out.AcceptedCount = int(quotes), int(sent), int(accepted)
		return out, err
	})
}

func (s *Store) ByTeam(ctx context.Context, orgID uuid.UUID, r dashboard.Range) ([]dashboard.TeamRow, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT t.id, t.name,
			count(q.id) FILTER (WHERE q.status = 'accepted'),
			COALESCE(sum(q.grand_total) FILTER (WHERE q.status = 'accepted'), 0) AS accepted_amount
		FROM teams t
		LEFT JOIN organization_members m ON m.team_id = t.id
		LEFT JOIN quotes q ON q.created_by = m.user_id AND q.organization_id = t.organization_id AND `+inRange+`
		WHERE t.organization_id = $1
		GROUP BY t.id, t.name
		ORDER BY accepted_amount DESC, t.name, t.id`, orgID, r.From, r.To)
	if err != nil {
		return nil, fmt.Errorf("by team: %w", err)
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (dashboard.TeamRow, error) {
		var out dashboard.TeamRow
		var accepted int64
		var amount decimal.Decimal
		err := row.Scan(&out.ID, &out.Name, &accepted, &amount)
		out.AcceptedCount, out.AcceptedAmount = int(accepted), amount
		return out, err
	})
}
