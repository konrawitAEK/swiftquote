// Package domain holds the core SwiftQuote entities, independent of transport and storage.
package domain

import (
	"slices"
	"time"

	"github.com/google/uuid"
	"github.com/shopspring/decimal"
)

type QuoteStatus string

const (
	StatusDraft           QuoteStatus = "draft"
	StatusPendingApproval QuoteStatus = "pending_approval"
	StatusApproved        QuoteStatus = "approved"
	StatusSent            QuoteStatus = "sent"
	StatusViewed          QuoteStatus = "viewed"
	StatusAccepted        QuoteStatus = "accepted"
	StatusRejected        QuoteStatus = "rejected"
	StatusExpired         QuoteStatus = "expired"
)

// AllStatuses is the contract's enum order.
var AllStatuses = []QuoteStatus{
	StatusDraft, StatusPendingApproval, StatusApproved, StatusSent,
	StatusViewed, StatusAccepted, StatusRejected, StatusExpired,
}

// CustomerStatuses are the states a customer can see: the quote has been sent to them.
var CustomerStatuses = []QuoteStatus{StatusSent, StatusViewed, StatusAccepted, StatusRejected}

// RespondableStatuses are the states in which a customer may still accept or reject.
var RespondableStatuses = []QuoteStatus{StatusSent, StatusViewed}

func (s QuoteStatus) Valid() bool { return slices.Contains(AllStatuses, s) }

type EventAction string

const (
	EventCreated   EventAction = "created"
	EventUpdated   EventAction = "updated"
	EventSubmitted EventAction = "submitted"
	EventApproved  EventAction = "approved"
	EventReturned  EventAction = "returned"
	EventSent      EventAction = "sent"
	EventViewed    EventAction = "viewed"
	EventAccepted  EventAction = "accepted"
	EventRejected  EventAction = "rejected"
)

// CustomerEvents are the history entries a customer may see.
var CustomerEvents = []EventAction{EventSent, EventViewed, EventAccepted, EventRejected}

// QuoteEvent is one audit-trail entry. Actor is nil when a customer acted through the share link.
type QuoteEvent struct {
	Action  EventAction
	Actor   *Ref
	Comment *string
	At      time.Time
}

// DiscountType says how a line's DiscountValue is read: a percent of the line or an amount for the whole line.
type DiscountType string

const (
	DiscountPercent DiscountType = "percent"
	DiscountAmount  DiscountType = "amount"
)

func (t DiscountType) Valid() bool { return t == DiscountPercent || t == DiscountAmount }

// QuoteItem is a single priced line. Monetary fields use decimal, never float.
type QuoteItem struct {
	ID            uuid.UUID
	Product       *Ref // nil for lines created before products existed
	Title         string
	Category      *Ref // nil for lines created before categories existed
	Description   string
	Quantity      decimal.Decimal
	UnitPrice     decimal.Decimal
	DiscountType  DiscountType
	DiscountValue decimal.Decimal // a percent or an amount, per DiscountType
	// DiscountAmount is the discount in money; set by pricing, or derived from LineTotal when loaded.
	DiscountAmount decimal.Decimal
	TaxPercent     decimal.Decimal
	LineTotal      decimal.Decimal
	UnitCost       *decimal.Decimal // the product's cost when the line was saved; nil for older lines
}

const moneyPlaces = 2

// CostTotal is round(quantity * unitCost), or nil when the line has no cost.
func (it QuoteItem) CostTotal() *decimal.Decimal {
	if it.UnitCost == nil {
		return nil
	}
	c := it.Quantity.Mul(*it.UnitCost).Round(moneyPlaces)
	return &c
}

// Profit is lineTotal - costTotal (before VAT), or nil when the line has no cost.
func (it QuoteItem) Profit() *decimal.Decimal {
	c := it.CostTotal()
	if c == nil {
		return nil
	}
	p := it.LineTotal.Sub(*c)
	return &p
}

type Quote struct {
	ID             uuid.UUID
	OrganizationID uuid.UUID
	ClientID       uuid.UUID
	ClientName     string
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
	CreatedBy      *Ref
	// CreatorTeamWO is the WO currently leading the creator's team, if any; it decides who may approve.
	CreatorTeamWO *uuid.UUID
	Items         []QuoteItem
	History       []QuoteEvent
	CreatedAt     time.Time
}

// CostTotal sums the lines' costs; nil if any line has no cost.
func (q Quote) CostTotal() *decimal.Decimal {
	total := decimal.Zero
	for _, it := range q.Items {
		c := it.CostTotal()
		if c == nil {
			return nil
		}
		total = total.Add(*c)
	}
	return &total
}

// Profit is subtotal - discountAmount - costTotal (before VAT); nil if any line has no cost.
func (q Quote) Profit() *decimal.Decimal {
	c := q.CostTotal()
	if c == nil {
		return nil
	}
	p := q.Subtotal.Sub(q.DiscountAmount).Sub(*c)
	return &p
}
