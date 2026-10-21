package com.swiftquote.domain;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

/** A priced quotation. Monetary fields are BigDecimal with scale 2, never double. */
public record Quote(UUID id, UUID organizationId, UUID clientId, UUID dealId, String quoteNumber, QuoteStatus status,
		LocalDate expiryDate, BigDecimal subtotal, BigDecimal discountAmount, BigDecimal taxAmount,
		BigDecimal grandTotal, UUID accessToken, String signedBy, String signatureData, Instant signedAt,
		Instant createdAt, List<QuoteItem> items) {

	public Quote withItems(List<QuoteItem> newItems) {
		return new Quote(id, organizationId, clientId, dealId, quoteNumber, status, expiryDate, subtotal,
				discountAmount, taxAmount, grandTotal, accessToken, signedBy, signatureData, signedAt, createdAt,
				newItems);
	}

}
