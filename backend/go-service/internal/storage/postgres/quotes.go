package postgres

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/shopspring/decimal"

	"github.com/konrawitAEK/swiftquote/backend/go-service/internal/domain"
	"github.com/konrawitAEK/swiftquote/backend/go-service/internal/quote"
)

// The methods in this file implement quote.Repository.

// quoteColumns/quoteFrom join the client, the creator and the creator's current team so visibility can be decided.
const quoteColumns = `
	SELECT q.id, q.organization_id, q.client_id, c.name, q.deal_id, q.quote_number, q.status, q.expiry_date,
		q.subtotal, q.discount_amount, q.tax_amount, q.grand_total, q.access_token,
		q.signed_by, q.signature_data, q.signed_at, COALESCE(q.created_at, now()),
		cb.id, cb.full_name, t.wo_user_id`

const quoteFrom = `
	FROM quotes q
	JOIN clients c ON c.id = q.client_id
	LEFT JOIN users cb ON cb.id = q.created_by
	LEFT JOIN organization_members cm ON cm.user_id = q.created_by AND cm.organization_id = q.organization_id
	LEFT JOIN teams t ON t.id = cm.team_id`

func scanQuote(row pgx.Row, extra ...any) (domain.Quote, error) {
	var q domain.Quote
	var status string
	var creatorID *uuid.UUID
	var creatorName *string
	dest := append([]any{
		&q.ID, &q.OrganizationID, &q.ClientID, &q.ClientName, &q.DealID, &q.QuoteNumber, &status, &q.ExpiryDate,
		&q.Subtotal, &q.DiscountAmount, &q.TaxAmount, &q.GrandTotal, &q.AccessToken,
		&q.SignedBy, &q.SignatureData, &q.SignedAt, &q.CreatedAt,
		&creatorID, &creatorName, &q.CreatorTeamWO,
	}, extra...)
	if err := row.Scan(dest...); err != nil {
		return domain.Quote{}, err
	}
	q.Status = domain.QuoteStatus(status)
	q.CreatedAt = q.CreatedAt.UTC()
	if q.SignedAt != nil {
		t := q.SignedAt.UTC()
		q.SignedAt = &t
	}
	if creatorID != nil && creatorName != nil {
		q.CreatedBy = &domain.Ref{ID: *creatorID, Name: *creatorName}
	}
	return q, nil
}

func (s *Store) Create(ctx context.Context, q *domain.Quote, ev quote.NewEvent) error {
	return pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		var createdBy *uuid.UUID
		if q.CreatedBy != nil {
			createdBy = &q.CreatedBy.ID
		}
		_, err := tx.Exec(ctx, `
			INSERT INTO quotes (id, organization_id, client_id, deal_id, quote_number, status, expiry_date,
				subtotal, discount_amount, tax_amount, grand_total, access_token, created_by, created_at)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
			q.ID, q.OrganizationID, q.ClientID, q.DealID, q.QuoteNumber, string(q.Status), q.ExpiryDate,
			q.Subtotal, q.DiscountAmount, q.TaxAmount, q.GrandTotal, q.AccessToken, createdBy, q.CreatedAt,
		)
		if isUniqueViolation(err) {
			return quote.ErrDuplicateNumber
		}
		if err != nil {
			return fmt.Errorf("insert quote: %w", err)
		}
		if err := insertItems(ctx, tx, q); err != nil {
			return err
		}
		return insertEvent(ctx, tx, q.ID, ev)
	})
}

func (s *Store) Replace(ctx context.Context, q *domain.Quote, ev quote.NewEvent) error {
	return pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `
			UPDATE quotes
			SET client_id = $2, deal_id = $3, quote_number = $4, expiry_date = $5,
				subtotal = $6, discount_amount = $7, tax_amount = $8, grand_total = $9
			WHERE id = $1 AND status = 'draft'`,
			q.ID, q.ClientID, q.DealID, q.QuoteNumber, q.ExpiryDate,
			q.Subtotal, q.DiscountAmount, q.TaxAmount, q.GrandTotal,
		)
		if isUniqueViolation(err) {
			return quote.ErrDuplicateNumber
		}
		if err != nil {
			return fmt.Errorf("update quote: %w", err)
		}
		if tag.RowsAffected() == 0 {
			return domain.ErrConflict
		}
		if _, err := tx.Exec(ctx, `DELETE FROM quote_items WHERE quote_id = $1`, q.ID); err != nil {
			return fmt.Errorf("delete quote items: %w", err)
		}
		if err := insertItems(ctx, tx, q); err != nil {
			return err
		}
		return insertEvent(ctx, tx, q.ID, ev)
	})
}

func insertItems(ctx context.Context, tx pgx.Tx, q *domain.Quote) error {
	batch := &pgx.Batch{}
	for i, it := range q.Items {
		var categoryID, productID *uuid.UUID
		if it.Category != nil {
			categoryID = &it.Category.ID
		}
		if it.Product != nil {
			productID = &it.Product.ID
		}
		batch.Queue(`
			INSERT INTO quote_items (id, quote_id, title, description, quantity, unit_price,
				discount_type, discount_value, tax_percent, line_total, position, category_id, product_id, unit_cost)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
			it.ID, q.ID, it.Title, it.Description, it.Quantity, it.UnitPrice,
			string(it.DiscountType), it.DiscountValue, it.TaxPercent, it.LineTotal, i, categoryID, productID, it.UnitCost,
		)
	}
	if err := tx.SendBatch(ctx, batch).Close(); err != nil {
		return fmt.Errorf("insert quote items: %w", err)
	}
	return nil
}

