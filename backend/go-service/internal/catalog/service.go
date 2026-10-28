// Package catalog manages products and the product categories used to classify quote lines.
package catalog

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/shopspring/decimal"

	"github.com/konrawitAEK/swiftquote/backend/go-service/internal/domain"
)

// Rules and messages are mirrored by the Spring and Node services.

// ErrDuplicate is returned by repositories when a category name already exists in the tenant.
var ErrDuplicate = errors.New("duplicate category")

// ErrInUse is returned by DeleteCategory and DeleteProduct when a row started referring to it meanwhile.
var ErrInUse = errors.New("in use")

// ErrDuplicateProduct is returned by repositories when a product name already exists in the tenant.
var ErrDuplicateProduct = errors.New("duplicate product")

type Repository interface {
	// ListCategories returns all categories of the tenant, active or not, ordered by name.
	ListCategories(ctx context.Context, orgID uuid.UUID) ([]domain.Category, error)
	GetCategory(ctx context.Context, orgID, id uuid.UUID) (domain.Category, error)
	CreateCategory(ctx context.Context, orgID uuid.UUID, name string) (uuid.UUID, error)
	UpdateCategory(ctx context.Context, orgID, id uuid.UUID, name string, active bool) error
	CategoryInUse(ctx context.Context, orgID, id uuid.UUID) (bool, error)
	CategoryHasProducts(ctx context.Context, orgID, id uuid.UUID) (bool, error)
	DeleteCategory(ctx context.Context, orgID, id uuid.UUID) error

	// ListProducts returns all products of the tenant, active or not, ordered by name.
	ListProducts(ctx context.Context, orgID uuid.UUID) ([]domain.Product, error)
	GetProduct(ctx context.Context, orgID, id uuid.UUID) (domain.Product, error)
	// CreateProduct and UpdateProduct return ErrDuplicateProduct for a name already in use.
	CreateProduct(ctx context.Context, orgID uuid.UUID, p domain.Product) (uuid.UUID, error)
	UpdateProduct(ctx context.Context, orgID uuid.UUID, p domain.Product) error
	ProductInUse(ctx context.Context, orgID, id uuid.UUID) (bool, error)
	DeleteProduct(ctx context.Context, orgID, id uuid.UUID) error
}

type Service struct {
	repo Repository
}

func NewService(repo Repository) *Service {
	return &Service{repo: repo}
}

// List is for RMs picking a category, WOC reading the dashboard and admins managing the list.
func (s *Service) List(ctx context.Context, a domain.Actor) ([]domain.Category, error) {
	switch a.Role {
	case domain.RoleRM, domain.RoleWOC, domain.RoleAdmin:
		return s.repo.ListCategories(ctx, a.TenantID)
	}
	return nil, domain.ErrRoleForbidden
}

func (s *Service) Create(ctx context.Context, a domain.Actor, name string) (domain.Category, error) {
	if a.Role != domain.RoleAdmin {
		return domain.Category{}, domain.ErrRoleForbidden
	}
	name = strings.TrimSpace(name)
	if name == "" {
		return domain.Category{}, domain.Invalid("name is required")
	}
	id, err := s.repo.CreateCategory(ctx, a.TenantID, name)
	if errors.Is(err, ErrDuplicate) {
		return domain.Category{}, domain.Conflict(fmt.Sprintf("category %q already exists", name))
	}
	if err != nil {
		return domain.Category{}, err
	}
	return s.repo.GetCategory(ctx, a.TenantID, id)
}

func (s *Service) Update(ctx context.Context, a domain.Actor, id uuid.UUID, name string, active *bool) (domain.Category, error) {
	if a.Role != domain.RoleAdmin {
		return domain.Category{}, domain.ErrRoleForbidden
	}
	if _, err := s.repo.GetCategory(ctx, a.TenantID, id); errors.Is(err, domain.ErrNotFound) {
		return domain.Category{}, domain.NotFound("category not found")
	} else if err != nil {
		return domain.Category{}, err
	}
	name = strings.TrimSpace(name)
	verr := &domain.ValidationError{}
	if name == "" {
		verr.Add("name is required")
	}
	if active == nil {
		verr.Add("active is required")
	}
	if err := verr.OrNil(); err != nil {
		return domain.Category{}, err
	}
	err := s.repo.UpdateCategory(ctx, a.TenantID, id, name, *active)
	if errors.Is(err, ErrDuplicate) {
		return domain.Category{}, domain.Conflict(fmt.Sprintf("category %q already exists", name))
	}
	if err != nil {
		return domain.Category{}, err
	}
	return s.repo.GetCategory(ctx, a.TenantID, id)
}

// Delete removes a category no quote line uses; used ones are retired (active false) instead.
func (s *Service) Delete(ctx context.Context, a domain.Actor, id uuid.UUID) error {
	if a.Role != domain.RoleAdmin {
		return domain.ErrRoleForbidden
	}
	if _, err := s.repo.GetCategory(ctx, a.TenantID, id); errors.Is(err, domain.ErrNotFound) {
		return domain.NotFound("category not found")
	} else if err != nil {
		return err
	}
	used, err := s.repo.CategoryInUse(ctx, a.TenantID, id)
	if err != nil {
		return err
	}
	if used {
		return errCategoryInUse
	}
	hasProducts, err := s.repo.CategoryHasProducts(ctx, a.TenantID, id)
	if err != nil {
		return err
	}
	if hasProducts {
		return errCategoryHasProducts
	}
	if err := s.repo.DeleteCategory(ctx, a.TenantID, id); errors.Is(err, ErrInUse) {
		return errCategoryInUse
	} else if err != nil {
		return err
	}
	return nil
}

