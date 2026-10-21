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
// The SQL is shared verbatim with the Spring and Node services so all three aggregate identically.

const inRange = `($2::date IS NULL OR (q.created_at AT TIME ZONE 'UTC')::date >= $2)
	AND ($3::date IS NULL OR (q.created_at AT TIME ZONE 'UTC')::date <= $3)`

const (
	isWon     = `q.status = 'accepted'`
	isPending = `(q.status IN ('sent', 'viewed') AND q.expiry_date >= (now() AT TIME ZONE 'UTC')::date)`
	isSent    = `q.status IN ('sent', 'viewed', 'accepted', 'rejected')`
	// Line amount incl. VAT, rounded per line exactly like pricing, so categories add up to grand totals.
	lineGross = `(i.line_total + round(i.line_total * i.tax_percent / 100, 2))`
)

// measureScan receives a (count, amount) column pair.
type measureScan struct {
	count  int64
	amount decimal.Decimal
}

func (m *measureScan) dest() []any { return []any{&m.count, &m.amount} }

func (m measureScan) measure() dashboard.Measure {
	return dashboard.Measure{Count: int(m.count), Amount: m.amount}
}

// scanWithMeasures scans the leading columns into head, then a won and a pending measure.
func scanWithMeasures(row pgx.CollectableRow, head ...any) (won, pending dashboard.Measure, err error) {
	var w, p measureScan
	err = row.Scan(append(append(head, w.dest()...), p.dest()...)...)
	return w.measure(), p.measure(), err
}

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

func (s *Store) PendingTotal(ctx context.Context, orgID uuid.UUID, r dashboard.Range) (dashboard.Measure, error) {
	var n int64
	var m dashboard.Measure
	err := s.pool.QueryRow(ctx, `
		SELECT count(*), COALESCE(sum(q.grand_total), 0)
		FROM quotes q
		WHERE q.organization_id = $1 AND `+isPending+` AND `+inRange, orgID, r.From, r.To).Scan(&n, &m.Amount)
	if err != nil {
		return dashboard.Measure{}, fmt.Errorf("pending total: %w", err)
	}
	m.Count = int(n)
	return m, nil
}

func (s *Store) ByMonth(ctx context.Context, orgID uuid.UUID, r dashboard.Range) ([]dashboard.MonthRow, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT month, sum(won_count), sum(won_amount), sum(pending_count), sum(pending_amount)
		FROM (
			SELECT to_char(q.signed_at AT TIME ZONE 'UTC', 'YYYY-MM') AS month,
				1 AS won_count, q.grand_total AS won_amount, 0 AS pending_count, 0 AS pending_amount
			FROM quotes q
			WHERE q.organization_id = $1 AND `+isWon+` AND q.signed_at IS NOT NULL AND `+inRange+`
			UNION ALL
			SELECT to_char(q.expiry_date, 'YYYY-MM'), 0, 0, 1, q.grand_total
			FROM quotes q
			WHERE q.organization_id = $1 AND `+isPending+` AND `+inRange+`
		) m
		GROUP BY month
		ORDER BY month`, orgID, r.From, r.To)
	if err != nil {
		return nil, fmt.Errorf("by month: %w", err)
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (dashboard.MonthRow, error) {
		var out dashboard.MonthRow
		var err error
		out.Won, out.Pending, err = scanWithMeasures(row, &out.Month)
		return out, err
	})
}

func (s *Store) ByRM(ctx context.Context, orgID uuid.UUID, r dashboard.Range) ([]dashboard.RMRow, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT u.id, u.full_name, t.name,
			count(*),
			count(*) FILTER (WHERE `+isSent+`),
			count(*) FILTER (WHERE `+isWon+`),
			COALESCE(sum(q.grand_total) FILTER (WHERE `+isWon+`), 0) AS won_amount,
			count(*) FILTER (WHERE `+isPending+`),
			COALESCE(sum(q.grand_total) FILTER (WHERE `+isPending+`), 0)
		FROM quotes q
		JOIN users u ON u.id = q.created_by
		LEFT JOIN organization_members m ON m.user_id = u.id AND m.organization_id = q.organization_id
		LEFT JOIN teams t ON t.id = m.team_id
		WHERE q.organization_id = $1 AND `+inRange+`
		GROUP BY u.id, u.full_name, t.name
		ORDER BY won_amount DESC, u.full_name, u.id`, orgID, r.From, r.To)
	if err != nil {
		return nil, fmt.Errorf("by rm: %w", err)
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (dashboard.RMRow, error) {
		var out dashboard.RMRow
		var quotes, sent int64
		var err error
		out.Won, out.Pending, err = scanWithMeasures(row, &out.User.ID, &out.User.Name, &out.Team, &quotes, &sent)
		out.QuoteCount, out.SentCount = int(quotes), int(sent)
		return out, err
	})
}

func (s *Store) ByTeam(ctx context.Context, orgID uuid.UUID, r dashboard.Range) ([]dashboard.TeamRow, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT t.id, t.name,
			count(q.id) FILTER (WHERE `+isWon+`),
			COALESCE(sum(q.grand_total) FILTER (WHERE `+isWon+`), 0) AS won_amount,
			count(q.id) FILTER (WHERE `+isPending+`),
			COALESCE(sum(q.grand_total) FILTER (WHERE `+isPending+`), 0)
		FROM teams t
		LEFT JOIN organization_members m ON m.team_id = t.id
		LEFT JOIN quotes q ON q.created_by = m.user_id AND q.organization_id = t.organization_id AND `+inRange+`
		WHERE t.organization_id = $1
		GROUP BY t.id, t.name
		ORDER BY won_amount DESC, t.name, t.id`, orgID, r.From, r.To)
	if err != nil {
		return nil, fmt.Errorf("by team: %w", err)
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (dashboard.TeamRow, error) {
		var out dashboard.TeamRow
		var err error
		out.Won, out.Pending, err = scanWithMeasures(row, &out.ID, &out.Name)
		return out, err
	})
}

func (s *Store) ByCategory(ctx context.Context, orgID uuid.UUID, r dashboard.Range) ([]dashboard.CategoryRow, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT c.id, c.name,
			count(*) FILTER (WHERE `+isWon+`),
			COALESCE(sum(`+lineGross+`) FILTER (WHERE `+isWon+`), 0) AS won_amount,
			count(*) FILTER (WHERE `+isPending+`),
			COALESCE(sum(`+lineGross+`) FILTER (WHERE `+isPending+`), 0)
		FROM quote_items i
		JOIN quotes q ON q.id = i.quote_id
		LEFT JOIN product_categories c ON c.id = i.category_id
		WHERE q.organization_id = $1 AND (`+isWon+` OR `+isPending+`) AND `+inRange+`
		GROUP BY c.id, c.name
		ORDER BY (c.id IS NULL), won_amount DESC, c.name, c.id`, orgID, r.From, r.To)
	if err != nil {
		return nil, fmt.Errorf("by category: %w", err)
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (dashboard.CategoryRow, error) {
		var out dashboard.CategoryRow
		var id *uuid.UUID
		var name *string
		var err error
		out.Won, out.Pending, err = scanWithMeasures(row, &id, &name)
		out.Category = ref(id, name)
		return out, err
	})
}
