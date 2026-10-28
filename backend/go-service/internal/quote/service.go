package quote

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/shopspring/decimal"

	"github.com/konrawitAEK/swiftquote/backend/go-service/internal/domain"
)

// Rules and messages here are mirrored by the Spring and Node services; change all three together.
// Check order for every action: 403 role, 404 visibility, 400 input, 409 state.

// ErrDuplicateNumber is returned by repositories when (organization, quoteNumber) already exists.
var ErrDuplicateNumber = errors.New("duplicate quote number")

// Summary is a list row; ClientName and CreatedBy are resolved by the repository.
type Summary struct {
	ID          uuid.UUID
	QuoteNumber string
	ClientName  string
	Status      domain.QuoteStatus
	GrandTotal  decimal.Decimal
	ExpiryDate  time.Time
	CreatedBy   *domain.Ref
}

// PublicView is what a customer sees through the share link.
type PublicView struct {
	Quote      domain.Quote
	VendorName string
	VendorLogo *string
}

// ListFilter narrows a tenant's quotes; nil fields do not filter.
type ListFilter struct {
	OrgID     uuid.UUID
	Status    *domain.QuoteStatus
	CreatedBy *uuid.UUID
	TeamWO    *uuid.UUID // quotes whose creator is in a team led by this WO
	ClientID  *uuid.UUID
	Statuses  []domain.QuoteStatus
}

// NewEvent is an audit entry written together with a state change.
type NewEvent struct {
	Action  domain.EventAction
	ActorID *uuid.UUID
	Comment *string
	At      time.Time
}

type Repository interface {
	ClientExists(ctx context.Context, orgID, clientID uuid.UUID) (bool, error)
	// ActiveProducts returns the tenant's active products by id.
	ActiveProducts(ctx context.Context, orgID uuid.UUID) (map[uuid.UUID]domain.Product, error)
	// TrackedStock returns the current stock of those of ids whose stock is tracked (not null).
	TrackedStock(ctx context.Context, orgID uuid.UUID, ids []uuid.UUID) (map[uuid.UUID]decimal.Decimal, error)
	// OrganizationName is the vendor shown on the PDF.
	OrganizationName(ctx context.Context, orgID uuid.UUID) (string, error)
	// Create persists q, its items and ev; a duplicate number returns ErrDuplicateNumber.
	Create(ctx context.Context, q *domain.Quote, ev NewEvent) error
	// Replace overwrites a draft's fields and items; domain.ErrConflict if it is no longer a draft.
	Replace(ctx context.Context, q *domain.Quote, ev NewEvent) error
	List(ctx context.Context, f ListFilter) ([]Summary, error)
	// Get returns a quote of orgID with items, history, client name, creator and creator's team WO.
	Get(ctx context.Context, orgID, id uuid.UUID) (domain.Quote, error)
	GetByAccessToken(ctx context.Context, accessToken uuid.UUID) (PublicView, error)
	// Transition sets status to `to` only if it is one of `from` (else domain.ErrConflict) and records ev.
	Transition(ctx context.Context, id uuid.UUID, from []domain.QuoteStatus, to domain.QuoteStatus, ev NewEvent) error
	// Accept records the signature like Transition to accepted and, in the same transaction, deducts uses
	// from tracked products' stock. If a product no longer has enough it rolls back and returns *StockShortage.
	Accept(ctx context.Context, id uuid.UUID, from []domain.QuoteStatus, signedBy, signatureData string,
		uses []StockUse, ev NewEvent) error
}

// StockUse is a quote's total quantity of one product, in order of the product's first line.
type StockUse struct {
	ProductID uuid.UUID
	Name      string
	Quantity  decimal.Decimal
}

// StockShortage reports a tracked product without enough stock.
type StockShortage struct {
	Name      string
	Available decimal.Decimal
}

func (e *StockShortage) Error() string {
	// Stock is shown rounded to 2 places without trailing zeros: 25, 2.5, 0.
	return domain.Conflict(fmt.Sprintf("not enough stock for %s (available %s)",
		e.Name, e.Available.Round(2).String())).Error()
}

