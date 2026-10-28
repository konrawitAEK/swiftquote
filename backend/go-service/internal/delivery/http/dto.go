package http

import (
	"encoding/json"
	"time"

	"github.com/google/uuid"
	"github.com/shopspring/decimal"

	"github.com/konrawitAEK/swiftquote/backend/go-service/internal/admin"
	"github.com/konrawitAEK/swiftquote/backend/go-service/internal/catalog"
	"github.com/konrawitAEK/swiftquote/backend/go-service/internal/dashboard"
	"github.com/konrawitAEK/swiftquote/backend/go-service/internal/domain"
	"github.com/konrawitAEK/swiftquote/backend/go-service/internal/quote"
)

// Wire types mirror the schemas in contracts/openapi.yaml; keep field names in sync.

const dateLayout = "2006-01-02"

// date is an OpenAPI `format: date` value.
type date time.Time

func (d *date) UnmarshalJSON(b []byte) error {
	var s string
	if err := json.Unmarshal(b, &s); err != nil {
		return err
	}
	t, err := time.Parse(dateLayout, s)
	if err != nil {
		return err
	}
	*d = date(t)
	return nil
}

// money renders a decimal as a JSON number with exactly 2 places, never via float.
func money(d decimal.Decimal) json.Number {
	return json.Number(d.StringFixed(2))
}

// nullableMoney is money or null.
func nullableMoney(d *decimal.Decimal) *json.Number {
	if d == nil {
		return nil
	}
	m := money(*d)
	return &m
}

// costMoney renders a cost field for internal roles (money or null). For customers and the share link
// it returns an empty value, which omitempty drops from the JSON so the field is absent, not null.
func costMoney(d *decimal.Decimal, show bool) json.RawMessage {
	switch {
	case !show:
		return nil
	case d == nil:
		return json.RawMessage("null")
	default:
		return json.RawMessage(d.StringFixed(2))
	}
}

type refView struct {
	ID   uuid.UUID `json:"id"`
	Name string    `json:"name"`
}

func toRef(r *domain.Ref) *refView {
	if r == nil {
		return nil
	}
	return &refView{ID: r.ID, Name: r.Name}
}

type loginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

type authUser struct {
	ID   uuid.UUID   `json:"id"`
	Name string      `json:"name"`
	Role domain.Role `json:"role"`
}

type authResponse struct {
	AccessToken string    `json:"accessToken"`
	TenantID    uuid.UUID `json:"tenantId"`
	User        authUser  `json:"user"`
}

type clientView struct {
	ID    uuid.UUID `json:"id"`
	Name  string    `json:"name"`
	Email *string   `json:"email"`
}

type quoteItemInput struct {
	ProductID     *uuid.UUID       `json:"productId"`
	Description   string           `json:"description"`
	Quantity      *decimal.Decimal `json:"quantity"`
	UnitPrice     *decimal.Decimal `json:"unitPrice"`
	DiscountType  *string          `json:"discountType"`
	DiscountValue *decimal.Decimal `json:"discountValue"`
	TaxPercent    *decimal.Decimal `json:"taxPercent"`
}

type createQuoteRequest struct {
	ClientID    *uuid.UUID       `json:"clientId"`
	DealID      *uuid.UUID       `json:"dealId"`
	QuoteNumber string           `json:"quoteNumber"`
	ExpiryDate  *date            `json:"expiryDate"`
	Items       []quoteItemInput `json:"items"`
}

func (r createQuoteRequest) toInput() quote.CreateInput {
	in := quote.CreateInput{ClientID: r.ClientID, DealID: r.DealID, QuoteNumber: r.QuoteNumber}
	if r.ExpiryDate != nil {
		t := time.Time(*r.ExpiryDate)
		in.ExpiryDate = &t
	}
	for _, it := range r.Items {
		in.Items = append(in.Items, quote.ItemInput{
			ProductID: it.ProductID, Description: it.Description, Quantity: it.Quantity, UnitPrice: it.UnitPrice,
			DiscountType: it.DiscountType, DiscountValue: it.DiscountValue, TaxPercent: it.TaxPercent,
		})
	}
	return in
}

type commentRequest struct {
	Comment *string `json:"comment"`
}

type acceptQuoteRequest struct {
	SignerName       string `json:"signerName"`
	SignatureDataURL string `json:"signatureDataUrl"`
}

type quoteSummary struct {
	ID          uuid.UUID          `json:"id"`
	QuoteNumber string             `json:"quoteNumber"`
	ClientName  string             `json:"clientName"`
	Status      domain.QuoteStatus `json:"status"`
	GrandTotal  json.Number        `json:"grandTotal"`
	ExpiryDate  string             `json:"expiryDate"`
	CreatedBy   *refView           `json:"createdBy"`
}

