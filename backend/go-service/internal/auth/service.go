// Package auth handles login and JWT issuance/verification.
//
// Token claims are part of the cross-backend contract (see BearerAuth in contracts/openapi.yaml):
// HS256, sub = user id, tid = tenant (organization) id, role, exp.
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
	// FindLogin returns the user by email (case-insensitive) with their membership, or domain.ErrNotFound.
	FindLogin(ctx context.Context, email string) (domain.User, domain.Membership, error)
}

// Principal is the authenticated caller extracted from a token.
type Principal struct {
	UserID   uuid.UUID
	TenantID uuid.UUID
	Role     domain.Role
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

// Login verifies credentials. Unknown email and wrong password both return domain.ErrUnauthorized.
func (s *Service) Login(ctx context.Context, email, password string) (LoginResult, error) {
	user, m, err := s.repo.FindLogin(ctx, strings.TrimSpace(email))
	if errors.Is(err, domain.ErrNotFound) {
		return LoginResult{}, domain.ErrUnauthorized
	}
	if err != nil {
		return LoginResult{}, err
	}
	if bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(password)) != nil {
		return LoginResult{}, domain.ErrUnauthorized
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

// Verify parses a bearer token. Any failure returns domain.ErrUnauthorized.
func (s *Service) Verify(token string) (Principal, error) {
	var c claims
	_, err := jwt.ParseWithClaims(token, &c, func(*jwt.Token) (any, error) { return s.secret, nil },
		jwt.WithValidMethods([]string{jwt.SigningMethodHS256.Alg()}),
		jwt.WithExpirationRequired(),
		jwt.WithTimeFunc(s.now),
	)
	if err != nil {
		return Principal{}, domain.ErrUnauthorized
	}
	userID, err1 := uuid.Parse(c.Subject)
	tenantID, err2 := uuid.Parse(c.TenantID)
	if err1 != nil || err2 != nil {
		return Principal{}, domain.ErrUnauthorized
	}
	return Principal{UserID: userID, TenantID: tenantID, Role: domain.Role(c.Role)}, nil
}
