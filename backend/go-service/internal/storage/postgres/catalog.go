package postgres

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/shopspring/decimal"

	"github.com/konrawitAEK/swiftquote/backend/go-service/internal/catalog"
	"github.com/konrawitAEK/swiftquote/backend/go-service/internal/domain"
)

// The methods in this file implement catalog.Repository and quote.Repository's product lookups.

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

func (s *Store) CategoryHasProducts(ctx context.Context, _, id uuid.UUID) (bool, error) {
	return s.exists(ctx, `SELECT EXISTS (SELECT 1 FROM products WHERE category_id = $1)`, id)
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

const productColumns = `
	SELECT p.id, p.name, c.id, c.name, p.unit_price, p.unit_cost, p.stock, p.active
	FROM products p
	JOIN product_categories c ON c.id = p.category_id`

func scanProduct(row pgx.Row) (domain.Product, error) {
	var p domain.Product
	err := row.Scan(&p.ID, &p.Name, &p.Category.ID, &p.Category.Name, &p.UnitPrice, &p.UnitCost, &p.Stock, &p.Active)
	return p, err
}

func (s *Store) ListProducts(ctx context.Context, orgID uuid.UUID) ([]domain.Product, error) {
	rows, err := s.pool.Query(ctx, productColumns+` WHERE p.organization_id = $1 ORDER BY p.name, p.id`, orgID)
	if err != nil {
		return nil, fmt.Errorf("list products: %w", err)
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (domain.Product, error) { return scanProduct(row) })
}

func (s *Store) GetProduct(ctx context.Context, orgID, id uuid.UUID) (domain.Product, error) {
	p, err := scanProduct(s.pool.QueryRow(ctx, productColumns+` WHERE p.organization_id = $1 AND p.id = $2`, orgID, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.Product{}, domain.ErrNotFound
	}
	if err != nil {
		return domain.Product{}, fmt.Errorf("get product: %w", err)
	}
	return p, nil
}

func (s *Store) CreateProduct(ctx context.Context, orgID uuid.UUID, p domain.Product) (uuid.UUID, error) {
	id := uuid.New()
	_, err := s.pool.Exec(ctx, `
		INSERT INTO products (id, organization_id, category_id, name, unit_price, unit_cost, stock, active)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
		id, orgID, p.Category.ID, p.Name, p.UnitPrice, p.UnitCost, p.Stock, p.Active)
	if isUniqueViolation(err) {
		return uuid.Nil, catalog.ErrDuplicateProduct
	}
	if err != nil {
		return uuid.Nil, fmt.Errorf("insert product: %w", err)
	}
	return id, nil
}

func (s *Store) UpdateProduct(ctx context.Context, orgID uuid.UUID, p domain.Product) error {
	_, err := s.pool.Exec(ctx, `
		UPDATE products SET category_id = $3, name = $4, unit_price = $5, unit_cost = $6, stock = $7, active = $8
		WHERE organization_id = $1 AND id = $2`,
		orgID, p.ID, p.Category.ID, p.Name, p.UnitPrice, p.UnitCost, p.Stock, p.Active)
	if isUniqueViolation(err) {
		return catalog.ErrDuplicateProduct
	}
	if err != nil {
		return fmt.Errorf("update product: %w", err)
	}
	return nil
}

func (s *Store) ProductInUse(ctx context.Context, _, id uuid.UUID) (bool, error) {
	return s.exists(ctx, `SELECT EXISTS (SELECT 1 FROM quote_items WHERE product_id = $1)`, id)
}

func (s *Store) DeleteProduct(ctx context.Context, orgID, id uuid.UUID) error {
	_, err := s.pool.Exec(ctx, `DELETE FROM products WHERE organization_id = $1 AND id = $2`, orgID, id)
	if isForeignKeyViolation(err) {
		return catalog.ErrInUse
	}
	if err != nil {
		return fmt.Errorf("delete product: %w", err)
	}
	return nil
}

func (s *Store) ActiveProducts(ctx context.Context, orgID uuid.UUID) (map[uuid.UUID]domain.Product, error) {
	rows, err := s.pool.Query(ctx, productColumns+` WHERE p.organization_id = $1 AND p.active`, orgID)
	if err != nil {
		return nil, fmt.Errorf("active products: %w", err)
	}
	ps, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (domain.Product, error) { return scanProduct(row) })
	if err != nil {
		return nil, err
	}
	out := make(map[uuid.UUID]domain.Product, len(ps))
	for _, p := range ps {
		out[p.ID] = p
	}
	return out, nil
}

func (s *Store) TrackedStock(ctx context.Context, orgID uuid.UUID, ids []uuid.UUID) (map[uuid.UUID]decimal.Decimal, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id, stock FROM products WHERE organization_id = $1 AND id = ANY($2) AND stock IS NOT NULL`, orgID, ids)
	if err != nil {
		return nil, fmt.Errorf("tracked stock: %w", err)
	}
	out := map[uuid.UUID]decimal.Decimal{}
	var id uuid.UUID
	var stock decimal.Decimal
	_, err = pgx.ForEachRow(rows, []any{&id, &stock}, func() error {
		out[id] = stock
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("tracked stock: %w", err)
	}
	return out, nil
}
