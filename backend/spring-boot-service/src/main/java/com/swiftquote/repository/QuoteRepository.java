package com.swiftquote.repository;

import java.math.BigDecimal;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

import com.swiftquote.domain.ApiException;
import com.swiftquote.domain.Quote;
import com.swiftquote.domain.QuoteItem;
import com.swiftquote.domain.QuoteStatus;

/** Quote persistence on the shared schema in db/migrations. */
@Repository
public class QuoteRepository {

	public record Summary(UUID id, String quoteNumber, String clientName, QuoteStatus status,
			BigDecimal grandTotal, LocalDate expiryDate) {
	}

	public record PublicView(Quote quote, String vendorName) {
	}

	private static final String QUOTE_COLUMNS = """
			q.id, q.organization_id, q.client_id, q.deal_id, q.quote_number, q.status, q.expiry_date,
			q.subtotal, q.discount_amount, q.tax_amount, q.grand_total, q.access_token,
			q.signed_by, q.signature_data, q.signed_at, COALESCE(q.created_at, now()) AS created_at""";

	private final JdbcClient jdbc;

	public QuoteRepository(JdbcClient jdbc) {
		this.jdbc = jdbc;
	}

	/** Inserts the quote and its items atomically; a duplicate quote number in the tenant is a conflict. */
	@Transactional
	public void create(Quote q) {
		try {
			this.jdbc.sql("""
					INSERT INTO quotes (id, organization_id, client_id, deal_id, quote_number, status, expiry_date,
						subtotal, discount_amount, tax_amount, grand_total, access_token, created_at)
					VALUES (:id, :org, :client, :deal, :number, :status, :expiry,
						:subtotal, :discount, :tax, :grand, :token, :created)""")
				.param("id", q.id())
				.param("org", q.organizationId())
				.param("client", q.clientId())
				.param("deal", q.dealId())
				.param("number", q.quoteNumber())
				.param("status", q.status().value())
				.param("expiry", q.expiryDate())
				.param("subtotal", q.subtotal())
				.param("discount", q.discountAmount())
				.param("tax", q.taxAmount())
				.param("grand", q.grandTotal())
				.param("token", q.accessToken())
				.param("created", utc(q.createdAt()))
				.update();
		}
		catch (DuplicateKeyException ex) {
			throw new ApiException.Conflict("conflict: quoteNumber \"%s\" already exists".formatted(q.quoteNumber()));
		}
		List<QuoteItem> items = q.items();
		for (int i = 0; i < items.size(); i++) {
			QuoteItem it = items.get(i);
			this.jdbc.sql("""
					INSERT INTO quote_items (id, quote_id, title, description, quantity, unit_price,
						discount_percent, tax_percent, line_total, position)
					VALUES (:id, :quote, :title, :description, :quantity, :unitPrice,
						:discount, :tax, :lineTotal, :position)""")
				.param("id", it.id())
				.param("quote", q.id())
				.param("title", it.title())
				.param("description", it.description())
				.param("quantity", it.quantity())
				.param("unitPrice", it.unitPrice())
				.param("discount", it.discountPercent())
				.param("tax", it.taxPercent())
				.param("lineTotal", it.lineTotal())
				.param("position", i)
				.update();
		}
	}

	public List<Summary> list(UUID orgId, QuoteStatus status) {
		return this.jdbc.sql("""
				SELECT q.id, q.quote_number, c.name, q.status, q.grand_total, q.expiry_date
				FROM quotes q
				JOIN clients c ON c.id = q.client_id
				WHERE q.organization_id = :org AND (CAST(:status AS text) IS NULL OR q.status = :status)
				ORDER BY q.created_at DESC""")
			.param("org", orgId)
			.param("status", (status != null) ? status.value() : null)
			.query((rs, n) -> new Summary(rs.getObject("id", UUID.class), rs.getString("quote_number"),
					rs.getString("name"), status(rs), rs.getBigDecimal("grand_total"),
					rs.getObject("expiry_date", LocalDate.class)))
			.list();
	}