// The cost fields of quoteItemView and quoteDetail are omitted (not null) for customers and the share link.
type quoteItemView struct {
	Product        *refView            `json:"product"`
	Title          string              `json:"title"`
	Category       *refView            `json:"category"`
	Description    *string             `json:"description"`
	Quantity       json.Number         `json:"quantity"`
	UnitPrice      json.Number         `json:"unitPrice"`
	DiscountType   domain.DiscountType `json:"discountType"`
	DiscountValue  json.Number         `json:"discountValue"`
	DiscountAmount json.Number         `json:"discountAmount"`
	TaxPercent     json.Number         `json:"taxPercent"`
	LineTotal      json.Number         `json:"lineTotal"`
	UnitCost       json.RawMessage     `json:"unitCost,omitempty"`
	CostTotal      json.RawMessage     `json:"costTotal,omitempty"`
	Profit         json.RawMessage     `json:"profit,omitempty"`
}

type eventView struct {
	Action  domain.EventAction `json:"action"`
	Actor   *refView           `json:"actor"`
	Comment *string            `json:"comment"`
	At      time.Time          `json:"at"`
}

type quoteDetail struct {
	ID             uuid.UUID          `json:"id"`
	QuoteNumber    string             `json:"quoteNumber"`
	Status         domain.QuoteStatus `json:"status"`
	ClientID       uuid.UUID          `json:"clientId"`
	ClientName     string             `json:"clientName"`
	CreatedBy      *refView           `json:"createdBy"`
	ExpiryDate     string             `json:"expiryDate"`
	Subtotal       json.Number        `json:"subtotal"`
	DiscountAmount json.Number        `json:"discountAmount"`
	TaxAmount      json.Number        `json:"taxAmount"`
	GrandTotal     json.Number        `json:"grandTotal"`
	CostTotal      json.RawMessage    `json:"costTotal,omitempty"`
	Profit         json.RawMessage    `json:"profit,omitempty"`
	AccessToken    uuid.UUID          `json:"accessToken"`
	SignedBy       *string            `json:"signedBy"`
	SignedAt       *time.Time         `json:"signedAt"`
	Items          []quoteItemView    `json:"items"`
	History        []eventView        `json:"history"`
}

type publicQuoteView struct {
	QuoteNumber string             `json:"quoteNumber"`
	Status      domain.QuoteStatus `json:"status"`
	ExpiryDate  string             `json:"expiryDate"`
	SignedBy    *string            `json:"signedBy"`
	SignedAt    *time.Time         `json:"signedAt"`
	VendorName  string             `json:"vendorName"`
	VendorLogo  *string            `json:"vendorLogo"`
	GrandTotal  json.Number        `json:"grandTotal"`
	Items       []quoteItemView    `json:"items"`
}

type adminUserView struct {
	ID     uuid.UUID   `json:"id"`
	Email  string      `json:"email"`
	Name   string      `json:"name"`
	Role   domain.Role `json:"role"`
	Active bool        `json:"active"`
	Team   *refView    `json:"team"`
	Client *refView    `json:"client"`
}

type createUserRequest struct {
	Email    string      `json:"email"`
	Name     string      `json:"name"`
	Password *string     `json:"password"`
	Role     domain.Role `json:"role"`
	TeamID   *uuid.UUID  `json:"teamId"`
	ClientID *uuid.UUID  `json:"clientId"`
}

type updateUserRequest struct {
	Name     string      `json:"name"`
	Role     domain.Role `json:"role"`
	Active   *bool       `json:"active"`
	TeamID   *uuid.UUID  `json:"teamId"`
	ClientID *uuid.UUID  `json:"clientId"`
	Password *string     `json:"password"`
}

type teamView struct {
	ID      uuid.UUID `json:"id"`
	Name    string    `json:"name"`
	WO      *refView  `json:"wo"`
	Members []refView `json:"members"`
}

type teamRequest struct {
	Name     string     `json:"name"`
	WOUserID *uuid.UUID `json:"woUserId"`
}

type categoryView struct {
	ID     uuid.UUID `json:"id"`
	Name   string    `json:"name"`
	Active bool      `json:"active"`
}

type productView struct {
	ID        uuid.UUID    `json:"id"`
	Name      string       `json:"name"`
	Category  refView      `json:"category"`
	UnitPrice json.Number  `json:"unitPrice"`
	UnitCost  json.Number  `json:"unitCost"`
	Stock     *json.Number `json:"stock"`
	Active    bool         `json:"active"`
}

