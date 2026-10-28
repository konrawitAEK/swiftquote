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
	// Line cost and profit before VAT; NULL (so left out of sums) when the line has no unit cost.
	lineCost   = `round(i.quantity * i.unit_cost, 2)`
	lineProfit = `(i.line_total - round(i.quantity * i.unit_cost, 2))`
	// quoteCost joins qc.cost and qc.profit per quote q, summed over its lines that have a unit cost.
	quoteCost = `LEFT JOIN (
			SELECT i.quote_id, sum(` + lineCost + `) AS cost, sum(` + lineProfit + `) AS profit
			FROM quote_items i
			WHERE i.unit_cost IS NOT NULL
			GROUP BY i.quote_id
		) qc ON qc.quote_id = q.id`
)

// measureCols is the (count, amount, cost, profit) column list of a measure over the quotes matching cond.
func measureCols(cond string) string {
	f := ` FILTER (WHERE ` + cond + `), 0)`
	return `count(q.id) FILTER (WHERE ` + cond + `),
			COALESCE(sum(q.grand_total)` + f + `,
			COALESCE(sum(qc.cost)` + f + `,
			COALESCE(sum(qc.profit)` + f
}

// measureScan receives a (count, amount, cost, profit) column group.
type measureScan struct {
	count                int64
	amount, cost, profit decimal.Decimal
}

func (m *measureScan) dest() []any { return []any{&m.count, &m.amount, &m.cost, &m.profit} }

func (m measureScan) measure() dashboard.Measure {
	return dashboard.Measure{Count: int(m.count), Amount: m.amount, Cost: m.cost, Profit: m.profit}
}

// scanWithMeasures scans the leading columns into head, then a won and a pending measure.
func scanWithMeasures(row pgx.CollectableRow, head ...any) (won, pending dashboard.Measure, err error) {
	var w, p measureScan
	err = row.Scan(append(append(head, w.dest()...), p.dest()...)...)
	return w.measure(), p.measure(), err
}

func (s *Store) CountByStatus(ctx context.Context, orgID uuid.UUID, r dashboard.Range) ([]dashboard.StatusRow, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT q.status, count(*), COALESCE(sum(q.grand_total), 0), COALESCE(sum(qc.cost), 0), COALESCE(sum(qc.profit), 0)
		FROM quotes q
		`+quoteCost+`
		WHERE q.organization_id = $1 AND `+inRange+`
		GROUP BY q.status`, orgID, r.From, r.To)
	if err != nil {
		return nil, fmt.Errorf("count by status: %w", err)
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (dashboard.StatusRow, error) {
		var out dashboard.StatusRow
		var st string
		var m measureScan
		err := row.Scan(append([]any{&st}, m.dest()...)...)
		out.Status, out.Measure = domain.QuoteStatus(st), m.measure()
		return out, err
	})
}

func (s *Store) PendingTotal(ctx context.Context, orgID uuid.UUID, r dashboard.Range) (dashboard.Measure, error) {
	var m measureScan
	err := s.pool.QueryRow(ctx, `
		SELECT count(*), COALESCE(sum(q.grand_total), 0), COALESCE(sum(qc.cost), 0), COALESCE(sum(qc.profit), 0)
		FROM quotes q
		`+quoteCost+`
		WHERE q.organization_id = $1 AND `+isPending+` AND `+inRange, orgID, r.From, r.To).Scan(m.dest()...)
	if err != nil {
		return dashboard.Measure{}, fmt.Errorf("pending total: %w", err)
	}
	return m.measure(), nil
}

func (s *Store) ByMonth(ctx context.Context, orgID uuid.UUID, r dashboard.Range) ([]dashboard.MonthRow, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT month, sum(won_count), sum(won_amount), sum(won_cost), sum(won_profit),
			sum(pending_count), sum(pending_amount), sum(pending_cost), sum(pending_profit)
		FROM (
			SELECT to_char(q.signed_at AT TIME ZONE 'UTC', 'YYYY-MM') AS month,
				1 AS won_count, q.grand_total AS won_amount,
				COALESCE(qc.cost, 0) AS won_cost, COALESCE(qc.profit, 0) AS won_profit,
				0 AS pending_count, 0 AS pending_amount, 0 AS pending_cost, 0 AS pending_profit
			FROM quotes q
			`+quoteCost+`
			WHERE q.organization_id = $1 AND `+isWon+` AND q.signed_at IS NOT NULL AND `+inRange+`
			UNION ALL
			SELECT to_char(q.expiry_date, 'YYYY-MM'), 0, 0, 0, 0,
				1, q.grand_total, COALESCE(qc.cost, 0), COALESCE(qc.profit, 0)
			FROM quotes q
			`+quoteCost+`
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
			`+measureCols(isWon)+`,
			`+measureCols(isPending)+`
		FROM quotes q
		`+quoteCost+`
		JOIN users u ON u.id = q.created_by
		LEFT JOIN organization_members m ON m.user_id = u.id AND m.organization_id = q.organization_id
		LEFT JOIN teams t ON t.id = m.team_id
		WHERE q.organization_id = $1 AND `+inRange+`
		GROUP BY u.id, u.full_name, t.name
		ORDER BY COALESCE(sum(q.grand_total) FILTER (WHERE `+isWon+`), 0) DESC, u.full_name, u.id`, orgID, r.From, r.To)
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
			`+measureCols(isWon)+`,
			`+measureCols(isPending)+`
		FROM teams t
		LEFT JOIN organization_members m ON m.team_id = t.id
		LEFT JOIN quotes q ON q.created_by = m.user_id AND q.organization_id = t.organization_id AND `+inRange+`
		`+quoteCost+`
		WHERE t.organization_id = $1
		GROUP BY t.id, t.name
		ORDER BY COALESCE(sum(q.grand_total) FILTER (WHERE `+isWon+`), 0) DESC, t.name, t.id`, orgID, r.From, r.To)
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
			COALESCE(sum(`+lineCost+`) FILTER (WHERE `+isWon+`), 0),
			COALESCE(sum(`+lineProfit+`) FILTER (WHERE `+isWon+`), 0),
			count(*) FILTER (WHERE `+isPending+`),
			COALESCE(sum(`+lineGross+`) FILTER (WHERE `+isPending+`), 0),
			COALESCE(sum(`+lineCost+`) FILTER (WHERE `+isPending+`), 0),
			COALESCE(sum(`+lineProfit+`) FILTER (WHERE `+isPending+`), 0)
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