	public Optional<Quote> get(UUID orgId, UUID id) {
		return this.jdbc.sql("SELECT " + QUOTE_COLUMNS + " FROM quotes q WHERE q.id = :id AND q.organization_id = :org")
			.param("id", id)
			.param("org", orgId)
			.query((rs, n) -> mapQuote(rs))
			.optional()
			.map(this::withItems);
	}

	public Optional<PublicView> getPublic(UUID accessToken) {
		return this.jdbc.sql("SELECT " + QUOTE_COLUMNS + """
				, o.name AS vendor_name
				FROM quotes q
				JOIN organizations o ON o.id = q.organization_id
				WHERE q.access_token = :token""")
			.param("token", accessToken)
			.query((rs, n) -> new PublicView(mapQuote(rs), rs.getString("vendor_name")))
			.optional()
			.map((v) -> new PublicView(withItems(v.quote()), v.vendorName()));
	}

	/** Sets status only if it is currently one of {@code from}; returns whether a row changed. */
	public boolean updateStatus(UUID id, QuoteStatus to, List<QuoteStatus> from) {
		return this.jdbc.sql("UPDATE quotes SET status = :to WHERE id = :id AND status IN (:from)")
			.param("id", id)
			.param("to", to.value())
			.param("from", from.stream().map(QuoteStatus::value).toList())
			.update() > 0;
	}

	/** Records the signature only while the quote is still acceptable; empty if it no longer is. */
	public Optional<Quote> accept(UUID id, String signedBy, String signatureData, Instant at) {
		return this.jdbc.sql("""
				UPDATE quotes q
				SET status = :accepted, signed_by = :signedBy, signature_data = :signature, signed_at = :at
				WHERE q.id = :id AND q.status IN (:acceptable)
				RETURNING
				""" + QUOTE_COLUMNS)
			.param("id", id)
			.param("accepted", QuoteStatus.ACCEPTED.value())
			.param("signedBy", signedBy)
			.param("signature", signatureData)
			.param("at", utc(at))
			.param("acceptable", QuoteStatus.ACCEPTABLE.stream().map(QuoteStatus::value).toList())
			.query((rs, n) -> mapQuote(rs))
			.optional()
			.map(this::withItems);
	}

	private Quote withItems(Quote q) {
		List<QuoteItem> items = this.jdbc.sql("""
				SELECT id, title, description, quantity, unit_price, discount_percent, tax_percent, line_total
				FROM quote_items
				WHERE quote_id = :quote
				ORDER BY position, id""")
			.param("quote", q.id())
			.query((rs, n) -> new QuoteItem(rs.getObject("id", UUID.class), rs.getString("title"),
					rs.getString("description"), rs.getBigDecimal("quantity"), rs.getBigDecimal("unit_price"),
					rs.getBigDecimal("discount_percent"), rs.getBigDecimal("tax_percent"),
					rs.getBigDecimal("line_total")))
			.list();
		return q.withItems(items);
	}

	private static Quote mapQuote(ResultSet rs) throws SQLException {
		return new Quote(rs.getObject("id", UUID.class), rs.getObject("organization_id", UUID.class),
				rs.getObject("client_id", UUID.class), rs.getObject("deal_id", UUID.class),
				rs.getString("quote_number"), status(rs), rs.getObject("expiry_date", LocalDate.class),
				rs.getBigDecimal("subtotal"), rs.getBigDecimal("discount_amount"), rs.getBigDecimal("tax_amount"),
				rs.getBigDecimal("grand_total"), rs.getObject("access_token", UUID.class), rs.getString("signed_by"),
				rs.getString("signature_data"), instant(rs, "signed_at"), instant(rs, "created_at"), List.of());
	}

	private static QuoteStatus status(ResultSet rs) throws SQLException {
		String raw = rs.getString("status");
		return QuoteStatus.parse(raw).orElseThrow(() -> new IllegalStateException("unknown quote status " + raw));
	}

	private static Instant instant(ResultSet rs, String column) throws SQLException {
		OffsetDateTime t = rs.getObject(column, OffsetDateTime.class);
		return (t != null) ? t.toInstant() : null;
	}

	private static OffsetDateTime utc(Instant t) {
		return (t != null) ? t.atOffset(ZoneOffset.UTC) : null;
	}

}
