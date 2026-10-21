package postgres

import (
	"context"
	"fmt"

	"github.com/konrawitAEK/swiftquote/backend/go-service/internal/domain"
)

// Put* insert reference data that has no API yet (tenants, users, clients).
// They mirror memory.Store so tests can seed either store the same way.

func (s *Store) PutOrganization(ctx context.Context, o domain.Organization) error {
	_, err := s.pool.Exec(ctx,
		`INSERT INTO organizations (id, name, slug, currency) VALUES ($1, $2, $3, COALESCE(NULLIF($4, ''), 'THB'))`,
		o.ID, o.Name, slugOrID(o), o.Currency)
	if err != nil {
		return fmt.Errorf("put organization: %w", err)
	}
	return nil
}

func (s *Store) PutUser(ctx context.Context, u domain.User, m domain.Membership) error {
	_, err := s.pool.Exec(ctx, `
		WITH ins AS (
			INSERT INTO users (id, email, password_hash, full_name) VALUES ($1, $2, $3, $4)
		)
		INSERT INTO organization_members (organization_id, user_id, role) VALUES ($5, $1, $6)`,
		u.ID, u.Email, u.PasswordHash, u.FullName, m.OrganizationID, string(m.Role))
	if err != nil {
		return fmt.Errorf("put user: %w", err)
	}
	return nil
}

func (s *Store) PutClient(ctx context.Context, c domain.Client) error {
	_, err := s.pool.Exec(ctx,
		`INSERT INTO clients (id, organization_id, name, email) VALUES ($1, $2, $3, NULLIF($4, ''))`,
		c.ID, c.OrganizationID, c.Name, c.Email)
	if err != nil {
		return fmt.Errorf("put client: %w", err)
	}
	return nil
}

func slugOrID(o domain.Organization) string {
	if o.Slug != "" {
		return o.Slug
	}
	return o.ID.String()
}
