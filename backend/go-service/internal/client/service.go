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

func (s *Service) List(ctx context.Context, orgID uuid.UUID) ([]domain.Client, error) {
	return s.repo.ListClients(ctx, orgID)
}
