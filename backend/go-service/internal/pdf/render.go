// Package pdf renders a quote as an A4 PDF for the customer. It never shows cost or profit.
package pdf

import (
	"bytes"
	_ "embed"
	"fmt"
	"strings"
	"unicode"

	"github.com/shopspring/decimal"
	"github.com/signintech/gopdf"

	"github.com/konrawitAEK/swiftquote/backend/go-service/internal/domain"
)

// Noto Sans Thai has only Thai glyphs, so Latin text, digits and punctuation use Noto Sans (both SIL OFL 1.1,
// see fonts/OFL.txt). Text is split into runs by script and each run is drawn with the matching font.
var (
	//go:embed fonts/NotoSans-Regular.ttf
	latinRegular []byte
	//go:embed fonts/NotoSans-Bold.ttf
	latinBold []byte
	//go:embed fonts/NotoSansThai-Regular.ttf
	thaiRegular []byte
	//go:embed fonts/NotoSansThai-Bold.ttf
	thaiBold []byte
)

const (
	pageW, pageH = 595.28, 841.89 // A4 in points
	margin       = 42.0
	contentW     = pageW - 2*margin
	bottomLimit  = pageH - margin - 24 // leave room for the page footer
)

// Input is what a quote PDF shows.
type Input struct {
	Quote      domain.Quote
	VendorName string
}

type column struct {
	title string
	width float64
	right bool
}

var columns = []column{
	{"#", 22, false},
	{"Item", 209, false},
	{"Qty", 44, true},
	{"Unit price", 78, true},
	{"Discount", 76, true},
	{"Amount", 82, true},
}

type renderer struct {
	pdf  *gopdf.GoPdf
	y    float64
	page int
	in   Input
}

// Render returns the PDF bytes for a quote.
func Render(in Input) ([]byte, error) {
	r := &renderer{pdf: &gopdf.GoPdf{}, in: in}
	r.pdf.Start(gopdf.Config{PageSize: *gopdf.PageSizeA4, Unit: gopdf.UnitPT})
	r.pdf.SetInfo(gopdf.PdfInfo{Title: "Quotation " + in.Quote.QuoteNumber, Author: in.VendorName, Creator: "SwiftQuote"})
	for _, f := range []struct {
		family string
		data   []byte
	}{{"latin", latinRegular}, {"latin-bold", latinBold}, {"thai", thaiRegular}, {"thai-bold", thaiBold}} {
		if err := r.pdf.AddTTFFontData(f.family, f.data); err != nil {
			return nil, fmt.Errorf("load font %s: %w", f.family, err)
		}
	}
	if err := r.document(); err != nil {
		return nil, err
	}
	var buf bytes.Buffer
	if err := r.pdf.Write(&buf); err != nil {
		return nil, fmt.Errorf("write pdf: %w", err)
	}
	return buf.Bytes(), nil
}

func (r *renderer) document() (err error) {
	// Drawing errors only come from font handling; collect the first one instead of checking every call.
	defer func() {
		if p := recover(); p != nil {
			if e, ok := p.(drawError); ok {
				err = e.err
				return
			}
			panic(p)
		}
	}()
	q := r.in.Quote
	r.newPage()

	// Header: vendor on the left, document title and number on the right.
	r.text(margin, r.y, r.in.VendorName, true, 18, gray(20))
	r.textRight(pageW-margin, r.y, "QUOTATION", true, 18, accent)
	r.y += 26
	r.textRight(pageW-margin, r.y, q.QuoteNumber, false, 11, gray(80))
	r.y += 24
	r.rule(margin, pageW-margin, 0.8, gray(200))
	r.y += 14

	// Client and dates.
	top := r.y
	r.text(margin, r.y, "BILL TO", true, 8, gray(120))
	r.y += 13
	for _, line := range r.wrap(q.ClientName, contentW/2, true, 11) {
		r.text(margin, r.y, line, true, 11, gray(20))
		r.y += 15
	}
	left := r.y
	r.y = top
	for _, row := range [][2]string{
		{"Quote number", q.QuoteNumber},
		{"Issue date", q.CreatedAt.UTC().Format("2006-01-02")},
		{"Valid until", q.ExpiryDate.Format("2006-01-02")},
	} {
		r.text(pageW-margin-200, r.y, row[0], false, 9, gray(120))
		r.textRight(pageW-margin, r.y, row[1], false, 9, gray(20))
		r.y += 14
	}
	r.y = max(r.y, left) + 16

	r.tableHeader()
	for i, it := range q.Items {
		r.item(i+1, it)
	}
	r.y += 6
	r.totals(q)

	if q.Status == domain.StatusAccepted && q.SignedBy != nil {
		r.ensure(60)
		r.y += 18
		r.text(margin, r.y, "ACCEPTED BY", true, 8, gray(120))
		r.y += 13
		r.text(margin, r.y, *q.SignedBy, true, 11, gray(20))
		r.y += 15
		if q.SignedAt != nil {
			r.text(margin, r.y, "Signed on "+q.SignedAt.UTC().Format("2006-01-02"), false, 9, gray(80))
			r.y += 14
		}
	}
	return nil
}

