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
	Quantity      decimal.Decimal     `json:"quantity"`
	UnitPrice     decimal.Decimal     `json:"unitPrice"`
	UnitCost      *decimal.Decimal    `json:"unitCost"`
	DiscountType  domain.DiscountType `json:"discountType"`
	DiscountValue decimal.Decimal     `json:"discountValue"`
	TaxPercent    decimal.Decimal     `json:"taxPercent"`
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
		CostTotal      *decimal.Decimal  `json:"costTotal"`
		Profit         *decimal.Decimal  `json:"profit"`
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
				discountType := fi.DiscountType
				if discountType == "" {
					discountType = domain.DiscountPercent
				}
				items[i] = domain.QuoteItem{
					Quantity:      fi.Quantity,
					UnitPrice:     fi.UnitPrice,
					UnitCost:      fi.UnitCost,
					DiscountType:  discountType,
					DiscountValue: fi.DiscountValue,
					TaxPercent:    fi.TaxPercent,
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
			for name, pair := range map[string][2]*decimal.Decimal{
				"costTotal": {got.CostTotal, tc.Expected.CostTotal},
				"profit":    {got.Profit, tc.Expected.Profit},
			} {
				if pair[1] == nil {
					continue
				}
				if pair[0] == nil {
					t.Errorf("%s: got null, want %s", name, pair[1].StringFixed(2))
					continue
				}
				assertMoney(t, name, *pair[0], *pair[1])
			}
		})
	}
}

func TestCalculateRejectsInvalidItems(t *testing.T) {
	valid := func() domain.QuoteItem {
		return domain.QuoteItem{
			Quantity:      decimal.NewFromInt(1),
			UnitPrice:     decimal.NewFromInt(10),
			DiscountType:  domain.DiscountPercent,
			DiscountValue: decimal.Zero,
			TaxPercent:    decimal.NewFromInt(7),
		}
	}

	amount := func(v string) func(*domain.QuoteItem) {
		return func(it *domain.QuoteItem) {
			it.DiscountType, it.DiscountValue = domain.DiscountAmount, decimal.RequireFromString(v)
		}
	}
	tests := []struct {
		name   string
		mutate func(*domain.QuoteItem)
		want   string
	}{
		{"quantity below 1", func(it *domain.QuoteItem) { it.Quantity = decimal.RequireFromString("0.5") },
			"quantity must be at least 1"},
		{"negative unit price", func(it *domain.QuoteItem) { it.UnitPrice = decimal.NewFromInt(-1) },
			"unitPrice must not be negative"},
		{"percent above 100", func(it *domain.QuoteItem) { it.DiscountValue = decimal.NewFromInt(101) },
			"discountValue must be between 0 and 100"},
		{"negative percent", func(it *domain.QuoteItem) { it.DiscountValue = decimal.NewFromInt(-1) },
			"discountValue must not be negative"},
		{"negative amount", amount("-1"), "discountValue must not be negative"},
		{"amount above line", amount("10.01"), "discountValue must not exceed the line amount"},
		{"amount above line after rounding", amount("10.005"), "discountValue must not exceed the line amount"},
		{"amount checked before tax", func(it *domain.QuoteItem) { amount("11")(it); it.TaxPercent = decimal.NewFromInt(101) },
			"discountValue must not exceed the line amount"},
		{"tax above 100", func(it *domain.QuoteItem) { it.TaxPercent = decimal.NewFromInt(101) },
			"taxPercent must be between 0 and 100"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			it := valid()
			tc.mutate(&it)
			_, err := Calculate([]domain.QuoteItem{it})
			if err == nil || err.Error() != "items[0]: "+tc.want {
				t.Fatalf("got %v, want items[0]: %s", err, tc.want)
			}
		})
	}

	t.Run("amount equal to the line after rounding", func(t *testing.T) {
		it := valid()
		amount("10.004")(&it)
		if _, err := Calculate([]domain.QuoteItem{it}); err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
	})

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
