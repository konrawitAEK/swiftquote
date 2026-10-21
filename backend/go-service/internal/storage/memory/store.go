// Package memory is an in-process implementation of the auth and quote repositories,
// used until the Postgres repositories land. Data is lost on restart.
package memory

import (
	"context"
	"slices"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"

	"github.com/konrawitAEK/swiftquote/backend/go-service/internal/domain"
	"github.com/konrawitAEK/swiftquote/backend/go-service/internal/quote"
)

type Store struct {
	mu          sync.RWMutex
	orgs        map[uuid.UUID]domain.Organization
	users       map[uuid.UUID]domain.User
	memberships map[uuid.UUID]domain.Membership // keyed by user id
	clients     map[uuid.UUID]domain.Client
	quotes      map[uuid.UUID]domain.Quote
}

func NewStore() *Store {
	return &Store{
		orgs:        map[uuid.UUID]domain.Organization{},
		users:       map[uuid.UUID]domain.User{},
		memberships: map[uuid.UUID]domain.Membership{},
		clients:     map[uuid.UUID]domain.Client{},
		quotes:      map[uuid.UUID]domain.Quote{},
	}
}

func (s *Store) PutOrganization(_ context.Context, o domain.Organization) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.orgs[o.ID] = o
	return nil
}

func (s *Store) PutUser(_ context.Context, u domain.User, m domain.Membership) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.users[u.ID] = u
	s.memberships[u.ID] = m
	return nil
}

func (s *Store) PutClient(_ context.Context, c domain.Client) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.clients[c.ID] = c
	return nil
}

// FindLogin implements auth.Repository.
func (s *Store) FindLogin(_ context.Context, email string) (domain.User, domain.Membership, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	for _, u := range s.users {
		if strings.EqualFold(u.Email, email) {
			m, ok := s.memberships[u.ID]
			if !ok {
				return domain.User{}, domain.Membership{}, domain.ErrNotFound
			}
			return u, m, nil
		}
	}
	return domain.User{}, domain.Membership{}, domain.ErrNotFound
}

// The methods below implement quote.Repository.

func (s *Store) ClientBelongsTo(_ context.Context, orgID, clientID uuid.UUID) (bool, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	c, ok := s.clients[clientID]
	return ok && c.OrganizationID == orgID, nil
}

func (s *Store) Create(_ context.Context, q *domain.Quote) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, existing := range s.quotes {
		if existing.OrganizationID == q.OrganizationID && existing.QuoteNumber == q.QuoteNumber {
			return domain.ErrConflict
		}
	}
	s.quotes[q.ID] = cloneQuote(*q)
	return nil
}

func (s *Store) List(_ context.Context, orgID uuid.UUID, status *domain.QuoteStatus) ([]quote.Summary, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	var qs []domain.Quote
	for _, q := range s.quotes {
		if q.OrganizationID == orgID && (status == nil || q.Status == *status) {
			qs = append(qs, q)
		}
	}
	sort.Slice(qs, func(i, j int) bool { return qs[i].CreatedAt.After(qs[j].CreatedAt) })

	out := make([]quote.Summary, 0, len(qs))
	for _, q := range qs {
		out = append(out, quote.Summary{
			ID:          q.ID,
			QuoteNumber: q.QuoteNumber,
			ClientName:  s.clients[q.ClientID].Name,
			Status:      q.Status,
			GrandTotal:  q.GrandTotal,
			ExpiryDate:  q.ExpiryDate,
		})
	}
	return out, nil
}

func (s *Store) GetPublic(_ context.Context, accessToken uuid.UUID) (quote.PublicView, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	for _, q := range s.quotes {
		if q.AccessToken == accessToken {
			org := s.orgs[q.OrganizationID]
			return quote.PublicView{Quote: cloneQuote(q), VendorName: org.Name, VendorLogo: org.LogoURL}, nil
		}
	}
	return quote.PublicView{}, domain.ErrNotFound
}

func (s *Store) UpdateStatus(_ context.Context, id uuid.UUID, to domain.QuoteStatus, from ...domain.QuoteStatus) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	q, ok := s.quotes[id]
	if !ok {
		return domain.ErrNotFound
	}
	if !slices.Contains(from, q.Status) {
		return domain.ErrConflict
	}
	q.Status = to
	s.quotes[id] = q
	return nil
}

func (s *Store) Accept(_ context.Context, id uuid.UUID, signedBy, signatureData string, at time.Time) (domain.Quote, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	q, ok := s.quotes[id]
	if !ok {
		return domain.Quote{}, domain.ErrNotFound
	}
	if !slices.Contains(quote.AcceptableStatuses(), q.Status) {
		return domain.Quote{}, domain.ErrConflict
	}
	q.Status = domain.StatusAccepted
	q.SignedBy = &signedBy
	q.SignatureData = &signatureData
	q.SignedAt = &at
	s.quotes[id] = q
	return cloneQuote(q), nil
}

// cloneQuote copies the items slice so callers cannot mutate stored state.
func cloneQuote(q domain.Quote) domain.Quote {
	q.Items = slices.Clone(q.Items)
	return q
}