func (e *StockShortage) Unwrap() error { return domain.ErrConflict }

// CreateInput is a create/update payload as decoded; nil means the field was absent.
type CreateInput struct {
	ClientID    *uuid.UUID
	DealID      *uuid.UUID
	QuoteNumber string
	ExpiryDate  *time.Time
	Items       []ItemInput
}

type ItemInput struct {
	ProductID     *uuid.UUID
	Description   string
	Quantity      *decimal.Decimal
	UnitPrice     *decimal.Decimal // default: the product's unitPrice
	DiscountType  *string          // default percent
	DiscountValue *decimal.Decimal // default 0
	TaxPercent    *decimal.Decimal // default 7
}

var defaultTaxPercent = decimal.NewFromInt(7)

// validated is a CreateInput that passed validation, with priced items.
type validated struct {
	clientID    uuid.UUID
	dealID      *uuid.UUID
	quoteNumber string
	expiryDate  time.Time
	items       []domain.QuoteItem
	totals      Totals
}

type Service struct {
	repo Repository
	now  func() time.Time
}

func NewService(repo Repository) *Service {
	return &Service{repo: repo, now: time.Now}
}

var notFound = domain.NotFound("quote not found")
var publicNotFound = domain.NotFound("quote expired or not found")

func stateConflict(verb string, s domain.QuoteStatus) error {
	return domain.Conflict(fmt.Sprintf("cannot %s a quote that is %s", verb, s))
}

func (s *Service) Create(ctx context.Context, a domain.Actor, in CreateInput) (domain.Quote, error) {
	if a.Role != domain.RoleRM {
		return domain.Quote{}, domain.ErrRoleForbidden
	}
	v, err := s.validate(ctx, a.TenantID, in)
	if err != nil {
		return domain.Quote{}, err
	}
	q := domain.Quote{
		ID:             uuid.New(),
		OrganizationID: a.TenantID,
		ClientID:       v.clientID,
		DealID:         v.dealID,
		QuoteNumber:    v.quoteNumber,
		Status:         domain.StatusDraft,
		ExpiryDate:     v.expiryDate,
		Subtotal:       v.totals.Subtotal,
		DiscountAmount: v.totals.DiscountAmount,
		TaxAmount:      v.totals.TaxAmount,
		GrandTotal:     v.totals.GrandTotal,
		AccessToken:    uuid.New(),
		CreatedBy:      &domain.Ref{ID: a.UserID, Name: a.Name},
		Items:          v.items,
		CreatedAt:      s.now().UTC(),
	}
	if err := s.repo.Create(ctx, &q, s.event(domain.EventCreated, &a.UserID, nil)); err != nil {
		return domain.Quote{}, duplicate(err, q.QuoteNumber)
	}
	return s.Get(ctx, a, q.ID)
}

func (s *Service) Update(ctx context.Context, a domain.Actor, id uuid.UUID, in CreateInput) (domain.Quote, error) {
	if a.Role != domain.RoleRM {
		return domain.Quote{}, domain.ErrRoleForbidden
	}
	current, err := s.visible(ctx, a, id)
	if err != nil {
		return domain.Quote{}, err
	}
	v, err := s.validate(ctx, a.TenantID, in)
	if err != nil {
		return domain.Quote{}, err
	}
	if current.Status != domain.StatusDraft {
		return domain.Quote{}, stateConflict("edit", current.Status)
	}
	current.ClientID = v.clientID
	current.DealID = v.dealID
	current.QuoteNumber = v.quoteNumber
	current.ExpiryDate = v.expiryDate
	current.Subtotal = v.totals.Subtotal
	current.DiscountAmount = v.totals.DiscountAmount
	current.TaxAmount = v.totals.TaxAmount
	current.GrandTotal = v.totals.GrandTotal
	current.Items = v.items
	err = s.repo.Replace(ctx, &current, s.event(domain.EventUpdated, &a.UserID, nil))
	if errors.Is(err, domain.ErrConflict) {
		return domain.Quote{}, s.raced(ctx, a.TenantID, id, "edit", err)
	}
	if err != nil {
		return domain.Quote{}, duplicate(err, v.quoteNumber)
	}
	return s.Get(ctx, a, id)
}