func (r *renderer) newPage() {
	r.pdf.AddPage()
	r.page++
	r.y = margin
	footer := fmt.Sprintf("%s  ·  Page %d", r.in.Quote.QuoteNumber, r.page)
	r.textRight(pageW-margin, pageH-margin+4, footer, false, 8, gray(140))
}

// ensure starts a new page when h more points do not fit.
func (r *renderer) ensure(h float64) bool {
	if r.y+h <= bottomLimit {
		return false
	}
	r.newPage()
	return true
}

func (r *renderer) tableHeader() {
	r.pdf.SetFillColor(240, 242, 246)
	r.pdf.RectFromUpperLeftWithStyle(margin, r.y, contentW, 20, "F")
	x := margin
	for _, c := range columns {
		r.cellText(x, r.y+5, c, c.title, true, 8.5, gray(70))
		x += c.width
	}
	r.y += 24
}

func (r *renderer) item(n int, it domain.QuoteItem) {
	titleLines := r.wrap(it.Title, columns[1].width-8, true, 9.5)
	descLines := r.wrap(it.Description, columns[1].width-8, false, 8.5)
	discount := []string{"-"}
	if it.DiscountAmount.IsPositive() {
		discount = []string{formatMoney(it.DiscountAmount)}
		if it.DiscountType != domain.DiscountAmount {
			discount = append(discount, "("+it.DiscountValue.String()+"%)")
		}
	}
	h := float64(len(titleLines))*13 + float64(len(descLines))*11.5
	h = max(h, float64(len(discount))*12) + 8
	if r.ensure(h) {
		r.tableHeader()
	}

	x := margin
	r.cellText(x, r.y, columns[0], fmt.Sprint(n), false, 9, gray(100))
	x += columns[0].width
	y := r.y
	for _, line := range titleLines {
		r.text(x+4, y, line, true, 9.5, gray(20))
		y += 13
	}
	for _, line := range descLines {
		r.text(x+4, y, line, false, 8.5, gray(110))
		y += 11.5
	}
	x += columns[1].width
	r.cellText(x, r.y, columns[2], it.Quantity.String(), false, 9, gray(20))
	x += columns[2].width
	r.cellText(x, r.y, columns[3], formatMoney(it.UnitPrice), false, 9, gray(20))
	x += columns[3].width
	for i, line := range discount {
		size := 9.0
		if i > 0 {
			size = 8
		}
		r.cellText(x, r.y+float64(i)*12, columns[4], line, false, size, gray(60))
	}
	x += columns[4].width
	r.cellText(x, r.y, columns[5], formatMoney(it.LineTotal), true, 9, gray(20))
	r.y += h
	r.rule(margin, pageW-margin, 0.4, gray(225))
	r.y += 6
}

func (r *renderer) totals(q domain.Quote) {
	r.ensure(90)
	labelX, valueX := pageW-margin-220, pageW-margin
	for _, row := range []struct {
		label string
		value decimal.Decimal
	}{
		{"Subtotal", q.Subtotal},
		{"Discount", q.DiscountAmount.Neg()},
		{"VAT", q.TaxAmount},
	} {
		r.text(labelX, r.y, row.label, false, 9.5, gray(80))
		r.textRight(valueX, r.y, formatMoney(row.value), false, 9.5, gray(20))
		r.y += 16
	}
	r.y += 2
	r.rule(labelX, valueX, 0.8, gray(180))
	r.y += 8
	r.text(labelX, r.y, "Grand total", true, 12, gray(20))
	r.textRight(valueX, r.y, formatMoney(q.GrandTotal), true, 12, accent)
	r.y += 22
}

