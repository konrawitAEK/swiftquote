// Package postgres implements the repositories on the shared schema in db/migrations.
package postgres

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"
	pgxdecimal "github.com/jackc/pgx-shopspring-decimal"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/konrawitAEK/swiftquote/backend/go-service/internal/domain"
)

const (
	uniqueViolation     = "23505"
	foreignKeyViolation = "23503"
)

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

func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == uniqueViolation
}

func isForeignKeyViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == foreignKeyViolation
}

// FindLogin implements auth.Repository. A user in several tenants logs into their earliest active membership.
func (s *Store) FindLogin(ctx context.Context, email string) (domain.User, domain.Membership, error) {
	var u domain.User
	var m domain.Membership
	var role string
	err := s.pool.QueryRow(ctx, `
		SELECT u.id, u.email, u.password_hash, u.full_name, m.organization_id, m.role, m.team_id, m.client_id
		FROM users u
		JOIN organization_members m ON m.user_id = u.id
		WHERE lower(u.email) = lower($1) AND m.active
		ORDER BY m.created_at
		LIMIT 1`, email,
	).Scan(&u.ID, &u.Email, &u.PasswordHash, &u.FullName, &m.OrganizationID, &role, &m.TeamID, &m.ClientID)
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.User{}, domain.Membership{}, domain.ErrNotFound
	}
	if err != nil {
		return domain.User{}, domain.Membership{}, fmt.Errorf("find login: %w", err)
	}
	m.UserID, m.Role, m.Active = u.ID, domain.Role(role), true
	return u, m, nil
}

// LoadActor implements auth.Repository.
func (s *Store) LoadActor(ctx context.Context, tenantID, userID uuid.UUID) (domain.Actor, error) {
	a := domain.Actor{UserID: userID, TenantID: tenantID}
	var role string
	err := s.pool.QueryRow(ctx, `
		SELECT u.full_name, m.role, m.team_id, m.client_id
		FROM organization_members m
		JOIN users u ON u.id = m.user_id
		WHERE m.organization_id = $1 AND m.user_id = $2 AND m.active`, tenantID, userID,
	).Scan(&a.Name, &role, &a.TeamID, &a.ClientID)
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.Actor{}, domain.ErrNotFound
	}
	if err != nil {
		return domain.Actor{}, fmt.Errorf("load actor: %w", err)
	}
	a.Role = domain.Role(role)
	return a, nil
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

// ClientExists implements quote.Repository and admin.Repository.
func (s *Store) ClientExists(ctx context.Context, orgID, clientID uuid.UUID) (bool, error) {
	return s.exists(ctx, `SELECT EXISTS (SELECT 1 FROM clients WHERE id = $1 AND organization_id = $2)`, clientID, orgID)
}

func (s *Store) exists(ctx context.Context, sql string, args ...any) (bool, error) {
	var ok bool
	if err := s.pool.QueryRow(ctx, sql, args...).Scan(&ok); err != nil {
		return false, fmt.Errorf("exists: %w", err)
	}
	return ok, nil
}