// validate checks a create/update payload in two passes (required fields, then values),
// prices the items and checks the client exists.
func (s *Service) validate(ctx context.Context, orgID uuid.UUID, in CreateInput) (validated, error) {
	verr := &domain.ValidationError{}
	if in.ClientID == nil {
		verr.Add("clientId is required")
	}
	if in.ExpiryDate == nil {
		verr.Add("expiryDate is required")
	}
	for i, it := range in.Items {
		if it.ProductID == nil {
			verr.Add(fmt.Sprintf("items[%d].productId is required", i))
		}
		if it.Quantity == nil {
			verr.Add(fmt.Sprintf("items[%d].quantity is required", i))
		}
		if it.DiscountType != nil && !domain.DiscountType(*it.DiscountType).Valid() {
			verr.Add(fmt.Sprintf("items[%d].discountType %q is not a valid DiscountType", i, *it.DiscountType))
		}
	}
	if err := verr.OrNil(); err != nil {
		return validated{}, err
	}

	products, err := s.repo.ActiveProducts(ctx, orgID)
	if err != nil {
		return validated{}, err
	}
	v := validated{clientID: *in.ClientID, dealID: in.DealID, quoteNumber: strings.TrimSpace(in.QuoteNumber), expiryDate: *in.ExpiryDate}
	if v.quoteNumber == "" {
		verr.Add("quoteNumber is required")
	}
	if v.expiryDate.Before(s.today()) {
		verr.Add("expiryDate must not be in the past")
	}
	productsOK := true
	for i, it := range in.Items {
		p, ok := products[*it.ProductID]
		if !ok {
			verr.Add(fmt.Sprintf("items[%d].productId is not an active product", i))
			productsOK = false
			continue
		}
		discountType := domain.DiscountPercent
		if it.DiscountType != nil {
			discountType = domain.DiscountType(*it.DiscountType)
		}
		cost := p.UnitCost
		v.items = append(v.items, domain.QuoteItem{
			ID:            uuid.New(),
			Product:       &domain.Ref{ID: p.ID, Name: p.Name},
			Title:         p.Name,
			Category:      &domain.Ref{ID: p.Category.ID, Name: p.Category.Name},
			Description:   it.Description,
			Quantity:      *it.Quantity,
			UnitPrice:     orDefault(it.UnitPrice, p.UnitPrice),
			DiscountType:  discountType,
			DiscountValue: orDefault(it.DiscountValue, decimal.Zero),
			TaxPercent:    orDefault(it.TaxPercent, defaultTaxPercent),
			UnitCost:      &cost,
		})
	}
	// Pricing messages need every line's price, so they follow only once all products resolved.
	var totals Totals
	if productsOK {
		if totals, err = Calculate(v.items); err != nil {
			verr.Add(err.Error())
		}
	}
	if err := verr.OrNil(); err != nil {
		return validated{}, err
	}
	v.totals = totals
	ok, err := s.repo.ClientExists(ctx, orgID, v.clientID)
	if err != nil {
		return validated{}, err
	}
	if !ok {
		return validated{}, domain.Invalid("clientId does not exist")
	}
	return v, nil
}

func orDefault(d *decimal.Decimal, fallback decimal.Decimal) decimal.Decimal {
	if d == nil {
		return fallback
	}
	return *d
}

func (s *Service) List(ctx context.Context, a domain.Actor, status *domain.QuoteStatus) ([]Summary, error) {
	f := ListFilter{OrgID: a.TenantID, Status: status}
	switch a.Role {
	case domain.RoleRM:
		f.CreatedBy = &a.UserID
	case domain.RoleWO:
		f.TeamWO = &a.UserID
	case domain.RoleWOC:
	case domain.RoleCustomer:
		if a.ClientID == nil {
			return []Summary{}, nil
		}
		f.ClientID = a.ClientID
		f.Statuses = domain.CustomerStatuses
	default:
		return nil, domain.ErrRoleForbidden
	}
	return s.repo.List(ctx, f)
}

