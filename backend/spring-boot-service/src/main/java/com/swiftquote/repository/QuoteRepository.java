package com.swiftquote.repository;

import java.math.BigDecimal;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.support.TransactionTemplate;

import com.swiftquote.domain.Quote;
import com.swiftquote.domain.QuoteEvent;
import com.swiftquote.domain.QuoteItem;
import com.swiftquote.domain.Ref;

/** Quote persistence on the shared schema (backend/go-service/internal/storage/postgres/quotes.go). */
@Repository
public class QuoteRepository {

	/** (organization, quoteNumber) already exists. */
	public static final class DuplicateNumberException extends RuntimeException {

		DuplicateNumberException(Throwable cause) {
			super(cause);
		}

	}

	/** A conditional update found the quote no longer in an allowed state. */
	public static final class StateConflictException extends RuntimeException {

		StateConflictException() {
			super("conflict");
		}

	}

	public record Summary(UUID id, String quoteNumber, String clientName, String status, BigDecimal grandTotal,
			LocalDate expiryDate, Ref createdBy) {
	}

	public record PublicView(Quote quote, String vendorName, String vendorLogo) {
	}

	/** Narrows a tenant's quotes; null fields do not filter. */
	public record ListFilter(UUID orgId, String status, UUID createdBy, UUID teamWo, UUID clientId,
			List<String> statuses) {
	}

	/** An audit entry written together with a state change. */
	public record NewEvent(String action, UUID actorId, String comment, Instant at) {
	}

	// Joins the client, the creator and the creator's current team so visibility can be decided.
	private static final String QUOTE_COLUMNS = """
			SELECT q.id, q.organization_id, q.client_id, c.name, q.deal_id, q.quote_number, q.status, q.expiry_date,
				q.subtotal, q.discount_amount, q.tax_amount, q.grand_total, q.access_token,
				q.signed_by, q.signature_data, q.signed_at, COALESCE(q.created_at, now()),
				cb.id, cb.full_name, t.wo_user_id""";

	private static final String QUOTE_FROM = """

			FROM quotes q
			JOIN clients c ON c.id = q.client_id
			LEFT JOIN users cb ON cb.id = q.created_by
			LEFT JOIN organization_members cm ON cm.user_id = q.created_by AND cm.organization_id = q.organization_id
			LEFT JOIN teams t ON t.id = cm.team_id""";

	private final JdbcClient jdbc;

	private final TransactionTemplate tx;

	public QuoteRepository(JdbcClient jdbc, TransactionTemplate tx) {
		this.jdbc = jdbc;
		this.tx = tx;
	}

	/** Persists q, its items and ev in one transaction. */
	public void create(Quote q, NewEvent ev) {
		this.tx.executeWithoutResult((status) -> {
			try {
				this.jdbc.sql("""
						INSERT INTO quotes (id, organization_id, client_id, deal_id, quote_number, status, expiry_date,
							subtotal, discount_amount, tax_amount, grand_total, access_token, created_by, created_at)
						VALUES (:id, :org, :client, :deal, :number, :status, :expiry,
							:subtotal, :discount, :tax, :grand, :token, :createdBy, :createdAt)""")
					.param("id", q.id())
					.param("org", q.organizationId())
					.param("client", q.clientId())
					.param("deal", q.dealId())
					.param("number", q.quoteNumber())
					.param("status", q.status())
					.param("expiry", q.expiryDate())
					.param("subtotal", q.subtotal())
					.param("discount", q.discountAmount())
					.param("tax", q.taxAmount())
					.param("grand", q.grandTotal())
					.param("token", q.accessToken())
					.param("createdBy", (q.createdBy() != null) ? q.createdBy().id() : null)
					.param("createdAt", Rows.utc(q.createdAt()))
					.update();
			}
			catch (DuplicateKeyException ex) {
				throw new DuplicateNumberException(ex);
			}
			insertItems(q);
			insertEvent(q.id(), ev);
		});
	}