type productRequest struct {
	Name       string           `json:"name"`
	CategoryID *uuid.UUID       `json:"categoryId"`
	UnitPrice  *decimal.Decimal `json:"unitPrice"`
	UnitCost   *decimal.Decimal `json:"unitCost"`
	Stock      *decimal.Decimal `json:"stock"`
	Active     *bool            `json:"active"` // update only; ignored on create
}

func (r productRequest) toInput(update bool) catalog.ProductInput {
	in := catalog.ProductInput{Name: r.Name, CategoryID: r.CategoryID, UnitPrice: r.UnitPrice, UnitCost: r.UnitCost, Stock: r.Stock}
	if update {
		in.Active = r.Active
	}
	return in
}

func toProductView(p domain.Product) productView {
	return productView{ID: p.ID, Name: p.Name, Category: refView{ID: p.Category.ID, Name: p.Category.Name},
		UnitPrice: money(p.UnitPrice), UnitCost: money(p.UnitCost), Stock: nullableMoney(p.Stock), Active: p.Active}
}

type createCategoryRequest struct {
	Name string `json:"name"`
}

type updateCategoryRequest struct {
	Name   string `json:"name"`
	Active *bool  `json:"active"`
}

type measureView struct {
	Count  int         `json:"count"`
	Amount json.Number `json:"amount"`
}

func toMeasure(m dashboard.Measure) measureView {
	return measureView{Count: m.Count, Amount: money(m.Amount)}
}

type statusRowView struct {
	Status domain.QuoteStatus `json:"status"`
	Count  int                `json:"count"`
	Amount json.Number        `json:"amount"`
}

type monthRowView struct {
	Month   string      `json:"month"`
	Won     measureView `json:"won"`
	Pending measureView `json:"pending"`
}

type rmRowView struct {
	User       refView     `json:"user"`
	Team       *string     `json:"team"`
	QuoteCount int         `json:"quoteCount"`
	SentCount  int         `json:"sentCount"`
	Won        measureView `json:"won"`
	Pending    measureView `json:"pending"`
}

type teamRowView struct {
	ID      uuid.UUID   `json:"id"`
	Name    string      `json:"name"`
	Won     measureView `json:"won"`
	Pending measureView `json:"pending"`
}

type categoryRowView struct {
	Category *refView    `json:"category"`
	Won      measureView `json:"won"`
	Pending  measureView `json:"pending"`
}

type dashboardView struct {
	From           *string           `json:"from"`
	To             *string           `json:"to"`
	Won            measureView       `json:"won"`
	Pending        measureView       `json:"pending"`
	InApproval     measureView       `json:"inApproval"`
	SentCount      int               `json:"sentCount"`
	ConversionRate json.Number       `json:"conversionRate"`
	ByStatus       []statusRowView   `json:"byStatus"`
	ByMonth        []monthRowView    `json:"byMonth"`
	ByRM           []rmRowView       `json:"byRm"`
	ByTeam         []teamRowView     `json:"byTeam"`
	ByCategory     []categoryRowView `json:"byCategory"`
}

type errorResponse struct {
	Code    string   `json:"code"`
	Message string   `json:"message"`
	Details []string `json:"details,omitempty"`
}

func toClientViews(cs []domain.Client) []clientView {
	out := make([]clientView, len(cs))
	for i, c := range cs {
		out[i] = clientView{ID: c.ID, Name: c.Name}
		if c.Email != "" {
			out[i].Email = &c.Email
		}
	}
	return out
}

// toItemViews renders lines; showCost is false for customers and the share link.
func toItemViews(items []domain.QuoteItem, showCost bool) []quoteItemView {
	out := make([]quoteItemView, len(items))
	for i, it := range items {
		out[i] = quoteItemView{
			Product:        toRef(it.Product),
			Title:          it.Title,
			Category:       toRef(it.Category),
			Quantity:       money(it.Quantity),
			UnitPrice:      money(it.UnitPrice),
			DiscountType:   it.DiscountType,
			DiscountValue:  money(it.DiscountValue),
			DiscountAmount: money(it.DiscountAmount),
			TaxPercent:     money(it.TaxPercent),
			LineTotal:      money(it.LineTotal),
			UnitCost:       costMoney(it.UnitCost, showCost),
			CostTotal:      costMoney(it.CostTotal(), showCost),
			Profit:         costMoney(it.Profit(), showCost),
		}
		if it.Description != "" {
			d := it.Description
			out[i].Description = &d
		}
	}
	return out
}