// cellText draws s inside a table column, aligned per the column.
func (r *renderer) cellText(x, y float64, c column, s string, bold bool, size float64, col rgb) {
	if c.right {
		r.textRight(x+c.width-4, y, s, bold, size, col)
		return
	}
	r.text(x+4, y, s, bold, size, col)
}

func (r *renderer) rule(x1, x2, width float64, col rgb) {
	r.pdf.SetLineWidth(width)
	r.pdf.SetStrokeColor(col.r, col.g, col.b)
	r.pdf.Line(x1, r.y, x2, r.y)
}

// text draws s with its top-left corner at (x, y), switching font per script run.
func (r *renderer) text(x, y float64, s string, bold bool, size float64, col rgb) {
	r.pdf.SetTextColor(col.r, col.g, col.b)
	for _, run := range runs(s) {
		r.setFont(run.thai, bold, size)
		w := r.measureRun(run.text)
		r.pdf.SetXY(x, y)
		must(r.pdf.Cell(&gopdf.Rect{W: w, H: size}, run.text))
		x += w
	}
}

func (r *renderer) textRight(right, y float64, s string, bold bool, size float64, col rgb) {
	r.text(right-r.measure(s, bold, size), y, s, bold, size, col)
}

func (r *renderer) measure(s string, bold bool, size float64) float64 {
	w := 0.0
	for _, run := range runs(s) {
		r.setFont(run.thai, bold, size)
		w += r.measureRun(run.text)
	}
	return w
}

func (r *renderer) measureRun(s string) float64 {
	w, err := r.pdf.MeasureTextWidth(s)
	must(err)
	return w
}

func (r *renderer) setFont(thai, bold bool, size float64) {
	family := "latin"
	if thai {
		family = "thai"
	}
	if bold {
		family += "-bold"
	}
	must(r.pdf.SetFont(family, "", size))
}

// wrap breaks s into lines no wider than width: at spaces, or between characters for long words
// (Thai has no spaces between words), never before a combining mark.
func (r *renderer) wrap(s string, width float64, bold bool, size float64) []string {
	var lines []string
	for _, para := range strings.Split(strings.TrimSpace(s), "\n") {
		para = strings.TrimSpace(para)
		if para == "" {
			continue
		}
		line := ""
		for _, word := range strings.Fields(para) {
			candidate := word
			if line != "" {
				candidate = line + " " + word
			}
			if r.measure(candidate, bold, size) <= width {
				line = candidate
				continue
			}
			if line != "" {
				lines = append(lines, line)
				line = ""
			}
			for _, cluster := range clusters(word) {
				if line != "" && r.measure(line+cluster, bold, size) > width {
					lines = append(lines, line)
					line = ""
				}
				line += cluster
			}
		}
		if line != "" {
			lines = append(lines, line)
		}
	}
	return lines
}

// clusters splits a word into base characters with their following combining marks.
func clusters(word string) []string {
	var out []string
	for _, c := range word {
		if len(out) > 0 && isMark(c) {
			out[len(out)-1] += string(c)
			continue
		}
		out = append(out, string(c))
	}
	return out
}

func isMark(c rune) bool {
	return unicode.Is(unicode.Mn, c) || c == 'ำ' // sara am follows its base too
}

type run struct {
	text string
	thai bool
}

// runs splits s into maximal runs of Thai and non-Thai characters.
func runs(s string) []run {
	var out []run
	for _, c := range s {
		thai := c >= 0x0E00 && c <= 0x0E7F
		if len(out) > 0 && out[len(out)-1].thai == thai {
			out[len(out)-1].text += string(c)
			continue
		}
		out = append(out, run{text: string(c), thai: thai})
	}
	return out
}

// formatMoney renders 2 decimals with thousands separators: 1,234.50.
func formatMoney(d decimal.Decimal) string {
	s := d.StringFixed(2)
	sign := ""
	if strings.HasPrefix(s, "-") {
		sign, s = "-", s[1:]
	}
	intPart, frac, _ := strings.Cut(s, ".")
	var b strings.Builder
	for i, c := range intPart {
		if i > 0 && (len(intPart)-i)%3 == 0 {
			b.WriteByte(',')
		}
		b.WriteRune(c)
	}
	return sign + b.String() + "." + frac
}

type rgb struct{ r, g, b uint8 }

func gray(v uint8) rgb { return rgb{v, v, v} }

var accent = rgb{29, 78, 216}

type drawError struct{ err error }

func must(err error) {
	if err != nil {
		panic(drawError{err})
	}
}
