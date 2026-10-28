package com.swiftquote.web.rest;

import java.awt.Color;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.text.DecimalFormat;
import java.text.DecimalFormatSymbols;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.Base64;
import java.util.Locale;

import org.openpdf.text.Chunk;
import org.openpdf.text.Document;
import org.openpdf.text.Element;
import org.openpdf.text.Font;
import org.openpdf.text.Image;
import org.openpdf.text.PageSize;
import org.openpdf.text.Paragraph;
import org.openpdf.text.Phrase;
import org.openpdf.text.Rectangle;
import org.openpdf.text.pdf.BaseFont;
import org.openpdf.text.pdf.FontSelector;
import org.openpdf.text.pdf.GlyphLayoutFontManager.FontLoadException;
import org.openpdf.text.pdf.GlyphLayoutManager;
import org.openpdf.text.pdf.PdfPCell;
import org.openpdf.text.pdf.PdfPTable;
import org.openpdf.text.pdf.PdfWriter;
import org.springframework.stereotype.Component;

import com.swiftquote.domain.DiscountTypes;
import com.swiftquote.domain.Quote;
import com.swiftquote.domain.QuoteItem;
import com.swiftquote.domain.Statuses;

/**
 * Renders a quote as an A4 PDF for the customer: vendor, client, number, dates, lines, totals and, once accepted, the
 * signer. Never shows cost or profit. Text uses embedded Noto Sans Thai (Thai) with Noto Sans (Latin, digits) as
 * fallback; Thai vowels and tone marks are positioned by the JDK's OpenType layout (OpenPDF's GlyphLayoutManager).
 */
@Component
class QuotePdf {

	private static final Color INK = new Color(0x1F, 0x29, 0x37);

	private static final Color MUTED = new Color(0x6B, 0x72, 0x80);

	private static final Color RULE = new Color(0xE5, 0xE7, 0xEB);

	private static final Color HEAD = new Color(0xF3, 0xF4, 0xF6);

	private static final DateTimeFormatter DATE = DateTimeFormatter.ofPattern("d MMM yyyy", Locale.ENGLISH);

	private final BaseFont thai;

	private final BaseFont thaiBold;

	private final BaseFont latin;

	private final BaseFont latinBold;

	/** Shapes text with the fonts' OpenType tables; every font a document uses must be loaded through it. */
	private final GlyphLayoutManager layout = new GlyphLayoutManager();

	QuotePdf() {
		this.thai = font("NotoSansThai-Regular.ttf");
		this.thaiBold = font("NotoSansThai-Bold.ttf");
		this.latin = font("NotoSans-Regular.ttf");
		this.latinBold = font("NotoSans-Bold.ttf");
	}

	private BaseFont font(String file) {
		try (InputStream in = QuotePdf.class.getResourceAsStream("/fonts/" + file)) {
			return this.layout.loadFont(file, in, 10).getBaseFont();
		}
		catch (IOException | FontLoadException ex) {
			throw new IllegalStateException("cannot load font " + file, ex);
		}
	}

	/** Characters outside [A-Za-z0-9._-] become "_" so the name is safe in Content-Disposition. */
	static String fileName(String quoteNumber) {
		return quoteNumber.replaceAll("[^A-Za-z0-9._-]", "_");
	}

	byte[] render(Quote q, String vendorName) {
		ByteArrayOutputStream out = new ByteArrayOutputStream();
		Document doc = new Document(PageSize.A4, 48, 48, 48, 48).setGlyphLayoutManager(this.layout);
		PdfWriter.getInstance(doc, out);
		doc.addTitle("Quotation " + q.quoteNumber());
		doc.addAuthor(vendorName);
		doc.addCreator("SwiftQuote");
		doc.open();

		doc.add(header(q, vendorName));
		doc.add(spacer(18));
		doc.add(parties(q));
		doc.add(spacer(18));
		doc.add(lines(q));
		doc.add(totals(q));
		if (Statuses.ACCEPTED.equals(q.status()) && q.signedBy() != null) {
			doc.add(spacer(24));
			doc.add(acceptance(q));
		}
		doc.close();
		return out.toByteArray();
	}