// toQuoteDetail renders a quote; showCost is false for customers and the share link.
func toQuoteDetail(q domain.Quote, showCost bool) quoteDetail {
	history := make([]eventView, len(q.History))
	for i, e := range q.History {
		history[i] = eventView{Action: e.Action, Actor: toRef(e.Actor), Comment: e.Comment, At: e.At}
	}
	return quoteDetail{
		ID:             q.ID,
		QuoteNumber:    q.QuoteNumber,
		Status:         q.Status,
		ClientID:       q.ClientID,
		ClientName:     q.ClientName,
		CreatedBy:      toRef(q.CreatedBy),
		ExpiryDate:     q.ExpiryDate.Format(dateLayout),
		Subtotal:       money(q.Subtotal),
		DiscountAmount: money(q.DiscountAmount),
		TaxAmount:      money(q.TaxAmount),
		GrandTotal:     money(q.GrandTotal),
		CostTotal:      costMoney(q.CostTotal(), showCost),
		Profit:         costMoney(q.Profit(), showCost),
		AccessToken:    q.AccessToken,
		SignedBy:       q.SignedBy,
		SignedAt:       q.SignedAt,
		Items:          toItemViews(q.Items, showCost),
		History:        history,
	}
}

func toQuoteSummaries(rows []quote.Summary) []quoteSummary {
	out := make([]quoteSummary, len(rows))
	for i, r := range rows {
		out[i] = quoteSummary{
			ID:          r.ID,
			QuoteNumber: r.QuoteNumber,
			ClientName:  r.ClientName,
			Status:      r.Status,
			GrandTotal:  money(r.GrandTotal),
			ExpiryDate:  r.ExpiryDate.Format(dateLayout),
			CreatedBy:   toRef(r.CreatedBy),
		}
	}
	return out
}

func toPublicView(v quote.PublicView) publicQuoteView {
	return publicQuoteView{
		QuoteNumber: v.Quote.QuoteNumber,
		Status:      v.Quote.Status,
		ExpiryDate:  v.Quote.ExpiryDate.Format(dateLayout),
		SignedBy:    v.Quote.SignedBy,
		SignedAt:    v.Quote.SignedAt,
		VendorName:  v.VendorName,
		VendorLogo:  v.VendorLogo,
		GrandTotal:  money(v.Quote.GrandTotal),
		Items:       toItemViews(v.Quote.Items, false),
	}
}

func toAdminUser(u admin.User) adminUserView {
	return adminUserView{ID: u.ID, Email: u.Email, Name: u.Name, Role: u.Role, Active: u.Active,
		Team: toRef(u.Team), Client: toRef(u.Client)}
}

func toTeamView(t admin.Team) teamView {
	members := make([]refView, len(t.Members))
	for i, m := range t.Members {
		members[i] = refView{ID: m.ID, Name: m.Name}
	}
	return teamView{ID: t.ID, Name: t.Name, WO: toRef(t.WO), Members: members}
}

func toCategoryView(c domain.Category) categoryView {
	return categoryView{ID: c.ID, Name: c.Name, Active: c.Active}
}

func toDashboardView(s dashboard.Summary) dashboardView {
	formatDate := func(t *time.Time) *string {
		if t == nil {
			return nil
		}
		v := t.Format(dateLayout)
		return &v
	}
	out := dashboardView{
		From:           formatDate(s.Range.From),
		To:             formatDate(s.Range.To),
		Won:            toMeasure(s.Won),
		Pending:        toMeasure(s.Pending),
		InApproval:     toMeasure(s.InApproval),
		SentCount:      s.SentCount,
		ConversionRate: json.Number(s.ConversionRate.StringFixed(4)),
		ByStatus:       []statusRowView{},
		ByMonth:        []monthRowView{},
		ByRM:           []rmRowView{},
		ByTeam:         []teamRowView{},
		ByCategory:     []categoryRowView{},
	}
	for _, r := range s.ByStatus {
		out.ByStatus = append(out.ByStatus, statusRowView{Status: r.Status, Count: r.Count, Amount: money(r.Amount)})
	}
	for _, r := range s.ByMonth {
		out.ByMonth = append(out.ByMonth, monthRowView{Month: r.Month, Won: toMeasure(r.Won), Pending: toMeasure(r.Pending)})
	}
	for _, r := range s.ByRM {
		out.ByRM = append(out.ByRM, rmRowView{User: refView{ID: r.User.ID, Name: r.User.Name}, Team: r.Team,
			QuoteCount: r.QuoteCount, SentCount: r.SentCount, Won: toMeasure(r.Won), Pending: toMeasure(r.Pending)})
	}
	for _, r := range s.ByTeam {
		out.ByTeam = append(out.ByTeam, teamRowView{ID: r.ID, Name: r.Name, Won: toMeasure(r.Won), Pending: toMeasure(r.Pending)})
	}
	for _, r := range s.ByCategory {
		out.ByCategory = append(out.ByCategory, categoryRowView{Category: toRef(r.Category), Won: toMeasure(r.Won), Pending: toMeasure(r.Pending)})
	}
	return out
}
