// Package domain holds the core SwiftQuote entities, independent of transport and storage.
package domain

import (
	"time"

	"github.com/google/uuid"
	"github.com/shopspring/decimal"
)

type QuoteStatus string

const (
	StatusDraft    QuoteStatus = "draft"
	StatusSent     QuoteStatus = "sent"
	StatusViewed   QuoteStatus = "viewed"
	StatusAccepted QuoteStatus = "accepted"
	StatusRejected QuoteStatus = "rejected"
	StatusExpired  QuoteStatus = "expired"
)

func (s QuoteStatus) Valid() bool {
	switch s {
	case StatusDraft, StatusSent, StatusViewed, StatusAccepted, StatusRejected, StatusExpired:
		return true
	}
	return false
}

// QuoteItem is a single priced line. Monetary fields use decimal, never float.
type QuoteItem struct {
	ID              uuid.UUID
	Title           string
	Description     string
	Quantity        decimal.Decimal
	UnitPrice       decimal.Decimal
	DiscountPercent decimal.Decimal
	TaxPercent      decimal.Decimal
	LineTotal       decimal.Decimal
}

type Quote struct {
	ID             uuid.UUID
	OrganizationID uuid.UUID
	ClientID       uuid.UUID
	DealID         *uuid.UUID
	QuoteNumber    string
	Status         QuoteStatus
	ExpiryDate     time.Time
	Subtotal       decimal.Decimal
	DiscountAmount decimal.Decimal
	TaxAmount      decimal.Decimal
	GrandTotal     decimal.Decimal
	AccessToken    uuid.UUID
	SignedBy       *string
	SignatureData  *string
	SignedAt       *time.Time
	Items          []QuoteItem
	CreatedAt      time.Time
}
