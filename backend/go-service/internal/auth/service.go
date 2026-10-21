// Package auth handles login, JWT issuance/verification and loading the calling actor.
//
// Token claims are part of the cross-backend contract (see BearerAuth in contracts/openapi.yaml):
// HS256, sub = user id, tid = tenant (organization) id, role, exp. The role claim is informational;
// the actor's current role and active flag are read from the database on every request.
package auth

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"

	"github.com/konrawitAEK/swiftquote/backend/go-service/internal/domain"
)

const tokenTTL = 24 * time.Hour

type Repository interface {
	// FindLogin returns an active user by email (case-insensitive) with their membership, or domain.ErrNotFound.
	FindLogin(ctx context.Context, email string) (domain.User, domain.Membership, error)
	// LoadActor returns the active member userID of tenantID, or domain.ErrNotFound.
	LoadActor(ctx context.Context, tenantID, userID uuid.UUID) (domain.Actor, error)
}

type LoginResult struct {
	AccessToken string
	User        domain.User
	Membership  domain.Membership
}

type Service struct {
	repo   Repository
	secret []byte
	now    func() time.Time
}

func NewService(repo Repository, secret string) *Service {
	return &Service{repo: repo, secret: []byte(secret), now: time.Now}
}

type claims struct {
	TenantID string `json:"tid"`
	Role     string `json:"role"`
	jwt.RegisteredClaims
}

// Login verifies credentials. Unknown email, inactive account and wrong password all fail the same way.
func (s *Service) Login(ctx context.Context, email, password string) (LoginResult, error) {
	invalid := domain.Unauthorized("invalid email or password")
	user, m, err := s.repo.FindLogin(ctx, strings.TrimSpace(email))
	if errors.Is(err, domain.ErrNotFound) {
		return LoginResult{}, invalid
	}
	if err != nil {
		return LoginResult{}, err
	}
	if bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(password)) != nil {
		return LoginResult{}, invalid
	}

	now := s.now()
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims{
		TenantID: m.OrganizationID.String(),
		Role:     string(m.Role),
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   user.ID.String(),
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(tokenTTL)),
		},
	})
	signed, err := token.SignedString(s.secret)
	if err != nil {
		return LoginResult{}, fmt.Errorf("sign token: %w", err)
	}
	return LoginResult{AccessToken: signed, User: user, Membership: m}, nil
}

// Authenticate verifies a bearer token and loads the actor it belongs to.
func (s *Service) Authenticate(ctx context.Context, token string) (domain.Actor, error) {
	var c claims
	_, err := jwt.ParseWithClaims(token, &c, func(*jwt.Token) (any, error) { return s.secret, nil },
		jwt.WithValidMethods([]string{jwt.SigningMethodHS256.Alg()}),
		jwt.WithExpirationRequired(),
		jwt.WithTimeFunc(s.now),
	)
	if err != nil {
		return domain.Actor{}, domain.Unauthorized("invalid or expired token")
	}
	userID, err1 := uuid.Parse(c.Subject)
	tenantID, err2 := uuid.Parse(c.TenantID)
	if err1 != nil || err2 != nil {
		return domain.Actor{}, domain.Unauthorized("invalid or expired token")
	}
	actor, err := s.repo.LoadActor(ctx, tenantID, userID)
	if errors.Is(err, domain.ErrNotFound) {
		return domain.Actor{}, domain.Unauthorized("account is inactive")
	}
	return actor, err
}

// HashPassword is shared with user administration so all hashes use the same cost.
func HashPassword(password string) (string, error) {
	h, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	return string(h), err
}