// Get returns a visible quote. A customer opening a sent quote marks it viewed.
func (s *Service) Get(ctx context.Context, a domain.Actor, id uuid.UUID) (domain.Quote, error) {
	if a.Role == domain.RoleAdmin {
		return domain.Quote{}, domain.ErrRoleForbidden
	}
	q, err := s.visible(ctx, a, id)
	if err != nil {
		return domain.Quote{}, err
	}
	if a.Role == domain.RoleCustomer && q.Status == domain.StatusSent {
		if err := s.markViewed(ctx, q.ID, &a.UserID); err != nil {
			return domain.Quote{}, err
		}
		if q, err = s.repo.Get(ctx, a.TenantID, id); err != nil {
			return domain.Quote{}, err
		}
	}
	return forActor(a, q), nil
}

func (s *Service) Submit(ctx context.Context, a domain.Actor, id uuid.UUID, comment *string) (domain.Quote, error) {
	if a.Role != domain.RoleRM {
		return domain.Quote{}, domain.ErrRoleForbidden
	}
	q, err := s.visible(ctx, a, id)
	if err != nil {
		return domain.Quote{}, err
	}
	if q.Status != domain.StatusDraft {
		return domain.Quote{}, stateConflict("submit", q.Status)
	}
	if q.CreatorTeamWO == nil {
		return domain.Quote{}, domain.Conflict("you must be in a team led by a WO to submit")
	}
	if err := s.checkStock(ctx, q); err != nil {
		return domain.Quote{}, err
	}
	return s.transition(ctx, a, q, "submit", []domain.QuoteStatus{domain.StatusDraft}, domain.StatusPendingApproval,
		domain.EventSubmitted, comment)
}

func (s *Service) Approve(ctx context.Context, a domain.Actor, id uuid.UUID, comment *string) (domain.Quote, error) {
	if a.Role != domain.RoleWO {
		return domain.Quote{}, domain.ErrRoleForbidden
	}
	q, err := s.visible(ctx, a, id)
	if err != nil {
		return domain.Quote{}, err
	}
	return s.transition(ctx, a, q, "approve", []domain.QuoteStatus{domain.StatusPendingApproval}, domain.StatusApproved,
		domain.EventApproved, comment)
}

func (s *Service) Return(ctx context.Context, a domain.Actor, id uuid.UUID, comment *string) (domain.Quote, error) {
	if a.Role != domain.RoleWO {
		return domain.Quote{}, domain.ErrRoleForbidden
	}
	q, err := s.visible(ctx, a, id)
	if err != nil {
		return domain.Quote{}, err
	}
	if trimmed(comment) == nil {
		return domain.Quote{}, domain.Invalid("comment is required")
	}
	return s.transition(ctx, a, q, "return", []domain.QuoteStatus{domain.StatusPendingApproval}, domain.StatusDraft,
		domain.EventReturned, comment)
}

func (s *Service) Send(ctx context.Context, a domain.Actor, id uuid.UUID) (domain.Quote, error) {
	if a.Role != domain.RoleRM {
		return domain.Quote{}, domain.ErrRoleForbidden
	}
	q, err := s.visible(ctx, a, id)
	if err != nil {
		return domain.Quote{}, err
	}
	if q.Status != domain.StatusApproved {
		return domain.Quote{}, stateConflict("send", q.Status)
	}
	if s.isExpired(q) {
		return domain.Quote{}, domain.Conflict("quote has expired")
	}
	if err := s.checkStock(ctx, q); err != nil {
		return domain.Quote{}, err
	}
	return s.transition(ctx, a, q, "send", []domain.QuoteStatus{domain.StatusApproved}, domain.StatusSent,
		domain.EventSent, nil)
}

