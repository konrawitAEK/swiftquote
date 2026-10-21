// Package client exposes the tenant's client directory.
package client

import (
	"context"

	"github.com/google/uuid"

	"github.com/konrawitAEK/swiftquote/backend/go-service/internal/domain"
)

type Repository interface {
	// ListClients returns the tenant's clients ordered by name.
	ListClients(ctx context.Context, orgID uuid.UUID) ([]domain.Client, error)
}

type Service struct {
	repo Repository
}

func NewService(repo Repository) *Service {
	return &Service{repo: repo}
}

// List is for RMs picking a client and admins linking customers to one.
func (s *Service) List(ctx context.Context, a domain.Actor) ([]domain.Client, error) {
	if a.Role != domain.RoleRM && a.Role != domain.RoleAdmin {
		return nil, domain.ErrRoleForbidden
	}
	return s.repo.ListClients(ctx, a.TenantID)
}