	private PdfPTable header(Quote q, String vendorName) {
		PdfPTable t = table(new float[] { 3, 2 });
		PdfPCell vendor = cell(text(vendorName, 18, true, INK), Element.ALIGN_LEFT);
		vendor.setVerticalAlignment(Element.ALIGN_BOTTOM);
		t.addCell(vendor);
		Phrase title = text("QUOTATION", 20, true, INK);
		title.add(Chunk.NEWLINE);
		title.addAll(text("ใบเสนอราคา", 11, false, MUTED));
		PdfPCell right = cell(title, Element.ALIGN_RIGHT);
		t.addCell(right);
		PdfPCell rule = new PdfPCell();
		rule.setColspan(2);
		rule.setBorder(Rectangle.BOTTOM);
		rule.setBorderColor(INK);
		rule.setBorderWidth(1.2f);
		rule.setFixedHeight(8);
		t.addCell(rule);
		return t;
	}

	private PdfPTable parties(Quote q) {
		PdfPTable t = table(new float[] { 3, 2 });
		Phrase client = text("BILL TO", 8, true, MUTED);
		client.add(Chunk.NEWLINE);
		client.addAll(text(q.clientName(), 12, true, INK));
		t.addCell(cell(client, Element.ALIGN_LEFT));

		PdfPTable meta = table(new float[] { 1, 1 });
		metaRow(meta, "Quote number", q.quoteNumber());
		metaRow(meta, "Issue date", formatDate(LocalDate.ofInstant(q.createdAt(), ZoneOffset.UTC)));
		metaRow(meta, "Valid until", formatDate(q.expiryDate()));
		PdfPCell holder = new PdfPCell(meta);
		holder.setBorder(Rectangle.NO_BORDER);
		holder.setPadding(0);
		t.addCell(holder);
		return t;
	}

	private void metaRow(PdfPTable t, String label, String value) {
		PdfPCell l = cell(text(label, 9, false, MUTED), Element.ALIGN_LEFT);
		l.setPaddingBottom(4);
		t.addCell(l);
		PdfPCell v = cell(text(value, 9, true, INK), Element.ALIGN_RIGHT);
		v.setPaddingBottom(4);
		t.addCell(v);
	}

	private PdfPTable lines(Quote q) {
		PdfPTable t = table(new float[] { 0.5f, 5, 1.1f, 1.7f, 1.4f, 1.8f });
		t.setHeaderRows(1);
		String[] heads = { "#", "Description", "Qty", "Unit price", "Discount", "Amount" };
		for (int i = 0; i < heads.length; i++) {
			PdfPCell h = cell(text(heads[i], 8.5f, true, MUTED), (i < 2) ? Element.ALIGN_LEFT : Element.ALIGN_RIGHT);
			h.setBackgroundColor(HEAD);
			h.setPadding(6);
			t.addCell(h);
		}
		int n = 1;
		for (QuoteItem it : q.items()) {
			t.addCell(lineCell(text(Integer.toString(n++), 9, false, MUTED), Element.ALIGN_LEFT));
			Phrase item = text(it.title(), 9.5f, true, INK);
			if (!it.description().isEmpty()) {
				item.add(Chunk.NEWLINE);
				item.addAll(text(it.description(), 8.5f, false, MUTED));
			}
			t.addCell(lineCell(item, Element.ALIGN_LEFT));
			t.addCell(lineCell(text(quantity(it.quantity()), 9, false, INK), Element.ALIGN_RIGHT));
			t.addCell(lineCell(text(money(it.unitPrice()), 9, false, INK), Element.ALIGN_RIGHT));
			t.addCell(lineCell(text(discount(it), 9, false, INK), Element.ALIGN_RIGHT));
			t.addCell(lineCell(text(money(it.lineTotal()), 9, false, INK), Element.ALIGN_RIGHT));
		}
		return t;
	}

	private PdfPCell lineCell(Phrase p, int align) {
		PdfPCell c = cell(p, align);
		c.setBorder(Rectangle.BOTTOM);
		c.setBorderColor(RULE);
		c.setPaddingTop(6);
		c.setPaddingBottom(7);
		c.setPaddingLeft(6);
		c.setPaddingRight(6);
		return c;
	}

	private PdfPTable totals(Quote q) {
		PdfPTable outer = table(new float[] { 3, 2 });
		outer.addCell(cell(text("", 9, false, INK), Element.ALIGN_LEFT));
		PdfPTable t = table(new float[] { 1, 1 });
		totalRow(t, "Subtotal", money(q.subtotal()), false);
		totalRow(t, "Discount", (q.discountAmount().signum() == 0) ? money(q.discountAmount())
				: "-" + money(q.discountAmount()), false);
		totalRow(t, "VAT", money(q.taxAmount()), false);
		totalRow(t, "Grand total", money(q.grandTotal()), true);
		PdfPCell holder = new PdfPCell(t);
		holder.setBorder(Rectangle.NO_BORDER);
		holder.setPadding(0);
		holder.setPaddingTop(10);
		outer.addCell(holder);
		return outer;
	}

