package com.swiftquote.domain;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

/**
 * A quotation with its lines and history. creatorTeamWo is the WO currently leading the creator's team, if any; it
 * decides who may approve.
 */
public record Quote(UUID id, UUID organizationId, UUID clientId, String clientName, UUID dealId, String quoteNumber,
		String status, LocalDate expiryDate, BigDecimal subtotal, BigDecimal discountAmount, BigDecimal taxAmount,
		BigDecimal grandTotal, UUID accessToken, String signedBy, String signatureData, Instant signedAt,
		Ref createdBy, UUID creatorTeamWo, Instant createdAt, List<QuoteItem> items, List<QuoteEvent> history) {

	public Quote withDetails(List<QuoteItem> newItems, List<QuoteEvent> newHistory) {
		return new Quote(this.id, this.organizationId, this.clientId, this.clientName, this.dealId, this.quoteNumber,
				this.status, this.expiryDate, this.subtotal, this.discountAmount, this.taxAmount, this.grandTotal,
				this.accessToken, this.signedBy, this.signatureData, this.signedAt, this.createdBy,
				this.creatorTeamWo, this.createdAt, newItems, newHistory);
	}

	public Quote withHistory(List<QuoteEvent> newHistory) {
		return withDetails(this.items, newHistory);
	}

}
