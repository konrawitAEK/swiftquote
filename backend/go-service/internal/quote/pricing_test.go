package quote

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"testing"

	"github.com/shopspring/decimal"

	"github.com/konrawitAEK/swiftquote/backend/go-service/internal/domain"
)

type fixtureItem struct {
	Quantity        decimal.Decimal `json:"quantity"`
	UnitPrice       decimal.Decimal `json:"unitPrice"`
	DiscountPercent decimal.Decimal `json:"discountPercent"`
	TaxPercent      decimal.Decimal `json:"taxPercent"`
}

type fixtureCase struct {
	Name     string        `json:"name"`
	Items    []fixtureItem `json:"items"`
	Expected struct {
		LineTotals     []decimal.Decimal `json:"lineTotals"`
		Subtotal       decimal.Decimal   `json:"subtotal"`
		DiscountAmount decimal.Decimal   `json:"discountAmount"`
		TaxAmount      decimal.Decimal   `json:"taxAmount"`
		GrandTotal     decimal.Decimal   `json:"grandTotal"`
	} `json:"expected"`
}

// TestCalculateSharedFixtures runs the cross-backend pricing cases that
// spring-boot-service must also pass.
func TestCalculateSharedFixtures(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "..", "contracts", "fixtures", "pricing-cases.json"))
	if err != nil {
		t.Fatalf("read fixtures: %v", err)
	}
	var fx struct {
		Cases []fixtureCase `json:"cases"`
	}
	if err := json.Unmarshal(raw, &fx); err != nil {
		t.Fatalf("parse fixtures: %v", err)
	}
	if len(fx.Cases) == 0 {
		t.Fatal("no fixture cases found")
	}

	for _, tc := range fx.Cases {
		t.Run(tc.Name, func(t *testing.T) {
			items := make([]domain.QuoteItem, len(tc.Items))
			for i, fi := range tc.Items {
				items[i] = domain.QuoteItem{
					Quantity:        fi.Quantity,
					UnitPrice:       fi.UnitPrice,
					DiscountPercent: fi.DiscountPercent,
					TaxPercent:      fi.TaxPercent,
				}
			}

			got, err := Calculate(items)
			if err != nil {
				t.Fatalf("Calculate: %v", err)
			}

			for i, want := range tc.Expected.LineTotals {
				assertMoney(t, fmt.Sprintf("lineTotal[%d]", i), items[i].LineTotal, want)
			}
			assertMoney(t, "subtotal", got.Subtotal, tc.Expected.Subtotal)
			assertMoney(t, "discountAmount", got.DiscountAmount, tc.Expected.DiscountAmount)
			assertMoney(t, "taxAmount", got.TaxAmount, tc.Expected.TaxAmount)
			assertMoney(t, "grandTotal", got.GrandTotal, tc.Expected.GrandTotal)
		})
	}
}

func TestCalculateRejectsInvalidItems(t *testing.T) {
	valid := func() domain.QuoteItem {
		return domain.QuoteItem{
			Quantity:        decimal.NewFromInt(1),
			UnitPrice:       decimal.NewFromInt(10),
			DiscountPercent: decimal.Zero,
			TaxPercent:      decimal.NewFromInt(7),
		}
	}

	tests := []struct {
		name   string
		mutate func(*domain.QuoteItem)
	}{
		{"quantity below 1", func(it *domain.QuoteItem) { it.Quantity = decimal.RequireFromString("0.5") }},
		{"negative unit price", func(it *domain.QuoteItem) { it.UnitPrice = decimal.NewFromInt(-1) }},
		{"discount above 100", func(it *domain.QuoteItem) { it.DiscountPercent = decimal.NewFromInt(101) }},
		{"negative discount", func(it *domain.QuoteItem) { it.DiscountPercent = decimal.NewFromInt(-1) }},
		{"tax above 100", func(it *domain.QuoteItem) { it.TaxPercent = decimal.NewFromInt(101) }},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			it := valid()
			tc.mutate(&it)
			if _, err := Calculate([]domain.QuoteItem{it}); err == nil {
				t.Fatal("expected validation error, got nil")
			}
		})
	}

	t.Run("no items", func(t *testing.T) {
		if _, err := Calculate(nil); !errors.Is(err, ErrNoItems) {
			t.Fatalf("expected ErrNoItems, got %v", err)
		}
	})
}

func assertMoney(t *testing.T, field string, got, want decimal.Decimal) {
	t.Helper()
	if !got.Equal(want) {
		t.Errorf("%s: got %s, want %s", field, got.StringFixed(2), want.StringFixed(2))
	}
}