	/** Overwrites a draft's fields and items; StateConflictException if it is no longer a draft. */
	public void replace(Quote q, NewEvent ev) {
		this.tx.executeWithoutResult((status) -> {
			int rows;
			try {
				rows = this.jdbc.sql("""
						UPDATE quotes
						SET client_id = :client, deal_id = :deal, quote_number = :number, expiry_date = :expiry,
							subtotal = :subtotal, discount_amount = :discount, tax_amount = :tax, grand_total = :grand
						WHERE id = :id AND status = 'draft'""")
					.param("id", q.id())
					.param("client", q.clientId())
					.param("deal", q.dealId())
					.param("number", q.quoteNumber())
					.param("expiry", q.expiryDate())
					.param("subtotal", q.subtotal())
					.param("discount", q.discountAmount())
					.param("tax", q.taxAmount())
					.param("grand", q.grandTotal())
					.update();
			}
			catch (DuplicateKeyException ex) {
				throw new DuplicateNumberException(ex);
			}
			if (rows == 0) {
				throw new StateConflictException();
			}
			this.jdbc.sql("DELETE FROM quote_items WHERE quote_id = :id").param("id", q.id()).update();
			insertItems(q);
			insertEvent(q.id(), ev);
		});
	}

	private void insertItems(Quote q) {
		List<QuoteItem> items = q.items();
		for (int i = 0; i < items.size(); i++) {
			QuoteItem it = items.get(i);
			this.jdbc.sql("""
					INSERT INTO quote_items (id, quote_id, title, description, quantity, unit_price,
						discount_percent, tax_percent, line_total, position, category_id)
					VALUES (:id, :quote, :title, :description, :quantity, :unitPrice,
						:discount, :tax, :lineTotal, :position, :category)""")
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
				.param("category", (it.category() != null) ? it.category().id() : null)
				.update();
		}
	}

	private void insertEvent(UUID quoteId, NewEvent ev) {
		this.jdbc.sql("""
				INSERT INTO quote_events (quote_id, actor_user_id, action, comment, created_at)
				VALUES (:quote, :actor, :action, :comment, :at)""")
			.param("quote", quoteId)
			.param("actor", ev.actorId())
			.param("action", ev.action())
			.param("comment", ev.comment())
			.param("at", Rows.utc(ev.at()))
			.update();
	}

	public List<Summary> list(ListFilter f) {
		StringBuilder sql = new StringBuilder("""
				SELECT q.id, q.quote_number, c.name, q.status, q.grand_total, q.expiry_date, cb.id, cb.full_name
				FROM quotes q
				JOIN clients c ON c.id = q.client_id
				LEFT JOIN users cb ON cb.id = q.created_by
				LEFT JOIN organization_members cm ON cm.user_id = q.created_by AND cm.organization_id = q.organization_id
				LEFT JOIN teams t ON t.id = cm.team_id
				WHERE q.organization_id = :org""");
		List<Object[]> params = new ArrayList<>();
		params.add(new Object[] { "org", f.orgId() });
		if (f.status() != null) {
			sql.append(" AND q.status = :status");
			params.add(new Object[] { "status", f.status() });
		}
		if (f.createdBy() != null) {
			sql.append(" AND q.created_by = :createdBy");
			params.add(new Object[] { "createdBy", f.createdBy() });
		}
		if (f.teamWo() != null) {
			sql.append(" AND t.wo_user_id = :teamWo");
			params.add(new Object[] { "teamWo", f.teamWo() });
		}
		if (f.clientId() != null) {
			sql.append(" AND q.client_id = :clientId");
			params.add(new Object[] { "clientId", f.clientId() });
		}
		if (f.statuses() != null) {
			sql.append(" AND q.status IN (:statuses)");
			params.add(new Object[] { "statuses", f.statuses() });
		}
		sql.append(" ORDER BY q.created_at DESC, q.id");
		JdbcClient.StatementSpec spec = this.jdbc.sql(sql.toString());
		for (Object[] p : params) {
			spec = spec.param((String) p[0], p[1]);
		}
		return spec
			.query((rs, n) -> new Summary(Rows.uuid(rs, 1), rs.getString(2), rs.getString(3), rs.getString(4),
					rs.getBigDecimal(5), rs.getObject(6, LocalDate.class), Ref.of(Rows.uuid(rs, 7), rs.getString(8))))
			.list();
	}

	/** A quote of orgId with items, history, client name, creator and creator's team WO. */
	public Optional<Quote> get(UUID orgId, UUID id) {
		return this.jdbc.sql(QUOTE_COLUMNS + QUOTE_FROM + " WHERE q.id = :id AND q.organization_id = :org")
			.param("id", id)
			.param("org", orgId)
			.query((rs, n) -> scanQuote(rs))
			.optional()
			.map((q) -> q.withDetails(items(q.id()), history(q.id())));
	}

