package domain

import (
	"github.com/google/uuid"
	"github.com/shopspring/decimal"
)

type Role string

const (
	RoleAdmin    Role = "admin"
	RoleWOC      Role = "woc"
	RoleWO       Role = "wo"
	RoleRM       Role = "rm"
	RoleCustomer Role = "customer"
)

func (r Role) Valid() bool {
	switch r {
	case RoleAdmin, RoleWOC, RoleWO, RoleRM, RoleCustomer:
		return true
	}
	return false
}

type User struct {
	ID           uuid.UUID
	Email        string
	PasswordHash string
	FullName     string
}

// Membership links a user to the tenant they act in, with their role and placement.
type Membership struct {
	OrganizationID uuid.UUID
	UserID         uuid.UUID
	Role           Role
	TeamID         *uuid.UUID // rm only
	ClientID       *uuid.UUID // customer only
	Active         bool
}

// Actor is the authenticated caller, loaded from the database on every request so role changes
// and deactivation apply immediately.
type Actor struct {
	UserID   uuid.UUID
	Name     string
	TenantID uuid.UUID
	Role     Role
	TeamID   *uuid.UUID
	ClientID *uuid.UUID
}

// Ref is a lightweight {id, name} reference used in responses.
type Ref struct {
	ID   uuid.UUID
	Name string
}

// Category classifies quote lines; retired categories stay on existing quotes.
type Category struct {
	ID     uuid.UUID
	Name   string
	Active bool
}

type Client struct {
	ID             uuid.UUID
	OrganizationID uuid.UUID
	Name           string
	Email          string
}

// Product is a catalog entry quote lines are made from. Stock nil means it is not tracked.
type Product struct {
	ID        uuid.UUID
	Name      string
	Category  Ref
	UnitPrice decimal.Decimal
	UnitCost  decimal.Decimal
	Stock     *decimal.Decimal
	Active    bool
}