func insertEvent(ctx context.Context, tx pgx.Tx, quoteID uuid.UUID, ev quote.NewEvent) error {
	_, err := tx.Exec(ctx, `
		INSERT INTO quote_events (quote_id, actor_user_id, action, comment, created_at)
		VALUES ($1, $2, $3, $4, $5)`, quoteID, ev.ActorID, string(ev.Action), ev.Comment, ev.At)
	if err != nil {
		return fmt.Errorf("insert quote event: %w", err)
	}
	return nil
}

func (s *Store) List(ctx context.Context, f quote.ListFilter) ([]quote.Summary, error) {
	var status *string
	if f.Status != nil {
		v := string(*f.Status)
		status = &v
	}
	var statuses []string
	if f.Statuses != nil {
		statuses = statusStrings(f.Statuses)
	}
	rows, err := s.pool.Query(ctx, `
		SELECT q.id, q.quote_number, c.name, q.status, q.grand_total, q.expiry_date, cb.id, cb.full_name
		FROM quotes q
		JOIN clients c ON c.id = q.client_id
		LEFT JOIN users cb ON cb.id = q.created_by
		LEFT JOIN organization_members cm ON cm.user_id = q.created_by AND cm.organization_id = q.organization_id
		LEFT JOIN teams t ON t.id = cm.team_id
		WHERE q.organization_id = $1
			AND ($2::text IS NULL OR q.status = $2)
			AND ($3::uuid IS NULL OR q.created_by = $3)
			AND ($4::uuid IS NULL OR t.wo_user_id = $4)
			AND ($5::uuid IS NULL OR q.client_id = $5)
			AND ($6::text[] IS NULL OR q.status = ANY($6))
		ORDER BY q.created_at DESC, q.id`,
		f.OrgID, status, f.CreatedBy, f.TeamWO, f.ClientID, statuses)
	if err != nil {
		return nil, fmt.Errorf("list quotes: %w", err)
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (quote.Summary, error) {
		var r quote.Summary
		var st string
		var creatorID *uuid.UUID
		var creatorName *string
		err := row.Scan(&r.ID, &r.QuoteNumber, &r.ClientName, &st, &r.GrandTotal, &r.ExpiryDate, &creatorID, &creatorName)
		r.Status = domain.QuoteStatus(st)
		if creatorID != nil && creatorName != nil {
			r.CreatedBy = &domain.Ref{ID: *creatorID, Name: *creatorName}
		}
		return r, err
	})
}

func (s *Store) Get(ctx context.Context, orgID, id uuid.UUID) (domain.Quote, error) {
	q, err := scanQuote(s.pool.QueryRow(ctx, quoteColumns+quoteFrom+` WHERE q.id = $1 AND q.organization_id = $2`, id, orgID))
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.Quote{}, domain.ErrNotFound
	}
	if err != nil {
		return domain.Quote{}, fmt.Errorf("get quote: %w", err)
	}
	if q.Items, err = s.items(ctx, q.ID); err != nil {
		return domain.Quote{}, err
	}
	if q.History, err = s.history(ctx, q.ID); err != nil {
		return domain.Quote{}, err
	}
	return q, nil
}

func (s *Store) GetByAccessToken(ctx context.Context, accessToken uuid.UUID) (quote.PublicView, error) {
	var v quote.PublicView
	q, err := scanQuote(s.pool.QueryRow(ctx, quoteColumns+`, o.name`+quoteFrom+`
		JOIN organizations o ON o.id = q.organization_id
		WHERE q.access_token = $1`, accessToken), &v.VendorName)
	if errors.Is(err, pgx.ErrNoRows) {
		return quote.PublicView{}, domain.ErrNotFound
	}
	if err != nil {
		return quote.PublicView{}, fmt.Errorf("get public quote: %w", err)
	}
	if q.Items, err = s.items(ctx, q.ID); err != nil {
		return quote.PublicView{}, err
	}
	v.Quote = q
	return v, nil
}

func (s *Store) Transition(ctx context.Context, id uuid.UUID, from []domain.QuoteStatus, to domain.QuoteStatus, ev quote.NewEvent) error {
	return pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `UPDATE quotes SET status = $2 WHERE id = $1 AND status = ANY($3)`,
			id, string(to), statusStrings(from))
		if err != nil {
			return fmt.Errorf("update quote status: %w", err)
		}
		if tag.RowsAffected() == 0 {
			return domain.ErrConflict
		}
		return insertEvent(ctx, tx, id, ev)
	})
}