func (s *Service) Accept(ctx context.Context, a domain.Actor, id uuid.UUID, signerName, signatureData string) (domain.Quote, error) {
	if a.Role != domain.RoleCustomer {
		return domain.Quote{}, domain.ErrRoleForbidden
	}
	q, err := s.visible(ctx, a, id)
	if err != nil {
		return domain.Quote{}, err
	}
	signer, err := validateSignature(signerName, signatureData)
	if err != nil {
		return domain.Quote{}, err
	}
	if err := s.respondable(q, "accept"); err != nil {
		return domain.Quote{}, err
	}
	err = s.repo.Accept(ctx, q.ID, domain.RespondableStatuses, signer, signatureData, stockUses(q),
		s.event(domain.EventAccepted, &a.UserID, nil))
	if err != nil {
		return domain.Quote{}, s.raced(ctx, a.TenantID, q.ID, "accept", err)
	}
	return s.Get(ctx, a, id)
}

func (s *Service) Reject(ctx context.Context, a domain.Actor, id uuid.UUID, comment *string) (domain.Quote, error) {
	if a.Role != domain.RoleCustomer {
		return domain.Quote{}, domain.ErrRoleForbidden
	}
	q, err := s.visible(ctx, a, id)
	if err != nil {
		return domain.Quote{}, err
	}
	if err := s.respondable(q, "reject"); err != nil {
		return domain.Quote{}, err
	}
	return s.transition(ctx, a, q, "reject", domain.RespondableStatuses, domain.StatusRejected, domain.EventRejected, comment)
}

// GetPublic returns a sent, unexpired quote by share link and marks it viewed on first open.
func (s *Service) GetPublic(ctx context.Context, accessToken uuid.UUID) (PublicView, error) {
	v, err := s.publicQuote(ctx, accessToken)
	if err != nil {
		return PublicView{}, err
	}
	if v.Quote.Status == domain.StatusSent {
		if err := s.markViewed(ctx, v.Quote.ID, nil); err != nil {
			return PublicView{}, err
		}
		return s.publicQuote(ctx, accessToken)
	}
	return v, nil
}

func (s *Service) AcceptPublic(ctx context.Context, accessToken uuid.UUID, signerName, signatureData string) (domain.Quote, error) {
	signer, err := validateSignature(signerName, signatureData)
	if err != nil {
		return domain.Quote{}, err
	}
	v, err := s.publicQuote(ctx, accessToken)
	if err != nil {
		return domain.Quote{}, err
	}
	if !slices.Contains(domain.RespondableStatuses, v.Quote.Status) {
		return domain.Quote{}, stateConflict("accept", v.Quote.Status)
	}
	err = s.repo.Accept(ctx, v.Quote.ID, domain.RespondableStatuses, signer, signatureData, stockUses(v.Quote),
		s.event(domain.EventAccepted, nil, nil))
	if err != nil {
		return domain.Quote{}, s.raced(ctx, v.Quote.OrganizationID, v.Quote.ID, "accept", err)
	}
	return s.customerView(ctx, v.Quote)
}

func (s *Service) RejectPublic(ctx context.Context, accessToken uuid.UUID, comment *string) (domain.Quote, error) {
	v, err := s.publicQuote(ctx, accessToken)
	if err != nil {
		return domain.Quote{}, err
	}
	if !slices.Contains(domain.RespondableStatuses, v.Quote.Status) {
		return domain.Quote{}, stateConflict("reject", v.Quote.Status)
	}
	err = s.repo.Transition(ctx, v.Quote.ID, domain.RespondableStatuses, domain.StatusRejected,
		s.event(domain.EventRejected, nil, comment))
	if err != nil {
		return domain.Quote{}, s.raced(ctx, v.Quote.OrganizationID, v.Quote.ID, "reject", err)
	}
	return s.customerView(ctx, v.Quote)
}

// visible loads a quote and hides it (404) unless the actor's role lets them see it.
func (s *Service) visible(ctx context.Context, a domain.Actor, id uuid.UUID) (domain.Quote, error) {
	q, err := s.repo.Get(ctx, a.TenantID, id)
	if errors.Is(err, domain.ErrNotFound) {
		return domain.Quote{}, notFound
	}
	if err != nil {
		return domain.Quote{}, err
	}
	if !canView(a, q) {
		return domain.Quote{}, notFound
	}
	return q, nil
}

