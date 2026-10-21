package com.swiftquote.web.rest;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.swiftquote.domain.Client;
import com.swiftquote.domain.Quote;
import com.swiftquote.domain.QuoteItem;
import com.swiftquote.domain.QuoteStatus;
import com.swiftquote.repository.QuoteRepository;

/**
 * Wire types mirroring the schemas in contracts/openapi.yaml and the Go service's JSON byte for byte: money is a JSON
 * number with exactly 2 decimals, nullable fields are present as null, and ErrorResponse omits empty details.
 */
final class Dtos {

	private Dtos() {
	}

	record LoginRequest(String email, String password) {
	}

	record AuthUser(UUID id, String name, String role) {
	}

	record AuthResponse(String accessToken, UUID tenantId, AuthUser user) {
	}

	record ClientView(UUID id, String name, String email) {

		static ClientView of(Client c) {
			return new ClientView(c.id(), c.name(), (c.email() == null || c.email().isEmpty()) ? null : c.email());
		}

	}

	record QuoteItemInput(String title, String description, BigDecimal quantity, BigDecimal unitPrice,
			BigDecimal discountPercent, BigDecimal taxPercent) {
	}

	record CreateQuoteRequest(UUID clientId, UUID dealId, String quoteNumber, LocalDate expiryDate,
			List<QuoteItemInput> items) {
	}

	record AcceptQuoteRequest(String signerName, String signatureDataUrl) {
	}

	record QuoteSummary(UUID id, String quoteNumber, String clientName, QuoteStatus status, BigDecimal grandTotal,
			LocalDate expiryDate) {

		static QuoteSummary of(QuoteRepository.Summary s) {
			return new QuoteSummary(s.id(), s.quoteNumber(), s.clientName(), s.status(), money(s.grandTotal()),
					s.expiryDate());
		}

	}

	record QuoteItemView(String title, BigDecimal quantity, BigDecimal unitPrice, BigDecimal lineTotal) {

		static List<QuoteItemView> of(List<QuoteItem> items) {
			return items.stream()
				.map((it) -> new QuoteItemView(it.title(), money(it.quantity()), money(it.unitPrice()),
						money(it.lineTotal())))
				.toList();
		}

	}

	record QuoteDetail(UUID id, String quoteNumber, QuoteStatus status, LocalDate expiryDate, BigDecimal subtotal,
			BigDecimal discountAmount, BigDecimal taxAmount, BigDecimal grandTotal, UUID accessToken, String signedBy,
			Instant signedAt, List<QuoteItemView> items) {

		static QuoteDetail of(Quote q) {
			return new QuoteDetail(q.id(), q.quoteNumber(), q.status(), q.expiryDate(), money(q.subtotal()),
					money(q.discountAmount()), money(q.taxAmount()), money(q.grandTotal()), q.accessToken(),
					q.signedBy(), q.signedAt(), QuoteItemView.of(q.items()));
		}

	}

	record PublicQuoteView(String quoteNumber, QuoteStatus status, LocalDate expiryDate, String signedBy,
			Instant signedAt, String vendorName, String vendorLogo, BigDecimal grandTotal,
			List<QuoteItemView> items) {

		static PublicQuoteView of(QuoteRepository.PublicView v) {
			Quote q = v.quote();
			return new PublicQuoteView(q.quoteNumber(), q.status(), q.expiryDate(), q.signedBy(), q.signedAt(),
					v.vendorName(), null, money(q.grandTotal()), QuoteItemView.of(q.items()));
		}

	}

	record ErrorResponse(String code, String message, @JsonInclude(JsonInclude.Include.NON_EMPTY) List<String> details) {
	}

	/** Exactly two decimal places, as the Go service renders money. */
	static BigDecimal money(BigDecimal d) {
		return d.setScale(2, RoundingMode.HALF_UP);
	}

}
