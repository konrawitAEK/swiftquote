package domain

import "github.com/google/uuid"

type Role string

const (
	RoleOwner   Role = "owner"
	RoleManager Role = "manager"
	RoleMember  Role = "member"
)

type Organization struct {
	ID       uuid.UUID
	Name     string
	Slug     string
	Currency string
	LogoURL  *string
}

type User struct {
	ID           uuid.UUID
	Email        string
	PasswordHash string
	FullName     string
}

// Membership links a user to the tenant they act in.
type Membership struct {
	OrganizationID uuid.UUID
	UserID         uuid.UUID
	Role           Role
}

type Client struct {
	ID             uuid.UUID
	OrganizationID uuid.UUID
	Name           string
	Email          string
}