func canView(a domain.Actor, q domain.Quote) bool {
	switch a.Role {
	case domain.RoleRM:
		return q.CreatedBy != nil && q.CreatedBy.ID == a.UserID
	case domain.RoleWO:
		return q.CreatorTeamWO != nil && *q.CreatorTeamWO == a.UserID
	case domain.RoleWOC:
		return true
	case domain.RoleCustomer:
		return a.ClientID != nil && *a.ClientID == q.ClientID && slices.Contains(domain.CustomerStatuses, q.Status)
	}
	return false
}

// forActor hides internal history from customers.
func forActor(a domain.Actor, q domain.Quote) domain.Quote {
	if a.Role == domain.RoleCustomer {
		q.History = customerHistory(q.History)
	}
	return q
}

func customerHistory(events []domain.QuoteEvent) []domain.QuoteEvent {
	out := []domain.QuoteEvent{}
	for _, e := range events {
		if slices.Contains(domain.CustomerEvents, e.Action) {
			out = append(out, e)
		}
	}
	return out
}

func (s *Service) transition(ctx context.Context, a domain.Actor, q domain.Quote, verb string,
	from []domain.QuoteStatus, to domain.QuoteStatus, action domain.EventAction, comment *string) (domain.Quote, error) {
	if !slices.Contains(from, q.Status) {
		return domain.Quote{}, stateConflict(verb, q.Status)
	}
	if err := s.repo.Transition(ctx, q.ID, from, to, s.event(action, &a.UserID, comment)); err != nil {
		return domain.Quote{}, s.raced(ctx, a.TenantID, q.ID, verb, err)
	}
	return s.Get(ctx, a, q.ID)
}

// raced turns a lost conditional update into the same conflict message the pre-check would have given.
func (s *Service) raced(ctx context.Context, orgID, id uuid.UUID, verb string, err error) error {
	var shortage *StockShortage
	if !errors.Is(err, domain.ErrConflict) || errors.As(err, &shortage) {
		return err
	}
	q, getErr := s.repo.Get(ctx, orgID, id)
	if getErr != nil {
		return getErr
	}
	return stateConflict(verb, q.Status)
}

func (s *Service) respondable(q domain.Quote, verb string) error {
	if s.isExpired(q) {
		return domain.Conflict("quote has expired")
	}
	if !slices.Contains(domain.RespondableStatuses, q.Status) {
		return stateConflict(verb, q.Status)
	}
	return nil
}

func (s *Service) markViewed(ctx context.Context, id uuid.UUID, actor *uuid.UUID) error {
	err := s.repo.Transition(ctx, id, []domain.QuoteStatus{domain.StatusSent}, domain.StatusViewed,
		s.event(domain.EventViewed, actor, nil))
	if errors.Is(err, domain.ErrConflict) {
		return nil // someone else already moved it on
	}
	return err
}

// publicQuote resolves a share link; drafts, unsent, expired and unknown quotes are all "not found".
func (s *Service) publicQuote(ctx context.Context, accessToken uuid.UUID) (PublicView, error) {
	v, err := s.repo.GetByAccessToken(ctx, accessToken)
	if errors.Is(err, domain.ErrNotFound) {
		return PublicView{}, publicNotFound
	}
	if err != nil {
		return PublicView{}, err
	}
	if !slices.Contains(domain.CustomerStatuses, v.Quote.Status) || s.isExpired(v.Quote) {
		return PublicView{}, publicNotFound
	}
	return v, nil
}

func (s *Service) customerView(ctx context.Context, q domain.Quote) (domain.Quote, error) {
	fresh, err := s.repo.Get(ctx, q.OrganizationID, q.ID)
	if err != nil {
		return domain.Quote{}, err
	}
	fresh.History = customerHistory(fresh.History)
	return fresh, nil
}

// ExportableStatuses are the states in which a quote can be downloaded as a PDF.
var ExportableStatuses = []domain.QuoteStatus{
	domain.StatusApproved, domain.StatusSent, domain.StatusViewed, domain.StatusAccepted, domain.StatusRejected,
}

