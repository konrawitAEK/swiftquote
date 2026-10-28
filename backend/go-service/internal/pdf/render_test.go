package pdf

import (
	"bytes"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/shopspring/decimal"

	"github.com/konrawitAEK/swiftquote/backend/go-service/internal/domain"
)

func TestRenderThaiQuote(t *testing.T) {
	cost := decimal.RequireFromString("26500.00")
	signer := "สมหญิง ใจดี"
	signed := time.Date(2026, 10, 28, 9, 0, 0, 0, time.UTC)
	items := []domain.QuoteItem{
		{Title: "แล็ปท็อป 14 นิ้ว (Laptop 14-inch)", Description: "รับประกันสามปี ส่งฟรีทั่วประเทศ ติดตั้งระบบปฏิบัติการให้พร้อมใช้งาน",
			Quantity: decimal.NewFromInt(2), UnitPrice: decimal.RequireFromString("32900"),
			DiscountType: domain.DiscountPercent, DiscountValue: decimal.NewFromInt(5),
			DiscountAmount: decimal.RequireFromString("3290"), LineTotal: decimal.RequireFromString("62510"), UnitCost: &cost},
		{Title: "Wireless mouse", Quantity: decimal.NewFromInt(10), UnitPrice: decimal.RequireFromString("590"),
			DiscountType: domain.DiscountAmount, DiscountValue: decimal.NewFromInt(400),
			DiscountAmount: decimal.NewFromInt(400), LineTotal: decimal.RequireFromString("5500")},
	}
	q := domain.Quote{
		ID: uuid.New(), QuoteNumber: "QT/2026-001", ClientName: "บริษัท ตัวอย่าง จำกัด", Status: domain.StatusAccepted,
		ExpiryDate: time.Date(2026, 11, 30, 0, 0, 0, 0, time.UTC), CreatedAt: signed,
		Subtotal: decimal.RequireFromString("71700"), DiscountAmount: decimal.RequireFromString("3690"),
		TaxAmount: decimal.RequireFromString("4760.70"), GrandTotal: decimal.RequireFromString("72770.70"),
		SignedBy: &signer, SignedAt: &signed, Items: items,
	}
	for i := 0; i < 30; i++ { // enough lines to need a second page
		q.Items = append(q.Items, items[1])
	}

	out, err := Render(Input{Quote: q, VendorName: "Demo Co., Ltd."})
	if err != nil {
		t.Fatalf("Render: %v", err)
	}
	if !bytes.HasPrefix(out, []byte("%PDF")) {
		t.Fatalf("not a PDF: %q", out[:min(len(out), 16)])
	}
	if strings.Contains(string(out), "26500") {
		t.Error("PDF must not contain the unit cost")
	}
	if path := os.Getenv("PDF_OUT"); path != "" {
		if err := os.WriteFile(path, out, 0o644); err != nil {
			t.Fatal(err)
		}
	}
}

func TestFormatMoney(t *testing.T) {
	for in, want := range map[string]string{"0": "0.00", "999.5": "999.50", "1234.5": "1,234.50", "-1234567.891": "-1,234,567.89"} {
		if got := formatMoney(decimal.RequireFromString(in)); got != want {
			t.Errorf("formatMoney(%s) = %s, want %s", in, got, want)
		}
	}
}
