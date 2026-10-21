package com.swiftquote.web.rest;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Instant;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.swiftquote.domain.Category;
import com.swiftquote.domain.Client;
import com.swiftquote.domain.Quote;
import com.swiftquote.domain.QuoteItem;
import com.swiftquote.domain.Ref;
import com.swiftquote.repository.AdminRepository;
import com.swiftquote.repository.DashboardRepository;
import com.swiftquote.repository.QuoteRepository;
import com.swiftquote.service.DashboardService;

/**
 * Wire types mirroring contracts/openapi.yaml and backend/go-service/internal/delivery/http/dto.go byte for byte:
 * money is a JSON number with exactly 2 decimals, timestamps are RFC 3339 with trailing zeros trimmed (Go's
 * RFC3339Nano), nullable fields are present as null, and ErrorResponse omits empty details.
 */
final class Dtos {

	private Dtos() {
	}

	record RefView(UUID id, String name) {

		static RefView of(Ref r) {
			return (r != null) ? new RefView(r.id(), r.name()) : null;
		}

	}

	record AuthUser(UUID id, String name, String role) {
	}

	record AuthResponse(String accessToken, UUID tenantId, AuthUser user) {
	}

	record ClientView(UUID id, String name, String email) {

		static ClientView of(Client c) {
			return new ClientView(c.id(), c.name(), c.email().isEmpty() ? null : c.email());
		}

	}

	record CategoryView(UUID id, String name, boolean active) {

		static CategoryView of(Category c) {
			return new CategoryView(c.id(), c.name(), c.active());
		}

	}

	record QuoteSummary(UUID id, String quoteNumber, String clientName, String status, BigDecimal grandTotal,
			String expiryDate, RefView createdBy) {

		static QuoteSummary of(QuoteRepository.Summary s) {
			return new QuoteSummary(s.id(), s.quoteNumber(), s.clientName(), s.status(), money(s.grandTotal()),
					date(s.expiryDate()), RefView.of(s.createdBy()));
		}

	}

	record QuoteItemView(String title, RefView category, String description, BigDecimal quantity,
			BigDecimal unitPrice, BigDecimal discountPercent, BigDecimal taxPercent, BigDecimal lineTotal) {

		static List<QuoteItemView> of(List<QuoteItem> items) {
			return items.stream()
				.map((it) -> new QuoteItemView(it.title(), RefView.of(it.category()),
						it.description().isEmpty() ? null : it.description(), money(it.quantity()),
						money(it.unitPrice()), money(it.discountPercent()), money(it.taxPercent()),
						money(it.lineTotal())))
				.toList();
		}

	}

	record EventView(String action, RefView actor, String comment, String at) {
	}

	record QuoteDetail(UUID id, String quoteNumber, String status, UUID clientId, String clientName,
			RefView createdBy, String expiryDate, BigDecimal subtotal, BigDecimal discountAmount,
			BigDecimal taxAmount, BigDecimal grandTotal, UUID accessToken, String signedBy, String signedAt,
			List<QuoteItemView> items, List<EventView> history) {

		static QuoteDetail of(Quote q) {
			return new QuoteDetail(q.id(), q.quoteNumber(), q.status(), q.clientId(), q.clientName(),
					RefView.of(q.createdBy()), date(q.expiryDate()), money(q.subtotal()), money(q.discountAmount()),
					money(q.taxAmount()), money(q.grandTotal()), q.accessToken(), q.signedBy(),
					timestamp(q.signedAt()), QuoteItemView.of(q.items()),
					q.history()
						.stream()
						.map((e) -> new EventView(e.action(), RefView.of(e.actor()), e.comment(), timestamp(e.at())))
						.toList());
		}

	}

	record PublicQuoteView(String quoteNumber, String status, String expiryDate, String signedBy, String signedAt,
			String vendorName, String vendorLogo, BigDecimal grandTotal, List<QuoteItemView> items) {

		static PublicQuoteView of(QuoteRepository.PublicView v) {
			Quote q = v.quote();
			return new PublicQuoteView(q.quoteNumber(), q.status(), date(q.expiryDate()), q.signedBy(),
					timestamp(q.signedAt()), v.vendorName(), v.vendorLogo(), money(q.grandTotal()),
					QuoteItemView.of(q.items()));
		}

	}