func (s *Store) Accept(ctx context.Context, id uuid.UUID, from []domain.QuoteStatus, signedBy, signatureData string,
	uses []quote.StockUse, ev quote.NewEvent) error {
	return pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `
			UPDATE quotes SET status = 'accepted', signed_by = $2, signature_data = $3, signed_at = $4
			WHERE id = $1 AND status = ANY($5)`,
			id, signedBy, signatureData, ev.At, statusStrings(from))
		if err != nil {
			return fmt.Errorf("accept quote: %w", err)
		}
		if tag.RowsAffected() == 0 {
			return domain.ErrConflict
		}
		if err := deductStock(ctx, tx, uses); err != nil {
			return err
		}
		return insertEvent(ctx, tx, id, ev)
	})
}

// deductStock takes each use from its product's stock with a guarded update, in order; untracked products are
// skipped. The first product without enough stock aborts the transaction with *quote.StockShortage.
func deductStock(ctx context.Context, tx pgx.Tx, uses []quote.StockUse) error {
	if len(uses) == 0 {
		return nil
	}
	// Lock the rows in id order first so two accepts sharing products can't deadlock; the checks below still run
	// in line order, which decides which product a 409 names.
	ids := make([]string, len(uses))
	for i, u := range uses {
		ids[i] = u.ProductID.String()
	}
	if _, err := tx.Exec(ctx, `
		SELECT id FROM products WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE`, ids); err != nil {
		return fmt.Errorf("lock products: %w", err)
	}
	for _, u := range uses {
		tag, err := tx.Exec(ctx, `
			UPDATE products SET stock = stock - $2 WHERE id = $1 AND stock IS NOT NULL AND stock >= $2`,
			u.ProductID, u.Quantity)
		if err != nil {
			return fmt.Errorf("deduct stock: %w", err)
		}
		if tag.RowsAffected() == 1 {
			continue
		}
		var name string
		var stock *decimal.Decimal
		err = tx.QueryRow(ctx, `SELECT name, stock FROM products WHERE id = $1`, u.ProductID).Scan(&name, &stock)
		if errors.Is(err, pgx.ErrNoRows) {
			continue
		}
		if err != nil {
			return fmt.Errorf("read stock: %w", err)
		}
		if stock != nil {
			return &quote.StockShortage{Name: name, Available: *stock}
		}
	}
	return nil
}

// OrganizationName implements quote.Repository.
func (s *Store) OrganizationName(ctx context.Context, orgID uuid.UUID) (string, error) {
	var name string
	if err := s.pool.QueryRow(ctx, `SELECT name FROM organizations WHERE id = $1`, orgID).Scan(&name); err != nil {
		return "", fmt.Errorf("organization name: %w", err)
	}
	return name, nil
}

func (s *Store) items(ctx context.Context, quoteID uuid.UUID) ([]domain.QuoteItem, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT i.id, i.title, COALESCE(i.description, ''), i.quantity, i.unit_price, i.discount_type, i.discount_value,
			ROUND(i.quantity * i.unit_price, 2) - i.line_total, i.tax_percent, i.line_total, i.unit_cost,
			c.id, c.name, p.id, p.name
		FROM quote_items i
		LEFT JOIN product_categories c ON c.id = i.category_id
		LEFT JOIN products p ON p.id = i.product_id
		WHERE i.quote_id = $1
		ORDER BY i.position, i.id`, quoteID)
	if err != nil {
		return nil, fmt.Errorf("list quote items: %w", err)
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (domain.QuoteItem, error) {
		var it domain.QuoteItem
		var categoryID, productID *uuid.UUID
		var categoryName, productName *string
		var discountType string
		err := row.Scan(&it.ID, &it.Title, &it.Description, &it.Quantity, &it.UnitPrice, &discountType,
			&it.DiscountValue, &it.DiscountAmount, &it.TaxPercent, &it.LineTotal, &it.UnitCost,
			&categoryID, &categoryName, &productID, &productName)
		it.DiscountType = domain.DiscountType(discountType)
		it.Category = ref(categoryID, categoryName)
		it.Product = ref(productID, productName)
		return it, err
	})
}

func (s *Store) history(ctx context.Context, quoteID uuid.UUID) ([]domain.QuoteEvent, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT e.action, e.actor_user_id, u.full_name, e.comment, e.created_at
		FROM quote_events e
		LEFT JOIN users u ON u.id = e.actor_user_id
		WHERE e.quote_id = $1
		ORDER BY e.seq`, quoteID)
	if err != nil {
		return nil, fmt.Errorf("list quote events: %w", err)
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (domain.QuoteEvent, error) {
		var e domain.QuoteEvent
		var action string
		var actorID *uuid.UUID
		var actorName *string
		var at time.Time
		err := row.Scan(&action, &actorID, &actorName, &e.Comment, &at)
		e.Action, e.At = domain.EventAction(action), at.UTC()
		if actorID != nil && actorName != nil {
			e.Actor = &domain.Ref{ID: *actorID, Name: *actorName}
		}
		return e, err
	})
}

func statusStrings(ss []domain.QuoteStatus) []string {
	out := make([]string, len(ss))
	for i, s := range ss {
		out[i] = string(s)
	}
	return out
}
