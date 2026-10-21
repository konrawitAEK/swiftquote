package com.swiftquote.domain;

import java.math.BigDecimal;
import java.util.UUID;

public record QuoteItem(UUID id, String title, String description, BigDecimal quantity, BigDecimal unitPrice,
		BigDecimal discountPercent, BigDecimal taxPercent, BigDecimal lineTotal) {

	public QuoteItem withIdAndLineTotal(UUID newId, BigDecimal newLineTotal) {
		return new QuoteItem(newId, title, description, quantity, unitPrice, discountPercent, taxPercent,
				newLineTotal);
	}

}
