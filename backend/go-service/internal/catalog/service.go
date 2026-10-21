// Package catalog manages product categories used to classify quote lines.
package catalog

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/google/uuid"

	"github.com/konrawitAEK/swiftquote/backend/go-service/internal/domain"
)

// Rules and messages are mirrored by the Spring and Node services.

// ErrDuplicate is returned by repositories when a category name already exists in the tenant.
var ErrDuplicate = errors.New("duplicate category")

type Repository interface {
	// ListCategories returns all categories of the tenant, active or not, ordered by name.
	ListCategories(ctx context.Context, orgID uuid.UUID) ([]domain.Category, error)
	GetCategory(ctx context.Context, orgID, id uuid.UUID) (domain.Category, error)
	CreateCategory(ctx context.Context, orgID uuid.UUID, name string) (uuid.UUID, error)
	UpdateCategory(ctx context.Context, orgID, id uuid.UUID, name string, active bool) error
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
