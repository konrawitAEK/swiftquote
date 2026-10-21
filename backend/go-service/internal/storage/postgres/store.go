// Package postgres implements the auth and quote repositories on the shared schema in db/migrations.
package postgres

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	pgxdecimal "github.com/jackc/pgx-shopspring-decimal"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/konrawitAEK/swiftquote/backend/go-service/internal/domain"
	"github.com/konrawitAEK/swiftquote/backend/go-service/internal/quote"
)

const uniqueViolation = "23505"

// Connect opens a pool with NUMERIC mapped to shopspring/decimal. Connections are lazy.
func Connect(ctx context.Context, databaseURL string) (*pgxpool.Pool, error) {
	cfg, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		return nil, fmt.Errorf("parse database url: %w", err)
	}
	cfg.AfterConnect = func(_ context.Context, conn *pgx.Conn) error {
		pgxdecimal.Register(conn.TypeMap())
		return nil
	}
	return pgxpool.NewWithConfig(ctx, cfg)
}

type Store struct {
	pool *pgxpool.Pool
}

func New(pool *pgxpool.Pool) *Store {
	return &Store{pool: pool}
}

// FindLogin implements auth.Repository. A user in several tenants logs into their earliest membership.
func (s *Store) FindLogin(ctx context.Context, email string) (domain.User, domain.Membership, error) {
	var u domain.User
	var m domain.Membership
	var role string
	err := s.pool.QueryRow(ctx, `
		SELECT u.id, u.email, u.password_hash, u.full_name, m.organization_id, m.role
		FROM users u
		JOIN organization_members m ON m.user_id = u.id
		WHERE lower(u.email) = lower($1)
		ORDER BY m.created_at
		LIMIT 1`, email,
	).Scan(&u.ID, &u.Email, &u.PasswordHash, &u.FullName, &m.OrganizationID, &role)
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.User{}, domain.Membership{}, domain.ErrNotFound
	}
	if err != nil {
		return domain.User{}, domain.Membership{}, fmt.Errorf("find login: %w", err)
	}
	m.UserID = u.ID
	m.Role = domain.Role(role)
	return u, m, nil
}