// Document is what a quote PDF is rendered from.
type Document struct {
	Quote      domain.Quote
	VendorName string
}

// Export returns a visible quote for its PDF, like Get but without marking it viewed.
func (s *Service) Export(ctx context.Context, a domain.Actor, id uuid.UUID) (Document, error) {
	if a.Role == domain.RoleAdmin {
		return Document{}, domain.ErrRoleForbidden
	}
	q, err := s.visible(ctx, a, id)
	if err != nil {
		return Document{}, err
	}
	if !slices.Contains(ExportableStatuses, q.Status) {
		return Document{}, stateConflict("export", q.Status)
	}
	vendor, err := s.repo.OrganizationName(ctx, q.OrganizationID)
	if err != nil {
		return Document{}, err
	}
	return Document{Quote: q, VendorName: vendor}, nil
}

// ExportPublic returns a quote reachable by share link for its PDF, without marking it viewed.
func (s *Service) ExportPublic(ctx context.Context, accessToken uuid.UUID) (Document, error) {
	v, err := s.publicQuote(ctx, accessToken)
	if err != nil {
		return Document{}, err
	}
	return Document{Quote: v.Quote, VendorName: v.VendorName}, nil
}

// stockUses totals the quote's quantity per product, in order of each product's first line.
// Lines without a product (created before products existed) are ignored.
func stockUses(q domain.Quote) []StockUse {
	var uses []StockUse
	index := map[uuid.UUID]int{}
	for _, it := range q.Items {
		if it.Product == nil {
			continue
		}
		if i, ok := index[it.Product.ID]; ok {
			uses[i].Quantity = uses[i].Quantity.Add(it.Quantity)
			continue
		}
		index[it.Product.ID] = len(uses)
		uses = append(uses, StockUse{ProductID: it.Product.ID, Name: it.Product.Name, Quantity: it.Quantity})
	}
	return uses
}

// checkStock rejects a quote that needs more of a tracked product than is in stock (first product in line order).
func (s *Service) checkStock(ctx context.Context, q domain.Quote) error {
	uses := stockUses(q)
	if len(uses) == 0 {
		return nil
	}
	ids := make([]uuid.UUID, len(uses))
	for i, u := range uses {
		ids[i] = u.ProductID
	}
	stock, err := s.repo.TrackedStock(ctx, q.OrganizationID, ids)
	if err != nil {
		return err
	}
	for _, u := range uses {
		if available, tracked := stock[u.ProductID]; tracked && u.Quantity.GreaterThan(available) {
			return &StockShortage{Name: u.Name, Available: available}
		}
	}
	return nil
}

func (s *Service) event(action domain.EventAction, actor *uuid.UUID, comment *string) NewEvent {
	return NewEvent{Action: action, ActorID: actor, Comment: trimmed(comment), At: s.now().UTC()}
}

func (s *Service) today() time.Time {
	y, m, d := s.now().UTC().Date()
	return time.Date(y, m, d, 0, 0, 0, 0, time.UTC)
}

// isExpired treats expiryDate as the last valid day.
func (s *Service) isExpired(q domain.Quote) bool {
	return q.Status == domain.StatusExpired || q.ExpiryDate.Before(s.today())
}

func validateSignature(signerName, signatureData string) (string, error) {
	verr := &domain.ValidationError{}
	signer := strings.TrimSpace(signerName)
	if signer == "" {
		verr.Add("signerName is required")
	}
	if strings.TrimSpace(signatureData) == "" {
		verr.Add("signatureDataUrl is required")
	}
	return signer, verr.OrNil()
}

func duplicate(err error, number string) error {
	if errors.Is(err, ErrDuplicateNumber) {
		return domain.Conflict(fmt.Sprintf("quoteNumber %q already exists", number))
	}
	return err
}

// trimmed returns nil for a missing or blank comment.
func trimmed(s *string) *string {
	if s == nil {
		return nil
	}
	t := strings.TrimSpace(*s)
	if t == "" {
		return nil
	}
	return &t
}
