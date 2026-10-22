package postgres

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/konrawitAEK/swiftquote/backend/go-service/internal/catalog"
	"github.com/konrawitAEK/swiftquote/backend/go-service/internal/domain"
)

// The methods in this file implement catalog.Repository and quote.Repository's category lookup.

func (s *Store) ListCategories(ctx context.Context, orgID uuid.UUID) ([]domain.Category, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id, name, active FROM product_categories WHERE organization_id = $1 ORDER BY name, id`, orgID)
	if err != nil {
		return nil, fmt.Errorf("list categories: %w", err)
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (domain.Category, error) {
		var c domain.Category
		err := row.Scan(&c.ID, &c.Name, &c.Active)
		return c, err
	})
}

func (s *Store) GetCategory(ctx context.Context, orgID, id uuid.UUID) (domain.Category, error) {
	var c domain.Category
	err := s.pool.QueryRow(ctx, `
		SELECT id, name, active FROM product_categories WHERE organization_id = $1 AND id = $2`, orgID, id,
	).Scan(&c.ID, &c.Name, &c.Active)
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.Category{}, domain.ErrNotFound
	}
	if err != nil {
		return domain.Category{}, fmt.Errorf("get category: %w", err)
	}
	return c, nil
}

func (s *Store) CreateCategory(ctx context.Context, orgID uuid.UUID, name string) (uuid.UUID, error) {
	id := uuid.New()
	_, err := s.pool.Exec(ctx, `INSERT INTO product_categories (id, organization_id, name) VALUES ($1, $2, $3)`,
		id, orgID, name)
	if isUniqueViolation(err) {
		return uuid.Nil, catalog.ErrDuplicate
	}
	if err != nil {
		return uuid.Nil, fmt.Errorf("insert category: %w", err)
	}
	return id, nil
}

func (s *Store) UpdateCategory(ctx context.Context, orgID, id uuid.UUID, name string, active bool) error {
	_, err := s.pool.Exec(ctx, `
		UPDATE product_categories SET name = $3, active = $4 WHERE organization_id = $1 AND id = $2`,
		orgID, id, name, active)
	if isUniqueViolation(err) {
		return catalog.ErrDuplicate
	}
	if err != nil {
		return fmt.Errorf("update category: %w", err)
	}
	return nil
}

func (s *Store) CategoryInUse(ctx context.Context, _, id uuid.UUID) (bool, error) {
	return s.exists(ctx, `SELECT EXISTS (SELECT 1 FROM quote_items WHERE category_id = $1)`, id)
}

func (s *Store) DeleteCategory(ctx context.Context, orgID, id uuid.UUID) error {
	_, err := s.pool.Exec(ctx, `DELETE FROM product_categories WHERE organization_id = $1 AND id = $2`, orgID, id)
	if isForeignKeyViolation(err) {
		return catalog.ErrInUse
	}
	if err != nil {
		return fmt.Errorf("delete category: %w", err)
	}
	return nil
}

func (s *Store) ActiveCategoryIDs(ctx context.Context, orgID uuid.UUID) (map[uuid.UUID]bool, error) {
	rows, err := s.pool.Query(ctx, `SELECT id FROM product_categories WHERE organization_id = $1 AND active`, orgID)
	if err != nil {
		return nil, fmt.Errorf("active categories: %w", err)
	}
	ids, err := pgx.CollectRows(rows, pgx.RowTo[uuid.UUID])
	if err != nil {
		return nil, err
	}
	out := make(map[uuid.UUID]bool, len(ids))
	for _, id := range ids {
		out[id] = true
	}
	return out, nil
}
