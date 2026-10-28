// Package quote contains quotation use cases, starting with pricing.
package quote

import (
	"errors"
	"fmt"

	"github.com/shopspring/decimal"

	"github.com/konrawitAEK/swiftquote/backend/go-service/internal/domain"
)

// The pricing rules are shared with spring-boot-service and pinned by
// contracts/fixtures/pricing-cases.json. Change both backends together.

var (
	hundred = decimal.NewFromInt(100)
	one     = decimal.NewFromInt(1)
)

const moneyPlaces = 2

var ErrNoItems = errors.New("quote must have at least one item")

// Totals is the quote-level result of pricing.
type Totals struct {
	Subtotal       decimal.Decimal
	DiscountAmount decimal.Decimal
	TaxAmount      decimal.Decimal
	GrandTotal     decimal.Decimal
	// CostTotal and Profit are nil unless every line has a unit cost.
	CostTotal *decimal.Decimal
	Profit    *decimal.Decimal
}

// Calculate validates items, sets each item's DiscountAmount and LineTotal and returns the quote totals.
// Rounding is half away from zero to 2 places, applied per line.
func Calculate(items []domain.QuoteItem) (Totals, error) {
	if len(items) == 0 {
		return Totals{}, ErrNoItems
	}

	t := Totals{
		Subtotal:       decimal.Zero,
		DiscountAmount: decimal.Zero,
		TaxAmount:      decimal.Zero,
	}
	for i := range items {
		it := &items[i]
		if err := validate(it); err != nil {
			return Totals{}, fmt.Errorf("items[%d]: %w", i, err)
		}

		gross := it.Quantity.Mul(it.UnitPrice).Round(moneyPlaces)
		discount := lineDiscount(it, gross)
		lineTotal := gross.Sub(discount)
		tax := lineTotal.Mul(it.TaxPercent).Div(hundred).Round(moneyPlaces)

		it.DiscountAmount = discount
		it.LineTotal = lineTotal
		t.Subtotal = t.Subtotal.Add(gross)
		t.DiscountAmount = t.DiscountAmount.Add(discount)
		t.TaxAmount = t.TaxAmount.Add(tax)
	}
	t.GrandTotal = t.Subtotal.Sub(t.DiscountAmount).Add(t.TaxAmount)
	q := domain.Quote{Items: items, Subtotal: t.Subtotal, DiscountAmount: t.DiscountAmount}
	t.CostTotal, t.Profit = q.CostTotal(), q.Profit()
	return t, nil
}

// lineDiscount is a percent of gross (the default) or the amount itself, rounded to 2 places.
func lineDiscount(it *domain.QuoteItem, gross decimal.Decimal) decimal.Decimal {
	if it.DiscountType == domain.DiscountAmount {
		return it.DiscountValue.Round(moneyPlaces)
	}
	return gross.Mul(it.DiscountValue).Div(hundred).Round(moneyPlaces)
}

// validate enforces the QuoteItemInput constraints from contracts/openapi.yaml, in the contract's order.
// An amount discount is compared with the line amount after both are rounded to 2 places.
func validate(it *domain.QuoteItem) error {
	switch {
	case it.Quantity.LessThan(one):
		return errors.New("quantity must be at least 1")
	case it.UnitPrice.IsNegative():
		return errors.New("unitPrice must not be negative")
	case it.DiscountValue.IsNegative():
		return errors.New("discountValue must not be negative")
	case it.DiscountType != domain.DiscountAmount && it.DiscountValue.GreaterThan(hundred):
		return errors.New("discountValue must be between 0 and 100")
	case it.DiscountType == domain.DiscountAmount &&
		it.DiscountValue.Round(moneyPlaces).GreaterThan(it.Quantity.Mul(it.UnitPrice).Round(moneyPlaces)):
		return errors.New("discountValue must not exceed the line amount")
	case !inPercentRange(it.TaxPercent):
		return errors.New("taxPercent must be between 0 and 100")
	}
	return nil
}

func inPercentRange(d decimal.Decimal) bool {
	return !d.IsNegative() && d.LessThanOrEqual(hundred)
}