// ListClients implements client.Repository.
func (s *Store) ListClients(ctx context.Context, orgID uuid.UUID) ([]domain.Client, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id, organization_id, name, COALESCE(email, '')
		FROM clients
		WHERE organization_id = $1
		ORDER BY name, id`, orgID)
	if err != nil {
		return nil, fmt.Errorf("list clients: %w", err)
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (domain.Client, error) {
		var c domain.Client
		err := row.Scan(&c.ID, &c.OrganizationID, &c.Name, &c.Email)
		return c, err
	})
}

// The methods below implement quote.Repository.

func (s *Store) ClientBelongsTo(ctx context.Context, orgID, clientID uuid.UUID) (bool, error) {
	var ok bool
	err := s.pool.QueryRow(ctx,
		`SELECT EXISTS (SELECT 1 FROM clients WHERE id = $1 AND organization_id = $2)`, clientID, orgID,
	).Scan(&ok)
	if err != nil {
		return false, fmt.Errorf("check client: %w", err)
	}
	return ok, nil
}

func (s *Store) Create(ctx context.Context, q *domain.Quote) error {
	return pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `
			INSERT INTO quotes (id, organization_id, client_id, deal_id, quote_number, status, expiry_date,
				subtotal, discount_amount, tax_amount, grand_total, access_token,
				signed_by, signature_data, signed_at, created_at)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
			q.ID, q.OrganizationID, q.ClientID, q.DealID, q.QuoteNumber, string(q.Status), q.ExpiryDate,
			q.Subtotal, q.DiscountAmount, q.TaxAmount, q.GrandTotal, q.AccessToken,
			q.SignedBy, q.SignatureData, q.SignedAt, q.CreatedAt,
		)
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == uniqueViolation {
			return domain.ErrConflict
		}
		if err != nil {
			return fmt.Errorf("insert quote: %w", err)
		}

		batch := &pgx.Batch{}
		for i, it := range q.Items {
			batch.Queue(`
				INSERT INTO quote_items (id, quote_id, title, description, quantity, unit_price,
					discount_percent, tax_percent, line_total, position)
				VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
				it.ID, q.ID, it.Title, it.Description, it.Quantity, it.UnitPrice,
				it.DiscountPercent, it.TaxPercent, it.LineTotal, i,
			)
		}
		if err := tx.SendBatch(ctx, batch).Close(); err != nil {
			return fmt.Errorf("insert quote items: %w", err)
		}
		return nil
	})
}

func (s *Store) List(ctx context.Context, orgID uuid.UUID, status *domain.QuoteStatus) ([]quote.Summary, error) {
	var statusFilter *string
	if status != nil {
		v := string(*status)
		statusFilter = &v
	}
	rows, err := s.pool.Query(ctx, `
		SELECT q.id, q.quote_number, c.name, q.status, q.grand_total, q.expiry_date
		FROM quotes q
		JOIN clients c ON c.id = q.client_id
		WHERE q.organization_id = $1 AND ($2::text IS NULL OR q.status = $2)
		ORDER BY q.created_at DESC`, orgID, statusFilter)
	if err != nil {
		return nil, fmt.Errorf("list quotes: %w", err)
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (quote.Summary, error) {
		var r quote.Summary
		var st string
		err := row.Scan(&r.ID, &r.QuoteNumber, &r.ClientName, &st, &r.GrandTotal, &r.ExpiryDate)
		r.Status = domain.QuoteStatus(st)
		return r, err
	})
}

const quoteColumns = `q.id, q.organization_id, q.client_id, q.deal_id, q.quote_number, q.status, q.expiry_date,
	q.subtotal, q.discount_amount, q.tax_amount, q.grand_total, q.access_token,
	q.signed_by, q.signature_data, q.signed_at, COALESCE(q.created_at, now())`

func scanQuote(row pgx.Row, extra ...any) (domain.Quote, error) {
	var q domain.Quote
	var st string
	dest := append([]any{
		&q.ID, &q.OrganizationID, &q.ClientID, &q.DealID, &q.QuoteNumber, &st, &q.ExpiryDate,
		&q.Subtotal, &q.DiscountAmount, &q.TaxAmount, &q.GrandTotal, &q.AccessToken,
		&q.SignedBy, &q.SignatureData, &q.SignedAt, &q.CreatedAt,
	}, extra...)
	if err := row.Scan(dest...); err != nil {
		return domain.Quote{}, err
	}
	q.Status = domain.QuoteStatus(st)
	q.CreatedAt = q.CreatedAt.UTC()
	if q.SignedAt != nil {
		t := q.SignedAt.UTC()
		q.SignedAt = &t
	}
	return q, nil
}

func (s *Store) Get(ctx context.Context, orgID, id uuid.UUID) (domain.Quote, error) {
	q, err := scanQuote(s.pool.QueryRow(ctx, `
		SELECT `+quoteColumns+`
		FROM quotes q
		WHERE q.id = $1 AND q.organization_id = $2`, id, orgID))
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.Quote{}, domain.ErrNotFound
	}
	if err != nil {
		return domain.Quote{}, fmt.Errorf("get quote: %w", err)
	}
	if q.Items, err = s.items(ctx, q.ID); err != nil {
		return domain.Quote{}, err
	}
	return q, nil
}

func (s *Store) GetPublic(ctx context.Context, accessToken uuid.UUID) (quote.PublicView, error) {
	var v quote.PublicView
	q, err := scanQuote(s.pool.QueryRow(ctx, `
		SELECT `+quoteColumns+`, o.name
		FROM quotes q
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

func (s *Store) UpdateStatus(ctx context.Context, id uuid.UUID, to domain.QuoteStatus, from ...domain.QuoteStatus) error {
	tag, err := s.pool.Exec(ctx,
		`UPDATE quotes SET status = $2 WHERE id = $1 AND status = ANY($3)`, id, string(to), statusStrings(from))
	if err != nil {
		return fmt.Errorf("update quote status: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return s.missingOrConflict(ctx, id)
	}
	return nil
}

func (s *Store) Accept(ctx context.Context, id uuid.UUID, signedBy, signatureData string, at time.Time) (domain.Quote, error) {
	q, err := scanQuote(s.pool.QueryRow(ctx, `
		UPDATE quotes q
		SET status = $2, signed_by = $3, signature_data = $4, signed_at = $5
		WHERE q.id = $1 AND q.status = ANY($6)
		RETURNING `+quoteColumns,
		id, string(domain.StatusAccepted), signedBy, signatureData, at, statusStrings(quote.AcceptableStatuses())))
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.Quote{}, s.missingOrConflict(ctx, id)
	}
	if err != nil {
		return domain.Quote{}, fmt.Errorf("accept quote: %w", err)
	}
	if q.Items, err = s.items(ctx, q.ID); err != nil {
		return domain.Quote{}, err
	}
	return q, nil
}

func (s *Store) items(ctx context.Context, quoteID uuid.UUID) ([]domain.QuoteItem, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id, title, COALESCE(description, ''), quantity, unit_price, discount_percent, tax_percent, line_total
		FROM quote_items
		WHERE quote_id = $1
		ORDER BY position, id`, quoteID)
	if err != nil {
		return nil, fmt.Errorf("list quote items: %w", err)
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (domain.QuoteItem, error) {
		var it domain.QuoteItem
		err := row.Scan(&it.ID, &it.Title, &it.Description, &it.Quantity, &it.UnitPrice,
			&it.DiscountPercent, &it.TaxPercent, &it.LineTotal)
		return it, err
	})
}

// missingOrConflict distinguishes a failed conditional update on an absent row from one on a row in the wrong state.
func (s *Store) missingOrConflict(ctx context.Context, id uuid.UUID) error {
	var exists bool
	if err := s.pool.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM quotes WHERE id = $1)`, id).Scan(&exists); err != nil {
		return fmt.Errorf("check quote: %w", err)
	}
	if !exists {
		return domain.ErrNotFound
	}
	return domain.ErrConflict
}

func statusStrings(ss []domain.QuoteStatus) []string {
	out := make([]string, len(ss))
	for i, s := range ss {
		out[i] = string(s)
	}
	return out
}