	public Optional<PublicView> getByAccessToken(UUID accessToken) {
		return this.jdbc.sql(QUOTE_COLUMNS + ", o.name" + QUOTE_FROM + """

				JOIN organizations o ON o.id = q.organization_id
				WHERE q.access_token = :token""")
			.param("token", accessToken)
			.query((rs, n) -> new PublicView(scanQuote(rs), rs.getString(21), null))
			.optional()
			.map((v) -> new PublicView(v.quote().withDetails(items(v.quote().id()), List.of()), v.vendorName(),
					null));
	}

	/** Sets status to {@code to} only if it is one of {@code from} (else StateConflictException) and records ev. */
	public void transition(UUID id, List<String> from, String to, NewEvent ev) {
		this.tx.executeWithoutResult((status) -> {
			int rows = this.jdbc.sql("UPDATE quotes SET status = :to WHERE id = :id AND status IN (:from)")
				.param("id", id)
				.param("to", to)
				.param("from", from)
				.update();
			if (rows == 0) {
				throw new StateConflictException();
			}
			insertEvent(id, ev);
		});
	}

	/** Records the signature like a transition to accepted. */
	public void accept(UUID id, List<String> from, String signedBy, String signatureData, NewEvent ev) {
		this.tx.executeWithoutResult((status) -> {
			int rows = this.jdbc.sql("""
					UPDATE quotes SET status = 'accepted', signed_by = :signedBy, signature_data = :signature, signed_at = :at
					WHERE id = :id AND status IN (:from)""")
				.param("id", id)
				.param("signedBy", signedBy)
				.param("signature", signatureData)
				.param("at", Rows.utc(ev.at()))
				.param("from", from)
				.update();
			if (rows == 0) {
				throw new StateConflictException();
			}
			insertEvent(id, ev);
		});
	}

	private List<QuoteItem> items(UUID quoteId) {
		return this.jdbc.sql("""
				SELECT i.id, i.title, COALESCE(i.description, ''), i.quantity, i.unit_price, i.discount_percent,
					i.tax_percent, i.line_total, c.id, c.name
				FROM quote_items i
				LEFT JOIN product_categories c ON c.id = i.category_id
				WHERE i.quote_id = :quote
				ORDER BY i.position, i.id""")
			.param("quote", quoteId)
			.query((rs, n) -> new QuoteItem(Rows.uuid(rs, 1), rs.getString(2),
					Ref.of(Rows.uuid(rs, 9), rs.getString(10)), rs.getString(3), rs.getBigDecimal(4),
					rs.getBigDecimal(5), rs.getBigDecimal(6), rs.getBigDecimal(7), rs.getBigDecimal(8)))
			.list();
	}

	private List<QuoteEvent> history(UUID quoteId) {
		return this.jdbc.sql("""
				SELECT e.action, e.actor_user_id, u.full_name, e.comment, e.created_at
				FROM quote_events e
				LEFT JOIN users u ON u.id = e.actor_user_id
				WHERE e.quote_id = :quote
				ORDER BY e.seq""")
			.param("quote", quoteId)
			.query((rs, n) -> new QuoteEvent(rs.getString(1), Ref.of(Rows.uuid(rs, 2), rs.getString(3)),
					rs.getString(4), Rows.instant(rs, 5)))
			.list();
	}

	private static Quote scanQuote(ResultSet rs) throws SQLException {
		return new Quote(Rows.uuid(rs, 1), Rows.uuid(rs, 2), Rows.uuid(rs, 3), rs.getString(4), Rows.uuid(rs, 5),
				rs.getString(6), rs.getString(7), rs.getObject(8, LocalDate.class), rs.getBigDecimal(9),
				rs.getBigDecimal(10), rs.getBigDecimal(11), rs.getBigDecimal(12), Rows.uuid(rs, 13), rs.getString(14),
				rs.getString(15), Rows.instant(rs, 16), Ref.of(Rows.uuid(rs, 18), rs.getString(19)), Rows.uuid(rs, 20),
				Rows.instant(rs, 17), List.of(), List.of());
	}

}
