package http

import (
	"encoding/json"
	"time"

	"github.com/google/uuid"
	"github.com/shopspring/decimal"

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
	Title           string           `json:"title"`
	Description     string           `json:"description"`
	Quantity        *decimal.Decimal `json:"quantity"`
	UnitPrice       *decimal.Decimal `json:"unitPrice"`
	DiscountPercent *decimal.Decimal `json:"discountPercent"`
	TaxPercent      *decimal.Decimal `json:"taxPercent"`
}

type createQuoteRequest struct {
	ClientID    *uuid.UUID       `json:"clientId"`
	DealID      *uuid.UUID       `json:"dealId"`
	QuoteNumber string           `json:"quoteNumber"`
	ExpiryDate  *date            `json:"expiryDate"`
	Items       []quoteItemInput `json:"items"`
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
}

type quoteItemView struct {
	Title     string      `json:"title"`
	Quantity  json.Number `json:"quantity"`
	UnitPrice json.Number `json:"unitPrice"`
	LineTotal json.Number `json:"lineTotal"`
}

type quoteDetail struct {
	ID             uuid.UUID          `json:"id"`
	QuoteNumber    string             `json:"quoteNumber"`
	Status         domain.QuoteStatus `json:"status"`
	Subtotal       json.Number        `json:"subtotal"`
	DiscountAmount json.Number        `json:"discountAmount"`
	TaxAmount      json.Number        `json:"taxAmount"`
	GrandTotal     json.Number        `json:"grandTotal"`
	AccessToken    uuid.UUID          `json:"accessToken"`
	SignedAt       *time.Time         `json:"signedAt"`
	Items          []quoteItemView    `json:"items"`
}

type publicQuoteView struct {
	QuoteNumber string          `json:"quoteNumber"`
	VendorName  string          `json:"vendorName"`
	VendorLogo  *string         `json:"vendorLogo"`
	GrandTotal  json.Number     `json:"grandTotal"`
	Items       []quoteItemView `json:"items"`
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

func toItemViews(items []domain.QuoteItem) []quoteItemView {
	out := make([]quoteItemView, len(items))
	for i, it := range items {
		out[i] = quoteItemView{
			Title:     it.Title,
			Quantity:  money(it.Quantity),
			UnitPrice: money(it.UnitPrice),
			LineTotal: money(it.LineTotal),
		}
	}
	return out
}

func toQuoteDetail(q domain.Quote) quoteDetail {
	return quoteDetail{
		ID:             q.ID,
		QuoteNumber:    q.QuoteNumber,
		Status:         q.Status,
		Subtotal:       money(q.Subtotal),
		DiscountAmount: money(q.DiscountAmount),
		TaxAmount:      money(q.TaxAmount),
		GrandTotal:     money(q.GrandTotal),
		AccessToken:    q.AccessToken,
		SignedAt:       q.SignedAt,
		Items:          toItemViews(q.Items),
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
		}
	}
	return out
}

func toPublicView(v quote.PublicView) publicQuoteView {
	return publicQuoteView{
		QuoteNumber: v.Quote.QuoteNumber,
		VendorName:  v.VendorName,
		VendorLogo:  v.VendorLogo,
		GrandTotal:  money(v.Quote.GrandTotal),
		Items:       toItemViews(v.Quote.Items),
	}
}