	record AdminUserView(UUID id, String email, String name, String role, boolean active, RefView team,
			RefView client) {

		static AdminUserView of(AdminRepository.User u) {
			return new AdminUserView(u.id(), u.email(), u.name(), u.role(), u.active(), RefView.of(u.team()),
					RefView.of(u.client()));
		}

	}

	record TeamView(UUID id, String name, RefView wo, List<RefView> members) {

		static TeamView of(AdminRepository.Team t) {
			return new TeamView(t.id(), t.name(), RefView.of(t.wo()), t.members().stream().map(RefView::of).toList());
		}

	}

	record MeasureView(long count, BigDecimal amount) {

		static MeasureView of(DashboardRepository.Measure m) {
			return new MeasureView(m.count(), money(m.amount()));
		}

	}

	record StatusRowView(String status, long count, BigDecimal amount) {
	}

	record MonthRowView(String month, MeasureView won, MeasureView pending) {
	}

	record RmRowView(RefView user, String team, long quoteCount, long sentCount, MeasureView won,
			MeasureView pending) {
	}

	record TeamRowView(UUID id, String name, MeasureView won, MeasureView pending) {
	}

	record CategoryRowView(RefView category, MeasureView won, MeasureView pending) {
	}

	record DashboardView(String from, String to, MeasureView won, MeasureView pending, MeasureView inApproval,
			long sentCount, BigDecimal conversionRate, List<StatusRowView> byStatus, List<MonthRowView> byMonth,
			List<RmRowView> byRm, List<TeamRowView> byTeam, List<CategoryRowView> byCategory) {

		static DashboardView of(DashboardService.Summary s) {
			return new DashboardView(date(s.range().from()), date(s.range().to()), MeasureView.of(s.won()),
					MeasureView.of(s.pending()), MeasureView.of(s.inApproval()), s.sentCount(),
					s.conversionRate().setScale(4, RoundingMode.HALF_UP),
					s.byStatus().stream().map((r) -> new StatusRowView(r.status(), r.count(), money(r.amount()))).toList(),
					s.byMonth()
						.stream()
						.map((r) -> new MonthRowView(r.month(), MeasureView.of(r.won()), MeasureView.of(r.pending())))
						.toList(),
					s.byRm()
						.stream()
						.map((r) -> new RmRowView(RefView.of(r.user()), r.team(), r.quoteCount(), r.sentCount(),
								MeasureView.of(r.won()), MeasureView.of(r.pending())))
						.toList(),
					s.byTeam()
						.stream()
						.map((r) -> new TeamRowView(r.id(), r.name(), MeasureView.of(r.won()),
								MeasureView.of(r.pending())))
						.toList(),
					s.byCategory()
						.stream()
						.map((r) -> new CategoryRowView(RefView.of(r.category()), MeasureView.of(r.won()),
								MeasureView.of(r.pending())))
						.toList());
		}

	}

	record ErrorResponse(String code, String message,
			@JsonInclude(JsonInclude.Include.NON_EMPTY) List<String> details) {
	}

	/** Exactly two decimal places, half away from zero, like Go's decimal.StringFixed(2). */
	static BigDecimal money(BigDecimal d) {
		return d.setScale(2, RoundingMode.HALF_UP);
	}

	static String date(LocalDate d) {
		return (d != null) ? d.toString() : null;
	}

	/** Go's time.RFC3339Nano in UTC: fractional seconds without trailing zeros, omitted when zero. */
	static String timestamp(Instant t) {
		if (t == null) {
			return null;
		}
		OffsetDateTime u = t.atOffset(ZoneOffset.UTC);
		StringBuilder b = new StringBuilder(
				"%04d-%02d-%02dT%02d:%02d:%02d".formatted(u.getYear(), u.getMonthValue(), u.getDayOfMonth(),
						u.getHour(), u.getMinute(), u.getSecond()));
		int nanos = u.getNano();
		if (nanos != 0) {
			String frac = "%09d".formatted(nanos);
			int end = frac.length();
			while (frac.charAt(end - 1) == '0') {
				end--;
			}
			b.append('.').append(frac, 0, end);
		}
		return b.append('Z').toString();
	}

}