	private void totalRow(PdfPTable t, String label, String value, boolean grand) {
		float size = grand ? 11 : 9.5f;
		PdfPCell l = cell(text(label, size, grand, grand ? INK : MUTED), Element.ALIGN_LEFT);
		PdfPCell v = cell(text(value, size, true, INK), Element.ALIGN_RIGHT);
		for (PdfPCell c : new PdfPCell[] { l, v }) {
			c.setPaddingTop(grand ? 8 : 3);
			c.setPaddingBottom(grand ? 8 : 3);
			c.setPaddingLeft(6);
			c.setPaddingRight(6);
			if (grand) {
				c.setBorder(Rectangle.TOP);
				c.setBorderColor(INK);
				c.setBorderWidth(1);
			}
			t.addCell(c);
		}
	}

	private PdfPTable acceptance(Quote q) {
		PdfPTable t = table(new float[] { 1 });
		Phrase p = text("ACCEPTED", 8, true, MUTED);
		p.add(Chunk.NEWLINE);
		p.addAll(text("Signed by " + q.signedBy(), 10, true, INK));
		if (q.signedAt() != null) {
			p.add(Chunk.NEWLINE);
			p.addAll(text("on " + formatDate(LocalDate.ofInstant(q.signedAt(), ZoneOffset.UTC)), 9, false, MUTED));
		}
		t.addCell(cell(p, Element.ALIGN_LEFT));
		Image signature = signature(q.signatureData());
		if (signature != null) {
			signature.scaleToFit(180, 60);
			PdfPCell c = new PdfPCell(signature, false);
			c.setBorder(Rectangle.NO_BORDER);
			c.setPaddingTop(6);
			t.addCell(c);
		}
		return t;
	}

	/** The drawn signature when it is a PNG or JPEG data URL; anything else is left out. */
	private static Image signature(String dataUrl) {
		if (dataUrl == null) {
			return null;
		}
		int comma = dataUrl.indexOf(',');
		if (!dataUrl.startsWith("data:image/") || comma < 0 || !dataUrl.substring(0, comma).endsWith(";base64")) {
			return null;
		}
		try {
			return Image.getInstance(Base64.getDecoder().decode(dataUrl.substring(comma + 1).trim()));
		}
		catch (Exception ex) {
			return null;
		}
	}

	private Phrase text(String s, float size, boolean bold, Color color) {
		FontSelector fs = new FontSelector();
		fs.addFont(new Font(bold ? this.thaiBold : this.thai, size, Font.NORMAL, color));
		fs.addFont(new Font(bold ? this.latinBold : this.latin, size, Font.NORMAL, color));
		return fs.process((s != null) ? s : "");
	}

	private static PdfPTable table(float[] widths) {
		PdfPTable t = new PdfPTable(widths);
		t.setWidthPercentage(100);
		return t;
	}

	private static PdfPCell cell(Phrase p, int align) {
		PdfPCell c = new PdfPCell(p);
		c.setBorder(Rectangle.NO_BORDER);
		c.setHorizontalAlignment(align);
		c.setPadding(0);
		// Line height from the largest font on each line, with room for Thai marks above and below.
		c.setLeading(0, 1.4f);
		c.setUseAscender(true);
		c.setUseDescender(true);
		return c;
	}

	/** Vertical space, set in an embedded font (every font must go through the glyph layout). */
	private Paragraph spacer(float height) {
		Paragraph p = new Paragraph(height, " ", new Font(this.latin, 1));
		return p;
	}

	private static String formatDate(LocalDate d) {
		return (d != null) ? DATE.format(d) : "";
	}

	private static String money(BigDecimal d) {
		DecimalFormat f = new DecimalFormat("#,##0.00", DecimalFormatSymbols.getInstance(Locale.ENGLISH));
		return f.format(d.setScale(2, RoundingMode.HALF_UP));
	}

	/** Whole quantities without decimals, others with up to 2. */
	private static String quantity(BigDecimal d) {
		DecimalFormat f = new DecimalFormat("#,##0.##", DecimalFormatSymbols.getInstance(Locale.ENGLISH));
		return f.format(d.setScale(2, RoundingMode.HALF_UP));
	}

	private static String discount(QuoteItem it) {
		if (it.discountValue().signum() == 0) {
			return "-";
		}
		if (DiscountTypes.AMOUNT.equals(it.discountType())) {
			return money(it.discountAmount());
		}
		return quantity(it.discountValue()) + "%";
	}

}
