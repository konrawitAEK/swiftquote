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