var errCategoryInUse = domain.Conflict("category is used on quotes; retire it instead")
var errCategoryHasProducts = domain.Conflict("category is used by products; move them to another category first")

// ProductInput is a create/update payload as decoded; nil means the field was absent (or null).
type ProductInput struct {
	Name       string
	CategoryID *uuid.UUID
	UnitPrice  *decimal.Decimal
	UnitCost   *decimal.Decimal
	Stock      *decimal.Decimal // nil: not tracked
	Active     *bool            // update only
}

var errProductNotFound = domain.NotFound("product not found")
var errProductInUse = domain.Conflict("product is used on quotes; retire it instead")

// ListProducts is for every internal role; customers never see prices, costs or stock.
func (s *Service) ListProducts(ctx context.Context, a domain.Actor) ([]domain.Product, error) {
	switch a.Role {
	case domain.RoleAdmin, domain.RoleWOC, domain.RoleWO, domain.RoleRM:
		return s.repo.ListProducts(ctx, a.TenantID)
	}
	return nil, domain.ErrRoleForbidden
}

func (s *Service) CreateProduct(ctx context.Context, a domain.Actor, in ProductInput) (domain.Product, error) {
	if a.Role != domain.RoleAdmin {
		return domain.Product{}, domain.ErrRoleForbidden
	}
	p, err := s.checkProduct(ctx, a.TenantID, in, false)
	if err != nil {
		return domain.Product{}, err
	}
	id, err := s.repo.CreateProduct(ctx, a.TenantID, p)
	if errors.Is(err, ErrDuplicateProduct) {
		return domain.Product{}, duplicateProduct(p.Name)
	}
	if err != nil {
		return domain.Product{}, err
	}
	return s.repo.GetProduct(ctx, a.TenantID, id)
}

func (s *Service) UpdateProduct(ctx context.Context, a domain.Actor, id uuid.UUID, in ProductInput) (domain.Product, error) {
	if a.Role != domain.RoleAdmin {
		return domain.Product{}, domain.ErrRoleForbidden
	}
	if _, err := s.repo.GetProduct(ctx, a.TenantID, id); errors.Is(err, domain.ErrNotFound) {
		return domain.Product{}, errProductNotFound
	} else if err != nil {
		return domain.Product{}, err
	}
	p, err := s.checkProduct(ctx, a.TenantID, in, true)
	if err != nil {
		return domain.Product{}, err
	}
	p.ID = id
	err = s.repo.UpdateProduct(ctx, a.TenantID, p)
	if errors.Is(err, ErrDuplicateProduct) {
		return domain.Product{}, duplicateProduct(p.Name)
	}
	if err != nil {
		return domain.Product{}, err
	}
	return s.repo.GetProduct(ctx, a.TenantID, id)
}

// DeleteProduct removes a product no quote line uses; used ones are retired (active false) instead.
func (s *Service) DeleteProduct(ctx context.Context, a domain.Actor, id uuid.UUID) error {
	if a.Role != domain.RoleAdmin {
		return domain.ErrRoleForbidden
	}
	if _, err := s.repo.GetProduct(ctx, a.TenantID, id); errors.Is(err, domain.ErrNotFound) {
		return errProductNotFound
	} else if err != nil {
		return err
	}
	used, err := s.repo.ProductInUse(ctx, a.TenantID, id)
	if err != nil {
		return err
	}
	if used {
		return errProductInUse
	}
	if err := s.repo.DeleteProduct(ctx, a.TenantID, id); errors.Is(err, ErrInUse) {
		return errProductInUse
	} else if err != nil {
		return err
	}
	return nil
}

// checkProduct validates in two passes (required and ranges, then the category) and returns the product to save.
func (s *Service) checkProduct(ctx context.Context, orgID uuid.UUID, in ProductInput, update bool) (domain.Product, error) {
	name := strings.TrimSpace(in.Name)
	verr := &domain.ValidationError{}
	if name == "" {
		verr.Add("name is required")
	}
	if in.CategoryID == nil {
		verr.Add("categoryId is required")
	}
	if in.UnitPrice == nil {
		verr.Add("unitPrice is required")
	}
	if in.UnitCost == nil {
		verr.Add("unitCost is required")
	}
	if in.UnitPrice != nil && in.UnitPrice.IsNegative() {
		verr.Add("unitPrice must not be negative")
	}
	if in.UnitCost != nil && in.UnitCost.IsNegative() {
		verr.Add("unitCost must not be negative")
	}
	if in.Stock != nil && in.Stock.IsNegative() {
		verr.Add("stock must not be negative")
	}
	if update && in.Active == nil {
		verr.Add("active is required")
	}
	if err := verr.OrNil(); err != nil {
		return domain.Product{}, err
	}
	cat, err := s.repo.GetCategory(ctx, orgID, *in.CategoryID)
	if errors.Is(err, domain.ErrNotFound) || (err == nil && !cat.Active) {
		return domain.Product{}, domain.Invalid("categoryId is not an active category")
	}
	if err != nil {
		return domain.Product{}, err
	}
	active := true
	if in.Active != nil {
		active = *in.Active
	}
	return domain.Product{
		Name: name, Category: domain.Ref{ID: cat.ID, Name: cat.Name},
		UnitPrice: *in.UnitPrice, UnitCost: *in.UnitCost, Stock: in.Stock, Active: active,
	}, nil
}

func duplicateProduct(name string) error {
	return domain.Conflict(fmt.Sprintf("product %q already exists", name))
}
